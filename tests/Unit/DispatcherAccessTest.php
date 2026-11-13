<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DispatcherAccessTest extends TestCase {
    public static function otherRoles(): iterable {
        foreach (array_keys(ROLE_LABELS) as $role) if (!roleIsDispatcher($role)) yield $role => [$role];
    }
    #[DataProvider('otherRoles')]
    public function testDispatcherReadProjectionsRejectOtherRoles(string $role): void {
        Actions::load('Trips'); Actions::load('Fleet');
        foreach ([fn()=>Trips::read(['id'=>1,'role'=>$role],'trips',['view'=>'requests']),fn()=>Trips::read(['id'=>1,'role'=>$role],'trips',['view'=>'request-result']),fn()=>Trips::dispatcherOverview(['id'=>1,'role'=>$role]),fn()=>Fleet::read(['id'=>1,'role'=>$role],'trucks',['view'=>'availability'])] as $call) {
            try { $call(); self::fail('Unauthorized dispatcher projection succeeded.'); }
            catch (BusinessRuleException $e) { self::assertSame(403,$e->httpStatus); }
        }
    }
    public static function dispatcherMutations(): iterable {
        foreach (['car_carrier_dispatcher','container_wingvan_dispatcher'] as $role) {
            foreach (['Trips'=>['review','reassign'],'Funds'=>['decide','release','liquidate'],'Fleet'=>['truck_save','truck_status','truck_active','crew_save','crew_status','crew_active'],'Maintenance'=>['report','assess','complete','verify'],'Mechanics'=>['save','availability','set_active']] as $module=>$actions) foreach ($actions as $action) yield "$role:$module.$action"=>[$role,$module,$action];
        }
    }
    #[DataProvider('dispatcherMutations')]
    public function testDispatcherCannotPerformManagementMutations(string $role,string $module,string $action): void {
        Actions::load($module);
        try { $module::action(['id'=>1,'role'=>$role],$action,[]); self::fail('Unauthorized management mutation succeeded.'); }
        catch (BusinessRuleException $e) { self::assertSame(403,$e->httpStatus); }
    }
    public function testDispatcherTeamGuardRejectsOtherTeam(): void {
        Actions::load('Trips'); $guard=new ReflectionMethod(Trips::class,'mustBeTripDispatcher');
        foreach (['car_carrier_dispatcher'=>'container_wingvan_dispatcher','container_wingvan_dispatcher'=>'car_carrier_dispatcher'] as $role=>$other) {
            try { $guard->invoke(null,['id'=>1,'role'=>$role],['dispatcher_role'=>$other]); self::fail('Cross-team trip allowed.'); }
            catch (BusinessRuleException $e) { self::assertSame(403,$e->httpStatus); }
        }
    }
}
