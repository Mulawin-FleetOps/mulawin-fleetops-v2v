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
 *    -> "Dispatched" (billing draft generated) -> progress / delays
 *    -> Complete Trip (completion date/time + waybill + acknowledgement receipt)
 *    -> "Completed" (billing draft moves to For Billing)
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

    // =================================================================
    // READ
    // =================================================================
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        [$scope, $scopeArgs] = self::scope($u);
        [$where, $args] = self::filters($q);
        $closed = "'" . implode("','", self::CLOSED) . "'";
        $data = readSections([
            'active' => fn() => many($p, self::select() . " WHERE t.status NOT IN ($closed) $scope ORDER BY t.scheduled_at, t.id", $scopeArgs),
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
                (SELECT ins.has_not_ok FROM inspections ins WHERE ins.trip_id=t.id AND ins.attempt_number=t.attempt_number) AS checklist_not_ok,
                (SELECT COUNT(*) FROM trip_updates up WHERE up.trip_id=t.id AND up.update_type='Delay') AS delay_count,
                (SELECT i.status FROM incidents i WHERE i.trip_id=t.id ORDER BY i.id DESC LIMIT 1) AS incident_status,
                (SELECT i.severity FROM incidents i WHERE i.trip_id=t.id ORDER BY i.id DESC LIMIT 1) AS incident_severity,
                (SELECT COUNT(*) FROM documents dw WHERE dw.entity_type='trip' AND dw.entity_id=t.id AND dw.category='" . self::DOC_WAYBILL . "') AS waybill_docs,
                (SELECT COUNT(*) FROM documents da WHERE da.entity_type='trip' AND da.entity_id=t.id AND da.category='" . self::DOC_AR . "') AS ar_docs,
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
            'checklist' => self::checklist($u, $d),
            'dispatch' => self::dispatch($u, $d),
            'progress' => self::progress($u, $d),
            'incident' => self::incident($u, $d),
            'resume' => self::resume($u, $d),
            'reschedule' => self::reschedule($u, $d),
            'complete' => self::complete($u, $d),
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
    public static function event(PDO $p, ?int $uid, int $tripId, string $type, string $from, string $to, string $notes = ''): void {
        $p->prepare('INSERT INTO trip_events (trip_id, actor_id, event_type, from_status, to_status, notes) VALUES (?,?,?,?,?,?)')
          ->execute([$tripId, $uid, $type, $from, $to, cut($notes, 500)]);
        audit($p, $uid, 'Trips', 'trip ' . $tripId, $type, ($from !== $to ? "$from -> $to. " : '') . $notes);
    }
    public static function setStatus(PDO $p, ?int $uid, array $t, string $to, string $type, string $notes = ''): void {
        run($p, 'UPDATE trips SET status=? WHERE id=?', [$to, $t['id']]);
        self::event($p, $uid, (int)$t['id'], $type, $t['status'], $to, $notes);
    }
    private static function hasRate(PDO $p, int $clientId, ?string $type): bool {
        return $type !== null && (bool)one($p, 'SELECT id FROM client_rates WHERE client_id=? AND truck_type=?', [$clientId, $type]);
    }

    /** Common delivery fields of the trip form. */
    private static function deliveryFields(array $d, bool $needsKm): array {
        $row = [
            'consignee' => ($c = optField($d, 'consignee', 120)) !== null ? strtoupper($c) : null,
            'pickup_point' => strtoupper(field($d, 'pickup_point', 200)),
            'delivery_point' => strtoupper(field($d, 'delivery_point', 200)),
            'scheduled_at' => dateTimeField($d, 'scheduled_at'),
            'delivery_details' => optField($d, 'delivery_details', 500),
            'booking_reference' => optField($d, 'booking_reference', 150),
            'units_planned' => intField($d, 'units_planned', 1, false),
            'container_number' => ($x = optField($d, 'container_number', 60)) !== null ? strtoupper($x) : null,
            'container_size' => optField($d, 'container_size', 20),
            'seal_number' => optField($d, 'seal_number', 60),
            'shipment_number' => optField($d, 'shipment_number', 60),
            'distance_km' => numberField($d, 'distance_km', $needsKm),
        ];
        foreach (['pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng'] as $k) {
            $v = trim((string)($d[$k] ?? ''));
            $row[$k] = $v === '' ? null : (is_numeric($v) && abs((float)$v) <= 180 ? round((float)$v, 7) : null);
        }
        must($row['pickup_point'] !== $row['delivery_point'], 'Pickup point and delivery point must be different.');
        if ($needsKm) must($row['distance_km'] > 0, 'Enter the billable distance in km (pickup point to delivery point).');
        must(strtotime($row['scheduled_at']) >= strtotime('-1 day'), 'The schedule cannot be more than one day in the past.');
        return $row;
    }

    // ---------- create (Scenario A by Ops Head / Scenario B by dispatcher) ----------
    private static function create(array $u, array $d): array {
        must(self::canCreate($u), 'Only the Operations Head or a dispatcher can create a trip.', 403);
        $isOps = hasRole($u, 'operations_head');
        $row = self::deliveryFields($d, $isOps);
        $row['client_id'] = idField($d, 'client_id');
        $type = choiceField($d, 'truck_type', TRUCK_TYPES, $isOps);
        if (!$isOps && $type) must(dispatcherRoleFor($type) === $u['role'], 'This truck type is handled by the other dispatcher team.');
        $row['truck_type'] = $type;
        if ($type === 'Car Carrier' && !$row['units_planned']) $row['units_planned'] = (int)Settings::value('units_per_trip');
        return transaction(function (PDO $p) use ($u, $row, $isOps) {
            $c = one($p, 'SELECT company_name, status FROM clients WHERE id=?', [$row['client_id']]);
            must($c && $c['status'] === 'Active', 'Choose an Active client from the client masterlist (clients waiting for documents or rates cannot be used yet).');
            if ($row['truck_type']) must(self::hasRate($p, $row['client_id'], $row['truck_type']), $c['company_name'] . ' has no billing rate for ' . $row['truck_type'] . ' yet.');
            $row += ['trip_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'created_by' => $u['id'],
                     'intake_source' => $isOps ? 'Operations Head' : 'Dispatcher',
                     'dispatcher_role' => $row['truck_type'] ? dispatcherRoleFor($row['truck_type']) : $u['role'],
                     'status' => 'Pending Review'];
            $id = insert($p, 'trips', $row);
            $ref = refNumber('TRP', $id);
            run($p, 'UPDATE trips SET trip_ref=? WHERE id=?', [$ref, $id]);
            self::event($p, $u['id'], $id, $isOps ? 'trip created by Operations Head (Scenario A)' : 'delivery request encoded by dispatcher (Scenario B)', '', 'Pending Review');
            // Optional supporting files from the New Trip Request page (booking / nomination, delivery order).
            Files::store($p, $u, 'attachments', 'trip', $id, self::DOC_REQUEST);
            if ($isOps) {
                run($p, 'UPDATE trips SET approved_by=?, approved_at=NOW() WHERE id=?', [$u['id'], $id]);
                $res = self::approveAndAssign($p, $u, self::lockTrip($p, $id));
                return ['trip_id' => $id, 'trip_ref' => $ref, 'message' => "Trip $ref created. " . $res];
            }
            Notify::roles($p, ['operations_head'], 'Trip request', "New delivery request $ref from " . $u['full_name'] . ' is Pending Review.', 'trips', 'trip-review-' . $id);
            return ['trip_id' => $id, 'trip_ref' => $ref, 'message' => "Request $ref sent to the Operations Head (Pending Review)."];
        });
    }

    // ---------- Ops Head reviews a dispatcher request (Scenario B step 3) ----------
    private static function review(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $id = idField($d, 'trip_id');
        $decision = choiceField($d, 'decision', ['approve', 'reject']);
        return transaction(function (PDO $p) use ($u, $d, $id, $decision) {
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
            $row = self::deliveryFields($d, true);
            $row['truck_type'] = choiceField($d, 'truck_type', TRUCK_TYPES);
            if ($row['truck_type'] === 'Car Carrier' && !$row['units_planned']) $row['units_planned'] = (int)Settings::value('units_per_trip');
            must(self::hasRate($p, (int)$t['client_id'], $row['truck_type']), 'This client has no billing rate for ' . $row['truck_type'] . ' yet.');
            $row['dispatcher_role'] = dispatcherRoleFor($row['truck_type']);
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE trips SET $cols, approved_by=?, approved_at=NOW() WHERE id=?", array_merge(array_values($row), [$u['id'], $id]));
            Notify::resolve($p, 'trip-review-' . $id);
            self::event($p, $u['id'], $id, 'trip details confirmed by Operations Head', 'Pending Review', 'Pending Review', $row['truck_type'] . ', ' . $row['distance_km'] . ' km');
            return ['message' => self::approveAndAssign($p, $u, self::lockTrip($p, $id))];
        });
    }

    /** Ops Head edits details before dispatch; the dispatcher may fill in booking / container / units details. */
    private static function edit(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $d, $id) {
            $t = self::lockTrip($p, $id);
            must(!in_array($t['status'], self::CLOSED, true), 'The trip is already closed.', 409);
            if (hasRole($u, 'operations_head')) {
                self::mustBeStatus($t, ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'], 'edit the delivery details');
                $row = self::deliveryFields($d, true);
            } else {
                self::mustBeTripDispatcher($u, $t);
                $row = ['booking_reference' => optField($d, 'booking_reference', 150), 'units_planned' => intField($d, 'units_planned', 1, false),
                        'container_number' => ($x = optField($d, 'container_number', 60)) !== null ? strtoupper($x) : null,
                        'container_size' => optField($d, 'container_size', 20), 'seal_number' => optField($d, 'seal_number', 60),
                        'shipment_number' => optField($d, 'shipment_number', 60), 'delivery_details' => optField($d, 'delivery_details', 500)];
            }
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE trips SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
            self::event($p, $u['id'], $id, 'trip details updated', $t['status'], $t['status']);
            return ['message' => 'Trip details updated.'];
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
     *   Car Carrier: a 2nd driver is added when one is free (DRIVER 1 / DRIVER 2 in the monitoring sheets).
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
        $free = function (string $type) use ($p): array {
            return many($p, "SELECT pe.id, pe.full_name, (SELECT COUNT(*) FROM trips x WHERE (x.driver_id=pe.id OR x.driver2_id=pe.id OR x.helper_id=pe.id) AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)) AS recent
                FROM personnel pe WHERE pe.active=1 AND pe.person_type=? AND pe.availability='Available'
                  AND (pe.person_type<>'Driver' OR pe.license_expiry IS NULL OR pe.license_expiry>=CURRENT_DATE())
                  AND NOT EXISTS (SELECT 1 FROM trip_assignments a WHERE a.resource_type='person' AND a.resource_id=pe.id)
                ORDER BY recent, pe.id FOR UPDATE", [$type]);
        };
        $drivers = array_map(fn($r) => (int)$r['id'], $free('Driver'));
        if (!$drivers) return ['ok' => false, 'reason' => 'No driver is available.'];
        $helpers = $t['truck_type'] === 'Car Carrier' ? [] : array_map(fn($r) => (int)$r['id'], $free('Helper'));
        if ($t['truck_type'] !== 'Car Carrier' && !$helpers) return ['ok' => false, 'reason' => 'No helper is available.'];
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
            $driver2 = $others[0] ?? null;
        } else {
            $helper = in_array((int)$v['assigned_helper_id'], $helpers, true) ? (int)$v['assigned_helper_id'] : $helpers[0];
        }
        return ['ok' => true, 'vehicle_id' => (int)$v['id'], 'plate' => $v['plate_number'], 'driver_id' => $driver, 'driver2_id' => $driver2, 'helper_id' => $helper];
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
            'Truck ' . $res['plate'] . '; driver ' . ($nm[$res['driver_id']] ?? '') . ($res['driver2_id'] ? '; driver 2 ' . ($nm[$res['driver2_id']] ?? '') : '') . ($res['helper_id'] ? '; helper ' . ($nm[$res['helper_id']] ?? '') : ''));
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
            else must(!$helper, 'Car carrier trips use Driver 1 and Driver 2 (no helper).');
            $keep = $t['status'] === 'For Reschedule' ? 'For Reschedule' : null;
            self::applyAssignment($p, $u['id'], $t, ['vehicle_id' => $vid, 'plate' => $v['plate_number'], 'driver_id' => $driver, 'driver2_id' => $driver2, 'helper_id' => $helper], 'Manual', $keep);
            self::event($p, $u['id'], $id, 'assignment changed by Operations Head', $t['status'], $keep ?? 'Pre-Assigned', $reason);
            return ['message' => 'Assignment updated.' . ($t['status'] === 'Ready for Dispatch' ? ' The pre-dispatch checklist must be done again for the new assignment.' : '')];
        });
    }

    // ---------- pre-dispatch checklist (PDF #12 step 7) ----------
    private static function checklist(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        require_once __DIR__ . '/Inspections/Checklist.php';
        $check = Checklist::validate($d);
        $km = intField($d, 'odometer_km', 0, false);
        $fuel = optField($d, 'fuel_level', 20);
        $remarks = optField($d, 'remarks', 500);
        return transaction(function (PDO $p) use ($u, $id, $check, $km, $fuel, $remarks) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Pre-Assigned'], 'do the pre-dispatch checklist');
            $v = one($p, 'SELECT status, plate_number FROM vehicles WHERE id=?', [$t['vehicle_id']]);
            must($v && $v['status'] === 'Assigned', 'The assigned truck is ' . ($v['status'] ?? 'missing') . '.', 409);
            $p->prepare('INSERT INTO inspections (trip_id, vehicle_id, attempt_number, items_json, has_not_ok, odometer_km, fuel_level, remarks, actor_id, completed_at)
                         VALUES (?,?,?,?,?,?,?,?,?,NOW())
                         ON DUPLICATE KEY UPDATE vehicle_id=VALUES(vehicle_id), items_json=VALUES(items_json), has_not_ok=VALUES(has_not_ok), odometer_km=VALUES(odometer_km),
                           fuel_level=VALUES(fuel_level), remarks=VALUES(remarks), actor_id=VALUES(actor_id), completed_at=NOW()')
              ->execute([$id, $t['vehicle_id'], $t['attempt_number'], json_encode($check, JSON_UNESCAPED_UNICODE), $check['has_not_ok'] ? 1 : 0, $km, $fuel, $remarks, $u['id']]);
            if ($check['has_not_ok']) {
                $bad = []; foreach (Checklist::sections() as $s) foreach ($s['items'] as $i => $label) { $k = $s['key'] . '_' . str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT); if ($check['items'][$k]['condition'] === 'NOT OK') $bad[] = $label; }
                self::event($p, $u['id'], $id, 'pre-dispatch checklist has NOT OK items', $t['status'], $t['status'], implode(', ', $bad));
                Notify::roles($p, ['motorpool'], 'Checklist finding', $t['trip_ref'] . ' / ' . $v['plate_number'] . ' NOT OK: ' . implode(', ', array_slice($bad, 0, 6)), 'maintenance');
                return ['warning' => 'Checklist saved with NOT OK items (' . implode(', ', array_slice($bad, 0, 5)) . '). The trip cannot be Ready for Dispatch until every item is OK. Fix the items and submit the checklist again.'];
            }
            self::setStatus($p, $u['id'], $t, 'Ready for Dispatch', 'pre-dispatch checklist completed', 'All items OK' . ($km ? "; odometer $km" : ''));
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
    public static function dispatchBlockers(PDO $p, array $t): array {
        $why = [];
        if ($t['status'] !== 'Ready for Dispatch') $why[] = 'Trip status is ' . $t['status'] . ' (needs Ready for Dispatch).';
        $fund = one($p, 'SELECT status FROM fund_requests WHERE trip_id=? AND attempt_number=?', [$t['id'], $t['attempt_number']]);
        if ($fund && $fund['status'] !== 'Released') $why[] = 'Fund status is ' . $fund['status'] . ' (needs Released).';
        if (!$fund && (int)$t['attempt_number'] === 1) $why[] = 'No fund request yet (needs a Released fund).';
        return $why;
    }

    private static function dispatch(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            $why = self::dispatchBlockers($p, $t);
            must(!$why, 'Confirm Dispatch is not enabled yet. ' . implode(' ', $why), 409);
            $v = one($p, 'SELECT status, plate_number FROM vehicles WHERE id=? FOR UPDATE', [$t['vehicle_id']]);
            must($v && $v['status'] === 'Assigned', 'The truck is ' . ($v['status'] ?? 'missing') . '.', 409);
            $redispatch = (int)$t['attempt_number'] > 1;
            run($p, "UPDATE trips SET status='Dispatched', dispatched_at=NOW(), dispatcher_id=? WHERE id=?", [$u['id'], $id]);
            self::event($p, $u['id'], $id, $redispatch ? 'redispatch confirmed (Second Attempt)' : 'dispatch confirmed', $t['status'], 'Dispatched',
                $redispatch ? 'Attempt #' . $t['attempt_number'] . ', linked to the original trip and incident report.' : '');
            FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Dispatched ' . $t['trip_ref']);
            BillingDraft::createFor($p, $t);
            Notify::resolve($p, 'trip-prep-' . $id . '-*');
            Notify::roles($p, ['operations_head', 'finance', 'billing'], $redispatch ? 'Trip redispatched' : 'Trip dispatched', $t['trip_ref'] . ' left with truck ' . $v['plate_number'] . '.', 'trips');
            return ['message' => ($redispatch ? 'Redispatch confirmed (Second Attempt).' : 'Dispatch confirmed.') . ' The billing draft was generated.'];
        });
    }

    /** Progress, delivery and delay updates (Objective 1.5). */
    private static function progress(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $type = choiceField($d, 'update_type', self::UPDATE_TYPES);
        $cause = $type === 'Delay' ? choiceField($d, 'delay_cause', self::DELAY_CAUSES) : null;
        $note = field($d, 'note', 500);
        return transaction(function (PDO $p) use ($u, $id, $type, $cause, $note) {
            $t = self::lockTrip($p, $id);
            self::mustBeTripDispatcher($u, $t);
            self::mustBeStatus($t, ['Pre-Assigned', 'Ready for Dispatch', 'Dispatched', 'On Hold - Incident Reported', 'In Transit', 'For Reschedule'], 'add an update');
            insert($p, 'trip_updates', ['trip_id' => $id, 'actor_id' => $u['id'], 'update_type' => $type, 'delay_cause' => $cause, 'note' => $note]);
            self::event($p, $u['id'], $id, 'trip update: ' . strtolower($type), $t['status'], $t['status'], ($cause ? "[$cause] " : '') . $note);
            if ($type === 'Delay') Notify::roles($p, ['operations_head'], 'Trip delay', $t['trip_ref'] . " delay ($cause): $note", 'trips');
            return ['message' => 'Update recorded.'];
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
        $when = dateTimeField($d, 'scheduled_at');
        must(strtotime($when) >= strtotime('-1 hour'), 'The new schedule cannot be in the past.');
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
     * TRIP COMPLETION (PDF #12 step 11): completion date/time + required supporting
     * documents (waybill and acknowledgement receipt, PDF #13). The system refuses
     * completion while anything is missing and says what is missing.
     */
    private static function complete(array $u, array $d): array {
        $id = idField($d, 'trip_id');
        $when = dateTimeField($d, 'completed_at');
        $waybill = strtoupper(field($d, 'waybill_number', 100));
        $units = intField($d, 'units_delivered', 0, false);
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
            Files::store($p, $u, 'other', 'trip', $id, 'Other Trip Document');
            $missing = [];
            if (!Files::count($p, 'trip', $id, self::DOC_WAYBILL)) $missing[] = 'waybill file';
            if (!Files::count($p, 'trip', $id, self::DOC_AR)) $missing[] = 'acknowledgement receipt file';
            must(!$missing, 'Trip cannot be completed yet. Missing: ' . implode(', ', $missing) . '.', 422);
            run($p, "UPDATE trips SET status='Completed', completed_at=?, waybill_number=?, units_delivered=?, delivery_notes=? WHERE id=?",
                [$when, $waybill, $units, $notes, $id]);
            self::event($p, $u['id'], $id, 'trip completed', $t['status'], 'Completed', 'Completed ' . $when . '; waybill ' . $waybill);
            FleetState::release($p, $id);
            $truck = FleetState::reconcile($p, (int)$t['vehicle_id'], $u['id'], 'Trip ' . $t['trip_ref'] . ' completed');
            BillingDraft::forBilling($p, $id);
            Notify::roles($p, ['billing'], 'For billing', $t['trip_ref'] . ' is completed. Verify the documents and finalize the billing.', 'billing', 'billing-verify-' . $id);
            Notify::roles($p, ['operations_head'], 'Trip completed', $t['trip_ref'] . ' completed.', 'trips');
            $auto = self::assignWaiting($p, $u);
            return ['message' => 'Trip completed. Truck is now ' . $truck . '. The billing record moved to For Billing.' . ($auto ? ' ' . $auto : '')];
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
        $t['fuel_estimate'] = $t['distance_km'] ? Settings::fuelEstimate((float)$t['distance_km']) : null;
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
            'inspections' => many($p, 'SELECT i.*, us.full_name AS actor FROM inspections i JOIN users us ON us.id=i.actor_id WHERE i.trip_id=? ORDER BY i.attempt_number', [$id]),
            'funds' => $funds,
            'incidents' => $incidents,
            'documents' => $docs,
            'billing' => one($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]),
        ];
    }
}
