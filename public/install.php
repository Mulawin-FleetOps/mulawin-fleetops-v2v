<?php
/*
 * public/install.php — ONE-TIME creation of the first Admin account.
 * Works only when: (1) there are no users yet, and (2) INSTALL_TOKEN in .env
 * has 32+ characters. After creating the account, clear INSTALL_TOKEN in .env
 * and delete this file. (You can also use: php scripts/create_user.php)
 */
declare(strict_types=1);
require dirname(__DIR__) . '/backend/bootstrap.php';
header('Cache-Control: no-store');
$token = envValue('INSTALL_TOKEN', '');
try { $already = (bool)one(db(), 'SELECT id FROM users LIMIT 1'); }
catch (Throwable $e) { http_response_code(503); exit('Database not ready. Import database/schema.sql then database/extension.sql and check .env.'); }
if ($already || strlen($token) < 32) { http_response_code(403); exit('The first-account installer is disabled.'); }
if (!isset($_SESSION['install_csrf'])) $_SESSION['install_csrf'] = bin2hex(random_bytes(24));
$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['install_csrf'], (string)($_POST['csrf'] ?? ''))) { http_response_code(403); exit('Security token rejected.'); }
    $username = trim((string)($_POST['username'] ?? '')); $name = trim((string)($_POST['name'] ?? '')); $pw = (string)($_POST['password'] ?? '');
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    if (!hash_equals($token, (string)($_POST['install_token'] ?? ''))) $message = 'Wrong setup token.';
    elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) $message = 'Enter a valid email address. Every login sends a code to this email.';
    elseif (!preg_match('/^[a-zA-Z0-9_.-]{3,70}$/', $username) || strlen($name) < 2 || strlen($name) > 100 || strlen($pw) < PASSWORD_MIN_LENGTH || !preg_match('/[A-Za-z]/', $pw) || !preg_match('/\d/', $pw))
        $message = 'Enter a valid username, full name and a password of ' . PASSWORD_MIN_LENGTH . '+ characters with letters and numbers.';
    else {
        try {
            $p = db(); $p->beginTransaction();
            $p->query('SELECT id FROM users FOR UPDATE');
            if (one($p, 'SELECT id FROM users LIMIT 1')) throw new RuntimeException('Setup already completed.');
            $p->prepare("INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?,?,?,?,'admin')")->execute([$username, $email, password_hash($pw, PASSWORD_DEFAULT), $name]);
            audit($p, (int)$p->lastInsertId(), 'Access', 'user 1', 'first admin account created');
            $p->commit(); header('Location: index.php'); exit;
        } catch (Throwable $e) { if (isset($p) && $p->inTransaction()) $p->rollBack(); error_log($e->getMessage()); $message = 'Could not create the account. Check the database and logs.'; }
    }
}
function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>First Admin account — Mulawin FleetOps</title>
<link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css"><link rel="stylesheet" href="assets/css/layout.css"><link rel="stylesheet" href="assets/css/login.css"></head>
<body class="login-page"><div class="login-shell"><div class="login-card mx-auto">
<div class="login-brand"><h1 class="brand-name">First Admin account</h1><p class="brand-sub">One-time setup. Afterwards clear INSTALL_TOKEN in .env and delete public/install.php.</p></div>
<?php if ($message): ?><div class="alert alert-danger"><?= e($message) ?></div><?php endif; ?>
<form method="post"><input type="hidden" name="csrf" value="<?= e($_SESSION['install_csrf']) ?>">
<div class="mb-3"><label class="form-label">Setup token (INSTALL_TOKEN)</label><input class="form-control" type="password" name="install_token" required></div>
<div class="mb-3"><label class="form-label">Username</label><input class="form-control" name="username" required></div>
<div class="mb-3"><label class="form-label">Full name</label><input class="form-control" name="name" required></div>
<div class="mb-3"><label class="form-label">Email (login codes are sent here)</label><input class="form-control" type="email" name="email" required></div>
<div class="mb-4"><label class="form-label">Password (<?= PASSWORD_MIN_LENGTH ?>+ characters, letters and numbers)</label><input class="form-control" type="password" name="password" minlength="<?= PASSWORD_MIN_LENGTH ?>" required></div>
<button class="btn btn-primary w-100 login-btn" type="submit">Create Admin account</button></form></div></div></body></html>
