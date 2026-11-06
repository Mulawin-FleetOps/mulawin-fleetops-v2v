<?php
/*
 * =====================================================================
 *  tests/run_route_tests.php  —  launcher of the Client Routes tests (Checklist #20)
 * =====================================================================
 *  SAFETY (the project's real / development database is never used):
 *   - The project .env is NOT read. The code is copied to a temporary folder and a
 *     separate test .env is written there, so db() can only reach the test databases.
 *   - Every database name must end with "_test" and must not be the DB_NAME of the
 *     project .env. Otherwise the run stops before anything is created or dropped.
 *   - Only these disposable databases are dropped and re-created:
 *       <prefix>_fresh_test, <prefix>_upgrade_test, <prefix>_partial_test
 *
 *  RUN (needs a MySQL / MariaDB user that may create those databases):
 *    Linux / Hostinger SSH:
 *      TEST_DB_USER=fleet_test TEST_DB_PASS=secret php tests/run_route_tests.php
 *    XAMPP (Windows, Command Prompt):
 *      set TEST_DB_USER=root
 *      set TEST_DB_PASS=
 *      C:\xampp\php\php.exe tests\run_route_tests.php
 *  Optional: TEST_DB_HOST (127.0.0.1), TEST_DB_PORT (3306), TEST_DB_PREFIX (mulawin_routes)
 *  Exit code 0 = every test passed.
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

$root = dirname(__DIR__);
$cfg = [
    'host' => getenv('TEST_DB_HOST') ?: '127.0.0.1',
    'port' => getenv('TEST_DB_PORT') ?: '3306',
    'user' => getenv('TEST_DB_USER') ?: '',
    'pass' => getenv('TEST_DB_PASS') !== false ? (string)getenv('TEST_DB_PASS') : '',
    'prefix' => getenv('TEST_DB_PREFIX') ?: 'mulawin_routes',
];
if ($cfg['user'] === '') { fwrite(STDERR, "Set TEST_DB_USER (and TEST_DB_PASS) first. See the top of this file.\n"); exit(2); }
if (!preg_match('/^[a-z0-9_]{1,30}$/', $cfg['prefix'])) { fwrite(STDERR, "TEST_DB_PREFIX may only contain a-z, 0-9 and _ (max 30).\n"); exit(2); }

$names = ['fresh' => $cfg['prefix'] . '_fresh_test', 'upgrade' => $cfg['prefix'] . '_upgrade_test', 'partial' => $cfg['prefix'] . '_partial_test'];

// Never the project database.
$projectDb = '';
if (is_file($root . '/.env')) {
    foreach (file($root . '/.env', FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\s*DB_NAME\s*=\s*["\']?([^"\'\s]*)/', $line, $m)) $projectDb = $m[1];
    }
}
foreach ($names as $n) {
    if (!preg_match('/^[a-z0-9_]+_test$/', $n)) { fwrite(STDERR, "Refused: $n does not end with _test.\n"); exit(2); }
    if ($projectDb !== '' && strcasecmp($n, $projectDb) === 0) { fwrite(STDERR, "Refused: $n is the project database in .env.\n"); exit(2); }
}

// Temporary copy of the code with its own test .env.
$tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mulawin_route_tests_' . bin2hex(random_bytes(4));
$copy = function (string $from, string $to) use (&$copy): void {
    if (is_dir($from)) {
        @mkdir($to, 0700, true);
        foreach (scandir($from) ?: [] as $f) if ($f !== '.' && $f !== '..') $copy("$from/$f", "$to/$f");
    } else { copy($from, $to); }
};
foreach (['backend', 'config', 'database', 'public', 'tests'] as $dir) $copy("$root/$dir", "$tmp/$dir");
@mkdir("$tmp/storage/private", 0700, true);
@mkdir("$tmp/storage/backups", 0700, true);
file_put_contents("$tmp/.env", implode("\n", [
    'APP_ENV=test', 'APP_TIMEZONE=Asia/Manila',
    'DB_HOST=' . $cfg['host'], 'DB_PORT=' . $cfg['port'], 'DB_NAME=' . $names['fresh'],
    'DB_USER=' . $cfg['user'], 'DB_PASS=' . $cfg['pass'],
    'TEST_DB_UPGRADE=' . $names['upgrade'], 'TEST_DB_PARTIAL=' . $names['partial'],
    'MAIL_HOST=', 'MAIL_USERNAME=', 'MAIL_PASSWORD=', 'MAIL_FROM_ADDRESS=', 'MAPTILER_API_KEY=',
]) . "\n");

// extension.sql as it was BEFORE this feature (for the upgrade test), when git is available.
$prev = '';
$base = trim((string)@shell_exec('git -C ' . escapeshellarg($root) . ' merge-base HEAD origin/main 2>' . (DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null')));
if ($base !== '' && preg_match('/^[0-9a-f]{7,40}$/', $base)) {
    $prev = (string)@shell_exec('git -C ' . escapeshellarg($root) . ' show ' . $base . ':database/extension.sql 2>' . (DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null'));
}
if ($prev !== '' && !str_contains($prev, 'client_routes')) file_put_contents("$tmp/tests/_previous_extension.sql", $prev);

passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$tmp/tests/route_tests.php"), $code);

// Remove the temporary copy (it holds the test password).
$rm = function (string $p) use (&$rm): void {
    if (is_dir($p) && !is_link($p)) { foreach (scandir($p) ?: [] as $f) if ($f !== '.' && $f !== '..') $rm("$p/$f"); @rmdir($p); }
    else @unlink($p);
};
$rm($tmp);
exit($code);
