<?php
/*
 * =====================================================================
 *  backend/Modules/Accounting/Funds.php  —  TRIP FUND REQUESTS
 * =====================================================================
 *  Objective 1.4: dispatchers submit trip fund requests by choosing the
 *  expense categories and amounts, for approval.
 *  Objective 3.5: Finance processes approved trip fund requests / allowances.
 *
 *  PDF #12 steps 4-6:
 *   4. Dispatcher picks the applicable preset categories (Forklift Operator 100,
 *      Checker 100, Passway 200, Driver Meal 300, Helper Meal 200) and may add
 *      other categories. The SYSTEM takes the preset amounts and computes the total.
 *   5. Operations Head approves (-> Ready for Release, appears to Finance) or
 *      rejects (-> back to the dispatcher for revision and resubmission).
 *   6. Finance releases the money (even before the checklist is done) and
 *      clicks Confirm Release (-> Released).
 *  After the trip, Finance records the liquidation (actual spent, returned cash),
 *  as printed on the Request for Cash Fund form ("subject for liquidation").
 * =====================================================================
 */
declare(strict_types=1);
core('Notify');
core('Money');
core('Files');

final class Funds {
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $scope = ''; $args = [];
        if (roleIsDispatcher($u['role'])) { $scope = ' AND (t.dispatcher_role=? OR f.requested_by=?)'; $args = [$u['role'], $u['id']]; }
        $data = readSections([
            'funds' => fn() => many($p, "SELECT f.*, t.trip_ref, t.status AS trip_status, t.truck_type, t.pickup_point, t.delivery_point, t.scheduled_at,
                    c.company_name AS client, v.plate_number, ru.full_name AS requested_by_name, au.full_name AS approved_by_name,
                    lu.full_name AS released_by_name, d.voucher_number, d.payment_method,
                    (SELECT GROUP_CONCAT(CONCAT(l.category_name, ' ', FORMAT(l.amount,2)) ORDER BY l.id SEPARATOR '; ') FROM fund_request_lines l WHERE l.fund_request_id=f.id) AS breakdown
                FROM fund_requests f JOIN trips t ON t.id=f.trip_id JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
                JOIN users ru ON ru.id=f.requested_by LEFT JOIN users au ON au.id=f.approved_by LEFT JOIN users lu ON lu.id=f.released_by
                LEFT JOIN disbursements d ON d.id=f.disbursement_id
                WHERE 1=1 $scope ORDER BY FIELD(f.status,'Pending Approval','Ready for Release','Rejected','Released','Cancelled'), f.id DESC LIMIT 1000", $args),
        ]);
        if (roleIsDispatcher($u['role'])) {
            $data = mergeSections($data, [
                'eligibleTrips' => fn() => many($p, "SELECT t.id, t.trip_ref, t.status, t.attempt_number, t.pickup_point, t.delivery_point, v.plate_number
                    FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id
                    WHERE t.dispatcher_role=? AND t.status IN ('Pre-Assigned','Ready for Dispatch')
                      AND NOT EXISTS (SELECT 1 FROM fund_requests f WHERE f.trip_id=t.id AND f.attempt_number=t.attempt_number AND f.status<>'Rejected')
                    ORDER BY t.scheduled_at", [$u['role']]),
            ]);
        }
        $data['categories'] = many($p, 'SELECT name, amount FROM fund_categories WHERE active=1 ORDER BY sort_order, name');
        $data['methods'] = Money::METHODS;
        $data['can'] = ['submit' => roleIsDispatcher($u['role']), 'approve' => hasRole($u, 'operations_head'), 'release' => hasRole($u, 'finance')];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'submit' => self::submit($u, $d),
            'decide' => self::decide($u, $d),
            'release' => self::release($u, $d),
            'liquidate' => self::liquidate($u, $d),
            'details' => self::details($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    /**
     * Builds the request lines. Preset amounts are ALWAYS taken from the database
     * (the screen cannot change them); added categories use the typed amount.
     */
    private static function lines(PDO $p, array $d): array {
        $presets = array_column(many($p, 'SELECT name, amount FROM fund_categories WHERE active=1'), 'amount', 'name');
        $lines = [];
        foreach ((array)($d['categories'] ?? []) as $name) {
            must(is_string($name) && isset($presets[$name]), 'Unknown fund category: ' . (is_string($name) ? $name : '?'));
            $lines[$name] = ['category_name' => $name, 'amount' => number_format((float)$presets[$name], 2, '.', ''), 'is_preset' => 1];
        }
        foreach ((array)($d['extra'] ?? []) as $x) {
            if (!is_array($x)) continue;
            $name = trim((string)($x['name'] ?? '')); $amt = trim((string)($x['amount'] ?? ''));
            if ($name === '' && $amt === '') continue;
            must($name !== '' && textLength($name) <= 80, 'Each added category needs a name (max 80 characters).');
            must(!isset($lines[$name]), 'Category "' . $name . '" was entered twice.');
            $lines[$name] = ['category_name' => $name, 'amount' => moneyField(['amount' => $amt], 'amount'), 'is_preset' => 0];
        }
        must((bool)$lines, 'Choose at least one fund category.');
        return array_values($lines);
    }

    /** Dispatcher submits (or revises a rejected) fund request. */
    private static function submit(array $u, array $d): array {
        must(roleIsDispatcher($u['role']), 'Only dispatchers submit trip fund requests.', 403);
        $tripId = idField($d, 'trip_id');
        $notes = optField($d, 'notes', 255);
        return transaction(function (PDO $p) use ($u, $d, $tripId, $notes) {
            $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$tripId]);
            must((bool)$t, 'Trip not found.', 404);
            must($t['dispatcher_role'] === $u['role'], 'This trip belongs to the other dispatcher team.', 403);
            must(in_array($t['status'], ['Pre-Assigned', 'Ready for Dispatch'], true), 'A fund request is made for a Pre-Assigned trip that has not left yet (trip is ' . $t['status'] . ').', 409);
            $lines = self::lines($p, $d);
            $total = number_format(array_sum(array_map(fn($l) => (float)$l['amount'], $lines)), 2, '.', '');
            $old = one($p, 'SELECT * FROM fund_requests WHERE trip_id=? AND attempt_number=? FOR UPDATE', [$tripId, $t['attempt_number']]);
            if ($old) {
                must($old['status'] === 'Rejected', 'This trip already has a fund request (' . $old['fund_ref'] . ', ' . $old['status'] . ').', 409);
                run($p, 'DELETE FROM fund_request_lines WHERE fund_request_id=?', [$old['id']]);
                run($p, "UPDATE fund_requests SET amount=?, notes=?, status='Pending Approval', requested_by=?, rejected_reason=NULL, approved_by=NULL, approved_at=NULL WHERE id=?",
                    [$total, $notes, $u['id'], $old['id']]);
                $fid = (int)$old['id']; $ref = $old['fund_ref']; $verb = 'resubmitted';
            } else {
                $fid = insert($p, 'fund_requests', ['fund_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'trip_id' => $tripId, 'attempt_number' => $t['attempt_number'],
                    'amount' => $total, 'notes' => $notes, 'status' => 'Pending Approval', 'requested_by' => $u['id']]);
                $ref = refNumber('FR', $fid);
                run($p, 'UPDATE fund_requests SET fund_ref=? WHERE id=?', [$ref, $fid]);
                $verb = 'submitted';
            }
            foreach ($lines as $l) insert($p, 'fund_request_lines', ['fund_request_id' => $fid] + $l);
            audit($p, $u['id'], 'Funds', 'fund ' . $fid, "fund request $verb", $ref . ' for ' . $t['trip_ref'] . ': PHP ' . $total);
            Notify::resolve($p, 'fund-revise-' . $fid . '-*');
            Notify::roles($p, ['operations_head'], 'Fund approval', "Fund request $ref (" . $t['trip_ref'] . ") for PHP " . number_format((float)$total, 2) . " is waiting for approval.", 'funds', Notify::key('fund-approve-' . $fid));
            return ['fund_id' => $fid, 'message' => "Fund request $ref $verb (PHP " . number_format((float)$total, 2) . '). Waiting for Operations Head approval.'];
        });
    }

    /** Operations Head approves or rejects (PDF #12 step 5). */
    private static function decide(array $u, array $d): array {
        requireRole($u, 'operations_head');
        $id = idField($d, 'fund_id');
        $decision = choiceField($d, 'decision', ['approve', 'reject']);
        $reason = $decision === 'reject' ? field($d, 'reason', 300) : null;
        return transaction(function (PDO $p) use ($u, $id, $decision, $reason) {
            $f = one($p, 'SELECT f.*, t.trip_ref, t.dispatcher_role, t.status AS trip_status FROM fund_requests f JOIN trips t ON t.id=f.trip_id WHERE f.id=? FOR UPDATE', [$id]);
            must((bool)$f, 'Fund request not found.', 404);
            must($f['status'] === 'Pending Approval', 'This request is ' . $f['status'] . ', not Pending Approval.', 409);
            Notify::resolve($p, 'fund-approve-' . $f['id'] . '-*');
            must(!in_array($f['trip_status'], ['Cancelled', 'Rejected', 'Completed'], true), 'The trip is ' . $f['trip_status'] . '.', 409);
            if ($decision === 'approve') {
                run($p, "UPDATE fund_requests SET status='Ready for Release', approved_by=?, approved_at=NOW() WHERE id=?", [$u['id'], $id]);
                audit($p, $u['id'], 'Funds', 'fund ' . $id, 'fund request approved', $f['fund_ref'] . ' -> Ready for Release');
                Notify::roles($p, ['finance'], 'Fund release', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') PHP ' . number_format((float)$f['amount'], 2) . ' is Ready for Release.', 'funds', 'fund-release-' . $f['id']);
                Notify::user($p, (int)$f['requested_by'], 'Fund approved', $f['fund_ref'] . ' was approved and is waiting for Finance release.', 'funds');
                return ['message' => 'Approved. The request is Ready for Release and now appears to Finance.'];
            }
            run($p, "UPDATE fund_requests SET status='Rejected', rejected_reason=? WHERE id=?", [$reason, $id]);
            audit($p, $u['id'], 'Funds', 'fund ' . $id, 'fund request rejected', $f['fund_ref'] . ': ' . $reason);
            Notify::user($p, (int)$f['requested_by'], 'Fund rejected', $f['fund_ref'] . ' was rejected: ' . $reason . '. Please revise and resubmit.', 'funds', Notify::key('fund-revise-' . $f['id']));
            return ['message' => 'Rejected. The dispatcher can revise and resubmit it.'];
        });
    }

    /** Finance Confirm Release (PDF #12 step 6). */
    private static function release(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'fund_id');
        $pay = Money::paymentFields($d);
        return transaction(function (PDO $p) use ($u, $id, $pay) {
            $f = one($p, 'SELECT f.*, t.trip_ref, t.status AS trip_status, t.vehicle_id, d.full_name AS driver_name FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                          LEFT JOIN personnel d ON d.id=t.driver_id WHERE f.id=? FOR UPDATE', [$id]);
            must((bool)$f, 'Fund request not found.', 404);
            must($f['status'] === 'Ready for Release', 'Only approved requests (Ready for Release) can be released. This one is ' . $f['status'] . '.', 409);
            must(!in_array($f['trip_status'], ['Cancelled', 'Rejected'], true), 'The trip is ' . $f['trip_status'] . '.', 409);
            $payee = $f['driver_name'] ?: 'Trip ' . $f['trip_ref'];
            $disb = Money::disburse($p, $u, 'fund_request', $id, $payee, $f['amount'], $pay);
            run($p, "UPDATE fund_requests SET status='Released', released_by=?, released_at=NOW(), disbursement_id=? WHERE id=?", [$u['id'], $disb, $id]);
            Money::expense($p, $u, 'Trip Allowance', $f['amount'], $pay['released_on'], 'Fund Release', $id, (int)$f['trip_id'], $f['vehicle_id'] ? (int)$f['vehicle_id'] : null, $payee, $f['fund_ref'], 'Trip fund ' . $f['trip_ref']);
            audit($p, $u['id'], 'Funds', 'fund ' . $id, 'fund released', $f['fund_ref'] . ' PHP ' . $f['amount'] . ' via ' . $pay['payment_method']);
            Notify::user($p, (int)$f['requested_by'], 'Fund released', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') is Released. Confirm Dispatch is enabled once the checklist is done.', 'trips');
            Notify::roles($p, ['operations_head'], 'Fund released', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') was released.', 'funds');
            Notify::resolve($p, 'fund-release-' . $f['id']);
            $v = one($p, 'SELECT voucher_number FROM disbursements WHERE id=?', [$disb])['voucher_number'];
            return ['message' => "Release confirmed (voucher $v). Fund status: Released."];
        });
    }

    /** Liquidation after the trip: actual amount spent and cash returned. */
    private static function liquidate(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'fund_id');
        $spent = moneyField($d, 'liquidated_amount', true);
        $notes = optField($d, 'liquidation_notes', 300);
        return transaction(function (PDO $p) use ($u, $id, $spent, $notes) {
            $f = one($p, 'SELECT f.*, t.trip_ref, t.status AS trip_status, t.vehicle_id FROM fund_requests f JOIN trips t ON t.id=f.trip_id WHERE f.id=? FOR UPDATE', [$id]);
            must((bool)$f, 'Fund request not found.', 404);
            must($f['status'] === 'Released', 'Only released funds are liquidated.', 409);
            must($f['liquidation_status'] === 'Not Liquidated', 'Already liquidated.', 409);
            must(in_array($f['trip_status'], ['Completed', 'Cancelled'], true), 'Liquidate after the trip is completed or cancelled.', 409);
            must((float)$spent <= (float)$f['amount'], 'Actual spent cannot be more than the released amount (PHP ' . $f['amount'] . ').');
            $returned = number_format((float)$f['amount'] - (float)$spent, 2, '.', '');
            Files::store($p, $u, 'receipts', 'fund', $id, 'Liquidation Receipt');
            run($p, "UPDATE fund_requests SET liquidation_status='Liquidated', liquidated_amount=?, returned_amount=?, liquidation_notes=?, liquidated_by=?, liquidated_at=NOW() WHERE id=?",
                [$spent, $returned, $notes, $u['id'], $id]);
            // Returned cash lowers the trip allowance expense (so expenses show what was really spent).
            if ((float)$returned > 0) Money::expense($p, $u, 'Trip Allowance', '-' . $returned, date('Y-m-d'), 'Liquidation', $id, (int)$f['trip_id'], $f['vehicle_id'] ? (int)$f['vehicle_id'] : null, null, $f['fund_ref'], 'Cash returned for ' . $f['trip_ref']);
            audit($p, $u['id'], 'Funds', 'fund ' . $id, 'fund liquidated', $f['fund_ref'] . ": spent $spent, returned $returned");
            return ['message' => "Liquidation recorded: spent PHP $spent, returned PHP $returned."];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'funds'), 'Not allowed.', 403);
        $id = idField($d, 'fund_id'); $p = db();
        $f = one($p, "SELECT f.*, t.trip_ref, t.dispatcher_role, t.pickup_point, t.delivery_point, t.scheduled_at, c.company_name AS client, v.plate_number,
                d1.full_name AS driver_name, ru.full_name AS requested_by_name, au.full_name AS approved_by_name, lu.full_name AS released_by_name,
                ds.voucher_number, ds.payment_method, ds.reference_number, ds.cheque_number, ds.released_on
            FROM fund_requests f JOIN trips t ON t.id=f.trip_id JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
            LEFT JOIN personnel d1 ON d1.id=t.driver_id JOIN users ru ON ru.id=f.requested_by LEFT JOIN users au ON au.id=f.approved_by
            LEFT JOIN users lu ON lu.id=f.released_by LEFT JOIN disbursements ds ON ds.id=f.disbursement_id WHERE f.id=?", [$id]);
        must((bool)$f, 'Fund request not found.', 404);
        if (roleIsDispatcher($u['role'])) must($f['dispatcher_role'] === $u['role'] || (int)$f['requested_by'] === $u['id'], 'Not allowed.', 403);
        $f['lines'] = many($p, 'SELECT category_name, amount, is_preset FROM fund_request_lines WHERE fund_request_id=? ORDER BY id', [$id]);
        $f['documents'] = Files::of($p, 'fund', $id);
        return ['fund' => $f];
    }
}
