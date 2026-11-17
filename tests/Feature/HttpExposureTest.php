<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;
final class HttpExposureTest extends TestCase {
    public function testPrivatePathsAreBlockedByApache(): void {
        if (!getenv('TEST_BASE_URL')) self::markTestSkipped('Set TEST_BASE_URL to an Apache-hosted application.');
        [$code, $output] = LegacyRunner::run('run_htaccess_tests.php');
        self::assertSame(0, $code, $output);
        self::assertMatchesRegularExpression('/RESULT:\s*\d+ passed, 0 failed/', $output);
    }
}
