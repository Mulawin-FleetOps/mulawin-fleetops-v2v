# Operations Head UI standardization — 2026-11-12

## Scope and environment

Verified local workspace `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`,
starting commit `fbade10255e5a52ed57d99e79330d248d7ceb152` and a clean working
tree. The complete root AGENTS.md was read first; no applicable nested
instructions were found under public or tests.

This update standardizes Operations Head presentation throughout its interface,
not just navigation. Existing sidebar names, workflows, technical identifiers,
status values, API contracts and authorization are preserved. There are no
backend, database, migration, framework or dependency changes. Nothing was
staged, committed, pushed, merged, reset or deployed.

## Before / after

| Before | After / scope |
| --- | --- |
| Truck & Crew; Truck & Crew Assignment | Truck & Personnel in trip sections and Readiness |
| Regular driver | Fixed Driver in Truck columns, details and forms |
| Regular helper | Regular Helper in labels; relationship unchanged |
| Plate Number / Plate number | Plate No.; original `plate_number` field retained |
| Request Information; Expense Breakdown | Request; Expenses in approval details |
| Trip Information; Recorded Progress | Trip; Progress in monitoring details |
| Assignment & Activity History; Recorded Activity | Activity; recorded events and actors unchanged |
| Recorded Approved Rate | Approved Rate; approved-versus-pending meaning retained |
| Delivery Details / Instructions | Delivery Instructions; original submission field retained |
| View Details; View Related Trip; View Fund Request | View; View Trip; View Fund |
| Approve Request; Close Details | Approve; Close |
| Vehicle documents; Maintenance history | Truck Documents; Repair History in Truck details |
| Long component names | Needs Action, Progress and Readiness where those components appear |

Contextual labels such as Fixed Driver, Regular Helper, Approved Client Route,
Duty Shift, Attendance Readiness, Replacement Reason, Trip Status and repair
status remain distinct where shortening would remove meaning. Recorded event
text, personal names, references and data values are never globally replaced.

## Components and pages

- The existing role-aware naming helper now covers Operations Head labels used
  by page tools, cards, table headers, form fields, modal headings/buttons,
  section headings and details panels. Existing page-title/breadcrumb handling
  and approved sidebar names remain.
- Label aliases added here apply only to Operations Head. Other-role labels and
  Dispatcher workflows remain unchanged.
- Drawer-section matching recognizes translated headings, preserving monitoring
  grouping and retained content after visible labels change.
- Existing dark-green navigation, yellow indicator, capsule tabs, search/filter
  toolbar, tables, badges, drawers and responsive styling are reused. No new CSS
  framework or duplicate component system was introduced.
- Dashboard, Trips, Drivers & Helpers, Fund Approvals, Clients, Client Routes,
  Incidents & Repairs, Reports and Documents retain their current renderers and
  integrations; shared naming applies only to label positions they use.

## Operations Head Trucks

Previously Trucks offered a single management list. It now opens **Master List**
by default and offers an **Availability** capsule beside it.

- Master List reuses the existing Fleet renderer. It displays Plate No., Truck
  Type, Fixed Driver, Regular Helper and Status alongside existing assignment and
  document information. Existing Add Truck, View, Edit and management actions
  remain authorized by the same `can` payload.
- Availability displays Truck status, current trip, fixed associations and
  repair restrictions from the existing Operations Head Truck response.
  Its View drawer retains Operations Head Edit/status actions; it does not copy
  Dispatcher read-only restrictions.
- Both views reuse the original Truck filter predicates through
  `FleetUI.truckRows`. Search, filters, table pagination and details remain.
  Clear Filters preserves the selected Availability tab.
- Links use `#trucks?tab=availability`, not the Dispatcher-only
  `view=availability`. The latter remains restricted by existing backend policy.
  No backend permission workaround or new API projection was added.
- Drivers and Helpers keep their separate management tabs, existing Availability
  filters, Add/Edit actions, fixed associations, license/attendance display and
  validation. No nested personnel Availability tabs were introduced.

## Preserved workflows

Add Trip/Batch Planning remains the dedicated in-page planning and review flow.
Client selection, approved routes and rates, maps, Route Option, distance,
scheduling, group/shift selection, quantities, idempotency and validation are
unchanged. Fixed pairing and manual Dispatcher assignment are untouched.

Dispatch Monitoring remains Operations Head-only and read-only. Its historical
status inclusion rules are unchanged. The screen remains
`page=dispatcher-monitoring`, with independent numeric `trip_page` pagination.

Fund approval/rejection, Finance release duties, incident coordination, mechanic
processing restrictions, documents, exports, and historical records are
unchanged. No automatic assignment or preventive-maintenance workflow was added.

## Files modified

- `public/assets/js/core.js`: role-scoped label aliases and their shared label
  renderers; translated drawer-section matching.
- `public/assets/js/modules/operations/ops-head.js`: consistent static labels,
  Truck resource tabs/Availability, filter-clear state and shared panel labels.
- `public/assets/js/modules/operations/fleet.js`: reusable existing Truck filter
  predicates; Operations Head-specific columns/form/detail labels.
- `tests/ops_head_ui.html`: Truck management/Availability, label-surface,
  record-text preservation, field-name and role-isolation regression checks;
  additional responsive previews.
- `tests/dispatcher_monitoring_ui.html`: translated details-tab grouping check.
- `tests/run_ops_head_browser.cjs`: six Truck-layout checks at desktop/tablet/
  mobile widths.
- This report is new. Dispatcher source and backend files were not modified.

## Verification executed

```powershell
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'OperationsV43Test|DispatcherAccessTest|DispatcherWorkflowTest|DispatcherPlanningTest|TripApprovalAccessTest' --do-not-cache-result
git diff --check
```

- Final fixture run: **615 assertions passed, zero failed** across ten fixtures,
  including **94 Operations Head**, **17 monitoring**, and the unchanged
  **314 Dispatcher** assertions.
- Full browser run: **83 additional layout/accessibility/export/print checks
  passed**, including both Operations Head Truck views at 390, 820 and 1440px
  without page overflow. Existing planning, personnel forms, Dispatcher resource
  views, filters, documents, report CSV/PDF and reduced-motion checks passed.
- Targeted safe unit tests: **96 tests, 232 assertions passed** using the
  existing temporary unit sandbox and unusable DB configuration.
- Modified JavaScript passed `node --check`; diff whitespace checks passed.
- Added tests exercise existing Fleet detail reads, management controls, Edit
  fields with unchanged technical names, Truck/repair/status filtering, selected
  tab retention, compact labels outside the sidebar, recorded-text preservation
  and other-role naming isolation.

The initial new button-label assertion included its icon markup; the assertion
was corrected to compare visible text. Application logic was not changed to
satisfy that test. Headless Chrome required execution outside the sandbox after
an EPERM launch failure; the database-free fixtures then ran successfully.

## Limits

No unresolved regression was found within the executed checks. Browser records
were mocked; no live authenticated operational workflow or database-write
integration run is claimed. No operational database changes or migrations were
performed. Applicable business terminology and actual stored values remain
authoritative.
