<?php
/*
 * =====================================================================
 *  backend/Core/AccountSecurity.php  —  simpleng proteksyon ng accounts
 * =====================================================================
 *  Walang email o SMS ang system, kaya ganito ang proteksyon (walang dagdag na setup):
 *  1. Lock ng account: 5 maling password (kahit saang computer) = naka-lock nang 15 minuto.
 *  2. Recovery code ng Admin: isang code na ipi-print at itatago. Kapag nakalimutan o na-hack ang
 *     Admin password, gamitin ito sa login page ("Forgot the Admin password?"). Isang beses lang gumagana.
 *  3. Kapag napalitan ang password (ng user, ng Admin o gamit ang recovery code), lahat ng lumang
 *     login session ng account na iyon ay mala-log out.
 *  Huling paraan (IT / developer, may access sa server): php scripts/reset_password.php USERNAME
 * =====================================================================
 */
declare(strict_types=1);

final class AccountSecurity {
    public const MAX_TRIES = 5;
    public const LOCK_MINUTES = 15;
    public static function now(): string { return date('Y-m-d H:i:s'); }

    public static function isLocked(array $row): bool {
        return !empty($row['locked_until']) && strtotime((string)$row['locked_until']) > time();
    }

    /** Maling password: dagdagan ang bilang; sa ika-5, i-lock nang 15 minuto. Ibinabalik kung na-lock. */
    public static function failure(array $row): bool {
        try {
            $n = (int)($row['failed_logins'] ?? 0) + 1;
            $lock = $n >= self::MAX_TRIES ? date('Y-m-d H:i:s', time() + self::LOCK_MINUTES * 60) : null;
            run(db(), 'UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [$lock ? 0 : $n, $lock, $row['id']]);
            if ($lock) audit(db(), (int)$row['id'], 'Access', 'user ' . $row['id'], 'account locked', self::MAX_TRIES . ' wrong passwords; locked for ' . self::LOCK_MINUTES . ' minutes');
            return (bool)$lock;
        } catch (Throwable $e) { error_log('Account lock unavailable: ' . $e->getMessage()); return false; }
    }

    public static function success(int $id): void {
        try { run(db(), 'UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [$id]); }
        catch (Throwable $e) { error_log('Account lock unavailable: ' . $e->getMessage()); }
    }

    /** Itala kung kailan napalitan ang password (para ma-log out ang lumang sessions). */
    public static function passwordChanged(int $id): string {
        $now = self::now();
        try { run(db(), 'UPDATE users SET password_changed_at=?, failed_logins=0, locked_until=NULL WHERE id=?', [$now, $id]); }
        catch (Throwable $e) { error_log('password_changed_at unavailable: ' . $e->getMessage()); }
        return $now;
    }

    /** True kapag napalitan ang password pagkatapos mag-login ang session na ito. */
    public static function sessionOutdated(int $id): bool {
        try { $pc = one(db(), 'SELECT password_changed_at FROM users WHERE id=?', [$id])['password_changed_at'] ?? null; }
        catch (Throwable $e) { return false; }
        return $pc !== null && strtotime((string)$pc) > (int)($_SESSION['login_at'] ?? 0);
    }

    /** Recovery code: 16 letra at numero (walang O/0/I/1 para hindi malito), naka-grupo ng 4. */
    public static function newCode(): string {
        $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $s = '';
        for ($i = 0; $i < 16; $i++) $s .= $abc[random_int(0, strlen($abc) - 1)];
        return implode('-', str_split($s, 4));
    }
    public static function normalizeCode(string $c): string { return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $c)); }

    public static function hasRecovery(int $id): ?bool {
        try { return !empty(one(db(), 'SELECT recovery_hash FROM users WHERE id=?', [$id])['recovery_hash']); }
        catch (Throwable $e) { return null; }
    }
}
