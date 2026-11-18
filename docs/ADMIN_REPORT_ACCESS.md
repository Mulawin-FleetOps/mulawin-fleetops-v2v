# Centralized Admin Reports — implementation notes

## Behavior
- The Admin's **Reports** hub lists original report pages; it adds no duplicate summary KPIs.
- All non-admin reporting entries are hidden unless Admin grants a role or a user access.
- A non-admin account sees exactly one **Reports** sidebar entry when at least one page is granted. Only granted report cards appear inside.
- Existing report queries, charts, page filters, and export behavior stay in their original modules.
- Category-specific Operations, Financial and Billing routes use the same `general/reports.js` renderer and existing Analytics aggregation functions with narrowed report sections.
- Executive Reports, Descriptive/Diagnostic Analytics and the underlying Admin Analytics screen remain Admin-only.
- Permissions are checked on every page-data request by `Access::canOpen`, not just via UI hiding. Permissions are default-deny until explicitly assigned. A user override wins over the role grant, including a user-specific denial.
- Permission changes are audit logged via `audit_events`.

## Deployment requirement
Before using Admin's grant controls, **apply the approved migration** `database/migrations/2026-11-18_24_admin_report_access.sql` using the project's existing migration process. Do not manually rewrite existing migration history. The new table starts empty: no non-admin accounts have Reports access by default. Until the migration is installed, Admin can see all reports but grant controls are disabled, and non-admin report access fails closed.

## QA checklist (must be exercised against a test database)
1. As Admin, open Reports, verify all report cards and their existing chart/table data.
2. Verify anonymous and ungranted users cannot read the report page APIs by direct URL.
3. Grant one role access to Operations Reports; refresh one member account and verify sidebar visibility and scoped data. Verify the other report categories still return 403.
4. Grant an individual user Financial Reports; test role default remains unchanged for other users.
5. Set an explicit user Deny against a role Allow; ensure page disappears from the user's Reports hub and direct data requests return 403.
6. Reset user Deny to Inherit Role; verify role policy applies again.
7. Revoke all access; ensure the Reports sidebar link disappears on refresh.
8. Verify normal department dashboards, KPIs, management actions, reports exports, and existing record permissions are unchanged.
9. Verify access-change audit records and that Admin executive/diagnostic analytics cannot be delegated.

## Note on legacy General Reports
The original `reports` route is retained for backward-compatible Operations Head reports and other existing role-scoped screens. Its existing per-role data scope remains unchanged; for precise delegation, prefer the separate Operations, Financial, Billing, Maintenance, Purchasing or Audit report categories.
