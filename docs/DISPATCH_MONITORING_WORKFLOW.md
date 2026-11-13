# Dispatch Monitoring workflow refinement

Implemented locally on `kenneth`, 2026-11-12. The pre-existing changes in
`core.js`, `ops-head.js`, `standard_data_table_ui.html` and
`STANDARD_DATA_TABLES.md` were preserved. No database, migration, operational
record, role policy or unrelated processing workflow was changed.

## Classification and totals

| Projection | Definition |
| --- | --- |
| Responsibility | Stored `dispatcher_role` matches a supported role from `DispatcherPlanning::groups()` |
| Active | Responsible trips excluding Pending Review, Completed, Cancelled and Rejected |
| History | Responsible trips with Completed, Cancelled or Rejected status |
| Total Assigned | All responsible trips within the selected group/shift, including older Pending Review records |
| Completed | Responsible trips whose status is exactly Completed |

On-hold, rescheduling and all current valid nonterminal operational statuses
remain Active. Completed trips with pending arrival work remain in History
according to their persisted terminal status; no operational processing rule
or arrival requirement changed.

Group cards retain independent group/shift workload counts. Summary cards use
the selected group/shift across all pages. Search, status and schedule filters
apply to the records table, not the overall workload summaries; visible help
text explains that distinction. Totals are calculated by SELECT queries rather
than the loaded page. Invalid/non-Dispatcher responsibility roles and trips
without recorded responsibility are excluded. No missing responsibility is
inferred from recorded actors.

## UI, filters and dates

- Cards show Dispatcher group, Duty Shift, Active and Completed. Selection
  retains the current tab, search and dates, removes incompatible status and
  resets `trip_page` to 1. Clear Group removes group/shift while retaining the
  other compatible filters. Day/Night and genuine NULL/legacy shifts remain.
- Active and History have tab-specific status choices. The backend rejects
  incompatible status requests, including Pending Review. Tab changes preserve
  group/shift/search/schedule dates, discard incompatible status and reset paging.
- Clear Filters retains the current tab, clears the page-wide filters and
  resets paging. Schedule From/To remain schedule filters. Inverted ranges are
  rejected in both the frontend and backend.
- History columns are Completion / Closure and Final Status. Completed uses
  persisted `completed_at` when present. Otherwise the cell says **Closure date
  not recorded**. Cancelled/Rejected always use that fallback: no dedicated
  cancellation/rejection timestamp was found in the trip schema/migrations,
  and generic events were not reinterpreted as reliable closure timestamps.
  Scheduled Dispatch remains visible as secondary information.
- Active columns and truthful unassigned truck text remain unchanged. Existing
  `UI.standardTable`, `UI.recordPager`, table CSS and eye View buttons are reused.
  Monitoring remains List-only with one server pager and its original size 12.
- Numeric paging remains `trip_page`; `page=dispatcher-monitoring` always
  identifies the authorized API screen. Paging preserves selected filters.
- Empty results retain headers and disabled paging. API failures use the
  existing router error path, distinct from empty results; malformed successful
  payloads get a Retry message rather than an empty table.

## Access and details trace

Navigation uses the existing Access registry. `App.data()` calls
`Actions::pageData()`, which checks `Access::canOpen()` before `Trips::read()`
and `DispatcherMonitoring::read()`. The latter retains its Operations Head
role guard. The SELECT projection is private; separating it from the guarded
entry point permits isolated SQL tests without connecting to operational data.

View continues through `Trips.monitor_details` and its existing independent
Operations Head guard and safe field projection. Details retain recorded
resources, Helper reason, group/shift, recorded dispatch account, timestamps,
checklists, incidents/repair status, documents and activity. No mutation controls
were added. Assignment, dispatch, maintenance clearance, finance, purchasing,
and Dispatcher processing permissions and workflows remain unchanged.

## Files changed for this task

- `backend/Core/DispatcherMonitoring.php`: History inclusion, supported-role
  scope, tab-valid statuses, private read-only projection for isolated testing.
- `public/assets/js/modules/operations/dispatcher-monitoring.js`: tab/filter
  navigation, Clear Group, count explanation, history dates/columns and error UI.
- `tests/Unit/DispatcherMonitoringTest.php`: actual SELECT queries against a
  private `sqlite::memory:` fixture, never project database credentials.
- `tests/dispatcher_monitoring_ui.html`: database-free router and workflow checks.
- `tests/run_ops_head_browser.cjs`: focused `--monitoring-only` fixture/layout mode.
- `docs/DISPATCH_MONITORING_WORKFLOW.md`: this report.

## Verification

```powershell
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'DispatcherMonitoringTest|OperationsV43Test|DispatcherAccessTest|DispatcherWorkflowTest|DispatcherPlanningTest' --do-not-cache-result
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs --monitoring-only
& 'C:\xampp\php\php.exe' -l backend/Core/DispatcherMonitoring.php
& 'C:\xampp\php\php.exe' -l tests/Unit/DispatcherMonitoringTest.php
node --check public/assets/js/modules/operations/dispatcher-monitoring.js
node --check tests/run_ops_head_browser.cjs
git diff --check
```

- **81 unit tests, 264 assertions passed.** Includes all-role denial checks at
  the Access, read and details boundaries; real SELECT projection checks cover
  every active/terminal status, unassigned/invalid roles, group/count consistency,
  Day/Night/NULL shifts, search fields, schedule dates, invalid filters and
  pagination beyond page one. Fixture row counts are unchanged by the projection.
- **654 browser assertions passed across eleven fixtures**, including 30
  monitoring checks, 94 Operations Head checks and 314 Dispatcher checks.
- Focused monitoring mode passed the same 30 monitoring checks plus **eight
  responsive checks**: Active and History at 1440/820/390px, and read-only drawers
  at 1440/390px. Standard List-only surface, six columns, one footer, eye View
  buttons and no page/drawer overflow were verified.
- The desktop History screenshot was visually inspected. Captures and the
  focused result log are under ignored `tests/reports/monitoring-*` paths.
- PHP/JavaScript syntax and diff checks passed.

SQLite verifies query behavior with synthetic isolated records; it is not a
live MariaDB or authenticated XAMPP integration test. No operational database
connection, writes, migration, commit, staging, push or deployment was performed.
Legacy absent closure dates remain unsupported rather than fabricated.
