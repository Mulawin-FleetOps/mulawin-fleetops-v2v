<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;

/** Regression: MySQL strict mode rejects the zero-datetime comparison in CREATE TABLE CHECK. */
final class TurnoverSchemaTest extends TestCase {
    public function testTurnoverSchemaHasStrictModeSafeAcceptanceConstraint(): void {
        $base = dirname(__DIR__, 2);
        foreach ([
            $base . '/database/migrations/2026-11-12_12_dispatcher_turnover.sql',
            $base . '/database/extension.sql',
        ] as $path) {
            $sql = file_get_contents($path);
            self::assertNotFalse($sql);
            self::assertStringNotContainsString('0000-00-00 00:00:00', $sql, $path);
            self::assertStringContainsString('accepted_at IS NOT NULL', $sql, $path);
            self::assertStringContainsString('accepted_at>=endorsed_at', $sql, $path);
            self::assertStringContainsString('accepted_by=incoming_id', $sql, $path);
        }
    }
}
