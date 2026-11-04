<?php
/*
 * =====================================================================
 *  backend/Modules/General/Analytics.php  —  DASHBOARD and REPORTS
 * =====================================================================
 *  Dashboard (every role): the current operational state of the fleet and
 *  the work waiting for this role. Objective 4.3 / 4.4.
 *
 *  Reports (Objective 5, descriptive and diagnostic analytics; PDF #11 IV):
 *   5.1 Trip summary with % change vs the previous period of the same length
 *   5.2 Trip volume, delays and incidents per driver, helper, truck, client, dispatcher
 *   5.3 Trucks with the highest downtime and maintenance expenses (parts + other costs)
 *   5.4 Billed vs collected vs expenses, outstanding receivables, overdue, aging,
 *       profit per completed trip
 *   5.5 Inventory movements (stock-in, stock-out, adjustments) and inventory value
 *  Every number is computed from the database records (no sample figures).
 * =====================================================================
 */
declare(strict_types=1);
core('Settings');
core('Notify');

final class Analytics {
    public static function read(array $u, string $page, array $q): array {
        return $page === 'dashboard' ? self::dashboard($u) : self::reports($u, $q);
    }
    public static function action(array $u, string $action, array $d): array {
        throw new BusinessRuleException('Unknown action.', 404);
    }

    private static function n(PDO $p, string $sql, array $a = []): float { return (float)(one($p, $sql, $a)['n'] ?? 0); }

    // =================================================================
    // DASHBOARD
    // =================================================================
    private static function dashboard(array $u): array {
        $p = db();
        Notify::dailyReminders($p);
        $r = $u['role'];
        $alerts = []; $cards = []; $charts = []; $tables = [];
        $alert = function (float $n, string $text, string $page, string $level = 'warning') use (&$alerts) { if ($n > 0) $alerts[] = ['text' => (int)$n . ' ' . $text, 'page' => $page, 'level' => $level]; };
        // ---- facts read straight from the records
        $fs = array_column(many($p, "SELECT status, COUNT(*) AS n FROM vehicles WHERE active=1 GROUP BY status"), 'n', 'status');
        $truckTotal = array_sum(array_map('intval', $fs));
        $crew = one($p, "SELECT SUM(person_type='Driver') AS drivers, SUM(person_type='Driver' AND availability='Available') AS drivers_free,
            SUM(person_type='Helper') AS helpers, SUM(person_type='Helper' AND availability='Available') AS helpers_free FROM personnel WHERE active=1");
        $mech = one($p, "SELECT COUNT(*) AS total, SUM(availability='Available') AS free, SUM(availability='Assigned') AS busy FROM mechanics WHERE active=1");
        $ongoing = self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status IN ('Dispatched','On Hold - Incident Reported','In Transit')");
        $pending = self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status IN ('Pending Review','Awaiting Resources','Pre-Assigned','Ready for Dispatch')");
        $completedMonth = self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status='Completed' AND completed_at>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')");
        $openCm = self::n($p, "SELECT COUNT(*) AS n FROM maintenance_jobs WHERE open_key=1");
        $underRepair = (int)($fs['Under Maintenance'] ?? 0);
        $unavailable = $underRepair + (int)($fs['Unavailable'] ?? 0);

        $fleetCards = [
            ['label' => 'Total trucks', 'value' => $truckTotal, 'icon' => 'bi-truck', 'page' => 'trucks', 'group' => 'Fleet'],
            ['label' => 'Available trucks', 'value' => (int)($fs['Available'] ?? 0), 'icon' => 'bi-check-circle', 'color' => 'green', 'page' => 'trucks', 'group' => 'Fleet'],
            ['label' => 'Assigned or on trip', 'value' => (int)($fs['Assigned'] ?? 0) + (int)($fs['On Trip'] ?? 0), 'icon' => 'bi-signpost-split', 'color' => 'blue', 'page' => 'trucks', 'group' => 'Fleet',
             'hint' => (int)($fs['Assigned'] ?? 0) . ' assigned · ' . (int)($fs['On Trip'] ?? 0) . ' on the road'],
            ['label' => 'Unavailable trucks', 'value' => $unavailable, 'icon' => 'bi-slash-circle', 'color' => 'red', 'page' => 'trucks', 'group' => 'Fleet',
             'hint' => $underRepair . ' under repair · ' . (int)($fs['Unavailable'] ?? 0) . ' set unavailable'],
        ];
        $tripCards = [
            ['label' => 'Available drivers', 'value' => (int)$crew['drivers_free'] . ' / ' . (int)$crew['drivers'], 'icon' => 'bi-person-badge', 'color' => 'green', 'page' => 'crew', 'group' => 'Trips and crew',
             'hint' => (int)$crew['helpers_free'] . ' / ' . (int)$crew['helpers'] . ' helpers available'],
            ['label' => 'Ongoing trips', 'value' => $ongoing, 'icon' => 'bi-geo-alt', 'color' => 'blue', 'page' => 'trips', 'group' => 'Trips and crew', 'hint' => (int)$pending . ' not yet dispatched'],
            ['label' => 'Completed trips this month', 'value' => $completedMonth, 'icon' => 'bi-flag', 'color' => 'green', 'page' => 'trips', 'group' => 'Trips and crew'],
        ];
        $maintCards = [
            ['label' => 'Trucks under corrective maintenance', 'value' => $underRepair, 'icon' => 'bi-wrench-adjustable', 'color' => $underRepair ? 'red' : 'green', 'page' => 'maintenance', 'group' => 'Corrective maintenance'],
            ['label' => 'Open repair requests', 'value' => $openCm, 'icon' => 'bi-clipboard-pulse', 'color' => $openCm ? 'amber' : 'green', 'page' => 'maintenance', 'group' => 'Corrective maintenance'],
            ['label' => 'Available mechanics', 'value' => (int)$mech['free'] . ' / ' . (int)$mech['total'], 'icon' => 'bi-person-gear', 'color' => 'green', 'page' => 'mechanics', 'group' => 'Corrective maintenance',
             'hint' => (int)$mech['busy'] . ' assigned to a repair'],
        ];
        $activeTrips = fn(string $scope = '', array $args = []) => many($p, "SELECT t.id, t.trip_ref, t.status, t.scheduled_at, c.company_name AS client, v.plate_number, d.full_name AS driver_name, t.truck_type
            FROM trips t JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN personnel d ON d.id=t.driver_id
            WHERE t.status NOT IN ('Completed','Cancelled','Rejected') $scope ORDER BY FIELD(t.status,'On Hold - Incident Reported','For Reschedule','Pending Review','Awaiting Resources','Ready for Dispatch','Pre-Assigned','Dispatched','In Transit'), t.scheduled_at LIMIT 10", $args);
        $tripCols = [['Trip', 'trip_ref'], ['Client', 'client'], ['Truck', 'plate_number'], ['Driver', 'driver_name'], ['Schedule', 'scheduled_at', 'datetime'], ['Status', 'status', 'badge']];
        $repairTable = fn() => ['title' => 'Trucks under corrective maintenance', 'page' => 'maintenance',
            'columns' => [['Record', 'job_ref'], ['Truck', 'plate_number'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Expected back', 'expected_completion', 'date']],
            'rows' => many($p, "SELECT m.job_ref, v.plate_number, m.problem, mc.full_name AS mechanic, IF(m.status='Completed','Awaiting verification', m.status) AS status, m.expected_completion
                FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id LEFT JOIN mechanics mc ON mc.id=m.mechanic_id WHERE m.open_key=1
                ORDER BY FIELD(m.priority,'Critical','High','Normal','Low'), m.id LIMIT 10"), 'empty' => 'No truck is under repair.'];
        $doneTable = fn() => ['title' => 'Recently completed repairs', 'page' => 'maintenance',
            'columns' => [['Record', 'job_ref'], ['Truck', 'plate_number'], ['Corrective action', 'repair_performed'], ['Mechanic', 'mechanic'], ['Returned to service', 'verified_at', 'datetime']],
            'rows' => many($p, "SELECT m.job_ref, v.plate_number, m.repair_performed, mc.full_name AS mechanic, m.verified_at FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id
                LEFT JOIN mechanics mc ON mc.id=m.mechanic_id WHERE m.verified_at IS NOT NULL ORDER BY m.verified_at DESC LIMIT 5"), 'empty' => 'No completed repair yet.'];

        if (in_array($r, ['admin', 'operations_head'], true)) {
            $cards = array_merge($fleetCards, $tripCards, $maintCards);
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status='Pending Review'"), 'trip request(s) waiting for your review', 'trips');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM fund_requests WHERE status='Pending Approval'"), 'fund request(s) waiting for approval', 'funds');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status='Awaiting Resources'"), 'trip(s) waiting for a free truck or crew', 'trips', 'info');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status='On Hold - Incident Reported'"), 'trip(s) on hold because of an incident', 'trips', 'danger');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips WHERE status IN ('Pre-Assigned','Ready for Dispatch') AND scheduled_at < NOW()"), 'trip(s) past the schedule and not yet dispatched (delayed)', 'trips', 'danger');
            if ($r === 'admin') {
                $alert(self::n($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status='Pending Approval' AND approver_role='admin'"), 'purchase order(s) above the limit waiting for your approval', 'purchasing');
                if (empty(one($p, 'SELECT recovery_hash FROM users WHERE id=?', [$u['id']])['recovery_hash'])) $alerts[] = ['text' => 'No Admin recovery code yet. Make one from your name menu > Recovery code.', 'level' => 'info'];
            }
            $docDays = (int)Settings::value('document_alert_days');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM vehicles WHERE active=1 AND ((registration_expiry IS NOT NULL AND registration_expiry<=DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)) OR (insurance_expiry IS NOT NULL AND insurance_expiry<=DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)))", [$docDays, $docDays]), "truck(s) with registration or insurance expiring within $docDays days", 'trucks', 'info');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM personnel WHERE active=1 AND license_expiry IS NOT NULL AND license_expiry<=DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)", [(int)Settings::value('license_alert_days')]), "driver license(s) expiring soon", 'crew', 'info');
            if ($r === 'admin') {
                $money = one($p, "SELECT (SELECT COALESCE(SUM(total_amount),0) FROM billings WHERE invoice_date>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')) AS billed,
                    (SELECT COALESCE(SUM(amount),0) FROM collections WHERE payment_date>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')) AS collected,
                    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE incurred_on>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')) AS spent,
                    (SELECT COALESCE(SUM(total_amount-amount_paid),0) FROM billings WHERE status IN ('Invoiced','Partially Paid')) AS receivable");
                foreach ([['Billed this month', 'billed', 'bi-receipt', 'billing'], ['Collected this month', 'collected', 'bi-cash-stack', 'billing'], ['Expenses this month', 'spent', 'bi-wallet2', 'finance'], ['Outstanding receivables', 'receivable', 'bi-hourglass-split', 'billing']] as [$l, $k, $i, $pg]) {
                    $cards[] = ['label' => $l, 'value' => (float)$money[$k], 'format' => 'money', 'icon' => $i, 'page' => $pg, 'group' => 'Money'];
                }
            }
            $tables[] = ['title' => 'Trips that need attention first', 'page' => 'trips', 'columns' => $tripCols, 'rows' => $activeTrips(), 'empty' => 'No open trips.'];
            $tables[] = $repairTable();
            $tables[] = $doneTable();
        } elseif (roleIsDispatcher($r)) {
            $cards = array_merge($fleetCards, [$tripCards[0]]);
            $scope = 'AND t.dispatcher_role=?'; $a = [$r];
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips t WHERE t.status='Pre-Assigned' $scope AND NOT EXISTS (SELECT 1 FROM fund_requests f WHERE f.trip_id=t.id AND f.attempt_number=t.attempt_number) AND t.attempt_number=1", $a), 'pre-assigned trip(s) need a fund request', 'trips');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips t WHERE t.status='Pre-Assigned' $scope", $a), 'trip(s) need the pre-dispatch checklist', 'trips');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM fund_requests f JOIN trips t ON t.id=f.trip_id WHERE f.status='Rejected' AND t.status NOT IN ('Completed','Cancelled','Rejected') $scope", $a), 'rejected fund request(s) to revise', 'funds', 'danger');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips t JOIN fund_requests f ON f.trip_id=t.id AND f.attempt_number=t.attempt_number WHERE t.status='Ready for Dispatch' AND f.status='Released' $scope", $a), 'trip(s) ready: Confirm Dispatch', 'trips', 'success');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips t JOIN incidents i ON i.trip_id=t.id WHERE i.status='Repaired - Cleared to Continue' $scope", $a), 'trip(s) cleared to continue (Resume Trip)', 'trips', 'success');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM trips t WHERE t.status='For Reschedule' $scope", $a), 'trip(s) for reschedule', 'trips', 'danger');
            $tables[] = ['title' => 'My open trips', 'page' => 'trips', 'columns' => $tripCols, 'rows' => $activeTrips($scope, $a), 'empty' => 'No open trips.'];
        } elseif ($r === 'motorpool') {
            $cards = array_merge($maintCards, [$fleetCards[0], $fleetCards[1]]);
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM maintenance_jobs WHERE source='Incident' AND status='Reported'"), 'trip incident(s) waiting for your assessment', 'maintenance', 'danger');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM maintenance_jobs WHERE source='On-Premise' AND status='Reported'"), 'reported problem(s) without a mechanic', 'maintenance');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM maintenance_jobs WHERE status='Completed' AND verified_at IS NULL"), 'completed repair(s) waiting for verification (truck still out of service)', 'maintenance');
            $tables[] = $repairTable();
            $tables[] = $doneTable();
        } elseif ($r === 'purchasing') {
            $inv = one($p, 'SELECT COUNT(*) AS parts, COALESCE(SUM(quantity_on_hand*unit_cost),0) AS value, SUM(reorder_level>0 AND quantity_on_hand<=reorder_level) AS low FROM parts WHERE active=1');
            $cards = [['label' => 'Parts in inventory', 'value' => (int)$inv['parts'], 'icon' => 'bi-box-seam', 'page' => 'purchasing'],
                      ['label' => 'Inventory value', 'value' => (float)$inv['value'], 'format' => 'money', 'icon' => 'bi-cash', 'page' => 'purchasing'],
                      ['label' => 'Low-stock items', 'value' => (int)$inv['low'], 'icon' => 'bi-exclamation-triangle', 'color' => (int)$inv['low'] ? 'red' : 'green', 'page' => 'purchasing']];
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM part_requests WHERE status='Requested'"), 'parts request(s) to check and release', 'purchasing');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('Approved','Partially Received')"), 'approved purchase order(s) waiting for delivery', 'purchasing', 'info');
            $alert((float)$inv['low'], 'low-stock item(s)', 'purchasing', 'danger');
            $tables[] = ['title' => 'Low-stock items', 'page' => 'purchasing', 'columns' => [['Part', 'part_number'], ['Description', 'description'], ['On hand', 'quantity_on_hand'], ['Reorder level', 'reorder_level']],
                         'rows' => many($p, 'SELECT part_number, description, quantity_on_hand, reorder_level FROM parts WHERE active=1 AND reorder_level>0 AND quantity_on_hand<=reorder_level ORDER BY quantity_on_hand'), 'empty' => 'No low-stock items.'];
        } elseif ($r === 'finance') {
            $b = one($p, "SELECT amount-reserved_amount-spent_amount AS available, reserved_amount FROM budgets WHERE status='Active' AND category='Purchasing' ORDER BY id DESC LIMIT 1");
            $cards = [
                ['label' => 'Funds ready for release', 'value' => self::n($p, "SELECT COALESCE(SUM(amount),0) AS n FROM fund_requests WHERE status='Ready for Release'"), 'format' => 'money', 'icon' => 'bi-cash-coin', 'page' => 'funds'],
                ['label' => 'PO payables (received, unpaid)', 'value' => self::n($p, "SELECT COALESCE(SUM((SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) - o.paid_amount),0) AS n FROM purchase_orders o WHERE o.payment_status IN ('Pending Payment','Partially Paid')"), 'format' => 'money', 'icon' => 'bi-receipt', 'page' => 'finance'],
                ['label' => 'Purchasing budget available', 'value' => (float)($b['available'] ?? 0), 'format' => 'money', 'icon' => 'bi-piggy-bank', 'color' => 'green', 'page' => 'finance', 'hint' => $b ? 'Reserved: PHP ' . number_format((float)$b['reserved_amount'], 2) : 'No active budget'],
                ['label' => 'Expenses this month', 'value' => self::n($p, "SELECT COALESCE(SUM(amount),0) AS n FROM expenses WHERE incurred_on>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')"), 'format' => 'money', 'icon' => 'bi-wallet2', 'page' => 'finance'],
            ];
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM fund_requests WHERE status='Ready for Release'"), 'approved trip fund(s) to release', 'funds');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status='Pending Approval' AND approver_role='finance'"), 'purchase order(s) waiting for your approval', 'purchasing');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM fund_requests f JOIN trips t ON t.id=f.trip_id WHERE f.status='Released' AND f.liquidation_status='Not Liquidated' AND t.status IN ('Completed','Cancelled')"), 'released fund(s) to liquidate', 'funds', 'info');
            if (!$b) $alerts[] = ['text' => 'No active purchasing budget. Purchase orders will be rejected until a budget is set (Finance > Purchasing budget).', 'page' => 'finance', 'level' => 'danger'];
        } elseif ($r === 'billing') {
            $cards = [
                ['label' => 'Ongoing trip drafts', 'value' => self::n($p, "SELECT COUNT(*) AS n FROM billings WHERE status='Ongoing'"), 'icon' => 'bi-hourglass', 'page' => 'billing'],
                ['label' => 'Completed trips for billing', 'value' => self::n($p, "SELECT COUNT(*) AS n FROM billings WHERE status='For Billing'"), 'icon' => 'bi-receipt', 'color' => 'amber', 'page' => 'billing'],
                ['label' => 'Outstanding balance', 'value' => self::n($p, "SELECT COALESCE(SUM(total_amount-amount_paid),0) AS n FROM billings WHERE status IN ('Invoiced','Partially Paid')"), 'format' => 'money', 'icon' => 'bi-hourglass-split', 'color' => 'red', 'page' => 'billing'],
                ['label' => 'Collected this month', 'value' => self::n($p, "SELECT COALESCE(SUM(amount),0) AS n FROM collections WHERE payment_date>=DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')"), 'format' => 'money', 'icon' => 'bi-cash-stack', 'color' => 'green', 'page' => 'billing'],
            ];
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM clients WHERE status='Pending Rate'"), 'new client(s) waiting for a billing rate', 'clients');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM billings WHERE status='For Billing'"), 'completed trip(s) to verify and invoice', 'billing');
            $alert(self::n($p, "SELECT COUNT(*) AS n FROM billings WHERE status IN ('Invoiced','Partially Paid') AND due_date<CURRENT_DATE()"), 'overdue invoice(s)', 'billing', 'danger');
        } else { // audit
            $cards = array_merge($fleetCards, $tripCards, $maintCards);
            $tables[] = ['title' => 'Latest activity', 'page' => 'admin', 'columns' => [['When', 'created_at', 'datetime'], ['Who', 'actor'], ['Area', 'area'], ['Action', 'action'], ['Details', 'details']],
                         'rows' => many($p, "SELECT a.created_at, COALESCE(u.full_name,'System') AS actor, a.area, a.action, a.details FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 20")];
        }
        return ['alerts' => $alerts, 'cards' => $cards, 'charts' => $charts, 'tables' => $tables];
    }

    // =================================================================
    // REPORTS
    // =================================================================
    private static function reports(array $u, array $q): array {
        $p = db();
        $from = self::date($q['from'] ?? '') ?? date('Y-m-01');
        $to = self::date($q['to'] ?? '') ?? date('Y-m-d');
        if ($to < $from) [$from, $to] = [$to, $from];
        $days = (int)((strtotime($to) - strtotime($from)) / 86400) + 1;
        $pFrom = date('Y-m-d', strtotime($from . " -$days days")); $pTo = date('Y-m-d', strtotime($from . ' -1 day'));
        $r = $u['role'];
        $sections = [];
        if (in_array($r, ['admin', 'operations_head', 'audit'], true)) $sections['trips'] = self::tripReport($p, $q, $from, $to, $pFrom, $pTo);
        if (in_array($r, ['admin', 'operations_head', 'motorpool', 'audit'], true)) $sections['fleet'] = self::fleetReport($p, $q, $from, $to);
        if (in_array($r, ['admin', 'finance', 'billing', 'audit'], true)) $sections['money'] = self::moneyReport($p, $q, $from, $to, $pFrom, $pTo);
        if (in_array($r, ['admin', 'purchasing', 'motorpool', 'finance', 'audit'], true)) $sections['stock'] = self::stockReport($p, $from, $to);
        return ['sections' => $sections, 'period' => ['from' => $from, 'to' => $to, 'prevFrom' => $pFrom, 'prevTo' => $pTo],
                'filterOptions' => readSections([
                    'clients' => fn() => many($p, 'SELECT id, company_name FROM clients ORDER BY company_name'),
                    'trucks' => fn() => many($p, 'SELECT id, plate_number FROM vehicles ORDER BY plate_number'),
                    'people' => fn() => many($p, 'SELECT id, full_name, person_type FROM personnel ORDER BY full_name'),
                    'dispatchers' => fn() => many($p, "SELECT id, full_name FROM users WHERE role IN ('car_carrier_dispatcher','container_wingvan_dispatcher') ORDER BY full_name"),
                ]), 'statuses' => ['Completed', 'Cancelled', 'For Reschedule', 'Dispatched', 'In Transit', 'On Hold - Incident Reported', 'Pre-Assigned', 'Ready for Dispatch', 'Pending Review', 'Awaiting Resources', 'Rejected']];
    }
    private static function date($v): ?string { $v = trim((string)$v); return ($v !== '' && DateTimeImmutable::createFromFormat('!Y-m-d', $v)) ? $v : null; }
    private static function pct(float $now, float $before): ?float { return $before == 0.0 ? null : round(($now - $before) / $before * 100, 1); }
    private static function change(float $now, float $before): string {
        $c = self::pct($now, $before);
        return $c === null ? ($now > 0 ? 'new this period (none before)' : 'no change') : (($c >= 0 ? '+' : '') . $c . '% vs previous period (' . (float)$before . ')');
    }

    /** 5.1 and 5.2: trips. Uses the trip schedule date for the period. */
    private static function tripReport(PDO $p, array $q, string $from, string $to, string $pFrom, string $pTo): array {
        Actions::load('Trips');
        $f = $q; unset($f['from'], $f['to']);
        [$w, $a] = Trips::filters($f);
        $sum = function (string $s, string $e) use ($p, $w, $a) {
            return one($p, "SELECT COUNT(*) AS total, SUM(t.status='Completed') AS completed, SUM(t.status='Cancelled') AS cancelled, SUM(t.status='For Reschedule') AS resched,
                    SUM(t.attempt_number>1) AS second_attempts, COALESCE(SUM(t.units_delivered),0) AS units,
                    (SELECT COUNT(*) FROM trip_updates up JOIN trips x ON x.id=up.trip_id WHERE up.update_type='Delay' AND DATE(x.scheduled_at) BETWEEN ? AND ?) AS delays,
                    (SELECT COUNT(*) FROM incidents i JOIN trips x ON x.id=i.trip_id WHERE DATE(x.scheduled_at) BETWEEN ? AND ?) AS incidents
                FROM trips t WHERE DATE(t.scheduled_at) BETWEEN ? AND ? $w", array_merge([$s, $e, $s, $e, $s, $e], $a));
        };
        $now = $sum($from, $to); $before = $sum($pFrom, $pTo);
        $cards = [];
        foreach ([['Total trips', 'total', 'bi-signpost-split'], ['Completed trips', 'completed', 'bi-flag'], ['Cancelled trips', 'cancelled', 'bi-x-circle'], ['Trips for reschedule', 'resched', 'bi-arrow-repeat'],
                  ['Delivered units (car carrier)', 'units', 'bi-car-front'], ['Recorded delays', 'delays', 'bi-clock-history'], ['Incidents', 'incidents', 'bi-exclamation-triangle']] as [$l, $k, $i]) {
            $cards[] = ['label' => $l, 'value' => (float)$now[$k], 'icon' => $i, 'hint' => self::change((float)$now[$k], (float)$before[$k])];
        }
        $by = function (string $col, string $nameSql, string $join) use ($p, $w, $a, $from, $to) {
            $rows = many($p, "SELECT $col AS gid, $nameSql AS name, COUNT(*) AS trips, SUM(t.status='Completed') AS completed, COALESCE(SUM(t.units_delivered),0) AS units,
                    SUM((SELECT COUNT(*) FROM trip_updates up WHERE up.trip_id=t.id AND up.update_type='Delay')) AS delays,
                    SUM((SELECT COUNT(*) FROM incidents i WHERE i.trip_id=t.id)) AS incidents
                FROM trips t $join WHERE DATE(t.scheduled_at) BETWEEN ? AND ? AND $col IS NOT NULL $w GROUP BY $col, $nameSql ORDER BY trips DESC", array_merge([$from, $to], $a));
            foreach ($rows as &$x) unset($x['gid']);
            return $rows;
        };
        $cols = [['Name', 'name'], ['Trips', 'trips', 'num'], ['Completed', 'completed', 'num'], ['Units', 'units', 'num'], ['Delays', 'delays', 'num'], ['Incidents', 'incidents', 'num']];
        $byDriver = $by('t.driver_id', 'd.full_name', 'LEFT JOIN personnel d ON d.id=t.driver_id');
        $byHelper = $by('t.helper_id', 'h.full_name', 'LEFT JOIN personnel h ON h.id=t.helper_id');
        $byTruck = $by('t.vehicle_id', 'v.plate_number', 'LEFT JOIN vehicles v ON v.id=t.vehicle_id');
        $byClient = $by('t.client_id', 'c.company_name', 'JOIN clients c ON c.id=t.client_id');
        $byDisp = $by('t.dispatcher_id', 'ds.full_name', 'LEFT JOIN users ds ON ds.id=t.dispatcher_id');
        $byType = many($p, "SELECT t.truck_type AS name, COUNT(*) AS trips FROM trips t WHERE DATE(t.scheduled_at) BETWEEN ? AND ? AND t.truck_type IS NOT NULL $w GROUP BY t.truck_type", array_merge([$from, $to], $a));
        $records = many($p, "SELECT t.trip_ref, t.status, t.truck_type, c.company_name AS client, v.plate_number, d.full_name AS driver_name, t.pickup_point, t.delivery_point,
                t.scheduled_at, t.dispatched_at, t.completed_at, t.units_delivered, t.waybill_number, t.attempt_number
            FROM trips t JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN personnel d ON d.id=t.driver_id
            WHERE DATE(t.scheduled_at) BETWEEN ? AND ? $w ORDER BY t.scheduled_at DESC LIMIT 2000", array_merge([$from, $to], $a));
        $issues = many($p, "SELECT * FROM (
                SELECT up.created_at AS at, t.trip_ref, 'Delay' AS kind, CONCAT(COALESCE(up.delay_cause,''), ': ', up.note) AS details, v.plate_number
                FROM trip_updates up JOIN trips t ON t.id=up.trip_id LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE up.update_type='Delay' AND DATE(t.scheduled_at) BETWEEN ? AND ? $w
                UNION ALL
                SELECT i.incident_at, t.trip_ref, CONCAT('Incident (', COALESCE(i.severity,'not assessed'), ')'), CONCAT(i.incident_type, ': ', i.problem, ' @ ', i.location), v.plate_number
                FROM incidents i JOIN trips t ON t.id=i.trip_id JOIN vehicles v ON v.id=i.vehicle_id WHERE DATE(t.scheduled_at) BETWEEN ? AND ? $w) z ORDER BY at DESC LIMIT 1000",
            array_merge([$from, $to], $a, [$from, $to], $a));
        $top = fn(array $rows) => array_slice($rows, 0, 12);
        return [
            'title' => 'Trips', 'cards' => $cards,
            'charts' => [
                ['type' => 'bar', 'horizontal' => true, 'title' => 'Trips per client', 'labels' => array_column($top($byClient), 'name'), 'datasets' => [['label' => 'Trips', 'data' => array_map('intval', array_column($top($byClient), 'trips'))]], 'how' => 'Trips scheduled in the period, top 12 clients.'],
                ['type' => 'doughnut', 'title' => 'Trips by truck type', 'labels' => array_column($byType, 'name'), 'datasets' => [['label' => 'Trips', 'data' => array_map('intval', array_column($byType, 'trips'))]]],
                ['type' => 'bar', 'horizontal' => true, 'title' => 'Delays and incidents per truck', 'labels' => array_column($top($byTruck), 'name'), 'stacked' => true,
                 'datasets' => [['label' => 'Delays', 'data' => array_map('intval', array_column($top($byTruck), 'delays'))], ['label' => 'Incidents', 'data' => array_map('intval', array_column($top($byTruck), 'incidents'))]],
                 'how' => 'Shows which trucks have recurring issues.'],
            ],
            'tables' => [
                ['title' => 'Per driver', 'columns' => $cols, 'rows' => $byDriver],
                ['title' => 'Per helper', 'columns' => $cols, 'rows' => $byHelper],
                ['title' => 'Per truck', 'columns' => $cols, 'rows' => $byTruck],
                ['title' => 'Per client', 'columns' => $cols, 'rows' => $byClient],
                ['title' => 'Per dispatcher', 'columns' => $cols, 'rows' => $byDisp],
                ['title' => 'Trip records (delivery and return)', 'columns' => [['Trip', 'trip_ref'], ['Status', 'status', 'badge'], ['Client', 'client'], ['Truck', 'plate_number'], ['Driver', 'driver_name'],
                    ['From', 'pickup_point'], ['To', 'delivery_point'], ['Schedule', 'scheduled_at', 'datetime'], ['Dispatched', 'dispatched_at', 'datetime'], ['Completed', 'completed_at', 'datetime'], ['Units', 'units_delivered'], ['Waybill', 'waybill_number'], ['Attempt', 'attempt_number']], 'rows' => $records],
                ['title' => 'Delays and incidents', 'columns' => [['When', 'at', 'datetime'], ['Trip', 'trip_ref'], ['Truck', 'plate_number'], ['Type', 'kind'], ['Details', 'details']], 'rows' => $issues],
            ],
        ];
    }

    /** 5.3: downtime (days Under Maintenance, from the truck status log) and maintenance cost per truck. */
    private static function fleetReport(PDO $p, array $q, string $from, string $to): array {
        $start = strtotime($from . ' 00:00:00'); $end = min(time(), strtotime($to . ' 23:59:59'));
        $down = [];
        foreach (many($p, 'SELECT id, plate_number, status FROM vehicles') as $v) $down[(int)$v['id']] = ['name' => $v['plate_number'], 'hours' => 0.0];
        $state = [];
        $logs = many($p, 'SELECT vehicle_id, from_status, to_status, UNIX_TIMESTAMP(created_at) AS ts FROM vehicle_status_log WHERE created_at<=? ORDER BY vehicle_id, id', [$to . ' 23:59:59']);
        foreach ($logs as $l) {
            $vid = (int)$l['vehicle_id']; $ts = (int)$l['ts'];
            if (isset($state[$vid]) && $state[$vid] !== null) { // was under maintenance since $state[$vid]
                $s = max($state[$vid], $start); $e = min($ts, $end);
                if ($e > $s && isset($down[$vid])) $down[$vid]['hours'] += ($e - $s) / 3600;
                $state[$vid] = null;
            }
            if ($l['to_status'] === 'Under Maintenance') $state[$vid] = $ts;
        }
        foreach ($state as $vid => $since) if ($since !== null && isset($down[$vid])) { $s = max($since, $start); if ($end > $s) $down[$vid]['hours'] += ($end - $s) / 3600; }
        $cost = many($p, "SELECT v.id, v.plate_number AS name,
                (SELECT COALESCE(SUM(l.released_qty*l.unit_cost),0) FROM part_request_lines l JOIN part_requests r ON r.id=l.part_request_id WHERE r.vehicle_id=v.id AND DATE(r.processed_at) BETWEEN ? AND ?) AS parts,
                (SELECT COALESCE(SUM(c.amount),0) FROM maintenance_costs c JOIN maintenance_jobs m ON m.id=c.maintenance_job_id WHERE m.vehicle_id=v.id AND c.incurred_on BETWEEN ? AND ?) AS other,
                (SELECT COUNT(*) FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND DATE(m.created_at) BETWEEN ? AND ?) AS jobs
            FROM vehicles v", [$from, $to, $from, $to, $from, $to]);
        $rows = [];
        foreach ($cost as $c) {
            $id = (int)$c['id'];
            $rows[] = ['name' => $c['name'], 'downtime_days' => round(($down[$id]['hours'] ?? 0) / 24, 1), 'jobs' => (int)$c['jobs'],
                       'parts' => (float)$c['parts'], 'other' => (float)$c['other'], 'total' => round((float)$c['parts'] + (float)$c['other'], 2)];
        }
        $byDown = $rows; usort($byDown, fn($x, $y) => $y['downtime_days'] <=> $x['downtime_days']);
        $byCost = $rows; usort($byCost, fn($x, $y) => $y['total'] <=> $x['total']);
        $byDown = array_values(array_filter($byDown, fn($x) => $x['downtime_days'] > 0 || $x['jobs'] > 0));
        $byCost = array_values(array_filter($byCost, fn($x) => $x['total'] > 0));
        $jobs = many($p, "SELECT m.job_ref, v.plate_number, m.source, m.severity, m.problem, m.status, m.created_at, m.completed_on FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id
            WHERE DATE(m.created_at) BETWEEN ? AND ? ORDER BY m.id DESC", [$from, $to]);
        $top = array_slice($byCost, 0, 12);
        return [
            'title' => 'Fleet and maintenance',
            'cards' => [
                ['label' => 'Maintenance records', 'value' => count($jobs), 'icon' => 'bi-tools'],
                ['label' => 'Completed', 'value' => count(array_filter($jobs, fn($j) => $j['status'] === 'Completed')), 'icon' => 'bi-check2-circle'],
                ['label' => 'Downtime (truck-days)', 'value' => round(array_sum(array_column($rows, 'downtime_days')), 1), 'icon' => 'bi-clock'],
                ['label' => 'Maintenance expenses', 'value' => round(array_sum(array_column($rows, 'total')), 2), 'format' => 'money', 'icon' => 'bi-cash'],
            ],
            'charts' => [
                ['type' => 'bar', 'horizontal' => true, 'stacked' => true, 'format' => 'money', 'title' => 'Maintenance cost per truck (highest first)', 'labels' => array_column($top, 'name'),
                 'datasets' => [['label' => 'Parts', 'data' => array_column($top, 'parts')], ['label' => 'Other', 'data' => array_column($top, 'other')]], 'how' => 'Parts released for the truck + labor / outside service costs.'],
                ['type' => 'bar', 'horizontal' => true, 'title' => 'Downtime per truck (days)', 'labels' => array_column(array_slice($byDown, 0, 12), 'name'),
                 'datasets' => [['label' => 'Days under maintenance', 'data' => array_column(array_slice($byDown, 0, 12), 'downtime_days')]], 'how' => 'Time each truck spent "Under Maintenance" in the period (truck status history).'],
            ],
            'tables' => [
                ['title' => 'Highest downtime', 'columns' => [['Truck', 'name'], ['Downtime (days)', 'downtime_days', 'num'], ['Maintenance records', 'jobs', 'num'], ['Total cost', 'total', 'money']], 'rows' => $byDown],
                ['title' => 'Highest maintenance expenses', 'columns' => [['Truck', 'name'], ['Parts', 'parts', 'money'], ['Other costs', 'other', 'money'], ['Total', 'total', 'money'], ['Downtime (days)', 'downtime_days', 'num']], 'rows' => $byCost],
                ['title' => 'Maintenance records', 'columns' => [['Record', 'job_ref'], ['Truck', 'plate_number'], ['Type', 'source'], ['Severity', 'severity'], ['Problem', 'problem'], ['Status', 'status', 'badge'], ['Started', 'created_at', 'date'], ['Completed', 'completed_on', 'date']], 'rows' => $jobs],
            ],
        ];
    }

    /** 5.4: billed vs collected vs expenses, receivables, aging, profit per completed trip. */
    private static function moneyReport(PDO $p, array $q, string $from, string $to, string $pFrom, string $pTo): array {
        $tot = fn(string $s, string $e) => one($p, "SELECT (SELECT COALESCE(SUM(total_amount),0) FROM billings WHERE invoice_date BETWEEN ? AND ?) AS billed,
            (SELECT COALESCE(SUM(amount),0) FROM collections WHERE payment_date BETWEEN ? AND ?) AS collected,
            (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE incurred_on BETWEEN ? AND ?) AS expenses", [$s, $e, $s, $e, $s, $e]);
        $now = $tot($from, $to); $before = $tot($pFrom, $pTo);
        $ar = one($p, "SELECT COALESCE(SUM(total_amount-amount_paid),0) AS outstanding, COALESCE(SUM(CASE WHEN due_date<CURRENT_DATE() THEN total_amount-amount_paid ELSE 0 END),0) AS overdue,
            COUNT(CASE WHEN due_date<CURRENT_DATE() THEN 1 END) AS overdue_n FROM billings WHERE status IN ('Invoiced','Partially Paid')");
        $aging = one($p, "SELECT COALESCE(SUM(CASE WHEN due_date>=CURRENT_DATE() THEN total_amount-amount_paid END),0) AS a0,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURRENT_DATE(),due_date) BETWEEN 1 AND 30 THEN total_amount-amount_paid END),0) AS a1,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURRENT_DATE(),due_date) BETWEEN 31 AND 60 THEN total_amount-amount_paid END),0) AS a2,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURRENT_DATE(),due_date) BETWEEN 61 AND 90 THEN total_amount-amount_paid END),0) AS a3,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURRENT_DATE(),due_date) > 90 THEN total_amount-amount_paid END),0) AS a4 FROM billings WHERE status IN ('Invoiced','Partially Paid')");
        $kpl = Settings::value('km_per_liter'); $price = Settings::value('fuel_price_per_liter');
        $profit = many($p, "SELECT t.trip_ref, c.company_name AS client, v.plate_number, t.completed_at, t.distance_km, b.total_amount AS billed, b.status AS billing_status,
                (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.trip_id=t.id) AS trip_expenses
            FROM trips t JOIN billings b ON b.trip_id=t.id JOIN clients c ON c.id=t.client_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
            WHERE t.status='Completed' AND DATE(t.completed_at) BETWEEN ? AND ? ORDER BY t.completed_at DESC", [$from, $to]);
        foreach ($profit as &$x) {
            $x['est_diesel'] = $kpl > 0 ? round((float)$x['distance_km'] / $kpl * $price, 2) : 0;
            $x['profit'] = round((float)$x['billed'] - (float)$x['trip_expenses'], 2);
            $x['profit_after_diesel'] = round($x['profit'] - $x['est_diesel'], 2);
        }
        unset($x);
        $expCat = many($p, 'SELECT category AS name, SUM(amount) AS total FROM expenses WHERE incurred_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', [$from, $to]);
        $byClient = many($p, "SELECT c.company_name AS name, COUNT(*) AS invoices, SUM(b.total_amount) AS billed, SUM(b.amount_paid) AS paid, SUM(b.total_amount-b.amount_paid) AS balance
            FROM billings b JOIN clients c ON c.id=b.client_id WHERE b.invoice_date BETWEEN ? AND ? GROUP BY c.company_name ORDER BY billed DESC", [$from, $to]);
        $overdue = many($p, "SELECT b.invoice_number, c.company_name AS client, b.invoice_date, b.due_date, b.total_amount, b.amount_paid, (b.total_amount-b.amount_paid) AS balance, DATEDIFF(CURRENT_DATE(), b.due_date) AS days_overdue
            FROM billings b JOIN clients c ON c.id=b.client_id WHERE b.status IN ('Invoiced','Partially Paid') AND b.due_date<CURRENT_DATE() ORDER BY days_overdue DESC");
        $unbilled = many($p, "SELECT t.trip_ref, c.company_name AS client, t.completed_at, b.total_amount FROM trips t JOIN billings b ON b.trip_id=t.id JOIN clients c ON c.id=t.client_id WHERE b.status='For Billing' ORDER BY t.completed_at");
        $avgProfit = $profit ? round(array_sum(array_column($profit, 'profit')) / count($profit), 2) : 0;
        return [
            'title' => 'Money',
            'cards' => [
                ['label' => 'Billed (invoices)', 'value' => (float)$now['billed'], 'format' => 'money', 'icon' => 'bi-receipt', 'hint' => self::change((float)$now['billed'], (float)$before['billed'])],
                ['label' => 'Collected', 'value' => (float)$now['collected'], 'format' => 'money', 'icon' => 'bi-cash-stack', 'hint' => self::change((float)$now['collected'], (float)$before['collected'])],
                ['label' => 'Expenses', 'value' => (float)$now['expenses'], 'format' => 'money', 'icon' => 'bi-wallet2', 'hint' => self::change((float)$now['expenses'], (float)$before['expenses'])],
                ['label' => 'Outstanding receivables', 'value' => (float)$ar['outstanding'], 'format' => 'money', 'icon' => 'bi-hourglass-split', 'hint' => 'All unpaid invoices today'],
                ['label' => 'Overdue', 'value' => (float)$ar['overdue'], 'format' => 'money', 'icon' => 'bi-exclamation-octagon', 'hint' => (int)$ar['overdue_n'] . ' overdue invoice(s)'],
                ['label' => 'Average profit per completed trip', 'value' => $avgProfit, 'format' => 'money', 'icon' => 'bi-graph-up', 'hint' => count($profit) . ' completed trip(s); billed minus recorded trip expenses'],
            ],
            'charts' => [
                ['type' => 'bar', 'format' => 'money', 'title' => 'Billed vs collected vs expenses', 'labels' => ['This period'],
                 'datasets' => [['label' => 'Billed', 'data' => [(float)$now['billed']]], ['label' => 'Collected', 'data' => [(float)$now['collected']]], ['label' => 'Expenses', 'data' => [(float)$now['expenses']]]]],
                ['type' => 'doughnut', 'format' => 'money', 'title' => 'Receivables aging', 'labels' => ['Not yet due', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'],
                 'datasets' => [['label' => 'Balance', 'data' => [(float)$aging['a0'], (float)$aging['a1'], (float)$aging['a2'], (float)$aging['a3'], (float)$aging['a4']]]], 'how' => 'Days past the due date of unpaid invoices.'],
                ['type' => 'bar', 'horizontal' => true, 'format' => 'money', 'title' => 'Expenses by category', 'labels' => array_column($expCat, 'name'), 'datasets' => [['label' => 'Expenses', 'data' => array_map('floatval', array_column($expCat, 'total'))]]],
            ],
            'tables' => [
                ['title' => 'Profit per completed trip', 'columns' => [['Trip', 'trip_ref'], ['Client', 'client'], ['Truck', 'plate_number'], ['Completed', 'completed_at', 'date'], ['Billed', 'billed', 'money'],
                    ['Trip expenses', 'trip_expenses', 'money'], ['Profit', 'profit', 'money'], ['Est. diesel', 'est_diesel', 'money'], ['Profit after est. diesel', 'profit_after_diesel', 'money']], 'rows' => $profit],
                ['title' => 'Billing by client', 'columns' => [['Client', 'name'], ['Invoices', 'invoices', 'num'], ['Billed', 'billed', 'money'], ['Paid', 'paid', 'money'], ['Balance', 'balance', 'money']], 'rows' => $byClient],
                ['title' => 'Overdue accounts', 'columns' => [['Invoice', 'invoice_number'], ['Client', 'client'], ['Invoice date', 'invoice_date', 'date'], ['Due', 'due_date', 'date'], ['Balance', 'balance', 'money'], ['Days overdue', 'days_overdue', 'num']], 'rows' => $overdue],
                ['title' => 'Completed trips not yet billed', 'columns' => [['Trip', 'trip_ref'], ['Client', 'client'], ['Completed', 'completed_at', 'date'], ['Draft amount', 'total_amount', 'money']], 'rows' => $unbilled],
            ],
            'note' => 'Profit per trip = billed amount minus the expenses recorded for that trip (released trip fund net of returned cash, and any other trip-linked expense). Estimated diesel = km / ' . $kpl . ' km per liter x PHP ' . $price . ' per liter (Settings).',
        ];
    }

    /** 5.5: inventory movements and value. */
    private static function stockReport(PDO $p, string $from, string $to): array {
        $m = many($p, "SELECT movement_type AS name, SUM(ABS(quantity_delta)) AS qty, SUM(ABS(quantity_delta)*unit_cost) AS value, SUM(quantity_delta) AS net FROM stock_movements WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY movement_type", [$from, $to]);
        $by = array_column($m, null, 'name');
        $value = (float)one($p, 'SELECT COALESCE(SUM(quantity_on_hand*unit_cost),0) AS v FROM parts WHERE active=1')['v'];
        $perPart = many($p, "SELECT pt.part_number, pt.description, pt.quantity_on_hand, ROUND(pt.quantity_on_hand*pt.unit_cost,2) AS value,
                COALESCE(SUM(CASE WHEN sm.movement_type='Stock In' THEN sm.quantity_delta END),0) AS stock_in,
                COALESCE(-SUM(CASE WHEN sm.movement_type='Stock Out' THEN sm.quantity_delta END),0) AS stock_out,
                COALESCE(SUM(CASE WHEN sm.movement_type='Adjustment' THEN sm.quantity_delta END),0) AS adjustments
            FROM parts pt LEFT JOIN stock_movements sm ON sm.part_id=pt.id AND DATE(sm.created_at) BETWEEN ? AND ? GROUP BY pt.id ORDER BY stock_out DESC, pt.part_number", [$from, $to]);
        $perTruck = many($p, "SELECT v.plate_number AS name, SUM(-sm.quantity_delta) AS qty, SUM(-sm.quantity_delta*sm.unit_cost) AS value FROM stock_movements sm JOIN vehicles v ON v.id=sm.vehicle_id
            WHERE sm.movement_type='Stock Out' AND DATE(sm.created_at) BETWEEN ? AND ? GROUP BY v.plate_number ORDER BY value DESC", [$from, $to]);
        $partial = many($p, "SELECT o.po_ref, s.name AS supplier, o.total_amount, o.status, o.payment_status FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.status='Partially Received' ORDER BY o.id");
        return [
            'title' => 'Inventory',
            'cards' => [
                ['label' => 'Stock-in (units)', 'value' => (float)($by['Stock In']['qty'] ?? 0), 'icon' => 'bi-box-arrow-in-down', 'hint' => 'PHP ' . number_format((float)($by['Stock In']['value'] ?? 0), 2)],
                ['label' => 'Stock-out (units)', 'value' => (float)($by['Stock Out']['qty'] ?? 0), 'icon' => 'bi-box-arrow-up', 'hint' => 'PHP ' . number_format((float)($by['Stock Out']['value'] ?? 0), 2)],
                ['label' => 'Adjustments (net units)', 'value' => (float)($by['Adjustment']['net'] ?? 0), 'icon' => 'bi-sliders'],
                ['label' => 'Total inventory value now', 'value' => $value, 'format' => 'money', 'icon' => 'bi-cash'],
                ['label' => 'Partially received POs', 'value' => count($partial), 'icon' => 'bi-hourglass'],
            ],
            'charts' => [
                ['type' => 'bar', 'horizontal' => true, 'format' => 'money', 'title' => 'Parts used per truck (value)', 'labels' => array_column(array_slice($perTruck, 0, 12), 'name'),
                 'datasets' => [['label' => 'Parts', 'data' => array_map('floatval', array_column(array_slice($perTruck, 0, 12), 'value'))]]],
            ],
            'tables' => [
                ['title' => 'Movements per part', 'columns' => [['Part', 'part_number'], ['Description', 'description'], ['Stock-in', 'stock_in', 'num'], ['Stock-out', 'stock_out', 'num'], ['Adjustments', 'adjustments', 'num'], ['On hand', 'quantity_on_hand', 'num'], ['Value', 'value', 'money']], 'rows' => $perPart],
                ['title' => 'Parts used per truck', 'columns' => [['Truck', 'name'], ['Units', 'qty', 'num'], ['Value', 'value', 'money']], 'rows' => $perTruck],
                ['title' => 'Partially received purchase orders', 'columns' => [['PO', 'po_ref'], ['Supplier', 'supplier'], ['Amount', 'total_amount', 'money'], ['Status', 'status', 'badge'], ['Payment', 'payment_status', 'badge']], 'rows' => $partial],
            ],
        ];
    }
}
