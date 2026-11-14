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
    public function testRouteRateModalExplainsMissingVerifiedFuelSources():void {
        $js=file_get_contents(dirname(__DIR__,2).'/public/assets/js/modules/operations/routes.js');
        self::assertIsString($js);
        self::assertStringContainsString('const pricingWarning=pricing.fuel===null', $js);
        self::assertStringContainsString('pricing.missing', $js);
        self::assertStringContainsString('Fuel estimate is not ready', $js);
        self::assertStringContainsString('Verified garage location is not configured', $js);
        self::assertStringContainsString('Effective diesel price is not configured', $js);
        self::assertStringContainsString('efficiency and verified garage', $js);
        self::assertStringContainsString('intro + pricingWarning + UI.kv(', $js);
        self::assertStringContainsString("'Routes.rate_enter'", $js);
        self::assertStringContainsString("'Routes.pricing_estimate'", $js);
    }

    public function testRouteRequestUsesOnlySharedVerifiedGarageConfiguration():void {
        $root=dirname(__DIR__,2);
        $js=file_get_contents($root.'/public/assets/js/modules/operations/routes.js');
        $routes=file_get_contents($root.'/backend/Modules/Operations/Routes.php');
        $pricing=file_get_contents($root.'/backend/Core/TripPricing.php');
        self::assertIsString($js);
        self::assertIsString($routes);
        self::assertIsString($pricing);
        self::assertStringNotContainsString('[14.126449, 121.070384]', $js);
        self::assertStringContainsString('if (!garage) return;', $js);
        self::assertStringContainsString('Garage not verified', $js);
        self::assertStringContainsString('Garage entrance is not verified', $js);
        self::assertStringContainsString('garage?L.latLng(garage):null', $js);
        self::assertStringContainsString('const garage=validGarage?', $js);
        self::assertStringContainsString("Settings::pricingAt(\$p,'garage',date('Y-m-d'))", $routes);
        self::assertStringContainsString("Settings::pricingAt(\$p,\$key,\$at)", $pricing);
        self::assertStringContainsString('Financial amounts are calculated by the backend', $js);
    }

    public function testVerifiedGarageCanBeConfiguredByHeadManagementWithoutSampleCoordinates():void {
        $root=dirname(__DIR__,2);
        $ui=file_get_contents($root.'/public/assets/js/modules/administration/admin.js');
        $settings=file_get_contents($root.'/backend/Core/Settings.php');
        self::assertIsString($ui);
        self::assertIsString($settings);
        self::assertStringContainsString("garageEdit(ctx)", $ui);
        self::assertStringContainsString("Verify Garage Entrance", $ui);
        self::assertStringContainsString("setting_key:'garage'", $ui);
        self::assertStringContainsString("'Admin.pricing_save'", $ui);
        self::assertStringContainsString("value:'garage',label:'Company Garage'", $ui);
        self::assertStringContainsString("['diesel','garage',...TRUCK_TYPES]", $settings);
        self::assertStringContainsString("must((\$d['verified']??null)==='1'", $settings);
        self::assertStringNotContainsString('[14.126449, 121.070384]', $ui);
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
