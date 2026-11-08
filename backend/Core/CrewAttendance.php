<?php
/*
 * =====================================================================
 *  backend/Core/CrewAttendance.php  —  Crew attendance rules (Checklist #42 Phase 2)
 * =====================================================================
 *  CHECKLIST_42_ATTENDANCE_PHASE2_V1 — preparation step:
 *   - shiftFor(): the ONE place that turns a moment (Philippine time) into an attendance
 *     duty date + shift, using the Admin start hours from Phase 1
 *     (attendance_day_start_hour, attendance_night_start_hour).
 *     A Night shift that crosses midnight keeps the date it STARTED on
 *     (same rule as the Phase 1 bell reminder, which now uses this function).
 *   - unassignedCrew(): active drivers / helpers without an assigned shift
 *     (they cannot appear in any attendance roster; Admin backfills them).
 *  Enforcement (CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1):
 *   - mode(): Admin setting crew_attendance_dispatch_check, 1 = Warn (default), 2 = Enforce.
 *   - dispatchFindings(): attendance of every assigned driver / Driver 2 / helper for the shift of the ACTUAL
 *     dispatch time (Philippine time). Warn: reported and noted; Enforce: Confirm Dispatch / Redispatch refused.
 *   - Present never bypasses availability, license or double-booking (FleetState::personBlocker in Enforce).
 * =====================================================================
 */
declare(strict_types=1);
core('Settings');

final class CrewAttendance {
    public const SHIFTS = ['Day', 'Night'];
    public const CREW_TYPES = ['Driver', 'Helper'];

    /** ['date' => 'Y-m-d', 'shift' => 'Day'|'Night'] for a Unix time (default: now). */
    public static function shiftFor(?int $ts = null): array {
        $ts ??= time();
        [$day, $night] = self::startHours();
        $h = (int)date('G', $ts);
        // Normal setup: Day start < Night start (default 6 and 18). If an Admin sets them the other way
        // round, the Day shift is the part from the Day start that wraps past midnight.
        $isDay = $day < $night ? ($h >= $day && $h < $night) : ($h >= $day || $h < $night);
        if ($isDay) {
            $date = $day < $night || $h >= $day ? date('Y-m-d', $ts) : date('Y-m-d', strtotime('-1 day', $ts));
            return ['date' => $date, 'shift' => 'Day'];
        }
        // Night: before the Night start hour (early morning) it belongs to the previous date's Night shift.
        $date = $h >= $night ? date('Y-m-d', $ts) : date('Y-m-d', strtotime('-1 day', $ts));
        return ['date' => $date, 'shift' => 'Night'];
    }

    /**
     * Day and Night start hours (Admin settings). Saving identical hours is refused (Admin settings); if an old or
     * manually edited value is identical anyway, the defaults 6 / 18 are used so a Night shift always exists.
     */
    public static function startHours(): array {
        $day = (int)Settings::value('attendance_day_start_hour');
        $night = (int)Settings::value('attendance_night_start_hour');
        if ($day === $night) {
            error_log('CrewAttendance: Day and Night shift start hours are identical (' . $day . '); using 6 and 18.');
            return [6, 18];
        }
        return [$day, $night];
    }

    /**
     * Shifts the Admin bell reminds about at a moment: every shift that has STARTED on the current calendar date
     * (Philippine time) plus the shift in progress (which may have started the previous date and crossed midnight).
     * Works for both orderings of the start hours (Day before Night, or Day after Night), with the same duty
     * dates as shiftFor(). Returns [['Day'|'Night', 'Y-m-d'], ...] without duplicates, earliest start first.
     */
    public static function dueShifts(?int $ts = null): array {
        $ts ??= time();
        [$day, $night] = self::startHours();
        $today = date('Y-m-d', $ts); $h = (int)date('G', $ts);
        $started = [];
        foreach (['Day' => $day, 'Night' => $night] as $shift => $start) if ($h >= $start) $started[$start] = [$shift, $today];
        ksort($started);
        $due = array_values($started);
        $cur = self::shiftFor($ts);
        if (!in_array([$cur['shift'], $cur['date']], $due, true)) array_unshift($due, [$cur['shift'], $cur['date']]);
        return $due;
    }

    /** 12-hour display of a start hour (0-23): 0 -> "12:00 AM", 6 -> "6:00 AM", 12 -> "12:00 PM", 18 -> "6:00 PM". */
    public static function hourLabel(int $h): string {
        return (($h % 12) ?: 12) . ':00 ' . ($h < 12 ? 'AM' : 'PM');
    }

    public const MODE_WARN = 1;
    public const MODE_ENFORCE = 2;
    public static function mode(): int {
        return (int)Settings::value('crew_attendance_dispatch_check') === self::MODE_ENFORCE ? self::MODE_ENFORCE : self::MODE_WARN;
    }
    public static function modeName(?int $mode = null): string { return ($mode ?? self::mode()) === self::MODE_ENFORCE ? 'Enforce' : 'Warn'; }

    /** "Night shift of Nov 8, 2026 (from 6:00 PM)". */
    public static function shiftText(array $s): string {
        [$day, $night] = self::startHours();
        return $s['shift'] . ' shift of ' . date('M j, Y', strtotime($s['date'])) . ' (from ' . self::hourLabel($s['shift'] === 'Day' ? $day : $night) . ')';
    }

    /**
     * Attendance of the trip crew for a moment (default now = the actual dispatch time).
     * Returns ['shift' => shiftFor(ts), 'crew' => [per person: id, name, role, duty_shift, status, problem|null]].
     * $lock: read the attendance rows FOR SHARE inside the dispatch transaction, so an Admin change made at the
     * same moment waits for the dispatch (or the dispatch waits for it) — never a half-old decision.
     */
    public static function dispatchFindings(PDO $p, array $t, ?int $ts = null, bool $lock = false): array {
        $s = self::shiftFor($ts);
        $crew = [];
        foreach (['driver_id' => 'Driver', 'driver2_id' => 'Driver 2', 'helper_id' => 'Helper'] as $col => $role) {
            if (empty($t[$col])) continue;
            $pe = one($p, 'SELECT id, full_name, duty_shift FROM personnel WHERE id=?', [(int)$t[$col]]);
            if (!$pe) continue;
            $mark = one($p, 'SELECT status FROM attendance_marks WHERE duty_date=? AND duty_shift=? AND personnel_id=?' . ($lock ? ' LOCK IN SHARE MODE' : ''),
                [$s['date'], $s['shift'], (int)$pe['id']]);
            $status = $mark['status'] ?? null;
            $name = $pe['full_name'] . ' (' . $role . ')';
            $issue = null;
            if ($pe['duty_shift'] === null) $issue = 'No shift';
            elseif ($pe['duty_shift'] !== $s['shift']) $issue = 'Shift mismatch';
            elseif ($status === 'Absent') $issue = 'Absent';
            elseif ($status !== 'Present') $issue = 'Not Yet Marked';
            if ($pe['duty_shift'] === null) $problem = $name . ' has no assigned shift. The Admin assigns a Day or Night shift in the masterlist.';
            elseif ($pe['duty_shift'] !== $s['shift']) {
                $problem = $name . ' is on the ' . $pe['duty_shift'] . ' shift, but Confirm Dispatch now falls in the ' . self::shiftText($s) . '. '
                         . 'Wait for the ' . $pe['duty_shift'] . ' shift (from ' . self::hourLabel($pe['duty_shift'] === 'Day' ? self::startHours()[0] : self::startHours()[1]) . '), '
                         . 'or the Operations Head assigns ' . $s['shift'] . '-shift crew.';
            }
            elseif ($status === 'Absent') $problem = $name . ' is marked Absent for the ' . self::shiftText($s) . '. The Operations Head reassigns the crew, or the Admin corrects the attendance.';
            elseif ($status !== 'Present') $problem = $name . ' is not yet marked Present for the ' . self::shiftText($s) . '. The Admin marks attendance.';
            else $problem = null;
            $crew[] = ['id' => (int)$pe['id'], 'name' => $pe['full_name'], 'role' => $role, 'duty_shift' => $pe['duty_shift'], 'status' => $status ?? 'Not Yet Marked', 'issue' => $issue, 'problem' => $problem];
        }
        return ['shift' => $s, 'crew' => $crew];
    }

    /**
     * Readiness before / while using Enforce: crew without a shift, and upcoming not-dispatched trips (overdue or
     * scheduled in the next 48 hours) whose assigned crew are on another shift than the trip's scheduled shift,
     * have no shift, or are already marked Absent for it. Read-only; nothing is changed.
     */
    public static function readiness(PDO $p): array {
        $trips = many($p, "SELECT id, trip_ref, scheduled_at, status, driver_id, driver2_id, helper_id FROM trips
                           WHERE status IN ('Pre-Assigned','Ready for Dispatch','For Reschedule') AND scheduled_at <= DATE_ADD(NOW(), INTERVAL 48 HOUR)
                           ORDER BY scheduled_at LIMIT 200");
        $out = [];
        foreach ($trips as $t) {
            $sched = self::shiftFor(strtotime((string)$t['scheduled_at']));
            $issues = [];
            foreach (['driver_id' => 'Driver', 'driver2_id' => 'Driver 2', 'helper_id' => 'Helper'] as $col => $role) {
                if (!$t[$col]) continue;
                $pe = one($p, 'SELECT full_name, duty_shift FROM personnel WHERE id=?', [(int)$t[$col]]);
                $mark = one($p, 'SELECT status FROM attendance_marks WHERE duty_date=? AND duty_shift=? AND personnel_id=?', [$sched['date'], $sched['shift'], (int)$t[$col]]);
                if ($pe['duty_shift'] === null) $issues[] = $pe['full_name'] . " ($role): no assigned shift";
                elseif ($pe['duty_shift'] !== $sched['shift']) $issues[] = $pe['full_name'] . " ($role): " . $pe['duty_shift'] . ' shift, trip is ' . $sched['shift'] . ' shift';
                elseif (($mark['status'] ?? null) === 'Absent') $issues[] = $pe['full_name'] . " ($role): marked Absent";
            }
            if ($issues) $out[] = ['trip_id' => (int)$t['id'], 'trip_ref' => $t['trip_ref'], 'scheduled_at' => $t['scheduled_at'], 'status' => $t['status'],
                                   'scheduled_shift' => self::shiftText($sched), 'issues' => $issues];
        }
        return ['mode' => self::modeName(), 'unassigned' => self::unassignedCrew($p), 'trips' => $out];
    }

    /** Active drivers and helpers with no assigned shift (not in any attendance roster). */
    public static function unassignedCrew(PDO $p): array {
        return many($p, "SELECT id, full_name, person_type FROM personnel WHERE active=1 AND person_type IN ('Driver','Helper') AND duty_shift IS NULL
                         ORDER BY person_type, full_name");
    }
}
