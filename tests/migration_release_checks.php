<?php
declare(strict_types=1);
require dirname(__DIR__) . '/scripts/lib/migration_release.php';

function assertRelease(bool $ok, string $label): void {
    if (!$ok) { fwrite(STDERR, "FAIL: $label\n"); exit(1); }
    echo "PASS: $label\n";
}
$base = sys_get_temp_dir() . '/fleetops_release_test_' . bin2hex(random_bytes(8));
$project = $base . '/application';
mkdir($project, 0700, true);
$source = $project . '/migration.sql';
$backup = $base . '/verified-backup.sql';
$receipt = $base . '/deployment-receipt.json';
file_put_contents($source, "SELECT 1;\n");
file_put_contents($backup, str_repeat("-- verified archive fixture\n", 12));
$make = static function (array $changes = []) use ($source, $backup): array {
    return array_replace([
        'ready_at' => time(),
        'files' => ['migration.sql' => hash_file('sha256', $source)],
        'backup_path' => $backup,
        'backup_sha256' => hash_file('sha256', $backup)
    ], $changes);
};
try {
    file_put_contents($receipt, json_encode($make(), JSON_THROW_ON_ERROR));
    assertRelease(is_array(migrationReleaseCheck($project, $receipt, [$source])), 'Valid trusted release receipt');
    $badCases = [
        'Missing receipt' => null,
        'Stale receipt' => $make(['ready_at' => time() - 7200]),
        'Different deployment hash' => $make(['files' => ['migration.sql' => str_repeat('0', 64)]]),
        'Different backup hash' => $make(['backup_sha256' => str_repeat('0', 64)]),
        'Backup inside deploy folder' => $make(['backup_path' => $source, 'backup_sha256' => hash_file('sha256', $source)])
    ];
    foreach ($badCases as $label => $data) {
        if ($data === null) unlink($receipt);
        else file_put_contents($receipt, json_encode($data, JSON_THROW_ON_ERROR));
        $blocked = false;
        try { migrationReleaseCheck($project, $receipt, [$source]); }
        catch (RuntimeException $exception) { $blocked = true; }
        assertRelease($blocked, $label . ' rejected');
    }
} finally {
    foreach ([$source, $backup, $receipt] as $path) if (file_exists($path)) unlink($path);
    rmdir($project);
    rmdir($base);
}
echo "All release gating checks passed, no database accessed.\n";
