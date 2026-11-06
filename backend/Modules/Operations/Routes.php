<?php
/*
 * =====================================================================
 *  backend/Modules/Operations/Routes.php  —  APPROVED ROUTES PER CLIENT
 * =====================================================================
 *  Checklist #20 / Objective 1.2 and 3.1.
 *
 *  A route = one client + one truck type + origin -> destination (directional:
 *  A -> B and B -> A are separate routes). The same origin and destination can
 *  have different rates for different truck types.
 *
 *  PROVISIONAL WORKFLOW (see POLICY below, pending company confirmation):
 *    1. Operations Head requests a route              -> "Pending Rate"
 *    2. Billing & Collection enters the rate           -> "Pending Approval"
 *    3. Admin approves                                  -> "Approved"
 *       (the client must STILL be eligible at approval time; rejecting is always allowed)
 *       or rejects (terminal for a new request)         -> "Rejected"
 *    Ops Head may withdraw a request that is not approved yet -> "Withdrawn"
 *    Admin may deactivate an approved route             -> "Inactive"
 *
 *  RATE REVISION of an Approved route:
 *    Billing enters a new rate (new version row, "Pending Approval"); the route
 *    stays Approved with its old rate. Admin approves -> the old rate becomes
 *    "Superseded" and the new one "Approved", in ONE transaction. Admin rejects
 *    -> only the revision is "Rejected"; the route and the old rate do not change.
 *
 *  HISTORY: an approved rate row is never edited or deleted. Every step is saved
 *  in client_route_events and in the activity log (audit_events).
 *
 *  TWO READ LISTS: approvedFor() = record/display (any client status);
 *  selectableFor() = planning eligibility (Approved route + current rate + Active client).
 *
 *  NOT CONNECTED (yet) to Trip Management or billing: the old client_rates
 *  (rate per km) and BillingDraft keep working exactly as before.
 *
 *  LOCK ORDER (prevents deadlocks): client row -> route row -> rate rows.
 * =====================================================================
 */
declare(strict_types=1);
core('Notify');

final class Routes {
    /**
     * PROVISIONAL BUSINESS POLICY — the only place to change when the company confirms.
     * Changing these lists needs no database change.
     */
    public const POLICY = [
        'request'         => ['operations_head'],          // asks for a new route
        'withdraw'        => ['operations_head'],          // withdraws own request before approval
        'rate'            => ['billing'],                  // enters / revises the contractual rate
        'approve'         => ['admin'],                    // approves or rejects the rate
        'deactivate'      => ['admin'],                    // takes an approved route out of use
        'view'            => ['admin', 'operations_head', 'billing', 'finance', 'audit'],
        'client_statuses' => ['Active', 'Pending Rate'],   // clients that can get route requests
        'rate_types'      => ['Flat'],                     // 'Per Km' is supported by the database; enable after confirmation
    ];

    public const STATUSES = ['Pending Rate', 'Pending Approval', 'Approved', 'Rejected', 'Withdrawn', 'Inactive'];
    /** Statuses that block a second route with the same client, truck type, origin and destination. */
    public const OPEN = ['Pending Rate', 'Pending Approval', 'Approved'];
    public const RATE_TYPES = ['Flat', 'Per Km'];
    public const MAX_DISTANCE_KM = 3000;
    private const PH_LAT = [4.0, 21.5];
    private const PH_LNG = [116.0, 127.5];

    // =================================================================
    // READ
    // =================================================================
    public static function read(array $u, string $page, array $q): array {
        $p = db();
        $clientId = filter_var($q['client_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
        $where = $clientId ? ' WHERE r.client_id=?' : '';
        $args = $clientId ? [$clientId] : [];
        $marks = implode(',', array_fill(0, count(self::POLICY['client_statuses']), '?'));
        $data = readSections([
            'routes' => fn() => many($p, self::listSql() . $where . " ORDER BY FIELD(r.status,'Pending Approval','Pending Rate','Approved','Rejected','Withdrawn','Inactive'), c.company_name, r.origin_label LIMIT 2000", $args),
            'clients' => fn() => many($p, "SELECT id, company_name, status FROM clients WHERE status IN ($marks) ORDER BY company_name", self::POLICY['client_statuses']),
        ]);
        $data['filterClient'] = $clientId;
        $data['truckTypes'] = TRUCK_TYPES;
        $data['rateTypes'] = self::POLICY['rate_types'];
        $data['maxDistance'] = self::MAX_DISTANCE_KM;
        $data['me'] = $u['id'];
        $data['can'] = [
            'request' => self::allowed($u, 'request'), 'withdraw' => self::allowed($u, 'withdraw'),
            'rate' => self::allowed($u, 'rate'), 'approve' => self::allowed($u, 'approve'), 'deactivate' => self::allowed($u, 'deactivate'),
        ];
        return $data;
    }

    /** Route rows with the current approved rate and the pending rate (if any). */
    private static function listSql(): string {
        return "SELECT r.id, r.route_ref, r.client_id, c.company_name AS client, r.truck_type, r.origin_label, r.destination_label,
                    r.distance_km, r.distance_source, r.status, r.requested_by, ru.full_name AS requested_by_name, r.requested_at, r.closed_reason,
                    cr.id AS rate_id, cr.version_no AS rate_version, cr.rate_type, cr.rate_amount, cr.minimum_charge, cr.effective_from,
                    pr.id AS pending_rate_id, pr.version_no AS pending_version, pr.rate_type AS pending_rate_type, pr.rate_amount AS pending_rate_amount,
                    pr.minimum_charge AS pending_minimum_charge, pr.entered_by AS pending_entered_by, pu.full_name AS pending_entered_by_name, pr.entered_at AS pending_entered_at
                FROM client_routes r
                JOIN clients c ON c.id=r.client_id
                JOIN users ru ON ru.id=r.requested_by
                LEFT JOIN client_route_rates cr ON cr.route_id=r.id AND cr.status='Approved'
                LEFT JOIN client_route_rates pr ON pr.route_id=r.id AND pr.status='Pending Approval'
                LEFT JOIN users pu ON pu.id=pr.entered_by";
    }

    /**
     * Client statuses whose Approved routes can be SELECTED for new trip planning.
     * Same rule as Trip Management today (only Active clients can be used for trips).
     */
    public const PLANNING_CLIENT_STATUSES = ['Active'];

    /** True when the client may get route requests and approvals (POLICY['client_statuses']). */
    private static function clientEligible(array $client): bool {
        return in_array($client['status'], self::POLICY['client_statuses'], true);
    }

    /** Shared SELECT of an approved route with its current approved rate. */
    private static function approvedSql(): string {
        return "SELECT r.id, r.route_ref, r.client_id, r.truck_type, r.origin_label, r.destination_label, r.distance_km, r.distance_source,
                    cr.id AS rate_id, cr.version_no AS rate_version, cr.rate_type, cr.rate_amount, cr.minimum_charge, cr.effective_from
                FROM client_routes r
                JOIN client_route_rates cr ON cr.route_id=r.id AND cr.status='Approved'
                JOIN clients c ON c.id=r.client_id
                WHERE r.client_id=? AND r.status='Approved'";
    }

    /**
     * RECORD / DISPLAY: Approved routes of a client with their current rate, WHATEVER the
     * client's status (used by the client details window, so the history of an Inactive
     * client is still visible). Do NOT use this list to choose a route for a new trip:
     * use selectableFor().
     */
    public static function approvedFor(PDO $p, int $clientId, ?string $truckType = null): array {
        $sql = self::approvedSql(); $args = [$clientId];
        if ($truckType !== null) { $sql .= ' AND r.truck_type=?'; $args[] = $truckType; }
        return many($p, $sql . ' ORDER BY r.origin_label, r.destination_label, r.truck_type', $args);
    }

    /**
     * PLANNING ELIGIBILITY: the ONLY list future batch planning may offer. A route is
     * selectable when ALL are true:
     *   - route status is Approved (not Pending, Rejected, Withdrawn or Inactive),
     *   - it has a current Approved rate,
     *   - the client's status is in PLANNING_CLIENT_STATUSES (Active).
     * Planning must call this again on the server when saving (never trust the screen).
     */
    public static function selectableFor(PDO $p, int $clientId, ?string $truckType = null): array {
        $marks = implode(',', array_fill(0, count(self::PLANNING_CLIENT_STATUSES), '?'));
        $sql = self::approvedSql() . " AND c.status IN ($marks)";
        $args = array_merge([$clientId], self::PLANNING_CLIENT_STATUSES);
        if ($truckType !== null) { $sql .= ' AND r.truck_type=?'; $args[] = $truckType; }
        return many($p, $sql . ' ORDER BY r.origin_label, r.destination_label, r.truck_type', $args);
    }

    // =================================================================
    // ACTIONS
    // =================================================================
    public static function action(array $u, string $action, array $d): array {
        return match ($action) {
            'request' => self::request($u, $d),
            'withdraw' => self::withdraw($u, $d),
            'rate_enter' => self::rateEnter($u, $d),
            'decide' => self::decide($u, $d),
            'deactivate' => self::deactivate($u, $d),
            'details' => self::details($u, $d),
            'for_client' => self::forClient($u, $d),
            default => throw new BusinessRuleException('Unknown route action.', 404),
        };
    }

    // ---------- helpers ----------
    private static function allowed(array $u, string $step): bool { return hasRole($u, ...self::POLICY[$step]); }
    private static function mustBeAllowed(array $u, string $step): void {
        must(self::allowed($u, $step), 'Your role is not allowed to do this.', 403);
    }

    /** Text as displayed: trimmed, single spaces, upper case (same style as trip points). */
    public static function label(string $v): string {
        return mb_strtoupper(trim((string)preg_replace('/\s+/u', ' ', $v)), 'UTF-8');
    }
    /**
     * Key used for the duplicate check: upper case, punctuation removed, single spaces.
     * " Tanauan,  Batangas " and "TANAUAN BATANGAS" give the same key.
     * It does NOT treat "Tanauan" and "Tanauan City" as the same place (the screen warns instead).
     */
    public static function normalize(string $v): string {
        $v = mb_strtoupper($v, 'UTF-8');
        $v = (string)preg_replace('/[^\p{L}\p{N}]+/u', ' ', $v);
        return trim((string)preg_replace('/\s+/u', ' ', $v));
    }

    private static function lockRoute(PDO $p, int $id): array {
        $r = one($p, 'SELECT * FROM client_routes WHERE id=? FOR UPDATE', [$id]);
        must((bool)$r, 'Route not found.', 404);
        return $r;
    }
    /** All rate rows of a route, locked (after the route row: see LOCK ORDER). */
    private static function lockRates(PDO $p, int $routeId): array {
        return many($p, 'SELECT * FROM client_route_rates WHERE route_id=? ORDER BY version_no FOR UPDATE', [$routeId]);
    }

    private static function event(PDO $p, ?int $uid, int $routeId, ?int $rateId, string $type, string $from, string $to, string $notes = ''): void {
        $p->prepare('INSERT INTO client_route_events (route_id, rate_id, actor_id, event_type, from_status, to_status, notes) VALUES (?,?,?,?,?,?,?)')
          ->execute([$routeId, $rateId, $uid, $type, $from, $to, cut($notes, 500)]);
        audit($p, $uid, 'Routes', 'route ' . $routeId, $type, ($from !== $to ? "$from -> $to. " : '') . $notes);
    }

    private static function routeName(array $r): string {
        return $r['route_ref'] . ' (' . $r['origin_label'] . ' to ' . $r['destination_label'] . ', ' . $r['truck_type'] . ')';
    }
    private static function rateText(string $type, string $amount, string $min): string {
        return $type === 'Flat' ? 'Flat PHP ' . number_format((float)$amount, 2)
            : 'PHP ' . number_format((float)$amount, 2) . ' per km' . ((float)$min > 0 ? ' (minimum PHP ' . number_format((float)$min, 2) . ')' : '');
    }

    /** Coordinates of both points: both or neither for each point, inside the Philippines. */
    private static function coordinates(array $d): array {
        $out = [];
        foreach (['origin' => 'origin', 'destination' => 'destination'] as $k => $label) {
            $lat = trim((string)($d[$k . '_lat'] ?? '')); $lng = trim((string)($d[$k . '_lng'] ?? ''));
            if ($lat === '' && $lng === '') { $out[$k . '_lat'] = null; $out[$k . '_lng'] = null; continue; }
            must(is_numeric($lat) && is_numeric($lng), "The map pin of the $label is incomplete. Pin it again or remove it.");
            must((float)$lat >= self::PH_LAT[0] && (float)$lat <= self::PH_LAT[1] && (float)$lng >= self::PH_LNG[0] && (float)$lng <= self::PH_LNG[1],
                "The map pin of the $label is outside the Philippines. Pin it again.");
            $out[$k . '_lat'] = round((float)$lat, 7); $out[$k . '_lng'] = round((float)$lng, 7);
        }
        return $out;
    }

    /** True when the PDO error is the duplicate-key error of the given unique key. */
    private static function isDuplicate(PDOException $e, string $key): bool {
        return ($e->errorInfo[1] ?? null) === 1062 && str_contains($e->getMessage(), $key);
    }

    // ---------- 1. request (Operations Head) ----------
    private static function request(array $u, array $d): array {
        self::mustBeAllowed($u, 'request');
        $clientId = idField($d, 'client_id');
        $type = choiceField($d, 'truck_type', TRUCK_TYPES);
        $origin = self::label(field($d, 'origin', 200));
        $destination = self::label(field($d, 'destination', 200));
        $okey = self::normalize($origin); $dkey = self::normalize($destination);
        must($okey !== '' && $dkey !== '', 'Origin and destination must contain letters or numbers.');
        must($okey !== $dkey, 'Origin and destination must be different.');
        $km = numberField($d, 'distance_km', true, self::MAX_DISTANCE_KM);
        must($km > 0, 'Enter the distance in km (more than 0).');
        $row = ['client_id' => $clientId, 'truck_type' => $type, 'origin_label' => $origin, 'destination_label' => $destination,
                'origin_key' => $okey, 'destination_key' => $dkey, 'distance_km' => number_format($km, 2, '.', ''), 'distance_source' => 'Manual',
                'notes' => optField($d, 'notes', 500), 'status' => 'Pending Rate', 'requested_by' => $u['id']] + self::coordinates($d);
        return transaction(function (PDO $p) use ($u, $row) {
            $c = one($p, 'SELECT id, company_name, status FROM clients WHERE id=? FOR UPDATE', [$row['client_id']]);
            must((bool)$c, 'Client not found.', 404);
            must(self::clientEligible($c),
                $c['company_name'] . ' is ' . $c['status'] . '. Routes can be requested only for ' . implode(' or ', self::POLICY['client_statuses']) . ' clients.', 409);
            $dup = one($p, "SELECT route_ref, status FROM client_routes WHERE client_id=? AND truck_type=? AND origin_key=? AND destination_key=? AND active_key=1 FOR UPDATE",
                [$row['client_id'], $row['truck_type'], $row['origin_key'], $row['destination_key']]);
            must(!$dup, 'This route already exists for ' . $c['company_name'] . ' (' . $row['truck_type'] . '): ' . ($dup['route_ref'] ?? '') . ', ' . ($dup['status'] ?? '') . '.', 409);
            try {
                $id = insert($p, 'client_routes', $row + ['route_ref' => 'TMP-' . bin2hex(random_bytes(6))]);
            } catch (PDOException $e) {
                // Another user saved the same route a moment earlier (the database key caught it).
                if (self::isDuplicate($e, 'uq_route_active')) throw new BusinessRuleException('This route was just requested by another user. Reload the page.', 409);
                throw $e;
            }
            $ref = refNumber('RTE', $id);
            run($p, 'UPDATE client_routes SET route_ref=? WHERE id=?', [$ref, $id]);
            $r = $row + ['route_ref' => $ref];
            self::event($p, $u['id'], $id, null, 'route requested', '', 'Pending Rate',
                $c['company_name'] . ': ' . $r['origin_label'] . ' to ' . $r['destination_label'] . ', ' . $r['truck_type'] . ', ' . $r['distance_km'] . ' km');
            Notify::roles($p, self::POLICY['rate'], 'Route rate', 'Route request ' . self::routeName($r) . ' for ' . $c['company_name'] . ' needs a rate.', 'routes', 'route-rate-' . $id);
            return ['route_id' => $id, 'route_ref' => $ref, 'message' => "Route $ref was sent to Billing for the rate (Pending Rate)."];
        });
    }

    // ---------- withdraw (Operations Head, own request, before approval) ----------
    private static function withdraw(array $u, array $d): array {
        self::mustBeAllowed($u, 'withdraw');
        $id = idField($d, 'route_id');
        $reason = field($d, 'reason', 300);
        return transaction(function (PDO $p) use ($u, $id, $reason) {
            $r = self::lockRoute($p, $id);
            must(in_array($r['status'], ['Pending Rate', 'Pending Approval'], true), 'Only a route that is not approved yet can be withdrawn (this one is ' . $r['status'] . ').', 409);
            must((int)$r['requested_by'] === $u['id'], 'Only the person who requested this route can withdraw it.', 403);
            $rates = self::lockRates($p, $id);
            foreach ($rates as $rt) {
                if ($rt['status'] !== 'Pending Approval') continue;
                run($p, "UPDATE client_route_rates SET status='Rejected', decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=?",
                    [$u['id'], 'Withdrawn together with the route request.', $rt['id']]);
                Notify::resolve($p, 'route-approve-' . $rt['id']);
            }
            run($p, "UPDATE client_routes SET status='Withdrawn', closed_reason=?, closed_by=?, closed_at=NOW() WHERE id=?", [$reason, $u['id'], $id]);
            self::event($p, $u['id'], $id, null, 'route request withdrawn', $r['status'], 'Withdrawn', $reason);
            Notify::resolve($p, 'route-rate-' . $id);
            return ['message' => $r['route_ref'] . ' was withdrawn.'];
        });
    }

    // ---------- 2. rate entry / revision (Billing) ----------
    private static function rateEnter(array $u, array $d): array {
        self::mustBeAllowed($u, 'rate');
        $id = idField($d, 'route_id');
        $type = choiceField($d, 'rate_type', self::RATE_TYPES);
        must(in_array($type, self::POLICY['rate_types'], true), 'The ' . $type . ' rate type is not enabled yet. Allowed: ' . implode(', ', self::POLICY['rate_types']) . '.');
        $amount = moneyField($d, 'rate_amount');
        $min = '0.00';
        if ($type === 'Per Km') {
            $min = trim((string)($d['minimum_charge'] ?? '')) === '' ? '0.00' : moneyField($d, 'minimum_charge', true);
        } else {
            must(trim((string)($d['minimum_charge'] ?? '')) === '' || (float)str_replace(',', '', (string)$d['minimum_charge']) == 0.0,
                'A minimum charge applies only to a Per Km rate.');
        }
        $notes = optField($d, 'notes', 300);
        return transaction(function (PDO $p) use ($u, $id, $type, $amount, $min, $notes) {
            $r0 = one($p, 'SELECT client_id FROM client_routes WHERE id=?', [$id]);
            must((bool)$r0, 'Route not found.', 404);
            $c = one($p, 'SELECT company_name, status FROM clients WHERE id=? FOR UPDATE', [$r0['client_id']]);
            $r = self::lockRoute($p, $id);
            must(in_array($r['status'], ['Pending Rate', 'Approved'], true),
                'A rate can be entered only for a route that is Pending Rate (new) or Approved (revision). This one is ' . $r['status'] . '.', 409);
            must($c['status'] !== 'Inactive', $c['company_name'] . ' is Inactive.', 409);
            $rates = self::lockRates($p, $id);
            $current = null;
            foreach ($rates as $rt) {
                must($rt['status'] !== 'Pending Approval', 'This route already has a rate waiting for approval (version ' . $rt['version_no'] . ').', 409);
                if ($rt['status'] === 'Approved') $current = $rt;
            }
            $revision = $r['status'] === 'Approved';
            if ($revision) {
                must((bool)$current, 'This approved route has no current rate. Ask the Admin to check the route history.', 409);
                must(!($current['rate_type'] === $type && (float)$current['rate_amount'] === (float)$amount && (float)$current['minimum_charge'] === (float)$min),
                    'The new rate is the same as the current approved rate.', 409);
            }
            $version = $rates ? max(array_map(fn($x) => (int)$x['version_no'], $rates)) + 1 : 1;
            try {
                $rateId = insert($p, 'client_route_rates', ['route_id' => $id, 'version_no' => $version, 'rate_type' => $type, 'rate_amount' => $amount,
                    'minimum_charge' => $min, 'status' => 'Pending Approval', 'entered_by' => $u['id'], 'entry_notes' => $notes]);
            } catch (PDOException $e) {
                if (self::isDuplicate($e, 'uq_route_rate_pending') || self::isDuplicate($e, 'uq_route_rate_version'))
                    throw new BusinessRuleException('Another rate was just entered for this route. Reload the page.', 409);
                throw $e;
            }
            $txt = self::rateText($type, $amount, $min);
            if ($revision) {
                self::event($p, $u['id'], $id, $rateId, 'rate revision entered', 'Approved', 'Approved', "Version $version: $txt (current: " . self::rateText($current['rate_type'], $current['rate_amount'], $current['minimum_charge']) . ')' . ($notes ? ". $notes" : ''));
            } else {
                run($p, "UPDATE client_routes SET status='Pending Approval' WHERE id=?", [$id]);
                self::event($p, $u['id'], $id, $rateId, 'rate entered', 'Pending Rate', 'Pending Approval', "Version $version: $txt" . ($notes ? ". $notes" : ''));
                Notify::resolve($p, 'route-rate-' . $id);
            }
            Notify::roles($p, self::POLICY['approve'], $revision ? 'Route rate revision' : 'Route approval',
                self::routeName($r) . ' of ' . $c['company_name'] . ': ' . $txt . ' is waiting for approval.', 'routes', 'route-approve-' . $rateId);
            return ['rate_id' => $rateId, 'message' => ($revision ? 'Rate revision' : 'Rate') . " saved as version $version and sent to the Admin for approval."
                . ($revision ? ' The current approved rate stays in use until the revision is approved.' : '')];
        });
    }

    // ---------- 3. approve / reject (Admin) ----------
    /**
     * Decides ONE pending rate (rate_id). Safe for double clicks and two Admin sessions:
     * the route and rate rows are locked, and a rate that is no longer "Pending Approval"
     * is refused. On approval the old rate is superseded BEFORE the new one becomes
     * Approved, inside the same transaction: if anything fails, everything is rolled
     * back and the old approved rate stays in use.
     */
    private static function decide(array $u, array $d): array {
        self::mustBeAllowed($u, 'approve');
        $rateId = idField($d, 'rate_id');
        $decision = choiceField($d, 'decision', ['approve', 'reject']);
        $notes = $decision === 'reject' ? field($d, 'reason', 300) : optField($d, 'notes', 300);
        return transaction(function (PDO $p) use ($u, $rateId, $decision, $notes) {
            $peek = one($p, 'SELECT rt.route_id, r.client_id FROM client_route_rates rt JOIN client_routes r ON r.id=rt.route_id WHERE rt.id=?', [$rateId]);
            must((bool)$peek, 'Rate not found.', 404);
            // LOCK ORDER client -> route -> rates (same as rate entry). Locking the client row means it
            // cannot be deactivated in the middle of this decision.
            $client = one($p, 'SELECT id, company_name, status FROM clients WHERE id=? FOR UPDATE', [$peek['client_id']]);
            must((bool)$client, 'Client not found.', 404);
            $r = self::lockRoute($p, (int)$peek['route_id']);
            $rates = self::lockRates($p, (int)$r['id']);
            $rate = null; $current = null;
            foreach ($rates as $rt) {
                if ((int)$rt['id'] === $rateId) $rate = $rt;
                if ($rt['status'] === 'Approved') $current = $rt;
            }
            must((bool)$rate, 'Rate not found.', 404);
            must($rate['status'] === 'Pending Approval', 'This rate was already decided (' . $rate['status'] . '). Reload the page.', 409);
            must((int)$rate['entered_by'] !== $u['id'], 'The person who entered the rate cannot approve or reject it (separation of duties).', 403);
            $revision = $r['status'] === 'Approved';
            must($revision || $r['status'] === 'Pending Approval', 'The route is ' . $r['status'] . '.', 409);
            if ($revision) must((bool)$current, 'This approved route has no current rate. Check the route history.', 409);
            // Client eligibility is checked AGAIN at approval time: the client may have been deactivated
            // after the request. Approving (new route or revision) needs an eligible client; rejecting is
            // always allowed, so a request for a deactivated client can still be closed.
            if ($decision === 'approve') {
                must(self::clientEligible($client),
                    'Cannot approve: ' . $client['company_name'] . ' is ' . $client['status'] . '. Routes can be approved only for '
                    . implode(' or ', self::POLICY['client_statuses']) . ' clients. Reject the rate, or reactivate the client first.', 409);
            }
            $txt = self::rateText($rate['rate_type'], $rate['rate_amount'], $rate['minimum_charge']);
            $c = $client;
            Notify::resolve($p, 'route-approve-' . $rateId);

            if ($decision === 'reject') {
                run($p, "UPDATE client_route_rates SET status='Rejected', decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=? AND status='Pending Approval'", [$u['id'], $notes, $rateId]);
                if ($revision) {
                    // Only the proposed revision is rejected: the route stays Approved with its old rate.
                    self::event($p, $u['id'], (int)$r['id'], $rateId, 'rate revision rejected', 'Approved', 'Approved', "Version {$rate['version_no']} ($txt): $notes");
                    $msg = 'Rate revision rejected. The route stays Approved with its current rate.';
                } else {
                    // A new route request that is rejected is closed (terminal).
                    run($p, "UPDATE client_routes SET status='Rejected', closed_reason=?, closed_by=?, closed_at=NOW() WHERE id=?", [$notes, $u['id'], $r['id']]);
                    self::event($p, $u['id'], (int)$r['id'], $rateId, 'route rejected', 'Pending Approval', 'Rejected', "Version {$rate['version_no']} ($txt): $notes");
                    $msg = 'Route rejected. A new request is needed to use this route.';
                }
                Notify::user($p, (int)$r['requested_by'], 'Route rejected', self::routeName($r) . ($revision ? ' rate revision' : '') . ' was rejected: ' . $notes, 'routes');
                Notify::user($p, (int)$rate['entered_by'], 'Route rejected', self::routeName($r) . ($revision ? ' rate revision' : '') . ' was rejected: ' . $notes, 'routes');
                return ['message' => $msg];
            }

            // APPROVE: 1) supersede the old approved rate, 2) activate the new one (same transaction).
            if ($current) {
                run($p, "UPDATE client_route_rates SET status='Superseded', effective_to=NOW() WHERE id=? AND status='Approved'", [$current['id']]);
            }
            $done = run($p, "UPDATE client_route_rates SET status='Approved', decided_by=?, decided_at=NOW(), decision_notes=?, effective_from=NOW() WHERE id=? AND status='Pending Approval'",
                [$u['id'], $notes, $rateId]);
            must($done === 1, 'The rate could not be approved. Nothing was changed. Reload the page.', 409);
            if (!$revision) run($p, "UPDATE client_routes SET status='Approved' WHERE id=?", [$r['id']]);
            self::event($p, $u['id'], (int)$r['id'], $rateId, $revision ? 'rate revision approved' : 'route approved', $r['status'], 'Approved',
                "Version {$rate['version_no']}: $txt" . ($current ? ' (replaces version ' . $current['version_no'] . ': ' . self::rateText($current['rate_type'], $current['rate_amount'], $current['minimum_charge']) . ')' : '') . ($notes ? ". $notes" : ''));
            $who = array_unique([(int)$r['requested_by'], (int)$rate['entered_by']]);
            foreach ($who as $uid) Notify::user($p, $uid, 'Route approved', self::routeName($r) . ' of ' . ($c['company_name'] ?? '') . ' is Approved: ' . $txt . '.', 'routes');
            return ['message' => ($revision ? 'Rate revision approved. ' : 'Route approved. ') . $r['route_ref'] . ' now uses ' . $txt . '.'];
        });
    }

    // ---------- deactivate (Admin) ----------
    private static function deactivate(array $u, array $d): array {
        self::mustBeAllowed($u, 'deactivate');
        $id = idField($d, 'route_id');
        $reason = field($d, 'reason', 300);
        return transaction(function (PDO $p) use ($u, $id, $reason) {
            $r = self::lockRoute($p, $id);
            must($r['status'] === 'Approved', 'Only an Approved route can be deactivated (this one is ' . $r['status'] . ').', 409);
            foreach (self::lockRates($p, $id) as $rt) {
                if ($rt['status'] !== 'Pending Approval') continue;
                run($p, "UPDATE client_route_rates SET status='Rejected', decided_by=?, decided_at=NOW(), decision_notes=? WHERE id=?",
                    [$u['id'], 'Route deactivated before this revision was decided.', $rt['id']]);
                Notify::resolve($p, 'route-approve-' . $rt['id']);
            }
            run($p, "UPDATE client_routes SET status='Inactive', closed_reason=?, closed_by=?, closed_at=NOW() WHERE id=?", [$reason, $u['id'], $id]);
            self::event($p, $u['id'], $id, null, 'route deactivated', 'Approved', 'Inactive', $reason);
            return ['message' => $r['route_ref'] . ' is now Inactive and can no longer be selected. Its history is kept.'];
        });
    }

    // ---------- read actions ----------
    private static function details(array $u, array $d): array {
        self::mustBeAllowed($u, 'view');
        $id = idField($d, 'route_id'); $p = db();
        $r = one($p, self::listSql() . ' WHERE r.id=?', [$id]);
        must((bool)$r, 'Route not found.', 404);
        $extra = one($p, 'SELECT r.notes, r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng, r.closed_at, cu.full_name AS closed_by_name
                          FROM client_routes r LEFT JOIN users cu ON cu.id=r.closed_by WHERE r.id=?', [$id]);
        return [
            'route' => $r + ($extra ?: []),
            'rates' => many($p, 'SELECT rt.id, rt.version_no, rt.rate_type, rt.rate_amount, rt.minimum_charge, rt.status, rt.entry_notes, rt.entered_at, eu.full_name AS entered_by_name,
                    rt.decided_at, du.full_name AS decided_by_name, rt.decision_notes, rt.effective_from, rt.effective_to
                FROM client_route_rates rt JOIN users eu ON eu.id=rt.entered_by LEFT JOIN users du ON du.id=rt.decided_by WHERE rt.route_id=? ORDER BY rt.version_no DESC', [$id]),
            'events' => many($p, 'SELECT e.event_type, e.from_status, e.to_status, e.notes, e.created_at, COALESCE(a.full_name, \'System\') AS actor
                FROM client_route_events e LEFT JOIN users a ON a.id=e.actor_id WHERE e.route_id=? ORDER BY e.id DESC', [$id]),
        ];
    }

    /** Read-only Approved routes of one client (used by the client details window). */
    private static function forClient(array $u, array $d): array {
        must(self::allowed($u, 'view') || Access::canOpen($u, 'clients'), 'Not allowed.', 403);
        $clientId = idField($d, 'client_id');
        return ['routes' => self::approvedFor(db(), $clientId), 'can_open_routes' => Access::canOpen($u, 'routes')];
    }
}
