<?php
/*
 * =====================================================================
 *  backend/Core/Mailer.php  —  sends email through SMTP (login OTP codes)
 * =====================================================================
 *  Uses PHPMailer 6.9.3 (backend/vendor/PHPMailer, LGPL-2.1, free).
 *  All settings come from .env, never from the code:
 *    MAIL_HOST          smtp.gmail.com
 *    MAIL_PORT          587
 *    MAIL_ENCRYPTION    tls  (tls = STARTTLS on 587, ssl = port 465, none = local test mailbox)
 *    MAIL_USERNAME      your Gmail address
 *    MAIL_PASSWORD      the 16-character Gmail App Password (NOT your normal password)
 *    MAIL_FROM_ADDRESS  usually the same Gmail address
 *    MAIL_FROM_NAME     Mulawin FleetOps
 *  Test the settings with:  php scripts/test_email.php you@example.com
 *  Passwords and codes are never written to logs.
 * =====================================================================
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/vendor/PHPMailer/Exception.php';
require_once dirname(__DIR__) . '/vendor/PHPMailer/PHPMailer.php';
require_once dirname(__DIR__) . '/vendor/PHPMailer/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;

final class Mailer {
    /** Missing settings (names only), so the screen can say what to fill in. */
    public static function missingSettings(): array {
        $need = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_FROM_ADDRESS'];
        if (strtolower(envValue('MAIL_ENCRYPTION', 'tls')) !== 'none') { $need[] = 'MAIL_USERNAME'; $need[] = 'MAIL_PASSWORD'; }
        return array_values(array_filter($need, fn($k) => trim(envValue($k)) === ''));
    }

    public static function configured(): bool { return !self::missingSettings(); }

    /**
     * Sends one email. Returns null when sent, or a short reason when it failed.
     * The reason never contains the password or the message body.
     */
    public static function send(string $to, string $toName, string $subject, string $html, string $text): ?string {
        $missing = self::missingSettings();
        if ($missing) return 'Email is not set up yet (missing in .env: ' . implode(', ', $missing) . ').';
        $m = new PHPMailer(true);
        try {
            $m->isSMTP();
            $m->Host = envValue('MAIL_HOST');
            $m->Port = (int)envValue('MAIL_PORT', '587');
            $enc = strtolower(envValue('MAIL_ENCRYPTION', 'tls'));
            if ($enc === 'none') {
                $m->SMTPAuth = trim(envValue('MAIL_USERNAME')) !== '';
                $m->SMTPSecure = '';
                $m->SMTPAutoTLS = false;
            } else {
                $m->SMTPAuth = true;
                $m->SMTPSecure = $enc === 'ssl' ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
            }
            if ($m->SMTPAuth) {
                $m->Username = envValue('MAIL_USERNAME');
                $m->Password = str_replace(' ', '', envValue('MAIL_PASSWORD')); // Gmail shows App Passwords with spaces
            }
            $m->Timeout = max(5, (int)envValue('MAIL_TIMEOUT', '20'));
            $m->CharSet = 'UTF-8';
            $m->setFrom(envValue('MAIL_FROM_ADDRESS'), envValue('MAIL_FROM_NAME', 'Mulawin FleetOps'));
            $m->addAddress($to, $toName);
            $m->Subject = $subject;
            $m->isHTML(true);
            $m->Body = $html;
            $m->AltBody = $text;
            $m->send();
            return null;
        } catch (Throwable $e) {
            // ErrorInfo can mention the server reply; it never contains the password.
            $reason = $m->ErrorInfo ?: $e->getMessage();
            error_log('Email to ' . self::mask($to) . ' failed: ' . $reason);
            if (stripos($reason, 'authenticate') !== false) return 'The email server rejected the login. Check MAIL_USERNAME and the Gmail App Password.';
            if (stripos($reason, 'connect') !== false) return 'Cannot connect to the email server. Check MAIL_HOST, MAIL_PORT and the internet connection.';
            return 'The email could not be sent (' . cut($reason, 160) . ').';
        }
    }

    /** r***o@gmail.com */
    public static function mask(string $email): string {
        if (!str_contains($email, '@')) return '***';
        [$u, $d] = explode('@', $email, 2);
        $show = strlen($u) <= 2 ? substr($u, 0, 1) : substr($u, 0, 1) . str_repeat('*', max(1, strlen($u) - 2)) . substr($u, -1);
        return $show . '@' . $d;
    }
}
