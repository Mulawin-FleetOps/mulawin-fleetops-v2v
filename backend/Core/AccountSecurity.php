<?php
/*
 * =====================================================================
 *  backend/Core/AccountSecurity.php  —  simpleng proteksyon ng accounts
 * =====================================================================
 *  Dagdag sa email login code (Core/Otp.php), ganito pa ang proteksyon ng accounts:
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

    /**
     * Maling password: dagdagan ang bilang; sa ika-5, i-lock nang 15 minuto. Ibinabalik kung na-lock.
     * The count goes up in ONE atomic UPDATE, so several requests at the same time cannot undercount it.
     * Used by login, the login code, and the current-password check of password / email change.
     */
    public static function failure(array $row): bool {
        try {
            $id = (int)$row['id'];
            run(db(), 'UPDATE users SET failed_logins=failed_logins+1 WHERE id=?', [$id]);
            $n = (int)(one(db(), 'SELECT failed_logins FROM users WHERE id=?', [$id])['failed_logins'] ?? 0);
            if ($n < self::MAX_TRIES) return false;
            $lock = date('Y-m-d H:i:s', time() + self::LOCK_MINUTES * 60);
            if (run(db(), 'UPDATE users SET failed_logins=0, locked_until=? WHERE id=? AND failed_logins>=?', [$lock, $id, self::MAX_TRIES]) === 1) {
                audit(db(), $id, 'Access', 'user ' . $id, 'account locked', self::MAX_TRIES . ' wrong passwords; locked for ' . self::LOCK_MINUTES . ' minutes');
            }
            return true;
        } catch (Throwable $e) { error_log('Account lock unavailable: ' . $e->getMessage()); return false; }
    }

    public static function success(int $id): void {
        try { run(db(), 'UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [$id]); }
        catch (Throwable $e) { error_log('Account lock unavailable: ' . $e->getMessage()); }
    }

    /** Itala kung kailan napalitan ang password (para ma-log out ang lumang sessions). */
    public static function passwordChanged(int $id): string {
        $now = self::now();
        // Fail closed: password/session revocation must not silently skip security updates.
        run(db(), 'UPDATE users SET password_changed_at=?, failed_logins=0, locked_until=NULL WHERE id=?', [$now, $id]);
        core('TrustedDevices'); TrustedDevices::revokeAll($id);
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
