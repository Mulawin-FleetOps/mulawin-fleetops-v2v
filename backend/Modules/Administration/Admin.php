<?php
/*
 * =====================================================================
 *  backend/Modules/Administration/Admin.php  —  HEAD MANAGEMENT: ADMINISTRATION
 * =====================================================================
 *  Objective 4.1  user accounts and role-based access (activate / deactivate)
 *  Objective 4.2  activity log: creation, modification, approval, processing
 *  PDF #11 V.65   backup of system data
 *  Also: system settings and fund request categories (Admin only),
 *        own password, Admin recovery code, e-signature for PO approvals.
 *  Audit can READ the activity log; every save here needs the Admin role.
 * =====================================================================
 */
declare(strict_types=1);
core('Mailer');
core('Settings');
core('AccountSecurity');
core('Files');
core('Notify');

final class Admin {
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        if ($page === 'notifications') return self::notificationsPage($u, $q);
        requireRole($u, 'admin', 'audit');
        $from = self::d((string)($q['from'] ?? '')) ?? date('Y-m-d', strtotime('-30 days'));
        $to = self::d((string)($q['to'] ?? '')) ?? date('Y-m-d');
        $w = 'WHERE DATE(a.created_at) BETWEEN ? AND ?'; $args = [$from, $to];
        if (!empty($q['area'])) { $w .= ' AND a.area=?'; $args[] = (string)$q['area']; }
        if (!empty($q['actor_id']) && ctype_digit((string)$q['actor_id'])) { $w .= ' AND a.actor_id=?'; $args[] = (int)$q['actor_id']; }
        $data = readSections([
            'events' => fn() => many($p, "SELECT a.*, COALESCE(us.full_name, 'System') AS actor, us.role, us.email AS actor_email, ac.changes_json
                FROM audit_events a LEFT JOIN users us ON us.id=a.actor_id
                LEFT JOIN audit_event_changes ac ON ac.audit_event_id=a.id
                $w ORDER BY a.id DESC LIMIT 3000", $args),
            'areas' => fn() => array_column(many($p, 'SELECT DISTINCT area FROM audit_events ORDER BY area'), 'area'),
            'actors' => fn() => many($p, 'SELECT id, full_name FROM users ORDER BY full_name'),
        ]);
        $data['range'] = ['from' => $from, 'to' => $to];
        if (hasRole($u, 'admin')) {
            $data = mergeSections($data, [
                'users' => fn() => many($p, 'SELECT id, username, email, full_name, role, shift, active, last_login_at, created_at, (signature_document_id IS NOT NULL) AS has_signature FROM users ORDER BY active DESC, role, full_name'),
                'fundCategories' => fn() => many($p, 'SELECT * FROM fund_categories ORDER BY sort_order, name'),
            ]);
            $data['settings'] = Settings::all();
            $dir = dirname(__DIR__, 3) . '/storage/backups';
            $data['backups'] = array_values(array_map(fn($f) => ['name' => basename($f), 'size' => filesize($f), 'date' => date('Y-m-d H:i', filemtime($f))],
                array_reverse(glob($dir . '/mulawin_backup_*.sql') ?: [])));
        }
        $data['roles'] = ROLE_LABELS;
        $data['can'] = ['admin' => hasRole($u, 'admin')];
        return $data;
    }
    private static function d(string $v): ?string { return ($v !== '' && DateTimeImmutable::createFromFormat('!Y-m-d', $v)) ? $v : null; }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'user_save' => self::withRoleSlotLock(fn() => self::userSave($u, $d)),
            'user_toggle' => self::withRoleSlotLock(fn() => self::userToggle($u, $d)),
            'user_password' => self::userPassword($u, $d),
            'change_password' => self::changePassword($u, $d),
            'recovery_code_create' => self::recoveryCodeCreate($u, $d),
            'signature_upload' => self::signatureUpload($u, $d),
            'setting_save' => self::settingSave($u, $d),
            'fund_category_save' => self::fundCategorySave($u, $d),
            'backup_create' => self::backupCreate($u),
            'notifications_read' => self::notificationsRead($u, $d),
            default => throw new BusinessRuleException('Unknown admin action.', 404),
        };
    }

    /** Password policy. $confirm = the "type it again" field; checked here on the server, never stored. */
    public static function strongPassword(string $pw, ?string $confirm = null): void {
        must(strlen($pw) >= PASSWORD_MIN_LENGTH, 'Password must have at least ' . PASSWORD_MIN_LENGTH . ' characters.');
        must(strlen($pw) <= PASSWORD_MAX_BYTES, 'Password is too long (max ' . PASSWORD_MAX_BYTES . ' characters).');
        if ($confirm !== null) must(hash_equals($pw, $confirm), 'The password and the confirmation do not match.');
        must(preg_match('/[A-Za-z]/', $pw) && preg_match('/\d/', $pw), 'Password must have letters and numbers.');
    }

    /** Adjustment: one active account per role/dispatcher shift (role-slot lock).
     * Serialize account actions to prevent concurrent requests claiming the same vacant slot.
     * Existing duplicates are kept untouched until Admin manually deactivates extras.
     */
    private static function withRoleSlotLock(callable $work): mixed {
        $p = db();
        $lock = one($p, "SELECT GET_LOCK('mulawin_user_role_slots', 10) AS acquired");
        must((int)($lock['acquired'] ?? 0) === 1, 'User accounts are being updated. Please try again.', 409);
        try {
            return $work();
        } finally {
            try { one($p, "SELECT RELEASE_LOCK('mulawin_user_role_slots') AS released"); }
            catch (Throwable $ignored) { /* Connection shutdown releases locks too. */ }
        }
    }

    /** Active non-dispatcher roles have one slot; each dispatcher role has Day and Night slots. */
    private static function assertRoleShiftVacancy(PDO $p, string $role, ?string $shift, ?int $excludeId = null): void {
        if (roleIsDispatcher($role)) {
            must(in_array($shift, ['Day', 'Night'], true), 'Select a dispatcher shift.', 400);
            $occupied = one($p, 'SELECT id FROM users WHERE role=? AND shift=? AND active=1 AND id<>? LIMIT 1', [$role, $shift, $excludeId ?? 0]);
            must(!$occupied, 'This dispatcher role and shift already have an active account. Deactivate that account first.', 409);
        } else {
            $occupied = one($p, 'SELECT id FROM users WHERE role=? AND active=1 AND id<>? LIMIT 1', [$role, $excludeId ?? 0]);
            must(!$occupied, 'This role already has an active account. Deactivate that account first.', 409);
        }
    }

    // ---------------------------------------------------------------- users
    private static function emailField(array $d): string {
        $email = strtolower(field($d, 'email', 190));
        must((bool)filter_var($email, FILTER_VALIDATE_EMAIL), 'Enter a valid email address (the login code is sent there).');
        return $email;
    }

    /** Admin creates or edits an account. The Admin sets the password (no temporary passwords). */
    private static function userSave(array $u, array $d): array {
        requireRole($u, 'admin');
        $id = optId($d, 'id');
        $role = choiceField($d, 'role', allowedRoles());
        $shift = roleIsDispatcher($role) ? choiceField($d, 'shift', ['Day', 'Night']) : null;
        $name = field($d, 'full_name', 100);
        $email = self::emailField($d);
        return transaction(function (PDO $p) use ($u, $id, $role, $shift, $name, $email, $d) {
            must(!one($p, 'SELECT id FROM users WHERE email=? AND id<>?', [$email, $id ?? 0]), 'Another account already uses this email address.', 409);
            if ($id) {
                if ($id === $u['id']) must($role === 'admin', 'You cannot remove your own Admin role.');
                $oldUser = one($p, 'SELECT full_name, email, role, shift, active FROM users WHERE id=? FOR UPDATE', [$id]);
                must((bool)$oldUser, 'User not found.', 404);
                if ((int)$oldUser['active'] === 1 && ($role !== $oldUser['role'] || $shift !== $oldUser['shift'])) self::assertRoleShiftVacancy($p, $role, $shift, $id);
                run($p, 'UPDATE users SET full_name=?, email=?, role=?, shift=? WHERE id=?', [$name, $email, $role, $shift, $id]);
                auditWithChanges($p, $u['id'], 'Access', 'user ' . $id, 'account updated', "$name / $role" . ($shift ? " / $shift" : '') . ' / ' . $email,
                    ['Full name' => $oldUser['full_name'], 'Email' => $oldUser['email'], 'Role' => $oldUser['role'], 'Shift' => $oldUser['shift']],
                    ['Full name' => $name, 'Email' => $email, 'Role' => $role, 'Shift' => $shift]);
                return ['message' => 'Account updated.'];
            }
            $username = field($d, 'username', 70);
            must((bool)preg_match('/^[a-zA-Z0-9_.-]{3,70}$/', $username), 'Username: 3-70 letters, numbers, dot, dash or underscore.');
            $pw = field($d, 'password', 255); self::strongPassword($pw, field($d, 'password_confirm', 255, false));
            must(!one($p, 'SELECT id FROM users WHERE username=?', [$username]), 'Username already exists.', 409);
            self::assertRoleShiftVacancy($p, $role, $shift);
            $id = insert($p, 'users', ['username' => $username, 'email' => $email, 'password_hash' => password_hash($pw, PASSWORD_DEFAULT),
                'full_name' => $name, 'role' => $role, 'shift' => $shift]);
            auditWithChanges($p, $u['id'], 'Access', 'user ' . $id, 'account created', "$username / $role / " . $email, [],
                ['Username' => $username, 'Full name' => $name, 'Email' => $email, 'Role' => $role, 'Shift' => $shift, 'Active' => 'Yes']);
            return ['id' => $id, 'message' => "Account $username created. Give the password to the user privately; each login also needs the code sent to " . Mailer::mask($email) . '.'];
        });
    }

    private static function userToggle(array $u, array $d): array {
        requireRole($u, 'admin');
        $id = idField($d, 'user_id'); $active = !empty($d['active']) ? 1 : 0;
        must($id !== $u['id'], 'You cannot deactivate your own account.');
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $t = one($p, 'SELECT role, full_name, active FROM users WHERE id=? FOR UPDATE', [$id]);
            must((bool)$t, 'User not found.', 404);
            if (!$active && $t['role'] === 'admin') must((int)one($p, "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1")['n'] > 1, 'Keep at least one active Admin.');
            if ($active && (int)$t['active'] !== 1) self::assertRoleShiftVacancy($p, $t['role'], $t['shift'], $id);
            run($p, 'UPDATE users SET active=? WHERE id=?', [$active, $id]);
            auditWithChanges($p, $u['id'], 'Access', 'user ' . $id, $active ? 'account activated' : 'account deactivated', $t['full_name'],
                ['Account active' => (int)$t['active'] ? 'Yes' : 'No'], ['Account active' => $active ? 'Yes' : 'No']);
            return ['message' => $t['full_name'] . ($active ? ' can log in again.' : ' can no longer log in.')];
        });
    }

    private static function userPassword(array $u, array $d): array {
        requireRole($u, 'admin');
        $id = idField($d, 'user_id'); $pw = field($d, 'password', 255); self::strongPassword($pw, field($d, 'password_confirm', 255, false));
        return transaction(function (PDO $p) use ($u, $id, $pw) {
            must((bool)one($p, 'SELECT id FROM users WHERE id=?', [$id]), 'User not found.', 404);
            run($p, 'UPDATE users SET password_hash=? WHERE id=?', [password_hash($pw, PASSWORD_DEFAULT), $id]);
            AccountSecurity::passwordChanged($id);
            audit($p, $u['id'], 'Access', 'user ' . $id, 'password set by Admin', 'old sessions signed out');
            return ['message' => 'New password saved. Give it to the user privately; their old sessions were signed out.'];
        });
    }

    private static function changePassword(array $u, array $d): array {
        $current = field($d, 'current_password', 255); $new = field($d, 'new_password', 255);
        self::strongPassword($new, field($d, 'confirm', 255, false));
        must($new !== $current, 'Choose a different password.');
        return transaction(function (PDO $p) use ($u, $current, $new) {
            $row = one($p, 'SELECT password_hash FROM users WHERE id=?', [$u['id']]);
            must(password_verify($current, $row['password_hash']), 'Current password is wrong.', 403);
            run($p, 'UPDATE users SET password_hash=? WHERE id=?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
            $_SESSION['login_at'] = strtotime(AccountSecurity::passwordChanged($u['id']));
            audit($p, $u['id'], 'Access', 'user ' . $u['id'], 'own password changed');
            return ['message' => 'Password changed.'];
        });
    }

    /** Admin recovery code (no email in the system): printed and kept safe; works once. */
    private static function recoveryCodeCreate(array $u, array $d): array {
        requireRole($u, 'admin');
        $current = field($d, 'current_password', 255);
        $row = one(db(), 'SELECT * FROM users WHERE id=?', [$u['id']]);
        must(password_verify($current, (string)$row['password_hash']), 'Current password is wrong.', 403);
        $code = AccountSecurity::newCode();
        run(db(), 'UPDATE users SET recovery_hash=? WHERE id=?', [password_hash(AccountSecurity::normalizeCode($code), PASSWORD_DEFAULT), $u['id']]);
        audit(db(), $u['id'], 'Access', 'user ' . $u['id'], 'recovery code created', 'the previous code no longer works');
        return ['code' => $code, 'message' => 'Recovery code created. It is shown only once.'];
    }

    /** E-signature image of an approver (printed on approved purchase orders). */
    /**
     * Every user can save an e-signature: an uploaded PNG/JPG image or a drawing made in the
     * app (sent as PNG). It is stored privately (entity "user", not in the Documents list) and
     * is shown only through index.php?api=signature to signed-in users.
     */
    private static function signatureUpload(array $u, array $d): array {
        must(Files::has('signature'), 'Choose a signature image or draw your signature.');
        $f = Files::list('signature')[0];
        must(($f['error'] ?? 1) === UPLOAD_ERR_OK && (int)$f['size'] > 0, 'The signature upload failed. Try again.');
        must((int)$f['size'] <= 2 * 1024 * 1024, 'The signature image is larger than 2 MB.');
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
        must(in_array($mime, ['image/png', 'image/jpeg'], true), 'The signature must be a PNG or JPG image.');
        $size = @getimagesize($f['tmp_name']);
        must($size && $size[0] >= 60 && $size[1] >= 20, 'The signature image is too small or damaged.');
        if (extension_loaded('gd') && $mime === 'image/png' && ($d['method'] ?? '') === 'draw') must(self::hasInk($f['tmp_name']), 'The drawing is empty. Draw your signature first.');
        return transaction(function (PDO $p) use ($u, $d) {
            $ids = Files::store($p, $u, 'signature', 'user', $u['id'], 'User E-Signature', true);
            run($p, 'UPDATE users SET signature_document_id=? WHERE id=?', [$ids[0], $u['id']]);
            audit($p, $u['id'], 'Access', 'user ' . $u['id'], 'e-signature saved', ($d['method'] ?? '') === 'draw' ? 'drawn in the app' : 'uploaded image');
            return ['message' => 'E-signature saved. It appears on the forms you prepare or approve.'];
        });
    }

    /** True when a drawn PNG has enough dark, visible pixels (not an empty box). */
    private static function hasInk(string $file): bool {
        $im = @imagecreatefrompng($file);
        if (!$im) return false;
        $w = imagesx($im); $h = imagesy($im); $ink = 0;
        for ($x = 0; $x < $w; $x += 2) for ($y = 0; $y < $h; $y += 2) {
            $c = imagecolorsforindex($im, imagecolorat($im, $x, $y));
            if ($c['alpha'] < 100 && ($c['red'] + $c['green'] + $c['blue']) < 450) { if (++$ink > 40) { imagedestroy($im); return true; } }
        }
        imagedestroy($im);
        return false;
    }

    // ---------------------------------------------------------------- settings
    private static function settingSave(array $u, array $d): array {
        requireRole($u, 'admin');
        $key = field($d, 'key', 80);
        must(isset(Settings::DEFS[$key]), 'Unknown setting.');
        [$label, , $unit, , $min, $max] = Settings::DEFS[$key];
        $raw = trim((string)($d['value'] ?? ''));
        must(is_numeric($raw) && (float)$raw >= $min && (float)$raw <= $max, "$label must be a number from $min to $max.");
        return transaction(function (PDO $p) use ($u, $key, $raw, $label) {
            $previousSetting = one($p, 'SELECT setting_value FROM app_settings WHERE setting_key=?', [$key]);
            $p->prepare('INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)')
              ->execute([$key, $raw, $u['id']]);
            Settings::clearCache();
            auditWithChanges($p, $u['id'], 'Settings', $key, 'setting changed', "$label = $raw",
                [$label => $previousSetting['setting_value'] ?? null], [$label => $raw]);
            return ['message' => "$label saved ($raw). New records use the new value."];
        });
    }

    private static function fundCategorySave(array $u, array $d): array {
        requireRole($u, 'admin');
        $id = optId($d, 'id');
        $name = field($d, 'name', 80); $amount = moneyField($d, 'amount'); $active = !empty($d['active']) ? 1 : 0;
        $order = (int)(intField($d, 'sort_order', 0, false) ?? 0);
        return transaction(function (PDO $p) use ($u, $id, $name, $amount, $active, $order) {
            must(!one($p, 'SELECT id FROM fund_categories WHERE name=? AND id<>?', [$name, $id ?? 0]), 'Category "' . $name . '" already exists.', 409);
            $old = $id ? one($p, 'SELECT name, amount, active, sort_order FROM fund_categories WHERE id=? FOR UPDATE', [$id]) : null;
            if ($id) {
                must((bool)$old, 'Fund category not found.', 404);
                run($p, 'UPDATE fund_categories SET name=?, amount=?, active=?, sort_order=?, updated_by=? WHERE id=?', [$name, $amount, $active, $order, $u['id'], $id]);
            } else {
                $id = insert($p, 'fund_categories', ['name' => $name, 'amount' => $amount, 'active' => $active, 'sort_order' => $order, 'updated_by' => $u['id']]);
            }
            auditWithChanges($p, $u['id'], 'Settings', 'fund category ' . $id, $old ? 'fund category updated' : 'fund category created',
                "$name PHP $amount" . ($active ? '' : ' (inactive)'),
                $old ? ['Name' => $old['name'], 'Amount (PHP)' => $old['amount'], 'Active' => (int)$old['active'] ? 'Yes' : 'No', 'Sort order' => $old['sort_order']] : [],
                ['Name' => $name, 'Amount (PHP)' => $amount, 'Active' => $active ? 'Yes' : 'No', 'Sort order' => $order]);
            return ['message' => 'Fund category saved. Old fund requests keep their amounts.'];
        });
    }

    // ---------------------------------------------------------------- backup
    private static function backupCreate(array $u): array {
        requireRole($u, 'admin');
        $p = db();
        $dir = dirname(__DIR__, 3) . '/storage/backups';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $name = 'mulawin_backup_' . date('Ymd_His') . '.sql';
        $fh = fopen($dir . '/' . $name, 'wb');
        must((bool)$fh, 'Cannot write to storage/backups.', 500);
        fwrite($fh, "-- Mulawin FleetOps backup " . date('Y-m-d H:i:s') . "\n-- Restore into an EMPTY database with phpMyAdmin Import.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n");
        foreach ($p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            $create = $p->query('SHOW CREATE TABLE `' . $table . '`')->fetch(PDO::FETCH_NUM)[1];
            fwrite($fh, "DROP TABLE IF EXISTS `$table`;\n$create;\n");
            $stmt = $p->query('SELECT * FROM `' . $table . '`');
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $vals = array_map(fn($v) => $v === null ? 'NULL' : $p->quote((string)$v), array_values($row));
                fwrite($fh, 'INSERT INTO `' . $table . '` (`' . implode('`,`', array_keys($row)) . '`) VALUES (' . implode(',', $vals) . ");\n");
            }
            fwrite($fh, "\n");
        }
        fwrite($fh, "SET FOREIGN_KEY_CHECKS=1;\n");
        fclose($fh);
        audit($p, $u['id'], 'Backup', $name, 'database backup created');
        return ['file' => $name, 'message' => 'Backup created. Download it and keep a copy outside this computer, together with the storage/private folder (uploaded files).'];
    }

    // ---------------------------------------------------------------- notifications (every user, own only)
    /** Notification history page: active and resolved/archived, filtered by state. */
    private static function notificationsPage(array $u, array $q): array {
        $state = in_array($q['state'] ?? '', Notify::STATES, true) ? (string)$q['state'] : null;
        $w = 'WHERE user_id=?'; $a = [$u['id']];
        if ($state) { $w .= ' AND state=?'; $a[] = $state; }
        else $w .= " AND state<>'Archived'";
        return [
            'items' => many(db(), "SELECT id, category, message, page, state, created_at, read_at, resolved_at, resolved_by IS NULL AS auto_resolved FROM notifications $w ORDER BY FIELD(state,'Unread','Read','Resolved','Archived'), id DESC LIMIT 500", $a),
            'counts' => array_column(many(db(), 'SELECT state, COUNT(*) AS n FROM notifications WHERE user_id=? GROUP BY state', [$u['id']]), 'n', 'state'),
            'states' => Notify::STATES,
        ];
    }

    /** Mark read (one or all), or resolve / archive one notification. Only the user's own notifications. */
    private static function notificationsRead(array $u, array $d): array {
        $id = optId($d, 'id');
        $to = choiceField(['state' => $d['state'] ?? 'Read'], 'state', ['Read', 'Resolved', 'Archived']);
        $p = db();
        if (!$id) {
            must($to === 'Read', 'Only "mark all as read" works on all notifications.');
            run($p, "UPDATE notifications SET state='Read', read_at=COALESCE(read_at, NOW()) WHERE user_id=? AND state='Unread'", [$u['id']]);
            return ['message' => 'All notifications marked as read.'] + Notify::forUser($p, $u['id']);
        }
        $n = one($p, 'SELECT id, state FROM notifications WHERE id=? AND user_id=?', [$id, $u['id']]);
        must((bool)$n, 'Notification not found.', 404);
        if ($to === 'Read') run($p, "UPDATE notifications SET state='Read', read_at=COALESCE(read_at, NOW()) WHERE id=? AND state='Unread'", [$id]);
        elseif ($to === 'Resolved') run($p, "UPDATE notifications SET state='Resolved', read_at=COALESCE(read_at, NOW()), resolved_at=NOW(), resolved_by=? WHERE id=? AND state IN ('Unread','Read')", [$u['id'], $id]);
        else run($p, "UPDATE notifications SET state='Archived', read_at=COALESCE(read_at, NOW()), resolved_at=COALESCE(resolved_at, NOW()), resolved_by=COALESCE(resolved_by, ?) WHERE id=?", [$u['id'], $id]);
        return ['message' => $to === 'Read' ? 'Marked as read.' : ($to === 'Resolved' ? 'Notification resolved.' : 'Notification archived.')] + Notify::forUser($p, $u['id']);
    }
}
