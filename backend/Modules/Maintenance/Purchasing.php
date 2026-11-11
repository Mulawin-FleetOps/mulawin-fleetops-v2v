<?php
/*
 * =====================================================================
 *  backend/Modules/Maintenance/Purchasing.php  —  PARTS & PURCHASING
 * =====================================================================
 *  Objective 2.4  truck-parts requests, inventory check, stock release, inventory update
 *  Objective 2.5  purchase requests, purchase order approval, receiving of parts
 *  Objective 2.6  inventory monitoring: stock-in, stock-out, partially received purchases
 *
 *  PDF #12 Maintenance Module:
 *   A. Stock-out: Motorpool Custodian requests parts (REQUEST FORM) -> Purchasing
 *      Officer checks stock -> releases and the system updates the inventory.
 *   B. Stock-in: Purchasing Officer makes a Purchase Order Request (parts, qty,
 *      unit price; system computes the total) -> automatic approval routing:
 *      PHP 10,000 and below = Finance, above = Admin -> approver approves ->
 *      AUTOMATIC BUDGET VALIDATION (reserve the amount in the same locked step, so
 *      two POs can never use the same remaining money) -> approved PO document with
 *      the approver's e-signature -> Finance sees it as Pending Payment ->
 *      receiving (partial allowed: "Partially Received") adds stock -> Finance pays.
 *
 *  SUPPLIER DETAILS (Nov 2026): the Purchasing Officer types the supplier in the PO form.
 *  Name, address, contact person, phone and email are saved IN the purchase order
 *  (supplier_name ... supplier_email = snapshot), so a PO always prints and pays with the
 *  details it was approved with. Suppliers used before are offered as suggestions; no
 *  supplier record is created. The old suppliers table is kept for purchase orders made
 *  before this change (supplier_id), and every query reads the snapshot first:
 *  COALESCE(o.supplier_name, s.name) with LEFT JOIN suppliers.
 * =====================================================================
 */
declare(strict_types=1);
core('Notify');
core('Files');
core('Settings');

final class Purchasing {
    /**
     * Role-specific workspace pages. Every page returns ONLY the sections it shows
     * (Access::canOpen() has already limited who may call each page).
     *   purchasing_overview  counts and short work lists, no full tables
     *   parts_requests       requests to process (fulfilment fields only)
     *   purchase_orders      purchase orders (+ what the PO form needs, Purchasing Officer only)
     *   inventory            parts and stock values
     *   stock_movements      stock-in / stock-out / adjustment records
     * Motorpool has none of these pages; it uses request_catalog / my_requests below.
     */
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        // MOTORPOOL_WORKSPACE_PHASE1: Motorpool's Parts Requests page. Separate from the Purchasing pages on purpose:
        // it never reads costs, stock counts, budget, supplier or purchase-order data.
        if ($page === 'mp_parts_requests') return self::motorpoolPage($u, $p);
        $stock = hasRole($u, 'purchasing');
        // S4B-2D-B: only roles that handle purchasing money see the budget.
        $budget = fn() => hasRole($u, 'purchasing', 'finance', 'admin', 'audit')
            // ACCOUNTING_INTEGRITY_G7: in_period = the same date rule po_decide uses; an expired budget is shown as ended, not as available.
            ? (one($p, "SELECT *, amount-reserved_amount-spent_amount AS available, (CURRENT_DATE() BETWEEN period_start AND period_end) AS in_period FROM budgets WHERE status='Active' AND category='Purchasing' ORDER BY id DESC LIMIT 1") ?? []) : [];
        $partsFull = fn() => many($p, "SELECT pt.*, ROUND(pt.quantity_on_hand*pt.unit_cost,2) AS stock_value,
                    (pt.reorder_level>0 AND pt.quantity_on_hand<=pt.reorder_level) AS low_stock FROM parts pt ORDER BY pt.active DESC, pt.part_number");
        $data = match ($page) {
            'purchasing_overview' => self::overview($u, $p, $budget),
            'parts_requests' => readSections([
                'requests' => fn() => self::requestRows($p),
                // The "Create PO" shortcut needs the part list and supplier suggestions: Purchasing Officer only.
                'parts' => fn() => $stock ? $partsFull() : [],
                'supplierSuggestions' => fn() => $stock ? self::supplierSuggestions($p) : [],
                'budget' => $budget,
            ]),
            'purchase_orders' => readSections([
                'orders' => fn() => many($p, "SELECT o.*, COALESCE(o.supplier_name, s.name) AS supplier, ru.full_name AS requested_by_name, du.full_name AS decided_by_name,
                        (SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) AS received_value,
                        (SELECT GROUP_CONCAT(CONCAT(pt.part_number, ' ', l.received_qty, '/', l.quantity) SEPARATOR '; ') FROM purchase_order_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.purchase_order_id=o.id) AS items
                    FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id JOIN users ru ON ru.id=o.requested_by LEFT JOIN users du ON du.id=o.decided_by
                    ORDER BY FIELD(o.status,'Pending Approval','Approved','Partially Received','Received','Closed','Rejected','Rejected - Insufficient Budget'), o.id DESC LIMIT 500"),
                // PO form inputs (Purchasing Officer only): parts to order, requests that can be linked, supplier suggestions.
                'parts' => fn() => $stock ? $partsFull() : [],
                'linkableRequests' => fn() => $stock ? many($p, "SELECT r.id, r.request_ref, r.status, v.plate_number FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id
                    WHERE r.status IN ('Requested','Partially Released','Not Available') ORDER BY r.id DESC LIMIT 200") : [],
                'supplierSuggestions' => fn() => $stock ? self::supplierSuggestions($p) : [],
                'budget' => $budget,
            ]),
            'inventory' => readSections(['parts' => $partsFull]),
            'stock_movements' => readSections([
                'movements' => fn() => many($p, "SELECT sm.*, pt.part_number, pt.description, v.plate_number, u.full_name AS actor FROM stock_movements sm JOIN parts pt ON pt.id=sm.part_id
                    LEFT JOIN vehicles v ON v.id=sm.vehicle_id JOIN users u ON u.id=sm.actor_id ORDER BY sm.id DESC LIMIT 500"),
            ]),
            default => throw new BusinessRuleException('Unknown page.', 404),
        };
        $data['threshold'] = Settings::value('purchase_approval_threshold');
        $data['can'] = [
            'stock' => $stock,
            'approveSmall' => hasRole($u, 'finance'), 'approveBig' => hasRole($u, 'admin'),
        ];
        return $data;
    }

    /** Parts requests as Purchasing needs them to fulfil: no incident notes, driver or employee data. */
    private static function requestRows(PDO $p): array {
        // STAGE_B_PURCHASING_UI: requested/released units and the linked purchase orders (ref + status) per request.
        return many($p, "SELECT r.id, r.request_ref, r.vehicle_id, r.status, r.purpose, r.notes, r.created_at, r.processed_at, v.plate_number, m.job_ref,
                ru.full_name AS requested_by_name, pu.full_name AS processed_by_name,
                (SELECT COALESCE(SUM(l.quantity),0) FROM part_request_lines l WHERE l.part_request_id=r.id) AS requested_units,
                (SELECT COALESCE(SUM(l.released_qty),0) FROM part_request_lines l WHERE l.part_request_id=r.id) AS released_units,
                (SELECT GROUP_CONCAT(CONCAT(o.po_ref, ' (', o.status, ')') ORDER BY o.id SEPARATOR '; ') FROM purchase_orders o WHERE o.part_request_id=r.id) AS linked_pos,
                (SELECT GROUP_CONCAT(CONCAT(pt.part_number, ' x', l.quantity, IF(l.released_qty>0, CONCAT(' (released ', l.released_qty, ')'), '')) SEPARATOR '; ')
                   FROM part_request_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.part_request_id=r.id) AS items
            FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id
            JOIN users ru ON ru.id=r.requested_by LEFT JOIN users pu ON pu.id=r.processed_by
            ORDER BY FIELD(r.status,'Requested','Partially Released','Not Available','Released','Cancelled'), r.id DESC LIMIT 500");
    }

    /** Purchasing Overview: what needs action now. Counts and short lists only. */
    private static function overview(array $u, PDO $p, callable $budget): array {
        return readSections([
            'counts' => fn() => [
                'requests_open' => (int)one($p, "SELECT COUNT(*) AS n FROM part_requests WHERE status='Requested'")['n'],
                'requests_followup' => (int)one($p, "SELECT COUNT(*) AS n FROM part_requests WHERE status IN ('Partially Released','Not Available')")['n'],
                'po_pending' => (int)one($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status='Pending Approval'")['n'],
                'po_to_receive' => (int)one($p, "SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('Approved','Partially Received')")['n'],
                'inventory_value' => (float)one($p, 'SELECT COALESCE(SUM(quantity_on_hand*unit_cost),0) AS v FROM parts WHERE active=1')['v'],
                'low_stock' => (int)one($p, 'SELECT COUNT(*) AS n FROM parts WHERE active=1 AND reorder_level>0 AND quantity_on_hand<=reorder_level')['n'],
            ],
            'requests' => fn() => many($p, "SELECT r.id, r.request_ref, r.status, r.created_at, v.plate_number, m.job_ref,
                    (SELECT GROUP_CONCAT(CONCAT(pt.part_number, ' x', l.quantity) SEPARATOR '; ') FROM part_request_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.part_request_id=r.id) AS items
                FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id
                WHERE r.status IN ('Requested','Partially Released','Not Available') ORDER BY FIELD(r.status,'Requested','Partially Released','Not Available'), r.id LIMIT 10"),
            'receiving' => fn() => many($p, "SELECT o.id, o.po_ref, o.status, o.total_amount, o.created_at, COALESCE(o.supplier_name, s.name) AS supplier FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id
                WHERE o.status IN ('Approved','Partially Received') ORDER BY o.id LIMIT 10"),
            // STAGE_B_PURCHASING_UI: POs waiting for Finance/Admin approval, and POs auto-rejected for budget in the last 30 days.
            'approvals' => fn() => many($p, "SELECT o.id, o.po_ref, o.status, o.approver_role, o.total_amount, o.created_at, o.decided_at, COALESCE(o.supplier_name, s.name) AS supplier
                FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id
                WHERE o.status='Pending Approval' OR (o.status='Rejected - Insufficient Budget' AND o.decided_at >= NOW() - INTERVAL 30 DAY)
                ORDER BY FIELD(o.status,'Pending Approval','Rejected - Insufficient Budget'), o.id LIMIT 10"),
            'payments' => fn() => array_map('floatval', one($p, "SELECT COUNT(*) AS n, COALESCE(SUM(GREATEST((SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id)-o.paid_amount,0)),0) AS due
                FROM purchase_orders o WHERE o.payment_status IN ('Pending Payment','Partially Paid')
                  AND (SELECT COALESCE(SUM(l.received_qty*l.unit_price),0) FROM purchase_order_lines l WHERE l.purchase_order_id=o.id) > o.paid_amount")),
            'lowStock' => fn() => many($p, "SELECT id, part_number, description, unit, quantity_on_hand, reorder_level FROM parts
                WHERE active=1 AND reorder_level>0 AND quantity_on_hand<=reorder_level ORDER BY (quantity_on_hand-reorder_level), part_number LIMIT 10"),
            'budget' => $budget,
        ]);
    }

    /**
     * Suppliers used before, for the suggestions of the PO form. Per supplier name and per field,
     * the newest non-empty value wins: purchase orders newest first, then the old masterlist.
     */
    private static function supplierSuggestions(PDO $p): array {
        $out = [];
        $add = function (array $r) use (&$out) {
            $k = strtoupper(trim((string)$r['name']));
            if ($k === '') return;
            $out[$k] ??= ['name' => $k, 'address' => null, 'contact_person' => null, 'contact_number' => null, 'email' => null];
            foreach (['address', 'contact_person', 'contact_number', 'email'] as $f) {
                if (($out[$k][$f] ?? '') === '' && trim((string)($r[$f] ?? '')) !== '') $out[$k][$f] = $r[$f];
            }
        };
        foreach (many($p, "SELECT supplier_name AS name, supplier_address AS address, supplier_contact AS contact_person, supplier_phone AS contact_number,
                    supplier_email AS email FROM purchase_orders WHERE supplier_name IS NOT NULL ORDER BY id DESC LIMIT 2000") as $r) $add($r);
        foreach (many($p, 'SELECT name, address, contact_person, contact_number, email FROM suppliers WHERE active=1') as $r) $add($r);
        ksort($out);
        return array_values($out);
    }

    /** Supplier details typed in the PO form (saved with the PO). */
    private static function supplierSnapshot(array $d): array {
        $name = strtoupper(preg_replace('/\s+/', ' ', field($d, 'supplier_name', 150)));
        $row = ['supplier_name' => $name, 'supplier_address' => optField($d, 'supplier_address', 255),
                'supplier_contact' => optField($d, 'supplier_contact', 120), 'supplier_phone' => phoneField($d, 'supplier_phone', 60),
                'supplier_email' => ($e = optField($d, 'supplier_email', 120)) !== null ? strtolower($e) : null];
        if ($row['supplier_email'] !== null) must((bool)filter_var($row['supplier_email'], FILTER_VALIDATE_EMAIL), 'Enter a valid supplier email address.');
        return $row;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'part_save' => self::partSave($u, $d),
            // Legacy supplier masterlist writes are disabled: suppliers are entered on Purchase Orders.
            'adjust' => self::adjust($u, $d),
            'request_create' => self::requestCreate($u, $d),
            'request_process' => self::requestProcess($u, $d),
            'request_cancel' => self::requestCancel($u, $d),
            'po_create' => self::poCreate($u, $d),
            'po_decide' => self::poDecide($u, $d),
            'po_receive' => self::poReceive($u, $d),
            'po_close' => self::poClose($u, $d),
            'po_details' => self::poDetails($u, $d),
            'request_details' => self::requestDetails($u, $d),
            'part_history' => self::partHistory($u, $d),
            'request_catalog' => self::requestCatalog($u),
            'my_requests' => self::myRequests($u),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    /** Records a stock change and keeps quantity_on_hand >= 0 (checked again by the database). */
    private static function move(PDO $p, array $u, int $partId, string $type, int $delta, float $cost, string $reason, ?string $refType, ?int $refId, ?int $vehicleId = null, ?int $jobId = null): void {
        $pt = one($p, 'SELECT * FROM parts WHERE id=? FOR UPDATE', [$partId]);
        must((bool)$pt, 'Part not found.', 404);
        must((int)$pt['quantity_on_hand'] + $delta >= 0, 'Not enough stock of ' . $pt['part_number'] . ' (on hand: ' . $pt['quantity_on_hand'] . ').', 409);
        run($p, 'UPDATE parts SET quantity_on_hand=quantity_on_hand+? WHERE id=?', [$delta, $partId]);
        insert($p, 'stock_movements', ['part_id' => $partId, 'movement_type' => $type, 'quantity_delta' => $delta, 'unit_cost' => number_format($cost, 2, '.', ''),
            'reason' => cut($reason, 150), 'reference_type' => $refType, 'reference_id' => $refId, 'vehicle_id' => $vehicleId, 'maintenance_job_id' => $jobId, 'actor_id' => $u['id']]);
    }

    // ---------------------------------------------------------------- parts and suppliers
    private static function partSave(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $id = optId($d, 'id');
        $row = ['part_number' => strtoupper(field($d, 'part_number', 70)), 'description' => field($d, 'description', 200), 'category' => optField($d, 'category', 80),
                'unit' => field($d, 'unit', 20), 'unit_cost' => moneyField($d, 'unit_cost', true), 'reorder_level' => intField($d, 'reorder_level', 0),
                'warranty_info' => optField($d, 'warranty_info', 150)];
        $opening = $id ? 0 : (int)(intField($d, 'opening_qty', 0, false) ?? 0);
        return transaction(function (PDO $p) use ($u, $id, $row, $opening) {
            must(!one($p, 'SELECT id FROM parts WHERE part_number=? AND id<>?', [$row['part_number'], $id ?? 0]), 'Part number ' . $row['part_number'] . ' already exists.', 409);
            if ($id) {
                $old = one($p, 'SELECT * FROM parts WHERE id=? FOR UPDATE', [$id]);
                must((bool)$old, 'Part not found.', 404);
                $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
                run($p, "UPDATE parts SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
                $before = []; $after = [];
                foreach (['part_number', 'description', 'category', 'unit', 'unit_cost', 'reorder_level', 'warranty_info'] as $key) {
                    $label = ucwords(str_replace('_', ' ', $key));
                    $before[$label] = $old[$key]; $after[$label] = $row[$key];
                }
                auditWithChanges($p, $u['id'], 'Inventory', 'part ' . $id, 'part updated', $row['part_number'], $before, $after);
                return ['message' => 'Part updated.'];
            }
            $id = insert($p, 'parts', $row);
            if ($opening > 0) self::move($p, $u, $id, 'Adjustment', $opening, (float)$row['unit_cost'], 'Opening balance', 'adjustment', null);
            $added = ['Part number' => $row['part_number'], 'Description' => $row['description'], 'Category' => $row['category'],
                'Unit' => $row['unit'], 'Unit cost' => $row['unit_cost'], 'Reorder level' => $row['reorder_level']];
            if ($opening > 0) $added['Opening quantity'] = $opening;
            auditWithChanges($p, $u['id'], 'Inventory', 'part ' . $id, 'part added', $row['part_number'] . ($opening ? " (opening $opening)" : ''), [], $added);
            return ['message' => 'Part ' . $row['part_number'] . ' added.'];
        });
    }

    private static function supplierSave(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $id = optId($d, 'id');
        $row = ['name' => strtoupper(field($d, 'name', 150)), 'contact_person' => optField($d, 'contact_person', 120), 'contact_number' => phoneField($d, 'contact_number', 60),
                'email' => optField($d, 'email', 120), 'address' => optField($d, 'address', 255), 'active' => isset($d['active']) ? (!empty($d['active']) ? 1 : 0) : 1];
        if ($row['email']) must((bool)filter_var($row['email'], FILTER_VALIDATE_EMAIL), 'Enter a valid email.');
        return transaction(function (PDO $p) use ($u, $id, $row) {
            must(!one($p, 'SELECT id FROM suppliers WHERE name=? AND id<>?', [$row['name'], $id ?? 0]), 'Supplier ' . $row['name'] . ' already exists.', 409);
            $old = [];
            if ($id) {
                $old = one($p, 'SELECT * FROM suppliers WHERE id=? FOR UPDATE', [$id]);
                must((bool)$old, 'Supplier not found.', 404);
                $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
                run($p, "UPDATE suppliers SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
            } else $id = insert($p, 'suppliers', $row);
            // Contact numbers and emails are intentionally excluded from permanent audit snapshots.
            $before = []; $after = [];
            foreach (['name', 'contact_person', 'address', 'active'] as $key) {
                $label = ucwords(str_replace('_', ' ', $key));
                $before[$label] = $key === 'active' ? (isset($old[$key]) ? ((int)$old[$key] ? 'Active' : 'Inactive') : null) : ($old[$key] ?? null);
                $after[$label] = $key === 'active' ? ((int)$row[$key] ? 'Active' : 'Inactive') : $row[$key];
            }
            auditWithChanges($p, $u['id'], 'Purchasing', 'supplier ' . $id, 'supplier saved', $row['name'], $before, $after);
            return ['message' => 'Supplier saved.'];
        });
    }

    /** Inventory adjustment (count correction, damaged stock ...). */
    private static function adjust(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $partId = idField($d, 'part_id');
        $delta = filter_var($d['quantity_delta'] ?? null, FILTER_VALIDATE_INT);
        must($delta !== false && $delta !== 0, 'Enter the quantity to add (e.g. 5) or remove (e.g. -2).');
        must(abs((int)$delta) <= MAX_QUANTITY, 'The adjustment cannot be more than ' . number_format(MAX_QUANTITY) . ' at a time.');
        $reason = field($d, 'reason', 150);
        return transaction(function (PDO $p) use ($u, $partId, $delta, $reason) {
            $pt = one($p, 'SELECT * FROM parts WHERE id=? FOR UPDATE', [$partId]);
            must((bool)$pt, 'Part not found.', 404);
            self::move($p, $u, $partId, 'Adjustment', (int)$delta, (float)$pt['unit_cost'], $reason, 'adjustment', null);
            auditWithChanges($p, $u['id'], 'Inventory', 'part ' . $partId, 'inventory adjusted', $pt['part_number'] . ' ' . ($delta > 0 ? '+' : '') . $delta . ': ' . $reason,
                ['Quantity on hand' => (int)$pt['quantity_on_hand']],
                ['Quantity on hand' => (int)$pt['quantity_on_hand'] + (int)$delta]);
            return ['message' => 'Inventory adjusted.'];
        });
    }

    // Audit #5E: purchasing workflow changes
    // ---------------------------------------------------------------- parts requests (stock-out)
    private static function lines(array $d, string $qtyKey = 'quantity'): array {
        $out = [];
        foreach ((array)($d['lines'] ?? []) as $l) {
            if (!is_array($l) || empty($l['part_id'])) continue;
            $pid = idField($l, 'part_id');
            must(!isset($out[$pid]), 'The same part was entered twice; combine the quantity in one line.');
            $out[$pid] = ['part_id' => $pid, 'quantity' => intField($l, $qtyKey, 1, true, MAX_QUANTITY)] + (isset($l['unit_price']) ? ['unit_price' => moneyField($l, 'unit_price')] : []);
        }
        must((bool)$out, 'Add at least one item.');
        must(count($out) <= 30, 'At most 30 items per form.');
        return array_values($out);
    }

    private static function requestCreate(array $u, array $d): array {
        requireRole($u, 'motorpool');
        $vid = idField($d, 'vehicle_id'); $jobId = optId($d, 'maintenance_job_id');
        $purpose = field($d, 'purpose', 255);
        $lines = self::lines($d);
        return transaction(function (PDO $p) use ($u, $vid, $jobId, $purpose, $lines) {
            $v = one($p, 'SELECT plate_number FROM vehicles WHERE id=? AND active=1', [$vid]);
            must((bool)$v, 'Choose an active truck.');
            if ($jobId) must((bool)one($p, "SELECT id FROM maintenance_jobs WHERE id=? AND vehicle_id=? AND status IN ('Under Inspection','Under Repair')", [$jobId, $vid]), 'The maintenance record does not belong to this truck or is already closed.');
            foreach ($lines as $l) must((bool)one($p, 'SELECT id FROM parts WHERE id=? AND active=1', [$l['part_id']]), 'Unknown part in the list.');
            $rid = insert($p, 'part_requests', ['request_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $vid, 'maintenance_job_id' => $jobId,
                'purpose' => $purpose, 'status' => 'Requested', 'requested_by' => $u['id']]);
            $ref = refNumber('RF', $rid);
            run($p, 'UPDATE part_requests SET request_ref=? WHERE id=?', [$ref, $rid]);
            foreach ($lines as $l) insert($p, 'part_request_lines', ['part_request_id' => $rid, 'part_id' => $l['part_id'], 'quantity' => $l['quantity']]);
            auditWithChanges($p, $u['id'], 'Inventory', 'request ' . $rid, 'parts request submitted', $ref . ' for ' . $v['plate_number'],
                [], ['Request status' => 'Requested', 'Truck' => $v['plate_number'], 'Requested units' => array_sum(array_column($lines, 'quantity'))]);
            Notify::roles($p, ['purchasing'], 'Parts request', "$ref: parts requested for " . $v['plate_number'] . '. Check the stock and release.', 'parts_requests', 'parts-req-' . $rid);
            return ['message' => "Request $ref sent to the Purchasing Officer."];
        });
    }

    /** Purchasing checks the stock and releases what is available (stock-out). */
    private static function requestProcess(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $id = idField($d, 'request_id');
        $notAvailable = !empty($d['not_available']);
        $notes = optField($d, 'notes', 255);
        return transaction(function (PDO $p) use ($u, $d, $id, $notAvailable, $notes) {
            $r = one($p, 'SELECT * FROM part_requests WHERE id=? FOR UPDATE', [$id]);
            must((bool)$r, 'Request not found.', 404);
            must(in_array($r['status'], ['Requested', 'Partially Released', 'Not Available'], true), 'This request is ' . $r['status'] . '.', 409);
            $lines = many($p, 'SELECT l.*, pt.part_number, pt.unit_cost AS cost FROM part_request_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.part_request_id=? FOR UPDATE', [$id]);
            $released = 0;
            if (!$notAvailable) {
                $want = [];
                foreach ((array)($d['release'] ?? []) as $x) if (is_array($x) && !empty($x['line_id'])) $want[(int)$x['line_id']] = (int)($x['qty'] ?? 0);
                foreach ($lines as $l) {
                    $q = $want[(int)$l['id']] ?? 0;
                    if ($q <= 0) continue;
                    must($q <= (int)$l['quantity'] - (int)$l['released_qty'], 'Cannot release more than requested for ' . $l['part_number'] . '.');
                    self::move($p, $u, (int)$l['part_id'], 'Stock Out', -$q, (float)$l['cost'], 'Released for ' . $r['request_ref'], 'part_request', $id, (int)$r['vehicle_id'], $r['maintenance_job_id'] ? (int)$r['maintenance_job_id'] : null);
                    run($p, 'UPDATE part_request_lines SET released_qty=released_qty+?, unit_cost=? WHERE id=?', [$q, $l['cost'], $l['id']]);
                    $released += $q;
                }
                must($released > 0, 'Enter the quantity to release, or mark the request as Not Available.');
            }
            $left = (int)one($p, 'SELECT COALESCE(SUM(quantity-released_qty),0) AS n FROM part_request_lines WHERE part_request_id=?', [$id])['n'];
            $any = (int)one($p, 'SELECT COALESCE(SUM(released_qty),0) AS n FROM part_request_lines WHERE part_request_id=?', [$id])['n'];
            $status = $left === 0 ? 'Released' : ($any > 0 ? 'Partially Released' : 'Not Available');
            run($p, 'UPDATE part_requests SET status=?, processed_by=?, processed_at=NOW(), notes=COALESCE(?, notes) WHERE id=?', [$status, $u['id'], $notes, $id]);
            auditWithChanges($p, $u['id'], 'Inventory', 'request ' . $id, 'parts request processed', $r['request_ref'] . ' -> ' . $status,
                ['Request status' => $r['status'], 'Units released in this action' => 0], ['Request status' => $status, 'Units released in this action' => $released]);
            Notify::user($p, (int)$r['requested_by'], 'Parts request', $r['request_ref'] . ' is ' . $status . '.', 'mp_parts_requests');
            Notify::resolve($p, 'parts-req-' . $id);
            return ['message' => 'Request is now ' . $status . '.' . ($status !== 'Released' ? ' Create a purchase order for the missing items if needed.' : '')];
        });
    }

    private static function requestCancel(array $u, array $d): array {
        requireRole($u, 'motorpool');
        $id = idField($d, 'request_id');
        return transaction(function (PDO $p) use ($u, $id) {
            $r = one($p, 'SELECT * FROM part_requests WHERE id=? FOR UPDATE', [$id]);
            must($r && $r['status'] === 'Requested', 'Only a request that is still Requested can be cancelled.', 409);
            run($p, "UPDATE part_requests SET status='Cancelled' WHERE id=?", [$id]);
            Notify::resolve($p, 'parts-req-' . $id);
            auditWithChanges($p, $u['id'], 'Inventory', 'request ' . $id, 'parts request cancelled', $r['request_ref'],
                ['Request status' => $r['status']], ['Request status' => 'Cancelled']);
            return ['message' => 'Request cancelled.'];
        });
    }

    // ---------------------------------------------------------------- purchase orders (stock-in)
    private static function poCreate(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $supplier = self::supplierSnapshot($d);
        $purpose = field($d, 'purpose', 255);
        $reqId = optId($d, 'part_request_id');
        $lines = self::lines($d);
        foreach ($lines as $l) must(isset($l['unit_price']), 'Enter the unit price of every item.');
        $total = round(array_sum(array_map(fn($l) => $l['quantity'] * (float)$l['unit_price'], $lines)), 2);
        $threshold = Settings::value('purchase_approval_threshold');
        $approver = $total <= $threshold ? 'finance' : 'admin';
        return transaction(function (PDO $p) use ($u, $supplier, $purpose, $reqId, $lines, $total, $approver, $threshold) {
            if ($reqId) must((bool)one($p, 'SELECT id FROM part_requests WHERE id=?', [$reqId]), 'Parts request not found.');
            foreach ($lines as $l) must((bool)one($p, 'SELECT id FROM parts WHERE id=? AND active=1', [$l['part_id']]), 'Unknown part in the list.');
            $id = insert($p, 'purchase_orders', ['po_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'part_request_id' => $reqId, 'purpose' => $purpose] + $supplier + [
                'total_amount' => number_format($total, 2, '.', ''), 'approver_role' => $approver, 'status' => 'Pending Approval', 'requested_by' => $u['id']]);
            $ref = refNumber('PO', $id);
            run($p, 'UPDATE purchase_orders SET po_ref=? WHERE id=?', [$ref, $id]);
            foreach ($lines as $l) insert($p, 'purchase_order_lines', ['purchase_order_id' => $id, 'part_id' => $l['part_id'], 'quantity' => $l['quantity'],
                'unit_price' => $l['unit_price'], 'line_total' => number_format($l['quantity'] * (float)$l['unit_price'], 2, '.', '')]);
            auditWithChanges($p, $u['id'], 'Purchasing', 'po ' . $id, 'purchase order request created', "$ref " . $supplier['supplier_name'] . ' PHP ' . number_format($total, 2) . ' -> ' . ($approver === 'finance' ? 'Finance' : 'Admin'),
                [], ['PO status' => 'Pending Approval', 'Supplier' => $supplier['supplier_name'], 'Total amount' => number_format($total, 2, '.', ''), 'Approval role' => $approver]);
            Notify::roles($p, [$approver], 'PO approval', "Purchase order $ref (PHP " . number_format($total, 2) . ') is waiting for your approval.', 'purchase_orders', 'po-approve-' . $id);
            return ['message' => "Purchase order $ref (PHP " . number_format($total, 2) . ') sent to ' . ($approver === 'finance' ? 'Finance (PHP ' . number_format($threshold) . ' and below)' : 'the Admin (above PHP ' . number_format($threshold) . ')') . ' for approval.'];
        });
    }

    /**
     * Approve / reject. On approve the budget is checked and reserved in ONE locked
     * step (SELECT ... FOR UPDATE on the budget row), so two approvals at the same
     * time cannot both use the same remaining money.
     */
    private static function poDecide(array $u, array $d): array {
        must(hasRole($u, 'finance', 'admin'), 'Only Finance or the Admin approve purchase orders.', 403);
        $id = idField($d, 'po_id');
        $decision = choiceField($d, 'decision', ['approve', 'reject']);
        $notes = $decision === 'reject' ? field($d, 'notes', 255) : optField($d, 'notes', 255);
        return transaction(function (PDO $p) use ($u, $id, $decision, $notes) {
            $o = one($p, 'SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [$id]);
            must((bool)$o, 'Purchase order not found.', 404);
            must($o['status'] === 'Pending Approval', 'This purchase order is ' . $o['status'] . '.', 409);
            Notify::resolve($p, 'po-approve-' . $id);
            must($u['role'] === $o['approver_role'], 'This purchase order is routed to ' . ($o['approver_role'] === 'finance' ? 'Finance' : 'the Admin') . ' (approval limit rule).', 403);
            if ($decision === 'reject') {
                run($p, "UPDATE purchase_orders SET status='Rejected', decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=?", [$u['id'], $notes, $id]);
                auditWithChanges($p, $u['id'], 'Purchasing', 'po ' . $id, 'purchase order rejected', $o['po_ref'] . ': ' . $notes,
                    ['PO status' => $o['status']], ['PO status' => 'Rejected']);
                Notify::user($p, (int)$o['requested_by'], 'PO rejected', $o['po_ref'] . ' was rejected: ' . $notes, 'purchase_orders');
                return ['message' => 'Purchase order rejected.'];
            }
            $b = one($p, "SELECT * FROM budgets WHERE status='Active' AND category='Purchasing' AND CURRENT_DATE() BETWEEN period_start AND period_end ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $available = $b ? round((float)$b['amount'] - (float)$b['reserved_amount'] - (float)$b['spent_amount'], 2) : 0.0;
            if (!$b || $available < (float)$o['total_amount']) {
                $why = !$b ? 'no active purchasing budget for today' : 'available budget PHP ' . number_format($available, 2) . ' is less than PHP ' . number_format((float)$o['total_amount'], 2);
                run($p, "UPDATE purchase_orders SET status='Rejected - Insufficient Budget', decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=?", [$u['id'], cut('System: ' . $why, 255), $id]);
                auditWithChanges($p, null, 'Purchasing', 'po ' . $id, 'purchase order rejected - insufficient budget', $o['po_ref'] . ': ' . $why,
                    ['PO status' => $o['status']], ['PO status' => 'Rejected - Insufficient Budget']);
                Notify::user($p, (int)$o['requested_by'], 'PO rejected', $o['po_ref'] . ' was automatically rejected: insufficient budget (' . $why . ').', 'purchase_orders');
                return ['warning' => 'Rejected - Insufficient Budget: ' . $why . '. No PO document was made.'];
            }
            run($p, 'UPDATE budgets SET reserved_amount=reserved_amount+? WHERE id=?', [$o['total_amount'], $b['id']]);
            run($p, "UPDATE purchase_orders SET status='Approved', payment_status='Pending Payment', budget_id=?, reserved_amount=total_amount, decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=?",
                [$b['id'], $u['id'], $notes, $id]);
            auditWithChanges($p, $u['id'], 'Purchasing', 'po ' . $id, 'purchase order approved', $o['po_ref'] . ': PHP ' . $o['total_amount'] . ' reserved from the budget',
                ['PO status' => $o['status'], 'Reserved amount' => $o['reserved_amount']], ['PO status' => 'Approved', 'Reserved amount' => $o['total_amount']]);
            Notify::user($p, (int)$o['requested_by'], 'PO approved', $o['po_ref'] . ' is approved. Print the PO and proceed with the purchase.', 'purchase_orders');
            Notify::roles($p, ['finance'], 'PO pending payment', $o['po_ref'] . ' (PHP ' . number_format((float)$o['total_amount'], 2) . ') was approved and is Pending Payment.', 'finance', 'po-pay-' . $id);
            return ['message' => 'Approved. PHP ' . number_format((float)$o['total_amount'], 2) . ' is reserved from the purchasing budget. The PO document is ready to print.'];
        });
    }

    /** Receiving (stock-in). Partial deliveries are allowed: "Partially Received". */
    private static function poReceive(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $id = idField($d, 'po_id');
        $invoice = optField($d, 'supplier_invoice_no', 80);
        return transaction(function (PDO $p) use ($u, $d, $id, $invoice) {
            $o = one($p, 'SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [$id]);
            must((bool)$o, 'Purchase order not found.', 404);
            must(in_array($o['status'], ['Approved', 'Partially Received'], true), 'Only approved purchase orders can be received (this one is ' . $o['status'] . ').', 409);
            $got = [];
            foreach ((array)($d['receive'] ?? []) as $x) if (is_array($x) && !empty($x['line_id'])) $got[(int)$x['line_id']] = (int)($x['qty'] ?? 0);
            $total = 0;
            foreach (many($p, 'SELECT l.*, pt.part_number FROM purchase_order_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.purchase_order_id=? FOR UPDATE', [$id]) as $l) {
                $q = $got[(int)$l['id']] ?? 0;
                if ($q <= 0) continue;
                must($q <= (int)$l['quantity'] - (int)$l['received_qty'], 'Received quantity of ' . $l['part_number'] . ' is more than the remaining ordered quantity.');
                self::move($p, $u, (int)$l['part_id'], 'Stock In', $q, (float)$l['unit_price'], 'Received from ' . $o['po_ref'], 'purchase_order', $id);
                run($p, 'UPDATE parts SET unit_cost=? WHERE id=?', [$l['unit_price'], $l['part_id']]);
                run($p, 'UPDATE purchase_order_lines SET received_qty=received_qty+? WHERE id=?', [$q, $l['id']]);
                $total += $q;
            }
            must($total > 0, 'Enter the quantities actually received.');
            Files::store($p, $u, 'receipt', 'purchase', $id, 'Delivery Receipt / Supplier Invoice');
            $left = (int)one($p, 'SELECT COALESCE(SUM(quantity-received_qty),0) AS n FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['n'];
            $status = $left === 0 ? 'Received' : 'Partially Received';
            run($p, 'UPDATE purchase_orders SET status=?, supplier_invoice_no=COALESCE(?, supplier_invoice_no) WHERE id=?', [$status, $invoice, $id]);
            self::refreshPayment($p, $id);
            auditWithChanges($p, $u['id'], 'Purchasing', 'po ' . $id, 'parts received', $o['po_ref'] . ': ' . $total . ' unit(s), ' . $status,
                ['PO status' => $o['status'], 'Units received in this action' => 0], ['PO status' => $status, 'Units received in this action' => $total]);
            Notify::roles($p, ['finance'], 'Parts received', $o['po_ref'] . ' is ' . $status . '. Check the supplier invoice before payment.', 'finance');
            return ['message' => "Received $total unit(s). PO is $status; inventory updated."];
        });
    }

    /** Close a PO whose balance will not be delivered: frees the reserved budget of the undelivered items. */
    private static function poClose(array $u, array $d): array {
        requireRole($u, 'purchasing');
        $id = idField($d, 'po_id'); $reason = field($d, 'reason', 255);
        return transaction(function (PDO $p) use ($u, $id, $reason) {
            $o = one($p, 'SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [$id]);
            must($o && in_array($o['status'], ['Approved', 'Partially Received'], true), 'Only an approved, not fully received PO can be closed.', 409);
            $undelivered = (float)one($p, 'SELECT COALESCE(SUM((quantity-received_qty)*unit_price),0) AS v FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['v'];
            $free = round(min($undelivered, (float)$o['reserved_amount']), 2);
            if ($o['budget_id'] && $free > 0) run($p, 'UPDATE budgets SET reserved_amount=GREATEST(reserved_amount-?,0) WHERE id=?', [$free, $o['budget_id']]);
            run($p, "UPDATE purchase_orders SET status='Closed', reserved_amount=GREATEST(reserved_amount-?,0), decision_notes=? WHERE id=?", [$free, cut('Closed: ' . $reason, 255), $id]);
            self::refreshPayment($p, $id);
            auditWithChanges($p, $u['id'], 'Purchasing', 'po ' . $id, 'purchase order closed', $o['po_ref'] . ': PHP ' . number_format($free, 2) . ' returned to the budget. ' . $reason,
                ['PO status' => $o['status'], 'Reserved amount' => $o['reserved_amount']], ['PO status' => 'Closed', 'Reserved amount' => max(0, (float)$o['reserved_amount'] - $free)]);
            return ['message' => 'PO closed. PHP ' . number_format($free, 2) . ' of reserved budget was released.'];
        });
    }

    /** Payment status follows the value of what was received (and what was paid). */
    public static function refreshPayment(PDO $p, int $id): void {
        $o = one($p, 'SELECT * FROM purchase_orders WHERE id=?', [$id]);
        if (!$o['payment_status']) return;
        $received = (float)one($p, 'SELECT COALESCE(SUM(received_qty*unit_price),0) AS v FROM purchase_order_lines WHERE purchase_order_id=?', [$id])['v'];
        $paid = (float)$o['paid_amount'];
        $final = in_array($o['status'], ['Received', 'Closed'], true);
        // ACCOUNTING_INTEGRITY_G5: a PO closed before anything was received (and never paid) owes nothing. It leaves the
        // Finance payables (payment_status NULL, allowed by chk_po_pay) and its "PO pending payment" notification is resolved.
        if ($final && round($received, 2) <= 0 && $paid <= 0) {
            run($p, 'UPDATE purchase_orders SET payment_status=NULL WHERE id=?', [$id]);
            Notify::resolve($p, 'po-pay-' . $id);
            return;
        }
        $status = ($paid <= 0) ? 'Pending Payment' : (($final && $paid >= round($received, 2)) ? 'Paid' : 'Partially Paid');
        if ($status === 'Paid') Notify::resolve($p, 'po-pay-' . $id);
        run($p, 'UPDATE purchase_orders SET payment_status=? WHERE id=?', [$status, $id]);
    }

    private static function poDetails(array $u, array $d): array {
        must(Access::canOpen($u, 'purchase_orders'), 'Not allowed.', 403);
        $id = idField($d, 'po_id'); $p = db();
        $o = one($p, 'SELECT o.*, COALESCE(o.supplier_name, s.name) AS supplier, COALESCE(o.supplier_address, s.address) AS supplier_address,
                COALESCE(o.supplier_contact, s.contact_person) AS supplier_contact, COALESCE(o.supplier_phone, s.contact_number) AS supplier_phone,
                COALESCE(o.supplier_email, s.email) AS supplier_email,
                ru.full_name AS requested_by_name, du.full_name AS decided_by_name, du.signature_document_id AS approver_signature, r.request_ref
            FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id JOIN users ru ON ru.id=o.requested_by LEFT JOIN users du ON du.id=o.decided_by
            LEFT JOIN part_requests r ON r.id=o.part_request_id WHERE o.id=?', [$id]);
        must((bool)$o, 'Purchase order not found.', 404);
        return ['po' => $o,
            'lines' => many($p, 'SELECT l.*, pt.part_number, pt.description, pt.unit FROM purchase_order_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.purchase_order_id=? ORDER BY l.id', [$id]),
            // S4B-2D-B: detailed disbursement records contain Finance-only payment data.
            // Purchasing/Motorpool still receive PO payment_status, but not bank/payment details.
            'payments' => hasRole($u, 'finance', 'admin', 'audit')
                ? many($p, "SELECT d.*, u.full_name AS recorded_by_name FROM disbursements d JOIN users u ON u.id=d.recorded_by WHERE d.source_type='purchase_order' AND d.source_id=? ORDER BY d.id", [$id]) : [],
            'documents' => Files::of($p, 'purchase', $id),
            // STAGE_B_PURCHASING_UI: the PO's recorded activity (created, approved/rejected, received, paid, closed) from the audit log.
            'history' => self::activity($p, 'po ' . $id, ['Purchasing', 'Finance'])];
    }

    /** Recorded audit events of one record (newest first): action, details, actor name, time. No change values. */
    private static function activity(PDO $p, string $ref, array $areas): array {
        $in = implode(',', array_fill(0, count($areas), '?'));
        return many($p, "SELECT e.action, e.details, e.created_at, COALESCE(u.full_name, 'System') AS actor FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id
            WHERE e.record_ref=? AND e.area IN ($in) ORDER BY e.id DESC LIMIT 50", array_merge([$ref], $areas));
    }

    /** STAGE_B_PURCHASING_UI — last 50 stock movements of one part (Inventory drawer). Same roles as the Inventory page. */
    private static function partHistory(array $u, array $d): array {
        must(Access::canOpen($u, 'inventory'), 'Not allowed.', 403);
        $id = idField($d, 'part_id'); $p = db();
        $pt = one($p, 'SELECT pt.*, ROUND(pt.quantity_on_hand*pt.unit_cost,2) AS stock_value FROM parts pt WHERE pt.id=?', [$id]);
        must((bool)$pt, 'Part not found.', 404);
        return ['part' => $pt,
            'movements' => many($p, "SELECT sm.id, sm.movement_type, sm.quantity_delta, sm.unit_cost, sm.reason, sm.reference_type, sm.reference_id, sm.created_at,
                    v.plate_number, u.full_name AS actor,
                    CASE sm.reference_type WHEN 'purchase_order' THEN (SELECT po_ref FROM purchase_orders WHERE id=sm.reference_id)
                        WHEN 'part_request' THEN (SELECT request_ref FROM part_requests WHERE id=sm.reference_id) END AS reference
                FROM stock_movements sm LEFT JOIN vehicles v ON v.id=sm.vehicle_id JOIN users u ON u.id=sm.actor_id WHERE sm.part_id=? ORDER BY sm.id DESC LIMIT 50", [$id]),
            'usage' => one($p, "SELECT COALESCE(SUM(CASE WHEN movement_type='Stock Out' THEN -quantity_delta END),0) AS issued_90d,
                    COUNT(CASE WHEN movement_type='Stock Out' THEN 1 END) AS issues_90d
                FROM stock_movements WHERE part_id=? AND created_at >= NOW() - INTERVAL 90 DAY", [$id])];
    }

    /**
     * One parts request with its lines.
     *  - Purchasing / Admin / Audit (Parts Requests page): fulfilment view incl. quantity on hand.
     *  - Motorpool: only requests made by Motorpool, and only an availability label (no stock counts, no costs).
     */
    private static function requestDetails(array $u, array $d): array {
        $motorpool = hasRole($u, 'motorpool');
        must($motorpool || Access::canOpen($u, 'parts_requests'), 'Not allowed.', 403);
        $id = idField($d, 'request_id'); $p = db();
        $r = one($p, 'SELECT r.id, r.request_ref, r.status, r.purpose, r.notes, r.created_at, r.processed_at, r.requested_by, r.processed_by,
                v.plate_number, v.truck_number, v.make_brand, v.engine_number, m.job_ref, ru.full_name AS requested_by_name, pu.full_name AS processed_by_name
            FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id JOIN users ru ON ru.id=r.requested_by
            LEFT JOIN users pu ON pu.id=r.processed_by WHERE r.id=?' . ($motorpool ? " AND ru.role='motorpool'" : ''), [$id]);
        must((bool)$r, 'Request not found.', 404);
        $cols = $motorpool ? self::availabilitySql('pt') . ' AS availability' : 'pt.quantity_on_hand';
        $out = ['request' => $r, 'lines' => many($p, "SELECT l.id, l.part_id, l.quantity, l.released_qty, pt.part_number, pt.description, pt.unit, $cols
            FROM part_request_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.part_request_id=? ORDER BY l.id", [$id])];
        // STAGE_B_PURCHASING_UI: Purchasing / Admin / Audit also get the linked POs and the request's recorded activity.
        // Motorpool's response is unchanged (no PO, supplier or cost data).
        if (!$motorpool) {
            $out['orders'] = many($p, "SELECT o.id, o.po_ref, o.status, o.payment_status, o.total_amount, o.created_at, COALESCE(o.supplier_name, s.name) AS supplier
                FROM purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.part_request_id=? ORDER BY o.id", [$id]);
            $out['history'] = self::activity($p, 'request ' . $id, ['Inventory']);
        }
        return $out;
    }

    /** In stock / Low stock / Out of stock, so Motorpool can see availability without stock counts or costs. */
    private static function availabilitySql(string $alias): string {
        return "CASE WHEN $alias.quantity_on_hand<=0 THEN 'Out of stock' WHEN $alias.reorder_level>0 AND $alias.quantity_on_hand<=$alias.reorder_level THEN 'Low stock' ELSE 'In stock' END";
    }

    /** Parts Motorpool may pick in the request form: identification and availability only. */
    private static function requestCatalog(array $u): array {
        requireRole($u, 'motorpool');
        return ['parts' => many(db(), 'SELECT pt.id, pt.part_number, pt.description, pt.unit, ' . self::availabilitySql('pt') . ' AS availability
            FROM parts pt WHERE pt.active=1 ORDER BY pt.part_number')];
    }

    /**
     * MOTORPOOL_WORKSPACE_PHASE1 — page data of Motorpool's Parts Requests page.
     *   requests  the department's requests (same rows as my_requests)
     *   summary   counts per status over ALL of the department's requests (not cut by the list limit)
     *   trucks / jobs  what the existing "Request parts" form needs (truck identity, open repairs)
     * Never: unit cost, quantity on hand, stock value, budget, supplier or purchase-order data.
     */
    private static function motorpoolPage(array $u, PDO $p): array {
        requireRole($u, 'motorpool');
        $data = readSections([
            'requests' => fn() => self::myRequestRows($p),
            'summary' => fn() => array_map('intval', one($p, "SELECT COALESCE(SUM(r.status='Requested'),0) AS requested,
                    COALESCE(SUM(r.status='Partially Released'),0) AS partially_released, COALESCE(SUM(r.status='Not Available'),0) AS not_available,
                    COALESCE(SUM(r.status='Released'),0) AS released, COALESCE(SUM(r.status='Cancelled'),0) AS cancelled
                FROM part_requests r JOIN users ru ON ru.id=r.requested_by WHERE ru.role='motorpool'")),
            'trucks' => fn() => many($p, 'SELECT id, plate_number, truck_number FROM vehicles WHERE active=1 ORDER BY plate_number'),
            'jobs' => fn() => many($p, "SELECT m.id, m.job_ref, m.vehicle_id, m.status, m.problem, v.plate_number FROM maintenance_jobs m JOIN vehicles v ON v.id=m.vehicle_id
                WHERE m.status IN ('Under Inspection','Under Repair') ORDER BY m.id DESC"),
        ]);
        $data['can'] = ['act' => true];
        return $data;
    }

    /** Motorpool's own parts requests with fulfilment progress (requested vs released units). No costs, no stock counts. */
    private static function myRequests(array $u): array {
        requireRole($u, 'motorpool');
        return ['requests' => self::myRequestRows(db())];
    }

    private static function myRequestRows(PDO $p): array {
        return many($p, "SELECT r.id, r.request_ref, r.status, r.purpose, r.notes, r.created_at, r.processed_at, r.vehicle_id, v.plate_number, m.job_ref, ru.full_name AS requested_by_name,
                (SELECT COALESCE(SUM(l.quantity),0) FROM part_request_lines l WHERE l.part_request_id=r.id) AS requested_units,
                (SELECT COALESCE(SUM(l.released_qty),0) FROM part_request_lines l WHERE l.part_request_id=r.id) AS released_units,
                (SELECT GROUP_CONCAT(CONCAT(pt.part_number, ' x', l.quantity, IF(l.released_qty>0, CONCAT(' (released ', l.released_qty, ')'), '')) SEPARATOR '; ')
                   FROM part_request_lines l JOIN parts pt ON pt.id=l.part_id WHERE l.part_request_id=r.id) AS items
            FROM part_requests r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN maintenance_jobs m ON m.id=r.maintenance_job_id JOIN users ru ON ru.id=r.requested_by
            WHERE ru.role='motorpool' ORDER BY FIELD(r.status,'Requested','Partially Released','Not Available','Released','Cancelled'), r.id DESC LIMIT 300");
    }
}
