<?php
/*
 * scripts/create_user.php — create an account from the command line.
 * Usage (XAMPP on Windows, inside the project folder):
 *   C:\xampp\php\php.exe scripts\create_user.php admin myusername "Full Name" name@gmail.com
 *   (dispatchers: add Day or Night at the end)
 * You type the password yourself (twice). Every login also needs the code sent to the email.
 * Forgotten password: scripts/reset_password.php.
 * Roles: admin, operations_head, car_carrier_dispatcher, container_wingvan_dispatcher,
 *        motorpool, purchasing, finance, billing, audit
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/backend/bootstrap.php';
require __DIR__ . '/_password_prompt.php';
$role = $argv[1] ?? ''; $username = $argv[2] ?? ''; $name = $argv[3] ?? ''; $email = strtolower(trim($argv[4] ?? ''));
if (!$username || !$name || !$email || !in_array($role, allowedRoles(), true)) {
    fwrite(STDERR, "Usage: php scripts/create_user.php ROLE USERNAME \"FULL NAME\" EMAIL [Day|Night]\nRoles: " . implode(', ', allowedRoles()) . "\n"); exit(2);
}
if (!preg_match('/^[a-zA-Z0-9_.-]{3,70}$/', $username)) { fwrite(STDERR, "Invalid username.\n"); exit(2); }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "Invalid email address.\n"); exit(2); }
try {
    $p = db();
    if ($role !== 'admin' && !one($p, "SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1")) throw new RuntimeException('Create an admin account first.');
    if (one($p, 'SELECT id FROM users WHERE username=?', [$username])) throw new RuntimeException('Username already exists.');
    if (one($p, 'SELECT id FROM users WHERE email=?', [$email])) throw new RuntimeException('Another account already uses this email.');
    $pass = askNewPassword();
    $shift = roleIsDispatcher($role) ? (in_array($argv[5] ?? '', ['Day', 'Night'], true) ? $argv[5] : 'Day') : null;
    $p->beginTransaction();
    $p->prepare('INSERT INTO users (username, email, password_hash, full_name, role, shift) VALUES (?,?,?,?,?,?)')
      ->execute([$username, $email, password_hash($pass, PASSWORD_DEFAULT), cut($name, 100), $role, $shift]);
    audit($p, null, 'Access', 'user ' . $p->lastInsertId(), 'account created from the server (scripts/create_user.php)', "$username / $role");
    $p->commit();
    echo "Account created: $username ($role). Login codes will be sent to $email.\n";
} catch (Throwable $e) { if (isset($p) && $p->inTransaction()) $p->rollBack(); fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
