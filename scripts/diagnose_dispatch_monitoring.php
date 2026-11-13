<?php
declare(strict_types=1);
/**
 * Safe read-only diagnostic for Operations Head > Dispatch Monitoring.
 * php scripts/diagnose_dispatch_monitoring.php
 * Does not execute migrations, print credentials or modify data.
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

require dirname(__DIR__) . '/backend/bootstrap.php';
require_once dirname(__DIR__) . '/backend/Actions.php';

$failed = false;
$check = static function (bool $ok, string $label) use (&$failed): void {
    echo ($ok ? 'PASS' : 'FAIL') . ': ' . $label . PHP_EOL;
    if (!$ok) $failed = true;
};

try {
    $p = db();
    $check(true, 'Database connection');

    foreach (['trips', 'clients', 'vehicles', 'schema_migrations'] as $table) {
        try {
            $p->query('SELECT 1 FROM `' . $table . '` LIMIT 1');
            $check(true, 'Table ' . $table);
        } catch (Throwable $e) {
            $check(false, 'Table ' . $table . ' (' . $e->getMessage() . ')');
        }
    }

    $columns = ['dispatcher_role', 'dispatcher_shift', 'trip_ref', 'client_id',
        'vehicle_id', 'pickup_point', 'delivery_point', 'truck_type',
        'scheduled_at', 'status', 'completed_at'];
    foreach ($columns as $column) {
        $stmt = $p->prepare(
            'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
             LIMIT 1'
        );
        $stmt->execute(['trips', $column]);
        $check((bool) $stmt->fetch(), 'trips.' . $column);
    }

    $migration = '2026-11-10_10_trip_dispatcher_shift';
    try {
        $stmt = $p->prepare('SELECT 1 FROM schema_migrations WHERE id=? LIMIT 1');
        $stmt->execute([$migration]);
        $check((bool) $stmt->fetchColumn(), 'Migration recorded: ' . $migration);
    } catch (Throwable $e) {
        $check(false, 'Migration record check (' . $e->getMessage() . ')');
    }

    // Trip creation and Dispatcher account responsibility also require turnover tables.
    foreach (['trip_responsibilities','dispatcher_turnovers','dispatcher_turnover_trips'] as $table) {
        $stmt = $p->prepare('SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
        $stmt->execute([$table]);
        $check((bool)$stmt->fetchColumn(), 'Turnover table ' . $table);
    }
    $stmt = $p->prepare('SELECT 1 FROM schema_migrations WHERE id=? LIMIT 1');
    $stmt->execute(['2026-11-12_12_dispatcher_turnover']);
    $check((bool)$stmt->fetchColumn(), 'Migration recorded: 2026-11-12_12_dispatcher_turnover');

    Actions::load('Trips');
    core('DispatcherMonitoring');
    $method = new ReflectionMethod(DispatcherMonitoring::class, 'projection');
    foreach (['active', 'history'] as $tab) {
        try {
            $data = $method->invoke(null, $p, ['tab' => $tab]);
            $check(is_array($data) && isset($data['rows'], $data['summary']),
                'Dispatch Monitoring ' . $tab . ' query');
            if (is_array($data)) {
                echo 'INFO: ' . $tab . ' total=' . (int) ($data['total'] ?? 0)
                    . '; groups=' . count($data['groups'] ?? []) . PHP_EOL;
            }
        } catch (Throwable $e) {
            $check(false, 'Dispatch Monitoring ' . $tab . ' query');
            echo 'DETAIL: ' . get_class($e) . ': ' . $e->getMessage() . PHP_EOL;
        }
    }
} catch (Throwable $e) {
    $check(false, 'Diagnostic setup');
    echo 'DETAIL: ' . get_class($e) . ': ' . $e->getMessage() . PHP_EOL;
}
echo PHP_EOL . ($failed ? 'DIAGNOSIS: At least one check failed. No database changes were made.'
    : 'DIAGNOSIS: Required monitoring and turnover schema checks passed.')
    . PHP_EOL;
exit($failed ? 1 : 0);
