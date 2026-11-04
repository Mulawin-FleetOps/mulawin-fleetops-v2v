<?php
/*
 * backend/Data.php  —  session information for the screen
 * Returns who is signed in, the sidebar pages for the role and the
 * latest notifications. Page data is loaded separately per page by
 * Actions::pageData(), so one broken page never blocks the others.
 */
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

final class Data {
    public static function me(): array {
        core('Access');
        $u = currentUser();
        $bell = ['items' => [], 'unread' => 0, 'active' => 0];
        try { core('Notify'); $bell = Notify::forUser(db(), $u['id']); }
        catch (Throwable $e) { error_log('Notifications unavailable: ' . $e->getMessage()); }
        // Admin: is there a recovery code already?
        if ($u['role'] === 'admin') { core('AccountSecurity'); $u['recovery_ready'] = AccountSecurity::hasRecovery($u['id']); }
        $u['has_signature'] = (bool)(one(db(), 'SELECT signature_document_id FROM users WHERE id=?', [$u['id']])['signature_document_id'] ?? null);
        return [
            'ok' => true, 'user' => $u, 'csrf' => $_SESSION['csrf'] ?? '',
            'nav' => Access::navFor($u), 'sections' => Access::SECTIONS,
            'notifications' => $bell['items'], 'unread' => $bell['unread'], 'activeNotifications' => $bell['active'],
            'mapKey' => envValue('MAPTILER_API_KEY'), 'mapStyle' => envValue('MAPTILER_STYLE', 'streets-v4') ?: 'streets-v4',
            'company' => ['name' => envValue('COMPANY_NAME', 'R P MULAWIN TRUCKING SERVICE'),
                          'address' => envValue('COMPANY_ADDRESS', '#086-A Purok 2 Brgy. Luyos Tanauan City, Batangas')],
            'truckTypes' => TRUCK_TYPES, 'passwordMin' => PASSWORD_MIN_LENGTH, 'roles' => ROLE_LABELS,
        ];
    }
}
