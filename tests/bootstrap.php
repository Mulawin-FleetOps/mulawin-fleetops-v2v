<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/vendor/autoload.php';
// Load real application functions from a copy with an explicitly unusable DB configuration.
// The project's .env is never evaluated, even for pure validation tests.
$unitRoot = sys_get_temp_dir() . '/fleetops_unit_' . bin2hex(random_bytes(8));
$copy = static function (string $from, string $to) use (&$copy): void {
    if (is_dir($from)) {
        if (!mkdir($to, 0700, true) && !is_dir($to)) throw new RuntimeException('Cannot create unit sandbox.');
        foreach (scandir($from) ?: [] as $f) if ($f !== '.' && $f !== '..') $copy($from . '/' . $f, $to . '/' . $f);
    } elseif (!copy($from, $to)) throw new RuntimeException('Cannot copy unit dependency.');
};
register_shutdown_function(static function () use ($unitRoot): void {
    $remove = static function (string $path) use (&$remove): void {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $f) if ($f !== '.' && $f !== '..') $remove($path . '/' . $f);
            @rmdir($path);
        } else @unlink($path);
    };
    $remove($unitRoot);
});
$copy(dirname(__DIR__) . '/backend', $unitRoot . '/backend');
$copy(dirname(__DIR__) . '/config', $unitRoot . '/config');
file_put_contents($unitRoot . '/.env', "APP_ENV=test\nAPP_TIMEZONE=Asia/Manila\nDB_HOST=127.0.0.1\nDB_PORT=1\nDB_NAME=unit_no_database\nDB_USER=unit_disabled\nDB_PASS=\nMAIL_HOST=\nORS_API_KEY=\n");
require_once $unitRoot . '/backend/Actions.php';
require_once __DIR__ . '/Support/LegacyRunner.php';
