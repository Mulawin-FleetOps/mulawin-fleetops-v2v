<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Access is lazily loaded by the application; load it explicitly for unit tests.
core('Access');

final class HeadManagementNavigationTest extends TestCase {
    public function testAdminReceivesExecutiveSidebarInBusinessWorkflowOrder(): void {
        $nav=Access::navFor(['role'=>'admin']);
        self::assertSame([
            'dashboard','trips','head-fleet','maintenance','clients','routes',
            'finance','billing','fuel-adjustment','head-approvals','reports','admin','head-settings',
        ],array_column($nav,'id'));
        self::assertSame('Executive Dashboard',$nav[0]['label']);
        self::assertSame('Client Management',$nav[4]['label']);
        self::assertSame('System Configuration',$nav[12]['label']);
        self::assertSame('Operations Oversight',$nav[2]['section']);
        self::assertSame('Client & Commercial',$nav[4]['section']);
        self::assertSame('Financial Oversight',$nav[6]['section']);
        self::assertSame('Management Control',$nav[9]['section']);
    }

    public function testBrowserShellUsesRoleSpecificExecutiveNavigationAndLoadsOverviewScreens(): void {
        $core = file_get_contents(dirname(__DIR__, 2).'/public/assets/js/core.js');
        $index = file_get_contents(dirname(__DIR__, 2).'/public/index.php');
        self::assertIsString($core);
        self::assertIsString($index);
        self::assertStringContainsString("if (u.role === 'admin')", $core);
        self::assertStringContainsString("item.section !== section", $core);
        self::assertStringContainsString("UI.esc(item.label)", $core);
        self::assertStringContainsString("'administration/head-management'", $index);
    }

    public function testOversightPagesAreAdminOnly(): void {
        foreach(['head-fleet','head-approvals','head-settings'] as $page) {
            self::assertTrue(Access::canOpen(['role'=>'admin'],$page));
            foreach(['operations_head','motorpool','finance','billing','audit'] as $role)
                self::assertFalse(Access::canOpen(['role'=>$role],$page));
        }
        self::assertFalse(Access::canOpen(['role'=>'operations_head'],'clients'));
        self::assertTrue(Access::canOpen(['role'=>'admin'],'clients'));
    }

    public function testHeadManagementOversightRejectsDirectMutations(): void {
        Actions::load('HeadManagement');
        try {
            HeadManagement::action(['role'=>'admin','id'=>1],'change',[]);
            self::fail('Oversight mutation unexpectedly permitted.');
        } catch (BusinessRuleException $e) {
            self::assertSame(403,$e->httpStatus);
        }
    }

    public function testHeadManagementCannotChangeDepartmentMasterData(): void {
        Actions::load('Fleet');
        Actions::load('Mechanics');
        foreach([
            fn()=>Fleet::action(['id'=>1,'role'=>'admin'],'truck_save',[]),
            fn()=>Fleet::action(['id'=>1,'role'=>'admin'],'crew_save',[]),
            fn()=>Mechanics::action(['id'=>1,'role'=>'admin'],'save',[]),
        ] as $mutate) {
            try { $mutate(); self::fail('Department master data was editable by Head Management.'); }
            catch (BusinessRuleException $e) { self::assertSame(403,$e->httpStatus); }
        }
    }
}
