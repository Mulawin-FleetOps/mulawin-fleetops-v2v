<?php
/** Accredited client profiles. Fixed contractual pricing belongs to approved Client Routes.
 * Historical client_rates rows and billing fields are retained read-only.
 */
declare(strict_types=1);
core('Files');
core('Notify');
core('Settings');
core('DispatcherScope');

final class Clients {
    /** input name => document category (all required before activation). */
    public const REQUIRED_DOCS = [
        'signature' => 'Client Signature',
        'company_profile' => 'Company Profile',
        'sec_dti' => 'SEC/DTI Registration',
        'business_permit' => 'Business Permit',
        'bir_2303' => 'BIR Form 2303',
    ];
    private const EDIT = ['admin', 'operations_head'];
    private const RATE = [];

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        if(roleIsDispatcher($u['role'])){$types=DispatcherScope::types($u);$marks=implode(',',array_fill(0,count($types),'?'));return ['clients'=>many($p,"SELECT c.id,c.company_name,c.status FROM clients c WHERE EXISTS(SELECT 1 FROM client_routes r WHERE r.client_id=c.id AND r.status='Approved' AND r.truck_type IN ($marks)) ORDER BY c.company_name",$types),'can'=>['edit'=>false,'rate'=>false],'requiredDocs'=>[],'defaultTerms'=>null];}
        $data = readSections([
            'clients' => fn() => many($p, "SELECT c.*,
                    NULL AS rates,
                    (SELECT COUNT(DISTINCT d.category) FROM documents d WHERE d.entity_type='client' AND d.entity_id=c.id AND d.category IN ('" . implode("','", self::REQUIRED_DOCS) . "')) AS docs_done,
                    (SELECT COUNT(*) FROM trips t WHERE t.client_id=c.id AND t.status NOT IN ('Cancelled','Rejected')) AS trip_count,
                    (SELECT COALESCE(SUM(b.total_amount - b.amount_paid),0) FROM billings b WHERE b.client_id=c.id AND b.status IN ('Invoiced','Partially Paid')) AS balance
                FROM clients c ORDER BY FIELD(c.status,'Pending Rate','Active','Incomplete','Inactive'), c.company_name"),
        ]);
        $data['requiredDocs'] = self::REQUIRED_DOCS;
        $data['defaultTerms'] = Settings::value('default_payment_terms_days');
        $data['can'] = ['edit' => hasRole($u, ...self::EDIT), 'rate' => false];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'create' => self::create($u, $d),
            'update' => self::update($u, $d),
            'documents' => self::documents($u, $d),
            'rate_save' => throw new BusinessRuleException('Client-level rates are retired. Use approved fixed Client Route Rates.',409),
            'set_active' => self::setActive($u, $d),
            'details' => self::details($u, $d),
            default => throw new BusinessRuleException('Unknown action.', 404),
        };
    }

    /** Client information sheet fields. */
    private static function infoFields(array $d): array {
        $row = [
            'company_name' => strtoupper(trim(preg_replace('/\s+/', ' ', field($d, 'company_name', 150)))),
            'trade_name' => optField($d, 'trade_name', 150),
            'nature_of_business' => optField($d, 'nature_of_business', 150),
            'tin' => optField($d, 'tin', 30),
            'business_address' => field($d, 'business_address', 255),
            'contact_person' => field($d, 'contact_person', 120),
            'contact_position' => optField($d, 'contact_position', 80),
            'contact_number' => phoneField($d, 'contact_number', 60, true),
            'email' => optField($d, 'email', 120),
            'notes' => optField($d, 'notes', 255),
        ];
        if ($row['email'] !== null) must((bool)filter_var($row['email'], FILTER_VALIDATE_EMAIL), 'Enter a valid email address.');
        if ($row['tin'] !== null) must((bool)preg_match('/^[0-9-]{9,20}$/', $row['tin']), 'TIN must contain numbers and dashes only (example: 123-456-789-000).');
        return $row;
    }

    private static function assertUnique(PDO $p, array $row, int $id = 0): void {
        must(!one($p, 'SELECT id FROM clients WHERE company_name=? AND id<>?', [$row['company_name'], $id]), $row['company_name'] . ' is already in the client masterlist.', 409);
        if ($row['tin']) must(!one($p, 'SELECT id FROM clients WHERE tin=? AND id<>?', [$row['tin'], $id]), 'TIN ' . $row['tin'] . ' belongs to another client.', 409);
    }

    /** Which required documents are still missing for a client. */
    public static function missingDocs(PDO $p, int $clientId): array {
        $have = array_column(many($p, 'SELECT DISTINCT category FROM documents WHERE entity_type=? AND entity_id=?', ['client', $clientId]), 'category');
        return array_values(array_diff(self::REQUIRED_DOCS, $have));
    }

    /** New client: profile is saved only together with ALL required files. */
    private static function create(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $row = self::infoFields($d);
        $missing = [];
        foreach (self::REQUIRED_DOCS as $input => $cat) if (!Files::has($input)) $missing[] = $cat;
        must(!$missing, 'The client profile can be saved only when all requirements are attached. Missing: ' . implode(', ', $missing) . '.');
        return transaction(function (PDO $p) use ($u, $row) {
            self::assertUnique($p, $row);
            $id = insert($p, 'clients', $row + ['status' => 'Active', 'created_by' => $u['id']]);
            run($p, 'UPDATE clients SET client_code=? WHERE id=?', ['CL-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT), $id]);
            foreach (self::REQUIRED_DOCS as $input => $cat) Files::store($p, $u, $input, 'client', $id, $cat, true, $cat);
            audit($p, $u['id'], 'Clients', 'client ' . $id, 'client profile created', $row['company_name'] . ' -> Active');
            return ['id' => $id, 'message' => 'Client profile saved. Accreditation is complete; the client is Active.'];
        });
    }

    private static function update(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id');
        $row = self::infoFields($d);
        return transaction(function (PDO $p) use ($u, $id, $row) {
            $oldClient = one($p, 'SELECT * FROM clients WHERE id=? FOR UPDATE', [$id]);
            must((bool)$oldClient, 'Client not found.', 404);
            self::assertUnique($p, $row, $id);
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE clients SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
            $oldFields = []; $newFields = [];
            foreach ($row as $key => $value) {
                if ($key === 'tin') continue; // do not duplicate government identifiers in audit history
                $label = ucwords(str_replace('_', ' ', $key));
                $oldFields[$label] = $oldClient[$key] ?? null;
                $newFields[$label] = $value;
            }
            auditWithChanges($p, $u['id'], 'Clients', 'client ' . $id, 'client information updated', $row['company_name'], $oldFields, $newFields);
            return ['id' => $id, 'message' => 'Client information updated.'];
        });
    }

    /** Upload missing or renewed accreditation files. An Incomplete client becomes Active when complete. */
    private static function documents(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id');
        return transaction(function (PDO $p) use ($u, $id) {
            $c = one($p, 'SELECT * FROM clients WHERE id=? FOR UPDATE', [$id]);
            must((bool)$c, 'Client not found.', 404);
            $n = 0;
            foreach (self::REQUIRED_DOCS as $input => $cat) $n += count(Files::store($p, $u, $input, 'client', $id, $cat));
            $n += count(Files::store($p, $u, 'other', 'client', $id, 'Other Client Document'));
            must($n > 0, 'Choose at least one file to upload.');
            $missing = self::missingDocs($p, $id);
            $msg = $n . ' file(s) uploaded.';
            if ($c['status'] === 'Incomplete' && !$missing) {
                foreach (['business_address', 'contact_person', 'contact_number'] as $f) must(!empty($c[$f]), 'Complete the client information sheet (address, contact person, contact number) first.');
                run($p, "UPDATE clients SET status='Active' WHERE id=?", [$id]);
                // Adjustment #5G: client lifecycle status audit
                auditWithChanges($p, $u['id'], 'Clients', 'client ' . $id, 'client requirements completed', $c['company_name'] . ' -> Active',
                    ['Client status' => $c['status']], ['Client status' => 'Active']);
                Notify::resolve($p,'client-rate-'.$id);
                $msg .= ' All requirements are complete; the client is Active.';
            } elseif ($missing) $msg .= ' Still missing: ' . implode(', ', $missing) . '.';
            return ['message' => $msg];
        });
    }

    /** Accreditation controls activation; no legacy pricing dependency. */
    private static function setActive(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id'); $active = !empty($d['active']);
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $c = one($p, 'SELECT * FROM clients WHERE id=? FOR UPDATE', [$id]);
            must((bool)$c, 'Client not found.', 404);
            if ($active) {
                $profileComplete=!empty($c['business_address'])&&!empty($c['contact_person'])&&!empty($c['contact_number']);
                $status = self::missingDocs($p, $id)||!$profileComplete ? 'Incomplete' : 'Active';
            } else $status = 'Inactive';
            run($p, 'UPDATE clients SET status=? WHERE id=?', [$status, $id]);
            // Adjustment #5G: record the actual status, which can also be Incomplete or Pending Rate.
            auditWithChanges($p, $u['id'], 'Clients', 'client ' . $id, $active ? 'client reactivated' : 'client deactivated', $c['company_name'] . ' -> ' . $status,
                ['Client status' => $c['status']], ['Client status' => $status]);
            return ['message' => $c['company_name'] . ' is now ' . $status . '.' . (!$active ? ' Existing trips and billings are kept.' : '')];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'clients') || Access::canOpen($u, 'trips'), 'Not allowed.', 403);
        $id = idField($d, 'id'); $p = db();
        if(roleIsDispatcher($u['role'])){
            $types=DispatcherScope::types($u);$marks=implode(',',array_fill(0,count($types),'?'));$c=one($p,"SELECT c.id,c.company_name,c.status FROM clients c WHERE c.id=? AND EXISTS(SELECT 1 FROM client_routes r WHERE r.client_id=c.id AND r.status='Approved' AND r.truck_type IN ($marks))",[$id,...$types]);must((bool)$c,'Client is outside your operational scope.',403);[$scope,$args]=DispatcherScope::tripSql($u);
            return ['client'=>$c,'rates'=>[],'documents'=>[],'missing'=>[],'trips'=>many($p,"SELECT t.id,t.trip_ref,t.status,t.scheduled_at,t.pickup_point,t.delivery_point,t.truck_type FROM trips t WHERE t.client_id=? $scope ORDER BY t.scheduled_at DESC LIMIT 30",[$id,...$args]),'billing'=>null];
        }
        $c = one($p, 'SELECT c.*, cu.full_name AS created_by_name, ru.full_name AS rate_set_by_name FROM clients c LEFT JOIN users cu ON cu.id=c.created_by LEFT JOIN users ru ON ru.id=c.rate_set_by WHERE c.id=?', [$id]);
        must((bool)$c, 'Client not found.', 404);
        return [
            'client' => $c,
            'rates' => many($p, 'SELECT r.*, u.full_name AS updated_by_name FROM client_rates r JOIN users u ON u.id=r.updated_by WHERE r.client_id=? ORDER BY r.truck_type', [$id]),
            'documents' => Files::of($p, 'client', $id),
            'missing' => self::missingDocs($p, $id),
            'trips' => many($p, "SELECT t.id, t.trip_ref, t.status, t.scheduled_at, t.pickup_point, t.delivery_point, t.truck_type FROM trips t WHERE t.client_id=? ORDER BY t.scheduled_at DESC LIMIT 30", [$id]),
            'billing' => one($p, "SELECT COUNT(*) AS invoices, COALESCE(SUM(total_amount),0) AS billed, COALESCE(SUM(amount_paid),0) AS paid FROM billings WHERE client_id=? AND status IN ('Invoiced','Partially Paid','Paid')", [$id]),
        ];
    }
}
