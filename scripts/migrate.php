<?php
/*
 * scripts/migrate.php — automatically runs pending migrations after git pull.
 * Usage (CLI only): php scripts/migrate.php --status [default]
 *                   php scripts/migrate.php --apply
 * Applying requires server .env flags MIGRATIONS_ENABLED=1,
 * MIGRATIONS_EXPECTED_DB and MIGRATIONS_APPROVED_IDS (comma-separated).
 * Do not schedule --apply until deployment/backup checks are implemented.
 *
 *
 *   this is baste, i made this shit because i dont know fcuking sql queries to migrate...
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/backend/bootstrap.php';

$args = array_slice($argv, 1);
if (count($args) > 1 || !in_array($args[0] ?? '--status', ['--status', '--apply'], true)) {
    fwrite(STDERR, "Usage: php scripts/migrate.php [--status|--apply]\\n");
    exit(2);
}
$apply = ($args[0] ?? '--status') === '--apply';

// MySQL DDL is not atomic. Parse simple SQL files into separate statements
// without breaking semicolons inside quoted strings or SQL comments.
function migrationSqlStatements(string $sql): array {
    if (preg_match('/^\\s*(DELIMITER|SOURCE)\\b/im', $sql)) throw new RuntimeException('Unsupported mysql-client directive.');
    $statements = [];
    $buffer = '';
    $quote = '';
    $line = false;
    $block = false;
    $n = strlen($sql);
    for ($i = 0; $i < $n; $i++) {
        $ch = $sql[$i];
        $next = $i + 1 < $n ? $sql[$i + 1] : '';
        if ($line) {
            if ($ch === "\\n" || $ch === "\\r") { $line = false; $buffer .= "\\n"; }
            continue;
        }
        if ($block) {
            if ($ch === '*' && $next === '/') { $block = false; $i++; }
            continue;
        }
        if ($quote !== '') {
            $buffer .= $ch;
            if ($ch === chr(92) && $next !== '') { $buffer .= $next; $i++; }
            elseif ($ch === $quote) {
                if ($next === $quote) { $buffer .= $next; $i++; }
                else $quote = '';
            }
            continue;
        }
        if ($ch === '-' && $next === '-' && ($i+2 >= $n || ctype_space($sql[$i+2]))) { $line = true; $i++; continue; }
        if ($ch === '#') { $line = true; continue; }
        if ($ch === '/' && $next === '*') { $block = true; $i++; continue; }
        if (in_array($ch, ["'", '"', '`'], true)) { $quote = $ch; $buffer .= $ch; continue; }
        if ($ch === ';') {
            if (trim($buffer) !== '') $statements[] = trim($buffer);
            $buffer = '';
            continue;
        }
        $buffer .= $ch;
    }
    if ($quote !== '' || $block) throw new RuntimeException('Unclosed quote or comment in migration.');
    if (trim($buffer) !== '') $statements[] = trim($buffer);
    return $statements;
}

try {
    $p = db();
    $database = (string)$p->query('SELECT DATABASE()')->fetchColumn();
    if ($database === '') throw new RuntimeException('No database selected.');
    if ($apply) {
        if (envValue('MIGRATIONS_ENABLED') !== '1') throw new RuntimeException('Migration application is disabled.');
        if (envValue('MIGRATIONS_EXPECTED_DB') === '' || envValue('MIGRATIONS_EXPECTED_DB') !== $database) {
            throw new RuntimeException('Database name does not match MIGRATIONS_EXPECTED_DB.');
        }
        if ((int)$p->query("SELECT GET_LOCK('mulawin_schema_migrations',0)")->fetchColumn() !== 1) {
            throw new RuntimeException('Another migration is running.');
        }
    }
    // Never initialize or import a production schema implicitly.
    $exists = (int)$p->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'")->fetchColumn();
    if (!$exists) throw new RuntimeException('schema_migrations table missing; manual setup required.');

    $applied = $p->query("SELECT id FROM schema_migrations")->fetchAll(PDO::FETCH_COLUMN);
    $appliedSet = array_flip($applied);

    $migrationDir = dirname(__DIR__) . '/database/migrations';
    $files = glob($migrationDir . '/*.sql');
    sort($files);

    $pending = array_values(array_filter($files, static function (string $file) use ($appliedSet): bool {
        return !isset($appliedSet[basename($file, '.sql')]);
    }));
    echo 'Database: ' . $database . "\\n";
    foreach ($pending as $file) echo 'Pending: ' . basename($file) . "\\n";
    if (!$apply) {
        echo "Read-only status; no SQL executed.\\n";
        exit(0);
    }
    $approved = array_filter(array_map('trim', explode(',', envValue('MIGRATIONS_APPROVED_IDS'))));
    foreach ($pending as $file) {
        $id = basename($file, '.sql');
        if (!in_array($id, $approved, true)) throw new RuntimeException("Unapproved migration: $id");
    }
    $ran = 0;
    foreach ($files as $file) {
        $name = basename($file, '.sql');
        if (isset($appliedSet[$name])) {
            continue;
        }

        // Halt on schema/history drift before attempting to run these known migrations.
        if ($name === '2026-11-15_17_dispatcher_multi_types') {
            $found = (int)$p->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='dispatcher_truck_types'")->fetchColumn();
            if ($found) throw new RuntimeException('Dispatcher column exists but migration history is missing; reconcile manually.');
        } elseif ($name === '2026-11-15_18_driver_truck_authorizations') {
            $found = (int)$p->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='driver_truck_authorizations'")->fetchColumn();
            if ($found) throw new RuntimeException('Authorization table exists but migration history is missing; reconcile manually.');
        } elseif ($name === '2026-11-15_19_missed_trips') {
            $clause = $p->query("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_trip_status' LIMIT 1")->fetchColumn();
            if ($clause !== false && stripos((string)$clause, 'Missed') !== false) {
                throw new RuntimeException('Missed status exists but migration history is missing; reconcile manually.');
            }
        }
        echo "Applying: $name.sql ... ";
        $sql = file_get_contents($file);
        if ($sql === false || trim($sql) === '') throw new RuntimeException("Empty/unreadable migration: $name");

        try {
            $statements = migrationSqlStatements($sql);
            if ($statements === []) throw new RuntimeException('No executable SQL statements.');
            foreach ($statements as $statement) $p->exec($statement);
            // Ensure recorded in schema_migrations if script didn't insert it
            $stmt = $p->prepare("INSERT IGNORE INTO schema_migrations (id) VALUES (?)");
            $stmt->execute([$name]);
            echo "DONE\n";
            $ran++;
        } catch (Throwable $e) {
            echo "FAILED\n";
            fwrite(STDERR, "Error in $name.sql: " . $e->getMessage() . "\n");
            exit(1);
        }
    }

    if ($ran === 0) {
        echo "Database is already up to date. No pending migrations.\n";
    } else {
        echo "\nSuccessfully applied $ran migration(s).\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, "Migration stopped: " . $e->getMessage() . "\\n");
    fwrite(STDERR, "DDL may be partially applied. Inspect schema before retrying.\\n");
    exit(1);
}
