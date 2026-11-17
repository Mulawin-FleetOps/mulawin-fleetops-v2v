<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** No database or network: exercise the real response classifier with provider/transport fixtures. */
final class RoutingDiagnosticsTest extends TestCase {
    private string $log;
    private string $previousLog;

    protected function setUp(): void {
        core('Routing');
        $this->previousLog = (string)ini_get('error_log');
        $this->log = tempnam(sys_get_temp_dir(), 'routing_diagnostics_');
        ini_set('error_log', $this->log);
    }

    protected function tearDown(): void {
        ini_set('error_log', $this->previousLog);
        unlink($this->log);
    }

    public static function failures(): iterable {
        yield 'DNS host' => [0, '', ['curl_errno' => 6], 'dns'];
        yield 'DNS proxy' => [0, '', ['curl_errno' => 5], 'dns'];
        yield 'connection timeout' => [0, '', ['curl_errno' => 28, 'connect_ms' => 0], 'connect_timeout'];
        yield 'response timeout' => [0, '', ['curl_errno' => 28, 'connect_ms' => 150], 'timeout'];
        yield 'untrusted certificate' => [0, '', ['curl_errno' => 60], 'ssl_certificate'];
        yield 'missing CA bundle' => [0, '', ['curl_errno' => 77], 'ssl_certificate'];
        yield 'issuer validation' => [0, '', ['curl_errno' => 83], 'ssl_certificate'];
        yield 'TLS handshake' => [0, '', ['curl_errno' => 35], 'tls'];
        foreach ([61, 111, 10061] as $os) yield "connection refused $os" => [0, '', ['curl_errno' => 7, 'os_errno' => $os], 'connection_refused'];
        yield 'unreachable connection' => [0, '', ['curl_errno' => 7], 'connection_failed'];
        yield 'other network failure' => [0, '', [], 'network'];
        yield 'invalid key' => [401, '{"error":"Unauthorized"}', [], 'refused'];
        yield 'account or quota denied' => [403, '{"error":"Forbidden"}', [], 'refused'];
        yield 'rate limit' => [429, '{}', [], 'rate_limited'];
        yield 'provider unavailable' => [503, '<html>Unavailable</html>', [], 'provider_error'];
        yield 'malformed JSON' => [200, 'not JSON', [], 'invalid_response'];
        yield 'wrong response shape' => [200, '{}', [], 'invalid_response'];
        yield 'wrong routes type' => [200, '{"routes":"invalid"}', [], 'invalid_response'];
        yield 'endpoint missing' => [404, '{}', [], 'endpoint'];
        yield 'pin off road' => [404, '{"error":{"code":2010}}', [], 'not_near_road'];
        yield 'route too long' => [400, '{"error":{"code":2004}}', [], 'too_long'];
        yield 'no road route' => [404, '{"error":{"code":2009}}', [], 'no_route'];
    }

    #[DataProvider('failures')]
    public function testFailureCategoryAndManualFallback(int $status, string $body, array $diagnostics, string $reason): void {
        try {
            (new ReflectionMethod(Routing::class, 'response'))->invoke(null, 'route', $status, $body, $diagnostics);
            self::fail('Failure was accepted.');
        } catch (RoutingUnavailable $error) {
            self::assertSame($reason, $error->reason);
            self::assertStringContainsString('type the km', strtolower($error->getMessage()));
            $log = file_get_contents($this->log);
            self::assertStringContainsString("HTTP $status", $log);
            self::assertStringContainsString("reason $reason", $log);
        }
    }

    public function testProviderDataAndRawTransportErrorsCannotLeakIntoLogs(): void {
        $secret = 'PRIVATE-KEY-AND-ADDRESS';
        try {
            (new ReflectionMethod(Routing::class, 'response'))->invoke(null, 'search', 0, $secret,
                ['curl_errno' => 60, 'curl_error' => $secret, 'url' => $secret, 'elapsed_ms' => 1250, 'ssl_verify_result' => 20]);
        } catch (RoutingUnavailable $error) {
            self::assertStringNotContainsString($secret, $error->getMessage());
        }
        $log = file_get_contents($this->log);
        self::assertStringNotContainsString($secret, $log);
        self::assertStringContainsString('"curl_errno":60', $log);
        self::assertStringContainsString('"curl_error":', $log);
        self::assertStringContainsString('"elapsed_ms":1250', $log);
    }

    public function testValidProviderResponsesRemainIntact(): void {
        $response = new ReflectionMethod(Routing::class, 'response');
        foreach (['search', 'reverse'] as $service) {
            $body = ['features' => [['geometry' => ['coordinates' => [121.1497, 14.0863]], 'properties' => ['label' => 'Tanauan, Philippines']]]];
            self::assertSame($body, $response->invoke(null, $service, 200, json_encode($body)));
            self::assertSame(['features' => []], $response->invoke(null, $service, 200, '{"features":[]}'));
        }
        $route = ['routes' => [['summary' => ['distance' => 4937.7], 'geometry' => 'encodedLine']]];
        self::assertSame($route, $response->invoke(null, 'route', 200, json_encode($route)));
    }

    public function testMalformedGeocodingIsAnOutageRatherThanAnEmptySearch(): void {
        $this->expectException(RoutingUnavailable::class);
        $this->expectExceptionMessage('invalid response');
        (new ReflectionMethod(Routing::class, 'response'))->invoke(null, 'search', 200, '{"message":"Unavailable"}');
    }
}
