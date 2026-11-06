<?php
/*
 * =====================================================================
 *  backend/Core/Routing.php  —  ROAD DISTANCE AND ADDRESS SEARCH (Checklist #5)
 * =====================================================================
 *  Provider: openrouteservice (ORS, by HeiGIT), called ONLY from this server.
 *  The API key stays in .env (ORS_API_KEY) and is never sent to the browser.
 *
 *    route()    road distance (km), travel time and the route line between two points
 *    search()   address search in the Philippines (ORS geocoding)
 *    reverse()  address of a map point (ORS reverse geocoding)
 *
 *  SAFE FALLBACK: when the key is missing, the quota is used up or ORS does not
 *  answer, a RoutingUnavailable exception with a clear message is thrown and the
 *  screens keep working with the km typed by hand.
 *
 *  PROTECTION OF THE FREE QUOTA (ORS Standard plan: 2,000 directions and 1,000
 *  geocoding / reverse per day):
 *    - results are cached in map_cache (same points + option = no new call),
 *    - daily guard per service in map_api_usage (stops below the ORS quota),
 *    - per-user limit per minute in map_user_usage.
 *
 *  ROUTE OPTIONS (implementation defaults; the company still has to confirm the toll policy):
 *    recommended   = expressways and toll roads allowed
 *    avoid_tolls   = ORS avoid_features: tollways
 *    general_roads = ORS avoid_features: highways + tollways (no expressways, no toll roads)
 * =====================================================================
 */
declare(strict_types=1);

/** The map service cannot answer now; the caller falls back to manual km. */
final class RoutingUnavailable extends RuntimeException {
    public function __construct(string $message, public readonly string $reason = 'unavailable') { parent::__construct($message); }
}

final class Routing {
    public const OPTIONS = [
        'recommended'   => ['label' => 'Recommended (expressways and toll roads allowed)', 'avoid' => []],
        'avoid_tolls'   => ['label' => 'Avoid toll roads', 'avoid' => ['tollways']],
        'general_roads' => ['label' => 'General roads only (no expressways or toll roads)', 'avoid' => ['highways', 'tollways']],
    ];
    public const DEFAULT_OPTION = 'recommended';
    public const PROFILES = ['driving-hgv', 'driving-car'];
    /** Philippine bounding box (same as Trips and Routes). */
    public const PH_LAT = [4.0, 21.5];
    public const PH_LNG = [116.0, 127.5];
    public const CACHE_DAYS = 30;
    private const SERVICES = ['route', 'search', 'reverse'];
    private const DAILY_DEFAULTS = ['route' => 1800, 'search' => 900, 'reverse' => 900];

    /** Test hook only (APP_ENV=test): fn(string $method, string $url, array $headers, ?string $body): array [status, body] */
    private static $transport = null;
    public static int $outboundCalls = 0;

    public static function useTransport(?callable $fn): void {
        if (envValue('APP_ENV') !== 'test') throw new LogicException('Routing transport can only be replaced in tests.');
        self::$transport = $fn;
    }
    /** Test hook only (APP_ENV=test): overrides ORS_* / MAP_USER_PER_MINUTE settings without editing .env. */
    private static array $override = [];
    public static function testConfig(array $values): void {
        if (envValue('APP_ENV') !== 'test') throw new LogicException('Routing settings can only be overridden in tests.');
        self::$override = $values;
    }
    private static function env(string $key, string $default = ''): string {
        return array_key_exists($key, self::$override) ? (string)self::$override[$key] : envValue($key, $default);
    }

    // -----------------------------------------------------------------
    // configuration (never returns the key)
    // -----------------------------------------------------------------
    public static function configured(): bool { return trim(self::env('ORS_API_KEY')) !== ''; }

    public static function profile(): string {
        $p = self::env('ORS_PROFILE', 'driving-hgv');
        return in_array($p, self::PROFILES, true) ? $p : 'driving-hgv';
    }
    public static function providerName(): string { return 'openrouteservice/' . self::profile(); }

    /**
     * Base URL from .env only (never from the request). HTTPS is required; plain http is
     * accepted only for 127.0.0.1 / localhost while APP_ENV=test (local mock server).
     */
    private static function baseUrl(): string {
        $u = rtrim(self::env('ORS_BASE_URL', 'https://api.heigit.org') ?: 'https://api.heigit.org', '/');
        $parts = parse_url($u);
        $ok = is_array($parts) && isset($parts['scheme'], $parts['host']) && !isset($parts['user']) && !isset($parts['query'])
            && ($parts['scheme'] === 'https'
                || ($parts['scheme'] === 'http' && in_array($parts['host'], ['127.0.0.1', 'localhost'], true) && envValue('APP_ENV') === 'test'));
        if (!$ok) throw new RoutingUnavailable('The map service address in .env (ORS_BASE_URL) is not allowed. Type the km.', 'config');
        return $u;
    }
    private static function dailyLimit(string $service): int {
        $v = (int)self::env('ORS_DAILY_LIMIT_' . strtoupper($service), (string)self::DAILY_DEFAULTS[$service]);
        return $v > 0 ? $v : self::DAILY_DEFAULTS[$service];
    }
    private static function perUserPerMinute(): int {
        $v = (int)self::env('MAP_USER_PER_MINUTE', '30');
        return $v > 0 ? $v : 30;
    }

    // -----------------------------------------------------------------
    // input checks
    // -----------------------------------------------------------------
    public static function point(mixed $lat, mixed $lng, string $label): array {
        must(is_numeric($lat) && is_numeric($lng), "The map pin of the $label is incomplete.");
        $lat = round((float)$lat, 5); $lng = round((float)$lng, 5);
        must($lat >= self::PH_LAT[0] && $lat <= self::PH_LAT[1] && $lng >= self::PH_LNG[0] && $lng <= self::PH_LNG[1],
            "The map pin of the $label is outside the Philippines.");
        return [$lat, $lng];
    }
    public static function option(?string $o): string {
        $o = $o === null || $o === '' ? self::DEFAULT_OPTION : $o;
        must(isset(self::OPTIONS[$o]), 'Unknown route option.');
        return $o;
    }

    /** Straight-line distance in km (sanity check only). */
    public static function straightKm(array $a, array $b): float {
        $r = 6371.0088; $dLat = deg2rad($b[0] - $a[0]); $dLng = deg2rad($b[1] - $a[1]);
        $h = sin($dLat / 2) ** 2 + cos(deg2rad($a[0])) * cos(deg2rad($b[0])) * sin($dLng / 2) ** 2;
        return 2 * $r * asin(min(1, sqrt($h)));
    }

    // -----------------------------------------------------------------
    // public services
    // -----------------------------------------------------------------
    /**
     * Road route between two points. Returns
     *   ['distance_km' => 12.34, 'duration_min' => 25.0, 'geometry' => encoded polyline,
     *    'option' => ..., 'provider' => 'openrouteservice/driving-hgv', 'straight_km' => .., 'warning' => '', 'cached' => bool]
     * Throws RoutingUnavailable (fallback to manual km) or BusinessRuleException (bad input).
     */
    public static function route(PDO $p, ?int $userId, array $from, array $to, string $option): array {
        $option = self::option($option);
        $a = self::point($from[0] ?? null, $from[1] ?? null, 'origin');
        $b = self::point($to[0] ?? null, $to[1] ?? null, 'destination');
        must($a !== $b, 'The two map pins are on the same spot.');
        $straight = self::straightKm($a, $b);
        $key = hash('sha256', implode('|', ['route', self::providerName(), $option, $a[0], $a[1], $b[0], $b[1]]));
        $hit = self::cacheGet($p, $key);
        if ($hit === null) {
            $body = ['coordinates' => [[$a[1], $a[0]], [$b[1], $b[0]]], 'preference' => 'recommended', 'instructions' => false, 'units' => 'm'];
            $opts = [];
            if (self::profile() === 'driving-hgv') $opts['vehicle_type'] = 'hgv';
            if (self::OPTIONS[$option]['avoid']) $opts['avoid_features'] = self::OPTIONS[$option]['avoid'];
            if ($opts) $body['options'] = $opts;
            $j = self::call($p, $userId, 'route', 'POST', '/openrouteservice/v2/directions/' . self::profile() . '/json', null, json_encode($body));
            $r = $j['routes'][0] ?? null;
            $m = $r['summary']['distance'] ?? null;
            if (!is_array($r) || !is_numeric($m) || (float)$m <= 0) throw new RoutingUnavailable('No road route was found between the two pins. Check the pins or type the km.', 'no_route');
            $geom = is_string($r['geometry'] ?? null) && strlen($r['geometry']) <= 500000 && preg_match('/^[\x3F-\x7E]+$/', $r['geometry']) ? $r['geometry'] : '';
            $hit = ['distance_m' => (float)$m, 'duration_s' => (float)($r['summary']['duration'] ?? 0), 'geometry' => $geom];
            self::cachePut($p, $key, 'route', $hit);
            $cached = false;
        } else { $cached = true; }
        $km = round($hit['distance_m'] / 1000, 2);
        must($km <= 3000, 'The road distance is more than 3,000 km. Check the pins.');
        $warning = '';
        if ($km < $straight * 0.98) $warning = 'The road distance is shorter than the straight-line distance. Check the pins.';
        elseif ($straight >= 1 && $km > $straight * 3) $warning = 'The road distance is more than 3 times the straight-line distance. Check the pins.';
        return ['distance_km' => $km, 'duration_min' => round($hit['duration_s'] / 60, 1), 'geometry' => $hit['geometry'], 'option' => $option,
                'option_label' => self::OPTIONS[$option]['label'], 'provider' => self::providerName(), 'straight_km' => round($straight, 2),
                'warning' => $warning, 'cached' => $cached];
    }

    /** Address search in the Philippines: up to 5 results [name, lat, lng]. */
    public static function search(PDO $p, ?int $userId, string $q): array {
        $q = trim((string)preg_replace('/\s+/u', ' ', $q));
        must(textLength($q) >= 3, 'Type at least 3 letters.');
        must(textLength($q) <= 150, 'The search text is too long (max 150 characters).');
        $key = hash('sha256', 'search|' . mb_strtolower($q, 'UTF-8'));
        $hit = self::cacheGet($p, $key);
        if ($hit !== null) return $hit;
        $j = self::call($p, $userId, 'search', 'GET', '/pelias/v1/search', ['text' => $q, 'boundary.country' => 'PH', 'size' => '5', 'lang' => 'en'], null);
        $out = [];
        foreach (($j['features'] ?? []) as $f) {
            $c = $f['geometry']['coordinates'] ?? null; $name = $f['properties']['label'] ?? ($f['properties']['name'] ?? '');
            if (!is_array($c) || !is_numeric($c[0] ?? null) || !is_numeric($c[1] ?? null) || !is_string($name) || $name === '') continue;
            $lat = (float)$c[1]; $lng = (float)$c[0];
            if ($lat < self::PH_LAT[0] || $lat > self::PH_LAT[1] || $lng < self::PH_LNG[0] || $lng > self::PH_LNG[1]) continue;
            $out[] = ['name' => cut($name, 200), 'lat' => round($lat, 7), 'lng' => round($lng, 7)];
            if (count($out) === 5) break;
        }
        self::cachePut($p, $key, 'search', $out);
        return $out;
    }

    /** Address of a map point ('' when none). */
    public static function reverse(PDO $p, ?int $userId, mixed $lat, mixed $lng): string {
        [$la, $lo] = self::point($lat, $lng, 'point');
        $la = round($la, 4); $lo = round($lo, 4);   // nearby clicks share the cache
        $key = hash('sha256', "reverse|$la|$lo");
        $hit = self::cacheGet($p, $key);
        if ($hit !== null) return (string)$hit;
        $j = self::call($p, $userId, 'reverse', 'GET', '/pelias/v1/reverse', ['point.lat' => (string)$la, 'point.lon' => (string)$lo, 'size' => '1', 'boundary.country' => 'PH', 'lang' => 'en'], null);
        $name = $j['features'][0]['properties']['label'] ?? '';
        $name = is_string($name) ? cut($name, 200) : '';
        self::cachePut($p, $key, 'reverse', $name);
        return $name;
    }

    // -----------------------------------------------------------------
    // cache (database)
    // -----------------------------------------------------------------
    private static function cacheGet(PDO $p, string $key): mixed {
        $r = one($p, 'SELECT payload FROM map_cache WHERE cache_key=? AND expires_at > NOW()', [$key]);
        if (!$r) return null;
        $v = json_decode((string)$r['payload'], true);
        return $v === null && $r['payload'] !== 'null' ? null : $v;
    }
    private static function cachePut(PDO $p, string $key, string $service, mixed $value): void {
        try {
            $p->prepare('INSERT INTO map_cache (cache_key, service, payload, expires_at) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL ' . self::CACHE_DAYS . ' DAY))
                         ON DUPLICATE KEY UPDATE payload=VALUES(payload), expires_at=VALUES(expires_at), created_at=NOW()')
              ->execute([$key, $service, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            if (random_int(1, 50) === 1) $p->exec('DELETE FROM map_cache WHERE expires_at < NOW() LIMIT 200');
        } catch (Throwable $e) { error_log('map_cache write failed: ' . $e->getMessage()); }
    }

    // -----------------------------------------------------------------
    // limits
    // -----------------------------------------------------------------
    /** Counts the call and refuses it when the per-user or the daily limit is reached. */
    private static function reserve(PDO $p, ?int $userId, string $service): void {
        if ($userId) {
            $p->prepare("INSERT INTO map_user_usage (user_id, minute_start, calls) VALUES (?, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00'), 1)
                         ON DUPLICATE KEY UPDATE calls = calls + 1")->execute([$userId]);
            $n = (int)(one($p, "SELECT calls FROM map_user_usage WHERE user_id=? AND minute_start=DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00')", [$userId])['calls'] ?? 0);
            if ($n > self::perUserPerMinute()) throw new RoutingUnavailable('Too many map requests. Wait a minute and try again, or type the km.', 'user_limit');
            if (random_int(1, 50) === 1) $p->exec('DELETE FROM map_user_usage WHERE minute_start < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 500');
        }
        $p->prepare('INSERT INTO map_api_usage (usage_date, service, calls) VALUES (CURRENT_DATE(), ?, 1) ON DUPLICATE KEY UPDATE calls = calls + 1')->execute([$service]);
        $n = (int)(one($p, 'SELECT calls FROM map_api_usage WHERE usage_date=CURRENT_DATE() AND service=?', [$service])['calls'] ?? 0);
        if ($n > self::dailyLimit($service)) {
            error_log("ORS daily guard reached for $service ($n calls)");
            throw new RoutingUnavailable('The daily limit of the map service is reached. Type the km; automatic km returns tomorrow.', 'daily_limit');
        }
    }

    // -----------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------
    /** Calls ORS and returns the decoded JSON. Maps every failure to a clear RoutingUnavailable message. */
    private static function call(PDO $p, ?int $userId, string $service, string $method, string $path, ?array $query, ?string $body): array {
        if (!in_array($service, self::SERVICES, true)) throw new LogicException('Unknown map service.');
        if (!self::configured()) throw new RoutingUnavailable('Automatic km is not set up (ORS_API_KEY is empty in .env). Type the km.', 'not_configured');
        $url = self::baseUrl() . $path . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
        self::reserve($p, $userId, $service);
        $headers = ['Authorization: ' . trim(self::env('ORS_API_KEY')), 'Accept: application/json, application/geo+json',
                    'User-Agent: MulawinFleetOps/2 (' . (envValue('COMPANY_NAME') ?: 'RP Mulawin Trucking') . ')'];
        if ($body !== null) $headers[] = 'Content-Type: application/json; charset=utf-8';
        self::$outboundCalls++;
        [$status, $raw] = self::$transport ? (self::$transport)($method, $url, $headers, $body) : self::curl($method, $url, $headers, $body);
        $j = is_string($raw) ? json_decode($raw, true) : null;
        if ($status >= 200 && $status < 300 && is_array($j)) return $j;
        $code = is_array($j) ? (int)($j['error']['code'] ?? 0) : 0;
        error_log("ORS $service failed: HTTP $status, ORS code $code");   // never logs the key or the URL with the key
        throw match (true) {
            $status === 0 => new RoutingUnavailable('The map service did not answer (no internet or timeout). Type the km.', 'network'),
            $status === 401 || $status === 403 => new RoutingUnavailable('The map service refused the request (API key or daily quota). Type the km.', 'refused'),
            $status === 429 => new RoutingUnavailable('The map service is busy (too many requests per minute). Try again in a minute, or type the km.', 'rate_limited'),
            $code === 2010 => new RoutingUnavailable('A pin is too far from a road. Move the pin closer to a road, or type the km.', 'not_near_road'),
            $code === 2004 => new RoutingUnavailable('The route is too long for the map service. Type the km.', 'too_long'),
            $code === 2009 => new RoutingUnavailable('No road route was found between the two pins. Check the pins or type the km.', 'no_route'),
            default => new RoutingUnavailable('The map service could not calculate the distance now. Type the km.', 'error'),
        };
    }

    /** Real HTTPS call: TLS verified, no redirects, short timeouts. Returns [status, body] (status 0 = network error). */
    private static function curl(string $method, string $url, array $headers, ?string $body): array {
        if (!function_exists('curl_init')) throw new RoutingUnavailable('The PHP curl extension is missing on this server. Type the km.', 'config');
        $h = curl_init($url);
        $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
                 CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_MAXFILESIZE => 5 * 1024 * 1024];
        if (defined('CURLOPT_PROTOCOLS_STR')) $opts[CURLOPT_PROTOCOLS_STR] = envValue('APP_ENV') === 'test' ? 'https,http' : 'https';
        if ($method === 'POST') { $opts[CURLOPT_POST] = true; $opts[CURLOPT_POSTFIELDS] = (string)$body; }
        curl_setopt_array($h, $opts);
        $raw = curl_exec($h);
        $status = $raw === false ? 0 : (int)curl_getinfo($h, CURLINFO_RESPONSE_CODE);
        curl_close($h);
        return [$status, $raw === false ? '' : (string)$raw];
    }
}
