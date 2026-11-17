<?php
declare(strict_types=1);
/**
 * A quiet-period gate, NOT a Hostinger deployment-completion API.
 * Every pending SQL must be reviewed and hash-pinned in approved.json.
 * State is retained outside the deployed public_html directory.
 */
function migrationAutoPrepare(string $root, array $pending, string $stateDirectory, int $seconds = 300): ?array {
    $rootReal = realpath($root);
    $dir = realpath($stateDirectory);
    if (!$rootReal || !$dir || !is_dir($dir) || !is_writable($dir) ||
        strncmp($dir . '/', $rootReal . '/', strlen($rootReal) + 1) === 0) {
        throw new RuntimeException('Auto migration state directory must exist, be writable, and remain outside the web root.');
    }
    $manifestPath = $rootReal . '/database/migrations/approved.json';
    if (!is_file($manifestPath)) throw new RuntimeException('Missing approved migration manifest.');
    $approved = json_decode((string)file_get_contents($manifestPath),true);
    if (!is_array($approved) || !is_array($approved['files'] ?? null)) {
        throw new RuntimeException('Invalid approved migration manifest.');
    }
    $hashes = [];
    foreach ($pending as $file) {
        $name = basename($file);
        $hash = hash_file('sha256',$file);
        if ($hash === false || !isset($approved['files'][$name]) ||
            !is_string($approved['files'][$name]) ||
            !preg_match('/^[0-9a-f]{64}$/',$approved['files'][$name]) ||
            !hash_equals($approved['files'][$name],$hash)) {
            throw new RuntimeException('Pending SQL is not hash-approved: ' . $name);
        }
        $hashes[$name]=$hash;
    }
    ksort($hashes);
    // Includes the executor code to detect an update mid-deployment.
    $snapshot = ['files'=>$hashes];
    foreach ([
        'scripts/migrate.php',
        'scripts/lib/migration_sql.php',
        'scripts/lib/migration_release.php',
        'scripts/lib/migration_auto.php',
        'scripts/lib/migration_backup.php',
        'database/migrations/approved.json'
    ] as $relative) {
        $file=$rootReal . '/' . $relative;
        if (!is_file($file)) throw new RuntimeException('Deployment file missing: ' . $relative);
        $snapshot[$relative]=hash_file('sha256',$file);
    }
    $digest=hash('sha256',json_encode($snapshot,JSON_THROW_ON_ERROR));
    $stateFile=$dir . '/deployment-stability.json';
    $now=time();
    $old = is_file($stateFile) ? json_decode((string)file_get_contents($stateFile),true) : null;
    if (!is_array($old) || ($old['digest'] ?? '')!==$digest ||
        !isset($old['first_seen']) || !is_int($old['first_seen']) ||
        $old['first_seen']>$now || $now-$old['first_seen']>86400) {
        $temp = $stateFile . '.tmp';
        file_put_contents($temp,json_encode(['digest'=>$digest,'first_seen'=>$now],JSON_THROW_ON_ERROR),LOCK_EX);
        chmod($temp,0600);
        if (!rename($temp,$stateFile)) throw new RuntimeException('Cannot persist deployment stability marker.');
        return null;
    }
    if ($now-$old['first_seen']<$seconds) return null;
    return ['files'=>$hashes,'digest'=>$digest,'stable_since'=>$old['first_seen']];
}
