<?php
/*
 * =====================================================================
 *  backend/Core/CrewAttendance.php  —  Crew attendance rules (Checklist #42)
 * =====================================================================
 *  DAILY_ATTENDANCE_V1 — no permanent Day/Night shifts for drivers, helpers or mechanics any more:
 *   - dayFor(): the ONE place that turns a moment (Philippine time) into the attendance duty date (calendar date).
 *     Attendance is one mark per person per date in attendance_daily. personnel.duty_shift / mechanics.duty_shift and the
 *     legacy attendance_marks table are kept as untouched history and are never read for rosters or dispatch checks.
 *  Enforcement (CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1):
 *   - mode(): Admin setting crew_attendance_dispatch_check, 1 = Warn (default), 2 = Enforce.
 *   - dispatchFindings(): attendance of every assigned driver / Driver 2 / helper for the date of the ACTUAL
 *     dispatch time (Philippine time). Warn: reported and noted; Enforce: Confirm Dispatch / Redispatch refused.
 *   - Present never bypasses availability, license or double-booking (FleetState::personBlocker in Enforce).
 * =====================================================================
 */
declare(strict_types=1);
core('Settings');

final class CrewAttendance {
    public const CREW_TYPES = ['Driver', 'Helper'];

    /** ['date' => 'Y-m-d'] for a Unix time (default: now), Philippine time. */
    public static function dayFor(?int $ts = null): array {
        return ['date' => date('Y-m-d', $ts ?? time())];
    }

    /** Hour (0-23) from which the Admin bell reminds about unmarked attendance of the current date. */
    public static function reminderHour(): int {
        return max(0, min(23, (int)Settings::value('attendance_day_start_hour')));
    }

    /** 12-hour display of an hour (0-23): 0 -> "12:00 AM", 6 -> "6:00 AM", 12 -> "12:00 PM", 18 -> "6:00 PM". */
    public static function hourLabel(int $h): string {
        return (($h % 12) ?: 12) . ':00 ' . ($h < 12 ? 'AM' : 'PM');
    }

    public const MODE_WARN = 1;
    public const MODE_ENFORCE = 2;
    public static function mode(): int {
        return (int)Settings::value('crew_attendance_dispatch_check') === self::MODE_ENFORCE ? self::MODE_ENFORCE : self::MODE_WARN;
    }
    public static function modeName(?int $mode = null): string { return ($mode ?? self::mode()) === self::MODE_ENFORCE ? 'Enforce' : 'Warn'; }

    /** "Nov 8, 2026". */
    public static function dayText(array $s): string {
        return date('M j, Y', strtotime($s['date']));
    }

    /**
     * Attendance of the trip crew for a moment (default now = the actual dispatch time).
     * Returns ['day' => dayFor(ts), 'crew' => [per person: id, name, role, status, issue, problem|null]].
     * $lock: read the attendance rows FOR SHARE inside the dispatch transaction, so an Admin change made at the
     * same moment waits for the dispatch (or the dispatch waits for it) — never a half-old decision.
     */
    public static function dispatchFindings(PDO $p, array $t, ?int $ts = null, bool $lock = false): array {
        $s = self::dayFor($ts);
        $crew = [];
        foreach (['driver_id' => 'Driver', 'driver2_id' => 'Driver 2', 'helper_id' => 'Helper'] as $col => $role) {
            if (empty($t[$col])) continue;
            $pe = one($p, 'SELECT id, full_name FROM personnel WHERE id=?', [(int)$t[$col]]);
            if (!$pe) continue;
            $mark = one($p, 'SELECT status FROM attendance_daily WHERE duty_date=? AND personnel_id=?' . ($lock ? ' LOCK IN SHARE MODE' : ''),
                [$s['date'], (int)$pe['id']]);
            $status = $mark['status'] ?? null;
            $name = $pe['full_name'] . ' (' . $role . ')';
            $issue = null;
            if ($status === 'Absent') $issue = 'Absent';
            elseif ($status !== 'Present') $issue = 'Not Yet Marked';
            if ($status === 'Absent') $problem = $name . ' is marked Absent for ' . self::dayText($s) . '. The Operations Head reassigns the crew, or the Admin corrects the attendance.';
            elseif ($status !== 'Present') $problem = $name . ' is not yet marked Present for ' . self::dayText($s) . '. The Admin marks attendance.';
            else $problem = null;
            $crew[] = ['id' => (int)$pe['id'], 'name' => $pe['full_name'], 'role' => $role, 'status' => $status ?? 'Not Yet Marked', 'issue' => $issue, 'problem' => $problem];
        }
        return ['day' => $s, 'crew' => $crew];
    }

    /**
     * Readiness before / while using Enforce: upcoming not-dispatched trips (overdue or scheduled in the next 48 hours)
     * whose assigned crew are already marked Absent for the trip's date. Read-only; nothing is changed.
     */
    public static function readiness(PDO $p): array {
        $trips = many($p, "SELECT id, trip_ref, scheduled_at, status, driver_id, driver2_id, helper_id FROM trips
                           WHERE status IN ('Pre-Assigned','Ready for Dispatch','For Reschedule') AND scheduled_at <= DATE_ADD(NOW(), INTERVAL 48 HOUR)
                           ORDER BY scheduled_at LIMIT 200");
        $out = [];
        foreach ($trips as $t) {
            $day = self::dayFor(strtotime((string)$t['scheduled_at']));
            $issues = [];
            foreach (['driver_id' => 'Driver', 'driver2_id' => 'Driver 2', 'helper_id' => 'Helper'] as $col => $role) {
                if (!$t[$col]) continue;
                $pe = one($p, 'SELECT full_name FROM personnel WHERE id=?', [(int)$t[$col]]);
                $mark = one($p, 'SELECT status FROM attendance_daily WHERE duty_date=? AND personnel_id=?', [$day['date'], (int)$t[$col]]);
                if (($mark['status'] ?? null) === 'Absent') $issues[] = $pe['full_name'] . " ($role): marked Absent";
            }
            if ($issues) $out[] = ['trip_id' => (int)$t['id'], 'trip_ref' => $t['trip_ref'], 'scheduled_at' => $t['scheduled_at'], 'status' => $t['status'],
                                   'scheduled_day' => self::dayText($day), 'issues' => $issues];
        }
        return ['mode' => self::modeName(), 'trips' => $out];
    }

    /**
     * The date that decides crew for a trip that is not dispatched yet: its scheduled date, or today once the
     * schedule has passed (an overdue trip leaves with whoever is on duty now).
     */
    public static function planningDay(array $t, ?int $now = null): array {
        $now ??= time();
        $ts = strtotime((string)$t['scheduled_at']) ?: $now;
        return self::dayFor($ts < $now ? $now : $ts);
    }

    /** Assignment check of one person for a planning date: ['name', 'type', 'attendance', 'absent']. */
    public static function assignmentCheck(PDO $p, int $personId, array $day): ?array {
        $pe = one($p, 'SELECT full_name, person_type FROM personnel WHERE id=?', [$personId]);
        if (!$pe) return null;
        $m = one($p, 'SELECT status FROM attendance_daily WHERE duty_date=? AND personnel_id=?', [$day['date'], $personId]);
        return ['name' => $pe['full_name'], 'type' => $pe['person_type'], 'attendance' => $m['status'] ?? 'Not Yet Marked',
                'absent' => ($m['status'] ?? null) === 'Absent'];
    }

    /**
     * Required crew (CHECKLIST_42_CREW_COMPLETENESS_V1), checked at Confirm Dispatch / Redispatch in BOTH modes:
     * Car Carrier = two different active drivers (Driver 1 and Driver 2); Container / Wing Van = one active driver and one
     * active helper. Returns the problems (empty = complete).
     */
    public static function crewCompleteness(PDO $p, array $t): array {
        $need = $t['truck_type'] === 'Car Carrier' ? ['driver_id' => ['Driver 1', 'Driver'], 'driver2_id' => ['Driver 2', 'Driver']]
                                                    : ['driver_id' => ['Driver', 'Driver'], 'helper_id' => ['Helper', 'Helper']];
        $why = []; $seen = [];
        foreach ($need as $col => [$role, $type]) {
            $id = (int)($t[$col] ?? 0);
            if (!$id) { $why[] = 'No ' . $role . ' assigned: a ' . $t['truck_type'] . ' trip needs ' . ($t['truck_type'] === 'Car Carrier' ? 'two drivers' : 'a driver and a helper') . '. The Operations Head assigns the crew.'; continue; }
            if (isset($seen[$id])) { $why[] = 'The same person is assigned as ' . $seen[$id] . ' and ' . $role . '. Assign two different drivers.'; continue; }
            $seen[$id] = $role;
            $pe = one($p, 'SELECT full_name, person_type, active FROM personnel WHERE id=?', [$id]);
            if (!$pe || !(int)$pe['active']) $why[] = $role . ' ' . ($pe['full_name'] ?? '') . ' is not an active ' . strtolower($type) . '.';
            elseif ($pe['person_type'] !== $type) $why[] = $pe['full_name'] . ' is a ' . $pe['person_type'] . ', not a ' . $type . ' (' . $role . ').';
        }
        return $why;
    }
}
