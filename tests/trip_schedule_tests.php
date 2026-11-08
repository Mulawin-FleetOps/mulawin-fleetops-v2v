<?php
/*
 * =====================================================================
 *  tests/trip_schedule_tests.php  —  Trip schedule restrictions (Checklist #38 / #40)
 * =====================================================================
 *  Do NOT run this file directly: run tests/run_trip_schedule_tests.php (temporary copy, own .env,
 *  disposable *_test database only).
 *
 *  Groups:
 *    A. Admin settings (defaults, range, who can change)
 *    B. Planning and approval stay allowed early
 *    C. Pre-dispatch checklist window (open and submit)
 *    D. Confirm Dispatch window, late dispatch note
 *    E. Admin changes the windows
 *    F. Date rollover (fixed clock)
 *    G. Asia/Manila timezone
 *    H. Reschedule (second attempt) and schedule edits
 *    I. Regression: fund release window (#40), trip details lock (#27), incident, completion + DR, assignment
 *    J. Screen data and code
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
core('Access');
core('Settings');

$FRESH = envValue('DB_NAME');
test_guard([$FRESH]);

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

// ---------------------------------------------------------------------
section('Setup: disposable fresh database');
test_recreate($FRESH);
$p = db();
ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');
test_import($p, test_sql('database/schema.sql'));
test_import($p, test_sql('database/extension.sql'));
$users = [];
foreach (array_keys(ROLE_LABELS) as $role) {
    $id = insert($p, 'users', ['username' => $role, 'email' => "$role@example.test", 'password_hash' => 'x', 'full_name' => strtoupper($role) . ' USER', 'role' => $role]);
    $users[$role] = ['id' => $id, 'username' => $role, 'email' => "$role@example.test", 'full_name' => strtoupper($role) . ' USER', 'role' => $role, 'shift' => null];
}
$U = fn(string $r) => $users[$r];
$ops = $U('operations_head'); $wvd = $U('container_wingvan_dispatcher'); $fin = $U('finance'); $adm = $U('admin');
Actions::load('Trips'); Actions::load('Funds'); Actions::load('Admin');
$cid = insert($p, 'clients', ['company_name' => 'SCHEDULE CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
insert($p, 'client_rates', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'rate_per_km' => '50.00', 'minimum_charge' => '0.00', 'updated_by' => $U('billing')['id']]);
for ($i = 1; $i <= 30; $i++) {
    insert($p, 'vehicles', ['plate_number' => "WV-$i", 'truck_type' => 'Wing Van']);
    insert($p, 'personnel', ['full_name' => "DRIVER, NO $i", 'person_type' => 'Driver']);
    insert($p, 'personnel', ['full_name' => "HELPER, NO $i", 'person_type' => 'Helper']);
}
$setting = function (string $key, $value) use ($p, $adm) {
    if ($value === null) run($p, 'DELETE FROM app_settings WHERE setting_key=?', [$key]);
    else run($p, 'INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [$key, (string)$value, $adm['id']]);
    Settings::clearCache();
};
$setting('inspection_min_minutes', 0);   // no inspection timer in these tests (the timer has its own rule)

$at = fn(int $minutes) => date('Y-m-d H:i:s', time() + $minutes * 60);
$T = fn(int $id) => one($p, 'SELECT * FROM trips WHERE id=?', [$id]);
$n = 0;
/** New confirmed (Pre-Assigned) trip; the schedule is then set directly to test the windows. */
$newTrip = function (int $minutesAhead) use ($ops, $cid, $p, $at, &$n): int {
    $n++;
    $r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'pickup_point' => "PICKUP $n", 'delivery_point' => "DELIVERY $n",
        'scheduled_at' => date('Y-m-d\TH:i', time() + 3 * 86400), 'distance_km' => '25.00']);
    run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [$at($minutesAhead), $r['trip_id']]);
    return (int)$r['trip_id'];
};
$items = [];
require_once dirname(__DIR__) . '/backend/Modules/Operations/Inspections/Checklist.php';
foreach (Checklist::sections() as $s) foreach ($s['items'] as $i => $label) $items[$s['key'] . '_' . str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT)] = ['condition' => 'OK', 'remarks' => ''];
$checklist = function (int $id) use ($wvd, $items) {
    Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']);
    return Trips::action($wvd, 'checklist', ['trip_id' => $id, 'items' => $items, 'meta' => [], 'odometer_km' => '1000', 'fuel_level' => 'Full']);
};
$fundReleased = function (int $id) use ($p, $wvd) {
    insert($p, 'fund_requests', ['fund_ref' => 'FR-S-' . $id, 'trip_id' => $id, 'attempt_number' => (int)one($p, 'SELECT attempt_number FROM trips WHERE id=?', [$id])['attempt_number'],
        'amount' => '500.00', 'status' => 'Released', 'requested_by' => $wvd['id']]);
};
$ready = function (int $id) use ($p, $fundReleased) { run($p, "UPDATE trips SET status='Ready for Dispatch' WHERE id=?", [$id]); $fundReleased($id); };

// ---------------------------------------------------------------------
section('A. Admin settings');
ok(Settings::value('checklist_lead_hours') === 2.0 && Settings::value('dispatch_early_minutes') === 15.0, 'defaults: checklist 2 hours, Confirm Dispatch 15 minutes before the schedule');
ok(Settings::value('fund_release_lead_hours') === 2.0, 'fund release window (#40) still defaults to 2 hours');
$keys = array_column(Settings::all(), 'key');
ok(in_array('checklist_lead_hours', $keys, true) && in_array('dispatch_early_minutes', $keys, true), 'both shown in Administration > Settings');
$r = Admin::action($adm, 'setting_save', ['key' => 'checklist_lead_hours', 'value' => '3']);
ok(Settings::value('checklist_lead_hours') === 3.0, 'Admin can change the checklist window', $r['message'] ?? '');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'checklist_lead_hours', 'value' => '25']), 'checklist window above 24 hours refused');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '-1']), 'negative dispatch minutes refused');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '241']), 'dispatch minutes above 240 refused');
fails(fn() => Admin::action($ops, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '60']), 'Operations Head cannot change the windows', 403);
fails(fn() => Admin::action($wvd, 'setting_save', ['key' => 'checklist_lead_hours', 'value' => '24']), 'dispatcher cannot change the windows', 403);
$setting('checklist_lead_hours', null);

// ---------------------------------------------------------------------
section('B. Planning and approval stay allowed early');
$id = $newTrip(3 * 1440);   // three days ahead
ok($T($id)['status'] === 'Pre-Assigned' && $T($id)['vehicle_id'] !== null, 'trip three days ahead: created, confirmed and auto-assigned');
$t = $T($id);
Trips::action($ops, 'edit', ['trip_id' => $id, 'pickup_point' => 'NEW PICKUP', 'delivery_point' => $t['delivery_point'], 'scheduled_at' => str_replace(' ', 'T', substr($t['scheduled_at'], 0, 16)), 'distance_km' => '26.00']);
ok($T($id)['pickup_point'] === 'NEW PICKUP', 'Operations Head can still edit the details before dispatch (#27)');
Trips::action($wvd, 'edit', ['trip_id' => $id, 'booking_reference' => 'BK-EARLY']);
ok($T($id)['booking_reference'] === 'BK-EARLY', 'dispatcher can still fill in booking details early');
$f = Funds::action($wvd, 'submit', ['trip_id' => $id, 'categories' => ['Driver Meal Allowance', 'Helper Meal Allowance']]);
ok(!empty($f['fund_id']), 'fund request can be submitted early');
Funds::action($ops, 'decide', ['fund_id' => $f['fund_id'], 'decision' => 'approve']);
ok(one($p, 'SELECT status FROM fund_requests WHERE id=?', [$f['fund_id']])['status'] === 'Ready for Release', 'fund request can be approved early');
fails(fn() => Funds::action($fin, 'release', ['fund_id' => $f['fund_id'], 'payment_method' => 'Cash', 'released_on' => date('Y-m-d')]), 'fund release still refused early (#40 phase 1)', 409, 'Too early');
fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'opening the pre-dispatch checklist three days early refused', 409, 'Too early for the pre-dispatch checklist');
ok(!one($p, 'SELECT 1 AS x FROM checklist_starts WHERE trip_id=?', [$id]), 'no checklist start recorded');
fails(fn() => Trips::action($wvd, 'checklist', ['trip_id' => $id, 'items' => $items, 'meta' => []]), 'submitting the checklist directly (API) three days early refused', 409, 'Too early');
ok($T($id)['status'] === 'Pre-Assigned' && !one($p, 'SELECT 1 AS x FROM inspections WHERE trip_id=?', [$id]), 'status unchanged, no inspection saved');
$c = $newTrip(3 * 1440);
Trips::action($ops, 'cancel', ['trip_id' => $c, 'reason' => 'Client cancelled']);
ok($T($c)['status'] === 'Cancelled', 'a trip can still be cancelled before its schedule');

// ---------------------------------------------------------------------
section('C. Pre-dispatch checklist window');
$id = $newTrip(121);
fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'scheduled in 2 h 1 min: checklist not open yet', 409, 'opens');
try { Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']); }
catch (BusinessRuleException $e) { ok(str_contains($e->getMessage(), 'Philippine time') && str_contains($e->getMessage(), '2 hour(s) before'), 'message gives the opening time, the scheduled time and the window', $e->getMessage()); }
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [$at(119), $id]);
$r = $checklist($id);
ok($T($id)['status'] === 'Ready for Dispatch', 'scheduled in 1 h 59 min: checklist opened and submitted -> Ready for Dispatch', json_encode($r));
$id2 = $newTrip(90);
Trips::action($wvd, 'checklist_start', ['trip_id' => $id2, 'kind' => 'Pre-Dispatch']);
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [$at(300), $id2]);   // Operations Head moved the trip later
fails(fn() => Trips::action($wvd, 'checklist', ['trip_id' => $id2, 'items' => $items, 'meta' => []]), 'checklist opened in the window, schedule moved later -> submit refused (re-checked on submit)', 409, 'Too early');
$id3 = $newTrip(-30);
$checklist($id3);
ok($T($id3)['status'] === 'Ready for Dispatch', 'schedule already passed: checklist still allowed');

// ---------------------------------------------------------------------
section('D. Confirm Dispatch window and late dispatch');
$id = $newTrip(30); $ready($id);
$det = Trips::action($wvd, 'details', ['trip_id' => $id]);
$bl = implode(' ', $det['trip']['dispatch_blockers']);
ok(str_contains($bl, 'Confirm Dispatch opens') && str_contains($bl, 'Philippine time') && count($det['trip']['dispatch_blockers']) === 1, 'Ready + Released, scheduled in 30 min: only the schedule blocks, with the time', $bl);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Confirm Dispatch 30 min early refused (server side)', 409, 'Confirm Dispatch opens');
ok($T($id)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$id]) && $T($id)['dispatched_at'] === null, 'refused dispatch: status, dispatch time and billing untouched');
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [$at(14), $id]);
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
ok($T($id)['status'] === 'Dispatched' && !str_contains($r['message'], 'late') && !str_contains($r['message'], 'after the scheduled'), 'scheduled in 14 min (15-min allowance): dispatch confirmed, no late note', $r['message']);
ok(one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'Ongoing', 'billing draft still generated at dispatch');
$id = $newTrip(-90); $ready($id);
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
$ev = one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='dispatch confirmed'", [$id]);
ok($T($id)['status'] === 'Dispatched' && str_contains($r['message'], 'after the scheduled time') && preg_match('/1 h (29|30|31) min after the scheduled time/', (string)$ev['notes']) === 1,
   'late by 1 h 30 min: dispatch allowed and noted in the history', (string)$ev['notes']);
$id = $newTrip(10);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'in the window but not Ready for Dispatch / no fund: still refused', 409, 'Ready for Dispatch');
$det = Trips::action($wvd, 'details', ['trip_id' => $id]);
ok(!str_contains(implode(' ', $det['trip']['dispatch_blockers']), 'opens'), 'inside the window the schedule is not listed as a blocker');

// ---------------------------------------------------------------------
section('E. Admin changes the windows');
$setting('checklist_lead_hours', 0);
$id = $newTrip(30);
fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'checklist window 0: 30 min early refused', 409, 'at the time before');
$setting('checklist_lead_hours', 1.5);
$checklist($id);
ok($T($id)['status'] === 'Ready for Dispatch', 'checklist window 1.5 hours: 30 min early allowed');
$fundReleased($id);
$setting('dispatch_early_minutes', 0);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'dispatch allowance 0: 30 min early refused', 409);
$setting('dispatch_early_minutes', 60);
Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
ok($T($id)['status'] === 'Dispatched', 'dispatch allowance 60 min: 30 min early allowed');
$setting('checklist_lead_hours', null); $setting('dispatch_early_minutes', null);

// ---------------------------------------------------------------------
section('F. Date rollover (fixed clock, Philippine time)');
$sched = ['scheduled_at' => '2026-11-09 00:30:00'];
$g = Trips::timeGates($sched, strtotime('2026-11-08 22:29:59'));
ok($g['checklist_opens_at'] === '2026-11-08 22:30:00' && $g['checklist_allowed_now'] === false, '12:30 AM trip: checklist opens 10:30 PM the evening before; closed at 10:29:59 PM', json_encode($g));
ok(Trips::timeGates($sched, strtotime('2026-11-08 22:30:00'))['checklist_allowed_now'] === true, 'open at 10:30:00 PM the day before (counted in hours, not dates)');
ok(Trips::timeGates($sched, strtotime('2026-11-08 23:59:59'))['dispatch_allowed_now'] === false, 'Confirm Dispatch still closed before midnight');
ok($g['dispatch_opens_at'] === '2026-11-09 00:15:00' && Trips::timeGates($sched, strtotime('2026-11-09 00:15:00'))['dispatch_allowed_now'] === true, 'Confirm Dispatch opens 12:15 AM on the scheduled date');
$g = Trips::timeGates(['scheduled_at' => '2027-01-01 01:00:00'], strtotime('2026-12-31 23:00:00'));
ok($g['checklist_allowed_now'] === true && $g['checklist_opens_at'] === '2026-12-31 23:00:00', 'year rollover (Jan 1, 1:00 AM): checklist opens Dec 31, 11:00 PM');
$g = Trips::timeGates(['scheduled_at' => '2026-11-09 08:00:00'], strtotime('2026-11-09 10:05:00'));
ok($g['late_minutes'] === 125 && $g['dispatch_allowed_now'] === true, 'late minutes counted after the schedule (2 h 5 min)');
$setting('checklist_lead_hours', 24);
ok(Trips::timeGates(['scheduled_at' => '2026-11-09 06:00:00'], strtotime('2026-11-08 06:00:00'))['checklist_allowed_now'] === true, 'window of 24 hours opens at the same time the previous day');
$setting('checklist_lead_hours', null);

// ---------------------------------------------------------------------
section('G. Asia/Manila timezone');
ok(date_default_timezone_get() === 'Asia/Manila', 'PHP timezone is Asia/Manila');
ok($p->query('SELECT @@session.time_zone')->fetchColumn() === '+08:00', 'database session uses +08:00 (same clock as PHP)');
$g = Trips::timeGates(['scheduled_at' => '2026-11-09 00:30:00'], gmmktime(16, 15, 0, 11, 8, 2026));   // 16:15 UTC = 12:15 AM PH
ok($g['dispatch_allowed_now'] === true && Trips::timeGates(['scheduled_at' => '2026-11-09 00:30:00'], gmmktime(16, 14, 59, 11, 8, 2026))['dispatch_allowed_now'] === false,
   'schedule is read as Philippine time: 12:30 AM PH = 4:30 PM UTC the day before');
ok(strtotime($g['checklist_opens_at']) === gmmktime(14, 30, 0, 11, 8, 2026), 'checklist opening time is 2:30 PM UTC (10:30 PM PH)');
$dbNow = strtotime((string)$p->query('SELECT NOW()')->fetchColumn());
ok(abs($dbNow - time()) <= 5, 'database NOW() and PHP time agree (dispatched_at and the windows use the same clock)');

// ---------------------------------------------------------------------
section('H. Reschedule (second attempt) and schedule edits');
$id = $newTrip(5); $ready($id);
Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
// After a major incident and repair (the Maintenance flow is not repeated here): trip For Reschedule, truck back to Assigned.
run($p, "UPDATE trips SET status='For Reschedule' WHERE id=?", [$id]);
run($p, "UPDATE vehicles SET status='Assigned' WHERE id=?", [$T($id)['vehicle_id']]);
$r = Trips::action($wvd, 'reschedule', ['trip_id' => $id, 'scheduled_at' => date('Y-m-d\TH:i', time() + 5 * 3600)]);
$t = $T($id);
ok($t['status'] === 'Pre-Assigned' && (int)$t['attempt_number'] === 2, 'reschedule (attempt 2) allowed any time, 5 hours ahead');
fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'attempt 2: checklist follows the NEW schedule (5 h ahead -> closed)', 409, 'Too early');
Trips::action($ops, 'edit', ['trip_id' => $id, 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'], 'scheduled_at' => date('Y-m-d\TH:i', time() + 3600), 'distance_km' => $t['distance_km']]);
$checklist($id);
ok($T($id)['status'] === 'Ready for Dispatch', 'Operations Head moves attempt 2 to 1 hour ahead -> checklist allowed');
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Confirm Redispatch 1 hour early refused', 409, 'Confirm Dispatch opens');
$t = $T($id);
Trips::action($ops, 'edit', ['trip_id' => $id, 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'], 'scheduled_at' => date('Y-m-d\TH:i', time() + 360), 'distance_km' => $t['distance_km']]);
ok($T($id)['status'] === 'Ready for Dispatch', 'schedule edit after the checklist keeps Ready for Dispatch (no new checklist)');
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
ok($T($id)['status'] === 'Dispatched' && str_contains($r['message'], 'Redispatch confirmed'), 'Confirm Redispatch allowed inside the new window (redispatch fund optional)', $r['message']);
$id = $newTrip(10); $ready($id);
$t = $T($id);
Trips::action($ops, 'edit', ['trip_id' => $id, 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'], 'scheduled_at' => date('Y-m-d\TH:i', time() + 4 * 3600), 'distance_km' => $t['distance_km']]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Ready trip moved 4 hours later -> Confirm Dispatch closed again', 409, 'Confirm Dispatch opens');

// ---------------------------------------------------------------------
section('I. Regression');
$id = $newTrip(300);
foreach (['incident' => ['incident_type' => 'Breakdown', 'incident_at' => date('Y-m-d\TH:i'), 'location' => 'X', 'problem' => 'Y', 'details' => 'Z'],
          'complete' => ['completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1'], 'resume' => []] as $act => $extra)
    fails(fn() => Trips::action($wvd, $act, ['trip_id' => $id] + $extra), "$act before dispatch refused (status rule unchanged)", 409);
fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Arrival']), 'arrival checklist not pending before the trip', 409);
$id = $newTrip(5); $ready($id);
Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
fails(fn() => Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-2']), 'completion still needs the documents incl. the DR', 422, 'delivery receipt (DR) file');
fails(fn() => Trips::action($wvd, 'edit', ['trip_id' => $id, 'booking_reference' => 'X']), 'trip details lock after dispatch (#27) unchanged', 409);
$r = Trips::action($wvd, 'incident', ['trip_id' => $id, 'incident_type' => 'Breakdown', 'incident_at' => date('Y-m-d\TH:i'), 'location' => 'SLEX', 'problem' => 'Flat tire', 'details' => 'Rear tire']);
ok($T($id)['status'] === 'On Hold - Incident Reported', 'incident report after dispatch still works');
$id = $newTrip(60);
$f = Funds::action($wvd, 'submit', ['trip_id' => $id, 'categories' => ['Driver Meal Allowance']]);
Funds::action($ops, 'decide', ['fund_id' => $f['fund_id'], 'decision' => 'approve']);
Funds::action($fin, 'release', ['fund_id' => $f['fund_id'], 'payment_method' => 'Cash', 'released_on' => date('Y-m-d')]);
ok(one($p, 'SELECT status FROM fund_requests WHERE id=?', [$f['fund_id']])['status'] === 'Released', 'fund release inside its own window (1 h ahead, #40) unchanged');
$checklist($id);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'checklist done and fund released 1 hour ahead: dispatch still waits for its own window', 409, 'Confirm Dispatch opens');
fails(fn() => Trips::action($U('car_carrier_dispatcher'), 'dispatch', ['trip_id' => $id]), 'other dispatcher team still refused', 403);

// ---------------------------------------------------------------------
section('J. Screen data and code');
$det = Trips::action($ops, 'details', ['trip_id' => $id]);
$g = $det['trip']['time_gates'] ?? [];
ok(isset($g['scheduled_at'], $g['checklist_opens_at'], $g['dispatch_opens_at']) && $g['checklist_allowed_now'] === true && $g['dispatch_allowed_now'] === false && $g['late_minutes'] === 0,
   'trip details give the schedule, opening times and flags', json_encode($g));
$js = (string)file_get_contents(dirname(__DIR__) . '/public/assets/js/modules/operations/trips.js');
ok(str_contains($js, 'CHECKLIST_38_40_TRIP_TIME_GATES_V1') && str_contains($js, 'checklist_allowed_now') && str_contains($js, 'gates.dispatch_opens_at'), 'trip screen disables the checklist and shows the windows');
ok(str_contains($js, 'CHECKLIST_27_TRIP_DETAILS_LOCK_V1'), 'trip screen keeps the #27 lock');

echo "\n----------------------------------------\n";
echo "RESULT: $PASS passed, $FAIL failed\n";
if ($FAILED) { echo "Failed:\n"; foreach ($FAILED as $f) echo "  - $f\n"; }
test_server()->exec("DROP DATABASE IF EXISTS `$FRESH`");
exit($FAIL === 0 ? 0 : 1);
