<?php
/**
 * Centralized approval inbox, read-only.
 * Decision authority and mutations remain in original owning modules.
 */
declare(strict_types=1);
final class Approvals {
    public static function read(array $u, string $page, array $q): array {
        must($page === 'approvals', 'Unknown approval page.', 404);
        core('Access');
        $role = (string)$u['role'];
        $p = db();
        if ($role === 'admin') {
            Actions::load('Oversight');
            return readSections(['queue' => fn() => Oversight::queue($u, $p, true)]);
        }
        if ($role === 'finance') {
            return readSections(['queue' => static function () use ($p): array {
                $purchaseOrders = array_map(static fn(array $o): array => [
                    'key' => 'po:'.$o['id'], 'kind'=>'po', 'ref'=>$o['po_ref'], 'type'=>'Purchase order',
                    'dept'=>'Purchasing', 'requester'=>$o['requester'], 'submitted'=>$o['created_at'],
                    'amount'=>(float)$o['total_amount'], 'status'=>'Pending',
                    'summary'=>trim((string)$o['supplier'].' · '.(string)$o['purpose'], ' · '),
                    'go'=>'purchase_orders?open='.$o['id'], 'actionable'=>true
                ], many($p, "SELECT o.id,o.po_ref,o.created_at,o.total_amount,o.purpose,
                           COALESCE(o.supplier_name,s.name) AS supplier, u.full_name AS requester
                           FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id
                           JOIN users u ON u.id=o.requested_by
                           WHERE o.status='Pending Approval' AND o.approver_role='finance'
                           ORDER BY o.created_at ASC LIMIT 300"));
                // Finance is responsible for releasing approved trip funds, not approving them.
                // Pending requests are visible for tracking, but their decision remains with Operations Head.
                core('Settings');
                $releaseLeadSeconds = (int)round(Settings::value('fund_release_lead_hours') * 3600);
                $funds = array_map(static function (array $f) use ($releaseLeadSeconds): array {
                    $dispatch = strtotime((string)$f['scheduled_at']);
                    $opensAt = $dispatch === false ? null : $dispatch - $releaseLeadSeconds;
                    $ready = $f['status'] === 'Ready for Release';
                    $canRelease = $ready && $opensAt !== null && time() >= $opensAt
                        && !in_array($f['trip_status'], ['Cancelled', 'Rejected', 'Completed'], true);
                    return [
                        'key'=>'fund:'.$f['id'], 'kind'=>'fund_release', 'ref'=>$f['fund_ref'],
                        'type'=>'Trip fund request', 'dept'=>'Operations', 'requester'=>$f['requester'],
                        'submitted'=>$f['created_at'], 'amount'=>(float)$f['amount'],
                        'status'=>$ready ? 'Ready for Release' : 'Awaiting Operations Head',
                        'summary'=>'Trip '.$f['trip_ref'],
                        'go'=>'funds?open='.$f['id'], 'actionable'=>$ready,
                        'release_allowed_now'=>$canRelease,
                        'release_opens_at'=>$opensAt === null ? null : date('Y-m-d H:i:s', $opensAt)
                    ];
                }, many($p, "SELECT f.id,f.fund_ref,f.created_at,f.amount,f.status,t.trip_ref,
                                  t.scheduled_at,t.status AS trip_status,u.full_name AS requester
                           FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                           JOIN users u ON u.id=f.requested_by
                           WHERE f.status IN ('Pending Approval','Ready for Release')
                           ORDER BY f.created_at ASC LIMIT 300"));
                return array_merge($purchaseOrders, $funds);
            }]);
        }
        if ($role === 'operations_head') {
            return readSections(['queue' => fn() => array_map(static fn(array $f): array => [
                'key'=>'fund:'.$f['id'],'kind'=>'fund','ref'=>$f['fund_ref'],'type'=>'Trip fund request',
                'dept'=>'Operations','requester'=>$f['requester'], 'submitted'=>$f['created_at'],
                'amount'=>(float)$f['amount'], 'status'=>'Pending',
                'summary'=>'Trip '.$f['trip_ref'], 'go'=>'funds?open='.$f['id'], 'actionable'=>true
            ], many($p, "SELECT f.id,f.fund_ref,f.created_at,f.amount,t.trip_ref,u.full_name AS requester
                FROM fund_requests f JOIN trips t ON t.id=f.trip_id
                JOIN users u ON u.id=f.requested_by
                WHERE f.status='Pending Approval' ORDER BY f.created_at ASC LIMIT 300"))]);
        }
        // These roles do not have an approval decision in the existing backend.
        return ['queue'=>[], '_errors'=>[]];
    }
    public static function action(array $u, string $action, array $d): array {
        throw new BusinessRuleException('Decisions must be made in their authorized department workflows.', 404);
    }
}
