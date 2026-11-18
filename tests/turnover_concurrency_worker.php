<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/backend/Actions.php';
require_once __DIR__.'/_launcher.php';
test_guard([envValue('DB_NAME')]);Actions::load('Trips');
$arg=json_decode($argv[1],true,512,JSON_THROW_ON_ERROR);
$u=one(db(),'SELECT id,role,shift FROM users WHERE id=? AND active=1',[$arg['user_id']]);
try { $r=isset($arg['planning'])?Trips::action($u,'create',$arg['planning']):Trips::action($u,'turnover_accept',['turnover_id'=>$arg['turnover_id']]);echo json_encode(['ok'=>true,'duplicate'=>!empty($r['duplicate']),'trip_id'=>$r['trip_id']??null]); }
catch(BusinessRuleException $e){echo json_encode(['ok'=>false,'status'=>$e->httpStatus]);exit(1);}
