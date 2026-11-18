<?php
/**
 * Release verification. A trusted post-deployment process (not a git commit)
 * must write a release-ready JSON receipt AFTER deployment has completed.
 * No receipt means no unattended migration. Does not connect to database.
 */
declare(strict_types=1);

function migrationReleaseCheck(string $projectRoot, string $receiptPath, array $pendingFiles, int $maxAgeSeconds = 3600): array
{
    $root = realpath($projectRoot);
    $receiptReal = realpath($receiptPath);
    if (!$root || !$receiptReal || !is_file($receiptReal)) {
        throw new RuntimeException('No verified post-deployment receipt; automatic migration blocked.');
    }
    $outside = realpath($root . '/..');
    if (!$outside || strncmp($receiptReal, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) === 0) {
        throw new RuntimeException('Release receipt must be outside the deployed application tree.');
    }
    $raw = file_get_contents($receiptReal);
    $record = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($record) || !isset($record['ready_at'], $record['files']) || !is_int($record['ready_at']) || !is_array($record['files'])) {
        throw new RuntimeException('Invalid release receipt.');
    }
    $age = time() - $record['ready_at'];
    if ($age < 0 || $age > $maxAgeSeconds) {
        throw new RuntimeException('Deployment receipt is stale or dated in the future.');
    }
    $actual = [];
    foreach ($pendingFiles as $file) {
        $name = basename($file);
        $actual[$name] = hash_file('sha256', $file);
    }
    ksort($actual);
    $files = $record['files'];
    ksort($files);
    if ($files !== $actual) {
        throw new RuntimeException('Release receipt file hashes do not match pending migrations.');
    }
    if (!isset($record['backup_path'], $record['backup_sha256']) ||
        !is_string($record['backup_path']) || !is_string($record['backup_sha256'])) {
        throw new RuntimeException('Backup verification is missing from release receipt.');
    }
    $backup = realpath($record['backup_path']);
    if (!$backup || !is_file($backup) || is_link($record['backup_path']) ||
        strncmp($backup, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) === 0) {
        throw new RuntimeException('Backup must be a real file outside the deployed tree.');
    }
    if (filesize($backup) < 128 || filemtime($backup) < $record['ready_at'] - 3600) {
        throw new RuntimeException('Backup missing, unexpectedly small, or too old.');
    }
    if (!preg_match('/^[0-9a-f]{64}$/', $record['backup_sha256']) ||
        !hash_equals($record['backup_sha256'], hash_file('sha256', $backup))) {
        throw new RuntimeException('Verified backup SHA-256 mismatch.');
    }
    return $record;
}
