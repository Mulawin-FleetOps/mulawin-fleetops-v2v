<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;

/** Exercises the real SELECT projection against a private in-memory SQLite database. */
final class DispatcherMonitoringTest extends TestCase {
    private PDO $pdo;
    private string $role = 'container_wingvan_dispatcher';
    protected function setUp(): void {
        Actions::load('Trips'); core('DispatcherMonitoring');
        $this->pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $this->pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, role TEXT, shift TEXT, dispatcher_truck_type TEXT, dispatcher_truck_types TEXT, active INTEGER); CREATE TABLE trip_responsibilities (trip_id INTEGER PRIMARY KEY, current_dispatcher_id INTEGER); CREATE TABLE clients (id INTEGER PRIMARY KEY, company_name TEXT); CREATE TABLE vehicles (id INTEGER PRIMARY KEY, plate_number TEXT); CREATE TABLE trips (id INTEGER PRIMARY KEY, trip_ref TEXT, client_id INTEGER, vehicle_id INTEGER, pickup_point TEXT, delivery_point TEXT, truck_type TEXT, scheduled_at TEXT, status TEXT, dispatcher_role TEXT, dispatcher_shift TEXT, completed_at TEXT)');
        $this->pdo->exec("INSERT INTO clients VALUES (1,'Fixture Client'); INSERT INTO vehicles VALUES (1,'FIX-PLATE')");
        $this->pdo->exec("INSERT INTO users VALUES
            (1,'Carrier Night','car_carrier_dispatcher','Night','Car Carrier','[\"Car Carrier\"]',1),
            (2,'Container Day','container_wingvan_dispatcher','Day','Container','[\"Container\"]',1),
            (3,'Container Night','container_wingvan_dispatcher','Night','Container','[\"Container\"]',1),
            (4,'Multi-Type Dispatcher','container_wingvan_dispatcher','Day','Container','[\"Car Carrier\",\"Container\"]',1)");
        foreach (Trips::STATUSES as $status) $this->add($status);
        for ($i=0; $i<15; $i++) $this->add('In Transit');
        $this->add('Completed', 'car_carrier_dispatcher', 'Night');
        $this->add('In Transit', 'car_carrier_dispatcher', 'Night');
        $this->add('Completed', $this->role, 'Night'); $this->add('Cancelled', $this->role, 'Night');
        $this->add('In Transit', $this->role, null); $this->add('Rejected', $this->role, null);
        $this->add('Completed', 'admin'); $this->add('Rejected', null);
    }
    private function add(string $status, ?string $role='container_wingvan_dispatcher', ?string $shift='Day'): void {
        $n=(int)$this->pdo->query('SELECT COUNT(*) FROM trips')->fetchColumn()+1;
        $this->pdo->prepare('INSERT INTO trips VALUES (?,?,1,1,?,?,?,?,?,?,?,?)')->execute([$n,'FIX-'.$n,'Fixture Pickup','Fixture Delivery','Container','2026-11-12 08:00:00',$status,$role,$shift,$status==='Completed'?'2026-11-13 17:00:00':null]);
        $owner = $role==='car_carrier_dispatcher' ? 1
            : ($role==='container_wingvan_dispatcher' ? ($shift==='Night'?3:2) : null);
        if ($owner) $this->pdo->prepare('INSERT INTO trip_responsibilities VALUES (?,?)')->execute([$n,$owner]);
    }
    private function read(array $q=[]): array {
        return (new ReflectionMethod(DispatcherMonitoring::class,'projection'))->invoke(null,$this->pdo,$q);
    }
    public function testClassificationResponsibilityCountsAndGroupCards(): void {
        $d=$this->read(); self::assertSame(['total'=>32,'active'=>24,'completed'=>3,'attention'=>3],$d['summary']);
        self::assertSame(24,$d['total']); self::assertSame(DispatcherMonitoring::statuses('active'),$d['statuses']);
        foreach ($d['rows'] as $row) self::assertNotContains($row['status'],['Pending Review',...Trips::CLOSED]);
        $history=$this->read(['tab'=>'history']); self::assertSame(7,$history['total']);
        self::assertEqualsCanonicalizing(Trips::CLOSED,array_unique(array_column($history['rows'],'status')));
        self::assertNotContains('admin',array_column($history['rows'],'dispatcher_role')); self::assertNotContains(null,array_column($history['rows'],'dispatcher_role'));
        self::assertCount(4,$d['groups'], 'Cards are generated from actual active dispatcher accounts.');
        foreach ($d['groups'] as $group) {
            $scope=$this->read(['dispatcher_id'=>$group['account_id']]);
            foreach (['total','active','completed'] as $key) self::assertSame($group[$key],$scope['summary'][$key]);
        }
        $unused=array_values(array_filter($d['groups'],fn($g)=>$g['account_id']===4))[0];
        self::assertSame(0,$unused['total'], 'Unused active accounts are visible, not invented shift buckets.');
        self::assertSame(34,(int)$this->pdo->query('SELECT COUNT(*) FROM trips')->fetchColumn());
    }
    public function testStatusesLegacyAndPagination(): void {
        foreach (DispatcherMonitoring::statuses('active') as $status) self::assertGreaterThan(0,$this->read(['status'=>$status])['total']);
        foreach (Trips::CLOSED as $status) self::assertGreaterThan(0,$this->read(['tab'=>'history','status'=>$status])['total']);
        $legacy=$this->read(['shift'=>'legacy']); self::assertSame(1,$legacy['total']); self::assertNull($legacy['rows'][0]['dispatcher_shift']);
        self::assertSame('Rejected',$this->read(['shift'=>'legacy','tab'=>'history'])['rows'][0]['status']);
        $first=$this->read(['group'=>$this->role,'shift'=>'Day']);
        $second=$this->read(['page'=>'dispatcher-monitoring','group'=>$this->role,'shift'=>'Day','trip_page'=>2]);
        self::assertSame(2,$second['page']); self::assertCount(10,$second['rows']);
        self::assertSame([],array_intersect(array_column($first['rows'],'id'),array_column($second['rows'],'id')));
        self::assertSame('2026-11-13 17:00:00',$this->read(['tab'=>'history','status'=>'Completed'])['rows'][0]['completed_at']);
    }
    public function testMultiTypeAccountAndTurnoverAreCountedOnlyOnce(): void {
        $trip=(int)$this->pdo->query("SELECT id FROM trips WHERE status='In Transit' AND dispatcher_role='container_wingvan_dispatcher' LIMIT 1")->fetchColumn();
        $this->pdo->prepare('UPDATE trip_responsibilities SET current_dispatcher_id=4 WHERE trip_id=?')->execute([$trip]);
        $d=$this->read();
        $multi=array_values(array_filter($d['groups'],fn($g)=>$g['account_id']===4))[0];
        self::assertSame(['Car Carrier','Container'],$multi['types']);
        self::assertSame(1,$multi['active']);
        self::assertSame(1,$multi['total']);
        self::assertSame(1,$this->read(['dispatcher_id'=>4])['total']);
        self::assertSame(24,$d['summary']['active'], 'Account turnover must not duplicate trips.');
    }
    public function testSearchAndScheduleDates(): void {
        foreach (['FIX-','Fixture Client','Fixture Pickup','Fixture Delivery','FIX-PLATE'] as $search) self::assertSame(24,$this->read(['search'=>$search])['total']);
        self::assertSame(0,$this->read(['search'=>'no-match'])['total']);
        self::assertSame(['total'=>32,'active'=>24,'completed'=>3,'attention'=>3],$this->read(['search'=>'no-match'])['summary'], 'KPI summary remains scoped to group/shift, not search terms');
        self::assertSame(24,$this->read(['from'=>'2026-11-12','to'=>'2026-11-12'])['total']);
        self::assertSame(0,$this->read(['from'=>'2026-11-13'])['total']);
        self::assertSame(0,$this->read(['tab'=>'history','from'=>'2026-11-13'])['total'],'Schedule filtering must not use completion dates');
    }
    public function testInvalidFiltersRemainAuthoritativelyRejected(): void {
        foreach ([['status'=>'Completed'],['tab'=>'history','status'=>'In Transit'],['status'=>'Pending Review'],['group'=>'admin'],['dispatcher_id'=>'999'],['shift'=>'Dawn'],['from'=>'2026-11-13','to'=>'2026-11-12']] as $q) {
            try { $this->read($q); self::fail('Invalid filter accepted'); } catch (BusinessRuleException $e) { self::assertNotEmpty($e->getMessage()); }
        }
    }
}
