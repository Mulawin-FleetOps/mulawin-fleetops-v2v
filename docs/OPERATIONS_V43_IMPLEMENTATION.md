# Operations V4.3 implementation

Workspace: `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`, starting HEAD `665910d`.

Starting local work is preserved: the resolved `routes.js`, browser runner changes, audit document, route tests and original `routes.js.backup`.

## Inspected implementation plan

1. Reuse `vehicles.assigned_driver_id` / `assigned_helper_id` for permanent relationships and `trips.vehicle_id/driver_id/helper_id/driver2_id` plus `trip_assignments` for actual trip resources. Add only an active-driver uniqueness constraint and a nullable helper-substitution reason. Refuse migrations on duplicate legacy pairings; never repair them by guessing.
2. Restrict trip creation to Operations Head. Keep historical request reads, retire request mutation/approval and automatic-allocation endpoints with meaningful compatibility errors. Existing waiting/release callers remain callable without allocating resources. Preserve exact lifecycle statuses, checklist/fund/document requirements and operational resource holds.
3. Let Dispatchers select a truck, derive its fixed primary driver server-side, and select an eligible helper with a substitution reason. Keep the existing Car Carrier two-driver requirement: its fixed primary driver follows the truck and its existing distinct co-driver slot remains; no invented permanent Driver 2 or helper relationship.
4. Reuse Fleet saves for contextual Driver/Helper modals and permanent assignment editing; validate both personnel-side and truck-side changes transactionally. Keep truck creation in Truck Masterlist.
5. Add Operations Head-only read APIs and a Dispatcher Monitoring page using existing group/shift mappings, persisted status/inspection counts and recorded actors/events. No mutation controls in monitoring.
6. Consolidate Add Trip under Trip Management, add operational KPI counts from backend records, remove inline route requests and request/approval navigation. Restore the existing visible Client Routes Route Option selector; preserve the conflict resolution, map and route approval workflow.
7. Verify with pure/unit tests, mocked browser contracts and genuinely isolated disposable database tests. Do not run migrations against the operational database. Record actual results and migration/recovery instructions below.

## Preservation boundaries

No financial repricing or route-rate billing integration is included. Existing Client Routes approvals, Finance release, Diesel PO/SOA attachments, documents, corrective maintenance and account security remain in their existing services. Legacy trip requests and approval history are retained read-only. Existing group-wide NULL-shift records remain labelled as legacy rather than assigned invented ownership.

## Implementation and verification results

## A. Environment verification

Verified the actual Windows checkout at `C:\xampp\htdocs\mulawin-fleetops-v2v`, repository `Mulawin-FleetOps/mulawin-fleetops-v2v`, branch `kenneth`, starting and final HEAD `665910d`. No branch switch, commit, push, merge, reset or deployment was performed.

Initial status contained two modified files (`public/assets/js/modules/operations/routes.js`, `tests/run_ops_head_browser.cjs`) and four untracked artifacts (`docs/KENNETH_OPERATIONS_AUDIT.md`, `public/assets/js/modules/operations/routes.js.backup`, `tests/Unit/RouteSafetyTest.php`, `tests/routes_ui.html`). Those changes remain. The backup SHA256 remains `B5F4975204635CF575180017311FA709654D61FE0A5A0CDB198A1AE2CEDC8604`.

The operational database was not migrated or modified. Database testing used a newly initialized MariaDB 10.4.32 instance with a separate verified data directory, loopback port and generated credentials. Its test databases were ownership-guarded and disposable. The instance was shut down and its generated files removed after verification. The starting-commit baseline copy and generated browser profile were also removed.

## B. Changes implemented

| Approved change | Local implementation |
| --- | --- |
| Navigation | Operations Head has eleven destinations in four groups, including Dispatcher Monitoring. Separate Planning/Approvals and More Tools are absent. Incidents & Maintenance opens `trips?tab=incidents`; standalone mechanic/maintenance navigation stays absent. Dispatcher has the approved nine links without Trip Requests. |
| Add Trip | Main-content Planning -> Review & Create, entered from Trip Management. Independent clients, truck types, approved routes, schedules, quantities, booking/shipment fields, group/shift selection, twenty-row limit, retry keys and partial-result recovery are preserved. |
| Trip Management | Four backend KPIs, exact lifecycle status column/badges, compact search and collapsible filters, active/history/incidents workspaces. Historical requests are retained read-only. |
| Dashboard | Operations retains Active Trips, Ongoing Incidents, Pending Fund Approvals and Resource Availability, schedule, priority actions, collapsible recent activity and new Monitoring shortcut. Dispatcher priorities cover manual assignment, preparation, incidents and fund follow-up. |
| Masterlists | Drivers/Helpers tabs expose one contextual Add button. Typed Add/Edit modals preserve personal/license fields, use existing Truck/Helper records and retain Admin-only shift assignment. No Truck creation inside Driver. |
| Fixed pair integrity | Permanent pairing uses existing vehicle links. Backend validation and an additive unique index prevent duplicate active Driver/Truck relationships. Reassignment is transactional, audited and blocked for held resources. Ordinary personal edits can retain an unchanged held pair. |
| Manual assignment | Dispatcher selects the Truck. Backend derives its fixed primary Driver and validates type, attendance, license expiry, availability, group/shift and holds. Regular Helper is preselected; replacement requires a reason, changes only the trip and preserves actual history. Car Carrier retains its distinct co-driver slot and no Helper. |
| Removed workflows | Dispatcher create/batch and request/result projections are refused server-side. Trip review, auto-assignment and independent overrides are retired. Background availability/release hooks remain callable but never allocate. Legacy approval tasks leave the active bell without deleting notification history. |
| Client Routes | Route Option is restored as a visible existing selector. Map/garage preview, defaults, editable km, override reasons, callbacks, duplicate acknowledgement, Billing rate entry and Admin approval remain. Planner has the required no-approved-route notice and no inline request action. |
| Dispatcher Monitoring | Operations-only page and backend read endpoints show actual group/shift counts, active/completed history, SQL filters and twelve-row pagination. Details retain recorded resource assignments, helper reasons, checklists, incidents/maintenance, documents, progress and event actors. There are no processing controls. |

Metric definitions: Active excludes `Pending Review`, `Completed`, `Cancelled`, `Rejected`; Attention counts `Awaiting Resources`, `On Hold - Incident Reported`, `For Reschedule`; Incidents counts distinct trips with an unresolved incident; Pending Arrival counts completed trips still holding their Truck. Monitoring Total Assigned includes all saved statuses for the selected responsibility; Active and Completed are its stated subsets. Monitoring workload summary cards use group/shift scope; the table additionally applies tab/status/date/search filters. Dashboard Active uses the same backend Active definition.

## C. Modified files and purpose

| Files | Purpose |
| --- | --- |
| `backend/Core/Access.php` | Register the Operations-only monitoring page. |
| `backend/Core/DispatcherPlanning.php` | Reuse the existing truck-type/group mapping and shift choices for planner and monitoring. |
| `backend/Core/DispatcherResources.php` | Truck-first manual selection, fixed Driver validation, actual Helper reason and own-trip reschedule eligibility; disable automatic allocation. |
| `backend/Core/FixedAssignments.php` (new) | Validate permanent relationships, resource holds and transactional reassignment. |
| `backend/Core/DispatcherMonitoring.php` (new) | Read-only SQL workloads, KPI definitions, filtering and pagination. |
| `backend/Core/Notify.php` | Exclude only retired `trip-review-*` tasks from the active bell; retain stored history. |
| `backend/Modules/Operations/Trips.php` | Operations-only intake, retirement guards, manual resources, helper reason, monitoring projection, read-only legacy requests and no-op allocation compatibility. |
| `backend/Modules/Operations/Fleet.php` | Expose authoritative pairing references and call validation from Driver/Truck saves and Truck reactivation. |
| `backend/Modules/General/Analytics.php` | Remove the obsolete pending Trip Approval priority alert. Report calculations remain intact. |
| `database/migrations/2026-11-11_11_operations_v43.sql` (new), `database/extension.sql` | Repeatable additive schema for upgrades and fresh installs. |
| `public/index.php` | Load the new monitoring module in the existing script architecture. |
| `public/assets/js/modules/operations/ops-head.js`, `public/assets/css/ops-head.css` | Approved navigation, planner, KPIs, contextual personnel tabs and scoped monitoring layout. Compact search labels retain accessible captions without visual overlap. |
| `public/assets/js/modules/operations/dispatcher-monitoring.js` (new) | Live read API consumption and read-only details. |
| `public/assets/js/modules/operations/fleet.js` | Operations Driver/Helper forms using existing Fleet APIs. Other roles retain their existing generic forms. |
| `public/assets/js/modules/operations/dispatcher.js` | Dispatcher navigation/priorities, Truck-first assignment and retired request bookmarks. |
| `public/assets/js/modules/operations/trips.js` | Remove obsolete actions, correct manual-assignment text, show replacement reason and keep historical pending requests read-only. |
| `public/assets/js/modules/operations/trip-planner.js`, `trip-approvals.js` | Compatibility guards/redirects; retain historical decision classification without active approval or Dispatcher creation controls. |
| `public/assets/js/modules/operations/routes.js` | Restore the approved existing Route Option selector while preserving the initial local conflict fixes and callback/preselection behavior. |
| `tests/Unit/OperationsV43Test.php` (new), `tests/Unit/DispatcherWorkflowTest.php` | Creation/monitoring permissions, fixed Driver derivation, substitution reason and retirement contracts. |
| `tests/run_operations_v43_tests.php`, `tests/operations_v43_tests.php`, `tests/operations_v43_worker.php` (new) | Guarded real MariaDB integration, migration/conflict recovery and concurrent assignment workers. |
| `tests/dispatcher_tests.php`, `tests/planning_dispatcher_tests.php` | Update superseded request fixtures to approved Operations intake; preserve resource, attendance, group/shift, funds/document/signature assertions. |
| `tests/operations_ui.html`, `tests/ops_head_ui.html`, `tests/dispatcher_ui.html`, `tests/trip_approvals_ui.html`, `tests/run_ops_head_browser.cjs` | Updated actual UI contracts, historical retirement, monitoring, contextual personnel, manual assignment and responsive checks. |
| `tests/routes_ui.html`, `tests/Unit/RouteSafetyTest.php` | Initial local route coverage preserved; browser expectation now requires the visible Route Option. |
| `docs/OPERATIONS_V43_IMPLEMENTATION.md` (new) | Implementation, migration and verification handoff. |

`docs/KENNETH_OPERATIONS_AUDIT.md` and `routes.js.backup` are preserved pre-existing untracked artifacts, not V4.3 edits. No capstone/Objective document was edited.

## D. Database changes and application instructions

Migration: `database/migrations/2026-11-11_11_operations_v43.sql`.

- Adds a stored generated `vehicles.active_fixed_driver_id` based on the existing active vehicle's `assigned_driver_id`, with unique index `uq_vehicle_active_fixed_driver`. This is an enforcement projection, not a second editable assignment source.
- Adds nullable `trips.helper_substitution_reason VARCHAR(255)` for the actual trip replacement reason.
- Records the version in existing `schema_migrations` with `INSERT IGNORE`. Each column/index step checks information_schema before changing anything.
- No operational rows are updated/deleted/backfilled; no accounting or maintenance tables are changed. Fresh and repeated upgrade imports were executed on disposable databases. A conflicting legacy duplicate deliberately causes migration failure without changing either pairing.

**The operational database still needs this migration before using the revised resource-assignment workflow.** Use the normal database backup procedure and inspect the preflight query in the intended database:

```sql
SELECT assigned_driver_id, COUNT(*) AS active_trucks
FROM vehicles
WHERE active=1 AND assigned_driver_id IS NOT NULL
GROUP BY assigned_driver_id HAVING COUNT(*)>1;
```

If rows are returned, have an authorized operator establish the correct permanent pairing from actual records and resolve it explicitly. Do not choose a Truck arbitrarily, erase old trips or silently rewrite historical assignments. Also review active Trucks without a fixed Driver, Drivers without a fixed Truck, missing regular Helpers, inactive/expired people, incompatible Helper group links and open operational holds. Incomplete legacy records are kept and remain ineligible until legitimately corrected; they are not populated with invented resources.

After preflight and backup, open the MySQL/MariaDB client using the intended operational database and your normal credentials, then execute:

```sql
SOURCE C:/xampp/htdocs/mulawin-fleetops-v2v/database/migrations/2026-11-11_11_operations_v43.sql;
SELECT id FROM schema_migrations WHERE id='2026-11-11_11_operations_v43';
SHOW INDEX FROM vehicles WHERE Key_name='uq_vehicle_active_fixed_driver';
```

Do not import `schema.sql` or the entire `extension.sql` into a populated database. The migration is independently repeatable, including a retry after an explicitly resolved conflict. MariaDB/MySQL DDL may commit separately; after an interrupted import inspect column/index presence and rerun the guarded migration.

Recovery: retain the additive columns/index and all saved reasons/history when reverting application files to an approved compatible version. Do not drop the reason column or remove saved assignments as a rollback shortcut. Resolve schema/application compatibility using a verified backup and a separately reviewed recovery operation if one is necessary. No operational rollback or migration was executed in this session.

## E. Integration verification

Real integration executed through the existing module action/read services against persisted test records, not simulated successful writes:

1. Route request -> Billing rate entry -> Admin approval -> eligible approved route.
2. Existing Truck + Helper + Driver creation -> permanent pairing -> Operations intake/batch -> Dispatcher manual allocation.
3. Trip Fund submission -> Operations approval -> Finance release/voucher -> full pre-dispatch checklist -> Confirm Dispatch/billing draft.
4. Diesel PO upload -> incident/hold -> Maintenance mechanic assessment, findings, cost, repair evidence, completion and verification -> Dispatcher resume.
5. Required waybill/AR/DR validation -> completion with optional Supplier SOA -> actual history -> arrival checklist/Truck release -> Finance liquidation and document access.
6. Two concurrent PHP workers compete for one pair: exactly one succeeds, the other receives a 409; one Truck hold remains. Direct database uniqueness also rejects duplicate permanent Driver assignments.

No Maintenance or Accounting service was rewritten. Existing group/shift scopes, Admin shift assignment, attendance, financial guards and document authorization continue to enforce their own policies. Existing Maintenance read permissions for operational coordination were retained; hiding menu entries does not replace server authorization. Maintenance-only mutations remain rejected for Operations Head. Head Management/authentication business code is unchanged; existing role/unit checks and shared navigation checks were run, but a complete live browser walkthrough of every unrelated role was not performed.

## F. Executed verification

| Check | Actual result |
| --- | --- |
| PHP Safe suite | **408 tests, 622 assertions passed** (`php vendor/phpunit/phpunit/phpunit --testsuite Safe`). |
| V4.3 isolated integration | **82 passed, 0 failed** (`php tests/run_operations_v43_tests.php`). Includes genuine lifecycle, two-worker conflict, SQL filtering, nullable legacy shifts and fresh/upgrade/duplicate migration cases. |
| Dispatcher isolated integration | **49 passed, 0 failed** (`php tests/run_dispatcher_tests.php`). |
| Planning/group-shift integration | **40 passed, 0 failed** (`php tests/run_planning_dispatcher_tests.php`). |
| Existing Inventory/Finance and Operations Reports suites | **19 + 20 passed**, respectively, in the aggregate integration run. |
| Local Chrome fixtures | **486 assertions passed in seven fixtures**. Browser APIs are mocked and explicitly labelled; PHP/MariaDB integration above verifies actual persistence. |
| Responsive/browser interaction checks | **69 layouts passed**, including planner, monitoring, Driver/Helper forms, both Dispatcher types, funds/incidents, attendance, records, reports and analytics; native keyboard focus checks passed. Actual CSV download exported 37 matching rows from page four; Print All generated its PDF; reduced-motion behavior passed. |
| Syntax | **17 PHP files and 8 JavaScript modules passed** syntax checks. |
| Patch hygiene | `git diff --check` passed; original backup hash unchanged. |
| Aggregate legacy Integration suite | **17 suites executed: 5 pass, 12 fail**. This aggregate is not green. Details below. |

The twelve remaining legacy failures were reproduced against the unmodified starting HEAD `665910d` in an extracted, isolated baseline. The baseline launcher was also pointed at the same repository's read-only Git history to reproduce the route upgrade fixture issue. Neither the current nor baseline runs used operational data.

| Failing legacy launcher | Observed limitation |
| --- | --- |
| `run_account_security_tests.php` | Windows SMTP test process cannot start with its `/dev/null` descriptor; email connection fails. Authentication implementation was not changed. |
| `run_billing_adjustment_tests.php` | Old trip fixture omits required Dispatcher group/shift. |
| `run_crew_attendance_tests.php` | Same obsolete planning fixture. |
| `run_crew_dispatch_tests.php` | Same obsolete planning fixture and old automatic allocation assumptions. |
| `run_fund_release_tests.php` | Same obsolete planning fixture. Real release/liquidation was verified in V4.3 coverage. |
| `run_map_tests.php` | Local routing mock process fails on Windows; route call times out. Live routing-provider connectivity was not validated. |
| `run_route_tests.php` | Git-derived pre-route base already contains route schema, causing duplicate migration-marker failure. The baseline reproduces this. Without the upgrade path, old trip regression fixtures also omit group/shift. |
| `run_trip_approval_tests.php` | Tests the retired Dispatcher create/approval flow. Starting HEAD already fails on a missing group/shift fixture; V4.3 correctly refuses Dispatcher creation earlier. |
| `run_trip_batch_tests.php` | Missing group/shift fixtures and old request/allocation assumptions. Replacement batch/retry coverage passed in V4.3/planning tests. |
| `run_trip_documents_tests.php` | Missing group/shift fixture. Real Diesel PO/SOA/required-document persistence was verified in V4.3. |
| `run_trip_routing_tests.php` | Missing group/shift fixture; map/manual intake expectations also predate approved-route-only planning. |
| `run_trip_schedule_tests.php` | Missing group/shift fixture and old approval/allocation assumptions. |

These old files were retained; checks were not disabled to produce a green aggregate. The passing V4.3/Dispatcher/planning tests cover the approved replacement contracts. The remaining legacy harness/fixture modernization is recorded explicitly rather than changing unrelated SMTP/map/financial behavior.

Other limits: no operational migration, real-user account login, Apache HTTP exposure run or live provider routing test was performed. Browser and backend contracts were tested separately; the browser fixtures do not represent an authenticated HTTP end-to-end run. No production-sized performance benchmark or complete manual walkthrough of every unrelated module was performed.

Reports and screenshots are under ignored `tests/reports/`, including `operations-v43-integration.txt`, `dispatcher-v43-integration.txt`, `planning-dispatcher-v43.txt`, `operations-v43-legacy-integration.txt`, baseline logs and `ops-head-browser.txt`.

## G. Preserved features

- Client Routes request form, visible Route Option, maps/garage/distance/override behavior and Billing/Admin approvals: route browser contracts and actual rate/approval integration passed.
- Trip Funds, Finance-only release, voucher and liquidation: genuine service integration passed; no repricing or cash formula change.
- Diesel PO, optional Supplier SOA, required waybill/AR/DR, private files and Finance document listing: actual uploads/read projections passed.
- Pre-dispatch and arrival checklists, existing exact status transitions, current-attempt resource holds, dispatch, completion and billing draft: genuine lifecycle passed.
- Incident reporting and authorized corrective maintenance/clearance: genuine lifecycle passed; Operations cannot process mechanic forms.
- Documents and Reports/analytics: existing APIs retained; browser filtering, CSV and PDF checks passed; Operations Reports integration passed.
- Authentication, Admin shift control and unrelated roles: implementation unchanged; unit authorization and shared-role navigation checks passed, subject to the live-session/SMTP limits above.

## H. Remaining risks and compatibility

The local implementation is ready for review, with the operational migration and legacy data preflight still required. Database duplicate conflicts must be resolved using actual business evidence. Existing incomplete fixed pairs, absent people, unmapped people or foreign open attendance sessions deliberately remain unavailable; the system does not invent substitutes or bypass Admin shift/attendance decisions. Car Carrier's co-driver remains an existing trip-specific second-driver selection, not a newly invented permanent second-driver relationship.

Historical group-wide NULL-shift records retain their original scope and are labelled as legacy. Recorded dispatch account and event actors are distinct from responsibility; completed trip IDs/resources and saved events remain unchanged after permanent reassignment. Monitoring does not add ETA/GPS/prediction or infer completion from time. Old request records are not converted into new trips automatically.

Twelve retained legacy suites still need fixture/harness modernization, as reported above. Their failures also occur on the starting code; the fully green claim is limited to the executed Safe, new/updated workflow and browser checks. The generated test server and baseline copies were removed; retained reports contain no generated database credentials.

## I. Final Git status

All changes are local and uncommitted. The following status was captured after cleanup; no generated test database/baseline directory remains:


```text
 M backend/Core/Access.php
 M backend/Core/DispatcherPlanning.php
 M backend/Core/DispatcherResources.php
 M backend/Core/Notify.php
 M backend/Modules/General/Analytics.php
 M backend/Modules/Operations/Fleet.php
 M backend/Modules/Operations/Trips.php
 M database/extension.sql
 M public/assets/css/ops-head.css
 M public/assets/js/modules/operations/dispatcher.js
 M public/assets/js/modules/operations/fleet.js
 M public/assets/js/modules/operations/ops-head.js
 M public/assets/js/modules/operations/routes.js
 M public/assets/js/modules/operations/trip-approvals.js
 M public/assets/js/modules/operations/trip-planner.js
 M public/assets/js/modules/operations/trips.js
 M public/index.php
 M tests/Unit/DispatcherWorkflowTest.php
 M tests/dispatcher_tests.php
 M tests/dispatcher_ui.html
 M tests/operations_ui.html
 M tests/ops_head_ui.html
 M tests/planning_dispatcher_tests.php
 M tests/run_ops_head_browser.cjs
 M tests/trip_approvals_ui.html
?? backend/Core/DispatcherMonitoring.php
?? backend/Core/FixedAssignments.php
?? database/migrations/2026-11-11_11_operations_v43.sql
?? docs/KENNETH_OPERATIONS_AUDIT.md
?? docs/OPERATIONS_V43_IMPLEMENTATION.md
?? public/assets/js/modules/operations/dispatcher-monitoring.js
?? public/assets/js/modules/operations/routes.js.backup
?? tests/Unit/OperationsV43Test.php
?? tests/Unit/RouteSafetyTest.php
?? tests/operations_v43_tests.php
?? tests/operations_v43_worker.php
?? tests/routes_ui.html
?? tests/run_operations_v43_tests.php
```
