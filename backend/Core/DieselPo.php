<?php
declare(strict_types=1);
core('Notify');
core('Files');
core('DispatcherScope');

/**
 * Independent Diesel PO review and post-trip Supplier SOA handover.
 * Cash fund approvals/releases and client statements of account are unrelated.
 * Legacy diesel_po_json records remain readable without automatic conversion.
 */
final class DieselPo {
    public static function ready(PDO $p): bool {
        return (int)(one($p, "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='diesel_purchase_orders'")['n'] ?? 0) === 1;
    }

    public static function byFund(PDO $p, int $fundId): ?array {
        if (!self::ready($p)) return null;
        return one($p, "SELECT po.*, au.full_name AS approved_by_name, ru.full_name AS received_by_name,
                vu.full_name AS verified_by_name, dr.full_name AS received_driver_name
            FROM diesel_purchase_orders po
            LEFT JOIN users au ON au.id=po.approved_by
            LEFT JOIN users ru ON ru.id=po.received_by
            LEFT JOIN users vu ON vu.id=po.verified_by
            LEFT JOIN personnel dr ON dr.id=po.received_driver_id
            WHERE po.fund_request_id=?", [$fundId]);
    }

    public static function byTrip(PDO $p, int $tripId, ?int $poId = null): ?array {
        if (!self::ready($p)) return null;
        return one($p, "SELECT po.*, f.diesel_po_json, au.full_name AS approved_by_name,
                ru.full_name AS received_by_name, vu.full_name AS verified_by_name,
                dr.full_name AS received_driver_name
            FROM diesel_purchase_orders po JOIN fund_requests f ON f.id=po.fund_request_id
            LEFT JOIN users au ON au.id=po.approved_by
            LEFT JOIN users ru ON ru.id=po.received_by
            LEFT JOIN users vu ON vu.id=po.verified_by
            LEFT JOIN personnel dr ON dr.id=po.received_driver_id
            WHERE po.trip_id=? ".($poId===null?"":"AND po.id=? ")."ORDER BY po.id DESC LIMIT 1", $poId===null?[$tripId]:[$tripId,$poId]);
    }

    /** Insert only for new Diesel POs; legacy JSON is never silently converted. */
    public static function sync(PDO $p, int $fundId, int $tripId, array $po, bool $legacy, int $actorId): void {
        must(self::ready($p), 'The additive Diesel PO workflow migration is not installed. Cash funds are unaffected.', 409);
        $row = one($p, 'SELECT * FROM diesel_purchase_orders WHERE fund_request_id=? FOR UPDATE', [$fundId]);
        if (!$row) {
            if ($legacy) return;
            run($p, "INSERT INTO diesel_purchase_orders
                (fund_request_id,trip_id,po_number,status,created_at) VALUES (?,?,?,'Draft',NOW())",
                [$fundId,$tripId,$po['po_number']]);
            audit($p, $actorId, 'Diesel PO', 'fund '.$fundId, 'diesel PO drafted', $po['po_number']);
            return;
        }
        must((int)$row['trip_id'] === $tripId && (string)$row['po_number'] === (string)$po['po_number'],
            'The Diesel PO identity cannot be changed.',409);
        // Cash fund resubmission must never change the independent PO decision.
    }

    /** A Draft or rejected Diesel PO can be edited without reopening approved cash funds. */
    public static function revise(array $u,array $d): array {
        must(roleIsDispatcher($u['role']), 'Only the responsible Dispatcher may revise Diesel PO.',403);
        $id=idField($d,'po_id');
        $liters=trim((string)($d['liters']??''));
        must((bool)preg_match('/^\\d{1,6}(?:\\.\\d{1,3})?$/',$liters) && (float)$liters>0,
            'Enter a positive number of liters with at most three decimals.',422);
        return transaction(function(PDO $p) use($u,$id,$liters) {
            must(self::ready($p),'Install the Diesel PO workflow migration first.',409);
            $po=one($p,'SELECT po.*,f.diesel_po_json,t.status AS trip_status,t.dispatcher_role,t.truck_type,
                (SELECT r.current_dispatcher_id FROM trip_responsibilities r WHERE r.trip_id=t.id) AS responsible_dispatcher_id
                FROM diesel_purchase_orders po JOIN fund_requests f ON f.id=po.fund_request_id
                JOIN trips t ON t.id=po.trip_id WHERE po.id=? FOR UPDATE',[$id]);
            must((bool)$po,'Diesel PO not found.',404);
            must(DispatcherScope::permitsTrip($u,$po),'This Diesel PO belongs to another dispatcher.',403);
            must(in_array($po['status'],['Draft','Rejected'],true),'Only Draft or Rejected Diesel POs can be edited.',409);
            must(!in_array($po['trip_status'],['Cancelled','Rejected','Missed'],true),'The trip is closed.',409);
            $snapshot=json_decode((string)$po['diesel_po_json'],true,512,JSON_THROW_ON_ERROR);
            must(count($snapshot['lines']??[])===1,'Legacy multi-line Diesel PO must be reviewed separately.',409);
            $rate=(string)$snapshot['lines'][0]['unit_price'];
            must(is_numeric($rate)&&(float)$rate>0,'Saved Diesel PO fuel price is invalid.',409);
            $amount=number_format(round((float)$liters*(float)$rate,2),2,'.','');
            $snapshot['lines']=[['liters'=>$liters,'unit_price'=>$rate,'total'=>$amount]];
            $snapshot['total_amount']=$amount;
            run($p,'UPDATE fund_requests SET diesel_po_json=? WHERE id=?',
                [json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$po['fund_request_id']]);
            run($p,"UPDATE diesel_purchase_orders SET status='Draft',approved_by=NULL,approved_at=NULL,
                decision_reason=NULL WHERE id=?",[$id]);
            audit($p,$u['id'],'Diesel PO','po '.$id,'rejected Diesel PO revised',
                $po['po_number'].' liters '.$liters.' total PHP '.$amount);
            Notify::roles($p,['operations_head'],'Diesel PO revision',
                'Diesel PO '.$po['po_number'].' was revised and is awaiting separate approval.','funds');
            return ['message'=>'Diesel PO revised and returned to Draft for Operations Head review. Cash fund status is unchanged.'];
        });
    }

    public static function decide(array $u, array $d): array {
        requireRole($u,'operations_head');
        $id=idField($d,'po_id');
        $decision=choiceField($d,'decision',['approve','reject']);
        $reason=$decision==='reject'?field($d,'reason',500):null;
        return transaction(function(PDO $p) use($u,$id,$decision,$reason) {
            must(self::ready($p),'Install the approved Diesel PO workflow migration first.',409);
            $po=one($p,"SELECT po.*,f.requested_by,f.diesel_po_json,t.trip_ref,t.status AS trip_status
                FROM diesel_purchase_orders po JOIN fund_requests f ON f.id=po.fund_request_id
                JOIN trips t ON t.id=po.trip_id WHERE po.id=? FOR UPDATE",[$id]);
            must((bool)$po,'Diesel PO not found.',404);
            must($po['status']==='Draft','Only Draft Diesel POs can be reviewed.',409);
            must(!in_array($po['trip_status'],['Cancelled','Rejected','Missed'],true),'This trip is closed.',409);
            if ($decision === 'approve') {
                $budget=one($p, "SELECT * FROM budgets WHERE category='Fuel Operations' AND status='Active'
                    AND CURRENT_DATE() BETWEEN period_start AND period_end ORDER BY id DESC LIMIT 1 FOR UPDATE");
                must((bool)$budget, 'No active Fuel Operations budget covers today. Finance must allocate a Fuel Operations budget before Diesel PO approval.', 409);
                $snapshot=json_decode((string)$po['diesel_po_json'],true);
                $fuelAmount=round((float)($snapshot['total_amount']??0),2);
                must($fuelAmount>0,'Diesel PO amount is invalid. Ask the Dispatcher to revise it.',409);
                $available=round((float)$budget['amount']-(float)$budget['reserved_amount']-(float)$budget['spent_amount'],2);
                must($fuelAmount<=$available,
                    'Insufficient Fuel Operations budget: PHP '.number_format($available,2).' available; Diesel PO requires PHP '.number_format($fuelAmount,2).'.',409);
                run($p,'UPDATE budgets SET reserved_amount=reserved_amount+? WHERE id=?',[$fuelAmount,$budget['id']]);
            }
            $status=$decision==='approve'?'Awaiting SOA':'Rejected';
            run($p,'UPDATE diesel_purchase_orders SET status=?,approved_by=?,approved_at=NOW(),decision_reason=? WHERE id=?',
                [$status,$u['id'],$reason,$id]);
            audit($p,$u['id'],'Diesel PO','po '.$id,'diesel PO '.$decision,
                $po['po_number'].' for '.$po['trip_ref'].($reason?': '.$reason:''));
            Notify::user($p,(int)$po['requested_by'],'Diesel PO review',
                'Diesel PO '.$po['po_number'].' for '.$po['trip_ref'].' is '.$status.'.','trips');
            if($decision==='approve') Notify::roles($p,['billing'],'Diesel SOA pending',
                $po['trip_ref'].': PO '.$po['po_number'].' awaits the driver\'s Supplier SOA after trip completion.','billing');
            return ['message'=>'Diesel PO '.$po['po_number'].' is '.$status.'. Cash fund status is unchanged.'];
        });
    }

    /** Billing confirms physical handover, attaching the SOA if not previously uploaded. */
    public static function receive(array $u,array $d): array {
        requireRole($u,'billing');
        $id=idField($d,'billing_id');
        $poId=idField($d,'po_id');
        $driver=idField($d,'driver_id');
        $notes=optField($d,'receipt_notes',500);
        return transaction(function(PDO $p) use($u,$id,$poId,$driver,$notes) {
            must(self::ready($p),'Install the Diesel PO workflow migration first.',409);
            $b=one($p,'SELECT b.trip_id,t.trip_ref,t.status,t.driver_id,t.driver2_id
                FROM billings b JOIN trips t ON t.id=b.trip_id WHERE b.id=? FOR UPDATE',[$id]);
            must((bool)$b,'Billing record not found.',404);
            must($b['status']==='Completed','Receive Supplier SOA only after trip completion.',409);
            must(in_array($driver,array_filter([(int)$b['driver_id'],(int)$b['driver2_id']]),true),
                'Select a driver assigned to this trip.',422);
            $po=one($p,'SELECT * FROM diesel_purchase_orders WHERE trip_id=? AND id=? FOR UPDATE',[$b['trip_id'],$poId]);
            must((bool)$po,'No independently tracked Diesel PO exists for this trip.',409);
            must($po['status']==='Awaiting SOA','The Diesel PO must be approved and awaiting SOA.',409);
            Files::store($p,$u,'supplier_soa','trip',(int)$b['trip_id'],'Supplier SOA');
            must(Files::count($p,'trip',(int)$b['trip_id'],'Supplier SOA')>0,
                'Attach the supplier SOA or use an existing document before confirming handover.',422);
            run($p,"UPDATE diesel_purchase_orders SET status='SOA Received',received_by=?,received_driver_id=?,
                    received_at=NOW(),receipt_notes=? WHERE id=?",[$u['id'],$driver,$notes,$po['id']]);
            audit($p,$u['id'],'Diesel PO','po '.$po['id'],'supplier SOA received',
                $po['po_number'].' for '.$b['trip_ref'].' from assigned driver '.$driver);
            return ['message'=>'Supplier SOA received by Billing. Diesel PO is ready for matching; no payment was recorded.'];
        });
    }

    public static function verify(array $u,array $d): array {
        requireRole($u,'billing');
        $id=idField($d,'billing_id');
        $poId=idField($d,'po_id');
        $decision=choiceField($d,'decision',['match','discrepancy']);
        $notes=$decision==='discrepancy'?field($d,'notes',500):optField($d,'notes',500);
        return transaction(function(PDO $p) use($u,$id,$poId,$decision,$notes) {
            must(self::ready($p),'Install the Diesel PO workflow migration first.',409);
            $b=one($p,'SELECT trip_id FROM billings WHERE id=?',[$id]);
            must((bool)$b,'Billing record not found.',404);
            $po=one($p,'SELECT * FROM diesel_purchase_orders WHERE trip_id=? AND id=? FOR UPDATE',[$b['trip_id'],$poId]);
            must($po && in_array($po['status'],['SOA Received','Discrepancy'],true),
                'Billing must receive the Supplier SOA before matching.',409);
            must(Files::count($p,'trip',(int)$b['trip_id'],'Supplier SOA')>0,
                'Supplier SOA attachment is missing.',422);
            $status=$decision==='match'?'Verified':'Discrepancy';
            run($p,'UPDATE diesel_purchase_orders SET status=?,verified_by=?,verified_at=NOW(),verification_notes=? WHERE id=?',
                [$status,$u['id'],$notes,$po['id']]);
            audit($p,$u['id'],'Diesel PO','po '.$po['id'],'supplier SOA '.$decision,
                $po['po_number'].($notes?': '.$notes:''));
            if($status==='Discrepancy') Notify::roles($p,['operations_head'],'Diesel SOA discrepancy',
                'Diesel PO '.$po['po_number'].' requires review: '.$notes,'billing');
            return ['message'=>'Diesel PO '.$po['po_number'].' marked '.$status.'. This does not release cash or mark the PO paid.'];
        });
    }
}
