<?php
/*
 * =====================================================================
 *  backend/Modules/Operations/Fleet.php  —  TRUCK and DRIVER/HELPER MASTERLISTS
 * =====================================================================
 *  Objective 1.1: truck records with plate numbers, truck types, assigned
 *  drivers and helpers, vehicle documents and availability status.
 *  PDF #11 II.B / II.C.
 *
 *  Pages:  trucks  (Truck Masterlist)
 *          crew    (Driver & Helper Masterlist)
 *  These are the ONLY places where trucks, drivers and helpers are created.
 *  Trips, maintenance, purchasing and reports all point to these rows.
 * =====================================================================
 */
declare(strict_types=1);
core('FleetState');
core('Settings');
core('Files');

final class Fleet {
    private const EDIT = ['admin', 'operations_head'];
    private const STATUS = ['admin', 'operations_head', 'motorpool'];

    // =================================================================
    // READ
    // =================================================================
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        if ($page === 'trucks') {
            $data = readSections([
                'trucks' => fn() => many($p, "SELECT v.*, d.full_name AS driver_name, h.full_name AS helper_name,
                        t.id AS trip_id, t.trip_ref, t.status AS trip_status,
                        DATEDIFF(v.registration_expiry, CURRENT_DATE()) AS reg_days, DATEDIFF(v.insurance_expiry, CURRENT_DATE()) AS ins_days,
                        (SELECT m.id FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job_id,
                        (SELECT m.job_ref FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job,
                        (SELECT m.status FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job_status,
                        (SELECT m.expected_completion FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS expected_back
                    FROM vehicles v
                    LEFT JOIN personnel d ON d.id=v.assigned_driver_id LEFT JOIN personnel h ON h.id=v.assigned_helper_id
                    LEFT JOIN trip_assignments a ON a.resource_type='vehicle' AND a.resource_id=v.id
                    LEFT JOIN trips t ON t.id=a.trip_id
                    ORDER BY v.active DESC, v.truck_type, LENGTH(v.truck_number), v.truck_number, v.plate_number"),
                'drivers' => fn() => many($p, "SELECT id, full_name FROM personnel WHERE active=1 AND person_type='Driver' ORDER BY full_name"),
                'helpers' => fn() => many($p, "SELECT id, full_name FROM personnel WHERE active=1 AND person_type='Helper' ORDER BY full_name"),
            ]);
            $data['alertDays'] = Settings::value('document_alert_days');
            $data['can'] = ['edit' => hasRole($u, ...self::EDIT), 'status' => hasRole($u, ...self::STATUS)];
            return $data;
        }
        // crew
        $data = readSections([
            'crew' => fn() => many($p, "SELECT pe.*, DATEDIFF(pe.license_expiry, CURRENT_DATE()) AS license_days,
                    t.id AS trip_id, t.trip_ref, t.status AS trip_status, v2.plate_number AS trip_plate,
                    (SELECT GROUP_CONCAT(v.plate_number SEPARATOR ', ') FROM vehicles v WHERE v.active=1 AND (v.assigned_driver_id=pe.id OR v.assigned_helper_id=pe.id)) AS regular_truck,
                    (SELECT COUNT(*) FROM trips x WHERE x.status='Completed' AND (x.driver_id=pe.id OR x.driver2_id=pe.id OR x.helper_id=pe.id)) AS completed_trips
                FROM personnel pe
                LEFT JOIN trip_assignments a ON a.resource_type='person' AND a.resource_id=pe.id
                LEFT JOIN trips t ON t.id=a.trip_id LEFT JOIN vehicles v2 ON v2.id=t.vehicle_id
                ORDER BY pe.active DESC, pe.person_type, pe.full_name"),
        ]);
        $data['alertDays'] = Settings::value('license_alert_days');
        $data['can'] = ['edit' => hasRole($u, ...self::EDIT)];
        return $data;
    }

    // =================================================================
    // ACTIONS
    // =================================================================
    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'truck_save' => self::truckSave($u, $d),
            'truck_status' => self::truckStatus($u, $d),
            'truck_active' => self::truckActive($u, $d),
            'truck_details' => self::truckDetails($u, $d),
            'crew_save' => self::crewSave($u, $d),
            'crew_status' => self::crewStatus($u, $d),
            'crew_active' => self::crewActive($u, $d),
            'crew_details' => self::crewDetails($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    // ---------------------------------------------------------------- trucks
    private static function truckSave(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = optId($d, 'id');
        $plate = strtoupper(preg_replace('/[\s-]+/', '', field($d, 'plate_number', 20)));
        must((bool)preg_match('/^[A-Z0-9]{4,10}$/', $plate), 'Plate number must be 4 to 10 letters or numbers (example: NAJ5941).');
        $row = [
            'plate_number' => $plate,
            'truck_number' => ($n = optField($d, 'truck_number', 20)) !== null ? strtoupper($n) : null,
            'truck_type' => choiceField($d, 'truck_type', TRUCK_TYPES),
            'make_brand' => optField($d, 'make_brand', 80), 'model' => optField($d, 'model', 80),
            'chassis_number' => optField($d, 'chassis_number', 80), 'engine_number' => optField($d, 'engine_number', 80),
            'mv_file_number' => optField($d, 'mv_file_number', 80), 'or_number' => optField($d, 'or_number', 80), 'cr_number' => optField($d, 'cr_number', 80),
            'registration_expiry' => dateField($d, 'registration_expiry', false),
            'insurance_provider' => optField($d, 'insurance_provider', 120), 'insurance_policy_number' => optField($d, 'insurance_policy_number', 80),
            'insurance_expiry' => dateField($d, 'insurance_expiry', false),
            'assigned_driver_id' => optId($d, 'assigned_driver_id'), 'assigned_helper_id' => optId($d, 'assigned_helper_id'),
            'notes' => optField($d, 'notes', 255),
        ];
        return transaction(function (PDO $p) use ($u, $id, $row) {
            $dup = one($p, 'SELECT id FROM vehicles WHERE plate_number=? AND id<>?', [$row['plate_number'], $id ?? 0]);
            must(!$dup, 'Plate number ' . $row['plate_number'] . ' is already registered.', 409);
            if ($row['truck_number']) must(!one($p, 'SELECT id FROM vehicles WHERE truck_number=? AND id<>?', [$row['truck_number'], $id ?? 0]), 'Truck number ' . $row['truck_number'] . ' is already used by another truck.', 409);
            foreach (['assigned_driver_id' => 'Driver', 'assigned_helper_id' => 'Helper'] as $col => $type) {
                if ($row[$col]) must((bool)one($p, 'SELECT id FROM personnel WHERE id=? AND person_type=? AND active=1', [$row[$col], $type]), "Choose an active $type from the masterlist.");
            }
            if ($id) {
                $old = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$id]);
                must((bool)$old, 'Truck not found.', 404);
                if ($old['truck_type'] !== $row['truck_type']) must(!FleetState::activeTrip($p, $id), 'The truck type cannot be changed while the truck is on an active trip.', 409);
                $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
                run($p, "UPDATE vehicles SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
                audit($p, $u['id'], 'Fleet', 'vehicle ' . $id, 'truck updated', $row['plate_number']);
                return ['id' => $id, 'message' => 'Truck ' . $row['plate_number'] . ' updated.'];
            }
            $id = insert($p, 'vehicles', $row + ['status' => 'Available']);
            audit($p, $u['id'], 'Fleet', 'vehicle ' . $id, 'truck added', $row['plate_number'] . ' (' . $row['truck_type'] . ')');
            return ['id' => $id, 'message' => 'Truck ' . $row['plate_number'] . ' added to the masterlist.'];
        });
    }

    /**
     * Manual availability: Available or Unavailable.
     * "Under Maintenance" comes only from Corrective Maintenance (a repair record always
     * exists) and ends only when the repair is verified there.
     */
    private static function truckStatus(array $u, array $d): array {
        requireRole($u, ...self::STATUS);
        $id = idField($d, 'id');
        $to = choiceField($d, 'status', ['Available', 'Unavailable']);
        $reason = $to === 'Unavailable' ? field($d, 'reason', 150) : optField($d, 'reason', 150);
        return transaction(function (PDO $p) use ($u, $id, $to, $reason) {
            $v = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$id]);
            must($v && (int)$v['active'], 'Truck not found or inactive.', 404);
            $job = FleetState::openJob($p, $id);
            $trip = FleetState::activeTrip($p, $id);
            $msg = '';
            if ($to === 'Available') {
                must(!$job, 'This truck has an unresolved repair (' . ($job['job_ref'] ?? '') . ', ' . ($job['status'] ?? '') . '). It becomes available only after the repair is completed and verified in Corrective Maintenance.', 409);
                run($p, 'UPDATE vehicles SET status_reason=NULL WHERE id=?', [$id]);
                if ($v['status'] === 'Unavailable') FleetState::setStatus($p, $id, 'Available', $u['id'], $reason ?: 'Set Available');
                $now = FleetState::reconcile($p, $id, $u['id'], 'Availability check');
                Actions::load('Trips');
                $auto = Trips::assignWaiting($p, $u);
                $msg = 'Truck is now ' . $now . '.' . ($auto ? ' ' . $auto : '');
            } else {
                must(!$trip || !in_array($trip['status'], FleetState::ON_ROAD, true), 'The truck is on the road (' . ($trip['trip_ref'] ?? '') . '). It can be set Unavailable after the trip.', 409);
                run($p, 'UPDATE vehicles SET status_reason=? WHERE id=?', [$reason, $id]);
                FleetState::setStatus($p, $id, 'Unavailable', $u['id'], $reason);
                $msg = 'Truck set Unavailable.';
                if ($trip) {
                    Actions::load('Trips');
                    $msg .= ' ' . Trips::resourceLost($p, $u, (int)$trip['id'], 'Truck ' . $v['plate_number'] . ' was set Unavailable: ' . $reason);
                }
            }
            audit($p, $u['id'], 'Fleet', 'vehicle ' . $id, 'truck availability set', $v['plate_number'] . ': ' . $to . ($reason ? " ($reason)" : ''));
            return ['message' => $msg];
        });
    }

    private static function truckActive(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id'); $active = !empty($d['active']) ? 1 : 0;
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $v = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$id]);
            must((bool)$v, 'Truck not found.', 404);
            if (!$active) {
                must(!FleetState::activeTrip($p, $id), 'The truck is on an active trip. Finish or re-assign the trip first.', 409);
                must(!FleetState::openJob($p, $id), 'The truck has an open maintenance job.', 409);
            }
            run($p, 'UPDATE vehicles SET active=? WHERE id=?', [$active, $id]);
            audit($p, $u['id'], 'Fleet', 'vehicle ' . $id, $active ? 'truck reactivated' : 'truck deactivated', $v['plate_number']);
            return ['message' => 'Truck ' . $v['plate_number'] . ($active ? ' reactivated.' : ' deactivated. Its past trips and records are kept.')];
        });
    }

    private static function truckDetails(array $u, array $d): array {
        must(Access::canOpen($u, 'trucks'), 'Not allowed.', 403);
        $id = idField($d, 'id'); $p = db();
        $v = one($p, 'SELECT v.*, d.full_name AS driver_name, h.full_name AS helper_name FROM vehicles v LEFT JOIN personnel d ON d.id=v.assigned_driver_id LEFT JOIN personnel h ON h.id=v.assigned_helper_id WHERE v.id=?', [$id]);
        must((bool)$v, 'Truck not found.', 404);
        return [
            'truck' => $v,
            'trips' => many($p, "SELECT t.id, t.trip_ref, t.status, t.scheduled_at, t.pickup_point, t.delivery_point, c.company_name AS client, d.full_name AS driver_name
                FROM trips t JOIN clients c ON c.id=t.client_id LEFT JOIN personnel d ON d.id=t.driver_id WHERE t.vehicle_id=? ORDER BY t.scheduled_at DESC LIMIT 50", [$id]),
            'openJob' => FleetState::openJob($p, $id),
            'maintenance' => many($p, "SELECT m.id, m.job_ref, m.source, m.problem, IF(m.status='Completed' AND m.verified_at IS NULL, 'Awaiting verification', m.status) AS status, m.reported_on, m.completed_on,
                (SELECT mc.full_name FROM mechanics mc WHERE mc.id=m.mechanic_id) AS mechanic,
                (SELECT COALESCE(SUM(c.amount),0) FROM maintenance_costs c WHERE c.maintenance_job_id=m.id) +
                (SELECT COALESCE(SUM(l.released_qty*l.unit_cost),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.maintenance_job_id=m.id) AS cost
                FROM maintenance_jobs m WHERE m.vehicle_id=? ORDER BY m.id DESC LIMIT 50", [$id]),
            'statusLog' => many($p, 'SELECT l.from_status, l.to_status, l.reason, l.created_at, u.full_name AS actor FROM vehicle_status_log l LEFT JOIN users u ON u.id=l.actor_id WHERE l.vehicle_id=? ORDER BY l.id DESC LIMIT 30', [$id]),
            'documents' => Files::of($p, 'vehicle', $id),
        ];
    }

    // ---------------------------------------------------------------- drivers and helpers
    private static function crewSave(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = optId($d, 'id');
        $name = strtoupper(preg_replace('/\s+/', ' ', field($d, 'full_name', 120)));
        $name = preg_replace('/\s*,\s*/', ', ', $name);
        must(str_contains($name, ','), 'Write the name as LAST NAME, FIRST NAME (example: JUEGOS, HECTOR).');
        $row = [
            'full_name' => $name,
            'person_type' => choiceField($d, 'person_type', ['Driver', 'Helper']),
            'employee_no' => optField($d, 'employee_no', 40),
            'contact_number' => optField($d, 'contact_number', 60),
            'address' => optField($d, 'address', 255),
            'license_number' => ($l = optField($d, 'license_number', 60)) !== null ? strtoupper($l) : null,
            'license_expiry' => dateField($d, 'license_expiry', false),
            'date_hired' => dateField($d, 'date_hired', false),
            'notes' => optField($d, 'notes', 255),
        ];
        if ($row['person_type'] === 'Driver') must($row['license_number'] !== null && $row['license_expiry'] !== null || $id !== null, "A driver needs the driver's license number and expiry date.");
        return transaction(function (PDO $p) use ($u, $id, $row) {
            must(!one($p, 'SELECT id FROM personnel WHERE full_name=? AND person_type=? AND id<>?', [$row['full_name'], $row['person_type'], $id ?? 0]), $row['full_name'] . ' is already in the ' . $row['person_type'] . ' masterlist.', 409);
            if ($row['license_number']) must(!one($p, 'SELECT id FROM personnel WHERE license_number=? AND id<>?', [$row['license_number'], $id ?? 0]), 'License number ' . $row['license_number'] . ' belongs to another person.', 409);
            if ($row['employee_no']) must(!one($p, 'SELECT id FROM personnel WHERE employee_no=? AND id<>?', [$row['employee_no'], $id ?? 0]), 'Employee number ' . $row['employee_no'] . ' is already used.', 409);
            if ($id) {
                $old = one($p, 'SELECT * FROM personnel WHERE id=? FOR UPDATE', [$id]);
                must((bool)$old, 'Person not found.', 404);
                if ($old['person_type'] !== $row['person_type']) {
                    must(!one($p, "SELECT 1 FROM trip_assignments WHERE resource_type='person' AND resource_id=?", [$id]), 'Driver/helper type cannot change while on an active trip.', 409);
                    must(!one($p, 'SELECT id FROM vehicles WHERE assigned_driver_id=? OR assigned_helper_id=?', [$id, $id]), 'Remove this person as the regular driver/helper of a truck first.', 409);
                }
                $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
                run($p, "UPDATE personnel SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
                audit($p, $u['id'], 'Fleet', 'personnel ' . $id, 'driver/helper updated', $row['full_name']);
                return ['id' => $id, 'message' => $row['full_name'] . ' updated.'];
            }
            $id = insert($p, 'personnel', $row);
            audit($p, $u['id'], 'Fleet', 'personnel ' . $id, 'driver/helper added', $row['full_name'] . ' (' . $row['person_type'] . ')');
            return ['id' => $id, 'message' => $row['full_name'] . ' added to the masterlist.'];
        });
    }

    private static function crewStatus(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id');
        $to = choiceField($d, 'availability', ['Available', 'Unavailable']);
        $reason = $to === 'Unavailable' ? field($d, 'reason', 150) : null;
        return transaction(function (PDO $p) use ($u, $id, $to, $reason) {
            $pe = one($p, 'SELECT * FROM personnel WHERE id=? FOR UPDATE', [$id]);
            must($pe && (int)$pe['active'], 'Person not found or inactive.', 404);
            $hold = one($p, "SELECT t.id, t.trip_ref, t.status FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='person' AND a.resource_id=?", [$id]);
            $msg = '';
            if ($to === 'Unavailable') {
                must(!$hold || !in_array($hold['status'], FleetState::ON_ROAD, true), $pe['full_name'] . ' is on the road (' . ($hold['trip_ref'] ?? '') . ').', 409);
                run($p, "UPDATE personnel SET availability='Unavailable', unavailable_reason=? WHERE id=?", [$reason, $id]);
                $msg = $pe['full_name'] . ' is now Unavailable.';
                if ($hold) { Actions::load('Trips'); $msg .= ' ' . Trips::resourceLost($p, $u, (int)$hold['id'], $pe['full_name'] . ' was set Unavailable: ' . $reason); }
            } else {
                run($p, "UPDATE personnel SET availability=?, unavailable_reason=NULL WHERE id=?", [$hold ? 'On Trip' : 'Available', $id]);
                $msg = $pe['full_name'] . ' is now ' . ($hold ? 'On Trip' : 'Available') . '.';
                Actions::load('Trips');
                if (!$hold && ($auto = Trips::assignWaiting($p, $u))) $msg .= ' ' . $auto;
            }
            audit($p, $u['id'], 'Fleet', 'personnel ' . $id, 'availability set', $pe['full_name'] . ': ' . $to . ($reason ? " ($reason)" : ''));
            return ['message' => $msg];
        });
    }

    private static function crewActive(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id'); $active = !empty($d['active']) ? 1 : 0;
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $pe = one($p, 'SELECT * FROM personnel WHERE id=? FOR UPDATE', [$id]);
            must((bool)$pe, 'Person not found.', 404);
            if (!$active) {
                must(!one($p, "SELECT 1 FROM trip_assignments WHERE resource_type='person' AND resource_id=?", [$id]), $pe['full_name'] . ' is on an active trip.', 409);
                run($p, 'UPDATE vehicles SET assigned_driver_id=NULL WHERE assigned_driver_id=?', [$id]);
                run($p, 'UPDATE vehicles SET assigned_helper_id=NULL WHERE assigned_helper_id=?', [$id]);
            }
            run($p, 'UPDATE personnel SET active=? WHERE id=?', [$active, $id]);
            audit($p, $u['id'], 'Fleet', 'personnel ' . $id, $active ? 'driver/helper reactivated' : 'driver/helper deactivated', $pe['full_name']);
            return ['message' => $pe['full_name'] . ($active ? ' reactivated.' : ' deactivated. Past trips keep the name.')];
        });
    }

    private static function crewDetails(array $u, array $d): array {
        must(Access::canOpen($u, 'crew') || Access::canOpen($u, 'trucks'), 'Not allowed.', 403);
        $id = idField($d, 'id'); $p = db();
        $pe = one($p, 'SELECT * FROM personnel WHERE id=?', [$id]);
        must((bool)$pe, 'Person not found.', 404);
        return [
            'person' => $pe,
            'trips' => many($p, "SELECT t.id, t.trip_ref, t.status, t.scheduled_at, t.pickup_point, t.delivery_point, v.plate_number, c.company_name AS client,
                    CASE WHEN t.driver_id=? THEN 'Driver' WHEN t.driver2_id=? THEN 'Driver 2' ELSE 'Helper' END AS role_on_trip
                FROM trips t JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
                WHERE t.driver_id=? OR t.driver2_id=? OR t.helper_id=? ORDER BY t.scheduled_at DESC LIMIT 100", [$id, $id, $id, $id, $id]),
            'documents' => Files::of($p, 'personnel', $id),
        ];
    }
}
