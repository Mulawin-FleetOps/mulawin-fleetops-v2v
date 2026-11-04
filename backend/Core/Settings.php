<?php
/*
 * =====================================================================
 *  backend/Core/Settings.php  —  SYSTEM SETTINGS (simple values)
 * =====================================================================
 *  Where does a value come from?
 *    1. A value saved by the Admin in Administration > Settings (table app_settings)
 *    2. Otherwise the default below.
 *  Some defaults are read from config/formulas.php (values the company
 *  already gave: purchase limit 10,000; 1 liter = 4 km; reminder days ...).
 *
 *  Fund request categories are kept in their own table (fund_categories).
 * =====================================================================
 */
declare(strict_types=1);

final class Settings {
    /**
     * key => [label, default, unit, help, min, max]
     * Defaults marked "config" are taken from config/formulas.php when present.
     */
    public const DEFS = [
        'purchase_approval_threshold' => ['Purchase approval limit', 10000, 'PHP',
            'Purchase orders up to this amount go to Finance for approval; above it they go to the Admin (PDF #12).', 1, 100000000],
        'document_alert_days'         => ['Remind about expiring truck documents', 30, 'days before',
            'OR/CR registration, insurance and uploaded documents with an expiry date.', 1, 365],
        'license_alert_days'          => ['Remind about expiring driver licenses', 30, 'days before', '', 1, 365],
        'default_payment_terms_days'  => ['Default client payment terms', 30, 'days',
            'Used when the client has no payment terms. Due date = invoice date + terms.', 0, 365],
        'vat_rate'                    => ['VAT rate shown on the service invoice', 12, '%',
            'Billed amounts are VAT-inclusive. The invoice shows VATable sales and VAT. Use 0 if not VAT-registered.', 0, 30],
        'km_per_liter'                => ['Kilometers per liter of diesel', 4, 'km/L',
            'For the estimated diesel cost of a trip (PDF #13: 1 liter = 4 km).', 0.1, 100],
        'fuel_price_per_liter'        => ['Diesel price per liter', 100, 'PHP/L',
            'Used with the value above: estimated diesel = (km / km per liter) x price.', 0, 1000],
        'units_per_trip'              => ['Default units per car carrier trip', 5, 'units',
            'First value of "units" on a car carrier trip; can be changed per trip.', 1, 20],
    ];
    private const FROM_CONFIG = ['purchase_approval_threshold', 'document_alert_days', 'license_alert_days',
                                 'default_payment_terms_days', 'km_per_liter', 'fuel_price_per_liter', 'units_per_trip'];

    private static ?array $saved = null;
    private static ?array $config = null;

    public static function clearCache(): void { self::$saved = null; }

    private static function config(): array {
        if (self::$config === null) {
            $file = dirname(__DIR__, 2) . '/config/formulas.php';
            $cfg = is_file($file) ? require $file : [];
            self::$config = is_array($cfg) ? ($cfg['values'] ?? []) : [];
        }
        return self::$config;
    }

    private static function saved(): array {
        if (self::$saved === null) {
            self::$saved = [];
            try {
                foreach (many(db(), 'SELECT setting_key, setting_value FROM app_settings') as $r) self::$saved[$r['setting_key']] = $r['setting_value'];
            } catch (Throwable $e) { error_log('Settings read failed: ' . $e->getMessage()); }
        }
        return self::$saved;
    }

    public static function default(string $key): float {
        must(isset(self::DEFS[$key]), 'Unknown setting ' . $key);
        if (in_array($key, self::FROM_CONFIG, true) && isset(self::config()[$key]['value'])) return (float)self::config()[$key]['value'];
        return (float)self::DEFS[$key][1];
    }

    public static function value(string $key): float {
        $saved = self::saved();
        return array_key_exists($key, $saved) ? (float)$saved[$key] : self::default($key);
    }

    /** All settings for the Administration > Settings page. */
    public static function all(): array {
        $out = [];
        foreach (self::DEFS as $key => [$label, , $unit, $help, $min, $max]) {
            $out[] = ['key' => $key, 'label' => $label, 'unit' => $unit, 'help' => $help, 'min' => $min, 'max' => $max,
                      'value' => self::value($key), 'default' => self::default($key)];
        }
        return $out;
    }

    /** Estimated diesel cost of a trip: (km / km per liter) x diesel price. */
    public static function fuelEstimate(float $km): float {
        $kpl = self::value('km_per_liter');
        return $kpl > 0 ? round($km / $kpl * self::value('fuel_price_per_liter'), 2) : 0.0;
    }
}
