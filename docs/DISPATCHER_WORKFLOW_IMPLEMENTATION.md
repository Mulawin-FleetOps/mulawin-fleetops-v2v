# Dispatcher workflow implementation

Implemented locally on November 10, 2026 in `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. This report supersedes the earlier eight-link Dispatcher sidebar and combined Truck & Personnel Availability design. The approved green theme, yellow navigation marker, pastel summary icons, vivid badges, and elevated surfaces remain.

## Audit and implementation decisions

The repository already had authenticated Car Carrier and Container/Wing Van Dispatcher roles, trip lifecycle checks, unique resource holds, permanent vehicle-to-driver/helper links, Admin Present/Absent marks, fund presets/revisions, inspections, incident coordination, and Diesel PO attachments. The implementation reuses those services and UI handlers.

The audit found three material gaps:

- Admin attendance marks contain one daily/shift decision, not repeated Time In/Out sessions. Reusing them would overwrite history. A separate additive session table now records real server timestamps and actors without altering those marks.
- Personnel have no explicit operational-group field or verified relief-pool model. Existing active regular vehicle links are the only verified grouping relationship. Dispatcher projections and eligibility therefore require an exclusive link to their operational group. Unmapped or cross-group-linked people are excluded rather than exposed through the former shared pool. A primary driver with multiple active regular trucks is excluded from assignment because the permanent truck is ambiguous. No links were backfilled or changed.
- Diesel PO submission, approval, and issuance do not exist in the current backend. The trip panel preserves attachment of actual Diesel PO documents and explicitly disables the unsupported request action. It does not manufacture transactions or approval states.

Car Carrier already requires two distinct drivers through `driver_id` and `driver2_id`. Only the primary driver has a verified regular-truck relationship. The existing temporary second-driver slot remains; no permanent Driver 2 relationship was invented.

Implementation sequence: centralize authenticated scope; add repeatable attendance; use that eligibility in regular-driver assignment and dispatch checks; restructure Dispatcher navigation and pages; reuse existing trip handlers inside six panels; move fund initiation into eligible trips; verify safe logic, browser contracts, responsive layout, and live read queries.

## Completed behavior

### Access and records

Car Carrier accounts receive Car Carrier trucks/trips and verified Car Carrier drivers. Container/Wing Van accounts receive their two truck types and verified drivers/helpers. Scope comes from the authenticated user, not submitted role parameters. Creating the record is no longer an exception to truck-type/role restrictions. Legacy null-type requests remain limited to their authenticated group and creator.

The same checks apply to trip details/actions, uncertain-request recovery, batch recovery, resource selection, attendance/history, funds, documents, client selection, and direct truck/person detail reads. Reference data contains safe operational fields. Permanent master editing remains restricted to its existing authorized roles. Dispatcher master lists are separate read-only pages, with real filters, list/grid controls, pagination, details, current assignments, and maintenance/eligibility information.

No other role's sidebar or page design was changed by this update. Finance approval/release, Maintenance processing, inspection clearance, and existing lifecycle authorization remain in their existing services. The necessary shared safety change is that automatic assignment and normal dispatch now also require the approved timed-in regular crew; Operations Head approval can consequently produce Awaiting Resources until those prerequisites are satisfied. Legacy Operations Head assignment permissions remain, but do not bypass normal dispatch eligibility checks.

### Attendance

The dedicated Driver & Helper Attendance page (Driver Attendance for Car Carrier) provides direct row actions and a session-history drawer. It supports search, filters, list/grid display, page sizes, and paging.

Time In requires a current assigned duty shift and rejects an explicit Admin Absent mark. An open session cannot be duplicated. Time Out requires the exact open session and rejects personnel held by any active trip resource assignment. It never frees a truck or changes its availability. After Time Out, the row returns to Time In; another Time In creates another session with its own timestamps. Previous-shift open sessions must be closed before starting another session.

Transactions lock personnel/session records. Unique generated open-person and request-key indexes protect duplicate/concurrent requests. The UI prevents double sends and retains the operation key for uncertain retries. Replaying an old Time Out cannot close a newer session. History and latest timestamps are filtered by the authenticated operational group; a later personnel transfer cannot reveal the previous group's session timestamps. An unresolved foreign open session displays an attendance-review restriction without exposing its details.

The new sessions can supply positive dispatch attendance without fabricating or rewriting Admin Present marks. Explicit Admin Absent marks still block eligibility. Existing shift Warn/Enforce settings remain relevant to the trip's planning shift; current-session/current-duty-shift requirements apply independently.

### Assignment and trips

Awaiting Resources opens Assign Resources. The Dispatcher chooses an eligible timed-in regular driver; their sole active permanent truck fills automatically and cannot be independently changed. The server rebuilds eligible choices inside the assignment transaction and rejects a forged truck/crew combination. Maintenance, resource holds, existing license rules, availability, scope, and attendance remain prerequisites.

For Container/Wing Van, an eligible linked regular helper is suggested; another eligible same-group helper can replace them for the trip without changing the permanent master record. Car Carrier requires a distinct eligible timed-in same-group second driver. Ineligible people and ambiguous primary mappings are not offered.

Trip Management shows Assign Resources for awaiting trips, Manage for preparation/ready trips, and View Details for dispatched/completed trips. Existing permitted incident, reschedule, inspection, progress, completion, and document actions remain inside the details interface.

Trip Details has exactly six rounded pills in one horizontally scrollable, nonwrapping strip:

1. Overview
2. Trip Funds & Fuel
3. Pre-Dispatch
4. Dispatch & Progress
5. Incidents
6. Arrival & Completion

Only one panel is visible. Keyboard arrows/Home/End select tabs. Green indicates selection; other pills are neutral, with subtle indicators derived from actual persisted inspection/dispatch/incident facts. Completed trip status alone does not mark arrival clearance complete. No progress percentage or extra progress bar was added. Existing content and action handlers are retained; the selected panel's primary action uses the fixed drawer footer.

The fund monitor has no global creation buttons. Request Trip Funds is attached to the eligible fixed trip and uses actual preset amounts, custom lines, revisions, and existing validation. The trip-only Request Diesel PO control is disabled with an explanation because only document attachment is supported. Documents and incidents retain their existing trip linkage and permission checks.

### Navigation

| Group | Links |
| --- | --- |
| Overview | Dashboard |
| Trip Operations | Trip Requests; Trip Management; Trip Funds & Fuel; Incident Reports |
| Reference & Records | Driver & Helper Attendance; Truck Master List; Driver & Helper Master Lists; Trip History; Documents |

Car Carrier uses Driver Attendance and Driver Master List labels. There is no operational-type switcher. The dashboard retains six operational cards; the pending attendance item opens the new attendance page.

## Files changed for this update

The checkout already contained substantial uncommitted work from earlier requests. This list describes this update's edits, not ownership of every dirty file.

| File | Purpose |
| --- | --- |
| `backend/Core/DispatcherScope.php` (new) | Authenticated type, trip, personnel, and truck scope |
| `backend/Core/DispatcherAttendance.php` (new) | Session roster/history, Time In/Out transactions, idempotency, eligibility |
| `backend/Core/DispatcherResources.php` (new) | Regular-driver candidates, fixed-truck validation, automatic assignment, dispatch blockers |
| `backend/Core/CrewAttendance.php` | Recognize current authorized sessions without overwriting Admin marks |
| `backend/Modules/Administration/Attendance.php` | Dispatcher-only session actions alongside unchanged Admin actions |
| `backend/Modules/Operations/Trips.php` | Strict scope/recovery, safe references, Dispatcher assignment, shared eligibility checks |
| `backend/Modules/Operations/Fleet.php` | Scoped safe master/detail projections and attendance read route |
| `backend/Modules/Operations/Clients.php` | Compatible-client selection and scoped operational projection |
| `backend/Modules/Accounting/Funds.php` | Strict Dispatcher trip scope for reads/submissions/details |
| `backend/Modules/General/Documents.php` | Strict scoped document access, including own truck references |
| `database/migrations/2026-11-10_09_dispatcher_sessions.sql` (new) | Additive session table, constraints, indexes, marker |
| `database/extension.sql` | Same additive structure for fresh installs |
| `public/assets/js/modules/operations/dispatcher.js` | Navigation, attendance, separate masters, driver-first assignment, six trip panels, trip-linked funds |
| `public/assets/js/core.js` | Dispatcher-only active-navigation mapping |
| `public/assets/css/dispatcher.css` | Dispatcher dark titles and responsive pill/drawer styling |
| `tests/Unit/DispatcherWorkflowTest.php` (new) | Pure scope/session/assignment and early role-rejection checks |
| `tests/dispatcher_tests.php` | Guarded isolated DB scenarios for scope, repeated sessions, fixed pairing, two-driver rules, transfers |
| `tests/dispatcher_ui.html` | Mocked browser contracts and workflow previews |
| `tests/run_ops_head_browser.cjs` | Additional attendance, assignment, and trip-pill responsive checks |
| `tests/README.md` | Current commands and verification limits |
| `docs/DISPATCHER_WORKFLOW_IMPLEMENTATION.md` | This report |

Composer configuration, dependency lockfile, PHPUnit configuration, EnvironmentTest, shared Maintenance backend, and existing operational records were not changed by this update.

## Local database impact

The additive migration **was applied to the verified local `mulawin_v2` database**, after checking the checkout path, loopback connection, exact database name, and migration statements. It created `dispatcher_attendance_sessions` and inserted its schema marker. Existing personnel, vehicle, trip, Admin attendance, fund, and incident row counts were compared before/after and remained unchanged. The session table has zero rows after verification. No operational sessions, accounts, trips, or sample records were created in development.

The migration uses CREATE TABLE IF NOT EXISTS and INSERT IGNORE; it does not alter or delete existing tables. The application reports unavailable attendance actions safely if the table is missing elsewhere. Do not remove this table after real sessions have been recorded; a rollback must preserve attendance history.

## Actual verification

Commands were run from the verified project root with PHP 8.2.12 and PHPUnit 11.5.57:

| Command/check | Actual result |
| --- | --- |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result` | **352 tests, 461 assertions passed** |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --testsuite Integration --do-not-cache-result` | **14 skipped, 0 assertions**; isolated test credentials/opt-in absent |
| `node tests/run_ops_head_browser.cjs` | **347 mocked browser checks passed**: Operations 25, Operations Head 72, Trip Approvals 49, Dispatcher 201 |
| Same Chrome runner | **48 responsive layouts passed**, five native Escape/Enter/focus checks passed, reduced-motion check passed |
| `php -l` on the three new core services, CrewAttendance, Attendance, Fleet, Trips, Funds, Documents, Clients, DispatcherWorkflowTest, and dispatcher_tests | No syntax errors |
| `node --check` on dispatcher.js, core.js, and run_ops_head_browser.cjs | Passed |
| `git diff --check` | Passed |

Screenshots in ignored `tests/reports/` include final desktop attendance, fixed-truck assignment, six-pill details, and mobile fuel panels. The attendance, desktop pill, and mobile fuel captures were visually inspected. Browser fixtures mock all APIs and do not exercise real database mutations or authentication.

A separate read-only PHP CLI smoke check used an existing local Container/Wing Van Dispatcher record. Trip, master, attendance, fund, and document reads returned no section-query errors; master projection returned 14 trucks and attendance returned 18 people. Direct Car Carrier truck and personnel detail calls returned 403. The schema was present with zero attendance sessions. This checks service queries and authorization with an existing role record; it is not an authenticated HTTP/browser session test. No existing Car Carrier account was available for equivalent live-role verification, and none was created.

The guarded disposable-DB Dispatcher scenarios are implemented and syntax-checked, **not database-executed**. These include repeated sessions, replay keys, active-hold checkout rejection, fixed-truck forgery, Car Carrier second-driver rules, cross-scope access, and group-transfer history. The full legacy DB regression suite also remains unverified. Its older auto-assignment fixtures assume unlinked/non-timed-in substitute crew and require adaptation to the newly required session/pairing prerequisites before their former expectations are applicable. The safe/unit and mocked UI passes do not prove those DB workflows or concurrency races.

## Limitations and rules needing verified policy/data

- Relief/unlinked personnel, mixed group links, and multiple permanent trucks have no verified resolution model. They fail closed for Dispatcher use; an authorized master-data/policy decision is needed before exposing them. No permanent personnel ownership field or invented qualification model was added.
- Car Carrier retains the existing two-driver trip requirement. Permanent ownership of the second-driver slot, rotation, and transfer rules remain unverified.
- Close attendance before changing a person's operational mapping, duty shift, or active status. This update does not invent force-checkout, automatic shift closing, timestamp backdating, or an Admin correction workflow. An open session left behind by a master-data transfer/deactivation needs authorized coordination.
- New eligibility applies to existing assignments at normal dispatch. Older trips with unmatched permanent pairs or missing sessions can require authorized correction; they are not silently rewritten. An expired license remains blocked; the existing policy for missing license-expiry values was not redefined.
- Diesel PO request/approval/issuance remains unavailable. The actual attachment workflow is retained.
- Real authentication, real Time In/Out mutations, database locking/races, and full cross-role end-to-end workflows have not been verified in this environment. Do not treat the skipped integration suite as a pass.

## Manual verification

Use existing authorized accounts for read-only navigation review. For mutation/lifecycle checks, use an explicitly isolated copy with dedicated test credentials and disposable records, following `tests/README.md`.

1. Sign in as each Dispatcher role. Verify the ten links, own operational types, separate read-only master lists, correct active menu, filters/paging, and safe details. Try foreign record IDs through direct APIs; expect rejection without data.
2. In the isolated environment, link eligible drivers/helpers through the existing authorized master workflow, assign their current duty shift, then Time In. Double-click/retry; verify one open session. Time Out and Time In again; verify two sessions and retained timestamps/history. Explicit Admin Absent marks must block eligibility.
3. Approve a request with no eligible resources; verify Awaiting Resources. Time In eligible regular crew, choose the primary driver, verify the locked truck and suggested/replacement helper. Submit a forged truck or foreign helper/second driver; verify rejection. For Car Carrier, verify two distinct same-group drivers.
4. With the crew held by a trip, try Time Out; verify rejection and unchanged truck hold. Verify maintenance restrictions and license/conflict checks still block assignment/dispatch. Exercise current- and next-planning-shift Warn/Enforce cases.
5. Open each of the six pills on desktop and mobile. Verify one panel, horizontal scrolling, keyboard navigation, factual indicators, and the selected panel's retained actions. A Completed status without arrival inspection must not show arrival completion.
6. Request funds from an eligible fixed trip, verify actual presets/custom totals/revision and existing Operations Head/Finance decisions. Verify no global creation buttons on the monitor. Attach a real test Diesel document; verify that attachment does not create an invented request/approval state.
7. Exercise pre-dispatch, dispatch/progress, incidents/Maintenance coordination, completion, and arrival inspection in isolation. Verify personnel and truck holds release through their existing correct lifecycle points, and other roles retain their authorized workflows.
8. Run the guarded Integration suite only with explicit isolated credentials. Review/adapt legacy fixtures for real regular links and sessions; verify failures rather than weakening production eligibility or substituting application DB credentials.

All work remains local. No commit, push, merge, deployment, or branch deletion was performed. Preexisting uncommitted files remain in place.
