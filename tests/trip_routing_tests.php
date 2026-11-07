<?php
/*
 * =====================================================================
 *  tests/trip_routing_tests.php  —  Road distance in Trip Management (Checklist #5 Phase 3)
 * =====================================================================
 *  Do NOT run this file directly: run tests/run_trip_routing_tests.php (temporary copy, own .env,
 *  disposable *_test databases only). No real call is made to openrouteservice (fake transport).
 *
 *  Groups:
 *    A. New trip (Scenario A): automatic road distance, route line, history note
 *    B. Route options (Recommended / Avoid Toll Roads / General Roads Only)
 *    C. Manual override: reason required, 15% warning, browser values not trusted
 *    D. Manual fallback (no option, no pins, service down, not configured)
 *    E. Approved client route: eligibility (client, truck type, status, rate), km, pins, line
 *    F. Review of a dispatcher request (Scenario B)
 *    G. Edit before dispatch (unchanged distance kept, switch to manual, deactivated route kept)
 *    H. Invalid inputs
 *    I. Roles and what the screen receives
 *    J. Trip workflow regression: assignment, dispatch, billing draft (per km), DR requirement
 *    K. Screen settings (Data::me)
 *    L. Migration 07: partially failed import, detection and recovery
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
core('Access');
core('Routing');
core('RouteDistance');

$FRESH = envValue('DB_NAME'); $PARTIAL = envValue('TEST_DB_PARTIAL');
test_guard([$FRESH, $PARTIAL]);

$PASS = 0; $FAIL = 0; $FAILED = [];
function ok(bool $c, string $name, string $detail = ''): void {
    global $PASS, $FAIL, $FAILED;
    if ($c) { $PASS++; echo "  PASS  $name\n"; } else { $FAIL++; $FAILED[] = $name; echo "  FAIL  $name" . ($detail !== '' ? "  -> $detail" : '') . "\n"; }
}
function fails(callable $fn, string $name, ?int $code = null, string $contains = ''): void {
    try { $fn(); ok(false, $name, 'no error was raised'); }
    catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }
    catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }
}
function section(string $t): void { echo "\n== $t ==\n"; }

const KEY = 'TEST-ORS-KEY-77aa-SECRET';
$LOG = tempnam(sys_get_temp_dir(), 'triplog');
ini_set('error_log', $LOG);
ini_set('display_errors', 'stderr');

// Fake ORS: Recommended = straight line x 1.25, any avoided feature = x 1.4 (tolls) / x 1.6 (highways too).
$REQ = []; $NEXT = null;
$fake = function (string $method, string $url, array $headers, ?string $body) use (&$REQ, &$NEXT): array {
    $REQ[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
    if ($NEXT !== null) { $r = $NEXT; $NEXT = null; return $r; }
    if (str_contains($url, '/directions/')) {
        $j = json_decode((string)$body, true);
        $a = [$j['coordinates'][0][1], $j['coordinates'][0][0]]; $b = [$j['coordinates'][1][1], $j['coordinates'][1][0]];
        $avoid = $j['options']['avoid_features'] ?? [];
        $f = !$avoid ? 1.25 : (in_array('highways', $avoid, true) ? 1.6 : 1.4);
        $m = round(Routing::straightKm($a, $b) * 1000 * $f, 1);
        return [200, json_encode(['routes' => [['summary' => ['distance' => $m, 'duration' => $m / 12], 'geometry' => 'tripline' . chr(65 + count($avoid))]]])];
    }
    return [404, '{}'];
};
$cfg = fn(array $over = []) => Routing::testConfig($over + ['ORS_API_KEY' => KEY, 'ORS_BASE_URL' => 'https://api.heigit.org', 'ORS_PROFILE' => 'driving-hgv']);
$cfg();
Routing::useTransport($fake);

// ---------------------------------------------------------------------
section('Setup: disposable fresh database');
test_recreate($FRESH); test_recreate($PARTIAL);
$p = db();
ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable fresh test database');
test_import($p, test_sql('database/schema.sql'));
test_import($p, test_sql('database/extension.sql'));
$users = [];
foreach (array_keys(ROLE_LABELS) as $role) {
    $id = insert($p, 'users', ['username' => $role, 'email' => "$role@example.test", 'password_hash' => 'x', 'full_name' => strtoupper($role) . ' USER', 'role' => $role]);
    $users[$role] = ['id' => $id, 'username' => $role, 'email' => "$role@example.test", 'full_name' => strtoupper($role) . ' USER', 'role' => $role, 'shift' => null];
}
$U = fn(string $r) => $users[$r];
$ops = $U('operations_head'); $wvd = $U('container_wingvan_dispatcher'); $ccd = $U('car_carrier_dispatcher');
Actions::load('Trips'); Actions::load('Routes');

$TAN = [14.0863, 121.1497]; $MAL = [14.0447, 121.1588]; $STR = [14.3122, 121.1114];
$cid = insert($p, 'clients', ['company_name' => 'TRIP ROUTE CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
$cid2 = insert($p, 'clients', ['company_name' => 'OTHER CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
foreach ([[$cid, 'Wing Van', '50.00', '0.00'], [$cid, 'Car Carrier', '80.00', '0.00'], [$cid2, 'Wing Van', '45.00', '0.00']] as [$c, $type, $rate, $min])
    insert($p, 'client_rates', ['client_id' => $c, 'truck_type' => $type, 'rate_per_km' => $rate, 'minimum_charge' => $min, 'updated_by' => $U('billing')['id']]);
// Enough trucks and crew so every created trip is assigned.
for ($i = 1; $i <= 40; $i++) {
    insert($p, 'vehicles', ['plate_number' => "WV-$i", 'truck_type' => 'Wing Van']);
    insert($p, 'vehicles', ['plate_number' => "CC-$i", 'truck_type' => 'Car Carrier']);
}
for ($i = 1; $i <= 90; $i++) {
    insert($p, 'personnel', ['full_name' => "DRIVER, NO $i", 'person_type' => 'Driver']);
    insert($p, 'personnel', ['full_name' => "HELPER, NO $i", 'person_type' => 'Helper']);
}
/** Approved client route with a current Approved rate (inserted directly; the route workflow is tested in run_route_tests.php). */
$routeN = 0;
$mkRoute = function (int $client, string $type, array $o = [], string $routeStatus = 'Approved', ?string $rateStatus = 'Approved') use ($p, $ops, $U, &$routeN, $TAN, $MAL): int {
    $routeN++;
    $id = insert($p, 'client_routes', $o + ['route_ref' => sprintf('RTE-T-%04d', $routeN), 'client_id' => $client, 'truck_type' => $type,
        'origin_label' => "TANAUAN $routeN", 'destination_label' => "MALVAR $routeN", 'origin_key' => "tanauan $routeN", 'destination_key' => "malvar $routeN",
        'origin_lat' => $TAN[0], 'origin_lng' => $TAN[1], 'destination_lat' => $MAL[0], 'destination_lng' => $MAL[1],
        'distance_km' => '9.50', 'distance_source' => 'Map', 'route_option' => 'avoid_tolls', 'distance_computed_km' => '9.50',
        'distance_provider' => 'openrouteservice/driving-hgv', 'route_geometry' => 'route_line_' . $routeN, 'status' => $routeStatus, 'requested_by' => $ops['id']]);
    if ($rateStatus !== null) insert($p, 'client_route_rates', ['route_id' => $id, 'version_no' => 1, 'rate_type' => 'Flat', 'rate_amount' => '9999.00',
        'status' => $rateStatus, 'entered_by' => $U('billing')['id'], 'effective_from' => $rateStatus === 'Approved' ? date('Y-m-d H:i:s') : null]);
    return $id;
};
$when = fn(int $h = 3) => date('Y-m-d\TH:i', time() + $h * 3600);
$n = 0;
$trip = function (array $o = []) use ($cid, $when, &$n, $TAN, $MAL): array {
    $n++;
    return $o + ['client_id' => $cid, 'truck_type' => 'Wing Van', 'pickup_point' => "PICKUP $n", 'delivery_point' => "DELIVERY $n", 'scheduled_at' => $when(),
        'pickup_lat' => (string)$TAN[0], 'pickup_lng' => (string)$TAN[1], 'delivery_lat' => (string)$MAL[0], 'delivery_lng' => (string)$MAL[1]];
};
$T = fn(int $id) => one($p, 'SELECT * FROM trips WHERE id=?', [$id]);
$line = fn(int $id) => one($p, 'SELECT geometry FROM trip_routes WHERE trip_id=?', [$id])['geometry'] ?? null;
$km = fn(string $opt, array $a = null, array $b = null) => Routing::route($p, $ops['id'], $a ?? $TAN, $b ?? $MAL, $opt)['distance_km'];
$fmt = fn(float $x) => number_format($x, 2, '.', '');
$COMP = $km('recommended');

// ---------------------------------------------------------------------
section('A. New trip (Scenario A): automatic road distance');
$REQ = [];
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP)]));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Map' && (float)$t['distance_km'] === $COMP && (float)$t['distance_computed_km'] === $COMP && $t['route_option'] === 'recommended'
   && $t['distance_provider'] === 'openrouteservice/driving-hgv' && $t['distance_computed_at'] !== null && $t['distance_override_reason'] === null && $t['client_route_id'] === null,
   'km = computed -> Map, computed km, option, provider and time saved', json_encode(array_intersect_key($t, array_flip(['distance_source', 'distance_km', 'distance_computed_km', 'route_option']))));
ok($line($r['trip_id']) === 'triplineA', 'road line saved in trip_routes');
ok(count($REQ) === 0, 'road distance served from the cache (no second call for the same points and option)', (string)count($REQ));
ok($t['status'] === 'Pre-Assigned' && $t['vehicle_id'] !== null, 'trip is still auto-assigned (Pre-Assigned)', $t['status']);
$ev = one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type LIKE 'trip created%'", [$r['trip_id']]);
ok(str_contains((string)$ev['notes'], 'Distance: ' . number_format($COMP, 2) . ' km, Map') && str_contains((string)$ev['notes'], 'Recommended'), 'trip history shows the distance and its source', (string)$ev['notes']);
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lat' => (string)$STR[0], 'pickup_lng' => (string)$STR[1]]));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Map' && (float)$t['distance_km'] === $km('recommended', $STR), 'no km typed -> the computed km becomes the billable km', (string)$t['distance_km']);

// ---------------------------------------------------------------------
section('B. Route options');
foreach (['avoid_tolls' => ['tollways'], 'general_roads' => ['highways', 'tollways']] as $opt => $avoid) {
    $REQ = [];
    $r = Trips::action($ops, 'create', $trip(['route_option' => $opt, 'pickup_lat' => '14.1000', 'pickup_lng' => '121.1400']));
    $t = $T($r['trip_id']);
    $sent = json_decode((string)($REQ[0]['body'] ?? ''), true);
    ok(($sent['options']['avoid_features'] ?? null) === $avoid, "$opt -> request avoids " . json_encode($avoid));
    ok($t['route_option'] === $opt && $t['distance_source'] === 'Map' && (float)$t['distance_km'] === $km($opt, [14.1, 121.14]), "$opt -> its own km saved with the option");
}
ok($km('avoid_tolls') !== $COMP, 'different options give different km (fake service)');

// ---------------------------------------------------------------------
section('C. Manual override of the computed km');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP + 1)])), 'km different from computed WITHOUT a reason is refused', 400, 'Give the reason');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP + 0.01)])), 'even 0.01 km difference needs a reason', 400, 'Give the reason');
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP + 0.5), 'distance_override_reason' => 'Gate is 500 m inside the port']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Map (edited)' && (float)$t['distance_km'] === round($COMP + 0.5, 2) && (float)$t['distance_computed_km'] === $COMP && $t['distance_override_reason'] === 'Gate is 500 m inside the port',
   'with a reason -> Map (edited); billable km, computed km and reason kept');
ok(!str_contains($r['message'], '15%'), 'difference of 15% or less -> no 15% warning');
$ev = one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type LIKE 'trip created%'", [$r['trip_id']]);
ok(str_contains((string)$ev['notes'], 'Map (edited)') && str_contains((string)$ev['notes'], 'reference') && str_contains((string)$ev['notes'], 'Gate is 500 m'), 'history shows edited source, reference km and reason', (string)$ev['notes']);
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP * 1.5), 'distance_override_reason' => 'Detour for truck ban']));
ok(str_contains($r['message'], '15%'), 'difference above 15% -> warning in the result', $r['message']);
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => '99', 'distance_override_reason' => str_repeat('r', 301)])), 'reason longer than 300 characters refused');
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP), 'distance_source' => 'Client Route', 'distance_computed_km' => '1.00', 'distance_provider' => 'fake', 'distance_override_reason' => '']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Map' && (float)$t['distance_computed_km'] === $COMP && $t['distance_provider'] === 'openrouteservice/driving-hgv', 'distance source / computed km / provider sent by the browser are ignored');

// ---------------------------------------------------------------------
section('D. Manual fallback');
$before = Routing::$outboundCalls;
$r = Trips::action($ops, 'create', $trip(['distance_km' => '12.34']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Manual' && $t['distance_km'] === '12.34' && $t['distance_computed_km'] === null && $t['route_option'] === null && Routing::$outboundCalls === $before && $line($r['trip_id']) === null,
   'no route option -> Manual (typed km), no map call, no line');
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => '7.00', 'pickup_lat' => '', 'pickup_lng' => '']));
ok($T($r['trip_id'])['distance_source'] === 'Manual', 'route option but a point not pinned -> Manual');
$NEXT = [503, 'down'];
$r = Trips::action($ops, 'create', $trip(['route_option' => 'general_roads', 'distance_km' => '8.10', 'pickup_lat' => '14.1200', 'pickup_lng' => '121.1300']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Manual' && $t['distance_km'] === '8.10' && $t['route_option'] === null && str_contains($r['message'], 'Manual'), 'map service down -> typed km saved as Manual with a note', $r['message']);
$NEXT = [503, 'down'];
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'general_roads', 'pickup_lat' => '14.1300', 'pickup_lng' => '121.1300'])),
    'map service down and no km typed (Operations Head) -> asked to type the km', 400, 'billable distance');
$cfg(['ORS_API_KEY' => '']);
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => '6.50', 'pickup_lat' => '14.1400', 'pickup_lng' => '121.1300']));
ok($T($r['trip_id'])['distance_source'] === 'Manual' && str_contains($r['message'], 'Manual'), 'map service not set up -> Manual with a note (manual trip creation still works)');
$NEXT = null;
$r = Trips::action($wvd, 'create', $trip(['route_option' => 'recommended', 'truck_type' => 'Wing Van', 'pickup_lat' => '14.1500', 'pickup_lng' => '121.1300']));
$t = $T($r['trip_id']);
ok($t['status'] === 'Pending Review' && $t['distance_km'] === null && $t['distance_source'] === 'Manual', 'dispatcher request with no km while the service is off -> saved, km left for the Operations Head', json_encode([$t['status'], $t['distance_km'], $t['distance_source'], $r['message']]));
$cfg();

// ---------------------------------------------------------------------
section('E. Approved client route');
$rWV = $mkRoute($cid, 'Wing Van');
$REQ = [];
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'pickup_lat' => '', 'pickup_lng' => '', 'delivery_lat' => '', 'delivery_lng' => '', 'distance_km' => '9.50']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Client Route' && $t['distance_km'] === '9.50' && $t['distance_computed_km'] === '9.50' && (int)$t['client_route_id'] === $rWV
   && $t['route_option'] === 'avoid_tolls' && str_starts_with((string)$t['distance_provider'], 'Client route RTE-T-'), 'approved route -> Client Route, route km, option and reference saved');
ok((float)$t['pickup_lat'] === $TAN[0] && (float)$t['delivery_lng'] === $MAL[1], 'map pins taken from the approved route');
ok($line($r['trip_id']) === 'route_line_1' && count($REQ) === 0, 'route line copied from the approved route; no map call');
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV]));
ok($T($r['trip_id'])['distance_km'] === '9.50', 'approved route and no km typed -> route km used');
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'distance_km' => '10.00'])), 'route km changed WITHOUT a reason refused', 400, 'Give the reason');
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'distance_km' => '10.00', 'distance_override_reason' => 'Second drop-off in the same compound']));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Client Route (edited)' && $t['distance_km'] === '10.00' && $t['distance_computed_km'] === '9.50', 'route km changed with a reason -> Client Route (edited)');
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'route_option' => 'general_roads', 'pickup_lat' => '15.0000', 'distance_source' => 'Map']));
$t = $T($r['trip_id']);
ok($t['route_option'] === 'avoid_tolls' && (float)$t['pickup_lat'] === $TAN[0] && $t['distance_source'] === 'Client Route', 'option, pins and source sent with an approved route are replaced by the route values');
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'truck_type' => 'Car Carrier'])), 'route of another truck type refused', 409);
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'client_id' => (string)$cid2])), 'route of another client refused', 409);
$rPend = $mkRoute($cid, 'Wing Van', [], 'Pending Approval', 'Pending Approval');
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rPend])), 'route not approved yet refused', 409);
$rNoRate = $mkRoute($cid, 'Wing Van', [], 'Approved', null);
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rNoRate])), 'route without a current approved rate refused', 409);
$rOff = $mkRoute($cid, 'Wing Van', [], 'Inactive');
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rOff])), 'inactive route refused', 409);
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => '999999'])), 'unknown route refused', 409);
$cid3 = insert($p, 'clients', ['company_name' => 'SOON INACTIVE CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
insert($p, 'client_rates', ['client_id' => $cid3, 'truck_type' => 'Wing Van', 'rate_per_km' => '40.00', 'minimum_charge' => '0.00', 'updated_by' => $U('billing')['id']]);
$r3 = $mkRoute($cid3, 'Wing Van');
run($p, "UPDATE clients SET status='Inactive' WHERE id=?", [$cid3]);
fails(fn() => Trips::action($ops, 'create', $trip(['client_id' => (string)$cid3, 'client_route_id' => (string)$r3])), 'route of an inactive client refused');
ok(RouteDistance::selectable($p, $cid3) === [], 'inactive client -> no selectable routes');
$rNoPins = $mkRoute($cid, 'Wing Van', ['origin_lat' => null, 'origin_lng' => null, 'destination_lat' => null, 'destination_lng' => null, 'route_geometry' => null, 'distance_source' => 'Manual', 'route_option' => null, 'distance_computed_km' => null, 'distance_km' => '21.00']);
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rNoPins]));
$t = $T($r['trip_id']);
ok($t['distance_source'] === 'Client Route' && $t['distance_km'] === '21.00' && (float)$t['pickup_lat'] === $TAN[0] && $line($r['trip_id']) === null, 'route without map pins -> route km used, the trip keeps its own pins, no line');

// ---------------------------------------------------------------------
section('F. Review of a dispatcher request (Scenario B)');
$r = Trips::action($wvd, 'create', $trip(['route_option' => 'recommended', 'truck_type' => 'Wing Van', 'pickup_lat' => '14.0600', 'pickup_lng' => '121.1500']));
$id = $r['trip_id']; $t = $T($id);
ok($t['status'] === 'Pending Review' && $t['distance_source'] === 'Map' && $t['distance_km'] !== null, 'dispatcher request saved with the computed road distance');
$form = ['trip_id' => $id, 'decision' => 'approve', 'truck_type' => 'Wing Van', 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'],
         'scheduled_at' => str_replace(' ', 'T', substr($t['scheduled_at'], 0, 16)), 'pickup_lat' => $t['pickup_lat'], 'pickup_lng' => $t['pickup_lng'],
         'delivery_lat' => $t['delivery_lat'], 'delivery_lng' => $t['delivery_lng'], 'route_option' => 'recommended', 'distance_km' => $t['distance_km']];
$before = Routing::$outboundCalls; $REQ = [];
$res = Trips::action($ops, 'review', $form);
$t2 = $T($id);
ok($t2['distance_source'] === 'Map' && $t2['distance_km'] === $t['distance_km'] && $t2['distance_computed_at'] === $t['distance_computed_at'] && count($REQ) === 0, 'review with unchanged distance -> saved distance kept (no new map call)');
ok($t2['status'] === 'Pre-Assigned', 'review still confirms and auto-assigns', $t2['status']);
$r = Trips::action($wvd, 'create', $trip(['truck_type' => 'Wing Van', 'distance_km' => '5.00']));
$id = $r['trip_id']; $t = $T($id);
$form = ['trip_id' => $id, 'decision' => 'approve', 'truck_type' => 'Wing Van', 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'],
         'scheduled_at' => str_replace(' ', 'T', substr($t['scheduled_at'], 0, 16)), 'client_route_id' => (string)$rWV];
$res = Trips::action($ops, 'review', $form);
$t2 = $T($id);
ok($t2['distance_source'] === 'Client Route' && $t2['distance_km'] === '9.50' && (int)$t2['client_route_id'] === $rWV && $line($id) === 'route_line_1', 'Operations Head picks an approved route at review -> route km, pins and line');
$r = Trips::action($wvd, 'create', $trip(['truck_type' => 'Wing Van', 'route_option' => 'recommended', 'pickup_lat' => '14.0700', 'pickup_lng' => '121.1500']));
$t = $T($r['trip_id']);
fails(fn() => Trips::action($ops, 'review', ['trip_id' => $r['trip_id'], 'decision' => 'approve', 'truck_type' => 'Wing Van', 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'],
    'scheduled_at' => str_replace(' ', 'T', substr($t['scheduled_at'], 0, 16)), 'pickup_lat' => $t['pickup_lat'], 'pickup_lng' => $t['pickup_lng'], 'delivery_lat' => $t['delivery_lat'], 'delivery_lng' => $t['delivery_lng'],
    'route_option' => 'recommended', 'distance_km' => $fmt((float)$t['distance_km'] + 3)]), 'review: km changed without a reason refused', 400, 'Give the reason');
ok($T($r['trip_id'])['status'] === 'Pending Review', 'refused review leaves the request Pending Review');
$res = Trips::action($ops, 'review', ['trip_id' => $r['trip_id'], 'decision' => 'reject', 'reason' => 'Test reject']);
ok($T($r['trip_id'])['status'] === 'Rejected', 'reject still works (no distance check on reject)');

// ---------------------------------------------------------------------
section('G. Edit before dispatch');
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lat' => '14.0800', 'pickup_lng' => '121.1500']));
$id = $r['trip_id']; $t = $T($id);
$edit = function (array $o = []) use ($id, $T) { $t = $T($id); return $o + ['trip_id' => $id, 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'], 'scheduled_at' => str_replace(' ', 'T', substr($t['scheduled_at'], 0, 16)),
    'pickup_lat' => $t['pickup_lat'], 'pickup_lng' => $t['pickup_lng'], 'delivery_lat' => $t['delivery_lat'], 'delivery_lng' => $t['delivery_lng'], 'route_option' => $t['route_option'] ?? '', 'distance_km' => $t['distance_km'], 'client_route_id' => (string)($t['client_route_id'] ?? '')]; };
$REQ = [];
Trips::action($ops, 'edit', $edit(['delivery_details' => 'Call the guard']));
$t2 = $T($id);
ok($t2['distance_source'] === 'Map' && $t2['distance_computed_at'] === $t['distance_computed_at'] && count($REQ) === 0 && $t2['delivery_details'] === 'Call the guard', 'edit of other details -> distance kept, no map call');
fails(fn() => Trips::action($ops, 'edit', $edit(['distance_km' => $fmt((float)$t['distance_km'] + 2)])), 'edit: km changed without a reason refused', 400, 'Give the reason');
Trips::action($ops, 'edit', $edit(['route_option' => '', 'distance_km' => '30.00']));
$t2 = $T($id);
ok($t2['distance_source'] === 'Manual' && $t2['distance_km'] === '30.00' && $t2['distance_computed_km'] === null && $line($id) === null, 'edit to manual km (no option) -> Manual, line removed');
$ch = one($p, "SELECT c.changes_json FROM audit_event_changes c JOIN audit_events a ON a.id=c.audit_event_id WHERE a.record_ref=? ORDER BY a.id DESC LIMIT 1", ['trip ' . $id]);
ok(str_contains((string)($ch['changes_json'] ?? ''), '"Distance source"') && str_contains((string)$ch['changes_json'], '"Manual"'), 'Activity Log records the distance source change', (string)($ch['changes_json'] ?? 'none'));
Trips::action($ops, 'edit', $edit(['client_route_id' => (string)$rWV, 'distance_km' => '9.50', 'route_option' => '']));
ok($T($id)['distance_source'] === 'Client Route' && $line($id) === 'route_line_1', 'edit: choose an approved route');
run($p, "UPDATE client_routes SET status='Inactive' WHERE id=?", [$rWV]);
$t = $T($id);
Trips::action($ops, 'edit', $edit(['client_route_id' => (string)$rWV, 'distance_km' => '9.50', 'route_option' => '', 'delivery_details' => 'Gate 2']));
ok($T($id)['distance_source'] === 'Client Route' && (int)$T($id)['client_route_id'] === $rWV, 'route deactivated later -> unchanged trip keeps its saved route (history)');
fails(fn() => Trips::action($ops, 'edit', $edit(['client_route_id' => (string)$rWV, 'distance_km' => '11.00', 'distance_override_reason' => 'more', 'route_option' => ''])), 'deactivated route cannot be used for a CHANGED distance', 409);
run($p, "UPDATE client_routes SET status='Approved' WHERE id=?", [$rWV]);
$res = Trips::action($wvd, 'edit', ['trip_id' => $id, 'booking_reference' => 'BK-1', 'distance_km' => '1.00', 'client_route_id' => '', 'route_option' => 'general_roads']);
ok($T($id)['distance_km'] === '9.50' && $T($id)['booking_reference'] === 'BK-1', 'dispatcher edit cannot change the distance (only booking / container / units)');

// Checklist #27 (CHECKLIST_27_TRIP_DETAILS_LOCK_V1): no booking / delivery / distance edits from Dispatched onward.
$r = Trips::action($ops, 'create', $trip(['route_option' => 'recommended']));
$lid = $r['trip_id'];
foreach (['Dispatched', 'In Transit', 'On Hold - Incident Reported', 'Completed', 'Cancelled', 'Rejected'] as $status) {
    run($p, 'UPDATE trips SET status=? WHERE id=?', [$status, $lid]);
    $before = $T($lid); $calls = Routing::$outboundCalls;
    $tryOps = ['trip_id' => $lid, 'pickup_point' => 'CHANGED', 'delivery_point' => $before['delivery_point'], 'scheduled_at' => str_replace(' ', 'T', substr($before['scheduled_at'], 0, 16)),
        'pickup_lat' => '14.2000', 'pickup_lng' => '121.1000', 'delivery_lat' => $before['delivery_lat'], 'delivery_lng' => $before['delivery_lng'],
        'route_option' => 'general_roads', 'distance_km' => '99.00', 'distance_override_reason' => 'try', 'client_route_id' => (string)$rWV];
    fails(fn() => Trips::action($ops, 'edit', $tryOps), "#27 edit lock: Operations Head cannot edit a $status trip", 409);
    fails(fn() => Trips::action($wvd, 'edit', ['trip_id' => $lid, 'booking_reference' => 'BK-LOCK', 'container_number' => 'CONT1', 'delivery_details' => 'x']), "#27 edit lock: dispatcher cannot edit a $status trip", 409);
    $after = $T($lid);
    ok($after === $before && Routing::$outboundCalls === $calls && $line($lid) === 'triplineA', "#27 edit lock: $status trip, distance and line unchanged; no map call");
}
run($p, "UPDATE trips SET status='Pre-Assigned' WHERE id=?", [$lid]);

// ---------------------------------------------------------------------
section('H. Invalid inputs');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'teleport', 'distance_km' => '8'])), 'unknown route option refused');
fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '8.123'])), 'km with more than 2 decimals refused');
fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '3000.01'])), 'km above 3000 refused');
fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '-5'])), 'negative km refused');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lat' => '35.68', 'pickup_lng' => '139.69'])), 'pin outside the Philippines refused', 400, 'outside the Philippines');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lng' => ''])), 'half pin refused', 400, 'incomplete');
fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => 'abc'])), 'route id that is not a number refused');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'teleport', 'distance_km' => '8', 'pickup_lat' => '', 'pickup_lng' => ''])), 'unknown route option refused even without map pins');
fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => ['x'], 'distance_km' => '8'])), 'route option as a list refused');

// ---------------------------------------------------------------------
section('I. Roles and what the screen receives');
$rCC = $mkRoute($cid, 'Car Carrier');
$sel = Routes::action($ops, 'selectable', ['client_id' => $cid]);
$ids = array_column($sel['routes'], 'id');
ok(in_array($rWV, array_map('intval', $ids), true) && in_array($rCC, array_map('intval', $ids), true) && !in_array($rPend, array_map('intval', $ids), true) && !in_array($rOff, array_map('intval', $ids), true),
   'Operations Head: approved routes of both truck types; pending / inactive not listed');
$row0 = $sel['routes'][0] ?? [];
ok(!array_key_exists('rate_amount', $row0) && !array_key_exists('rate_type', $row0) && !array_key_exists('minimum_charge', $row0), 'route list for trips has no route rates (pricing stays with Billing)');
$one = Routes::action($ops, 'selectable', ['client_id' => $cid, 'route_id' => $rWV]);
ok(($one['routes'][0]['route_geometry'] ?? null) === 'route_line_1', 'one route asked -> its line included');
$cc = Routes::action($ccd, 'selectable', ['client_id' => $cid]);
ok($cc['routes'] && !array_filter($cc['routes'], fn($x) => $x['truck_type'] !== 'Car Carrier'), 'Car Carrier dispatcher sees only Car Carrier routes');
fails(fn() => Routes::action($ccd, 'selectable', ['client_id' => $cid, 'truck_type' => 'Wing Van']), 'dispatcher asking for the other team\'s truck type refused', 403);
foreach (['finance', 'billing', 'audit', 'motorpool', 'purchasing'] as $role)
    fails(fn() => Routes::action($U($role), 'selectable', ['client_id' => $cid]), "$role cannot list routes for trips", 403);
fails(fn() => Trips::action($U('finance'), 'create', $trip(['distance_km' => '5'])), 'finance cannot create a trip', 403);
fails(fn() => Trips::action($ccd, 'create', $trip(['truck_type' => 'Wing Van', 'client_route_id' => (string)$rWV])), 'dispatcher cannot create a trip of the other team (route or not)');
$r = Trips::action($ccd, 'create', $trip(['truck_type' => 'Car Carrier', 'client_route_id' => (string)$rCC]));
ok($T($r['trip_id'])['distance_source'] === 'Client Route', 'Car Carrier dispatcher can use a Car Carrier approved route');
$det = Trips::action($ops, 'details', ['trip_id' => $r['trip_id']]);
ok($det['trip']['client_route_ref'] === one($p, 'SELECT route_ref FROM client_routes WHERE id=?', [$rCC])['route_ref'] && $det['trip']['route_geometry'] !== null
   && array_key_exists('distance_override_reason', $det['trip']) && !str_contains(json_encode($det), 'rate_amount'), 'trip details: route reference, line and distance fields; no route rates');
$all = file_get_contents(dirname(__DIR__) . '/public/assets/js/modules/operations/trips.js') . file_get_contents(dirname(__DIR__) . '/public/assets/js/map.js');
ok(!preg_match('/api\.heigit\.org|api\.openrouteservice\.org/i', $all) && !str_contains($all, KEY) && !str_contains($all, 'ORS_API_KEY='), 'trip screen code never calls the map service directly and has no key');
ok(!str_contains((string)file_get_contents($LOG), KEY), 'API key never written to the PHP error log');

// ---------------------------------------------------------------------
section('J. Trip workflow regression');
$routeSum = fn() => array_map(fn($t) => $p->query("CHECKSUM TABLE $t")->fetch()['Checksum'], ['client_routes', 'client_route_rates', 'client_rates', 'disbursements']);
$RS = $routeSum();
$r = Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'distance_km' => '12.00', 'distance_override_reason' => 'Extra stop']));
$id = $r['trip_id']; $t = $T($id);
ok($t['status'] === 'Pre-Assigned' && (int)one($p, "SELECT COUNT(*) AS n FROM trip_assignments WHERE trip_id=?", [$id])['n'] >= 3, 'assignment holds truck, driver and helper');
// Pre-dispatch checklist and fund release are not changed by Phase 3: set their results directly.
run($p, "UPDATE trips SET status='Ready for Dispatch' WHERE id=?", [$id]);
insert($p, 'fund_requests', ['fund_ref' => 'FR-T-1', 'trip_id' => $id, 'attempt_number' => 1, 'amount' => '1000.00', 'status' => 'Released', 'requested_by' => $wvd['id']]);
$res = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
$b = one($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]);
ok($b && $b['status'] === 'Ongoing' && $b['distance_km'] === '12.00' && $b['rate_per_km'] === '50.00' && $b['base_amount'] === '600.00',
   'billing draft = billable km x client rate per km (route flat rate NOT used; formula unchanged)', json_encode($b ? array_intersect_key($b, array_flip(['distance_km', 'rate_per_km', 'base_amount'])) : null));
fails(fn() => Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1']), 'completion without documents refused', 422, 'delivery receipt (DR) file');
foreach (['Waybill' => 'wb', 'Acknowledgement Receipt' => 'ar'] as $cat => $s) {
    $const = $cat === 'Waybill' ? (new ReflectionClassConstant('Trips', 'DOC_WAYBILL'))->getValue() : (new ReflectionClassConstant('Trips', 'DOC_AR'))->getValue();
    insert($p, 'documents', ['category' => $const, 'entity_type' => 'trip', 'entity_id' => $id, 'original_filename' => "$s.pdf", 'storage_name' => "t-$s-$id", 'mime_type' => 'application/pdf', 'byte_size' => 10, 'uploaded_by' => $wvd['id']]);
}
try { Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1']); ok(false, 'DR still required'); }
catch (BusinessRuleException $e) { ok($e->httpStatus === 422 && str_contains($e->getMessage(), 'delivery receipt') && !str_contains($e->getMessage(), 'waybill file'), 'with waybill and AR only -> still refused, only the DR is missing', $e->getMessage()); }
insert($p, 'documents', ['category' => (new ReflectionClassConstant('Trips', 'DOC_DR'))->getValue(), 'entity_type' => 'trip', 'entity_id' => $id, 'original_filename' => 'dr.pdf', 'storage_name' => "t-dr-$id", 'mime_type' => 'application/pdf', 'byte_size' => 10, 'uploaded_by' => $wvd['id']]);
Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1']);
ok($T($id)['status'] === 'Completed' && one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'For Billing', 'with the DR -> Completed, billing For Billing');
ok($T($id)['distance_source'] === 'Client Route (edited)' && $T($id)['distance_override_reason'] === 'Extra stop', 'distance record unchanged by dispatch and completion');
fails(fn() => Trips::action($ops, 'edit', ['trip_id' => $id, 'distance_km' => '1']), 'completed trip cannot be edited', 409);
ok($routeSum() === $RS, 'client routes, route rates, client rates and disbursements are not changed by creating, dispatching or completing a trip');

// ---------------------------------------------------------------------
section('K. Screen settings');
$_SESSION = ['uid' => $ops['id'], 'last_seen' => time(), 'login_at' => time() + 5];
require_once dirname(__DIR__) . '/backend/Data.php';
$me = Data::me();
ok(($me['map']['defaultRouteOption'] ?? null) === 'recommended' && ($me['map']['overrideWarningRatio'] ?? null) === 0.15 && count($me['map']['routeOptions'] ?? []) === 3,
   'screen settings: default Recommended, 15% warning, 3 options');
ok(!str_contains(json_encode($me), KEY), 'screen settings never contain the ORS key');

// ---------------------------------------------------------------------
section('L. Migration 07: partially failed import, detection and recovery');
$baseSchema = __DIR__ . '/_base_schema.sql'; $baseExt = __DIR__ . '/_base_extension.sql';
$MIG = '2026-11-07_07_trip_routing';
if (!is_file($baseSchema) || !is_file($baseExt)) {
    echo "  NOTE  git history of $MIG not available (not committed yet, or no git): partial-import check skipped. The full migration chain is checked by tests/run_route_tests.php.\n";
} else {
    $pa = test_conn($PARTIAL);
    test_import($pa, (string)file_get_contents($baseSchema));
    test_import($pa, (string)file_get_contents($baseExt));
    $parts = array_values(array_filter(array_map('trim', preg_split('/;\s*\n/', (string)preg_replace('/^\s*--.*$/m', '', test_sql("database/migrations/$MIG.sql")))), fn($s) => $s !== ''));
    ok(count($parts) === 3, 'migration has 3 statements (tracker, ALTER trips, CREATE trip_routes)', (string)count($parts));
    $pa->exec($parts[0]); $pa->exec($parts[1]);   // stops before trip_routes
    $detect = "SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id='$MIG') AS tracked,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='trip_routes') AS table_found,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='trips' AND column_name IN ('distance_source','route_option','distance_computed_km','distance_provider','distance_computed_at','distance_override_reason','client_route_id')) AS columns_found";
    $st = $pa->query($detect)->fetch();
    ok((int)$st['tracked'] === 1 && (int)$st['table_found'] === 0 && (int)$st['columns_found'] === 7, 'detection query shows the partial state (columns added, trip_routes missing)', json_encode($st));
    try { test_import($pa, test_sql("database/migrations/$MIG.sql")); ok(false, 'importing again is stopped by the tracker'); }
    catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 1062, 'importing again is stopped by the tracker (duplicate key), nothing else runs'); }
    // Recovery steps from docs/CLAUDE_05_PHASE3_TRIP_ROUTING.md (MariaDB)
    foreach (['DROP TABLE IF EXISTS trip_routes',
              'ALTER TABLE trips DROP FOREIGN KEY IF EXISTS fk_trip_client_route',
              'ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_trip_distance_source, DROP CONSTRAINT IF EXISTS chk_trip_route_option, DROP CONSTRAINT IF EXISTS chk_trip_computed_km',
              'ALTER TABLE trips DROP COLUMN IF EXISTS distance_source, DROP COLUMN IF EXISTS route_option, DROP COLUMN IF EXISTS distance_computed_km, DROP COLUMN IF EXISTS distance_provider, DROP COLUMN IF EXISTS distance_computed_at, DROP COLUMN IF EXISTS distance_override_reason, DROP COLUMN IF EXISTS client_route_id',
              "DELETE FROM schema_migrations WHERE id='$MIG'"] as $sql) $pa->exec($sql);
    test_import($pa, test_sql("database/migrations/$MIG.sql"));
    foreach (test_migrations_from($MIG) as $m) if (strcmp($m, $MIG) > 0) test_import($pa, test_sql("database/migrations/$m.sql"));
    $st = $pa->query($detect)->fetch();
    ok((int)$st['tracked'] === 1 && (int)$st['table_found'] === 1 && (int)$st['columns_found'] === 7, 'after recovery: tracked, table and 7 columns present', json_encode($st));
    $fp = test_fingerprint($pa, $PARTIAL); $ff = test_fingerprint($p, $FRESH);
    ok($fp === $ff, 'recovered database is identical to a fresh install', json_encode(array_map(fn($k) => array_values(array_diff($fp[$k], $ff[$k])) + array_values(array_diff($ff[$k], $fp[$k])), array_keys($ff))));
    $old = $pa->query("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='trips' AND column_name='distance_source' AND column_default=\"'Manual'\"")->fetchColumn();
    ok((int)$old === 1, "existing trips get distance_source 'Manual' by default");
}

// ---------------------------------------------------------------------
echo "\n----------------------------------------\n";
echo "RESULT: $PASS passed, $FAIL failed\n";
if ($FAILED) { echo "Failed:\n"; foreach ($FAILED as $f) echo "  - $f\n"; }
@unlink($LOG);
foreach ([$FRESH, $PARTIAL] as $db) test_server()->exec("DROP DATABASE IF EXISTS `$db`");
exit($FAIL === 0 ? 0 : 1);
