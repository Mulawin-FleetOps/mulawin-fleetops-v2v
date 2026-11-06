<?php
/* Security S2: password + stored one-time 2FA proof for named browser; no passwordless access. */
declare(strict_types=1);
final class TrustedDevices {
    private const COOKIE = 'mulawin_trusted_device';
    private const DAYS = 30;

    private static function secureEnvironment(): bool {
        $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        $loopback = in_array((string)($_SERVER['REMOTE_ADDR'] ?? ''), ['127.0.0.1', '::1'], true);
        return $https || $loopback; // Allow local XAMPP testing; production requires HTTPS.
    }

    private static function cookieOptions(int $expires): array {
        return ['expires' => $expires, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'httponly' => true, 'samesite' => 'Strict'];
    }

    public static function isTrusted(int $uid): bool {
        if (!self::secureEnvironment()) return false;
        $token = (string)($_COOKIE[self::COOKIE] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) return false;
        $hash = hash('sha256', $token);
        $row = one(db(), 'SELECT id FROM trusted_login_devices WHERE user_id=? AND token_hash=? AND expires_at>NOW()', [$uid, $hash]);
        if (!$row) return false;
        run(db(), 'UPDATE trusted_login_devices SET last_used_at=NOW() WHERE id=?', [$row['id']]);
        return true;
    }

    public static function remember(int $uid): bool {
        if (!self::secureEnvironment()) return false;
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);
        run(db(), 'DELETE FROM trusted_login_devices WHERE user_id=? AND expires_at<NOW()', [$uid]);
        $p = db();
        $p->prepare('INSERT INTO trusted_login_devices (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))')
           ->execute([$uid, $hash]);
        if (!setcookie(self::COOKIE, $token, self::cookieOptions(time() + self::DAYS * 86400))) {
            run($p, 'DELETE FROM trusted_login_devices WHERE token_hash=?', [$hash]);
            return false;
        }
        return true;
    }

    /** Security S3: self-service trusted-device management. Never expose cookie values or token hashes. */
    public static function listFor(int $uid): array {
        $token = (string)($_COOKIE[self::COOKIE] ?? '');
        $currentHash = preg_match('/^[a-f0-9]{64}$/D', $token) ? hash('sha256', $token) : null;
        $devices = many(db(), 'SELECT id, token_hash, created_at, last_used_at, expires_at FROM trusted_login_devices WHERE user_id=? AND expires_at>NOW() ORDER BY created_at DESC, id DESC LIMIT 100', [$uid]);
        return array_map(static fn(array $r): array => [
            'id' => (int)$r['id'],
            'created_at' => $r['created_at'],
            'last_used_at' => $r['last_used_at'],
            'expires_at' => $r['expires_at'],
            'current' => $currentHash !== null && hash_equals($currentHash, (string)$r['token_hash']),
        ], $devices);
    }

    /** Require the employee's own password; never accept a target user ID from the client. */
    public static function manage(array $u, string $action, array $d): array {
        $p = db();
        $uid = (int)$u['id'];
        $password = field($d, 'current_password', 255);
        $now = time();
        $fails = array_values(array_filter((array)($_SESSION['trusted_device_password_failures'] ?? []),
            static fn($t): bool => $now - (int)$t < 900));
        must(count($fails) < 5, 'Too many failed confirmations. Try again in 15 minutes.', 429);
        $record = one($p, 'SELECT password_hash FROM users WHERE id=? AND active=1', [$uid]);
        if (!$record || !password_verify($password, (string)$record['password_hash'])) {
            $fails[] = $now;
            $_SESSION['trusted_device_password_failures'] = $fails;
            must(false, 'Current password is incorrect.', 403);
        }
        unset($_SESSION['trusted_device_password_failures']);
        if ($action === 'trusted_devices_revoke_all') {
            $count = run($p, 'DELETE FROM trusted_login_devices WHERE user_id=?', [$uid]);
            setcookie(self::COOKIE, '', self::cookieOptions(time() - 3600));
            audit($p, $uid, 'Access', 'user ' . $uid, 'all trusted devices revoked', 'count: ' . $count);
            return ['message' => 'All remembered devices removed. Email OTP is required on their next login.'];
        }
        must($action === 'trusted_devices_revoke', 'Unknown trusted-device action.', 404);
        $id = idField($d, 'device_id');
        $token = (string)($_COOKIE[self::COOKIE] ?? '');
        $currentHash = preg_match('/^[a-f0-9]{64}$/D', $token) ? hash('sha256', $token) : null;
        $row = one($p, 'SELECT token_hash FROM trusted_login_devices WHERE id=? AND user_id=?', [$id, $uid]);
        must((bool)$row, 'Remembered device no longer exists.', 404);
        run($p, 'DELETE FROM trusted_login_devices WHERE id=? AND user_id=?', [$id, $uid]);
        if ($currentHash !== null && hash_equals($currentHash, (string)$row['token_hash'])) {
            setcookie(self::COOKIE, '', self::cookieOptions(time() - 3600));
        }
        audit($p, $uid, 'Access', 'user ' . $uid, 'trusted device revoked', 'device record ' . $id);
        return ['message' => 'Remembered device removed. Email OTP is required on its next login.'];
    }

    public static function revokeAll(int $uid): void {
        run(db(), 'DELETE FROM trusted_login_devices WHERE user_id=?', [$uid]);
    }

    public static function forgetCurrent(int $uid): void {
        $token = (string)($_COOKIE[self::COOKIE] ?? '');
        if (preg_match('/^[a-f0-9]{64}$/D', $token))
            run(db(), 'DELETE FROM trusted_login_devices WHERE user_id=? AND token_hash=?', [$uid, hash('sha256', $token)]);
        setcookie(self::COOKIE, '', self::cookieOptions(time() - 3600));
    }
}
