<?php
/*
 * backend/Core/Money.php  —  shared payment helpers
 * Every cash release (trip fund, purchase order, bill) records the same
 * details and gets a payment voucher number (PDF #11 II.I).
 */
declare(strict_types=1);

final class Money {
    public const METHODS = ['Cash', 'Cheque', 'Bank Transfer', 'E-wallet'];

    /** Payment details (method, date, cheque, bank, reference). */
    public static function paymentFields(array $d, string $dateKey = 'released_on'): array {
        $method = choiceField($d, 'payment_method', self::METHODS);
        $out = ['payment_method' => $method, $dateKey => dateField($d, $dateKey),
                'reference_number' => optField($d, 'reference_number', 100), 'cheque_number' => optField($d, 'cheque_number', 60),
                'bank_name' => optField($d, 'bank_name', 100)];
        if ($method === 'Cheque') {
            must($out['cheque_number'] !== null, 'Cheque number is required for cheque payments.');
            must($out['bank_name'] !== null, 'Bank name is required for cheque payments.');
        }
        if ($method === 'Bank Transfer' || $method === 'E-wallet') must($out['reference_number'] !== null, 'Reference number is required for ' . $method . '.');
        must($out[$dateKey] <= date('Y-m-d'), 'The date cannot be in the future.');
        return $out;
    }

    /** Records a cash release with a voucher number like PV-2026-0001. Returns the disbursement id. */
    public static function disburse(PDO $p, array $u, string $sourceType, int $sourceId, string $payee, string $amount, array $pay): int {
        $id = insert($p, 'disbursements', ['voucher_number' => 'TMP-' . bin2hex(random_bytes(6)), 'source_type' => $sourceType, 'source_id' => $sourceId,
            'payee' => cut($payee, 180), 'payment_method' => $pay['payment_method'], 'cheque_number' => $pay['cheque_number'],
            'bank_name' => $pay['bank_name'], 'reference_number' => $pay['reference_number'], 'amount' => $amount,
            'released_on' => $pay['released_on'], 'recorded_by' => $u['id']]);
        run($p, 'UPDATE disbursements SET voucher_number=? WHERE id=?', [refNumber('PV', $id), $id]);
        return $id;
    }

    /** Adds an expense row (source keeps totals from being counted twice). */
    public static function expense(PDO $p, array $u, string $category, string $amount, string $date, string $source, ?int $sourceId,
                                   ?int $tripId = null, ?int $vehicleId = null, ?string $payee = null, ?string $ref = null, ?string $desc = null): int {
        return insert($p, 'expenses', ['category' => $category, 'trip_id' => $tripId, 'vehicle_id' => $vehicleId, 'amount' => $amount,
            'incurred_on' => $date, 'payee' => $payee ? cut($payee, 150) : null, 'reference_number' => $ref, 'description' => $desc ? cut($desc, 500) : null,
            'source' => $source, 'source_id' => $sourceId, 'recorded_by' => $u['id']]);
    }
}
