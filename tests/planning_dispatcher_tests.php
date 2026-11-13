<?php
/** Explicit isolated credentials and the ownership-guarded launcher are mandatory. */
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit('CLI only');}
require_once dirname(__DIR__).'/backend/Actions.php';
require_once __DIR__.'/_launcher.php';
$fresh=envValue('DB_NAME');test_guard([$fresh]);test_recreate($fresh);$p=db();
test_import($p,test_sql('database/schema.sql'));test_import($p,test_sql('database/extension.sql'));
foreach(['Trips','Funds','Documents'] as $module)Actions::load($module);
$passed=0;$failed=0;
function planning_ok(bool $ok,string $label):void {global $passed,$failed;$ok?$passed++:$failed++;echo ($ok?'PASS ':'FAIL ').$label.PHP_EOL;}
function planning_denied(callable $call,int $code,string $label):void {try{$call();planning_ok(false,$label);}catch(BusinessRuleException $e){planning_ok($e->httpStatus===$code,$label);}}
function planning_key():string {$h=bin2hex(random_bytes(16));return substr($h,0,8).'-'.substr($h,8,4).'-4'.substr($h,13,3).'-a'.substr($h,17,3).'-'.substr($h,20,12);}
$makeUser=function(string $role,?string $shift=null)use($p):array{$label=$role.($shift??'');$id=insert($p,'users',['username'=>$label,'email'=>$label.'@example.test','password_hash'=>'fixture','full_name'=>'Fixture '.$label,'role'=>$role,'shift'=>$shift]);return ['id'=>$id,'role'=>$role,'shift'=>$shift,'full_name'=>'Fixture '.$label];};
$ops=$makeUser('operations_head');$cwDay=$makeUser('container_wingvan_dispatcher','Day');$cwNight=$makeUser('container_wingvan_dispatcher','Night');$ccDay=$makeUser('car_carrier_dispatcher','Day');$ccNight=$makeUser('car_carrier_dispatcher','Night');
$clients=[];foreach(['A','B'] as $name)$clients[]=insert($p,'clients',['company_name'=>'ISOLATED PLANNING '.$name,'status'=>'Active','created_by'=>$ops['id']]);
$routes=[];
foreach($clients as $client)foreach(TRUCK_TYPES as $type){
    insert($p,'client_rates',['client_id'=>$client,'truck_type'=>$type,'rate_per_km'=>'50','minimum_charge'=>'0','updated_by'=>$ops['id']]);
    $ref='PLAN-'.$client.'-'.str_replace(' ','',$type);
    $route=insert($p,'client_routes',['route_ref'=>$ref,'client_id'=>$client,'truck_type'=>$type,'origin_label'=>'Fixture origin '.$client,'destination_label'=>'Fixture destination '.$client,'origin_key'=>'origin '.$client,'destination_key'=>'destination '.$client,'distance_km'=>'25','status'=>'Approved','requested_by'=>$ops['id']]);
    insert($p,'client_route_rates',['route_id'=>$route,'version_no'=>1,'rate_type'=>'Flat','rate_amount'=>'1250','status'=>'Approved','entered_by'=>$ops['id'],'effective_from'=>date('Y-m-d H:i:s')]);
    $routes[$client][$type]=$route;
}
$base=function(string $type,string $shift,int $client)use($routes):array{return ['request_key'=>planning_key(),'client_id'=>$client,'truck_type'=>$type,'client_route_id'=>$routes[$client][$type],'dispatcher_assignment'=>dispatcherRoleFor($type).':'.$shift,'scheduled_at'=>date('Y-m-d',strtotime('+1 day')).'T08:00','pickup_point'=>'Fixture origin '.$client,'delivery_point'=>'Fixture destination '.$client,'distance_km'=>'25','delivery_details'=>'Isolated parent instructions'];};
$rows=[];foreach([['Wing Van','Day',3,$clients[0]],['Container','Night',2,$clients[1]],['Car Carrier','Day',4,$clients[0]]] as [$type,$shift,$quantity,$client])for($i=0;$i<$quantity;$i++)$rows[]=$base($type,$shift,$client);
$result=Trips::action($ops,'create_batch',['rows'=>$rows]);
$ids=array_map('intval',array_column($result['results'],'trip_id'));
planning_ok(count($ids)===9&&count(array_unique($ids))===9&&!in_array(0,$ids,true),'3 + 2 + 4 required trucks create nine distinct trip records');
$saved=many($p,'SELECT * FROM trips ORDER BY id');
planning_ok(count(array_unique(array_column($saved,'trip_ref')))===9,'Each generated trip has its own reference');
foreach($saved as $i=>$t){$source=$rows[$i];planning_ok($t['dispatcher_role'].':'.$t['dispatcher_shift']===$source['dispatcher_assignment']&&(int)$t['client_route_id']===$source['client_route_id']&&(int)$t['client_id']===$source['client_id']&&$t['delivery_details']===$source['delivery_details'],'Generated row '.($i+1).' inherits its exact parent values');}
planning_ok(count(array_filter($saved,fn($t)=>$t['status']==='Awaiting Resources'&&!$t['vehicle_id']&&!$t['driver_id']&&!$t['driver2_id']&&!$t['helper_id']))===9,'Dispatcher selection never invents resource assignments when resources are absent');
$active=fn(array $u)=>array_map('intval',array_column(Trips::read($u,'trips',[])['active'],'id'));
planning_ok($active($cwDay)===array_slice($ids,0,3),'Day Container/Wing Van retrieves exactly its planned trips');
planning_ok($active($cwNight)===array_slice($ids,3,2),'Night Container/Wing Van retrieves its 8 AM plans without schedule inference');
planning_ok($active($ccDay)===array_slice($ids,5,4)&&$active($ccNight)===[],'Car Carrier role and shift both restrict retrieval');
planning_denied(fn()=>Trips::action($cwDay,'details',['trip_id'=>$ids[3]]),404,'Same group opposite shift direct details rejected');
planning_denied(fn()=>Trips::action($ccDay,'details',['trip_id'=>$ids[0]]),404,'Foreign operational group direct details rejected');
planning_denied(fn()=>Trips::action($cwDay,'dispatcher_resources',['trip_id'=>$ids[3]]),403,'Opposite shift cannot retrieve resource candidates');
planning_denied(fn()=>Trips::action($cwDay,'assign_resources',['trip_id'=>$ids[3],'vehicle_id'=>1,'driver_id'=>1,'helper_id'=>2]),403,'Opposite shift cannot mutate resource assignment');
$options=Trips::action($cwNight,'dispatcher_resources',['trip_id'=>$ids[3]]);planning_ok($options['drivers']===[],'Authorized shift reaches existing resource eligibility workflow');
$count=fn()=>(int)one($p,'SELECT COUNT(*) AS n FROM trips')['n'];$before=$count();
$invalid=$base('Container','Day',$clients[0]);$invalid['dispatcher_assignment']='car_carrier_dispatcher:Day';
planning_denied(fn()=>Trips::action($ops,'create_batch',['rows'=>[$base('Wing Van','Night',$clients[0]),$invalid]]),400,'One invalid group blocks the entire batch preflight');
planning_ok($count()===$before,'Invalid batch creates no partial trips');
foreach([null,'','container_wingvan_dispatcher:Evening','car_carrier_dispatcher:Night'] as $selection){$row=$base('Container','Day',$clients[0]);$row['dispatcher_assignment']=$selection;planning_denied(fn()=>Trips::action($ops,'create',$row),400,'Direct creation rejects missing or incompatible manual assignment');}
$wrongRoute=$base('Container','Day',$clients[0]);$wrongRoute['client_route_id']=$routes[$clients[1]]['Container'];planning_denied(fn()=>Trips::action($ops,'create_batch',['rows'=>[$wrongRoute]]),400,'Route of another client cannot bypass approval relationship');
$noRoute=$base('Wing Van','Day',$clients[0]);unset($noRoute['client_route_id']);planning_denied(fn()=>Trips::action($ops,'create',$noRoute),400,'Direct Operations Head planning requires an approved route');
$badTypeRoute=$base('Container','Day',$clients[0]);$badTypeRoute['client_route_id']=$routes[$clients[0]]['Car Carrier'];planning_denied(fn()=>Trips::action($ops,'create_batch',['rows'=>[$badTypeRoute]]),400,'Route of another truck type rejected');
run($p,"UPDATE client_routes SET status='Pending Rate' WHERE id=?",[$routes[$clients[0]]['Container']]);planning_denied(fn()=>Trips::action($ops,'create_batch',['rows'=>[$base('Container','Day',$clients[0])]]),400,'Unapproved route cannot be planned');
$retry=$rows;foreach($retry as &$row){unset($row['dispatcher_assignment']);$row['scheduled_at']='2000-01-01T08:00';}unset($row);
$duplicate=Trips::action($ops,'create_batch',['rows'=>$retry]);planning_ok(count(array_filter($duplicate['results'],fn($r)=>$r['result']==='Already created'))===9&&$count()===$before,'Uncertain pre-update retries recover existing keys without new assignments or records');
planning_ok(array_column(many($p,'SELECT dispatcher_shift FROM trips ORDER BY id'),'dispatcher_shift')===array_column($saved,'dispatcher_shift'),'Retries preserve original selected shift');
// Persisted pre-shift records remain group-wide; Dispatchers cannot create new requests.
$legacy=insert($p,'trips',['trip_ref'=>'LEGACY-PLANNING','client_id'=>$clients[0],'truck_type'=>'Wing Van','dispatcher_role'=>$cwDay['role'],'dispatcher_shift'=>null,'intake_source'=>'Operations Head','status'=>'Awaiting Resources','pickup_point'=>'LEGACY PICKUP','delivery_point'=>'LEGACY DELIVERY','scheduled_at'=>date('Y-m-d H:i:s'),'created_by'=>$ops['id']]);
planning_ok(in_array($legacy,$active($cwDay),true)&&in_array($legacy,$active($cwNight),true),'Existing NULL-shift trips retain group-wide compatibility without inventing a shift');
planning_denied(fn()=>Trips::action($cwDay,'create',$base('Wing Van','Day',$clients[0])),403,'Dispatcher creation remains retired');
// Exercise supporting fund/document/signature authorization without changing finance business rules.
run($p,"UPDATE trips SET status='Pre-Assigned' WHERE id=?",[$ids[0]]);insert($p,'fund_categories',['name'=>'Fixture planning preset','amount'=>'100','active'=>1,'sort_order'=>99]);
planning_denied(fn()=>Funds::action($cwNight,'submit',['trip_id'=>$ids[0],'categories'=>['Fixture planning preset']]),403,'Opposite shift cannot initiate trip funds');
$fund=Funds::action($cwDay,'submit',['trip_id'=>$ids[0],'categories'=>['Fixture planning preset']]);
planning_denied(fn()=>Funds::action($cwNight,'details',['fund_id'=>$fund['fund_id']]),403,'Opposite shift cannot read fund details');
insert($p,'documents',['category'=>'Diesel PO','entity_type'=>'trip','entity_id'=>$ids[0],'original_filename'=>'fixture-only.pdf','storage_name'=>'metadata-only','mime_type'=>'application/pdf','byte_size'=>1,'uploaded_by'=>$cwDay['id']]);
planning_ok(count(Documents::read($cwDay,'documents',[])['documents'])===1&&Documents::read($cwNight,'documents',[])['documents']===[],'Trip document listings respect planning shift');
core('SignatureAccess');planning_ok(!SignatureAccess::canView($cwNight,$cwDay['id'],'fund_request',(int)$fund['fund_id']),'Opposite shift cannot view a trip-linked signature');
$notifications=many($p,'SELECT user_id,message FROM notifications');planning_ok(!array_filter($notifications,fn($n)=>(int)$n['user_id']===$cwNight['id']&&str_contains($n['message'],$saved[0]['trip_ref'])),'Trip notifications do not leak another shift assignment');
// A repeat migration is safe and never assigns historical rows.
$beforeMigration=many($p,'SELECT id,dispatcher_shift,dispatcher_role,dispatcher_id,status FROM trips ORDER BY id');
test_import($p,test_sql('database/migrations/2026-11-10_10_trip_dispatcher_shift.sql'));test_import($p,test_sql('database/migrations/2026-11-10_10_trip_dispatcher_shift.sql'));
planning_ok($beforeMigration===many($p,'SELECT id,dispatcher_shift,dispatcher_role,dispatcher_id,status FROM trips ORDER BY id'),'Reimported migration preserves all trip ownership and lifecycle values');
test_drop($fresh);echo "RESULT: $passed passed, $failed failed\n";exit($failed?1:0);
