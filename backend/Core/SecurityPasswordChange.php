<?php
/* Security S1: email-verified, one-time, expiring employee password changes. */
declare(strict_types=1);
final class SecurityPasswordChange {
    public static function required(int $id): bool {
        return (int)(one(db(), 'SELECT must_change_password FROM users WHERE id=?', [$id])['must_change_password'] ?? 0) === 1;
    }

    /** Verify current password before sending code; never email or log a password. */
    public static function request(array $u, array $d): array {
        core('Mailer');
        $p = db();
        $row = one($p, 'SELECT * FROM users WHERE id=? AND active=1', [$u['id']]);
        must((bool)$row, 'Account is inactive.', 403);
        $current = field($d, 'current_password', 255);
        must(password_verify($current, (string)$row['password_hash']), 'Current password is incorrect.', 403);
        $new = field($d, 'new_password', 255);
        $confirm = field($d, 'confirm', 255, false);
        must(hash_equals($new, $confirm), 'New passwords do not match.');
        must(strlen($new) >= PASSWORD_MIN_LENGTH && strlen($new) <= PASSWORD_MAX_BYTES,
            'Password must be ' . PASSWORD_MIN_LENGTH . '-' . PASSWORD_MAX_BYTES . ' bytes.');
        must((bool)preg_match('/[A-Za-z]/', $new) && (bool)preg_match('/[0-9]/', $new),
            'Password must contain letters and numbers.');
        must(!password_verify($new, (string)$row['password_hash']), 'Choose a password different from the current one.');
        must(trim((string)$row['email']) !== '' && filter_var($row['email'], FILTER_VALIDATE_EMAIL), 'A valid account email is required. Ask Admin to update it first.', 409);
        $recent = one($p, 'SELECT requested_at FROM password_change_challenges WHERE user_id=?', [$u['id']]);
        must(!$recent || strtotime((string)$recent['requested_at']) <= time() - 60, 'Please wait 60 seconds before requesting another code.', 429);
        $code = (string)random_int(100000, 999999);
        $newHash = password_hash($new, PASSWORD_DEFAULT);
        $codeHash = password_hash($code, PASSWORD_DEFAULT);
        $p->prepare('INSERT INTO password_change_challenges (user_id, password_hash, code_hash, expires_at, attempts, requested_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0, NOW()) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), code_hash=VALUES(code_hash), expires_at=VALUES(expires_at), attempts=0, requested_at=NOW()')
            ->execute([$u['id'], $newHash, $codeHash]);
        $err = Mailer::send((string)$row['email'], (string)$row['full_name'], 'Mulawin FleetOps password change verification',
            '<p>Your verification code is <b>' . $code . '</b>. It expires in 5 minutes. If you did not request this, contact your Admin.</p>',
            "Your Mulawin FleetOps password change code: $code. Expires in 5 minutes. If you did not request this, contact your Admin.");
        if ($err !== null) {
            run($p, 'DELETE FROM password_change_challenges WHERE user_id=?', [$u['id']]);
            throw new BusinessRuleException($err, 503);
        }
        audit($p, (int)$u['id'], 'Access', 'user ' . $u['id'], 'password change verification requested', 'code sent to registered email');
        return ['message' => 'A verification code was sent to your registered email. It expires in 5 minutes.'];
    }

    public static function confirm(array $u, array $d): array {
        $code = field($d, 'code', 6);
        must((bool)preg_match('/^[0-9]{6}$/', $code), 'Enter the 6-digit verification code.');
        $result = transaction(function(PDO $p) use ($u, $code): array {
            $row = one($p, 'SELECT * FROM password_change_challenges WHERE user_id=? FOR UPDATE', [$u['id']]);
            must((bool)$row && strtotime((string)$row['expires_at']) >= time(), 'Verification expired. Request a new code.', 401);
            must((int)$row['attempts'] < 5, 'Too many attempts. Request a new code.', 429);
            if (!password_verify($code, (string)$row['code_hash'])) {
                run($p, 'UPDATE password_change_challenges SET attempts=attempts+1 WHERE user_id=?', [$u['id']]);
                return ['error' => 'Wrong verification code.'];
            }
            must(run($p, 'UPDATE users SET password_hash=?, must_change_password=0 WHERE id=? AND active=1', [$row['password_hash'], $u['id']]) === 1, 'Account is no longer active.', 403);
            run($p, 'DELETE FROM password_change_challenges WHERE user_id=?', [$u['id']]);
            core('AccountSecurity');
            $when = AccountSecurity::passwordChanged((int)$u['id']);
            $_SESSION['login_at'] = strtotime($when);
            audit($p, (int)$u['id'], 'Access', 'user ' . $u['id'], 'verified password changed', 'existing sessions invalidated');
            return ['message' => 'Password changed successfully.'];
        });
        must(!isset($result['error']), $result['error'] ?? '', 401);
        return $result;
    }

    /** Employee verifies a new email before it can replace the registered address. */
    public static function emailRequest(array $u, array $d): array {
        core('Mailer');
        $p = db();
        $old = one($p, 'SELECT * FROM users WHERE id=? AND active=1', [$u['id']]);
        must((bool)$old, 'Inactive account.', 403);
        must(password_verify(field($d, 'current_password', 255), (string)$old['password_hash']), 'Current password is incorrect.', 403);
        $email = strtolower(field($d, 'new_email', 190));
        must((bool)filter_var($email, FILTER_VALIDATE_EMAIL), 'Enter a valid email address.');
        must($email !== strtolower((string)$old['email']), 'This is already your registered email.');
        must(!one($p, 'SELECT id FROM users WHERE email=? AND id<>?', [$email, $u['id']]), 'Email is already in use.', 409);
        $recent = one($p, 'SELECT requested_at FROM email_change_challenges WHERE user_id=?', [$u['id']]);
        must(!$recent || strtotime((string)$recent['requested_at']) <= time()-60, 'Please wait 60 seconds before requesting another email code.', 429);
        $code = (string)random_int(100000,999999);
        $p->prepare('INSERT INTO email_change_challenges (user_id, new_email, code_hash, expires_at, attempts, requested_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0, NOW()) ON DUPLICATE KEY UPDATE new_email=VALUES(new_email), code_hash=VALUES(code_hash), expires_at=VALUES(expires_at), attempts=0, requested_at=NOW()')
          ->execute([$u['id'], $email, password_hash($code, PASSWORD_DEFAULT)]);
        $err = Mailer::send($email, (string)$old['full_name'], 'Verify your Mulawin FleetOps email address',
            '<p>Your email verification code is <b>' . $code . '</b>. It expires in 5 minutes. Do not share this code.</p>',
            "Your Mulawin FleetOps email verification code is $code. Expires in 5 minutes. Do not share this code.");
        if ($err !== null) {run($p, 'DELETE FROM email_change_challenges WHERE user_id=?', [$u['id']]); throw new BusinessRuleException($err,503);}
        audit($p, (int)$u['id'], 'Access', 'user '.$u['id'], 'email change verification requested', 'verification sent to proposed email');
        return ['message' => 'Verification code sent to the new email address.'];
    }

    public static function emailConfirm(array $u, array $d): array {
        $code=field($d,'code',6);
        must((bool)preg_match('/^[0-9]{6}$/D',$code),'Enter the 6-digit code.');
        $result=transaction(function(PDO $p) use ($u,$code): array {
            $r=one($p,'SELECT * FROM email_change_challenges WHERE user_id=? FOR UPDATE',[$u['id']]);
            must((bool)$r && strtotime((string)$r['expires_at'])>=time(),'Email verification expired. Request a new code.',401);
            must((int)$r['attempts']<5,'Too many attempts. Request a new code.',429);
            if (!password_verify($code,(string)$r['code_hash'])) {
                run($p,'UPDATE email_change_challenges SET attempts=attempts+1 WHERE user_id=?',[$u['id']]);
                return ['error'=>'Wrong email verification code.'];
            }
            $prior=one($p,'SELECT email FROM users WHERE id=? FOR UPDATE',[$u['id']]);
            must(!one($p,'SELECT id FROM users WHERE email=? AND id<>?',[$r['new_email'],$u['id']]),'Email is already registered.',409);
            run($p,'UPDATE users SET email=? WHERE id=?',[$r['new_email'],$u['id']]);
            run($p,'DELETE FROM email_change_challenges WHERE user_id=?',[$u['id']]);
            core('TrustedDevices'); TrustedDevices::revokeAll((int)$u['id']);
            auditWithChanges($p, (int)$u['id'], 'Access', 'user '.$u['id'], 'email verified and updated', '',
                ['Email'=>$prior['email']],['Email'=>$r['new_email']]);
            return ['message'=>'Email verified and updated. Trusted devices were revoked.'];
        });
        must(!isset($result['error']),$result['error']??'',401);
        return $result;
    }
}
