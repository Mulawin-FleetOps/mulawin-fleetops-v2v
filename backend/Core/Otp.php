<?php
/*
 * =====================================================================
 *  backend/Core/Otp.php  —  email one-time password (second login step)
 * =====================================================================
 *  1. Password correct  -> a 6-digit code is created and emailed.
 *  2. The code is saved HASHED (password_hash), never in plain text.
 *  3. It expires after OTP_MINUTES, works once, and allows OTP_MAX_ATTEMPTS
 *     tries. A new code cancels every older code of the same user.
 *  4. "Resend code" waits OTP_RESEND_SECONDS between sends and allows at most
 *     OTP_MAX_SENDS sends in 15 minutes.
 *  The session is NOT logged in until the code is verified, so nothing in the
 *  system can be opened with the password alone.
 * =====================================================================
 */
declare(strict_types=1);
core('Mailer');

final class Otp {
    public const OTP_MINUTES = 5;
    public const OTP_MAX_ATTEMPTS = 5;
    public const OTP_RESEND_SECONDS = 60;
    public const OTP_MAX_SENDS = 5;          // per 15 minutes
    public const PENDING_MINUTES = 15;       // time allowed between password and code

    /** Creates a new code, cancels older ones and emails it. Returns null or an error message. */
    public static function issue(array $user): ?string {
        $p = db();
        // Limits count only codes that were NOT used (a normal successful login does not count).
        $recent = (int)one($p, 'SELECT COUNT(*) AS n FROM login_otps WHERE user_id=? AND consumed_at IS NULL AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)', [$user['id']])['n'];
        if ($recent >= self::OTP_MAX_SENDS) return 'Too many codes were sent. Please wait 15 minutes, then log in again.';
        $wait = self::resendWait((int)$user['id']);
        if ($wait > 0) return 'Please wait ' . $wait . ' seconds before asking for a new code.';

        $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        run($p, 'UPDATE login_otps SET invalidated_at=NOW() WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL', [$user['id']]);
        $p->prepare('INSERT INTO login_otps (user_id, code_hash, expires_at, request_ip) VALUES (?,?,DATE_ADD(NOW(), INTERVAL ' . self::OTP_MINUTES . ' MINUTE),?)')
          ->execute([$user['id'], password_hash($code, PASSWORD_DEFAULT), cut((string)($_SERVER['REMOTE_ADDR'] ?? ''), 45)]);
        $otpId = (int)$p->lastInsertId();

        $company = envValue('COMPANY_NAME', 'R P MULAWIN TRUCKING SERVICE');
        $name = htmlspecialchars((string)$user['full_name'], ENT_QUOTES, 'UTF-8');
        $html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937">'
              . '<p>Hello ' . $name . ',</p><p>Your Mulawin FleetOps verification code is:</p>'
              . '<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:12px 0">' . $code . '</p>'
              . '<p>The code expires in ' . self::OTP_MINUTES . ' minutes and can be used once.</p>'
              . '<p style="color:#6b7280">If you did not try to log in, change your password and tell the Admin.</p>'
              . '<p style="color:#6b7280">' . htmlspecialchars($company, ENT_QUOTES, 'UTF-8') . '</p></div>';
        $text = "Hello {$user['full_name']},\n\nYour Mulawin FleetOps verification code is: $code\n\nThe code expires in "
              . self::OTP_MINUTES . " minutes and can be used once.\nIf you did not try to log in, change your password and tell the Admin.\n\n$company";
        $err = Mailer::send((string)$user['email'], (string)$user['full_name'], 'Your Mulawin FleetOps login code', $html, $text);
        unset($code);
        if ($err !== null) {
            // A code that was never delivered must not stay usable.
            run($p, 'UPDATE login_otps SET invalidated_at=NOW() WHERE id=?', [$otpId]);
            return $err;
        }
        audit($p, (int)$user['id'], 'Access', 'user ' . $user['id'], 'login code sent', 'to ' . Mailer::mask((string)$user['email']));
        return null;
    }

    /**
     * Checks a code typed by the user. Returns ['ok'=>true] or ['ok'=>false,'error'=>..., 'restart'=>bool].
     * 'restart' = the code can no longer be used; the user must log in again or resend.
     */
    public static function verify(int $userId, string $code): array {
        return transaction(function (PDO $p) use ($userId, $code) {
            $o = one($p, 'SELECT id, code_hash, attempts, (expires_at < NOW()) AS expired FROM login_otps
                          WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [$userId]);
            if (!$o) return ['ok' => false, 'error' => 'No active code. Click "Send a new code".', 'restart' => true];
            if ((int)$o['expired']) {
                run($p, 'UPDATE login_otps SET invalidated_at=NOW() WHERE id=?', [$o['id']]);
                return ['ok' => false, 'error' => 'The code has expired. Click "Send a new code".', 'restart' => true];
            }
            if (!preg_match('/^\d{6}$/', $code) || !password_verify($code, (string)$o['code_hash'])) {
                $tries = (int)$o['attempts'] + 1;
                $left = self::OTP_MAX_ATTEMPTS - $tries;
                run($p, 'UPDATE login_otps SET attempts=?' . ($left <= 0 ? ', invalidated_at=NOW()' : '') . ' WHERE id=?', [$tries, $o['id']]);
                audit($p, $userId, 'Access', 'user ' . $userId, 'wrong login code', $left <= 0 ? 'code cancelled after ' . self::OTP_MAX_ATTEMPTS . ' wrong tries' : "$left tries left");
                return $left <= 0
                    ? ['ok' => false, 'error' => 'Too many wrong codes. This code no longer works; click "Send a new code".', 'restart' => true]
                    : ['ok' => false, 'error' => "Wrong code. $left " . ($left === 1 ? 'try' : 'tries') . ' left.', 'restart' => false];
            }
            run($p, 'UPDATE login_otps SET consumed_at=NOW(), attempts=attempts+1 WHERE id=?', [$o['id']]);
            return ['ok' => true];
        });
    }

    /** Seconds until "Resend" is allowed (0 = now). Counts from the newest code that was not used. */
    public static function resendWait(int $userId): int {
        $last = one(db(), 'SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM login_otps WHERE user_id=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', [$userId]);
        return $last ? max(0, self::OTP_RESEND_SECONDS - (int)$last['age']) : 0;
    }

    /** True when the user still has a code that can be typed (sent, not used, not expired, not cancelled). */
    public static function hasActive(int $userId): bool {
        return (bool)one(db(), 'SELECT id FROM login_otps WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > NOW() LIMIT 1', [$userId]);
    }
}
