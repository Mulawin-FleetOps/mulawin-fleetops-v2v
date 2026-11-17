<?php
/*
 * scripts/migrate.php — automatically runs pending migrations after git pull.
 * Usage (CLI only): php scripts/migrate.php --status [default]
 *                   php scripts/migrate.php --apply
 *                   php scripts/migrate.php --auto (requires trusted release receipt)
 * Manual apply requires MIGRATIONS_ENABLED=1, MIGRATIONS_EXPECTED_DB,
 * MIGRATIONS_APPROVED_IDS and MIGRATIONS_BACKUP_VERIFIED=1.
 * Auto apply requires MIGRATIONS_ENABLED=1, MIGRATIONS_EXPECTED_DB,
 * MIGRATIONS_AUTO_PRIVATE_DIR outside public_html, stable code/files,
 * hash-pinned SQL approvals, and a fresh private backup.
 *
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/backend/bootstrap.php';

$args = array_slice($argv, 1);
if (count($args) > 1 || !in_array($args[0] ?? '--status', ['--status', '--apply', '--auto'], true)) {
    fwrite(STDERR, "Usage: php scripts/migrate.php [--status|--apply|--auto]\n");
    exit(2);
}
$mode = $args[0] ?? '--status';
$apply = $mode === '--apply' || $mode === '--auto';

// Keep parser unit-testable without loading application/database settings.
require __DIR__ . '/lib/migration_sql.php';
require __DIR__ . '/lib/migration_release.php';
require __DIR__ . '/lib/migration_backup.php';
require __DIR__ . '/lib/migration_auto.php';

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
    echo 'Database: ' . $database . "\n";
    foreach ($pending as $file) echo 'Pending: ' . basename($file) . "\n";
    if (!$apply) {
        echo "Read-only status; no SQL executed.\n";
        exit(0);
    }
    if ($mode === '--auto' && $pending === []) {
        echo "No pending migrations; nothing to apply.\n";
        exit(0);
    }
    if ($mode !== '--auto') {
        if (envValue('MIGRATIONS_BACKUP_VERIFIED') !== '1') {
            throw new RuntimeException('Explicit backup verification required for manual apply.');
        }
        $approved = array_filter(array_map('trim', explode(',', envValue('MIGRATIONS_APPROVED_IDS'))));
        foreach ($pending as $file) {
            $id = basename($file, '.sql');
            if (!in_array($id, $approved, true)) throw new RuntimeException("Unapproved migration: $id");
        }
    }
    // Pre-parse *all* pending files before starting any DDL. This prevents
    // later unsupported SQL from being discovered after earlier DDL commits.
    foreach ($pending as $file) {
        $raw = file_get_contents($file);
        if ($raw === false || trim($raw) === '') {
            throw new RuntimeException('Empty or unreadable migration: ' . basename($file));
        }
        if (migrationSqlStatements($raw) === []) {
            throw new RuntimeException('No SQL statements in: ' . basename($file));
        }
    }
    if ($mode === '--auto') {
        $private = envValue('MIGRATIONS_AUTO_PRIVATE_DIR');
        if ($private === '') throw new RuntimeException('MIGRATIONS_AUTO_PRIVATE_DIR not configured.');
        $private = realpath($private);
        if (!$private || !is_dir($private)) throw new RuntimeException('Private backup directory missing.');
        if (is_file($private . '/migration-failed.lock')) {
            throw new RuntimeException('Previous migration failed; manual schema reconciliation required.');
        }
        $ready = migrationAutoPrepare(dirname(__DIR__), $pending, $private, 300);
        if ($ready === null) {
            echo "Deployed files are settling; no SQL applied.\n";
            exit(0);
        }
        $backup = migrationMakeBackup($p, $private, $database);
        $receipt = $private . '/deployment-receipt.json';
        $payload = [
            'ready_at' => time(),
            'files' => $ready['files'],
            'backup_path' => $backup['backup_path'],
            'backup_sha256' => $backup['backup_sha256'],
        ];
        $receiptTemp = $receipt . '.tmp';
        if (file_put_contents($receiptTemp, json_encode($payload, JSON_THROW_ON_ERROR), LOCK_EX) === false) {
            throw new RuntimeException('Cannot write backup receipt.');
        }
        chmod($receiptTemp, 0600);
        if (!rename($receiptTemp, $receipt)) throw new RuntimeException('Cannot finalize receipt.');
        migrationReleaseCheck(dirname(__DIR__), $receipt, $pending);
        // Recheck that the deployment did not change during the backup.
        $again = migrationAutoPrepare(dirname(__DIR__), $pending, $private, 300);
        if ($again === null || $again['digest'] !== $ready['digest']) {
            throw new RuntimeException('Deployment changed while backing up; migration blocked.');
        }
        echo "Verified private backup: " . basename($backup['backup_path']) . "\n";
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
            if ($mode === '--auto' && isset($private)) {
                file_put_contents($private . '/migration-failed.lock', date(DATE_ATOM) . ' ' . $name . "\n", LOCK_EX);
            }
            throw $e;
        }
    }

    if ($ran === 0) {
        echo "Database is already up to date. No pending migrations.\n";
    } else {
        echo "\nSuccessfully applied $ran migration(s).\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, "Migration stopped: " . $e->getMessage() . "\n");
    fwrite(STDERR, "DDL may be partially applied. Inspect schema before retrying.\n");
    exit(1);
}
