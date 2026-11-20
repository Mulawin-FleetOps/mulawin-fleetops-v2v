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
core('Settings');
core('DispatcherScope');
core('DieselPo');

// CHECKLIST_40_FINANCE_WINDOW_V1: scheduling always uses Asia/Manila from bootstrap.php.
final class Funds {
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $scope = ''; $args = [];
        if (roleIsDispatcher($u['role'])) [$scope,$args]=DispatcherScope::tripSql($u);
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
                // Existing Diesel PO attachments only. No request approval/issuance workflow is implied.
                'fuelTrips' => fn() => many($p, "SELECT t.id, t.trip_ref, t.truck_type, t.status, t.dispatcher_role, v.plate_number,
                    (SELECT COUNT(*) FROM documents d WHERE d.entity_type='trip' AND d.entity_id=t.id AND d.category='Diesel PO') AS diesel_po_docs
                    FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id
                    WHERE 1=1 $scope AND (t.status NOT IN ('Pending Review','Rejected','Cancelled')
                        OR EXISTS (SELECT 1 FROM documents pd WHERE pd.entity_type='trip' AND pd.entity_id=t.id AND pd.category='Diesel PO')) ORDER BY t.id DESC LIMIT 1000", $args),
                'dieselDocuments' => fn() => many($p, "SELECT d.id,d.category,d.original_filename,d.mime_type,d.created_at,us.full_name AS uploader,t.id AS trip_id,t.trip_ref
                    FROM documents d JOIN trips t ON d.entity_type='trip' AND d.entity_id=t.id JOIN users us ON us.id=d.uploaded_by
                    WHERE d.category='Diesel PO' $scope ORDER BY d.id DESC LIMIT 2000", $args),
                'eligibleTrips' => fn() => many($p, "SELECT t.id, t.trip_ref, t.status, t.attempt_number, t.pickup_point, t.delivery_point, v.plate_number
                    FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id
                    WHERE 1=1 $scope AND t.status IN ('Pre-Assigned','Ready for Dispatch')
                      AND NOT EXISTS (SELECT 1 FROM fund_requests f WHERE f.trip_id=t.id AND f.attempt_number=t.attempt_number AND f.status<>'Rejected')
                    ORDER BY t.scheduled_at", $args),
            ]);
        }
        // Server-derived flags power the Finance UI; the release API rechecks time.
        $leadSeconds = (int)round(Settings::value('fund_release_lead_hours') * 3600);
        if (isset($data['funds']) && is_array($data['funds'])) foreach ($data['funds'] as &$fund) {
            $scheduled = strtotime((string)$fund['scheduled_at']);
            $opensAt = $scheduled === false ? null : $scheduled - $leadSeconds;
            $fund['release_opens_at'] = $opensAt === null ? null : date('Y-m-d H:i:s', $opensAt);
            $fund['release_allowed_now'] = $opensAt !== null
                && time() >= $opensAt && !in_array($fund['trip_status'], ['Cancelled', 'Rejected', 'Completed'], true);
        }
        unset($fund);
        if (DieselPo::ready($p) && is_array($data['funds'] ?? null)) {
            $poStates = [];
            foreach (many($p,'SELECT fund_request_id,id,po_number,status FROM diesel_purchase_orders') as $poRow)
                $poStates[(int)$poRow['fund_request_id']] = $poRow;
            foreach ($data['funds'] as &$fund)
                $fund['diesel_po_record'] = $poStates[(int)$fund['id']] ?? null;
            unset($fund);
        }
        if (hasRole($u, 'finance', 'operations_head')) {
            $budget = one($p, "SELECT amount, reserved_amount, spent_amount, period_start, period_end,
                amount-reserved_amount-spent_amount AS available,
                (CURRENT_DATE() BETWEEN period_start AND period_end) AS in_period
                FROM budgets WHERE category='Trip Operations' AND status='Active' ORDER BY id DESC LIMIT 1");
            $data['tripBudget'] = $budget ?? [];
        }
        $data['releaseLeadHours'] = Settings::value('fund_release_lead_hours');
        $data['categories'] = many($p, 'SELECT name, amount FROM fund_categories WHERE active=1 ORDER BY sort_order, name');
        $data['methods'] = ['Cash'];   // #36: trip fund release is cash only (shared Money::METHODS unchanged)
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
            'diesel_price' => self::dieselPrice($u),
            'diesel_decide' => DieselPo::decide($u,$d),
            'diesel_revise' => DieselPo::revise($u,$d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    /**
     * Builds request lines using active preset categories and the amounts entered
     * for this request, without changing the configured category defaults.
     */
    private static function lines(PDO $p, array $d): array {
        $presets = array_column(many($p, 'SELECT name, amount FROM fund_categories WHERE active=1'), 'amount', 'name');
        $requestedAmounts = $d['preset_amounts'] ?? [];
        must(is_array($requestedAmounts), 'Invalid preset expense amounts.');
        $selected = $d['categories'] ?? [];
        must(is_array($selected), 'Invalid fund categories.');
        $lines = [];
        foreach ($selected as $name) {
            must(is_string($name) && array_key_exists($name, $presets), 'Unknown fund category: ' . (is_string($name) ? $name : '?'));
            must(!isset($lines[$name]), 'Duplicate fund category: ' . $name);
            $requested = array_key_exists($name, $requestedAmounts) ? $requestedAmounts[$name] : $presets[$name];
            must(is_string($requested) || is_numeric($requested), 'Invalid preset expense amount.');
            $amount = moneyField(['amount' => (string)$requested], 'amount');
            must((float)$amount > 0, 'Preset expense amounts must be greater than zero.');
            $lines[$name] = ['category_name' => $name, 'amount' => $amount, 'is_preset' => 1];
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

    /** Active company-wide diesel price, never a browser-supplied rate. */
    private static function dieselPrice(array $u): array {
        must(roleIsDispatcher($u['role']), 'Only dispatchers can request a Diesel PO price.', 403);
        $p = db();
        core('TripPricing');
        must(TripPricing::ready($p), 'Fuel configuration is not installed.', 409);
        $row = Settings::pricingAt($p, 'diesel', date('Y-m-d H:i:s'));
        must((bool)$row, 'No effective diesel price is configured. Ask Head Management to set one.', 409);
        $value = json_decode((string)$row['value_json'], true, 512, JSON_THROW_ON_ERROR);
        must(is_numeric($value['value'] ?? null) && (float)$value['value'] > 0, 'Configured diesel price is invalid.', 409);
        return ['unit_price' => number_format((float)$value['value'], 2, '.', ''),
            'price_setting_id' => (int)$row['id'], 'effective_date' => $row['effective_date']];
    }

    /** Serialized within the named DB lock held by submit(); no schema change required. */
    private static function nextDieselPoNumber(PDO $p): string {
        $row = one($p, "SELECT COALESCE(MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(diesel_po_json, '$.po_number')) AS UNSIGNED)), 0) AS last_number
            FROM fund_requests
            WHERE diesel_po_json IS NOT NULL
              AND JSON_UNQUOTE(JSON_EXTRACT(diesel_po_json, '$.po_number')) REGEXP '^[0-9]{4}$'");
        $next = (int)($row['last_number'] ?? 0) + 1;
        must($next <= 9999, 'Four-digit Diesel PO numbers have been exhausted. Contact an administrator.', 409);
        return str_pad((string)$next, 4, '0', STR_PAD_LEFT);
    }

    /** A single confirmed liters quantity; PO metadata and pricing are server owned. */
    private static function dieselPo(PDO $p, array $d, array $trip, ?array $previous): ?array {
        if (!array_key_exists('diesel_po', $d)) return null;
        $input = $d['diesel_po'];
        must(is_array($input), 'Invalid Diesel PO data.');
        if ($previous && count($previous['lines'] ?? []) > 1) {
            // Never collapse previously saved multi-line orders during a fund revision.
            return $previous;
        }
        $liters = trim((string)($input['liters'] ?? $input['lines'][0]['liters'] ?? ''));
        must((bool)preg_match('/^\\d{1,6}(?:\\.\\d{1,3})?$/', $liters) && (float)$liters > 0,
            'Enter a positive number of liters with up to three decimal places.');
        if ($previous) {
            $number = (string)$previous['po_number'];
            $date = (string)$previous['po_date'];
            $vehicle = (string)$previous['vehicle'];
            $plate = (string)$previous['plate_number'];
            $price = (string)$previous['lines'][0]['unit_price'];
        } else {
            $number = self::nextDieselPoNumber($p);
            $date = date('Y-m-d'); // bootstrap timezone is Asia/Manila
            $vehicle = trim((string)$trip['truck_type']);
            $plateRow = one($p, 'SELECT plate_number FROM vehicles WHERE id=?', [$trip['vehicle_id']]);
            $plate = trim((string)($plateRow['plate_number'] ?? ''));
            must($vehicle !== '' && $plate !== '', 'Assign a truck before including a Diesel PO.', 409);
            core('TripPricing');
            must(TripPricing::ready($p), 'Fuel configuration is not installed.', 409);
            $source = Settings::pricingAt($p, 'diesel', date('Y-m-d H:i:s'));
            must((bool)$source, 'No effective diesel price is configured.', 409);
            $configured = json_decode((string)$source['value_json'], true, 512, JSON_THROW_ON_ERROR);
            must(is_numeric($configured['value'] ?? null) && (float)$configured['value'] > 0,
                'Configured diesel price is invalid.', 409);
            must((int)($input['price_setting_id'] ?? 0) === (int)$source['id'],
                'Diesel pricing changed. Reopen the request to confirm the latest price.', 409);
            $price = number_format((float)$configured['value'], 2, '.', '');
        }
        must((bool)preg_match('/^\\d{1,7}(?:\\.\\d{1,2})?$/', $price) && (float)$price > 0, 'Diesel price is invalid.', 409);
        $amount = round((float)$liters * (float)$price, 2);
        must($amount > 0 && $amount <= 999999999999.99, 'Diesel PO total is out of range.');
        $total = number_format($amount, 2, '.', '');
        return ['po_number' => $number, 'po_date' => $date, 'vehicle' => $vehicle, 'plate_number' => $plate,
            'lines' => [['liters' => $liters, 'unit_price' => $price, 'total' => $total]],
            'total_amount' => $total];
    }

    /** Dispatcher submits (or revises a rejected) fund request. */
    private static function submit(array $u, array $d): array {
        must(roleIsDispatcher($u['role']), 'Only dispatchers submit trip fund requests.', 403);
        $tripId = idField($d, 'trip_id');
        $notes = optField($d, 'notes', 255);
        $p = db();
        // All PO submissions use one named lock, held until AFTER commit, to prevent duplicate numbers.
        $poRequested = array_key_exists('diesel_po', $d);
        if ($poRequested) {
            $lock = one($p, "SELECT GET_LOCK('mulawin_diesel_po_number_v1', 10) AS acquired");
            must((int)($lock['acquired'] ?? 0) === 1, 'Diesel PO numbering is busy. Retry submission.', 409);
        }
        try {
        return transaction(function (PDO $p) use ($u, $d, $tripId, $notes) {
            $t = one($p, 'SELECT * FROM trips WHERE id=? FOR UPDATE', [$tripId]);
            must((bool)$t, 'Trip not found.', 404);
            $t['responsible_dispatcher_id']=one($p,'SELECT current_dispatcher_id FROM trip_responsibilities WHERE trip_id=?',[$tripId])['current_dispatcher_id']??null;
            must(DispatcherScope::permitsTrip($u,$t), 'This trip belongs to the other dispatcher team.', 403);
            must(in_array($t['status'], ['Pre-Assigned', 'Ready for Dispatch'], true), 'A fund request is made for a Pre-Assigned trip that has not left yet (trip is ' . $t['status'] . ').', 409);
            $lines = self::lines($p, $d);
            $total = number_format(array_sum(array_map(fn($l) => (float)$l['amount'], $lines)), 2, '.', '');
            $old = one($p, 'SELECT * FROM fund_requests WHERE trip_id=? AND attempt_number=? FOR UPDATE', [$tripId, $t['attempt_number']]);
            $previousPo = $old && !empty($old['diesel_po_json'])
                ? json_decode((string)$old['diesel_po_json'], true, 512, JSON_THROW_ON_ERROR) : null;
            $po = self::dieselPo($p, $d, $t, $previousPo);
            if ($po !== null && $previousPo === null)
                must(DieselPo::ready($p),'Diesel PO workflow migration is pending. Cash fund requests without PO remain available.',409);
            if ($po !== null && $previousPo !== null && DieselPo::ready($p)) {
                $tracked = DieselPo::byFund($p,(int)$old['id']);
                if ($tracked)
                    must($po === $previousPo,'Diesel PO details are maintained separately. Use the Diesel PO revision action, not cash fund revision.',409);
            }
            $oldBreakdown = $old ? many($p, 'SELECT category_name, amount FROM fund_request_lines WHERE fund_request_id=? ORDER BY id', [$old['id']]) : [];
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
            if ($po !== null) {
                run($p, 'UPDATE fund_requests SET diesel_po_json=? WHERE id=?', [json_encode($po, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $fid]);
                if (DieselPo::ready($p)) DieselPo::sync($p,$fid,$tripId,$po,$previousPo !== null,(int)$u['id']);
            }
            if ($old) {
                auditWithChanges($p, $u['id'], 'Funds', 'fund ' . $fid, 'fund request resubmitted', $ref . ' for ' . $t['trip_ref'] . ': PHP ' . $total,
                    ['Requested amount' => $old['amount'], 'Notes' => $old['notes'], 'Expense breakdown' => implode('; ', array_map(fn($x) => $x['category_name'] . ': ' . $x['amount'], $oldBreakdown))],
                    ['Requested amount' => $total, 'Notes' => $notes, 'Expense breakdown' => implode('; ', array_map(fn($x) => $x['category_name'] . ': ' . $x['amount'], $lines))]);
            } else {
                audit($p, $u['id'], 'Funds', 'fund ' . $fid, "fund request $verb", $ref . ' for ' . $t['trip_ref'] . ': PHP ' . $total);
            }
            Notify::resolve($p, 'fund-revise-' . $fid . '-*');
            Notify::roles($p, ['operations_head'], 'Fund approval', "Fund request $ref (" . $t['trip_ref'] . ") for PHP " . number_format((float)$total, 2) . " is waiting for approval.", 'funds', Notify::key('fund-approve-' . $fid));
            return ['fund_id' => $fid, 'message' => "Fund request $ref $verb (PHP " . number_format((float)$total, 2) . '). Waiting for Operations Head approval.'];
        }, $p);
        } finally {
            if ($poRequested) one($p, "SELECT RELEASE_LOCK('mulawin_diesel_po_number_v1') AS released");
        }
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
            must(!in_array($f['trip_status'], ['Cancelled', 'Rejected', 'Completed'], true), 'The trip is ' . $f['trip_status'] . '.', 409);
            if ($decision === 'approve') {
                $budget = one($p, "SELECT * FROM budgets WHERE category='Trip Operations' AND status='Active' AND CURRENT_DATE() BETWEEN period_start AND period_end ORDER BY id DESC LIMIT 1 FOR UPDATE");
                $available = $budget ? round((float)$budget['amount'] - (float)$budget['reserved_amount'] - (float)$budget['spent_amount'], 2) : 0.0;
                if (!$budget || $available < (float)$f['amount']) {
                    // Retain the request for Head review; no funds are reserved and no approval is recorded.
                    return ['warning'=>'Awaiting Budget: Trip Operations has ' . ($budget ? 'PHP '.number_format($available,2).' available' : 'no active budget') .
                        ' for this PHP '.number_format((float)$f['amount'],2).' request. Finance must allocate funds before approval can be completed.'];
                }
                run($p, 'UPDATE budgets SET reserved_amount=reserved_amount+? WHERE id=?', [$f['amount'], $budget['id']]);
                Notify::resolve($p, 'fund-approve-' . $f['id'] . '-*');
                run($p, "UPDATE fund_requests SET status='Ready for Release', approved_by=?, approved_at=NOW() WHERE id=?", [$u['id'], $id]);
                auditWithChanges($p, $u['id'], 'Funds', 'fund ' . $id, 'fund request approved', $f['fund_ref'] . ' -> Ready for Release',
                    ['Status' => $f['status']], ['Status' => 'Ready for Release']);
                Notify::roles($p, ['finance'], 'Fund release', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') PHP ' . number_format((float)$f['amount'], 2) . ' is Ready for Release.', 'funds', 'fund-release-' . $f['id']);
                Notify::user($p, (int)$f['requested_by'], 'Fund approved', $f['fund_ref'] . ' was approved and is waiting for Finance release.', 'funds');
                return ['message' => 'Fund request approved. It is now ready for release by Finance.'];
            }
            Notify::resolve($p, 'fund-approve-' . $f['id'] . '-*');
            run($p, "UPDATE fund_requests SET status='Rejected', rejected_reason=? WHERE id=?", [$reason, $id]);
            auditWithChanges($p, $u['id'], 'Funds', 'fund ' . $id, 'fund request rejected', $f['fund_ref'] . ': ' . $reason,
                ['Status' => $f['status'], 'Rejection reason' => $f['rejected_reason']],
                ['Status' => 'Rejected', 'Rejection reason' => $reason]);
            Notify::user($p, (int)$f['requested_by'], 'Fund rejected', $f['fund_ref'] . ' was rejected: ' . $reason . '. Please revise and resubmit.', 'funds', Notify::key('fund-revise-' . $f['id']));
            return ['message' => 'Fund request rejected. The dispatcher may revise and resubmit the request.'];
        });
    }

    /** Finance Confirm Release (PDF #12 step 6). */
    private static function release(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'fund_id');
        $pay = self::cashReleaseFields($d);
        return transaction(function (PDO $p) use ($u, $id, $pay) {
            $f = one($p, 'SELECT f.*, t.trip_ref, t.status AS trip_status, t.scheduled_at, t.vehicle_id, d.full_name AS driver_name FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                          LEFT JOIN personnel d ON d.id=t.driver_id WHERE f.id=? FOR UPDATE', [$id]);
            must((bool)$f, 'Fund request not found.', 404);
            must($f['status'] === 'Ready for Release', 'Only approved requests (Ready for Release) can be released. This one is ' . $f['status'] . '.', 409);
            must(!in_array($f['trip_status'], ['Cancelled', 'Rejected', 'Completed'], true), 'The trip is ' . $f['trip_status'] . '.', 409);
            // Re-evaluate under the row lock. Browser UI and submitted payment dates are not trusted.
            $scheduled = strtotime((string)$f['scheduled_at']);
            must($scheduled !== false, 'Invalid trip dispatch schedule.', 409);
            $leadHours = Settings::value('fund_release_lead_hours');
            $opensAt = $scheduled - (int)round($leadHours * 3600);
            must(time() >= $opensAt, 'Too early to release the fund. Finance may release ' .
                $leadHours . ' hour(s) before dispatch (' . date('M j, Y g:i A', $opensAt) .
                ' Philippine time).', 409);
            $budget = one($p, "SELECT * FROM budgets WHERE category='Trip Operations' AND status='Active' AND CURRENT_DATE() BETWEEN period_start AND period_end ORDER BY id DESC LIMIT 1 FOR UPDATE");
            must((bool)$budget, 'Trip Operations budget is not active for today. Finance must set a valid budget before releasing funds.', 409);
            must(round((float)$budget['reserved_amount'], 2) >= round((float)$f['amount'], 2),
                'This approved fund has no sufficient Trip Operations budget reservation. Finance must renew the budget to carry outstanding approved requests.', 409);
            $payee = $f['driver_name'] ?: 'Trip ' . $f['trip_ref'];
            $pay['released_on'] = date('Y-m-d');   // actual server date at release time (after any lock wait)
            $disb = Money::disburse($p, $u, 'fund_request', $id, $payee, $f['amount'], $pay);
            run($p, "UPDATE fund_requests SET status='Released', released_by=?, released_at=NOW(), disbursement_id=? WHERE id=?", [$u['id'], $disb, $id]);
            run($p, "UPDATE budgets SET reserved_amount=reserved_amount-?, spent_amount=spent_amount+? WHERE id=?", [$f['amount'], $f['amount'], $budget['id']]);
            Money::expense($p, $u, 'Trip Allowance', $f['amount'], $pay['released_on'], 'Fund Release', $id, (int)$f['trip_id'], $f['vehicle_id'] ? (int)$f['vehicle_id'] : null, $payee, $f['fund_ref'], 'Trip fund ' . $f['trip_ref']);
            auditWithChanges($p, $u['id'], 'Funds', 'fund ' . $id, 'fund released', $f['fund_ref'] . ' PHP ' . $f['amount'] . ' via ' . $pay['payment_method'],
                ['Status' => $f['status'], 'Amount released' => null],
                ['Status' => 'Released', 'Amount released' => $f['amount']]);
            Notify::user($p, (int)$f['requested_by'], 'Fund released', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') is Released. Confirm Dispatch is enabled once the checklist is done.', 'trips');
            Notify::roles($p, ['operations_head'], 'Fund released', $f['fund_ref'] . ' (' . $f['trip_ref'] . ') was released.', 'funds');
            Notify::resolve($p, 'fund-release-' . $f['id']);
            $v = one($p, 'SELECT voucher_number FROM disbursements WHERE id=?', [$disb])['voucher_number'];
            return ['message' => "Funds released successfully under voucher $v."];
        });
    }

    /**
     * CHECKLIST_36_CASH_ONLY_TRIP_FUND_RELEASE_V1 — trip funds are released in cash only, dated by the server.
     *   - payment method: Cash (anything else sent by a browser or API call is refused);
     *   - release date: today's server date (Philippine time); a date sent by the caller is refused unless it IS today
     *     (it is never used), so the release cannot be backdated or post-dated;
     *   - cheque number / bank / reference fields do not apply to cash and are refused when filled in.
     *   Shared payment methods (Money::METHODS / paymentFields) used by Billing, Finance payments and Purchasing are unchanged.
     */
    private static function cashReleaseFields(array $d): array {
        $method = $d['payment_method'] ?? null;
        must($method === null || $method === '' || $method === 'Cash', 'Trip funds are released in cash only.');
        $date = $d['released_on'] ?? null;
        $today = date('Y-m-d');
        must($date === null || $date === '' || $date === $today, 'The release date is recorded automatically (today, ' . $today . '). It cannot be changed.');
        foreach (['cheque_number' => 'Cheque number', 'bank_name' => 'Bank name', 'reference_number' => 'Reference number'] as $k => $label)
            must(!isset($d[$k]) || (is_string($d[$k]) && trim($d[$k]) === ''), $label . ' does not apply: trip funds are released in cash only.');
        return ['payment_method' => 'Cash', 'released_on' => $today, 'reference_number' => null, 'cheque_number' => null, 'bank_name' => null];
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
            auditWithChanges($p, $u['id'], 'Funds', 'fund ' . $id, 'fund liquidated', $f['fund_ref'] . ": spent $spent, returned $returned",
                ['Liquidation status' => $f['liquidation_status'], 'Amount spent' => $f['liquidated_amount'], 'Cash returned' => $f['returned_amount']],
                ['Liquidation status' => 'Liquidated', 'Amount spent' => $spent, 'Cash returned' => $returned]);
            return ['message' => "Liquidation recorded: spent PHP $spent, returned PHP $returned."];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'funds'), 'Not allowed.', 403);
        $id = idField($d, 'fund_id'); $p = db();
        $f = one($p, "SELECT f.*, t.trip_ref, t.status AS trip_status, (SELECT r.current_dispatcher_id FROM trip_responsibilities r WHERE r.trip_id=t.id) AS responsible_dispatcher_id,t.dispatcher_role,t.dispatcher_shift,t.truck_type, t.pickup_point, t.delivery_point, t.scheduled_at, c.company_name AS client, v.plate_number,
                d1.full_name AS driver_name, ru.full_name AS requested_by_name, au.full_name AS approved_by_name, lu.full_name AS released_by_name,
                ds.voucher_number, ds.payment_method, ds.reference_number, ds.cheque_number, ds.released_on
            FROM fund_requests f JOIN trips t ON t.id=f.trip_id JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
            LEFT JOIN personnel d1 ON d1.id=t.driver_id JOIN users ru ON ru.id=f.requested_by LEFT JOIN users au ON au.id=f.approved_by
            LEFT JOIN users lu ON lu.id=f.released_by LEFT JOIN disbursements ds ON ds.id=f.disbursement_id WHERE f.id=?", [$id]);
        must((bool)$f, 'Fund request not found.', 404);
        if (roleIsDispatcher($u['role'])) must(DispatcherScope::permitsTrip($u,$f), 'Not allowed.', 403);
        $f['lines'] = many($p, 'SELECT category_name, amount, is_preset FROM fund_request_lines WHERE fund_request_id=? ORDER BY id', [$id]);
        $f['documents'] = Files::of($p, 'fund', $id);
        $f['diesel_po'] = $f['diesel_po_json'] ? json_decode((string)$f['diesel_po_json'], true) : null;
        $f['diesel_po_record'] = DieselPo::byFund($p,$id);
        $f['diesel_po_legacy'] = (bool)$f['diesel_po'] && !$f['diesel_po_record'];
        if ($u['role'] === 'operations_head') {
            $f['history'] = many($p, "SELECT a.action, a.created_at, u.full_name AS actor FROM audit_events a
                LEFT JOIN users u ON u.id=a.actor_id WHERE a.area='Funds' AND a.record_ref=? ORDER BY a.id", ['fund ' . $id]);
        }
        return ['fund' => $f];
    }
}
