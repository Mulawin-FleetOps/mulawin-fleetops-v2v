<?php
/*
 * =====================================================================
 *  public/index.php  —  the only page the browser opens
 * =====================================================================
 *  1. Without ?api=  -> sends the HTML shell (login / app screen).
 *  2. With ?api=...  -> JSON API used by the screen:
 *       whoami, login (step 1: password), otp_verify (step 2: email code), otp_resend,
 *       otp_cancel, recover (Admin recovery code), logout, me
 *       data&page=xyz                      data for one page
 *       Module.action  (POST JSON)         save something
 *       document_upload / document_download / backup_download
 *  All POST requests need the CSRF token.
 * =====================================================================
 */
declare(strict_types=1);
require_once dirname(__DIR__) . '/backend/bootstrap.php';
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once dirname(__DIR__) . '/backend/Data.php';

if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
core('AccountSecurity');
core('Otp');
const LOCKED_MSG = 'This account is locked for 15 minutes because of too many wrong passwords or codes. Try again later.';

/** The user who typed a correct password but has not entered the email code yet (or null). */
function pendingLogin(): ?array {
    $id = (int)($_SESSION['pending_uid'] ?? 0);
    if (!$id) return null;
    if (time() - (int)($_SESSION['pending_at'] ?? 0) > Otp::PENDING_MINUTES * 60) { unset($_SESSION['pending_uid'], $_SESSION['pending_at']); return null; }
    $row = one(db(), 'SELECT * FROM users WHERE id=? AND active=1', [$id]);
    if (!$row) { unset($_SESSION['pending_uid'], $_SESSION['pending_at']); return null; }
    return $row;
}

function checkCsrf(?string $given): void {
    must(hash_equals((string)($_SESSION['csrf'] ?? ''), (string)$given), 'Security token expired. Please reload the page.', 403);
}

if (isset($_GET['api'])) {
    $api = (string)$_GET['api'];
    try {
        switch ($api) {
            case 'whoami':
                $pending = pendingLogin();
                jsonOut(['ok' => true, 'signedIn' => (bool)($_SESSION['uid'] ?? false), 'csrf' => $_SESSION['csrf'],
                         'otp' => $pending ? ['email' => Mailer::mask((string)$pending['email']), 'resend_in' => Otp::resendWait((int)$pending['id']), 'minutes' => Otp::OTP_MINUTES] : null]);
            case 'login':
                // Step 1 of 2: username (or email) + password. The session is NOT logged in yet.
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                $d = inputData();
                checkCsrf($d['csrf'] ?? '');
                $login = field($d, 'username', 190); $password = field($d, 'password', 255);
                $now = time();
                $fails = array_values(array_filter($_SESSION['login_failures'] ?? [], fn($t) => $now - (int)$t < 900));
                must(count($fails) < 5, 'Too many wrong tries. Please wait 15 minutes.', 429);
                $row = one(db(), 'SELECT * FROM users WHERE (username=? OR email=?) AND active=1 LIMIT 1', [$login, $login]);
                // Account lock (from any computer): 5 wrong passwords or codes = locked for 15 minutes.
                must(!$row || !AccountSecurity::isLocked($row), LOCKED_MSG, 429);
                if (!$row || !password_verify($password, (string)$row['password_hash'])) {
                    $fails[] = $now; $_SESSION['login_failures'] = $fails;
                    if ($row && AccountSecurity::failure($row)) fail(LOCKED_MSG, 429);
                    fail('Wrong username or password.' . (count($fails) >= 3 ? ' (' . (5 - count($fails)) . ' tries left)' : ''), 401);
                }
                must(in_array($row['role'], allowedRoles(), true), 'Account role is not allowed.', 403);
                must(trim((string)$row['email']) !== '', 'This account has no email address for the login code. Ask the Admin to add one.', 409);
                unset($_SESSION['login_failures'], $_SESSION['uid']);
                session_regenerate_id(true);
                $_SESSION['pending_uid'] = (int)$row['id']; $_SESSION['pending_at'] = time();
                $err = Otp::issue($row);
                if ($err !== null && str_starts_with($err, 'Please wait') && Otp::hasActive((int)$row['id'])) {
                    // A code was sent less than a minute ago and still works: ask for that code instead of sending another.
                    jsonOut(['ok' => true, 'otp' => ['email' => Mailer::mask((string)$row['email']), 'resend_in' => Otp::resendWait((int)$row['id']), 'minutes' => Otp::OTP_MINUTES],
                             'notice' => 'A code was already sent a moment ago. Use that code.']);
                }
                if ($err !== null) {
                    unset($_SESSION['pending_uid'], $_SESSION['pending_at']);
                    fail($err, str_starts_with($err, 'Please wait') || str_starts_with($err, 'Too many') ? 429 : 503);
                }
                jsonOut(['ok' => true, 'otp' => ['email' => Mailer::mask((string)$row['email']), 'resend_in' => Otp::OTP_RESEND_SECONDS, 'minutes' => Otp::OTP_MINUTES]]);
            case 'otp_verify':
                // Step 2 of 2: the 6-digit code from the email.
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                $d = inputData();
                checkCsrf($d['csrf'] ?? '');
                $row = pendingLogin();
                must((bool)$row, 'Your login step expired. Enter your username and password again.', 401);
                must(!AccountSecurity::isLocked($row), LOCKED_MSG, 429);
                $res = Otp::verify((int)$row['id'], preg_replace('/\D/', '', (string)($d['code'] ?? '')));
                if (!$res['ok']) {
                    if (AccountSecurity::failure($row)) { unset($_SESSION['pending_uid'], $_SESSION['pending_at']); fail(LOCKED_MSG, 429); }
                    fail($res['error'], 401);
                }
                AccountSecurity::success((int)$row['id']);
                session_regenerate_id(true);
                unset($_SESSION['pending_uid'], $_SESSION['pending_at']);
                $_SESSION['uid'] = (int)$row['id']; $_SESSION['last_seen'] = time(); $_SESSION['login_at'] = time();
                $_SESSION['csrf'] = bin2hex(random_bytes(24));
                run(db(), 'UPDATE users SET last_login_at=NOW() WHERE id=?', [$row['id']]);
                audit(db(), (int)$row['id'], 'Access', 'user ' . $row['id'], 'signed in', 'password + email code');
                jsonOut(['ok' => true]);
            case 'otp_resend':
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                $d = inputData();
                checkCsrf($d['csrf'] ?? '');
                $row = pendingLogin();
                must((bool)$row, 'Your login step expired. Enter your username and password again.', 401);
                must(!AccountSecurity::isLocked($row), LOCKED_MSG, 429);
                $err = Otp::issue($row);
                if ($err !== null) fail($err, str_starts_with($err, 'Please wait') || str_starts_with($err, 'Too many') ? 429 : 503);
                jsonOut(['ok' => true, 'otp' => ['email' => Mailer::mask((string)$row['email']), 'resend_in' => Otp::OTP_RESEND_SECONDS, 'minutes' => Otp::OTP_MINUTES],
                         'data' => ['message' => 'A new code was sent. Older codes no longer work.']]);
            case 'otp_cancel':
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                $d = inputData();
                checkCsrf($d['csrf'] ?? '');
                unset($_SESSION['pending_uid'], $_SESSION['pending_at']);
                jsonOut(['ok' => true]);
            case 'recover':
                // Nakalimutan / na-hack ang Admin password: recovery code (naka-print at nakatago) + bagong password.
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                $d = inputData();
                checkCsrf($d['csrf'] ?? '');
                $username = field($d, 'username', 70); $code = AccountSecurity::normalizeCode(field($d, 'code', 40)); $new = field($d, 'new_password', 255);
                $now = time();
                $fails = array_values(array_filter($_SESSION['login_failures'] ?? [], fn($t) => $now - (int)$t < 900));
                must(count($fails) < 5, 'Too many wrong tries. Please wait 15 minutes.', 429);
                $row = one(db(), "SELECT * FROM users WHERE username=? AND active=1 AND role='admin'", [$username]);
                must(!$row || array_key_exists('recovery_hash', $row), 'Recovery is not ready yet. Ask IT to import database/migrations/2026-11-04_account_security.sql.', 409);
                must(!$row || !AccountSecurity::isLocked($row), LOCKED_MSG, 429);
                if (!$row || empty($row['recovery_hash']) || !password_verify($code, (string)$row['recovery_hash'])) {
                    $fails[] = $now; $_SESSION['login_failures'] = $fails;
                    if ($row && AccountSecurity::failure($row)) fail(LOCKED_MSG, 429);
                    fail('Wrong Admin username or recovery code.', 401);
                }
                must(strlen($new) >= PASSWORD_MIN_LENGTH && preg_match('/[A-Za-z]/', $new) && preg_match('/\d/', $new), 'Password must have at least ' . PASSWORD_MIN_LENGTH . ' characters with letters and numbers.');
                run(db(), 'UPDATE users SET password_hash=?, recovery_hash=NULL WHERE id=?', [password_hash($new, PASSWORD_DEFAULT), $row['id']]);
                AccountSecurity::passwordChanged((int)$row['id']); // lahat ng lumang session ng account ay mala-log out
                audit(db(), (int)$row['id'], 'Access', 'user ' . $row['id'], 'password reset with recovery code', 'old sessions signed out; recovery code used up');
                unset($_SESSION['login_failures']);
                jsonOut(['ok' => true, 'data' => ['message' => 'Password reset. Log in with the new password and the code sent to your email, then make a new recovery code (the old one no longer works).']]);
            case 'logout':
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                checkCsrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
                session_unset(); session_destroy();
                jsonOut(['ok' => true]);
            case 'me':
                jsonOut(Data::me());
            case 'data':
                jsonOut(['ok' => true, 'data' => Actions::pageData((string)($_GET['page'] ?? ''), $_GET)]);
            case 'document_upload':
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                checkCsrf($_POST['csrf'] ?? '');
                $u = currentUser();
                Actions::load('Documents');
                jsonOut(['ok' => true, 'data' => Documents::upload($u)]);
            case 'document_download':
                $u = currentUser();
                $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
                must($id !== false && $id > 0, 'Invalid document.');
                Actions::load('Documents');
                Documents::download($u, (int)$id, !empty($_GET['inline']));
            case 'signature':
                // E-signature image of a user, for printed forms. Signed-in users only; never a public file.
                currentUser();
                $uid = filter_var($_GET['user'] ?? null, FILTER_VALIDATE_INT);
                must($uid !== false && $uid > 0, 'Invalid user.');
                $doc = one(db(), "SELECT d.storage_name, d.mime_type FROM users u JOIN documents d ON d.id=u.signature_document_id WHERE u.id=? AND d.entity_type='user'", [(int)$uid]);
                if (!$doc) { http_response_code(404); exit; }
                $file = dirname(__DIR__) . '/storage/private/' . basename((string)$doc['storage_name']);
                if (!is_file($file)) { http_response_code(404); exit; }
                header('Content-Type: ' . (in_array($doc['mime_type'], ['image/png', 'image/jpeg'], true) ? $doc['mime_type'] : 'application/octet-stream'));
                header('Cache-Control: private, no-store'); header('Content-Disposition: inline; filename="signature"');
                header('Content-Length: ' . filesize($file)); readfile($file); exit;
            case 'backup_download':
                $u = currentUser(); requireRole($u, 'admin');
                $name = basename((string)($_GET['file'] ?? ''));
                must((bool)preg_match('/^mulawin_backup_\d{8}_\d{6}\.sql$/', $name), 'Invalid backup file.');
                $file = dirname(__DIR__) . '/storage/backups/' . $name;
                must(is_file($file), 'Backup not found.', 404);
                header('Content-Type: application/sql'); header('Content-Disposition: attachment; filename="' . $name . '"');
                header('Content-Length: ' . filesize($file)); readfile($file); exit;
            default:
                must($_SERVER['REQUEST_METHOD'] === 'POST', 'POST required.', 405);
                checkCsrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
                jsonOut(['ok' => true, 'data' => Actions::run($api, inputData())]);
        }
    } catch (BusinessRuleException $e) {
        fail($e->getMessage(), $e->httpStatus);
    } catch (ModuleUnavailable $e) {
        fail($e->getMessage(), 503);
    } catch (PDOException $e) {
        error_log('Database error: ' . $e->getMessage());
        $msg = str_contains($e->getMessage(), 'Duplicate entry') ? 'This record already exists (duplicate).' : 'Database problem. Check the setup and the server error log.';
        fail($msg, 500);
    } catch (Throwable $e) {
        error_log('Unexpected error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        fail('Unexpected error. See the server error log.', 500);
    }
}

// ---------------- HTML shell ----------------
// Each module script is separate: if one file fails, the other pages still work.
// Screen files naka-grupo ayon sa department (public/assets/js/modules/<department>/<file>.js).
$jsModules = ['general/dashboard', 'operations/trips', 'operations/fleet', 'operations/clients', 'maintenance/mechanics', 'maintenance/maintenance',
              'maintenance/purchasing', 'accounting/funds', 'accounting/billing', 'accounting/finance', 'general/documents', 'general/reports',
              'general/notifications', 'administration/admin'];
$v = static fn(string $f): string => is_file(__DIR__ . '/' . $f) ? (string)filemtime(__DIR__ . '/' . $f) : '1';
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" type="image/png" href="assets/img/favicon.png">
  <title>Mulawin FleetOps — R.P. Mulawin Fleet Management System</title>
  <link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css">
  <link rel="stylesheet" href="assets/vendor/bootstrap-icons/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css">
  <link rel="stylesheet" href="assets/css/layout.css?v=<?= $v('assets/css/layout.css') ?>">
  <link rel="stylesheet" href="assets/css/login.css?v=<?= $v('assets/css/login.css') ?>">
  <link rel="stylesheet" href="assets/css/app.css?v=<?= $v('assets/css/app.css') ?>">
</head>
<body>
  <div id="app"><div class="text-center p-5 text-muted">Loading Mulawin FleetOps…</div></div>
  <div class="toast-zone" id="toastZone" aria-live="polite"></div>
  <script src="assets/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="assets/vendor/chartjs/chart.umd.min.js"></script>
  <script src="assets/vendor/leaflet/leaflet.js"></script>
  <script src="assets/js/core.js?v=<?= $v('assets/js/core.js') ?>"></script>
<?php foreach ($jsModules as $m): ?>
  <script src="assets/js/modules/<?= $m ?>.js?v=<?= $v('assets/js/modules/' . $m . '.js') ?>"></script>
<?php endforeach; ?>
  <script>App.start();</script>
</body>
</html>
