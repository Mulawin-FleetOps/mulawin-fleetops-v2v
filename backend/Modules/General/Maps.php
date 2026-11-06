<?php
/*
 * =====================================================================
 *  backend/Modules/General/Maps.php  —  MAP SERVICES FOR THE SCREENS (Checklist #5)
 * =====================================================================
 *  The browser never talks to openrouteservice directly and never sees the API key.
 *  It calls these actions (logged in, CSRF-checked by public/index.php, role-checked here):
 *
 *    Maps.route    {from_lat, from_lng, to_lat, to_lng, option}  -> road km, minutes, route line
 *    Maps.geocode  {q}                                           -> up to 5 places in the Philippines
 *    Maps.reverse  {lat, lng}                                    -> address of a map point
 *
 *  When the service cannot answer, route() returns available = false with a message
 *  (the screen keeps the km field for manual entry); geocode/reverse return the message
 *  as a normal error, so the address can still be typed.
 * =====================================================================
 */
declare(strict_types=1);
core('Routing');

final class Maps {
    /** Roles that fill in pickup / destination points (trip forms and route requests). */
    public const ROLES = ['admin', 'operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher'];

    public static function read(array $u, string $page, array $q): array {
        throw new BusinessRuleException('Unknown page.', 404);
    }

    public static function action(array $u, string $action, array $d): array {
        must(hasRole($u, ...self::ROLES), 'Your role is not allowed to use the map service.', 403);
        return match ($action) {
            'route' => self::route($u, $d),
            'geocode' => self::geocode($u, $d),
            'reverse' => self::reverse($u, $d),
            default => throw new BusinessRuleException('Unknown map action.', 404),
        };
    }

    private static function route(array $u, array $d): array {
        $option = Routing::option(is_string($d['option'] ?? null) ? $d['option'] : null);
        $from = Routing::point($d['from_lat'] ?? null, $d['from_lng'] ?? null, 'origin');
        $to = Routing::point($d['to_lat'] ?? null, $d['to_lng'] ?? null, 'destination');
        try {
            $r = Routing::route(db(), $u['id'], $from, $to, $option);
            unset($r['cached']);
            return ['available' => true] + $r;
        } catch (RoutingUnavailable $e) {
            return ['available' => false, 'reason' => $e->reason, 'message' => $e->getMessage(), 'option' => $option,
                    'straight_km' => round(Routing::straightKm($from, $to), 2)];
        }
    }

    private static function geocode(array $u, array $d): array {
        $q = field($d, 'q', 150);
        try { return ['results' => Routing::search(db(), $u['id'], $q)]; }
        catch (RoutingUnavailable $e) { throw new BusinessRuleException($e->getMessage(), 503); }
    }

    private static function reverse(array $u, array $d): array {
        try { return ['address' => Routing::reverse(db(), $u['id'], $d['lat'] ?? null, $d['lng'] ?? null)]; }
        catch (RoutingUnavailable $e) { return ['address' => '', 'message' => $e->getMessage()]; }
    }
}
