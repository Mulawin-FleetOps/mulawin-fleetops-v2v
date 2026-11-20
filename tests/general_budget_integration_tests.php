<?php
/** General Budget integration, isolated disposable *_test database only. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
$dbName=envValue('DB_NAME');
test_guard([$dbName]);
function checkBudget(bool $ok,string $msg):void {
    if (!$ok) throw new RuntimeException($msg);
    echo "PASS: $msg\n";
}
try {
    test_recreate($dbName);
    $p=db();
    test_import($p,test_sql('database/schema.sql'));
    // The fresh users table already includes dispatcher fields, which extension.sql
    // also creates for historical upgrades. Do not re-apply those ALTERs here.
    $ext=test_sql('database/extension.sql');
    $ext=preg_replace('/ALTER TABLE users\s+ADD COLUMN dispatcher_truck_type VARCHAR\(25\).*?;/is','',$ext);
    $ext=preg_replace('/ALTER TABLE users ADD COLUMN dispatcher_truck_types JSON NULL AFTER dispatcher_truck_type\s*;/is','',$ext);
    test_import($p,$ext);
    $p->exec("CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    test_import($p,test_sql('database/migrations/2026-11-21_01_general_budget_approvals.sql'));
    foreach(['Finance','Purchasing','Oversight'] as $module) Actions::load($module);
    $accounts=[];
    foreach(['finance','admin','purchasing'] as $role) {
        $id=insert($p,'users',['username'=>$role,'email'=>$role.'@example.test',
            'password_hash'=>'disabled','full_name'=>ucfirst($role),'role'=>$role]);
        $accounts[$role]=['id'=>$id,'role'=>$role,'full_name'=>ucfirst($role)];
    }
    $finance=$accounts['finance'];$admin=$accounts['admin'];$buyer=$accounts['purchasing'];
    $today=date('Y-m-d');$later=date('Y-m-d',strtotime('+30 days'));
    $submit=function(float $amount) use($finance,$p,$today,$later):int {
        Finance::action($finance,'budget_set',['amount'=>$amount,'period_start'=>$today,'period_end'=>$later]);
        return (int)one($p,'SELECT MAX(id) AS id FROM general_budget_requests')['id'];
    };
    $active=fn()=>one($p,"SELECT * FROM budgets WHERE category='General' AND status='Active' ORDER BY id DESC LIMIT 1");
    foreach ([
        ['period_start'=>date('Y-m-d',strtotime('-1 day')),'period_end'=>$later,'case'=>'past start'],
        ['period_start'=>date('Y-m-d',strtotime('+1 day')),'period_end'=>$later,'case'=>'future start'],
        ['period_start'=>$today,'period_end'=>date('Y-m-d',strtotime('-1 day')),'case'=>'past end'],
    ] as $invalid) {
        try {
            Finance::action($finance,'budget_set',[
                'amount'=>10000,'period_start'=>$invalid['period_start'],'period_end'=>$invalid['period_end']
            ]);
            throw new RuntimeException('Accepted invalid '.$invalid['case'].' date');
        } catch(BusinessRuleException $e) {
            checkBudget($e->httpStatus===422,'General Budget rejects '.$invalid['case'].' date');
        }
    }
    $first=$submit(10000);
    checkBudget(!$active(),'Finance submission does not activate unapproved budget');
    checkBudget(one($p,'SELECT status FROM general_budget_requests WHERE id=?',[$first])['status']==='Pending Approval','Request remains Pending Approval');
    $adminPending=Oversight::queue($admin,$p,false);
    checkBudget(count(array_filter($adminPending,static fn($row)=>($row['kind']??'')==='budget' && (int)$row['id']===$first && $row['status']==='Pending'))===1,
        'General Budget request is visible in Admin Pending Approvals');
    Finance::action($admin,'budget_decide',['request_id'=>$first,'decision'=>'approve']);
    $one=$active();
    checkBudget($one && (float)$one['amount']===10000.0,'Admin approval activates General Budget');
    $adminAfter=Oversight::queue($admin,$p,false);
    checkBudget(!array_filter($adminAfter,static fn($row)=>($row['kind']??'')==='budget' && (int)$row['id']===$first),
        'Approved General Budget leaves the Admin Pending queue');
    $adminHistory=Oversight::queue($admin,$p,true);
    checkBudget((bool)array_filter($adminHistory,static fn($row)=>($row['kind']??'')==='budget' && (int)$row['id']===$first && $row['status']==='Approved'),
        'Approved General Budget appears in Admin History');
    $part=(int)Purchasing::action($buyer,'part_save',[
        'part_type'=>'Tire','description'=>'General budget test tire','unit'=>'piece',
        'unit_cost'=>'100','reorder_level'=>1
    ])['id'];
    Purchasing::action($buyer,'po_create',[
        'supplier_name'=>'Test Supplier','supplier_address'=>'Test Address',
        'purpose'=>'Test General Budget reservation',
        'lines'=>[['part_id'=>$part,'quantity'=>3,'unit_price'=>100]]
    ]);
    $po=(int)one($p,'SELECT MAX(id) AS id FROM purchase_orders')['id'];
    Purchasing::action($finance,'po_decide',['po_id'=>$po,'decision'=>'approve']);
    checkBudget((float)$active()['reserved_amount']===300.0,'PO approval reserves General Budget');
    Finance::action($finance,'expense_add',[
        'category'=>'Office','amount'=>120,'incurred_on'=>$today,'description'=>'Office supplies test'
    ]);
    checkBudget((float)$active()['spent_amount']===120.0,'Manual expense updates General Budget spent');
    $second=$submit(20000);
    try { $submit(25000); throw new RuntimeException('Duplicate pending request was accepted'); }
    catch(BusinessRuleException $e) { checkBudget($e->httpStatus===409,'Only one pending General Budget request is allowed'); }
    Finance::action($admin,'budget_decide',['request_id'=>$second,'decision'=>'approve']);
    $two=$active();
    checkBudget((int)$two['id']!==(int)$one['id'] && (float)$two['reserved_amount']===300.0,
        'Replacement activates only on approval and carries PO reservation');
    checkBudget((int)one($p,'SELECT budget_id FROM purchase_orders WHERE id=?',[$po])['budget_id']===(int)$two['id'],
        'Existing PO stays linked to new active General Budget');
    checkBudget(one($p,'SELECT status FROM budgets WHERE id=?',[$one['id']])['status']==='Closed',
        'Prior approved allocation remains as Closed history');
    $third=$submit(30000);
    Finance::action($admin,'budget_decide',['request_id'=>$third,'decision'=>'reject','reason'=>'Not needed']);
    checkBudget((int)$active()['id']===(int)$two['id'],
        'Rejected request does not change active budget');
    $view=Finance::read($finance,'finance_budgets',[]);
    checkBudget((int)($view['generalBudget']['id']??0)===(int)$two['id'] &&
        count($view['budgetRequests']??[])===3,'Finance page includes active budget and complete request history');
    echo "PASS: General Budget integration complete\n";
} catch(Throwable $e) {
    fwrite(STDERR,'FAIL: '.get_class($e).': '.$e->getMessage()."\n");
    exit(1);
}
