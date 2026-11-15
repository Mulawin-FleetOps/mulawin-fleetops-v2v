<?php
declare(strict_types=1);
core('DispatcherPlanning');

/** Read-only workload projection. Responsibility is group/shift; recorded actors are separate. */
final class DispatcherMonitoring {
    public static function operationalCounts(PDO $p): array {
        return one($p, "SELECT
            COALESCE(SUM(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected','Missed')),0) AS active,
            COALESCE(SUM(t.status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule')),0) AS attention,
            COALESCE(SUM(EXISTS(SELECT 1 FROM incidents i WHERE i.trip_id=t.id AND i.status<>'Resolved')),0) AS incidents,
            COALESCE(SUM(t.status='Completed' AND EXISTS(SELECT 1 FROM trip_assignments a WHERE a.trip_id=t.id AND a.resource_type='vehicle')),0) AS arrival
            FROM trips t");
    }

    public static function read(array $u, array $q): array {
        requireRole($u, 'operations_head');
        $p = db(); Trips::closeOverdueUnassigned($p);
        return self::projection($p, $q);
    }

    public static function statuses(string $tab): array {
        return $tab === 'history' ? Trips::CLOSED : array_values(array_diff(Trips::STATUSES, ['Pending Review', ...Trips::CLOSED]));
    }

    /** Read-only projection; the public entry point enforces Operations Head access. */
    private static function projection(PDO $p, array $q): array {
        $planningGroups = DispatcherPlanning::groups();
        $roles = array_values(array_unique(array_column($planningGroups, 'role')));
        // Workload belongs to current responsible Dispatcher accounts; the
        // historical role/shift on trips remains for filtering and audit.
        $accounts = many($p, "SELECT u.id,u.full_name,u.role,u.shift,u.dispatcher_truck_type,u.dispatcher_truck_types,
            COUNT(t.id) AS total,
            COALESCE(SUM(CASE WHEN t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected','Missed') THEN 1 ELSE 0 END),0) AS active,
            COALESCE(SUM(CASE WHEN t.status='Completed' THEN 1 ELSE 0 END),0) AS completed,
            COALESCE(SUM(CASE WHEN t.status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule') THEN 1 ELSE 0 END),0) AS attention
            FROM users u
            LEFT JOIN trip_responsibilities r ON r.current_dispatcher_id=u.id
            LEFT JOIN trips t ON t.id=r.trip_id
            WHERE u.active=1 AND u.role IN ('car_carrier_dispatcher','container_wingvan_dispatcher')
                AND u.shift IN ('Day','Night')
            GROUP BY u.id,u.full_name,u.role,u.shift,u.dispatcher_truck_type,u.dispatcher_truck_types
            ORDER BY u.shift,u.full_name,u.id");
        $groups = [];
        foreach ($accounts as $account) {
            $types = json_decode((string)($account['dispatcher_truck_types'] ?? ''),true);
            if (!is_array($types) || !$types) {
                $types = !empty($account['dispatcher_truck_type'])
                    ? [$account['dispatcher_truck_type']]
                    : ($account['role']==='car_carrier_dispatcher'?['Car Carrier']:['Container','Wing Van']);
            }
            $types = array_values(array_unique(array_filter($types,fn($type)=>
                is_string($type)&&in_array($type,TRUCK_TYPES,true))));
            $groups[] = [
                'account_id'=>(int)$account['id'],'role'=>$account['role'],'shift'=>$account['shift'],
                'key'=>'account:'.$account['id'],'label'=>$account['full_name'],'types'=>$types,
                'total'=>(int)$account['total'],'active'=>(int)$account['active'],
                'completed'=>(int)$account['completed'],'attention'=>(int)$account['attention']
            ];
        }
        $role = (optField($q,'group',60) ?? '');
        must($role === '' || in_array($role, $roles, true), 'Choose a supported Dispatcher group.');
        $shift = (optField($q,'shift',20) ?? '');
        must($shift === '' || in_array($shift, [...DispatcherPlanning::SHIFTS, 'legacy'], true), 'Choose a supported shift.');
        $responsibility = 'dispatcher_role IN ('.implode(',', array_fill(0, count($roles), '?')).')';
        $where = ['t.'.$responsibility]; $args = $roles;
        if ($role !== '') { $where[] = 't.dispatcher_role=?'; $args[] = $role; }
        $dispatcherId = optId($q,'dispatcher_id');
        if ($dispatcherId !== null) {
            must((bool)one($p, "SELECT 1 FROM users WHERE id=? AND role IN ('car_carrier_dispatcher','container_wingvan_dispatcher')",
                [$dispatcherId]), 'Choose a valid Dispatcher account.');
            $where[] = 'EXISTS (SELECT 1 FROM trip_responsibilities owner WHERE owner.trip_id=t.id AND owner.current_dispatcher_id=?)';
            $args[] = $dispatcherId;
        }
        if ($shift === 'legacy') $where[] = 't.dispatcher_shift IS NULL';
        elseif ($shift !== '') { $where[] = 't.dispatcher_shift=?'; $args[] = $shift; }
        $base = implode(' AND ', $where);
        $summary = one($p, "SELECT COUNT(*) AS total,
            COALESCE(SUM(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected','Missed')),0) AS active,
            COALESCE(SUM(t.status='Completed'),0) AS completed,
            COALESCE(SUM(t.status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule')),0) AS attention
            FROM trips t WHERE $base", $args);
        $tab = ($q['tab'] ?? '') === 'history' ? 'history' : 'active';
        $where[] = $tab === 'history' ? "t.status IN ('Completed','Cancelled','Rejected','Missed')" : "t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected','Missed')";
        $statuses = self::statuses($tab);
        if (($status = (optField($q,'status',60) ?? '')) !== '') { must(in_array($status, $statuses, true), 'Choose a trip status valid for the selected monitoring tab.'); $where[] = 't.status=?'; $args[] = $status; }
        $from = (optField($q,'from',10) ?? ''); $to = (optField($q,'to',10) ?? '');
        if ($from !== '') { dateField(['from'=>$from], 'from'); $where[] = 'DATE(t.scheduled_at)>=?'; $args[] = $from; }
        if ($to !== '') { dateField(['to'=>$to], 'to'); $where[] = 'DATE(t.scheduled_at)<=?'; $args[] = $to; }
        must(!$from || !$to || $from <= $to, 'The date range is inverted.');
        $search = (optField($q,'search',200) ?? '');
        must(textLength($search) <= 200, 'Search is too long.');
        if ($search !== '') { $where[] = '(t.trip_ref LIKE ? OR c.company_name LIKE ? OR t.pickup_point LIKE ? OR t.delivery_point LIKE ? OR v.plate_number LIKE ?)'; array_push($args, ...array_fill(0,5,'%'.$search.'%')); }
        $sql = " FROM trips t JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE ".implode(' AND ', $where);
        $total = (int)one($p, 'SELECT COUNT(*) AS n'.$sql, $args)['n'];
        // The shared API reserves `page` for the authorized screen identifier.
        $pages = max(1, (int)ceil($total / 12)); $page = max(1, min($pages, (int)($q['trip_page'] ?? 1))); $offset = ($page - 1)*12;
        $rows = many($p, 'SELECT t.id,t.trip_ref,c.company_name AS client,t.pickup_point,t.delivery_point,t.truck_type,v.plate_number,t.scheduled_at,t.status,t.dispatcher_role,t.dispatcher_shift,t.completed_at'.$sql." ORDER BY t.scheduled_at DESC,t.id DESC LIMIT 12 OFFSET $offset", $args);
        return ['groups'=>$groups,
            'roleOptions'=>array_values(array_reduce($planningGroups,function($result,$group){
                $result[$group['role']]=['role'=>$group['role'],'label'=>ROLE_LABELS[$group['role']]];
                return $result;
            },[])),
            'summary'=>array_map('intval',$summary),'rows'=>$rows,'tab'=>$tab,'total'=>$total,'page'=>$page,'pages'=>$pages,'pageSize'=>12,'statuses'=>$statuses];
    }
}
