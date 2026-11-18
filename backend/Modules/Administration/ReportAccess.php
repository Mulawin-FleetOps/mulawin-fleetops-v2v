<?php
/* Admin-managed, default-deny REPORT PAGE permissions.
 * All existing reports remain in their original backend modules.
 * This component controls page access and sidebar visibility, never calculations.
 */
declare(strict_types=1);

final class ReportAccess {
    public const PAGES = [
        'reports' => 'Original Department Reports',
        'operations_reports' => 'Operations Reports',
        'financial_reports' => 'Financial Reports',
        'billing_reports' => 'Billing Reports',
        'maintenance_reports' => 'Maintenance Reports',
        'purchasing_reports' => 'Purchasing Reports',
        'audit_reports' => 'Audit Reports',
        'admin_reports' => 'Executive Reports',
        'admin_analytics' => 'Analytics',
        'admin_descriptive_analytics' => 'Descriptive Analytics',
        'admin_diagnostic_analytics' => 'Diagnostic Analytics',
    ];

    /** Existing admin-only analytics contain executive information and stay admin-only. */
    public const DELEGATABLE = ['reports','operations_reports','maintenance_reports','purchasing_reports','financial_reports','billing_reports','audit_reports'];

    private static function installed(): bool {
        try {
            return (bool)one(db(), "SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='report_access_grants'");
        } catch (Throwable $e) { error_log('Report access schema check: '.$e->getMessage()); return false; }
    }

    public static function allowed(array $u, string $page): bool {
        if (!isset(self::PAGES[$page])) return false;
        if (($u['role'] ?? '') === 'admin') return true;
        if (!in_array($page, self::DELEGATABLE, true) || !self::installed()) return false;
        try {
            $rows = many(db(), 'SELECT subject_type, allowed FROM report_access_grants
                WHERE report_page=? AND ((subject_type=? AND subject_key=?) OR (subject_type=? AND subject_key=?))',
                [$page,'user',(string)(int)$u['id'],'role',(string)$u['role']]);
            $byType = [];
            foreach ($rows as $row) $byType[$row['subject_type']] = (bool)$row['allowed'];
            // An explicit user denial overrides an allowed role default.
            return $byType['user'] ?? $byType['role'] ?? false;
        } catch (Throwable $e) {
            error_log('Report access evaluation failed: '.$e->getMessage());
            return false;
        }
    }

    public static function any(array $u): bool {
        if (($u['role'] ?? '') === 'admin') return true;
        foreach (self::DELEGATABLE as $page) if (self::allowed($u, $page)) return true;
        return false;
    }

    public static function read(array $u, string $page, array $q): array {
        must($page === 'reports_center', 'Unknown reports page.', 404);
        $available = [];
        foreach (self::PAGES as $id => $label) {
            if (self::allowed($u, $id)) $available[] = ['page'=>$id,'label'=>$label];
        }
        $result = ['reports'=>$available, 'admin'=>($u['role'] ?? '') === 'admin'];
        if (!$result['admin']) return $result;
        $result['roles'] = ROLE_LABELS;
        $result['users'] = many(db(), 'SELECT id, full_name, username, role, active FROM users WHERE active=1 ORDER BY full_name');
        $result['grantable'] = array_map(fn($id) => ['page'=>$id, 'label'=>self::PAGES[$id]], self::DELEGATABLE);
        $result['installed'] = self::installed();
        $result['grants'] = $result['installed'] ? many(db(), 'SELECT subject_type, subject_key, report_page, allowed, updated_at FROM report_access_grants ORDER BY subject_type, subject_key, report_page') : [];
        return $result;
    }

    public static function action(array $u, string $action, array $data): array {
        requireRole($u, 'admin');
        must(in_array($action, ['set_grant','clear_grant'], true), 'Unknown report access action.', 404);
        must(self::installed(), 'Run the report access migration before assigning permissions.', 503);
        $type = (string)($data['subject_type'] ?? '');
        $key = (string)($data['subject_key'] ?? '');
        $page = (string)($data['report_page'] ?? '');
        $allowed = $data['allowed'] ?? null;
        must(in_array($type, ['role','user'], true), 'Invalid recipient type.');
        must(in_array($page, self::DELEGATABLE, true), 'This report is reserved for Admin.');
        if ($action === 'set_grant') must(in_array($allowed, [true,false,0,1,'0','1'], true), 'Invalid access value.');
        if ($type === 'role') {
            must(isset(ROLE_LABELS[$key]) && $key !== 'admin', 'Invalid role.');
        } else {
            must(ctype_digit($key) && (int)$key > 0, 'Invalid user.');
            $target = one(db(), 'SELECT id, role, active FROM users WHERE id=?', [(int)$key]);
            must($target && (int)$target['active'] === 1 && $target['role'] !== 'admin', 'User is not an active non-admin account.');
        }
        $value = (int)(bool)$allowed;
        $pdo = db();
        $pdo->beginTransaction();
        try {
            if ($action === 'clear_grant') {
                run($pdo, 'DELETE FROM report_access_grants WHERE subject_type=? AND subject_key=? AND report_page=?', [$type,$key,$page]);
            } else {
                run($pdo, 'INSERT INTO report_access_grants(subject_type,subject_key,report_page,allowed,updated_by)
                    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE allowed=VALUES(allowed), updated_by=VALUES(updated_by), updated_at=CURRENT_TIMESTAMP',
                    [$type,$key,$page,$value,(int)$u['id']]);
            }
            audit($pdo, (int)$u['id'], 'Report Access', $type.':'.$key,
                $action === 'clear_grant' ? 'RESET' : ($value ? 'GRANT' : 'REVOKE'),
                $page.' permission updated');
            $pdo->commit();
        } catch(Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        return ['ok'=>true,'message'=>'Report permission saved.','allowed'=>(bool)$value];
    }
}
