<?php
/*
 * =====================================================================
 *  backend/Modules/Accounting/Billing.php  —  BILLING AND COLLECTION
 * =====================================================================
 *  Objective 3.2  billing drafts from client rate x billable distance (+ charges);
 *                 completed trips processed for billing
 *  Objective 3.3  verify billing information and required documents before
 *                 finalizing; generate invoices (Service Invoice format, PDF #13)
 *  Objective 3.4  client payments, collections, outstanding balances, receivables
 *
 *  PDF #12:
 *   - Confirm Dispatch -> billing draft in "Ongoing Trips" (view only)
 *   - Trip Completed -> draft moves to "For Billing" with client profile, trip
 *     details, billing breakdown and the dispatcher's supporting documents
 *   - Billing verifies the documents; if verified -> finalize -> printable invoice
 *   - Payment needs the acknowledgement receipt + payment details; the system
 *     refuses the confirmation until they are complete -> PAID
 * =====================================================================
 */
declare(strict_types=1);
core('Notify');
core('Files');
core('Money');
core('Settings');

final class Billing {
    public const DOC_PAYMENT = 'Payment Acknowledgement Receipt';

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $data = readSections([
            'billings' => fn() => many($p, "SELECT b.*, t.trip_ref, t.status AS trip_status, t.truck_type, t.pickup_point, t.delivery_point, t.dispatched_at, t.completed_at,
                    t.waybill_number, t.units_delivered, c.company_name AS client, c.payment_terms_days, v.plate_number,
                    (b.total_amount-b.amount_paid) AS balance, DATEDIFF(CURRENT_DATE(), b.due_date) AS days_overdue,
                    (SELECT COUNT(*) FROM documents d WHERE d.entity_type='trip' AND d.entity_id=t.id AND d.category='Waybill') AS waybill_docs,
                    (SELECT COUNT(*) FROM documents d WHERE d.entity_type='trip' AND d.entity_id=t.id AND d.category='Acknowledgement Receipt') AS ar_docs
                FROM billings b JOIN trips t ON t.id=b.trip_id JOIN clients c ON c.id=b.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
                ORDER BY b.id DESC LIMIT 2000"),
            'collections' => fn() => many($p, "SELECT co.*, b.invoice_number, c.company_name AS client, u.full_name AS recorded_by_name FROM collections co
                JOIN billings b ON b.id=co.billing_id JOIN clients c ON c.id=b.client_id JOIN users u ON u.id=co.recorded_by ORDER BY co.id DESC LIMIT 1000"),
            'receivables' => fn() => many($p, "SELECT c.id, c.company_name AS client, COUNT(*) AS invoices, SUM(b.total_amount-b.amount_paid) AS balance,
                    SUM(CASE WHEN b.due_date>=CURRENT_DATE() THEN b.total_amount-b.amount_paid ELSE 0 END) AS not_due,
                    SUM(CASE WHEN DATEDIFF(CURRENT_DATE(), b.due_date) BETWEEN 1 AND 30 THEN b.total_amount-b.amount_paid ELSE 0 END) AS d1_30,
                    SUM(CASE WHEN DATEDIFF(CURRENT_DATE(), b.due_date) BETWEEN 31 AND 60 THEN b.total_amount-b.amount_paid ELSE 0 END) AS d31_60,
                    SUM(CASE WHEN DATEDIFF(CURRENT_DATE(), b.due_date) > 60 THEN b.total_amount-b.amount_paid ELSE 0 END) AS d60
                FROM billings b JOIN clients c ON c.id=b.client_id WHERE b.status IN ('Invoiced','Partially Paid') GROUP BY c.id, c.company_name ORDER BY balance DESC"),
            'pendingRates' => fn() => (int)one($p, "SELECT COUNT(*) AS n FROM clients WHERE status='Pending Rate'")['n'],
        ]);
        $data['methods'] = Money::METHODS;
        $data['vatRate'] = Settings::value('vat_rate');
        $data['can'] = ['act' => hasRole($u, 'billing')];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'charge_add' => self::chargeAdd($u, $d),
            'charge_remove' => self::chargeRemove($u, $d),
            'verify' => self::verify($u, $d),
            'finalize' => self::finalize($u, $d),
            'collect' => self::collect($u, $d),
            'details' => self::details($u, $d),
            'soa' => self::soa($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    private static function lock(PDO $p, int $id): array {
        $b = one($p, 'SELECT b.*, t.trip_ref, t.status AS trip_status FROM billings b JOIN trips t ON t.id=b.trip_id WHERE b.id=? FOR UPDATE', [$id]);
        must((bool)$b, 'Billing record not found.', 404);
        return $b;
    }
    private static function recompute(PDO $p, int $id): void {
        run($p, 'UPDATE billings SET charges_total=(SELECT COALESCE(SUM(amount),0) FROM billing_charges WHERE billing_id=?), total_amount=base_amount+(SELECT COALESCE(SUM(amount),0) FROM billing_charges WHERE billing_id=?) WHERE id=?', [$id, $id, $id]);
    }

    /** Additional charges (only after the trip is completed; the draft is view-only while ongoing). */
    private static function chargeAdd(array $u, array $d): array {
        requireRole($u, 'billing');
        $id = idField($d, 'billing_id');
        $desc = field($d, 'description', 150); $amount = moneyField($d, 'amount');
        return transaction(function (PDO $p) use ($u, $id, $desc, $amount) {
            $b = self::lock($p, $id);
            must($b['status'] === 'For Billing', $b['status'] === 'Ongoing' ? 'The billing draft is view-only while the trip is ongoing.' : 'Charges can only be changed before the invoice is finalized.', 409);
            insert($p, 'billing_charges', ['billing_id' => $id, 'description' => $desc, 'amount' => $amount, 'added_by' => $u['id']]);
            self::recompute($p, $id);
            audit($p, $u['id'], 'Billing', 'billing ' . $id, 'additional charge added', $b['trip_ref'] . ": $desc PHP $amount");
            return ['message' => 'Charge added.'];
        });
    }

    private static function chargeRemove(array $u, array $d): array {
        requireRole($u, 'billing');
        $cid = idField($d, 'charge_id');
        return transaction(function (PDO $p) use ($u, $cid) {
            $c = one($p, 'SELECT * FROM billing_charges WHERE id=?', [$cid]);
            must((bool)$c, 'Charge not found.', 404);
            $b = self::lock($p, (int)$c['billing_id']);
            must($b['status'] === 'For Billing', 'Charges can only be changed before the invoice is finalized.', 409);
            run($p, 'DELETE FROM billing_charges WHERE id=?', [$cid]);
            self::recompute($p, (int)$b['id']);
            audit($p, $u['id'], 'Billing', 'billing ' . $b['id'], 'additional charge removed', $b['trip_ref'] . ': ' . $c['description']);
            return ['message' => 'Charge removed.'];
        });
    }

    /** Document verification: the required trip documents must be there. */
    private static function verify(array $u, array $d): array {
        requireRole($u, 'billing');
        $id = idField($d, 'billing_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $b = self::lock($p, $id);
            must($b['status'] === 'For Billing', 'Only records in For Billing are verified.', 409);
            must($b['trip_status'] === 'Completed', 'The trip is not completed.', 409);
            $missing = [];
            foreach (['Waybill', 'Acknowledgement Receipt'] as $cat) if (!Files::count($p, 'trip', (int)$b['trip_id'], $cat)) $missing[] = $cat;
            must(!$missing, 'Cannot verify. Missing supporting documents: ' . implode(', ', $missing) . '.', 422);
            run($p, 'UPDATE billings SET docs_verified_by=?, docs_verified_at=NOW() WHERE id=?', [$u['id'], $id]);
            audit($p, $u['id'], 'Billing', 'billing ' . $id, 'supporting documents verified', $b['trip_ref']);
            return ['message' => 'Documents verified. The billing can now be finalized.'];
        });
    }

    /** Finalize -> invoice number, invoice date and due date (date + client payment terms). */
    private static function finalize(array $u, array $d): array {
        requireRole($u, 'billing');
        $id = idField($d, 'billing_id');
        $date = dateField($d, 'invoice_date');
        must($date <= date('Y-m-d'), 'Invoice date cannot be in the future.');
        $number = optField($d, 'invoice_number', 40);
        return transaction(function (PDO $p) use ($u, $id, $date, $number) {
            $b = self::lock($p, $id);
            must($b['status'] === 'For Billing', 'Only records in For Billing can be finalized.', 409);
            must((bool)$b['docs_verified_at'], 'Verify the supporting documents first.', 409);
            must((float)$b['total_amount'] > 0, 'The billing amount is zero.', 409);
            Notify::resolve($p, 'billing-verify-' . $b['trip_id']);
            if ($number !== null) must(!one($p, 'SELECT id FROM billings WHERE invoice_number=? AND id<>?', [$number, $id]), 'Invoice number ' . $number . ' is already used.', 409);
            $number ??= refNumber('SI', $id);
            $c = one($p, 'SELECT company_name, payment_terms_days FROM clients WHERE id=?', [$b['client_id']]);
            $terms = $c['payment_terms_days'] !== null ? (int)$c['payment_terms_days'] : (int)Settings::value('default_payment_terms_days');
            $due = date('Y-m-d', strtotime($date . " +$terms days"));
            run($p, "UPDATE billings SET status='Invoiced', invoice_number=?, invoice_date=?, due_date=?, finalized_by=?, finalized_at=NOW() WHERE id=?", [$number, $date, $due, $u['id'], $id]);
            audit($p, $u['id'], 'Billing', 'billing ' . $id, 'invoice finalized', "$number for " . $b['trip_ref'] . ' PHP ' . $b['total_amount'] . ", due $due");
            return ['message' => "Invoice $number finalized (due $due). It is ready for printing and collection."];
        });
    }

    /** Client payment. Refused until the acknowledgement receipt and payment details are complete. */
    private static function collect(array $u, array $d): array {
        requireRole($u, 'billing');
        $id = idField($d, 'billing_id');
        $amount = moneyField($d, 'amount');
        $pay = Money::paymentFields($d, 'payment_date');
        $ar = field($d, 'ar_number', 40);
        $ref = $pay['reference_number'] ?? ($pay['payment_method'] === 'Cash' ? 'CASH ' . $ar : null);
        must($ref !== null, 'Enter the payment reference number.');
        must(Files::has('ack_receipt'), 'Attach the acknowledgement receipt before confirming the payment.', 422);
        return transaction(function (PDO $p) use ($u, $id, $amount, $pay, $ar, $ref) {
            $b = self::lock($p, $id);
            must(in_array($b['status'], ['Invoiced', 'Partially Paid'], true), 'Payments are recorded for finalized invoices (this record is ' . $b['status'] . ').', 409);
            $balance = round((float)$b['total_amount'] - (float)$b['amount_paid'], 2);
            must((float)$amount <= $balance, 'The amount is more than the balance (PHP ' . number_format($balance, 2) . ').');
            must($pay['payment_date'] >= $b['invoice_date'], 'Payment date is before the invoice date.');
            $cid = insert($p, 'collections', ['billing_id' => $id, 'amount' => $amount, 'payment_date' => $pay['payment_date'], 'payment_method' => $pay['payment_method'],
                'reference' => $ref, 'ar_number' => $ar, 'cheque_number' => $pay['cheque_number'], 'bank_name' => $pay['bank_name'], 'recorded_by' => $u['id']]);
            Files::store($p, $u, 'ack_receipt', 'billing', $id, self::DOC_PAYMENT, true, 'acknowledgement receipt');
            $paid = round((float)$b['amount_paid'] + (float)$amount, 2);
            $status = $paid >= (float)$b['total_amount'] ? 'Paid' : 'Partially Paid';
            run($p, 'UPDATE billings SET amount_paid=?, status=? WHERE id=?', [$paid, $status, $id]);
            audit($p, $u['id'], 'Billing', 'billing ' . $id, 'payment recorded', $b['invoice_number'] . ": PHP $amount ({$pay['payment_method']}), AR $ar -> $status");
            Notify::roles($p, ['finance'], 'Collection', $b['invoice_number'] . ' received PHP ' . number_format((float)$amount, 2) . " ($status).", 'billing');
            return ['collection_id' => $cid, 'message' => 'Payment recorded. Invoice is ' . $status . '.'];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'billing'), 'Not allowed.', 403);
        $id = idField($d, 'billing_id'); $p = db();
        $b = one($p, 'SELECT b.*, (b.total_amount-b.amount_paid) AS balance, vu.full_name AS verified_by_name, fu.full_name AS finalized_by_name FROM billings b
            LEFT JOIN users vu ON vu.id=b.docs_verified_by LEFT JOIN users fu ON fu.id=b.finalized_by WHERE b.id=?', [$id]);
        must((bool)$b, 'Billing record not found.', 404);
        $docs = array_merge(Files::of($p, 'trip', (int)$b['trip_id']), Files::of($p, 'billing', $id));
        return [
            'billing' => $b,
            'trip' => one($p, 'SELECT t.*, v.plate_number, d1.full_name AS driver_name, d2.full_name AS driver2_name, h.full_name AS helper_name FROM trips t
                LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN personnel d1 ON d1.id=t.driver_id LEFT JOIN personnel d2 ON d2.id=t.driver2_id LEFT JOIN personnel h ON h.id=t.helper_id WHERE t.id=?', [$b['trip_id']]),
            'client' => one($p, 'SELECT * FROM clients WHERE id=?', [$b['client_id']]),
            'charges' => many($p, 'SELECT c.*, u.full_name AS added_by_name FROM billing_charges c JOIN users u ON u.id=c.added_by WHERE c.billing_id=? ORDER BY c.id', [$id]),
            'collections' => many($p, 'SELECT co.*, u.full_name AS recorded_by_name FROM collections co JOIN users u ON u.id=co.recorded_by WHERE co.billing_id=? ORDER BY co.id', [$id]),
            'documents' => $docs,
            'vatRate' => Settings::value('vat_rate'),
        ];
    }

    /** Statement of account of a client (unpaid invoices). */
    private static function soa(array $u, array $d): array {
        must(Access::canOpen($u, 'billing'), 'Not allowed.', 403);
        $cid = idField($d, 'client_id'); $p = db();
        $c = one($p, 'SELECT * FROM clients WHERE id=?', [$cid]);
        must((bool)$c, 'Client not found.', 404);
        return ['client' => $c, 'invoices' => many($p, "SELECT b.invoice_number, b.invoice_date, b.due_date, b.total_amount, b.amount_paid, (b.total_amount-b.amount_paid) AS balance,
                t.trip_ref, t.waybill_number, t.pickup_point, t.delivery_point, DATEDIFF(CURRENT_DATE(), b.due_date) AS days_overdue
            FROM billings b JOIN trips t ON t.id=b.trip_id WHERE b.client_id=? AND b.status IN ('Invoiced','Partially Paid') ORDER BY b.invoice_date", [$cid])];
    }
}
