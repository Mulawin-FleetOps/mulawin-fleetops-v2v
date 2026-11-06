<?php
/*
 * =====================================================================
 *  tests/_launcher.php  —  shared SAFE launcher for the integration tests
 * =====================================================================
 *  - The project .env is NOT read by the tests: the code is copied to a temporary
 *    folder with its own test .env, so db() can only reach the test databases.
 *  - Every database name must end with "_test" and must not be DB_NAME of the project .env.
 *  - MIGRATION CHAIN: when git is available, the schema as it was BEFORE $baseMigration was
 *    added is written to the copy (tests/_base_schema.sql, tests/_base_extension.sql), so the
 *    test can apply every migration from $baseMigration on, in order, and compare the result
 *    with a fresh install.
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

function run_isolated_tests(string $testFile, string $defaultPrefix, array $dbSuffixes, string $baseMigration, array $extraEnv = []): int {
    $root = dirname(__DIR__);
    $cfg = [
        'host' => getenv('TEST_DB_HOST') ?: '127.0.0.1',
        'port' => getenv('TEST_DB_PORT') ?: '3306',
        'user' => getenv('TEST_DB_USER') ?: '',
        'pass' => getenv('TEST_DB_PASS') !== false ? (string)getenv('TEST_DB_PASS') : '',
        'prefix' => getenv('TEST_DB_PREFIX') ?: $defaultPrefix,
    ];
    if ($cfg['user'] === '') { fwrite(STDERR, "Set TEST_DB_USER (and TEST_DB_PASS) first. See tests/README.md.\n"); return 2; }
    if (!preg_match('/^[a-z0-9_]{1,30}$/', $cfg['prefix'])) { fwrite(STDERR, "TEST_DB_PREFIX may only contain a-z, 0-9 and _ (max 30).\n"); return 2; }
    $names = [];
    foreach ($dbSuffixes as $s) $names[$s] = $cfg['prefix'] . '_' . $s . '_test';

    $projectDb = '';
    if (is_file($root . '/.env')) {
        foreach (file($root . '/.env', FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (preg_match('/^\s*DB_NAME\s*=\s*["\']?([^"\'\s]*)/', $line, $m)) $projectDb = $m[1];
        }
    }
    foreach ($names as $n) {
        if (!preg_match('/^[a-z0-9_]+_test$/', $n)) { fwrite(STDERR, "Refused: $n does not end with _test.\n"); return 2; }
        if ($projectDb !== '' && strcasecmp($n, $projectDb) === 0) { fwrite(STDERR, "Refused: $n is the project database in .env.\n"); return 2; }
    }

    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mulawin_tests_' . bin2hex(random_bytes(4));
    $copy = function (string $from, string $to) use (&$copy): void {
        if (is_dir($from)) { @mkdir($to, 0700, true); foreach (scandir($from) ?: [] as $f) if ($f !== '.' && $f !== '..') $copy("$from/$f", "$to/$f"); }
        else copy($from, $to);
    };
    foreach (['backend', 'config', 'database', 'public', 'tests'] as $dir) $copy("$root/$dir", "$tmp/$dir");
    @mkdir("$tmp/storage/private", 0700, true);
    @mkdir("$tmp/storage/backups", 0700, true);
    $env = ['APP_ENV=test', 'APP_TIMEZONE=Asia/Manila',
        'DB_HOST=' . $cfg['host'], 'DB_PORT=' . $cfg['port'], 'DB_NAME=' . reset($names),
        'DB_USER=' . $cfg['user'], 'DB_PASS=' . $cfg['pass'],
        'MAIL_HOST=', 'MAIL_USERNAME=', 'MAIL_PASSWORD=', 'MAIL_FROM_ADDRESS=', 'ORS_API_KEY='];
    foreach ($names as $s => $n) $env[] = 'TEST_DB_' . strtoupper($s) . '=' . $n;
    foreach ($extraEnv as $k => $v) $env[] = "$k=$v";
    file_put_contents("$tmp/.env", implode("\n", $env) . "\n");

    // Schema BEFORE $baseMigration was added (git), for the migration chain test.
    $null = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
    $git = 'git -C ' . escapeshellarg($root);
    $commits = array_values(array_filter(explode("\n", trim((string)@shell_exec("$git log --diff-filter=A --format=%H -- " . escapeshellarg("database/migrations/$baseMigration.sql") . " 2>$null")))));
    $added = $commits ? end($commits) : '';   // oldest commit that added the migration file
    if (preg_match('/^[0-9a-f]{40}$/', $added)) {
        foreach (['schema', 'extension'] as $f) {
            $sql = (string)@shell_exec("$git show {$added}^:database/$f.sql 2>$null");
            if ($sql !== '') file_put_contents("$tmp/tests/_base_$f.sql", $sql);
        }
    }

    passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$tmp/tests/$testFile"), $code);

    $rm = function (string $p) use (&$rm): void {
        if (is_dir($p) && !is_link($p)) { foreach (scandir($p) ?: [] as $f) if ($f !== '.' && $f !== '..') $rm("$p/$f"); @rmdir($p); }
        else @unlink($p);
    };
    $rm($tmp);   // the copy holds the test password
    return (int)$code;
}

/* ---------------------------------------------------------------------
 * Helpers used INSIDE the temporary copy by the test files.
 * ------------------------------------------------------------------- */
const TEST_NAME_RULE = '/^[a-z0-9_]+_test$/';

/** Refuses to run outside the temporary copy or on a database that does not end with _test. */
function test_guard(array $names): void {
    foreach ($names as $n) if (!preg_match(TEST_NAME_RULE, (string)$n)) { fwrite(STDERR, "Refused: database name '$n' does not end with _test. Use the tests/run_*.php launcher.\n"); exit(2); }
    $env = dirname(__DIR__) . '/.env';
    if (!is_file($env) || !str_contains((string)file_get_contents($env), 'APP_ENV=test')) { fwrite(STDERR, "Refused: this is not the temporary test copy. Use the tests/run_*.php launcher.\n"); exit(2); }
}
function test_server(): PDO {
    static $s = null;
    return $s ??= new PDO('mysql:host=' . envValue('DB_HOST') . ';port=' . envValue('DB_PORT') . ';charset=utf8mb4', envValue('DB_USER'), envValue('DB_PASS'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
}
function test_conn(string $db): PDO {
    if (!preg_match(TEST_NAME_RULE, $db)) { fwrite(STDERR, "Refused $db\n"); exit(2); }
    $p = new PDO('mysql:host=' . envValue('DB_HOST') . ';port=' . envValue('DB_PORT') . ';dbname=' . $db . ';charset=utf8mb4', envValue('DB_USER'), envValue('DB_PASS'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    if ($p->query('SELECT DATABASE()')->fetchColumn() !== $db) { fwrite(STDERR, "Connected to the wrong database\n"); exit(2); }
    return $p;
}
/** Drops and re-creates ONE disposable test database (guarded by the _test name rule). */
function test_recreate(string $db): void {
    if (!preg_match(TEST_NAME_RULE, $db)) { fwrite(STDERR, "Refused to reset $db\n"); exit(2); }
    test_server()->exec("DROP DATABASE IF EXISTS `$db`");
    test_server()->exec("CREATE DATABASE `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
}
/** Imports SQL text (same splitting rule as scripts/seed_test_data.php). */
function test_import(PDO $p, string $sql): void {
    $sql = (string)preg_replace('/^\s*--.*$/m', '', $sql);
    foreach (preg_split('/;\s*\n/', $sql) as $stmt) { $stmt = trim($stmt); if ($stmt !== '') $p->exec($stmt); }
}
function test_sql(string $rel): string { return (string)file_get_contents(dirname(__DIR__) . '/' . $rel); }
/** Migration files from $first on, in name order (= the order they must be imported). */
function test_migrations_from(string $first): array {
    $out = [];
    foreach (glob(dirname(__DIR__) . '/database/migrations/*.sql') ?: [] as $f) { $id = basename($f, '.sql'); if (strcmp($id, $first) >= 0) $out[] = $id; }
    sort($out, SORT_STRING);
    return $out;
}
/** Schema fingerprint of a database (tables, columns, indexes, checks, foreign keys). */
function test_fingerprint(PDO $p, string $db): array {
    $q = fn(string $sql) => array_map('json_encode', many($p, $sql, [$db]));
    return [
        'tables' => $q('SELECT table_name, engine, table_collation FROM information_schema.tables WHERE table_schema=? ORDER BY table_name'),
        'columns' => $q('SELECT table_name, column_name, ordinal_position, column_type, is_nullable, column_default, extra, generation_expression, column_comment
                         FROM information_schema.columns WHERE table_schema=? ORDER BY table_name, ordinal_position'),
        'indexes' => $q('SELECT table_name, index_name, seq_in_index, column_name, non_unique FROM information_schema.statistics WHERE table_schema=? ORDER BY table_name, index_name, seq_in_index'),
        'checks' => $q('SELECT table_name, constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema=? ORDER BY table_name, constraint_name'),
        'fks' => $q('SELECT k.table_name, k.constraint_name, k.column_name, k.referenced_table_name, k.referenced_column_name FROM information_schema.key_column_usage k
                     WHERE k.table_schema=? AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name, k.ordinal_position'),
    ];
}
