<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;

final class DispatcherWorkflowTest extends TestCase {
    protected function setUp():void {core('DispatcherResources');Actions::load('Attendance');Actions::load('Trips');}
    public function testCreatorCannotBypassOperationalTripScope():void {
        $u=['id'=>7,'role'=>'container_wingvan_dispatcher'];
        self::assertFalse(DispatcherScope::permitsTrip($u,['created_by'=>7,'dispatcher_role'=>'car_carrier_dispatcher','truck_type'=>'Car Carrier']));
        self::assertFalse(DispatcherScope::permitsTrip($u,['created_by'=>7,'dispatcher_role'=>$u['role'],'truck_type'=>'Car Carrier']));
        self::assertTrue(DispatcherScope::permitsTrip($u,['created_by'=>8,'dispatcher_role'=>$u['role'],'truck_type'=>'Wing Van']));
        self::assertFalse(DispatcherScope::permitsTrip($u,['created_by'=>8,'dispatcher_role'=>$u['role'],'truck_type'=>null]));
    }
    public function testSessionMustStillBeOpenAndBelongToTheCurrentDutyShift():void {
        $s=['duty_date'=>'2026-11-10','duty_shift'=>'Night','time_out'=>null];$shift=['date'=>'2026-11-10','shift'=>'Night'];
        self::assertTrue(DispatcherAttendance::isCurrent($s,$shift));
        self::assertFalse(DispatcherAttendance::isCurrent(array_replace($s,['time_out'=>'2026-11-11 01:00:00']),$shift));
        self::assertFalse(DispatcherAttendance::isCurrent($s,['date'=>'2026-11-11','shift'=>'Night']));
        self::assertFalse(DispatcherAttendance::isCurrent($s,['date'=>'2026-11-10','shift'=>'Day']));
    }
    private function options():array {return ['drivers'=>[['id'=>1,'name'=>'Fixture Driver','vehicle_id'=>10,'plate_number'=>'TEST','regular_helper_id'=>3,'shift_warning'=>null]],'helpers'=>[['id'=>3]],'second_drivers'=>[['id'=>1],['id'=>2]]];}
    public function testReplacementUsesSelectedDriversPermanentTruckWithoutChangingItsRegularHelper():void {
        $options=$this->options();$options['helpers']=[['id'=>4]];$r=DispatcherResources::choose($options,['truck_type'=>'Container'],['driver_id'=>1,'vehicle_id'=>10,'helper_id'=>4]);
        self::assertSame(10,$r['vehicle_id']);self::assertSame(4,$r['helper_id']);self::assertSame(3,$options['drivers'][0]['regular_helper_id']);
    }
    public function testForgedTruckCannotOverrideThePermanentPair():void {
        $this->expectException(BusinessRuleException::class);DispatcherResources::choose($this->options(),['truck_type'=>'Wing Van'],['driver_id'=>1,'vehicle_id'=>11,'helper_id'=>3]);
    }
    public function testUnauthorizedOrNotTimedInHelperCannotBeChosen():void {
        $this->expectException(BusinessRuleException::class);DispatcherResources::choose($this->options(),['truck_type'=>'Container'],['driver_id'=>1,'vehicle_id'=>10,'helper_id'=>999]);
    }
    public function testCarCarrierRequiresTwoDistinctEligibleDrivers():void {
        $r=DispatcherResources::choose($this->options(),['truck_type'=>'Car Carrier'],['driver_id'=>1,'vehicle_id'=>10,'driver2_id'=>2]);self::assertSame(2,$r['driver2_id']);self::assertNull($r['helper_id']);
        $this->expectException(BusinessRuleException::class);DispatcherResources::choose($this->options(),['truck_type'=>'Car Carrier'],['driver_id'=>1,'vehicle_id'=>10,'driver2_id'=>1]);
    }
    public function testAttendanceAndAssignmentEndpointsRejectOtherRolesBeforeDatabaseAccess():void {
        foreach(['admin','operations_head','motorpool','finance','audit','billing','purchasing'] as $role){$u=['id'=>1,'role'=>$role];foreach([fn()=>Attendance::action($u,'time_in',[]),fn()=>Attendance::action($u,'time_out',[]),fn()=>Attendance::action($u,'dispatcher_list',[]),fn()=>Attendance::action($u,'dispatcher_history',[]),fn()=>Trips::action($u,'dispatcher_resources',[]),fn()=>Trips::action($u,'assign_resources',[])] as $call){try{$call();self::fail('Unauthorized operation succeeded.');}catch(BusinessRuleException $e){self::assertSame(403,$e->httpStatus);}}}
    }
}
