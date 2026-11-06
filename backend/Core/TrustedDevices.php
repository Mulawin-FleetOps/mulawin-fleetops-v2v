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
