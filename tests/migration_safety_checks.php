<?php
declare(strict_types=1);
require dirname(__DIR__) . '/scripts/lib/migration_sql.php';

function check(bool $condition, string $description): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: $description\n");
        exit(1);
    }
    echo "PASS: $description\n";
}
$cases = [
    ['SELECT 1; SELECT 2;', 2],
    ["-- line comment\nSELECT ';'; # trailing\nSELECT 2;", 2],
    ["/* semicolon ; comment */\nSELECT 1;", 1],
    ["SET @v = IF(1, 'a; b', 'c'); PREPARE p FROM @v; EXECUTE p; DEALLOCATE PREPARE p;", 4],
    ["INSERT INTO t VALUES ('it''s; fine');", 1],
    ["INSERT INTO t VALUES ('back\\'slash; ok');", 1],
    ["SELECT `semi;colon` FROM t;", 1],
    ["-- blank comment\n", 0],
];
foreach ($cases as $index => [$input, $count]) {
    check(count(migrationSqlStatements($input)) === $count, "SQL parser case " . ($index + 1));
}
foreach (["SELECT 'unfinished", "/* unfinished", "DELIMITER $$\nSELECT 1;"] as $bad) {
    $rejected = false;
    try { migrationSqlStatements($bad); }
    catch (RuntimeException $e) { $rejected = true; }
    check($rejected, 'Reject malformed/unsupported SQL');
}
$runner = file_get_contents(dirname(__DIR__) . '/scripts/migrate.php');
check($runner !== false, 'Migration runner exists');
foreach (['--status', 'MIGRATIONS_ENABLED', 'MIGRATIONS_EXPECTED_DB', 'MIGRATIONS_APPROVED_IDS', 'MIGRATIONS_BACKUP_VERIFIED', 'GET_LOCK', 'schema_migrations'] as $guard) {
    check(str_contains($runner, $guard), "Runner guard: $guard");
}
echo "All offline migration safety checks passed. No database used.\n";
