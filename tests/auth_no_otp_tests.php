<?php
/*
 * tests/auth_no_otp_tests.php — DB-free checks for "authentication without email OTP".
 * Run:  php tests/auth_no_otp_tests.php
 * Needs no database, no mail server and no network. It checks (1) the OTP / trusted-device code is gone,
 * (2) the temporary-password generator, and (3) the wiring of the login, the Admin account actions and the
 * first-login gate by reading the source. Behaviour that needs MySQL is listed in the Phase 1 report, not claimed here.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
$root = dirname(__DIR__);
$PASS = 0; $FAIL = 0;
function ok(bool $c, string $name): void { global $PASS, $FAIL; if ($c) { $PASS++; echo "  PASS  $name\n"; } else { $FAIL++; echo "  FAIL  $name\n"; } }
$read = fn(string $f): string => (string)file_get_contents($root . '/' . $f);
/** Source of one `case 'x':` block (up to the next top-level case). */
$caseBlock = function (string $src, string $case): string {
    $a = strpos($src, "case '$case':"); if ($a === false) return '';
    $b = strpos($src, "\n            case '", $a + 5);
    return substr($src, $a, ($b === false ? strlen($src) : $b) - $a);
};

echo "A. OTP and trusted-device code removed\n";
ok(!is_file("$root/backend/Core/Otp.php"), 'backend/Core/Otp.php deleted');
ok(!is_file("$root/backend/Core/TrustedDevices.php"), 'backend/Core/TrustedDevices.php deleted');
$leak = [];
foreach (['public/index.php', 'public/assets/js/core.js', 'public/assets/js/modules/administration/admin.js', 'backend/Actions.php', 'backend/bootstrap.php',
          'backend/Core/AccountSecurity.php', 'backend/Core/SecurityPasswordChange.php', 'backend/Modules/Administration/Admin.php'] as $f) {
    if (preg_match('/\bOtp::|otp_verify|otp_resend|otp_cancel|otpScreen|TrustedDevices|trusted_devices|remember_device|login_otps|pending_uid/', $read($f))) $leak[] = $f;
}
ok($leak === [], 'no OTP / trusted-device references left in code' . ($leak ? ' (' . implode(', ', $leak) . ')' : ''));
$idx = $read('public/index.php');
ok(!preg_match("/case 'otp_/", $idx), 'no OTP endpoints in the API switch');

echo "B. Temporary password generator\n";
require_once $root . '/backend/Actions.php';
core('AccountSecurity');
Actions::load('Admin');
$seen = []; $bad = 0; $weak = 0;
for ($i = 0; $i < 3000; $i++) {
    $pw = AccountSecurity::newTemporaryPassword();
    $seen[$pw] = true;
    if (!preg_match('/^[A-HJ-NP-Z2-9]{16}$/D', $pw)) $bad++;
    try { Admin::strongPassword($pw); } catch (Throwable $e) { $weak++; }
}
ok($bad === 0, '3000 generated passwords: 16 chars, unambiguous alphabet only');
ok($weak === 0, '3000 generated passwords pass the password policy (letters + digits)');
ok(count($seen) === 3000, '3000 generated passwords are all different');
ok(str_contains($read('backend/Core/AccountSecurity.php'), 'random_bytes(16)') && !preg_match('/\b(rand|mt_rand|uniqid)\(/', substr($read('backend/Core/AccountSecurity.php'), strpos($read('backend/Core/AccountSecurity.php'), 'newTemporaryPassword'), 700)),
   'generator uses random_bytes(), not rand/mt_rand/uniqid');

echo "C. Admin account actions\n";
$adm = $read('backend/Modules/Administration/Admin.php');
$save = substr($adm, strpos($adm, 'private static function userSave'), strpos($adm, 'private static function userToggle') - strpos($adm, 'private static function userSave'));
$reset = substr($adm, strpos($adm, 'private static function userPassword'), strpos($adm, 'private static function changePassword') - strpos($adm, 'private static function userPassword'));
ok(!str_contains($save, "field(\$d, 'password'"), 'user_save no longer accepts an Admin-typed password');
ok(str_contains($save, 'newTemporaryPassword()') && str_contains($save, "'must_change_password' => 1") && str_contains($save, 'password_hash($pw, PASSWORD_DEFAULT)'),
   'user_save: generated password, stored only as password_hash, must_change_password=1');
ok(str_contains($save, "requireRole(\$u, 'admin')") && str_contains($reset, "requireRole(\$u, 'admin')"), 'both actions are Admin-only');
ok(str_contains($reset, 'newTemporaryPassword()') && str_contains($reset, 'must_change_password=1') && str_contains($reset, 'AccountSecurity::passwordChanged'),
   'user_password: new generated password, flag set, old sessions revoked');
ok(str_contains($reset, '$id !== $u[\'id\']'), 'Admin cannot reset their own password through the reset action');
foreach (['save' => $save, 'reset' => $reset] as $n => $src) {
    preg_match_all('/audit(?:WithChanges)?\([^;]*;/s', $src, $m);
    $bad = array_filter($m[0], fn($l) => str_contains($l, '$pw') || str_contains($l, 'temporary_password'));
    ok(!$bad, "user_$n audit entries never contain the password");
    ok(!preg_match('/Mailer::|error_log\(/', $src), "user_$n never emails or error-logs");
}
ok(!str_contains($adm, "'password_hash' => \$pw") && !preg_match('/SELECT[^;]*password_hash[^;]*FROM users[^;]*\)\s*as\s*\[/i', $adm), 'no plaintext password column is written or read for display');
ok(!str_contains($adm, "'id, username, email, full_name, role, shift, active, last_login_at, created_at, (signature_document_id IS NOT NULL) AS has_signature, password"), 'user list does not select password data');

echo "D. Login and first-login gate\n";
$login = $caseBlock($idx, 'login');
ok(str_contains($login, 'password_verify') && str_contains($login, 'checkCsrf') && str_contains($login, 'AccountSecurity::failure') && str_contains($login, "count(\$fails) < 5"),
   'login: CSRF, password_verify, per-session and per-account failure limits kept');
ok(str_contains($login, 'session_regenerate_id(true)') && str_contains($login, "'uid' =>"), 'login: session id regenerated and user set only after the password check');
ok(!str_contains($login, 'Otp') && !str_contains($login, 'Mailer'), 'login sends no email');
preg_match("/if \(!in_array\(\\\$api, \[([^\]]*)\]/", $idx, $m);
$allowed = array_map(fn($s) => trim($s, " '"), explode(',', $m[1] ?? ''));
sort($allowed);
$expect = ['Admin.password_change_confirm', 'Admin.password_change_force', 'Admin.password_change_request', 'login', 'logout', 'me', 'whoami'];
ok($allowed === $expect, 'while a password change is pending only login/logout/me/whoami and the password-change actions pass (email change waits)');
$act = $read('backend/Actions.php');
ok(substr_count($act, 'SecurityPasswordChange::required') >= 2 && strpos($act, "'Admin.password_change_force'") < strpos($act, 'SecurityPasswordChange::required((int)$u[\'id\'])'),
   'Actions::run and Actions::pageData block everything else with the same gate');
$runSrc = substr($act, strpos($act, 'public static function run('), strpos($act, 'public static function pageData(') - strpos($act, 'public static function run('));
$gatePos = strpos($runSrc, 'must(!SecurityPasswordChange::required');
ok($gatePos !== false && $gatePos < strpos($runSrc, "'Admin.email_change_request'") && $gatePos < strpos($runSrc, '$class::action('),
   'Actions::run: the first-login gate comes before email change and before every module action');
$me = $read('backend/Data.php');
$meGate = substr($me, strpos($me, "if (\$u['setup_required'])"), 700);
ok(strpos($me, "if (\$u['setup_required'])") < strpos($me, 'Notify::forUser') && strpos($me, "if (\$u['setup_required'])") < strpos($me, 'Access::navFor') && str_contains($meGate, 'return'),
   'me: while a password change is pending, returns before building menu, notifications, map or company data');
$seed = $read('public/seed_test_data.php');
ok(strpos($seed, 'SecurityPasswordChange::required') !== false && strpos($seed, 'SecurityPasswordChange::required') < strpos($seed, "require dirname(__DIR__) . '/scripts/seed_test_data.php'"),
   'public/seed_test_data.php (the only other page that reads the session) also honours the first-login gate');
foreach (glob($root . '/public/*.php') as $f) {
    $src = (string)file_get_contents($f); $n = basename($f);
    if (!in_array($n, ['index.php', 'seed_test_data.php', 'install.php'], true)) ok(false, "unexpected public entry point $n is not covered by the gate audit");
}
$spc = $read('backend/Core/SecurityPasswordChange.php');
$force = substr($spc, strpos($spc, 'function forceChange'), strpos($spc, 'private static function policy') - strpos($spc, 'function forceChange'));
ok(str_contains($force, 'must_change_password'), 'forceChange works only while the flag is set') ;
ok(strpos($force, 'verifyCurrentPassword') < strpos($force, 'UPDATE users SET password_hash=?, must_change_password=0'), 'temporary password is verified (with lockout) before the flag is cleared');
ok(substr_count($force, 'must_change_password=0') === 1 && str_contains($force, 'password_hash(') && str_contains($force, 'session_regenerate_id(true)') && !str_contains($force, 'Mailer'),
   'flag cleared only together with the new hash; session id regenerated; nothing emailed');
ok(str_contains($force, 'password changed at first login') && !preg_match('/audit\([^;]*\$new/', $force), 'first-login change is audited without the password');
ok(str_contains($spc, 'private static function policy') && substr_count($spc, 'self::policy(') === 2, 'one shared password policy for both change flows');

echo "\n$PASS passed, $FAIL failed\n";
exit($FAIL === 0 ? 0 : 1);
