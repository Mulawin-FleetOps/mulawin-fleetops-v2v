<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;
final class PricingAuthorizationTest extends TestCase {
    public function testPricingNavigationKeepsExistingManagementPages():void {
        core('Access');$nav=Access::navFor(['id'=>1,'role'=>'admin']);$pages=array_column($nav,null,'id');
        self::assertSame('Route & Contract Rates',$pages['routes']['label']);self::assertSame('Client & Commercial',$pages['routes']['section']);
        self::assertSame('Fuel & Operating Costs',$pages['fuel-adjustment']['label']);self::assertArrayHasKey('admin',$pages);self::assertArrayHasKey('billing',$pages);
        foreach(array_keys(ROLE_LABELS) as $role)self::assertSame($role==='admin',Access::canOpen(['id'=>1,'role'=>$role],'fuel-adjustment'));
    }
    public function testFuelAndRecalculationMutationsDenyOtherRolesBeforeDatabaseAccess():void {
        core('Settings');Actions::load('Billing');
        foreach(array_keys(ROLE_LABELS) as $role){if($role==='admin')continue;$u=['id'=>1,'role'=>$role];
            foreach([fn()=>Settings::pricingSave($u,[]),fn()=>Settings::pricingRead($u),fn()=>Billing::action($u,'pricing_recalculate',[])] as $action){
                try{$action();self::fail('Unauthorized pricing action');}catch(BusinessRuleException $e){self::assertSame(403,$e->httpStatus);}
            }
        }
    }
}
