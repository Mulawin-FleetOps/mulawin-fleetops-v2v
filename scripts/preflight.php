<?php
/*
 * scripts/preflight.php — checks that the server is ready.
 *   C:\xampp\php\php.exe scripts\preflight.php
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/backend/bootstrap.php';
$ready = true;
$checks = [
    'PHP 8.2 or higher' => PHP_VERSION_ID >= 80200,
    'PDO MySQL extension' => extension_loaded('pdo_mysql'),
    'fileinfo extension (uploads)' => extension_loaded('fileinfo'),
    'mbstring extension' => extension_loaded('mbstring'),
    '.env file exists' => is_file(dirname(__DIR__) . '/.env'),
    'storage/private is writable' => is_writable(dirname(__DIR__) . '/storage/private'),
    'storage/backups is writable' => is_writable(dirname(__DIR__) . '/storage/backups'),
    'config/formulas.php loads' => is_array(@include dirname(__DIR__) . '/config/formulas.php'),
];
foreach ($checks as $k => $v) { echo ($v ? 'PASS' : 'FAIL') . ": $k\n"; if (!$v) $ready = false; }
// Every module file must load on its own (module isolation check).
require_once dirname(__DIR__) . '/backend/Actions.php';
foreach (array_keys(Actions::MODULES) as $m) {
    try { Actions::load($m); echo "PASS: module $m\n"; } catch (Throwable $e) { echo "FAIL: module $m (" . $e->getMessage() . ")\n"; $ready = false; }
}
if (extension_loaded('pdo_mysql')) {
    try {
        $p = db();
        foreach (['users', 'clients', 'client_rates', 'vehicles', 'personnel', 'trips', 'trip_assignments', 'fund_requests', 'inspections', 'incidents', 'maintenance_jobs', 'part_requests', 'purchase_orders', 'billings', 'collections', 'documents', 'app_settings', 'fund_categories'] as $t) {
            $p->query("SELECT 1 FROM `$t` LIMIT 1"); echo "PASS: table $t\n";
        }
    } catch (Throwable $e) { echo 'FAIL: database or schema: ' . $e->getMessage() . "\n"; $ready = false; }
}
echo $ready ? "\nREADY.\n" : "\nNOT READY. Fix the FAIL lines above.\n";
exit($ready ? 0 : 1);
