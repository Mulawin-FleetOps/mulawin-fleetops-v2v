<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PartWarrantyTest extends TestCase {
    private static function expiry(string $date, int $months): string {
        require_once dirname((new ReflectionClass(Actions::class))->getFileName())
            . '/Modules/Maintenance/Purchasing.php';
        $method = new ReflectionMethod(Purchasing::class, 'warrantyExpiry');
        return $method->invoke(null, $date, $months);
    }

    public static function dates(): iterable {
        yield 'regular' => ['2026-11-18', 12, '2027-11-18'];
        yield 'short-February' => ['2027-01-31', 1, '2027-02-28'];
        yield 'leap-year' => ['2028-01-31', 1, '2028-02-29'];
        yield 'leap-anniversary' => ['2028-02-29', 12, '2029-02-28'];
        yield 'year-boundary' => ['2026-12-31', 2, '2027-02-28'];
    }

    #[DataProvider('dates')]
    public function testMonthEndIsClamped(string $start, int $months, string $expected): void {
        self::assertSame($expected, self::expiry($start, $months));
    }

    private static function coverage(array $data): array {
        require_once dirname((new ReflectionClass(Actions::class))->getFileName())
            . '/Modules/Maintenance/Purchasing.php';
        return (new ReflectionMethod(Purchasing::class, 'warrantyData'))->invoke(null, $data);
    }

    public function testUnconfirmedReceiptHasNoInventedExpiry(): void {
        $data = self::coverage(['status'=>'Not Yet Confirmed']);
        self::assertNull($data['warranty_expires']);
        self::assertNull($data['warranty_start']);
        self::assertNull($data['warranty_months']);
    }

    public function testNoWarrantyHasNoExpiry(): void {
        self::assertNull(self::coverage(['status'=>'No Warranty'])['warranty_expires']);
    }

    public function testConfirmedWarrantyUsesSupplierDate(): void {
        $data = self::coverage(['status'=>'With Warranty', 'start_basis'=>'Invoice',
            'start'=>'2028-01-31', 'months'=>1]);
        self::assertSame('2028-02-29', $data['warranty_expires']);
        self::assertSame('Invoice', $data['start_basis']);
    }

    public function testMissingConfirmedWarrantyDateRejected(): void {
        $this->expectException(BusinessRuleException::class);
        self::coverage(['status'=>'With Warranty','start_basis'=>'Delivery','months'=>12]);
    }

    public function testInvalidStatusRejected(): void {
        $this->expectException(BusinessRuleException::class);
        self::coverage(['status'=>'unknown']);
    }

    public function testInvalidDatesAreRejected(): void {
        $this->expectException(BusinessRuleException::class);
        self::expiry('2027-02-30', 12);
    }
}
