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

final class Finance {
    public const EXPENSE_CATEGORIES = ['Fuel', 'RFID / Toll', 'Trip Allowance', 'Maintenance', 'Parts', 'Office', 'Utilities', 'Salaries', 'Other'];

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $from = (string)($q['from'] ?? date('Y-m-01')); $to = (string)($q['to'] ?? date('Y-m-d'));
        if (!DateTimeImmutable::createFromFormat('!Y-m-d', $from)) $from = date('Y-m-01');
        if (!DateTimeImmutable::createFromFormat('!Y-m-d', $to)) $to = date('Y-m-d');
        $data = readSections([
            'poPayables' => fn() => many($p, "SELECT o.*, s.name AS supplier, du.full_name AS approved_by_name,
                    (SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) AS received_value
                FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id LEFT JOIN users du ON du.id=o.decided_by
                WHERE o.payment_status IN ('Pending Payment','Partially Paid') ORDER BY o.id"),
            'payables' => fn() => many($p, "SELECT pa.*, (pa.amount-pa.paid_amount) AS balance, v.plate_number, s.name AS supplier FROM payables pa
                LEFT JOIN vehicles v ON v.id=pa.vehicle_id LEFT JOIN suppliers s ON s.id=pa.supplier_id ORDER BY FIELD(pa.status,'Unpaid','Partially Paid','Paid'), pa.due_on, pa.id DESC LIMIT 500"),
            'expenses' => fn() => many($p, "SELECT e.*, t.trip_ref, v.plate_number, u.full_name AS recorded_by_name FROM expenses e LEFT JOIN trips t ON t.id=e.trip_id
                LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN users u ON u.id=e.recorded_by WHERE e.incurred_on BETWEEN ? AND ? ORDER BY e.incurred_on DESC, e.id DESC LIMIT 2000", [$from, $to]),
            'disbursements' => fn() => many($p, "SELECT d.*, u.full_name AS recorded_by_name FROM disbursements d JOIN users u ON u.id=d.recorded_by
                WHERE d.released_on BETWEEN ? AND ? ORDER BY d.released_on DESC, d.id DESC LIMIT 2000", [$from, $to]),
            'budgets' => fn() => many($p, "SELECT b.*, (b.amount-b.reserved_amount-b.spent_amount) AS available, u.full_name AS set_by_name FROM budgets b JOIN users u ON u.id=b.set_by ORDER BY b.status, b.id DESC"),
            'cashflow' => fn() => many($p, "SELECT m, SUM(cash_in) AS cash_in, SUM(cash_out) AS cash_out FROM (
                    SELECT DATE_FORMAT(payment_date,'%Y-%m') AS m, amount AS cash_in, 0 AS cash_out FROM collections WHERE payment_date>=DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
                    UNION ALL SELECT DATE_FORMAT(released_on,'%Y-%m'), 0, amount FROM disbursements WHERE released_on>=DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)) x GROUP BY m ORDER BY m"),
            'suppliers' => fn() => many($p, 'SELECT id, name FROM suppliers WHERE active=1 ORDER BY name'),
            'trucks' => fn() => many($p, 'SELECT id, plate_number FROM vehicles ORDER BY plate_number'),
        ]);
        $data['period'] = ['from' => $from, 'to' => $to];
        $data['categories'] = self::EXPENSE_CATEGORIES;
        $data['methods'] = Money::METHODS;
        $data['can'] = ['act' => hasRole($u, 'finance')];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'po_pay' => self::poPay($u, $d),
            'payable_add' => self::payableAdd($u, $d),
            'payable_pay' => self::payablePay($u, $d),
            'expense_add' => self::expenseAdd($u, $d),
            'budget_set' => self::budgetSet($u, $d),
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
        must(Files::has('or_doc'), 'Attach the official receipt or payment confirmation.', 422);
        return transaction(function (PDO $p) use ($u, $id, $amount, $invoice, $pay) {
            $o = one($p, 'SELECT o.*, s.name AS supplier FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=? FOR UPDATE', [$id]);
            must((bool)$o, 'Purchase order not found.', 404);
            must(in_array($o['payment_status'], ['Pending Payment', 'Partially Paid'], true), 'This purchase order is not waiting for payment.', 409);
            $received = (float)one($p, 'SELECT COALESCE(SUM(received_qty*unit_price),0) AS v FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['v'];
            $payable = round($received - (float)$o['paid_amount'], 2);
            must($payable > 0, 'Nothing to pay yet: no items have been received for this PO (check the delivery against the approved PO).', 409);
            must((float)$amount <= $payable, 'The amount is more than the value of the received items not yet paid (PHP ' . number_format($payable, 2) . ').');
            $disb = Money::disburse($p, $u, 'purchase_order', $id, $o['supplier'], $amount, $pay);
            Files::store($p, $u, 'or_doc', 'purchase', $id, 'Official Receipt / Payment Confirmation', true, 'official receipt or payment confirmation');
            $fromReserve = round(min((float)$amount, (float)$o['reserved_amount']), 2);
            if ($o['budget_id']) run($p, 'UPDATE budgets SET reserved_amount=GREATEST(reserved_amount-?,0), spent_amount=spent_amount+? WHERE id=?', [$fromReserve, $amount, $o['budget_id']]);
            run($p, 'UPDATE purchase_orders SET paid_amount=paid_amount+?, reserved_amount=GREATEST(reserved_amount-?,0), supplier_invoice_no=? WHERE id=?', [$amount, $fromReserve, $invoice, $id]);
            Actions::load('Purchasing');
            Purchasing::refreshPayment($p, $id);
            Money::expense($p, $u, 'Parts', $amount, $pay['released_on'], 'PO Payment', $id, null, null, $o['supplier'], $o['po_ref'], 'Payment of ' . $o['po_ref'] . ' (invoice ' . $invoice . ')');
            $st = one($p, 'SELECT payment_status FROM purchase_orders WHERE id=?', [$id])['payment_status'];
            audit($p, $u['id'], 'Finance', 'po ' . $id, 'purchase order payment recorded', $o['po_ref'] . ' PHP ' . $amount . ' -> ' . $st);
            Notify::user($p, (int)$o['requested_by'], 'PO paid', $o['po_ref'] . ' payment recorded (' . $st . ').', 'purchasing');
            if ($st === 'Paid') Notify::resolve($p, 'po-pay-' . $o['id']);
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
            audit($p, $u['id'], 'Finance', 'payable ' . $id, 'payable recorded', "$ref {$row['payee']} PHP {$row['amount']}");
            return ['message' => "Payable $ref recorded."];
        });
    }

    private static function payablePay(array $u, array $d): array {
        requireRole($u, 'finance');
        $id = idField($d, 'payable_id');
        $amount = moneyField($d, 'amount');
        $pay = Money::paymentFields($d);
        return transaction(function (PDO $p) use ($u, $id, $amount, $pay) {
            $a = one($p, 'SELECT * FROM payables WHERE id=? FOR UPDATE', [$id]);
            must((bool)$a, 'Payable not found.', 404);
            $bal = round((float)$a['amount'] - (float)$a['paid_amount'], 2);
            must($bal > 0, 'This payable is already paid.', 409);
            must((float)$amount <= $bal, 'The amount is more than the balance (PHP ' . number_format($bal, 2) . ').');
            Money::disburse($p, $u, 'payable', $id, $a['payee'], $amount, $pay);
            Files::store($p, $u, 'or_doc', 'payable', $id, 'Official Receipt / Payment Confirmation');
            $paid = round((float)$a['paid_amount'] + (float)$amount, 2);
            run($p, 'UPDATE payables SET paid_amount=?, status=? WHERE id=?', [$paid, $paid >= (float)$a['amount'] ? 'Paid' : 'Partially Paid', $id]);
            Money::expense($p, $u, $a['category'], $amount, $pay['released_on'], 'Payable', $id, null, $a['vehicle_id'] ? (int)$a['vehicle_id'] : null, $a['payee'], $a['payable_ref'], $a['description']);
            audit($p, $u['id'], 'Finance', 'payable ' . $id, 'payable paid', $a['payable_ref'] . ' PHP ' . $amount);
            return ['message' => 'Payment recorded.'];
        });
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
            $id = Money::expense($p, $u, $cat, $amount, $date, 'Manual', null, $tripId, $vid, $payee, $ref, $desc);
            Files::store($p, $u, 'receipt', 'expense', $id, 'Expense Receipt');
            audit($p, $u['id'], 'Finance', 'expense ' . $id, 'expense recorded', "$cat PHP $amount: $desc");
            return ['message' => 'Expense recorded.'];
        });
    }

    /** Purchasing budget. Only one Active budget; a new one closes the previous. */
    private static function budgetSet(array $u, array $d): array {
        requireRole($u, 'finance');
        $amount = moneyField($d, 'amount');
        $start = dateField($d, 'period_start'); $end = dateField($d, 'period_end');
        must($end >= $start, 'The end date is before the start date.');
        return transaction(function (PDO $p) use ($u, $amount, $start, $end) {
            run($p, "UPDATE budgets SET status='Closed' WHERE status='Active' AND category='Purchasing'");
            $id = insert($p, 'budgets', ['category' => 'Purchasing', 'amount' => $amount, 'period_start' => $start, 'period_end' => $end, 'status' => 'Active', 'set_by' => $u['id']]);
            audit($p, $u['id'], 'Finance', 'budget ' . $id, 'purchasing budget set', "PHP $amount ($start to $end)");
            return ['message' => 'Purchasing budget set: PHP ' . number_format((float)$amount, 2) . '.'];
        });
    }
}
