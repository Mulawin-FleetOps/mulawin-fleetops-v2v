<?php
declare(strict_types=1);
/* Consistent SQL snapshot for supported InnoDB-only databases. */
function migrationQuoteIdentifier(string $value): string {
    return chr(96) . str_replace(chr(96), chr(96).chr(96), $value) . chr(96);
}
function migrationMakeBackup(PDO $db, string $directory, string $database): array {
    if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI only.');
    $root = realpath(dirname(__DIR__, 2));
    $dir = realpath($directory);
    if (!$root || !$dir || !is_dir($dir) || !is_writable($dir) ||
        strncmp($dir . '/', $root . '/', strlen($root) + 1) === 0) {
        throw new RuntimeException('Backup directory must be writable and outside deployed website.');
    }
    if ($database !== (string)$db->query('SELECT DATABASE()')->fetchColumn()) {
        throw new RuntimeException('Backup database mismatch.');
    }
    foreach (['TRIGGERS'=>'TRIGGER_SCHEMA', 'ROUTINES'=>'ROUTINE_SCHEMA', 'EVENTS'=>'EVENT_SCHEMA'] as $kind=>$schema) {
        $count = (int)$db->query("SELECT COUNT(*) FROM information_schema.$kind WHERE $schema=DATABASE()")->fetchColumn();
        if ($count) throw new RuntimeException("Unsupported $kind: use a native full backup.");
    }
    $objects = $db->query('SHOW FULL TABLES')->fetchAll(PDO::FETCH_NUM);
    if (!$objects) throw new RuntimeException('No database tables found.');
    foreach ($objects as $item) {
        if ($item[1] !== 'BASE TABLE') throw new RuntimeException('Views/unsupported database objects require a native backup.');
        $status = $db->query('SHOW TABLE STATUS LIKE ' . $db->quote($item[0]))->fetch(PDO::FETCH_ASSOC);
        if (strcasecmp((string)($status['Engine'] ?? ''), 'InnoDB') !== 0)
            throw new RuntimeException('Non-InnoDB tables cannot be safely snapshotted.');
    }
    $filename = 'fleetops-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(8)) . '.sql';
    $temp = $dir . '/.' . $filename . '.part';
    $final = $dir . '/' . $filename;
    $out = fopen($temp, 'xb');
    if ($out === false) throw new RuntimeException('Cannot open backup.');
    chmod($temp, 0600);
    $write = static function($h, string $data): void {
        if (fwrite($h, $data) !== strlen($data)) throw new RuntimeException('Incomplete backup write.');
    };
    try {
        $db->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
        $write($out, "-- FleetOps SQL snapshot\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n");
        foreach ($objects as $item) {
            $quoted = migrationQuoteIdentifier($item[0]);
            $ddl = $db->query('SHOW CREATE TABLE ' . $quoted)->fetch(PDO::FETCH_ASSOC);
            $create = (string)($ddl['Create Table'] ?? '');
            if ($create === '') throw new RuntimeException('Cannot retrieve table schema.');
            $write($out, "DROP TABLE IF EXISTS $quoted;\n$create;\n");
            $cols = $db->query('SHOW COLUMNS FROM ' . $quoted)->fetchAll(PDO::FETCH_ASSOC);
            $names = implode(',', array_map(static fn($c)=>migrationQuoteIdentifier($c['Field']), $cols));
            $rows = $db->query('SELECT * FROM ' . $quoted);
            while (($row=$rows->fetch(PDO::FETCH_ASSOC)) !== false) {
                $values = [];
                foreach ($cols as $column) {
                    $v=$row[$column['Field']];
                    if ($v === null) $values[]='NULL';
                    elseif (preg_match('/(?:blob|binary|bit)/i', $column['Type'])) $values[]='0x'.bin2hex((string)$v);
                    else $values[]=$db->quote((string)$v);
                }
                $write($out, "INSERT INTO $quoted ($names) VALUES (" . implode(',', $values) . ");\n");
            }
            $rows->closeCursor();
        }
        $write($out, "SET FOREIGN_KEY_CHECKS=1;\n-- END FLEETOPS BACKUP\n");
        $db->exec('COMMIT');
        if (!fflush($out)) throw new RuntimeException('Backup flush failed.');
        if (function_exists('fsync') && !fsync($out)) throw new RuntimeException('Backup fsync failed.');
        fclose($out);
        $out=null;
        if (!rename($temp,$final)) throw new RuntimeException('Backup finalization failed.');
        $size=filesize($final);
        $hash=hash_file('sha256',$final);
        if ($size===false || $size<128 || $hash===false ||
            !str_contains((string)file_get_contents($final,false,null,max(0,$size-64)), '-- END FLEETOPS BACKUP')) {
            throw new RuntimeException('Backup integrity check failed.');
        }
        return ['backup_path'=>$final, 'backup_sha256'=>$hash, 'bytes'=>$size];
    } catch (Throwable $e) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {}
        if (is_resource($out)) fclose($out);
        if (is_file($temp)) unlink($temp);
        if (is_file($final)) unlink($final);
        throw $e;
    }
}
