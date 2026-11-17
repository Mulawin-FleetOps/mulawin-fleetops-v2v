<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
final class LegacySuitesTest extends TestCase {
    public static function suites(): iterable {
        foreach (glob(__DIR__ . '/../run_*_tests.php') ?: [] as $file) {
            if (basename($file) !== 'run_htaccess_tests.php') yield basename($file) => [basename($file)];
        }
    }
    #[DataProvider('suites')]
    public function testLegacySuite(string $script): void {
        if (getenv('FLEETOPS_DB_TESTS') !== '1') self::markTestSkipped('Set FLEETOPS_DB_TESTS=1 to enable disposable local database tests.');
        if (!getenv('TEST_DB_USER') || getenv('TEST_DB_PASS') === false) self::markTestSkipped('Explicit TEST_DB_USER and TEST_DB_PASS required; application credentials are never used.');
        if (!extension_loaded('pdo_mysql')) self::markTestSkipped('pdo_mysql is required.');
        [$code, $output] = LegacyRunner::run($script);
        self::assertSame(0, $code, $output);
        self::assertMatchesRegularExpression('/RESULT:\s*\d+ passed, 0 failed/', $output, 'Missing successful legacy summary: ' . $output);
    }
}
