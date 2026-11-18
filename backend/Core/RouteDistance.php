<?php
/*
 * =====================================================================
 *  backend/Core/RouteDistance.php  —  ONE set of distance rules for Client Routes AND Trips
 * =====================================================================
 *  Checklist #5 (Phase 2 = Client Routes, Phase 3 = Trip Management).
 *
 *  1. resolve()          road distance from map pins (openrouteservice through Routing.php)
 *  2. fromClientRoute()  distance of an APPROVED client route chosen for a trip
 *  3. selectable()       the ONLY eligibility rule for choosing an approved route
 *
 *  The km sent by the browser is never trusted: the server computes the reference km
 *  again (map) or reads it from the approved route, and decides the distance source:
 *
 *    Manual                  typed km (no pins / no route option / map service unavailable)
 *    Map                     km = computed road distance (2 decimals)
 *    Map (edited)            km differs from the computed road distance -> reason REQUIRED
 *    Client Route            km = distance of the approved client route
 *    Client Route (edited)   km differs from the approved route distance -> reason REQUIRED
 *
 *  A difference above OVERRIDE_WARNING_RATIO (15%) returns a warning (never blocks).
 *  Implementation defaults, not final business policy (km billing / toll policy to be confirmed).
 *  Contract pricing uses the approved fixed route rate; TripPricing snapshots fuel separately.
 * =====================================================================
 */
declare(strict_types=1);
core('Routing');

final class RouteDistance {
    public const OVERRIDE_WARNING_RATIO = 0.15;
    /** Clients whose approved routes can be chosen for NEW work (same rule as trips: Active only). */
    public const PLANNING_CLIENT_STATUSES = ['Active'];
    public const SOURCES = ['Manual', 'Map', 'Map (edited)', 'Client Route', 'Client Route (edited)'];

    /** Empty distance columns (= typed km, Manual). 'geometry' is stored by the caller where it keeps route lines. */
    public static function manual(): array {
        return ['distance_source' => 'Manual', 'route_option' => null, 'distance_computed_km' => null, 'distance_provider' => null,
                'distance_computed_at' => null, 'distance_override_reason' => null, 'geometry' => null];
    }

    /**
     * Road distance from two map pins. $finalKm = the km the user typed (null = left empty).
     * Returns ['cols' => distance columns, 'km' => final km or null, 'warning' => text].
     */
    public static function resolve(int $userId, array $d, ?float $finalKm, ?array $a, ?array $b): array {
        must(!isset($d['route_option']) || is_string($d['route_option']), 'Unknown route option. Choose one from the list.');
        $opt = trim((string)($d['route_option'] ?? ''));
        if ($opt !== '') $opt = Routing::option($opt);   // an unknown option is refused even without map pins
        if ($opt === '' || !$a || !$b || $a[0] === null || $b[0] === null) return ['cols' => self::manual(), 'km' => $finalKm, 'warning' => ''];
        try {
            $r = Routing::route(db(), $userId, [$a[0], $a[1]], [$b[0], $b[1]], $opt);
        } catch (RoutingUnavailable $e) {
            return ['cols' => self::manual(), 'km' => $finalKm, 'warning' => 'Automatic km was not available (' . $e->getMessage() . ') '
                . ($finalKm === null ? 'No km was saved; the Operations Head enters it at review.' : 'The typed km was saved as Manual.')];
        }
        $computed = (float)$r['distance_km'];
        $cols = ['distance_source' => 'Map', 'route_option' => $opt, 'distance_computed_km' => number_format($computed, 2, '.', ''),
                 'distance_provider' => $r['provider'], 'distance_computed_at' => date('Y-m-d H:i:s'), 'distance_override_reason' => null,
                 'geometry' => $r['geometry'] !== '' ? $r['geometry'] : null];
        $km = $finalKm ?? $computed;
        [$reason, $warning] = self::override($d, $km, $computed, 'the computed road distance');
        if ($reason !== null) { $cols['distance_source'] = 'Map (edited)'; $cols['distance_override_reason'] = $reason; }
        return ['cols' => $cols, 'km' => round($km, 2), 'warning' => trim($r['warning'] . ' ' . $warning)];
    }

    /**
     * Distance of an approved client route chosen for a trip. The route must be selectable
     * for THIS client and truck type (Approved, current approved rate, Active client).
     * Returns ['cols' => ..., 'km' => ..., 'warning' => ..., 'route' => row, 'points' => [[lat,lng],[lat,lng]] or null].
     */
    public static function fromClientRoute(PDO $p, int $routeId, int $clientId, ?string $truckType, array $d, ?float $finalKm): array {
        must($truckType !== null && $truckType !== '', 'Choose the truck type before choosing an approved client route.');
        $r = self::selectable($p, $clientId, $truckType, $routeId)[0] ?? null;
        must((bool)$r, 'The chosen client route cannot be used for this client and truck type. It must be Approved, with an approved rate, for an Active client. Choose another route, or pin the points on the map.', 409);
        $reference = (float)$r['distance_km'];
        $km = $finalKm ?? $reference;
        $cols = ['distance_source' => 'Client Route', 'route_option' => $r['route_option'], 'distance_computed_km' => number_format($reference, 2, '.', ''),
                 'distance_provider' => 'Client route ' . $r['route_ref'], 'distance_computed_at' => date('Y-m-d H:i:s'), 'distance_override_reason' => null,
                 'geometry' => self::routeGeometry($p, (int)$r['id'])];
        [$reason, $warning] = self::override($d, $km, $reference, 'the approved route distance');
        if ($reason !== null) { $cols['distance_source'] = 'Client Route (edited)'; $cols['distance_override_reason'] = $reason; }
        $points = $r['origin_lat'] !== null && $r['destination_lat'] !== null
            ? [[(float)$r['origin_lat'], (float)$r['origin_lng']], [(float)$r['destination_lat'], (float)$r['destination_lng']]] : null;
        return ['cols' => $cols, 'km' => round($km, 2), 'warning' => $warning, 'route' => $r, 'points' => $points];
    }

    /** [reason or null, warning]: a reason is required when the km differs (2 decimals) from the reference km. */
    private static function override(array $d, float $km, float $reference, string $what): array {
        if (abs(round($km, 2) - $reference) < 0.005) return [null, ''];
        $reason = trim((string)($d['distance_override_reason'] ?? ''));
        must($reason !== '', 'The km (' . number_format($km, 2) . ') is different from ' . $what . ' (' . number_format($reference, 2)
            . ' km). Give the reason for the change, or use the ' . ($what === 'the computed road distance' ? 'computed' : 'route') . ' km.');
        must(textLength($reason) <= 300, 'The reason is too long (max 300 characters).');
        $warning = abs($km - $reference) > self::OVERRIDE_WARNING_RATIO * $reference
            ? 'The km differs from ' . $what . ' by more than ' . (int)(self::OVERRIDE_WARNING_RATIO * 100) . '%. The reason is kept with the record.' : '';
        return [$reason, $warning];
    }

    /**
     * APPROVED ROUTES THAT MAY BE CHOSEN (the only eligibility rule, used by Client Routes and Trips):
     * route Approved + a current Approved rate + client status in PLANNING_CLIENT_STATUSES.
     * Includes the rate (Client Routes needs it); screens for trips leave the rate out.
     */
    public static function selectable(PDO $p, int $clientId, ?string $truckType = null, ?int $routeId = null): array {
        $marks = implode(',', array_fill(0, count(self::PLANNING_CLIENT_STATUSES), '?'));
        $sql = "SELECT r.id, r.route_ref, r.client_id, r.truck_type, r.origin_label, r.destination_label, r.distance_km, r.distance_source,
                    r.route_option, r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng, r.distance_provider,
                    cr.id AS rate_id, cr.version_no AS rate_version, cr.rate_type, cr.rate_amount, cr.minimum_charge, cr.effective_from
                FROM client_routes r
                JOIN client_route_rates cr ON cr.route_id=r.id AND cr.status='Approved' AND cr.rate_type='Flat'
                JOIN clients c ON c.id=r.client_id
                WHERE r.client_id=? AND r.status='Approved' AND c.status IN ($marks)";
        $args = array_merge([$clientId], self::PLANNING_CLIENT_STATUSES);
        if ($truckType !== null) { $sql .= ' AND r.truck_type=?'; $args[] = $truckType; }
        if ($routeId !== null) { $sql .= ' AND r.id=?'; $args[] = $routeId; }
        return many($p, $sql . ' ORDER BY r.origin_label, r.destination_label, r.truck_type', $args);
    }

    public static function routeGeometry(PDO $p, int $routeId): ?string {
        $g = one($p, 'SELECT route_geometry FROM client_routes WHERE id=?', [$routeId])['route_geometry'] ?? null;
        return is_string($g) && $g !== '' ? $g : null;
    }
}
