<?php
/*
 * =====================================================================
 *  backend/Modules/Operations/Trips.php  —  TRIP MANAGEMENT AND DISPATCH
 * =====================================================================
 *  Objectives 1.3, 1.5, 1.6 and 4.4. Workflow = PDF #12.
 *
 *  SCENARIO A (client -> Operations Head)
 *    Ops Head picks the client, enters delivery details, truck type, route
 *    (map pins + typed km) -> system auto-assigns truck, driver, helper
 *    -> "Pre-Assigned" (shown to the dispatcher of that truck type)
 *  SCENARIO B (client -> Dispatcher)
 *    Dispatcher encodes the request -> "Pending Review" -> Ops Head reviews,
 *    sets truck type, km and details -> auto-assign -> "Pre-Assigned"
 *  BOTH
 *    Dispatcher fund request -> Ops Head approves -> Finance releases (Funds.php)
 *    Dispatcher pre-dispatch checklist (all OK) -> "Ready for Dispatch"
 *    Confirm Dispatch is allowed only when fund = Released AND trip = Ready for Dispatch
 *    -> "Dispatched" (billing draft generated) -> incident / completion actions
 *    -> Complete Trip (completion date/time + waybill + acknowledgement receipt)
 *    -> "Completed" (billing draft moves to For Billing; driver and helper are free)
 *    -> truck drives back: it stays held ("On Trip") until the dispatcher submits the
 *       ARRIVAL CHECKLIST (PDF #11 section G). All OK -> truck Available.
 *       NOT OK -> corrective maintenance record, truck Under Maintenance.
 *  SCENARIO C (breakdown)
 *    Dispatcher incident report -> "On Hold - Incident Reported" -> Maintenance assesses
 *      Minor: repaired on site -> Resume Trip -> "In Transit" (not a second attempt)
 *      Major: truck Under Maintenance, trip "For Reschedule" -> repair -> Reschedule
 *             -> checklist again -> Confirm Redispatch = Second Attempt
 *
 *  Every status change is checked here on the server (allowed "from" statuses),
 *  so an invalid jump (e.g. Completed -> Dispatched) is impossible even by API.
 * =====================================================================
 */
declare(strict_types=1);
core('FleetState');
core('Settings');
core('Notify');
core('Files');
core('BillingDraft');
core('RouteDistance');
core('CrewAttendance');

final class Trips {
    public const STATUSES = ['Pending Review', 'Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'Dispatched',
                             'On Hold - Incident Reported', 'In Transit', 'For Reschedule', 'Completed', 'Cancelled', 'Rejected'];
    public const CLOSED = ['Completed', 'Cancelled', 'Rejected'];
    public const BEFORE_DISPATCH = ['Pending Review', 'Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'];
    public const UPDATE_TYPES = ['Progress', 'Loading', 'Unloading', 'Delivery', 'Delay', 'Other'];
    public const DELAY_CAUSES = ['Client', 'Pending Documents', 'Traffic', 'Weather', 'Operational', 'Other'];
    public const INCIDENT_TYPES = ['Breakdown', 'Flat Tire', 'Accident', 'Cargo Damage', 'Other'];
    public const DOC_REQUEST = 'Trip Request Document';
    public const DOC_WAYBILL = 'Waybill';
    public const DOC_AR = 'Acknowledgement Receipt';
    public const DOC_DR = 'Delivery Receipt';
    public const DOC_ARRIVAL_PHOTO = 'Arrival Inspection Photo';
    // CHECKLIST_44_DIESEL_PO_SOA_ATTACHMENTS_V1: optional attachments only (no approval, purchasing or reconciliation flow).
    public const DOC_DIESEL_PO = 'Diesel PO';
    public const DOC_SUPPLIER_SOA = 'Supplier SOA';
    /** Trip statuses where the dispatcher may attach the Diesel PO (assigned, on the road, or just completed). */
    private const DIESEL_PO_STATUSES = ['Pre-Assigned', 'Ready for Dispatch', 'Dispatched', 'On Hold - Incident Reported', 'In Transit', 'For Reschedule', 'Completed'];
    public const FUEL_LEVELS = ['Full', '3/4', '1/2', '1/4', 'Low'];

    // =================================================================
    // READ
    // =================================================================
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        [$scope, $scopeArgs] = self::scope($u);
        [$where, $args] = self::filters($q);
        $closed = "'" . implode("','", self::CLOSED) . "'";
        $data = readSections([
            // Open trips + completed trips whose truck is still returning (arrival checklist pending).
            'active' => fn() => many($p, self::select() . " WHERE (t.status NOT IN ($closed)
                    OR EXISTS (SELECT 1 FROM trip_assignments aa WHERE aa.trip_id=t.id AND aa.resource_type='vehicle')) $scope ORDER BY t.scheduled_at, t.id", $scopeArgs),
            'history' => fn() => many($p, self::select() . " WHERE t.status IN ($closed) $scope $where ORDER BY t.scheduled_at DESC, t.id DESC LIMIT 1000", array_merge($scopeArgs, $args)),
            'incidents' => fn() => many($p, "SELECT i.*, t.trip_ref, t.status AS trip_status, v.plate_number, c.company_name AS client, ru.full_name AS reported_by_name,
                    (SELECT au.full_name FROM users au WHERE au.id=i.assessed_by) AS assessed_by_name, m.job_ref, m.status AS job_status
                FROM incidents i JOIN trips t ON t.id=i.trip_id JOIN vehicles v ON v.id=i.vehicle_id JOIN clients c ON c.id=t.client_id
                JOIN users ru ON ru.id=i.reported_by LEFT JOIN maintenance_jobs m ON m.incident_id=i.id
                WHERE 1=1 $scope ORDER BY i.id DESC LIMIT 300", $scopeArgs),
        ]);
        if (self::canCreate($u) || hasRole($u, 'operations_head', 'admin')) {
            $data = mergeSections($data, [
                'clients' => fn() => many($p, "SELECT c.id, c.company_name, (SELECT GROUP_CONCAT(r.truck_type SEPARATOR '|') FROM client_rates r WHERE r.client_id=c.id) AS rate_types
                    FROM clients c WHERE c.status='Active' ORDER BY c.company_name"),
                'trucks' => fn() => many($p, "SELECT v.id, v.plate_number, v.truck_number, v.truck_type, v.status, v.assigned_driver_id, v.assigned_helper_id,
                    (SELECT t.trip_ref FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='vehicle' AND a.resource_id=v.id) AS on_trip
                    FROM vehicles v WHERE v.active=1 ORDER BY v.truck_type, v.plate_number"),
                'crew' => fn() => many($p, "SELECT pe.id, pe.full_name, pe.person_type, pe.availability, pe.license_expiry,
                    (SELECT t.trip_ref FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='person' AND a.resource_id=pe.id) AS on_trip
                    FROM personnel pe WHERE pe.active=1 ORDER BY pe.full_name"),
                'places' => fn() => array_column(many($p, "SELECT x FROM (SELECT pickup_point AS x FROM trips UNION SELECT delivery_point FROM trips) z WHERE x<>'' ORDER BY x LIMIT 500"), 'x'),
                'consignees' => fn() => array_column(many($p, "SELECT DISTINCT consignee FROM trips WHERE consignee IS NOT NULL ORDER BY consignee LIMIT 300"), 'consignee'),
            ]);
        }
        require_once __DIR__ . '/Inspections/Checklist.php';
        $data['checklist'] = Checklist::sections();
        $data['fundCategories'] = many($p, 'SELECT name, amount FROM fund_categories WHERE active=1 ORDER BY sort_order, name');
        $data['updateTypes'] = self::UPDATE_TYPES;
        $data['delayCauses'] = self::DELAY_CAUSES;
        $data['incidentTypes'] = self::INCIDENT_TYPES;
        $data['statuses'] = self::STATUSES;
        $data['fuelLevels'] = self::FUEL_LEVELS;
        $data['checklistMinMinutes'] = (int)Settings::value('inspection_min_minutes');
        $data['unitsPerTrip'] = Settings::value('units_per_trip');
        $data['filterOptions'] = readSections([
            'clients' => fn() => many($p, 'SELECT id, company_name FROM clients ORDER BY company_name'),
            'trucks' => fn() => many($p, 'SELECT id, plate_number FROM vehicles ORDER BY plate_number'),
            'drivers' => fn() => many($p, "SELECT id, full_name, person_type FROM personnel ORDER BY full_name"),
            'dispatchers' => fn() => many($p, "SELECT id, full_name FROM users WHERE role IN ('car_carrier_dispatcher','container_wingvan_dispatcher') ORDER BY full_name"),
        ]);
        $data['can'] = ['create' => self::canCreate($u), 'review' => hasRole($u, 'operations_head'),
                        'dispatch' => roleIsDispatcher($u['role']), 'manage' => hasRole($u, 'operations_head')];
        return $data;
    }

    private static function canCreate(array $u): bool { return hasRole($u, 'operations_head') || roleIsDispatcher($u['role']); }

    /** Dispatchers see the trips of their own truck types (and requests they encoded). */
    private static function scope(array $u): array {
        if (roleIsDispatcher($u['role'])) return [' AND (t.dispatcher_role=? OR t.created_by=?)', [$u['role'], $u['id']]];
        return ['', []];
    }

    private static function select(): string {
        return "SELECT t.*, c.company_name AS client, v.plate_number, v.truck_number, v.status AS truck_status,
                d1.full_name AS driver_name, d2.full_name AS driver2_name, hp.full_name AS helper_name,
                ds.full_name AS dispatcher_name, cr.full_name AS created_by_name,
                f.id AS fund_id, f.status AS fund_status, f.amount AS fund_amount, f.rejected_reason AS fund_rejected_reason,
                (SELECT ins.has_not_ok FROM inspections ins WHERE ins.trip_id=t.id AND ins.attempt_number=t.attempt_number AND ins.kind='Pre-Dispatch') AS checklist_not_ok,
                (SELECT ia.has_not_ok FROM inspections ia WHERE ia.trip_id=t.id AND ia.attempt_number=t.attempt_number AND ia.kind='Arrival') AS arrival_not_ok,
                EXISTS (SELECT 1 FROM trip_assignments aw WHERE aw.trip_id=t.id AND aw.resource_type='vehicle' AND t.status='Completed') AS awaiting_arrival,
                (SELECT COUNT(*) FROM trip_updates up WHERE up.trip_id=t.id AND up.update_type='Delay') AS delay_count,
                (SELECT i.status FROM incidents i WHERE i.trip_id=t.id ORDER BY i.id DESC LIMIT 1) AS incident_status,
                (SELECT i.severity FROM incidents i WHERE i.trip_id=t.id ORDER BY i.id DESC LIMIT 1) AS incident_severity,
                (SELECT COUNT(*) FROM documents dw WHERE dw.entity_type='trip' AND dw.entity_id=t.id AND dw.category='" . self::DOC_WAYBILL . "') AS waybill_docs,
                (SELECT COUNT(*) FROM documents da WHERE da.entity_type='trip' AND da.entity_id=t.id AND da.category='" . self::DOC_AR . "') AS ar_docs,
                (SELECT COUNT(*) FROM documents dr WHERE dr.entity_type='trip' AND dr.entity_id=t.id AND dr.category='" . self::DOC_DR . "') AS dr_docs,
                (SELECT COUNT(*) FROM documents dp WHERE dp.entity_type='trip' AND dp.entity_id=t.id AND dp.category='" . self::DOC_DIESEL_PO . "') AS diesel_po_docs,
                (SELECT COUNT(*) FROM documents ds WHERE ds.entity_type='trip' AND ds.entity_id=t.id AND ds.category='" . self::DOC_SUPPLIER_SOA . "') AS soa_docs,
                b.status AS billing_status, b.total_amount AS billing_amount
            FROM trips t
            JOIN clients c ON c.id=t.client_id
            LEFT JOIN vehicles v ON v.id=t.vehicle_id
            LEFT JOIN personnel d1 ON d1.id=t.driver_id
            LEFT JOIN personnel d2 ON d2.id=t.driver2_id
            LEFT JOIN personnel hp ON hp.id=t.helper_id
            LEFT JOIN users ds ON ds.id=t.dispatcher_id
            LEFT JOIN users cr ON cr.id=t.created_by
            LEFT JOIN fund_requests f ON f.trip_id=t.id AND f.attempt_number=t.attempt_number
            LEFT JOIN billings b ON b.trip_id=t.id";
    }

    /** Filters of the trip history (filter modal): text, status, type, client, truck, driver, dispatcher, dates. */
    public static function filters(array $q, string $a = 't'): array {
        $w = ''; $args = [];
        $from = trim((string)($q['from'] ?? '')); $to = trim((string)($q['to'] ?? ''));
        if ($from !== '' && DateTimeImmutable::createFromFormat('!Y-m-d', $from)) { $w .= " AND DATE($a.scheduled_at)>=?"; $args[] = $from; }
        if ($to !== '' && DateTimeImmutable::createFromFormat('!Y-m-d', $to)) { $w .= " AND DATE($a.scheduled_at)<=?"; $args[] = $to; }
        foreach (['client_id' => "$a.client_id", 'vehicle_id' => "$a.vehicle_id", 'dispatcher_id' => "$a.dispatcher_id"] as $k => $col) {
            if (!empty($q[$k]) && ctype_digit((string)$q[$k])) { $w .= " AND $col=?"; $args[] = (int)$q[$k]; }
        }
        if (!empty($q['person_id']) && ctype_digit((string)$q['person_id'])) {
            $w .= " AND ($a.driver_id=? OR $a.driver2_id=? OR $a.helper_id=?)"; $id = (int)$q['person_id']; array_push($args, $id, $id, $id);
        }
        if (!empty($q['status']) && in_array($q['status'], self::STATUSES, true)) { $w .= " AND $a.status=?"; $args[] = $q['status']; }
        if (!empty($q['truck_type']) && in_array($q['truck_type'], TRUCK_TYPES, true)) { $w .= " AND $a.truck_type=?"; $args[] = $q['truck_type']; }
        $text = trim((string)($q['q'] ?? ''));
        if ($text !== '') {
            $w .= " AND ($a.trip_ref LIKE ? OR $a.pickup_point LIKE ? OR $a.delivery_point LIKE ? OR $a.waybill_number LIKE ? OR $a.booking_reference LIKE ? OR $a.consignee LIKE ?)";
            $like = '%' . $text . '%'; array_push($args, $like, $like, $like, $like, $like, $like);
        }
        return [$w, $args];
    }

    // =================================================================
    // ACTIONS
    // =================================================================
    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'create' => self::create($u, $d),
            'review' => self::review($u, $d),
            'edit' => self::edit($u, $d),
            'auto_assign' => self::retryAssign($u, $d),
            'reassign' => self::reassign($u, $d),
            'crew_options' => self::crewOptions($u, $d),
            'diesel_po' => self::attachDieselPo($u, $d),
            'create_batch' => self::createBatch($u, $d),
            'checklist_start' => self::checklistStart($u, $d),
            'checklist' => self::checklist($u, $d),
            'dispatch' => self::dispatch($u, $d),
            'incident' => self::incident($u, $d),
            'resume' => self::resume($u, $d),
            'reschedule' => self::reschedule($u, $d),
            'complete' => self::complete($u, $d),
            'arrival' => self::arrival($u, $d),
            'cancel' => self::cancel($u, $d),
            'details' => self::details($u, $d),
            default => throw new BusinessRuleException('Unknown trip action.', 404),
        };
    }

    // ---------- helpers ----------
    private static function lockTrip(PDO $p, int $id): array {
        $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$id]);
        must((bool)$t, 'Trip not found.', 404);
        return $t;
    }
    /** Only dispatchers of the trip's truck type do dispatcher steps (Day and Night shifts share the trips). */
    private static function mustBeTripDispatcher(array $u, array $t): void {
        must(roleIsDispatcher($u['role']), 'Only the dispatcher can do this step.', 403);
        must($t['dispatcher_role'] === $u['role'], 'This trip belongs to the ' . (ROLE_LABELS[$t['dispatcher_role']] ?? 'other') . ' team.', 403);
    }
    private static function mustBeStatus(array $t, array $allowed, string $what): void {
        must(in_array($t['status'], $allowed, true), "Cannot $what: the trip is " . $t['status'] . ' (allowed only when ' . implode(' / ', $allowed) . ').', 409);
    }
    public static function event(PDO $p, ?int $uid, int $tripId, string $type, string $from, string $to, string $notes = '', array $before = [], array $after = []): void {
        $p->prepare('INSERT INTO trip_events (trip_id, actor_id, event_type, from_status, to_status, notes) VALUES (?,?,?,?,?,?)')
          ->execute([$tripId, $uid, $type, $from, $to, cut($notes, 500)]);
        $message = ($from !== $to ? "$from -> $to. " : '') . $notes;
        // Adjustment #5H-1: Trip status and safe delivery-field changes.
        // Status is a real transition. Preserve any supplied driver/truck edit details.
        if ($from !== $to) {
            $before = ['Trip status' => $from !== '' ? $from : null] + $before;
            $after = ['Trip status' => $to !== '' ? $to : null] + $after;
        }
        if ($after) auditWithChanges($p, $uid, 'Trips', 'trip ' . $tripId, $type, $message, $before, $after);
        else audit($p, $uid, 'Trips', 'trip ' . $tripId, $type, $message);
    }
    public static function setStatus(PDO $p, ?int $uid, array $t, string $to, string $type, string $notes = ''): void {
        run($p, 'UPDATE trips SET status=? WHERE id=?', [$to, $t['id']]);
        self::event($p, $uid, (int)$t['id'], $type, $t['status'], $to, $notes);
    }
    private static function hasRate(PDO $p, int $clientId, ?string $type): bool {
        return $type !== null && (bool)one($p, 'SELECT id FROM client_rates WHERE client_id=? AND truck_type=?', [$clientId, $type]);
    }

    /** Longest billable distance accepted (km). Luzon to Mindanao by road is well below this. */
    public const MAX_DISTANCE_KM = 3000;
    /** Philippine bounding box for map pins (keeps a mistyped or swapped coordinate out). */
    private const PH_LAT = [4.0, 21.5];
    private const PH_LNG = [116.0, 127.5];
    /** Set by deliveryFields() when an unchanged schedule is already in the past (shown with the result). */
    private static string $scheduleWarning = '';

    /**
     * Schedule rule (one place for create, review, edit and reschedule):
     *   - a NEW or CHANGED schedule must be the current date and time or later (Asia/Manila,
     *     5-minute grace) and at most 365 days ahead: futureDateTimeField() in bootstrap.php;
     *   - an UNCHANGED schedule of a trip that is not dispatched yet is kept even if its time
     *     has passed, so other details can still be corrected; a warning is returned instead.
     */
    private static function scheduleField(array $d, ?string $current): string {
        $typed = dateTimeField($d, 'scheduled_at');
        if ($current !== null && substr($typed, 0, 16) === substr($current, 0, 16)) {
            self::$scheduleWarning = strtotime($current) < time()
                ? ' Note: the schedule (' . substr($current, 0, 16) . ') has already passed; set a new date and time if the trip will leave later.' : '';
            return $current;
        }
        return futureDateTimeField($d, 'scheduled_at');
    }

    /**
     * CHECKLIST_38_40_TRIP_TIME_GATES_V1 — execution actions follow the trip's CURRENT schedule.
     *   Planning / approval (create, review, edit before dispatch, assignment, fund request and approval,
     *   reschedule, cancel) is allowed any time. Execution is time-gated (Philippine time, server clock):
     *     - pre-dispatch checklist (open and submit): from `checklist_lead_hours` before scheduled_at;
     *     - Confirm Dispatch / Redispatch: from `dispatch_early_minutes` before scheduled_at;
     *     - incident, resume, completion and arrival need a dispatched trip, so they are gated through dispatch;
     *     - fund release: Funds.php (Checklist #40 phase 1, `fund_release_lead_hours`).
     *   Hours are counted, not dates, so a 12:30 AM trip opens its checklist the evening before.
     *   A late dispatch (after scheduled_at) is allowed and noted in the trip history.
     */
    public static function timeGates(array $t, ?int $now = null): array {
        $now ??= time();
        $sched = strtotime((string)$t['scheduled_at']);
        must($sched !== false, 'Invalid trip schedule.', 409);
        $check = $sched - (int)round(Settings::value('checklist_lead_hours') * 3600);
        $disp = $sched - (int)round(Settings::value('dispatch_early_minutes') * 60);
        return ['scheduled_at' => date('Y-m-d H:i:s', $sched),
                'checklist_opens_at' => date('Y-m-d H:i:s', $check), 'checklist_allowed_now' => $now >= $check,
                'dispatch_opens_at' => date('Y-m-d H:i:s', $disp), 'dispatch_allowed_now' => $now >= $disp,
                'late_minutes' => $now > $sched ? intdiv($now - $sched, 60) : 0];
    }
    /** The current attempt's pre-dispatch checklist (null when there is none). */
    private static function currentChecklist(PDO $p, array $t): ?array {
        return one($p, "SELECT id, vehicle_id, completed_at FROM inspections WHERE trip_id=? AND attempt_number=? AND kind='Pre-Dispatch' AND completed_at IS NOT NULL",
            [$t['id'], $t['attempt_number']]) ?: null;
    }
    /**
     * Schedule-change revalidation (approved 2026-11-08). A completed checklist stays valid for a new schedule only if it
     * was completed inside that schedule's checklist window (completed_at >= new scheduled_at - checklist_lead_hours).
     * Earlier schedules and small moves inside the window keep it; a later move outside the window sends the trip back to
     * Pre-Assigned for a new checklist. Assignment, fund, route distance and booking details are not touched.
     * Uses the existing Admin window; no separate expiry duration.
     */
    private static function revalidateChecklistAfterScheduleChange(PDO $p, array $u, array $t, array $row): string {
        if ($t['status'] !== 'Ready for Dispatch' || !array_key_exists('scheduled_at', $row)) return '';
        if (strtotime((string)$row['scheduled_at']) === strtotime((string)$t['scheduled_at'])) return '';
        $new = $t; $new['scheduled_at'] = $row['scheduled_at'];
        $opens = self::timeGates($new)['checklist_opens_at'];
        $c = self::currentChecklist($p, $t);
        if ($c && strtotime((string)$c['completed_at']) >= strtotime($opens)) return '';
        $why = 'The pre-dispatch checklist must be done again: it was completed ' . ($c ? self::phTime((string)$c['completed_at']) : '(not found)')
             . ', before the checklist window for the new schedule (opens ' . self::phTime($opens) . ').';
        self::setStatus($p, $u['id'], $t, 'Pre-Assigned', 'pre-dispatch checklist reset after schedule change', $why);
        return ' ' . $why;
    }
    private static function phTime(string $dt): string { return date('M j, Y g:i A', strtotime($dt)) . ' Philippine time'; }
    /** Refuses the pre-dispatch checklist before its window (re-checked on submit: the schedule may have moved). */
    private static function mustBeChecklistWindow(array $t): void {
        $g = self::timeGates($t);
        must($g['checklist_allowed_now'], 'Too early for the pre-dispatch checklist. It opens ' . self::phTime($g['checklist_opens_at'])
            . ' (' . self::hoursText(Settings::value('checklist_lead_hours')) . ' before the scheduled dispatch, ' . self::phTime($g['scheduled_at']) . ').', 409);
    }
    private static function durationText(int $min): string { return $min >= 60 ? intdiv($min, 60) . ' h ' . ($min % 60) . ' min' : $min . ' min'; }
    private static function hoursText(float $h): string { return $h == 0.0 ? 'at the time' : rtrim(rtrim(number_format($h, 2, '.', ''), '0'), '.') . ' hour(s)'; }

    /** Pickup and delivery coordinates: both or neither for each point, inside the Philippines. */
    private static function coordinates(array $d): array {
        $out = [];
        foreach (['pickup' => 'pickup point', 'delivery' => 'delivery point'] as $k => $label) {
            $lat = trim((string)($d[$k . '_lat'] ?? '')); $lng = trim((string)($d[$k . '_lng'] ?? ''));
            if ($lat === '' && $lng === '') { $out[$k . '_lat'] = null; $out[$k . '_lng'] = null; continue; }
            must(is_numeric($lat) && is_numeric($lng), "The map pin of the $label is incomplete. Pin it again or remove it.");
            must((float)$lat >= self::PH_LAT[0] && (float)$lat <= self::PH_LAT[1] && (float)$lng >= self::PH_LNG[0] && (float)$lng <= self::PH_LNG[1],
                "The map pin of the $label is outside the Philippines. Pin it again.");
            $out[$k . '_lat'] = round((float)$lat, 7); $out[$k . '_lng'] = round((float)$lng, 7);
        }
        return $out;
    }

    /** Common delivery fields of the trip form. $currentSchedule = the saved schedule when editing. */
    private static function deliveryFields(array $d, bool $needsKm, ?string $currentSchedule = null): array {
        self::$scheduleWarning = '';
        $row = [
            'consignee' => ($c = optField($d, 'consignee', 120)) !== null ? strtoupper($c) : null,
            'pickup_point' => strtoupper(field($d, 'pickup_point', 200)),
            'delivery_point' => strtoupper(field($d, 'delivery_point', 200)),
            'scheduled_at' => self::scheduleField($d, $currentSchedule),
            'delivery_details' => optField($d, 'delivery_details', 500),
            'booking_reference' => optField($d, 'booking_reference', 150),
            'units_planned' => intField($d, 'units_planned', 1, false, 100),
            'container_number' => ($x = optField($d, 'container_number', 60)) !== null ? strtoupper($x) : null,
            'container_size' => optField($d, 'container_size', 20),
            'seal_number' => optField($d, 'seal_number', 60),
            'shipment_number' => optField($d, 'shipment_number', 60),
            'distance_km' => numberField($d, 'distance_km', $needsKm, self::MAX_DISTANCE_KM),
        ] + self::coordinates($d);
        must($row['pickup_point'] !== $row['delivery_point'], 'Pickup point and delivery point must be different.');
        if ($needsKm) must($row['distance_km'] > 0, 'Enter the billable distance in km (pickup point to delivery point).');
        return $row;
    }

    // ---------- road distance (Checklist #5 Phase 3) ----------
    /** Distance columns of a trip (the road line itself is kept in trip_routes). */
    private const DISTANCE_COLS = ['distance_source', 'route_option', 'distance_computed_km', 'distance_provider',
                                   'distance_computed_at', 'distance_override_reason', 'client_route_id'];

    /**
     * Distance of the trip form, decided by the SERVER (the km typed or filled in by the browser is
     * never trusted alone). Rules: backend/Core/RouteDistance.php (same as Client Routes).
     *   - approved client route chosen (client_route_id) -> km of that route; must be selectable for
     *     this client and truck type; its map pins are used
     *   - map pins + route option                          -> road distance computed again here
     *   - otherwise / map service unavailable             -> typed km (Manual)
     *   - km different from the reference km              -> reason required; warning above 15%
     * $current = the saved trip (review / edit): when nothing about the distance changed, the saved
     * distance is kept as is (no new map call; an approved route stays even if deactivated later).
     * Returns [$row, $geometry, $note]; $geometry = string (save), null (remove), false (keep).
     */
    private static function distanceColumns(array $u, array $d, array $row, int $clientId, ?string $truckType, ?array $current): array {
        $routeId = trim((string)($d['client_route_id'] ?? '')) === '' ? null : idField($d, 'client_route_id');
        $km = $row['distance_km'] !== null ? (float)$row['distance_km'] : null;
        if ($current !== null && self::distanceUnchanged($d, $row, $routeId, $current)) {
            foreach (self::DISTANCE_COLS as $c) $row[$c] = $current[$c];
            return [$row, false, ''];
        }
        if ($routeId !== null) {
            $res = RouteDistance::fromClientRoute(db(), $routeId, $clientId, $truckType, $d, $km);
            if ($res['points']) {
                [$row['pickup_lat'], $row['pickup_lng']] = $res['points'][0];
                [$row['delivery_lat'], $row['delivery_lng']] = $res['points'][1];
            }
        } else {
            $res = RouteDistance::resolve($u['id'], $d, $km, [$row['pickup_lat'], $row['pickup_lng']], [$row['delivery_lat'], $row['delivery_lng']]);
        }
        $geometry = $res['cols']['geometry'];
        unset($res['cols']['geometry']);
        $row = array_merge($row, $res['cols'], ['client_route_id' => $routeId, 'distance_km' => $res['km']]);
        return [$row, $geometry, $res['warning'] !== '' ? ' ' . $res['warning'] : ''];
    }

    /** True when the form did not change anything the distance depends on. */
    private static function distanceUnchanged(array $d, array $row, ?int $routeId, array $t): bool {
        $same = fn($a, $b) => ($a === null || $a === '') ? ($b === null || $b === '') : ($b !== null && $b !== '' && abs((float)$a - (float)$b) < 0.0000005);
        $opt = is_string($d['route_option'] ?? null) && trim($d['route_option']) !== '' ? trim($d['route_option']) : null;
        $reason = trim((string)($d['distance_override_reason'] ?? ''));
        $savedRoute = $t['client_route_id'] !== null ? (int)$t['client_route_id'] : null;
        $kmSame = ($row['distance_km'] === null && $t['distance_km'] === null)
            || ($row['distance_km'] !== null && $t['distance_km'] !== null && abs(round((float)$row['distance_km'], 2) - (float)$t['distance_km']) < 0.005);
        return $routeId === $savedRoute && ($routeId !== null || $opt === $t['route_option']) && $kmSame
            && $same($row['pickup_lat'], $t['pickup_lat']) && $same($row['pickup_lng'], $t['pickup_lng'])
            && $same($row['delivery_lat'], $t['delivery_lat']) && $same($row['delivery_lng'], $t['delivery_lng'])
            && ($reason === '' || $reason === (string)$t['distance_override_reason']);
    }

    /** Road line of a trip: string = save, null = remove, false = keep. */
    private static function saveGeometry(PDO $p, int $tripId, string|null|false $geometry): void {
        if ($geometry === false) return;
        if ($geometry === null) { run($p, 'DELETE FROM trip_routes WHERE trip_id=?', [$tripId]); return; }
        $p->prepare('INSERT INTO trip_routes (trip_id, geometry) VALUES (?,?) ON DUPLICATE KEY UPDATE geometry=VALUES(geometry)')->execute([$tripId, $geometry]);
    }

    /** Short text for the trip history, e.g. "18.52 km, Map (Recommended)". */
    private static function distanceNote(array $row): string {
        if ($row['distance_km'] === null) return 'no km yet';
        $opt = $row['route_option'] && isset(Routing::OPTIONS[$row['route_option']]) ? Routing::OPTIONS[$row['route_option']]['label'] : '';
        return number_format((float)$row['distance_km'], 2) . ' km, ' . $row['distance_source']
            . ($row['distance_computed_km'] !== null && in_array($row['distance_source'], ['Map (edited)', 'Client Route (edited)'], true) ? ' (reference ' . $row['distance_computed_km'] . ' km)' : '')
            . ($opt !== '' ? ', ' . $opt : '') . ($row['distance_provider'] && str_starts_with((string)$row['distance_provider'], 'Client route') ? ', ' . $row['distance_provider'] : '');
    }

    // ---------- create (Scenario A by Ops Head / Scenario B by dispatcher) ----------
    private static function create(array $u, array $d): array {
        must(self::canCreate($u), 'Only the Operations Head or a dispatcher can create a trip.', 403);
        $isOps = hasRole($u, 'operations_head');
        // km is checked AFTER the road distance (an approved route or the map may supply it).
        $row = self::deliveryFields($d, false);
        $row['client_id'] = idField($d, 'client_id');
        // One key per opened New Trip form: the same form sent twice creates the trip once.
        $key = trim((string)($d['request_key'] ?? ''));
        must($key === '' || (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $key), 'Invalid form key. Reload the page.');
        $row['request_key'] = $key === '' ? null : strtolower($key);
        $type = choiceField($d, 'truck_type', TRUCK_TYPES, $isOps);
        if (!$isOps && $type) must(dispatcherRoleFor($type) === $u['role'], 'This truck type is handled by the other dispatcher team.');
        $row['truck_type'] = $type;
        if ($type === 'Car Carrier' && !$row['units_planned']) $row['units_planned'] = (int)Settings::value('units_per_trip');
        // Road distance before the transaction (no lock is held while the map service answers).
        [$row, $geometry, $distNote] = self::distanceColumns($u, $d, $row, $row['client_id'], $type, null);
        if ($isOps) must($row['distance_km'] !== null && $row['distance_km'] > 0, 'Enter the billable distance in km (pickup point to delivery point).');
        return transaction(function (PDO $p) use ($u, $row, $isOps, $geometry, $distNote) {
            if ($row['request_key'] !== null && ($dup = one($p, 'SELECT id, trip_ref, created_by FROM trips WHERE request_key=?', [$row['request_key']]))) {
                must((int)$dup['created_by'] === $u['id'], 'Invalid form key. Reload the page.', 409);
                return ['trip_id' => (int)$dup['id'], 'trip_ref' => $dup['trip_ref'], 'duplicate' => true,
                        'message' => 'Trip ' . $dup['trip_ref'] . ' was already created from this form (sent twice). No second trip was made.'];
            }
            $c = one($p, 'SELECT company_name, status FROM clients WHERE id=?', [$row['client_id']]);
            must($c && $c['status'] === 'Active', 'Choose an Active client from the client masterlist (clients waiting for documents or rates cannot be used yet).');
            if ($row['truck_type']) must(self::hasRate($p, $row['client_id'], $row['truck_type']), $c['company_name'] . ' has no billing rate for ' . $row['truck_type'] . ' yet.');
            if ($row['client_route_id'] !== null) must((bool)RouteDistance::selectable($p, $row['client_id'], $row['truck_type'], $row['client_route_id']),
                'The chosen client route was just changed and can no longer be used. Reload the page.', 409);
            $row += ['trip_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'created_by' => $u['id'],
                     'intake_source' => $isOps ? 'Operations Head' : 'Dispatcher',
                     'dispatcher_role' => $row['truck_type'] ? dispatcherRoleFor($row['truck_type']) : $u['role'],
                     'status' => 'Pending Review'];
            $id = insert($p, 'trips', $row);
            $ref = refNumber('TRP', $id);
            run($p, 'UPDATE trips SET trip_ref=? WHERE id=?', [$ref, $id]);
            self::saveGeometry($p, $id, $geometry);
            self::event($p, $u['id'], $id, $isOps ? 'trip created by Operations Head (Scenario A)' : 'delivery request encoded by dispatcher (Scenario B)', '', 'Pending Review',
                'Distance: ' . self::distanceNote($row) . ($row['distance_override_reason'] ? '. Km changed by hand: ' . $row['distance_override_reason'] : ''));
            if ($isOps) {
                run($p, 'UPDATE trips SET approved_by=?, approved_at=NOW() WHERE id=?', [$u['id'], $id]);
                $res = self::approveAndAssign($p, $u, self::lockTrip($p, $id));
                return ['trip_id' => $id, 'trip_ref' => $ref, 'message' => "Trip $ref created. " . $res . self::$scheduleWarning . $distNote];
            }
            Notify::roles($p, ['operations_head'], 'Trip request', "New delivery request $ref from " . $u['full_name'] . ' is Pending Review.', 'trips', 'trip-review-' . $id);
            return ['trip_id' => $id, 'trip_ref' => $ref, 'message' => "Request $ref sent to the Operations Head (Pending Review)." . $distNote];
        });
    }

    /**
     * BATCH_TRIP_PLANNING_V1 — several trips entered in one planning session.
     *   Every row becomes its own trip through the SAME create() rules (client, rates, approved route, schedule,
     *   distance, Scenario A auto-assignment / Awaiting Resources for the Operations Head, Scenario B Pending Review
     *   for a dispatcher). No new approval rule, no new table.
     *   1) All rows are checked first without writing anything; if any row is wrong, nothing is created and every
     *      problem is listed by row number.
     *   2) Then the rows are created one by one (earliest schedule first, so earlier trips get resources first).
     *      Each row has its own form key (request_key), so sending the same batch again creates nothing new.
     *   Returns one result per row, in the order entered.
     */
    public const BATCH_MAX_ROWS = 20;
    private static function createBatch(array $u, array $d): array {
        must(self::canCreate($u), 'Only the Operations Head or a dispatcher can create a trip.', 403);
        $rows = $d['rows'] ?? null;
        must(is_array($rows) && array_is_list($rows) && $rows, 'Add at least one trip to the batch.');
        must(count($rows) <= self::BATCH_MAX_ROWS, 'A batch can have at most ' . self::BATCH_MAX_ROWS . ' trips. Split it into smaller batches.');
        $isOps = hasRole($u, 'operations_head');
        $p = db();
        $errors = []; $seenKeys = []; $seenTrips = []; $sched = [];
        foreach ($rows as $i => $row) {
            $n = $i + 1;
            try {
                must(is_array($row), 'Invalid trip entry.');
                $key = strtolower(trim((string)($row['request_key'] ?? '')));
                must((bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $key), 'Invalid form key. Reload the page.');
                must(!isset($seenKeys[$key]), 'Same form key as row ' . ($seenKeys[$key] ?? '') . '. Reload the page.');
                $seenKeys[$key] = $n;
                $prev = one($p, 'SELECT trip_ref, created_by FROM trips WHERE request_key=?', [$key]);
                must(!$prev || (int)$prev['created_by'] === $u['id'], 'Invalid form key. Reload the page.');
                if ($prev) { $sched[$i] = PHP_INT_MAX; continue; }   // already created by an earlier send: reported as duplicate below
                $f = self::deliveryFields($row, false);
                $client = idField($row, 'client_id');
                $type = choiceField($row, 'truck_type', TRUCK_TYPES, $isOps);
                if (!$isOps && $type) must(dispatcherRoleFor($type) === $u['role'], 'This truck type is handled by the other dispatcher team.');
                $c = one($p, 'SELECT company_name, status FROM clients WHERE id=?', [$client]);
                must($c && $c['status'] === 'Active', 'Choose an Active client.');
                if ($type) must(self::hasRate($p, $client, $type), $c['company_name'] . ' has no billing rate for ' . $type . ' yet.');
                $route = ($row['client_route_id'] ?? '') === '' || ($row['client_route_id'] ?? null) === null ? null : idField($row, 'client_route_id');
                if ($route !== null) must((bool)RouteDistance::selectable($p, $client, $type, $route), 'The chosen approved route cannot be used for this client and truck type.');
                $mapRoute = trim((string)($row['route_option'] ?? '')) !== '' && $f['pickup_lat'] !== null && $f['delivery_lat'] !== null;
                if ($isOps) must($route !== null || $mapRoute || ($f['distance_km'] !== null && $f['distance_km'] > 0), 'Enter the billable distance in km, or choose an approved route.');
                $sig = implode('|', [$client, $type, substr((string)$f['scheduled_at'], 0, 16), mb_strtolower(trim((string)$f['pickup_point'])), mb_strtolower(trim((string)$f['delivery_point'])), $route]);
                must(!isset($seenTrips[$sig]), 'Same client, truck type, schedule, pickup and delivery as row ' . ($seenTrips[$sig] ?? '') . '.');
                $seenTrips[$sig] = $n;
                $sched[$i] = strtotime((string)$f['scheduled_at']);
            } catch (BusinessRuleException $e) {
                $errors[] = "Row $n: " . $e->getMessage();
            }
        }
        must(!$errors, 'Nothing was created. Fix these rows: ' . implode(' ', $errors), 400);
        $order = array_keys($rows);
        usort($order, fn($a, $b) => [$sched[$a], $a] <=> [$sched[$b], $b]);   // earliest schedule first (stable)
        $results = [];
        foreach ($order as $i) {
            $row = $rows[$i];
            try {
                $r = self::create($u, $row);
                $t = one($p, 'SELECT t.trip_ref, t.status, v.plate_number FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=?', [$r['trip_id']]);
                $results[$i] = ['row' => $i + 1, 'result' => !empty($r['duplicate']) ? 'Already created' : 'Created', 'trip_id' => (int)$r['trip_id'],
                                'trip_ref' => $t['trip_ref'], 'trip_status' => $t['status'], 'truck' => $t['plate_number'], 'message' => $r['message']];
            } catch (PDOException $e) {
                // Same batch sent twice at the same moment: the other request inserted this form key first.
                $dup = ($e->errorInfo[1] ?? 0) === 1062 ? one($p, 'SELECT id, trip_ref, status FROM trips WHERE request_key=? AND created_by=?', [strtolower((string)$row['request_key']), $u['id']]) : null;
                if (!$dup) throw $e;
                $results[$i] = ['row' => $i + 1, 'result' => 'Already created', 'trip_id' => (int)$dup['id'], 'trip_ref' => $dup['trip_ref'], 'trip_status' => $dup['status'], 'truck' => null,
                                'message' => 'Trip ' . $dup['trip_ref'] . ' was already created from this row (sent twice). No second trip was made.'];
            } catch (BusinessRuleException $e) {
                $results[$i] = ['row' => $i + 1, 'result' => 'Not created', 'trip_id' => null, 'trip_ref' => null, 'trip_status' => null, 'truck' => null, 'message' => $e->getMessage()];
            }
        }
        ksort($results);
        $results = array_values($results);
        $count = fn(string $r) => count(array_filter($results, fn($x) => $x['result'] === $r));
        $summary = sprintf('%d created, %d already created, %d not created', $count('Created'), $count('Already created'), $count('Not created'));
        $waiting = count(array_filter($results, fn($x) => $x['trip_status'] === 'Awaiting Resources'));
        audit($p, $u['id'], 'Trips', 'trip batch', 'trip batch planned', count($rows) . ' row(s): ' . $summary . '. '
            . implode(', ', array_filter(array_map(fn($x) => $x['trip_ref'] ? $x['trip_ref'] . ' ' . $x['trip_status'] : null, $results))));
        return ['results' => $results, 'message' => 'Batch planning: ' . $summary . '.' . ($waiting ? " $waiting trip(s) are Awaiting Resources (no free truck or crew yet)." : '')];
    }

    // ---------- Ops Head reviews a dispatcher request (Scenario B step 3) ----------
    private static function review(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $id = idField($d, 'trip_id');
        $decision = choiceField($d, 'decision', ['approve', 'reject']);
        // Approve: the form and the road distance are checked BEFORE the transaction (no lock is
        // held while the map service answers); the status is checked again under the lock.
        $prepared = null;
        if ($decision === 'approve') {
            $pre = one(db(), 'SELECT * FROM trips WHERE id=?', [$id]);
            must((bool)$pre, 'Trip not found.', 404);
            self::mustBeStatus($pre, ['Pending Review'], 'review');
            $row = self::deliveryFields($d, false, (string)$pre['scheduled_at']);
            $row['truck_type'] = choiceField($d, 'truck_type', TRUCK_TYPES);
            $prepared = self::distanceColumns($u, $d, $row, (int)$pre['client_id'], $row['truck_type'], $pre);
            must($prepared[0]['distance_km'] !== null && $prepared[0]['distance_km'] > 0, 'Enter the billable distance in km (pickup point to delivery point).');
        }
        return transaction(function (PDO $p) use ($u, $d, $id, $decision, $prepared) {
            $t = self::lockTrip($p, $id);
            self::mustBeStatus($t, ['Pending Review'], 'review');
            if ($decision === 'reject') {
                $reason = field($d, 'reason', 300);
                run($p, 'UPDATE trips SET cancel_reason=? WHERE id=?', [$reason, $id]);
                self::setStatus($p, $u['id'], $t, 'Rejected', 'trip request rejected', $reason);
                Notify::resolve($p, 'trip-review-' . $id);
                Notify::user($p, (int)$t['created_by'], 'Trip request', $t['trip_ref'] . ' was rejected: ' . $reason, 'trips');
                return ['message' => 'Request rejected.'];
            }
            [$row, $geometry, $distNote] = $prepared;
            if ($row['truck_type'] === 'Car Carrier' && !$row['units_planned']) $row['units_planned'] = (int)Settings::value('units_per_trip');
            must(self::hasRate($p, (int)$t['client_id'], $row['truck_type']), 'This client has no billing rate for ' . $row['truck_type'] . ' yet.');
            $row['dispatcher_role'] = dispatcherRoleFor($row['truck_type']);
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE trips SET $cols, approved_by=?, approved_at=NOW() WHERE id=?", array_merge(array_values($row), [$u['id'], $id]));
            self::saveGeometry($p, $id, $geometry);
            Notify::resolve($p, 'trip-review-' . $id);
            self::event($p, $u['id'], $id, 'trip details confirmed by Operations Head', 'Pending Review', 'Pending Review', $row['truck_type'] . ', ' . self::distanceNote($row)
                . ($row['distance_override_reason'] ? '. Km changed by hand: ' . $row['distance_override_reason'] : ''));
            return ['message' => self::approveAndAssign($p, $u, self::lockTrip($p, $id)) . self::$scheduleWarning . $distNote];
        });
    }

    /** Ops Head edits details before dispatch; the dispatcher may fill in booking / container / units details. */
    private static function edit(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        // Operations Head: form and road distance checked BEFORE the transaction (no lock while the
        // map service answers); status checked again under the lock.
        $prepared = null;
        if (hasRole($u, 'operations_head')) {
            $pre = one(db(), 'SELECT * FROM trips WHERE id=?', [$id]);
            must((bool)$pre, 'Trip not found.', 404);
            must(!in_array($pre['status'], self::CLOSED, true), 'The trip is already closed.', 409);
            self::mustBeStatus($pre, ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], 'edit the delivery details');
            $prepared = self::distanceColumns($u, $d, self::deliveryFields($d, false, (string)$pre['scheduled_at']), (int)$pre['client_id'], $pre['truck_type'], $pre);
            must($prepared[0]['distance_km'] !== null && $prepared[0]['distance_km'] > 0, 'Enter the billable distance in km (pickup point to delivery point).');
        }
        return transaction(function (PDO $p) use ($u, $d, $id, $prepared) {
            $t = self::lockTrip($p, $id);
            // CHECKLIST_27_TRIP_DETAILS_LOCK_V1: booking and delivery fields are
            // immutable once a truck is dispatched. A rescheduled attempt gets a
            // new editable pre-dispatch phase; completion/incident/arrival use
            // their separate workflow actions and remain available.
            self::mustBeStatus($t, ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], 'edit the delivery / booking details');
            $geometry = false; $distNote = '';
            if (hasRole($u, 'operations_head')) {
                self::mustBeStatus($t, ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], 'edit the delivery details');
                [$row, $geometry, $distNote] = $prepared;
            } else {
                self::mustBeTripDispatcher($u, $t);
                $row = ['booking_reference' => optField($d, 'booking_reference', 150), 'units_planned' => intField($d, 'units_planned', 1, false, 100),
                        'container_number' => ($x = optField($d, 'container_number', 60)) !== null ? strtoupper($x) : null,
                        'container_size' => optField($d, 'container_size', 20), 'seal_number' => optField($d, 'seal_number', 60),
                        'shipment_number' => optField($d, 'shipment_number', 60), 'delivery_details' => optField($d, 'delivery_details', 500)];
            }
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE trips SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
            self::saveGeometry($p, $id, $geometry);
            // Audit only operational fields; omit free-text/identifiers that may contain private data.
            $labels = ['scheduled_at' => 'Scheduled at', 'pickup_point' => 'Pickup point',
                'delivery_point' => 'Delivery point', 'truck_type' => 'Truck type',
                'distance_km' => 'Distance (km)', 'units_planned' => 'Units planned',
                'distance_source' => 'Distance source', 'route_option' => 'Route option', 'client_route_id' => 'Client route'];
            $oldFields = []; $newFields = [];
            foreach ($labels as $key => $label) if (array_key_exists($key, $row)) {
                $oldFields[$label] = $t[$key] ?? null;
                $newFields[$label] = $row[$key];
            }
            self::event($p, $u['id'], $id, 'trip details updated', $t['status'], $t['status'], '', $oldFields, $newFields);
            $recheck = self::revalidateChecklistAfterScheduleChange($p, $u, $t, $row);
            return ['message' => 'Trip details updated.' . self::$scheduleWarning . $distNote . $recheck];
        });
    }

    /** After confirmation: automatic assignment of truck, driver and helper. Returns a message. */
    private static function approveAndAssign(PDO $p, array $u, array $t): string {
        $res = self::autoAssign($p, $t);
        if (!$res['ok']) {
            self::setStatus($p, $u['id'], $t, 'Awaiting Resources', 'trip confirmed; waiting for resources', $res['reason']);
            Notify::roles($p, ['operations_head', $t['dispatcher_role']], 'Waiting for resources', $t['trip_ref'] . ': ' . $res['reason'] . ' The system will assign automatically when resources are free.', 'trips');
            return 'No free resources yet (' . $res['reason'] . ') The trip is "Awaiting Resources" and will be assigned automatically when a truck and crew are free.';
        }
        self::applyAssignment($p, $u['id'], $t, $res, 'Auto');
        return 'System assigned truck ' . $res['plate'] . ' with its crew. Status: Pre-Assigned.';
    }

    /**
     * AUTOMATIC ASSIGNMENT (PDF #12: "Awtomatikong mag-aassign ang system ng available truck, driver, at helper").
     * Rule:
     *   Truck : active, same truck type, status Available, no open maintenance job, not held by another trip;
     *           fewest trips in the last 30 days first (fair rotation).
     *   Driver: the truck's regular driver when free; otherwise a free active driver (license not expired)
     *           with the fewest recent trips.
     *   Car Carrier: two different eligible drivers are required (DRIVER 1 / DRIVER 2); with fewer the trip waits (Awaiting Resources).
     *   Container / Wing Van: a helper is required (regular helper first).
     */
    private static function autoAssign(PDO $p, array $t): array {
        if (!$t['truck_type']) return ['ok' => false, 'reason' => 'Truck type is not set.'];
        $trucks = many($p, "SELECT v.*, (SELECT COUNT(*) FROM trips x WHERE x.vehicle_id=v.id AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)) AS recent
            FROM vehicles v WHERE v.active=1 AND v.truck_type=? AND v.status='Available'
              AND NOT EXISTS (SELECT 1 FROM trip_assignments a WHERE a.resource_type='vehicle' AND a.resource_id=v.id)
              AND NOT EXISTS (SELECT 1 FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1)
            ORDER BY recent, v.id FOR UPDATE", [$t['truck_type']]);
        if (!$trucks) return ['ok' => false, 'reason' => 'No ' . $t['truck_type'] . ' truck is available.'];
        // CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1: shift-aware crew. The trip's SCHEDULED shift decides (planning);
        // crew marked Absent for that shift are never picked; Not Yet Marked is allowed (future shifts cannot be marked).
        // Same-shift crew first. Warn mode only: if none is free, other-shift / no-shift crew as a flagged fallback.
        // All existing rules (active, Available, license, not held by another trip) still apply to every candidate.
        $sched = CrewAttendance::planningShift($t);
        $warn = CrewAttendance::mode() === CrewAttendance::MODE_WARN;
        $free = function (string $type) use ($p, $sched): array {
            return many($p, "SELECT pe.id, pe.full_name, pe.duty_shift, (SELECT COUNT(*) FROM trips x WHERE (x.driver_id=pe.id OR x.driver2_id=pe.id OR x.helper_id=pe.id) AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)) AS recent
                FROM personnel pe WHERE pe.active=1 AND pe.person_type=? AND pe.availability='Available'
                  AND (pe.person_type<>'Driver' OR pe.license_expiry IS NULL OR pe.license_expiry>=CURRENT_DATE())
                  AND NOT EXISTS (SELECT 1 FROM trip_assignments a WHERE a.resource_type='person' AND a.resource_id=pe.id)
                  AND NOT EXISTS (SELECT 1 FROM attendance_marks am WHERE am.personnel_id=pe.id AND am.duty_date=? AND am.duty_shift=? AND am.status='Absent')
                ORDER BY recent, pe.id FOR UPDATE", [$type, $sched['date'], $sched['shift']]);
        };
        $pool = function (string $type) use ($free, $sched, $warn): array {
            $rows = $free($type);
            $same = array_values(array_filter($rows, fn($r) => $r['duty_shift'] === $sched['shift']));
            $other = $warn ? array_values(array_filter($rows, fn($r) => $r['duty_shift'] !== $sched['shift'])) : [];
            return [array_map(fn($r) => (int)$r['id'], $same), array_map(fn($r) => (int)$r['id'], $other)];
        };
        $shiftWord = $sched['shift'] . '-shift';
        [$drivers, $fbDrivers] = $pool('Driver');
        if (!$drivers && !$fbDrivers) return ['ok' => false, 'reason' => $warn ? 'No driver is available.' : "No $shiftWord driver is available (Enforce mode; Absent crew are skipped)."];
        $usedFallback = [];
        if (!$drivers) { $drivers = $fbDrivers; $usedFallback['driver'] = true; }
        [$helpers, $fbHelpers] = $t['truck_type'] === 'Car Carrier' ? [[], []] : $pool('Helper');
        if ($t['truck_type'] !== 'Car Carrier' && !$helpers) {
            if (!$fbHelpers) return ['ok' => false, 'reason' => $warn ? 'No helper is available.' : "No $shiftWord helper is available (Enforce mode; Absent crew are skipped)."];
            $helpers = $fbHelpers; $usedFallback['helper'] = true;
        }
        // Prefer a truck whose regular driver (and helper) is free.
        usort($trucks, function ($a, $b) use ($drivers, $helpers) {
            $sa = (in_array((int)$a['assigned_driver_id'], $drivers, true) ? 2 : 0) + (in_array((int)$a['assigned_helper_id'], $helpers, true) ? 1 : 0);
            $sb = (in_array((int)$b['assigned_driver_id'], $drivers, true) ? 2 : 0) + (in_array((int)$b['assigned_helper_id'], $helpers, true) ? 1 : 0);
            return $sb <=> $sa ?: ((int)$a['recent'] <=> (int)$b['recent']) ?: ((int)$a['id'] <=> (int)$b['id']);
        });
        $v = $trucks[0];
        $driver = in_array((int)$v['assigned_driver_id'], $drivers, true) ? (int)$v['assigned_driver_id'] : $drivers[0];
        $driver2 = null; $helper = null;
        if ($t['truck_type'] === 'Car Carrier') {
            $others = array_values(array_filter($drivers, fn($x) => $x !== $driver));
            if (!$others && empty($usedFallback['driver'])) {   // Driver 2: same shift first, then (Warn) fallback
                $others = array_values(array_filter($fbDrivers, fn($x) => $x !== $driver));
                if ($others) $usedFallback['driver2'] = true;
            }
            $driver2 = $others[0] ?? null;
            // CHECKLIST_42_CREW_COMPLETENESS_V1: a Car Carrier assignment needs TWO different eligible drivers.
            // Nothing is held when only one is free (the caller leaves the trip Awaiting Resources).
            if (!$driver2) return ['ok' => false, 'reason' => $warn ? 'Car Carrier requires two available drivers.'
                : "Car Carrier requires two available $shiftWord drivers (Enforce mode; Absent crew are skipped)."];
        } else {
            $helper = in_array((int)$v['assigned_helper_id'], $helpers, true) ? (int)$v['assigned_helper_id'] : $helpers[0];
        }
        // Flag every picked person who is not on the trip's scheduled shift (Warn-mode fallback; never "verified").
        $fallback = [];
        foreach (['Driver' => $driver, 'Driver 2' => $driver2, 'Helper' => $helper] as $role => $pid) {
            if (!$pid) continue;
            $pe = one($p, 'SELECT full_name, duty_shift FROM personnel WHERE id=?', [$pid]);
            if ($pe['duty_shift'] !== $sched['shift']) $fallback[] = $pe['full_name'] . " ($role, " . ($pe['duty_shift'] ? $pe['duty_shift'] . ' shift' : 'no assigned shift') . ')';
        }
        $note = $fallback ? 'Shift fallback (Warn mode): no free ' . $shiftWord . ' crew for the ' . CrewAttendance::shiftText($sched) . ', so '
            . implode(', ', $fallback) . ' was assigned. Attendance is NOT verified; reassign ' . $shiftWord . ' crew before Confirm Dispatch if possible.' : '';
        return ['ok' => true, 'vehicle_id' => (int)$v['id'], 'plate' => $v['plate_number'], 'driver_id' => $driver, 'driver2_id' => $driver2, 'helper_id' => $helper,
                'shift_fallback_note' => $note];
    }

    private static function applyAssignment(PDO $p, ?int $uid, array $t, array $res, string $mode, ?string $keepStatus = null): void {
        $oldVehicle = $t['vehicle_id'] ? (int)$t['vehicle_id'] : null;
        FleetState::hold($p, (int)$t['id'], $res['vehicle_id'], ['driver' => $res['driver_id'], 'driver2' => $res['driver2_id'], 'helper' => $res['helper_id']]);
        $to = $keepStatus ?? 'Pre-Assigned';
        run($p, 'UPDATE trips SET vehicle_id=?, driver_id=?, driver2_id=?, helper_id=?, assignment_mode=?, status=? WHERE id=?',
            [$res['vehicle_id'], $res['driver_id'], $res['driver2_id'], $res['helper_id'], $mode, $to, $t['id']]);
        FleetState::reconcile($p, $res['vehicle_id'], $uid, 'Assigned to ' . $t['trip_ref']);
        if ($oldVehicle && $oldVehicle !== $res['vehicle_id']) FleetState::reconcile($p, $oldVehicle, $uid, 'Released from ' . $t['trip_ref']);
        $names = many($p, 'SELECT id, full_name FROM personnel WHERE id IN (?,?,?)', [$res['driver_id'], $res['driver2_id'] ?? 0, $res['helper_id'] ?? 0]);
        $nm = array_column($names, 'full_name', 'id');
        self::event($p, $uid, (int)$t['id'], $mode === 'Auto' ? 'system auto-assigned truck and crew' : 'truck and crew assigned manually', $t['status'], $to,
            'Truck ' . $res['plate'] . '; driver ' . ($nm[$res['driver_id']] ?? '') . ($res['driver2_id'] ? '; driver 2 ' . ($nm[$res['driver2_id']] ?? '') : '') . ($res['helper_id'] ? '; helper ' . ($nm[$res['helper_id']] ?? '') : '')
            . (!empty($res['shift_fallback_note']) ? '. ' . $res['shift_fallback_note'] : ''));
        if (!empty($res['shift_fallback_note'])) {
            audit($p, $uid, 'Trips', 'trip ' . $t['id'], 'crew shift fallback', $t['trip_ref'] . ': ' . $res['shift_fallback_note']);
            Notify::roles($p, ['operations_head'], 'Crew shift fallback', $t['trip_ref'] . ': ' . $res['shift_fallback_note'], 'trips', 'trip-shift-fallback-' . $t['id'] . '-' . $t['attempt_number'] . '-' . $res['driver_id'] . '-' . ($res['driver2_id'] ?? 0) . '-' . ($res['helper_id'] ?? 0));
        }
        if ($to === 'Pre-Assigned') Notify::roles($p, [$t['dispatcher_role']], 'Pre-assigned trip', $t['trip_ref'] . ' is pre-assigned to truck ' . $res['plate'] . '. Submit the fund request and do the pre-dispatch checklist.', 'trips', 'trip-prep-' . $t['id'] . '-' . $t['attempt_number']);
    }

    /**
     * Assigns trips that are "Awaiting Resources" (oldest schedule first) when
     * trucks or crew become free. Called after trip completion / cancellation,
     * repair completion and when a truck or person is set Available.
     */
    public static function assignWaiting(PDO $p, array $u): string {
        $done = [];
        foreach (many($p, "SELECT * FROM trips WHERE status='Awaiting Resources' ORDER BY scheduled_at, id FOR UPDATE") as $t) {
            $res = self::autoAssign($p, $t);
            if (!$res['ok']) continue;
            self::applyAssignment($p, null, $t, $res, 'Auto');
            $done[] = $t['trip_ref'] . ' -> ' . $res['plate'];
        }
        return $done ? 'Waiting trip(s) assigned automatically: ' . implode(', ', $done) . '.' : '';
    }

    /**
     * A truck or person of a not-yet-dispatched trip became unavailable
     * (set Unavailable, or the truck went Under Maintenance). The system
     * frees the trip and tries to assign other resources automatically.
     */
    public static function resourceLost(PDO $p, array $u, int $tripId, string $why): string {
        $t = self::lockTrip($p, $tripId);
        if (!in_array($t['status'], ['Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], true)) return '';
        $freed = FleetState::release($p, $tripId);
        run($p, 'UPDATE trips SET vehicle_id=NULL, driver_id=NULL, driver2_id=NULL, helper_id=NULL WHERE id=?', [$tripId]);
        if ($freed) FleetState::reconcile($p, $freed, $u['id'], 'Released from ' . $t['trip_ref']);
        self::event($p, $u['id'], $tripId, 'resources released', $t['status'], $t['status'], $why);
        $t = self::lockTrip($p, $tripId);
        $res = self::autoAssign($p, $t);
        $keep = $t['status'] === 'For Reschedule' ? 'For Reschedule' : null;
        if ($res['ok']) {
            self::applyAssignment($p, $u['id'], $t, $res, 'Auto', $keep);
            return 'Trip ' . $t['trip_ref'] . ' was re-assigned to ' . $res['plate'] . ($keep ? '' : ' (pre-dispatch checklist needed again)') . '.';
        }
        if (!$keep) self::setStatus($p, $u['id'], $t, 'Awaiting Resources', 'waiting for resources', $res['reason']);
        Notify::roles($p, ['operations_head', $t['dispatcher_role']], 'Trip needs resources', $t['trip_ref'] . ': ' . $why . '. ' . $res['reason'], 'trips');
        return 'Trip ' . $t['trip_ref'] . ' is waiting for resources (' . $res['reason'] . ').';
    }

    private static function retryAssign(array $u, array $d): array {
        must(hasRole($u, 'operations_head') || roleIsDispatcher($u['role']), 'Not allowed.', 403);
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $t = self::lockTrip($p, $id);
            if (roleIsDispatcher($u['role'])) self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Awaiting Resources'], 'auto-assign');
            $res = self::autoAssign($p, $t);
            must($res['ok'], ($res['reason'] ?? 'No resources.') . ' Try again later or assign manually.', 409);
            self::applyAssignment($p, $u['id'], $t, $res, 'Auto');
            return ['message' => 'Assigned to ' . $res['plate'] . '. Status: Pre-Assigned.'];
        });
    }

    /** Ops Head manual override (PDF #11: Ops Head approves truck and driver assignments). */
    /**
     * Crew choices for the Operations Head's manual assignment, labelled for the trip's planning shift:
     * shift, attendance, Absent / Shift mismatch / No shift, availability. The server rechecks everything on save.
     */
    private static function crewOptions(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $p = db();
        $t = one($p, 'SELECT * FROM trips WHERE id=?', [idField($d, 'trip_id')]);
        must((bool)$t, 'Trip not found.', 404);
        $plan = CrewAttendance::planningShift($t);
        $enforce = CrewAttendance::mode() === CrewAttendance::MODE_ENFORCE;
        $out = [];
        foreach (many($p, "SELECT id FROM personnel WHERE active=1 AND person_type IN ('Driver','Helper') ORDER BY person_type, full_name") as $r) {
            $id = (int)$r['id'];
            $c = CrewAttendance::assignmentCheck($p, $id, $plan);
            $block = FleetState::personBlocker($p, $id, (int)$t['id']);
            $current = in_array($id, array_map('intval', [$t['driver_id'], $t['driver2_id'], $t['helper_id']]), true);
            $labels = [];
            if ($c['absent']) $labels[] = 'Absent';
            if ($c['issue']) $labels[] = $c['issue'];
            if ($block) $labels[] = 'Not available';
            $out[] = ['id' => $id, 'name' => $c['name'], 'type' => $c['type'], 'duty_shift' => $c['duty_shift'], 'attendance' => $c['attendance'], 'current' => $current,
                      'labels' => $labels, 'blocker' => $block, 'allowed' => !$c['absent'] && !$block && (!$enforce || !$c['issue'])];
        }
        return ['mode' => CrewAttendance::modeName(), 'shift' => $plan['shift'], 'shift_text' => CrewAttendance::shiftText($plan), 'crew' => $out];
    }

    private static function reassign(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $id = idField($d, 'trip_id'); $vid = idField($d, 'vehicle_id'); $driver = idField($d, 'driver_id');
        $driver2 = optId($d, 'driver2_id'); $helper = optId($d, 'helper_id');
        $reason = field($d, 'reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $vid, $driver, $driver2, $helper, $reason) {
            $t = self::lockTrip($p, $id);
            self::mustBeStatus($t, ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], 'change the assignment');
            $ids = array_filter([$driver, $driver2, $helper]);
            must(count($ids) === count(array_unique($ids)), 'The same person was chosen twice.');
            $v = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$vid]);
            must($v && $v['truck_type'] === $t['truck_type'], 'Choose a ' . $t['truck_type'] . ' truck.');
            if ((int)$t['vehicle_id'] !== $vid) must(!($why = FleetState::truckBlocker($p, $vid, $id)), 'Truck not available: ' . ($why ?? '') . '.', 409);
            foreach ([[$driver, 'Driver'], [$driver2, 'Driver'], [$helper, 'Helper']] as [$pid, $type]) {
                if (!$pid) continue;
                must((bool)one($p, 'SELECT id FROM personnel WHERE id=? AND person_type=? FOR UPDATE', [$pid, $type]), "Choose a $type from the masterlist.");
                must(!($why = FleetState::personBlocker($p, $pid, $id)), 'Not available: ' . ($why ?? '') . '.', 409);
            }
            if ($t['truck_type'] !== 'Car Carrier') must((bool)$helper, 'A helper is required for ' . $t['truck_type'] . ' trips.');
            else {
                must(!$helper, 'Car carrier trips use Driver 1 and Driver 2 (no helper).');
                must((bool)$driver2, 'Car carrier trips need Driver 1 and Driver 2 (two different drivers).');   // CHECKLIST_42_CREW_COMPLETENESS_V1
            }
            // CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1: manual crew follow the same shift rules as auto-assignment.
            // Absent for the trip's planning shift: never. Other shift / no shift: Enforce refuses; Warn allows, flagged.
            $plan = CrewAttendance::planningShift($t);
            $fallback = [];
            foreach ([[$driver, 'Driver'], [$driver2, 'Driver 2'], [$helper, 'Helper']] as [$pid, $role]) {
                if (!$pid) continue;
                $c = CrewAttendance::assignmentCheck($p, $pid, $plan);
                must(!$c['absent'], $c['name'] . " ($role) is marked Absent for the " . CrewAttendance::shiftText($plan) . ' and cannot be assigned.', 409);
                if ($c['issue'] === null) continue;
                $what = $c['issue'] === 'No shift' ? 'has no assigned shift' : 'is on the ' . $c['duty_shift'] . ' shift';
                must(CrewAttendance::mode() === CrewAttendance::MODE_WARN, $c['name'] . " ($role) $what; this trip needs " . $plan['shift'] . '-shift crew (' . CrewAttendance::shiftText($plan) . '). Enforce mode does not allow other-shift or unassigned-shift crew.', 409);
                $fallback[] = $c['name'] . " ($role, " . ($c['duty_shift'] ? $c['duty_shift'] . ' shift' : 'no assigned shift') . ')';
            }
            $fallbackNote = $fallback ? 'Shift fallback (Warn mode, manual): ' . implode(', ', $fallback) . ' assigned outside the ' . CrewAttendance::shiftText($plan)
                . '. Attendance is NOT verified.' : '';
            $keep = $t['status'] === 'For Reschedule' ? 'For Reschedule' : null;
            $personName = static function (?int $personId) use ($p): ?string {
                return $personId ? (one($p, 'SELECT full_name FROM personnel WHERE id=?', [$personId])['full_name'] ?? null) : null;
            };
            $oldPlate = $t['vehicle_id'] ? (one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$t['vehicle_id']])['plate_number'] ?? null) : null;
            $beforeAssignment = ['Truck' => $oldPlate, 'Driver 1' => $personName($t['driver_id'] ? (int)$t['driver_id'] : null),
                'Driver 2' => $personName($t['driver2_id'] ? (int)$t['driver2_id'] : null), 'Helper' => $personName($t['helper_id'] ? (int)$t['helper_id'] : null)];
            $afterAssignment = ['Truck' => $v['plate_number'], 'Driver 1' => $personName($driver),
                'Driver 2' => $personName($driver2), 'Helper' => $personName($helper)];
            self::applyAssignment($p, $u['id'], $t, ['vehicle_id' => $vid, 'plate' => $v['plate_number'], 'driver_id' => $driver, 'driver2_id' => $driver2, 'helper_id' => $helper,
                'shift_fallback_note' => $fallbackNote], 'Manual', $keep);
            self::event($p, $u['id'], $id, 'assignment changed by Operations Head', $t['status'], $keep ?? 'Pre-Assigned', $reason, $beforeAssignment, $afterAssignment);
            return ['message' => 'Assignment updated.' . ($t['status'] === 'Ready for Dispatch' ? ' The pre-dispatch checklist must be done again for the new assignment.' : '') . ($fallbackNote !== '' ? ' Warning: ' . $fallbackNote : '')];
        });
    }

    // ---------- pre-dispatch checklist (PDF #12 step 7) ----------
    // ---------- checklist timer (PDF #11 G: minimum inspection duration) ----------
    /**
     * Called when the dispatcher OPENS a checklist. Records the start time once per trip attempt
     * and kind (opening it again does not restart the timer) and returns the time left.
     */
    private static function checklistStart(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $kind = choiceField($d, 'kind', ['Pre-Dispatch', 'Arrival']);
        return transaction(function (PDO $p) use ($u, $id, $kind) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            if ($kind === 'Pre-Dispatch') { self::mustBeStatus($t, ['Pre-Assigned'], 'do the pre-dispatch checklist'); self::mustBeChecklistWindow($t); }
            else must($t['status'] === 'Completed' && FleetState::awaitingArrival($p, $id), 'The arrival checklist is not pending for this trip.', 409);
            $p->prepare('INSERT IGNORE INTO checklist_starts (trip_id, attempt_number, kind, started_by) VALUES (?,?,?,?)')
              ->execute([$id, $t['attempt_number'], $kind, $u['id']]);
            return self::timerState($p, $t, $kind);
        });
    }

    /** Start time, minimum minutes and seconds left (computed with the database clock). */
    private static function timerState(PDO $p, array $t, string $kind): array {
        $min = (int)Settings::value('inspection_min_minutes');
        $s = one($p, 'SELECT started_at, TIMESTAMPDIFF(SECOND, started_at, NOW()) AS secs FROM checklist_starts WHERE trip_id=? AND attempt_number=? AND kind=?',
                 [$t['id'], $t['attempt_number'], $kind]);
        return ['started_at' => $s['started_at'] ?? null, 'min_minutes' => $min,
                'remaining_seconds' => $s ? max(0, $min * 60 - (int)$s['secs']) : $min * 60];
    }

    /** Refuses a checklist submitted before the minimum duration. Returns the start time. */
    private static function mustRespectTimer(PDO $p, array $t, string $kind): ?string {
        $st = self::timerState($p, $t, $kind);
        if ($st['min_minutes'] <= 0) return $st['started_at'];
        $label = $kind === 'Arrival' ? 'arrival checklist' : 'pre-dispatch checklist';
        must($st['started_at'] !== null, 'Open the ' . $label . ' first. The ' . $st['min_minutes'] . '-minute inspection timer starts when the checklist is opened.', 409);
        $left = (int)$st['remaining_seconds'];
        must($left <= 0, 'The ' . $label . ' must take at least ' . $st['min_minutes'] . ' minute(s) (started ' . substr((string)$st['started_at'], 11, 5)
            . '). You can submit in ' . intdiv($left, 60) . ' min ' . ($left % 60) . ' sec.', 409);
        return $st['started_at'];
    }

    private static function checklist(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        require_once __DIR__ . '/Inspections/Checklist.php';
        $check = Checklist::validate($d);
        $km = intField($d, 'odometer_km', 0, false, 9999999);
        $fuel = optField($d, 'fuel_level', 20);
        $remarks = optField($d, 'remarks', 500);
        return transaction(function (PDO $p) use ($u, $id, $check, $km, $fuel, $remarks) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Pre-Assigned'], 'do the pre-dispatch checklist');
            self::mustBeChecklistWindow($t);
            $v = one($p, 'SELECT status, plate_number FROM vehicles WHERE id=?', [$t['vehicle_id']]);
            must($v && $v['status'] === 'Assigned', 'The assigned truck is ' . ($v['status'] ?? 'missing') . '.', 409);
            $started = self::mustRespectTimer($p, $t, 'Pre-Dispatch');
            $p->prepare("INSERT INTO inspections (trip_id, vehicle_id, attempt_number, kind, items_json, has_not_ok, odometer_km, fuel_level, remarks, actor_id, started_at, completed_at)
                         VALUES (?,?,?,'Pre-Dispatch',?,?,?,?,?,?,?,NOW())
                         ON DUPLICATE KEY UPDATE vehicle_id=VALUES(vehicle_id), items_json=VALUES(items_json), has_not_ok=VALUES(has_not_ok), odometer_km=VALUES(odometer_km),
                           fuel_level=VALUES(fuel_level), remarks=VALUES(remarks), actor_id=VALUES(actor_id), started_at=VALUES(started_at), completed_at=NOW()")
              ->execute([$id, $t['vehicle_id'], $t['attempt_number'], json_encode($check, JSON_UNESCAPED_UNICODE), $check['has_not_ok'] ? 1 : 0, $km, $fuel, $remarks, $u['id'], $started]);
            if ($check['has_not_ok']) {
                $bad = []; foreach (Checklist::sections() as $s) foreach ($s['items'] as $i => $label) { $k = $s['key'] . '_' . str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT); if ($check['items'][$k]['condition'] === 'NOT OK') $bad[] = $label; }
                self::event($p, $u['id'], $id, 'pre-dispatch checklist has NOT OK items', $t['status'], $t['status'], implode(', ', $bad), [],
                    ['Inspection result' => 'NOT OK', 'NOT OK item count' => count($bad)]);
                Notify::roles($p, ['motorpool'], 'Checklist finding', $t['trip_ref'] . ' / ' . $v['plate_number'] . ' NOT OK: ' . implode(', ', array_slice($bad, 0, 6)), 'maintenance');
                return ['warning' => 'Checklist saved with NOT OK items (' . implode(', ', array_slice($bad, 0, 5)) . '). The trip cannot be Ready for Dispatch until every item is OK. Fix the items and submit the checklist again.'];
            }
            run($p, 'UPDATE trips SET status=? WHERE id=?', ['Ready for Dispatch', $id]);
            self::event($p, $u['id'], $id, 'pre-dispatch checklist completed', $t['status'], 'Ready for Dispatch',
                'All items OK' . ($km ? "; odometer $km" : ''), [], ['Inspection result' => 'All OK']);
            $fund = one($p, 'SELECT status FROM fund_requests WHERE trip_id=? AND attempt_number=?', [$id, $t['attempt_number']]);
            $msg = 'Trip is Ready for Dispatch.';
            if ($fund && $fund['status'] === 'Released') $msg .= ' Fund is Released, so Confirm Dispatch is now enabled.';
            elseif ($fund) $msg .= ' Confirm Dispatch is enabled once the fund is Released (now: ' . $fund['status'] . ').';
            elseif ((int)$t['attempt_number'] === 1) $msg .= ' Submit the fund request; Confirm Dispatch needs a Released fund.';
            else $msg .= ' Confirm Redispatch is now enabled.';
            return ['message' => $msg];
        });
    }

    /**
     * AUTOMATIC DISPATCH VALIDATION (PDF #12 step 8): both must be true
     *   a. Fund Status: Released   b. Trip Status: Ready for Dispatch
     * Redispatch (Second Attempt): a new fund request is optional ("kung applicable");
     * when one exists it must be Released.
     */
    public static function dispatchBlockers(PDO $p, array $t, bool $lock = false): array {
        $why = [];
        if ($t['status'] !== 'Ready for Dispatch') $why[] = 'Trip status is ' . $t['status'] . ' (needs Ready for Dispatch).';
        else {
            // Not status-only: the checklist must exist for the CURRENT attempt and the CURRENTLY assigned truck.
            $c = self::currentChecklist($p, $t);
            if (!$c) $why[] = 'No pre-dispatch checklist for attempt #' . $t['attempt_number'] . ' (the Operations Head must reassign or reschedule so the checklist can be done again).';
            elseif ((int)$c['vehicle_id'] !== (int)$t['vehicle_id']) $why[] = 'The pre-dispatch checklist was done for another truck (the Operations Head must reassign so the checklist can be done for the assigned truck).';
        }
        $fund = one($p, 'SELECT status FROM fund_requests WHERE trip_id=? AND attempt_number=?', [$t['id'], $t['attempt_number']]);
        if ($fund && $fund['status'] !== 'Released') $why[] = 'Fund status is ' . $fund['status'] . ' (needs Released).';
        if (!$fund && (int)$t['attempt_number'] === 1) $why[] = 'No fund request yet (needs a Released fund).';
        $g = self::timeGates($t);
        if (!$g['dispatch_allowed_now']) $why[] = 'Scheduled dispatch is ' . self::phTime($g['scheduled_at']) . '; Confirm Dispatch opens ' . self::phTime($g['dispatch_opens_at']) . '.';
        // CHECKLIST_42_CREW_COMPLETENESS_V1 (both modes): Car Carrier = 2 different drivers; others = driver + helper.
        foreach (CrewAttendance::crewCompleteness($p, $t) as $c) $why[] = $c;
        // CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1 (Enforce): attendance for the ACTUAL dispatch time (now), every crew
        // member Present on their own shift, and the existing availability rules (Present never bypasses them).
        if (CrewAttendance::mode() === CrewAttendance::MODE_ENFORCE) {
            foreach (CrewAttendance::dispatchFindings($p, $t, null, $lock)['crew'] as $c) {
                if ($c['problem']) $why[] = $c['problem'];
                elseif ($block = FleetState::personBlocker($p, $c['id'], (int)$t['id'])) $why[] = 'Crew not available: ' . $block . '.';
            }
        }
        return $why;
    }

    private static function dispatch(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            $why = self::dispatchBlockers($p, $t, true);
            must(!$why, 'Confirm Dispatch is not enabled yet. ' . implode(' ', $why), 409);
            // Warn mode: dispatch goes ahead; unconfirmed attendance is recorded with the dispatch (never "verified").
            $attNote = '';
            if (CrewAttendance::mode() === CrewAttendance::MODE_WARN) {
                $att = CrewAttendance::dispatchFindings($p, $t, null, true);
                $issues = array_values(array_filter(array_column($att['crew'], 'problem')));
                if ($issues) $attNote = 'Attendance not confirmed (Warn mode): ' . implode(' ', $issues);
            }
            $v = one($p, 'SELECT status, plate_number FROM vehicles WHERE id=? FOR UPDATE', [$t['vehicle_id']]);
            must($v && $v['status'] === 'Assigned', 'The truck is ' . ($v['status'] ?? 'missing') . '.', 409);
            $redispatch = (int)$t['attempt_number'] > 1;
            $late = self::timeGates($t)['late_minutes'];
            $lateNote = $late > 0 ? 'Dispatched ' . self::durationText($late) . ' after the scheduled time (' . substr((string)$t['scheduled_at'], 0, 16) . ').' : '';
            run($p, "UPDATE trips SET status='Dispatched', dispatched_at=NOW(), dispatcher_id=? WHERE id=?", [$u['id'], $id]);
            self::event($p, $u['id'], $id, $redispatch ? 'redispatch confirmed (Second Attempt)' : 'dispatch confirmed', $t['status'], 'Dispatched',
                trim(($redispatch ? 'Attempt #' . $t['attempt_number'] . ', linked to the original trip and incident report. ' : '') . $lateNote . ($attNote !== '' ? ' ' . $attNote : '')));
            FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Dispatched ' . $t['trip_ref']);
            BillingDraft::createFor($p, $t);
            Notify::resolve($p, 'trip-prep-' . $id . '-*');
            Notify::roles($p, ['operations_head', 'finance', 'billing'], $redispatch ? 'Trip redispatched' : 'Trip dispatched', $t['trip_ref'] . ' left with truck ' . $v['plate_number'] . '.', 'trips');
            return ['message' => ($redispatch ? 'Redispatch confirmed (Second Attempt).' : 'Dispatch confirmed.') . ' The billing draft was generated.' . ($lateNote !== '' ? ' Note: ' . $lateNote : '') . ($attNote !== '' ? ' ' . $attNote : '')];
        });
    }

    /** INCIDENT REPORT (PDF #12 Scenario C steps 1-2; Incident Report Form of PDF #13). */
    private static function incident(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $row = ['incident_type' => choiceField($d, 'incident_type', self::INCIDENT_TYPES),
                'incident_at' => dateTimeField($d, 'incident_at'),
                'location' => field($d, 'location', 200),
                'persons_involved' => optField($d, 'persons_involved', 255),
                'reason' => optField($d, 'reason', 255),
                'problem' => field($d, 'problem', 255),
                'details' => field($d, 'details', 2000)];
        must(strtotime($row['incident_at']) <= time() + 300, 'The incident date and time cannot be in the future.');
        return transaction(function (PDO $p) use ($u, $id, $row) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Dispatched', 'In Transit'], 'report an incident');
            must(strtotime($row['incident_at']) >= strtotime((string)$t['dispatched_at']) - 60, 'The incident time is before the dispatch time.');
            $iid = insert($p, 'incidents', ['incident_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'trip_id' => $id, 'vehicle_id' => $t['vehicle_id'],
                'attempt_number' => $t['attempt_number'], 'status' => 'Reported', 'reported_by' => $u['id']] + $row);
            $iref = refNumber('INC', $iid);
            run($p, 'UPDATE incidents SET incident_ref=? WHERE id=?', [$iref, $iid]);
            Files::store($p, $u, 'photos', 'incident', $iid, 'Incident Photo');
            Files::store($p, $u, 'attachments', 'incident', $iid, 'Incident Document');
            // Appears at once in the Maintenance module (PDF #12: "magrereflect sa Maintenance Module").
            $jid = insert($p, 'maintenance_jobs', ['job_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $t['vehicle_id'], 'source' => 'Incident',
                'incident_id' => $iid, 'trip_id' => $id, 'problem' => cut($row['problem'] . ' @ ' . $row['location'], 500), 'status' => 'Reported',
                'reported_on' => substr($row['incident_at'], 0, 10), 'priority' => 'High', 'created_by' => $u['id']]);
            run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, details, actor_id) VALUES (?,?,?,?,?)', [$jid, null, 'Reported', 'from incident ' . $iref, $u['id']]);
            run($p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [refNumber('JOB', $jid), $jid]);
            self::setStatus($p, $u['id'], $t, 'On Hold - Incident Reported', 'incident reported', $iref . ': ' . $row['problem'] . ' @ ' . $row['location']);
            $plate = one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$t['vehicle_id']])['plate_number'];
            Notify::roles($p, ['motorpool'], 'Incident reported', "$iref on $plate (" . $t['trip_ref'] . '): ' . $row['problem'] . ' @ ' . $row['location'] . '. Please assess (Minor or Major).', 'maintenance', 'incident-assess-' . $iid);
            Notify::roles($p, ['operations_head'], 'Incident reported', "$iref on $plate (" . $t['trip_ref'] . '). Trip is On Hold.', 'trips');
            return ['incident_id' => $iid, 'message' => "Incident $iref reported. The trip is On Hold while Maintenance assesses the damage."];
        });
    }

    /** Scenario C.1 step 7: Resume Trip after a minor repair (In Transit, NOT a second attempt). */
    private static function resume(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['On Hold - Incident Reported'], 'resume the trip');
            $inc = one($p, 'SELECT * FROM incidents WHERE trip_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [$id]);
            must($inc && $inc['status'] === 'Repaired - Cleared to Continue', 'Wait for Maintenance to confirm the repair (Repaired - Cleared to Continue).', 409);
            run($p, "UPDATE incidents SET status='Resolved', resolved_at=NOW() WHERE id=?", [$inc['id']]);
            self::setStatus($p, $u['id'], $t, 'In Transit', 'trip resumed after minor repair', 'Continuation of the original trip (not a second attempt).');
            FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Resumed ' . $t['trip_ref']);
            Notify::roles($p, ['operations_head'], 'Trip resumed', $t['trip_ref'] . ' resumed after a minor repair.', 'trips');
            Notify::resolve($p, 'trip-resume-' . $inc['id']);
            return ['message' => 'Trip resumed. Status: In Transit.'];
        });
    }

    /**
     * Scenario C.2 step 7: Reschedule Trip after the major repair (or with another truck).
     * New schedule, pre-dispatch checklist again (fund request if applicable);
     * Confirm Redispatch records the Second Attempt.
     */
    private static function reschedule(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $when = futureDateTimeField($d, 'scheduled_at');
        return transaction(function (PDO $p) use ($u, $id, $when) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['For Reschedule'], 'reschedule');
            if (!$t['vehicle_id']) {
                $res = self::autoAssign($p, $t);
                must($res['ok'], 'No truck/crew assigned and none available: ' . ($res['reason'] ?? '') . ' Ask the Operations Head to assign.', 409);
                self::applyAssignment($p, $u['id'], $t, $res, 'Auto', 'For Reschedule');
                $t = self::lockTrip($p, $id);
            }
            $v = one($p, 'SELECT status, plate_number FROM vehicles WHERE id=? FOR UPDATE', [$t['vehicle_id']]);
            must($v && $v['status'] === 'Assigned', 'Truck ' . ($v['plate_number'] ?? '') . ' is still ' . ($v['status'] ?? 'missing') . '. Maintenance must confirm the repair first, or the Operations Head can assign another truck.', 409);
            $next = (int)$t['attempt_number'] + 1;
            run($p, "UPDATE trips SET attempt_number=?, status='Pre-Assigned', scheduled_at=? WHERE id=?", [$next, $when, $id]);
            self::event($p, $u['id'], $id, 'trip rescheduled', 'For Reschedule', 'Pre-Assigned', 'Attempt #' . $next . ' on ' . $when . ' with truck ' . $v['plate_number'] . '. Pre-dispatch checklist again; Confirm Redispatch records the Second Attempt.');
            Notify::roles($p, ['operations_head'], 'Trip rescheduled', $t['trip_ref'] . ' rescheduled to ' . $when . '.', 'trips');
            foreach (many($p, 'SELECT id FROM incidents WHERE trip_id=?', [$id]) as $ii) Notify::resolve($p, 'trip-reschedule-' . $ii['id']);
            return ['message' => 'Trip rescheduled (attempt #' . $next . '). Do the pre-dispatch checklist again, then Confirm Redispatch.'];
        });
    }

    /**
     * CHECKLIST_44_DIESEL_PO_SOA_ATTACHMENTS_V1: the trip's dispatcher attaches the Diesel PO (PDF or photo) from Trip
     * Details. Stored with the secure document system (type / size checked, private storage, audit) and linked to the
     * trip; visible in Trip Details and Documents (Finance can view and download trip documents). Attachment only.
     */
    private static function attachDieselPo(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, self::DIESEL_PO_STATUSES, 'attach the Diesel PO');
            $ids = Files::store($p, $u, 'diesel_po', 'trip', $id, self::DOC_DIESEL_PO, true, 'the Diesel PO file');
            self::event($p, $u['id'], $id, 'diesel PO attached', $t['status'], $t['status'], count($ids) . ' file(s)');
            return ['message' => 'Diesel PO attached to ' . $t['trip_ref'] . ' (' . count($ids) . ' file(s)).'];
        });
    }

    /**
     * TRIP COMPLETION (PDF #12 step 11): completion date/time + required supporting
     * documents (waybill, acknowledgement receipt and delivery receipt). The system refuses
     * completion while anything is missing and says what is missing.
     */
    private static function complete(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $when = dateTimeField($d, 'completed_at');
        $waybill = strtoupper(field($d, 'waybill_number', 100));
        $units = intField($d, 'units_delivered', 0, false, 100);
        $notes = optField($d, 'delivery_notes', 500);
        return transaction(function (PDO $p) use ($u, $id, $when, $waybill, $units, $notes) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Dispatched', 'In Transit'], 'complete the trip');
            must(strtotime($when) <= time() + 300, 'The completion date and time cannot be in the future.');
            must(strtotime($when) >= strtotime(substr((string)$t['dispatched_at'], 0, 16)), 'The completion time is before the dispatch time (' . substr((string)$t['dispatched_at'], 0, 16) . ').');
            if ($t['truck_type'] === 'Car Carrier') must($units !== null && $units > 0, 'Enter the number of units delivered.');
            Files::store($p, $u, 'waybill', 'trip', $id, self::DOC_WAYBILL);
            Files::store($p, $u, 'ack_receipt', 'trip', $id, self::DOC_AR);
            Files::store($p, $u, 'delivery_receipt', 'trip', $id, self::DOC_DR);
            Files::store($p, $u, 'other', 'trip', $id, 'Other Trip Document');
            $soa = Files::store($p, $u, 'supplier_soa', 'trip', $id, self::DOC_SUPPLIER_SOA);   // optional (#44)
            $missing = [];
            if (!Files::count($p, 'trip', $id, self::DOC_WAYBILL)) $missing[] = 'waybill file';
            if (!Files::count($p, 'trip', $id, self::DOC_AR)) $missing[] = 'acknowledgement receipt file';
            if (!Files::count($p, 'trip', $id, self::DOC_DR)) $missing[] = 'delivery receipt (DR) file';
            must(!$missing, 'Trip cannot be completed yet. Missing: ' . implode(', ', $missing) . '.', 422);
            run($p, "UPDATE trips SET status='Completed', completed_at=?, waybill_number=?, units_delivered=?, delivery_notes=? WHERE id=?",
                [$when, $waybill, $units, $notes, $id]);
            self::event($p, $u['id'], $id, 'trip completed', $t['status'], 'Completed', 'Completed ' . $when . '; waybill ' . $waybill . ($soa ? '; supplier SOA attached (' . count($soa) . ')' : ''));
            // Crew is free now; the truck stays held (On Trip) until the arrival checklist.
            FleetState::releaseCrew($p, $id);
            FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Trip ' . $t['trip_ref'] . ' completed, truck returning');
            BillingDraft::forBilling($p, $id);
            Notify::roles($p, ['billing'], 'For billing', $t['trip_ref'] . ' is completed. Verify the documents and finalize the billing.', 'billing', 'billing-verify-' . $id);
            Notify::roles($p, ['operations_head'], 'Trip completed', $t['trip_ref'] . ' completed. The truck is returning (arrival checklist pending).', 'trips');
            Notify::roles($p, [$t['dispatcher_role']], 'Arrival checklist', $t['trip_ref'] . ': do the arrival checklist when the truck is back.', 'trips', 'trip-arrival-' . $id);
            $auto = self::assignWaiting($p, $u);
            return ['message' => 'Trip completed. The billing record moved to For Billing. The driver and helper are free; the truck stays On Trip until you submit the arrival checklist.' . ($auto ? ' ' . $auto : '')];
        });
    }

    /**
     * ARRIVAL CHECKLIST (PDF #11 section G; PDF #11 Car Carrier "Complete the arrival checklist").
     * Done by the trip's dispatcher when the truck is back after a Completed trip.
     * Same 57 items as the pre-dispatch checklist so the condition before departure and
     * upon arrival can be compared item by item.
     *   All OK  -> the truck is released and becomes Available.
     *   NOT OK  -> photos and a description are required; a corrective maintenance record is
     *              opened (or the findings are added to the truck's open record) and the
     *              truck becomes Under Maintenance.
     */
    private static function arrival(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        require_once __DIR__ . '/Inspections/Checklist.php';
        $check = Checklist::validate($d);
        $km = intField($d, 'odometer_km', 0, false, 9999999);
        $fuel = choiceField($d, 'fuel_level', self::FUEL_LEVELS);
        $remarks = optField($d, 'remarks', 500);
        $damage = optField($d, 'damage_notes', 1000);
        if ($check['has_not_ok']) must($damage !== null, 'Describe the damage, defects or missing equipment of the NOT OK items.');
        return transaction(function (PDO $p) use ($u, $id, $check, $km, $fuel, $remarks, $damage) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Completed'], 'do the arrival checklist');
            must(FleetState::awaitingArrival($p, $id), 'The arrival checklist of ' . $t['trip_ref'] . ' is already done.', 409);
            $started = self::mustRespectTimer($p, $t, 'Arrival');
            $vid = (int)$t['vehicle_id'];
            $plate = one($p, 'SELECT plate_number FROM vehicles WHERE id=? FOR UPDATE', [$vid])['plate_number'];

            // Compare with the pre-dispatch checklist of the same attempt.
            $pre = one($p, "SELECT items_json, odometer_km, fuel_level FROM inspections WHERE trip_id=? AND attempt_number=? AND kind='Pre-Dispatch'", [$id, $t['attempt_number']]);
            if ($km && $pre && $pre['odometer_km']) must($km >= (int)$pre['odometer_km'], 'The arrival odometer (' . $km . ' km) is lower than at departure (' . $pre['odometer_km'] . ' km).');
            $before = $pre ? (json_decode((string)$pre['items_json'], true)['items'] ?? []) : [];
            $bad = []; $changed = [];
            foreach (Checklist::sections() as $s) foreach ($s['items'] as $i => $label) {
                $k = $s['key'] . '_' . str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT);
                if ($check['items'][$k]['condition'] !== 'NOT OK') continue;
                $bad[] = $label . ($check['items'][$k]['remarks'] !== '' ? ' (' . $check['items'][$k]['remarks'] . ')' : '');
                if (($before[$k]['condition'] ?? null) === 'OK') $changed[] = $label;
            }
            Files::store($p, $u, 'photos', 'trip', $id, self::DOC_ARRIVAL_PHOTO, (bool)$bad, 'photos of the NOT OK items (damage, defects or missing equipment)');

            $jobId = null; $jobRef = null;
            if ($bad) {
                $problem = cut('Arrival checklist ' . $t['trip_ref'] . ' - NOT OK: ' . implode('; ', $bad) . '. ' . $damage, 500);
                $open = FleetState::openJob($p, $vid);
                if ($open) {
                    // One open record per truck: add the findings to it.
                    $jobId = (int)$open['id']; $jobRef = $open['job_ref'];
                    run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, details, actor_id) VALUES (?,?,?,?,?)',
                        [$jobId, $open['status'], $open['status'], cut('Arrival checklist findings: ' . $problem, 500), $u['id']]);
                } else {
                    $jobId = insert($p, 'maintenance_jobs', ['job_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $vid, 'source' => 'On-Premise',
                        'trip_id' => $id, 'problem' => $problem, 'reported_on' => date('Y-m-d'), 'priority' => 'Normal', 'status' => 'Reported',
                        'remarks' => cut('From the arrival checklist of ' . $t['trip_ref'], 500), 'created_by' => $u['id']]);
                    $jobRef = refNumber('CM', $jobId);
                    run($p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [$jobRef, $jobId]);
                    run($p, 'INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, details, actor_id) VALUES (?,?,?,?,?)',
                        [$jobId, null, 'Reported', cut('from the arrival checklist of ' . $t['trip_ref'], 500), $u['id']]);
                }
            }
            $p->prepare("INSERT INTO inspections (trip_id, vehicle_id, attempt_number, kind, items_json, has_not_ok, odometer_km, fuel_level, remarks, damage_notes, maintenance_job_id, actor_id, started_at, completed_at)
                         VALUES (?,?,?,'Arrival',?,?,?,?,?,?,?,?,?,NOW())")
              ->execute([$id, $vid, $t['attempt_number'], json_encode($check, JSON_UNESCAPED_UNICODE), $bad ? 1 : 0, $km, $fuel, $remarks, $damage, $jobId, $u['id'], $started]);

            FleetState::release($p, $id);
            $truck = FleetState::reconcile($p, $vid, $u['id'], 'Arrival checklist ' . $t['trip_ref'] . ($bad ? ' (NOT OK items, ' . $jobRef . ')' : ' (all OK)'));
            $summary = ($bad ? count($bad) . ' NOT OK item(s): ' . implode('; ', $bad) : 'All items OK') . ($km ? "; odometer $km" : '') . "; fuel $fuel"
                     . ($changed ? '. Changed since departure: ' . implode(', ', $changed) : '');
            self::event($p, $u['id'], $id, 'arrival checklist completed', 'Completed', 'Completed', cut($summary, 500), [],
                ['Inspection result' => $bad ? 'NOT OK' : 'All OK', 'NOT OK item count' => count($bad)]);
            Notify::resolve($p, 'trip-arrival-' . $id);
            if ($bad) {
                Notify::roles($p, ['motorpool'], 'Arrival checklist finding', "$plate back from " . $t['trip_ref'] . ' with NOT OK items (' . $jobRef . '). Assign a mechanic.', 'maintenance', 'job-open-' . $jobId);
                Notify::roles($p, ['operations_head'], 'Truck under maintenance', "$plate came back from " . $t['trip_ref'] . " with NOT OK items ($jobRef). It cannot be assigned until the repair is verified.", 'maintenance');
                return ['warning' => 'Arrival checklist saved. NOT OK items were found, so ' . $jobRef . ' was ' . ($open ? 'updated' : 'opened') . ' in Corrective Maintenance. Truck ' . $plate . ' is now ' . $truck . '.'];
            }
            $auto = self::assignWaiting($p, $u);
            return ['message' => 'Arrival checklist saved (all OK). Truck ' . $plate . ' is now ' . $truck . '.' . ($auto ? ' ' . $auto : '')];
        });
    }

    /** Ops Head cancels a trip that is not on the road. */
    private static function cancel(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $id = idField($d, 'trip_id'); $reason = field($d, 'reason', 300);
        return transaction(function (PDO $p) use ($u, $id, $reason) {
            $t = self::lockTrip($p, $id);
            self::mustBeStatus($t, self::BEFORE_DISPATCH, 'cancel');
            run($p, 'UPDATE trips SET cancel_reason=? WHERE id=?', [$reason, $id]);
            self::setStatus($p, $u['id'], $t, 'Cancelled', 'trip cancelled', $reason);
            Notify::resolve($p, 'trip-review-' . $id); Notify::resolve($p, 'trip-prep-' . $id . '-*');
            $freed = FleetState::release($p, $id);
            if ($freed) FleetState::reconcile($p, $freed, $u['id'], 'Released by cancelled ' . $t['trip_ref']);
            BillingDraft::cancel($p, $id);
            $msg = 'Trip cancelled.';
            foreach (many($p, "SELECT * FROM fund_requests WHERE trip_id=? AND status IN ('Pending Approval','Ready for Release','Rejected','Released') FOR UPDATE", [$id]) as $f) {
                if ($f['status'] === 'Released') {
                    Notify::roles($p, ['finance'], 'Liquidation needed', $t['trip_ref'] . ' was cancelled after fund ' . $f['fund_ref'] . ' was released. Record the liquidation (returned cash).', 'funds');
                    $msg .= ' The fund was already released; Finance was asked to record the liquidation.';
                } else {
                    run($p, "UPDATE fund_requests SET status='Cancelled' WHERE id=?", [$f['id']]);
                    audit($p, $u['id'], 'Funds', 'fund ' . $f['id'], 'fund request cancelled (trip cancelled)', $f['fund_ref']);
                }
            }
            Notify::roles($p, [$t['dispatcher_role']], 'Trip cancelled', $t['trip_ref'] . ' was cancelled: ' . $reason, 'trips');
            $auto = self::assignWaiting($p, $u);
            return ['message' => $msg . ($auto ? ' ' . $auto : '')];
        });
    }

    /** Everything about one trip (details drawer). */
    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'trips') || Access::canOpen($u, 'funds') || Access::canOpen($u, 'billing'), 'Not allowed.', 403);
        $id = idField($d, 'trip_id'); $p = db();
        [$scope, $args] = self::scope($u);
        $t = one($p, self::select() . " WHERE t.id=? $scope", array_merge([$id], $args));
        must((bool)$t, 'Trip not found.', 404);
        $t['dispatch_blockers'] = self::dispatchBlockers($p, $t);
        $t['time_gates'] = self::timeGates($t);
        if (in_array($t['status'], ['Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], true)) {
            $att = CrewAttendance::dispatchFindings($p, $t);
            $sched = CrewAttendance::planningShift($t);   // scheduled shift (current shift once overdue)
            foreach ($att['crew'] as &$c) $c['outside_scheduled_shift'] = $c['duty_shift'] !== $sched['shift'];
            unset($c);
            $t['crew_attendance'] = ['mode' => CrewAttendance::modeName(), 'dispatch_shift' => CrewAttendance::shiftText($att['shift']),
                'scheduled_shift' => CrewAttendance::shiftText($sched), 'crew' => $att['crew'], 'missing' => CrewAttendance::crewCompleteness($p, $t)];
        }
        $t['fuel_estimate'] = $t['distance_km'] ? Settings::fuelEstimate((float)$t['distance_km']) : null;
        $t['route_geometry'] = one($p, 'SELECT geometry FROM trip_routes WHERE trip_id=?', [$id])['geometry'] ?? null;
        $t['client_route_ref'] = $t['client_route_id'] ? (one($p, 'SELECT route_ref FROM client_routes WHERE id=?', [$t['client_route_id']])['route_ref'] ?? null) : null;
        $funds = many($p, 'SELECT f.*, ru.full_name AS requested_by_name, au.full_name AS approved_by_name, lu.full_name AS released_by_name
            FROM fund_requests f JOIN users ru ON ru.id=f.requested_by LEFT JOIN users au ON au.id=f.approved_by LEFT JOIN users lu ON lu.id=f.released_by WHERE f.trip_id=? ORDER BY f.id', [$id]);
        foreach ($funds as &$f) $f['lines'] = many($p, 'SELECT category_name, amount, is_preset FROM fund_request_lines WHERE fund_request_id=? ORDER BY id', [$f['id']]);
        unset($f);
        $incidents = many($p, 'SELECT i.*, ru.full_name AS reported_by_name, au.full_name AS assessed_by_name, m.job_ref, m.status AS job_status FROM incidents i JOIN users ru ON ru.id=i.reported_by LEFT JOIN users au ON au.id=i.assessed_by LEFT JOIN maintenance_jobs m ON m.incident_id=i.id WHERE i.trip_id=? ORDER BY i.id', [$id]);
        $docs = Files::of($p, 'trip', $id);
        foreach ($incidents as $i) foreach (Files::of($p, 'incident', (int)$i['id']) as $doc) $docs[] = $doc + ['for' => $i['incident_ref']];
        return [
            'trip' => $t,
            'events' => many($p, 'SELECT e.*, us.full_name AS actor FROM trip_events e LEFT JOIN users us ON us.id=e.actor_id WHERE e.trip_id=? ORDER BY e.id', [$id]),
            'updates' => many($p, 'SELECT up.*, us.full_name AS actor FROM trip_updates up JOIN users us ON us.id=up.actor_id WHERE up.trip_id=? ORDER BY up.id DESC', [$id]),
            'inspections' => many($p, 'SELECT i.*, us.full_name AS actor, m.job_ref, m.status AS job_status FROM inspections i JOIN users us ON us.id=i.actor_id
                LEFT JOIN maintenance_jobs m ON m.id=i.maintenance_job_id WHERE i.trip_id=? ORDER BY i.attempt_number, i.kind DESC', [$id]),
            'funds' => $funds,
            'incidents' => $incidents,
            'documents' => $docs,
            'billing' => one($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]),
        ];
    }
}
