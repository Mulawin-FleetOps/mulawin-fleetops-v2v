<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit('CLI only');
require dirname(__DIR__).'/backend/Actions.php';
require __DIR__.'/_launcher.php';
test_guard([envValue('DB_NAME')]);
Actions::load('Trips');
$input=json_decode((string)fgets(STDIN),true,512,JSON_THROW_ON_ERROR);
$user=one(db(),'SELECT id,role,shift,full_name FROM users WHERE id=?',[$input['user']]);
echo "READY\n";flush();
if(trim((string)fgets(STDIN))!=='GO')exit(2);
try{Trips::action($user,'assign_resources',$input['assignment']);echo json_encode(['ok'=>true]);}
catch(BusinessRuleException $error){echo json_encode(['ok'=>false,'status'=>$error->httpStatus]);}
catch(Throwable $error){echo json_encode(['ok'=>false,'status'=>500]);exit(1);}
