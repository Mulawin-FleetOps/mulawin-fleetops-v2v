# Dispatcher Monitoring access correction — 2026-11-11

## Confirmed cause

The local Apache access log records these requests:

```text
GET /mulawin-fleetops-v2v/public/index.php?api=data&page=dispatcher-monitoring -> 200
GET /mulawin-fleetops-v2v/public/index.php?api=data&page=1&tab=history -> 403
GET /mulawin-fleetops-v2v/public/index.php?api=data&page=1&group=container_wingvan_dispatcher&shift=Day -> 403
```

Monitoring links and pagination used `page` for a numeric record-page number.
`App.data()` constructs `{api: 'data', page, ...query}`, so that query value
replaced the authorized screen identifier. The hash still named monitoring,
which passed the frontend navigation check; the outgoing API request named `1`.

The server path is `public/index.php` -> `Actions::pageData('1', ...)` ->
`Access::canOpen($user, '1') === false` -> HTTP 403 with
`You do not have access to this page.` The core router displays this backend
error inside its module-failure panel. `Trips::read()` is never reached for
that request. This is not the frontend's separate navigation-denial panel.

## Authorization and environment checks

- Branch `kenneth`; starting HEAD `98c754d`; starting working tree clean.
- `dispatcher-monitoring` is registered to Trips and authorized only for
  `operations_head`. `Access::navFor()` includes it for that role, and
  `Data::me()` supplies that navigation to `App.me.nav`.
- A read-only operational query found one active Operations Head account with
  role `operations_head`. No session cookies or credentials were exposed.
- `Trips::read()` dispatches this screen to `DispatcherMonitoring::read()`;
  both retain their Operations Head role checks. `monitor_details` also keeps
  its role guard and read-only projection.
- No authorization, shared router, database schema or business-process changes
  were necessary. The malformed request itself establishes the cause; stale
  cache is not needed to explain it.

## Minimal application correction

`public/assets/js/modules/operations/dispatcher-monitoring.js` uses `trip_page`
for tab/group link resets and Previous/Next controls.
`backend/Core/DispatcherMonitoring.php` reads that same key for SQL pagination.
The response still returns `page`, `pages`, and `pageSize` as before.
Shared `page` continues to identify the authorized API screen.

Example corrected request:

```text
index.php?api=data&page=dispatcher-monitoring&tab=history&trip_page=1
```

## Executed verification

- The new database-free `tests/dispatcher_monitoring_ui.html` initially failed
  on the actual serialized group-selection API URL before the application fix.
  Afterward all 16 checks passed using the real core router, request serializer
  and monitoring renderer, with mocked API responses. It covers group/shift,
  both tabs, paging, filters, empty state, read-only details, and navigation
  denial for both Dispatcher roles and other management roles.
- `node tests/run_ops_head_browser.cjs --fixtures-only`: 502 checks passed,
  zero failed across eight browser fixtures. The existing monitoring assertion
  in `tests/trip_approvals_ui.html` was updated to expect `trip_page`.
- `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --testsuite Unit --filter
  "OperationsV43Test|DispatcherAccessTest|DispatcherWorkflowTest|DispatcherPlanningTest|TripApprovalAccessTest"
  --do-not-cache-result`: 96 tests, 232 assertions passed.
- `tests/run_operations_v43_tests.php`: 85 checks passed, zero failed. It ran
  with generated test credentials against a separately initialized MariaDB
  10.4.32 instance on loopback port 61844, after verifying its data directory.
  Its two databases were uniquely named, ownership-guarded disposable databases.
  New tests exercise real `Actions::pageData()` authorization with pagination,
  completed history, empty history, and continued denial of numeric screen IDs.
  Existing tests cover completion, historical responsibility, manual assignment,
  Helper replacement, maintenance coordination, funds and Car Carrier behavior.
- PHP syntax checks passed for both modified PHP files; Node syntax check passed
  for the modified monitoring JavaScript.
- Live XAMPP returned HTTP 200 for the application HTML and its versioned
  monitoring JavaScript. The served JavaScript SHA-256 matches the modified
  local file and includes `trip_page`.

## Limits and preservation

The user's live authenticated browser session was not attached or replayed.
Authenticated workflow testing used the disposable database, and browser
interaction testing used mocked records. Thus live XAMPP asset delivery is
verified; a full signed-in operational-browser smoke test is not claimed.
Reopen Dispatcher Monitoring from its sidebar after reloading to leave any
old hash containing the former numeric `page` parameter.

No operational records were modified and no operational migration was applied.
The test launcher removed its owned databases. The disposable MariaDB process
was shut down, and its verified test directory and generated credentials were
removed afterward.
No commit, push, merge, reset, or staging operation was performed.
