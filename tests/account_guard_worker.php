<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/backend/Actions.php';
require_once __DIR__.'/_launcher.php';
test_guard([envValue('DB_NAME')]);
$arg=json_decode($argv[1],true,512,JSON_THROW_ON_ERROR);
Actions::load('Admin');Actions::load('Trips');
$u=one(db(),'SELECT id,role,shift FROM users WHERE id=? AND active=1',[$arg['actor']]);
try{
 if(isset($arg['hold_account'])){db()->beginTransaction();one(db(),'SELECT id FROM users WHERE id=? FOR UPDATE',[$arg['hold_account']]);echo "READY\n";flush();if(trim((string)fgets(STDIN))!=='go')throw new RuntimeException('Missing test release');}
 else {echo "STARTED\n";flush();}
 $result=match($arg['kind']){
  'accept'=>Trips::action($u,'turnover_accept',['turnover_id'=>$arg['turnover']]),
  'endorse'=>Trips::action($u,'turnover_endorse',$arg['data']),
  default=>Admin::action($u,$arg['kind'],$arg['data']),
 };
 if(db()->inTransaction())db()->commit();
 echo json_encode(['ok'=>true,'duplicate'=>!empty($result['duplicate'])]);
}catch(BusinessRuleException $e){if(db()->inTransaction())db()->rollBack();echo json_encode(['ok'=>false,'status'=>$e->httpStatus]);}
catch(Throwable $e){if(db()->inTransaction())db()->rollBack();fwrite(STDERR,'Guard concurrency worker failed: '.get_class($e));exit(2);}
