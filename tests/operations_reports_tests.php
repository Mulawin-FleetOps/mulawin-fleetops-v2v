<?php
/** Read-report scenarios over fixtures in an ownership-guarded disposable DB only. */
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit('CLI only');}
require_once dirname(__DIR__).'/backend/Actions.php';require_once __DIR__.'/_launcher.php';
$fresh=envValue('DB_NAME');test_guard([$fresh]);test_recreate($fresh);$p=db();
test_import($p,test_sql('database/schema.sql'));test_import($p,test_sql('database/extension.sql'));Actions::load('Analytics');core('OperationsReports');
$passed=0;$failed=0;
function reports_ok(bool $ok,string $label):void{global $passed,$failed;$ok?$passed++:$failed++;echo($ok?'PASS ':'FAIL ').$label.PHP_EOL;}
$uid=insert($p,'users',['username'=>'reports_fixture','email'=>'reports@example.test','password_hash'=>'fixture','full_name'=>'Fixture Operations Head','role'=>'operations_head']);$ops=['id'=>$uid,'role'=>'operations_head'];
$client=insert($p,'clients',['company_name'=>'ISOLATED REPORT CLIENT','status'=>'Active','created_by'=>$uid]);
$driver=insert($p,'personnel',['full_name'=>'ISOLATED REGULAR DRIVER','person_type'=>'Driver']);
$v1=insert($p,'vehicles',['plate_number'=>'REPORT-CW','truck_type'=>'Container','assigned_driver_id'=>$driver,'status'=>'Available']);
$v2=insert($p,'vehicles',['plate_number'=>'REPORT-WV','truck_type'=>'Wing Van','active'=>0,'status'=>'Unavailable']);
insert($p,'vehicles',['plate_number'=>'REPORT-CC','truck_type'=>'Car Carrier','status'=>'Under Maintenance']);
// These are persisted reporting fixtures, not a bypass of the live trip creation/dispatch workflow.
$ids=[];foreach(range(1,37) as $i){$status=['Completed','Dispatched','In Transit','On Hold - Incident Reported'][$i-1]??'Ready for Dispatch';$ids[]=insert($p,'trips',['trip_ref'=>'REPORT-TRIP-'.$i,'intake_source'=>'Operations Head','created_by'=>$uid,'client_id'=>$client,'truck_type'=>'Container','dispatcher_role'=>'container_wingvan_dispatcher','pickup_point'=>'Fixture origin','delivery_point'=>'Fixture destination','scheduled_at'=>'2026-11-02 08:00:00','status'=>$status,'vehicle_id'=>$i<=4?$v1:null,'dispatched_at'=>$i<=4?'2026-11-03 08:00:00':null,'completed_at'=>$i===1?'2026-11-04 08:00:00':null]);}
insert($p,'trips',['trip_ref'=>'REPORT-OUTSIDE-SCHEDULE','intake_source'=>'Operations Head','created_by'=>$uid,'client_id'=>$client,'truck_type'=>'Wing Van','dispatcher_role'=>'container_wingvan_dispatcher','pickup_point'=>'Other origin','delivery_point'=>'Other destination','scheduled_at'=>'2026-10-31 08:00:00','status'=>'Completed','vehicle_id'=>$v2,'dispatched_at'=>'2026-11-05 08:00:00','completed_at'=>'2026-11-06 08:00:00']);
$incidentIds=[];foreach(['Resolved','Under Repair','Reported','Repaired - Cleared to Continue'] as $i=>$status)$incidentIds[]=insert($p,'incidents',['incident_ref'=>'REPORT-INC-'.$i,'trip_id'=>$i<3?$ids[0]:$ids[1],'vehicle_id'=>$v1,'attempt_number'=>1,'incident_type'=>'Breakdown','incident_at'=>'2026-10-15 10:00:00','created_at'=>'2026-11-08 10:00:00','location'=>'Fixture location','problem'=>'Fixture problem','details'=>'Fixture details','status'=>$status,'reported_by'=>$uid]);
insert($p,'incidents',['incident_ref'=>'REPORT-OLD-ENTRY','trip_id'=>$ids[1],'vehicle_id'=>$v1,'attempt_number'=>1,'incident_type'=>'Other','incident_at'=>'2026-11-05 10:00:00','created_at'=>'2026-10-30 10:00:00','location'=>'Fixture location','problem'=>'Fixture problem','details'=>'Fixture details','status'=>'Resolved','reported_by'=>$uid]);
$period=['date_range'=>'custom','from'=>'2026-11-01','to'=>'2026-11-10'];
$read=fn(array $q=[])=>OperationsReports::read($ops,array_replace($period,$q))['operationsReport'];
$before=[(int)one($p,'SELECT COUNT(*) AS n FROM trips')['n'],(int)one($p,'SELECT COUNT(*) AS n FROM incidents')['n']];
$trips=$read();reports_ok($trips['total']===37&&count($trips['rows'])===10&&$trips['pages']===4,'Trip dataset is complete while the displayed page has ten');
reports_ok(array_column($trips['cards'],'value')===[37,1,2,1]&&array_sum($trips['chart']['values'])===37,'Trip metrics and chart share schedule-period records');
$last=$read(['report_page'=>4,'page_size'=>100]);reports_ok(count($last['rows'])===7&&$last['pageSize']===10,'Page-size parameters cannot exceed ten');
$found=$read(['search'=>'REPORT-TRIP-37']);reports_ok($found['total']===1&&$found['cards'][0]['value']===1&&$found['rows'][0]['trip_ref']==='REPORT-TRIP-37','Search reaches records beyond page one and updates metrics');
$trucks=$read(['report'=>'trucks']);reports_ok(array_column($trucks['cards'],'value')===[3,2,5,1],'Truck counts use distinct fleet records and recorded dispatches, including inactive history');
reports_ok((int)$trucks['rows'][0]['trip_count']===4&&$trucks['rows'][0]['driver_name']==='ISOLATED REGULAR DRIVER','Four trips count as one used truck with its authoritative regular driver');
$wv=$read(['report'=>'trucks','truck_type'=>'Wing Van']);reports_ok(array_column($wv['cards'],'value')===[1,1,1,0],'Dispatch-date utilization does not confuse a prior schedule date with the reporting period');
$cc=$read(['report'=>'trucks','truck_type'=>'Car Carrier']);reports_ok(array_column($cc['cards'],'value')===[1,0,0,1],'Operational state does not fabricate usage');
$incidents=$read(['report'=>'incidents']);reports_ok(array_column($incidents['cards'],'value')===[4,1,3,2],'Incident reporting timestamp and distinct affected trips define metrics');
reports_ok($incidents['chart']['values']===[1,3]&&count($incidents['rows'])===4,'Cleared-to-continue remains open and records reconcile with chart');
$details=Analytics::action($ops,'operations_incident',['id'=>$incidentIds[0]]);reports_ok($details['incident']['details']==='Fixture details'&&$details['incident']['trip_ref']==='REPORT-TRIP-1','Authorized incident detail supplies the existing coordination view');
$export=Analytics::action($ops,'operations_export',array_replace($period,['report'=>'trips','report_page'=>4]));reports_ok($export['recordCount']===37&&str_contains($export['csv'],'REPORT-TRIP-1')&&str_contains($export['csv'],'REPORT-TRIP-37')&&!str_contains($export['csv'],'OUTSIDE-SCHEDULE'),'Export includes all and only matching records independently of page');
reports_ok(str_starts_with($export['filename'],'trip-report-2026-11-01')&&str_ends_with($export['filename'],'.csv'),'Export uses a descriptive CSV filename');
$export=Analytics::action($ops,'operations_export',array_replace($period,['report'=>'incidents','search'=>'REPORT-INC-0']));reports_ok($export['recordCount']===1&&str_contains($export['csv'],'REPORT-INC-0')&&!str_contains($export['csv'],'REPORT-INC-1'),'Export and report search share one filter definition');
$empty=$read(['search'=>'No such fixture']);reports_ok($empty['total']===0&&array_column($empty['cards'],'value')===[0,0,0,0],'Empty results contain actual zeros');
foreach(['car_carrier_dispatcher','container_wingvan_dispatcher','finance','motorpool'] as $role){try{Analytics::action(['id'=>$uid,'role'=>$role],'operations_export',$period);reports_ok(false,'Unauthorized export rejected: '.$role);}catch(BusinessRuleException $e){reports_ok($e->httpStatus===403,'Unauthorized export rejected: '.$role);}}
reports_ok($before===[(int)one($p,'SELECT COUNT(*) AS n FROM trips')['n'],(int)one($p,'SELECT COUNT(*) AS n FROM incidents')['n']],'Reporting and export never modify operational records');
test_drop($fresh);echo "RESULT: $passed passed, $failed failed\n";exit($failed?1:0);
