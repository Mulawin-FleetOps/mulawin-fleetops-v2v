<?php
declare(strict_types=1);

/** One manually selected operational group/shift per Operations Head planning entry. */
final class DispatcherPlanning {
    public const SHIFTS = ['Day', 'Night'];
    public static function groups(): array {
        $out = [];
        foreach (array_unique(array_map('dispatcherRoleFor', TRUCK_TYPES)) as $role) foreach (self::SHIFTS as $shift) {
            $out[] = ['role' => $role, 'shift' => $shift, 'key' => $role.':'.$shift, 'label' => ROLE_LABELS[$role].' - '.$shift];
        }
        return $out;
    }
    public static function assignment(string $type, mixed $selection): array {
        must(in_array($type, TRUCK_TYPES, true), 'Choose a valid truck type.');
        must(is_string($selection) && $selection !== '', 'Choose a dispatcher group and shift for every trip entry.');
        $parts = explode(':', $selection);
        must(count($parts) === 2 && in_array($parts[1], self::SHIFTS, true), 'Choose a supported Day or Night dispatcher.');
        must($parts[0] === dispatcherRoleFor($type), 'The selected dispatcher group does not handle this truck type.');
        return ['dispatcher_role' => $parts[0], 'dispatcher_shift' => $parts[1]];
    }
}
