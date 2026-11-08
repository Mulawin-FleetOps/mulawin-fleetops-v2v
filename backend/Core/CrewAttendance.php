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
 *  Not yet used for trip assignment or Confirm Dispatch (hard blocker pending rollout review).
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

    /** Active drivers and helpers with no assigned shift (not in any attendance roster). */
    public static function unassignedCrew(PDO $p): array {
        return many($p, "SELECT id, full_name, person_type FROM personnel WHERE active=1 AND person_type IN ('Driver','Helper') AND duty_shift IS NULL
                         ORDER BY person_type, full_name");
    }
}
