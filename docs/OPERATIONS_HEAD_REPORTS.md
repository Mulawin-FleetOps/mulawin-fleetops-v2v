# Operations Head Reports implementation

Implemented locally on November 10, 2026 in `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. The verified repository was clean at the start of this task (`a47f59d`); prior approved work was already present in that checkout. Parent/repository instructions, reporting controllers, role permissions, schema, chart/table components, dates, exports, and detail handlers were inspected before edits. No commit, push, merge, branch deletion, or deployment was performed.

## Scope and completed interface

Only Operations Head → Reports uses the new renderer/data projection. The main content contains, in order:

1. **Reports**, with **View trip activities, truck usage, and incident records.**
2. Exactly three horizontally scrolling capsule tabs: **Trip Reports**, **Truck Utilization**, **Incident Reports**. The selected white pill has dark-green text, subtle elevation, and a thin green underline against the gray capsule.
3. Compact Report Filters: Today, This Week, This Month (default), Custom Range, and the three actual truck types/All Truck Types. Custom dates appear only for Custom Range.
4. Four compact white summary cards for the selected report.
5. One nonanimated horizontal bar chart using existing Chart.js and its existing configuration helper.
6. Searchable detailed records, View Details, accurate count/range, fixed-ten pagination, and one **Export Report** action in the records header.

The existing sidebar, top bar, account menu, typography, icons, green primary actions, and white/light-gray surfaces remain. There are no new sidebar entries, submission forms, progress bars, predictive metrics, or report-count tab badges. No page-size selector appears. Empty results use actual zeros and `No records found for the selected filters.`

The router's existing loading and API-error handling remains; report filter/page actions also expose compact Loading report feedback. Reversed/invalid custom dates receive inline feedback and are independently rejected on the backend. Export errors appear beside the records and allow retry. If Chart.js cannot load, the same actual category/value data remains readable as text.

## Audit and calculation definitions

The previous generic report renderer combines trip, maintenance/downtime, finance, and inventory sections by role. It remains intact for other authorized roles. Its reporting comments mention historical CSV support, but the current shared table explicitly has no bulk CSV helper; no functioning generic CSV exporter was available to reuse. This implementation therefore adds a small Operations Head-only CSV service, without a dependency.

The Operations Head's existing report/page/detail permissions cover company-wide operational records in this single-company schema. No organization/tenant key or narrower Operations Head assignment scope exists in these tables. The new projection keeps that scope and excludes finance, credential, and unrelated personnel fields. Its endpoints explicitly require `operations_head`; authenticated request routing, CSRF, and existing detail authorization remain in force.

### Trip Reports

Period membership uses `trips.scheduled_at`, preserving the prior trip-report definition. Status is the trip's current stored status, not a reconstructed historical status at period end.

| Metric/chart group | Calculation |
| --- | --- |
| Total Trips | All matching trip records |
| Completed Trips / Completed | `status = Completed` |
| In Progress | `status IN (Dispatched, In Transit)` |
| Trips On Hold / On Hold | `status = On Hold - Incident Reported` |
| Other (chart) | Remaining matching statuses, including preparation, awaiting, reschedule, rejected, and cancelled |

Chart categories reconcile exactly to Total Trips. This does not label scheduled-but-undispatched trips as used trucks.

### Truck Utilization

The schema retains `trips.vehicle_id` and a dispatch timestamp, while `trip_assignments` is an active-hold table whose rows are removed on completion/cancellation/reassignment. Assignment events are free-text history, not a reliable structured record of every vehicle per attempt. A reschedule may clear the stored truck/timestamp. No complete historical assignment/attempt usage model was invented.

The supported report therefore counts **retained trip records with a recorded dispatch in the selected period**, associated with their retained `vehicle_id`. It does not claim to count every historical truck assignment, redispatch, or attempt.

| Metric | Calculation |
| --- | --- |
| Total Trucks | Distinct trucks in the existing vehicle master list, including inactive records, matching the truck-type/search filters |
| Trucks Used | Included trucks with at least one qualifying recorded dispatch |
| Total Trips Recorded | Sum of per-truck `COUNT(DISTINCT trip.id)` for those dispatch records |
| Trucks Not Used | Total Trucks minus Trucks Used |

Each vehicle appears once through the grouped query. Four trips on one truck count as one truck used and four trips recorded. Available/Under Maintenance/Unavailable status does not establish usage. The assigned driver comes from `vehicles.assigned_driver_id`; current operational status and truck type come from the vehicle master. Including inactive trucks preserves the denominator for retained historical dispatches rather than silently omitting them.

The chart shows Used Trucks and Not Used. A concise visible note states the retained-dispatch scope and that earlier reassignments/attempts cannot be reconstructed. Full historical utilization remains a schema/data limitation, not a computed estimate.

### Incident Reports

Period membership uses `incidents.created_at` as reporting time. The existing `incident_at` is occurrence time, which can differ when a report is encoded later. The table labels its timestamp Date Reported. Truck type comes from the affected vehicle master; a historical type snapshot does not exist on the incident.

| Metric/chart group | Calculation |
| --- | --- |
| Total Incidents | All matching incident records |
| Resolved Incidents / Resolved | `status = Resolved` |
| Open Incidents / Open | Remaining actual statuses: Reported, Under Repair, Repaired - Cleared to Continue |
| Trips Affected | Distinct matching `trip_id` values |

Cleared-to-continue remains open until the existing operational workflow marks the incident Resolved. Three incident records on one trip count as three incidents and one affected trip. This tab does not submit incidents or alter repair/resume/clearance logic.

## Dates, consistent filtering, pagination, and export

Date presets are calculated on the server in `Asia/Manila`: Today, Monday through today for This Week, and first of the month through today for This Month. Custom Range requires two exact valid Gregorian dates with start ≤ end. Legacy complete `from`/`to` report bookmarks are interpreted as Custom Range. No arbitrary reporting-range cap or new scheduling restriction was added.

Timestamp queries use an inclusive start and exclusive next-day end. Trip Reports uses scheduled timestamp; Truck Utilization uses dispatch timestamp; Incident Reports uses reporting timestamp. Truck type is applied in the corresponding SQL query. Search applies to all visible report fields across the complete matching dataset, before metrics and table paging. Truck search correspondingly narrows the included fleet/denominator.

Each response computes its four cards and chart from that same complete filtered dataset, then returns at most ten rows for the requested page. Counts and page boundaries are clamped accurately. Search, report type, and filter changes reset to page one; Previous/Next retain applied filters. No query is limited to ten before filtering or aggregation. The new report queries do not inherit the generic report's 2,000-row detail cap.

Export calls the same authorized filter/query/search code and exports every matching record, independently of `report_page`. It exports only the selected report's displayed data columns, with no action column, credentials, contact details, or financial fields. CSV uses UTF-8 with BOM, correct quoting for commas/quotes/newlines, and spreadsheet-formula neutralization. Empty results produce a header-only CSV.

The browser creates an actual Blob-backed download with a descriptive filename, for example `trip-report-2026-11-01-to-2026-11-10.csv`. This is a dedicated scoped exporter; no generic table export was enabled. Export uses committed filters/search from the displayed report, not an unsubmitted search edit. Like other live reads, exporting again can reflect records changed by authorized users since the displayed response; no immutable report snapshot is claimed.

## Existing components and details reused

- Existing `Analytics` page-data routing and authenticated/CSRF action routing, with a narrow Operations Head dispatch branch.
- Existing plain `UI.table`, form fields, status badges, record action controls, and number formatting. Plain tables avoid the shared size selector without changing shared defaults.
- Existing Chart.js bundle and `UI.chartConfig`; animation is disabled only for this report.
- `TripUI.open` for trip details, `FleetUI.truckDetails` with read-only context from Reports for trucks, and `OpsHead.incident` for incident coordination. The incident endpoint supplies the same authorized detail information to that existing view.
- Existing root API exception logging and user-friendly error responses; SQL errors and stack traces are not rendered in the report UI.

## Modified files

| File | Purpose |
| --- | --- |
| `backend/Core/OperationsReports.php` (new) | Operations Head authorization, filter normalization, operational queries, shared metrics/page/export, safe CSV, incident detail projection |
| `backend/Modules/General/Analytics.php` | Narrow Operations Head Reports branch and authorized export/detail actions; generic reports/dashboard unchanged |
| `public/assets/js/modules/operations/ops-reports.js` (new) | Three-tab report UI, filters, cards/chart, records/paging, existing details, actual download/error handling |
| `public/assets/js/modules/operations/ops-head.js` | Remove only the superseded Operations Head report-category dropdown wrapper |
| `public/assets/css/ops-head.css` | Styles scoped to the report workspace and its components |
| `public/index.php` | Load the new role-gated Reports script after existing modules |
| `tests/Unit/OperationsReportsTest.php` (new) | Pure filters/metrics/search/page/CSV/early authorization checks |
| `tests/ops_reports_ui.html` (new) | Fully mocked Reports interactions, failures, details, other-role renderer, visual/download previews |
| `tests/ops_head_ui.html` | Load the new report renderer and update the superseded report expectation |
| `tests/run_ops_head_browser.cjs` | Reports contract fixture, five responsive captures, real fixture CSV download verification |
| `tests/operations_reports_tests.php` (new) | Guarded disposable-DB query/metric/date/export scenarios |
| `tests/run_operations_reports_tests.php` (new) | Reuse existing safe disposable launcher |
| `tests/README.md` | Commands, previews, and limitations |
| `docs/OPERATIONS_HEAD_REPORTS.md` | This report |

No database schema, stored record, dependency, Composer configuration, PHPUnit configuration, EnvironmentTest, shared table/chart implementation, Dispatcher interface, financial process, or Maintenance business rule was modified.

## Actual verification

| Command/check | Result |
| --- | --- |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result` | **389 tests / 556 assertions passed** |
| `node tests/run_ops_head_browser.cjs` | **435 mocked browser checks passed**: Operations 25, Operations Head 84, Trip Approvals 49, Dispatcher 244, Reports 33 |
| Same Chrome runner | **56 responsive layouts passed**, five native filter keyboard/focus checks passed, reduced-motion check passed |
| Same Chrome runner | **Real CSV file downloaded** from Reports page four; verified header + all 37 matching fixture records, including first/last records |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --testsuite Integration --do-not-cache-result` | **16 skipped, 0 assertions**; isolated opt-in/credentials absent |
| PHP lint on new service, Analytics, public/index.php, Unit test, isolated test and launcher | No syntax errors |
| `node --check` on ops-reports.js, ops-head.js, and browser runner | Passed |
| `git diff --check` | Passed |

Unit coverage verifies Manila date boundaries, Monday weeks crossing months, invalid/reversed/missing dates, exact status grouping, distinct affected trips, one-used-truck/four-trip semantics, full-set search/page counts, empty values, CSV quoting/formula protection, and rejection of all other roles before database access.

Browser coverage verifies all three tabs, one chart/four cards, presets/custom/type combinations, inline date refusal, ten-row paging, full-set search/counts, filter/page resets, existing detail delegation, export identities and applied criteria, export failure/retry, header-only empty export, loading/error states, and preservation of the other-role report renderer. Screenshots at desktop/tablet/mobile widths confirm horizontal tabs, no document overflow, and the report structure; desktop trips, tablet trucks, and mobile incidents captures were visually inspected. Files and CSV downloads are retained in ignored `tests/reports/` and contain fixture data only.

A read-only PHP service smoke check used an existing active local Operations Head account and the verified loopback `mulawin_v2` database. All three new queries executed successfully for November 1–10, 2026. Current local results: Trip Reports zero; Incident Reports zero; Truck Utilization 29 registered trucks, zero retained qualifying dispatches, 29 not used. The truck page returned ten rows. These are read-query checks, not authenticated HTTP end-to-end tests or populated historical-data validation. No fixture records were inserted into development.

The dedicated isolated suite is written and syntax-checked but **not database-executed**. It covers scheduled-vs-dispatch/reporting dates, inactive fleet inclusion, per-truck distinct counts, multiple incidents per trip, full CSV/query consistency, wrong-role export refusal, and unchanged operational row counts. Skips are not passes. Existing legacy database suites also remain unverified under this session's absent isolated credentials.

## Remaining limitations and manual checks

- Complete historical truck reassignment/attempt utilization cannot be derived reliably from the existing schema. The report intentionally exposes supported retained-dispatch counts and a visible limitation, without inventing history or adding schema.
- Status, regular driver, vehicle type, and inactive/active fleet membership are current stored values, not period-end snapshots. No historical master-data reconstruction is attempted.
- Complete matching datasets are read server-side for consistent metrics/search/CSV before slicing the page. There is no artificial export truncation; unusually large datasets can require a future streaming/aggregate optimization after measurement. No performance benchmark or production-scale guarantee was claimed.
- Real authentication/HTTP exports, populated database query assertions, and full lifecycle regression require existing authorized accounts or the dedicated isolated test credentials. Do not seed production/development records for visual verification.

For read-only manual review, sign in as Operations Head and open Reports. Verify the three tabs, current live counts, custom-date validation, type/search changes, ten-row page controls, correct detail drawers, and a CSV with only matching authorized columns. Verify another reporting role still sees its original report interface.

For generated-data verification, enable only the dedicated disposable credentials described in `tests/README.md` and run the guarded `run_operations_reports_tests.php` or the opt-in Integration suite. Use fixtures with a truck performing four dispatches, an inactive truck with a retained dispatch, one trip with three incidents, and report dates differing from event/schedule dates. Confirm summaries, charts, complete exports, and detailed records reconcile under identical criteria. Preserve existing databases and never substitute application credentials for isolated tests.
