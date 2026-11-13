<?php
/** Isolated MariaDB scenarios. Run only through run_trip_approval_tests.php. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/Actions.php';
require_once __DIR__ . '/_launcher.php';
$fresh = envValue('DB_NAME');
test_guard([$fresh]);
Actions::load('Trips');

if (($argv[1] ?? '') === 'worker') {
    $user = json_decode($argv[2], true, 512, JSON_THROW_ON_ERROR);
    $payload = json_decode($argv[3], true, 512, JSON_THROW_ON_ERROR);
    while (microtime(true) < (float)$argv[4]) usleep(10000);
    try { $r = Trips::action($user, 'review', $payload); echo json_encode(['ok' => true, 'message' => $r['message']]); }
    catch (BusinessRuleException $e) { echo json_encode(['ok' => false, 'code' => $e->httpStatus, 'message' => $e->getMessage()]); }
    exit;
}

$passed = 0; $failed = 0;
function approval_check(bool $condition, string $label): void {
    global $passed, $failed;
    $condition ? $passed++ : $failed++;
    echo ($condition ? 'PASS ' : 'FAIL ') . $label . "\n";
}
function approval_refusal(callable $fn, int $status, string $label): void {
    try { $fn(); approval_check(false, $label); }
    catch (BusinessRuleException $e) { approval_check($e->httpStatus === $status, $label); }
}

test_recreate($fresh);
$p = db();
test_import($p, test_sql('database/schema.sql'));
test_import($p, test_sql('database/extension.sql'));
$users = [];
foreach (['operations_head', 'container_wingvan_dispatcher', 'motorpool'] as $role) {
    $id = insert($p, 'users', ['username' => 'approval_' . $role, 'email' => $role . '@example.test', 'password_hash' => 'fixture', 'full_name' => 'Fixture ' . $role, 'role' => $role]);
    $users[$role] = ['id' => $id, 'role' => $role, 'full_name' => 'Fixture ' . $role];
}
$ops = $users['operations_head']; $dispatcher = $users['container_wingvan_dispatcher'];
$client = insert($p, 'clients', ['company_name' => 'ISOLATED APPROVAL CLIENT', 'status' => 'Active', 'created_by' => $ops['id']]);
insert($p, 'client_rates', ['client_id' => $client, 'truck_type' => 'Wing Van', 'rate_per_km' => '50', 'minimum_charge' => '0', 'updated_by' => $ops['id']]);
$base = ['client_id' => $client, 'truck_type' => 'Wing Van', 'pickup_point' => 'FIXTURE TANAUAN', 'delivery_point' => 'FIXTURE MALVAR', 'distance_km' => '25', 'scheduled_at' => date('Y-m-d\TH:i', time() + 10800)];
$ids = [];
for ($i = 0; $i < 15; $i++) $ids[] = Trips::action($dispatcher, 'create', $base)['trip_id'];
$opsCreated = Trips::action($ops, 'create', $base)['trip_id'];
$read = fn(array $q = []) => Trips::read($ops, 'trips', ['view' => 'approvals'] + $q)['approval'];
$pending = $read();
approval_check($pending['counts']['pending'] === 15 && $pending['counts']['approved'] === 0, 'only dispatcher requests count; Operations Head auto-created trip excluded');
approval_check($pending['total'] === 15 && count($pending['rows']) === 12 && $pending['pages'] === 2, 'server pagination reports full pending total');
approval_check(count($read(['approval_page' => 2])['rows']) === 3, 'second page contains remaining rows');

$approved = Trips::action($ops, 'review', ['trip_id' => $ids[0], 'decision' => 'approve'] + $base);
approval_check(str_contains($approved['message'], 'Awaiting Resources'), 'existing approval engine retains automatic awaiting-resource behavior');
approval_check($read(['approval' => 'approved'])['counts']['approved'] === 1, 'approved request classified from persisted decision');
// Simulate a later lifecycle in the disposable fixture; do not bypass the live dispatch workflow.
run($p, "UPDATE trips SET status='Completed', completed_at=NOW() WHERE id=?", [$ids[0]]);
approval_check($read(['approval' => 'approved'])['rows'][0]['status'] === 'Completed', 'completed dispatcher trip remains approved in history');
approval_refusal(fn() => Trips::action($ops, 'review', ['trip_id' => $ids[0], 'decision' => 'approve'] + $base), 409, 'processed approval cannot be repeated');
approval_refusal(fn() => Trips::action($ops, 'review', ['trip_id' => $ids[0], 'decision' => 'reject', 'reason' => 'Late rejection']), 409, 'invalid completed-to-rejected transition refused');
Trips::action($ops, 'review', ['trip_id' => $ids[1], 'decision' => 'reject', 'reason' => 'Fixture missing supporting records']);
approval_check(one($p, 'SELECT cancel_reason FROM trips WHERE id=?', [$ids[1]])['cancel_reason'] === 'Fixture missing supporting records', 'rejection reason persists');
approval_check($read(['approval' => 'rejected'])['counts']['rejected'] === 1, 'recorded rejection event classifies rejected queue');
approval_refusal(fn() => Trips::action($ops, 'review', ['trip_id' => $ids[1], 'decision' => 'reject', 'reason' => 'Repeated']), 409, 'rejection cannot be repeated');
run($p, "UPDATE trips SET status='Rejected' WHERE id=?", [$ids[2]]);
run($p, "UPDATE trips SET status='Cancelled' WHERE id=?", [$ids[3]]);
$evidence = $read();
approval_check($evidence['counts']['rejected'] === 1 && $evidence['counts']['unclassified'] === 2, 'status-only legacy rejection and unreviewed cancellation do not fabricate decisions');
approval_check($read(['q' => 'ISOLATED APPROVAL CLIENT', 'client_id' => $client, 'truck_type' => 'Wing Van', 'requester_id' => $dispatcher['id']])['total'] === 11, 'search and supported filters combine');
run($p, "UPDATE trips SET created_at='2000-01-01 12:00:00' WHERE id=?", [$ids[4]]);
approval_check($read(['request_from' => date('Y-m-d'), 'request_to' => date('Y-m-d')])['total'] === 10, 'date filter uses request creation rather than dispatch schedule');
approval_refusal(fn() => Trips::action($dispatcher, 'review', ['trip_id' => $ids[5], 'decision' => 'reject', 'reason' => 'Denied']), 403, 'dispatcher cannot reject by direct API');
approval_refusal(fn() => Trips::read($users['motorpool'], 'trips', ['view' => 'approvals']), 403, 'maintenance role cannot read dedicated approval projection');

if (function_exists('proc_open')) {
    $raceId = $ids[5]; $start = microtime(true) + 1.5; $workers = [];
    for ($i = 0; $i < 2; $i++) {
        $pipes = [];
        $process = proc_open([PHP_BINARY, __FILE__, 'worker', json_encode($ops), json_encode(['trip_id' => $raceId, 'decision' => 'approve'] + $base), (string)$start], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('Cannot start approval concurrency worker.');
        $workers[] = [$process, $pipes];
    }
    $outcomes = [];
    foreach ($workers as [$process, $pipes]) {
        $stdout = stream_get_contents($pipes[1]); $stderr = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
        $exit = proc_close($process);
        if ($exit !== 0) throw new RuntimeException('Approval worker failed: ' . $stderr);
        $outcomes[] = json_decode(trim($stdout), true, 512, JSON_THROW_ON_ERROR);
    }
    approval_check(count(array_filter($outcomes, fn($r) => $r['ok'])) === 1 && count(array_filter($outcomes, fn($r) => !$r['ok'] && $r['code'] === 409)) === 1, 'concurrent approval produces one success and one stale refusal');
    approval_check((int)one($p, "SELECT COUNT(*) AS n FROM trip_events WHERE trip_id=? AND event_type='trip details confirmed by Operations Head'", [$raceId])['n'] === 1, 'concurrent approval records one confirmation event');
} else {
    throw new RuntimeException('proc_open is required to verify concurrent approval.');
}

approval_check((bool)one($p, "SELECT id FROM audit_events WHERE area='Trips' AND record_ref=?", ['trip ' . $ids[1]]), 'decision audit trail exists');
test_drop($fresh);
echo "RESULT: $passed passed, $failed failed\n";
exit($failed ? 1 : 0);
