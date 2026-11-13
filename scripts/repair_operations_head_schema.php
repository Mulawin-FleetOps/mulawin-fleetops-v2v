<?php
declare(strict_types=1);
/**
 * Guarded, additive Operations Head turnover schema installer.
 * Verify: php scripts/repair_operations_head_schema.php
 * Apply:  php scripts/repair_operations_head_schema.php --apply --database=mulawin_v2
 *
 * Reads only the project's checked-in 2026-11-12 turnover migration.
 * Does not drop tables, truncate data, recreate accounts or infer ownership.
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require dirname(__DIR__) . '/backend/bootstrap.php';

$apply = in_array('--apply', $argv, true);
$expected = null;
foreach (array_slice($argv, 1) as $argument) {
    if (str_starts_with($argument, '--database=')) $expected = substr($argument, 11);
    elseif ($argument !== '--apply') { fwrite(STDERR, "Unsupported argument.\n"); exit(2); }
}
try {
    $p = db();
    $database = (string)$p->query('SELECT DATABASE()')->fetchColumn();
    echo 'Database: ' . $database . PHP_EOL;
    if ($database === '' || $database !== envValue('DB_NAME', 'mulawin_v2')) {
        throw new RuntimeException('Connected database does not match the configured DB_NAME.');
    }
    if ($apply && ($expected === null || $expected !== $database)) {
        throw new RuntimeException('To apply, supply --database=' . $database . ' to confirm the exact database.');
    }
    $column = $p->prepare("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='dispatcher_shift'");
    $column->execute();
    if (!$column->fetchColumn()) {
        echo "BLOCKED: trips.dispatcher_shift is missing. Apply 2026-11-10_10_trip_dispatcher_shift.sql first.\n";
        exit(1);
    }
    $tables = ['trip_responsibilities','dispatcher_turnovers','dispatcher_turnover_trips'];
    $present = [];
    $query = $p->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
    foreach ($tables as $table) {
        $query->execute([$table]);
        $present[$table] = (bool)$query->fetchColumn();
        echo ($present[$table] ? 'PASS' : 'MISSING') . ': ' . $table . PHP_EOL;
    }
    $marker = $p->prepare('SELECT 1 FROM schema_migrations WHERE id=? LIMIT 1');
    $marker->execute(['2026-11-12_12_dispatcher_turnover']);
    $recorded = (bool)$marker->fetchColumn();
    echo ($recorded ? 'PASS' : 'MISSING') . ': turnover migration marker' . PHP_EOL;
    if (!in_array(false, $present, true) && $recorded) {
        echo "READY: Turnover schema already installed. No changes made.\n";
        exit(0);
    }
    if (!$apply) {
        echo "READ-ONLY: To install the additive migration, rerun with --apply --database=" . $database . PHP_EOL;
        exit(1);
    }
    $file = dirname(__DIR__) . '/database/migrations/2026-11-12_12_dispatcher_turnover.sql';
    $sql = file_get_contents($file);
    if ($sql === false) throw new RuntimeException('Migration file is missing.');
    // This specific migration has statement terminators but no semicolons in SQL string literals.
    $sql = preg_replace('/^\\s*--[^\\r\\n]*(?:\\r?\\n|$)/m', '', $sql);
    $statements = array_values(array_filter(array_map('trim', explode(';', $sql)), fn($part) => $part !== ''));
    if (count($statements) !== 4) throw new RuntimeException('Migration SQL format changed. Aborting without executing.');
    foreach ($statements as $index => $statement) {
        if ($index < 3 && !preg_match('/^CREATE TABLE IF NOT EXISTS (trip_responsibilities|dispatcher_turnovers|dispatcher_turnover_trips)\\s*\\(/i', $statement)) {
            throw new RuntimeException('Unexpected migration statement. Aborting.');
        }
        if ($index === 3 && !str_starts_with($statement, "INSERT IGNORE INTO schema_migrations(id) VALUES ('2026-11-12_12_dispatcher_turnover')")) {
            throw new RuntimeException('Unexpected migration marker statement. Aborting.');
        }
    }
    echo "Applying the existing additive turnover migration...\n";
    foreach ($statements as $index => $statement) {
        $p->exec($statement);
        echo 'PASS: migration statement ' . ($index + 1) . '/4' . PHP_EOL;
    }
    foreach ($tables as $table) {
        $query->execute([$table]);
        if (!$query->fetchColumn()) throw new RuntimeException('Verification failed: ' . $table);
    }
    $marker->execute(['2026-11-12_12_dispatcher_turnover']);
    if (!$marker->fetchColumn()) throw new RuntimeException('Migration marker verification failed.');
    echo "READY: Turnover tables verified. No existing records or accounts were deleted.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'FAILED: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
