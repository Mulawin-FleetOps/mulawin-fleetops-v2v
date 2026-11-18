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

    public function testInvalidDatesAreRejected(): void {
        $this->expectException(BusinessRuleException::class);
        self::expiry('2027-02-30', 12);
    }
}
