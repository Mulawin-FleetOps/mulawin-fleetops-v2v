<?php
declare(strict_types=1);
require dirname(__DIR__) . '/scripts/lib/migration_auto.php';
function mustAuto(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException("FAILED $label");
    echo "PASS $label\n";
}
$base = sys_get_temp_dir() . '/fleetops_auto_ci_' . bin2hex(random_bytes(8));
$root=$base.'/site';
$private=$base.'/private';
foreach (['scripts/lib','database/migrations'] as $relative) mkdir($root.'/'.$relative,0700,true);
mkdir($private,0700);
$required=[
'scripts/migrate.php',
'scripts/lib/migration_sql.php',
'scripts/lib/migration_release.php',
'scripts/lib/migration_auto.php',
'scripts/lib/migration_backup.php',
];
foreach ($required as $relative) file_put_contents($root.'/'.$relative,"fixture: ".$relative);
$sql=$root.'/database/migrations/fixture.sql';
file_put_contents($sql,"SELECT 1;\n");
$manifest=$root.'/database/migrations/approved.json';
file_put_contents($manifest,json_encode(['files'=>['fixture.sql'=>hash_file('sha256',$sql)]]));
try {
    mustAuto(migrationAutoPrepare($root,[$sql],$private,0)===null,'first auto check observes deployment');
    mustAuto(is_array(migrationAutoPrepare($root,[$sql],$private,0)),'second auto check accepts stable approved files');
    file_put_contents($sql,"SELECT 2;\n");
    $blocked=false;
    try {migrationAutoPrepare($root,[$sql],$private,0);}catch(RuntimeException $e){$blocked=true;}
    mustAuto($blocked,'unapproved SQL change blocked');
    file_put_contents($manifest,json_encode(['files'=>['fixture.sql'=>hash_file('sha256',$sql)]]));
    mustAuto(migrationAutoPrepare($root,[$sql],$private,0)===null,'new approval requires fresh settling window');
    mustAuto(is_array(migrationAutoPrepare($root,[$sql],$private,0)),'new approved snapshot can settle');
    echo "All offline automatic migration gate tests passed.\n";
} finally {
    foreach (array_merge($required,['database/migrations/fixture.sql','database/migrations/approved.json']) as $relative) unlink($root.'/'.$relative);
    foreach (glob($private.'/*') ?: [] as $file) unlink($file);
    rmdir($private);rmdir($root.'/database/migrations');rmdir($root.'/database');
    rmdir($root.'/scripts/lib');rmdir($root.'/scripts');rmdir($root);rmdir($base);
}
