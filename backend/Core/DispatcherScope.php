<?php
declare(strict_types=1);

/** Operational authorization from authenticated roles and existing regular vehicle links. */
final class DispatcherScope {
    public static function types(array $u): array {
        must(roleIsDispatcher($u['role']), 'Only dispatchers can use this operation.', 403);
        $configured = $u['dispatcher_truck_types'] ?? null;
        if (is_string($configured) && $configured !== '') {
            $values = json_decode($configured, true);
            if (is_array($values)) {
                $types = array_values(array_unique(array_filter($values, fn($t) => is_string($t) && in_array($t, TRUCK_TYPES, true))));
                if ($types) return $types;
            }
        }
        $roleTypes = $u['role'] === 'car_carrier_dispatcher' ? ['Car Carrier'] : ['Container', 'Wing Van'];
        $selected = $u['dispatcher_truck_type'] ?? null;
        return $selected !== null && in_array($selected, $roleTypes, true) ? [$selected] : $roleTypes;
    }
    /** Use the trip's historical operational group for attendance and fixed crew rules,
     * while retaining the same authenticated Dispatcher identity. */
    public static function forTruckType(array $u, string $truckType): array {
        must(in_array($truckType, self::types($u), true),
            'This Dispatcher is not assigned to that truck type.', 403);
        $scoped = $u;
        $scoped['role'] = dispatcherRoleFor($truckType);
        $scoped['dispatcher_truck_type'] = $truckType;
        $scoped['dispatcher_truck_types'] = json_encode([$truckType], JSON_THROW_ON_ERROR);
        return $scoped;
    }
    public static function tripSql(array $u, string $alias = 't'): array {
        $types = self::types($u); $marks = implode(',', array_fill(0, count($types), '?'));
        return [" AND $alias.truck_type IN ($marks) AND EXISTS(SELECT 1 FROM trip_responsibilities resp WHERE resp.trip_id=$alias.id AND resp.current_dispatcher_id=?)", [...$types, $u['id']]];
    }
    public static function permitsTrip(array $u, array $t): bool {
        $types = self::types($u);
        return in_array($t['truck_type'] ?? null, $types, true)
            && (int)($t['responsible_dispatcher_id'] ?? $t['current_dispatcher_id'] ?? 0) === (int)$u['id'] && (int)$u['id']>0;
    }
    /** Drivers are scoped by explicit vehicle authorization; Helpers keep their
     * existing exclusive regular operational-group links. */
    public static function personnelSql(array $u, string $alias = 'pe'): array {
        $types=self::types($u);
        $marks=implode(',',array_fill(0,count($types),'?'));
        $driver="({$alias}.person_type='Driver' AND EXISTS (
            SELECT 1 FROM driver_truck_authorizations da
            JOIN vehicles av ON av.id=da.vehicle_id
            WHERE da.driver_id={$alias}.id AND av.active=1 AND av.truck_type IN ($marks)
        ))";
        $helper="({$alias}.person_type='Helper' AND EXISTS (
            SELECT 1 FROM vehicles sv WHERE sv.active=1 AND sv.assigned_helper_id={$alias}.id AND sv.truck_type IN ($marks)
        ) AND NOT EXISTS (
            SELECT 1 FROM vehicles sv WHERE sv.active=1 AND sv.assigned_helper_id={$alias}.id AND sv.truck_type NOT IN ($marks)
        ))";
        return [" AND ($driver OR $helper)",[...$types,...$types,...$types]];
    }
    /** Attendance follows verified truck links, never a manually selected group.
     * Drivers use authorized trucks; Helpers use the exclusive regular truck.
     * Personnel without a truck association are not yet eligible for a Dispatcher roster.
     */
    public static function attendanceGroupReady(PDO $p): bool {
        return (bool)one($p, "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='personnel' AND COLUMN_NAME='attendance_group'");
    }
    public static function attendancePersonnelSql(array $u, string $alias = 'pe', ?PDO $p = null): array {
        return self::personnelSql($u, $alias);
    }
    public static function attendancePerson(PDO $p, array $u, int $id, bool $lock = false): array {
        [$scope, $args] = self::attendancePersonnelSql($u, 'pe', $p);
        $pe = one($p, "SELECT pe.id,pe.full_name,pe.person_type,pe.duty_shift,pe.availability,pe.license_expiry,pe.active
            FROM personnel pe WHERE pe.id=? $scope" . ($lock ? ' FOR UPDATE' : ''), [$id, ...$args]);
        must((bool)$pe, 'Personnel has no verified attendance group for this Dispatcher.', 403);
        return $pe;
    }

    public static function person(PDO $p, array $u, int $id, bool $lock = false): array {
        [$scope,$args] = self::personnelSql($u);
        $pe = one($p, "SELECT pe.id,pe.full_name,pe.person_type,pe.duty_shift,pe.availability,pe.license_expiry,pe.active FROM personnel pe WHERE pe.id=? $scope" . ($lock ? ' FOR UPDATE' : ''), [$id,...$args]);
        must((bool)$pe, 'This personnel record is outside your authorized operational group or has no verified group link.', 403);
        return $pe;
    }
    public static function truck(PDO $p, array $u, int $id): array {
        $types = self::types($u); $marks = implode(',', array_fill(0,count($types),'?'));
        $v = one($p,"SELECT id,plate_number,truck_type,assigned_driver_id,assigned_helper_id,status,active FROM vehicles WHERE id=? AND truck_type IN ($marks)",[$id,...$types]);
        must((bool)$v,'This truck belongs to another operational group.',403);
        return $v;
    }
}
