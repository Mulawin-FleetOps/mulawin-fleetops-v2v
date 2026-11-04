<?php
/*
 * =====================================================================
 *  backend/Core/BillingDraft.php  —  automatic billing draft of a trip
 * =====================================================================
 *  PDF #12 step 10 (Confirmed Dispatch -> Billing Draft Generation):
 *    billing amount = assigned client billing rate x confirmed billable
 *    distance (+ applicable additional charges, added later by Billing).
 *    The draft appears in the "Ongoing Trips" tab of Billing and is view-only
 *    while the trip is ongoing.
 *  PDF #12 step 12: when the trip is completed the draft moves to "For Billing".
 *
 *  base amount = MAX(distance_km x rate_per_km, minimum_charge)
 * =====================================================================
 */
declare(strict_types=1);

final class BillingDraft {
    /** Creates (or refreshes, for a redispatch) the billing draft. Called at Confirm Dispatch. */
    public static function createFor(PDO $p, array $trip): int {
        $rate = one($p, 'SELECT rate_per_km, minimum_charge FROM client_rates WHERE client_id=? AND truck_type=?', [$trip['client_id'], $trip['truck_type']]);
        must((bool)$rate, 'The client has no billing rate for ' . $trip['truck_type'] . '. Ask Billing to set it first.', 409);
        $km = (float)$trip['distance_km'];
        $base = round(max($km * (float)$rate['rate_per_km'], (float)$rate['minimum_charge']), 2);
        $old = one($p, 'SELECT * FROM billings WHERE trip_id=? FOR UPDATE', [$trip['id']]);
        if ($old) {
            if (in_array($old['status'], ['Ongoing', 'Cancelled'], true)) {
                run($p, "UPDATE billings SET status='Ongoing', distance_km=?, rate_per_km=?, minimum_charge=?, base_amount=?, total_amount=?+charges_total WHERE id=?",
                    [$km, $rate['rate_per_km'], $rate['minimum_charge'], $base, $base, $old['id']]);
            }
            return (int)$old['id'];
        }
        $id = insert($p, 'billings', ['trip_id' => $trip['id'], 'client_id' => $trip['client_id'], 'status' => 'Ongoing', 'distance_km' => $km,
            'rate_per_km' => $rate['rate_per_km'], 'minimum_charge' => $rate['minimum_charge'], 'base_amount' => $base, 'total_amount' => $base]);
        audit($p, null, 'Billing', 'billing ' . $id, 'billing draft generated', $trip['trip_ref'] . ': ' . $km . ' km x ' . $rate['rate_per_km'] . ' = ' . number_format($base, 2));
        return $id;
    }

    /** Trip completed: the draft moves to For Billing. */
    public static function forBilling(PDO $p, int $tripId): void {
        run($p, "UPDATE billings SET status='For Billing' WHERE trip_id=? AND status='Ongoing'", [$tripId]);
    }

    /** Trip cancelled after a dispatch: the draft is cancelled. */
    public static function cancel(PDO $p, int $tripId): void {
        run($p, "UPDATE billings SET status='Cancelled' WHERE trip_id=? AND status IN ('Ongoing','For Billing')", [$tripId]);
    }
}
