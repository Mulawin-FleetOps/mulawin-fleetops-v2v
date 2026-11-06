<?php
/*
 * tests/_mock_ors.php  —  FAKE openrouteservice for tests only (PHP built-in server router).
 *   php -S 127.0.0.1:8098 tests/_mock_ors.php
 * Never deployed: the tests/ folder is blocked from the web by the root .htaccess.
 *
 * Answers like ORS:
 *   POST /openrouteservice/v2/directions/{profile}/json   distance = straight line x 1.3 (x 1.5 with avoid_features)
 *   GET  /pelias/v1/search?text=...                       a few fixed places in Batangas / Laguna
 *   GET  /pelias/v1/reverse?point.lat=..&point.lon=..     "Mock address lat,lng"
 * Special cases:
 *   Authorization header must be "mock-ors-key" (else 403)
 *   origin latitude 14.111 -> ORS error 2010 (point not near a road)
 *   origin latitude 14.222 -> HTTP 429
 * Every request is appended (without the key) to the file in MOCK_ORS_LOG, when set.
 */
declare(strict_types=1);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$body = (string)file_get_contents('php://input');
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($log = getenv('MOCK_ORS_LOG')) {
    file_put_contents($log, json_encode(['method' => $_SERVER['REQUEST_METHOD'], 'path' => $path, 'query' => $_GET, 'body' => $body,
        'auth_ok' => $auth === 'mock-ors-key', 'ua' => $_SERVER['HTTP_USER_AGENT'] ?? '']) . "\n", FILE_APPEND);
}
header('Content-Type: application/json');
$out = function (int $code, array $v): never { http_response_code($code); echo json_encode($v); exit; };
if ($auth !== 'mock-ors-key') $out(403, ['error' => 'Access to this API has been disallowed']);

function enc(array $pts): string {
    $s = ''; $prev = [0, 0];
    foreach ($pts as $pt) {
        foreach ([0, 1] as $i) {
            $v = (int)round($pt[$i] * 1e5); $d = $v - $prev[$i]; $prev[$i] = $v;
            $d = $d < 0 ? ~($d << 1) : ($d << 1);
            while ($d >= 0x20) { $s .= chr((0x20 | ($d & 0x1f)) + 63); $d >>= 5; }
            $s .= chr($d + 63);
        }
    }
    return $s;
}
function km(array $a, array $b): float {
    $r = 6371.0088; $dLat = deg2rad($b[0] - $a[0]); $dLng = deg2rad($b[1] - $a[1]);
    $h = sin($dLat / 2) ** 2 + cos(deg2rad($a[0])) * cos(deg2rad($b[0])) * sin($dLng / 2) ** 2;
    return 2 * $r * asin(min(1, sqrt($h)));
}

if (preg_match('#^/openrouteservice/v2/directions/(driving-hgv|driving-car)/json$#', $path)) {
    $j = json_decode($body, true);
    [$a, $b] = [[$j['coordinates'][0][1], $j['coordinates'][0][0]], [$j['coordinates'][1][1], $j['coordinates'][1][0]]];
    if (abs($a[0] - 14.111) < 0.0001) $out(404, ['error' => ['code' => 2010, 'message' => 'Could not find routable point within a radius of 350.0 meters']]);
    if (abs($a[0] - 14.222) < 0.0001) $out(429, ['error' => 'Rate Limit Exceeded']);
    $factor = empty($j['options']['avoid_features']) ? 1.3 : 1.5;
    $m = round(km($a, $b) * 1000 * $factor, 1);
    $mid = [($a[0] + $b[0]) / 2 + 0.01, ($a[1] + $b[1]) / 2];
    $out(200, ['routes' => [['summary' => ['distance' => $m, 'duration' => round($m / 13.9, 1)], 'geometry' => enc([$a, $mid, $b])]]]);
}
if ($path === '/pelias/v1/search') {
    $places = ['Tanauan City, Batangas, Philippines' => [14.0863, 121.1497], 'Malvar, Batangas, Philippines' => [14.0447, 121.1588],
               'Santa Rosa, Laguna, Philippines' => [14.3122, 121.1114], 'Tokyo, Japan' => [35.68, 139.69]];
    $t = strtolower((string)($_GET['text'] ?? ''));
    $f = [];
    foreach ($places as $name => [$la, $lo]) if (str_contains(strtolower($name), explode(' ', $t)[0])) $f[] = ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [$lo, $la]], 'properties' => ['label' => $name]];
    $out(200, ['type' => 'FeatureCollection', 'features' => $f]);
}
if ($path === '/pelias/v1/reverse') {
    $la = (float)($_GET['point_lat'] ?? $_GET['point.lat'] ?? 0); $lo = (float)($_GET['point_lon'] ?? $_GET['point.lon'] ?? 0);
    $out(200, ['type' => 'FeatureCollection', 'features' => [['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [$lo, $la]], 'properties' => ['label' => sprintf('Mock address %.4f,%.4f', $la, $lo)]]]]);
}
$out(404, ['error' => 'not found']);
