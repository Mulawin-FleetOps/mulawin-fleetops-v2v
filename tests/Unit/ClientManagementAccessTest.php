<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Access is lazily loaded by the application; load it explicitly for unit tests.
core('Access');

/** Client Masterlist ownership: Admin/Head Management, not Operations Head. */
final class ClientManagementAccessTest extends TestCase {
    public function testHeadManagementOwnsClientMasterlistNavigation(): void {
        self::assertTrue(Access::canOpen(['role'=>'admin'], 'clients'));
        self::assertFalse(Access::canOpen(['role'=>'operations_head'], 'clients'));
        self::assertContains('clients', array_column(Access::navFor(['role'=>'admin']), 'id'));
        self::assertNotContains('clients', array_column(Access::navFor(['role'=>'operations_head']), 'id'));
        // Operations Head still needs Trip Management to plan against approved routes.
        self::assertTrue(Access::canOpen(['role'=>'operations_head'], 'trips'));
        self::assertTrue(Access::canOpen(['role'=>'operations_head'], 'routes'));
    }

    public function testOperationsHeadCannotMutateClientRecordsUsingDirectApi(): void {
        Actions::load('Clients');
        foreach (['create','update','documents','set_active'] as $action) {
            try {
                Clients::action(['id'=>1,'role'=>'operations_head'],$action,[]);
                self::fail('Operations Head unexpectedly performed Clients.'.$action);
            } catch (BusinessRuleException $e) {
                self::assertSame(403, $e->httpStatus, $action);
            }
        }
    }
}
