<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
final class ValidationTest extends TestCase {
    public static function invalidMoney(): iterable {
        foreach (['', '-1', '0', '1.001', '1e3', 'NaN', '10000000000', 'abc'] as $value) yield 'amount:' . $value => [$value];
    }
    #[DataProvider('invalidMoney')]
    public function testInvalidPaymentAmountsAreRejected(string $value): void {
        $this->expectException(BusinessRuleException::class);
        moneyField(['amount'=>$value], 'amount');
    }
    public function testMoneyNormalizationAndOptionalZero(): void {
        self::assertSame('1234.50', moneyField(['amount'=>'1,234.5'], 'amount'));
        self::assertSame('0.00', moneyField(['amount'=>'0'], 'amount', true));
        self::assertNull(optMoney([], 'amount'));
    }
    public static function invalidQuantities(): iterable {
        foreach ([-1, '1.5', '1e3', MAX_QUANTITY+1] as $v) yield (string)$v => [$v];
    }
    #[DataProvider('invalidQuantities')]
    public function testInventoryQuantityBounds(mixed $value): void {
        $this->expectException(BusinessRuleException::class);
        intField(['quantity'=>$value], 'quantity', 0, true, MAX_QUANTITY);
    }
    public static function paymentCases(): iterable {
        yield 'cheque without cheque number' => ['Cheque', ['bank_name'=>'Bank']];
        yield 'cheque without bank' => ['Cheque', ['cheque_number'=>'123']];
        yield 'transfer without reference' => ['Bank Transfer', []];
        yield 'wallet without reference' => ['E-wallet', []];
        yield 'unsupported method' => ['Crypto', []];
    }
    #[DataProvider('paymentCases')]
    public function testIncompletePaymentDetails(string $method, array $fields): void {
        core('Money'); $this->expectException(BusinessRuleException::class);
        Money::paymentFields($fields + ['payment_method'=>$method, 'released_on'=>date('Y-m-d')]);
    }
    public function testCashPaymentAndFutureDateRestriction(): void {
        core('Money');
        self::assertSame('Cash', Money::paymentFields(['payment_method'=>'Cash','released_on'=>date('Y-m-d')])['payment_method']);
        $this->expectException(BusinessRuleException::class);
        Money::paymentFields(['payment_method'=>'Cash','released_on'=>date('Y-m-d', time()+86400)]);
    }
    public function testPastTripScheduleRejected(): void {
        $this->expectException(BusinessRuleException::class);
        futureDateTimeField(['schedule'=>date('Y-m-d\TH:i', time()-3600)], 'schedule');
    }
    public function testScheduleBeyondMaximumRejected(): void {
        $this->expectException(BusinessRuleException::class);
        futureDateTimeField(['schedule'=>date('Y-m-d\TH:i', time()+367*86400)], 'schedule');
    }
    public static function impossibleDates(): iterable {
        foreach (['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','2026-1-01'] as $value) yield $value => [$value];
    }
    #[DataProvider('impossibleDates')]
    public function testInvalidCalendarDateRejected(string $value): void {
        $this->expectException(BusinessRuleException::class); dateField(['date'=>$value],'date');
    }
    public static function impossibleTimes(): iterable {
        foreach (['2026-02-30T12:00','2026-11-10T24:00','2026-11-10T12:60','2026-11-10 25:00:00'] as $value) yield $value => [$value];
    }
    #[DataProvider('impossibleTimes')]
    public function testInvalidCalendarScheduleRejected(string $value): void {
        $this->expectException(BusinessRuleException::class); dateTimeField(['at'=>$value],'at');
    }
    public function testValidLeapDayAndSchedule(): void {
        self::assertSame('2028-02-29', dateField(['date'=>'2028-02-29'],'date'));
        self::assertSame('2028-02-29 23:59:00', dateTimeField(['at'=>'2028-02-29T23:59'],'at'));
        self::assertSame('2028-02-29 23:59:01', dateTimeField(['at'=>'2028-02-29 23:59:01'],'at'));
    }
}
