<?php
declare(strict_types=1);
core('DispatcherPlanning');

/** Read-only workload projection. Responsibility is group/shift; recorded actors are separate. */
final class DispatcherMonitoring {
    public static function operationalCounts(PDO $p): array {
        return one($p, "SELECT
            COALESCE(SUM(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected')),0) AS active,
            COALESCE(SUM(t.status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule')),0) AS attention,
            COALESCE(SUM(EXISTS(SELECT 1 FROM incidents i WHERE i.trip_id=t.id AND i.status<>'Resolved')),0) AS incidents,
            COALESCE(SUM(t.status='Completed' AND EXISTS(SELECT 1 FROM trip_assignments a WHERE a.trip_id=t.id AND a.resource_type='vehicle')),0) AS arrival
            FROM trips t");
    }

    public static function read(array $u, array $q): array {
        requireRole($u, 'operations_head');
        return self::projection(db(), $q);
    }

    public static function statuses(string $tab): array {
        return $tab === 'history' ? Trips::CLOSED : array_values(array_diff(Trips::STATUSES, ['Pending Review', ...Trips::CLOSED]));
    }

    /** Read-only projection; the public entry point enforces Operations Head access. */
    private static function projection(PDO $p, array $q): array {
        $groups = DispatcherPlanning::groups();
        $roles = array_values(array_unique(array_column($groups, 'role')));
        $role = (optField($q,'group',60) ?? '');
        must($role === '' || in_array($role, $roles, true), 'Choose a supported Dispatcher group.');
        $shift = (optField($q,'shift',20) ?? '');
        must($shift === '' || in_array($shift, [...DispatcherPlanning::SHIFTS, 'legacy'], true), 'Choose a supported shift.');
        $responsibility = 'dispatcher_role IN ('.implode(',', array_fill(0, count($roles), '?')).')';
        $counts = many($p, "SELECT dispatcher_role AS role,dispatcher_shift AS shift,COUNT(*) AS total,
            SUM(status NOT IN ('Pending Review','Completed','Cancelled','Rejected')) AS active,
            SUM(status='Completed') AS completed,
            SUM(status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule')) AS attention
            FROM trips WHERE $responsibility GROUP BY dispatcher_role,dispatcher_shift", $roles);
        foreach ($counts as $count) if ($count['shift'] === null && in_array($count['role'], $roles, true)) {
            $groups[] = ['role' => $count['role'], 'shift' => null, 'key' => $count['role'].':legacy', 'label' => ROLE_LABELS[$count['role']].' - Legacy unspecified shift'];
        }
        foreach ($groups as &$group) {
            $match = array_values(array_filter($counts, fn($c) => $c['role'] === $group['role'] && $c['shift'] === $group['shift']))[0] ?? [];
            foreach (['total','active','completed','attention'] as $key) $group[$key] = (int)($match[$key] ?? 0);
        }
        unset($group);
        $where = ['t.'.$responsibility]; $args = $roles;
        if ($role !== '') { $where[] = 't.dispatcher_role=?'; $args[] = $role; }
        if ($shift === 'legacy') $where[] = 't.dispatcher_shift IS NULL';
        elseif ($shift !== '') { $where[] = 't.dispatcher_shift=?'; $args[] = $shift; }
        $base = implode(' AND ', $where);
        $summary = one($p, "SELECT COUNT(*) AS total,
            COALESCE(SUM(t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected')),0) AS active,
            COALESCE(SUM(t.status='Completed'),0) AS completed,
            COALESCE(SUM(t.status IN ('Awaiting Resources','On Hold - Incident Reported','For Reschedule')),0) AS attention
            FROM trips t WHERE $base", $args);
        $tab = ($q['tab'] ?? '') === 'history' ? 'history' : 'active';
        $where[] = $tab === 'history' ? "t.status IN ('Completed','Cancelled','Rejected')" : "t.status NOT IN ('Pending Review','Completed','Cancelled','Rejected')";
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
        return ['groups'=>$groups,'summary'=>array_map('intval',$summary),'rows'=>$rows,'tab'=>$tab,'total'=>$total,'page'=>$page,'pages'=>$pages,'pageSize'=>12,'statuses'=>$statuses];
    }
}
