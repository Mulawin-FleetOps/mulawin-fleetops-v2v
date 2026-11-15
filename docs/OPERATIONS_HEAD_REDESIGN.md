# Operations Head UI/UX redesign

**Subsequent update:** The dedicated Trip Approvals workspace and removal of the Operations Head More Tools/standalone maintenance links supersede the navigation described below. See [Trip Approvals and sidebar cleanup](TRIP_APPROVALS_REDESIGN.md) for the current behavior, permission-policy conflict, and latest verification results. Other earlier redesign behavior remains in place.

Implemented locally on Windows in `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`, November 10, 2026. Implementation followed the user's approval of the read-only audit. No commits, pushes, merges, deployment, schema migration, development-database resets, or application-record submissions were performed. Existing modified/untracked work was retained. No reference screenshots were attached; the detailed written specification was used.

## Actual changes

The new `operations/ops-head.js` module loads after the existing screen modules. It selects the redesigned renderers only for `operations_head`; other roles continue using their existing renderers. The new CSS is scoped to that role or to components rendered by that role. Existing Dispatcher planning, backend actions, access policies, and secondary tools remain available.

### Sidebar

| Section | Navigation |
| --- | --- |
| Overview | Dashboard |
| Trip Operations | Trip Planning; Trip Approvals; Trip Management; Trip Fund Approvals |
| Masterlists | Truck Masterlist; Driver & Helper Masterlist; Client Masterlist; Client Routes |
| Monitoring & Records | Incidents & Maintenance; Reports; Documents |

Trip Planning targets `#trips?new=1`. Trip Approvals targets `#trips?tab=active&group=pending`. Trip Management opens Active Trips. Incidents & Maintenance opens the existing Trips workspace's Incidents tab. More Tools preserves the other authorized destinations, including mechanics and corrective maintenance. Notifications remain accessible through the bell. Desktop collapse and existing mobile navigation are supported; navigation is filtered through the server-provided permitted pages.

### Dashboard

The title is Dashboard, with the requested subtitle and no New Trip header action. Four clickable counts link to Pending Trip Approvals, Awaiting Resources, Trips on the Road, and Open Incidents. The dashboard includes today's schedule, priority trip/fund/incident queues, fleet availability, and recent operational activity. Targeted read queries use trips, incidents, active vehicles, trip events, and audit records linked specifically to fund requests. No general audit-log access is added. Trip events and fund audit records provide distinct activity streams.

Counts come from database aggregates, with separate unavailable and empty states. Times in the new Operations Head components are displayed in Asia/Manila. Other role dashboards retain their previous response contract.

### New Trip and review

Planning starts with one collapsible card. Its field rows are Client/Truck Type, full-width Approved Route, Scheduled Date & Time/Number of Trips, and full-width Delivery Details/Instructions. Additional entries are independent and removable. A numeric stepper and immediate planning totals enforce the existing 20-trip combined maximum. Clear Form requires an in-app discard confirmation.

The form calls `Routes.selectable` for each client/type pair, clears incompatible selections immediately, rejects missing selections, and retains route-provided addresses, distance, and coordinates for submission. There is no pickup/delivery read-only panel or route-request shortcut in New Trip. The Operations Head planner requires an approved route; existing map/manual backend behavior and existing legacy editing tools remain intact.

Review Trips validates entries without creating records. It groups separate individual drafts under their planning entries and shows common client, type, route, schedule, and instructions. Each draft has supported individual booking/consignee fields, Car Carrier cargo units, Container number/size/seal, or non-Car-Carrier shipment number. Incompatible overrides are removed when changing truck type. Shared planning values are edited through Back to Planning before submission.

Confirm & Create Trips calls the existing `Trips.create_batch`. Every draft retains its own UUID request key. Submission disables controls immediately. Created rows are locked and omitted from retries; failed rows retain their keys. Uncertain responses lock draft values until a retry reconciles those keys. A confirmed HTTP 400 preflight refusal permits corrections. Actual backend results distinguish creation, previous submissions, failures, and Awaiting Resources. The in-progress submission envelope is saved in per-user, per-tab session storage so navigating away/reloading can restore unresolved submissions. Completed envelopes are removed; an explicit Start Another Plan action is available after known outcomes.

### Trip Management and details

Active Trips, Trip History, and Incidents reuse the existing Trips API and official statuses. Active monitoring groups are Pending Review, Awaiting Resources, Preparing, On the Road, Problems, and Arrival Pending. These are filters, not new statuses. Search, status, client, truck type, date range, and assigned-truck filters operate on actual loaded records, with compact desktop rows, responsive mobile cards, and pagination. Approval rows include the requesting dispatcher and a Review action.

History provides Completed/Cancelled/Rejected filters, historical access, and available completion dates. Missing closure dates are explicitly described as unrecorded. Completed records still awaiting arrival appear in both History and the Active Arrival Pending group through the existing `awaiting_arrival` flag.

Incidents uses searchable cards with severity, incident/trip statuses, truck, location, linked maintenance, and recommendations. Under Repair means the existing linked maintenance status is Under Repair. Details and existing report printing are available; no repair-completion, clearance, preventive-maintenance, or Dispatcher rescheduling actions were added to Operations Head.

Trip Details remains a side drawer. Its summary, simplified progress tracker, and separate readiness panel precede eleven collapsible sections: Trip Overview; Route & Schedule; Shipment & Delivery; Truck & Crew; Trip Funds & Fuel; Pre-Dispatch Checklist; Dispatch & Progress; Incidents & Maintenance; Completion & Arrival; Documents; Activity Timeline. Existing document controls, maps, incident printing, checklist details, and action handlers are retained. One existing permitted contextual action moves to the fixed drawer footer. Closed trips do not gain active actions. Drawer loading from Dashboard also works before Trip Management has been visited.

### Supporting pages

- Trip Fund Approvals has Pending/Approved/Rejected counts, a separate Finance release indicator, searchable records, expense details, notes, approval history, related-trip navigation, and authorized approve/reject controls. Closed trips do not expose approval. Finance release remains unavailable to Operations Head.
- Driver & Helper Masterlist shows assigned truck, duty shift, current-shift attendance readiness, availability, and license expiry, retaining existing profile/document and management workflows. New read data comes from existing attendance marks and `CrewAttendance::shiftFor`; dispatch and shift rules are unchanged.
- Truck and Client masterlists retain their existing search, filters, authorized actions, details, documents, and route relationships, with the Operations Head table/control styling. They were not rebuilt.
- Client Routes has Approved Routes and Route Requests tabs, searchable real records, recorded approved rates, existing details, and the header Request New Route action. Pending revisions remain visible as revisions of approved routes. Closed request records remain accessible in Route Requests.
- Reports retains existing periods, calculations, filters, printing, and supported exports; a report-category selector provides direct access to existing categories.
- Documents retains its protected repository, category/record filters, folder/filename search, preview/download behavior, and empty states. No parallel repository or upload permission was added.

## Files changed in this implementation

| File | Purpose |
| --- | --- |
| `public/assets/js/modules/operations/ops-head.js` (new) | Role-scoped navigation, dashboard, planner/review/recovery, trip/fund/route/crew screens, drawer organization, report category |
| `public/assets/css/ops-head.css` (new) | Scoped compact components, responsive forms/records, sidebar collapse, drawer footer |
| `public/index.php` | Load the new stylesheet and final presentation module |
| `public/assets/js/core.js` | Recognize Operations Head shortcut active state; attach HTTP status to existing API errors for safe preflight recovery |
| `public/assets/js/modules/operations/trips.js` | Call the scoped drawer decorator after wiring existing actions |
| `backend/Modules/General/Analytics.php` | Operations Head dashboard read payload |
| `backend/Modules/Accounting/Funds.php` | Related trip status and authorized fund-specific audit history |
| `backend/Modules/Operations/Fleet.php` | Operations Head current-shift attendance read data |
| `tests/ops_head_ui.html` (new) | Mocked browser regression fixture and visual preview modes |
| `tests/run_ops_head_browser.cjs` (new) | Local headless Chrome runner, exact device widths, screenshots, safe generated-profile cleanup |
| `tests/README.md` | New browser-test instructions |
| `docs/OPERATIONS_HEAD_REDESIGN.md` (new) | This handoff |

Other pre-existing changes, including the earlier planner, dashboard, CSS, test infrastructure, Composer configuration, bootstrap, and older implementation/proposal documents, remain present. They are not attributed to this implementation.

## Backend integration and compatibility

No new storage module, status machine, financial formula, role, or action endpoint was introduced. `Access` remains authoritative. Batch creation, assignment, attendance enforcement, fund approval/release separation, checklist windows, incident workflows, arrival checks, audit writes, notifications, and protected document APIs remain existing backend responsibilities.

Known business-model discrepancies are preserved and reported:

1. Billing uses `round(max(distance_km * client_rates.rate_per_km, minimum_charge), 2)` plus existing charges. Approved route Flat rates are stored separately and do not replace that calculation. New Trip still needs an existing client/truck-type legacy billing rate. See the pre-existing `OPERATIONS_BILLING_ANALYSIS.md`.
2. Current route policy assigns rate entry to Billing and approval to Admin. The redesign preserves this actual policy; it does not move approval permission to Billing or Operations Head.
3. Scheduling retains present resource checks and active holds, not a future reservation calendar. See the pre-existing scheduling proposal.
4. Legacy APIs still allow map/manual distance in other existing workflows. Approved-route-only selection in this new planner does not constitute a new server-wide route-enforcement policy.

## Verification actually executed

| Check | Final result |
| --- | --- |
| PHP syntax: Analytics, Funds, Fleet, public/index.php | PASS |
| JavaScript syntax: core, trips, ops-head, browser runner | PASS |
| `git diff --check` | PASS |
| Existing database-free PHPUnit suite | PASS: 282 tests, 302 assertions |
| Existing mocked Operations browser fixture | PASS: 25 checks |
| New Operations Head mocked browser fixture | PASS: 72 checks |
| Exact-width layout checks | PASS: Dashboard at 1440px; Planner, Trips, Incidents at 390px; no document overflow |
| Screenshot inspection | Desktop Dashboard and mobile Planner/Trips images inspected |
| PHPUnit Integration | SKIPPED: 12 tests, 0 assertions; explicit isolated DB opt-in/credentials absent |
| Authenticated live persistence, real concurrent database submissions, production document access and map provider | NOT RUN |

The browser checks cover quantity expansion/limits, independent entries, route clearing, route API errors, review-only behavior, relevant shipment overrides, override retention/pruning, duplicate clicks, partial-result retries, uncertain-response recovery, original-key reuse, confirmed server refusals, real-result display, trip groups/history, incidents, dashboard empty/error states, drawer sections, closed-trip actions, fund permission boundaries, masterlists, report/document controls, sidebar grouping, collapse, and Dispatcher navigation preservation. API calls are mocked; these checks do not establish database persistence or server concurrency correctness.

### Reproduce local checks

From the repository root in PowerShell:

```powershell
& C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result
node --check public/assets/js/modules/operations/ops-head.js
node tests/run_ops_head_browser.cjs
git diff --check
```

The browser runner requires local Chrome at its normal Program Files path and Node with built-in WebSocket support (the verified local runtime is Node 26). It opens local files, mocks API calls, captures screenshots into ignored `tests/reports/`, and removes only its own generated browser profile after checking the absolute path. Windows sandbox restrictions may require the already-approved local browser command capability.

Open `tests/ops_head_ui.html` directly as a file for the mocked test results. Use `?preview=dashboard`, `?preview=planner`, `?preview=active`, or `?preview=incidents` for fixture visuals. These are test-only pages; the tests directory remains blocked through Apache.

### Authenticated browser review

Open `http://localhost/mulawin-fleetops-v2v/`, sign in as Operations Head, and hard-refresh to load the new assets. Check every sidebar destination, Dashboard links, Trip Approvals filtering, Active/History/Incidents, drawer scrolling/footer, masterlists, route tabs, fund details, reports, and documents. Resize to approximately 390px and check mobile navigation and single-column planning. Review existing authorized records; use only a verified isolated test instance for actual record creation and approval tests.

### Remaining limits

- The development database was not queried or changed for verification. New SQL payloads have syntax-reviewed code and mocked frontend coverage, not a live MariaDB integration pass.
- Existing API limits remain: up to 1,000 history/fund records, 300 incidents, and 2,000 routes. Supporting summaries refer to loaded records; Dashboard counts use full database aggregates. Large datasets may require a later server-pagination task.
- No supplied design screenshots were available for pixel comparison. Visual acceptance is based on the written specification and local fixture captures.
- Session storage recovery is limited to the current browser tab/session and user. If browser storage is disabled, retries retain in-memory keys only. This is not a permanent server-side draft repository.
- Existing data may lack historical closure timestamps or approved-route links; the UI reports the missing information rather than fabricating it.
