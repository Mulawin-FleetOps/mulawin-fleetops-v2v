<?php
/*
 * =====================================================================
 *  tests/crew_attendance_tests.php  —  Checklist #42 Phase 2, PREPARATION step
 * =====================================================================
 *  Do NOT run this file directly: run tests/run_crew_attendance_tests.php (temporary copy, own .env,
 *  disposable *_test database only).
 *
 *  Covers the preparation step only (no dispatch blocker yet):
 *    A. Shift boundaries (single source, Philippine time, overnight, Admin start hours)
 *    B. Crew roster: drivers AND helpers, by assigned shift
 *    C. Helper shift assignment (Admin), unchanged rights for others
 *    D. Unassigned-shift readiness list and Admin bell
 *    E. Attendance Phase 1 behaviour kept (future date, full roster, audit, mechanics, roles)
 *    F. No operational effect yet (trip planning, auto-assignment, Confirm Dispatch unchanged)
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
$adm = $U('admin'); $ops = $U('operations_head'); $wvd = $U('container_wingvan_dispatcher');
Actions::load('Attendance'); Actions::load('Fleet'); Actions::load('Trips');
$setting = function (string $key, $value) use ($p, $adm) {
    if ($value === null) run($p, 'DELETE FROM app_settings WHERE setting_key=?', [$key]);
    else run($p, 'INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [$key, (string)$value, $adm['id']]);
    Settings::clearCache();
};
$person = fn(string $name, string $type, ?string $shift) => insert($p, 'personnel', ['full_name' => $name, 'person_type' => $type, 'duty_shift' => $shift,
    'license_number' => $type === 'Driver' ? 'L-' . strtoupper(substr(md5($name), 0, 8)) : null, 'license_expiry' => $type === 'Driver' ? date('Y-m-d', strtotime('+1 year')) : null]);

// ---------------------------------------------------------------------
section('A. Shift boundaries (single source, Philippine time)');
$at = fn(string $local) => CrewAttendance::shiftFor(strtotime($local));
$cases = [
    '2026-11-08 05:59:59' => ['2026-11-07', 'Night'], '2026-11-08 06:00:00' => ['2026-11-08', 'Day'], '2026-11-08 12:00:00' => ['2026-11-08', 'Day'],
    '2026-11-08 17:59:59' => ['2026-11-08', 'Day'], '2026-11-08 18:00:00' => ['2026-11-08', 'Night'], '2026-11-08 23:59:59' => ['2026-11-08', 'Night'],
    '2026-11-09 00:30:00' => ['2026-11-08', 'Night'], '2027-01-01 02:00:00' => ['2026-12-31', 'Night'], '2028-03-01 03:00:00' => ['2028-02-29', 'Night'],
];
foreach ($cases as $local => [$date, $shift]) { $r = $at($local); ok($r === ['date' => $date, 'shift' => $shift], "$local -> $shift shift of $date", json_encode($r)); }
ok(date_default_timezone_get() === 'Asia/Manila' && CrewAttendance::shiftFor(gmmktime(16, 30, 0, 11, 8, 2026)) === ['date' => '2026-11-08', 'shift' => 'Night'], '00:30 PH (16:30 UTC the day before) is read in Philippine time');
$setting('attendance_day_start_hour', 7); $setting('attendance_night_start_hour', 19);
ok($at('2026-11-08 06:30:00') === ['date' => '2026-11-07', 'shift' => 'Night'] && $at('2026-11-08 18:30:00') === ['date' => '2026-11-08', 'shift' => 'Day'] && $at('2026-11-08 19:00:00')['shift'] === 'Night',
   'Admin start hours 7 / 19 are used (no separate boundaries)');
$setting('attendance_day_start_hour', null); $setting('attendance_night_start_hour', null);
Actions::load('Admin');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_night_start_hour', 'value' => '6']), 'Night start = Day start (6) refused', 409, 'cannot be the same');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '18']), 'Day start = Night start (18) refused', 409, 'cannot be the same');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '6.5']), 'half hour refused (whole hours only)', 400, 'whole hour');
fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '24']), 'hour 24 refused (range kept)', 400);
ok(Settings::value('attendance_day_start_hour') === 6.0 && Settings::value('attendance_night_start_hour') === 18.0, 'refused saves left the hours unchanged');
Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '5']);
Admin::action($adm, 'setting_save', ['key' => 'attendance_night_start_hour', 'value' => '17']);
ok($at('2026-11-08 05:00:00')['shift'] === 'Day' && $at('2026-11-08 17:00:00')['shift'] === 'Night', 'valid different hours (5 / 17) saved and used');
$aud = one($p, "SELECT details FROM audit_events WHERE action='setting changed' ORDER BY id DESC LIMIT 1");
ok($aud !== null, 'setting change still audited');
$setting('attendance_night_start_hour', 6); $setting('attendance_day_start_hour', 6);   // bad value written outside the app
ok(CrewAttendance::startHours() === [6, 18] && $at('2026-11-08 20:00:00') === ['date' => '2026-11-08', 'shift' => 'Night'], 'identical hours already in the database -> safe defaults 6 / 18 (a Night shift still exists)');
$setting('attendance_day_start_hour', null); $setting('attendance_night_start_hour', null);

// ---------------------------------------------------------------------
section('B. Crew roster: drivers and helpers');
$dDay = $person('DAY, DRIVER', 'Driver', 'Day'); $hDay = $person('DAY, HELPER', 'Helper', 'Day');
$dNight = $person('NIGHT, DRIVER', 'Driver', 'Night'); $hNight = $person('NIGHT, HELPER', 'Helper', 'Night');
$dNone = $person('NOSHIFT, DRIVER', 'Driver', null); $hNone = $person('NOSHIFT, HELPER', 'Helper', null);
$hOff = $person('INACTIVE, HELPER', 'Helper', 'Day'); run($p, 'UPDATE personnel SET active=0 WHERE id=?', [$hOff]);
$today = date('Y-m-d');
$l = Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day']);
$ids = array_map('intval', array_column($l['rows'], 'id'));
ok($ids == [$dDay, $hDay] && $l['total'] === 2, 'Day roster: the Day driver AND the Day helper (no Night, no shift-less, no inactive)', json_encode($ids));
ok(array_column($l['rows'], 'person_type') === ['Driver', 'Helper'], 'roster shows the crew type');
$n = Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Night']);
ok(array_map('intval', array_column($n['rows'], 'id')) == [$dNight, $hNight], 'Night roster: Night driver and helper');
$r = Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present'], ['id' => $hDay, 'status' => 'Absent']]]);
$marks = many($p, 'SELECT personnel_id, status FROM attendance_marks WHERE duty_date=? AND duty_shift=? ORDER BY personnel_id', [$today, 'Day']);
ok(array_column($marks, 'status', 'personnel_id') == [$dDay => 'Present', $hDay => 'Absent'], 'helper attendance saved like a driver\'s', json_encode($marks));
fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present'], ['id' => $hDay, 'status' => 'Present'], ['id' => $hNight, 'status' => 'Present']]]),
    'a Night helper cannot be marked in the Day roster (no cross-shift attendance)', 409, 'wrong-shift');
fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present'], ['id' => $hDay, 'status' => 'Present'], ['id' => $hNone, 'status' => 'Present']]]),
    'a helper with no shift cannot be marked', 409);

// ---------------------------------------------------------------------
section('C. Helper shift assignment');
$crew = fn(int $id) => one($p, 'SELECT * FROM personnel WHERE id=?', [$id]);
$save = fn(array $u, int $id, ?string $shift, string $type = 'Helper') => Fleet::action($u, 'crew_save', ['id' => $id, 'full_name' => $crew($id)['full_name'], 'person_type' => $type, 'duty_shift' => $shift ?? '',
    'license_number' => $crew($id)['license_number'] ?? '', 'license_expiry' => $crew($id)['license_expiry'] ?? '']);
fails(fn() => $save($adm, $hNone, null), 'Admin must choose a shift when saving a helper', 400, 'shift for the helper');
$save($adm, $hNone, 'Night');
ok($crew($hNone)['duty_shift'] === 'Night', 'Admin assigns a Night shift to the helper');
$aud = one($p, "SELECT c.changes_json FROM audit_event_changes c JOIN audit_events a ON a.id=c.audit_event_id WHERE a.record_ref=? ORDER BY a.id DESC LIMIT 1", ['personnel ' . $hNone]);
ok(str_contains((string)($aud['changes_json'] ?? ''), 'Assigned shift') && str_contains((string)$aud['changes_json'], 'Night'), 'shift change recorded in the Activity Log', (string)($aud['changes_json'] ?? ''));
ok(in_array($hNone, array_map('intval', array_column(Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Night'])['rows'], 'id')), true), 'the helper now appears in the Night roster');
fails(fn() => $save($adm, $dNone, null, 'Driver'), 'Admin must still choose a shift for a driver', 400, 'shift for the driver');
$save($ops, $hDay, 'Night');
ok($crew($hDay)['duty_shift'] === 'Day', 'Operations Head edit keeps the helper\'s shift (shift stays Admin-only)');
$newId = (int)Fleet::action($ops, 'crew_save', ['full_name' => 'NEW, HELPER', 'person_type' => 'Helper', 'duty_shift' => 'Day'])['id'];
ok($crew($newId)['duty_shift'] === null, 'helper added by the Operations Head starts without a shift (Admin assigns it)');
foreach (['finance', 'billing', 'container_wingvan_dispatcher'] as $role)
    fails(fn() => Fleet::action($U($role), 'crew_save', ['id' => $hDay, 'full_name' => 'DAY, HELPER', 'person_type' => 'Helper', 'duty_shift' => 'Night']), "$role cannot change crew records", 403);

// ---------------------------------------------------------------------
section('D. Unassigned-shift readiness list and Admin bell');
$un = CrewAttendance::unassignedCrew($p);
ok(array_map('intval', array_column($un, 'id')) == [$dNone, $newId], 'readiness list: active driver / helper without a shift (inactive excluded)', json_encode($un));
$l = Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day']);
ok(count($l['unassigned']) === 2, 'crew attendance list returns the unassigned crew for the warning');
ok(Attendance::action($adm, 'list', ['kind' => 'Mechanic', 'duty_date' => $today, 'duty_shift' => 'Day'])['unassigned'] === [], 'mechanic list has no crew warning');
require_once dirname(__DIR__) . '/backend/Modules/Administration/Attendance.php';
Attendance::remind($p);
$bell = one($p, "SELECT message, state FROM notifications WHERE dedupe_key='att-noshift' AND user_id=?", [$adm['id']]);
ok($bell && str_contains($bell['message'], '2 active driver(s)/helper(s) have no Day/Night shift') && in_array($bell['state'], ['Unread', 'Read'], true), 'Admin bell: crew without a shift', json_encode($bell));
Attendance::remind($p);
ok((int)one($p, "SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key='att-noshift' AND user_id=?", [$adm['id']])['n'] === 1, 'no duplicate bell on refresh');
$save($adm, $dNone, 'Day', 'Driver'); $save($adm, $newId, 'Day');
Attendance::remind($p);
ok(one($p, "SELECT state FROM notifications WHERE dedupe_key='att-noshift' AND user_id=?", [$adm['id']])['state'] === 'Resolved' && CrewAttendance::unassignedCrew($p) === [], 'all shifts assigned: bell resolved');
ok(!one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key='att-noshift' AND user_id<>?", [$adm['id']]), 'only the Admin gets the shift bell');

// ---------------------------------------------------------------------
section('E. Attendance Phase 1 behaviour kept');
fails(fn() => Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => date('Y-m-d', strtotime('+1 day')), 'duty_shift' => 'Day']), 'future attendance still refused', 409, 'future');
fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present']]]), 'partial roster still refused', 409, 'roster changed');
foreach (['operations_head', 'container_wingvan_dispatcher', 'finance'] as $role)
    fails(fn() => Attendance::action($U($role), 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day']), "$role cannot open attendance", 403);
$m = insert($p, 'mechanics', ['mechanic_code' => 'MEC-T-1', 'full_name' => 'MECH, ONE', 'duty_shift' => 'Day']);
$ml = Attendance::action($adm, 'list', ['kind' => 'Mechanic', 'duty_date' => $today, 'duty_shift' => 'Day']);
ok(array_map('intval', array_column($ml['rows'], 'id')) == [$m], 'mechanic roster unchanged');
$dayRoster = Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day'])['rows'];
$items = array_map(fn($r) => ['id' => (int)$r['id'], 'status' => (int)$r['id'] === $hDay ? 'Present' : ($r['status'] ?? null)], $dayRoster);
Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => $items]);
$ch = one($p, "SELECT a.action, c.changes_json FROM audit_events a JOIN audit_event_changes c ON c.audit_event_id=a.id WHERE a.record_ref=? ORDER BY a.id DESC LIMIT 1", ['driver ' . $hDay]);
ok($ch && $ch['action'] === 'attendance updated' && str_contains((string)$ch['changes_json'], 'Absent') && str_contains((string)$ch['changes_json'], 'Present'), 'helper correction Absent -> Present kept in the audit trail', json_encode($ch));
Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => date('Y-m-d', strtotime('-1 day')), 'duty_shift' => 'Night',
    'items' => array_map(fn($r) => ['id' => (int)$r['id'], 'status' => 'Present'], Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => date('Y-m-d', strtotime('-1 day')), 'duty_shift' => 'Night'])['rows'])]);
ok((int)one($p, "SELECT COUNT(*) AS n FROM attendance_marks WHERE duty_date=? AND duty_shift='Night'", [date('Y-m-d', strtotime('-1 day'))])['n'] === 3, 'yesterday\'s Night shift can be marked (past date)');

// ---------------------------------------------------------------------
section('F. No operational effect yet (hard blocker not enabled)');
$cid = insert($p, 'clients', ['company_name' => 'ATT CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
insert($p, 'client_rates', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'rate_per_km' => '50.00', 'minimum_charge' => '0.00', 'updated_by' => $U('billing')['id']]);
insert($p, 'vehicles', ['plate_number' => 'WV-1', 'truck_type' => 'Wing Van']);
run($p, "UPDATE personnel SET availability='Unavailable' WHERE id<>? AND id<>?", [$dNight, $hNight]);   // only the Night crew is free
$r = Trips::action($ops, 'create', ['client_id' => $cid, 'truck_type' => 'Wing Van', 'pickup_point' => 'A', 'delivery_point' => 'B', 'scheduled_at' => date('Y-m-d\TH:i', time() + 86400), 'distance_km' => '10']);
$t = one($p, 'SELECT * FROM trips WHERE id=?', [$r['trip_id']]);
ok($t['status'] === 'Pre-Assigned' && (int)$t['driver_id'] === $dNight && (int)$t['helper_id'] === $hNight, 'future trip still planned and auto-assigned (no attendance needed for planning)');
$det = Trips::action($ops, 'details', ['trip_id' => $t['id']]);
ok(!preg_grep('/attendance/i', $det['trip']['dispatch_blockers']), 'Confirm Dispatch has no attendance blocker yet (pending rollout review)');
$src = (string)file_get_contents(dirname(__DIR__) . '/backend/Modules/Operations/Trips.php');
ok(!str_contains($src, 'CrewAttendance'), 'trip assignment and dispatch code untouched in this step');
$js = (string)file_get_contents(dirname(__DIR__) . '/public/assets/js/attendance.js');
ok(str_contains($js, 'Crew Attendance (Drivers and Helpers)') && str_contains($js, 'data-att-unassigned'), 'attendance modal: crew title and unassigned warning');
$fjs = (string)file_get_contents(dirname(__DIR__) . '/public/assets/js/modules/operations/fleet.js');
ok(str_contains($fjs, "label: 'Assigned shift', type: 'select'") && str_contains($fjs, "required: UI.role('admin'),"), 'masterlist form: shift for drivers and helpers (Admin)');

echo "\n----------------------------------------\n";
echo "RESULT: $PASS passed, $FAIL failed\n";
if ($FAILED) { echo "Failed:\n"; foreach ($FAILED as $f) echo "  - $f\n"; }
test_server()->exec("DROP DATABASE IF EXISTS `$FRESH`");
exit($FAIL === 0 ? 0 : 1);
