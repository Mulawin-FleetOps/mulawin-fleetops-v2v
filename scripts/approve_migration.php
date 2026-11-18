<?php
/**
 * Developer-side opt-in approval: php scripts/approve_migration.php migration_file.sql
 * Commit the resulting database/migrations/approved.json WITH the SQL migration.
 * Does not connect to MySQL and does not execute SQL.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit('CLI only');
if (count($argv) !== 2 || !preg_match('/^[A-Za-z0-9_-]+\.sql$/D', $argv[1])) {
    fwrite(STDERR,"Usage: php scripts/approve_migration.php <migration-basename.sql>\n"); exit(2);
}
$dir=dirname(__DIR__) . '/database/migrations';
$file=$dir . '/' . $argv[1];
if (!is_file($file) || !is_readable($file)) {
    fwrite(STDERR,"Migration file does not exist.\n"); exit(1);
}
require __DIR__ . '/lib/migration_sql.php';
$sql=(string)file_get_contents($file);
if (trim($sql)==='' || migrationSqlStatements($sql)===[]) {
    fwrite(STDERR,"Migration has no supported SQL statements.\n"); exit(1);
}
$manifest=$dir . '/approved.json';
$data=is_file($manifest) ? json_decode((string)file_get_contents($manifest),true) : null;
if (!is_array($data) || !is_array($data['files'] ?? null)) {
    fwrite(STDERR,"Invalid approved.json.\n"); exit(1);
}
$data['files'][$argv[1]]=hash_file('sha256',$file);
ksort($data['files']);
$encoded=json_encode($data,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n";
if (file_put_contents($manifest,$encoded,LOCK_EX)===false) {
    fwrite(STDERR,"Could not update approvals.\n"); exit(1);
}
echo "Approved content hash for ".$argv[1].". Review and commit SQL + approved.json together.\n";
