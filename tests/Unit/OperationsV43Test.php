<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;

final class OperationsV43Test extends TestCase {
    protected function setUp():void { Actions::load('Trips');core('DispatcherMonitoring');core('Access'); }
    public function testOnlyOperationsHeadCanCreateTrips():void {
        $permission=new ReflectionMethod(Trips::class,'canCreate');
        foreach(array_keys(ROLE_LABELS) as $role) self::assertSame($role==='operations_head',$permission->invoke(null,['id'=>1,'role'=>$role]));
    }
    public function testMonitoringIsOperationsHeadOnlyAtPageAndServiceBoundaries():void {
        foreach(array_keys(ROLE_LABELS) as $role){$u=['id'=>1,'role'=>$role];self::assertSame($role==='operations_head',Access::canOpen($u,'dispatcher-monitoring'));
            if($role==='operations_head')continue;
            foreach([fn()=>DispatcherMonitoring::read($u,[]),fn()=>Trips::action($u,'monitor_details',[])] as $call){try{$call();self::fail('Unauthorized monitoring succeeded');}catch(BusinessRuleException $error){self::assertSame(403,$error->httpStatus);}}
        }
    }
    public function testGroupChoicesReuseTheTruckTypePlanningMapping():void {
        $groups=DispatcherPlanning::groups();self::assertCount(count(array_unique(array_map('dispatcherRoleFor',TRUCK_TYPES)))*count(DispatcherPlanning::SHIFTS),$groups);
        foreach($groups as $group)self::assertSame($group['role'].':'.$group['shift'],$group['key']);
    }
    private function options():array {return ['drivers'=>[['id'=>2,'vehicle_id'=>9,'plate_number'=>'TEST','regular_helper_id'=>3]],'helpers'=>[['id'=>3],['id'=>4]],'second_drivers'=>[]];}
    public function testSelectedTruckDerivesPrimaryDriverWithoutClientDriverField():void {
        $result=DispatcherResources::choose($this->options(),['truck_type'=>'Container'],['vehicle_id'=>9,'helper_id'=>3]);
        self::assertSame(2,$result['driver_id']);self::assertSame(3,$result['helper_id']);self::assertNull($result['helper_substitution_reason']);
    }
    public function testForgedDriverCannotOverrideFixedPair():void {
        $this->expectException(BusinessRuleException::class);DispatcherResources::choose($this->options(),['truck_type'=>'Container'],['vehicle_id'=>9,'driver_id'=>7,'helper_id'=>3]);
    }
    public function testHelperReplacementRequiresNonemptyReason():void {
        $this->expectException(BusinessRuleException::class);DispatcherResources::choose($this->options(),['truck_type'=>'Container'],['vehicle_id'=>9,'helper_id'=>4,'helper_substitution_reason'=>'  ']);
    }
    public function testRetiredMutationsRefuseBeforeOpeningDatabase():void {
        foreach(['review','reassign','auto_assign'] as $action){try{Trips::action(['id'=>1,'role'=>'operations_head'],$action,[]);self::fail('Retired mutation succeeded');}catch(BusinessRuleException $error){self::assertSame(409,$error->httpStatus);}}
    }
}
