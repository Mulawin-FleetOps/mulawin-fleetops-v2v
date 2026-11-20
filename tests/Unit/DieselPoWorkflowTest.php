<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Database-free authorization and migration-contract checks for the Diesel PO workflow. */
final class DieselPoWorkflowTest extends TestCase {
    protected function setUp(): void {
        core('DieselPo');
    }

    public function testOnlyOperationsHeadCanDecideDieselPo(): void {
        foreach (['billing','finance','car_carrier_dispatcher','container_wingvan_dispatcher'] as $role) {
            try {
                DieselPo::decide(['id'=>8,'role'=>$role], ['po_id'=>1,'decision'=>'approve']);
                self::fail('Unauthorized Diesel PO review accepted for '.$role);
            } catch (BusinessRuleException $e) {
                self::assertSame(403,$e->httpStatus);
            }
        }
    }

    public function testOnlyBillingCanRecordPhysicalSoaReceiptOrVerification(): void {
        foreach (['finance','operations_head','car_carrier_dispatcher'] as $role) {
            foreach (['receive','verify'] as $action) {
                try {
                    DieselPo::$action(['id'=>8,'role'=>$role], ['billing_id'=>1]);
                    self::fail('Unauthorized Billing Supplier SOA action '.$action.' accepted for '.$role);
                } catch (BusinessRuleException $e) {
                    self::assertSame(403,$e->httpStatus);
                }
            }
        }
    }

    public function testOnlyDispatchersCanReviseRejectedDieselPo(): void {
        foreach (['finance','billing','operations_head'] as $role) {
            try {
                DieselPo::revise(['id'=>8,'role'=>$role], ['po_id'=>1,'liters'=>'10']);
                self::fail('Unauthorized Diesel PO revision accepted for '.$role);
            } catch (BusinessRuleException $e) {
                self::assertSame(403,$e->httpStatus);
            }
        }
    }

    public function testMigrationIsAdditiveAndNeverRewritesHistoricalFundRequests(): void {
        $sql=file_get_contents(dirname(__DIR__,2).'/database/migrations/2026-11-20_03_diesel_po_soa_workflow.sql');
        self::assertIsString($sql);
        self::assertStringContainsString('CREATE TABLE IF NOT EXISTS diesel_purchase_orders',$sql);
        self::assertStringContainsString('UNIQUE KEY uq_diesel_po_number',$sql);
        self::assertStringNotContainsString('UPDATE fund_requests',$sql);
        self::assertStringNotContainsString('DELETE FROM fund_requests',$sql);
        self::assertStringNotContainsString('DROP TABLE',$sql);
    }
}
