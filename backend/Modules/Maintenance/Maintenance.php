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
        $data = readSections([
            'jobs' => fn() => many($p, "SELECT m.id, m.job_ref, m.vehicle_id, m.source, m.problem, m.reported_on, m.priority, m.severity, m.status, m.mechanic_id, m.trip_id, m.incident_id,
                    m.expected_completion, m.completed_on, m.verified_at, m.created_at, mc.full_name AS mechanic, mc.mechanic_code,
                    v.plate_number, v.truck_number, v.truck_type, v.status AS truck_status,
                    i.incident_ref, i.status AS incident_status, t.trip_ref, t.status AS trip_status,
                    (SELECT COALESCE(SUM(c.amount),0) FROM maintenance_costs c WHERE c.maintenance_job_id=m.id) AS other_cost,
                    (SELECT COALESCE(SUM(l.released_qty*l.unit_cost),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.maintenance_job_id=m.id) AS parts_cost
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id
                LEFT JOIN incidents i ON i.id=m.incident_id LEFT JOIN trips t ON t.id=m.trip_id
                ORDER BY FIELD(m.status,'Reported','Under Inspection','Under Repair','Completed','Cancelled'), FIELD(m.priority,'Critical','High','Normal','Low'), m.id DESC LIMIT 1000"),
            'trucks' => fn() => many($p, "SELECT v.id, v.plate_number, v.truck_number, v.truck_type, v.status,
                    (SELECT m.job_ref FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job,
                    (SELECT t.trip_ref FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='vehicle' AND a.resource_id=v.id AND t.status IN ('Dispatched','On Hold - Incident Reported','In Transit') LIMIT 1) AS on_road
                FROM vehicles v WHERE v.active=1 ORDER BY v.plate_number"),
            'mechanics' => fn() => many($p, "SELECT id, mechanic_code, full_name, specialization, availability FROM mechanics WHERE active=1 ORDER BY full_name"),
        ]);
        $data['costTypes'] = self::COST_TYPES;
        $data['priorities'] = self::PRIORITIES;
        $data['can'] = ['act' => hasRole($u, ...self::ACT)];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'report' => self::report($u, $d),
            'assign_mechanic' => self::assignMechanic($u, $d),
            'assess' => self::assess($u, $d),
            'inspect' => self::inspect($u, $d),
            'add_cost' => self::addCost($u, $d),
            'complete' => self::complete($u, $d),
            'verify' => self::verify($u, $d),
            'cancel' => self::cancel($u, $d),
            'details' => self::details($u, $d),
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
        must($m['availability'] !== 'Unavailable', $m['full_name'] . ' is Unavailable' . ($m['unavailable_reason'] ? ' (' . $m['unavailable_reason'] . ')' : '') . '.', 409);
        $busy = one($p, "SELECT job_ref, id FROM maintenance_jobs WHERE active_mechanic=?", [$mechanicId]);
        must(!$busy || (int)$busy['id'] === (int)$exceptJob, $m['full_name'] . ' is already assigned to ' . ($busy['job_ref'] ?? '') . '. Choose an Available mechanic.', 409);
        return $m;
    }

    /** Recomputes a mechanic's availability from their active repairs (Unavailable is kept). */
    public static function refreshMechanic(PDO $p, ?int $mechanicId): void {
        if (!$mechanicId) return;
        $m = one($p, 'SELECT availability FROM mechanics WHERE id=? FOR UPDATE', [$mechanicId]);
        if (!$m || $m['availability'] === 'Unavailable') return;
        $busy = (bool)one($p, 'SELECT id FROM maintenance_jobs WHERE active_mechanic=?', [$mechanicId]);
        run($p, 'UPDATE mechanics SET availability=? WHERE id=?', [$busy ? 'Assigned' : 'Available', $mechanicId]);
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

    // ------------------------------------------------------------------ actions
    /** Report a truck problem found at the garage (on-premise). The truck goes Under Maintenance at once. */
    private static function report(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $vid = idField($d, 'vehicle_id');
        $problem = field($d, 'problem', 500);
        $date = dateField($d, 'reported_on');
        must($date <= date('Y-m-d'), 'The date reported cannot be in the future.');
        $priority = choiceField($d, 'priority', self::PRIORITIES);
        $mechanicId = optId($d, 'mechanic_id');
        $remarks = optField($d, 'remarks', 500);
        return transaction(function (PDO $p) use ($u, $vid, $problem, $date, $priority, $mechanicId, $remarks) {
            $v = one($p, 'SELECT * FROM vehicles WHERE id=? FOR UPDATE', [$vid]);
            must($v && (int)$v['active'], 'Truck not found or inactive.', 404);
            $open = FleetState::openJob($p, $vid);
            must(!$open, 'Truck ' . $v['plate_number'] . ' already has an unresolved maintenance record (' . ($open['job_ref'] ?? '') . '). Add the new findings to that record.', 409);
            $trip = FleetState::activeTrip($p, $vid);
            must(!$trip || !in_array($trip['status'], FleetState::ON_ROAD, true), 'Truck ' . $v['plate_number'] . ' is on the road (' . ($trip['trip_ref'] ?? '') . '). The dispatcher reports trouble during a trip with "Report incident".', 409);
            if ($mechanicId) self::freeMechanic($p, $mechanicId);
            $status = $mechanicId ? 'Under Inspection' : 'Reported';
            $jid = insert($p, 'maintenance_jobs', ['job_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $vid, 'source' => 'On-Premise',
                'problem' => $problem, 'reported_on' => $date, 'priority' => $priority, 'status' => 'Reported', 'remarks' => $remarks, 'created_by' => $u['id']]);
            $ref = refNumber('CM', $jid);
            run($p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [$ref, $jid]);
            Files::store($p, $u, 'photos', 'maintenance', $jid, 'Inspection Photo', true, 'photos of the damaged parts or truck condition');
            self::event($p, $jid, null, 'Reported', $u['id'], $problem);
            if ($mechanicId) {
                $j = self::lockJob($p, $jid);
                self::setMechanic($p, $j, $mechanicId);
                run($p, "UPDATE maintenance_jobs SET status='Under Inspection', started_by=?, started_at=NOW() WHERE id=?", [$u['id'], $jid]);
                self::event($p, $jid, 'Reported', 'Under Inspection', $u['id'], 'mechanic assigned', $mechanicId);
            }
            $msg = "Problem reported ($ref). Truck " . $v['plate_number'] . ' is Under Maintenance and cannot be assigned to trips.';
            if ($trip) { Actions::load('Trips'); $msg .= ' ' . Trips::resourceLost($p, $u, (int)$trip['id'], 'Truck ' . $v['plate_number'] . ' has a reported problem'); }
            FleetState::reconcile($p, $vid, $u['id'], "Corrective maintenance $ref");
            audit($p, $u['id'], 'Maintenance', 'job ' . $jid, 'truck problem reported', "$ref {$v['plate_number']} ($priority): " . cut($problem, 200));
            Notify::roles($p, ['operations_head'], 'Truck under maintenance', $v['plate_number'] . " has a reported problem ($ref, $priority priority). It cannot be assigned until the repair is verified.", 'maintenance', 'job-open-' . $jid);
            return ['job_id' => $jid, 'job_ref' => $ref, 'message' => $msg . ($mechanicId ? '' : ' Assign a mechanic to start the inspection.')];
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
            must(!($j['source'] === 'Incident' && $j['status'] === 'Reported'), 'Assess the incident first (Minor or Major); the mechanic is chosen there.', 409);
            if ((int)$j['mechanic_id'] === $mechanicId) return ['message' => 'This mechanic is already assigned.'];
            if ($j['mechanic_id']) must($reason !== null, 'Give the reason for changing the mechanic.');
            $m = self::freeMechanic($p, $mechanicId, (int)$j['id']);
            self::setMechanic($p, $j, $mechanicId);
            $to = $j['status'] === 'Reported' ? 'Under Inspection' : $j['status'];
            if ($to !== $j['status']) run($p, "UPDATE maintenance_jobs SET status=?, started_by=?, started_at=NOW() WHERE id=?", [$to, $u['id'], $id]);
            self::event($p, $id, $j['status'], $to, $u['id'], ($j['mechanic_id'] ? 'mechanic changed' : 'mechanic assigned') . ($reason ? ': ' . $reason : ''), $mechanicId);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'mechanic assigned', $j['job_ref'] . ' -> ' . $m['full_name']);
            return ['message' => $m['full_name'] . ' is assigned to ' . $j['job_ref'] . ($to !== $j['status'] ? ' (Under Inspection).' : '.')];
        });
    }

    /** Incident assessment: Minor (on-site repair) or Major (return, repair, redispatch). PDF #12 Scenario C step 3. */
    private static function assess(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $sev = choiceField($d, 'severity', ['Minor', 'Major']);
        $rec = field($d, 'recommendation', 500);
        $mechanicId = idField($d, 'mechanic_id');
        $exp = dateField($d, 'expected_completion', $sev === 'Major');
        if ($exp) must($exp >= date('Y-m-d'), 'Expected completion cannot be in the past.');
        return transaction(function (PDO $p) use ($u, $id, $sev, $rec, $mechanicId, $exp) {
            $j = self::lockJob($p, $id);
            must($j['source'] === 'Incident' && $j['status'] === 'Reported', 'Only a newly reported incident can be assessed.', 409);
            $inc = one($p, 'SELECT * FROM incidents WHERE id=? FOR UPDATE', [$j['incident_id']]);
            $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$j['trip_id']]);
            must($t && $t['status'] === 'On Hold - Incident Reported', 'The trip is not On Hold.', 409);
            $m = self::freeMechanic($p, $mechanicId);
            self::setMechanic($p, $j, $mechanicId);
            run($p, "UPDATE maintenance_jobs SET status='Under Inspection', severity=?, priority=?, expected_completion=?, started_by=?, started_at=NOW(), remarks=? WHERE id=?",
                [$sev, $sev === 'Major' ? 'Critical' : 'High', $exp, $u['id'], $rec, $id]);
            run($p, "UPDATE incidents SET severity=?, recommendation=?, status='Under Repair', assessed_by=?, assessed_at=NOW() WHERE id=?", [$sev, $rec, $u['id'], $inc['id']]);
            self::event($p, $id, 'Reported', 'Under Inspection', $u['id'], "assessed $sev: $rec", $mechanicId);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'incident assessed', $inc['incident_ref'] . ': ' . $sev . '; mechanic ' . $m['full_name']);
            Notify::resolve($p, 'incident-assess-' . $inc['id']);
            Actions::load('Trips');
            if ($sev === 'Major') {
                Trips::setStatus($p, $u['id'], $t, 'For Reschedule', 'major damage: truck returned for repair', $inc['incident_ref'] . ($exp ? '; expected back ' . $exp : ''));
                $now = FleetState::reconcile($p, (int)$j['vehicle_id'], $u['id'], 'Major damage ' . $inc['incident_ref']);
                Notify::roles($p, [$t['dispatcher_role'], 'operations_head'], 'Major damage', $t['trip_ref'] . ' is For Reschedule. Truck is ' . $now . ($exp ? ' (expected back ' . $exp . ')' : '') . '.', 'trips');
                return ['message' => 'Assessed as MAJOR. ' . $m['full_name'] . ' is assigned. Truck is ' . $now . ' and the trip is For Reschedule.'];
            }
            Trips::event($p, $u['id'], (int)$t['id'], 'minor damage: mechanic sent to the location', $t['status'], $t['status'], $inc['incident_ref'] . '; ' . $m['full_name']);
            Notify::roles($p, [$t['dispatcher_role'], 'operations_head'], 'Minor damage', $t['trip_ref'] . ': ' . $m['full_name'] . ' sent for on-site repair.', 'trips');
            return ['message' => 'Assessed as MINOR. ' . $m['full_name'] . ' is sent to the location. Record the findings, the repair, then verify the truck.'];
        });
    }

    /** Inspection findings + diagnosis. Under Inspection -> Under Repair. */
    private static function inspect(array $u, array $d): array {
        requireRole($u, ...self::ACT);
        $id = idField($d, 'job_id');
        $findings = field($d, 'findings', 2000);
        $diagnosis = field($d, 'diagnosis', 2000);
        $exp = dateField($d, 'expected_completion', false);
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
        $done = dateField($d, 'completed_on');
        must($done <= date('Y-m-d'), 'Completion date cannot be in the future.');
        $remarks = optField($d, 'remarks', 500);
        return transaction(function (PDO $p) use ($u, $id, $performed, $done, $remarks) {
            $j = self::lockJob($p, $id);
            must($j['status'] === 'Under Repair', $j['status'] === 'Under Inspection' ? 'Record the inspection findings and diagnosis first.' : 'Only records Under Repair can be completed (now: ' . $j['status'] . ').', 409);
            must($done >= (string)$j['reported_on'], 'Completion date is before the date reported.');
            Files::store($p, $u, 'evidence', 'maintenance', $id, 'Repair Evidence');
            must(Files::count($p, 'maintenance', $id, 'Repair Evidence') > 0, 'Attach at least one photo or document as evidence of the repair.', 422);
            run($p, "UPDATE maintenance_jobs SET status='Completed', repair_performed=?, completed_on=?, remarks=COALESCE(?, remarks), completed_by=?, completed_at=NOW() WHERE id=?",
                [$performed, $done, $remarks, $u['id'], $id]);
            self::refreshMechanic($p, $j['mechanic_id'] ? (int)$j['mechanic_id'] : null);
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
        return transaction(function (PDO $p) use ($u, $id, $result, $notes, $mechanicId) {
            $j = self::lockJob($p, $id);
            must($j['status'] === 'Completed' && !$j['verified_at'], 'Only completed repairs waiting for verification can be verified.', 409);
            $v = one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$j['vehicle_id']]);
            if ($result === 'Failed') {
                $mid = $mechanicId ?: (int)$j['mechanic_id'];
                must($mid > 0, 'Choose the mechanic who will continue the repair.');
                self::freeMechanic($p, $mid, (int)$j['id']);
                run($p, "UPDATE maintenance_jobs SET status='Under Repair', completed_on=NULL, completed_by=NULL, completed_at=NULL WHERE id=?", [$id]);
                self::setMechanic($p, self::lockJob($p, $id), $mid);
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
            Actions::load('Trips');
            if ($j['source'] === 'Incident') {
                $inc = one($p, 'SELECT * FROM incidents WHERE id=? FOR UPDATE', [$j['incident_id']]);
                $t = one($p, 'SELECT * FROM trips WHERE id=?', [$j['trip_id']]);
                if ($j['severity'] === 'Minor') {
                    run($p, "UPDATE incidents SET status='Repaired - Cleared to Continue' WHERE id=?", [$inc['id']]);
                    Trips::event($p, $u['id'], (int)$t['id'], 'repaired - cleared to continue', $t['status'], $t['status'], $inc['incident_ref']);
                    Notify::roles($p, [$t['dispatcher_role']], 'Cleared to continue', $t['trip_ref'] . ': truck repaired on site. Resume the trip.', 'trips', 'trip-resume-' . $inc['id']);
                    $msg .= ' The dispatcher was told to resume the trip.';
                } else {
                    run($p, "UPDATE incidents SET status='Resolved', resolved_at=NOW() WHERE id=?", [$inc['id']]);
                    Trips::event($p, $u['id'], (int)$t['id'], 'truck repaired after major damage', $t['status'], $t['status'], $inc['incident_ref']);
                    Notify::roles($p, [$t['dispatcher_role'], 'operations_head'], 'Truck available again', $v['plate_number'] . ' is repaired. Reschedule ' . $t['trip_ref'] . '.', 'trips', 'trip-reschedule-' . $inc['id']);
                    $msg .= ' The dispatcher can now reschedule the trip.';
                }
            } else {
                Notify::roles($p, ['operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher'], 'Truck available again', $v['plate_number'] . ' was repaired, verified and is ' . $now . '.', 'trucks');
                if ($auto = Trips::assignWaiting($p, $u)) $msg .= ' ' . $auto;
            }
            return ['message' => $msg];
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
            self::event($p, $id, $j['status'], 'Cancelled', $u['id'], $reason);
            $now = FleetState::reconcile($p, (int)$j['vehicle_id'], $u['id'], 'Maintenance cancelled ' . $j['job_ref']);
            audit($p, $u['id'], 'Maintenance', 'job ' . $id, 'maintenance cancelled', $j['job_ref'] . ': ' . $reason);
            Notify::resolve($p, 'job-open-' . $id);
            Actions::load('Trips'); Trips::assignWaiting($p, $u);
            return ['message' => 'Record cancelled. Truck is ' . $now . '.'];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'maintenance') || Access::canOpen($u, 'trucks'), 'Not allowed.', 403);
        $id = idField($d, 'job_id'); $p = db();
        $j = one($p, 'SELECT m.*, v.plate_number, v.truck_number, v.truck_type, v.status AS truck_status, t.trip_ref, mc.full_name AS mechanic, mc.mechanic_code, mc.contact_number AS mechanic_contact,
                su.full_name AS started_by_name, cu.full_name AS completed_by_name, vu.full_name AS verified_by_name, ru.full_name AS reported_by_name
            FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN trips t ON t.id=m.trip_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id
            LEFT JOIN users su ON su.id=m.started_by LEFT JOIN users cu ON cu.id=m.completed_by LEFT JOIN users vu ON vu.id=m.verified_by LEFT JOIN users ru ON ru.id=m.created_by WHERE m.id=?', [$id]);
        must((bool)$j, 'Record not found.', 404);
        $inc = $j['incident_id'] ? one($p, 'SELECT i.*, ru.full_name AS reported_by_name, au.full_name AS assessed_by_name FROM incidents i JOIN users ru ON ru.id=i.reported_by LEFT JOIN users au ON au.id=i.assessed_by WHERE i.id=?', [$j['incident_id']]) : null;
        $docs = Files::of($p, 'maintenance', $id);
        if ($inc) foreach (Files::of($p, 'incident', (int)$inc['id']) as $doc) $docs[] = $doc;
        return [
            'job' => $j, 'incident' => $inc, 'documents' => $docs,
            'events' => many($p, 'SELECT e.*, u.full_name AS actor, mc.full_name AS mechanic FROM maintenance_events e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN mechanics mc ON mc.id=e.mechanic_id WHERE e.maintenance_job_id=? ORDER BY e.id', [$id]),
            'history' => many($p, 'SELECT m.id, m.job_ref, m.source, m.problem, m.status, m.reported_on, m.completed_on, mc.full_name AS mechanic FROM maintenance_jobs m LEFT JOIN mechanics mc ON mc.id=m.mechanic_id WHERE m.vehicle_id=? ORDER BY m.id DESC LIMIT 30', [$j['vehicle_id']]),
            'costs' => many($p, 'SELECT c.*, u.full_name AS recorded_by_name FROM maintenance_costs c JOIN users u ON u.id=c.recorded_by WHERE c.maintenance_job_id=? ORDER BY c.id', [$id]),
            'parts' => many($p, 'SELECT r.request_ref, r.status, pt.part_number, pt.description, l.quantity, l.released_qty, l.unit_cost FROM part_requests r
                JOIN part_request_lines l ON l.part_request_id=r.id JOIN parts pt ON pt.id=l.part_id WHERE r.maintenance_job_id=? ORDER BY r.id, l.id', [$id]),
        ];
    }
}
