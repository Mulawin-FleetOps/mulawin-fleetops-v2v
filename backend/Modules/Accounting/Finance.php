<?php
/*
 * =====================================================================
 *  backend/Modules/Accounting/Finance.php  —  FINANCE (payables and cash out)
 * =====================================================================
 *  Objective 3.5  purchase order payments, accounts payable, disbursements and
 *                 other operating expenses (trip fund release is in Funds.php)
 *  Objective 3.6  purchasing budget (available, reserved, actual payments) and
 *                 financial transactions with supporting documents and statuses
 *
 *  PDF #12 Maintenance Module B steps 6, 8, 9:
 *   - an approved PO appears here with its amount, approver and "Pending Payment"
 *   - before payment Finance checks the supplier invoice against the approved PO
 *     and the received items; uploads the official receipt / payment confirmation
 *   - payment -> Paid; only now is cash reduced; the budget is NOT reduced again
 *     (it was reserved at approval: reserved -> spent)
 * =====================================================================
 */
declare(strict_types=1);
core('Notify');
core('Files');
core('Money');
core('DieselPo');

final class Finance {
    public const EXPENSE_CATEGORIES = ['Fuel', 'RFID / Toll', 'Trip Allowance', 'Maintenance', 'Parts', 'Office', 'Utilities', 'Salaries', 'Other'];

    /** Parent PO/payable is locked before checking this transactionally saved receipt. */
    private static function paymentRequest(array $d, string $record, array $values): array {
        $key = strtolower(field($d, 'request_key', 36));
        must((bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $key), 'Reload the payment form before recording a payment.');
        return [$record, 'payment request ' . $key, hash('sha256', json_encode($values, JSON_THROW_ON_ERROR))];
    }

    private static function paymentReplay(PDO $p, array $request): bool {
        [$record,$action,$fingerprint] = $request;
        $old = one($p, "SELECT details FROM audit_events WHERE area='Finance' AND record_ref=? AND action=? ORDER BY id LIMIT 1", [$record,$action]);
        if (!$old) return false;
        must(hash_equals($old['details'],$fingerprint), 'This payment request was already used with different details. Reload the record before making another payment.', 409);
        return true;
    }

    private static function paymentReceipt(PDO $p, array $u, array $request): void {
        audit($p,$u['id'],'Finance',$request[0],$request[1],$request[2]);
    }

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $from = (string)($q['from'] ?? date('Y-m-01')); $to = (string)($q['to'] ?? date('Y-m-d'));
        if (!DateTimeImmutable::createFromFormat('!Y-m-d', $from)) $from = date('Y-m-01');
        if (!DateTimeImmutable::createFromFormat('!Y-m-d', $to)) $to = date('Y-m-d');
        if ($to < $from) [$from, $to] = [$to, $from];
        // FINANCE_WORKSPACE_V1: one page per Finance task. Each page returns only the sections it shows.
        if ($page === 'finance_overview') return self::overview($u, $p);
        $sections = self::sections($p, $from, $to);
        // Admin's Financial Overview renders payables AND budget/expense/cashflow
        // tabs on the same page. Finance personnel use the narrower task pages.
        $keys = $page === 'finance' && hasRole($u, 'admin')
            ? ['poPayables', 'fuelCommitments', 'fuelBudget', 'payables', 'disbursements', 'suppliers', 'trucks',
               'expenses', 'budgets', 'cashflow', 'expenseMix', 'generalBudget', 'budgetRequests']
            : ($page === 'finance_budgets'
                ? ['expenses', 'budgets', 'tripFunds', 'tripOperationsBudget', 'fuelBudget', 'fuelCommitments', 'cashflow', 'trucks', 'expenseMix', 'generalBudget', 'budgetRequests']
                : ['poPayables', 'fuelCommitments', 'fuelBudget', 'payables', 'disbursements', 'suppliers', 'trucks']);
        $data = readSections(array_intersect_key($sections, array_flip($keys)));
        $data['period'] = ['from' => $from, 'to' => $to];
        $data['categories'] = self::EXPENSE_CATEGORIES;
        $data['methods'] = Money::METHODS;
        $data['can'] = ['act' => hasRole($u, 'finance')];
        return $data;
    }

    /** All Finance read sections (lazy). Pages pick the ones they show. */
    private static function sections(PDO $p, string $from, string $to): array {
        return [
            'fuelCommitments' => fn() => DieselPo::ready($p) ? many($p, "SELECT po.id, po.po_number, po.status, po.trip_id, t.trip_ref,
                    CAST(JSON_UNQUOTE(JSON_EXTRACT(f.diesel_po_json,'$.total_amount')) AS DECIMAL(14,2)) AS amount,
                    po.approved_at, po.verified_at,
                    (SELECT COUNT(*) FROM documents d WHERE d.entity_type='trip' AND d.entity_id=po.trip_id AND d.category='Supplier SOA') AS soa_documents
                FROM diesel_purchase_orders po JOIN fund_requests f ON f.id=po.fund_request_id
                JOIN trips t ON t.id=po.trip_id
                WHERE po.status IN ('Awaiting SOA','SOA Received','Verified','Discrepancy')
                ORDER BY po.id DESC") : [],
            'fuelBudget' => fn() => one($p, "SELECT id,amount,reserved_amount,spent_amount,period_start,period_end,
                    amount-reserved_amount-spent_amount AS available,
                    (CURRENT_DATE() BETWEEN period_start AND period_end) AS in_period
                    FROM budgets WHERE category=(CASE WHEN EXISTS(SELECT 1 FROM budgets gb WHERE gb.category='General' AND gb.status='Active') THEN 'General' ELSE 'Fuel Operations' END) AND status='Active' ORDER BY id DESC LIMIT 1") ?? [],
            'poPayables' => fn() => many($p, "SELECT o.id, o.po_ref, o.status, o.payment_status, o.total_amount, o.paid_amount, o.supplier_invoice_no, COALESCE(o.supplier_name, s.name) AS supplier, du.full_name AS approved_by_name,
                    (SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) AS received_value
                FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id LEFT JOIN users du ON du.id=o.decided_by
                WHERE o.payment_status IN ('Pending Payment','Partially Paid') ORDER BY o.id"),
            'payables' => fn() => many($p, "SELECT pa.id, pa.payable_ref, pa.payee, pa.category, pa.description, pa.due_on, pa.amount, pa.paid_amount, pa.status, (pa.amount-pa.paid_amount) AS balance, v.plate_number, s.name AS supplier FROM payables pa
                LEFT JOIN vehicles v ON v.id=pa.vehicle_id LEFT JOIN suppliers s ON s.id=pa.supplier_id ORDER BY FIELD(pa.status,'Unpaid','Partially Paid','Paid'), pa.due_on, pa.id DESC"),
            'expenses' => fn() => many($p, "SELECT e.id, e.category, e.amount, e.incurred_on, e.payee, e.reference_number, e.description, e.source, t.trip_ref, v.plate_number, u.full_name AS recorded_by_name FROM expenses e LEFT JOIN trips t ON t.id=e.trip_id
                LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN users u ON u.id=e.recorded_by WHERE e.incurred_on BETWEEN ? AND ? ORDER BY e.incurred_on DESC, e.id DESC", [$from, $to]),
            'disbursements' => fn() => many($p, "SELECT d.id, d.voucher_number, d.source_type, d.source_id, d.payee, d.payment_method, d.cheque_number, d.bank_name, d.reference_number, d.amount, d.released_on, u.full_name AS recorded_by_name,
                    CASE d.source_type WHEN 'purchase_order' THEN (SELECT po_ref FROM purchase_orders WHERE id=d.source_id) WHEN 'fund_request' THEN (SELECT fund_ref FROM fund_requests WHERE id=d.source_id)
                        WHEN 'payable' THEN (SELECT payable_ref FROM payables WHERE id=d.source_id) END AS source_ref
                FROM disbursements d JOIN users u ON u.id=d.recorded_by
                WHERE d.released_on BETWEEN ? AND ? ORDER BY d.released_on DESC, d.id DESC", [$from, $to]),
            'tripFunds' => fn() => many($p, "SELECT f.id, f.fund_ref, f.amount, f.status, f.liquidation_status, f.created_at, f.released_at, t.trip_ref, t.scheduled_at, u.full_name AS requested_by_name
                FROM fund_requests f JOIN trips t ON t.id=f.trip_id JOIN users u ON u.id=f.requested_by
                ORDER BY f.id DESC LIMIT 500"),
            'tripOperationsBudget' => fn() => one($p, "SELECT id, amount, reserved_amount, spent_amount, period_start, period_end, amount-reserved_amount-spent_amount AS available, (CURRENT_DATE() BETWEEN period_start AND period_end) AS in_period FROM budgets WHERE status='Active' AND category=(CASE WHEN EXISTS(SELECT 1 FROM budgets gb WHERE gb.category='General' AND gb.status='Active') THEN 'General' ELSE 'Trip Operations' END) ORDER BY id DESC LIMIT 1") ?? [],
            'budgets' => fn() => many($p, "SELECT b.id, b.category, b.created_at, b.period_start, b.period_end, b.amount, b.reserved_amount, b.spent_amount, b.status, (b.amount-b.reserved_amount-b.spent_amount) AS available, u.full_name AS set_by_name FROM budgets b JOIN users u ON u.id=b.set_by ORDER BY b.id DESC"),
            'generalBudget' => fn() => one($p, "SELECT b.*, (b.amount-b.reserved_amount-b.spent_amount) AS available, (CURRENT_DATE() BETWEEN b.period_start AND b.period_end) AS in_period
                  FROM budgets b WHERE b.category='General' AND b.status='Active' ORDER BY b.id DESC LIMIT 1") ?? [],
            'budgetRequests' => fn() => self::budgetRequestsReady($p) ? many($p, "SELECT r.*, su.full_name AS submitted_by_name, du.full_name AS decided_by_name
                  FROM general_budget_requests r JOIN users su ON su.id=r.submitted_by LEFT JOIN users du ON du.id=r.decided_by ORDER BY r.id DESC LIMIT 1000") : [],
            'cashflow' => fn() => many($p, "SELECT m, SUM(cash_in) AS cash_in, SUM(cash_out) AS cash_out FROM (
                    SELECT DATE_FORMAT(payment_date,'%Y-%m') AS m, amount AS cash_in, 0 AS cash_out FROM collections WHERE payment_date>=DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
                    UNION ALL SELECT DATE_FORMAT(released_on,'%Y-%m'), 0, amount FROM disbursements WHERE released_on>=DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
                    UNION ALL SELECT DATE_FORMAT(liquidated_at,'%Y-%m'), returned_amount, 0 FROM fund_requests
                        WHERE liquidation_status='Liquidated' AND returned_amount>0 AND liquidated_at>=DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)) x GROUP BY m ORDER BY m"),
            'suppliers' => fn() => many($p, 'SELECT id, name FROM suppliers WHERE active=1 ORDER BY name'),
            'trucks' => fn() => many($p, 'SELECT id, plate_number FROM vehicles ORDER BY plate_number'),
            // Expenses of the period per category and source (descriptive; same rows as the expense list).
            'expenseMix' => fn() => many($p, "SELECT category, source, COUNT(*) AS n, SUM(amount) AS total FROM expenses WHERE incurred_on BETWEEN ? AND ?
                GROUP BY category, source ORDER BY total DESC", [$from, $to]),
        ];
    }

    /**
     * FINANCE_WORKSPACE_V1 — Finance Overview (read only): what is waiting for Finance now.
     * Every figure is a direct sum/count over stored records; definitions are shown on the page.
     */
    private static function overview(array $u, PDO $p): array {
        $month = date('Y-m-01'); $today = date('Y-m-d');
        $poDue = "(SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) - o.paid_amount";
        $data = readSections([
            'counts' => fn() => [
                'po_approvals' => (int)one($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status='Pending Approval' AND approver_role='finance'")['n'],
                'funds_ready' => one($p, "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM fund_requests WHERE status='Ready for Release'"),
                'funds_to_liquidate' => (int)one($p, "SELECT COUNT(*) AS n FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                    WHERE f.status='Released' AND f.liquidation_status='Not Liquidated' AND t.status IN ('Completed','Cancelled')")['n'],
                'po_due' => one($p, "SELECT COUNT(*) AS n, COALESCE(SUM(GREATEST($poDue,0)),0) AS total FROM purchase_orders o
                    WHERE o.payment_status IN ('Pending Payment','Partially Paid') AND $poDue > 0"),
                'ap_due' => one($p, "SELECT COUNT(*) AS n, COALESCE(SUM(amount-paid_amount),0) AS total, COALESCE(SUM(due_on < ?),0) AS overdue
                    FROM payables WHERE status<>'Paid'", [$today]),
                'expenses_month' => (float)one($p, 'SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE incurred_on >= ?', [$month])['v'],
                'cash_out_month' => (float)one($p, 'SELECT COALESCE(SUM(amount),0) AS v FROM disbursements WHERE released_on >= ?', [$month])['v'],
            ],
            'approvals' => fn() => many($p, "SELECT o.id, o.po_ref, o.total_amount, o.created_at, COALESCE(o.supplier_name, s.name) AS supplier FROM purchase_orders o
                LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.status='Pending Approval' AND o.approver_role='finance' ORDER BY o.id LIMIT 25"),
            'fundsReady' => fn() => many($p, "SELECT f.id, f.fund_ref, f.amount, t.trip_ref, t.scheduled_at, c.company_name AS client FROM fund_requests f
                JOIN trips t ON t.id=f.trip_id JOIN clients c ON c.id=t.client_id WHERE f.status='Ready for Release' ORDER BY t.scheduled_at LIMIT 25"),
            'paymentsDue' => fn() => many($p, "(SELECT 'po' AS kind, o.id, o.po_ref AS ref, COALESCE(o.supplier_name, s.name) AS payee, GREATEST($poDue,0) AS due, NULL AS due_on, o.payment_status AS status
                    FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.payment_status IN ('Pending Payment','Partially Paid') AND $poDue > 0)
                UNION ALL (SELECT 'payable', pa.id, pa.payable_ref, pa.payee, pa.amount-pa.paid_amount, pa.due_on, pa.status FROM payables pa WHERE pa.status<>'Paid')
                ORDER BY (due_on IS NULL), due_on, ref LIMIT 25"),
            'budget' => fn() => one($p, "SELECT id, amount, reserved_amount, spent_amount, period_start, period_end, amount-reserved_amount-spent_amount AS available,
                    (CURRENT_DATE() BETWEEN period_start AND period_end) AS in_period FROM budgets WHERE status='Active' AND category=(CASE WHEN EXISTS(SELECT 1 FROM budgets gb WHERE gb.category='General' AND gb.status='Active') THEN 'General' ELSE 'Purchasing' END) ORDER BY id DESC LIMIT 1") ?? [],
        ]);
        $data['can'] = ['act' => hasRole($u, 'finance')];
        $data['today'] = $today;
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'po_pay' => self::poPay($u, $d),
            'payable_add' => self::payableAdd($u, $d),
            'payable_pay' => self::payablePay($u, $d),
            'expense_add' => self::expenseAdd($u, $d),
            'budget_set' => self::budgetSet($u, $d),
            'budget_decide' => self::budgetDecide($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    /** Pays a purchase order (up to the value of the items actually received). */
    private static function poPay(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'po_id');
        $amount = moneyField($d, 'amount');
        $invoice = field($d, 'supplier_invoice_no', 80);
        $pay = Money::paymentFields($d);
        $request = self::paymentRequest($d,'po '.$id,[$amount,$invoice,$pay]);
        return transaction(function (PDO $p) use ($u, $id, $amount, $invoice, $pay, $request) {
            $o = one($p, 'SELECT o.*, COALESCE(o.supplier_name, s.name) AS supplier FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=? FOR UPDATE', [$id]);
            must((bool)$o, 'Purchase order not found.', 404);
            if (self::paymentReplay($p,$request)) return ['message'=>'Payment was already recorded. No additional payment was created.','duplicate'=>true];
            must(Files::has('or_doc'), 'Attach the official receipt or payment confirmation.', 422);
            must(in_array($o['payment_status'], ['Pending Payment', 'Partially Paid'], true), 'This purchase order is not waiting for payment.', 409);
            $received = (float)one($p, 'SELECT COALESCE(SUM(received_qty*unit_price),0) AS v FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['v'];
            $payable = round($received - (float)$o['paid_amount'], 2);
            must($payable > 0, 'Nothing to pay yet: no items have been received for this PO (check the delivery against the approved PO).', 409);
            must((float)$amount <= $payable, 'The amount is more than the value of the received items not yet paid (PHP ' . number_format($payable, 2) . ').');
            $disb = Money::disburse($p, $u, 'purchase_order', $id, $o['supplier'], $amount, $pay);
            Files::store($p, $u, 'or_doc', 'purchase', $id, 'Official Receipt / Payment Confirmation', true, 'official receipt or payment confirmation');
            // New receipts already convert reserved budget to spent.
            // Older receipts (recorded before this rule) can still have their
            // delivered value in reserved_amount. Convert only that legacy
            // portion, never the undelivered reservation, and never count a
            // newly recorded payment as another budget expense.
            $undelivered = (float)one($p, 'SELECT COALESCE(SUM((quantity-received_qty)*unit_price),0) AS v FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['v'];
            $legacyReceivedReserve = max(0.0, round((float)$o['reserved_amount'] -
                (in_array($o['status'], ['Received', 'Closed'], true) ? 0.0 : $undelivered), 2));
            $fromReserve = round(min((float)$amount, $legacyReceivedReserve), 2);
            if ($o['budget_id'] && $fromReserve > 0) {
                run($p, 'UPDATE budgets SET reserved_amount=reserved_amount-?, spent_amount=spent_amount+? WHERE id=?',
                    [$fromReserve, $fromReserve, $o['budget_id']]);
            }
            run($p, 'UPDATE purchase_orders SET paid_amount=paid_amount+?, reserved_amount=GREATEST(reserved_amount-?,0), supplier_invoice_no=? WHERE id=?', [$amount, $fromReserve, $invoice, $id]);
            Actions::load('Purchasing');
            Purchasing::refreshPayment($p, $id);
            Money::expense($p, $u, 'Parts', $amount, $pay['released_on'], 'PO Payment', $id, null, null, $o['supplier'], $o['po_ref'], 'Payment of ' . $o['po_ref'] . ' (invoice ' . $invoice . ')');
            $st = one($p, 'SELECT payment_status FROM purchase_orders WHERE id=?', [$id])['payment_status'];
            auditWithChanges($p, $u['id'], 'Finance', 'po ' . $id, 'purchase order payment recorded', $o['po_ref'] . ' PHP ' . $amount . ' -> ' . $st,
                ['Paid amount' => $o['paid_amount'], 'Reserved amount' => $o['reserved_amount'], 'Payment status' => $o['payment_status']],
                ['Paid amount' => number_format((float)$o['paid_amount'] + (float)$amount, 2, '.', ''),
                 'Reserved amount' => number_format(max(0, (float)$o['reserved_amount'] - $fromReserve), 2, '.', ''), 'Payment status' => $st]);
            Notify::user($p, (int)$o['requested_by'], 'PO paid', $o['po_ref'] . ' payment recorded (' . $st . ').', 'purchase_orders');
            if ($st === 'Paid') Notify::resolve($p, 'po-pay-' . $o['id']);
            self::paymentReceipt($p,$u,$request);
            return ['message' => 'Payment recorded. ' . $o['po_ref'] . ' is ' . $st . '.'];
        });
    }

    private static function payableAdd(array $u, array $d): array {
        requireRole($u, 'finance');
        $row = ['supplier_id' => optId($d, 'supplier_id'), 'payee' => field($d, 'payee', 150), 'category' => choiceField($d, 'category', self::EXPENSE_CATEGORIES),
                'vehicle_id' => optId($d, 'vehicle_id'), 'description' => field($d, 'description', 255), 'amount' => moneyField($d, 'amount'), 'due_on' => dateField($d, 'due_on', false)];
        return transaction(function (PDO $p) use ($u, $row) {
            $id = insert($p, 'payables', ['payable_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'status' => 'Unpaid', 'recorded_by' => $u['id']] + $row);
            $ref = refNumber('AP', $id);
            run($p, 'UPDATE payables SET payable_ref=? WHERE id=?', [$ref, $id]);
            Files::store($p, $u, 'bill', 'payable', $id, 'Supplier Bill / Invoice');
            auditWithChanges($p, $u['id'], 'Finance', 'payable ' . $id, 'payable recorded', "$ref {$row['payee']} PHP {$row['amount']}", [],
                ['Payable reference' => $ref, 'Payee' => $row['payee'], 'Category' => $row['category'],
                 'Amount' => $row['amount'], 'Due date' => $row['due_on'], 'Status' => 'Unpaid']);
            return ['message' => "Payable $ref recorded."];
        });
    }

    private static function payablePay(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'payable_id');
        $amount = moneyField($d, 'amount');
        $pay = Money::paymentFields($d);
        $request = self::paymentRequest($d,'payable '.$id,[$amount,$pay]);
        return transaction(function (PDO $p) use ($u, $id, $amount, $pay, $request) {
            $a = one($p, 'SELECT * FROM payables WHERE id=? FOR UPDATE', [$id]);
            must((bool)$a, 'Payable not found.', 404);
            if (self::paymentReplay($p,$request)) return ['message'=>'Payment was already recorded. No additional payment was created.','duplicate'=>true];
            $bal = round((float)$a['amount'] - (float)$a['paid_amount'], 2);
            must($bal > 0, 'This payable is already paid.', 409);
            must((float)$amount <= $bal, 'The amount is more than the balance (PHP ' . number_format($bal, 2) . ').');
            self::chargeGeneralBudget($p, (float)$amount, $pay['released_on']);
            Money::disburse($p, $u, 'payable', $id, $a['payee'], $amount, $pay);
            Files::store($p, $u, 'or_doc', 'payable', $id, 'Official Receipt / Payment Confirmation');
            $paid = round((float)$a['paid_amount'] + (float)$amount, 2);
            run($p, 'UPDATE payables SET paid_amount=?, status=? WHERE id=?', [$paid, $paid >= (float)$a['amount'] ? 'Paid' : 'Partially Paid', $id]);
            Money::expense($p, $u, $a['category'], $amount, $pay['released_on'], 'Payable', $id, null, $a['vehicle_id'] ? (int)$a['vehicle_id'] : null, $a['payee'], $a['payable_ref'], $a['description']);
            auditWithChanges($p, $u['id'], 'Finance', 'payable ' . $id, 'payable paid', $a['payable_ref'] . ' PHP ' . $amount,
                ['Paid amount' => $a['paid_amount'], 'Status' => $a['status']],
                ['Paid amount' => number_format($paid, 2, '.', ''), 'Status' => $paid >= (float)$a['amount'] ? 'Paid' : 'Partially Paid']);
            self::paymentReceipt($p,$u,$request);
            return ['message' => 'Payment recorded.'];
        });
    }

    /** Count new manual expenses and non-PO payables against the current overall allocation.
     * PO receipts and trip fund releases already change reserved -> spent in their own modules.
     */
    private static function chargeGeneralBudget(PDO $p, float $amount, string $expenseDate): void {
        $exists = one($p,"SELECT id FROM budgets WHERE category='General' AND status='Active' LIMIT 1");
        if (!$exists) return; // Legacy allocations remain authoritative until Admin approves the first General Budget.
        $b=one($p,"SELECT * FROM budgets WHERE category='General' AND status='Active' FOR UPDATE");
        must((bool)$b && $expenseDate >= $b['period_start'] && $expenseDate <= $b['period_end'],
            'The expense date is outside the approved General Budget period.',409);
        $available=round((float)$b['amount']-(float)$b['reserved_amount']-(float)$b['spent_amount'],2);
        must($available >= round($amount,2),
            'Insufficient General Budget: PHP '.number_format($available,2).' available.',409);
        run($p,'UPDATE budgets SET spent_amount=spent_amount+? WHERE id=?',[$amount,$b['id']]);
    }

    private static function expenseAdd(array $u, array $d): array {
        requireRole($u, 'finance');
        $cat = choiceField($d, 'category', self::EXPENSE_CATEGORIES);
        $amount = moneyField($d, 'amount');
        $date = dateField($d, 'incurred_on');
        must($date <= date('Y-m-d'), 'The date cannot be in the future.');
        $tripId = optId($d, 'trip_id'); $vid = optId($d, 'vehicle_id');
        $payee = optField($d, 'payee', 150); $ref = optField($d, 'reference_number', 100); $desc = field($d, 'description', 500);
        return transaction(function (PDO $p) use ($u, $cat, $amount, $date, $tripId, $vid, $payee, $ref, $desc) {
            if ($tripId) must((bool)one($p, 'SELECT id FROM trips WHERE id=?', [$tripId]), 'Trip not found.');
            self::chargeGeneralBudget($p, (float)$amount, $date);
            $id = Money::expense($p, $u, $cat, $amount, $date, 'Manual', null, $tripId, $vid, $payee, $ref, $desc);
            Files::store($p, $u, 'receipt', 'expense', $id, 'Expense Receipt');
            auditWithChanges($p, $u['id'], 'Finance', 'expense ' . $id, 'expense recorded', "$cat PHP $amount: $desc", [],
                ['Category' => $cat, 'Amount' => $amount, 'Date' => $date, 'Payee' => $payee, 'Description' => $desc]);
            return ['message' => 'Expense recorded.'];
        });
    }

    /** Budget requests must be migrated before Finance can submit an allocation. */
    public static function budgetRequestsReady(PDO $p): bool {
        return (bool)one($p, "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
            AND TABLE_NAME='general_budget_requests' LIMIT 1");
    }

    /** The form proposes ONE overall budget. Saving never activates an unapproved amount. */
    private static function budgetSet(array $u, array $d): array {
        requireRole($u, 'finance');
        $amount = moneyField($d, 'amount');
        $start = dateField($d, 'period_start');
        $end = dateField($d, 'period_end');
        $remarks = optField($d, 'remarks', 500);
        must($end >= $start, 'The end date is before the start date.', 422);
        return transaction(function(PDO $p) use ($u,$amount,$start,$end,$remarks) {
            must(self::budgetRequestsReady($p), 'General Budget migration is required before submitting an allocation.', 409);
            must(!one($p, "SELECT id FROM general_budget_requests WHERE status='Pending Approval' LIMIT 1 FOR UPDATE"),
                 'An allocation is already waiting for Admin approval. Ask Admin to decide it before submitting another.', 409);
            $id = insert($p, 'general_budget_requests', [
                'amount'=>$amount, 'period_start'=>$start, 'period_end'=>$end,
                'remarks'=>$remarks, 'status'=>'Pending Approval', 'submitted_by'=>$u['id']
            ]);
            auditWithChanges($p,$u['id'],'Finance','general budget request '.$id,'general budget submitted',
                'PHP '.number_format((float)$amount,2).' '.$start.' to '.$end,
                [],['Amount'=>$amount,'Period start'=>$start,'Period end'=>$end,'Status'=>'Pending Approval']);
            Notify::roles($p, ['admin'], 'General Budget approval required',
                'Finance submitted a General Budget of PHP '.number_format((float)$amount,2).' for '.$start.' to '.$end.'.', 'admin_approvals');
            return ['message'=>'General Budget submitted for Admin approval. The existing active allocation remains unchanged.'];
        });
    }

    /** Activate only after Admin approval, carrying outstanding commitments without duplication. */
    private static function budgetDecide(array $u, array $d): array {
        requireRole($u,'admin');
        $id = idField($d,'request_id');
        $decision = choiceField($d,'decision',['approve','reject']);
        $notes = $decision === 'reject' ? field($d,'reason',500) : optField($d,'notes',500);
        return transaction(function(PDO $p) use ($u,$id,$decision,$notes) {
            must(self::budgetRequestsReady($p), 'General Budget migration is not installed.',409);
            $r = one($p, 'SELECT * FROM general_budget_requests WHERE id=? FOR UPDATE',[$id]);
            must((bool)$r,'General Budget request not found.',404);
            must($r['status']==='Pending Approval','This request has already been decided.',409);
            must((int)$r['submitted_by'] !== (int)$u['id'],'The submitting user cannot approve their own budget.',403);
            if ($decision === 'reject') {
                run($p, "UPDATE general_budget_requests SET status='Rejected',decided_by=?,decided_at=NOW(),decision_notes=? WHERE id=?",[$u['id'],$notes,$id]);
                auditWithChanges($p,$u['id'],'Finance','general budget request '.$id,'general budget rejected',
                    (string)$notes,['Status'=>'Pending Approval'],['Status'=>'Rejected']);
                Notify::user($p,(int)$r['submitted_by'],'General Budget rejected','Admin rejected the allocation: '.$notes,'finance_budgets');
                return ['message'=>'Budget request rejected. The existing budget remains active.'];
            }
            must($r['period_start'] <= date('Y-m-d') && $r['period_end'] >= date('Y-m-d'),
                'The approved General Budget period must include today. Ask Finance to submit a current allocation.',409);
            // Lock all existing allocations. Each originating transaction still retains its audit history.
            $old = many($p,"SELECT * FROM budgets WHERE status='Active' ORDER BY id FOR UPDATE");
            $reserved = round(array_sum(array_map(static fn($b)=>(float)$b['reserved_amount'],$old)),2);
            // A purchasing PO keeps its original budget_id until the decision is atomic.
            $poCarry = many($p,"SELECT id, budget_id, reserved_amount FROM purchase_orders
                WHERE reserved_amount>0 AND status IN ('Approved','Partially Received','Received','Closed')
                FOR UPDATE");
            $poTotal = round(array_sum(array_map(static fn($o)=>(float)$o['reserved_amount'],$poCarry)),2);
            $funds = round((float)one($p,"SELECT COALESCE(SUM(amount),0) AS v FROM fund_requests WHERE status='Ready for Release'")['v'],2);
            $diesel = 0.0;
            if (DieselPo::ready($p)) {
                $diesel = round((float)one($p,"SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(f.diesel_po_json,'$.total_amount')) AS DECIMAL(14,2))),0) AS v
                    FROM diesel_purchase_orders po JOIN fund_requests f ON f.id=po.fund_request_id
                    WHERE po.status IN ('Awaiting SOA','SOA Received','Verified','Discrepancy')")['v'],2);
            }
            // Never activate a budget that cannot cover existing outstanding obligations.
            $carry = max($reserved,round($poTotal+$funds+$diesel,2));
            must((float)$r['amount'] >= $carry,
                'The requested budget is below outstanding approved commitments of PHP '.number_format($carry,2).'. Finance must submit a larger allocation.',409);
            $budgetId = insert($p,'budgets',[
                'category'=>'General','amount'=>$r['amount'],'period_start'=>$r['period_start'],
                'period_end'=>$r['period_end'],'reserved_amount'=>$carry,'status'=>'Active','set_by'=>$r['submitted_by']
            ]);
            // Move open PO reservations to the new General allocation; no PO, fund or diesel approval is recreated.
            foreach($poCarry as $po) run($p,'UPDATE purchase_orders SET budget_id=? WHERE id=?',[$budgetId,$po['id']]);
            run($p,"UPDATE budgets SET status='Closed', reserved_amount=0 WHERE status='Active' AND id<>?",[$budgetId]);
            run($p,"UPDATE general_budget_requests SET status='Approved',decided_by=?,decided_at=NOW(),decision_notes=?,activated_budget_id=? WHERE id=?",
                [$u['id'],$notes,$budgetId,$id]);
            auditWithChanges($p,$u['id'],'Finance','general budget request '.$id,'general budget approved',
                'Budget '.$budgetId.' PHP '.number_format((float)$r['amount'],2).' with PHP '.number_format($carry,2).' carried forward',
                ['Status'=>'Pending Approval'],['Status'=>'Approved','Active budget'=>$budgetId,'Reserved commitments'=>$carry]);
            Notify::user($p,(int)$r['submitted_by'],'General Budget approved',
                'Admin approved the General Budget. PHP '.number_format($carry,2).' in existing commitments was carried forward.','finance_budgets');
            return ['message'=>'General Budget approved and activated. Outstanding reservations carried forward: PHP '.number_format($carry,2).'.'];
        });
    }
}
