# Operations compact naming and resource tabs — 2026-11-12

## Environment and instructions

- Verified Windows workspace: `C:\xampp\htdocs\mulawin-fleetops-v2v`.
- Branch: `kenneth`; starting commit: `6143446213e83168f9f38f2095fde0fbf236b6f6`.
- The root AGENTS.md was read completely before editing. No applicable nested
  AGENTS.md files were found in public or tests. The starting working tree was
  clean; the latest local implementation was used.
- Frontend presentation and browser fixtures only. No backend, API contract,
  authorization, database, migration, dependency or business-rule change.
- Nothing was staged, committed, pushed, merged, reset, pulled or deployed.

## Sidebar before / after

| Operations Head before | After |
| --- | --- |
| Trip Management | Trips |
| Dispatcher Monitoring | Dispatch Monitoring |
| Trip Fund Approvals | Fund Approvals |
| Truck Masterlist | Trucks |
| Driver & Helper Masterlist | Drivers & Helpers |
| Client Masterlist | Clients |
| Incidents & Maintenance | Incidents & Repairs |

Groups remain Overview, Trip Operations, Masterlists, Monitoring & Records.
Dashboard, Client Routes, Reports and Documents retain their names and links.
Incidents & Repairs still opens `trips?tab=incidents`.

| Dispatcher before | After |
| --- | --- |
| Trip Management | Trips |
| Trip Funds & Fuel | Funds & Fuel |
| Incident Reports | Incidents |
| Driver / Driver & Helper Attendance | Attendance |
| Truck Master List | Trucks |
| Driver & Helper Master Lists | Drivers & Helpers |
| Driver Master List (Car Carrier) | Drivers |

Groups remain Overview, Trip Operations, Reference & Records. Dashboard, Trip
History and Documents remain. The Car Carrier resource label stays Driver-only;
the same page never grants Helper access. Attendance's title and table headings
use Attendance, Name, Role, Time In, Time Out, Status and Action; internal `crew`
identifiers remain unchanged.

Page titles, browser titles and breadcrumbs follow the compact names. A shared
display-label helper is explicitly limited to Operations Head and the two
Dispatcher roles. Other roles keep their existing names. Plate No., Fixed
Truck, Fixed Driver, Role, Availability, Status, View, Needs Action, Progress
and Readiness are used where appropriate. Backend status values are untouched.

## Resource layout before / after

Before: resource masterlists exposed a separate View Availability toolbar action,
leading to a combined Truck / personnel availability workspace under `trucks`.

After: both resource pages immediately show keyboard-accessible Master List and
Availability tabs. The sidebar links explicitly select Master List, independently
of the last view used. Tab links preserve existing search/filter query values
and use the same resource page:

| Page | Master List | Availability |
| --- | --- | --- |
| Trucks | `#trucks?view=masterlist` | `#trucks?view=availability` |
| Drivers & Helpers / Drivers | `#crew?view=masterlist` | `#crew?view=availability` |

There is no active combined availability navigation or separate View Availability
toolbar button. The old `trucks?view=availability&tab=personnel` bookmark redirects
to the existing `crew` page without broadening its permissions. New resource tabs
never use numeric `page` values. Native hash navigation and browser history are
preserved; sidebar highlighting remains on the corresponding resource.

The existing Fleet API already supplies scoped Truck and personnel payloads on
both internal pages, so no backend extension was necessary. Tables retain their
compact columns; the existing read-only View drawers retain additional pairing,
license, shift, attendance, trip and maintenance information. No management or
attendance rules were recreated in JavaScript.

## Files modified

- `public/assets/js/core.js`: role-scoped display names, formatted labels and
  consistent page/browser titles and breadcrumbs. Authorization and request
  serialization remain unchanged.
- `public/assets/js/modules/operations/ops-head.js`: compact sidebar, headings
  and panel labels; original planning/management renderers retained.
- `public/assets/js/modules/operations/dispatcher.js`: compact labels and
  independent resource tabs; existing filters, tables, detail calls and handlers
  reused. Attendance and role-specific resource scoping retained.
- `public/assets/js/modules/operations/dispatcher-monitoring.js`: visible title
  and View label only; internal page and `trip_page` remain intact.
- `tests/dispatcher_ui.html`: updated approved label expectations and added
  four-view filtering/search/details, keyboard, role-scope and history checks.
- `tests/ops_head_ui.html`: exact compact navigation and updated panel labels.
- `tests/trip_approvals_ui.html`: approved Dispatch Monitoring title expectation.
- `tests/run_ops_head_browser.cjs`: independent resource preview expectations.
- This report is new. Existing CSS, Fleet/Trips source, Access registry and
  shared UI components were reused without introducing a component framework.

## Executed checks

```powershell
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'OperationsV43Test|DispatcherAccessTest|DispatcherWorkflowTest|DispatcherPlanningTest|TripApprovalAccessTest' --do-not-cache-result
git diff --check
```

- **598 browser assertions passed; zero failed** across ten fixtures. Operations
  Head has 78 checks and Dispatcher 314; monitoring retains its 16 access,
  group/shift, active/history and `trip_page` request checks.
- **77 additional browser checks passed**, covering mobile/tablet/desktop
  layouts, active-menu contrast, filter keyboard behavior, resource views,
  forms, route maps, report CSV/PDF output and reduced motion.
- **96 unit tests passed, 232 assertions**, using the existing temporary unit
  sandbox with an unusable DB configuration.
- `node --check` passed for modified application JavaScript; diff whitespace
  checks passed.
- Added cases verify exact sidebars, Master List defaults, resource-specific
  Availability, all four search/filter/detail paths, read-only drawers,
  Car Carrier Driver scope, correct sidebar state, browser Back/Forward and
  Home-key tab selection. Existing fixtures continue to exercise Add Trip,
  batch review, personnel management, approvals, assignment, Helper reasons,
  checklists, attendance Time In/Out, funds, Diesel attachments and documents.

Initial failures were obsolete visible-name expectations and two fixture issues:
Car Carrier tests needed explicitly scoped Car Carrier trucks, and a Truck plate
inside a personnel association was incorrectly treated as a Truck table. Tests
were corrected without weakening application scoping or rules. The first
sandboxed Chrome launch returned EPERM; the same fixture runner succeeded with
permission to launch outside the sandbox.

## Preserved behavior and limits

Add Trip remains the dedicated in-page planning/review workflow. Driver/Helper
management tabs and Truck management actions remain role-authorized. Fixed
pairing, manual resource assignment, Car Carrier's two distinct Drivers,
trip-specific Helper reasons, attendance restrictions, funds/Finance duties,
Client Routes, corrective repair coordination and documents are unchanged.
Dispatch Monitoring remains Operations Head-only and read-only, with
`page=dispatcher-monitoring` and `trip_page` kept separate.

No unresolved regression was found in executed checks. Browser tests used fixture
records and mocked API responses; no live authenticated role workflow or
database-write integration test is claimed. No operational records were touched
and no migration was applied.
