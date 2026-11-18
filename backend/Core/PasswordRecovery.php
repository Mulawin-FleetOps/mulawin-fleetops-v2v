<?php
/**
 * Public email-verified password recovery for all active accounts.
 * No authenticated session or existing password required. All public
 * messages are generic to prevent account/email enumeration.
 */
declare(strict_types=1);

final class PasswordRecovery {
    private const MESSAGE = 'If an active account has that registered email, a 6-digit verification code will be sent. Check your inbox.';
    private static function ready(PDO $p): bool {
        return (bool)one($p, "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='password_reset_challenges'");
    }
    private static function publicLimit(string $key, int $max, int $window): void {
        $now = time();
        $events = array_values(array_filter($_SESSION[$key] ?? [], static fn($t) => (int)$t > $now - $window));
        must(count($events) < $max, 'Too many attempts. Try again later.', 429);
        $events[] = $now;
        $_SESSION[$key] = $events;
    }
    public static function request(array $d): array {
        self::publicLimit('password_recovery_requests', 5, 900);
        $email = strtolower(trim(field($d, 'email', 190)));
        must((bool)filter_var($email, FILTER_VALIDATE_EMAIL), 'Enter a valid email address.');
        $p = db();
        must(self::ready($p), 'Password recovery is not configured yet. Contact authorized IT.', 503);
        $user = one($p, 'SELECT id, email, full_name FROM users WHERE email=? AND active=1 LIMIT 1', [$email]);
        if (!$user) return ['message' => self::MESSAGE];
        $recent = one($p, 'SELECT requested_at FROM password_reset_challenges WHERE user_id=?', [$user['id']]);
        if ($recent && strtotime((string)$recent['requested_at']) > time() - 60)
            return ['message' => self::MESSAGE];
        $code = (string)random_int(100000,999999);
        $p->prepare('INSERT INTO password_reset_challenges (user_id,code_hash,expires_at,attempts,requested_at) VALUES (?, ?, DATE_ADD(NOW(),INTERVAL 5 MINUTE),0,NOW()) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0,requested_at=NOW()')
            ->execute([(int)$user['id'],password_hash($code,PASSWORD_DEFAULT)]);
        core('Mailer');
        $error = Mailer::send((string)$user['email'],(string)$user['full_name'],
            'Mulawin FleetOps password reset verification',
            '<p>Your Mulawin FleetOps password reset code is <strong>'.$code.'</strong>.</p><p>It expires in 5 minutes. If you did not request it, ignore this email. Never share this code.</p>',
            "Your Mulawin FleetOps password reset code is $code. Expires in 5 minutes. If you did not request it, ignore this email.");
        if ($error !== null) {
            run($p,'DELETE FROM password_reset_challenges WHERE user_id=?',[$user['id']]);
            error_log('Password recovery delivery unavailable for user '.(int)$user['id']);
        } else {
            audit($p,(int)$user['id'],'Access','user '.$user['id'],'password recovery code requested','code delivered to registered email');
        }
        return ['message' => self::MESSAGE];
    }
    public static function confirm(array $d): array {
        self::publicLimit('password_recovery_verifications', 10, 900);
        $email = strtolower(trim(field($d,'email',190)));
        must((bool)filter_var($email,FILTER_VALIDATE_EMAIL),'Enter a valid email address.');
        $code = field($d,'code',6);
        must((bool)preg_match('/^[0-9]{6}$/D',$code),'Enter the 6-digit email verification code.');
        $new = field($d,'new_password',255);
        $confirm = field($d,'confirm',255);
        must(hash_equals($new,$confirm),'New passwords do not match.');
        must(strlen($new)>=PASSWORD_MIN_LENGTH && strlen($new)<=PASSWORD_MAX_BYTES &&
            (bool)preg_match('/[A-Za-z]/',$new) && (bool)preg_match('/[0-9]/',$new),
            'Password must contain letters and numbers and be between '.PASSWORD_MIN_LENGTH.' and '.PASSWORD_MAX_BYTES.' bytes.');
        $p = db();
        must(self::ready($p),'Password recovery is not configured yet. Contact authorized IT.',503);
        $result = transaction(function(PDO $p) use ($email,$code,$new): array {
            $user = one($p,'SELECT id,password_hash,active FROM users WHERE email=? LIMIT 1 FOR UPDATE',[$email]);
            if (!$user || !(int)$user['active']) return ['error'=>'Invalid or expired verification code.'];
            $challenge = one($p,'SELECT * FROM password_reset_challenges WHERE user_id=? FOR UPDATE',[$user['id']]);
            if (!$challenge || strtotime((string)$challenge['expires_at']) < time())
                return ['error'=>'Invalid or expired verification code.'];
            if ((int)$challenge['attempts'] >= 5)
                return ['error'=>'Too many incorrect codes. Request a new code.'];
            if (!password_verify($code,(string)$challenge['code_hash'])) {
                run($p,'UPDATE password_reset_challenges SET attempts=attempts+1 WHERE user_id=?',[$user['id']]);
                return ['error'=>'Invalid or expired verification code.'];
            }
            must(!password_verify($new,(string)$user['password_hash']),'Choose a password different from your previous password.');
            run($p,'UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND active=1',[password_hash($new,PASSWORD_DEFAULT),$user['id']]);
            run($p,'DELETE FROM password_reset_challenges WHERE user_id=?',[$user['id']]);
            AccountSecurity::passwordChanged((int)$user['id']);
            audit($p,(int)$user['id'],'Access','user '.$user['id'],'password recovered by verified email','existing sessions invalidated');
            return ['message'=>'Password reset successfully. Sign in with your new password.'];
        });
        if (isset($result['error'])) throw new BusinessRuleException($result['error'],401);
        return $result;
    }
}
