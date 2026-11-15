<?php
declare(strict_types=1);
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/../_launcher.php';
final class DatabaseSafetyTest extends TestCase {
    public static function destructiveHelpers(): iterable {
        foreach (['test_recreate','test_drop','test_conn'] as $helper) foreach (['development','production_test','unknown_test'] as $name) yield "$helper:$name" => [$helper,$name];
    }
    #[DataProvider('destructiveHelpers')]
    public function testSuffixCannotAuthorizeDatabaseAccess(string $helper,string $name): void {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('no valid temporary isolation manifest');
        $helper($name);
    }
    public function testServerConnectionRequiresManifest(): void {
        $this->expectException(RuntimeException::class);
        test_server();
    }
}
