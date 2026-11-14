<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Access is lazily loaded by the application; load it explicitly for unit tests.
core('Access');

final class HeadManagementNavigationTest extends TestCase {
    public function testAdminReceivesExecutiveSidebarInBusinessWorkflowOrder(): void {
        $nav=Access::navFor(['role'=>'admin']);
        self::assertSame([
            'dashboard','head-trips','head-fleet','maintenance','clients','routes',
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
        self::assertStringContainsString('class="head-nav-group"', $core);
        self::assertStringContainsString('head-nav-items', $core);
        self::assertStringContainsString('if (headGroup) headGroup.open = true', $core);
        self::assertStringContainsString('Head Management', file_get_contents(dirname(__DIR__,2).'/public/assets/css/layout.css') ?: '');
        self::assertStringContainsString("'administration/head-management'", $index);
    }

    public function testOversightPagesAreAdminOnly(): void {
        foreach(['head-trips','head-fleet','head-approvals','head-settings'] as $page) {
            self::assertTrue(Access::canOpen(['role'=>'admin'],$page));
            foreach(['operations_head','motorpool','finance','billing','audit'] as $role)
                self::assertFalse(Access::canOpen(['role'=>$role],$page));
        }
        self::assertFalse(Access::canOpen(['role'=>'operations_head'],'clients'));
        self::assertTrue(Access::canOpen(['role'=>'admin'],'clients'));
    }

    public function testDedicatedHeadTripPageUsesSharedComponents(): void {
        $code = file_get_contents(dirname(__DIR__, 2).'/public/assets/js/modules/administration/head-management.js');
        self::assertIsString($code);
        self::assertStringContainsString("App.page('head-trips'", $code);
        self::assertStringContainsString('head-trip-kpis', $code);
        self::assertStringContainsString('head-kpi-icon', $code);
        self::assertStringContainsString('UI.tabs(', $code);
        self::assertStringContainsString('UI.table(', $code);
        self::assertStringContainsString('UI.drawer(', $code);
        self::assertStringContainsString('HeadManagement.trip_details', $code);
        self::assertStringContainsString('UI.chartHtml(', $code);
        self::assertStringContainsString('UI.routeMap(', $code);
        self::assertStringContainsString('data-head-export', $code);
        self::assertStringContainsString('data-head-date', $code);
        self::assertStringContainsString('RecordComponents.bindDropdowns(', $code);
        self::assertStringContainsString('data-head-search', $code);
        self::assertStringContainsString('data-head-filter-count', $code);
        self::assertStringContainsString('HeadOversight.mount(ctx.el', $code);
        self::assertStringContainsString('data-head-panel-table', $code);
        self::assertStringContainsString('head-monitor-header', $code);
        self::assertStringContainsString('record-workspace-sort-trigger', $code);
        self::assertStringContainsString('this.finishTable(slot)', $code);
        self::assertStringContainsString('UI.recordPager(', $code);
        self::assertStringContainsString('Reported Trip Incidents', $code);
        self::assertStringContainsString('Saved road geometry only', $code);
        $backend = file_get_contents(dirname(__DIR__, 2).'/backend/Modules/Administration/HeadManagement.php');
        self::assertStringContainsString('route_preview', $backend);
        self::assertStringContainsString('JOIN trip_routes r', $backend);
    }

    public function testFleetWorkspaceUsesSingleTabbedReadOnlyTableAndRealAggregates(): void {
        $root = dirname(__DIR__, 2);
        $js = file_get_contents($root.'/public/assets/js/modules/administration/head-management.js');
        $php = file_get_contents($root.'/backend/Modules/Administration/HeadManagement.php');
        $css = file_get_contents($root.'/public/assets/css/layout.css');
        self::assertIsString($js);
        self::assertIsString($php);
        self::assertIsString($css);
        self::assertStringContainsString('const HeadFleetWorkspace =', $js);
        self::assertStringContainsString('data-head-fleet-tab', $js);
        self::assertStringContainsString('data-head-fleet-table', $js);
        self::assertStringContainsString('HeadOversight.mount(container', $js);
        self::assertStringContainsString('data-head-fleet-kpi', $js);
        self::assertStringContainsString('fleet_summary', $php);
        self::assertStringContainsString('COUNT(*) FROM vehicles', $php);
        self::assertStringContainsString('COUNT(*) FROM personnel', $php);
        self::assertStringContainsString('.head-fleet-tabs', $css);
        self::assertStringContainsString('.head-fleet-kpi', $css);
        self::assertStringNotContainsString("App.api('Fleet.", $js);
    }

    public function testHeadMaintenanceUsesReadOnlyTabbedWorkspace(): void {
        $root=dirname(__DIR__,2);
        $js=file_get_contents($root.'/public/assets/js/modules/maintenance/maintenance.js');
        $css=file_get_contents($root.'/public/assets/css/layout.css');
        self::assertIsString($js);
        self::assertIsString($css);
        self::assertStringContainsString('const HeadMaintenanceUI =', $js);
        self::assertStringContainsString("App.me?.user?.role === 'admin'", $js);
        self::assertStringContainsString('HeadMaintenanceUI.render(ctx,d,jobs)', $js);
        self::assertStringContainsString('data-head-maintenance-tab', $js);
        self::assertStringContainsString('data-head-maintenance-export', $js);
        self::assertStringContainsString('RecordComponents.bindDropdowns(panel', $js);
        self::assertStringContainsString('.head-maintenance-workspace', $css);
        self::assertStringContainsString("if (d.can.act) UI.tool(ctx, 'Report truck problem'", $js);
    }

    public function testHeadRouteRatesHaveExecutiveWorkspaceAndKeepApprovalActions(): void {
        $root=dirname(__DIR__,2);
        $code=file_get_contents($root.'/public/assets/js/modules/operations/routes.js');
        $css=file_get_contents($root.'/public/assets/css/layout.css');
        self::assertIsString($code);
        self::assertIsString($css);
        self::assertStringContainsString('const HeadRouteWorkspace =', $code);
        self::assertStringContainsString("App.me?.user?.role === 'admin'", $code);
        self::assertStringContainsString('data-head-route-tab', $code);
        self::assertStringContainsString('data-head-route-client', $code);
        self::assertStringContainsString('data-head-route-export', $code);
        self::assertStringContainsString('RecordComponents.bindDropdowns(root', $code);
        self::assertStringContainsString("d.can.approve&&r.pending_rate_id", $code);
        self::assertStringContainsString("RouteUI.open(r.id,d)", $code);
        self::assertStringContainsString('Routes.decide', $code);
        self::assertStringContainsString('.head-route-workspace', $css);
    }

    public function testHeadTripDetailsRejectOtherRolesWithoutDatabaseAccess(): void {
        Actions::load('HeadManagement');
        foreach (['operations_head','billing','finance','audit'] as $role) {
            try {
                HeadManagement::action(['id'=>1,'role'=>$role],'trip_details',['trip_id'=>1]);
                self::fail('Unauthorized trip monitoring detail access.');
            } catch (BusinessRuleException $e) {
                self::assertSame(403, $e->httpStatus);
            }
        }
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
