<?php

use PHPUnit\Framework\TestCase;

final class EnvironmentTest extends TestCase
{
    public function testPhpVersionIsSupported(): void
    {
        $this->assertGreaterThanOrEqual(80200, PHP_VERSION_ID);
    }

    public function testRequiredPhpExtensionsAreLoaded(): void
    {
        foreach (['pdo', 'json', 'mbstring'] as $extension) {
            $this->assertTrue(
                extension_loaded($extension),
                "Missing PHP extension: {$extension}"
            );
        }
    }
}
