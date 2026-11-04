<?php
/*
 * =====================================================================
 *  scripts/seed_test_data.php  —  COMPLETE TEST DATA for the masterlists
 * =====================================================================
 *  For a TEST copy of the system. It fills the masterlists so every flow can be tested
 *  (trips and automatic assignment, dispatch, incidents, corrective maintenance, mechanics,
 *  parts and purchasing, billing), INCLUDING the required attachments as real files.
 *
 *  What it does (safe to run again; it only ADDS what is missing):
 *    1. Imports database/seed_masterlists.sql when the masterlists are empty
 *       (29 trucks, 62 drivers, 18 helpers, 13 clients from the company workbooks, 8 mechanics).
 *    2. Completes every truck: make/model, numbers, registration and insurance dates,
 *       regular driver (and helper for Container / Wing Van), OR/CR and insurance files.
 *    3. Completes every driver and helper: employee no., contact, address, date hired,
 *       license number and expiry (drivers).
 *    4. Completes every client: information sheet, the 5 required files, billing rates -> Active.
 *    5. Mechanics, parts inventory, suppliers and an active purchasing budget.
 *    6. Adds clearly described SPECIAL CASES (fictional records) to test the rules:
 *       expired license, driver/helper on leave, truck Unavailable, truck under repair,
 *       repair waiting for verification, regular driver on leave, expiring registration,
 *       mechanic on leave, client without documents / without rate / with one rate only.
 *    7. Writes the TEST BASIS report (what the automatic assignment SHOULD pick, and what each
 *       special case should do): storage/test_data/test_data_report_<date>.html
 *
 *  It never deletes or overwrites a value that is already filled in, and never creates trips,
 *  money records or user accounts (create the accounts in User Management or with Script 1).
 *
 *  RUN (XAMPP, in the project folder):   C:\xampp\php\php.exe scripts\seed_test_data.php
 *  RUN (Hostinger with SSH):             php scripts/seed_test_data.php
 *  Hostinger without SSH:                public/seed_test_data.php (see the notes in that file)
 * =====================================================================
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && !defined('FMS_SEED_WEB')) { http_response_code(403); exit('CLI only'); }
require_once dirname(__DIR__) . '/backend/bootstrap.php';
core('FleetState');

final class TestSeed {
    private PDO $p;
    private int $actor;
    /** @var callable */
    private $log;
    private array $done = [];
    private array $cases = [];
    private string $root;
    private string $today;

    public function __construct(PDO $p, int $actorId, callable $log) {
        $this->p = $p; $this->actor = $actorId; $this->log = $log;
        $this->root = dirname(__DIR__);
        $this->today = date('Y-m-d');
    }

    private function say(string $s): void { ($this->log)($s); }
    private function count(string $k, int $n = 1): void { $this->done[$k] = ($this->done[$k] ?? 0) + $n; }
    private function day(int $offset): string { return date('Y-m-d', strtotime($this->today . ' ' . ($offset >= 0 ? '+' : '') . $offset . ' days')); }

    // ================================================================= run everything
    public function run(): array {
        $this->masterlistBase();
        $this->personnel();
        $this->trucks();
        $this->clients();
        $this->mechanics();
        $this->inventory();
        $this->specialCases();
        $report = $this->writeReport();
        return ['counts' => $this->done, 'report' => $report];
    }

    // ================================================================= 1. workbook masterlists
    private function masterlistBase(): void {
        $n = (int)one($this->p, 'SELECT COUNT(*) AS n FROM vehicles')['n'];
        if ($n > 0) { $this->say("Masterlists already have $n truck(s): completing them."); return; }
        $file = $this->root . '/database/seed_masterlists.sql';
        must(is_file($file), 'database/seed_masterlists.sql is missing.');
        $sql = preg_replace('/^\s*--.*$/m', '', (string)file_get_contents($file));
        foreach (preg_split('/;\s*\n/', $sql) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt !== '' && stripos($stmt, 'SET NAMES') !== 0) $this->p->exec($stmt);
        }
        $this->say('Imported database/seed_masterlists.sql (workbook trucks, drivers, helpers, clients, mechanics).');
        $this->count('workbook masterlists imported');
    }

    // ================================================================= 2. drivers and helpers
    private const TOWNS = ['Brgy. Darasa, Tanauan City, Batangas', 'Brgy. San Jose, Sto. Tomas, Batangas', 'Brgy. Marawoy, Lipa City, Batangas',
        'Brgy. Poblacion, Malvar, Batangas', 'Brgy. Real, Calamba City, Laguna', 'Brgy. Sambat, Tanauan City, Batangas',
        'Brgy. Balagtasin, San Jose, Batangas', 'Brgy. Santiago, Sto. Tomas, Batangas'];

    private function personnel(): void {
        $rows = many($this->p, 'SELECT * FROM personnel ORDER BY person_type, id');
        $filled = 0;
        foreach ($rows as $i => $r) {
            $id = (int)$r['id']; $set = [];
            $isD = $r['person_type'] === 'Driver';
            if (!$r['employee_no']) $set['employee_no'] = sprintf('RPM-%s-%03d', $isD ? 'D' : 'H', $id);
            if (!$r['contact_number']) $set['contact_number'] = sprintf('09%02d %03d %04d', 15 + $id % 15, 200 + ($id * 37) % 700, 1000 + ($id * 7919) % 9000);
            if (!$r['address']) $set['address'] = self::TOWNS[$id % count(self::TOWNS)];
            if (!$r['date_hired']) $set['date_hired'] = date('Y-m-d', strtotime('2016-01-15 +' . (($id * 53) % 3000) . ' days'));
            if ($isD && !$r['license_number']) $set['license_number'] = sprintf('D%02d-%02d-%06d', 1 + $id % 12, 15 + $id % 10, 100000 + $id * 1373);
            if ($isD && !$r['license_expiry']) $set['license_expiry'] = $this->day(240 + ($id * 41) % 900);
            if ($set) { $this->update('personnel', $id, $set); $filled++; }
        }
        $this->count('drivers / helpers completed', $filled);
        $this->say("Drivers and helpers: $filled record(s) completed.");
    }

    // ================================================================= 3. trucks
    private const MODELS = [
        'Car Carrier' => [['ISUZU', 'GIGA CYZ 6x4 car carrier'], ['HINO', '500 FM car carrier'], ['FUSO', 'FIGHTER FN car carrier']],
        'Container'   => [['SHACMAN', 'X3000 tractor head 6x4'], ['HOWO', 'A7 tractor head 6x4'], ['ISUZU', 'GIGA EXZ tractor head']],
        'Wing Van'    => [['ISUZU', 'FORWARD FVR wing van'], ['HINO', '500 FG wing van'], ['FUSO', 'FIGHTER FK wing van']],
    ];
    private const INSURERS = ['Malayan Insurance', 'Pioneer Insurance', 'Standard Insurance', 'Prudential Guarantee'];

    private function trucks(): void {
        $trucks = many($this->p, 'SELECT * FROM vehicles ORDER BY id');
        $takenD = array_map('intval', array_column(many($this->p, 'SELECT assigned_driver_id AS x FROM vehicles WHERE assigned_driver_id IS NOT NULL'), 'x'));
        $takenH = array_map('intval', array_column(many($this->p, 'SELECT assigned_helper_id AS x FROM vehicles WHERE assigned_helper_id IS NOT NULL'), 'x'));
        $freeDrivers = array_values(array_filter(array_map('intval', array_column(many($this->p,
            "SELECT id FROM personnel WHERE person_type='Driver' AND active=1 AND availability='Available' AND (license_expiry IS NULL OR license_expiry>=CURRENT_DATE()) ORDER BY id"), 'id')),
            fn($x) => !in_array($x, $takenD, true)));
        $freeHelpers = array_values(array_filter(array_map('intval', array_column(many($this->p,
            "SELECT id FROM personnel WHERE person_type='Helper' AND active=1 AND availability='Available' ORDER BY id"), 'id')),
            fn($x) => !in_array($x, $takenH, true)));
        $filled = 0; $docs = 0;
        foreach ($trucks as $v) {
            $id = (int)$v['id']; $set = [];
            if (str_starts_with((string)$v['notes'], 'Test scenario')) continue;   // special-case trucks are set up in step 6
            [$make, $model] = self::MODELS[$v['truck_type']][$id % 3];
            if (!$v['make_brand']) $set['make_brand'] = $make;
            if (!$v['model']) $set['model'] = $model;
            if (!$v['chassis_number']) $set['chassis_number'] = sprintf('JAL%s%07d', strtoupper(substr($make, 0, 2)), 1400000 + $id * 917);
            if (!$v['engine_number']) $set['engine_number'] = sprintf('6HK1-%06d', 300000 + $id * 433);
            if (!$v['mv_file_number']) $set['mv_file_number'] = sprintf('0423-%011d', 812000 + $id * 97);
            if (!$v['or_number']) $set['or_number'] = sprintf('77%08d', 18823000 + $id * 13);
            if (!$v['cr_number']) $set['cr_number'] = sprintf('34%07d', 2219000 + $id * 11);
            $reg = $v['registration_expiry'];
            if (!$reg || $reg < $this->day(31)) { $set['registration_expiry'] = $this->day(60 + ($id * 29) % 300); $reg = $set['registration_expiry']; }
            if (!$v['insurance_provider']) $set['insurance_provider'] = self::INSURERS[$id % 4];
            if (!$v['insurance_policy_number']) $set['insurance_policy_number'] = sprintf('CV-%s-%06d', date('Y'), 118000 + $id * 7);
            $ins = $v['insurance_expiry'];
            if (!$ins || $ins < $this->day(31)) { $set['insurance_expiry'] = $this->day(45 + ($id * 31) % 320); $ins = $set['insurance_expiry']; }
            if (!$v['assigned_driver_id'] && $freeDrivers) $set['assigned_driver_id'] = array_shift($freeDrivers);
            if ($v['truck_type'] !== 'Car Carrier' && !$v['assigned_helper_id'] && $freeHelpers) $set['assigned_helper_id'] = array_shift($freeHelpers);
            if ($set) { $this->update('vehicles', $id, $set); $filled++; }
            $docs += $this->ensureDoc('vehicle', $id, 'OR/CR', 'OR-CR ' . $v['plate_number'] . '.pdf', 'LTO OFFICIAL RECEIPT / CERTIFICATE OF REGISTRATION',
                ['Plate no.: ' . $v['plate_number'], 'Truck type: ' . $v['truck_type'], 'Registration valid until: ' . $reg], $reg);
            $docs += $this->ensureDoc('vehicle', $id, 'Insurance', 'Insurance ' . $v['plate_number'] . '.pdf', 'CERTIFICATE OF INSURANCE (COMPREHENSIVE / CTPL)',
                ['Plate no.: ' . $v['plate_number'], 'Insurer: ' . ($set['insurance_provider'] ?? $v['insurance_provider']), 'Valid until: ' . $ins], $ins);
        }
        $this->count('trucks completed', $filled); $this->count('truck files attached', $docs);
        $this->say("Trucks: $filled record(s) completed, $docs file(s) attached.");
    }

    // ================================================================= 4. clients
    private const CONTACTS = [['Rhea Manalo', 'Logistics Supervisor'], ['Mark Dimaculangan', 'Operations Manager'], ['Joanna Reyes', 'Traffic Coordinator'],
        ['Paolo Villanueva', 'Purchasing Head'], ['Grace Medina', 'Dispatch Supervisor'], ['Allan Bautista', 'Warehouse Manager'], ['Liza Ocampo', 'Account Officer']];
    private const PARKS = ['First Philippine Industrial Park, Sto. Tomas, Batangas', 'LIMA Technology Center, Malvar, Batangas', 'Light Industry & Science Park II, Calamba, Laguna',
        'Calamba Premiere Industrial Park, Calamba, Laguna', 'Batangas Port Zone, Batangas City', 'Laguna Technopark, Biñan, Laguna', 'Carmelray Industrial Park I, Calamba, Laguna'];

    private function clients(): void {
        $rows = many($this->p, "SELECT * FROM clients WHERE notes IS NULL OR notes NOT LIKE 'Test scenario%' ORDER BY id");
        $filled = 0; $docs = 0; $rates = 0;
        foreach ($rows as $i => $c) {
            $id = (int)$c['id']; $set = [];
            [$person, $pos] = self::CONTACTS[$id % count(self::CONTACTS)];
            $slug = trim(preg_replace('/[^a-z0-9]+/', '', strtolower(preg_replace('/,? INC\.?$/i', '', $c['company_name']))), '-') ?: 'client' . $id;
            if (!$c['client_code']) $set['client_code'] = 'CL-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT);
            if (!$c['tin']) $set['tin'] = sprintf('%03d-%03d-%03d-000', 100 + $id * 7, 200 + ($id * 131) % 800, 300 + ($id * 577) % 700);
            if (!$c['trade_name']) $set['trade_name'] = ucwords(strtolower($c['company_name']));
            if (!$c['nature_of_business']) $set['nature_of_business'] = ['Freight forwarding and logistics', 'Vehicle distribution', 'Customs brokerage and logistics', 'Courier and cargo services'][$id % 4];
            if (!$c['business_address']) $set['business_address'] = 'Bldg. ' . (2 + $id % 9) . ', ' . self::PARKS[$id % count(self::PARKS)];
            if (!$c['contact_person']) $set['contact_person'] = $person;
            if (!$c['contact_position']) $set['contact_position'] = $pos;
            if (!$c['contact_number']) $set['contact_number'] = sprintf('0917 %03d %04d', 300 + $id * 17 % 600, 2000 + ($id * 4421) % 7000);
            if (!$c['email']) $set['email'] = 'logistics@' . substr($slug, 0, 30) . '.example';
            if ($c['payment_terms_days'] === null) $set['payment_terms_days'] = [15, 30, 30, 45][$id % 4];
            if ($set) { $this->update('clients', $id, $set); $filled++; }
            $docs += $this->clientDocs($id, $c['company_name']);
            $rates += $this->clientRates($id, ['Car Carrier' => 140 + ($id % 5) * 5, 'Container' => 115 + ($id % 4) * 5, 'Wing Van' => 100 + ($id % 4) * 4]);
            $this->refreshClient($id);
        }
        $this->count('clients completed', $filled); $this->count('client files attached', $docs); $this->count('client rates added', $rates);
        $this->say("Clients: $filled record(s) completed, $docs file(s) attached, $rates rate(s) added.");
    }

    private function clientDocs(int $id, string $name, ?array $only = null): int {
        $n = 0;
        $list = ['Client Signature' => null, 'Company Profile' => 'COMPANY PROFILE', 'SEC/DTI Registration' => 'SEC CERTIFICATE OF INCORPORATION / DTI REGISTRATION',
                 'Business Permit' => "MAYOR'S BUSINESS PERMIT " . date('Y'), 'BIR Form 2303' => 'BIR FORM 2303 - CERTIFICATE OF REGISTRATION'];
        foreach ($list as $cat => $title) {
            if ($only !== null && !in_array($cat, $only, true)) continue;
            $n += $title === null
                ? $this->ensureImage('client', $id, $cat, 'Signature ' . $this->fileSafe($name) . '.png', $id)
                : $this->ensureDoc('client', $id, $cat, $cat . ' ' . $this->fileSafe($name) . '.pdf', $title, ['Registered name: ' . $name, 'Date issued: ' . $this->day(-200 - $id * 3)]);
        }
        return $n;
    }

    private function clientRates(int $id, array $rates): int {
        $n = 0;
        foreach ($rates as $type => $rate) {
            if (one($this->p, 'SELECT id FROM client_rates WHERE client_id=? AND truck_type=?', [$id, $type])) continue;
            insert($this->p, 'client_rates', ['client_id' => $id, 'truck_type' => $type, 'rate_per_km' => $rate, 'minimum_charge' => 3000 + ($id % 4) * 500, 'updated_by' => $this->actor]);
            $n++;
        }
        if ($n) run($this->p, 'UPDATE clients SET rate_set_by=?, rate_set_at=NOW() WHERE id=? AND rate_set_by IS NULL', [$this->actor, $id]);
        return $n;
    }

    /** Same rule as the Clients module: missing files -> Incomplete; files but no rate -> Pending Rate; else Active. */
    private function refreshClient(int $id): void {
        $c = one($this->p, 'SELECT status FROM clients WHERE id=?', [$id]);
        if ($c['status'] === 'Inactive') return;
        $docs = array_column(many($this->p, "SELECT DISTINCT category FROM documents WHERE entity_type='client' AND entity_id=?", [$id]), 'category');
        $missing = array_diff(['Client Signature', 'Company Profile', 'SEC/DTI Registration', 'Business Permit', 'BIR Form 2303'], $docs);
        $hasRate = (bool)one($this->p, 'SELECT id FROM client_rates WHERE client_id=? LIMIT 1', [$id]);
        $status = $missing ? 'Incomplete' : ($hasRate ? 'Active' : 'Pending Rate');
        if ($status !== $c['status']) run($this->p, 'UPDATE clients SET status=? WHERE id=?', [$status, $id]);
    }

    // ================================================================= 5. mechanics, parts, suppliers, budget
    private function mechanics(): void {
        $base = [['DELA CRUZ, ROMEO', 'Engine and transmission'], ['VILLANUEVA, ARNEL', 'Electrical and lighting'], ['MENDOZA, JOEL', 'Brakes and suspension'],
                 ['PASCUAL, DANILO', 'Welding and body repair'], ['RAMOS, EDGARDO', 'Tires and wheel alignment'], ['SALAZAR, BENJIE', 'Air conditioning and cooling'],
                 ['TORRES, NOEL', 'Hydraulics (car carrier ramps)'], ['AQUINO, RENATO', 'General mechanic']];
        $added = 0;
        foreach ($base as $i => [$name, $spec]) {
            if (one($this->p, 'SELECT id FROM mechanics WHERE full_name=?', [$name])) continue;
            $this->newMechanic($name, $spec, sprintf('09%02d 555 01%02d', 17 + $i % 3, $i + 1));
            $added++;
        }
        foreach (many($this->p, 'SELECT * FROM mechanics') as $m) {
            $set = [];
            if (!$m['contact_number']) $set['contact_number'] = sprintf('0918 555 %04d', 100 + (int)$m['id']);
            if (!$m['specialization']) $set['specialization'] = 'General mechanic';
            if ($m['notes'] === 'Sample record') $set['notes'] = 'Company mechanic';
            if ($set) $this->update('mechanics', (int)$m['id'], $set);
        }
        $this->count('mechanics added', $added);
        $this->say("Mechanics: $added added; all have contact and specialization.");
    }

    private function newMechanic(string $name, string $spec, string $contact, string $notes = 'Company mechanic'): int {
        $id = insert($this->p, 'mechanics', ['mechanic_code' => 'TMP-' . bin2hex(random_bytes(4)), 'full_name' => $name, 'contact_number' => $contact, 'specialization' => $spec, 'notes' => $notes]);
        run($this->p, 'UPDATE mechanics SET mechanic_code=? WHERE id=?', ['MEC-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT), $id]);
        return $id;
    }

    private function inventory(): void {
        $parts = [
            ['BRK-CH30', 'Brake chamber type 30 (air brake)', 'Brakes', 'pc', 3850, 2, 6],
            ['BRK-PAD-HD', 'Brake lining set, heavy duty', 'Brakes', 'set', 4200, 2, 5],
            ['BRK-HOSE-12', 'Air brake hose 1/2 in. x 12 in.', 'Brakes', 'pc', 650, 4, 12],
            ['TIR-1100R20', 'Tire 11.00 R20 (radial)', 'Tires', 'pc', 16500, 4, 8],
            ['TIR-TUBE-20', 'Inner tube 11.00-20', 'Tires', 'pc', 1350, 4, 10],
            ['OIL-15W40', 'Engine oil 15W-40 (18 L pail)', 'Lubricants', 'pail', 5200, 3, 6],
            ['FLT-OIL-HK1', 'Oil filter (6HK1 engine)', 'Filters', 'pc', 980, 5, 14],
            ['FLT-FUEL-HK1', 'Fuel filter (6HK1 engine)', 'Filters', 'pc', 1150, 5, 9],
            ['BAT-3SMF', 'Battery 3SMF 12 V', 'Electrical', 'pc', 7800, 2, 3],
            ['LMP-H4-24V', 'Headlight bulb H4 24 V', 'Electrical', 'pc', 320, 6, 20],
            ['HYD-SEAL-KIT', 'Hydraulic cylinder seal kit (ramp)', 'Hydraulics', 'kit', 2900, 2, 1],
            ['CLU-KIT-430', 'Clutch kit 430 mm', 'Transmission', 'set', 18500, 1, 0],
        ];
        $added = 0;
        foreach ($parts as [$no, $desc, $cat, $unit, $cost, $reorder, $qty]) {
            if (one($this->p, 'SELECT id FROM parts WHERE part_number=?', [$no])) continue;
            $pid = insert($this->p, 'parts', ['part_number' => $no, 'description' => $desc, 'category' => $cat, 'unit' => $unit, 'unit_cost' => $cost,
                'reorder_level' => $reorder, 'quantity_on_hand' => $qty, 'warranty_info' => in_array($cat, ['Tires', 'Electrical'], true) ? '6 months' : null]);
            if ($qty > 0) $this->stockIn($pid, $qty, $cost);
            $added++;
        }
        $sup = [['Calamba Truck Parts Center', 'Jun Ilagan', '049 545 2210', 'sales@calambatruckparts.example', 'National Highway, Brgy. Parian, Calamba City, Laguna'],
                ['Tanauan Tire and Battery Supply', 'Lorna Mercado', '043 778 1102', 'orders@tanauantire.example', 'J.P. Laurel Highway, Tanauan City, Batangas'],
                ['Batangas Heavy Equipment Parts', 'Ramon Castillo', '043 723 8890', 'parts@bhep.example', 'Diversion Road, Batangas City']];
        $s = 0;
        foreach ($sup as [$name, $person, $num, $email, $addr]) {
            if (one($this->p, 'SELECT id FROM suppliers WHERE name=?', [$name])) continue;
            insert($this->p, 'suppliers', ['name' => $name, 'contact_person' => $person, 'contact_number' => $num, 'email' => $email, 'address' => $addr]); $s++;
        }
        if (!one($this->p, "SELECT id FROM budgets WHERE status='Active' AND category='Purchasing'")) {
            insert($this->p, 'budgets', ['category' => 'Purchasing', 'amount' => 250000, 'period_start' => date('Y-m-01'), 'period_end' => date('Y-m-t', strtotime('+2 months')), 'set_by' => $this->actor]);
            $this->count('purchasing budget set');
        }
        $this->count('parts added', $added); $this->count('suppliers added', $s);
        $this->say("Inventory: $added part(s), $s supplier(s); active purchasing budget ready.");
    }

    /** Opening stock as a stock movement, so inventory reports start from a real record. */
    private function stockIn(int $partId, int $qty, float $cost): void {
        insert($this->p, 'stock_movements', ['part_id' => $partId, 'movement_type' => 'Adjustment', 'quantity_delta' => $qty, 'unit_cost' => $cost,
            'reason' => 'Opening stock (test data)', 'reference_type' => 'adjustment', 'actor_id' => $this->actor]);
    }

    // ================================================================= 6. special cases
    private function specialCases(): void {
        $added = 0;
        // --- people
        $exp = $this->person('RAMIREZ, DANILO', 'Driver', ['license_expiry' => $this->day(-20)], 'Test scenario: license EXPIRED - must never be auto-assigned.');
        $leave = $this->person('GARCIA, NOEL', 'Driver', ['availability' => 'Unavailable', 'unavailable_reason' => 'Sick leave'], 'Test scenario: driver on leave - must never be auto-assigned.');
        $resigned = $this->person('SANTOS, EFREN', 'Driver', ['active' => 0], 'Test scenario: inactive (resigned) - hidden from choices.');
        $hLeave = $this->person('LOPEZ, ARMANDO', 'Helper', ['availability' => 'Unavailable', 'unavailable_reason' => 'Vacation leave'], 'Test scenario: helper on leave - must never be auto-assigned.');
        $this->case('Driver with EXPIRED license', 'RAMIREZ, DANILO (Driver Masterlist)', 'Create several trips.', 'Never chosen as driver or second driver; the Driver Masterlist shows the expired license.');
        $this->case('Driver on leave', 'GARCIA, NOEL', 'Create trips; then set him Available in the Driver Masterlist.', 'Never chosen while Unavailable; after Set Available he can be chosen.');
        $this->case('Inactive driver', 'SANTOS, EFREN', 'Look for him in trip assignment choices.', 'Not offered anywhere; history kept.');
        $this->case('Helper on leave', 'LOPEZ, ARMANDO', 'Create Container / Wing Van trips.', 'Never chosen as helper while Unavailable.');
        // --- trucks
        $t = [];
        $t['unav'] = $this->truck('NEX5521', 'W91', 'Wing Van', ['status' => 'Unavailable', 'status_reason' => 'LTO registration renewal'], 'Test scenario: truck set Unavailable by the Operations Head.');
        $t['repair'] = $this->truck('NEX5522', 'C91', 'Container', [], 'Test scenario: truck with an open repair (Under Repair).');
        $t['verify'] = $this->truck('NEX5523', '91', 'Car Carrier', [], 'Test scenario: repair completed but NOT verified yet.');
        $t['regleave'] = $this->truck('NEX5524', '92', 'Car Carrier', ['assigned_driver_id' => $leave], 'Test scenario: regular driver is on leave.');
        $t['expiring'] = $this->truck('NEX5525', 'W92', 'Wing Van', ['registration_expiry' => $this->day(20)], 'Test scenario: registration expires within 30 days (dashboard alert) but truck is assignable.');
        $t['inactive'] = $this->truck('NEX5526', 'W93', 'Wing Van', ['active' => 0], 'Test scenario: inactive truck (sold) - hidden from choices.');
        // repair records for the two maintenance cases (only when the truck was just created)
        if ($t['repair'][1]) {
            $mech = (int)one($this->p, "SELECT id FROM mechanics WHERE full_name='MENDOZA, JOEL'")['id'];
            $this->job((int)$t['repair'][0], 'Air leak at the rear brake chamber; truck cannot hold brake pressure.', 'High', 'Under Repair', $mech,
                'Rear brake chamber diaphragm torn.', 'Replace brake chamber (BRK-CH30).');
        }
        if ($t['verify'][1]) {
            $mech = (int)one($this->p, "SELECT id FROM mechanics WHERE full_name='DELA CRUZ, ROMEO'")['id'];
            $this->job((int)$t['verify'][0], 'Engine overheats on long trips.', 'Normal', 'Completed', $mech,
                'Radiator clogged; fan belt worn.', 'Flush radiator, replace fan belt.', 'Radiator flushed and fan belt replaced; engine temperature normal in garage test.');
        }
        $this->case('Truck set Unavailable', 'NEX5521 (Wing Van)', 'Create Wing Van trips; then Ops Head sets it Available.', 'Never assigned while Unavailable; after Set Available it can be assigned (a waiting Wing Van trip gets it automatically).');
        $this->case('Truck under repair', 'NEX5522 (Container), record "Air leak..." Under Repair, mechanic MENDOZA, JOEL', 'Create Container trips; try Set Available; report another problem on it.',
            'Never assigned; manual Available is refused; a second report is refused (one unresolved record per truck); MENDOZA, JOEL shows Assigned.');
        $this->case('Repair completed, waiting for verification', 'NEX5523 (Car Carrier)', 'Create Car Carrier trips, then Motorpool opens the record and clicks Verify & return to service (Passed).',
            'Not assigned before verification (truck stays Under Maintenance). After Passed it becomes Available, and a waiting Car Carrier trip is assigned to it automatically.');
        $this->case('Regular driver on leave', 'NEX5524 (Car Carrier), regular driver GARCIA, NOEL', 'Create Car Carrier trips.',
            'Ranked after trucks whose regular driver is free; when picked, another free driver is used (never GARCIA).');
        $this->case('Registration expiring soon', 'NEX5525 (Wing Van)', 'Open the Dashboard; create Wing Van trips.', 'Dashboard "Needs attention" counts it; it is still assignable.');
        $this->case('Inactive truck', 'NEX5526', 'Look in assignment choices and the trip form availability.', 'Not counted, not offered.');
        // --- mechanics
        if (!one($this->p, "SELECT id FROM mechanics WHERE full_name='FLORES, RENATO'")) {
            $id = $this->newMechanic('FLORES, RENATO', 'Engine and transmission', '0919 555 0141', 'Test scenario: mechanic on leave.');
            run($this->p, "UPDATE mechanics SET availability='Unavailable', unavailable_reason='Vacation leave' WHERE id=?", [$id]); $added++;
        }
        if (!one($this->p, "SELECT id FROM mechanics WHERE full_name='NAVARRO, LITO'")) {
            $id = $this->newMechanic('NAVARRO, LITO', 'Welding and body repair', '0919 555 0142', 'Test scenario: inactive mechanic (resigned).');
            run($this->p, 'UPDATE mechanics SET active=0 WHERE id=?', [$id]); $added++;
        }
        $this->case('Mechanic on leave / inactive', 'FLORES, RENATO (Unavailable), NAVARRO, LITO (inactive)', 'Assign a mechanic to any repair.', 'Neither appears in the mechanic dropdown.');
        $this->case('Mechanic already on a repair', 'MENDOZA, JOEL (on NEX5522)', 'Assign a mechanic to another repair; try to set him Unavailable.', 'Not in the dropdown; Unavailable is refused while he is assigned.');
        // --- clients
        $c1 = $this->client('BATANGAS BAY FREIGHT CORP.', 'Test scenario: missing Business Permit and BIR 2303 - stays Incomplete.', ['Client Signature', 'Company Profile', 'SEC/DTI Registration'], []);
        $c2 = $this->client('SOUTHPORT CARGO SOLUTIONS INC.', 'Test scenario: complete files but NO billing rate - Pending Rate.', null, []);
        $c3 = $this->client('TANAUAN AGRI TRADING CORP.', 'Test scenario: rate for Wing Van ONLY.', null, ['Wing Van' => 98]);
        $this->case('Client with missing files', 'BATANGAS BAY FREIGHT CORP.', 'New trip: look for the client; Billing tries Set rate.', 'Not in the client list of New trip (status Incomplete); rate refused until files are complete.');
        $this->case('Client without rate', 'SOUTHPORT CARGO SOLUTIONS INC.', 'New trip; then Billing sets a rate.', 'Not offered for trips while Pending Rate; Active right after the rate is saved.');
        $this->case('Client with one rate only', 'TANAUAN AGRI TRADING CORP.', 'New trip with Car Carrier, then with Wing Van.', 'Car Carrier is refused ("no billing rate for Car Carrier"); Wing Van is accepted.');
        // --- stock
        $this->case('Low stock and no stock', 'HYD-SEAL-KIT (1 left, reorder 2), CLU-KIT-430 (0)', 'Parts & Purchasing > Inventory; request 2 clutch kits for a repair.',
            'Both listed as low stock; the request cannot be released (Not Available) and Purchasing can create a PO from it.');
        $this->case('PO approval routing', 'Any part', 'Create a PO up to PHP 10,000, and another above PHP 10,000.', 'Up to 10,000 goes to Finance; above goes to the Admin (setting: purchase approval limit). Budget is reserved at approval.');
        $this->count('special-case mechanics added', $added);
        $this->say('Special cases ready (see the report for what each one should do).');
    }

    private function person(string $name, string $type, array $extra, string $note): int {
        $r = one($this->p, 'SELECT id FROM personnel WHERE full_name=? AND person_type=?', [$name, $type]);
        if ($r) return (int)$r['id'];
        $id = insert($this->p, 'personnel', ['full_name' => $name, 'person_type' => $type, 'notes' => $note]);
        $set = ['employee_no' => sprintf('RPM-%s-%03d', $type === 'Driver' ? 'D' : 'H', $id), 'contact_number' => sprintf('0920 444 %04d', $id),
                'address' => self::TOWNS[$id % count(self::TOWNS)], 'date_hired' => '2022-06-01'];
        if ($type === 'Driver') { $set['license_number'] = sprintf('D09-24-%06d', 700000 + $id); $set['license_expiry'] = $this->day(500); }
        $this->update('personnel', $id, $extra + $set);
        $this->count('special-case people added');
        return $id;
    }

    /** @return array{0:int,1:bool} id and whether it was created now */
    private function truck(string $plate, string $unit, string $type, array $extra, string $note): array {
        $r = one($this->p, 'SELECT id FROM vehicles WHERE plate_number=?', [$plate]);
        if ($r) return [(int)$r['id'], false];
        [$make, $model] = self::MODELS[$type][strlen($plate) % 3];
        $row = ['plate_number' => $plate, 'truck_number' => one($this->p, 'SELECT id FROM vehicles WHERE truck_number=?', [$unit]) ? null : $unit, 'truck_type' => $type,
            'make_brand' => $make, 'model' => $model, 'chassis_number' => 'JALTS' . substr(md5($plate), 0, 9), 'engine_number' => '6HK1-' . substr(crc32($plate) . '', 0, 6),
            'mv_file_number' => '0423-' . substr(crc32('mv' . $plate) . '000000', 0, 11), 'or_number' => '77' . substr(crc32('or' . $plate) . '0000', 0, 8),
            'cr_number' => '34' . substr(crc32('cr' . $plate) . '000', 0, 7), 'registration_expiry' => $this->day(200), 'insurance_provider' => 'Pioneer Insurance',
            'insurance_policy_number' => 'CV-' . date('Y') . '-' . substr(crc32('in' . $plate) . '', 0, 6), 'insurance_expiry' => $this->day(180), 'notes' => $note];
        $status = $extra['status'] ?? null; unset($extra['status']);
        $row = $extra + $row;
        // regular crew from people who have no truck yet
        if (!array_key_exists('assigned_driver_id', $row)) {
            $d = one($this->p, "SELECT id FROM personnel p WHERE person_type='Driver' AND active=1 AND availability='Available' AND (license_expiry IS NULL OR license_expiry>=CURRENT_DATE())
                                AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.assigned_driver_id=p.id) ORDER BY id DESC LIMIT 1");
            $row['assigned_driver_id'] = $d['id'] ?? null;
        }
        if ($type !== 'Car Carrier') {
            $h = one($this->p, "SELECT id FROM personnel p WHERE person_type='Helper' AND active=1 AND availability='Available' AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.assigned_helper_id=p.id) ORDER BY id DESC LIMIT 1");
            $row['assigned_helper_id'] = $h['id'] ?? null;
        }
        $id = insert($this->p, 'vehicles', $row);
        if ($status) { run($this->p, 'UPDATE vehicles SET status=? WHERE id=?', [$status, $id]);
            $this->p->prepare('INSERT INTO vehicle_status_log (vehicle_id, from_status, to_status, reason, actor_id) VALUES (?,?,?,?,?)')->execute([$id, 'Available', $status, $row['status_reason'] ?? '', $this->actor]); }
        $this->ensureDoc('vehicle', $id, 'OR/CR', 'OR-CR ' . $plate . '.pdf', 'LTO OFFICIAL RECEIPT / CERTIFICATE OF REGISTRATION', ['Plate no.: ' . $plate, 'Valid until: ' . $row['registration_expiry']], $row['registration_expiry']);
        $this->ensureDoc('vehicle', $id, 'Insurance', 'Insurance ' . $plate . '.pdf', 'CERTIFICATE OF INSURANCE', ['Plate no.: ' . $plate, 'Valid until: ' . $row['insurance_expiry']], $row['insurance_expiry']);
        $this->count('special-case trucks added');
        return [$id, true];
    }

    private function job(int $vid, string $problem, string $priority, string $status, int $mechId, string $findings, string $diagnosis, ?string $performed = null): void {
        $jid = insert($this->p, 'maintenance_jobs', ['job_ref' => 'TMP-' . bin2hex(random_bytes(6)), 'vehicle_id' => $vid, 'source' => 'On-Premise', 'problem' => $problem,
            'reported_on' => $this->day(-3), 'priority' => $priority, 'status' => 'Reported', 'created_by' => $this->actor]);
        run($this->p, 'UPDATE maintenance_jobs SET job_ref=? WHERE id=?', [refNumber('CM', $jid), $jid]);
        $ev = $this->p->prepare('INSERT INTO maintenance_events (maintenance_job_id, from_status, to_status, mechanic_id, details, actor_id) VALUES (?,?,?,?,?,?)');
        $ev->execute([$jid, null, 'Reported', null, $problem, $this->actor]);
        $this->ensureImage('maintenance', $jid, 'Inspection Photo', 'Inspection photo ' . refNumber('CM', $jid) . '.png', $jid + 7);
        run($this->p, "UPDATE maintenance_jobs SET mechanic_id=?, status='Under Inspection', started_by=?, started_at=NOW() WHERE id=?", [$mechId, $this->actor, $jid]);
        $ev->execute([$jid, 'Reported', 'Under Inspection', $mechId, 'mechanic assigned', $this->actor]);
        run($this->p, "UPDATE maintenance_jobs SET status='Under Repair', findings=?, diagnosis=?, expected_completion=? WHERE id=?", [$findings, $diagnosis, $this->day(2), $jid]);
        $ev->execute([$jid, 'Under Inspection', 'Under Repair', $mechId, 'diagnosis: ' . $diagnosis, $this->actor]);
        if ($status === 'Completed') {
            $this->ensureDoc('maintenance', $jid, 'Repair Evidence', 'Repair receipt ' . refNumber('CM', $jid) . '.pdf', 'SERVICE / REPAIR RECEIPT', ['Work done: ' . $performed]);
            run($this->p, "UPDATE maintenance_jobs SET status='Completed', repair_performed=?, completed_on=?, completed_by=?, completed_at=NOW() WHERE id=?", [$performed, $this->day(-1), $this->actor, $jid]);
            $ev->execute([$jid, 'Under Repair', 'Completed', $mechId, 'corrective action: ' . $performed, $this->actor]);
            run($this->p, "UPDATE mechanics SET availability='Available' WHERE id=? AND availability='Assigned'", [$mechId]);
        } else {
            run($this->p, "UPDATE mechanics SET availability='Assigned' WHERE id=?", [$mechId]);
        }
        FleetState::reconcile($this->p, $vid, $this->actor, 'Corrective maintenance ' . refNumber('CM', $jid) . ' (test data)');
        $this->count('special-case repair records added');
    }

    private function client(string $name, string $note, ?array $docs, array $rates): int {
        $r = one($this->p, 'SELECT id FROM clients WHERE company_name=?', [$name]);
        if ($r) return (int)$r['id'];
        $id = insert($this->p, 'clients', ['company_name' => $name, 'status' => 'Incomplete', 'notes' => $note, 'created_by' => $this->actor]);
        [$person, $pos] = self::CONTACTS[$id % count(self::CONTACTS)];
        $this->update('clients', $id, ['client_code' => 'CL-' . str_pad((string)$id, 3, '0', STR_PAD_LEFT), 'tin' => sprintf('%03d-%03d-%03d-000', 600 + $id, 410 + $id, 520 + $id),
            'trade_name' => ucwords(strtolower($name)), 'nature_of_business' => 'Freight forwarding and logistics', 'business_address' => 'Bldg. 3, ' . self::PARKS[$id % count(self::PARKS)],
            'contact_person' => $person, 'contact_position' => $pos, 'contact_number' => sprintf('0917 610 %04d', $id), 'email' => 'ops@client' . $id . '.example', 'payment_terms_days' => 30]);
        $this->clientDocs($id, $name, $docs);
        $this->clientRates($id, $rates);
        $this->refreshClient($id);
        $this->count('special-case clients added');
        return $id;
    }

    private function case(string $title, string $records, string $how, string $expected): void {
        $this->cases[] = [$title, $records, $how, $expected];
    }

    // ================================================================= files (real PDF / PNG)
    private function update(string $table, int $id, array $set): void {
        $cols = implode(',', array_map(fn($c) => "$c=?", array_keys($set)));
        run($this->p, "UPDATE $table SET $cols WHERE id=?", array_merge(array_values($set), [$id]));
    }

    private function fileSafe(string $s): string { return trim(preg_replace('/[^A-Za-z0-9 .&-]+/', '', $s)); }

    private function storeBytes(string $entity, int $entityId, string $category, string $original, string $bytes, string $mime, string $ext, ?string $expires = null): int {
        $dir = $this->root . '/storage/private';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $storage = bin2hex(random_bytes(20)) . '.' . $ext;
        must(file_put_contents($dir . '/' . $storage, $bytes) !== false, 'Cannot write to storage/private (check folder permissions).');
        storedFiles($dir . '/' . $storage);   // removed again if the whole run fails
        insert($this->p, 'documents', ['category' => $category, 'entity_type' => $entity, 'entity_id' => $entityId, 'original_filename' => cut($original, 220),
            'storage_name' => $storage, 'mime_type' => $mime, 'byte_size' => strlen($bytes), 'expires_on' => $expires, 'notes' => 'Test data (generated sample file)', 'uploaded_by' => $this->actor]);
        return 1;
    }

    private function hasDoc(string $entity, int $id, string $category): bool {
        return (bool)one($this->p, 'SELECT id FROM documents WHERE entity_type=? AND entity_id=? AND category=? LIMIT 1', [$entity, $id, $category]);
    }

    private function ensureDoc(string $entity, int $id, string $category, string $name, string $title, array $lines, ?string $expires = null): int {
        if ($this->hasDoc($entity, $id, $category)) return 0;
        return $this->storeBytes($entity, $id, $category, $name, self::pdf($title, $lines), 'application/pdf', 'pdf', $expires);
    }

    private function ensureImage(string $entity, int $id, string $category, string $name, int $seed): int {
        if ($this->hasDoc($entity, $id, $category)) return 0;
        return $this->storeBytes($entity, $id, $category, $name, self::png($seed), 'image/png', 'png');
    }

    /** Minimal valid one-page PDF (Helvetica) - a labelled SAMPLE document. */
    private static function pdf(string $title, array $lines): string {
        $esc = fn($s) => str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], preg_replace('/[^\x20-\x7E]/', '', $s));
        $t = "BT /F1 9 Tf 50 800 Td (SAMPLE DOCUMENT - TEST DATA FOR MULAWIN FLEETOPS - FICTIONAL) Tj ET\n";
        $t .= "BT /F1 16 Tf 50 770 Td (" . $esc($title) . ") Tj ET\n";
        $y = 740;
        foreach (array_merge(['R P MULAWIN TRUCKING SERVICE test records'], $lines) as $l) { $t .= "BT /F1 11 Tf 50 $y Td (" . $esc($l) . ") Tj ET\n"; $y -= 18; }
        $t .= "50 120 m 250 120 l S\nBT /F1 9 Tf 50 106 Td (Authorized signature) Tj ET\n";
        $objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
            "<< /Length " . strlen($t) . " >>\nstream\n" . $t . "endstream", '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
        $out = "%PDF-1.4\n"; $offs = [];
        foreach ($objs as $i => $o) { $offs[] = strlen($out); $out .= ($i + 1) . " 0 obj\n" . $o . "\nendobj\n"; }
        $x = strlen($out);
        $out .= "xref\n0 " . (count($objs) + 1) . "\n0000000000 65535 f \n";
        foreach ($offs as $o) $out .= sprintf("%010d 00000 n \n", $o);
        return $out . "trailer\n<< /Size " . (count($objs) + 1) . " /Root 1 0 R >>\nstartxref\n$x\n%%EOF\n";
    }

    /** Pure-PHP PNG (no GD needed): white background with a signature-like stroke. */
    private static function png(int $seed): string {
        $w = 360; $h = 120; $px = array_fill(0, $h, str_repeat("\xff\xff\xff", $w));
        mt_srand($seed);
        $pts = []; for ($i = 0; $i < 9; $i++) $pts[] = [20 + $i * 40, mt_rand(25, 95)];
        $plot = function (int $x, int $y) use (&$px, $w, $h) {
            for ($dx = -1; $dx <= 1; $dx++) for ($dy = -1; $dy <= 1; $dy++) {
                $xx = $x + $dx; $yy = $y + $dy;
                if ($xx >= 0 && $xx < $w && $yy >= 0 && $yy < $h) $px[$yy] = substr_replace($px[$yy], "\x14\x24\x6b", $xx * 3, 3);
            }
        };
        for ($i = 1; $i < count($pts); $i++) {
            [$x0, $y0] = $pts[$i - 1]; [$x1, $y1] = $pts[$i];
            $steps = max(abs($x1 - $x0), abs($y1 - $y0));
            for ($s = 0; $s <= $steps; $s++) $plot((int)round($x0 + ($x1 - $x0) * $s / $steps), (int)round($y0 + ($y1 - $y0) * $s / $steps));
        }
        $raw = ''; foreach ($px as $row) $raw .= "\x00" . $row;
        $chunk = fn($type, $data) => pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
        return "\x89PNG\r\n\x1a\n" . $chunk('IHDR', pack('NNCCCCC', $w, $h, 8, 2, 0, 0, 0)) . $chunk('IDAT', gzcompress($raw, 6)) . $chunk('IEND', '');
    }

    // ================================================================= 7. test basis report
    /** Same order as Trips::autoAssign, for trips of ONE truck type created one after another (no other trips). */
    private function simulate(string $type): array {
        $trucks = many($this->p, "SELECT v.id, v.plate_number, v.truck_number, v.assigned_driver_id, v.assigned_helper_id FROM vehicles v
            WHERE v.active=1 AND v.truck_type=? AND v.status='Available'
              AND NOT EXISTS (SELECT 1 FROM trip_assignments a WHERE a.resource_type='vehicle' AND a.resource_id=v.id)
              AND NOT EXISTS (SELECT 1 FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1)
            ORDER BY (SELECT COUNT(*) FROM trips x WHERE x.vehicle_id=v.id AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)), v.id", [$type]);
        $free = fn(string $t) => array_map('intval', array_column(many($this->p, "SELECT pe.id FROM personnel pe WHERE pe.active=1 AND pe.person_type=? AND pe.availability='Available'
              AND (pe.person_type<>'Driver' OR pe.license_expiry IS NULL OR pe.license_expiry>=CURRENT_DATE())
              AND NOT EXISTS (SELECT 1 FROM trip_assignments a WHERE a.resource_type='person' AND a.resource_id=pe.id)
            ORDER BY (SELECT COUNT(*) FROM trips x WHERE (x.driver_id=pe.id OR x.driver2_id=pe.id OR x.helper_id=pe.id) AND x.status='Completed' AND x.completed_at>=DATE_SUB(NOW(), INTERVAL 30 DAY)), pe.id", [$t]), 'id'));
        $names = array_column(many($this->p, 'SELECT id, full_name FROM personnel'), 'full_name', 'id');
        $drivers = $free('Driver'); $helpers = $type === 'Car Carrier' ? [] : $free('Helper');
        $out = []; $n = 0;
        while (true) {
            $n++;
            if (!$trucks) { $out[] = [$n, 'Awaiting Resources', "No $type truck is available.", '', '']; break; }
            if (!$drivers) { $out[] = [$n, 'Awaiting Resources', 'No driver is available.', '', '']; break; }
            if ($type !== 'Car Carrier' && !$helpers) { $out[] = [$n, 'Awaiting Resources', 'No helper is available.', '', '']; break; }
            usort($trucks, function ($a, $b) use ($drivers, $helpers) {
                $sa = (in_array((int)$a['assigned_driver_id'], $drivers, true) ? 2 : 0) + (in_array((int)$a['assigned_helper_id'], $helpers, true) ? 1 : 0);
                $sb = (in_array((int)$b['assigned_driver_id'], $drivers, true) ? 2 : 0) + (in_array((int)$b['assigned_helper_id'], $helpers, true) ? 1 : 0);
                return $sb <=> $sa ?: ((int)$a['id'] <=> (int)$b['id']);
            });
            $v = array_shift($trucks);
            $regular = in_array((int)$v['assigned_driver_id'], $drivers, true);
            $d = $regular ? (int)$v['assigned_driver_id'] : $drivers[0];
            $drivers = array_values(array_filter($drivers, fn($x) => $x !== $d));
            $second = ''; $helper = '';
            if ($type === 'Car Carrier') { if ($drivers) { $second = $names[$drivers[0]] ?? ''; array_shift($drivers); } }
            else {
                $h = in_array((int)$v['assigned_helper_id'], $helpers, true) ? (int)$v['assigned_helper_id'] : $helpers[0];
                $helpers = array_values(array_filter($helpers, fn($x) => $x !== $h)); $helper = ($names[$h] ?? '') . ((int)$v['assigned_helper_id'] === $h ? ' (regular)' : '');
            }
            $out[] = [$n, $v['plate_number'] . ($v['truck_number'] ? ' #' . $v['truck_number'] : ''), ($names[$d] ?? '') . ($regular ? ' (regular)' : ' (regular driver not free)'), $second, $helper];
        }
        return $out;
    }

    private function writeReport(): string {
        $e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $table = function (array $head, array $rows, bool $verdict = true) use ($e): string {
            $h = '<table' . ($verdict ? ' class="verdict"' : '') . '><thead><tr>' . implode('', array_map(fn($x) => '<th>' . $e($x) . '</th>', $head)) . '</tr></thead><tbody>';
            foreach ($rows as $r) $h .= '<tr>' . implode('', array_map(fn($x) => '<td>' . $e($x) . '</td>', $r)) . '</tr>';
            return $h . '</tbody></table>';
        };
        $trucks = many($this->p, "SELECT v.*, d.full_name AS driver, h.full_name AS helper,
              (SELECT GROUP_CONCAT(DISTINCT category ORDER BY category SEPARATOR ', ') FROM documents x WHERE x.entity_type='vehicle' AND x.entity_id=v.id) AS docs,
              (SELECT CONCAT(m.job_ref, ' ', m.status) FROM maintenance_jobs m WHERE m.vehicle_id=v.id AND m.open_key=1 LIMIT 1) AS open_job
            FROM vehicles v LEFT JOIN personnel d ON d.id=v.assigned_driver_id LEFT JOIN personnel h ON h.id=v.assigned_helper_id ORDER BY v.truck_type, v.id");
        $truckRows = array_map(function ($v) {
            $why = !(int)$v['active'] ? 'NO - inactive' : ($v['open_job'] ? 'NO - open repair ' . $v['open_job'] : ($v['status'] !== 'Available' ? 'NO - ' . $v['status'] . ($v['status_reason'] ? ' (' . $v['status_reason'] . ')' : '') : 'Yes'));
            return [$v['plate_number'], $v['truck_number'], $v['truck_type'], trim(($v['make_brand'] ?? '') . ' ' . ($v['model'] ?? '')), $v['status'], $v['driver'], $v['truck_type'] === 'Car Carrier' ? '-' : $v['helper'],
                $v['registration_expiry'], $v['insurance_expiry'], $v['docs'], $why];
        }, $trucks);
        $people = many($this->p, "SELECT pe.*, (SELECT GROUP_CONCAT(v.plate_number) FROM vehicles v WHERE v.assigned_driver_id=pe.id OR v.assigned_helper_id=pe.id) AS regular_of FROM personnel pe ORDER BY pe.person_type, pe.full_name");
        $peopleRows = array_map(function ($p) {
            $why = !(int)$p['active'] ? 'NO - inactive' : ($p['availability'] !== 'Available' ? 'NO - ' . $p['availability'] . ($p['unavailable_reason'] ? ' (' . $p['unavailable_reason'] . ')' : '')
                : ($p['person_type'] === 'Driver' && $p['license_expiry'] && $p['license_expiry'] < date('Y-m-d') ? 'NO - license expired' : 'Yes'));
            return [$p['full_name'], $p['person_type'], $p['employee_no'], $p['contact_number'], $p['license_number'] ?: '-', $p['license_expiry'] ?: '-', $p['regular_of'] ?: '-', $why];
        }, $people);
        $clients = many($this->p, "SELECT c.*, (SELECT GROUP_CONCAT(CONCAT(r.truck_type, ' ', r.rate_per_km) ORDER BY r.truck_type SEPARATOR '; ') FROM client_rates r WHERE r.client_id=c.id) AS rates,
              (SELECT COUNT(DISTINCT x.category) FROM documents x WHERE x.entity_type='client' AND x.entity_id=c.id) AS files FROM clients c ORDER BY c.status, c.company_name");
        $clientRows = array_map(fn($c) => [$c['client_code'], $c['company_name'], $c['status'], $c['files'] . ' / 5', $c['rates'] ?: '-', $c['payment_terms_days'] . ' days', $c['contact_person'], $c['status'] === 'Active' ? 'Yes' : 'NO'], $clients);
        $mech = many($this->p, "SELECT m.*, (SELECT job_ref FROM maintenance_jobs j WHERE j.active_mechanic=m.id LIMIT 1) AS job FROM mechanics m ORDER BY m.mechanic_code");
        $mechRows = array_map(fn($m) => [$m['mechanic_code'], $m['full_name'], $m['specialization'], $m['contact_number'], (int)$m['active'] ? $m['availability'] : 'Inactive', $m['job'] ?: '-',
            (int)$m['active'] && $m['availability'] === 'Available' ? 'Yes' : 'NO'], $mech);
        $parts = many($this->p, 'SELECT * FROM parts ORDER BY part_number');
        $partRows = array_map(fn($x) => [$x['part_number'], $x['description'], $x['quantity_on_hand'] . ' ' . $x['unit'], $x['reorder_level'], number_format((float)$x['unit_cost'], 2), (int)$x['quantity_on_hand'] <= (int)$x['reorder_level'] ? 'LOW' : 'OK'], $parts);
        $sim = '';
        foreach (['Car Carrier', 'Container', 'Wing Van'] as $type) {
            $rows = $this->simulate($type);
            $sim .= '<h3>' . $e($type) . ' trips created one after another</h3>' . $table(['Trip #', 'Truck', 'Driver', $type === 'Car Carrier' ? 'Second driver' : 'Helper'],
                array_map(fn($r) => [$r[0], $r[1], $r[2], $type === 'Car Carrier' ? $r[3] : $r[4]], $rows), false);
        }
        $caseRows = array_map(fn($c) => [$c[0], $c[1], $c[2], $c[3]], $this->cases);
        $counts = []; foreach ($this->done as $k => $v) $counts[] = [$k, $v];
        $stats = one($this->p, "SELECT (SELECT COUNT(*) FROM vehicles) t, (SELECT COUNT(*) FROM personnel WHERE person_type='Driver') d, (SELECT COUNT(*) FROM personnel WHERE person_type='Helper') h,
            (SELECT COUNT(*) FROM clients) c, (SELECT COUNT(*) FROM mechanics) m, (SELECT COUNT(*) FROM parts) p, (SELECT COUNT(*) FROM documents) f");
        $html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Mulawin FleetOps - Test data and expected results</title><style>
            body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#1f2328;font-size:13px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:26px 0 6px;border-bottom:2px solid #1f2328;padding-bottom:4px}
            h3{font-size:14px;margin:16px 0 4px}table{border-collapse:collapse;width:100%;margin:6px 0 10px}th,td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
            th{background:#f6f8fa}table.verdict td:last-child{font-weight:bold}.muted{color:#57606a}.box{background:#fff8e1;border:1px solid #f0c36d;padding:8px 10px;border-radius:4px}
            @media print{h2{break-before:auto}tr{break-inside:avoid}}</style></head><body>'
            . '<h1>Mulawin FleetOps - Test data and expected results</h1><div class="muted">Generated ' . date('Y-m-d H:i') . ' by scripts/seed_test_data.php</div>'
            . '<p>' . $e("Masterlists now: {$stats['t']} trucks, {$stats['d']} drivers, {$stats['h']} helpers, {$stats['c']} clients, {$stats['m']} mechanics, {$stats['p']} parts, {$stats['f']} files.") . '</p>'
            . '<div class="box">How to use: create trips as the Operations Head (Trip Management &gt; New trip) and compare the truck and crew the system assigns with section 1. '
            . 'Then go through the special cases in section 2. The expected order assumes no other active trips and no completed trips in the last 30 days; '
            . 'trips of different truck types share the same drivers, so mixing types changes who is free. After testing, run this script again to get an updated report.</div>'
            . '<h2>1. Expected automatic assignment</h2><p class="muted">Rule (Trips::autoAssign): Available truck of the same type, no open repair; trucks whose regular driver (and helper) are free come first, then fewest recent trips, then oldest record. '
            . 'Driver = regular driver if free, otherwise the free driver with the fewest recent trips (valid license, Available, active). Car Carrier adds a second free driver. Container / Wing Van need a helper (regular helper first). '
            . 'When nothing is free the trip becomes Awaiting Resources and is assigned automatically when a truck and crew become free.</p>' . $sim
            . '<h2>2. Special cases to test</h2>' . $table(['Case', 'Records', 'How to test', 'Expected result'], $caseRows, false)
            . '<h2>3. Trucks</h2>' . $table(['Plate', 'Unit', 'Type', 'Make / model', 'Status', 'Regular driver', 'Regular helper', 'Registration until', 'Insurance until', 'Files', 'Can be auto-assigned'], $truckRows)
            . '<h2>4. Drivers and helpers</h2>' . $table(['Name', 'Type', 'Employee no.', 'Contact', 'License no.', 'License expiry', 'Regular crew of', 'Can be auto-assigned'], $peopleRows)
            . '<h2>5. Clients</h2>' . $table(['Code', 'Client', 'Status', 'Files', 'Rates per km (PHP)', 'Terms', 'Contact', 'Can be used for trips'], $clientRows)
            . '<h2>6. Mechanics</h2>' . $table(['ID', 'Name', 'Specialization', 'Contact', 'Availability', 'Current repair', 'In the assignment dropdown'], $mechRows)
            . '<h2>7. Parts inventory</h2>' . $table(['Part no.', 'Description', 'On hand', 'Reorder level', 'Unit cost (PHP)', 'Stock'], $partRows)
            . '<h2>8. What this run added</h2>' . $table(['Item', 'Count'], $counts ?: [['Nothing new - everything was already complete', 0]], false)
            . '<p class="muted">Accounts are not created by this script. Create one per role in User Management (or automation/script1_init_accounts.py). Sample files are labelled "SAMPLE DOCUMENT - TEST DATA".</p></body></html>';
        $dir = $this->root . '/storage/test_data';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        if (!is_file($dir . '/.htaccess')) file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
        $path = $dir . '/test_data_report_' . date('Ymd_His') . '.html';
        file_put_contents($path, $html);
        return $path;
    }
}

/** Runs everything in one transaction; files written are removed if it fails. */
function fmsSeedTestData(callable $log): array {
    $p = db();
    $admin = one($p, "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1");
    must((bool)$admin, 'Create the Admin account first (public/install.php or scripts/create_user.php).');
    $seed = new TestSeed($p, (int)$admin['id'], $log);
    $result = transaction(fn() => $seed->run());
    audit($p, (int)$admin['id'], 'Admin', 'test data', 'test data loaded (scripts/seed_test_data.php)', json_encode($result['counts']));
    return $result;
}

if (PHP_SAPI === 'cli' && !defined('FMS_SEED_WEB') && realpath($argv[0] ?? '') === realpath(__FILE__)) {
    $yes = in_array('--yes', $argv, true);
    echo "Mulawin FleetOps - load complete TEST data into the database in .env\n";
    echo "Use this on a TEST copy. It only adds missing data and never deletes anything.\n";
    if (!$yes) { echo "Type YES to continue: "; if (trim((string)fgets(STDIN)) !== 'YES') { echo "Cancelled.\n"; exit(1); } }
    try {
        $r = fmsSeedTestData(function ($s) { echo "  - $s\n"; });
        echo "\nDone. Test basis report (open it in your browser):\n  " . $r['report'] . "\n";
        exit(0);
    } catch (Throwable $e) {
        fwrite(STDERR, "\nFAILED: " . $e->getMessage() . "\nNothing was saved.\n");
        exit(1);
    }
}
