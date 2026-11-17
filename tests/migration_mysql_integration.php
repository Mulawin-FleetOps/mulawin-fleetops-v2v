<?php
declare(strict_types=1);
// CI-only disposable MySQL test. Never point at Hostinger or a user database.
if (getenv('CI') !== 'true' || getenv('MYSQL_TEST_ALLOW_CREATE') !== '1') {
    fwrite(STDERR, "CI only\n"); exit(2);
}
$host = getenv('MYSQL_TEST_HOST');
if ($host !== '127.0.0.1') { fwrite(STDERR, "Localhost only\n"); exit(2); }
$user = getenv('MYSQL_TEST_USER') ?: 'root';
$pass = getenv('MYSQL_TEST_PASS') ?: '';
$admin = new PDO("mysql:host=127.0.0.1;port=3306;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$name = 'fleetops_ci_' . bin2hex(random_bytes(8));
$admin->exec("CREATE DATABASE " . $name . " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
try {
    $db = new PDO("mysql:host=127.0.0.1;port=3306;dbname=$name;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach ([
        "CREATE TABLE users (id INT PRIMARY KEY, dispatcher_truck_type VARCHAR(25)) ENGINE=InnoDB",
        "CREATE TABLE personnel (id INT PRIMARY KEY, person_type VARCHAR(30) NOT NULL) ENGINE=InnoDB",
        "CREATE TABLE vehicles (id INT PRIMARY KEY, assigned_driver_id INT) ENGINE=InnoDB",
        "CREATE TABLE trips (id INT PRIMARY KEY, status VARCHAR(50) NOT NULL, CONSTRAINT chk_trip_status CHECK (status IN ('Pending Review','Awaiting Resources','Completed'))) ENGINE=InnoDB",
        "CREATE TABLE schema_migrations (id VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
        "INSERT INTO users(id) VALUES(1)",
        "INSERT INTO personnel(id,person_type) VALUES(1,'Driver')",
        "INSERT INTO vehicles(id,assigned_driver_id) VALUES(1,1)",
        "INSERT INTO trips(id,status) VALUES(1,'Completed')"
    ] as $sql) $db->exec($sql);
    // Independently verify the PHP backup can restore data/schema on disposable MySQL.
    require_once dirname(__DIR__) . '/scripts/lib/migration_backup.php';
    require_once dirname(__DIR__) . '/scripts/lib/migration_sql.php';
    $backupDir = sys_get_temp_dir() . '/fleetops_backup_ci_' . bin2hex(random_bytes(8));
    mkdir($backupDir, 0700);
    $restoreName = 'fleetops_ci_' . bin2hex(random_bytes(8));
    try {
        $dump = migrationMakeBackup($db, $backupDir, $name);
        if (!is_file($dump['backup_path']) || !hash_equals($dump['backup_sha256'], hash_file('sha256',$dump['backup_path']))) {
            throw new RuntimeException('Backup integrity check failed');
        }
        $admin->exec('CREATE DATABASE ' . $restoreName . ' CHARACTER SET utf8mb4');
        $restore = new PDO("mysql:host=127.0.0.1;port=3306;dbname=$restoreName;charset=utf8mb4", $user, $pass,
            [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
        foreach (migrationSqlStatements((string)file_get_contents($dump['backup_path'])) as $statement) {
            $restore->exec($statement);
        }
        $restored = (int)$restore->query('SELECT COUNT(*) FROM personnel WHERE id=1')->fetchColumn();
        $tripsRestored = (int)$restore->query("SELECT COUNT(*) FROM trips WHERE id=1 AND status='Completed'")->fetchColumn();
        $historyExists = (int)$restore->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'")->fetchColumn();
        if ($restored!==1 || $tripsRestored!==1 || $historyExists!==1) {
            throw new RuntimeException('SQL backup restore contents mismatch');
        }
        echo "PASS: private SQL backup, SHA-256 and disposable database restore\n";
    } finally {
        if (isset($restore)) { $restore=null; }
        if (preg_match('/^fleetops_ci_[a-f0-9]{16}$/',$restoreName)) {
            $admin->exec('DROP DATABASE IF EXISTS ' . $restoreName);
        }
        foreach (glob($backupDir . '/*') ?: [] as $file) unlink($file);
        rmdir($backupDir);
    }
    $targets = ['2026-11-15_17_dispatcher_multi_types', '2026-11-15_18_driver_truck_authorizations', '2026-11-15_19_missed_trips'];
    foreach (glob(dirname(__DIR__) . '/database/migrations/*.sql') as $file) {
        $id = basename($file, '.sql');
        if (!in_array($id, $targets, true)) {
            $statement = $db->prepare("INSERT INTO schema_migrations(id) VALUES(?)");
            $statement->execute([$id]);
        }
    }
    // CI verifies the same approved-hash process used on the live branch,
    // but only against an isolated database and an ephemeral checkout.
    $approvalPath=dirname(__DIR__) . '/database/migrations/approved.json';
    $approvalOriginal=file_get_contents($approvalPath);
    $approvedHashes=[];
    foreach ($targets as $id) {
        $file=dirname(__DIR__) . '/database/migrations/' . $id . '.sql';
        $approvedHashes[basename($file)]=hash_file('sha256',$file);
    }
    file_put_contents($approvalPath,json_encode(['files'=>$approvedHashes],JSON_PRETTY_PRINT));
    $autoDir=sys_get_temp_dir() . '/fleetops_auto_mysql_ci_' . bin2hex(random_bytes(8));
    mkdir($autoDir,0700);
    $env = array_merge($_ENV, [
        'DB_HOST'=>'127.0.0.1', 'DB_PORT'=>'3306', 'DB_NAME'=>$name,
        'DB_USER'=>$user, 'DB_PASS'=>$pass,
        'MIGRATIONS_ENABLED'=>'1', 'MIGRATIONS_EXPECTED_DB'=>$name,
        'MIGRATIONS_BACKUP_VERIFIED'=>'1', // disposable fixture, not production
        'MIGRATIONS_APPROVED_IDS'=>implode(',', $targets),
        'MIGRATIONS_AUTO_PRIVATE_DIR'=>$autoDir,
        'MIGRATIONS_CI_FAST_STABILITY'=>'1',
        'MYSQL_TEST_ALLOW_CREATE'=>'1',
        'CI'=>'true'
    ]);
    $run = static function(string $mode) use ($env): array {
        $p = proc_open([PHP_BINARY, dirname(__DIR__) . '/scripts/migrate.php', $mode], [1=>['pipe','w'],2=>['pipe','w']], $pipes, dirname(__DIR__), $env);
        if (!is_resource($p)) throw new RuntimeException('Cannot launch runner');
        $out = stream_get_contents($pipes[1]); fclose($pipes[1]);
        $err = stream_get_contents($pipes[2]); fclose($pipes[2]);
        return [proc_close($p), $out, $err];
    };
    [$code,$out,$err] = $run('--status');
    if ($code !== 0 || substr_count($out, 'Pending:') !== 3) throw new RuntimeException("Status: $out $err");
    [$code,$out,$err] = $run('--auto');
    if ($code !== 0 || !str_contains($out, 'settling')) throw new RuntimeException("First auto gate: $out $err");
    [$code,$out,$err] = $run('--auto');
    if ($code !== 0 || !str_contains($out, 'Verified private backup') ||
        !str_contains($out, 'Successfully applied 3')) throw new RuntimeException("Auto apply: $out $err");
    echo "PASS: content-approved auto migration after settling and private backup\n";
    $applied = (int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE id IN ('" . implode("','", $targets) . "')")->fetchColumn();
    $column = (int)$db->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='dispatcher_truck_types'")->fetchColumn();
    $table = (int)$db->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='driver_truck_authorizations'")->fetchColumn();
    $backfill = (int)$db->query('SELECT COUNT(*) FROM driver_truck_authorizations WHERE driver_id=1 AND vehicle_id=1')->fetchColumn();
    $constraint = $db->query("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_trip_status'")->fetchColumn();
    if ($applied !== 3 || $column !== 1 || $table !== 1 || $backfill !== 1 || !str_contains((string)$constraint,'Missed')) {
        throw new RuntimeException('Schema or backfill verification failed');
    }
    [$code,$out,$err] = $run('--apply');
    if ($code !== 0 || !str_contains($out, 'already up to date')) throw new RuntimeException("Repeat: $out $err");
    echo "PASS: all three migrations, backfill, history and repeat idempotence\n";
} finally {
    if (isset($approvalPath, $approvalOriginal) && is_string($approvalOriginal)) {
        file_put_contents($approvalPath,$approvalOriginal);
    }
    if (isset($autoDir) && is_dir($autoDir)) {
        foreach (glob($autoDir . '/*') ?: [] as $file) if (is_file($file)) unlink($file);
        rmdir($autoDir);
    }
    if (preg_match('/^fleetops_ci_[a-f0-9]{16}$/', $name)) {
        $admin->exec("DROP DATABASE " . $name);
    }
}
