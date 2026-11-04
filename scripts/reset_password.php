<?php
/*
 * scripts/reset_password.php — LAST RESORT when the Admin cannot log in and has no recovery code.
 * For the IT person / developer with access to the server (XAMPP on the computer).
 * Usage (XAMPP on Windows, inside the project folder):
 *   C:\xampp\php\php.exe scripts\reset_password.php USERNAME
 * You type the new password yourself (twice). The account is unlocked and all old sessions are
 * signed out. Logging in still needs the code sent to the account's email.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/backend/bootstrap.php';
require __DIR__ . '/_password_prompt.php';
core('AccountSecurity');
$username = $argv[1] ?? '';
if ($username === '') { fwrite(STDERR, "Usage: php scripts/reset_password.php USERNAME\n"); exit(2); }
try {
    $p = db();
    $u = one($p, 'SELECT id, role, email FROM users WHERE username=?', [$username]);
    if (!$u) throw new RuntimeException('Username not found.');
    $pass = askNewPassword();
    run($p, 'UPDATE users SET password_hash=?, active=1 WHERE id=?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    AccountSecurity::passwordChanged((int)$u['id']);
    audit($p, null, 'Access', 'user ' . $u['id'], 'password reset from the server (scripts/reset_password.php)');
    echo "New password saved for $username ({$u['role']}). Login codes go to {$u['email']}.\n";
} catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
