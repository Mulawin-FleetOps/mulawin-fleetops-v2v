<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Pure validation and real authorization guards; the unit bootstrap disables database access. */
final class RouteSafetyTest extends TestCase {
    protected function setUp(): void {
        Actions::load('Routes');
    }

    public static function deniedActions(): iterable {
        yield 'dispatcher cannot request a master route' => ['container_wingvan_dispatcher', 'request'];
        yield 'billing cannot edit fixed contractual rates' => ['billing','rate_enter'];
        yield 'billing cannot request a master route' => ['billing', 'request'];
        yield 'operations cannot enter contractual rates' => ['operations_head', 'rate_enter'];
        yield 'operations cannot approve rates' => ['operations_head', 'decide'];
        yield 'billing cannot approve its own workflow' => ['billing', 'decide'];
        yield 'operations cannot deactivate approved routes' => ['operations_head', 'deactivate'];
        yield 'dispatcher cannot read master route details' => ['car_carrier_dispatcher', 'details'];
    }

    #[DataProvider('deniedActions')]
    public function testRoutePermissionsRejectBeforeDatabaseAccess(string $role, string $action): void {
        try {
            Routes::action(['id' => 1, 'role' => $role], $action, []);
            self::fail('Unauthorized route action succeeded.');
        } catch (BusinessRuleException $error) {
            self::assertSame(403, $error->httpStatus);
        }
    }

    public function testDuplicateNormalizationPreservesDirectionalPlaceKeys(): void {
        self::assertSame('TANAUAN BATANGAS', Routes::normalize(' Tanauan,  Batangas '));
        self::assertSame('SANTO TOMÁS', Routes::normalize('Santo—Tomás'));
        self::assertNotSame(Routes::normalize('Tanauan'), Routes::normalize('Tanauan City'));
    }

    public function testTypedDistanceWithoutPinsUsesManualMetadata(): void {
        $result = RouteDistance::resolve(1, [], 25.0, null, null);
        self::assertSame(25.0, $result['km']);
        self::assertSame('Manual', $result['cols']['distance_source']);
        self::assertNull($result['cols']['route_option']);
    }

    public function testUnknownInternalRouteOptionIsRejectedEvenWithoutPins(): void {
        $this->expectException(BusinessRuleException::class);
        RouteDistance::resolve(1, ['route_option' => 'not-a-route-option'], 25.0, null, null);
    }

    public function testComputedDistanceOverrideRequiresAReason(): void {
        $override = new ReflectionMethod(RouteDistance::class, 'override');
        $this->expectException(BusinessRuleException::class);
        $this->expectExceptionMessage('Give the reason');
        $override->invoke(null, [], 65.0, 50.0, 'the computed road distance');
    }

    public function testDocumentedOverrideKeepsTheExistingWarningThreshold(): void {
        $override = new ReflectionMethod(RouteDistance::class, 'override');
        [$reason, $warning] = $override->invoke(null, ['distance_override_reason' => 'Verified access restriction'], 65.0, 50.0, 'the computed road distance');
        self::assertSame('Verified access restriction', $reason);
        self::assertStringContainsString('15%', $warning);
        self::assertSame([null, ''], $override->invoke(null, [], 50.0, 50.0, 'the computed road distance'));
    }
}
