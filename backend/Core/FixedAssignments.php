<?php
declare(strict_types=1);

/** Permanent pairing has one source of truth: vehicles.assigned_driver_id / assigned_helper_id. */
final class FixedAssignments {
    public static function validateTruck(PDO $p, ?int $vehicleId, array $row, ?array $old = null): void {
        $changed = !$old || (int)$old['assigned_driver_id'] !== (int)$row['assigned_driver_id']
            || (int)$old['assigned_helper_id'] !== (int)$row['assigned_helper_id'] || $old['truck_type'] !== $row['truck_type'];
        $ids = array_values(array_unique(array_filter([(int)($old['assigned_driver_id'] ?? 0), (int)$row['assigned_driver_id'], (int)$row['assigned_helper_id']])));
        sort($ids);
        foreach ($ids as $id) one($p, 'SELECT id FROM personnel WHERE id=? FOR UPDATE', [$id]);
        if ($changed && $vehicleId) must(!FleetState::activeTrip($p, $vehicleId), 'Permanent assignments cannot change while this truck holds an active or returning trip.', 409);
        foreach (['assigned_driver_id' => 'Driver', 'assigned_helper_id' => 'Helper'] as $key => $type) {
            if (empty($row[$key])) continue;
            must((bool)one($p, 'SELECT id FROM personnel WHERE id=? AND person_type=? AND active=1', [$row[$key], $type]), "Choose an active $type.", 409);
            if ($changed) must(!one($p, "SELECT trip_id FROM trip_assignments WHERE resource_type='person' AND resource_id=?", [$row[$key]]), 'This person is held by an active trip. Complete or release that trip before permanent reassignment.', 409);
        }
        if (!empty($row['assigned_driver_id'])) {
            must(!one($p, 'SELECT id FROM vehicles WHERE active=1 AND assigned_driver_id=? AND id<>? FOR UPDATE', [$row['assigned_driver_id'], $vehicleId ?? 0]), 'This driver already has an active fixed truck. Use the Driver masterlist to reassign the pair.', 409);
        }
        if (!empty($row['assigned_helper_id'])) {
            $group = dispatcherRoleFor($row['truck_type']);
            foreach (many($p, 'SELECT truck_type FROM vehicles WHERE active=1 AND assigned_helper_id=? AND id<>?', [$row['assigned_helper_id'], $vehicleId ?? 0]) as $v) {
                must(dispatcherRoleFor($v['truck_type']) === $group, 'The helper is permanently linked to another operational group.', 409);
            }
        }
    }

    public static function forDriver(PDO $p, array $u, int $driverId, ?int $vehicleId, ?int $helperId): void {
        $driver = one($p, 'SELECT id,person_type,active FROM personnel WHERE id=? FOR UPDATE', [$driverId]);
        must($driver && $driver['person_type'] === 'Driver' && (int)$driver['active'] === 1, 'Choose an active Driver.', 409);
        must($vehicleId !== null, 'Select an existing Fixed Truck from Truck Masterlist.');
        $links = many($p, 'SELECT * FROM vehicles WHERE active=1 AND (assigned_driver_id=? OR id=?) ORDER BY id FOR UPDATE', [$driverId, $vehicleId]);
        $target = null;
        foreach ($links as $link) if ((int)$link['id'] === $vehicleId) $target = $link;
        must($target !== null, 'Select an active existing Truck.', 409);
        must(!$target['assigned_driver_id'] || (int)$target['assigned_driver_id'] === $driverId, 'That Truck already has another fixed Driver. Release its permanent pairing first.', 409);
        if ($target['truck_type'] !== 'Car Carrier') must($helperId !== null, 'Select a Regular Helper for this Truck.');
        else must($helperId === null, 'Car Carrier keeps its existing two-driver workflow; a regular Helper is not used.');
        if (count($links) === 1 && (int)$target['assigned_driver_id'] === $driverId && (int)$target['assigned_helper_id'] === (int)$helperId) return;
        $new = array_merge($target, ['assigned_driver_id' => $driverId, 'assigned_helper_id' => $helperId]);
        // Validate the move after excluding this driver's previous links; these are released in the same transaction.
        foreach ($links as $link) {
            $changes = (int)$link['id'] !== $vehicleId || (int)$link['assigned_helper_id'] !== (int)$helperId;
            if ($changes) must(!FleetState::activeTrip($p, (int)$link['id']), 'A fixed pair cannot move while its truck holds an active or returning trip.', 409);
        }
        must(!one($p, "SELECT trip_id FROM trip_assignments WHERE resource_type='person' AND resource_id=?", [$driverId]), 'The Driver is held by an active trip; permanent reassignment is blocked.', 409);
        foreach ($links as $link) if ((int)$link['id'] !== $vehicleId && (int)$link['assigned_driver_id'] === $driverId) {
            run($p, 'UPDATE vehicles SET assigned_driver_id=NULL WHERE id=?', [$link['id']]);
            auditWithChanges($p, $u['id'], 'Fleet', 'vehicle '.$link['id'], 'fixed driver released', 'Permanent reassignment through Driver masterlist', ['Regular driver' => $driverId], ['Regular driver' => null]);
        }
        self::validateTruck($p, $vehicleId, $new, $target);
        run($p, 'UPDATE vehicles SET assigned_driver_id=?,assigned_helper_id=? WHERE id=?', [$driverId, $helperId, $vehicleId]);
        auditWithChanges($p, $u['id'], 'Fleet', 'vehicle '.$vehicleId, 'fixed assignment saved', 'Permanent Driver/Helper assignment',
            ['Regular driver' => $target['assigned_driver_id'], 'Regular helper' => $target['assigned_helper_id']], ['Regular driver' => $driverId, 'Regular helper' => $helperId]);
    }
}
