<?php
/*
 * =====================================================================
 *  backend/Core/Access.php  —  WHO CAN OPEN WHICH PAGE
 * =====================================================================
 *  One short menu. Every page belongs to ONE backend module
 *  (backend/Modules/<Department>/<Module>.php) and ONE screen file
 *  (public/assets/js/modules/<department>/<file>.js).
 *
 *  Roles follow PDF #11 "User Roles and Access Requirements".
 *  This list only decides which pages a role can OPEN. Every save action
 *  checks the role again in its module (requireRole / must), so typing a
 *  URL or calling the API directly does not bypass the rules.
 * =====================================================================
 */
declare(strict_types=1);

final class Access {
    /** Small headings in the menu (only shown when the role has pages under them). */
    public const SECTIONS = ['Masterlists', 'Maintenance', 'Accounting', 'Records'];

    public static function pages(): array {
        $D = ['car_carrier_dispatcher', 'container_wingvan_dispatcher'];
        $all = array_keys(ROLE_LABELS);
        return [
            // id => [label, icon, section, module, js file, roles]
            'dashboard'   => ['Dashboard', 'bi-grid-1x2', null, 'Analytics', 'general/dashboard', $all],
            'trips'       => ['Trip Management', 'bi-signpost-split', null, 'Trips', 'operations/trips',
                              array_merge(['admin', 'operations_head', 'motorpool', 'billing', 'audit'], $D)],

            'trucks'      => ['Truck Masterlist', 'bi-truck', 'Masterlists', 'Fleet', 'operations/fleet',
                              array_merge(['admin', 'operations_head', 'motorpool', 'purchasing', 'audit'], $D)],
            'crew'        => ['Driver Masterlist', 'bi-person-badge', 'Masterlists', 'Fleet', 'operations/fleet',
                              array_merge(['admin', 'operations_head', 'audit'], $D)],
            'clients'     => ['Client Masterlist', 'bi-building', 'Masterlists', 'Clients', 'operations/clients',
                              array_merge(['admin', 'operations_head', 'billing', 'finance', 'audit'], $D)],
            'mechanics'   => ['Mechanic Masterlist', 'bi-person-gear', 'Masterlists', 'Mechanics', 'maintenance/mechanics',
                              ['admin', 'operations_head', 'motorpool', 'audit']],

            'maintenance' => ['Corrective Maintenance', 'bi-wrench-adjustable', 'Maintenance', 'Maintenance', 'maintenance/maintenance',
                              ['admin', 'operations_head', 'motorpool', 'audit']],
            'purchasing'  => ['Parts & Purchasing', 'bi-box-seam', 'Maintenance', 'Purchasing', 'maintenance/purchasing',
                              ['admin', 'motorpool', 'purchasing', 'finance', 'audit']],

            'funds'       => ['Trip Funds', 'bi-cash-coin', 'Accounting', 'Funds', 'accounting/funds',
                              array_merge(['admin', 'operations_head', 'finance', 'audit'], $D)],
            'billing'     => ['Billing & Collection', 'bi-receipt', 'Accounting', 'Billing', 'accounting/billing',
                              ['admin', 'billing', 'finance', 'audit']],
            'finance'     => ['Finance', 'bi-wallet2', 'Accounting', 'Finance', 'accounting/finance',
                              ['admin', 'finance', 'audit']],

            'documents'   => ['Documents', 'bi-folder2-open', 'Records', 'Documents', 'general/documents', $all],
            'reports'     => ['Reports', 'bi-bar-chart-line', 'Records', 'Analytics', 'general/reports',
                              ['admin', 'operations_head', 'motorpool', 'purchasing', 'finance', 'billing', 'audit']],
            'notifications' => ['Notifications', 'bi-bell', 'Records', 'Admin', 'general/notifications', $all],
            'admin'       => ['User Management', 'bi-people', 'Records', 'Admin', 'administration/admin', ['admin', 'audit']],
        ];
    }

    /** Pages the user can open, for the menu. */
    public static function navFor(array $u): array {
        $out = [];
        foreach (self::pages() as $id => [$label, $icon, $section, $module, $js, $roles]) {
            if (in_array($u['role'], $roles, true)) {
                $out[] = ['id' => $id, 'label' => $label, 'icon' => $icon, 'section' => $section, 'js' => $js];
            }
        }
        return $out;
    }

    public static function canOpen(array $u, string $page): bool {
        $p = self::pages()[$page] ?? null;
        return $p !== null && in_array($u['role'], $p[5], true);
    }

    public static function moduleOf(string $page): ?string { return self::pages()[$page][3] ?? null; }
}
