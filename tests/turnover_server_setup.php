<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$root=realpath((string)getenv('TURNOVER_TEST_DATADIR'));
if(!$root||!preg_match('/fleetops-turnover-[a-f0-9]{32}$/',$root))exit(2);
$p=null;
for($i=0;$i<100;$i++){try{$p=new PDO('mysql:host=127.0.0.1;port='.getenv('TEST_DB_PORT').';charset=utf8mb4','root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);break;}catch(PDOException $e){usleep(100000);}}
if(!$p)exit(3);
$identity=$p->query('SELECT @@datadir AS dir,@@port AS port,VERSION() AS version')->fetch(PDO::FETCH_ASSOC);
$normalize=fn($s)=>strtolower(rtrim(str_replace('\\','/',$s),'/'));
if($normalize($identity['dir'])!==$normalize($root)||(int)$identity['port']!==(int)getenv('TEST_DB_PORT'))exit(4);
$p->exec("CREATE USER 'fleetops_turnover_test'@'127.0.0.1' IDENTIFIED BY ".$p->quote((string)getenv('TEST_DB_PASS')));
$p->exec("GRANT ALL PRIVILEGES ON *.* TO 'fleetops_turnover_test'@'127.0.0.1'");
echo 'Verified owned disposable MariaDB '.$identity['version'].' on independent port; credentials withheld.'.PHP_EOL;
