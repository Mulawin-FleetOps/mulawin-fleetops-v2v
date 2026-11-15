<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
final class AuthorizationTest extends TestCase {
    public static function deniedActions(): iterable {
        $groups = [
            'Maintenance'=>['motorpool'=>['report','assign_mechanic','assess','inspect','add_cost','complete','verify','cancel']],
            'Purchasing'=>['purchasing'=>['part_save','adjust','request_process','po_create','po_receive','po_close'], 'motorpool'=>['request_create','request_cancel']],
            'Finance'=>['finance'=>['po_pay','payable_add','payable_pay','expense_add','budget_set']],
            'Billing'=>['billing'=>['charge_add','charge_change','charge_remove','charge_withdraw','verify','finalize','collect'], 'admin'=>['charge_decide']],
        ];
        foreach ($groups as $module=>$roles) foreach ($roles as $allowed=>$actions) foreach ($actions as $action) foreach (array_keys(ROLE_LABELS) as $role) {
            if ($role !== $allowed) yield "$module.$action denied for $role" => [$module,$action,$role];
        }
    }
    #[DataProvider('deniedActions')]
    public function testUnauthorizedMutationRejectedBeforeDatabaseAccess(string $module,string $action,string $role): void {
        Actions::load($module);
        try { $module::action(['id'=>1,'role'=>$role],$action,[]); self::fail('Unauthorized action succeeded.'); }
        catch (BusinessRuleException $e) { self::assertSame(403,$e->httpStatus,$e->getMessage()); }
    }
}
