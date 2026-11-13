<?php
declare(strict_types=1);

/** Operational authorization from authenticated roles and existing regular vehicle links. */
final class DispatcherScope {
    public static function types(array $u): array {
        must(roleIsDispatcher($u['role']), 'Only dispatchers can use this operation.', 403);
        return $u['role'] === 'car_carrier_dispatcher' ? ['Car Carrier'] : ['Container', 'Wing Van'];
    }
    public static function tripSql(array $u, string $alias = 't'): array {
        $types = self::types($u); $marks = implode(',', array_fill(0, count($types), '?'));
        return [" AND $alias.dispatcher_role=? AND $alias.truck_type IN ($marks) AND EXISTS(SELECT 1 FROM trip_responsibilities resp WHERE resp.trip_id=$alias.id AND resp.current_dispatcher_id=?)", [$u['role'], ...$types, $u['id']]];
    }
    public static function permitsTrip(array $u, array $t): bool {
        $types = self::types($u);
        return ($t['dispatcher_role'] ?? null) === $u['role'] && in_array($t['truck_type'] ?? null, $types, true)
            && (int)($t['responsible_dispatcher_id'] ?? $t['current_dispatcher_id'] ?? 0) === (int)$u['id'] && (int)$u['id']>0;
    }
    /** No shared/unmapped pool: a person needs an exclusive, existing regular link to this group. */
    public static function personnelSql(array $u, string $alias = 'pe'): array {
        $types = self::types($u); $marks = implode(',', array_fill(0, count($types), '?'));
        $link = "(({$alias}.person_type='Driver' AND sv.assigned_driver_id=$alias.id) OR ({$alias}.person_type='Helper' AND sv.assigned_helper_id=$alias.id))";
        return [" AND $alias.person_type IN (" . ($u['role'] === 'car_carrier_dispatcher' ? "'Driver'" : "'Driver','Helper'") . ")
            AND EXISTS (SELECT 1 FROM vehicles sv WHERE sv.active=1 AND $link AND sv.truck_type IN ($marks))
            AND NOT EXISTS (SELECT 1 FROM vehicles sv WHERE sv.active=1 AND $link AND sv.truck_type NOT IN ($marks))", [...$types, ...$types]];
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
