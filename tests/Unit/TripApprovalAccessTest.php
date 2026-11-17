<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Exercise real role checks without connecting to a database. */
final class TripApprovalAccessTest extends TestCase {
    public static function nonOperationsRoles(): iterable {
        foreach (array_keys(ROLE_LABELS) as $role) {
            if ($role !== 'operations_head') yield $role => [$role];
        }
    }

    #[DataProvider('nonOperationsRoles')]
    public function testApprovalReadIsDeniedBeforeDatabaseAccess(string $role): void {
        Actions::load('Trips');
        try { Trips::read(['id' => 1, 'role' => $role], 'trips', ['view' => 'approvals']); self::fail('Unauthorized approval read succeeded.'); }
        catch (BusinessRuleException $e) { self::assertSame(403, $e->httpStatus); }
    }

    #[DataProvider('nonOperationsRoles')]
    public function testApprovalDecisionIsDeniedBeforeDatabaseAccess(string $role): void {
        Actions::load('Trips');
        foreach (['approve', 'reject'] as $decision) {
            try { Trips::action(['id' => 1, 'role' => $role], 'review', ['trip_id' => 1, 'decision' => $decision]); self::fail('Unauthorized review succeeded.'); }
            catch (BusinessRuleException $e) { self::assertSame(403, $e->httpStatus); }
        }
    }

    public function testOperationsHeadCannotMutateMechanics(): void {
        Actions::load('Mechanics');
        foreach (['save', 'availability', 'set_active'] as $action) {
            try { Mechanics::action(['id' => 1, 'role' => 'operations_head'], $action, []); self::fail('Unauthorized mechanic action succeeded.'); }
            catch (BusinessRuleException $e) { self::assertSame(403, $e->httpStatus); }
        }
    }

    public function testExistingMaintenancePolicyIsPreserved(): void {
        core('Access');
        foreach (['mechanics', 'maintenance'] as $page) {
            self::assertTrue(Access::canOpen(['role' => 'motorpool'], $page));
            // Existing read-only Operations Head access is deliberately not silently revoked by navigation cleanup.
            self::assertTrue(Access::canOpen(['role' => 'operations_head'], $page));
            self::assertFalse(Access::canOpen(['role' => 'car_carrier_dispatcher'], $page));
        }
    }

    public function testApprovalFiltersRejectInvalidRequestDateRange(): void {
        Actions::load('Trips');
        $filters = new ReflectionMethod(Trips::class, 'approvalFilters');
        $this->expectException(BusinessRuleException::class);
        $this->expectExceptionMessage('start must not be after the end');
        $filters->invoke(null, ['request_from' => '2026-11-12', 'request_to' => '2026-11-10']);
    }
}
