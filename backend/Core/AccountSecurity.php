<?php
/*
 * =====================================================================
 *  backend/Core/AccountSecurity.php  —  simpleng proteksyon ng accounts
 * =====================================================================
 *  Proteksyon ng accounts (login = username/email + password lamang; walang email OTP):
 *  1. Lock ng account: 5 maling password (kahit saang computer) = naka-lock nang 15 minuto.
 *  2. Forgot Password: one-time 6-digit code sent to the account's registered email.
 *     Five-minute expiry, attempt limits; the code is stored only as a hash.
 *  3. Kapag napalitan ang password, lahat ng lumang login session ay mala-log out.
 *  Emergency fallback kapag unavailable ang email: authorized server IT can use
 *     php scripts/reset_password.php USERNAME (CLI only, audited).
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
        } catch (Throwable $e) {
            // Do not allow authentication to proceed when failed attempts
            // cannot be counted reliably. The API error handler masks details.
            error_log('Account lock unavailable: ' . $e->getMessage());
            throw new RuntimeException('Account security verification unavailable.', 0, $e);
        }
    }

    public static function success(int $id): void {
        try { run(db(), 'UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [$id]); }
        catch (Throwable $e) {
            error_log('Account lock reset unavailable: ' . $e->getMessage());
            throw new RuntimeException('Account security verification unavailable.', 0, $e);
        }
    }

    /** Itala kung kailan napalitan ang password (para ma-log out ang lumang sessions). */
    public static function passwordChanged(int $id): string {
        $now = self::now();
        // Fail closed: password/session revocation must not silently skip security updates.
        run(db(), 'UPDATE users SET password_changed_at=?, failed_logins=0, locked_until=NULL WHERE id=?', [$now, $id]);
        return $now;
    }

    /** True kapag napalitan ang password pagkatapos mag-login ang session na ito. */
    public static function sessionOutdated(int $id): bool {
        try {
            $row = one(db(), 'SELECT password_changed_at FROM users WHERE id=?', [$id]);
            if (!$row) throw new RuntimeException('Session account no longer exists.');
            $pc = $row['password_changed_at'] ?? null;
            if ($pc === null) return false;
            $changed = strtotime((string)$pc);
            // An unreadable security timestamp must not validate an old session.
            if ($changed === false) throw new RuntimeException('Invalid password-change timestamp.');
            return $changed > (int)($_SESSION['login_at'] ?? 0);
        } catch (Throwable $e) {
            error_log('Session revocation verification unavailable: ' . $e->getMessage());
            throw new RuntimeException('Session security verification unavailable.', 0, $e);
        }
    }

    /**
     * One-time temporary password for a new or reset account (cryptographically secure, via random_bytes()).
     * 16 characters from a 32-letter/digit alphabet (no O/0/I/1), so every random byte maps to a symbol without bias.
     * Always has at least one letter and one digit so it passes the password policy. Shown to the Admin once; only its hash is stored.
     */
    public static function newTemporaryPassword(): string {
        $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exactly 32 symbols
        do {
            $bytes = random_bytes(16); $pw = '';
            for ($i = 0; $i < 16; $i++) $pw .= $abc[ord($bytes[$i]) & 31];
        } while (!preg_match('/[A-Z]/', $pw) || !preg_match('/[2-9]/', $pw));
        return $pw;
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
