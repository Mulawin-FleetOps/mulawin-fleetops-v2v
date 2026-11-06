<?php
/* S4A phase 1: restrict e-signatures to owner or signatories of records
 * available to the viewer's current role. Final record-specific links
 * should additionally bind the signature URL to a record ID. */
declare(strict_types=1);

final class SignatureAccess {
    public static function canView(array $viewer, int $signerId): bool {
        $self = (int)($viewer['id'] ?? 0);
        if ($self <= 0 || $signerId <= 0) return false;
        if ($self === $signerId) return true;
        core('Access');
        $role = (string)($viewer['role'] ?? '');
        // Each check is restricted to a business document the viewer's
        // role can open. Do not use 'all authenticated users' as a policy.
        if (Access::canOpen($viewer, 'purchasing')) {
            if (self::exists('SELECT id FROM purchase_orders WHERE requested_by=? OR decided_by=? LIMIT 1', [$signerId, $signerId])) return true;
            if (self::exists('SELECT id FROM part_requests WHERE requested_by=? OR processed_by=? LIMIT 1', [$signerId, $signerId])) return true;
        }
        if (Access::canOpen($viewer, 'funds')) {
            if (roleIsDispatcher($role)) {
                if (self::exists('SELECT f.id FROM fund_requests f JOIN trips t ON t.id=f.trip_id WHERE (f.requested_by=? OR f.approved_by=? OR f.released_by=?) AND (t.dispatcher_role=? OR f.requested_by=?) LIMIT 1',
                    [$signerId, $signerId, $signerId, $role, $self])) return true;
            } elseif (self::exists('SELECT id FROM fund_requests WHERE requested_by=? OR approved_by=? OR released_by=? LIMIT 1', [$signerId, $signerId, $signerId])) return true;
        }
        if (Access::canOpen($viewer, 'billing')) {
            if (self::exists('SELECT id FROM billings WHERE finalized_by=? LIMIT 1', [$signerId])) return true;
            if (self::exists('SELECT id FROM collections WHERE recorded_by=? LIMIT 1', [$signerId])) return true;
        }
        if (Access::canOpen($viewer, 'trips')) {
            if (roleIsDispatcher($role)) {
                if (self::exists('SELECT i.id FROM incidents i JOIN trips t ON t.id=i.trip_id WHERE (i.reported_by=? OR i.assessed_by=?) AND (t.dispatcher_role=? OR t.created_by=?) LIMIT 1',
                    [$signerId, $signerId, $role, $self])) return true;
            } elseif (self::exists('SELECT id FROM incidents WHERE reported_by=? OR assessed_by=? LIMIT 1', [$signerId, $signerId])) return true;
        }
        return false;
    }

    private static function exists(string $sql, array $params): bool {
        // Database errors must never grant access.
        return (bool)one(db(), $sql, $params);
    }
}
