# Coverage inventory ? inspection before implementation

Existing procedural suites are preserved. Each launcher invokes its matching script in a temporary project copy; all DB suites require explicit TEST_DB_USER/PASS, PDO MySQL, schema.sql and extension.sql. Migration comparisons also require git history. Assertions use ok()/fails(), count failures and return nonzero. Local map/SMTP doubles replace external services.

Safety finding: suffix-only reset can destroy pre-existing databases. Temporary-copy guard only checks APP_ENV substring. PHPUnit must never bootstrap the normal application environment.

## account_security_tests.php

Launcher: `run_account_security_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: AccountSecurity::failure, AccountSecurity::isLocked, SecurityPasswordChange::confirm, SecurityPasswordChange::emailConfirm, SecurityPasswordChange::emailRequest, SecurityPasswordChange::request

Source scenario and assertion inventory (line references preserve exact expectations):

- L34: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L35: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L36: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L63: `section('Setup: disposable fresh database');`
- L66: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L84: `section('A. Password change: wrong current password counts toward the account lock');`
- L86: `for ($i = 1; $i <= 4; $i++) fails(fn() => $pwReq($a, "wrong-$i"), "wrong current password #$i refused (403)", 403, 'incorrect');`
- L87: `ok((int)$state($a)['failed_logins'] === 4 && !$locked($a), 'four wrong tries counted (4), not locked yet');`
- L88: `ok($audits($a, 'wrong current password') === 4, 'each wrong try is audited');`
- L90: `fails(fn() => $pwReq($a, 'wrong-5'), 'fifth wrong try locks the account (429)', 429, 'locked for 15 minutes');`
- L91: `ok($locked($a) && $audits($a, 'account locked') === 1, 'account locked for 15 minutes and audited');`
- L92: `fails(fn() => $pwReq($a, PW), 'CORRECT current password refused while locked (429)', 429, 'locked');`
- L93: `ok(count($mails()) === $before && !one($p, 'SELECT user_id FROM password_change_challenges WHERE user_id=?', [$a['id']]), 'no code emailed and no change started while locked');`
- L96: `ok(str_contains($r['message'], 'verification code was sent') && $lastCode() !== null, 'after the lock ends, the correct password works (code emailed)');`
- L97: `ok((int)$state($a)['failed_logins'] === 0, 'correct password resets the wrong-try count');`
- L100: `section('B. Email change: same lock');`
- L102: `for ($i = 1; $i <= 4; $i++) fails(fn() => $emReq($b, "nope-$i", 'bob.new@example.test'), "email change: wrong current password #$i refused (403)", 403, 'incorrect');`
- L103: `fails(fn() => $emReq($b, 'nope-5', 'bob.new@example.test'), 'email change: fifth wrong try locks the account (429)', 429, 'locked');`
- L104: `fails(fn() => $emReq($b, PW, 'bob.new@example.test'), 'email change: CORRECT password refused while locked (429)', 429);`
- L105: `ok(!one($p, 'SELECT user_id FROM email_change_challenges WHERE user_id=?', [$b['id']]) && $state($b)['email'] === 'bob@example.test', 'no email change started; email unchanged');`
- L109: `section('C. Shared counter with login; atomic count');`
- L112: `fails(fn() => $pwReq($c, 'x1'), 'login failures + current-password failures share one counter (4th)', 403);`
- L113: `fails(fn() => $emReq($c, 'x2', 'carol2@example.test'), '5th wrong try (email change) locks the account', 429, 'locked');`
- L117: `ok((int)$state($c)['failed_logins'] === 0, 'a correct current password resets earlier wrong logins (same as a successful login)');`
- L122: `ok($locked($d) && $res === [false, false, false, false, true], 'count is atomic: 5 failures with the same stale row still lock the account', json_encode([$res, $state($d)]));`
- L139: `ok(count($all) === 10 && $locked($d) && in_array(429, $all, true) && !in_array(200, $all, true), 'two processes guessing in parallel (10 tries): account locked, the rest refused with 429', json_encode($outs));`
- L140: `ok(count(array_filter($all, fn($s) => $s === 403)) <= 4, 'at most 4 guesses were actually checked before the lock', json_encode($all));`
- L144: `section('D. A locked account cannot finish a change, even with the right code');`
- L149: `fails(fn() => SecurityPasswordChange::confirm($e, ['code' => $code]), 'password change: correct code refused while locked (429)', 429, 'locked');`
- L150: `ok($state($e)['password_hash'] === $hash, 'password unchanged');`
- L153: `ok(str_contains($r['message'], 'Password changed') && password_verify('Changed-Pass-2026', $state($e)['password_hash']), 'after the lock ends the same code completes the change');`
- L157: `fails(fn() => SecurityPasswordChange::emailConfirm($f, ['code' => $ecode]), 'email change: correct code refused while locked (429)', 429, 'locked');`
- L158: `ok($state($f)['email'] === 'frank@example.test', 'email unchanged while locked');`
- L162: `section('E. Email change: notice to the previous address');`
- L167: `ok($state($f)['email'] === 'frank.new@example.test', 'email changed after the verified code');`
- L170: `ok(count($new) === 1 && count($notice) === 1, 'exactly one notice, sent to the PREVIOUS address', json_encode(array_column($new, 'to')));`
- L173: `ok(str_contains($t, 'email address was changed') && str_contains($t, 'frank') && str_contains($t, 'contact your Admin'), 'notice says what changed, for which account, and what to do');`
- L174: `ok(str_contains($t, 'f*******w@example.test') && !str_contains($t, 'frank.new@example.test'), 'new address shown masked only', $t);`
- L175: `ok(!preg_match('/\b\d{6}\b/', $body) && !str_contains($body, $ecode) && !str_contains($body, PW) && !preg_match('#https?://|href=#i', $body),`
- L177: `ok(str_contains($r['message'], 'notice was sent to your previous email'), 'user is told the notice was sent');`
- L178: `ok($audits($f, 'email change notice sent') === 1 && $audits($f, 'email verified and updated') === 1, 'change and notice are audited');`
- L179: `ok(!one($p, 'SELECT id FROM trusted_login_devices WHERE user_id=?', [$f['id']]), 'trusted devices still revoked (unchanged)');`
- L185: `ok($state($g)['email'] === 'gina.new@example.test' && !str_contains($r['message'], 'notice was sent'), 'mail server down: email change still saved; no false "notice sent" message');`
- L186: `ok($audits($g, 'email change notice not sent') === 1, 'failed notice is audited (no address in clear, no error details to the user)');`
- L190: `section('F. Normal flows still work');`
- L193: `fails(fn() => SecurityPasswordChange::confirm($h, ['code' => $hc === '000000' ? '111111' : '000000']), 'wrong verification code still refused (401)', 401);`
- L194: `ok((int)$state($h)['failed_logins'] === 0, 'a wrong verification CODE does not touch the login counter (unchanged behaviour)');`
- L196: `ok(password_verify('Changed-Pass-2026', $state($h)['password_hash']), 'password change completes normally');`
- L197: `fails(fn() => $pwReq($h, PW), 'old password no longer accepted as current password', 403);`
- L198: `ok((int)$state($h)['failed_logins'] === 1, 'the wrong current password was counted (1)');`
- L199: `fails(fn() => SecurityPasswordChange::request($h, ['current_password' => 'Changed-Pass-2026', 'new_password' => 'short', 'confirm' => 'short']), 'password rules unchanged (too short refused)', 400);`
- L200: `ok((int)$state($h)['failed_logins'] === 0, 'the correct current password reset the count (0)');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## billing_adjustment_tests.php

Launcher: `run_billing_adjustment_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Access::canOpen, Actions::load, Billing::COUNTED, Billing::action, Billing::read, BillingDraft::createFor, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L40: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L41: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L42: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L45: `try { run($p, $sql, $args); ok(false, $name, 'database accepted it'); }`
- L46: `catch (PDOException $e) { ok(true, $name); }`
- L50: `section('Setup: disposable fresh database');`
- L53: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L92: `section('A. Migration: safe order, recovery, grandfathered charges, fresh install = upgrade');`
- L99: `ok(count($mst) === 4 && str_starts_with($mst[0], 'ALTER TABLE billing_charges') && str_starts_with($mst[3], 'INSERT INTO schema_migrations'), 'migration = 1 ALTER (all schema changes), backfill, default, and the schema_migrations marker LAST', json_encode(array_map(fn($x) => substr($x, 0, 40), $mst)));`
- L100: `ok(substr_count($MIGSQL, 'ALTER TABLE billing_charges') === 2 && !str_contains($mst[1] . $mst[2], 'DROP') && !str_contains($mst[1] . $mst[2], 'ADD COLUMN'), 'every column / constraint change is inside the single step-1 ALTER');`
- L101: `ok($state($p)['state'] === 'COMPLETE', 'check file: fresh install is COMPLETE', json_encode($state($p)));`
- L129: `foreach ($fa as $k => $v) ok($v === $fb[$k], "$label: identical $k to a fresh install", json_encode([array_values(array_diff($v, $fb[$k])), array_values(array_diff($fb[$k], $v))]));`
- L134: `ok($state($up)['state'] === 'NOT APPLIED', 'check file: old database is NOT APPLIED', json_encode($state($up)));`
- L137: `ok($state($up)['state'] === 'COMPLETE', 'normal upgrade: check file says COMPLETE');`
- L138: `ok($sum($up) === $billSum, 'normal upgrade: billings (For Billing, Invoiced, Paid) unchanged: same totals and invoice data');`
- L139: `ok(many($up, "SELECT $oldCols FROM billing_charges ORDER BY id") === $oldRows, 'normal upgrade: existing charge rows kept as they were');`
- L141: `ok(count($st) === 1 && $st[0]['status'] === 'Approved' && $st[0]['kind'] === 'Additional Charge' && $st[0]['request_type'] === 'New' && $st[0]['replaces_id'] === null`
- L143: `ok(one($up, 'SELECT COALESCE(SUM(amount),0) AS s FROM billing_charges WHERE billing_id=? AND ' . Billing::COUNTED, [$tA])['s'] === '550.00'`
- L147: `try { test_import($up, $MIGSQL); ok(false, 'second import refused'); }`
- L148: `catch (PDOException $e) { ok(str_contains($e->getMessage(), "Duplicate column name 'kind'"), 'second import stops at step 1 (Duplicate column) before changing anything', $e->getMessage()); }`
- L149: `ok(test_fingerprint($up, $UPGRADE) === $fb && $sum($up) === $billSum && $state($up)['state'] === 'COMPLETE', 'refused second import changed nothing (old CHECK not dropped twice)');`
- L150: `try { test_import($up, $FINISH); ok(false, 'recovery on a complete database refused'); }`
- L151: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'Duplicate entry'), 'recovery file on a COMPLETE database stops at the marker', $e->getMessage()); }`
- L152: `ok(test_fingerprint($up, $UPGRADE) === $fb && $sum($up) === $billSum, 'recovery file on a complete database changed nothing');`
- L159: `try { test_import($up, $MIGSQL); ok(false, 'step 1 failure simulated'); }`
- L160: `catch (PDOException $e) { ok(true, 'step 1 failed (simulated constraint name clash)'); }`
- L161: `ok(test_fingerprint($up, $UPGRADE) === $blocked, 'failed step 1 left the table exactly as before (old CHECK kept, no new column)');`
- L162: `ok(!one($up, 'SELECT id FROM schema_migrations WHERE id=?', [MIG]) && $state($up)['state'] === 'NOT APPLIED', 'failed migration NOT recorded; check file says NOT APPLIED');`
- L164: `ok(test_fingerprint($up, $UPGRADE) === $before, 'cause removed: back to the old schema');`
- L166: `ok($state($up)['state'] === 'COMPLETE' && $sum($up) === $billSum, 'after fixing the cause, importing the migration again completes it; totals unchanged');`
- L174: `ok($s3['state'] === 'PARTIAL' && (int)$s3['recorded'] === 0, 'stopped after step 1: check file says PARTIAL, not recorded', json_encode($s3));`
- L175: `ok($sum($up) === $billSum && (int)one($up, "SELECT COUNT(*) AS n FROM billing_charges WHERE status<>'Approved'")['n'] === 0, 'PARTIAL state: old charges already Approved, totals unchanged (safe meanwhile)');`
- L177: `try { test_import($up, $MIGSQL); ok(false, 'migration re-import refused in PARTIAL state'); }`
- L178: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'Duplicate column'), 'importing the migration again is refused at step 1 (nothing re-run)', $e->getMessage()); }`
- L179: `ok(test_fingerprint($up, $UPGRADE) === $part && $state($up)['state'] === 'PARTIAL', 'refused re-import changed nothing');`
- L181: `ok($state($up)['state'] === 'COMPLETE' && $sum($up) === $billSum, 'recovery file finished steps 2-4: COMPLETE, totals unchanged');`
- L182: `ok((int)one($up, "SELECT COUNT(*) AS n FROM billing_charges WHERE decision_notes LIKE '%before the approval workflow%'")['n'] === count($oldCharges), 'recovery backfilled the grandfather note');`
- L188: `try { test_import($up, $FINISH); ok(false, 'recovery on an old database refused'); }`
- L189: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'Unknown column'), 'recovery file on a NOT APPLIED database fails at its first statement', $e->getMessage()); }`
- L190: `ok(test_fingerprint($up, $UPGRADE) === $before && $state($up)['state'] === 'NOT APPLIED', 'mistaken recovery changed and recorded nothing');`
- L200: `section('B. New additional charge: pending until the Admin approves');`
- L205: `ok($c['status'] === 'Pending Approval' && $c['kind'] === 'Additional Charge' && $c['request_type'] === 'New' && $c['amount'] === '350.00', 'request saved as Pending Approval', json_encode($c));`
- L206: `ok($total($b1) === '1000.00' && $B($b1)['charges_total'] === '0.00', 'pending charge is NOT in the billing total');`
- L207: `ok(str_contains($r['message'], 'Admin'), 'message says it needs Admin approval', $r['message']);`
- L208: `ok((bool)$note($adm['id'], "billing-adj-$c1") && (bool)$note($adm2['id'], "billing-adj-$c1"), 'every Admin is notified (dedupe key billing-adj-ID)');`
- L209: `ok(!$note($bil['id'], "billing-adj-$c1"), 'Billing (requester) is not sent the approval task');`
- L210: `ok($audit('billing adjustment requested', $b1) === 1, 'request is audited');`
- L213: `ok($c['status'] === 'Approved' && (int)$c['decided_by'] === $adm['id'] && $c['decided_at'] !== null && $c['decision_notes'] === 'OK per toll receipts', 'Admin approved: decider, time and notes recorded');`
- L214: `ok($total($b1) === '1350.00' && $B($b1)['charges_total'] === '350.00', 'approved charge counts in the total (1000 + 350)');`
- L215: `ok($note($adm2['id'], "billing-adj-$c1")['state'] === 'Resolved' && $note($adm['id'], "billing-adj-$c1")['state'] === 'Resolved', 'approval task resolved for every Admin');`
- L216: `ok((bool)one($p, "SELECT id FROM notifications WHERE user_id=? AND category='Billing approval' AND message LIKE '%approved%'", [$bil['id']]), 'requester told about the approval');`
- L217: `ok($audit('billing adjustment approved', $b1) === 1, 'approval is audited');`
- L218: `fails(fn() => $act($adm2, 'charge_decide', ['charge_id' => $c1, 'decision' => 'approve']), 'deciding twice refused', 409, 'already decided');`
- L219: `ok($p->query('CHECKSUM TABLE client_rates')->fetch()['Checksum'] === $rateBefore, 'global client rates not changed');`
- L222: `section('C. Roles and separation of duties');`
- L225: `fails(fn() => $act($U($role), 'charge_add', ['billing_id' => $b1, 'description' => 'X', 'amount' => '1']), "$role cannot request charges", 403);`
- L227: `fails(fn() => $act($U($who), 'charge_decide', ['charge_id' => $c2, 'decision' => 'approve']), "$who cannot approve", 403);`
- L228: `fails(fn() => $act($adm, 'charge_withdraw', ['charge_id' => $c2]), 'Admin cannot withdraw a Billing request', 403);`
- L230: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $c2, 'decision' => 'approve']), 'no self-approval (separation of duties)', 403, 'separation of duties');`
- L231: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $c2, 'decision' => 'reject', 'reason' => 'x']), 'no self-rejection either', 403);`
- L233: `ok($C($c2)['status'] === 'Pending Approval' && $total($b1) === '1350.00', 'refused decisions changed nothing');`
- L234: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $c2, 'decision' => 'reject']), 'rejecting needs a reason', 400);`
- L236: `ok($C($c2)['status'] === 'Rejected' && $C($c2)['decision_notes'] === 'No waiting time on the waybill' && $total($b1) === '1350.00', 'rejected charge never enters the total');`
- L237: `ok($note($adm['id'], "billing-adj-$c2")['state'] === 'Resolved', 'rejection resolves the approval task');`
- L238: `ok((bool)one($p, "SELECT id FROM notifications WHERE user_id=? AND message LIKE '%rejected%No waiting time%'", [$bil['id']]), 'requester told about the rejection with the reason');`
- L239: `ok($audit('billing adjustment rejected', $b1) === 1, 'rejection is audited');`
- L240: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $c2, 'decision' => 'approve']), 'a rejected request cannot be approved later', 409);`
- L243: `section('D. Per-trip rate adjustments (peso amounts, plus or minus)');`
- L244: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b1, 'kind' => 'Rate Adjustment', 'description' => 'Special rate', 'amount' => '100', 'direction' => 'Decrease']), 'rate adjustment needs a reason', 400);`
- L245: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b1, 'kind' => 'Rate Adjustment', 'description' => 'Special rate', 'amount' => '100', 'reason' => 'x']), 'rate adjustment needs a direction', 400);`
- L246: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b1, 'kind' => 'Discount', 'description' => 'x', 'amount' => '1']), 'unknown kind refused', 400);`
- L247: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b1, 'description' => 'Neg', 'amount' => '-50']), 'negative additional charge refused', 400);`
- L248: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b1, 'description' => 'Zero', 'amount' => '0']), 'zero amount refused', 400);`
- L250: `ok($C($d1)['amount'] === '-150.00' && $C($d1)['kind'] === 'Rate Adjustment' && $total($b1) === '1350.00', 'discount stored as -150.00, pending, total unchanged');`
- L252: `ok($C($d2)['amount'] === '400.00', 'increase stored as +400.00');`
- L254: `ok($total($b1) === '1200.00', 'approved discount: 1000 + 350 - 150 = 1200');`
- L256: `ok($total($b1) === '1200.00' && $C($d2)['status'] === 'Rejected', 'rejected increase not in the total');`
- L257: `ok($B($b1)['rate_per_km'] === '50.00' && $B($b1)['base_amount'] === '1000.00', 'base amount and rate per km of the trip unchanged (adjustment is a separate line)');`
- L260: `section('E. Change of an approved line');`
- L261: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $c1, 'description' => 'Toll fees', 'amount' => '350', 'reason' => 'x']), 'change with nothing changed refused', 400, 'Nothing changed');`
- L262: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $c2, 'description' => 'Toll fees', 'amount' => '10', 'reason' => 'x']), 'a rejected request cannot be changed', 409);`
- L263: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $c1, 'description' => 'Toll fees', 'amount' => '420']), 'change needs a reason', 400);`
- L265: `ok($C($e1)['request_type'] === 'Change' && (int)$C($e1)['replaces_id'] === $c1 && $C($e1)['status'] === 'Pending Approval', 'change saved as a pending request pointing to the approved line');`
- L266: `ok($C($c1)['status'] === 'Approved' && $C($c1)['amount'] === '350.00' && $total($b1) === '1200.00', 'approved line unchanged while the change waits');`
- L267: `fails(fn() => $act($bil2, 'charge_change', ['charge_id' => $c1, 'description' => 'Toll', 'amount' => '999', 'reason' => 'x']), 'second change of the same line refused while one is pending', 409, 'already waiting');`
- L268: `fails(fn() => $act($bil2, 'charge_remove', ['charge_id' => $c1, 'reason' => 'x']), 'removal of the same line refused while a change is pending', 409, 'already waiting');`
- L270: `ok($C($c1)['status'] === 'Approved' && $C($c1)['amount'] === '350.00' && $total($b1) === '1200.00', 'rejected change: old approved line unchanged, total unchanged');`
- L273: `ok($C($c1)['status'] === 'Superseded' && $C($e2)['status'] === 'Approved' && $total($b1) === '1270.00', 'approved change: old line Superseded, new line Approved, total 1270 (one transaction)');`
- L274: `ok($C($c1)['amount'] === '350.00' && $C($c1)['description'] === 'Toll fees', 'superseded line kept unedited for history');`
- L275: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $c1, 'description' => 'x', 'amount' => '1', 'reason' => 'x']), 'superseded line cannot be changed', 409);`
- L277: `ok($C($dChg)['amount'] === '-100.00' && $C($dChg)['kind'] === 'Rate Adjustment', 'a discount change keeps its kind and sign');`
- L280: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $dChg, 'decision' => 'approve']), 'approval refused when the replaced line is no longer approved', 409, 'no longer approved');`
- L281: `ok($C($dChg)['status'] === 'Pending Approval', 'refused approval rolled back completely');`
- L284: `ok($total($b1) === '1320.00' && $C($d1)['status'] === 'Superseded', 'discount changed 150 -> 100: total 1320');`
- L287: `section('F. Removal of an approved line; withdrawing a pending request');`
- L288: `fails(fn() => $act($bil, 'charge_remove', ['charge_id' => $e2]), 'removal needs a reason', 400);`
- L290: `ok($C($rm)['request_type'] === 'Removal' && (int)$C($rm)['replaces_id'] === $e2 && $C($e2)['status'] === 'Approved' && $total($b1) === '1320.00', 'removal is a pending request; the line stays in the total');`
- L292: `ok($C($e2)['status'] === 'Removed' && $C($rm)['status'] === 'Approved' && $total($b1) === '900.00', 'approved removal: line Removed (not deleted), total 1000 - 100 = 900');`
- L293: `ok((bool)$C($e2), 'removed line still in the database (history)');`
- L295: `fails(fn() => $act($bil, 'charge_remove', ['charge_id' => $w, 'reason' => 'x']), 'a pending request is withdrawn, not removed', 409, 'Withdraw');`
- L296: `fails(fn() => $act($bil2, 'charge_withdraw', ['charge_id' => $w]), 'another Billing user cannot withdraw it (direct API)', 403, 'person who made');`
- L298: `fails(fn() => $act($U($who), 'charge_withdraw', ['charge_id' => $w]), "$who cannot withdraw it (direct API)", 403);`
- L299: `ok($C($w)['status'] === 'Pending Approval', 'refused withdrawals changed nothing');`
- L301: `ok($C($w)['status'] === 'Withdrawn' && (int)$C($w)['decided_by'] === $bil['id'] && $total($b1) === '900.00', 'the requester withdrew it (kept as history), total unchanged');`
- L302: `ok($note($adm['id'], "billing-adj-$w")['state'] === 'Resolved', 'withdrawing resolves the Admin task');`
- L303: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $w, 'decision' => 'approve']), 'withdrawn request cannot be approved', 409);`
- L304: `fails(fn() => $act($bil, 'charge_withdraw', ['charge_id' => $e2]), 'an approved / decided line cannot be withdrawn', 409);`
- L305: `ok(array_map('intval', array_column(many($p, 'SELECT id FROM billing_charges WHERE billing_id=? ORDER BY id', [$b1]), 'id')) === [$c1, $c2, $d1, $d2, $e1, $e2, $dChg, $rm, $w], 'no billing line was ever deleted (every request and line kept)');`
- L308: `section('G. Billing total must stay above zero');`
- L310: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b2, 'kind' => 'Rate Adjustment', 'description' => 'Free trip', 'amount' => '1000', 'direction' => 'Decrease', 'reason' => 'x']), 'discount equal to the total refused (total 0)', 409, 'above zero');`
- L311: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $b2, 'kind' => 'Rate Adjustment', 'description' => 'Too much', 'amount' => '1500', 'direction' => 'Decrease', 'reason' => 'x']), 'discount bigger than the total refused', 409);`
- L315: `fails(fn() => $act($adm, 'charge_decide', ['charge_id' => $g2, 'decision' => 'approve']), 'approving the second discount refused (total would be -200)', 409, 'above zero');`
- L316: `ok($C($g2)['status'] === 'Pending Approval' && $total($b2) === '400.00', 'refused approval left the request pending and the total at 400');`
- L317: `ok($note($adm['id'], "billing-adj-$g2")['state'] !== 'Resolved', 'refused approval did not resolve the Admin task (rolled back)');`
- L321: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $g1, 'description' => 'Discount A', 'amount' => '1300', 'direction' => 'Decrease', 'reason' => 'x']), 'a change that would make the total zero is refused', 409, 'above zero');`
- L323: `fails(fn() => $act($bil2, 'charge_add', ['billing_id' => $b2, 'kind' => 'Rate Adjustment', 'description' => 'Discount C', 'amount' => '700', 'direction' => 'Decrease', 'reason' => 'z']), 'request checked against the approved total (700 - 700 = 0 refused)', 409);`
- L325: `ok($total($b2) === '700.00', 'total 1000 - 600 + 300 = 700');`
- L328: `section('H. Document verification (Delivery Receipt) and finalize');`
- L334: `fails(fn() => $act($bil, 'verify', ['billing_id' => $b3]), 'verify refused without the Delivery Receipt', 422, 'Delivery Receipt');`
- L337: `ok($B($b3)['docs_verified_at'] !== null, 'verify passes with Waybill + Delivery Receipt + Acknowledgement Receipt');`
- L339: `fails(fn() => $act($bil, 'finalize', ['billing_id' => $b3, 'invoice_date' => date('Y-m-d')]), 'finalize blocked while a request is pending', 409, 'waiting for Admin approval');`
- L340: `ok($B($b3)['status'] === 'For Billing' && $B($b3)['invoice_number'] === null, 'blocked finalize changed nothing');`
- L344: `ok($f['status'] === 'Invoiced' && $f['total_amount'] === '1250.00' && $f['charges_total'] === '250.00', 'finalized with the approved total only (1000 + 250)');`
- L350: `ok($B($b4)['total_amount'] === '1000.00', 'withdrawn request not in the invoice');`
- L356: `ok($B($b5)['total_amount'] === '1000.00' && $B($b5)['status'] === 'Invoiced', 'rejected request does not block and is not in the invoice');`
- L361: `ok($B($b6)['total_amount'] === '1000.00', 'finalize uses the approved lines, not a stale stored total');`
- L364: `section('I. Finalized / paid invoices are untouched');`
- L367: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $inv, 'description' => 'Late', 'amount' => '10']), 'no new request after finalizing', 409);`
- L368: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $h1, 'description' => 'X', 'amount' => '10', 'reason' => 'x']), 'no change request after finalizing', 409);`
- L369: `fails(fn() => $act($bil, 'charge_remove', ['charge_id' => $h1, 'reason' => 'x']), 'no removal request after finalizing', 409);`
- L370: `ok(json_encode($B($inv)) === $snap && json_encode(many($p, 'SELECT * FROM billing_charges WHERE billing_id=?', [$inv])) === $lines, 'invoiced record and its lines unchanged');`
- L375: `fails(fn() => $act($bil, 'charge_change', ['charge_id' => $old, 'description' => 'X', 'amount' => '1', 'reason' => 'x']), "old invoiced/paid billing $bid cannot be changed", 409);`
- L377: `ok(json_encode([$B($tB), $B($tC)]) === $legacy, 'old Invoiced and Paid records unchanged');`
- L381: `fails(fn() => $act($bil, 'collect', ['billing_id' => $b4, 'amount' => '1000', 'payment_date' => date('Y-m-d'), 'payment_method' => 'Cash', 'ar_number' => 'AR-1']), 'payment still requires the acknowledgement receipt file (unchanged)', 422, 'acknowledgement receipt');`
- L383: `fails(fn() => $act($bil, 'charge_add', ['billing_id' => $ongoing, 'description' => 'Early', 'amount' => '10']), 'no request while the trip is ongoing (draft view-only, unchanged)', 409, 'view-only');`
- L386: `section('J. Database constraints and views');`
- L394: `ok($C($def)['status'] === 'Pending Approval', 'DB default status is Pending Approval (never approved by accident)');`
- L400: `ok($chg === $expect && !in_array($c2, $chg, true) && !in_array($rm, $chg, true) && !in_array($e2, $chg, true), 'details(): charges = only the lines in the total (used by the printed invoice)', json_encode([$chg, $expect]));`
- L402: `ok(abs(1000 + $sumLines - (float)$total($b1)) < 0.001, 'printed invoice lines add up to the billing total');`
- L403: `ok(count($det['requests']) + count($det['charges']) === (int)one($p, 'SELECT COUNT(*) AS n FROM billing_charges WHERE billing_id=?', [$b1])['n'], 'details(): requests = every other row (pending + history)');`
- L405: `ok($rd['can']['decide'] === true && $rd['can']['act'] === false, 'read(): Admin can decide, cannot act');`
- L406: `ok(in_array($g2, array_column($rd['adjustments'], 'id'), false) === false && count($rd['adjustments']) === (int)one($p, "SELECT COUNT(*) AS n FROM billing_charges WHERE status='Pending Approval'")['n'], 'read(): approval list = all pending requests');`
- L408: `ok($rb['can']['decide'] === false && $rb['can']['act'] === true, 'read(): Billing can act, cannot decide');`
- L409: `ok(Access::canOpen($adm, 'billing'), 'Admin can open the Billing page (approval UI)');`
- L411: `ok(isset($row['dr_docs'], $row['pending_adjustments']) && (int)$row['dr_docs'] === 1, 'billing list shows DR documents and pending requests');`
- L414: `section('K. Trip operations do not depend on billing approvals');`
- L416: `ok(!str_contains($src, 'billing_charges') && !str_contains($src, 'Pending Approval\' AND billing'), 'Trips and BillingDraft never read billing_charges (planning, dispatch, completion unaffected)');`
- L419: `ok($t9 > 0 && in_array(one($p, 'SELECT status FROM trips WHERE id=?', [$t9])['status'], ['Pre-Assigned', 'Awaiting Resources'], true), 'trip planning works while billing requests are pending (normal planning status)');`
- L421: `ok(one($p, 'SELECT total_amount FROM billings WHERE trip_id=?', [$t9])['total_amount'] === '1000.00', 'billing draft at dispatch unaffected (base only)');`
- L422: `ok($C($pend)['status'] === 'Pending Approval', 'pending request untouched by other trip operations');`
- L425: `section('L. Two processes at the same moment (approval / request / finalize)');`
- L455: `ok($w1 >= 1, 'finalize waited for the request being saved', "waiting=$w1");`
- L456: `ok(!$o1['ok'] && ($o1['code'] ?? 0) === 409 && str_contains($o1['message'], 'waiting for Admin approval'), 'finalize then refused: the pending amount cannot reach an invoice', json_encode($o1));`
- L457: `ok($B($l1)['status'] === 'For Billing' && $B($l1)['invoice_number'] === null && $total($l1) === '1000.00', 'no invoice, total without the pending amount');`
- L463: `ok($w2 >= 1, 'finalize waited for the approval', "waiting=$w2");`
- L464: `ok($o2['ok'] && $B($l2)['status'] === 'Invoiced' && $B($l2)['total_amount'] === '1300.00' && $invoiceMatchesLines($l2), 'finalize then invoiced exactly base + approved lines (1300)', json_encode([$o2, $B($l2)['total_amount']]));`
- L470: `ok($w3 >= 1 && $o3['ok'] && $B($l3)['total_amount'] === '1000.00' && $invoiceMatchesLines($l3), 'finalize after a concurrent rejection: invoice 1000, rejected 450 not included', json_encode($o3));`
- L475: `ok($w4 >= 1 && !$o4['ok'] && ($o4['code'] ?? 0) === 409, 'a request arriving during finalize waited and was refused', json_encode($o4));`
- L476: `ok($B($l4)['total_amount'] === '1000.00' && !one($p, 'SELECT id FROM billing_charges WHERE billing_id=?', [$l4]), 'finalized invoice unchanged, no line added');`
- L482: `ok($w5 >= 1 && !$o5['ok'] && ($o5['code'] ?? 0) === 409 && str_contains($o5['message'], 'already decided'), 'second Admin waited and got "already decided"', json_encode($o5));`
- L483: `ok($total($l5) === '1200.00' && (int)$C($rq5)['decided_by'] === $adm['id'], 'approved amount counted once (1200)');`
- L491: `ok($w6 >= 1 && !$o6['ok'] && ($o6['code'] ?? 0) === 409, 'removal request of a line being superseded waited and was refused', json_encode($o6));`
- L492: `ok($total($l6) === '1150.00' && $C($base6)['status'] === 'Superseded' && $C($chg6)['status'] === 'Approved', 'one consistent result: changed line 150, total 1150');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## crew_attendance_tests.php

Launcher: `run_crew_attendance_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Admin::action, Attendance::action, Attendance::remind, CrewAttendance::MODE_WARN, CrewAttendance::dueShifts, CrewAttendance::hourLabel, CrewAttendance::mode, CrewAttendance::shiftFor, CrewAttendance::startHours, CrewAttendance::unassignedCrew, Fleet::action, Settings::all, Settings::clearCache, Settings::value, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L36: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L37: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L38: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L42: `section('Setup: disposable fresh database');`
- L45: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L65: `section('A. Shift boundaries (single source, Philippine time)');`
- L72: `foreach ($cases as $local => [$date, $shift]) { $r = $at($local); ok($r === ['date' => $date, 'shift' => $shift], "$local -> $shift shift of $date", json_encode($r)); }`
- L73: `ok(date_default_timezone_get() === 'Asia/Manila' && CrewAttendance::shiftFor(gmmktime(16, 30, 0, 11, 8, 2026)) === ['date' => '2026-11-08', 'shift' => 'Night'], '00:30 PH (16:30 UTC the day before) is read in Philippine time');`
- L75: `ok($at('2026-11-08 06:30:00') === ['date' => '2026-11-07', 'shift' => 'Night'] && $at('2026-11-08 18:30:00') === ['date' => '2026-11-08', 'shift' => 'Day'] && $at('2026-11-08 19:00:00')['shift'] === 'Night',`
- L79: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_night_start_hour', 'value' => '6']), 'Night start = Day start (6) refused', 409, 'cannot be the same');`
- L80: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '18']), 'Day start = Night start (18) refused', 409, 'cannot be the same');`
- L81: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '6.5']), 'half hour refused (whole hours only)', 400, 'whole hour');`
- L82: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '24']), 'hour 24 refused (range kept)', 400);`
- L83: `ok(Settings::value('attendance_day_start_hour') === 6.0 && Settings::value('attendance_night_start_hour') === 18.0, 'refused saves left the hours unchanged');`
- L86: `ok($at('2026-11-08 05:00:00')['shift'] === 'Day' && $at('2026-11-08 17:00:00')['shift'] === 'Night', 'valid different hours (5 / 17) saved and used');`
- L88: `ok($aud !== null, 'setting change still audited');`
- L90: `ok(CrewAttendance::startHours() === [6, 18] && $at('2026-11-08 20:00:00') === ['date' => '2026-11-08', 'shift' => 'Night'], 'identical hours already in the database -> safe defaults 6 / 18 (a Night shift still exists)');`
- L93: `section('A2. Bell reminder shifts follow shiftFor() for both start-hour orderings');`
- L95: `ok($due('2026-11-08 03:00:00') === [['Night', '2026-11-07']], 'normal 6 AM / 6 PM, 3:00 AM: last night\'s Night shift only', json_encode($due('2026-11-08 03:00:00')));`
- L96: `ok($due('2026-11-08 10:00:00') === [['Day', '2026-11-08']], 'normal, 10:00 AM: today\'s Day shift');`
- L97: `ok($due('2026-11-08 20:00:00') === [['Day', '2026-11-08'], ['Night', '2026-11-08']], 'normal, 8:00 PM: today\'s Day and Night shifts');`
- L103: `ok(CrewAttendance::startHours() === [18, 6], 'reversed start hours accepted (Day 6:00 PM, Night 6:00 AM)');`
- L106: `ok($at($local) === ['date' => $date, 'shift' => $shift], "reversed: $local -> $shift shift of $date", json_encode($at($local)));`
- L107: `ok($due('2026-11-08 03:00:00') === [['Day', '2026-11-07']], 'reversed, 3:00 AM: the Day shift that started yesterday 6 PM (old reminder said Night of yesterday)', json_encode($due('2026-11-08 03:00:00')));`
- L108: `ok($due('2026-11-08 10:00:00') === [['Night', '2026-11-08']], 'reversed, 10:00 AM: today\'s Night shift');`
- L109: `ok($due('2026-11-08 20:00:00') === [['Night', '2026-11-08'], ['Day', '2026-11-08']], 'reversed, 8:00 PM: today\'s Night and Day shifts');`
- L112: `ok(in_array([$cur['shift'], $cur['date']], $due($local), true), "reversed, $local: the shift in progress is always reminded");`
- L121: `ok($keys === $expect, 'remind() (reversed hours, real clock) creates crew bells exactly for dueShifts()', json_encode([$keys, $expect]));`
- L125: `section('A3. 12-hour (AM/PM) display of the shift start settings');`
- L127: `ok(CrewAttendance::hourLabel($h) === $label, "$h -> $label");`
- L129: `ok($all['attendance_day_start_hour']['format'] === 'hour' && $all['attendance_night_start_hour']['format'] === 'hour' && $all['attendance_day_start_hour']['value'] === 6.0 && $all['attendance_night_start_hour']['value'] === 18.0,`
- L131: `ok($all['fund_release_lead_hours']['format'] === 'number' && $all['checklist_lead_hours']['format'] === 'number', 'other settings unchanged (number)');`
- L133: `ok(str_contains($r['message'], '(4:00 AM)') && Settings::value('attendance_day_start_hour') === 4.0, 'saving 4 says "4:00 AM" and stores 4', $r['message']);`
- L135: `ok(str_contains((string)$a['details'], '4:00 AM') && str_contains((string)$a['changes_json'], '6:00 AM') && str_contains((string)$a['changes_json'], '4:00 AM'), 'Activity Log shows 6:00 AM -> 4:00 AM', json_encode($a));`
- L136: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'attendance_day_start_hour', 'value' => '6:00 AM']), 'text "6:00 AM" is not a stored value (the dropdown sends 6)', 400);`
- L139: `ok(preg_match('/const hour12 = \(h\) => ('[^']+');/', $js, $mm) === 1 && str_contains($js, "Array.from({ length: 24 }") && str_contains($js, "type: 'select'"), 'settings screen: 24-option AM/PM dropdown');`
- L142: `ok(trim((string)$out) === '["12:00 AM","4:00 AM","6:00 AM","12:00 PM","1:00 PM","6:00 PM","11:00 PM"]', 'screen labels match the server labels (node)', (string)$out);`
- L146: `section('B. Crew roster: drivers and helpers');`
- L154: `ok($ids == [$dDay, $hDay] && $l['total'] === 2, 'Day roster: the Day driver AND the Day helper (no Night, no shift-less, no inactive)', json_encode($ids));`
- L155: `ok(array_column($l['rows'], 'person_type') === ['Driver', 'Helper'], 'roster shows the crew type');`
- L157: `ok(array_map('intval', array_column($n['rows'], 'id')) == [$dNight, $hNight], 'Night roster: Night driver and helper');`
- L160: `ok(array_column($marks, 'status', 'personnel_id') == [$dDay => 'Present', $hDay => 'Absent'], 'helper attendance saved like a driver\'s', json_encode($marks));`
- L161: `fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present'], ['id' => $hDay, 'status' => 'Present'], ['id' => $hNight, 'status' => 'Present']]]),`
- L163: `fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present'], ['id' => $hDay, 'status' => 'Present'], ['id' => $hNone, 'status' => 'Present']]]),`
- L167: `section('C. Helper shift assignment');`
- L171: `fails(fn() => $save($adm, $hNone, null), 'Admin must choose a shift when saving a helper', 400, 'shift for the helper');`
- L173: `ok($crew($hNone)['duty_shift'] === 'Night', 'Admin assigns a Night shift to the helper');`
- L175: `ok(str_contains((string)($aud['changes_json'] ?? ''), 'Assigned shift') && str_contains((string)$aud['changes_json'], 'Night'), 'shift change recorded in the Activity Log', (string)($aud['changes_json'] ?? ''));`
- L176: `ok(in_array($hNone, array_map('intval', array_column(Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Night'])['rows'], 'id')), true), 'the helper now appears in the Night roster');`
- L177: `fails(fn() => $save($adm, $dNone, null, 'Driver'), 'Admin must still choose a shift for a driver', 400, 'shift for the driver');`
- L179: `ok($crew($hDay)['duty_shift'] === 'Day', 'Operations Head edit keeps the helper\'s shift (shift stays Admin-only)');`
- L181: `ok($crew($newId)['duty_shift'] === null, 'helper added by the Operations Head starts without a shift (Admin assigns it)');`
- L183: `fails(fn() => Fleet::action($U($role), 'crew_save', ['id' => $hDay, 'full_name' => 'DAY, HELPER', 'person_type' => 'Helper', 'duty_shift' => 'Night']), "$role cannot change crew records", 403);`
- L186: `section('D. Unassigned-shift readiness list and Admin bell');`
- L188: `ok(array_map('intval', array_column($un, 'id')) == [$dNone, $newId], 'readiness list: active driver / helper without a shift (inactive excluded)', json_encode($un));`
- L190: `ok(count($l['unassigned']) === 2, 'crew attendance list returns the unassigned crew for the warning');`
- L191: `ok(Attendance::action($adm, 'list', ['kind' => 'Mechanic', 'duty_date' => $today, 'duty_shift' => 'Day'])['unassigned'] === [], 'mechanic list has no crew warning');`
- L195: `ok($bell && str_contains($bell['message'], '2 active driver(s)/helper(s) have no Day/Night shift') && in_array($bell['state'], ['Unread', 'Read'], true), 'Admin bell: crew without a shift', json_encode($bell));`
- L197: `ok((int)one($p, "SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key='att-noshift' AND user_id=?", [$adm['id']])['n'] === 1, 'no duplicate bell on refresh');`
- L200: `ok(one($p, "SELECT state FROM notifications WHERE dedupe_key='att-noshift' AND user_id=?", [$adm['id']])['state'] === 'Resolved' && CrewAttendance::unassignedCrew($p) === [], 'all shifts assigned: bell resolved');`
- L201: `ok(!one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key='att-noshift' AND user_id<>?", [$adm['id']]), 'only the Admin gets the shift bell');`
- L204: `section('E. Attendance Phase 1 behaviour kept');`
- L205: `fails(fn() => Attendance::action($adm, 'list', ['kind' => 'Driver', 'duty_date' => date('Y-m-d', strtotime('+1 day')), 'duty_shift' => 'Day']), 'future attendance still refused', 409, 'future');`
- L206: `fails(fn() => Attendance::action($adm, 'save', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day', 'items' => [['id' => $dDay, 'status' => 'Present']]]), 'partial roster still refused', 409, 'roster changed');`
- L208: `fails(fn() => Attendance::action($U($role), 'list', ['kind' => 'Driver', 'duty_date' => $today, 'duty_shift' => 'Day']), "$role cannot open attendance", 403);`
- L211: `ok(array_map('intval', array_column($ml['rows'], 'id')) == [$m], 'mechanic roster unchanged');`
- L216: `ok($ch && $ch['action'] === 'attendance updated' && str_contains((string)$ch['changes_json'], 'Absent') && str_contains((string)$ch['changes_json'], 'Present'), 'helper correction Absent -> Present kept in the audit trail', json_encode($ch));`
- L219: `ok((int)one($p, "SELECT COUNT(*) AS n FROM attendance_marks WHERE duty_date=? AND duty_shift='Night'", [date('Y-m-d', strtotime('-1 day'))])['n'] === 3, 'yesterday\'s Night shift can be marked (past date)');`
- L222: `section('F. No operational effect yet (hard blocker not enabled)');`
- L229: `ok($t['status'] === 'Pre-Assigned' && (int)$t['driver_id'] === $dNight && (int)$t['helper_id'] === $hNight, 'future trip still planned and auto-assigned (no attendance needed for planning)');`
- L231: `ok(!preg_grep('/attendance|Present|shift/i', $det['trip']['dispatch_blockers']), 'Warn mode (default): attendance never blocks Confirm Dispatch');`
- L232: `ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'default attendance check is Warn (enforcement suite: run_crew_dispatch_tests.php)');`
- L234: `ok(str_contains($js, 'Crew Attendance (Drivers and Helpers)') && str_contains($js, 'data-att-unassigned'), 'attendance modal: crew title and unassigned warning');`
- L236: `ok(str_contains($fjs, "label: 'Assigned shift', type: 'select'") && str_contains($fjs, "required: UI.role('admin'),"), 'masterlist form: shift for drivers and helpers (Admin)');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## crew_dispatch_tests.php

Launcher: `run_crew_dispatch_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Admin::action, Attendance::action, CrewAttendance::MODE_ENFORCE, CrewAttendance::MODE_WARN, CrewAttendance::crewCompleteness, CrewAttendance::dispatchFindings, CrewAttendance::hourLabel, CrewAttendance::mode, CrewAttendance::shiftFor, Settings::all, Settings::clearCache, Trips::action, Trips::timeGates

Source scenario and assertion inventory (line references preserve exact expectations):

- L42: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L43: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L44: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L48: `section('Setup: disposable fresh database');`
- L51: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L73: `ok($NOW['shift'] === 'Day', 'test clock: now is inside a Day shift', json_encode($NOW));`
- L113: `section('A. Warn / Enforce setting and the Enforce guard');`
- L114: `ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'default mode: Warn');`
- L116: `ok(($all['crew_attendance_dispatch_check']['format'] ?? '') === 'attendance_mode' && $all['crew_attendance_dispatch_check']['value'] === 1.0, 'setting listed for the Admin screen (Warn / Enforce)');`
- L118: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '2']), 'Enforce refused while a helper has no shift (names listed)', 409, 'HELPER NOSHIFT');`
- L119: `ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'still Warn after the refusal');`
- L120: `foreach (['3', '0', '1.5', 'Enforce', ''] as $v) fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => $v]), "value '$v' refused", 400);`
- L121: `fails(fn() => Admin::action($ops, 'setting_save', ['key' => 'crew_attendance_dispatch_check', 'value' => '2']), 'Operations Head cannot change the mode', 403);`
- L124: `ok(CrewAttendance::mode() === CrewAttendance::MODE_ENFORCE && str_contains($r['message'], 'Enforce'), 'every crew member has a shift: Enforce on', $r['message']);`
- L126: `ok(str_contains((string)$a['changes_json'], '"Warn"') && str_contains((string)$a['changes_json'], '"Enforce"'), 'Activity Log: Warn -> Enforce', (string)$a['changes_json']);`
- L129: `ok(CrewAttendance::mode() === CrewAttendance::MODE_WARN, 'switching back to Warn is always allowed (rollback)');`
- L133: `section('B. Enforce: Confirm Dispatch needs Present crew on their own shift');`
- L137: `ok((int)$T($id)['driver_id'] === $D && (int)$T($id)['helper_id'] === $H, 'trip assigned to the Day crew');`
- L139: `ok(($det['crew_attendance']['mode'] ?? '') === 'Enforce' && count($det['crew_attendance']['crew']) === 2 && str_contains(implode(' ', $det['dispatch_blockers']), 'not yet marked Present'),`
- L141: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Not Yet Marked: Confirm Dispatch refused (direct API call)', 409, 'not yet marked Present for the Day shift');`
- L142: `ok($T($id)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$id]), 'refused dispatch: status and billing untouched');`
- L144: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'driver Present, helper Not Yet Marked: refused', 409, '(Helper) is not yet marked Present');`
- L146: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper Absent: refused with the Absent reason', 409, 'marked Absent');`
- L149: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Present but Unavailable: still refused (Present does not bypass availability)', 409, 'marked Unavailable');`
- L152: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Present but license expired: still refused', 409, 'license is expired');`
- L156: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper on the Night shift (Present for Night): refused, other-shift attendance not accepted', 409, 'is on the Night shift, but Confirm Dispatch now falls in the Day shift');`
- L158: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'helper with no shift: refused', 409, 'has no assigned shift');`
- L161: `ok($T($id)['status'] === 'Dispatched' && one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'Ongoing' && !str_contains($r['message'], 'Attendance'), 'all Present on their shift: dispatched, billing draft made, no attendance note');`
- L165: `ok((int)$T($cc)['driver2_id'] > 0, 'Car Carrier trip has Driver 2');`
- L167: `fails(fn() => Trips::action($ccd, 'dispatch', ['trip_id' => $cc]), 'Car Carrier: Driver 2 not marked -> refused', 409, '(Driver 2) is not yet marked Present');`
- L170: `ok($T($cc)['status'] === 'Dispatched', 'Car Carrier: both drivers Present -> dispatched');`
- L173: `section('C. Warn: dispatch allowed, unconfirmed attendance noted');`
- L178: `ok(!preg_grep('/attendance|Present|shift/i', $det['dispatch_blockers']) && $det['crew_attendance']['mode'] === 'Warn', 'Warn: attendance is not a blocker, but shown in the trip details');`
- L181: `ok($T($id)['status'] === 'Dispatched' && str_contains((string)$ev['notes'], 'Attendance not confirmed (Warn mode)') && str_contains((string)$ev['notes'], 'not yet marked Present')`
- L186: `ok(!str_contains($r['message'], 'Attendance') && !str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='dispatch confirmed'", [$id])['notes'], 'Attendance'), 'Warn with everyone Present: no note');`
- L189: `section('D. Cross-shift early dispatch (actual dispatch time decides)');`
- L196: `ok($nowShift['shift'] === 'Day' && $nextNight['shift'] === 'Night', 'clock: Day now, Night from the next hour', json_encode([$nowShift, $nextNight]));`
- L200: `ok((int)$T($id)['driver_id'] === $ND, 'Night trip assigned to the Night crew (scheduled shift)');`
- L203: `ok($gates['dispatch_allowed_now'] === true, 'trip 5 min after the Night start: inside the (120-min) early dispatch window');`
- L204: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Night crew (Present for tonight) before the Night shift starts: refused', 409, 'Confirm Dispatch now falls in the Day shift');`
- L206: `ok(str_contains($e->getMessage(), 'Wait for the Night shift (from ' . CrewAttendance::hourLabel($nightStart) . ')'), 'message says when the Night shift starts', $e->getMessage()); }`
- L208: `ok(!array_filter(array_column($after['crew'], 'problem')), 'at the Night start (same trip, same marks): no attendance problem');`
- L213: `section('E. Overnight duty dates (fixed clock, 6:00 AM / 6:00 PM)');`
- L219: `ok($f('2026-11-08 00:30:00', $fake)['problem'] === null, '00:30 Nov 8: Present for the Night shift of Nov 7 counts');`
- L220: `ok($f('2026-11-08 05:59:00', $fake)['problem'] === null, '05:59 Nov 8: still the Night shift of Nov 7');`
- L221: `ok(str_contains((string)$f('2026-11-08 18:30:00', $fake)['problem'], 'not yet marked Present for the Night shift of Nov 8, 2026'), '18:30 Nov 8: needs the Night shift of Nov 8 (Nov 7 mark does not count)');`
- L223: `ok(str_contains((string)$f('2026-11-09 03:00:00', $fake)['problem'], 'marked Absent for the Night shift of Nov 8, 2026'), '03:00 Nov 9: Absent for the Night shift of Nov 8');`
- L225: `ok(str_contains((string)$f('2026-11-08 05:55:00', ['id' => 0, 'driver_id' => $DY])['problem'], 'falls in the Night shift of Nov 7, 2026'), '05:55: Day crew Present for Nov 8 Day is still before the Day shift');`
- L226: `ok($f('2026-11-08 06:00:00', ['id' => 0, 'driver_id' => $DY])['problem'] === null, '06:00: Day shift of Nov 8 -> OK');`
- L230: `section('F. Shift-aware auto-assignment');`
- L235: `ok((int)$t['driver_id'] === $dD && (int)$t['helper_id'] === $hD && !str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'fallback'),`
- L241: `ok((int)$t['driver_id'] === $dN && (int)$t['helper_id'] === $hN, 'Night trip: Night crew picked (scheduled shift used for planning)');`
- L248: `ok((int)$T($id)['helper_id'] === $hD2, 'Day helper marked Absent for this shift skipped; the other Day helper picked');`
- L255: `ok((int)$t['helper_id'] === $hN && $t['status'] === 'Pre-Assigned', 'Warn: no free Day helper (the Day one is Absent) -> Night helper as fallback, never the Absent one');`
- L256: `ok(str_contains($ev, 'Shift fallback (Warn mode)') && str_contains($ev, '(Helper, Night shift)') && str_contains($ev, 'Attendance is NOT verified'), 'fallback written in the trip history', $ev);`
- L257: `ok((int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn() === $c0 + 1, 'fallback audited');`
- L258: `ok((bool)one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ? AND user_id=?", ['trip-shift-fallback-' . $id . '-1-%', $ops['id']]), 'Operations Head notified of the fallback');`
- L261: `ok($hc['outside_scheduled_shift'] === true && $hc['problem'] !== null && $hc['issue'] === 'Shift mismatch', 'trip screen flags the helper: outside the trip shift, "Shift mismatch" (not Present)');`
- L264: `ok((int)$T($id)['helper_id'] === $hX && str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'no assigned shift'), 'Warn: helper with no shift as fallback, flagged');`
- L269: `ok($t['status'] === 'Awaiting Resources' && $t['helper_id'] === null, 'Enforce: no cross-shift fallback -> Awaiting Resources');`
- L270: `ok(str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? ORDER BY id DESC LIMIT 1", [$id])['notes'], 'No Day-shift helper is available (Enforce mode'), 'reason names the shift and Enforce mode');`
- L278: `ok($T($r['trip_id'])['status'] === 'Awaiting Resources', 'Present but Unavailable helper is never auto-assigned (availability first)');`
- L283: `section('G. Operations Head notice for Absent assigned crew');`
- L295: `ok(count($n) === 1 && (int)$n[0]['user_id'] === $ops['id'] && $n[0]['state'] === 'Unread' && str_contains($n[0]['message'], 'marked Absent') && str_contains($n[0]['message'], $T($gid)['trip_ref']), 'Operations Head notified (one notice, names the trip)', json_encode($n));`
- L296: `ok((int)$T($gid)['helper_id'] === $gH && $T($gid)['status'] === 'Pre-Assigned', 'assignment not changed by the attendance');`
- L299: `ok(count($notes()) === 1, 'saving again does not duplicate the notice');`
- L301: `ok($notes()[0]['state'] === 'Resolved', 'corrected to Present: notice resolved');`
- L303: `ok(count($notes()) === 1 && $notes()[0]['state'] === 'Unread', 'marked Absent again: same notice re-opened (no duplicate)');`
- L306: `ok(!one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ?", ['att-absent-' . $gH . '-' . $yest . '%']), 'Absent for another shift (yesterday): no notice');`
- L311: `ok((bool)one($p, 'SELECT 1 AS x FROM notifications WHERE dedupe_key=?', ['att-absent-' . $oD . '-' . $NOW['date'] . '-Day-' . $oid]), 'overdue trip: Absent for the current shift -> notified');`
- L318: `ok([$T($aid), many($p, 'SELECT * FROM trip_assignments WHERE trip_id=? ORDER BY resource_type, resource_id', [$aid])] == $before && !one($p, 'SELECT 1 AS x FROM notifications WHERE dedupe_key LIKE ?', ['att-absent-' . $aD . '-%']),`
- L321: `ok($T($aid)['status'] === 'On Hold - Incident Reported', 'incident report on the active trip still works');`
- L324: `section('H. Second attempt (Redispatch)');`
- L334: `ok((int)$T($rid)['attempt_number'] === 2 && $T($rid)['status'] === 'Ready for Dispatch', 'attempt 2 ready (same crew)');`
- L336: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $rid]), 'Redispatch with the driver now Absent: refused', 409, 'marked Absent');`
- L339: `ok($T($rid)['status'] === 'Dispatched' && str_contains($r['message'], 'Redispatch confirmed'), 'attendance corrected: Redispatch confirmed');`
- L342: `section('I. Attendance changed at the same moment as Confirm Dispatch (two processes)');`
- L365: `ok($waiting >= 1, 'Confirm Dispatch waited for the unsaved attendance change', "waiting=$waiting");`
- L366: `ok(!$out['ok'] && ($out['code'] ?? 0) === 409 && str_contains($out['message'], 'marked Absent'), 'it then saw the new Absent mark and refused (no stale Present)', json_encode($out));`
- L367: `ok($T($xid)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$xid]), 'trip not dispatched, no billing');`
- L370: `section('J. Readiness report and regression');`
- L373: `ok($rd['mode'] === 'Enforce' && in_array($T($xid)['trip_ref'], $refs, true), 'readiness lists upcoming trips with Absent / other-shift crew', json_encode($rd['trips']));`
- L374: `ok(in_array($hX, array_map('intval', array_column($rd['unassigned'], 'id')), true), 'readiness lists crew without a shift');`
- L375: `fails(fn() => Attendance::action($ops, 'readiness', []), 'readiness is Admin-only', 403);`
- L377: `ok(isset($l['readiness']['trips']), 'Crew Attendance window carries the readiness warnings');`
- L381: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $zid]), 'crew Present but 60 min early: time gate still refuses', 409, 'Confirm Dispatch opens');`
- L384: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $zid]), 'crew Present but no checklist for the attempt: still refused', 409, 'No pre-dispatch checklist');`
- L389: `ok($T($zid)['status'] === 'Dispatched' && $b['base_amount'] === '1000.00', 'dispatched; billing draft = 20 km x 50.00 unchanged');`
- L391: `ok(str_contains($js, 'crew_attendance') && str_contains($js, 'Attendance.readiness') && str_contains($js, 'Outside trip shift') && str_contains($js, "'attendance_mode'"), 'screens: crew attendance in trip details, readiness before switching mode, fallback badge');`
- L394: `section('K. Manual reassignment (Operations Head)');`
- L404: `ok($co['mode'] === 'Warn' && $co['shift'] === 'Day', 'crew options: trip shift and mode');`
- L405: `ok($byId[$kHabs]['labels'] === ['Absent'] && $byId[$kHabs]['allowed'] === false, 'Absent helper labelled "Absent", not allowed');`
- L406: `ok($byId[$kHn]['labels'] === ['Shift mismatch'] && $byId[$kHn]['duty_shift'] === 'Night' && $byId[$kHn]['allowed'] === true, 'Night helper labelled "Shift mismatch" (allowed in Warn)');`
- L407: `ok($byId[$kHx]['labels'] === ['No shift'] && $byId[$kHx]['allowed'] === true, 'helper without shift labelled "No shift" (allowed in Warn)');`
- L408: `ok(in_array('Not available', $byId[$kHu]['labels'], true) && $byId[$kHu]['allowed'] === false, 'Unavailable helper labelled, not allowed');`
- L409: `ok($byId[$kH]['current'] === true && $byId[$kH]['labels'] === [] && $byId[$kH]['allowed'] === true, 'current same-shift helper: no label');`
- L410: `foreach (['container_wingvan_dispatcher', 'finance', 'admin'] as $role) fails(fn() => Trips::action($U($role), 'crew_options', ['trip_id' => $kid]), "$role cannot open crew options", 403);`
- L413: `fails(fn() => $re($kHabs), 'Warn: Absent helper refused', 409, 'marked Absent for the Day shift');`
- L414: `fails(fn() => $re($kHu), 'Unavailable helper refused (availability unchanged)', 409, 'Not available');`
- L415: `ok($T($kid) == $before, 'refused reassignments changed nothing (still Ready for Dispatch)');`
- L420: `ok((int)$t['helper_id'] === $kHn && $t['status'] === 'Pre-Assigned' && str_contains($r['message'], 'checklist must be done again'), 'Warn: Night helper accepted; trip back to Pre-Assigned (new checklist)');`
- L421: `ok(str_contains($r['message'], 'Warning: Shift fallback (Warn mode, manual)') && str_contains($ev, 'Shift fallback (Warn mode, manual)') && str_contains($ev, '(Helper, Night shift)'), 'visible warning and trip history entry', $ev);`
- L422: `ok((int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='crew shift fallback'")->fetchColumn() === $c0 + 1, 'fallback audited');`
- L423: `ok((bool)one($p, "SELECT 1 AS x FROM notifications WHERE dedupe_key=? AND user_id=?", ['trip-shift-fallback-' . $kid . '-1-' . $kD . '-0-' . $kHn, $ops['id']]), 'Operations Head notified');`
- L425: `ok((int)$T($kid)['helper_id'] === $kHx && str_contains($r['message'], 'no assigned shift'), 'Warn: helper without shift accepted with warning');`
- L427: `ok((int)$T($kid)['helper_id'] === $kH && !str_contains($r['message'], 'Warning'), 'back to the Day helper: no warning');`
- L430: `ok($co['mode'] === 'Enforce' && $byId[$kHn]['allowed'] === false && $byId[$kHx]['allowed'] === false && $byId[$kH]['allowed'] === true, 'Enforce: other-shift and no-shift crew marked not allowed');`
- L432: `fails(fn() => $re($kHn), 'Enforce: Night helper refused server-side', 409, 'Enforce mode does not allow');`
- L433: `fails(fn() => $re($kHx), 'Enforce: helper without shift refused server-side', 409, 'has no assigned shift');`
- L434: `fails(fn() => $re($kHabs), 'Enforce: Absent helper refused', 409, 'marked Absent');`
- L435: `ok($T($kid) == $before, 'Enforce refusals changed nothing');`
- L438: `ok((int)$T($kid)['helper_id'] === $kH2, 'Enforce: another Day helper accepted');`
- L442: `fails(fn() => $re($kH), 'overdue trip: helper Absent for the current shift refused', 409, 'marked Absent');`
- L448: `fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $kcc, 'vehicle_id' => $T($kcc)['vehicle_id'], 'driver_id' => $k1, 'reason' => 'x']), 'Car Carrier reassign without Driver 2 refused', 400, 'Driver 1 and Driver 2');`
- L449: `fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $kcc, 'vehicle_id' => $T($kcc)['vehicle_id'], 'driver_id' => $k1, 'driver2_id' => $k1, 'reason' => 'x']), 'same driver twice refused', 400, 'same person');`
- L452: `ok((int)$T($kcc)['driver2_id'] === $k3, 'Car Carrier with two different drivers accepted');`
- L454: `fails(fn() => Trips::action($ops, 'reassign', ['trip_id' => $aid, 'vehicle_id' => $T($aid)['vehicle_id'], 'driver_id' => $aD, 'helper_id' => $aH, 'reason' => 'x']), 'trip on the road (incident) cannot be reassigned', 409);`
- L457: `section('L. Required crew at Confirm Dispatch / Redispatch (both modes, direct API)');`
- L464: `fails(fn() => Trips::action($who, 'dispatch', ['trip_id' => $id]), "$m: $name", 409, $contains);`
- L465: `ok($T($id) == $before && many($p, 'SELECT * FROM billings WHERE trip_id=?', [$id]) == $bills, "$m: nothing changed, no new / changed billing");`
- L472: `ok($T($lcc)['driver2_id'] === null && $T($lcc)['status'] === 'Ready for Dispatch', 'Car Carrier trip with Driver 2 removed (old data)');`
- L474: `ok(str_contains(implode(' ', $det['crew_attendance']['missing']), 'No Driver 2 assigned'), 'trip details show the missing Driver 2');`
- L476: `try { run($p, 'UPDATE trips SET driver2_id=driver_id WHERE id=?', [$lcc]); ok(false, 'database refuses the same driver twice'); }`
- L477: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'chk_trip_crew'), 'database itself refuses the same driver as Driver 1 and Driver 2 (chk_trip_crew)'); }`
- L479: `ok(str_contains(implode(' ', CrewAttendance::crewCompleteness($p, $dup)), 'same person'), 'completeness check also reports the same driver twice');`
- L493: `ok($T($lw)['status'] === 'Dispatched', 'complete Wing Van crew: dispatched');`
- L506: `section('M. Car Carrier auto-assignment needs two eligible drivers');`
- L518: `ok($t['status'] === 'Awaiting Resources' && $t['vehicle_id'] === null && $t['driver_id'] === null && $t['driver2_id'] === null, "$m: one free driver -> Awaiting Resources, nothing assigned");`
- L519: `ok(str_contains($evNote($t['id']), 'Car Carrier requires two available' . ($m === 'Enforce' ? ' Day-shift' : '') . ' drivers'), "$m: clear reason", $evNote($t['id']));`
- L520: `ok($after['holds'] == $before['holds'] && $after['vehicles'] == $before['vehicles'] && $after['crew'] == $before['crew'], "$m: no truck or driver reserved for the incomplete assignment");`
- L527: `ok($t['status'] === 'Pre-Assigned' && $t['driver_id'] && $t['driver2_id'] && (int)$t['driver_id'] !== (int)$t['driver2_id'] && !str_contains($evNote($id), 'fallback'), 'two free Day drivers: Driver 1 and Driver 2 assigned, no fallback');`
- L533: `ok($t['status'] === 'Pre-Assigned' && (int)$t['driver_id'] === $m1 && (int)$t['driver2_id'] === $mN && str_contains($ev, '(Driver 2, Night shift)') && str_contains($ev, 'Shift fallback (Warn mode)'),`
- L539: `ok($T($id)['status'] === 'Awaiting Resources' && $T($id)['driver_id'] === null && str_contains($evNote($id), 'two available Day-shift drivers (Enforce mode'), 'Enforce: Night driver not used -> Awaiting Resources');`
- L540: `ok($state()['holds'] == $before['holds'], 'Enforce: nothing reserved');`
- L547: `ok($T($id)['status'] === 'Awaiting Resources' && $state()['holds'] == $before['holds'], 'Warn: second driver Absent -> never picked; Awaiting Resources, nothing reserved');`
- L551: `ok($T($id)['status'] === 'Awaiting Resources', 'Warn: Absent driver + no-shift driver -> only one eligible, waits');`
- L555: `ok($t['status'] === 'Pre-Assigned' && in_array((int)$t['driver_id'], [$mN, $mX], true) && in_array((int)$t['driver2_id'], [$mN, $mX], true) && str_contains($evNote($id) . (string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='system auto-assigned truck and crew'", [$id])['notes'], 'Shift fallback'),`
- L560: `ok($T($id)['status'] === 'Awaiting Resources', 'one driver: waiting');`
- L563: `ok($T($id)['status'] === 'Pre-Assigned' && $T($id)['driver2_id'] !== null, 'second driver free: retry assigns both drivers');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## fund_release_tests.php

Launcher: `run_fund_release_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Checklist::sections, Funds::action, Funds::read, Money::METHODS, Money::paymentFields, Settings::clearCache, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L40: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L41: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L42: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L47: `section('Setup: disposable fresh database');`
- L50: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L91: `section('A. Cash release: voucher, expense, audit, server date');`
- L98: `ok($f['status'] === 'Released' && (int)$f['released_by'] === $fin['id'] && substr((string)$f['released_at'], 0, 10) === $today, 'released by Finance, release time = now (server)');`
- L99: `ok($dis && $dis['payment_method'] === 'Cash' && $dis['released_on'] === $today && $dis['cheque_number'] === null && $dis['bank_name'] === null && $dis['reference_number'] === null && $dis['amount'] === $f['amount'],`
- L101: `ok(preg_match('/^PV-\d{4}-\d{4,}$/', (string)$dis['voucher_number']) === 1 && str_contains($r['message'], $dis['voucher_number']), 'payment voucher generated and shown', (string)$dis['voucher_number']);`
- L102: `ok($exp && $exp['category'] === 'Trip Allowance' && $exp['amount'] === $f['amount'] && $exp['incurred_on'] === $today && (int)$exp['trip_id'] === $tid, 'expense recorded: Trip Allowance, same amount, dated today');`
- L104: `ok($aud && str_contains((string)$aud['details'], 'via Cash') && (int)$aud['actor_id'] === $fin['id'], 'audit trail: fund released via Cash by Finance', json_encode($aud ? [$aud['details'], $aud['actor_id']] : null));`
- L105: `ok($counts() == ['disbursements' => $c0['disbursements'] + 1, 'expenses' => $c0['expenses'] + 1, 'released_audit' => $c0['released_audit'] + 1], 'exactly one voucher, one expense, one audit row');`
- L108: `ok($F($fid)['status'] === 'Released', 'explicit Cash with today\'s date (what an old form would send) accepted');`
- L111: `ok($F($fid)['status'] === 'Released', 'blank optional fields accepted (treated as not sent)');`
- L114: `section('B. Non-Cash payment and payment details (direct API)');`
- L117: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid, 'payment_method' => $m, 'released_on' => $today] + $extra), "payment method '$m' refused", 400, 'cash only');`
- L118: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid, 'payment_method' => ['Cash']]), 'payment method sent as a list refused', 400);`
- L120: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid, $k => $v]), "Cash with $k filled in refused", 400, 'does not apply');`
- L121: `ok($F($fid)['status'] === 'Ready for Release', 'fund still Ready for Release after the refused attempts');`
- L124: `section('C. Backdated / future / changed release date (direct API)');`
- L127: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid, 'payment_method' => 'Cash', 'released_on' => $date]), "release date '$label' refused", 400, 'recorded automatically');`
- L128: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid, 'released_on' => [$today]]), 'release date sent as a list refused', 400);`
- L129: `ok($F($fid)['status'] === 'Ready for Release', 'fund still Ready for Release');`
- L132: `ok($f['status'] === 'Released' && substr((string)$f['released_at'], 0, 10) === $today && (int)$f['released_by'] === $fin['id'], 'unknown fields (released_at, released_by, status) ignored: server values recorded');`
- L135: `section('D. Double-click / repeated release');`
- L139: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'second click refused', 409, 'Only approved requests');`
- L140: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'third click refused', 409);`
- L141: `ok($counts() == ['disbursements' => $c0['disbursements'] + 1, 'expenses' => $c0['expenses'] + 1, 'released_audit' => $c0['released_audit'] + 1], 'only one voucher, one expense, one audit row after repeated clicks');`
- L142: `ok((int)one($p, "SELECT COUNT(*) AS n FROM disbursements WHERE source_type='fund_request' AND source_id=?", [$fid])['n'] === 1, 'one voucher for this fund');`
- L145: `section('E. Two Finance users at the same time (two PHP processes)');`
- L175: `ok($waiting === 2, 'both releases were waiting on the same fund at the same time', "waiting=$waiting");`
- L176: `ok(count($wins) === 1 && count($loses) === 1 && ($loses[0]['code'] ?? 0) === 409 && str_contains($loses[0]['message'], 'Released'), 'exactly one release succeeds; the other gets "already Released" (409)', json_encode($out));`
- L177: `ok($counts() == ['disbursements' => $c0['disbursements'] + 1, 'expenses' => $c0['expenses'] + 1, 'released_audit' => $c0['released_audit'] + 1], 'one voucher, one expense, one audit row');`
- L180: `section('F. Release window (#40) and closed trips');`
- L183: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'release 3 hours before dispatch refused (2-hour window)', 409, 'Too early');`
- L191: `ok($F($fid)['status'] === 'Released', 'Admin window 4 hours: same release now allowed (configurable window unchanged)');`
- L196: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), "release for a $st trip refused", 409, $st);`
- L200: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'trip cancelled through the system: release refused', 409);`
- L203: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'not yet approved (Pending Approval) refused', 409, 'Only approved');`
- L205: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $fid]), 'rejected fund request refused', 409, 'Only approved');`
- L206: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => 999999]), 'unknown fund refused', 404);`
- L207: `ok($counts() == ['disbursements' => $c0['disbursements'] + 1, 'expenses' => $c0['expenses'] + 1, 'released_audit' => $c0['released_audit'] + 1], 'only the allowed release wrote a voucher, an expense and an audit row');`
- L210: `section('G. Roles');`
- L213: `fails(fn() => Funds::action($U($role), 'release', ['fund_id' => $fid]), "$role cannot release", 403);`
- L215: `ok($F($fid)['status'] === 'Released' && (int)$F($fid)['released_by'] === $fin2['id'], 'any Finance user can release');`
- L218: `section('H. Nothing written by failed attempts');`
- L228: `ok($counts() == $c0 && (int)$p->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === $auditAll && (int)$p->query('SELECT COUNT(*) FROM notifications')->fetchColumn() === $notes,`
- L230: `ok($F($fid)['status'] === 'Ready for Release' && $F($fid)['disbursement_id'] === null && $F($fid)['released_at'] === null, 'fund untouched by the refused releases');`
- L233: `section('I. Shared payment methods unchanged (Billing / Finance / Purchasing)');`
- L234: `ok(Money::METHODS === ['Cash', 'Cheque', 'Bank Transfer', 'E-wallet'], 'shared payment methods list unchanged');`
- L236: `ok($pay['payment_method'] === 'Cheque' && $pay['released_on'] === date('Y-m-d', strtotime('-3 days')), 'other Finance payments still accept Cheque and an earlier date');`
- L237: `ok(Money::paymentFields(['payment_method' => 'Bank Transfer', 'reference_number' => 'R', 'payment_date' => $today], 'payment_date')['payment_method'] === 'Bank Transfer', 'Billing payment fields still accept Bank Transfer');`
- L239: `ok(!str_contains($src, 'cashReleaseFields'), 'cash-only rule used only by the trip fund release');`
- L242: `section('J. Trip Fund tabs (#37) and screen data');`
- L244: `ok($d['methods'] === ['Cash'], 'Trip Funds page offers Cash only');`
- L246: `ok(str_contains($js, 'CHECKLIST_36_CASH_ONLY_TRIP_FUND_RELEASE_V1') && !str_contains($js, 'UI.payFields'), 'release form has no payment method / date fields');`
- L247: `ok(str_contains($js, ''To Release (') && !preg_match('/'Ready for release \(/', $js), 'tab renamed: "To Release" (approved requests waiting for Finance)');`
- L248: `ok(str_contains($js, ''For liquidation (') && str_contains($js, "UI.btn('liquidate', 'Liquidate'"), 'liquidation keeps its own tab and Liquidate action');`
- L249: `ok(!preg_match('/All requests\s*\(/i', $js) && !preg_match('/To Liquidate/i', $js), 'no "All requests" tab and no "To Liquidate" label');`
- L251: `ok($m[1] === ['pending', 'release', 'liquidate', 'revision', 'history'], 'tab order: Pending approval, To Release, For liquidation, Needs revision, History', json_encode($m[1]));`
- L254: `section('K. Regression: liquidation, dispatch after release');`
- L265: `ok($T($tid)['status'] === 'Dispatched', 'released fund -> checklist -> Confirm Dispatch works (#38/#40 unchanged)');`
- L266: `fails(fn() => Funds::action($fin, 'liquidate', ['fund_id' => $fid, 'liquidated_amount' => '100.00']), 'liquidation still waits for the trip to finish', 409, 'after the trip');`
- L271: `ok($f['liquidation_status'] === 'Liquidated' && $f['returned_amount'] === '100.00', 'liquidation unchanged: spent and returned recorded');`
- L272: `ok((float)one($p, 'SELECT SUM(amount) AS s FROM expenses WHERE trip_id=?', [$tid])['s'] === (float)$amount - 100, 'trip allowance expense = released minus returned');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## map_tests.php

Launcher: `run_map_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Data::me, Maps::ROLES, Maps::action, Routes::action, Routes::read, Routing::configured, Routing::profile, Routing::reverse, Routing::route, Routing::search, Routing::straightKm, Routing::testConfig, Routing::useTransport

Source scenario and assertion inventory (line references preserve exact expectations):

- L41: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L42: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L43: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L47: `try { $fn(); ok(false, $name, 'no error was raised'); return null; }`
- L48: `catch (RoutingUnavailable $e) { ok($e->reason === $reason, $name, "reason {$e->reason}: {$e->getMessage()}"); return $e; }`
- L49: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); return null; }`
- L79: `section('Setup: disposable fresh database');`
- L82: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable fresh test database');`
- L95: `section('A. Configuration and secrecy of the API key');`
- L97: `ok(!Routing::configured(), 'no ORS_API_KEY -> routing is not configured');`
- L100: `ok(Routing::configured(), 'with ORS_API_KEY -> configured');`
- L106: `ok(isset($me['map']) && $me['map']['routing'] === true && $me['map']['tileUrl'] === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'screen settings: OpenStreetMap tiles, routing on');`
- L107: `ok(!str_contains($meJson, KEY) && !str_contains($meJson, 'mapKey') && !str_contains(strtolower($meJson), 'maptiler'), 'screen settings never contain the ORS key or MapTiler settings');`
- L108: `ok(count($me['map']['routeOptions']) === 3 && isset($me['map']['routeOptions']['recommended'], $me['map']['routeOptions']['avoid_tolls'], $me['map']['routeOptions']['general_roads']), 'three route options for the screen');`
- L111: `section('B. Requests sent to openrouteservice');`
- L115: `ok(($q['method'] ?? '') === 'POST' && ($q['url'] ?? '') === 'https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/json', 'POST to api.heigit.org/openrouteservice/v2/directions/driving-hgv/json', $q['url'] ?? '');`
- L116: `ok(in_array('Authorization: ' . KEY, $q['headers'] ?? [], true) && !str_contains($q['url'] ?? '', KEY), 'key sent only in the Authorization header (never in the URL)');`
- L117: `ok((bool)preg_grep('/^User-Agent: MulawinFleetOps/', $q['headers'] ?? []), 'identifying User-Agent sent');`
- L119: `ok($b['coordinates'] === [[121.1497, 14.0863], [121.1588, 14.0447]], 'coordinates in ORS order [lng, lat]', json_encode($b['coordinates'] ?? null));`
- L120: `ok(($b['options']['vehicle_type'] ?? null) === 'hgv' && !isset($b['options']['avoid_features']) && $b['units'] === 'm', 'Recommended: truck (hgv), nothing avoided');`
- L124: `ok(($b['options']['avoid_features'] ?? null) === $avoid, "$opt -> avoid_features " . json_encode($avoid));`
- L128: `ok(str_contains($REQ[0]['url'] ?? '', '/driving-car/json') && !isset(json_decode((string)$REQ[0]['body'], true)['options']['vehicle_type']), 'ORS_PROFILE=driving-car: car profile, no vehicle_type');`
- L130: `ok(Routing::profile() === 'driving-hgv', 'unknown profile falls back to driving-hgv');`
- L134: `section('C. Answers, rounding, warnings, input checks');`
- L136: `ok(abs($r['distance_km'] - round($straight * 1.25, 2)) <= 0.011 && $r['distance_km'] === round($r['distance_km'], 2), 'distance in km with 2 decimals (meters / 1000, not rounded up)', (string)$r['distance_km']);`
- L137: `ok($r['provider'] === 'openrouteservice/driving-hgv' && $r['option'] === 'recommended' && $r['geometry'] === '_p~iF~ps|U_ulLnnqC_mqNvxq'@' && $r['warning'] === '', 'provider, option and route line returned');`
- L139: `ok(str_contains(Routing::route($p, 1, $TAN, [14.20, 121.15], 'recommended')['warning'], 'shorter than the straight-line'), 'road shorter than straight line -> warning');`
- L141: `ok(str_contains(Routing::route($p, 1, $TAN, [14.15, 121.15], 'recommended')['warning'], 'more than 3 times'), 'road > 3x straight line -> warning');`
- L143: `ok(Routing::route($p, 1, $TAN, [14.16, 121.15], 'recommended')['geometry'] === '', 'route line with invalid characters is dropped');`
- L145: `fails(fn() => Routing::route($p, 1, $TAN, [14.17, 121.15], 'recommended'), 'road distance above 3,000 km refused');`
- L146: `fails(fn() => Routing::route($p, 1, [35.68, 139.69], $MAL, 'recommended'), 'pin outside the Philippines refused', 400, 'outside');`
- L147: `fails(fn() => Routing::route($p, 1, ['x', 121], $MAL, 'recommended'), 'incomplete pin refused', 400, 'incomplete');`
- L148: `fails(fn() => Routing::route($p, 1, $TAN, $TAN, 'recommended'), 'same spot refused', 400, 'same spot');`
- L149: `fails(fn() => Routing::route($p, 1, $TAN, $MAL, 'fly'), 'unknown route option refused', 400, 'Unknown route option');`
- L152: `section('D. Errors from the map service -> clear messages, manual km');`
- L160: `if ($e) ok(!str_contains($e->getMessage(), KEY) && stripos($e->getMessage(), 'km') !== false, "  message tells the user to type the km and has no key");`
- L162: `ok(!str_contains((string)file_get_contents($LOG), KEY), 'server error log never contains the API key');`
- L163: `ok(str_contains((string)file_get_contents($LOG), 'ORS route failed: HTTP 429'), 'failures are written to the server error log (status only)');`
- L167: `ok(Routing::$outboundCalls === $before, '  no call was made');`
- L172: `section('E. Cache, daily guard, per-user limit');`
- L175: `ok(Routing::$outboundCalls === $before && $c1['cached'] === true, 'same points + option again -> answered from the cache, no new call');`
- L177: `ok(Routing::$outboundCalls === $before, 'points within ~1 m (rounded to 5 decimals) share the cache');`
- L179: `ok(Routing::$outboundCalls === $before, 'each option has its own cached answer');`
- L182: `ok(Routing::$outboundCalls === $before + 1, 'expired cache -> new call');`
- L188: `ok(Routing::$outboundCalls === $before, '  no call was made after the guard');`
- L189: `ok(isset(Routing::route($p, 1, $TAN, [14.51, 121.0], 'recommended')['distance_km']), 'cached answers still work after the daily guard');`
- L190: `ok((int)one($p, "SELECT calls FROM map_api_usage WHERE usage_date=CURRENT_DATE() AND service='route'")['calls'] === 4, 'daily usage counted per service (map_api_usage)');`
- L196: `ok(isset(Routing::route($p, $users['admin']['id'], $TAN, [14.73, 121.0], 'recommended')['distance_km']), 'another user is not blocked by that limit');`
- L200: `section('F. Address search and reverse');`
- L203: `ok(str_starts_with($REQ[0]['url'] ?? '', 'https://api.heigit.org/pelias/v1/search?') && str_contains($REQ[0]['url'], 'text=Tanauan%20City') && str_contains($REQ[0]['url'], 'boundary.country=PH')`
- L205: `ok(count($s) === 2 && $s[0]['name'] === 'Tanauan City, Batangas, Philippines' && !in_array('Tokyo, Japan', array_column($s, 'name'), true), 'results outside the Philippines are dropped');`
- L207: `ok(Routing::$outboundCalls === $before, 'same search (any case / spacing) answered from the cache');`
- L208: `fails(fn() => Routing::search($p, 1, 'ab'), 'search shorter than 3 letters refused');`
- L209: `fails(fn() => Routing::search($p, 1, str_repeat('x', 151)), 'search longer than 150 refused');`
- L211: `ok(Routing::reverse($p, 1, 14.08631, 121.14971) === 'Poblacion, Tanauan City' && str_contains($REQ[0]['url'] ?? '', '/pelias/v1/reverse?point.lat=14.0863&point.lon=121.1497'), 'reverse: address of a point (rounded to 4 decimals)');`
- L213: `ok(Routing::$outboundCalls === $before, 'nearby click shares the reverse cache');`
- L216: `section('G. Maps module (what the screen calls)');`
- L219: `if ($allowed) ok(isset(Maps::action($U($role), 'route', ['from_lat' => $TAN[0], 'from_lng' => $TAN[1], 'to_lat' => $MAL[0], 'to_lng' => $MAL[1]])['available']), "$role can use Maps.route");`
- L220: `else fails(fn() => Maps::action($U($role), 'route', ['from_lat' => $TAN[0], 'from_lng' => $TAN[1], 'to_lat' => $MAL[0], 'to_lng' => $MAL[1]]), "$role cannot use the map service", 403);`
- L223: `ok($m['available'] === true && $m['option'] === 'avoid_tolls' && !array_key_exists('cached', $m) && !str_contains(json_encode($m), KEY), 'Maps.route: km, option, no key in the answer');`
- L226: `ok($m['available'] === false && $m['message'] !== '' && $m['straight_km'] > 0, 'service down -> available = false with a message (screen keeps manual km)');`
- L227: `ok(count(Maps::action($U('container_wingvan_dispatcher'), 'geocode', ['q' => 'Malvar'])['results']) >= 1, 'Maps.geocode works for a dispatcher (trip form search)');`
- L229: `fails(fn() => Maps::action($U('operations_head'), 'geocode', ['q' => 'Lipa City']), 'geocode refused by ORS -> clear 503 message', 503, 'Type the km');`
- L232: `ok($rv['address'] === '' && $rv['message'] !== '', 'reverse unavailable -> empty address with a message (no error)');`
- L233: `fails(fn() => Maps::action($U('operations_head'), 'teleport', []), 'unknown map action refused', 404);`
- L236: `section('H. Client Routes: server re-verification and manual override');`
- L248: `ok($row['distance_source'] === 'Map' && (float)$row['distance_computed_km'] === $comp && $row['route_option'] === 'recommended' && $row['distance_override_reason'] === null`
- L250: `ok(!isset($r1['warning']), 'no warning when the km equals the computed km');`
- L253: `fails(fn() => Routes::action($ops, 'request', $base(['route_option' => 'recommended', 'distance_km' => number_format($comp + 1, 2, '.', '')])),`
- L257: `ok($row['distance_source'] === 'Map (edited)' && (float)$row['distance_km'] === round($comp + 0.5, 2) && (float)$row['distance_computed_km'] === $comp`
- L259: `ok(!isset($r2['warning']) || !str_contains($r2['warning'], '15%'), 'difference of 15% or less -> no 15% warning', $r2['warning'] ?? '');`
- L261: `ok(str_contains($ev['notes'], 'Map (edited)') && str_contains($ev['notes'], 'computed') && str_contains($ev['notes'], 'Client contract'), 'route history shows source, computed km and the reason');`
- L265: `ok(isset($r3['warning']) && str_contains($r3['warning'], '15%'), 'difference above 15% -> warning returned', $r3['warning'] ?? '');`
- L268: `fails(fn() => Routes::action($ops, 'request', $base(['route_option' => 'recommended', 'distance_km' => number_format($comp + 0.01, 2, '.', '')])),`
- L270: `fails(fn() => Routes::action($ops, 'request', $base(['route_option' => 'recommended', 'distance_km' => number_format($comp, 3, '.', '') . '1'])), 'km with more than 2 decimals refused');`
- L274: `ok($row['distance_source'] === 'Manual' && $row['distance_computed_km'] === null && Routing::$outboundCalls === $before, 'no route option -> Manual, no map call; values sent by the browser are ignored');`
- L278: `ok(one($p, 'SELECT distance_source FROM client_routes WHERE id=?', [$r6['route_id']])['distance_source'] === 'Manual', 'route option but no pins -> Manual (typed km)');`
- L284: `ok($row['distance_source'] === 'Manual' && $row['distance_km'] === '8.10' && $row['route_option'] === null && isset($r7['warning']) && str_contains($r7['warning'], 'Manual'),`
- L286: `fails(fn() => Routes::action($ops, 'request', $base(['origin' => 'Tanauan B', 'route_option' => 'teleport', 'distance_km' => '8'])), 'unknown route option refused on save');`
- L287: `fails(fn() => Routes::action($ops, 'request', $base(['origin' => 'Tanauan C', 'route_option' => 'recommended', 'distance_km' => '99', 'distance_override_reason' => str_repeat('r', 301)])), 'reason longer than 300 refused');`
- L289: `ok(array_key_exists('distance_computed_km', $det['route']) && array_key_exists('route_geometry', $det['route']) && array_key_exists('distance_override_reason', $det['route']), 'route details include the distance fields');`
- L291: `ok($page['routing'] === true && count($page['routeOptions']) === 3 && $page['defaultRouteOption'] === 'recommended' && $page['overrideWarningRatio'] === 0.15, 'page data: routing on, 3 options, default Recommended, 15% warning');`
- L292: `ok($checks() === $sum, 'trips, billings, client_rates, fund requests and disbursements were not changed by route requests');`
- L293: `try { $p->exec("UPDATE client_routes SET distance_source='GPS' WHERE id={$r7['route_id']}"); ok(false, 'database refuses an unknown distance_source'); }`
- L294: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 4025, 'database refuses an unknown distance_source (CHECK)'); }`
- L295: `try { $p->exec("UPDATE client_routes SET route_option='fly' WHERE id={$r7['route_id']}"); ok(false, 'database refuses an unknown route option'); }`
- L296: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 4025, 'database refuses an unknown route option (CHECK)'); }`
- L299: `section('I. Real curl code against the local mock server');`
- L308: `ok($c['distance_km'] > 0 && $c['geometry'] !== '', 'curl: route computed through HTTP (' . $c['distance_km'] . ' km)');`
- L311: `ok($last['auth_ok'] === true && $last['method'] === 'POST' && str_contains($last['body'], '"avoid_features":["highways","tollways"]') && str_starts_with($last['ua'], 'MulawinFleetOps'), 'curl: key header, POST body and User-Agent received by the server');`
- L312: `ok(Routing::search($p, 1, 'Santa Rosa Laguna')[0]['name'] === 'Santa Rosa, Laguna, Philippines', 'curl: address search through HTTP');`
- L323: `section('J. Migration 04: partially failed import, detection and recovery');`
- L339: `ok((int)$st['tracked'] === 1 && (int)$st['tables_found'] === 1 && (int)$st['columns_found'] === 0, 'detection query shows the partial state (1 of 3 tables, columns missing)', json_encode($st));`
- L348: `ok((int)$st['tracked'] === 1 && (int)$st['tables_found'] === 3 && (int)$st['columns_found'] === 1, 'after recovery: tracked, 3 of 3 tables, columns present', json_encode($st));`
- L349: `ok(test_fingerprint($pa, $PARTIAL) === test_fingerprint($p, $FRESH), 'recovered database is identical to a fresh install');`
- L353: `section('K. Screen helpers');`
- L355: `ok(!str_contains($coreJs, 'UI.Map = {') && !str_contains($coreJs, 'UI.mapPicker = ') && str_contains($mapJs, 'UI.mapPicker = ') && str_contains($mapJs, 'UI.routeMap = '), 'map code lives only in map.js (moved out of core.js)');`
- L357: `ok($pos('map.js') !== false && $pos('map.js') > $pos('core.js') && $pos('map.js') < $pos('modules/'), 'map.js is loaded after core.js and before the page scripts');`
- L359: `ok(!preg_match('/maptiler|api\.heigit\.org|api\.openrouteservice\.org/i', $mapJs . $coreJs) && !preg_match('/Authorization\s*[:\'"]/', $mapJs . $coreJs)`
- L368: `ok($dec === [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]], 'UI.Map.decode() decodes the reference polyline correctly', json_encode($dec));`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## route_tests.php

Launcher: `run_route_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Access::canOpen, Actions::load, Checklist::sections, Clients::action, Funds::action, PDO::ATTR_DEFAULT_FETCH_MODE, PDO::ATTR_EMULATE_PREPARES, PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION, PDO::FETCH_ASSOC, Routes::action, Routes::approvedFor, Routes::class, Routes::normalize, Routes::read, Routes::selectableFor, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L64: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L67: `ok($good, $name, "got {$e->httpStatus}: {$e->getMessage()}");`
- L69: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L121: `section('A. Migration: fresh install vs upgrade');`
- L126: `ok(true, 'fresh install imports schema.sql + extension.sql');`
- L136: `ok(!str_contains((string)file_get_contents($baseExt), 'client_routes'), 'base schema (before this feature) has no route tables');`
- L137: `ok($CHAIN[0] === $MIG, 'migration chain starts with ' . $MIG . ' (' . count($CHAIN) . ' migration(s): ' . implode(', ', $CHAIN) . ')');`
- L147: `ok(true, 'upgrade: base schema + ' . count($CHAIN) . ' migration(s) import in order');`
- L148: `ok($up->query('CHECKSUM TABLE client_rates')->fetch()['Checksum'] === $beforeRates, 'upgrade: existing client_rates rows unchanged');`
- L150: `foreach ($fa as $k => $v) ok($v === $fb[$k], "fresh install and upgraded database have identical $k", count(array_diff($v, $fb[$k])) . ' / ' . count(array_diff($fb[$k], $v)) . ' differences');`
- L158: `ok(array_values(array_diff($migFresh, $untracked)) === array_values(array_diff($migUp, $untracked)) && in_array($MIG, $migUp, true),`
- L160: `try { importSql($up, file_sql($MIGFILE)); ok(false, 'second import is refused'); }`
- L161: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 1062, 'second import is refused by schema_migrations (duplicate key)', $e->getMessage()); }`
- L162: `ok(fingerprint($up, $UPGRADE) === $fb, 'refused second import changed nothing');`
- L164: `section('A2. Partially failed migration: detection and recovery (docs procedure)');`
- L174: `ok((int)$st['tracked'] === 1 && (int)$st['tables_found'] === 1, 'detection query shows: tracked = 1 but only 1 of 3 tables (partial)', json_encode($st));`
- L175: `ok((int)$pa->query('SELECT COUNT(*) FROM client_routes')->fetchColumn() === 0, 'partially created table is empty (safe to drop)');`
- L183: `ok((int)$st['tracked'] === 1 && (int)$st['tables_found'] === 3, 'after recovery: tracked = 1 and 3 of 3 tables', json_encode($st));`
- L185: `ok(fingerprint($pa, $PARTIAL) === fingerprint($fresh, $FRESH), 'recovered database (+ later migrations) is identical to a fresh install');`
- L225: `section('B. Role permissions');`
- L228: `ok(Access::canOpen($U($role), 'routes') === $expect, "page access 'routes' for $role = " . ($expect ? 'yes' : 'no'));`
- L232: `fails(fn() => $act($role, 'request', $req()), "request refused for $role", 403);`
- L235: `ok(str_starts_with($r1['route_ref'], 'RTE-'), 'Operations Head can request a route (' . $r1['route_ref'] . ')');`
- L239: `fails(fn() => $act($role, 'rate_enter', ['route_id' => $route1, 'rate_type' => 'Flat', 'rate_amount' => '12500']), "rate entry refused for $role", 403);`
- L242: `ok($rate1 > 0, 'Billing can enter the rate');`
- L245: `fails(fn() => $act($role, 'decide', ['rate_id' => $rate1, 'decision' => 'approve']), "approval refused for $role", 403);`
- L249: `fails(fn() => $act($role, 'deactivate', ['route_id' => $route1, 'reason' => 'x']), "deactivate refused for $role", 403);`
- L251: `foreach (['finance', 'audit'] as $role) ok(isset($act($role, 'details', ['route_id' => $route1])['route']), "$role can view route details (read-only)");`
- L252: `foreach (['car_carrier_dispatcher', 'container_wingvan_dispatcher', 'motorpool', 'purchasing'] as $role) fails(fn() => $act($role, 'details', ['route_id' => $route1]), "$role cannot view route details", 403);`
- L253: `fails(fn() => $act('purchasing', 'for_client', ['client_id' => $cActive]), 'for_client refused for a role without client access', 403);`
- L254: `ok(is_array($act('car_carrier_dispatcher', 'for_client', ['client_id' => $cActive])['routes']), 'for_client allowed for a role that can open the Client Masterlist');`
- L255: `fails(fn() => Routes::action($users['ops2'], 'withdraw', ['route_id' => $route1, 'reason' => 'x']), 'another Operations Head cannot withdraw this request', 403);`
- L260: `section('C. Route request validation and normalization');`
- L262: `ok($row1['origin_label'] === 'TANAUAN, BATANGAS' && $row1['origin_key'] === 'TANAUAN BATANGAS' && $row1['destination_key'] === 'MALVAR BATANGAS', 'labels upper-cased; keys normalized', json_encode([$row1['origin_label'], $row1['origin_key']]));`
- L263: `ok($row1['status'] === 'Pending Approval' && $row1['distance_source'] === 'Manual' && $row1['distance_km'] === '18.50', 'route stored with Manual distance');`
- L264: `fails(fn() => $act('operations_head', 'request', $req(['client_id' => $cIncomplete])), 'Incomplete client refused', 409, 'Incomplete');`
- L265: `fails(fn() => $act('operations_head', 'request', $req(['client_id' => $cInactive])), 'Inactive client refused', 409);`
- L266: `fails(fn() => $act('operations_head', 'request', $req(['client_id' => 999999])), 'unknown client refused', 404);`
- L268: `ok($rp['route_id'] > 0, 'Pending Rate client allowed (provisional policy)');`
- L269: `fails(fn() => $act('operations_head', 'request', $req(['truck_type' => 'Tricycle'])), 'invalid truck type refused');`
- L270: `fails(fn() => $act('operations_head', 'request', $req(['distance_km' => '0'])), 'distance 0 refused');`
- L271: `fails(fn() => $act('operations_head', 'request', $req(['distance_km' => '-5'])), 'negative distance refused');`
- L272: `fails(fn() => $act('operations_head', 'request', $req(['distance_km' => '3000.01'])), 'distance above 3000 km refused');`
- L273: `fails(fn() => $act('operations_head', 'request', $req(['distance_km' => '1e3'])), 'scientific notation refused');`
- L274: `fails(fn() => $act('operations_head', 'request', $req(['destination' => ' tanauan  batangas.'])), 'origin = destination after normalization refused', 400, 'different');`
- L275: `fails(fn() => $act('operations_head', 'request', $req(['origin' => '---'])), 'origin without letters or numbers refused');`
- L276: `fails(fn() => $act('operations_head', 'request', $req(['origin' => str_repeat('A', 201)])), 'origin longer than 200 refused');`
- L277: `fails(fn() => $act('operations_head', 'request', $req(['origin' => ''])), 'empty origin refused');`
- L278: `fails(fn() => $act('operations_head', 'request', $req(['origin' => 'X1', 'origin_lat' => '14.1'])), 'incomplete map pin refused', 400, 'incomplete');`
- L279: `fails(fn() => $act('operations_head', 'request', $req(['origin' => 'X2', 'origin_lat' => '35.6', 'origin_lng' => '139.7'])), 'map pin outside the Philippines refused', 400, 'outside');`
- L281: `ok((float)one($p, 'SELECT origin_lat FROM client_routes WHERE id=?', [$rc['route_id']])['origin_lat'] === 14.2117, 'valid map pin stored');`
- L282: `ok(one($p, "SELECT COUNT(*) AS n FROM client_route_events WHERE route_id=? AND event_type='route requested'", [$route1])['n'] == 1, 'request event recorded');`
- L283: `ok((bool)one($p, "SELECT id FROM audit_events WHERE area='Routes' AND record_ref=? AND action='route requested'", ['route ' . $route1]), 'request written to the activity log');`
- L284: `ok((bool)one($p, "SELECT id FROM notifications WHERE user_id=? AND dedupe_key=?", [$users['billing']['id'], 'route-rate-' . $route1]), 'Billing was notified');`
- L289: `section('D. Rate entry validation');`
- L292: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $rv, 'rate_type' => 'Flat', 'rate_amount' => (string)$v]), "rate $label refused");`
- L293: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $rv, 'rate_type' => 'Per Km', 'rate_amount' => '50']), 'Per Km refused while the policy enables Flat only', 400, 'not enabled');`
- L294: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $rv, 'rate_type' => 'Hourly', 'rate_amount' => '50']), 'unknown rate type refused');`
- L295: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $rv, 'rate_type' => 'Flat', 'rate_amount' => '5000', 'minimum_charge' => '100']), 'minimum charge with a Flat rate refused', 400, 'minimum');`
- L296: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $route1, 'rate_type' => 'Flat', 'rate_amount' => '9000']), 'new rate refused while the first rate waits for approval', 409, 'Pending Approval');`
- L297: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => 999999, 'rate_type' => 'Flat', 'rate_amount' => '9000']), 'rate for unknown route refused', 404);`
- L298: `try { insert($p, 'client_route_rates', ['route_id' => $route1, 'version_no' => 9, 'rate_type' => 'Flat', 'rate_amount' => '1', 'status' => 'Pending Approval', 'entered_by' => $users['billing']['id']]); ok(false, 'database refuses a second pending rate'); }`
- L299: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'uq_route_rate_pending'), 'database refuses a second pending rate (uq_route_rate_pending)'); }`
- L301: `try { insert($p, 'client_route_rates', array_merge(['route_id' => $rv, 'version_no' => 50 + $i, 'rate_type' => 'Flat', 'rate_amount' => '10', 'status' => 'Rejected', 'entered_by' => $users['billing']['id']], $bad)); ok(false, "database CHECK refuses " . json_encode($bad)); }`
- L302: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 4025, 'database CHECK refuses ' . json_encode($bad)); }`
- L312: `ok($policyOk, 'database accepts a Per Km rate with a minimum charge (ready for the company decision)');`
- L317: `section('E. Approval and rejection');`
- L323: `fails(fn() => $act('admin', 'decide', ['rate_id' => $selfRate, 'decision' => 'approve']), 'the person who entered a rate cannot approve it (separation of duties)', 403, 'separation');`
- L324: `ok(isset(Routes::action($users['admin2'], 'decide', ['rate_id' => $selfRate, 'decision' => 'approve'])['message']), 'another Admin can approve it');`
- L326: `fails(fn() => $act('admin', 'decide', ['rate_id' => $rate1, 'decision' => 'reject']), 'reject without a reason refused');`
- L329: `ok($r['status'] === 'Approved' && $rt['status'] === 'Approved' && $rt['effective_from'] !== null && (int)$rt['decided_by'] === $users['admin']['id'], 'approve: route and rate Approved, approver and effective date recorded');`
- L330: `fails(fn() => $act('admin', 'decide', ['rate_id' => $rate1, 'decision' => 'approve']), 'approving an already decided rate refused (double click)', 409, 'already decided');`
- L331: `fails(fn() => $act('admin', 'decide', ['rate_id' => 999999, 'decision' => 'approve']), 'unknown rate refused', 404);`
- L332: `ok((bool)one($p, 'SELECT id FROM notifications WHERE user_id=? AND dedupe_key=? AND state=?', [$users['admin']['id'], 'route-approve-' . $rate1, 'Resolved']), 'approval notification resolved after the decision');`
- L339: `ok($r['status'] === 'Rejected' && $r['closed_reason'] === 'Not in the contract' && (int)$r['closed_by'] === $users['admin']['id'], 'reject new request: route Rejected with reason and person');`
- L340: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$rnr])['status'] === 'Rejected', 'reject new request: its rate is Rejected');`
- L341: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $rn, 'rate_type' => 'Flat', 'rate_amount' => '4500']), 'rejected route is terminal (no new rate)', 409);`
- L343: `ok($again['route_id'] > 0, 'a rejected route does not block a new request for the same route');`
- L344: `ok($checksums() === $before, 'approvals and rejections did not change trips, billings, client_rates, funds, disbursements, expenses');`
- L349: `section('F. Rate revision: reject, approve, rollback, concurrency');`
- L350: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $route1, 'rate_type' => 'Flat', 'rate_amount' => '12500']), 'revision equal to the current rate refused', 409, 'same');`
- L352: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$route1])['status'] === 'Approved', 'during a revision the route stays Approved');`
- L353: `fails(fn() => Routes::action($users['billing2'], 'rate_enter', ['route_id' => $route1, 'rate_type' => 'Flat', 'rate_amount' => '13100']), 'second pending revision refused (application rule)', 409, 'already has a rate waiting');`
- L356: `ok($x && $x['rate_amount'] === '12500.00' && (int)$x['rate_id'] === $rate1, 'during a revision the OLD approved rate is the one in use');`
- L358: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$route1])['status'] === 'Approved', 'rejected revision: route stays Approved');`
- L360: `ok($o['status'] === 'Approved' && $o['rate_amount'] === '12500.00' && $o['effective_to'] === null, 'rejected revision: old approved rate unchanged and still current');`
- L361: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$rev1])['status'] === 'Rejected', 'rejected revision: only the revision is Rejected');`
- L367: `ok($o['status'] === 'Superseded' && $o['effective_to'] !== null && $o['rate_amount'] === '12500.00', 'approved revision: old rate Superseded, amount kept, effective_to set');`
- L368: `ok($n['status'] === 'Approved' && (int)$n['version_no'] === 3 && $n['effective_from'] !== null, 'approved revision: new rate Approved as version 3');`
- L369: `ok((int)one($p, "SELECT COUNT(*) AS n FROM client_route_rates WHERE route_id=? AND status='Approved'", [$route1])['n'] === 1, 'exactly one current approved rate');`
- L370: `try { run($p, "UPDATE client_route_rates SET status='Approved' WHERE id=?", [$rate1]); ok(false, 'database refuses two approved rates'); }`
- L371: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'uq_route_rate_current'), 'database refuses two approved rates for one route (uq_route_rate_current)'); }`
- L377: `try { $act('admin', 'decide', ['rate_id' => $rev3, 'decision' => 'approve']); ok(false, 'simulated failure raised'); }`
- L378: `catch (Throwable $e) { ok(str_contains($e->getMessage(), 'simulated failure'), 'simulated failure during activation raised'); }`
- L381: `ok($n['status'] === 'Approved' && $n['effective_to'] === null, 'after the failure the previous approved rate is still Approved (rolled back)');`
- L382: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$rev3])['status'] === 'Pending Approval', 'after the failure the revision is still Pending Approval');`
- L383: `ok(!$p->inTransaction(), 'no transaction left open after the failure');`
- L393: `ok($okCount === 1 && $already === 1, 'concurrent approval of the same rate: one succeeds, the other is refused', implode(' | ', $outs));`
- L394: `ok((int)one($p, "SELECT COUNT(*) AS n FROM client_route_rates WHERE route_id=? AND status='Approved'", [$route1])['n'] === 1`
- L396: `ok((int)one($p, "SELECT COUNT(*) AS n FROM client_route_events WHERE rate_id=? AND event_type='rate revision approved'", [$rev3])['n'] === 1, 'after concurrent approval: one approval event');`
- L401: `section('G. Duplicate prevention, truck types, direction');`
- L402: `fails(fn() => $act('operations_head', 'request', $req()), 'same client + truck type + route refused', 409, 'already exists');`
- L403: `fails(fn() => $act('operations_head', 'request', $req(['origin' => '  tanauan;BATANGAS ', 'destination' => 'malvar - batangas'])), 'case / spacing / punctuation variant refused', 409, 'already exists');`
- L405: `ok($wv['route_id'] > 0, 'same route with another truck type (Wing Van) allowed');`
- L410: `ok(count($tm) === 2 && count(array_unique(array_column($tm, 'rate_amount'))) === 2, 'Container and Wing Van of the same route have different approved rates');`
- L412: `ok($back['route_id'] > 0, 'reverse direction (B -> A) is a separate route');`
- L414: `ok($other['route_id'] > 0, 'same route for another client allowed');`
- L416: `'origin_key' => 'TANAUAN BATANGAS', 'destination_key' => 'MALVAR BATANGAS', 'distance_km' => '1', 'status' => 'Pending Rate', 'requested_by' => $users['operations_head']['id']]); ok(false, 'database refuses duplicate active route'); }`
- L417: `catch (PDOException $e) { ok(str_contains($e->getMessage(), 'uq_route_active'), 'database refuses a duplicate active route (uq_route_active)'); }`
- L422: `fails(fn() => $act('operations_head', 'request', $req(['truck_type' => 'Car Carrier', 'origin' => 'race a', 'destination' => 'race b'])), 'route saved by another session is refused with a clear message', 409);`
- L427: `section('H. Selectable routes, withdraw, deactivate, history');`
- L430: `ok($statuses === ['Approved'], 'only Approved routes are selectable');`
- L431: `ok(!in_array($rn, $selectable, true) && !in_array((int)$back['route_id'], $selectable, true), 'Rejected and Pending routes are not selectable');`
- L432: `ok(count(Routes::approvedFor($p, $cActive, 'Wing Van')) === 1, 'selectable list filters by truck type');`
- L434: `ok(count($fc['routes']) === count($selectable) && $fc['can_open_routes'] === true, 'client details section returns the approved routes');`
- L437: `fails(fn() => $act('operations_head', 'withdraw', ['route_id' => $wd]), 'withdraw without a reason refused');`
- L439: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$wd])['status'] === 'Withdrawn', 'own request withdrawn');`
- L440: `fails(fn() => $act('operations_head', 'withdraw', ['route_id' => $route1, 'reason' => 'x']), 'an Approved route cannot be withdrawn', 409);`
- L445: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$wpr])['status'] === 'Rejected', 'withdrawing closes the pending rate');`
- L446: `fails(fn() => $act('admin', 'decide', ['rate_id' => $wpr, 'decision' => 'approve']), 'a rate of a withdrawn route cannot be approved', 409);`
- L450: `fails(fn() => $act('admin', 'deactivate', ['route_id' => $wvId]), 'deactivate without a reason refused');`
- L452: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$wvId])['status'] === 'Inactive', 'route deactivated');`
- L453: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$pend])['status'] === 'Rejected' && one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$wvr])['status'] === 'Approved', 'deactivate: pending revision closed, last approved rate kept as history');`
- L454: `ok(count(Routes::approvedFor($p, $cActive, 'Wing Van')) === 0, 'Inactive route is not selectable');`
- L455: `fails(fn() => $act('billing', 'rate_enter', ['route_id' => $wvId, 'rate_type' => 'Flat', 'rate_amount' => '1']), 'no rate entry on an Inactive route', 409);`
- L457: `ok($re['route_id'] > 0, 'an Inactive route does not block a new request');`
- L460: `ok(count($det['rates']) === 4 && $det['rates'][0]['version_no'] == 4 && array_column($det['rates'], 'status') === ['Approved', 'Superseded', 'Rejected', 'Superseded'],`
- L463: `foreach (['route requested', 'rate entered', 'route approved', 'rate revision entered', 'rate revision rejected', 'rate revision approved'] as $ev) ok(in_array($ev, $types, true), "history has '$ev'");`
- L464: `ok((int)one($p, "SELECT COUNT(*) AS n FROM audit_events WHERE area='Routes'")['n'] >= count($det['events']), 'every route event is also in the activity log');`
- L466: `ok(empty($page['_errors']) && count($page['routes']) >= 10 && $page['can']['rate'] && !$page['can']['approve'], 'page data loads for Billing with the right buttons');`
- L468: `ok(count(array_unique(array_column($pf['routes'], 'client_id'))) === 1, 'page filter by client works');`
- L473: `section('J. Client eligibility re-checked at approval time');`
- L489: `fails(fn() => $act('admin', 'decide', ['rate_id' => $jrate, 'decision' => 'approve']), 'approval blocked when the client became Inactive after the request', 409, 'Cannot approve');`
- L490: `ok($state($jr, $jrate) === $snap, 'blocked approval changed nothing (route, rates, events, activity log, notifications)');`
- L491: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$jr])['status'] === 'Pending Approval'`
- L493: `ok(!$p->inTransaction(), 'no transaction left open after the blocked approval');`
- L494: `ok(count(Routes::approvedFor($p, $cJ)) === 0 && count(Routes::selectableFor($p, $cJ)) === 0, 'blocked route is neither approved nor selectable');`
- L496: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$jr])['status'] === 'Rejected', 'rejection is still allowed for a deactivated client (request can be closed)');`
- L502: `fails(fn() => $act('admin', 'decide', ['rate_id' => $jrate2, 'decision' => 'approve']), 'approval blocked for a client that is no longer eligible (Incomplete)', 409, 'Cannot approve');`
- L505: `ok(one($p, 'SELECT status FROM client_routes WHERE id=?', [$jr2])['status'] === 'Approved', 'approval works again once the client is eligible');`
- L514: `fails(fn() => $act('admin', 'decide', ['rate_id' => $v2, 'decision' => 'approve']), 'revision approval blocked when the client became Inactive', 409, 'Cannot approve');`
- L515: `ok($state($jr3, $v2) === $snap, 'blocked revision approval changed nothing');`
- L516: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$v1])['status'] === 'Approved' && one($p, 'SELECT status FROM client_routes WHERE id=?', [$jr3])['status'] === 'Approved',`
- L524: `try { $act('admin', 'decide', ['rate_id' => $v2, 'decision' => 'reject', 'reason' => 'x']); ok(false, 'decision waits for the client lock'); }`
- L525: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 1205, 'decision waits for the client row lock (lock wait timeout while another session holds it)', $e->getMessage()); }`
- L528: `ok(one($p, 'SELECT status FROM client_route_rates WHERE id=?', [$v2])['status'] === 'Pending Approval', 'timed-out decision changed nothing');`
- L533: `section('K. approvedFor (record) vs selectableFor (planning eligibility)');`
- L540: `ok(array_column(Routes::selectableFor($p, $cK), 'id') === array_column(Routes::approvedFor($p, $cK), 'id') && count(Routes::selectableFor($p, $cK)) === 2,`
- L542: `ok(!in_array($kp, array_column(Routes::selectableFor($p, $cK), 'id'), true), 'Pending route of an Active client is not selectable');`
- L543: `ok(count(Routes::selectableFor($p, $cK, 'Wing Van')) === 1 && (int)Routes::selectableFor($p, $cK, 'Wing Van')[0]['id'] === $kw, 'selectable list filters by truck type');`
- L545: `ok(count(Routes::selectableFor($p, $cK)) === 0, 'Inactive client: no selectable routes');`
- L546: `ok(count(Routes::approvedFor($p, $cK)) === 2, 'Inactive client: approved route records are still listed (history not hidden)');`
- L547: `ok(count($act('operations_head', 'for_client', ['client_id' => $cK])['routes']) === 2, 'client details still show the approved routes of an Inactive client');`
- L549: `ok(count(Routes::selectableFor($p, $cK)) === 0, 'Pending Rate client: not selectable for planning (trips need an Active client)');`
- L551: `ok(count(Routes::selectableFor($p, $cK)) === 2, 'reactivated client: routes are selectable again');`
- L554: `ok(!$bad && count($all) > 0, 'every selectable route in the database has an Approved route and an Active client', count($bad) . ' bad of ' . count($all));`
- L559: `section('L. RouteUI.norm() (screen) matches Routes::normalize() (server)');`
- L565: `ok(false, 'RouteUI.norm found in routes.js');`
- L574: `ok(is_array($jsOut) && count($jsOut) === count($samples), 'screen normalization ran in Node.js for ' . count($samples) . ' samples');`
- L575: `foreach ($samples as $i => $s) ok(($jsOut[$i] ?? null) === $phpOut[$i], 'same result for ' . json_encode($s, JSON_UNESCAPED_UNICODE) . ' -> ' . json_encode($phpOut[$i], JSON_UNESCAPED_UNICODE), json_encode($jsOut[$i] ?? null, JSON_UNESCAPED_UNICODE));`
- L581: `section('I. Regression: trip -> fund -> checklist -> dispatch -> billing draft (rate per km)');`
- L598: `ok($trip['status'] === 'Pre-Assigned' && (int)$trip['vehicle_id'] === $veh && (int)$trip['driver_id'] === $drv && (int)$trip['helper_id'] === $hlp, 'trip created and auto-assigned (Pre-Assigned) as before');`
- L603: `ok(one($p, 'SELECT status, amount FROM fund_requests WHERE id=?', [$f['fund_id']]) == ['status' => 'Released', 'amount' => '500.00'], 'fund request submitted, approved and released as before (PHP 500.00)');`
- L609: `ok(one($p, 'SELECT status FROM trips WHERE id=?', [$trip['id']])['status'] === 'Ready for Dispatch', 'pre-dispatch checklist -> Ready for Dispatch as before');`
- L614: `ok($b && $b['status'] === 'Ongoing' && $b['rate_per_km'] === '55.50' && $b['base_amount'] === '1110.00', 'billing draft still uses client_rates per km: 20 km x 55.50 = 1,110.00 (route rate ignored)', json_encode($b ? [$b['rate_per_km'], $b['base_amount']] : null));`
- L615: `} catch (Throwable $e) { ok(false, 'regression flow', get_class($e) . ': ' . $e->getMessage()); }`
- L618: `ok(count($cd['rates']) === 1 && $cd['rates'][0]['rate_per_km'] === '55.50', 'client details still show the per-km billing rates');`
- L621: `ok((int)one($p, 'SELECT COUNT(*) AS n FROM billings')['n'] === $rowsBefore && one($p, 'SELECT base_amount FROM billings WHERE trip_id=?', [$trip['id'] ?? 0])['base_amount'] === '1110.00', 'route rate revision does not change existing billings');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_account_security_tests.php

Launcher: `run_run_account_security_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_billing_adjustment_tests.php

Launcher: `run_run_billing_adjustment_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_crew_attendance_tests.php

Launcher: `run_run_crew_attendance_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_crew_dispatch_tests.php

Launcher: `run_run_crew_dispatch_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_fund_release_tests.php

Launcher: `run_run_fund_release_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_htaccess_tests.php

Launcher: `run_run_htaccess_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):

- L52: `ok(in_array($s, $codes, true) && !$leak, 'not served: ' . ($label ?: $path) . ($codes === [403] ? ' (403)' : ''), "HTTP $s" . ($leak ? ', body contains ' . implode(', ', $leak) : ''));`
- L83: `ok($s === 200 && str_contains($type, 'json') && str_contains($body, '"csrf"'), 'API answers (index.php?api=whoami)', "HTTP $s $type");`
- L85: `ok($s === 200 && str_contains($body, 'App.start()'), 'application page loads', "HTTP $s");`
- L87: `ok($s === 200 && str_contains($type, 'css'), 'stylesheet served (assets/css/app.css)', "HTTP $s $type");`
- L89: `ok($s === 200 && str_contains($type, 'javascript'), 'script served (assets/js/core.js)', "HTTP $s $type");`
- L91: `ok($s === 200, 'vendor asset served (bootstrap.min.css)', "HTTP $s");`
- L94: `ok(in_array($s, [200, 301, 302], true), 'project root opens or forwards to the app', "HTTP $s $loc");`
- L99: `ok($s !== 403 && !$leak, "$p is not blocked (SSL certificate validation)", "HTTP $s");`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_map_tests.php

Launcher: `run_run_map_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_route_tests.php

Launcher: `run_run_route_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_trip_batch_tests.php

Launcher: `run_run_trip_batch_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_trip_documents_tests.php

Launcher: `run_run_trip_documents_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_trip_routing_tests.php

Launcher: `run_run_trip_routing_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## run_trip_schedule_tests.php

Launcher: `run_run_trip_schedule_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: 

Source scenario and assertion inventory (line references preserve exact expectations):


Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## trip_batch_tests.php

Launcher: `run_trip_batch_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L36: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L37: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L38: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L43: `section('Setup: disposable fresh database');`
- L46: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L74: `section('A. Operations Head batch');`
- L78: `ok(count($res) === 2 && $res[0]['row'] === 1 && $res[1]['row'] === 2 && $res[0]['result'] === 'Created' && $res[1]['result'] === 'Created', 'one result per row, in the order entered');`
- L79: `ok($res[0]['trip_ref'] !== $res[1]['trip_ref'] && preg_match('/^TRP-\d{4}-\d{4}$/', (string)$res[0]['trip_ref']) === 1, 'each row is its own trip with its own reference', json_encode(array_column($res, 'trip_ref')));`
- L81: `ok($t1['status'] === 'Pre-Assigned' && $t2['status'] === 'Pre-Assigned' && $t1['vehicle_id'] && $t2['vehicle_id'] && $t1['vehicle_id'] !== $t2['vehicle_id'], 'both confirmed and auto-assigned (different trucks)');`
- L82: `ok($t1['delivery_point'] === 'DROP ONE' && $t2['consignee'] === 'ABC STORE' && $t1['distance_km'] === '25.50' && $t1['distance_source'] === 'Manual' && $t1['intake_source'] === 'Operations Head', 'row details saved like a New trip');`
- L83: `ok((bool)one($p, "SELECT 1 AS x FROM trip_events WHERE trip_id=? AND event_type='trip created by Operations Head (Scenario A)'", [$t1['id']]), 'same history as a single New trip');`
- L84: `ok(str_contains($r['message'], '2 created, 0 already created, 0 not created'), 'summary message', $r['message']);`
- L86: `ok($aud && str_contains($aud['details'], $res[0]['trip_ref']) && str_contains($aud['details'], '2 row(s)'), 'batch recorded in the Activity Log');`
- L87: `ok($t1['request_key'] === strtolower($rows[0]['request_key']), 'row form key stored with the trip');`
- L90: `section('B. Not enough trucks: Awaiting Resources, earliest schedule first');`
- L95: `ok($early['trip_status'] === 'Pre-Assigned' && $late['trip_status'] === 'Awaiting Resources', 'only one truck: the earlier trip gets it, the later one waits (Awaiting Resources)', json_encode($r['results']));`
- L96: `ok($late['result'] === 'Created' && $late['trip_ref'] && $T($late['trip_id'])['vehicle_id'] === null, 'the waiting trip is still created (no truck held)');`
- L97: `ok(str_contains($r['message'], '1 trip(s) are Awaiting Resources'), 'message says how many are waiting');`
- L98: `ok((bool)one($p, "SELECT 1 AS x FROM trip_events WHERE trip_id=? AND event_type LIKE '%awaiting resources%'", [$late['trip_id']]) || $T($late['trip_id'])['status'] === 'Awaiting Resources', 'waiting trip uses the existing Awaiting Resources status');`
- L101: `section('C. All-or-nothing validation');`
- L105: `try { $batch($ops, $bad); ok(false, 'batch with wrong rows refused'); }`
- L108: `ok($e->httpStatus === 400 && str_starts_with($m, 'Nothing was created.'), 'batch with wrong rows refused: nothing created', $m);`
- L110: `ok(str_contains($m, "Row $rowNo:") && ($part === '' || stripos($m, $part) !== false), "row $rowNo reason listed" . ($part ? " ($part)" : ''));`
- L111: `ok(!str_contains($m, 'Row 1:'), 'correct row 1 not listed');`
- L113: `ok($tripCount() === $n0 && (int)$p->query("SELECT COUNT(*) FROM audit_events WHERE action='trip batch planned'")->fetchColumn() === $a0, 'no trip and no batch log written');`
- L116: `section('D. Duplicate submissions');`
- L122: `ok($tripCount() === $n1 && array_column($again['results'], 'result') === ['Already created', 'Already created'] && array_column($again['results'], 'trip_id') === array_column($first['results'], 'trip_id'),`
- L125: `ok(array_column($mixed['results'], 'result') === ['Already created', 'Created'] && $tripCount() === $n1 + 1, 'resend with one new row: only the new row creates a trip');`
- L131: `ok(array_column($r['results'], 'result') === ['Created', 'Created'] && $tripCount() === $n3 + 2 && $r['results'][0]['trip_ref'] !== $r['results'][1]['trip_ref'],`
- L134: `ok($a1['vehicle_id'] && $a2['vehicle_id'] && $a1['vehicle_id'] !== $a2['vehicle_id'], 'each identical-looking trip gets its own truck');`
- L136: `ok($r2['results'][0]['result'] === 'Created' && $tripCount() === $n3 + 3, 'a third truck for the same route and time later: another trip (new key)');`
- L138: `fails(fn() => $batch($ops, [$row(['request_key' => $k, 'delivery_point' => 'K1']), $row(['request_key' => $k, 'delivery_point' => 'K2'])]), 'same form key twice refused', 400, 'Same form key as row 1');`
- L139: `fails(fn() => $batch($wvd, [$rows[0]]), 'another user re-sending a key refused', 400, 'Invalid form key');`
- L140: `fails(fn() => $batch($ops, [$row(['request_key' => 'not-a-key'])]), 'malformed key refused', 400, 'Invalid form key');`
- L162: `ok($outs[0]['ok'] && $outs[1]['ok'], 'both simultaneous sends answered without an error', json_encode($outs));`
- L163: `ok($tripCount() === $n2 + 2 && count(array_unique($ids)) === 2, 'only two trips exist (one per row) after two simultaneous sends', json_encode($ids));`
- L166: `section('D2. Partial failure during creation, then retry of the failed row only');`
- L173: `ok(array_column($r['results'], 'result') === ['Created', 'Not created', 'Created'] && $tripCount() === $n4 + 2, 'row 2 fails while saving: rows 1 and 3 created, row 2 "Not created"', json_encode(array_column($r['results'], 'result')));`
- L174: `ok(str_contains($r['results'][1]['message'], 'could not be saved (server error)') && !str_contains($r['results'][1]['message'], 'simulated') && $r['results'][1]['request_key'] === strtolower($rows[1]['request_key']),`
- L176: `ok(str_contains($r['message'], '2 created, 0 already created, 1 not created'), 'summary counts the three outcomes', $r['message']);`
- L179: `ok($retry['results'][0]['result'] === 'Created' && $retry['results'][0]['row'] === 2 && $tripCount() === $n4 + 3, 'retry of only the failed row (same key, same row number): created');`
- L181: `ok(array_column($all['results'], 'result') === ['Already created', 'Already created', 'Already created'] && $tripCount() === $n4 + 3, 'sending all three again: nothing duplicated');`
- L182: `ok(count(array_unique(array_column($all['results'], 'trip_id'))) === 3, 'three different trips, one per row');`
- L183: `fails(fn() => $batch($ops, [$row(['distance_km' => '', 'row_no' => '5'])]), 'retry with a row problem names the screen row number', 400, 'Row 5:');`
- L185: `ok(str_contains($js, "filter(tr => !tr.dataset.done)") && str_contains($js, 'Retry not-created row(s)') && str_contains($js, 'request_key: tr.dataset.key, row_no:'), 'screen: Retry sends only not-created rows with their original keys');`
- L186: `ok(!str_contains($js, 'Nothing is created until every row is correct'), 'old all-or-nothing wording removed');`
- L189: `section('E. Limits and malformed input');`
- L190: `fails(fn() => $batch($ops, []), 'empty batch refused', 400, 'at least one');`
- L191: `fails(fn() => Trips::action($ops, 'create_batch', []), 'missing rows refused', 400);`
- L192: `fails(fn() => Trips::action($ops, 'create_batch', ['rows' => 'abc']), 'rows as text refused', 400);`
- L193: `fails(fn() => Trips::action($ops, 'create_batch', ['rows' => ['a' => $row()]]), 'rows as an object refused', 400);`
- L194: `fails(fn() => $batch($ops, array_map(fn() => $row(), range(1, 21))), '21 rows refused (max 20)', 400, 'at most 20');`
- L195: `fails(fn() => $batch($ops, ['text']), 'a row that is not an entry refused', 400, 'Row 1: Invalid trip entry');`
- L198: `section('F. Dispatcher batch (Scenario B), team rules, roles');`
- L200: `ok(array_column($r['results'], 'trip_status') === ['Pending Review', 'Pending Review'] && $T($r['results'][0]['trip_id'])['vehicle_id'] === null, 'dispatcher rows become Pending Review requests (no assignment), km optional');`
- L201: `ok((int)one($p, "SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND dedupe_key LIKE 'trip-review-%'", [$ops['id']])['n'] >= 2, 'Operations Head notified per request (individual review kept)');`
- L202: `fails(fn() => $batch($wvd, [$row(['truck_type' => 'Car Carrier'])]), 'Wing Van dispatcher cannot enter a Car Carrier trip', 400, 'other dispatcher team');`
- L203: `foreach (['finance', 'billing', 'motorpool', 'purchasing', 'audit', 'admin'] as $role) fails(fn() => $batch($U($role), [$row()]), "$role cannot plan trips", 403);`
- L208: `ok(in_array($T($req)['status'], ['Pre-Assigned', 'Awaiting Resources'], true), 'a batch request is reviewed individually like any request');`
- L211: `section('G. Approved routes in a batch');`
- L218: `ok($t['distance_source'] === 'Client Route' && $t['distance_km'] === '9.50' && (int)$t['client_route_id'] === $route, 'row with an approved route: route km used (same rules as New trip)');`
- L219: `fails(fn() => $batch($ops, [$row(['client_id' => (string)$cid2, 'client_route_id' => (string)$route])]), 'route of another client refused', 400, 'approved route cannot be used');`
- L221: `fails(fn() => $batch($ops, [$row(['client_route_id' => (string)$route, 'distance_km' => ''])]), 'inactive route refused', 400, 'approved route cannot be used');`
- L224: `section('H. Existing trips untouched; a batch trip continues individually');`
- L231: `ok($snapshot() == $before, 'completed, active and other existing trips not modified by a new batch');`
- L235: `ok($T($fid)['status'] === 'Pre-Assigned', 'batch trip assigned');`
- L242: `ok($T($fid)['status'] === 'Dispatched' && $b && $b['base_amount'] === '1275.00', 'batch trip: checklist, fund, Confirm Dispatch and billing draft (25.50 km x 50) work as usual');`
- L244: `ok(str_contains($js, 'BATCH_TRIP_PLANNING_V1') && str_contains($js, "'Trips.create_batch'") && str_contains($js, 'tr.dataset.key = UI.uuid()') && str_contains($js, 'submit.disabled = true'), 'screen: batch page, one key per row, button disabled while sending');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## trip_documents_tests.php

Launcher: `run_trip_documents_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Documents::download, Documents::read, Files::store, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L33: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L34: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L35: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L39: `section('Setup: disposable fresh database');`
- L42: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L86: `section('A. Diesel PO from Trip Details');`
- L91: `ok(count($d) === 1 && $d[0]['original_filename'] === 'diesel-po-001.pdf' && $d[0]['mime_type'] === 'application/pdf' && (int)$d[0]['uploaded_by'] === $wvd['id'], 'Diesel PO saved as a trip document (category Diesel PO)', json_encode($d));`
- L92: `ok(is_file($storage . '/' . $d[0]['storage_name']) && preg_match('/^[a-f0-9]{40}\.pdf$/', $d[0]['storage_name']) === 1, 'stored privately with a random name');`
- L93: `ok(str_contains($r['message'], 'Diesel PO attached'), 'result message', $r['message']);`
- L94: `ok((bool)one($p, "SELECT 1 AS x FROM trip_events WHERE trip_id=? AND event_type='diesel PO attached'", [$id]), 'trip history entry');`
- L95: `ok((bool)one($p, "SELECT 1 AS x FROM audit_events WHERE action='document uploaded' AND record_ref=?", ['trip ' . $id]), 'audit trail (document uploaded)');`
- L98: `ok(count($docs($id, 'Diesel PO')) === 3, 'more files can be attached later (multiple at once)');`
- L99: `ok($T($id)['status'] === 'Pre-Assigned', 'trip status not changed by the attachment');`
- L102: `section('B. File checks; nothing left behind on failure');`
- L106: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $id]), "rejected: $name", 400);`
- L109: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $id]), 'text file renamed .pdf rejected (content is checked, not the name)', 400, 'Only PDF, JPG, PNG and WebP');`
- L111: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $id]), 'one bad file in a batch rejects the whole batch', 400);`
- L113: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $id]), 'no file: refused', 400, 'Please attach');`
- L115: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $id]), 'upload error reported', 400, 'Upload failed');`
- L116: `ok([$stored(), count($docs($id, 'Diesel PO'))] === $before, 'refused uploads left no stored file and no document row');`
- L119: `section('C. Permissions and statuses (direct API)');`
- L122: `fails(fn() => Trips::action($U($role), 'diesel_po', ['trip_id' => $id]), "$role cannot attach the Diesel PO to a Wing Van trip", $code);`
- L123: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => 999999]), 'unknown trip refused', 404);`
- L124: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => 'abc']), 'invalid trip id refused', 400);`
- L128: `fails(fn() => Trips::action($wvd, 'diesel_po', ['trip_id' => $x]), "$st trip: refused", 409);`
- L134: `ok(count($docs($x, 'Diesel PO')) === 1, "$st trip: Diesel PO attached");`
- L138: `section('D. Supplier SOA in Complete Trip');`
- L143: `ok($T($c1)['status'] === 'Completed' && count($docs($c1, 'Supplier SOA')) === 1 && $docs($c1, 'Supplier SOA')[0]['original_filename'] === 'soa-shell.pdf', 'completed with the Supplier SOA attached');`
- L144: `ok(str_contains((string)one($p, "SELECT notes FROM trip_events WHERE trip_id=? AND event_type='trip completed'", [$c1])['notes'], 'supplier SOA attached (1)'), 'completion history mentions the SOA');`
- L147: `ok($T($c2)['status'] === 'Completed' && count($docs($c2, 'Supplier SOA')) === 0, 'SOA is optional: completed without it');`
- L150: `fails(fn() => $complete($c3, ['waybill' => $file('pdf', 'wb.pdf'), 'ack_receipt' => $file('pdf', 'ar.pdf'), 'supplier_soa' => $file('pdf', 'soa.pdf')]), 'SOA does not replace the DR: still refused without the DR', 422, 'delivery receipt (DR) file');`
- L151: `ok($T($c3)['status'] === 'Dispatched' && count($docs($c3, 'Supplier SOA')) === 0 && $stored() === $before, 'refused completion: no SOA row and no stored file left');`
- L152: `fails(fn() => $complete($c3, $req() + ['supplier_soa' => $file('txt', 'soa.txt')]), 'SOA of a wrong type: completion refused', 400, 'Only PDF');`
- L153: `ok($T($c3)['status'] === 'Dispatched' && $stored() === $before && !$docs($c3, 'Waybill'), 'nothing saved (required files rolled back too)');`
- L155: `ok($T($c3)['status'] === 'Completed' && count($docs($c3, 'Supplier SOA')) === 2, 'several SOA pages accepted');`
- L157: `fails(fn() => (function () use ($cc, $ccd, $req, $file) { $_FILES = $req() + ['supplier_soa' => $file('pdf', 's.pdf')]; return Trips::action($ccd, 'complete', ['trip_id' => $cc, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'W']); })(),`
- L161: `section('E. Trip Details, Documents viewer, Finance view / download rights');`
- L164: `ok(in_array('Supplier SOA', $cats, true) && in_array('Waybill', $cats, true), 'Finance opens Trip Details: Supplier SOA listed with the trip documents', json_encode($cats));`
- L166: `ok(count(array_filter($det['documents'], fn($x) => $x['category'] === 'Diesel PO')) === 3 && (int)$det['trip']['diesel_po_docs'] === 3, 'Trip Details: Diesel PO files and count');`
- L167: `ok((int)Trips::action($wvd, 'details', ['trip_id' => $c3])['trip']['soa_docs'] === 2, 'Trip Details: Supplier SOA count');`
- L170: `ok(($byCat['Diesel PO'] ?? 0) >= 7 && ($byCat['Supplier SOA'] ?? 0) === 3, 'Documents viewer (Finance): Diesel PO and Supplier SOA listed', json_encode($byCat));`
- L177: `ok($a === $allowed && $b === $allowed, "$label " . ($allowed ? 'can' : 'cannot') . ' view / download the Diesel PO and Supplier SOA');`
- L180: `ok(str_contains($src, 'Documents::download'), 'downloads go through Documents::download (same permission check)');`
- L183: `fails(fn() => $complete($c4, ['supplier_soa' => $file('pdf', 'soa.pdf')]), 'only the SOA: still refused (waybill, AR, DR required)', 422, 'waybill file, acknowledgement receipt file, delivery receipt (DR) file');`
- L185: `ok(str_contains($js, "name: 'supplier_soa'") && str_contains($js, "'Trips.diesel_po'") && str_contains($js, 'CHECKLIST_44_DIESEL_PO_SOA_ATTACHMENTS_V1'), 'screens: SOA field in Complete Trip, Diesel PO button in Trip Details');`
- L186: `ok(!preg_match("/\\['Supplier SOA/", $js) && str_contains($js, "['Delivery Receipt (DR) file', has('delivery_receipt')"), 'Complete Trip checklist of required files unchanged (SOA not required)');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## trip_routing_tests.php

Launcher: `run_trip_routing_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Data::me, RouteDistance::selectable, Routes::action, Routing::route, Routing::straightKm, Routing::testConfig, Routing::useTransport, Trips::action

Source scenario and assertion inventory (line references preserve exact expectations):

- L41: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L42: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L43: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L72: `section('Setup: disposable fresh database');`
- L75: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable fresh test database');`
- L128: `section('A. New trip (Scenario A): automatic road distance');`
- L132: `ok($t['distance_source'] === 'Map' && (float)$t['distance_km'] === $COMP && (float)$t['distance_computed_km'] === $COMP && $t['route_option'] === 'recommended'`
- L135: `ok($line($r['trip_id']) === 'triplineA', 'road line saved in trip_routes');`
- L136: `ok(count($REQ) === 0, 'road distance served from the cache (no second call for the same points and option)', (string)count($REQ));`
- L137: `ok($t['status'] === 'Pre-Assigned' && $t['vehicle_id'] !== null, 'trip is still auto-assigned (Pre-Assigned)', $t['status']);`
- L139: `ok(str_contains((string)$ev['notes'], 'Distance: ' . number_format($COMP, 2) . ' km, Map') && str_contains((string)$ev['notes'], 'Recommended'), 'trip history shows the distance and its source', (string)$ev['notes']);`
- L142: `ok($t['distance_source'] === 'Map' && (float)$t['distance_km'] === $km('recommended', $STR), 'no km typed -> the computed km becomes the billable km', (string)$t['distance_km']);`
- L145: `section('B. Route options');`
- L151: `ok(($sent['options']['avoid_features'] ?? null) === $avoid, "$opt -> request avoids " . json_encode($avoid));`
- L152: `ok($t['route_option'] === $opt && $t['distance_source'] === 'Map' && (float)$t['distance_km'] === $km($opt, [14.1, 121.14]), "$opt -> its own km saved with the option");`
- L154: `ok($km('avoid_tolls') !== $COMP, 'different options give different km (fake service)');`
- L157: `section('C. Manual override of the computed km');`
- L158: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP + 1)])), 'km different from computed WITHOUT a reason is refused', 400, 'Give the reason');`
- L159: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => $fmt($COMP + 0.01)])), 'even 0.01 km difference needs a reason', 400, 'Give the reason');`
- L162: `ok($t['distance_source'] === 'Map (edited)' && (float)$t['distance_km'] === round($COMP + 0.5, 2) && (float)$t['distance_computed_km'] === $COMP && $t['distance_override_reason'] === 'Gate is 500 m inside the port',`
- L164: `ok(!str_contains($r['message'], '15%'), 'difference of 15% or less -> no 15% warning');`
- L166: `ok(str_contains((string)$ev['notes'], 'Map (edited)') && str_contains((string)$ev['notes'], 'reference') && str_contains((string)$ev['notes'], 'Gate is 500 m'), 'history shows edited source, reference km and reason', (string)$ev['notes']);`
- L168: `ok(str_contains($r['message'], '15%'), 'difference above 15% -> warning in the result', $r['message']);`
- L169: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'distance_km' => '99', 'distance_override_reason' => str_repeat('r', 301)])), 'reason longer than 300 characters refused');`
- L172: `ok($t['distance_source'] === 'Map' && (float)$t['distance_computed_km'] === $COMP && $t['distance_provider'] === 'openrouteservice/driving-hgv', 'distance source / computed km / provider sent by the browser are ignored');`
- L175: `section('D. Manual fallback');`
- L179: `ok($t['distance_source'] === 'Manual' && $t['distance_km'] === '12.34' && $t['distance_computed_km'] === null && $t['route_option'] === null && Routing::$outboundCalls === $before && $line($r['trip_id']) === null,`
- L182: `ok($T($r['trip_id'])['distance_source'] === 'Manual', 'route option but a point not pinned -> Manual');`
- L186: `ok($t['distance_source'] === 'Manual' && $t['distance_km'] === '8.10' && $t['route_option'] === null && str_contains($r['message'], 'Manual'), 'map service down -> typed km saved as Manual with a note', $r['message']);`
- L188: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'general_roads', 'pickup_lat' => '14.1300', 'pickup_lng' => '121.1300'])),`
- L192: `ok($T($r['trip_id'])['distance_source'] === 'Manual' && str_contains($r['message'], 'Manual'), 'map service not set up -> Manual with a note (manual trip creation still works)');`
- L196: `ok($t['status'] === 'Pending Review' && $t['distance_km'] === null && $t['distance_source'] === 'Manual', 'dispatcher request with no km while the service is off -> saved, km left for the Operations Head', json_encode([$t['status'], $t['distance_km'], $t['distance_source'], $r['message']]));`
- L200: `section('E. Approved client route');`
- L205: `ok($t['distance_source'] === 'Client Route' && $t['distance_km'] === '9.50' && $t['distance_computed_km'] === '9.50' && (int)$t['client_route_id'] === $rWV`
- L207: `ok((float)$t['pickup_lat'] === $TAN[0] && (float)$t['delivery_lng'] === $MAL[1], 'map pins taken from the approved route');`
- L208: `ok($line($r['trip_id']) === 'route_line_1' && count($REQ) === 0, 'route line copied from the approved route; no map call');`
- L210: `ok($T($r['trip_id'])['distance_km'] === '9.50', 'approved route and no km typed -> route km used');`
- L211: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'distance_km' => '10.00'])), 'route km changed WITHOUT a reason refused', 400, 'Give the reason');`
- L214: `ok($t['distance_source'] === 'Client Route (edited)' && $t['distance_km'] === '10.00' && $t['distance_computed_km'] === '9.50', 'route km changed with a reason -> Client Route (edited)');`
- L217: `ok($t['route_option'] === 'avoid_tolls' && (float)$t['pickup_lat'] === $TAN[0] && $t['distance_source'] === 'Client Route', 'option, pins and source sent with an approved route are replaced by the route values');`
- L218: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'truck_type' => 'Car Carrier'])), 'route of another truck type refused', 409);`
- L219: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rWV, 'client_id' => (string)$cid2])), 'route of another client refused', 409);`
- L221: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rPend])), 'route not approved yet refused', 409);`
- L223: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rNoRate])), 'route without a current approved rate refused', 409);`
- L225: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => (string)$rOff])), 'inactive route refused', 409);`
- L226: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => '999999'])), 'unknown route refused', 409);`
- L231: `fails(fn() => Trips::action($ops, 'create', $trip(['client_id' => (string)$cid3, 'client_route_id' => (string)$r3])), 'route of an inactive client refused');`
- L232: `ok(RouteDistance::selectable($p, $cid3) === [], 'inactive client -> no selectable routes');`
- L236: `ok($t['distance_source'] === 'Client Route' && $t['distance_km'] === '21.00' && (float)$t['pickup_lat'] === $TAN[0] && $line($r['trip_id']) === null, 'route without map pins -> route km used, the trip keeps its own pins, no line');`
- L239: `section('F. Review of a dispatcher request (Scenario B)');`
- L242: `ok($t['status'] === 'Pending Review' && $t['distance_source'] === 'Map' && $t['distance_km'] !== null, 'dispatcher request saved with the computed road distance');`
- L249: `ok($t2['distance_source'] === 'Map' && $t2['distance_km'] === $t['distance_km'] && $t2['distance_computed_at'] === $t['distance_computed_at'] && count($REQ) === 0, 'review with unchanged distance -> saved distance kept (no new map call)');`
- L250: `ok($t2['status'] === 'Pre-Assigned', 'review still confirms and auto-assigns', $t2['status']);`
- L257: `ok($t2['distance_source'] === 'Client Route' && $t2['distance_km'] === '9.50' && (int)$t2['client_route_id'] === $rWV && $line($id) === 'route_line_1', 'Operations Head picks an approved route at review -> route km, pins and line');`
- L260: `fails(fn() => Trips::action($ops, 'review', ['trip_id' => $r['trip_id'], 'decision' => 'approve', 'truck_type' => 'Wing Van', 'pickup_point' => $t['pickup_point'], 'delivery_point' => $t['delivery_point'],`
- L263: `ok($T($r['trip_id'])['status'] === 'Pending Review', 'refused review leaves the request Pending Review');`
- L265: `ok($T($r['trip_id'])['status'] === 'Rejected', 'reject still works (no distance check on reject)');`
- L268: `section('G. Edit before dispatch');`
- L276: `ok($t2['distance_source'] === 'Map' && $t2['distance_computed_at'] === $t['distance_computed_at'] && count($REQ) === 0 && $t2['delivery_details'] === 'Call the guard', 'edit of other details -> distance kept, no map call');`
- L277: `fails(fn() => Trips::action($ops, 'edit', $edit(['distance_km' => $fmt((float)$t['distance_km'] + 2)])), 'edit: km changed without a reason refused', 400, 'Give the reason');`
- L280: `ok($t2['distance_source'] === 'Manual' && $t2['distance_km'] === '30.00' && $t2['distance_computed_km'] === null && $line($id) === null, 'edit to manual km (no option) -> Manual, line removed');`
- L282: `ok(str_contains((string)($ch['changes_json'] ?? ''), '"Distance source"') && str_contains((string)$ch['changes_json'], '"Manual"'), 'Activity Log records the distance source change', (string)($ch['changes_json'] ?? 'none'));`
- L284: `ok($T($id)['distance_source'] === 'Client Route' && $line($id) === 'route_line_1', 'edit: choose an approved route');`
- L288: `ok($T($id)['distance_source'] === 'Client Route' && (int)$T($id)['client_route_id'] === $rWV, 'route deactivated later -> unchanged trip keeps its saved route (history)');`
- L289: `fails(fn() => Trips::action($ops, 'edit', $edit(['client_route_id' => (string)$rWV, 'distance_km' => '11.00', 'distance_override_reason' => 'more', 'route_option' => ''])), 'deactivated route cannot be used for a CHANGED distance', 409);`
- L292: `ok($T($id)['distance_km'] === '9.50' && $T($id)['booking_reference'] === 'BK-1', 'dispatcher edit cannot change the distance (only booking / container / units)');`
- L303: `fails(fn() => Trips::action($ops, 'edit', $tryOps), "#27 edit lock: Operations Head cannot edit a $status trip", 409);`
- L304: `fails(fn() => Trips::action($wvd, 'edit', ['trip_id' => $lid, 'booking_reference' => 'BK-LOCK', 'container_number' => 'CONT1', 'delivery_details' => 'x']), "#27 edit lock: dispatcher cannot edit a $status trip", 409);`
- L306: `ok($after === $before && Routing::$outboundCalls === $calls && $line($lid) === 'triplineA', "#27 edit lock: $status trip, distance and line unchanged; no map call");`
- L311: `section('H. Invalid inputs');`
- L312: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'teleport', 'distance_km' => '8'])), 'unknown route option refused');`
- L313: `fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '8.123'])), 'km with more than 2 decimals refused');`
- L314: `fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '3000.01'])), 'km above 3000 refused');`
- L315: `fails(fn() => Trips::action($ops, 'create', $trip(['distance_km' => '-5'])), 'negative km refused');`
- L316: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lat' => '35.68', 'pickup_lng' => '139.69'])), 'pin outside the Philippines refused', 400, 'outside the Philippines');`
- L317: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'recommended', 'pickup_lng' => ''])), 'half pin refused', 400, 'incomplete');`
- L318: `fails(fn() => Trips::action($ops, 'create', $trip(['client_route_id' => 'abc'])), 'route id that is not a number refused');`
- L319: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => 'teleport', 'distance_km' => '8', 'pickup_lat' => '', 'pickup_lng' => ''])), 'unknown route option refused even without map pins');`
- L320: `fails(fn() => Trips::action($ops, 'create', $trip(['route_option' => ['x'], 'distance_km' => '8'])), 'route option as a list refused');`
- L323: `section('I. Roles and what the screen receives');`
- L327: `ok(in_array($rWV, array_map('intval', $ids), true) && in_array($rCC, array_map('intval', $ids), true) && !in_array($rPend, array_map('intval', $ids), true) && !in_array($rOff, array_map('intval', $ids), true),`
- L330: `ok(!array_key_exists('rate_amount', $row0) && !array_key_exists('rate_type', $row0) && !array_key_exists('minimum_charge', $row0), 'route list for trips has no route rates (pricing stays with Billing)');`
- L332: `ok(($one['routes'][0]['route_geometry'] ?? null) === 'route_line_1', 'one route asked -> its line included');`
- L334: `ok($cc['routes'] && !array_filter($cc['routes'], fn($x) => $x['truck_type'] !== 'Car Carrier'), 'Car Carrier dispatcher sees only Car Carrier routes');`
- L335: `fails(fn() => Routes::action($ccd, 'selectable', ['client_id' => $cid, 'truck_type' => 'Wing Van']), 'dispatcher asking for the other team\'s truck type refused', 403);`
- L337: `fails(fn() => Routes::action($U($role), 'selectable', ['client_id' => $cid]), "$role cannot list routes for trips", 403);`
- L338: `fails(fn() => Trips::action($U('finance'), 'create', $trip(['distance_km' => '5'])), 'finance cannot create a trip', 403);`
- L339: `fails(fn() => Trips::action($ccd, 'create', $trip(['truck_type' => 'Wing Van', 'client_route_id' => (string)$rWV])), 'dispatcher cannot create a trip of the other team (route or not)');`
- L341: `ok($T($r['trip_id'])['distance_source'] === 'Client Route', 'Car Carrier dispatcher can use a Car Carrier approved route');`
- L343: `ok($det['trip']['client_route_ref'] === one($p, 'SELECT route_ref FROM client_routes WHERE id=?', [$rCC])['route_ref'] && $det['trip']['route_geometry'] !== null`
- L346: `ok(!preg_match('/api\.heigit\.org|api\.openrouteservice\.org/i', $all) && !str_contains($all, KEY) && !str_contains($all, 'ORS_API_KEY='), 'trip screen code never calls the map service directly and has no key');`
- L347: `ok(!str_contains((string)file_get_contents($LOG), KEY), 'API key never written to the PHP error log');`
- L350: `section('J. Trip workflow regression');`
- L355: `ok($t['status'] === 'Pre-Assigned' && (int)one($p, "SELECT COUNT(*) AS n FROM trip_assignments WHERE trip_id=?", [$id])['n'] >= 3, 'assignment holds truck, driver and helper');`
- L364: `ok($b && $b['status'] === 'Ongoing' && $b['distance_km'] === '12.00' && $b['rate_per_km'] === '50.00' && $b['base_amount'] === '600.00',`
- L366: `fails(fn() => Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1']), 'completion without documents refused', 422, 'delivery receipt (DR) file');`
- L371: `try { Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-1']); ok(false, 'DR still required'); }`
- L372: `catch (BusinessRuleException $e) { ok($e->httpStatus === 422 && str_contains($e->getMessage(), 'delivery receipt') && !str_contains($e->getMessage(), 'waybill file'), 'with waybill and AR only -> still refused, only the DR is missing', $e->getMessage()); }`
- L375: `ok($T($id)['status'] === 'Completed' && one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'For Billing', 'with the DR -> Completed, billing For Billing');`
- L376: `ok($T($id)['distance_source'] === 'Client Route (edited)' && $T($id)['distance_override_reason'] === 'Extra stop', 'distance record unchanged by dispatch and completion');`
- L377: `fails(fn() => Trips::action($ops, 'edit', ['trip_id' => $id, 'distance_km' => '1']), 'completed trip cannot be edited', 409);`
- L378: `ok($routeSum() === $RS, 'client routes, route rates, client rates and disbursements are not changed by creating, dispatching or completing a trip');`
- L381: `section('K. Screen settings');`
- L385: `ok(($me['map']['defaultRouteOption'] ?? null) === 'recommended' && ($me['map']['overrideWarningRatio'] ?? null) === 0.15 && count($me['map']['routeOptions'] ?? []) === 3,`
- L387: `ok(!str_contains(json_encode($me), KEY), 'screen settings never contain the ORS key');`
- L390: `section('L. Migration 07: partially failed import, detection and recovery');`
- L400: `ok(count($parts) === 3, 'migration has 3 statements (tracker, ALTER trips, CREATE trip_routes)', (string)count($parts));`
- L406: `ok((int)$st['tracked'] === 1 && (int)$st['table_found'] === 0 && (int)$st['columns_found'] === 7, 'detection query shows the partial state (columns added, trip_routes missing)', json_encode($st));`
- L407: `try { test_import($pa, test_sql("database/migrations/$MIG.sql")); ok(false, 'importing again is stopped by the tracker'); }`
- L408: `catch (PDOException $e) { ok(($e->errorInfo[1] ?? 0) === 1062, 'importing again is stopped by the tracker (duplicate key), nothing else runs'); }`
- L418: `ok((int)$st['tracked'] === 1 && (int)$st['table_found'] === 1 && (int)$st['columns_found'] === 7, 'after recovery: tracked, table and 7 columns present', json_encode($st));`
- L420: `ok($fp === $ff, 'recovered database is identical to a fresh install', json_encode(array_map(fn($k) => array_values(array_diff($fp[$k], $ff[$k])) + array_values(array_diff($ff[$k], $fp[$k])), array_keys($ff))));`
- L422: `ok((int)$old === 1, "existing trips get distance_source 'Manual' by default");`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## trip_schedule_tests.php

Launcher: `run_trip_schedule_tests.php`. Unified runner compatible via subprocess (global function names conflict in-process).

Backend calls: Actions::load, Admin::action, Checklist::sections, Funds::action, Settings::all, Settings::clearCache, Settings::value, Trips::action, Trips::timeGates

Source scenario and assertion inventory (line references preserve exact expectations):

- L41: `try { $fn(); ok(false, $name, 'no error was raised'); }`
- L42: `catch (BusinessRuleException $e) { ok(($code === null || $e->httpStatus === $code) && ($contains === '' || stripos($e->getMessage(), $contains) !== false), $name, "got {$e->httpStatus}: {$e->getMessage()}"); }`
- L43: `catch (Throwable $e) { ok(false, $name, get_class($e) . ': ' . $e->getMessage()); }`
- L48: `section('Setup: disposable fresh database');`
- L51: `ok($p->query('SELECT DATABASE()')->fetchColumn() === $FRESH, 'db() is the disposable test database');`
- L107: `section('A. Admin settings');`
- L108: `ok(Settings::value('checklist_lead_hours') === 2.0 && Settings::value('dispatch_early_minutes') === 15.0, 'defaults: checklist 2 hours, Confirm Dispatch 15 minutes before the schedule');`
- L109: `ok(Settings::value('fund_release_lead_hours') === 2.0, 'fund release window (#40) still defaults to 2 hours');`
- L111: `ok(in_array('checklist_lead_hours', $keys, true) && in_array('dispatch_early_minutes', $keys, true), 'both shown in Administration > Settings');`
- L113: `ok(Settings::value('checklist_lead_hours') === 3.0, 'Admin can change the checklist window', $r['message'] ?? '');`
- L114: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'checklist_lead_hours', 'value' => '25']), 'checklist window above 24 hours refused');`
- L115: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '-1']), 'negative dispatch minutes refused');`
- L116: `fails(fn() => Admin::action($adm, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '241']), 'dispatch minutes above 240 refused');`
- L117: `fails(fn() => Admin::action($ops, 'setting_save', ['key' => 'dispatch_early_minutes', 'value' => '60']), 'Operations Head cannot change the windows', 403);`
- L118: `fails(fn() => Admin::action($wvd, 'setting_save', ['key' => 'checklist_lead_hours', 'value' => '24']), 'dispatcher cannot change the windows', 403);`
- L122: `section('B. Planning and approval stay allowed early');`
- L124: `ok($T($id)['status'] === 'Pre-Assigned' && $T($id)['vehicle_id'] !== null, 'trip three days ahead: created, confirmed and auto-assigned');`
- L127: `ok($T($id)['pickup_point'] === 'NEW PICKUP', 'Operations Head can still edit the details before dispatch (#27)');`
- L129: `ok($T($id)['booking_reference'] === 'BK-EARLY', 'dispatcher can still fill in booking details early');`
- L131: `ok(!empty($f['fund_id']), 'fund request can be submitted early');`
- L133: `ok(one($p, 'SELECT status FROM fund_requests WHERE id=?', [$f['fund_id']])['status'] === 'Ready for Release', 'fund request can be approved early');`
- L134: `fails(fn() => Funds::action($fin, 'release', ['fund_id' => $f['fund_id'], 'payment_method' => 'Cash', 'released_on' => date('Y-m-d')]), 'fund release still refused early (#40 phase 1)', 409, 'Too early');`
- L135: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'opening the pre-dispatch checklist three days early refused', 409, 'Too early for the pre-dispatch checklist');`
- L136: `ok(!one($p, 'SELECT 1 AS x FROM checklist_starts WHERE trip_id=?', [$id]), 'no checklist start recorded');`
- L137: `fails(fn() => Trips::action($wvd, 'checklist', ['trip_id' => $id, 'items' => $items, 'meta' => []]), 'submitting the checklist directly (API) three days early refused', 409, 'Too early');`
- L138: `ok($T($id)['status'] === 'Pre-Assigned' && !one($p, 'SELECT 1 AS x FROM inspections WHERE trip_id=?', [$id]), 'status unchanged, no inspection saved');`
- L141: `ok($T($c)['status'] === 'Cancelled', 'a trip can still be cancelled before its schedule');`
- L144: `section('C. Pre-dispatch checklist window');`
- L146: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'scheduled in 2 h 1 min: checklist not open yet', 409, 'opens');`
- L148: `catch (BusinessRuleException $e) { ok(str_contains($e->getMessage(), 'Philippine time') && str_contains($e->getMessage(), '2 hour(s) before'), 'message gives the opening time, the scheduled time and the window', $e->getMessage()); }`
- L151: `ok($T($id)['status'] === 'Ready for Dispatch', 'scheduled in 1 h 59 min: checklist opened and submitted -> Ready for Dispatch', json_encode($r));`
- L155: `fails(fn() => Trips::action($wvd, 'checklist', ['trip_id' => $id2, 'items' => $items, 'meta' => []]), 'checklist opened in the window, schedule moved later -> submit refused (re-checked on submit)', 409, 'Too early');`
- L158: `ok($T($id3)['status'] === 'Ready for Dispatch', 'schedule already passed: checklist still allowed');`
- L161: `section('D. Confirm Dispatch window and late dispatch');`
- L165: `ok(str_contains($bl, 'Confirm Dispatch opens') && str_contains($bl, 'Philippine time') && count($det['trip']['dispatch_blockers']) === 1, 'Ready + Released, scheduled in 30 min: only the schedule blocks, with the time', $bl);`
- L166: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Confirm Dispatch 30 min early refused (server side)', 409, 'Confirm Dispatch opens');`
- L167: `ok($T($id)['status'] === 'Ready for Dispatch' && !one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$id]) && $T($id)['dispatched_at'] === null, 'refused dispatch: status, dispatch time and billing untouched');`
- L170: `ok($T($id)['status'] === 'Dispatched' && !str_contains($r['message'], 'late') && !str_contains($r['message'], 'after the scheduled'), 'scheduled in 14 min (15-min allowance): dispatch confirmed, no late note', $r['message']);`
- L171: `ok(one($p, 'SELECT status FROM billings WHERE trip_id=?', [$id])['status'] === 'Ongoing', 'billing draft still generated at dispatch');`
- L175: `ok($T($id)['status'] === 'Dispatched' && str_contains($r['message'], 'after the scheduled time') && preg_match('/1 h (29|30|31) min after the scheduled time/', (string)$ev['notes']) === 1,`
- L178: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'in the window but not Ready for Dispatch / no fund: still refused', 409, 'Ready for Dispatch');`
- L180: `ok(!str_contains(implode(' ', $det['trip']['dispatch_blockers']), 'opens'), 'inside the window the schedule is not listed as a blocker');`
- L183: `section('E. Admin changes the windows');`
- L186: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'checklist window 0: 30 min early refused', 409, 'at the time before');`
- L189: `ok($T($id)['status'] === 'Ready for Dispatch', 'checklist window 1.5 hours: 30 min early allowed');`
- L192: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'dispatch allowance 0: 30 min early refused', 409);`
- L195: `ok($T($id)['status'] === 'Dispatched', 'dispatch allowance 60 min: 30 min early allowed');`
- L199: `section('F. Date rollover (fixed clock, Philippine time)');`
- L202: `ok($g['checklist_opens_at'] === '2026-11-08 22:30:00' && $g['checklist_allowed_now'] === false, '12:30 AM trip: checklist opens 10:30 PM the evening before; closed at 10:29:59 PM', json_encode($g));`
- L203: `ok(Trips::timeGates($sched, strtotime('2026-11-08 22:30:00'))['checklist_allowed_now'] === true, 'open at 10:30:00 PM the day before (counted in hours, not dates)');`
- L204: `ok(Trips::timeGates($sched, strtotime('2026-11-08 23:59:59'))['dispatch_allowed_now'] === false, 'Confirm Dispatch still closed before midnight');`
- L205: `ok($g['dispatch_opens_at'] === '2026-11-09 00:15:00' && Trips::timeGates($sched, strtotime('2026-11-09 00:15:00'))['dispatch_allowed_now'] === true, 'Confirm Dispatch opens 12:15 AM on the scheduled date');`
- L207: `ok($g['checklist_allowed_now'] === true && $g['checklist_opens_at'] === '2026-12-31 23:00:00', 'year rollover (Jan 1, 1:00 AM): checklist opens Dec 31, 11:00 PM');`
- L209: `ok($g['late_minutes'] === 125 && $g['dispatch_allowed_now'] === true, 'late minutes counted after the schedule (2 h 5 min)');`
- L211: `ok(Trips::timeGates(['scheduled_at' => '2026-11-09 06:00:00'], strtotime('2026-11-08 06:00:00'))['checklist_allowed_now'] === true, 'window of 24 hours opens at the same time the previous day');`
- L215: `section('G. Asia/Manila timezone');`
- L216: `ok(date_default_timezone_get() === 'Asia/Manila', 'PHP timezone is Asia/Manila');`
- L217: `ok($p->query('SELECT @@session.time_zone')->fetchColumn() === '+08:00', 'database session uses +08:00 (same clock as PHP)');`
- L219: `ok($g['dispatch_allowed_now'] === true && Trips::timeGates(['scheduled_at' => '2026-11-09 00:30:00'], gmmktime(16, 14, 59, 11, 8, 2026))['dispatch_allowed_now'] === false,`
- L221: `ok(strtotime($g['checklist_opens_at']) === gmmktime(14, 30, 0, 11, 8, 2026), 'checklist opening time is 2:30 PM UTC (10:30 PM PH)');`
- L223: `ok(abs($dbNow - time()) <= 5, 'database NOW() and PHP time agree (dispatched_at and the windows use the same clock)');`
- L226: `section('H. Reschedule (second attempt) and schedule edits');`
- L234: `ok($t['status'] === 'Pre-Assigned' && (int)$t['attempt_number'] === 2, 'reschedule (attempt 2) allowed any time, 5 hours ahead');`
- L235: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'attempt 2: checklist follows the NEW schedule (5 h ahead -> closed)', 409, 'Too early');`
- L238: `ok($T($id)['status'] === 'Ready for Dispatch', 'Operations Head moves attempt 2 to 1 hour ahead -> checklist allowed');`
- L239: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Confirm Redispatch 1 hour early refused', 409, 'Confirm Dispatch opens');`
- L242: `ok($T($id)['status'] === 'Ready for Dispatch', 'schedule moved earlier after the checklist keeps Ready for Dispatch (no new checklist)');`
- L244: `ok($T($id)['status'] === 'Dispatched' && str_contains($r['message'], 'Redispatch confirmed'), 'Confirm Redispatch allowed inside the new window (redispatch fund optional)', $r['message']);`
- L248: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'Ready trip moved 4 hours later (outside the checklist window) -> reset and Confirm Dispatch refused', 409, 'Confirm Dispatch opens');`
- L251: `section('I. Regression');`
- L255: `fails(fn() => Trips::action($wvd, $act, ['trip_id' => $id] + $extra), "$act before dispatch refused (status rule unchanged)", 409);`
- L256: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Arrival']), 'arrival checklist not pending before the trip', 409);`
- L259: `fails(fn() => Trips::action($wvd, 'complete', ['trip_id' => $id, 'completed_at' => date('Y-m-d\TH:i'), 'waybill_number' => 'WB-2']), 'completion still needs the documents incl. the DR', 422, 'delivery receipt (DR) file');`
- L260: `fails(fn() => Trips::action($wvd, 'edit', ['trip_id' => $id, 'booking_reference' => 'X']), 'trip details lock after dispatch (#27) unchanged', 409);`
- L262: `ok($T($id)['status'] === 'On Hold - Incident Reported', 'incident report after dispatch still works');`
- L267: `ok(one($p, 'SELECT status FROM fund_requests WHERE id=?', [$f['fund_id']])['status'] === 'Released', 'fund release inside its own window (1 h ahead, #40) unchanged');`
- L269: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'checklist done and fund released 1 hour ahead: dispatch still waits for its own window', 409, 'Confirm Dispatch opens');`
- L270: `fails(fn() => Trips::action($U('car_carrier_dispatcher'), 'dispatch', ['trip_id' => $id]), 'other dispatcher team still refused', 403);`
- L273: `section('K. Completed checklist, then the schedule changes (revalidation)');`
- L289: `ok($T($id)['status'] === 'Ready for Dispatch' && !str_contains($r['message'], 'done again'), 'small later change inside the window (+40 min): checklist kept, still Ready for Dispatch', $r['message']);`
- L291: `ok($T($id)['status'] === 'Ready for Dispatch', 'schedule moved EARLIER: checklist kept');`
- L293: `ok($e0 === 0, 'no reset recorded for the kept changes');`
- L296: `ok($t['status'] === 'Pre-Assigned' && str_contains($r['message'], 'must be done again'), 'moved 3 days later: back to Pre-Assigned, message says the checklist must be done again', $r['message']);`
- L298: `ok($ev && $ev['from_status'] === 'Ready for Dispatch' && $ev['to_status'] === 'Pre-Assigned' && str_contains((string)$ev['notes'], 'Philippine time'), 'reset written to the trip history with the times', json_encode($ev));`
- L300: `ok($after['trip'] == $before['trip'], 'assignment, route distance, booking and attempt unchanged by the reset');`
- L301: `ok($after['fund'] == $before['fund'] && $after['fund'][0]['status'] === 'Released', 'Released fund unchanged (same row, amount, release time)');`
- L302: `ok($after['holds'] == $before['holds'], 'truck and crew holds unchanged');`
- L303: `ok($after['inspection'] == $before['inspection'], 'old checklist record kept (not deleted)');`
- L304: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'reset trip cannot be dispatched', 409, 'needs Ready for Dispatch');`
- L305: `fails(fn() => Trips::action($wvd, 'checklist_start', ['trip_id' => $id, 'kind' => 'Pre-Dispatch']), 'new checklist only in the new window (3 days ahead -> closed)', 409, 'Too early');`
- L308: `ok($T($id)['status'] === 'Ready for Dispatch', 'new checklist in the new window -> Ready for Dispatch again');`
- L311: `ok($T($id)['status'] === 'Dispatched' && $snap($id)['fund'] == $before['fund'], 'then dispatched with the same Released fund');`
- L316: `ok($T($id)['status'] === 'Ready for Dispatch', 'boundary: new schedule 1 min before (checklist time + 2 h) -> kept');`
- L318: `ok($T($id)['status'] === 'Pre-Assigned', 'boundary: new schedule 2 min after (checklist time + 2 h) -> reset');`
- L322: `ok($T($id)['status'] === 'Ready for Dispatch', 'Admin window 6 hours: moving 4 hours later stays inside -> kept (same setting, no extra duration)');`
- L329: `ok($T($id)['status'] === 'Ready for Dispatch', 'Ready trip: edits without a schedule change (Ops details, dispatcher booking) keep the checklist');`
- L332: `ok($T($id)['status'] === 'Pre-Assigned' && !one($p, "SELECT 1 AS x FROM trip_events WHERE trip_id=? AND event_type='pre-dispatch checklist reset after schedule change'", [$id]), 'Pre-Assigned trip (no checklist yet): schedule change has no reset event');`
- L334: `section('L. Dispatch checks the checklist itself (current attempt and truck)');`
- L338: `ok(str_contains(implode(' ', $det['trip']['dispatch_blockers']), 'No pre-dispatch checklist for attempt #2'), 'Ready trip whose checklist is for attempt 1 only: blocked for attempt 2', implode(' ', $det['trip']['dispatch_blockers']));`
- L339: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'dispatch refused (status alone is not enough)', 409, 'No pre-dispatch checklist');`
- L340: `ok(!one($p, 'SELECT 1 AS x FROM billings WHERE trip_id=?', [$id]), 'no billing draft on the refused dispatch');`
- L344: `fails(fn() => Trips::action($wvd, 'dispatch', ['trip_id' => $id]), 'checklist done for another truck: dispatch refused', 409, 'another truck');`
- L349: `ok($T($id)['status'] === 'Pre-Assigned', 'truck replacement after the checklist: back to Pre-Assigned (rule unchanged)');`
- L354: `ok($T($id)['status'] === 'Pre-Assigned', 'crew replacement after the checklist: back to Pre-Assigned (rule unchanged)');`
- L356: `section('M. KNOWN GAP (documented, policy pending): late dispatch without a schedule edit');`
- L361: `ok($T($id)['status'] === 'Dispatched' && str_contains($r['message'], 'after the scheduled time'),`
- L364: `section('J. Screen data and code');`
- L368: `ok(isset($g['scheduled_at'], $g['checklist_opens_at'], $g['dispatch_opens_at']) && $g['checklist_allowed_now'] === true && $g['dispatch_allowed_now'] === false && $g['late_minutes'] === 0,`
- L371: `ok(str_contains($js, 'CHECKLIST_38_40_TRIP_TIME_GATES_V1') && str_contains($js, 'checklist_allowed_now') && str_contains($js, 'gates.dispatch_opens_at'), 'trip screen disables the checklist and shows the windows');`
- L372: `ok(str_contains($js, 'CHECKLIST_27_TRIP_DETAILS_LOCK_V1'), 'trip screen keeps the #27 lock');`

Missing coverage: this script covers only the scenarios above; cross-module gaps are listed below.

## Cross-module gaps

Quantity expansion is proposed, not implemented: current batch creates one trip per row. No executable expectation of quantity expansion. Existing batch tests cover partial retry, limits, validation and concurrency.

Operations: existing regression tests cover dispatch, funds, completion and arrival in part. Exhaustive role/state matrices, incident repair/reschedule and arrival finding combinations still need dedicated DB scenarios.

Maintenance: corrective jobs, parts stock, purchase orders and verification exist; no dedicated maintenance suite currently proves all inventory, duplicate receipt and authorization paths. Preventive maintenance is excluded.

Accounting: billing adjustment and cash fund release have dedicated suites. Collections, reporting totals, accounts payable and purchasing fuel approval require additional executable workflows; do not count them as covered. Diesel PO/SOA attachments are optional document flows, not evidence of a complete fuel approval workflow.

## Infrastructure files

EnvironmentTest.php: PHP >=8.2 and PDO/JSON/mbstring availability only; no DB connection. _launcher.php: copy/config/migration/DB helpers; _mock_ors.php: local routing/geocoding fake including 403/429/no-road; _smtp_sink.php: loopback SMTP capture. run_htaccess_tests.php: read-only HTTP exposure and asset assertions, explicit TEST_BASE_URL, actual Apache required. README.md documents legacy commands. composer.lock pins PHPUnit 11.5.57; composer.json currently allows ^11. No existing PHPUnit XML.


## Implementation additions (after inventory)

- PHPUnit Safe/Unit/Integration/Feature suites, Composer aliases and JUnit output.
- Pure payment, inventory quantity, checklist, schedule and calendar validation regression tests.
- Mutation authorization matrix for actual Maintenance/Purchasing/Finance/Billing actions and all nine roles. These prove rejection before DB access; they do not prove authorized workflows.
- Database-free refusal tests for all destructive connection helpers outside a verified sandbox.
- New inventory_finance_tests.php, launched by run_inventory_finance_tests.php: opening stock, duplicate parts, insufficient stock rollback, request stock release, duplicate release, stock movements, duplicate lines, payable partial/final settlement, overpayment/settled-payable refusals, disbursement/expense totals, budget rollover and invalid period.
- The new DB suite is executable but unverified until explicit local test credentials are supplied.

Remaining dedicated scenarios include maintenance report/repair/verification and purchasing PO receipt matrices, complete incident recovery/redispatch matrices, collection/payment races and financial reports. Existing workflow regression suites cover portions; the inventory above must not be interpreted as exhaustive coverage. No quantity expansion test assumes the proposed interface exists.
