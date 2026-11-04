<?php
/*
 * =====================================================================
 *  backend/Core/FleetState.php  —  ONE set of availability rules
 * =====================================================================
 *  Used by Trips, Maintenance and Fleet so the same rule applies everywhere.
 *
 *  TRUCK status (PDF #11 II.B): Available, Assigned, On Trip, Under Maintenance, Unavailable
 *  CREW availability:            Available, On Trip, Unavailable
 *
 *  How availability is kept correct:
 *   1. trip_assignments table: one row per truck/person held by an active trip.
 *      Its PRIMARY KEY makes the DATABASE refuse a second active trip for the
 *      same truck or person (double-booking safeguard).
 *   2. reconcile() recomputes a truck's status from the facts (open repair,
 *      trip on the road, reserved trip, manual Unavailable) after every change,
 *      so the status shown on screen always matches the records.
 * =====================================================================
 */
declare(strict_types=1);

final class FleetState {
    public const STATUSES = ['Available', 'Assigned', 'On Trip', 'Under Maintenance', 'Unavailable'];
    /** Trip statuses where the truck is out on the road. */
    public const ON_ROAD = ['Dispatched', 'On Hold - Incident Reported', 'In Transit'];
    /** Trip statuses that hold a truck and crew (reserved or on the road). */
    public const HOLDING = ['Pre-Assigned', 'Ready for Dispatch', 'Dispatched', 'On Hold - Incident Reported', 'In Transit', 'For Reschedule'];

    /** Changes a truck status and writes the status log (downtime analytics). */
    public static function setStatus(PDO $p, int $vehicleId, string $to, ?int $actorId, string $reason = ''): void {
        must(in_array($to, self::STATUSES, true), 'Invalid truck status.');
        $v = one($p, 'SELECT status FROM vehicles WHERE id=? FOR UPDATE', [$vehicleId]);
        must((bool)$v, 'Truck not found.', 404);
        if ($v['status'] === $to) return;
        run($p, 'UPDATE vehicles SET status=? WHERE id=?', [$to, $vehicleId]);
        $p->prepare('INSERT INTO vehicle_status_log (vehicle_id, from_status, to_status, reason, actor_id) VALUES (?,?,?,?,?)')
          ->execute([$vehicleId, $v['status'], $to, cut($reason, 255), $actorId]);
    }

    /** The active trip holding a truck (on-the-road trip first). */
    public static function activeTrip(PDO $p, int $vehicleId): ?array {
        return one($p, "SELECT t.id, t.status, t.trip_ref FROM trip_assignments a JOIN trips t ON t.id=a.trip_id
                        WHERE a.resource_type='vehicle' AND a.resource_id=? LIMIT 1", [$vehicleId]);
    }

    /** Unresolved corrective maintenance record of a truck (not cancelled and not yet verified). */
    public static function openJob(PDO $p, int $vehicleId): ?array {
        return one($p, "SELECT id, job_ref, source, severity, status FROM maintenance_jobs WHERE vehicle_id=? AND open_key=1 LIMIT 1", [$vehicleId]);
    }

    /**
     * Recomputes the status a truck should have:
     *   unresolved repair record    -> Under Maintenance, until the repair is VERIFIED
     *                                  (an incident not yet assessed, or a Minor roadside repair, keeps it On Trip)
     *   trip on the road            -> On Trip
     *   reserved for a trip         -> Assigned
     *   manually Unavailable        -> stays Unavailable
     *   otherwise                   -> Available
     *  "Under Maintenance" always has an open maintenance job behind it, so the
     *  status can never stay stuck after the repair is confirmed.
     */
    public static function reconcile(PDO $p, int $vehicleId, ?int $actorId, string $reason): string {
        $v = one($p, 'SELECT status FROM vehicles WHERE id=? FOR UPDATE', [$vehicleId]);
        must((bool)$v, 'Truck not found.', 404);
        $trip = self::activeTrip($p, $vehicleId);
        $job = one($p, "SELECT id FROM maintenance_jobs WHERE vehicle_id=? AND open_key=1
                        AND NOT (source='Incident' AND (severity IS NULL OR severity='Minor')) LIMIT 1", [$vehicleId]);
        if ($job) $next = 'Under Maintenance';
        elseif ($trip && in_array($trip['status'], self::ON_ROAD, true)) $next = 'On Trip';
        elseif ($trip) $next = 'Assigned';
        elseif ($v['status'] === 'Unavailable') $next = 'Unavailable';
        else $next = 'Available';
        self::setStatus($p, $vehicleId, $next, $actorId, $reason);
        return $next;
    }

    /**
     * Holds the truck and crew for a trip. Old rows of the trip are removed first.
     * A duplicate key here means another active trip already holds the resource.
     */
    public static function hold(PDO $p, int $tripId, int $vehicleId, array $people): void {
        self::release($p, $tripId);
        $ins = $p->prepare('INSERT INTO trip_assignments (resource_type, resource_id, trip_id, role) VALUES (?,?,?,?)');
        try {
            $ins->execute(['vehicle', $vehicleId, $tripId, 'truck']);
            foreach ($people as $role => $pid) if ($pid) $ins->execute(['person', (int)$pid, $tripId, $role]);
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) throw new BusinessRuleException('Double booking blocked: the truck or one of the crew is already on another active trip.', 409);
            throw $e;
        }
        foreach ($people as $pid) if ($pid) run($p, "UPDATE personnel SET availability='On Trip' WHERE id=? AND availability='Available'", [(int)$pid]);
    }

    /** Frees the truck and crew of a trip (completed, cancelled, re-assigned). Returns the freed truck id. */
    public static function release(PDO $p, int $tripId): ?int {
        $rows = many($p, 'SELECT resource_type, resource_id FROM trip_assignments WHERE trip_id=?', [$tripId]);
        run($p, 'DELETE FROM trip_assignments WHERE trip_id=?', [$tripId]);
        $vehicle = null;
        foreach ($rows as $r) {
            if ($r['resource_type'] === 'vehicle') { $vehicle = (int)$r['resource_id']; continue; }
            run($p, "UPDATE personnel SET availability='Available' WHERE id=? AND availability='On Trip'", [(int)$r['resource_id']]);
        }
        return $vehicle;
    }

    /** Is the person free for a new trip? Returns null when free, otherwise the reason. */
    public static function personBlocker(PDO $p, int $personId, ?int $exceptTrip = null): ?string {
        $pe = one($p, 'SELECT full_name, active, availability, person_type, license_expiry FROM personnel WHERE id=?', [$personId]);
        if (!$pe || !(int)$pe['active']) return 'not an active driver/helper';
        if ($pe['availability'] === 'Unavailable') return $pe['full_name'] . ' is marked Unavailable';
        $a = one($p, "SELECT t.trip_ref, a.trip_id FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='person' AND a.resource_id=?", [$personId]);
        if ($a && (int)$a['trip_id'] !== (int)$exceptTrip) return $pe['full_name'] . ' is already on ' . $a['trip_ref'];
        if ($pe['person_type'] === 'Driver' && $pe['license_expiry'] && $pe['license_expiry'] < date('Y-m-d')) return $pe['full_name'] . "'s license is expired";
        return null;
    }

    /** Is the truck free for a new trip? Returns null when free, otherwise the reason. */
    public static function truckBlocker(PDO $p, int $vehicleId, ?int $exceptTrip = null): ?string {
        $v = one($p, 'SELECT plate_number, active, status FROM vehicles WHERE id=?', [$vehicleId]);
        if (!$v || !(int)$v['active']) return 'not an active truck';
        if (in_array($v['status'], ['Under Maintenance', 'Unavailable'], true)) return $v['plate_number'] . ' is ' . $v['status'];
        if ($j = self::openJob($p, $vehicleId)) return $v['plate_number'] . ' has an unresolved repair (' . $j['job_ref'] . ', ' . $j['status'] . ($j['status'] === 'Completed' ? ', waiting for verification' : '') . ')';
        $a = one($p, "SELECT t.trip_ref, a.trip_id FROM trip_assignments a JOIN trips t ON t.id=a.trip_id WHERE a.resource_type='vehicle' AND a.resource_id=?", [$vehicleId]);
        if ($a && (int)$a['trip_id'] !== (int)$exceptTrip) return $v['plate_number'] . ' is already on ' . $a['trip_ref'];
        return null;
    }
}
