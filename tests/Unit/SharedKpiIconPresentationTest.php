<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class SharedKpiIconPresentationTest extends TestCase {
    public function testSharedMetricCardsRenderSemanticIconsWithoutChangingValues(): void {
        $js=file_get_contents(dirname(__DIR__,2).'/public/assets/js/core.js');
        $css=file_get_contents(dirname(__DIR__,2).'/public/assets/css/app.css');
        self::assertIsString($js);
        self::assertIsString($css);
        self::assertStringContainsString('UI.metricVisual =', $js);
        self::assertStringContainsString('metric-strip-icons', $js);
        self::assertStringContainsString('metric-icon-', $js);
        self::assertStringContainsString('icon: c.icon', $js);
        self::assertStringContainsString('UI.money(c.value)', $js);
        self::assertStringContainsString('UI.canGo(c.go)', $js);
        self::assertStringContainsString('.metric-strip-icons .metric-icon-card', $css);
        self::assertStringContainsString('.metric-strip-icons .metric-icon-blue', $css);
        self::assertStringContainsString('.metric-strip-icons .metric-icon-red', $css);
    }
}
