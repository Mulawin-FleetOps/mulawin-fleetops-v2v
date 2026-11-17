<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class OperationsReportsTest extends TestCase {
    protected function setUp():void {core('OperationsReports');Actions::load('Analytics');}
    public function testPresetDatesUseManilaAndDefaultToMonthToDate():void {
        $now=new DateTimeImmutable('2026-11-09T17:00:00Z'); // Nov 10 in Manila.
        foreach(['today'=>['2026-11-10','2026-11-10'],'week'=>['2026-11-09','2026-11-10'],'month'=>['2026-11-01','2026-11-10']] as $range=>$dates){$f=OperationsReports::filters(['date_range'=>$range],$now);self::assertSame($dates,[$f['from'],$f['to']]);}
        self::assertSame('month',OperationsReports::filters([],$now)['date_range']);
        $f=OperationsReports::filters(['date_range'=>'week'],new DateTimeImmutable('2026-11-01T00:00:00+08:00'));self::assertSame('2026-10-26',$f['from']);
    }
    public function testCustomAndLegacyDateFiltersRemainExact():void {
        $f=OperationsReports::filters(['report'=>'incidents','from'=>'2026-02-01','to'=>'2026-02-28','truck_type'=>'Wing Van','search'=>'TRIP']);
        self::assertSame('custom',$f['date_range']);self::assertSame('2026-02-28',$f['to']);self::assertSame('Wing Van',$f['truck_type']);self::assertSame('TRIP',$f['search']);
    }
    public static function invalidFilters():iterable {
        yield [['report'=>'money']];yield [['date_range'=>'year']];yield [['truck_type'=>'Bus']];
        yield [['date_range'=>'custom','from'=>'2026-03-01','to'=>'2026-02-28']];
        yield [['date_range'=>'custom','from'=>'2026-02-30','to'=>'2026-03-01']];
        yield [['date_range'=>'custom','from'=>'0000-01-01','to'=>'2026-03-01']];
        yield [['date_range'=>'custom','from'=>'2026-01-01']];yield [['date_range'=>'custom','from'=>[],'to'=>'2026-03-01']];
        yield [['date_range'=>'custom','from'=>'2026-1-01','to'=>'2026-03-01']];yield [['search'=>str_repeat('x',201)]];
    }
    #[DataProvider('invalidFilters')]
    public function testInvalidFiltersAreRejectedInsteadOfSilentlySwapped(array $q):void {$this->expectException(BusinessRuleException::class);OperationsReports::filters($q);}
    public function testTripMetricsUseVerifiedStatusesAndAccountForEveryRecord():void {
        $rows=array_map(fn($s)=>['status'=>$s],['Completed','Dispatched','In Transit','On Hold - Incident Reported','For Reschedule','Cancelled','Rejected','Ready for Dispatch']);
        $s=OperationsReports::summarize('trips',$rows);self::assertSame([8,1,2,1],array_column($s['cards'],'value'));self::assertSame([1,2,1,4],$s['chart']['values']);self::assertSame(8,array_sum($s['chart']['values']));
    }
    public function testTruckMetricsCountTrucksOnceAndTripsSeparately():void {
        $s=OperationsReports::summarize('trucks',[['id'=>1,'trip_count'=>4],['id'=>2,'trip_count'=>1],['id'=>3,'trip_count'=>0]]);
        self::assertSame([3,2,5,1],array_column($s['cards'],'value'));self::assertSame([2,1],$s['chart']['values']);
    }
    public function testIncidentMetricsCountDistinctTripsAndKeepClearedIncidentsOpen():void {
        $s=OperationsReports::summarize('incidents',[['trip_id'=>5,'status'=>'Resolved'],['trip_id'=>5,'status'=>'Under Repair'],['trip_id'=>5,'status'=>'Repaired - Cleared to Continue'],['trip_id'=>8,'status'=>'Reported']]);
        self::assertSame([4,1,3,2],array_column($s['cards'],'value'));self::assertSame([1,3],$s['chart']['values']);
    }
    public function testSearchAndPageUseTheFullMatchingSetAndClampPages():void {
        $rows=array_map(fn($i)=>['id'=>$i,'trip_ref'=>'TRIP-'.$i,'status'=>'Completed','client'=>'Client','truck_type'=>'Container','route'=>'A → B','scheduled_at'=>'2026-11-01 08:00:00'],range(1,37));
        $f=OperationsReports::filters([]);$page=OperationsReports::page($f,$rows,4);self::assertCount(7,$page['rows']);self::assertSame(37,$page['total']);self::assertSame(4,$page['pages']);self::assertSame(31,$page['rows'][0]['id']);self::assertSame(37,$page['cards'][0]['value']);
        $found=OperationsReports::matchingRows('trips',$rows,'trip-37');self::assertCount(1,$found);$page=OperationsReports::page($f,$found,99);self::assertSame(1,$page['page']);self::assertSame(1,$page['total']);self::assertSame(1,$page['cards'][0]['value']);
        $empty=OperationsReports::page($f,[],5);self::assertSame([0,0,0,0],array_column($empty['cards'],'value'));self::assertSame(1,$empty['page']);
    }
    public function testCsvContainsAllSafeColumnsAndNeutralizesSpreadsheetFormulas():void {
        $rows=array_map(fn($i)=>['id'=>$i,'trip_ref'=>'TRIP-'.$i,'client'=>$i===1?' =HYPERLINK("bad")':'Client, "quoted"','truck_type'=>'Container','route'=>'A → B','scheduled_at'=>'2026-11-01 08:00:00','status'=>'Completed','password_hash'=>'SECRET'],range(1,25));
        $csv=OperationsReports::csv('trips',$rows);self::assertStringStartsWith("\xEF\xBB\xBF",$csv);self::assertStringContainsString('TRIP-25',$csv);self::assertStringNotContainsString('SECRET',$csv);
        $stream=fopen('php://temp','w+');fwrite($stream,substr($csv,3));rewind($stream);$parsed=[];while(($line=fgetcsv($stream,0,',','"',''))!==false)$parsed[]=$line;fclose($stream);
        self::assertCount(26,$parsed);self::assertCount(6,$parsed[0]);self::assertStringStartsWith("'",$parsed[1][1]);self::assertSame('Client, "quoted"',$parsed[2][1]);
        self::assertCount(1,explode("\n",trim(OperationsReports::csv('incidents',[]))));
    }
    public function testOtherRolesCannotUseOperationsReportEndpointsBeforeDatabaseAccess():void {
        foreach(array_diff(array_keys(ROLE_LABELS),['operations_head']) as $role){$u=['id'=>1,'role'=>$role];foreach([fn()=>OperationsReports::read($u,[]),fn()=>Analytics::action($u,'operations_export',[]),fn()=>Analytics::action($u,'operations_incident',[])] as $call){try{$call();self::fail('Unauthorized reporting operation allowed.');}catch(BusinessRuleException $e){self::assertSame(403,$e->httpStatus);}}}
    }
}
