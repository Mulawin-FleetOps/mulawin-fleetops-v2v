<?php
/*
 * =====================================================================
 *  tests/crew_dispatch_tests.php  —  Checklist #42 Phase 2: attendance enforcement
 * =====================================================================
 *  Do NOT run this file directly: run tests/run_crew_dispatch_tests.php (temporary copy, own .env,
 *  disposable *_test database only). Includes a two-process concurrency test.
 *
 *    A. Warn / Enforce setting and the Enforce guard
 *    B. Enforce: Confirm Dispatch needs Present crew on their own shift (+ availability, license)
 *    C. Warn: dispatch allowed, unconfirmed attendance noted
 *    D. Cross-shift early dispatch (actual dispatch time decides)
 *    E. Overnight duty dates (fixed clock)
 *    F. Shift-aware auto-assignment, Absent skipped, Warn fallback flagged, Enforce no fallback
 *    G. Operations Head notice for Absent assigned crew (deduplicated)
 *    H. Second attempt (Redispatch)
 *    I. Attendance changed at the same moment as Confirm Dispatch (two processes)
 *    J. Readiness report and regression (active trips, checklist, time gates, billing)
 *    K. Manual reassignment (shift labels, Absent, Warn fallback, Enforce refusal)
 *    L. Required crew at Confirm Dispatch / Redispatch (both modes, direct API)
 *    M. Car Carrier auto-assignment needs two eligible drivers (no partial reservation)
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
core('Access');
core('Settings');
core('CrewAttendance');
core('Notify');

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
$adm = $U('admin'); $ops = $U('operations_head'); $wvd = $U('container_wingvan_dispatcher'); $ccd = $U('car_carrier_dispatcher');
Actions::load('Attendance'); Actions::load('Admin'); Actions::load('Trips'); Actions::load('Funds');
$setting = function (string $key, $value) use ($p, $adm) {
    if ($value === null) run($p, 'DELETE FROM app_settings WHERE setting_key=?', [$key]);
    else run($p, 'INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [$key, (string)$value, $adm['id']]);
    Settings::clearCache();
};
// Put "now" in the middle of a Day shift (4 hours from either boundary), whatever the real clock says.
$h = (int)date('G');
$DAY = ($h + 20) % 24; $NIGHT = ($h + 4) % 24;
$setting('attendance_day_start_hour', $DAY); $setting('attendance_night_start_hour', $NIGHT);
$setting('inspection_min_minutes', 0);
$NOW = CrewAttendance::shiftFor();
ok($NOW['shift'] === 'Day', 'test clock: now is inside a Day shift', json_encode($NOW));
$cid = insert($p, 'clients', ['company_name' => 'ATT DISPATCH CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
foreach (['Wing Van' => '50.00', 'Car Carrier' => '80.00'] as $type => $rate) insert($p, 'client_rates', ['client_id' => $cid, 'truck_type' => $type, 'rate_per_km' => $rate, 'minimum_charge' => '0.00', 'updated_by' => $U('billing')['id']]);
for ($i = 1; $i <= 30; $i++) { insert($p, 'vehicles', ['plate_number' => "WV-$i", 'truck_type' => 'Wing Van']); insert($p, 'vehicles', ['plate_number' => "CC-$i", 'truck_type' => 'Car Carrier']); }
$pn = 0;
$person = function (string $type, ?string $shift, string $label = '') use ($p, &$pn): int {
    $pn++;
    return insert($p, 'personnel', ['full_name' => strtoupper("$type $label $pn"), 'person_type' => $type, 'duty_shift' => $shift,
        'license_number' => $type === 'Driver' ? "LIC-$pn" : null, 'license_expiry' => $type === 'Driver' ? date('Y-m-d', strtotime('+1 year')) : null]);
};
/** Only these people are free for auto-assignment (everyone else not on a trip is made Unavailable). */
$only = function (array $ids) use ($p) {
    run($p, "UPDATE personnel SET availability='Unavailable' WHERE availability='Available'");
    if ($ids) run($p, "UPDATE personnel SET availability='Available' WHERE id IN (" . implode(',', array_map('intval', $ids)) . ") AND availability='Unavailable'");
};
$mark = function (int $pid, string $date, string $shift, ?string $status) use ($p, $adm) {
    run($p, 'DELETE FROM attendance_marks WHERE personnel_id=? AND duty_date=? AND duty_shift=?', [$pid, $date, $shift]);
    if ($status) insert($p, 'attendance_marks', ['duty_date' => $date, 'duty_shift' => $shift, 'personnel_id' => $pid, 'status' => $status, 'marked_by' => $adm['id']]);
};
$present = fn(array $ids) => array_map(fn($id) => $mark($id, $NOW['date'], 'Day', 'Present'), $ids);
$T = fn(int $id) => one($p, 'SELECT * FROM trips WHERE id=?', [$id]);
$tn = 0;
/** Trip auto-assigned with only $crew free; schedule then set to $minutesAhead (default: 5 min, inside the dispatch window). */
$trip = function (array $crew, int $minutesAhead = 5, string $type = 'Wing Van', ?int $createAheadMinutes = null) use ($ops, $cid, $p, $only, &$tn): int {
    $tn++; $only($crew);
    $r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => $type, 'pickup_point' => "P$tn", 'delivery_point' => "D$tn",
        'scheduled_at' => date('Y-m-d\TH:i', time() + ($createAheadMinutes ?? 30) * 60), 'distance_km' => '20']);
    run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [date('Y-m-d H:i:s', time() + $minutesAhead * 60), $r['trip_id']]);
    return (int)$r['trip_id'];
};
$ready = function (int $id) use ($p, $wvd) {
    $t = one($p, 'SELECT vehicle_id, attempt_number FROM trips WHERE id=?', [$id]);
    insert($p, 'inspections', ['trip_id' => $id, 'vehicle_id' => $t['vehicle_id'], 'attempt_number' => $t['attempt_number'], 'kind' => 'Pre-Dispatch', 'items_json' => '{}', 'actor_id' => $wvd['id'], 'completed_at' => date('Y-m-d H:i:s')]);
    run($p, "UPDATE trips SET status='Ready for Dispatch' WHERE id=?", [$id]);
    if ((int)$t['attempt_number'] === 1) insert($p, 'fund_requests', ['fund_ref' => 'FR-A-' . $id, 'trip_id' => $id, 'attempt_number' => 1, 'amount' => '500.00', 'status' => 'Released', 'requested_by' => $wvd['id']]);
};
$enforce = fn() => $setting('crew_attendance_dispatch_check', 2);
$warn = fn() => $setting('crew_attendance_dispatch_check', null);

// ---------------------------------------------------------------------
section('A. Warn / Enforce setting and the Enforce guard');
ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'default mode: Warn');
$all = array_column(Settings::all(), null, 'key');
ok(($all['crew_attendance_dispatch_check']['format'] ?? '') === 'attendance_mode' && $all['crew_attendance_dispatch_check']['value'] === 1.0, 'setting listed for the Admin screen (Warn / Enforce)');
$noShift = $person('Helper', null, 'noshift');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '2']), 'Enforce refused while a helper has no shift (names listed)', 409, 'HELPER NOSHIFT');
ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'still Warn after the refusal');
foreach (['3', '0', '1.5', 'Enforce', ''] as $v) fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => $v]), "value '$v' refused", 400);
fails(fn() => Admin::action($ops, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '2']), 'Operations Head cannot change the mode', 403);
run($p, "UPDATE personnel SET duty_shift='Night' WHERE id=?", [$noShift]);
$r = Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '2']);
ok(CrewAttendance::mode() === CrewAttendance::MODE_ENFORCE && str_contains($r['message'], 'Enforce'), 'every crew member has a shift: Enforce on', $r['message']);
$a = one($p, "SELECT c.changes_json FROM audit_events a JOIN audit_event_changes c ON c.audit_event_id=a.id WHERE a.action='setting changed' ORDER BY a.id DESC LIMIT 1");
ok(str_contains((string)$a['changes_json'], '"Warn"') && str_contains((string)$a['changes_json'], '"Enforce"'), 'Activity Log: Warn -> Enforce', (string)$a['changes_json']);
$late = $person('Driver', null, 'late');
Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '1']);
ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'switching back to Warn is always allowed (rollback)');
run($p, "UPDATE personnel SET duty_shift='Day' WHERE id=?", [$late]);

// ---------------------------------------------------------------------
section('B. Enforce: Confirm Dispatch needs Present crew on their own shift');
$enforce();
$D = $person('Driver', 'Day', 'b'); $H = $person('Helper', 'Day', 'b');
$id = $trip([$D, $H]); $ready($id);
ok((int)$T($id)['driver_id'] === $D && (int)$T($id)['helper_id'] === $H, 'trip assigned to the Day crew');
$det = Trips::action($ops, 'details', ['trip_id' => $id])['trip'];
ok(($det['crew_attendance']['mode'] ?? '') === 'Enforce' && count($det['crew_attendance']['crew']) === 2 && str_contains(implode(' ', $det['dispatch_blockers']), 'not yet marked Present'),
   'trip details: attendance per crew member and the reason in the dispatch blockers', json_encode($det['dispatch_blockers']));
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Not Yet Marked: Confirm Dispatch refused (direct API call)', 409, 'not yet marked Present for the Day shift');
ok($T($id)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$id]), 'refused dispatch: status and billing untouched');
$present([$D]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'driver Present, helper Not Yet Marked: refused', 409, '(Helper) is not yet marked Present');
$mark($H, $NOW['date'], 'Day', 'Absent');
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper Absent: refused with the Absent reason', 409, 'marked Absent');
$mark($H, $NOW['date'], 'Day', 'Present');
run($p, "UPDATE personnel SET availability='Unavailable' WHERE id=?", [$H]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Present but Unavailable: still refused (Present does not bypass availability)', 409, 'marked Unavailable');
run($p, "UPDATE personnel SET availability='On Trip' WHERE id=?", [$H]);
run($p, 'UPDATE personnel SET license_expiry=? WHERE id=?', [date('Y-m-d', strtotime('-1 day')), $D]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Present but license expired: still refused', 409, 'license is expired');
run($p, 'UPDATE personnel SET license_expiry=? WHERE id=?', [date('Y-m-d', strtotime('+1 year')), $D]);
run($p, "UPDATE personnel SET duty_shift='Night' WHERE id=?", [$H]);
$mark($H, $NOW['date'], 'Night', 'Present');
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper on the Night shift (Present for Night): refused, other-shift attendance not accepted', 409, 'is on the Night shift, but Confirm Dispatch now falls in the Day shift');
run($p, 'UPDATE personnel SET duty_shift=NULL WHERE id=?', [$H]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper with no shift: refused', 409, 'has no assigned shift');
run($p, "UPDATE personnel SET duty_shift='Day' WHERE id=?", [$H]);
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
ok($T($id)['status'] === 'Dispatched' && one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'Ongoing' && !str_contains($r['message'], 'Attendance'), 'all Present on their shift: dispatched, billing draft made, no attendance note');
// Car Carrier: Driver 2 is checked too.
$C1 = $person('Driver', 'Day', 'cc'); $C2 = $person('Driver', 'Day', 'cc');
$cc = $trip([$C1, $C2], 5, 'Car Carrier'); $ready($cc);
ok((int)$T($cc)['driver2_id'] > 0, 'Car Carrier trip has Driver 2');
$present([$C1]);
fails(fn() => Trips::action($ccd, 'dispatch', ['trip_id' => $cc]), 'Car Carrier: Driver 2 not marked -> refused', 409, '(Driver 2) is not yet marked Present');
$present([$C2]);
Trips::action($ccd, 'dispatch', ['trip_id' => $cc]);
ok($T($cc)['status'] === 'Dispatched', 'Car Carrier: both drivers Present -> dispatched');

// ---------------------------------------------------------------------
section('C. Warn: dispatch allowed, unconfirmed attendance noted');
$warn();
$D = $person('Driver', 'Day', 'c'); $H = $person('Helper', 'Night', 'c');
$id = $trip([$D, $H]); $ready($id);
$det = Trips::action($ops, 'details', ['trip_id' => $id])['trip'];
ok(!preg_grep('/attendance|Present|shift/i', $det['dispatch_blockers']) && $det['crew_attendance']['mode'] === 'Warn', 'Warn: attendance is not a blocker, but shown in the trip details');
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
$ev = one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='dispatch confirmed'", [$id]);
ok($T($id)['status'] === 'Dispatched' && str_contains((string)$ev['notes'], 'Attendance not confirmed (Warn mode)') && str_contains((string)$ev['notes'], 'not yet marked Present')
   && str_contains((string)$ev['notes'], 'is on the Night shift') && str_contains($r['message'], 'Attendance not confirmed'), 'dispatched; history and message say attendance was not confirmed (never shown as Present)', (string)$ev['notes']);
$D = $person('Driver', 'Day', 'c2'); $H = $person('Helper', 'Day', 'c2');
$id = $trip([$D, $H]); $ready($id); $present([$D, $H]);
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $id]);
ok(!str_contains($r['message'], 'Attendance') && !str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='dispatch confirmed'", [$id])['notes'], 'Attendance'), 'Warn with everyone Present: no note');

// ---------------------------------------------------------------------
section('D. Cross-shift early dispatch (actual dispatch time decides)');
$enforce();
$nightStart = ($h + 1) % 24;   // Night starts at the next full hour
$setting('attendance_night_start_hour', $nightStart); $setting('attendance_day_start_hour', ($h + 13) % 24);
$setting('dispatch_early_minutes', 120);
$nowShift = CrewAttendance::shiftFor();
$nextNight = CrewAttendance::shiftFor(mktime($nightStart, 0, 0) + ($nightStart === 0 ? 86400 : 0));
ok($nowShift['shift'] === 'Day' && $nextNight['shift'] === 'Night', 'clock: Day now, Night from the next hour', json_encode([$nowShift, $nextNight]));
$ND = $person('Driver', 'Night', 'd'); $NH = $person('Helper', 'Night', 'd');
$minsToNight = (int)ceil((mktime($nightStart, 0, 0) + ($nightStart === 0 ? 86400 : 0) - time()) / 60);
$id = $trip([$ND, $NH], $minsToNight + 5, 'Wing Van', $minsToNight + 5); $ready($id);
ok((int)$T($id)['driver_id'] === $ND, 'Night trip assigned to the Night crew (scheduled shift)');
foreach ([$ND, $NH] as $x) $mark($x, $nextNight['date'], 'Night', 'Present');
$gates = Trips::timeGates($T($id));
ok($gates['dispatch_allowed_now'] === true, 'trip 5 min after the Night start: inside the (120-min) early dispatch window');
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Night crew (Present for tonight) before the Night shift starts: refused', 409, 'Confirm Dispatch now falls in the Day shift');
try { Trips::action($wvd, 'dispatch', ['trip_id' => $id]); } catch (BusinessRuleException $e) {
    ok(str_contains($e->getMessage(), 'Wait for the Night shift (from ' . CrewAttendance::hourLabel($nightStart) . ')'), 'message says when the Night shift starts', $e->getMessage()); }
$after = CrewAttendance::dispatchFindings($p, $T($id), mktime($nightStart, 0, 30) + ($nightStart === 0 ? 86400 : 0));
ok(!array_filter(array_column($after['crew'], 'problem')), 'at the Night start (same trip, same marks): no attendance problem');
$setting('dispatch_early_minutes', null);
$setting('attendance_day_start_hour', $DAY); $setting('attendance_night_start_hour', $NIGHT);

// ---------------------------------------------------------------------
section('E. Overnight duty dates (fixed clock, 6:00 AM / 6:00 PM)');
$setting('attendance_day_start_hour', null); $setting('attendance_night_start_hour', null);
$N = $person('Driver', 'Night', 'e'); $DY = $person('Driver', 'Day', 'e');
$fake = ['id' => 0, 'driver_id' => $N, 'driver2_id' => null, 'helper_id' => null];
$mark($N, '2026-11-07', 'Night', 'Present');
$f = fn(string $local, array $t) => CrewAttendance::dispatchFindings($p, $t, strtotime($local))['crew'][0];
ok($f('2026-11-08 00:30:00', $fake)['problem'] === null, '00:30 Nov 8: Present for the Night shift of Nov 7 counts');
ok($f('2026-11-08 05:59:00', $fake)['problem'] === null, '05:59 Nov 8: still the Night shift of Nov 7');
ok(str_contains((string)$f('2026-11-08 18:30:00', $fake)['problem'], 'not yet marked Present for the Night shift of Nov 8, 2026'), '18:30 Nov 8: needs the Night shift of Nov 8 (Nov 7 mark does not count)');
$mark($N, '2026-11-08', 'Night', 'Absent');
ok(str_contains((string)$f('2026-11-09 03:00:00', $fake)['problem'], 'marked Absent for the Night shift of Nov 8, 2026'), '03:00 Nov 9: Absent for the Night shift of Nov 8');
$mark($DY, '2026-11-08', 'Day', 'Present');
ok(str_contains((string)$f('2026-11-08 05:55:00', ['id' => 0, 'driver_id' => $DY])['problem'], 'falls in the Night shift of Nov 7, 2026'), '05:55: Day crew Present for Nov 8 Day is still before the Day shift');
ok($f('2026-11-08 06:00:00', ['id' => 0, 'driver_id' => $DY])['problem'] === null, '06:00: Day shift of Nov 8 -> OK');
$setting('attendance_day_start_hour', $DAY); $setting('attendance_night_start_hour', $NIGHT);

// ---------------------------------------------------------------------
section('F. Shift-aware auto-assignment');
$warn();
$dD = $person('Driver', 'Day', 'f'); $dN = $person('Driver', 'Night', 'f'); $hD = $person('Helper', 'Day', 'f'); $hN = $person('Helper', 'Night', 'f'); $hX = $person('Helper', null, 'f');
$id = $trip([$dD, $dN, $hD, $hN, $hX], 5, 'Wing Van', 1440);
$t = $T($id);
ok((int)$t['driver_id'] === $dD && (int)$t['helper_id'] === $hD && !str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'fallback'),
   'Day trip (tomorrow, Not Yet Marked): same-shift crew picked, no fallback');
$nightTomorrow = mktime($NIGHT, 30, 0) + ($NIGHT <= $h ? 86400 : 0) + 86400;
$only([$dD, $dN, $hD, $hN]);
$r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'pickup_point' => 'NIGHT P', 'delivery_point' => 'NIGHT D', 'scheduled_at' => date('Y-m-d\TH:i', $nightTomorrow), 'distance_km' => '20']);
$t = $T($r['trip_id']);
ok((int)$t['driver_id'] === $dN && (int)$t['helper_id'] === $hN, 'Night trip: Night crew picked (scheduled shift used for planning)');
Trips::action($ops, 'cancel', ['trip_id' => $r['trip_id'], 'reason' => 'test']);
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
// Absent for the trip's (current) shift is never picked.
$hD2 = $person('Helper', 'Day', 'f2');
$mark($hD, $NOW['date'], 'Day', 'Absent');
$id = $trip([$dD, $hD, $hD2], 30, 'Wing Van', 30);
ok((int)$T($id)['helper_id'] === $hD2, 'Day helper marked Absent for this shift skipped; the other Day helper picked');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
// Warn fallback: only Night / no-shift helpers free for a Day trip.
$c0 = (int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn();
$id = $trip([$dD, $hD, $hN], 30, 'Wing Van', 30);
$t = $T($id);
$ev = (string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'];
ok((int)$t['helper_id'] === $hN && $t['status'] === 'Pre-Assigned', 'Warn: no free Day helper (the Day one is Absent) -> Night helper as fallback, never the Absent one');
ok(str_contains($ev, 'Shift fallback (Warn mode)') && str_contains($ev, '(Helper, Night shift)') && str_contains($ev, 'Attendance is NOT verified'), 'fallback written in the trip history', $ev);
ok((int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn() === $c0 + 1, 'fallback audited');
ok((bool)one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ? AND user_id=?", ['trip-shift-fallback-' . $id . '-1-%', $ops['id']]), 'Operations Head notified of the fallback');
$det = Trips::action($ops, 'details', ['trip_id' => $id])['trip'];
$hc = array_values(array_filter($det['crew_attendance']['crew'], fn($c) => $c['role'] === 'Helper'))[0];
ok($hc['outside_scheduled_shift'] === true && $hc['problem'] !== null && $hc['issue'] === 'Shift mismatch', 'trip screen flags the helper: outside the trip shift, "Shift mismatch" (not Present)');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$id = $trip([$dD, $hX], 30, 'Wing Van', 30);
ok((int)$T($id)['helper_id'] === $hX && str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'no assigned shift'), 'Warn: helper with no shift as fallback, flagged');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$enforce();
$id = $trip([$dD, $hD, $hN], 30, 'Wing Van', 30);
$t = $T($id);
ok($t['status'] === 'Awaiting Resources' && $t['helper_id'] === null, 'Enforce: no cross-shift fallback -> Awaiting Resources');
ok(str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? ORDER BY id DESC LIMIT 1", [$id])['notes'], 'No Day-shift helper is available (Enforce mode'), 'reason names the shift and Enforce mode');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$mark($hD, $NOW['date'], 'Day', null);
run($p, "UPDATE personnel SET availability='Available' WHERE id=?", [$hD]);
run($p, "UPDATE personnel SET availability='Unavailable' WHERE id=?", [$hD]);
$hD3 = $person('Helper', 'Day', 'f3'); $mark($hD3, $NOW['date'], 'Day', 'Present'); run($p, "UPDATE personnel SET availability='Unavailable' WHERE id=?", [$hD3]);
$only([$dD]); run($p, "UPDATE personnel SET availability='Unavailable' WHERE id=?", [$hD3]);
$r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'pickup_point' => 'X', 'delivery_point' => 'Y', 'scheduled_at' => date('Y-m-d\TH:i', time() + 1800), 'distance_km' => '20']);
ok($T($r['trip_id'])['status'] === 'Awaiting Resources', 'Present but Unavailable helper is never auto-assigned (availability first)');
Trips::action($ops, 'cancel', ['trip_id' => $r['trip_id'], 'reason' => 'test']);
$warn();

// ---------------------------------------------------------------------
section('G. Operations Head notice for Absent assigned crew');
$roster = function (string $date, string $shift) use ($adm) { return Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $date, 'duty_shift' => $shift])['rows']; };
$save = function (string $date, string $shift, array $set) use ($adm, $roster) {
    $items = array_map(fn($r) => ['id' => (int)$r['id'], 'status' => array_key_exists((int)$r['id'], $set) ? $set[(int)$r['id']] : $r['status']], $roster($date, $shift));
    return Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $date, 'duty_shift' => $shift, 'items' => $items]);
};
$gD = $person('Driver', 'Day', 'g'); $gH = $person('Helper', 'Day', 'g');
$gid = $trip([$gD, $gH], 30, 'Wing Van', 30);
$key = 'att-absent-' . $gH . '-' . $NOW['date'] . '-Day-' . $gid;
$notes = fn() => many($p, 'SELECT user_id, state, message FROM notifications WHERE dedupe_key=?', [$key]);
$save($NOW['date'], 'Day', [$gH => 'Absent']);
$n = $notes();
ok(count($n) === 1 && (int)$n[0]['user_id'] === $ops['id'] && $n[0]['state'] === 'Unread' && str_contains($n[0]['message'], 'marked Absent') && str_contains($n[0]['message'], $T($gid)['trip_ref']), 'Operations Head notified (one notice, names the trip)', json_encode($n));
ok((int)$T($gid)['helper_id'] === $gH && $T($gid)['status'] === 'Pre-Assigned', 'assignment not changed by the attendance');
$save($NOW['date'], 'Day', [$gH => 'Absent']);
$save($NOW['date'], 'Day', [$gD => 'Present']);
ok(count($notes()) === 1, 'saving again does not duplicate the notice');
$save($NOW['date'], 'Day', [$gH => 'Present']);
ok($notes()[0]['state'] === 'Resolved', 'corrected to Present: notice resolved');
$save($NOW['date'], 'Day', [$gH => 'Absent']);
ok(count($notes()) === 1 && $notes()[0]['state'] === 'Unread', 'marked Absent again: same notice re-opened (no duplicate)');
$yest = date('Y-m-d', strtotime('-1 day'));
$save($yest, 'Day', [$gH => 'Absent']);
ok(!one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ?", ['att-absent-' . $gH . '-' . $yest . '%']), 'Absent for another shift (yesterday): no notice');
// Overdue trip: scheduled yesterday, not dispatched -> the current shift is relevant.
$oD = $person('Driver', 'Day', 'o'); $oH = $person('Helper', 'Day', 'o');
$oid = $trip([$oD, $oH], -1440, 'Wing Van', 30);
$save($NOW['date'], 'Day', [$oD => 'Absent']);
ok((bool)one($p, 'SELECT 1 AS x FROM notifications WHERE dedupe_key=?', ['att-absent-' . $oD . '-' . $NOW['date'] . '-Day-' . $oid]), 'overdue trip: Absent for the current shift -> notified');
// Active (dispatched) trip: nothing happens.
$aD = $person('Driver', 'Day', 'a'); $aH = $person('Helper', 'Day', 'a');
$aid = $trip([$aD, $aH]); $ready($aid);
Trips::action($wvd, 'dispatch', ['trip_id' => $aid]);
$before = [$T($aid), many($p, 'SELECT * FROM trip_assignments WHERE trip_id=? ORDER BY resource_type, resource_id', [$aid])];
$save($NOW['date'], 'Day', [$aD => 'Absent', $aH => 'Absent']);
ok([$T($aid), many($p, 'SELECT * FROM trip_assignments WHERE trip_id=? ORDER BY resource_type, resource_id', [$aid])] == $before && !one($p, 'SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ?', ['att-absent-' . $aD . '-%']),
   'dispatched trip: crew marked Absent -> trip, assignment and notices unchanged');
Trips::action($wvd, 'incident', ['trip_id' => $aid, 'incident_type' => 'Breakdown', 'incident_at' => date('Y-m-d\TH:i'), 'location' => 'SLEX', 'problem' => 'Flat', 'details' => 'Tire']);
ok($T($aid)['status'] === 'On Hold - Incident Reported', 'incident report on the active trip still works');

// ---------------------------------------------------------------------
section('H. Second attempt (Redispatch)');
$enforce();
$rD = $person('Driver', 'Day', 'h'); $rH = $person('Helper', 'Day', 'h');
$rid = $trip([$rD, $rH]); $ready($rid); $present([$rD, $rH]);
Trips::action($wvd, 'dispatch', ['trip_id' => $rid]);
run($p, "UPDATE trips SET status='For Reschedule' WHERE id=?", [$rid]);
run($p, "UPDATE vehicles SET status='Assigned' WHERE id=?", [$T($rid)['vehicle_id']]);
Trips::action($wvd, 'reschedule', ['trip_id' => $rid, 'scheduled_at' => date('Y-m-d\TH:i', time() + 3600)]);
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [date('Y-m-d H:i:s', time() + 300), $rid]);
$ready($rid);
ok((int)$T($rid)['attempt_number'] === 2 && $T($rid)['status'] === 'Ready for Dispatch', 'attempt 2 ready (same crew)');
$mark($rD, $NOW['date'], 'Day', 'Absent');
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $rid]), 'Redispatch with the driver now Absent: refused', 409, 'marked Absent');
$mark($rD, $NOW['date'], 'Day', 'Present');
$r = Trips::action($wvd, 'dispatch', ['trip_id' => $rid]);
ok($T($rid)['status'] === 'Dispatched' && str_contains($r['message'], 'Redispatch confirmed'), 'attendance corrected: Redispatch confirmed');

// ---------------------------------------------------------------------
section('I. Attendance changed at the same moment as Confirm Dispatch (two processes)');
$xD = $person('Driver', 'Day', 'i'); $xH = $person('Helper', 'Day', 'i');
$xid = $trip([$xD, $xH]); $ready($xid); $present([$xD, $xH]);
$child = __DIR__ . '/_dispatch_child.php';
file_put_contents($child, '<?php
declare(strict_types=1);
require dirname(__DIR__) . "/backend/Actions.php";
Actions::load("Trips");
$u = json_decode($argv[1], true);
try { $r = Trips::action($u, "dispatch", ["trip_id" => (int)$argv[2]]); echo json_encode(["ok" => true, "message" => $r["message"]]); }
catch (BusinessRuleException $e) { echo json_encode(["ok" => false, "code" => $e->httpStatus, "message" => $e->getMessage()]); }
catch (Throwable $e) { echo json_encode(["ok" => false, "code" => 0, "message" => get_class($e) . ": " . $e->getMessage()]); }
');
$adminConn = test_conn($FRESH);
$adminConn->beginTransaction();
$adminConn->prepare("UPDATE attendance_marks SET status='Absent' WHERE personnel_id=? AND duty_date=? AND duty_shift='Day'")->execute([$xH, $NOW['date']]);   // not committed yet
$pipes = [];
$proc = proc_open([PHP_BINARY, $child, json_encode($wvd), (string)$xid], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
usleep(1500000);
$waiting = (int)$p->query("SELECT COUNT(*) FROM information_schema.processlist WHERE db='$FRESH' AND command IN ('Query','Execute') AND info LIKE '%attendance_marks%' AND id<>CONNECTION_ID()")->fetchColumn();
$adminConn->commit();
$out = json_decode((string)stream_get_contents($pipes[1]), true) ?: ['ok' => false, 'message' => stream_get_contents($pipes[2])];
proc_close($proc); @unlink($child);
ok($waiting >= 1, 'Confirm Dispatch waited for the unsaved attendance change', "waiting=$waiting");
ok(!$out['ok'] && ($out['code'] ?? 0) === 409 && str_contains($out['message'], 'marked Absent'), 'it then saw the new Absent mark and refused (no stale Present)', json_encode($out));
ok($T($xid)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$xid]), 'trip not dispatched, no billing');

// ---------------------------------------------------------------------
section('J. Readiness report and regression');
$rd = Attendance::action($adm, 'readiness', []);
$refs = array_column($rd['trips'], 'trip_ref');
ok($rd['mode'] === 'Enforce' && in_array($T($xid)['trip_ref'], $refs, true), 'readiness lists upcoming trips with Absent / other-shift crew', json_encode($rd['trips']));
ok(in_array($hX, array_map('intval', array_column($rd['unassigned'], 'id')), true), 'readiness lists crew without a shift');
fails(fn() => Attendance::action($ops, 'readiness', []), 'readiness is Admin-only', 403);
$l = Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $NOW['date'], 'duty_shift' => 'Day']);
ok(isset($l['readiness']['trips']), 'Crew Attendance window carries the readiness warnings');
// Time gates and checklist still apply in Enforce.
$zD = $person('Driver', 'Day', 'z'); $zH = $person('Helper', 'Day', 'z');
$zid = $trip([$zD, $zH], 60); $ready($zid); $present([$zD, $zH]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $zid]), 'crew Present but 60 min early: time gate still refuses', 409, 'Confirm Dispatch opens');
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [date('Y-m-d H:i:s', time() + 300), $zid]);
run($p, 'DELETE FROM inspections WHERE trip_id=?', [$zid]);
fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $zid]), 'crew Present but no checklist for the attempt: still refused', 409, 'No pre-dispatch checklist');
$ready2 = one($p, 'SELECT vehicle_id FROM trips WHERE id=?', [$zid]);
insert($p, 'inspections', ['trip_id' => $zid, 'vehicle_id' => $ready2['vehicle_id'], 'attempt_number' => 1, 'kind' => 'Pre-Dispatch', 'items_json' => '{}', 'actor_id' => $wvd['id'], 'completed_at' => date('Y-m-d H:i:s')]);
Trips::action($wvd, 'dispatch', ['trip_id' => $zid]);
$b = one($p, 'SELECT * FROM billings WHERE trip_id=?', [$zid]);
ok($T($zid)['status'] === 'Dispatched' && $b['base_amount'] === '1000.00', 'dispatched; billing draft = 20 km x 50.00 unchanged');
$js = (string)file_get_contents(dirname(__DIR__) . '/public/assets/js/modules/operations/trips.js') . file_get_contents(dirname(__DIR__) . '/public/assets/js/modules/administration/admin.js') . file_get_contents(dirname(__DIR__) . '/public/assets/js/attendance.js');
ok(str_contains($js, 'crew_attendance') && str_contains($js, 'Attendance.readiness') && str_contains($js, 'Outside trip shift') && str_contains($js, "'attendance_mode'"), 'screens: crew attendance in trip details, readiness before switching mode, fallback badge');

// ---------------------------------------------------------------------
section('K. Manual reassignment (Operations Head)');
$warn();
$kD = $person('Driver', 'Day', 'k'); $kH = $person('Helper', 'Day', 'k');
$kHabs = $person('Helper', 'Day', 'kabs'); $kHn = $person('Helper', 'Night', 'kn'); $kHx = $person('Helper', null, 'kx'); $kHu = $person('Helper', 'Day', 'ku');
$kid = $trip([$kD, $kH], 30, 'Wing Van', 30); $ready($kid);
foreach ([$kHabs, $kHn, $kHx] as $x) run($p, "UPDATE personnel SET availability='Available' WHERE id=?", [$x]);
run($p, "UPDATE personnel SET availability='Unavailable' WHERE id=?", [$kHu]);
$mark($kHabs, $NOW['date'], 'Day', 'Absent');
$opt = function () use ($ops, $kid) { $r = Trips::action($ops, 'crew_options', ['trip_id' => $kid]); return [$r, array_column($r['crew'], null, 'id')]; };
[$co, $byId] = $opt();
ok($co['mode'] === 'Warn' && $co['shift'] === 'Day', 'crew options: trip shift and mode');
ok($byId[$kHabs]['labels'] === ['Absent'] && $byId[$kHabs]['allowed'] === false, 'Absent helper labelled "Absent", not allowed');
ok($byId[$kHn]['labels'] === ['Shift mismatch'] && $byId[$kHn]['duty_shift'] === 'Night' && $byId[$kHn]['allowed'] === true, 'Night helper labelled "Shift mismatch" (allowed in Warn)');
ok($byId[$kHx]['labels'] === ['No shift'] && $byId[$kHx]['allowed'] === true, 'helper without shift labelled "No shift" (allowed in Warn)');
ok(in_array('Not available', $byId[$kHu]['labels'], true) && $byId[$kHu]['allowed'] === false, 'Unavailable helper labelled, not allowed');
ok($byId[$kH]['current'] === true && $byId[$kH]['labels'] === [] && $byId[$kH]['allowed'] === true, 'current same-shift helper: no label');
foreach (['container_wingvan_dispatcher', 'finance', 'admin'] as $role) fails(fn() => Trips::action($U($role), 'crew_options', ['trip_id' => $kid]), "$role cannot open crew options", 403);
$re = fn(int $helper) => Trips::action($ops, 'reassign', ['trip_id' => $kid, 'vehicle_id' => $T($kid)['vehicle_id'], 'driver_id' => $kD, 'helper_id' => $helper, 'reason' => 'Crew change']);
$before = $T($kid);
fails(fn() => $re($kHabs), 'Warn: Absent helper refused', 409, 'marked Absent for the Day shift');
fails(fn() => $re($kHu), 'Unavailable helper refused (availability unchanged)', 409, 'Not available');
ok($T($kid) == $before, 'refused reassignments changed nothing (still Ready for Dispatch)');
$c0 = (int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn();
$r = $re($kHn);
$t = $T($kid);
$ev = (string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='truck and crew assigned manually' ORDER BY id DESC LIMIT 1", [$kid])['notes'];
ok((int)$t['helper_id'] === $kHn && $t['status'] === 'Pre-Assigned' && str_contains($r['message'], 'checklist must be done again'), 'Warn: Night helper accepted; trip back to Pre-Assigned (new checklist)');
ok(str_contains($r['message'], 'Warning: Shift fallback (Warn mode, manual)') && str_contains($ev, 'Shift fallback (Warn mode, manual)') && str_contains($ev, '(Helper, Night shift)'), 'visible warning and trip history entry', $ev);
ok((int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn() === $c0 + 1, 'fallback audited');
ok((bool)one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key=? AND user_id=?", ['trip-shift-fallback-' . $kid . '-1-' . $kD . '-0-' . $kHn, $ops['id']]), 'Operations Head notified');
$r = $re($kHx);
ok((int)$T($kid)['helper_id'] === $kHx && str_contains($r['message'], 'no assigned shift'), 'Warn: helper without shift accepted with warning');
$r = $re($kH);
ok((int)$T($kid)['helper_id'] === $kH && !str_contains($r['message'], 'Warning'), 'back to the Day helper: no warning');
$enforce();
[$co, $byId] = $opt();
ok($co['mode'] === 'Enforce' && $byId[$kHn]['allowed'] === false && $byId[$kHx]['allowed'] === false && $byId[$kH]['allowed'] === true, 'Enforce: other-shift and no-shift crew marked not allowed');
$before = $T($kid);
fails(fn() => $re($kHn), 'Enforce: Night helper refused server-side', 409, 'Enforce mode does not allow');
fails(fn() => $re($kHx), 'Enforce: helper without shift refused server-side', 409, 'has no assigned shift');
fails(fn() => $re($kHabs), 'Enforce: Absent helper refused', 409, 'marked Absent');
ok($T($kid) == $before, 'Enforce refusals changed nothing');
$kH2 = $person('Helper', 'Day', 'k2'); run($p, "UPDATE personnel SET availability='Available' WHERE id=?", [$kH2]);
$re($kH2);
ok((int)$T($kid)['helper_id'] === $kH2, 'Enforce: another Day helper accepted');
// Overdue trip: the current shift decides (here Day as well), Absent for now refused.
run($p, 'UPDATE trips SET scheduled_at=? WHERE id=?', [date('Y-m-d H:i:s', time() - 86400 - 3600), $kid]);
$mark($kH, $NOW['date'], 'Day', 'Absent');
fails(fn() => $re($kH), 'overdue trip: helper Absent for the current shift refused', 409, 'marked Absent');
$mark($kH, $NOW['date'], 'Day', null);
// Car Carrier: Driver 2 required, two different drivers.
$warn();
$k1 = $person('Driver', 'Day', 'kc'); $k2 = $person('Driver', 'Day', 'kc'); $k3 = $person('Driver', 'Day', 'kc');
$kcc = $trip([$k1, $k2], 30, 'Car Carrier', 30);
fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $kcc, 'vehicle_id' => $T($kcc)['vehicle_id'], 'driver_id' => $k1, 'reason' => 'x']), 'Car Carrier reassign without Driver 2 refused', 400, 'Driver 1 and Driver 2');
fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $kcc, 'vehicle_id' => $T($kcc)['vehicle_id'], 'driver_id' => $k1, 'driver2_id' => $k1, 'reason' => 'x']), 'same driver twice refused', 400, 'same person');
run($p, "UPDATE personnel SET availability='Available' WHERE id=?", [$k3]);
Trips::action($ops, 'reassign', ['trip_id' => $kcc, 'vehicle_id' => $T($kcc)['vehicle_id'], 'driver_id' => $k1, 'driver2_id' => $k3, 'reason' => 'swap']);
ok((int)$T($kcc)['driver2_id'] === $k3, 'Car Carrier with two different drivers accepted');
// Active trips cannot be reassigned.
fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $aid, 'vehicle_id' => $T($aid)['vehicle_id'], 'driver_id' => $aD, 'helper_id' => $aH, 'reason' => 'x']), 'trip on the road (incident) cannot be reassigned', 409);

// ---------------------------------------------------------------------
section('L. Required crew at Confirm Dispatch / Redispatch (both modes, direct API)');
$lcheck = function (int $id, string $contains, string $name) use ($p, $wvd, $ccd, $T, $warn, $enforce) {
    foreach (['Warn' => $warn, 'Enforce' => $enforce] as $m => $set) {
        $set();
        $before = $T($id);
        $bills = many($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]);   // attempt 1 billing exists for a redispatch
        $who = $before['truck_type'] === 'Car Carrier' ? $ccd : $wvd;
        fails(fn() => Trips::action($who, 'dispatch', ['trip_id' => $id]), "$m: $name", 409, $contains);
        ok($T($id) == $before && many($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]) == $bills, "$m: nothing changed, no new / changed billing");
    }
};
// Defence in depth: a Car Carrier trip whose Driver 2 is missing (e.g. data from before this rule) cannot leave.
$l1 = $person('Driver', 'Day', 'l'); $l1b = $person('Driver', 'Day', 'l');
$lcc = $trip([$l1, $l1b], 5, 'Car Carrier'); $ready($lcc); $present([$l1]);
run($p, "UPDATE trips SET driver2_id=NULL WHERE id=?", [$lcc]);
ok($T($lcc)['driver2_id'] === null && $T($lcc)['status'] === 'Ready for Dispatch', 'Car Carrier trip with Driver 2 removed (old data)');
$det = Trips::action($ops, 'details', ['trip_id' => $lcc])['trip'];
ok(str_contains(implode(' ', $det['crew_attendance']['missing']), 'No Driver 2 assigned'), 'trip details show the missing Driver 2');
$lcheck($lcc, 'No Driver 2 assigned', 'Car Carrier without Driver 2 refused');
try { run($p, 'UPDATE trips SET driver2_id=driver_id WHERE id=?', [$lcc]); ok(false, 'database refuses the same driver twice'); }
catch (PDOException $e) { ok(str_contains($e->getMessage(), 'chk_trip_crew'), 'database itself refuses the same driver as Driver 1 and Driver 2 (chk_trip_crew)'); }
$dup = ['truck_type' => 'Car Carrier', 'driver_id' => $l1, 'driver2_id' => $l1];
ok(str_contains(implode(' ', CrewAttendance::crewCompleteness($p, $dup)), 'same person'), 'completeness check also reports the same driver twice');
$l2 = $person('Helper', 'Day', 'lh');
run($p, 'UPDATE trips SET driver2_id=? WHERE id=?', [$l2, $lcc]);
$lcheck($lcc, 'is a Helper, not a Driver (Driver 2)', 'Car Carrier with a helper as Driver 2 refused');
$lD = $person('Driver', 'Day', 'lw'); $lH = $person('Helper', 'Day', 'lw');
$lw = $trip([$lD, $lH]); $ready($lw); $present([$lD, $lH]);
run($p, 'UPDATE trips SET helper_id=NULL WHERE id=?', [$lw]);
$lcheck($lw, 'No Helper assigned', 'Wing Van without a helper refused');
run($p, 'UPDATE trips SET helper_id=? WHERE id=?', [$lH, $lw]);
run($p, 'UPDATE personnel SET active=0 WHERE id=?', [$lH]);
$lcheck($lw, 'is not an active helper', 'Wing Van with an inactive helper refused (even though Present)');
run($p, 'UPDATE personnel SET active=1 WHERE id=?', [$lH]);
$warn();
Trips::action($wvd, 'dispatch', ['trip_id' => $lw]);
ok($T($lw)['status'] === 'Dispatched', 'complete Wing Van crew: dispatched');
// Redispatch: Driver 2 removed on attempt 2 is caught too.
$r1 = $person('Driver', 'Day', 'r'); $r2 = $person('Driver', 'Day', 'r');
$rcc = $trip([$r1, $r2], 5, 'Car Carrier'); $ready($rcc); $present([$r1, $r2]);
Trips::action($ccd, 'dispatch', ['trip_id' => $rcc]);
run($p, "UPDATE trips SET status='For Reschedule' WHERE id=?", [$rcc]);
run($p, "UPDATE vehicles SET status='Assigned' WHERE id=?", [$T($rcc)['vehicle_id']]);
Trips::action($ccd, 'reschedule', ['trip_id' => $rcc, 'scheduled_at' => date('Y-m-d\TH:i', time() + 3600)]);
run($p, 'UPDATE trips SET scheduled_at=?, driver2_id=NULL WHERE id=?', [date('Y-m-d H:i:s', time() + 300), $rcc]);
$ready($rcc);
$lcheck($rcc, 'No Driver 2 assigned', 'Redispatch (attempt 2) without Driver 2 refused');

// ---------------------------------------------------------------------
section('M. Car Carrier auto-assignment needs two eligible drivers');
$state = fn() => [
    'holds' => many($p, 'SELECT resource_type, resource_id, trip_id FROM trip_assignments ORDER BY resource_type, resource_id'),
    'vehicles' => many($p, "SELECT id, status FROM vehicles WHERE truck_type='Car Carrier' ORDER BY id"),
    'crew' => many($p, 'SELECT id, availability FROM personnel ORDER BY id')];
$evNote = fn(int $id) => (string)(one($p, 'SELECT notes FROM trip_events WHERE trip_id=? ORDER BY id DESC LIMIT 1', [$id])['notes'] ?? '');
foreach (['Warn' => $warn, 'Enforce' => $enforce] as $m => $set) {
    $set();
    $m1 = $person('Driver', 'Day', 'm1' . $m);
    $only([$m1]); $before = $state();
    $r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => 'Car Carrier', 'pickup_point' => 'M', 'delivery_point' => 'N', 'scheduled_at' => date('Y-m-d\TH:i', time() + 1800), 'distance_km' => '20']);
    $t = $T($r['trip_id']); $after = $state();
    ok($t['status'] === 'Awaiting Resources' && $t['vehicle_id'] === null && $t['driver_id'] === null && $t['driver2_id'] === null, "$m: one free driver -> Awaiting Resources, nothing assigned");
    ok(str_contains($evNote($t['id']), 'Car Carrier requires two available' . ($m === 'Enforce' ? ' Day-shift' : '') . ' drivers'), "$m: clear reason", $evNote($t['id']));
    ok($after['holds'] == $before['holds'] && $after['vehicles'] == $before['vehicles'] && $after['crew'] == $before['crew'], "$m: no truck or driver reserved for the incomplete assignment");
    Trips::action($ops, 'cancel', ['trip_id' => $t['id'], 'reason' => 'test']);
}
$warn();
$m1 = $person('Driver', 'Day', 'mm'); $m2 = $person('Driver', 'Day', 'mm');
$id = $trip([$m1, $m2], 30, 'Car Carrier', 30);
$t = $T($id);
ok($t['status'] === 'Pre-Assigned' && $t['driver_id'] && $t['driver2_id'] && (int)$t['driver_id'] !== (int)$t['driver2_id'] && !str_contains($evNote($id), 'fallback'), 'two free Day drivers: Driver 1 and Driver 2 assigned, no fallback');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$mN = $person('Driver', 'Night', 'mn');
$id = $trip([$m1, $mN], 30, 'Car Carrier', 30);
$t = $T($id);
$ev = (string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'];
ok($t['status'] === 'Pre-Assigned' && (int)$t['driver_id'] === $m1 && (int)$t['driver2_id'] === $mN && str_contains($ev, '(Driver 2, Night shift)') && str_contains($ev, 'Shift fallback (Warn mode)'),
   'Warn: one Day + one Night driver -> Night driver as flagged Driver 2', $ev);
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$enforce();
$before = $state();
$id = $trip([$m1, $mN], 30, 'Car Carrier', 30);
ok($T($id)['status'] === 'Awaiting Resources' && $T($id)['driver_id'] === null && str_contains($evNote($id), 'two available Day-shift drivers (Enforce mode'), 'Enforce: Night driver not used -> Awaiting Resources');
ok($state()['holds'] == $before['holds'], 'Enforce: nothing reserved');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$warn();
$mAbs = $person('Driver', 'Day', 'mabs');
$mark($mAbs, $NOW['date'], 'Day', 'Absent');
$before = $state();
$id = $trip([$m1, $mAbs], 30, 'Car Carrier', 30);
ok($T($id)['status'] === 'Awaiting Resources' && $state()['holds'] == $before['holds'], 'Warn: second driver Absent -> never picked; Awaiting Resources, nothing reserved');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$mX = $person('Driver', null, 'mx');
$id = $trip([$mAbs, $mX], 30, 'Car Carrier', 30);
ok($T($id)['status'] === 'Awaiting Resources', 'Warn: Absent driver + no-shift driver -> only one eligible, waits');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
$id = $trip([$mN, $mX], 30, 'Car Carrier', 30);
$t = $T($id);
ok($t['status'] === 'Pre-Assigned' && in_array((int)$t['driver_id'], [$mN, $mX], true) && in_array((int)$t['driver2_id'], [$mN, $mX], true) && str_contains($evNote($id) . (string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'Shift fallback'),
   'Warn: Night + no-shift drivers for a Day trip -> both flagged fallback');
Trips::action($ops, 'cancel', ['trip_id' => $id, 'reason' => 'test']);
// Awaiting trip is assigned once a second driver becomes free (retry).
$id = $trip([$m1], 30, 'Car Carrier', 30);
ok($T($id)['status'] === 'Awaiting Resources', 'one driver: waiting');
$only([$m1, $m2]);
Trips::action($ops, 'auto_assign', ['trip_id' => $id]);
ok($T($id)['status'] === 'Pre-Assigned' && $T($id)['driver2_id'] !== null, 'second driver free: retry assigns both drivers');

echo "\n----------------------------------------\n";
echo "RESULT: $PASS passed, $FAIL failed\n";
if ($FAILED) { echo "Failed:\n"; foreach ($FAILED as $f) echo "  - $f\n"; }
test_drop($FRESH);
exit($FAIL === 0 ? 0 : 1);
