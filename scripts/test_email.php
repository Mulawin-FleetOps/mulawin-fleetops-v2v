<?php
/*
 * scripts/test_email.php — checks the email (SMTP) settings in .env by sending one test email.
 * Usage (XAMPP on Windows, inside the project folder):
 *   C:\xampp\php\php.exe scripts\test_email.php you@gmail.com
 * It prints only "SENT" or the reason it failed. Passwords are never printed.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/backend/bootstrap.php';
core('Mailer');
$to = trim($argv[1] ?? '');
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "Usage: php scripts/test_email.php you@example.com\n"); exit(2); }
echo 'Server: ' . (envValue('MAIL_HOST') ?: '(MAIL_HOST missing)') . ':' . envValue('MAIL_PORT', '587') . ' (' . envValue('MAIL_ENCRYPTION', 'tls') . ")\n";
echo 'Sender: ' . (envValue('MAIL_FROM_ADDRESS') ?: '(MAIL_FROM_ADDRESS missing)') . "\n";
echo 'Password set: ' . (envValue('MAIL_PASSWORD') !== '' ? 'yes' : 'no') . "\n";
$err = Mailer::send($to, $to, 'Mulawin FleetOps email test', '<p>This is a test email from Mulawin FleetOps. Email delivery works.</p>', 'This is a test email from Mulawin FleetOps. Email delivery works.');
if ($err === null) { echo "SENT. Check the inbox (and Spam folder) of $to.\n"; exit(0); }
fwrite(STDERR, "FAILED: $err\n"); exit(1);
