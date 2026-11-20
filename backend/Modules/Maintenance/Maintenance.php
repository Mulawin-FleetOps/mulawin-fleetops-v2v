<?php
/*
 * =====================================================================
 *  backend/Modules/Maintenance/Maintenance.php  —  CORRECTIVE MAINTENANCE
 * =====================================================================
 *  Objective 2.1  maintenance records (findings, problems, repair activities,
 *                 parts used, repair dates, costs, documents)
 *  Objective 2.2  repairs from trip incident reports + truck availability
 *  Objective 2.3  on-premise repairs (inspection, repair, completion, verification)
 *  Objective 2.6  monitoring of ongoing and completed repairs
 *
 *  Corrective maintenance = an unexpected truck problem that needs inspection,
 *  diagnosis and repair. (There is no monthly preventive maintenance.)
 *
 *  Workflow (Motorpool Custodian):
 *    Reported          problem reported (garage) or incident reported (dispatcher)
 *    Under Inspection  an Available mechanic from the Mechanic Masterlist is assigned
 *                      (incidents: Minor / Major assessment happens here too)
 *    Under Repair      inspection findings and diagnosis recorded
 *    Completed         corrective action, completion date and evidence recorded;
 *                      the mechanic becomes free again
 *    Verify & return   operational check passed -> ONLY NOW the truck is available
 *    Cancelled         garage report made by mistake (no parts released)
 *
 *  Truck availability: a truck with an unresolved record is Under Maintenance and
 *  cannot be assigned (a Minor roadside repair keeps it On Trip). Trips that had the
 *  truck reserved are re-assigned automatically. Database rules: one unresolved
 *  record per truck, one active repair per mechanic.
 * =====================================================================
 */
declare(strict_types=1);
core('FleetState');
core('Notify');
core('Files');
core('Money');

final class Maintenance {
    private const ACT = ['motorpool'];
    public const COST_TYPES = ['Labor', 'Outside Service', 'Materials', 'Other'];
    public const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];
    public const ACTIVE = ['Reported', 'Under Inspection', 'Under Repair'];

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        if ($page === 'maintenance_overview') return self::overview($u, $p);
        if ($page === 'maint_history') return self::history($u, $p);
        // Expose the saved RA lock to the list page. Older installations
        // without the Motorpool catalog migration still render safely.
        $finalizedField = self::catalogReady($p)
            ? 'm.assignment_finalized_at' : 'NULL AS assignment_finalized_at';
        $data = readSections([
            'jobs' => fn() => many($p, "SELECT m.id, m.job_ref, m.vehicle_id, m.source, m.problem, m.reported_on, m.priority, m.severity, m.status, m.mechanic_id, m.trip_id, m.incident_id,
                    $finalizedField, m.expected_completion, m.completed_on, m.verified_at, m.created_at, mc.full_name AS mechanic, mc.mechanic_code,
                    v.plate_number, v.truck_number, v.truck_type, v.status AS truck_status,
                    i.incident_ref, i.status AS incident_status, i.clearance AS incident_clearance, t.trip_ref, t.status AS trip_status,
                    (SELECT COALESCE(SUM(c.amount),0) FROM maintenance_costs c WHERE c.maintenance_job_id=m.id) AS other_cost,
                    (SELECT COALESCE(SUM(l.released_qty*l.unit_cost),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.maintenance_job_id=m.id) AS parts_cost,
                    (SELECT COALESCE(SUM(l.quantity-l.released_qty),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.maintenance_job_id=m.id AND r.status <> 'Cancelled') AS pending_parts_units
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id
                LEFT JOIN incidents i ON i.id=m.incident_id LEFT JOIN trips t ON t.id=m.trip_id
                ORDER BY FIELD(m.status,'Reported','Under Inspection','Under Repair','Completed','Cancelled'), m.id DESC LIMIT 1000"),
        ] + self::formSections($p));
        // JOB_HELPER_MECHANICS_V1: assisting mechanics of the active repairs (empty until migration 12 is applied).
        $data['helpers'] = self::helpersReady($p) ? many($p, "SELECT h.maintenance_job_id AS job_id, h.mechanic_id, mc.full_name, mc.mechanic_code FROM maintenance_job_helpers h
                JOIN mechanics mc ON mc.id=h.mechanic_id WHERE h.released_at IS NULL ORDER BY h.id") : [];
        $data['helpersReady'] = self::helpersReady($p);
        $data['motorpoolCatalogReady'] = self::catalogReady($p);
        $data['components'] = self::catalogReady($p) ? many($p, "SELECT c.id,c.component_key,c.section_key,c.label, GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS suggested_skills
            FROM motorpool_components c LEFT JOIN motorpool_component_skills cs ON cs.component_id=c.id
            LEFT JOIN mechanic_specializations s ON s.id=cs.specialization_id WHERE c.active=1 GROUP BY c.id,c.component_key,c.section_key,c.label ORDER BY c.id") : [];
        $data['mechanicSkills'] = self::catalogReady($p) ? many($p, 'SELECT ms.mechanic_id, s.name FROM mechanic_skills ms JOIN mechanic_specializations s ON s.id=ms.specialization_id') : [];
        $data['costTypes'] = self::COST_TYPES;
        $data['can'] = ['act' => hasRole($u, ...self::ACT)];
        return $data;
    }

    /** Trucks and mechanics for the "Report a truck problem" form (Repair Management and Overview). */
    private static function formSections(PDO $p): array {
        return [
            'trucks' => fn() => many($p, "SELECT v.id, v.plate_number, v.truck_number, v.truck_type, v.status,
                    (SELECT m.job_ref FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job,
                    (SELECT t.trip_ref FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='vehicle' AND a.resource_id=v.id AND t.status IN ('Dispatched','On Hold - Incident Reported','In Transit','Completed') LIMIT 1) AS on_road
                FROM vehicles v WHERE v.active=1 ORDER BY v.plate_number"),
            'mechanics' => fn() => many($p, "SELECT id, mechanic_code, full_name, specialization, availability FROM mechanics WHERE active=1 ORDER BY full_name"),
        ];
    }

    /*
     * MAINTENANCE_OVERVIEW_PHASE1_V1 — read-only landing page for the Motorpool Custodian.
     * Uses only existing statuses and records; nothing is written here.
     *   - "For verification" = status Completed with verified_at still empty (the existing
     *     Verify & return to service step; it is not a separate status value).
     *   - Parts request data is included only for Motorpool and roles that may open Parts Requests.
     *   - Recent activity = maintenance_events (+ parts requests and stock-out releases).
     */
    private const OVERVIEW_ATTENTION_LIMIT = 25;
    private const OVERVIEW_ACTIVITY_LIMIT = 15;

    private static function overview(array $u, PDO $p): array {
        // Parts data: Motorpool (its own requests) and the roles that can open the Parts Requests page.
        // Never inventory values, budget, purchase orders or supplier data.
        $parts = hasRole($u, 'motorpool') || Access::canOpen($u, 'parts_requests');
        $data = readSections([
            'summary' => fn() => self::overviewSummary($p, $parts),
            'attention' => fn() => self::overviewAttention($p, $parts),
            'activity' => fn() => self::overviewActivity($p, $parts),
            // MOTORPOOL_UI_V2 dashboard: fleet status (replaces the Truck Masterlist menu), long-running repairs, this month.
            'fleetStatus' => fn() => array_map('intval', one($p, "SELECT COALESCE(SUM(status='Available'),0) AS available,
                    COALESCE(SUM(status='On Trip'),0) AS on_trip, COALESCE(SUM(status='Assigned'),0) AS assigned, COALESCE(SUM(status='Under Maintenance'),0) AS under_maintenance,
                    COALESCE(SUM(status='Unavailable'),0) AS unavailable, COUNT(*) AS active FROM vehicles WHERE active=1")),
            'stale' => fn() => many($p, "SELECT m.id AS job_id, m.job_ref, m.status, v.plate_number, mc.full_name AS mechanic,
                    DATEDIFF(CURRENT_DATE(), m.reported_on) AS days
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id
                WHERE m.open_key=1 AND m.status IN ('Reported','Under Inspection','Under Repair') AND DATEDIFF(CURRENT_DATE(), m.reported_on) >= " . self::STALE_DAYS . "
                ORDER BY days DESC, m.id LIMIT 10"),
            'month' => fn() => self::overviewMonth($p),
            // STAGE_A_MOTORPOOL_UI: read-only status panels (same values as the Mechanic Masterlist / Truck Masterlist).
            'crew' => fn() => array_map('intval', one($p, "SELECT COUNT(*) AS active,
                    COALESCE(SUM(availability='Available'),0) AS available, COALESCE(SUM(availability='Assigned'),0) AS assigned,
                    COALESCE(SUM(availability='Unavailable'),0) AS unavailable,
                    (SELECT COUNT(*) FROM mechanic_attendance a JOIN mechanics x ON x.id=a.mechanic_id WHERE a.time_out IS NULL AND x.active=1) AS on_duty
                FROM mechanics WHERE active=1")),
            'fleet' => fn() => [
                'active_trucks' => (int)one($p, 'SELECT COUNT(*) AS n FROM vehicles WHERE active=1')['n'],
                'in_repair' => many($p, "SELECT v.id AS vehicle_id, v.plate_number, v.truck_number, v.truck_type, m.id AS job_id, m.job_ref, m.status,
                        (m.status='Completed' AND m.verified_at IS NULL) AS awaiting_verification, m.reported_on
                    FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id WHERE m.open_key=1 ORDER BY m.reported_on, m.id"),
            ],
        ] + self::formSections($p));
        $data['can'] = ['act' => hasRole($u, ...self::ACT), 'parts' => $parts, 'requestParts' => hasRole($u, 'motorpool')];
        $data['limits'] = ['attention' => self::OVERVIEW_ATTENTION_LIMIT, 'activity' => self::OVERVIEW_ACTIVITY_LIMIT];
        return $data;
    }

    /** MOTORPOOL_UI_V2: an open repair waiting this many days or more is listed as long-running on the dashboard. */
    public const STALE_DAYS = 3;

    /**
     * MOTORPOOL_UI_V2 — this month: repairs returned to service, average days from report to completion, and cost
     * (parts released to repairs at their release cost + labor/services incurred). Same cost rules as Maintenance Reports.
     */
    private static function overviewMonth(PDO $p): array {
        $from = date('Y-m-01');
        $done = one($p, "SELECT COUNT(*) AS n, AVG(DATEDIFF(completed_on, reported_on)) AS avg_days FROM maintenance_jobs
            WHERE verified_at >= ? AND completed_on IS NOT NULL", [$from]);
        $parts = (float)one($p, "SELECT COALESCE(SUM(-quantity_delta*unit_cost),0) AS v FROM stock_movements
            WHERE movement_type='Stock Out' AND maintenance_job_id IS NOT NULL AND created_at >= ?", [$from])['v'];
        $other = (float)one($p, 'SELECT COALESCE(SUM(amount),0) AS v FROM maintenance_costs WHERE incurred_on >= ?', [$from])['v'];
        return ['completed' => (int)$done['n'], 'avg_days' => $done['avg_days'] === null ? null : round((float)$done['avg_days'], 1),
            'cost' => round($parts + $other, 2), 'from' => $from];
    }

    /** One row per maintenance record / parts request, so related events are never counted twice. */
    private static function overviewSummary(PDO $p, bool $parts): array {
        $j = one($p, "SELECT COALESCE(SUM(status='Reported'),0) AS new_reports,
                COALESCE(SUM(status='Reported' AND source='Incident'),0) AS new_incidents,
                COALESCE(SUM(status='Under Inspection'),0) AS under_inspection,
                COALESCE(SUM(status='Under Repair'),0) AS under_repair,
                COALESCE(SUM(status='Completed' AND verified_at IS NULL),0) AS for_verification
            FROM maintenance_jobs WHERE open_key=1");
        $out = array_map('intval', $j);
        if ($parts) {
            $r = one($p, "SELECT COALESCE(SUM(status='Requested'),0) AS requested, COALESCE(SUM(status='Partially Released'),0) AS partially_released
                FROM part_requests WHERE status IN ('Requested','Partially Released')");
            $out['parts_requested'] = (int)$r['requested'];
            $out['parts_partially_released'] = (int)$r['partially_released'];
            $out['pending_parts'] = (int)$r['requested'] + (int)$r['partially_released'];
        }
        return $out;
    }

    /** Records that wait for an action of the Motorpool Custodian, longest waiting first. */
    private static function overviewAttention(PDO $p, bool $parts): array {
        $lim = self::OVERVIEW_ATTENTION_LIMIT + 1;   // one extra row tells the screen that the list is cut
        $rows = many($p, "SELECT 'job' AS kind, m.id AS job_id, m.job_ref, NULL AS request_id, NULL AS request_ref, m.source, m.status, m.problem AS issue,
                    v.plate_number, v.truck_number, i.incident_ref, t.trip_ref,
                    CASE WHEN m.status='Completed' THEN m.completed_at ELSE m.created_at END AS since,
                    CASE WHEN m.status='Completed' THEN 'verify' WHEN m.source='Incident' THEN 'assess' ELSE 'assign' END AS next_action
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN incidents i ON i.id=m.incident_id LEFT JOIN trips t ON t.id=m.trip_id
                WHERE m.open_key=1 AND (m.status='Reported' OR (m.status='Completed' AND m.verified_at IS NULL))
                ORDER BY since, m.id LIMIT $lim");
        if ($parts) {
            // Parts the Purchasing Officer marked Not Available, for a repair that is still open (or no repair record).
            $rows = array_merge($rows, many($p, "SELECT 'parts' AS kind, m.id AS job_id, m.job_ref, r.id AS request_id, r.request_ref, m.source, r.status, r.purpose AS issue,
                        v.plate_number, v.truck_number, NULL AS incident_ref, NULL AS trip_ref, COALESCE(r.processed_at, r.created_at) AS since, 'parts_follow_up' AS next_action
                    FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id
                    WHERE r.status='Not Available' AND (r.maintenance_job_id IS NULL OR m.open_key=1)
                    ORDER BY since, r.id LIMIT $lim"));
            usort($rows, fn($a, $b) => [(string)$a['since'], $a['kind'], (int)($a['job_id'] ?? 0)] <=> [(string)$b['since'], $b['kind'], (int)($b['job_id'] ?? 0)]);
        }
        foreach ($rows as &$r) $r['issue'] = cut((string)$r['issue'], 160);
        unset($r);
        return $rows;
    }

    /** Latest maintenance events in plain words. Parts entries only for Motorpool and roles that may open Parts Requests. */
    private static function overviewActivity(PDO $p, bool $parts): array {
        $lim = self::OVERVIEW_ACTIVITY_LIMIT;
        $sql = "SELECT 'job' AS kind, e.created_at AS at, e.from_status, e.to_status, e.details, m.id AS job_id, m.job_ref, NULL AS request_id, NULL AS request_ref,
                    v.plate_number, u.full_name AS actor, mc.full_name AS mechanic, NULL AS units, e.id AS sort_id
                FROM maintenance_events e JOIN maintenance_jobs m ON m.id=e.maintenance_job_id JOIN vehicles v ON v.id=m.vehicle_id
                LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN mechanics mc ON mc.id=e.mechanic_id";
        if ($parts) {
            $sql = "($sql ORDER BY e.id DESC LIMIT $lim)
                UNION ALL
                (SELECT 'parts_requested', r.created_at, NULL, r.status, r.purpose, m.id, m.job_ref, r.id, r.request_ref, v.plate_number, u.full_name, NULL,
                    (SELECT SUM(l.quantity) FROM part_request_lines l WHERE l.part_request_id=r.id), r.id
                 FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id JOIN users u ON u.id=r.requested_by
                 ORDER BY r.id DESC LIMIT $lim)
                UNION ALL
                (SELECT 'parts_released', g.at, NULL, NULL, NULL, m.id, m.job_ref, r.id, r.request_ref, v.plate_number, u.full_name, NULL, g.units, g.last_id
                 FROM (SELECT reference_id, actor_id, created_at AS at, -SUM(quantity_delta) AS units, MAX(id) AS last_id FROM stock_movements
                       WHERE reference_type='part_request' AND movement_type='Stock Out' GROUP BY reference_id, actor_id, created_at) g
                 JOIN part_requests r ON r.id=g.reference_id JOIN vehicles v ON v.id=r.vehicle_id
                 LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id JOIN users u ON u.id=g.actor_id
                 ORDER BY g.last_id DESC LIMIT $lim)
                ORDER BY at DESC, sort_id DESC LIMIT $lim";
        } else {
            $sql .= " ORDER BY e.created_at DESC, e.id DESC LIMIT $lim";
        }
        $rows = many($p, $sql);
        foreach ($rows as &$r) {
            $r['label'] = self::activityLabel($r);
            $r['details'] = $r['details'] === null ? null : cut((string)$r['details'], 160);
            unset($r['from_status'], $r['sort_id']);
        }
        unset($r);
        return $rows;
    }

    /** Plain-language name of an event. The detail prefixes are the ones written by this module and by Trips. */
    private static function activityLabel(array $e): string {
        if ($e['kind'] === 'parts_requested') return 'Parts request submitted';
        if ($e['kind'] === 'parts_released') return 'Parts released';
        $from = $e['from_status']; $to = $e['to_status']; $det = (string)$e['details'];
        if ($to === 'Cancelled') return 'Record cancelled';
        if ($from === null && $to === 'Reported') return str_starts_with($det, 'from incident') ? 'Trip incident reported' : 'Truck issue reported';
        if (str_starts_with($det, 'assisting mechanic added')) return 'Assisting mechanic added';
        if (str_starts_with($det, 'assisting mechanic removed')) return 'Assisting mechanic removed';
        if (str_starts_with($det, 'mechanic changed')) return 'Mechanic changed';
        if (str_starts_with($det, 'mechanic assigned')) return 'Mechanic assigned';
        if (str_starts_with($det, 'assessed ')) return 'Incident assessed';
        if (str_starts_with($det, 'Arrival checklist findings')) return 'Arrival checklist findings added';
        if ($from === 'Under Inspection' && $to === 'Under Repair') return 'Inspection findings recorded';
        if ($from === 'Under Repair' && $to === 'Completed') return 'Repair completed';
        if ($from === 'Completed' && $to === 'Under Repair') return 'Verification failed, back to repair';
        if ($from === 'Completed' && $to === 'Completed' && str_starts_with($det, 'verified')) return 'Verified, returned to service';
        return $to;
    }

    /**
     * Maintenance History: finished and cancelled records with their cost and attachment count.
     * Full detail (incident, photos, parts, costs) opens through details(), which checks the role again.
     */
    private static function history(array $u, PDO $p): array {
        return readSections([
            'records' => fn() => many($p, "SELECT m.id, m.job_ref, m.source, m.problem, m.status, m.reported_on, m.completed_on, m.verified_at, v.plate_number, v.truck_type,
                    mc.full_name AS mechanic, i.incident_ref,
                    (SELECT COALESCE(SUM(c.amount),0) FROM maintenance_costs c WHERE c.maintenance_job_id=m.id) AS other_cost,
                    (SELECT COALESCE(SUM(l.released_qty*l.unit_cost),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.maintenance_job_id=m.id) AS parts_cost,
                    (SELECT COUNT(*) FROM documents d WHERE (d.entity_type='maintenance' AND d.entity_id=m.id) OR (m.incident_id IS NOT NULL AND d.entity_type='incident' AND d.entity_id=m.incident_id)) AS attachments
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id LEFT JOIN incidents i ON i.id=m.incident_id
                WHERE m.status IN ('Completed','Cancelled') OR m.verified_at IS NOT NULL
                ORDER BY COALESCE(m.verified_at, m.completed_on, m.created_at) DESC, m.id DESC LIMIT 1000"),
            'trucks' => fn() => many($p, 'SELECT id, plate_number FROM vehicles ORDER BY plate_number'),
        ]);
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'report' => self::report($u, $d),
            'assign_mechanic' => self::assignMechanic($u, $d),
            'helpers_add' => self::helpersAdd($u, $d),
            'helper_remove' => self::helperRemove($u, $d),
            'assess' => self::assess($u, $d),
            'inspect' => self::inspect($u, $d),
            'add_cost' => self::addCost($u, $d),
            'complete' => self::complete($u, $d),
            'verify' => self::verify($u, $d),
            'clearance' => self::clearance($u, $d),
            'cancel' => self::cancel($u, $d),
            'details' => self::details($u, $d),
            'finalize_assignment' => self::finalizeAssignment($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    // ------------------------------------------------------------------ helpers
    private static function lockJob(PDO $p, int $id): array {
        $j = one($p, 'SELECT * FROM maintenance_jobs WHERE id=? FOR UPDATE', [$id]);
        must((bool)$j, 'Maintenance record not found.', 404);
        return $j;
    }

    private static function event(PDO $p, int $jobId, ?string $from, string $to, ?int $actor, string $details = '', ?int $mechanicId = null): void {
        run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, mechanic_id, details, actor_id) VALUES (?,?,?,?,?,?)',
            [$jobId, $from, $to, $mechanicId, cut($details, 500), $actor]);
    }

    /** Locks the mechanic and checks that a new repair can be given to them. */
    private static function freeMechanic(PDO $p, int $mechanicId, ?int $exceptJob = null): array {
        $m = one($p, 'SELECT * FROM mechanics WHERE id=? FOR UPDATE', [$mechanicId]);
        must($m && (int)$m['active'], 'Choose an active mechanic from the Mechanic Masterlist.');
        // Availability = an open Time In (Mechanic Attendance). The saved state is checked here, not only in the dropdown.
        $in = one($p, 'SELECT id FROM mechanic_attendance WHERE mechanic_id=? AND time_out IS NULL', [$mechanicId]);
        must((bool)$in, $m['full_name'] . ' is Unavailable (not timed in). The Motorpool Custodian must Time In the mechanic in the Mechanic Masterlist first.', 409);
        $busy = one($p, "SELECT job_ref, id FROM maintenance_jobs WHERE active_mechanic=?", [$mechanicId]);
        must(!$busy || (int)$busy['id'] === (int)$exceptJob, $m['full_name'] . ' is already assigned to ' . ($busy['job_ref'] ?? '') . '. Choose an Available mechanic.', 409);
        // JOB_HELPER_MECHANICS_V1: an assisting assignment also makes the mechanic busy (on any job, including this one:
        // remove them as assisting mechanic first before making them the lead).
        if (self::helpersReady($p)) {
            $helps = one($p, 'SELECT m.job_ref FROM maintenance_job_helpers h JOIN maintenance_jobs m ON m.id=h.maintenance_job_id WHERE h.active_mechanic=?', [$mechanicId]);
            must(!$helps, $m['full_name'] . ' is already assisting on ' . ($helps['job_ref'] ?? '') . '. Choose an Available mechanic.', 409);
        }
        return $m;
    }

    private static function catalogReady(PDO $p): bool {
        return (bool)one($p, "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='maintenance_jobs' AND COLUMN_NAME='assignment_finalized_at'");
    }

    /** JOB_HELPER_MECHANICS_V1 — true once migration 2026-11-12_12 created maintenance_job_helpers (checked once per request). */
    private static ?bool $helpersReady = null;
    public static function helpersReady(PDO $p): bool {
        return self::$helpersReady ??= (bool)one($p, "SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='maintenance_job_helpers'");
    }

    /** Releases every active assisting mechanic of a job (completion, cancellation) and recomputes their availability. */
    private static function releaseHelpers(PDO $p, int $jobId, int $actor, string $reason): array {
        if (!self::helpersReady($p)) return [];
        $ids = array_map('intval', array_column(many($p, 'SELECT mechanic_id FROM maintenance_job_helpers WHERE maintenance_job_id=? AND released_at IS NULL FOR UPDATE', [$jobId]), 'mechanic_id'));
        if (!$ids) return [];
        run($p, 'UPDATE maintenance_job_helpers SET released_at=NOW(), released_by=?, release_reason=? WHERE maintenance_job_id=? AND released_at IS NULL', [$actor, cut($reason, 255), $jobId]);
        foreach ($ids as $mid) self::refreshMechanic($p, $mid);
        return $ids;
    }

    /** Recomputes a mechanic's availability from their active repairs and Time In (no open Time In = Unavailable). */
    public static function refreshMechanic(PDO $p, ?int $mechanicId): void {
        if (!$mechanicId) return;
        $m = one($p, 'SELECT availability FROM mechanics WHERE id=? FOR UPDATE', [$mechanicId]);
        if (!$m) return;
        $busy = (bool)one($p, 'SELECT id FROM maintenance_jobs WHERE active_mechanic=?', [$mechanicId])
            || (self::helpersReady($p) && (bool)one($p, 'SELECT id FROM maintenance_job_helpers WHERE active_mechanic=?', [$mechanicId]));
        $in = (bool)one($p, 'SELECT id FROM mechanic_attendance WHERE mechanic_id=? AND time_out IS NULL', [$mechanicId]);
        run($p, 'UPDATE mechanics SET availability=? WHERE id=?', [$busy ? 'Assigned' : ($in ? 'Available' : 'Unavailable'), $mechanicId]);
    }

    private static function setMechanic(PDO $p, array $j, int $mechanicId): void {
        try { run($p, 'UPDATE maintenance_jobs SET mechanic_id=? WHERE id=?', [$mechanicId, $j['id']]); }
        catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) throw new BusinessRuleException('This mechanic already has another active repair.', 409);
            throw $e;
        }
        self::refreshMechanic($p, $mechanicId);
        if ($j['mechanic_id'] && (int)$j['mechanic_id'] !== $mechanicId) self::refreshMechanic($p, (int)$j['mechanic_id']);
    }

    /**
     * Called inside Trips::checklist's transaction for confirmed defects in the
     * existing tractor/trailer checklist sections. This must not start a second
     * transaction or accept client-provided status/authority.
     *
     * One unresolved job per vehicle: append findings rather than duplicate it.
     */
    /** Mirror only Tractor Head / Trailer NOT OK keys into the repair component catalog.
     * Existing checklist submissions remain the source of truth; no duplicate repair record. */
    public static function linkChecklistComponents(PDO $p, int $jobId, array $check): void {
        if (!self::catalogReady($p)) return;
        foreach (['tractor_head','trailer'] as $section) {
            foreach (($check['items'] ?? []) as $key => $value) {
                if (!str_starts_with((string)$key,$section.'_') || ($value['condition'] ?? '') !== 'NOT OK') continue;
                $c = one($p,'SELECT id FROM motorpool_components WHERE component_key=? AND active=1',[$key]);
                if ($c) run($p,'INSERT IGNORE INTO maintenance_job_components (maintenance_job_id,component_id) VALUES (?,?)',[$jobId,(int)$c['id']]);
            }
        }
    }

    public static function fromPreDispatchChecklist(PDO $p, array $u, array $t, array $defects): array {
        must(count($defects) > 0, 'No truck defects were provided.');
        $vid = (int)$t['vehicle_id'];
        $v = one($p, 'SELECT id, plate_number FROM vehicles WHERE id=? FOR UPDATE', [$vid]);
        must((bool)$v, 'Assigned truck not found.', 409);
        $description = cut('Pre-dispatch checklist ' . $t['trip_ref'] . ' - NOT OK: ' . implode('; ', $defects), 500);
        $open = FleetState::openJob($p, $vid);
        if ($open) {
            $id = (int)$open['id'];
            $ref = $open['job_ref'];
            run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, details, actor_id) VALUES (?,?,?,?,?)',
                [$id, $open['status'], $open['status'], $description, $u['id']]);
        } else {
            $id = insert($p, 'maintenance_jobs', [
                'job_ref' => 'TMP-' . bin2hex(random_bytes(6)),
                'vehicle_id' => $vid, 'trip_id' => (int)$t['id'],
                'source' => 'On-Premise', 'problem' => $description,
                'reported_on' => date('Y-m-d'), 'priority' => 'Normal',
                'status' => 'Reported',
                'remarks' => cut('Automatically opened from pre-dispatch checklist ' . $t['trip_ref'], 500),
                'created_by' => $u['id'],
            ]);
            $ref = refNumber('CM', $id);
            run($p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [$ref, $id]);
            if (self::catalogReady($p)) run($p, "UPDATE maintenance_jobs SET parts_requirement='To Be Determined' WHERE id=?", [$id]);
            run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, details, actor_id) VALUES (?,?,?,?,?)',
                [$id, null, 'Reported', $description, $u['id']]);
        }
        audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'pre-dispatch truck defects reported',
            $ref . ': ' . cut($description, 200));
        Notify::roles($p, ['motorpool'], 'Pre-dispatch truck problem',
            $v['plate_number'] . ' from ' . $t['trip_ref'] . ' needs corrective inspection (' . $ref . ').', 'maintenance', 'job-open-' . $id);
        return ['job_id' => $id, 'job_ref' => $ref, 'new' => !$open];
    }

    // ------------------------------------------------------------------ actions
    /** Report a truck problem found at the garage (on-premise). The truck goes Under Maintenance at once. */
    private static function report(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $vid = idField($d, 'vehicle_id');
        // Use the intake findings as the problem summary when the simplified Motorpool form
        // omits the legacy problem field. Preserve existing API callers and report history.
        $findings = optField($d, 'findings', 2000);
        $diagnosis = optField($d, 'diagnosis', 2000);
        $problem = isset($d['problem']) && trim((string)$d['problem']) !== ''
            ? field($d, 'problem', 500)
            : cut((string)($findings ?? ''), 500);
        must(trim($problem) !== '', 'Inspection findings are required to report a truck problem.', 422);
        // The Report Truck Problem form does not ask for a date. The server is
        // authoritative, so never require or trust a client-supplied reported_on.
        $date = date('Y-m-d');
        $priority = 'Normal'; // Legacy DB field; users no longer choose priority (#41).
        $mechanicId = optId($d, 'mechanic_id');
        $remarks = optField($d, 'remarks', 500);
        $rawAssist = $d['assistant_mechanic_ids'] ?? [];
        must(is_array($rawAssist), 'Invalid assisting mechanics list.');
        $assist = [];
        foreach ($rawAssist as $rawId) {
            $mid = filter_var($rawId, FILTER_VALIDATE_INT);
            must($mid !== false && $mid > 0, 'Invalid assisting mechanic.');
            must(!in_array($mid, $assist, true), 'Duplicate assisting mechanic.');
            $assist[] = $mid;
        }
        must(count($assist) <= 10, 'At most 10 assisting mechanics.');
        must(!$assist || $mechanicId !== null, 'Choose a lead mechanic before adding assisting mechanics.');
        must(!$mechanicId || !in_array($mechanicId, $assist, true), 'Lead mechanic cannot also be an assistant.');
        $rawParts = $d['parts_lines'] ?? [];
        must(is_array($rawParts), 'Invalid parts request.');
        must(count($rawParts) <= 30, 'At most 30 requested parts.');
        $partsPurpose = $rawParts ? cut($problem, 255) : null;
        return transaction(function (PDO $p) use ($u, $vid, $problem, $date, $priority, $mechanicId, $remarks, $assist, $rawParts, $partsPurpose, $findings, $diagnosis) {
            $v = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$vid]);
            must($v && (int)$v['active'], 'Truck not found or inactive.', 404);
            must(in_array((string)$v['status'], ['Available', 'Assigned'], true), 'Only Available or Assigned trucks at the garage can be reported here. On-trip, returning, unavailable and under-maintenance trucks are excluded.', 409);
            $open = FleetState::openJob($p, $vid);
            must(!$open, 'Truck ' . $v['plate_number'] . ' already has an unresolved maintenance record (' . ($open['job_ref'] ?? '') . '). Add the new findings to that record.', 409);
            $trip = FleetState::activeTrip($p, $vid);
            must(!$trip || !in_array($trip['status'], FleetState::ON_ROAD, true), 'Truck ' . $v['plate_number'] . ' is on the road (' . ($trip['trip_ref'] ?? '') . '). The dispatcher reports trouble during a trip with "Report incident".', 409);
            must(!$trip || $trip['status'] !== FleetState::RETURNING, 'Truck ' . $v['plate_number'] . ' is returning from ' . ($trip['trip_ref'] ?? '') . '. Its problems are recorded in the arrival checklist (NOT OK items open a repair record automatically).', 409);
            if ($mechanicId) self::freeMechanic($p, $mechanicId);
            $status = $mechanicId ? 'Under Inspection' : 'Reported';
            $jid = insert($p, 'maintenance_jobs', ['job_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $vid, 'source' => 'On-Premise',
                'problem' => $problem, 'findings' => $findings, 'diagnosis' => $diagnosis, 'reported_on' => $date, 'priority' => $priority, 'status' => 'Reported', 'remarks' => $remarks, 'created_by' => $u['id']]);
            $ref = refNumber('CM', $jid);
            run($p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [$ref, $jid]);
            self::event($p, $jid, null, 'Reported', $u['id'], $problem);
            if (self::catalogReady($p)) run($p, "UPDATE maintenance_jobs SET parts_requirement='To Be Determined' WHERE id=?", [$jid]);
            if ($mechanicId) {
                $j = self::lockJob($p, $jid);
                self::setMechanic($p, $j, $mechanicId);
                run($p, "UPDATE maintenance_jobs SET status='Under Inspection', started_by=?, started_at=NOW() WHERE id=?", [$u['id'], $jid]);
                self::event($p, $jid, 'Reported', 'Under Inspection', $u['id'], 'mechanic assigned', $mechanicId);
            }
            if ($assist) {
                must(self::helpersReady($p), 'Assisting mechanics require the existing mechanics migration.', 503);
                sort($assist);
                foreach ($assist as $mid) {
                    $m = self::freeMechanic($p, $mid, $jid);
                    run($p, 'INSERT INTO maintenance_job_helpers (maintenance_job_id, mechanic_id, assigned_at, assigned_by) VALUES (?,?,NOW(),?)',
                        [$jid, $mid, $u['id']]);
                    self::refreshMechanic($p, $mid);
                    self::event($p, $jid, 'Under Inspection', 'Under Inspection', $u['id'], 'assisting mechanic added: ' . $m['full_name'], $mid);
                }
                auditWithChanges($p, $u['id'], 'Maintenance', 'job ' . $jid, 'assisting mechanics added during report',
                    $ref, [], ['Assisting mechanic IDs' => implode(', ', $assist)]);
            }
            $request = null;
            if ($rawParts) {
                must($mechanicId !== null, 'Choose a lead mechanic before requesting parts for the new repair.');
                Actions::load('Purchasing');
                $request = Purchasing::createForRepair($p, $u, $vid, $jid, (string)$partsPurpose, $rawParts);
            }
            Files::store($p, $u, 'photos', 'maintenance', $jid, 'Inspection Photo', true, 'photos of the damaged parts or truck condition');
            $msg = "Problem reported ($ref). Truck " . $v['plate_number'] . ' is Under Maintenance and cannot be assigned to trips.';
            if ($trip) { Actions::load('Trips'); $msg .= ' ' . Trips::resourceLost($p, $u, (int)$trip['id'], 'Truck ' . $v['plate_number'] . ' has a reported problem'); }
            FleetState::reconcile($p, $vid, $u['id'], "Corrective maintenance $ref");
            audit($p, $u['id'], 'Maintenance', 'job ' . $jid, 'truck problem reported', "$ref {$v['plate_number']}: " . cut($problem, 200));
            Notify::roles($p, ['operations_head'], 'Truck under maintenance', $v['plate_number'] . " has a reported problem ($ref). It cannot be assigned until the repair is verified.", 'maintenance', 'job-open-' . $jid);
            return ['job_id' => $jid, 'job_ref' => $ref, 'parts_request_ref' => $request['request_ref'] ?? null,
                'message' => $msg . ($request ? ' ' . $request['message'] : '') . ($mechanicId ? '' : ' Assign the lead and assisting mechanics to start repair.')];
        });
    }


    /** Finalize the whole mechanic team and component selection in one transaction. */
    private static function finalizeAssignment(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $jobId = idField($d,'job_id');
        $lead = idField($d,'mechanic_id');
        $helpers = $d['assistant_mechanic_ids'] ?? [];
        $components = $d['component_ids'] ?? [];
        // Additional unlisted components are retained in repair activity, not
        // inserted as unverified catalog entries or given fabricated skill mappings.
        $otherComponents = optField($d,'other_components',250);
        $parts = choiceField($d,'parts_requirement',['No Parts Needed','Parts Required']);
        must(is_array($helpers) && count($helpers)<=10 && is_array($components) && count($components)<=31,'Invalid repair selections.',422);
        $helpers = array_map('intval',$helpers);
        $components = array_map('intval',$components);
        must(count($helpers)===count(array_unique($helpers)) && !in_array($lead,$helpers,true),'Invalid duplicate mechanic.',422);
        must(count($components)===count(array_unique($components)),'Duplicate component.',422);
        $lines = $d['parts_lines'] ?? [];
        must(is_array($lines) && count($lines)<=30 && (!$lines || $parts==='Parts Required'),'Invalid parts requirement.',422);
        return transaction(function(PDO $p) use($u,$jobId,$lead,$helpers,$components,$otherComponents,$parts,$lines) {
            must(self::catalogReady($p),'Apply the approved Motorpool catalog migration before finalizing.',409);
            $j=self::lockJob($p,$jobId);
            must(in_array($j['status'],['Under Inspection','Under Repair'],true)
                || ($j['source']==='On-Premise' && $j['status']==='Reported' && trim((string)$j['findings'])!=='' && trim((string)$j['diagnosis'])!==''),
                'Record inspection findings and diagnosis before assigning the repair team.',409);
            must(!$j['assignment_finalized_at'],'Repair assignment is finalized and locked.',409);
            if ($j['source']==='Incident') must($j['severity']!==null,'Assess the incident first.',409);
            // Allow the initial lead to be changed once before finalization.
            if ((int)$j['mechanic_id']!==$lead) {
                self::freeMechanic($p,$lead,$jobId);
                self::setMechanic($p,$j,$lead);
            }
            $old=self::helpersReady($p)?many($p,'SELECT mechanic_id FROM maintenance_job_helpers WHERE maintenance_job_id=? AND released_at IS NULL FOR UPDATE',[$jobId]):[];
            $current=array_map('intval',array_column($old,'mechanic_id'));
            must(self::helpersReady($p)||!$helpers,'Assisting mechanics need the helpers migration.',409);
            foreach($helpers as $mid) if(!in_array($mid,$current,true)) self::freeMechanic($p,$mid,$jobId);
            if(self::helpersReady($p)) {
                foreach($current as $mid) if(!in_array($mid,$helpers,true)) {
                    run($p,"UPDATE maintenance_job_helpers SET released_at=NOW(),released_by=?,release_reason='changed before finalization' WHERE maintenance_job_id=? AND mechanic_id=? AND released_at IS NULL",[$u['id'],$jobId,$mid]);
                    self::refreshMechanic($p,$mid);
                }
                foreach($helpers as $mid) if(!in_array($mid,$current,true)) {
                    run($p,'INSERT INTO maintenance_job_helpers (maintenance_job_id,mechanic_id,assigned_at,assigned_by) VALUES (?,?,NOW(),?)',[$jobId,$mid,$u['id']]);
                    self::refreshMechanic($p,$mid);
                }
            }
            if($components) {
                $marks=implode(',',array_fill(0,count($components),'?'));
                must(count(many($p,"SELECT id FROM motorpool_components WHERE active=1 AND id IN ($marks)",$components))===count($components),'Unknown component.',422);
                $block=one($p,"SELECT COUNT(*) AS n FROM motorpool_vehicle_component_exclusions WHERE vehicle_id=? AND component_id IN ($marks)",array_merge([(int)$j['vehicle_id']],$components));
                must((int)$block['n']===0,'Selected component is not applicable to this truck.',422);
            }
            run($p,'DELETE FROM maintenance_job_components WHERE maintenance_job_id=?',[$jobId]);
            foreach($components as $cid) run($p,'INSERT INTO maintenance_job_components (maintenance_job_id,component_id) VALUES (?,?)',[$jobId,$cid]);
            $needed=many($p,'SELECT DISTINCT s.name FROM maintenance_job_components jc JOIN motorpool_component_skills cs ON cs.component_id=jc.component_id JOIN mechanic_specializations s ON s.id=cs.specialization_id WHERE jc.maintenance_job_id=?',[$jobId]);
            if($needed) {
                $team=array_merge([$lead],$helpers);
                $marks=implode(',',array_fill(0,count($team),'?'));
                $have=many($p,"SELECT DISTINCT s.name FROM mechanic_skills ms JOIN mechanic_specializations s ON s.id=ms.specialization_id WHERE ms.mechanic_id IN ($marks)",$team);
                $missing=array_diff(array_column($needed,'name'),array_column($have,'name'));
                must(!$missing,'Mechanic team lacks: '.implode(', ',$missing),409);
            }
            if ($parts === 'No Parts Needed') must(!one($p,"SELECT id FROM part_requests WHERE maintenance_job_id=? AND status<>'Cancelled' LIMIT 1",[$jobId]),'Existing parts requests must be resolved; cannot claim No Parts Needed.',409);
            // The linked parts request requires an active repair. Advance garage reports
            // inside this same transaction (all changes roll back if parts creation fails).
            $targetStatus = $j['source']==='On-Premise' && $j['status']==='Reported' ? 'Under Repair' : $j['status'];
            if ($targetStatus !== $j['status']) run($p,'UPDATE maintenance_jobs SET status=? WHERE id=?',[$targetStatus,$jobId]);
            if($lines) {
                Actions::load('Purchasing');
                Purchasing::createForRepair($p,$u,(int)$j['vehicle_id'],$jobId,cut((string)$j['problem'],255),$lines);
            }
            run($p,'UPDATE maintenance_jobs SET status=?, started_by=COALESCE(started_by,?), started_at=COALESCE(started_at,NOW()), assignment_finalized_at=NOW(), assignment_finalized_by=?, parts_requirement=? WHERE id=?',
                [$targetStatus,$u['id'],$u['id'],$parts,$jobId]);
            self::event($p,$jobId,$j['status'],$targetStatus,$u['id'],
                'repair assignment finalized; parts: '.$parts
                .($otherComponents !== null && trim($otherComponents) !== ''
                    ? '; Other affected components: '.trim($otherComponents) : ''));
            audit($p,$u['id'],'Maintenance','job '.$jobId,'repair assignment finalized',$j['job_ref']);
            return ['message'=>'Repair assignment finalized. Assigned mechanics are locked.'];
        });
    }

    /** Assign (or change) the mechanic. Reported -> Under Inspection. */
    private static function assignMechanic(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id'); $mechanicId = idField($d, 'mechanic_id');
        $reason = optField($d, 'reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $mechanicId, $reason) {
            $j = self::lockJob($p, $id);
            must(in_array($j['status'], self::ACTIVE, true), 'This record is ' . $j['status'] . '.', 409);
            must(!($j['source'] === 'Incident' && $j['status'] === 'Reported'), 'Assess the incident first (Minor or Major) before assigning a mechanic.', 409);
            must(!self::catalogReady($p) || !$j['assignment_finalized_at'], 'Finalized mechanic assignment is locked.', 409);
            if ((int)$j['mechanic_id'] === $mechanicId) return ['message' => 'This mechanic is already assigned.'];
            if ($j['mechanic_id']) must($reason !== null, 'Give the reason for changing the mechanic.');
            $oldMechanic = $j['mechanic_id'] ? one($p, 'SELECT full_name FROM mechanics WHERE id=?', [$j['mechanic_id']]) : null;
            $m = self::freeMechanic($p, $mechanicId, (int)$j['id']);
            self::setMechanic($p, $j, $mechanicId);
            $to = $j['status'] === 'Reported' ? 'Under Inspection' : $j['status'];
            if ($to !== $j['status']) run($p, "UPDATE maintenance_jobs SET status=?, started_by=?, started_at=NOW() WHERE id=?", [$to, $u['id'], $id]);
            self::event($p, $id, $j['status'], $to, $u['id'], ($j['mechanic_id'] ? 'mechanic changed' : 'mechanic assigned') . ($reason ? ': ' . $reason : ''), $mechanicId);
            auditWithChanges($p, $u['id'], 'Maintenance', 'job ' . $id, 'mechanic assigned', $j['job_ref'] . ' -> ' . $m['full_name'],
                ['Assigned mechanic' => $oldMechanic['full_name'] ?? null, 'Repair status' => $j['status']],
                ['Assigned mechanic' => $m['full_name'], 'Repair status' => $to]);
            return ['message' => $m['full_name'] . ' is assigned to ' . $j['job_ref'] . ($to !== $j['status'] ? ' (Under Inspection).' : '.')];
        });
    }

    /**
     * JOB_HELPER_MECHANICS_V1 — add one or more assisting mechanics to an active repair that already has a lead mechanic.
     * Same rules as the lead: active masterlist mechanic, timed in, not on another active repair (lead or assisting).
     * All-or-nothing: one refused mechanic refuses the whole request, so nothing is half-assigned.
     */
    private static function helpersAdd(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $raw = $d['mechanic_ids'] ?? [];
        must(is_array($raw) && $raw, 'Choose at least one mechanic.');
        $ids = array_values(array_unique(array_map('intval', $raw)));
        must(count($ids) <= 10 && min($ids) > 0, 'Choose valid mechanics (at most 10 at a time).');
        return transaction(function (PDO $p) use ($u, $id, $ids) {
            must(self::helpersReady($p), 'Assigning several mechanics needs the pending database update (migration 12). Ask the administrator.', 409);
            $j = self::lockJob($p, $id);
            must(in_array($j['status'], self::ACTIVE, true), 'This record is ' . $j['status'] . '.', 409);
            must(!self::catalogReady($p) || !$j['assignment_finalized_at'], 'Finalized mechanic assignment is locked.', 409);
            must((bool)$j['mechanic_id'], 'Assign the lead mechanic first.', 409);
            $names = [];
            sort($ids); // fixed lock order on the mechanic rows (no deadlock between two custodians)
            foreach ($ids as $mid) {
                must($mid !== (int)$j['mechanic_id'], 'The lead mechanic is already on this repair.', 409);
                $m = self::freeMechanic($p, $mid, (int)$j['id']);
                must((int)$j['mechanic_id'] !== $mid, $m['full_name'] . ' already leads this repair.', 409);
                // NOW() on both assigned_at and released_at (same clock as the CHECK released_at >= assigned_at).
                try { run($p, 'INSERT INTO maintenance_job_helpers (maintenance_job_id, mechanic_id, assigned_at, assigned_by) VALUES (?,?,NOW(),?)', [$id, $mid, $u['id']]); }
                catch (PDOException $e) {
                    if (str_contains($e->getMessage(), 'Duplicate')) throw new BusinessRuleException($m['full_name'] . ' already has another active repair.', 409);
                    throw $e;
                }
                self::refreshMechanic($p, $mid);
                self::event($p, $id, $j['status'], $j['status'], $u['id'], 'assisting mechanic added: ' . $m['full_name'], $mid);
                $names[] = $m['full_name'];
            }
            auditWithChanges($p, $u['id'], 'Maintenance', 'job ' . $id, 'assisting mechanics added', $j['job_ref'] . ' + ' . implode(', ', $names), [], ['Assisting mechanics added' => implode(', ', $names)]);
            return ['message' => implode(', ', $names) . (count($names) > 1 ? ' are' : ' is') . ' now assisting on ' . $j['job_ref'] . '.'];
        });
    }

    /** JOB_HELPER_MECHANICS_V1 — remove an assisting mechanic (reason required). The row is kept as history (released_at). */
    private static function helperRemove(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id'); $mid = idField($d, 'mechanic_id'); $reason = field($d, 'reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $mid, $reason) {
            must(self::helpersReady($p), 'Assigning several mechanics needs the pending database update (migration 12).', 409);
            $j = self::lockJob($p, $id);
            must(in_array($j['status'], self::ACTIVE, true), 'This record is ' . $j['status'] . '.', 409);
            must(!self::catalogReady($p) || !$j['assignment_finalized_at'], 'Finalized mechanic assignment is locked.', 409);
            $h = one($p, 'SELECT h.id, mc.full_name FROM maintenance_job_helpers h JOIN mechanics mc ON mc.id=h.mechanic_id WHERE h.maintenance_job_id=? AND h.mechanic_id=? AND h.released_at IS NULL FOR UPDATE', [$id, $mid]);
            must((bool)$h, 'This mechanic is not assisting on this repair.', 404);
            run($p, 'UPDATE maintenance_job_helpers SET released_at=NOW(), released_by=?, release_reason=? WHERE id=?', [$u['id'], $reason, $h['id']]);
            self::refreshMechanic($p, $mid);
            self::event($p, $id, $j['status'], $j['status'], $u['id'], 'assisting mechanic removed: ' . $h['full_name'] . ': ' . $reason, $mid);
            auditWithChanges($p, $u['id'], 'Maintenance', 'job ' . $id, 'assisting mechanic removed', $j['job_ref'] . ' - ' . $h['full_name'] . ': ' . $reason,
                ['Assisting mechanic' => $h['full_name']], ['Assisting mechanic' => null]);
            return ['message' => $h['full_name'] . ' was removed from ' . $j['job_ref'] . '.'];
        });
    }

    /** Incident assessment is based on the dispatcher's report; no physical inspection or mechanic assignment is assumed. */
    private static function assess(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $sev = choiceField($d, 'severity', ['Minor', 'Major']);
        $rec = field($d, 'recommendation', 500);
        return transaction(function (PDO $p) use ($u, $id, $sev, $rec) {
            $j = self::lockJob($p, $id);
            must($j['source'] === 'Incident' && $j['status'] === 'Reported', 'Only a newly reported incident can be assessed.', 409);
            $inc = one($p, 'SELECT * FROM incidents WHERE id=? FOR UPDATE', [$j['incident_id']]);
            $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$j['trip_id']]);
            must($inc && $t && $t['status'] === 'On Hold - Incident Reported', 'The trip is not On Hold.', 409);
            // Assessment does not reserve a garage mechanic or claim a physical inspection.
            // Minor incidents proceed to documented roadside safety clearance;
            // Major incidents proceed to rescheduling, with garage repair only after recovery.
            run($p, "UPDATE maintenance_jobs SET status='Under Inspection', severity=?, started_by=?, started_at=NOW(), remarks=? WHERE id=?",
                [$sev, $u['id'], $rec, $id]);
            run($p, "UPDATE incidents SET severity=?, recommendation=?, status='Under Repair', assessed_by=?, assessed_at=NOW() WHERE id=?",
                [$sev, $rec, $u['id'], $inc['id']]);
            self::event($p, $id, 'Reported', 'Under Inspection', $u['id'], "assessed $sev: $rec");
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'incident assessed', $inc['incident_ref'] . ': ' . $sev . '; mechanic not yet assigned');
            Notify::resolve($p, 'incident-assess-' . $inc['id']);
            Actions::load('Trips');
            if ($sev === 'Major') {
                run($p, "UPDATE incidents SET clearance='Not Fit to Continue', clearance_findings=?, cleared_by=?, cleared_at=NOW() WHERE id=?",
                    [$rec, $u['id'], $inc['id']]);
                Trips::setStatus($p, $u['id'], $t, 'For Reschedule', 'major damage: truck returned for repair', $inc['incident_ref']);
                $now = FleetState::reconcile($p, (int)$j['vehicle_id'], $u['id'], 'Major damage ' . $inc['incident_ref']);
                Notify::tripRoles($p, $t, [$t['dispatcher_role'], 'operations_head'], 'Major damage',
                    $t['trip_ref'] . ' is For Reschedule. Truck is ' . $now . '.', 'trips');
                return ['message' => 'Assessed as MAJOR. Truck is ' . $now . ' and trip is For Reschedule. No garage mechanic is assigned until the truck is recovered and garage repair begins.'];
            }
            Trips::event($p, $u['id'], (int)$t['id'], 'minor damage assessed; awaiting inspection or clearance', $t['status'], $t['status'], $inc['incident_ref']);
            Notify::tripRoles($p, $t, [$t['dispatcher_role'], 'operations_head'], 'Minor damage',
                $t['trip_ref'] . ': Motorpool assessed a minor incident. Trip stays On Hold pending fit-to-continue clearance.', 'trips');
            return ['message' => 'Assessed as MINOR. Trip remains On Hold. Review documented roadside condition and record Vehicle Clearance; a garage mechanic is not required for roadside assessment.'];
        });
    }

    /** Inspection findings + diagnosis. Under Inspection -> Under Repair. */
    private static function inspect(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $findings = field($d, 'findings', 2000);
        $diagnosis = field($d, 'diagnosis', 2000);
        $exp = null; // ETA no longer requested during inspection (#43).
        if ($exp) must($exp >= date('Y-m-d'), 'Expected completion cannot be in the past.');
        return transaction(function (PDO $p) use ($u, $id, $findings, $diagnosis, $exp) {
            $j = self::lockJob($p, $id);
            must($j['status'] === 'Under Inspection', 'Findings are recorded while the record is Under Inspection (now: ' . $j['status'] . ').', 409);
            must((bool)$j['mechanic_id'], 'Assign a mechanic first.', 409);
            run($p, "UPDATE maintenance_jobs SET status='Under Repair', findings=?, diagnosis=?, expected_completion=COALESCE(?, expected_completion) WHERE id=?", [$findings, $diagnosis, $exp, $id]);
            Files::store($p, $u, 'photos', 'maintenance', $id, 'Inspection Photo');
            self::event($p, $id, 'Under Inspection', 'Under Repair', $u['id'], 'diagnosis: ' . $diagnosis, (int)$j['mechanic_id']);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'inspection recorded', $j['job_ref'] . ': ' . cut($diagnosis, 200));
            return ['message' => 'Findings and diagnosis saved. ' . $j['job_ref'] . ' is Under Repair.'];
        });
    }

    /** Repair costs (labor, outside service ...). Recorded as maintenance expenses. */
    private static function addCost(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $row = ['cost_type' => choiceField($d, 'cost_type', self::COST_TYPES), 'description' => field($d, 'description', 255),
                'provider' => optField($d, 'provider', 150), 'amount' => moneyField($d, 'amount'), 'incurred_on' => dateField($d, 'incurred_on')];
        must($row['incurred_on'] <= date('Y-m-d'), 'The date cannot be in the future.');
        return transaction(function (PDO $p) use ($u, $id, $row) {
            $j = self::lockJob($p, $id);
            must(in_array($j['status'], ['Under Inspection', 'Under Repair'], true), 'Costs are added while the record is Under Inspection or Under Repair.', 409);
            $cid = insert($p, 'maintenance_costs', ['maintenance_job_id' => $id, 'recorded_by' => $u['id']] + $row);
            Money::expense($p, $u, 'Maintenance', $row['amount'], $row['incurred_on'], 'Maintenance', $cid, null, (int)$j['vehicle_id'], $row['provider'], $j['job_ref'], $row['cost_type'] . ': ' . $row['description']);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'repair cost added', $j['job_ref'] . ' ' . $row['cost_type'] . ' PHP ' . $row['amount']);
            return ['message' => 'Cost recorded.'];
        });
    }

    /** Repair done: corrective action + completion date + evidence. The mechanic becomes free; the truck waits for verification. */
    private static function complete(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $performed = field($d, 'repair_performed', 2000);
        // Completion date is the authoritative server date when Complete Repair is submitted.
        // Never accept a client-selected completion date.
        $done = date('Y-m-d');
        $remarks = null; // Preserve earlier remarks on the repair record, if any.
        return transaction(function (PDO $p) use ($u, $id, $performed, $done, $remarks) {
            $j = self::lockJob($p, $id);
            must($j['status'] === 'Under Repair', $j['status'] === 'Under Inspection' ? 'Record the inspection findings and diagnosis first.' : 'Only records Under Repair can be completed (now: ' . $j['status'] . ').', 409);
            must($done >= (string)$j['reported_on'], 'Completion date is before the date reported.');
            if (self::catalogReady($p) && $j['parts_requirement'] !== null) {
                must((bool)$j['assignment_finalized_at'], 'Finalize the repair assignment before completion.', 409);
                must(in_array($j['parts_requirement'], ['No Parts Needed','Parts Required'], true), 'Confirm parts requirement before repair completion.', 409);
                if ($j['parts_requirement'] === 'Parts Required') must((bool)one($p, "SELECT id FROM part_requests WHERE maintenance_job_id=? AND status<>'Cancelled' LIMIT 1", [$id]), 'Parts are required but no active linked request exists.', 409);
            }
            // A parts request is fulfilled only after Purchasing releases the
            // requested quantity to this repair. PO receipt into inventory alone
            // does not satisfy the mechanic's request.
            $pendingParts = one($p, "SELECT COALESCE(SUM(l.quantity-l.released_qty),0) AS units,
                    COUNT(DISTINCT r.id) AS requests
                FROM part_requests r JOIN part_request_lines l ON l.part_request_id=r.id
                WHERE r.maintenance_job_id=? AND r.status <> 'Cancelled'
                  AND l.quantity>l.released_qty", [$id]);
            must((int)($pendingParts['units'] ?? 0) === 0,
                'Cannot complete repair: ' . (int)$pendingParts['units'] . ' requested part unit(s) are still waiting for Purchasing release. Check Parts Requests and complete the release first.', 409);
            Files::store($p, $u, 'evidence', 'maintenance', $id, 'Repair Evidence');
            must(Files::count($p, 'maintenance', $id, 'Repair Evidence') > 0, 'Attach at least one photo or document as evidence of the repair.', 422);
            run($p, "UPDATE maintenance_jobs SET status='Completed', repair_performed=?, completed_on=?, remarks=COALESCE(?, remarks), completed_by=?, completed_at=NOW() WHERE id=?",
                [$performed, $done, $remarks, $u['id'], $id]);
            self::refreshMechanic($p, $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
            self::releaseHelpers($p, $id, (int)$u['id'], 'repair completed');
            self::event($p, $id, 'Under Repair', 'Completed', $u['id'], 'corrective action: ' . $performed, $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'repair completed', $j['job_ref'] . ': ' . cut($performed, 200));
            $v = one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$j['vehicle_id']]);
            return ['message' => 'Repair completed. Truck ' . $v['plate_number'] . ' stays out of service until you verify it (Verify & return to service).'];
        });
    }

    /**
     * Operational verification after the repair. Passed -> the truck returns to service
     * (Available, or Assigned if a trip is waiting for it). Failed -> back to Under Repair.
     */
    private static function verify(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $result = choiceField($d, 'result', ['Passed', 'Failed']);
        $notes = field($d, 'verification_notes', 500);
        $mechanicId = optId($d, 'mechanic_id');
        $replacementReason = optField($d, 'reassignment_reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $result, $notes, $mechanicId, $replacementReason) {
            $j = self::lockJob($p, $id);
            must($j['status'] === 'Completed' && !$j['verified_at'], 'Only completed repairs waiting for verification can be verified.', 409);
            $v = one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$j['vehicle_id']]);
            if ($result === 'Failed') {
                $mid = $mechanicId ?: (int)$j['mechanic_id'];
                must($mid > 0, 'Choose the mechanic who will continue the repair.');
                if (self::catalogReady($p) && $j['assignment_finalized_at'] && $mid !== (int)$j['mechanic_id']) must($replacementReason !== null, 'Give a reason for replacing a finalized mechanic after failed verification.', 422);
                self::freeMechanic($p, $mid, (int)$j['id']);
                run($p, "UPDATE maintenance_jobs SET status='Under Repair', completed_on=NULL, completed_by=NULL, completed_at=NULL WHERE id=?", [$id]);
                self::setMechanic($p, self::lockJob($p, $id), $mid);
                if (self::catalogReady($p) && $j['assignment_finalized_at'] && $mid !== (int)$j['mechanic_id']) {
                    self::event($p, $id, 'Under Repair', 'Under Repair', $u['id'], 'authorized replacement after failed verification: ' . $replacementReason, $mid);
                    audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'finalized mechanic replaced after failed verification', $j['job_ref'] . ': ' . $replacementReason);
                }
                self::event($p, $id, 'Completed', 'Under Repair', $u['id'], 'verification failed: ' . $notes, $mid);
                audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'verification failed', $j['job_ref'] . ': ' . cut($notes, 200));
                return ['message' => 'Verification failed. ' . $j['job_ref'] . ' is back Under Repair; truck ' . $v['plate_number'] . ' stays out of service.'];
            }
            run($p, 'UPDATE maintenance_jobs SET verified_at=NOW(), verified_by=?, verification_notes=? WHERE id=?', [$u['id'], $notes, $id]);
            self::event($p, $id, 'Completed', 'Completed', $u['id'], 'verified, returned to service: ' . $notes);
            $now = FleetState::reconcile($p, (int)$j['vehicle_id'], $u['id'], 'Repair verified ' . $j['job_ref']);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'truck returned to service', $j['job_ref'] . ' ' . $v['plate_number'] . ': ' . cut($notes, 200));
            Notify::resolve($p, 'job-open-' . $id);
            $msg = 'Verified. Truck ' . $v['plate_number'] . ' is back in service (' . $now . ').';
            if ($j['source'] === 'Incident' && $j['severity'] === 'Minor') $msg = 'Repair verified. Truck ' . $v['plate_number'] . ' is ' . $now . ' and stays with its trip.';
            Actions::load('Trips');
            if ($j['source'] === 'Incident') {
                $inc = one($p, 'SELECT * FROM incidents WHERE id=? FOR UPDATE', [$j['incident_id']]);
                $t = one($p, 'SELECT * FROM trips WHERE id=?', [$j['trip_id']]);
                if ($j['severity'] === 'Minor' && $t['status'] === 'For Reschedule') {
                    // Operations moved the trip to For Reschedule after Not Fit: the verified repair closes the incident like a Major one.
                    run($p, "UPDATE incidents SET status='Resolved', resolved_at=NOW() WHERE id=?", [$inc['id']]);
                    Trips::event($p, $u['id'], (int)$t['id'], 'truck repaired after not fit to continue', $t['status'], $t['status'], $inc['incident_ref']);
                    Notify::tripRoles($p, $t, [$t['dispatcher_role'], 'operations_head'], 'Truck available again', $v['plate_number'] . ' is repaired. Reschedule ' . $t['trip_ref'] . '.', 'trips', 'trip-reschedule-' . $inc['id']);
                    $msg .= ' The dispatcher can now reschedule the trip.';
                } elseif ($j['severity'] === 'Minor') {
                    // INCIDENT_CLEARANCE_V1: a verified repair is not by itself a clearance; Motorpool records Fit / Not Fit next.
                    Trips::event($p, $u['id'], (int)$t['id'], 'on-site repair verified; awaiting Motorpool clearance', $t['status'], $t['status'], $inc['incident_ref']);
                    $msg .= ' Record the vehicle clearance (Fit / Not Fit to Continue) for ' . $inc['incident_ref'] . ' so the dispatcher can act on it.';
                } else {
                    run($p, "UPDATE incidents SET status='Resolved', resolved_at=NOW() WHERE id=?", [$inc['id']]);
                    Trips::event($p, $u['id'], (int)$t['id'], 'truck repaired after major damage', $t['status'], $t['status'], $inc['incident_ref']);
                    Notify::tripRoles($p, $t, [$t['dispatcher_role'], 'operations_head'], 'Truck available again', $v['plate_number'] . ' is repaired. Reschedule ' . $t['trip_ref'] . '.', 'trips', 'trip-reschedule-' . $inc['id']);
                    $msg .= ' The dispatcher can now reschedule the trip.';
                }
            } else {
                Notify::roles($p, ['operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher'], 'Truck available again', $v['plate_number'] . ' was repaired, verified and is ' . $now . '.', 'trucks');
                // A failed pre-dispatch truck was released from its fixed pair.
                // Verification restores availability, not dispatch authorization.
                if (!empty($j['trip_id'])) {
                    $affected = one($p, 'SELECT * FROM trips WHERE id=?', [(int)$j['trip_id']]);
                    if ($affected && $affected['status'] === 'Awaiting Resources') {
                        Notify::tripRoles($p, $affected, ['operations_head', $affected['dispatcher_role']],
                            'Truck repaired — repeat pre-dispatch checklist',
                            $v['plate_number'] . ' is verified after ' . $j['job_ref'] . '. Reassign an eligible truck and fixed driver to ' .
                            $affected['trip_ref'] . ', then submit a fresh full pre-dispatch checklist before dispatch.',
                            'trips');
                        $msg .= ' Trip ' . $affected['trip_ref'] . ' still needs Dispatcher reassignment and a new full pre-dispatch checklist.';
                    }
                }
                if ($auto = Trips::assignWaiting($p, $u)) $msg .= ' ' . $auto;
            }
            return ['message' => $msg];
        });
    }

    /**
     * INCIDENT_CLEARANCE_V1: Motorpool's vehicle clearance for a trip incident. Minor / Major (severity) stays the damage
     * classification; this is the separate technical decision. Fit to Continue (Minor only) needs the on-site repair
     * record completed and verified; it lets the trip's Dispatcher resume. Not Fit to Continue keeps the trip On Hold.
     * Only the trip's CURRENT incident, for the trip's current attempt and truck, can be cleared; a decision is never
     * overwritten except Not Fit -> Fit after a verified repair (both stay in the trip history and audit).
     */
    private static function clearance(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $decision = choiceField($d, 'decision', ['Fit to Continue', 'Not Fit to Continue']);
        $findings = field($d, 'findings', 1000);
        $inspectionOnly = $decision === 'Fit to Continue' && !empty($d['inspection_only']);
        // Roadside incident checks are distinct from garage repair and must never
        // claim a mechanic inspected a distant truck. Only qualified on-site
        // checks with evidence may support an unassigned Minor incident clearance.
        $roadside = $decision === 'Fit to Continue' && !empty($d['roadside_check']);
        $checkedBy = $roadside ? field($d, 'checked_by', 150) : null;
        $onSiteConfirmed = !empty($d['on_site_checked']);
        return transaction(function (PDO $p) use ($u, $id, $decision, $findings, $inspectionOnly, $roadside, $checkedBy, $onSiteConfirmed) {
            $j = self::lockJob($p, $id);
            must($j['source'] === 'Incident' && $j['incident_id'] && $j['trip_id'], 'Clearance is recorded on a trip incident repair record.', 409);
            $inc = one($p, 'SELECT * FROM incidents WHERE id=? FOR UPDATE', [$j['incident_id']]);
            $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$j['trip_id']]);
            must($inc && $t && (int)$inc['trip_id'] === (int)$t['id'], 'The incident does not belong to this trip.', 409);
            $latest = one($p, 'SELECT id FROM incidents WHERE trip_id=? ORDER BY id DESC LIMIT 1', [$t['id']]);
            must((int)$latest['id'] === (int)$inc['id'] && (int)$inc['attempt_number'] === (int)$t['attempt_number'],
                'This is an earlier incident of the trip; record the clearance on the current incident.', 409);
            must((int)$inc['vehicle_id'] === (int)$j['vehicle_id'] && (int)$inc['vehicle_id'] === (int)$t['vehicle_id'], "The incident truck is not the trip's current truck.", 409);
            must($t['status'] === 'On Hold - Incident Reported', 'The trip is not On Hold for this incident (status: ' . $t['status'] . ').', 409);
            must($inc['severity'] !== null, 'Assess the incident (Minor or Major) first.', 409);
            must($inc['severity'] === 'Minor', 'Major damage is already recorded as Not Fit to Continue; the trip follows For Reschedule.', 409);
            must($inc['clearance'] !== 'Fit to Continue', 'Fit to Continue is already recorded for ' . $inc['incident_ref'] . '.', 409);
            must($inc['clearance'] !== $decision, $decision . ' is already recorded for ' . $inc['incident_ref'] . '.', 409);
            if ($roadside) {
                must(!$inspectionOnly, 'Choose one clearance method.', 422);
                must($j['status'] === 'Under Inspection' && !$j['mechanic_id'] && !$j['assignment_finalized_at'],
                    'Roadside clearance applies only to a Minor incident before garage repair.', 409);
                must($onSiteConfirmed, 'Confirm the physical on-site vehicle check before clearing the trip.', 422);
                must(Files::has('evidence'), 'Attach supporting evidence of the on-site vehicle check.', 422);
                must(!one($p, 'SELECT 1 FROM maintenance_costs WHERE maintenance_job_id=? LIMIT 1', [$id]),
                    'A repair cost exists; complete the garage repair process instead.', 409);
                must(!one($p, "SELECT 1 FROM part_requests WHERE maintenance_job_id=? AND status<>'Cancelled' LIMIT 1", [$id]),
                    'A parts request exists; complete the repair process instead.', 409);
            } elseif ($inspectionOnly) {
                // Inspection-only clearance is after a real inspection, not an assumption from the dispatcher's report.
                must((bool)$j['mechanic_id'], 'Assign a mechanic and inspect the truck before recording inspection-only clearance.', 409);
                // No repair was needed: the inspection itself is recorded; nothing is invented (no repair text, parts, costs or labor).
                must(in_array($j['status'], ['Under Inspection', 'Under Repair'], true), 'Inspection-only clearance is for an open, inspected record (now: ' . $j['status'] . ').', 409);
                must(!one($p, 'SELECT 1 AS x FROM maintenance_costs WHERE maintenance_job_id=?', [$id]), 'Costs were recorded, so a repair took place: complete and verify the repair instead.', 409);
                must(!one($p, "SELECT 1 AS x FROM part_requests WHERE maintenance_job_id=? AND status<>'Cancelled'", [$id]), 'Parts were requested for this record: complete and verify the repair instead.', 409);
            } elseif ($decision === 'Fit to Continue') {
                must($j['status'] === 'Completed' && $j['verified_at'] !== null,
                    'Complete and verify the on-site repair record ' . $j['job_ref'] . ' first, or record an inspection-only clearance when no repair was needed.', 409);
            }
            $before = $inc['clearance'];
            if ($roadside) {
                // Close the incident-linked maintenance record as a roadside
                // safety check, not a fabricated garage repair or mechanic job.
                $record = 'Roadside vehicle check by ' . $checkedBy . ': ' . $findings;
                run($p, "UPDATE maintenance_jobs SET status='Completed', findings=?, repair_performed=NULL,
                         completed_on=CURRENT_DATE(), completed_by=?, completed_at=NOW(), verified_at=NOW(),
                         verified_by=?, verification_notes=? WHERE id=?",
                    [$record, $u['id'], $u['id'], cut($record, 500), $id]);
                self::event($p, $id, $j['status'], 'Completed', $u['id'],
                    'roadside safety check; no garage mechanic or repair: ' . cut($record, 400));
                audit($p, $u['id'], 'Maintenance', 'incident '.$inc['id'],
                    'roadside vehicle condition accepted', $inc['incident_ref'].': '.cut($record, 250));
            } elseif ($inspectionOnly) {
                run($p, "UPDATE maintenance_jobs SET status='Completed', findings=COALESCE(findings, ?), repair_performed=NULL, completed_on=CURRENT_DATE(), completed_by=?, completed_at=NOW(),
                         verified_at=NOW(), verified_by=?, verification_notes=? WHERE id=?",
                    [$findings, $u['id'], $u['id'], cut('Inspection only - no repair performed: ' . $findings, 500), $id]);
                self::refreshMechanic($p, $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
                self::releaseHelpers($p, $id, (int)$u['id'], 'inspection only, no repair needed');
                self::event($p, $id, $j['status'], 'Completed', $u['id'], 'inspection only, no repair performed: ' . cut($findings, 400), $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
            }
            run($p, 'UPDATE incidents SET clearance=?, clearance_findings=?, cleared_by=?, cleared_at=NOW()' . ($decision === 'Fit to Continue' ? ", status='Repaired - Cleared to Continue'" : '') . ' WHERE id=?',
                [$decision, $findings, $u['id'], $inc['id']]);
            Files::store($p, $u, 'evidence', 'incident', (int)$inc['id'],
                $roadside ? 'Roadside Safety Evidence' : ($inspectionOnly ? 'Incident Photo' : 'Repair Evidence'),
                $roadside);
            $truckNow = FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Vehicle clearance ' . $inc['incident_ref'] . ': ' . $decision); // Not Fit -> Under Maintenance
            Actions::load('Trips');
            Trips::event($p, $u['id'], (int)$t['id'], 'vehicle clearance: ' . $decision, $t['status'], $t['status'], $inc['incident_ref'] . ': ' . cut($findings, 400));
            auditWithChanges($p, $u['id'], 'Maintenance', 'incident ' . $inc['id'], 'vehicle clearance recorded', $inc['incident_ref'] . ' (' . $t['trip_ref'] . '): ' . $decision,
                ['Clearance' => $before], ['Clearance' => $decision]);
            if ($decision === 'Fit to Continue') {
                Notify::tripRoles($p, $t, [$t['dispatcher_role']], 'Cleared to continue', $t['trip_ref'] . ': Motorpool recorded Fit to Continue. Resume the trip.', 'trips', 'trip-resume-' . $inc['id']);
                return ['message' => 'Fit to Continue recorded for ' . $inc['incident_ref'] . ($roadside ? ' (roadside safety check; no garage mechanic assigned)' : ($inspectionOnly ? ' (inspection only, no repair performed)' : '')) . '. The dispatcher can resume ' . $t['trip_ref'] . '.'];
            }
            Notify::tripRoles($p, $t, [$t['dispatcher_role'], 'operations_head'], 'Not fit to continue', $t['trip_ref'] . ': Motorpool recorded Not Fit to Continue. The trip stays On Hold.', 'trips');
            return ['message' => 'Not Fit to Continue recorded for ' . $inc['incident_ref'] . '. Trip remains On Hold; Operations Head can move it to For Reschedule. Garage repair starts after truck recovery if required.'];
        });
    }

    /** Cancel a garage report made by mistake. Incident repairs cannot be cancelled. */
    private static function cancel(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id'); $reason = field($d, 'reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $reason) {
            $j = self::lockJob($p, $id);
            must($j['source'] !== 'Incident', 'Incident repairs cannot be cancelled; complete and verify the repair instead.', 409);
            must(in_array($j['status'], self::ACTIVE, true), 'Already ' . $j['status'] . '.', 409);
            must(!one($p, "SELECT r.id FROM part_requests r JOIN part_request_lines l ON l.part_request_id=r.id WHERE r.maintenance_job_id=? AND l.released_qty>0", [$id]), 'Parts were already released for this record; complete it instead.', 409);
            run($p, "UPDATE maintenance_jobs SET status='Cancelled', remarks=? WHERE id=?", [cut('Cancelled: ' . $reason, 500), $id]);
            run($p, "UPDATE part_requests SET status='Cancelled' WHERE maintenance_job_id=? AND status='Requested'", [$id]);
            self::refreshMechanic($p, $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
            self::releaseHelpers($p, $id, (int)$u['id'], 'record cancelled');
            self::event($p, $id, $j['status'], 'Cancelled', $u['id'], $reason);
            $now = FleetState::reconcile($p, (int)$j['vehicle_id'], $u['id'], 'Maintenance cancelled ' . $j['job_ref']);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'maintenance cancelled', $j['job_ref'] . ': ' . $reason);
            Notify::resolve($p, 'job-open-' . $id);
            Actions::load('Trips'); Trips::assignWaiting($p, $u);
            return ['message' => 'Record cancelled. Truck is ' . $now . '.'];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'maintenance'), 'Not allowed.', 403);
        $id = idField($d, 'job_id'); $p = db();
        $j = one($p, 'SELECT m.*, v.plate_number, v.truck_number, v.truck_type, v.status AS truck_status, t.trip_ref, mc.full_name AS mechanic, mc.mechanic_code, mc.contact_number AS mechanic_contact,
                su.full_name AS started_by_name, cu.full_name AS completed_by_name, vu.full_name AS verified_by_name, ru.full_name AS reported_by_name
            FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN trips t ON t.id=m.trip_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id
            LEFT JOIN users su ON su.id=m.started_by LEFT JOIN users cu ON cu.id=m.completed_by LEFT JOIN users vu ON vu.id=m.verified_by LEFT JOIN users ru ON ru.id=m.created_by WHERE m.id=?', [$id]);
        must((bool)$j, 'Record not found.', 404);
        $inc = $j['incident_id'] ? one($p, 'SELECT i.*, ru.full_name AS reported_by_name, au.full_name AS assessed_by_name, cu.full_name AS cleared_by_name, su.full_name AS resumed_by_name FROM incidents i JOIN users ru ON ru.id=i.reported_by LEFT JOIN users au ON au.id=i.assessed_by LEFT JOIN users cu ON cu.id=i.cleared_by LEFT JOIN users su ON su.id=i.resumed_by WHERE i.id=?', [$j['incident_id']]) : null;
        $docs = Files::of($p, 'maintenance', $id);
        if ($inc) foreach (Files::of($p, 'incident', (int)$inc['id']) as $doc) $docs[] = $doc;
        // Repair opened by an arrival checklist: show the checklist findings and its photos.
        $arrival = one($p, "SELECT ins.*, us.full_name AS actor FROM inspections ins JOIN users us ON us.id=ins.actor_id WHERE ins.maintenance_job_id=? AND ins.kind='Arrival' ORDER BY ins.id DESC LIMIT 1", [$id]);
        $historyReady = (bool)one($p, "SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pre_dispatch_checklist_submissions'");
        $preDispatch = $historyReady
            ? one($p, "SELECT ins.*, us.full_name AS actor FROM pre_dispatch_checklist_submissions ins
                JOIN users us ON us.id=ins.actor_id
                WHERE ins.maintenance_job_id=? AND ins.has_not_ok=1 ORDER BY ins.id DESC LIMIT 1", [$id])
            : one($p, "SELECT ins.*, us.full_name AS actor FROM inspections ins
                JOIN users us ON us.id=ins.actor_id
                WHERE ins.maintenance_job_id=? AND ins.kind='Pre-Dispatch' AND ins.has_not_ok=1
                ORDER BY ins.id DESC LIMIT 1", [$id]);
        $preDispatchFindings = [];
        if ($preDispatch) {
            require_once __DIR__ . '/../Operations/Inspections/Checklist.php';
            $saved = json_decode((string)$preDispatch['items_json'], true)['items'] ?? [];
            foreach (Checklist::sections() as $section) foreach ($section['items'] as $i => $label) {
                $key = $section['key'].'_'.str_pad((string)($i+1), 2, '0', STR_PAD_LEFT);
                if (($saved[$key]['condition'] ?? '') !== 'NOT OK') continue;
                $remark = trim((string)($saved[$key]['remarks'] ?? ''));
                $preDispatchFindings[] = $label . ($remark !== '' ? ' (' . $remark . ')' : '');
            }
        }
        if ($arrival) foreach (Files::of($p, 'trip', (int)$arrival['trip_id']) as $doc) if ($doc['category'] === 'Arrival Inspection Photo') $docs[] = $doc;
        return [
            'job' => $j, 'pending_parts_units' => (int)(one($p, "SELECT COALESCE(SUM(l.quantity-l.released_qty),0) AS n
                FROM part_requests r JOIN part_request_lines l ON l.part_request_id=r.id
                WHERE r.maintenance_job_id=? AND r.status <> 'Cancelled'", [$id])['n'] ?? 0),
            'incidentClarifications' => $inc && one($p,"SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='incident_clarifications'") ? many($p,'SELECT c.id,c.details,c.created_at,u.full_name AS actor FROM incident_clarifications c JOIN users u ON u.id=c.actor_id WHERE c.incident_id=? ORDER BY c.id',[(int)$inc['id']]) : [],
            'incident' => $inc, 'arrival' => $arrival, 'preDispatch' => $preDispatch, 'preDispatchFindings' => $preDispatchFindings, 'documents' => $docs,
            'selectedComponents' => self::catalogReady($p) ? array_map('intval',array_column(many($p,'SELECT component_id FROM maintenance_job_components WHERE maintenance_job_id=?',[$id]),'component_id')) : [],
            'excludedComponents' => self::catalogReady($p) ? array_map('intval',array_column(many($p,'SELECT component_id FROM motorpool_vehicle_component_exclusions WHERE vehicle_id=?',[(int)$j['vehicle_id']]),'component_id')) : [],
            // JOB_HELPER_MECHANICS_V1: assisting mechanics, active and past (who assigned / released them and why).
            'helpers' => self::helpersReady($p) ? many($p, 'SELECT h.mechanic_id, h.assigned_at, h.released_at, h.release_reason, mc.full_name, mc.mechanic_code, au.full_name AS assigned_by_name, ru.full_name AS released_by_name
                FROM maintenance_job_helpers h JOIN mechanics mc ON mc.id=h.mechanic_id JOIN users au ON au.id=h.assigned_by LEFT JOIN users ru ON ru.id=h.released_by
                WHERE h.maintenance_job_id=? ORDER BY h.released_at IS NOT NULL, h.id', [$id]) : [],
            'helpersReady' => self::helpersReady($p),
            'events' => many($p, 'SELECT e.*, u.full_name AS actor, mc.full_name AS mechanic FROM maintenance_events e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN mechanics mc ON mc.id=e.mechanic_id WHERE e.maintenance_job_id=? ORDER BY e.id', [$id]),
            'history' => many($p, 'SELECT m.id, m.job_ref, m.source, m.problem, m.status, m.reported_on, m.completed_on, mc.full_name AS mechanic FROM maintenance_jobs m LEFT JOIN mechanics mc ON mc.id=m.mechanic_id WHERE m.vehicle_id=? ORDER BY m.id DESC LIMIT 30', [$j['vehicle_id']]),
            'costs' => many($p, 'SELECT c.*, u.full_name AS recorded_by_name FROM maintenance_costs c JOIN users u ON u.id=c.recorded_by WHERE c.maintenance_job_id=? ORDER BY c.id', [$id]),
            'parts' => many($p, 'SELECT r.request_ref, r.status, pt.part_number, pt.description, l.quantity, l.released_qty, l.unit_cost FROM part_requests r
                JOIN part_request_lines l ON l.part_request_id=r.id JOIN parts pt ON pt.id=l.part_id WHERE r.maintenance_job_id=? ORDER BY r.id, l.id', [$id]),
        ];
    }
}
