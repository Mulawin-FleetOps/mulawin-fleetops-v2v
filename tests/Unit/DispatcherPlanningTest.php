<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DispatcherPlanningTest extends TestCase {
    protected function setUp():void { core('DispatcherPlanning');core('DispatcherScope'); }
    public static function compatibleAssignments():iterable {
        foreach(TRUCK_TYPES as $type)foreach(['Day','Night'] as $shift)yield "$type $shift"=>[$type,$shift];
    }
    #[DataProvider('compatibleAssignments')]
    public function testEverySupportedShiftIsManualAndIndependentOfDepartureTime(string $type,string $shift):void {
        $selected=dispatcherRoleFor($type).':'.$shift;
        self::assertSame(['dispatcher_role'=>dispatcherRoleFor($type),'dispatcher_shift'=>$shift],DispatcherPlanning::assignment($type,$selected));
    }
    public static function invalidAssignments():iterable {
        yield ['Container',null];yield ['Wing Van',''];yield ['Car Carrier',[]];
        yield ['Container','car_carrier_dispatcher:Day'];yield ['Wing Van','car_carrier_dispatcher:Night'];
        yield ['Car Carrier','container_wingvan_dispatcher:Day'];yield ['Car Carrier','container_wingvan_dispatcher:Night'];
        yield ['Container','container_wingvan_dispatcher:Evening'];yield ['Container','container_wingvan_dispatcher:day'];
        yield ['Container','container_wingvan_dispatcher:Day:Night'];yield ['Other','car_carrier_dispatcher:Day'];
    }
    #[DataProvider('invalidAssignments')]
    public function testMissingMalformedOrIncompatibleAssignmentIsRejected(string $type,mixed $value):void {
        $this->expectException(BusinessRuleException::class);DispatcherPlanning::assignment($type,$value);
    }
    public function testCurrentAccountOwnershipIsIndependentOfOriginalShiftOrSchedule():void {
        $day=['id'=>1,'role'=>'container_wingvan_dispatcher','shift'=>'Day'];$night=['id'=>2,'role'=>$day['role'],'shift'=>'Night'];
        $trip=['created_by'=>1,'dispatcher_role'=>$day['role'],'dispatcher_shift'=>'Day','truck_type'=>'Wing Van','responsible_dispatcher_id'=>2];
        foreach(['2026-11-11 08:00:00','2026-11-11 20:00:00'] as $at){$trip['scheduled_at']=$at;self::assertFalse(DispatcherScope::permitsTrip($day,$trip));self::assertTrue(DispatcherScope::permitsTrip($night,$trip));}
        self::assertTrue(DispatcherScope::permitsTrip(array_diff_key($night,['shift'=>1]),$trip));
        self::assertFalse(DispatcherScope::permitsTrip(['id'=>2,'role'=>'car_carrier_dispatcher','shift'=>'Night'],$trip));
    }
    public function testHistoricalNullShiftDoesNotFabricateAccountOwnership():void {
        $trip=['created_by'=>9,'dispatcher_role'=>'car_carrier_dispatcher','truck_type'=>'Car Carrier','dispatcher_shift'=>null];
        foreach(['Day','Night',null] as $shift){$u=['id'=>2,'role'=>'car_carrier_dispatcher','shift'=>$shift];self::assertFalse(DispatcherScope::permitsTrip($u,$trip));self::assertTrue(DispatcherScope::permitsTrip($u,$trip+['responsible_dispatcher_id'=>2]));}
    }
}
