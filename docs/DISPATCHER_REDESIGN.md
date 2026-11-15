# Dispatcher module redesign and verification

For the subsequent centralized-filter, grouped-form, and Controlled Vivid refinement, see [Dispatcher refinement](DISPATCHER_REFINEMENT.md). That report supersedes the initial filter layout and summary-card styling described here.

Implemented November 10, 2026 in the verified local Windows checkout `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. The repository root and working tree were inspected before edits. Existing modified/untracked files, Composer dependencies, PHPUnit configuration, and EnvironmentTest were preserved. No remote GitHub changes, commit, push, merge, deployment, schema migration, or development-database operation was performed.

## Implemented interfaces

Both authenticated Dispatcher roles share the new presentation. Car Carrier remains `car_carrier_dispatcher`; Container / Wing Van remains `container_wingvan_dispatcher`. There is no role switcher. Truck-type choices come from the authenticated role, and the existing backend team/creator visibility and mutation checks remain authoritative. Operations Head, Trip Approvals, Finance, Maintenance, and other role renderers remain in place.

### Sidebar

| Group | Items / existing destinations |
| --- | --- |
| Overview | Dashboard |
| Trip Operations | Trip Requests (`#trips?view=requests`); Trip Operations (`#trips`); Trip Funds & Fuel (`#funds`); Incident Reports (`#trips?tab=incidents`) |
| Reference & Records | Truck & Personnel Availability (`#trucks?view=availability`); Trip History (`#trips?tab=history`); Documents |

Active links recognize the distinct workspaces. Page headers, browser titles, and breadcrumbs use the Dispatcher terminology. Desktop collapse and the existing mobile navigation are supported. Old authorized URLs remain usable: legacy truck/personnel links enter the combined reference screen, and `#trips?batch=1` retains the existing batch-request workspace. No backend controller or role identifier was renamed to match a display label.

### Dashboard

The supplied image was used for card styling only: white rounded cards, subtle borders/shadows, colored icon containers on the left, prominent real counts, readable labels, and right-side desktop chevrons. No screenshot numbers or obsolete labels are copied into production data.

There are exactly six cards:

| Display label | Existing record mapping |
| --- | --- |
| Pre-Dispatch Preparation | Pre-Assigned |
| Ready for Dispatch | Ready for Dispatch |
| Trips in Progress | Dispatched or In Transit |
| Trips on Hold | On Hold - Incident Reported |
| Pending Rescheduling | For Reschedule |
| Pending Arrival Inspection | Completed with the existing `awaiting_arrival` vehicle-hold indicator |

Cards open Trip Operations with the corresponding filter. Awaiting Resources is available through the operational toolbar and pending-action queue; it is not a seventh card. Wide desktop uses six columns where readable, standard desktop three, and tablet/mobile two.

The Dashboard has exactly three main content sections: Operational Summary Cards, Scheduled and Active Trips, and Pending Operational Actions. The trip table is capped to six relevant rows with View All Trips. On mobile it remains a compact horizontally scrollable table so the queues are not pushed below six tall record cards. Pending queues use actual unresolved/actionable records for resource assignment, checklists, fund follow-up, incident coordination, rescheduling, and arrival. Unsupported Diesel request counts are not invented. Quick Actions/Quick Access panels are absent.

The dashboard uses a role-scoped backend read projection through the existing Analytics endpoint. It reuses the existing Trips SELECT and visibility scope; it does not calculate counts from another team's records. Failed sections show unavailable states rather than synthetic zero counts.

### Trip Requests and creation

Trip Requests has a New Trip Request header action, Pending Review/Approved Requests/Rejected Requests categories, search, server-side pagination, accurate filtered totals, and View Details. Its read projection reuses the existing approval-evidence query, additionally scoped to this Dispatcher's authorized trips. Approved history comes from `approved_by`/`approved_at` or existing confirmation events, not a permanent Approved operational status; recorded rejection events classify rejected requests. Incomplete historical evidence is disclosed/excluded rather than fabricated.

New Trip Request is a compact two-column form with active clients, role-allowed truck types, client/type-specific approved routes, Philippine dispatch schedule, relevant booking/consignee/cargo/container/shipment fields, and instructions. Inapplicable shipment controls are hidden and disabled. Client/type changes clear route selections and independently reload `Routes.selectable`; stale route responses cannot overwrite a newer selection. Route addresses, coordinates, and distance remain in the existing creation payload. The current server revalidates route eligibility, role, client/rate, fields, and scheduling. Operations Head retains review authority.

The form uses `Trips.create` with a unique request key and immediate submission locking. Server validation errors retain editable data. Uncertain submissions retain their original payload/key in per-user tab session storage. On recovery, a new read-only `view=request-result` projection checks the existing request key and **created_by=current user** before sending again. A found submission is displayed with its actual reference/status without another creation call. Unknown outcomes retain the original key; they do not silently become a fresh request. No draft table or second creation engine was introduced.

### Trip Operations and details

Trip Operations provides the six monitoring filters, search, official status/truck-type/date controls, pagination, next-action text, View Details, and an Awaiting Resources shortcut. Desktop rows are compact; narrow operation/history lists become cards. Trip completion and resource release remain distinct: a completed returning trip is visible under Pending Arrival Inspection and in History until the existing arrival/maintenance workflow releases its hold.

The trip drawer keeps existing action handlers and protected records, reorganized into ten collapsible sections:

1. Trip Overview
2. Delivery & Shipment
3. Truck & Personnel
4. Trip Funds & Fuel
5. Pre-Dispatch Checklist
6. Dispatch & Progress
7. Incidents & Maintenance
8. Completion & Arrival
9. Documents
10. Activity Timeline

Operational Readiness shows recorded resource assignment, fund state, Diesel document availability, checklist state, server dispatch blockers/time windows, and arrival state where applicable. Car Carrier shows Driver 1/Driver 2; Container/Wing Van shows Driver/Helper. Existing attendance findings and restrictions remain visible. The footer moves an existing enabled contextual action without replacing its handler. It prioritizes arrival, dispatch/checklist, completion, cleared resume/reschedule, permitted automatic-assignment retry, and fund follow-up. There are no Operations Head review or manual resource-reassignment controls.

Existing checklist timing, required crew, attendance, fund release, incident clearance, completion uploads, and arrival validations remain server-side. The Dispatcher-specific modal guard prevents duplicate submits across both the confirmation dialog and network await. Dispatcher pages do not add billing controls or financial processing; existing dispatch/billing backend side effects are unchanged.

### Trip Funds & Fuel

There are exactly two main tabs: Trip Fund Requests and Diesel PO Requests. There is no PO Records or redundant Fuel Requests tab.

Trip Fund Requests retains eligible-trip selection, the existing preset checklist, configured fixed amounts, automatic totals, optional custom expenses, remarks, and `Funds.submit`. Preset amounts are never turned into manual amount inputs or hardcoded JavaScript allowances. The existing shared fund form renders them from backend `fund_categories`; submission sends selected category names/custom lines, and the backend remains authoritative for amounts and totals. Custom entries receive unique-name/positive-amount validation, including preventing preset-name impersonation in this UI. Server failures retain form values. Rejected eligible requests can be revised using their existing request record/lines.

The list has status filters and details. Ready for Release displays as Approved — Awaiting Release, and Rejected as Requires Revision in fund context only. Trip-history Rejected remains Rejected. Details show actual breakdown, remarks, rejection, approval, and Finance release information. Dispatcher gets no approve, release, or liquidation controls. Finance-only fund document links are not exposed through this new Dispatcher drawer; authorized trip documents remain accessible through the related trip/Documents views.

### Incident Reports

Incident Reports supports search/status filtering, records, linked trips/trucks, descriptions/location, actual incident status, maintenance reference/status, details, and Submit Incident Report.

Both entry points use the same original `TripUI.incident` and `Trips.incident` workflow:

- Incident Reports → select an eligible dispatched/in-transit trip → submit the incident form.
- Trip Operations → View Details → Incidents & Maintenance → Submit Incident Report, with that trip preselected.

The selector uses current team-eligible trips and rechecks the selected protected record before opening the form. The original incident fields, Philippine incident time, photos/attachments, trip hold, corrective-maintenance linkage, event/audit writes, notifications, and server state lock remain existing behavior. The modal guard prevents duplicate UI sends; the server still refuses a repeated incident after the trip enters its hold state. Dispatcher sees coordination/clearance information without maintenance processing, repair-cost, mechanic, or clearance privileges.

### Availability, History, Documents

- Truck & Personnel Availability is read-only. Car Carrier has Truck Availability and Driver Availability tabs; Container/Wing Van has Truck Availability and Driver & Helper Availability. The new backend projection filters vehicle types before returning records, excludes personnel currently assigned to another team, and retains shared unassigned personnel as a common resource pool. Official availability, current trip, open maintenance restriction, duty shift, license expiry, and actual current-shift attendance are shown. Off-current-shift personnel are not mislabeled absent. There are no manual assignment controls or future availability guarantees.
- Trip History retains scoped completed/cancelled/rejected records, schedule-date/status/type filters, search, supporting details, and the pending-arrival distinction. The new client/route/truck search runs against loaded authorized history using its own query key, avoiding the legacy history API's narrower reference-only prefilter. The existing 1,000-row history limit remains explicit.
- Documents provides category filtering, table search, linked records, type, upload date/uploader, protected preview/download, and empty states. No unrestricted upload was added. File submission remains in the appropriate trip, incident, completion, arrival, or Diesel-attachment workflow.

## Diesel PO findings and deliberate boundary

**An end-to-end Diesel PO request cannot currently be submitted.** No existing Dispatcher Diesel request-creation, approval, issuance, requested-liters, accredited-fuel-station, or request-status workflow was found in the inspected code/schema. No new one was silently implemented.

Verified existing functionality:

- `Trips.diesel_po` attaches existing Diesel PO PDF/image documents to a trip.
- The server requires the trip's Dispatcher team and an existing eligible trip status: Pre-Assigned, Ready for Dispatch, Dispatched, On Hold - Incident Reported, In Transit, For Reschedule, or Completed.
- Documents are trip-linked, audited, and protected through the existing document endpoint. Finance has its existing read access to relevant trip attachments; this is not evidence of PO issuance authority.
- `Purchasing.php` implements a separate **truck-parts** purchase workflow. Its Finance/Admin approval routing does not establish who approves or issues a Diesel PO.

Implemented in Diesel PO Requests: an explicit unavailable Request Diesel PO control with an explanation, working authorized trip/document records, attached/missing document filters, View Details, protected document access, and Attach Diesel PO Document through the original upload action. Missing documents at the list read limit can be retrieved through the protected trip details response. Document Attached is a document indicator, not an invented approval/issuance status. Existing attachments on closed trips remain readable where authorized.

Still requiring company workflow definition and separate implementation approval:

1. Identify the actual Diesel request approver and actual PO issuer; neither is assumed to be Operations Head or Finance.
2. Confirm whether liters, fuel-station accreditation, purpose, vehicle snapshots, rejection/cancellation, and per-trip/attempt limits are required.
3. Decide whether an existing approved purchasing structure can safely represent this process or a separate request model is necessary. Any proposed persistence must retain trip linkage, unique submission keys, decision history, issuance reference, and existing protected document associations.
4. Implement the confirmed role/state policy, request/decision/issuance transactions, notifications/audit, safe retries, and Finance handoff only after that definition. Keep cash fund requests, SOA reconciliation, payables, and payment processing separate.
5. Verify the complete process on isolated databases before enabling the disabled request control.

No simulated PO request, fake success, unverified authority, fuel payable, or new fuel table exists in this update.

## Files changed in this update

| File | Purpose |
| --- | --- |
| `public/assets/js/modules/operations/dispatcher.js` (new) | Role-specific shell/pages/cards/forms/drawers; safe request recovery; modal submission guard |
| `public/assets/css/dispatcher.css` (new) | Scoped card reference styling, compact layouts, responsive tables/forms/drawers |
| `public/index.php` | Load the Dispatcher presentation and stylesheet after existing modules |
| `public/assets/js/core.js` | Recognize Dispatcher workspace active navigation |
| `public/assets/js/modules/operations/trips.js` | Invoke the Dispatcher drawer decorator after wiring the existing handlers |
| `backend/Modules/Operations/Trips.php` | Dispatcher dashboard/read projections; scope existing evidence-based request list; creator-only request-result lookup |
| `backend/Modules/General/Analytics.php` | Use the scoped Dispatcher overview for Dispatcher dashboards |
| `backend/Modules/Operations/Fleet.php` | Role-scoped read-only availability and current-shift attendance projection |
| `backend/Modules/Accounting/Funds.php` | Dispatcher reads for existing trip-linked Diesel PO documents; no cash workflow change |
| `tests/dispatcher_ui.html` (new) | Both-role mocked workflow regression and visual previews |
| `tests/Unit/DispatcherAccessTest.php` (new) | Actual unauthorized-read/mutation and team-guard checks without DB access |
| `tests/dispatcher_tests.php`, `tests/run_dispatcher_tests.php` (new) | Guarded isolated MariaDB scenarios for scopes, presets, arrival holds, recovery, and documents |
| `tests/run_ops_head_browser.cjs` | Add Dispatcher fixture and desktop/wide/tablet/mobile captures; retain prior role checks |
| `tests/README.md`, this report | Reproduction instructions, actual outcomes, scope, Diesel gap |

`Access.php`, maintenance processing modules, all database schema files, official status constants, authentication/session management, financial formulas, document repository, existing Composer dependencies, and EnvironmentTest were not changed. Earlier Operations Head and Trip Approvals work remains in place.

## Reused functionality and genuinely new pieces

Existing actions/components reused: `Routes.selectable`, `Trips.create`, legacy `Trips.create_batch`, `Trips.details`, `Funds.submit/details`, `UI.fundForm`, `UI.modal`, protected multipart uploads, `Trips.incident`, checklist/timer, dispatch, resume/reschedule, completion, arrival, automatic assignment, event/audit records, `CrewAttendance`, and document viewing/downloading.

New functionality is limited to the presentation/navigation, the scoped read projections, the creator-only recovery lookup over existing request keys, per-tab recovery metadata, and Dispatcher UI validation/submission guards. There is no new trip/fund/incident transaction engine, role, workflow status, financial calculation, or database schema.

## Actual tests and limits

| Check | Final result |
| --- | --- |
| PHP syntax on affected PHP and new test files | PASS |
| JavaScript syntax on affected JavaScript and browser runner | PASS |
| `git diff --check` | PASS |
| Database-free PHPUnit | PASS: **345 tests, 403 assertions** |
| Existing Operations browser fixture | PASS: **25 checks** |
| Operations Head browser fixture | PASS: **72 checks** |
| Trip Approvals browser fixture | PASS: **49 checks** |
| New Dispatcher browser fixture | PASS: **68 checks** |
| Responsive/layout checks | PASS: **17 checks**, including Dispatcher 1920/1440/820/390px views and visible mobile drawer footer |
| Isolated database Integration suites | SKIPPED: **14 suites, 0 assertions**, explicit opt-in/test credentials absent |
| Live authenticated persistence, real concurrent DB writes, actual upload/download permissions, real map provider | NOT RUN |
| End-to-end Diesel request creation/approval/issuance | NOT IMPLEMENTED / NOT RUN: verified workflow is missing |

The Dispatcher fixture exercises both roles, exact six labels/count mappings, three Dashboard sections, card filters, resource queues, role-specific reference labels, restricted request types, route clearing/empty states, existing creation payloads, duplicate clicks, uncertain-response reconciliation, editable validation failures, recorded approval history, two fuel tabs, fixed preset inputs, automatic/custom totals, duplicate custom names, fund revisions without financial authority, explicit Diesel gap and working attachment controls, ten drawer sections/readiness, checklist timing, arrival hold, both incident entry points/preselection/photos/duplicate protection, document controls, history search, and Operations Head navigation preservation.

The PHPUnit additions execute real denial checks before DB access for non-Dispatcher read projections, Dispatcher management/finance/maintenance mutations, and the existing cross-team trip guard. Browser APIs are mocked and are not a persistence or concurrency pass.

The new isolated suite is syntax-checked but **not database-executed**. It will verify real request/overview/availability/document scopes, creator-only key lookup, recorded approvals after completion, arrival holds, shared/current-team personnel, attendance, fixed preset amounts despite tampered client totals, duplicate fund refusal, and financial permission denials. Existing guarded integration suites retain dispatch, checklist, incident/maintenance, upload, arrival, and concurrency scenarios. No database was created, dropped, reset, or overwritten during this implementation.

Known practical limits: existing history/fund/fuel-trip lists load up to 1,000 rows, incidents up to 300, and document lists up to 2,000. Trip Requests itself uses server pagination. Session-storage recovery is per browser tab/session and user, not a permanent server draft store; with disabled browser storage only in-memory recovery remains. Availability is a current official snapshot rather than a reservation calendar. Historical requests without reliable provenance/decision evidence are not fabricated into approval categories.

## Local verification

From the repository root in PowerShell:

```powershell
& C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result
node tests/run_ops_head_browser.cjs
node --check public/assets/js/modules/operations/dispatcher.js
git diff --check
```

The browser runner uses local Chrome and Node built-ins, loads local mocked fixtures, writes ignored results/screenshots into `tests/reports/`, and removes only its generated checked-path browser profile. Node's built-in WebSocket support is required; the verified local runtime is Node 26. No npm dependency was installed.

Open `tests/dispatcher_ui.html` directly as a file for the fixture results. Preview modes include `?preview=dashboard`, `?preview=operations`, `?preview=requests` (creation form), `?preview=funds`, `?preview=incidents`, and `?preview=drawer`. Add `&role=cc` for Car Carrier; otherwise the fixture uses Container/Wing Van. Fixture data is explicitly test-only. The tests directory remains blocked through Apache.

For application review, open `http://localhost/mulawin-fleetops-v2v/`, sign in separately as each Dispatcher, and hard-refresh. Inspect the sidebar and six cards, filter links, requests/history, fund presets and revisions, Diesel document tab, both incident entry points, read-only availability tabs, documents, and drawer timing/disabled states. Check desktop, tablet, and approximately 390px layouts. Use only a verified isolated test instance for actual creation, financial, incident, dispatch, completion, and arrival submissions.

Database integration remains governed by the existing `tests/README.md`: explicit dedicated credentials, loopback host, randomized disposable database names, manifest/ownership checks, and opt-in. Do not use application credentials or reset existing databases.
