# Workflow-grounded Analytics: incident evidence phase

## Scope
Admin's existing Descriptive and Diagnostic Analytics pages are retained. No new operational workflow, table, migration, status, approval, or data-entry action is introduced.

The **Operations Diagnostic** panel no longer presents legacy manually recorded Delay updates as a primary diagnostic finding. It now uses the current Trip Incident reporting flow and directly linked maintenance jobs:

- `incidents.id / incident_ref / incident_type / incident_at / problem / location`
- `incidents.trip_id -> trips.id`
- `incidents.vehicle_id -> vehicles.id`
- `maintenance_jobs.incident_id = incidents.id AND maintenance_jobs.trip_id = trips.id`

The read-only query is in `Oversight::analyticsWithReports()` and is available to the existing **Admin-only** analytics pages. The chart counts incidents by their recorded types; selecting a bar or category filters the supporting records. A "View evidence" action displays recorded incident/trip/job fields and navigation to the existing source modules. If there is no explicit job link, it says "No linked repair"; it does not search for a speculative truck repair.

**Time definition:** incident event timestamp (`incident_at`) within the selected date window. `total` counts all incidents; the evidence list is capped at 1,000 newest events and the visible table at 100 rows per selected category. Multiple incidents may belong to one trip. Filtered trip/job counts reflect the loaded evidence set, not necessarily the full population when capped.

## Existing analytics preserved
- Descriptive: trip activity/status; maintenance activity/downtime/cost; billed/collected/expenses; inventory movements/value.
- Diagnostic: maintenance downtime and recorded repair cost rankings; receivables aging and overdue invoices; part issue and stock-related rankings.
- The established report aggregation owners and original operational workflows are untouched.

## QA before release
1. Run PHP lint on `backend/Modules/Administration/Oversight.php` and JS syntax check on `public/assets/js/modules/administration/oversight.js`.
2. Verify Admin-only access to `admin_diagnostic_analytics` and correct role denial for non-admins.
3. Seed or identify an existing trip incident with `incident_id` linked to a repair; verify both references and status are displayed accurately.
4. Verify an incident without a linked repair displays "No linked repair".
5. Verify type filters, chart selection, dates, empty states, and capped results.
6. Confirm the user can navigate to Trip Management and Repair Management without granting any additional permissions.
7. Regression-test Descriptive Analytics and other Diagnostic topics, plus Trip Incident and Motorpool repair workflows.

No live database migration or live-browser acceptance test has been executed by this change.
