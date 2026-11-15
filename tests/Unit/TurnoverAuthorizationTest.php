<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;
final class TurnoverAuthorizationTest extends TestCase {
    protected function setUp():void { Actions::load('Trips'); }
    public function testNonparticipantsAndMonitoringRolesHaveNoTurnoverMutationPrivileges():void {
        foreach(array_keys(ROLE_LABELS) as $role){
            $u=['id'=>1,'role'=>$role];
            $actions=roleIsDispatcher($role)?['turnover_assign_initial']:($role==='operations_head'?['turnover_preview','turnover_endorse','turnover_accept','progress']:['turnover_list','turnover_details','turnover_assign_initial','turnover_endorse','turnover_accept','progress']);
            foreach($actions as $action){try{Trips::action($u,$action,[]);self::fail($role.' unexpectedly passed '.$action);}catch(BusinessRuleException $e){self::assertSame(403,$e->httpStatus);}}
        }
    }
}
