<?php
/** Existing draft lifecycle; new trips freeze fixed route plus separately billable fuel.
 * Existing drafts/invoices retain their original pricing on redispatch.
 */
declare(strict_types=1);

final class BillingDraft {
    /** Creates the dispatch snapshot once; redispatch reuses existing monetary values. */
    public static function createFor(PDO $p, array $trip): int {
        core('TripPricing');must(TripPricing::ready($p),'Install and verify pricing migration 13 before dispatch.',409);
        $old=one($p,'SELECT * FROM billings WHERE trip_id=? FOR UPDATE',[$trip['id']]);
        if($old){ // Redispatch preserves the original monetary snapshot, including legacy bills.
            if($old['status']==='Cancelled')run($p,"UPDATE billings SET status='Ongoing' WHERE id=?",[$old['id']]);
            return (int)$old['id'];
        }
        $at=one($p,'SELECT dispatched_at FROM trips WHERE id=?',[$trip['id']])['dispatched_at']??date('Y-m-d H:i:s');
        $q=TripPricing::quote($p,$trip,$at);$q['frozen']=true;$base=$q['total']??$q['fixed']??'0.00';
        $id=insert($p,'billings',['trip_id'=>$trip['id'],'client_id'=>$trip['client_id'],'status'=>'Ongoing','distance_km'=>$trip['distance_km']??0,'rate_per_km'=>0,'minimum_charge'=>0,'base_amount'=>$base,'total_amount'=>$base]);
        insert($p,'billing_pricing',['billing_id'=>$id,'snapshot_json'=>json_encode($q,JSON_THROW_ON_ERROR)]);
        audit($p,null,'Billing','billing '.$id,'fixed route draft generated',$trip['trip_ref'].($q['missing']?': Pending Fuel Calculation':': dispatch pricing frozen'));
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
