<?php
/*
 * =====================================================================
 *  backend/Modules/Operations/Clients.php  —  CLIENT MASTERLIST
 * =====================================================================
 *  Objective 1.2: client profiles with client information, accreditation
 *  documents and applicable billing rates.
 *  Objective 3.1: client billing rates based on billable distance.
 *
 *  PDF #12 Scenario A step 2 (client profile creation):
 *   1. Operations Head fills in the digital client information sheet
 *      (printable, so a clean copy can be given to the client).
 *   2. Attaches the client signature image and the accreditation files:
 *      company profile, SEC/DTI registration, business permit, BIR Form 2303.
 *   3. Only when ALL requirements are complete can the profile be saved
 *      -> status "Pending Rate" and it appears to Billing.
 *   4. Billing creates the client rate -> status "Active" and the complete
 *      profile (with rate) appears to the Operations Head. Only Active
 *      clients can be chosen for trips.
 * =====================================================================
 */
declare(strict_types=1);
core('Files');
core('Notify');
core('Settings');

final class Clients {
    /** input name => document category (all required before "Pending Rate"). */
    public const REQUIRED_DOCS = [
        'signature' => 'Client Signature',
        'company_profile' => 'Company Profile',
        'sec_dti' => 'SEC/DTI Registration',
        'business_permit' => 'Business Permit',
        'bir_2303' => 'BIR Form 2303',
    ];
    private const EDIT = ['admin', 'operations_head'];
    private const RATE = ['admin', 'billing'];

    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $data = readSections([
            'clients' => fn() => many($p, "SELECT c.*,
                    (SELECT GROUP_CONCAT(CONCAT(r.truck_type, ': ', FORMAT(r.rate_per_km,2), '/km') ORDER BY r.truck_type SEPARATOR '; ') FROM client_rates r WHERE r.client_id=c.id) AS rates,
                    (SELECT COUNT(DISTINCT d.category) FROM documents d WHERE d.entity_type='client' AND d.entity_id=c.id AND d.category IN ('" . implode("','", self::REQUIRED_DOCS) . "')) AS docs_done,
                    (SELECT COUNT(*) FROM trips t WHERE t.client_id=c.id AND t.status NOT IN ('Cancelled','Rejected')) AS trip_count,
                    (SELECT COALESCE(SUM(b.total_amount - b.amount_paid),0) FROM billings b WHERE b.client_id=c.id AND b.status IN ('Invoiced','Partially Paid')) AS balance
                FROM clients c ORDER BY FIELD(c.status,'Pending Rate','Active','Incomplete','Inactive'), c.company_name"),
        ]);
        $data['requiredDocs'] = self::REQUIRED_DOCS;
        $data['defaultTerms'] = Settings::value('default_payment_terms_days');
        $data['can'] = ['edit' => hasRole($u, ...self::EDIT), 'rate' => hasRole($u, ...self::RATE)];
        return $data;
    }

    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'create' => self::create($u, $d),
            'update' => self::update($u, $d),
            'documents' => self::documents($u, $d),
            'rate_save' => self::rateSave($u, $d),
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
            'contact_number' => field($d, 'contact_number', 60),
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
            $id = insert($p, 'clients', $row + ['status' => 'Pending Rate', 'created_by' => $u['id']]);
            run($p, 'UPDATE clients SET client_code=? WHERE id=?', ['CL-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT), $id]);
            foreach (self::REQUIRED_DOCS as $input => $cat) Files::store($p, $u, $input, 'client', $id, $cat, true, $cat);
            audit($p, $u['id'], 'Clients', 'client ' . $id, 'client profile created', $row['company_name'] . ' -> Pending Rate');
            Notify::roles($p, ['billing'], 'Client rate needed', 'New client ' . $row['company_name'] . ' is waiting for its billing rate.', 'clients', 'client-rate-' . $id);
            return ['id' => $id, 'message' => 'Client profile saved. It now waits for Billing to set the rate (Pending Rate).'];
        });
    }

    private static function update(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id');
        $row = self::infoFields($d);
        return transaction(function (PDO $p) use ($u, $id, $row) {
            must((bool)one($p, 'SELECT id FROM clients WHERE id=? FOR UPDATE', [$id]), 'Client not found.', 404);
            self::assertUnique($p, $row, $id);
            $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($row)));
            run($p, "UPDATE clients SET $cols WHERE id=?", array_merge(array_values($row), [$id]));
            audit($p, $u['id'], 'Clients', 'client ' . $id, 'client information updated', $row['company_name']);
            return ['id' => $id, 'message' => 'Client information updated.'];
        });
    }

    /** Upload missing or renewed accreditation files. An Incomplete client becomes Pending Rate when complete. */
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
                run($p, "UPDATE clients SET status='Pending Rate' WHERE id=?", [$id]);
                audit($p, $u['id'], 'Clients', 'client ' . $id, 'client requirements completed', $c['company_name'] . ' -> Pending Rate');
                Notify::roles($p, ['billing'], 'Client rate needed', 'Client ' . $c['company_name'] . ' is complete and waiting for its billing rate.', 'clients', 'client-rate-' . $id);
                $msg .= ' All requirements are complete; the client now waits for Billing to set the rate.';
            } elseif ($missing) $msg .= ' Still missing: ' . implode(', ', $missing) . '.';
            return ['message' => $msg];
        });
    }

    /** Billing sets the rate per truck type (rate per km and optional minimum charge) and payment terms. */
    private static function rateSave(array $u, array $d): array {
        requireRole($u, ...self::RATE);
        $id = idField($d, 'id');
        $rates = $d['rates'] ?? null;
        must(is_array($rates), 'Enter at least one rate.');
        $clean = [];
        foreach ($rates as $r) {
            if (!is_array($r) || trim((string)($r['rate_per_km'] ?? '')) === '') continue;
            $type = choiceField($r, 'truck_type', TRUCK_TYPES);
            $clean[$type] = ['rate_per_km' => moneyField($r, 'rate_per_km'), 'minimum_charge' => trim((string)($r['minimum_charge'] ?? '')) === '' ? '0.00' : moneyField($r, 'minimum_charge', true)];
        }
        must((bool)$clean, 'Enter the rate per km for at least one truck type.');
        $terms = intField($d, 'payment_terms_days', 0, false);
        if ($terms !== null) must($terms <= 365, 'Payment terms must be 365 days or less.');
        return transaction(function (PDO $p) use ($u, $id, $clean, $terms) {
            $c = one($p, 'SELECT * FROM clients WHERE id=? FOR UPDATE', [$id]);
            must((bool)$c, 'Client not found.', 404);
            must(in_array($c['status'], ['Pending Rate', 'Active'], true), 'Rates are set after the Operations Head completes the client profile (status is ' . $c['status'] . ').', 409);
            foreach ($clean as $type => $r) {
                $p->prepare('INSERT INTO client_rates (client_id, truck_type, rate_per_km, minimum_charge, updated_by) VALUES (?,?,?,?,?)
                             ON DUPLICATE KEY UPDATE rate_per_km=VALUES(rate_per_km), minimum_charge=VALUES(minimum_charge), updated_by=VALUES(updated_by)')
                  ->execute([$id, $type, $r['rate_per_km'], $r['minimum_charge'], $u['id']]);
            }
            run($p, "UPDATE clients SET status='Active', payment_terms_days=?, rate_set_by=?, rate_set_at=NOW() WHERE id=?", [$terms, $u['id'], $id]);
            $txt = implode('; ', array_map(fn($t, $r) => "$t {$r['rate_per_km']}/km" . ((float)$r['minimum_charge'] > 0 ? " (min {$r['minimum_charge']})" : ''), array_keys($clean), $clean));
            audit($p, $u['id'], 'Clients', 'client ' . $id, 'client rate set', $c['company_name'] . ': ' . $txt);
            if ($c['status'] === 'Pending Rate') {
                Notify::resolve($p, 'client-rate-' . $id);
                Notify::roles($p, ['operations_head'], 'Client ready', 'Client ' . $c['company_name'] . ' is complete with its billing rate and can now be used for trips.', 'clients');
            }
            return ['message' => 'Rate saved. ' . $c['company_name'] . ' is Active and can be selected for trips.'];
        });
    }

    private static function setActive(array $u, array $d): array {
        requireRole($u, ...self::EDIT);
        $id = idField($d, 'id'); $active = !empty($d['active']);
        return transaction(function (PDO $p) use ($u, $id, $active) {
            $c = one($p, 'SELECT * FROM clients WHERE id=? FOR UPDATE', [$id]);
            must((bool)$c, 'Client not found.', 404);
            if ($active) {
                $hasRate = (bool)one($p, 'SELECT id FROM client_rates WHERE client_id=? LIMIT 1', [$id]);
                $status = self::missingDocs($p, $id) ? 'Incomplete' : ($hasRate ? 'Active' : 'Pending Rate');
            } else $status = 'Inactive';
            run($p, 'UPDATE clients SET status=? WHERE id=?', [$status, $id]);
            audit($p, $u['id'], 'Clients', 'client ' . $id, $active ? 'client reactivated' : 'client deactivated', $c['company_name'] . ' -> ' . $status);
            return ['message' => $c['company_name'] . ' is now ' . $status . '.' . (!$active ? ' Existing trips and billings are kept.' : '')];
        });
    }

    private static function details(array $u, array $d): array {
        must(Access::canOpen($u, 'clients') || Access::canOpen($u, 'trips'), 'Not allowed.', 403);
        $id = idField($d, 'id'); $p = db();
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
