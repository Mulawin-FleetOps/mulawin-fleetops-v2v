<?php
/* Motorpool Repair Management V2 integration regression.
 * Run only through run_motorpool_repair_v2_tests.php (isolated disposable database).
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
core('Access'); core('FleetState'); core('Settings');
$db=envValue('DB_NAME'); test_guard([$db]); test_recreate($db);
$p=db();
test_import($p,test_sql('database/schema.sql'));
// Current split schema already declares dispatcher truck-type fields.
 // Strip only the duplicate extension ALTERs for this disposable fresh-schema test.
$extension=test_sql('database/extension.sql');
$extension=(string)preg_replace('/ALTER TABLE users\\s+ADD COLUMN dispatcher_truck_type VARCHAR\\(25\\)[\\s\\S]*?\\n  \\);\\s*/','',$extension);
$extension=(string)preg_replace('/ALTER TABLE users ADD COLUMN dispatcher_truck_types JSON NULL AFTER dispatcher_truck_type;\\s*/','',$extension);
test_import($p,$extension);
test_import($p,test_sql('database/migrations/2026-11-19_03_motorpool_repair_catalogs.sql'));
test_import($p,test_sql('database/migrations/2026-11-19_04_incident_clarifications.sql'));
foreach (['Maintenance','Mechanics','Purchasing'] as $m) Actions::load($m);
$pass=0;$fail=0;
function mpok(bool $v,string $message): void { global $pass,$fail; if($v){$pass++;echo "PASS $message\n";}else{$fail++;echo "FAIL $message\n";} }
function mpfails(callable $fn,string $message): void {
    try{$fn();mpok(false,$message);}
    catch(BusinessRuleException $e){mpok($e->httpStatus>=400,$message);}
}
$mid=insert($p,'users',['username'=>'mp_v2','email'=>'mp_v2@example.test','password_hash'=>'x','full_name'=>'Test Motorpool','role'=>'motorpool']);
$mp=['id'=>$mid,'role'=>'motorpool','full_name'=>'Test Motorpool'];
$v=insert($p,'vehicles',['plate_number'=>'MPV-001','truck_type'=>'Wing Van']);
$electrical=(int)one($p,"SELECT id FROM mechanic_specializations WHERE name='Electrical'")['id'];
$lead=(int)Mechanics::action($mp,'save',['full_name'=>'TEST, ELECTRICAL','specialization_ids'=>[$electrical]])['id'];
$mechanic=one($p,'SELECT specialization FROM mechanics WHERE id=?',[$lead]);
mpok(str_contains($mechanic['specialization'],'Electrical'),'preset specialization persists');
Mechanics::action($mp,'time_in',['id'=>$lead]);
$catalog=Maintenance::read($mp,'maintenance',[]);
mpok(!empty($catalog['motorpoolCatalogReady']) && count($catalog['components'])===31,'31 mapped Tractor Head and Trailer components');
$headlight=(int)one($p,"SELECT id FROM motorpool_components WHERE component_key='tractor_head_06'")['id'];
$tire=(int)one($p,"SELECT id FROM motorpool_components WHERE component_key='tractor_head_18'")['id'];
$tmp=tempnam(sys_get_temp_dir(),'mp_photo_');file_put_contents($tmp,base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
$file=fn()=>['name'=>'motorpool.png','tmp_name'=>$tmp,'error'=>UPLOAD_ERR_OK,'size'=>filesize($tmp)];
$_FILES=['photos'=>$file()];
$reported=Maintenance::action($mp,'report',['vehicle_id'=>$v,'problem'=>'Left headlight broken']);
$_FILES=[];
$jid=(int)$reported['job_id'];
$j=fn()=>one($p,'SELECT * FROM maintenance_jobs WHERE id=?',[$jid]);
mpok($j()['status']==='Reported' && $j()['parts_requirement']==='To Be Determined','report creates unfinalized repair with unresolved parts');
Maintenance::action($mp,'assign_mechanic',['job_id'=>$jid,'mechanic_id'=>$lead]);
Maintenance::action($mp,'inspect',['job_id'=>$jid,'findings'=>'Left headlight unlit','diagnosis'=>'Bulb circuit faulty']);
mpfails(fn()=>Maintenance::action($mp,'finalize_assignment',[
 'job_id'=>$jid,'mechanic_id'=>$lead,'component_ids'=>[$tire],'assistant_mechanic_ids'=>[],'parts_requirement'=>'No Parts Needed'
]),'wrong specialization cannot finalize');
mpok($j()['assignment_finalized_at']===null,'failed finalization rolls back');
mpfails(fn()=>Maintenance::action($mp,'finalize_assignment',[
 'job_id'=>$jid,'mechanic_id'=>$lead,'component_ids'=>[$headlight],'assistant_mechanic_ids'=>[],'parts_requirement'=>'To Be Determined'
]),'unknown parts requirement cannot finalize');
Maintenance::action($mp,'finalize_assignment',[
 'job_id'=>$jid,'mechanic_id'=>$lead,'component_ids'=>[$headlight],'assistant_mechanic_ids'=>[],'parts_requirement'=>'No Parts Needed'
]);
mpok($j()['assignment_finalized_at']!==null && $j()['parts_requirement']==='No Parts Needed','full form finalizes once');
mpfails(fn()=>Maintenance::action($mp,'assign_mechanic',['job_id'=>$jid,'mechanic_id'=>$lead]),'finalized lead assignment cannot be changed through ordinary action');
mpfails(fn()=>Maintenance::action($mp,'finalize_assignment',[
 'job_id'=>$jid,'mechanic_id'=>$lead,'component_ids'=>[$headlight],'assistant_mechanic_ids'=>[],'parts_requirement'=>'No Parts Needed'
]),'duplicate finalization is refused');
mpok((int)one($p,'SELECT COUNT(*) AS n FROM maintenance_job_components WHERE maintenance_job_id=?',[$jid])['n']===1,'selected components saved to repair');
$_FILES=['evidence'=>$file()];
Maintenance::action($mp,'complete',['job_id'=>$jid,'repair_performed'=>'Replaced faulty connector','completed_on'=>date('Y-m-d')]);
$_FILES=[];
mpok($j()['status']==='Completed','repair can complete with confirmed no parts and evidence');
Maintenance::action($mp,'verify',['job_id'=>$jid,'result'=>'Passed','verification_notes'=>'Headlight working']);
mpok($j()['verified_at']!==null,'verified repair remains auditable');
mpok((bool)one($p,"SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='incident_clarifications'"),'append-only incident clarification table installed');
@unlink($tmp);
echo "TOTAL: $pass passed, $fail failed\n"; exit($fail?1:0);
