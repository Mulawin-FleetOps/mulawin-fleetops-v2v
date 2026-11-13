# Standard Data Tables — 2026-11-12

## Environment and preservation

Verified workspace `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`,
starting commit `fbade10255e5a52ed57d99e79330d248d7ceb152`.
The complete root AGENTS.md was read; no applicable nested instructions were
found under public/tests. Existing uncommitted Operations Head standardization,
Fleet changes, monitoring checks and documentation were preserved.

This is frontend presentation only. No backend, operational data, schema,
migration, endpoint, permission, workflow or dependency was changed. Nothing was
staged, committed, pushed, merged, reset, pulled or deployed.

## Visual reference and before / after

The supplied screenshot is the visual reference. Its records, names and specific
columns were not copied into application pages.

| Previously | Standard presentation |
| --- | --- |
| Different surfaces between shared/custom tables | White rounded container, gray-green border and soft shadow |
| Record count/view controls in different positions | Compact count-first toolbar; working List/Grid controls beside it |
| Different header and row treatment | Light-gray header, readable compact type, consistent spacing and subtle alternate rows |
| Inconsistent View appearance | Green-outline View button with eye icon; original element/listener retained |
| Mixed pagination descriptions and missing single-page footer | Integrated Showing range plus Previous / Page / Next footer, including disabled boundaries |
| Empty lists could lose table headers | Targeted shared tables retain headers, empty message and disabled footer |
| Grid cards omitted fields beyond four | Target roles' Grid retains all configured visible List columns and original actions |

Status labels and semantic colors are unchanged. Existing search controls,
extra authorized tools and page-size selectors remain where already supported;
the screenshot does not justify removing those functions or forcing its sample
ten-row count onto pages with different existing sizes.

## Shared implementation

- `UI.table`, `UI.drawTable`, `UI.activate`, the existing RPM List/Grid renderer,
  table registries, filtering and action callbacks remain the table engine.
- `UI.standardTable(root, metadata)` decorates existing nodes, reorders the count
  and working view controls, and adds View styling/icons without replacing bound
  buttons. It accepts caller-supplied counts and existing toolbar/count nodes.
- `UI.recordPager(metadata)` renders only footer presentation. Callers retain
  their existing page state, datasets, navigation attributes and handlers.
- Generic table activation opts in only for Operations Head and Dispatcher.
  Shared styling uses explicit `.fleet-data-table` selectors within those roles.
  Other-role tables and workflow forms are not restyled.
- Mobile custom trip tables retain real table semantics inside horizontally
  scrollable containers; pages themselves do not overflow. Focus indicators,
  existing toggle accessible labels/pressed states and disabled paging remain.
- Server-paged markers do not receive a second local pager. Custom monitoring
  and report views retain server pagination and their existing request handlers.

## Coverage and Grid support

| Interface / page | Presentation and List/Grid behavior |
| --- | --- |
| Operations Head Trips / Trip History | Standard custom record surface and footer; List only, with existing local paging |
| Dispatch Monitoring | Standard custom surface and footer; List only; server `trip_page` preserved |
| Fund Approvals | Existing shared table and working List/Grid |
| Trucks Master List / Availability | Existing shared table and working List/Grid; management permissions retained |
| Drivers / Helpers | Existing shared table and working List/Grid; separate management tabs retained |
| Clients / Client Routes | Existing shared record tables and working List/Grid |
| Incidents & Repairs | Existing main incident cards remain; no decorative List/Grid switch was invented |
| Tabular Reports | Shared report blocks keep existing Grid support; paged detailed-report records remain List only |
| Operations Head Documents | Existing folder library remains; applicable shared record tables use the standard rather than replacing the library |
| Dispatcher Trips / Trip History | Standard custom record surface and footer; List only; contextual actions retained |
| Dispatcher Funds & Fuel / Incidents | Existing shared tables and working List/Grid |
| Dispatcher Attendance | Existing shared table and working List/Grid; Time In/Out and History actions retained |
| Dispatcher Trucks / Drivers Master List and Availability | Existing shared tables and working List/Grid; independent resource tabs, read-only details and Car Carrier scope retained |
| Dispatcher Documents | Existing shared table and working List/Grid; authenticated document actions unchanged |

Grid always defaults to List and uses the same filtered, authorized in-memory
records as its table. Switching keeps search/filter values. Existing pagination
sizes are retained. Pages without a working Grid renderer do not show a toggle.

## Files changed for this task

- `public/assets/css/app.css`: scoped reference table styling.
- `public/assets/js/core.js`: standard surface/footer helpers, shared table
  integration, empty headers, and target-role Grid field preservation.
- `public/assets/js/modules/operations/ops-head.js`: custom Trips surface/footer,
  preserving the pre-existing Operations Head work.
- `public/assets/js/modules/operations/dispatcher.js`: custom trip-table
  decoration/footer; all existing actions retained.
- `public/assets/js/modules/operations/dispatcher-monitoring.js`: standard
  surface/footer around the existing server-paged records.
- `public/assets/js/modules/operations/ops-reports.js`: standard decoration of
  existing detailed-report records without changing search/export/paging.
- `tests/ops_head_ui.html`: count-label expectations updated to the approved
  toolbar wording; existing functional assertions preserved.
- `tests/run_ops_head_browser.cjs`: registers the new fixture and `--tables-only`
  checks/screenshots.
- New: `tests/standard_data_table_ui.html` and this report.

Pre-existing diffs in Fleet, monitoring fixtures and the earlier Operations Head
report remain; they are not additional implementation changes for this task.

## Verification executed

```powershell
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs --tables-only
node tests/run_ops_head_browser.cjs
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'OperationsV43Test|DispatcherAccessTest|DispatcherWorkflowTest|DispatcherPlanningTest|TripApprovalAccessTest' --do-not-cache-result
git diff --check
```

- **634 browser assertions passed, zero failed**, across eleven fixtures.
- The new table fixture passed **19 checks** covering visual surface/header,
  count order, default List, real Grid, all configured fields, original action
  identities, search across pages, filtered List/Grid switching, empty results,
  disabled boundaries, optional Grid suppression and unrelated-role isolation.
- **83 additional browser layout/accessibility/export/print checks passed**,
  including the existing Operations Head and Dispatcher workflows and Report
  CSV/PDF behavior.
- Dedicated table checks passed at **390, 820 and 1190px**, with no page overflow.
  Reference captures are in `tests/reports/standard-table-390.png`,
  `standard-table-820.png` and `standard-table-1190.png`.
  The 1190px capture was visually inspected against the supplied design.
- **96 targeted unit tests passed, 232 assertions**, using the existing safe
  temporary unit bootstrap with an unusable database configuration.
- Modified JavaScript syntax checks and diff whitespace checks passed.

Initial fixture failures expected the old result-count wording or a View button
without icon spacing. Count assertions were updated to inspect the actual new
toolbar count, and icon insertion preserves the original visible button text.
No permission or business behavior was weakened to make tests pass.

## Preserved behavior and limits

Existing columns, records, status calculations, authorized actions, original
handlers, filters and role/group/shift scopes remain authoritative. Add Trip,
batch planning, permanent pairing, Helper reasons, Car Carrier's two distinct
Drivers, attendance, funds, routes, checklists, incidents, completion, arrival,
documents and exports are unchanged.

Monitoring still requests `page=dispatcher-monitoring` with a separate numeric
`trip_page`. No generic helper uses a numeric API screen identifier. No history
inclusion/status rules were changed.

No unresolved regression was found within executed checks. Browser data was
mocked; no live authenticated end-to-end or database-write integration run is
claimed. The existing folder/card-only views were preserved rather than
misrepresented as supporting an unimplemented alternative view.


## Operations Head integration follow-up ? 2026-11-12

Started on verified branch `kenneth`, commit `01e7c68`, with a clean working
tree. Root instructions were read and no nested AGENTS.md files were found.

The main records tables already met the standard. The smallest remaining
integration adds the existing standard presentation to read-only plain tables
inside Operations Head details drawers. These include fund expense lines,
Truck trip/maintenance history, monitoring checklists and linked incidents,
and Client Route rate/event history. Shared non-plain personnel trip history
already used the standard. Existing columns, callbacks and eight-row plain-table
paging remain; drawers stay List-only without invented Grid controls.

The Dashboard Trip Schedule now also reuses `UI.standardTable` and
`UI.recordPager`: its original complete schedule dataset and trip-link buttons
remain, with a single-page footer rather than introducing record slicing.
Unavailable schedule data still renders the existing error message.

Files changed in this follow-up:

- `public/assets/js/core.js`: include Operations Head read-only drawer tables
  in the existing empty-header, footer and surface integration.
- `public/assets/js/modules/operations/ops-head.js`: decorate the existing
  Dashboard schedule without replacing its columns or handlers.
- `tests/standard_data_table_ui.html`: seven focused drawer integration checks.
- `docs/STANDARD_DATA_TABLES.md`: this reconciliation and verification record.

Existing coverage requiring no renderer changes:

| Page | Existing presentation / supported views |
| --- | --- |
| Trips and Trip History | Standard custom List; local pagination |
| Dispatch Monitoring | Standard custom List; server `trip_page` |
| Fund Approvals | Standard shared List/Grid; original approval actions |
| Trucks Master List and Availability | Standard shared List/Grid |
| Drivers and Helpers | Standard shared List/Grid; separate tabs |
| Clients and Client Routes | Standard shared List/Grid |
| Reports | Shared report blocks retain List/Grid; detailed server pages stay List |
| Incidents & Repairs | Incident cards preserved; linked record tables in drawers standardized |
| Documents | Existing folder library and previews preserved; shared record tables already standardized |

Forms (including Batch Planning review), timelines, maps, previews, print/export
layouts and document cards deliberately retain their existing structure. Plain
tables inside forms and server-paged plain tables are excluded from automatic
drawer decoration. Reports keep their explicit existing decoration and server
footer, with no second pager. Dispatcher plain drawers retain their previous
appearance; other roles do not opt into the new drawer treatment.

No new component, CSS design, API, database, permission or business workflow
change was introduced. No source identifiers or stored values were renamed.
No live authenticated or database-write test is claimed. Visual uniformity is
intentionally limited to record tables; workflow forms and card libraries retain
their established presentation.


Follow-up verification commands:

```powershell
node --check public/assets/js/core.js
node --check public/assets/js/modules/operations/ops-head.js
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs
git diff --check
```

The fixture run passed **641 assertions across eleven fixtures**, including
26 shared-table checks and 314 Dispatcher checks. Seven new checks cover drawer
surface/List-only behavior, original pagination/action identities, empty headers,
form exclusion, server-paged exclusion and Dispatcher isolation.

The first full responsive run passed all 641 assertions and 40 additional
checks, including Operations Head master/availability tabs and monitoring
read-only drawers at desktop/mobile sizes. It stopped at an unchanged Dispatcher
fund-form modal measured with its top at -5px during the layout check. A second
full run was requested to distinguish an animation-timing failure from a
repeatable layout issue; its result is recorded below. No test assertion or
Dispatcher layout was changed to suppress the failure.

The second full run passed **641 fixture assertions and all 83 additional
layout/accessibility/export/print checks**, including the previously failing
Dispatcher fund modal at desktop/mobile sizes. The initial modal failure did
not reproduce; animation timing remains a limitation of that browser check.
Both modified JavaScript files passed syntax checks; `git diff --check` passed.
No backend/database paths appear in the final diff. No database tests were run.
