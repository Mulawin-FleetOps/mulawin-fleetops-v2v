# Operations UI redesign — local implementation report

Date: 2026-11-10. Branch: `kenneth`. Scope: approved presentation changes with existing backend contracts. No commit, push, merge, remote changes, deployment, schema migration or development-database reset/update was performed. Existing uncommitted testing improvements and other local changes were retained. The approved Objectives of the Study were not edited.

## Actual UI changes

- Operations Head and both Dispatcher roles have direct New Trip, Active Trips, Trip History and Incidents sidebar links. Existing authorized tools remain available. All other roles retain their existing navigation.
- New Trip is one workspace. The separate creation/batch mode choice is removed. Old `#trips?batch=1` bookmarks open the same workspace.
- An entry retains its own client, truck type, schedule, approved route/map/manual distance, consignee, booking, cargo/container details and notes. Quantity expands immediately into independent trip rows, each with its own UUID request key. Cargo units do not become trip quantity. The existing backend limit is 20 trips.
- Users can edit/remove individual uncreated trips, review the queue, and acknowledge final review before submission. The queue shows row-level creation results and links to created trips; partial-failure retries send only uncreated rows with their original keys. Server validation errors remain visible in the review dialog. This is an in-memory workspace, not persisted drafts; browser reload/navigation can discard unsaved entries.
- Approved-route selection uses the existing client/truck-type-filtered API. Pending route requests cannot be selected as approved routes; pending revisions do not invalidate the current approved rate. Missing-route warnings appear in the entry, queue, final review and details. No route price is invented or calculated.
- Existing map pins, road-distance calculation, manual distance and override-reason handling remain wired through the shared distance widget. Scheduled dates retain Philippine-time limits. A resource-hold explanation avoids claiming a reservation calendar.
- Active Trips adds status and truck-type filters, shows schedule and next steps in list view, and sorts personal-action/delayed trips first, then schedule. Search, personal-action filter, card/list layouts, pagination and existing actions remain.
- Trip History has a direct route and includes truck type and waybill among its table fields. Existing filters, search, detail actions and the shared table's condensed/expanded presentation remain.
- Incidents adds a status filter and shows unresolved records before resolved ones. Trip navigation and printable incident reports remain available through the shared table actions.
- Trip Details identifies the current role's workflow context, flags absent approved-route linkage, and provides section-jump buttons. Existing action permissions, time gates, dispatch blockers, attendance, funds, checklists, completion, documents, incidents and audit history remain in place.
- Operations dashboards add a New Trip shortcut.

## Final sidebars

| Area | Operations Head | Dispatcher (both teams) |
| --- | --- | --- |
| My workspace | Dashboard | Dashboard |
| Operations | New Trip; Active Trips; Trip History; Incidents; Trucks; Drivers; Clients; Client routes; Trip funds | New Trip; Active Trips; Trip History; Incidents; My Trip Funds |
| More tools | Mechanics; Maintenance; Documents; Reports | Trucks; Drivers; Clients; Documents |
| Notifications | Existing bell and View all notifications | Existing bell and View all notifications |

Navigation is presentation only. `Access::navFor()` still supplies permitted pages; the four workflow links target the existing Trips page/query, and server action authorization is unchanged. Dispatcher truck types remain Car Carrier, or Container/Wing Van, according to the existing team role.

## Unified New Trip workflow

1. Select client, role-allowed truck type, schedule and consignee.
2. Select the approved client route, or retain the existing map/manual tools with an explicit missing-route warning.
3. Enter booking/cargo details; choose quantity and confirm addresses.
4. Add the entry. Quantity creates separate queued rows; repeat for another independent entry or edit a row.
5. Review all pending rows and warnings, acknowledge review, then create trips (Operations Head) or send requests (Dispatcher).
6. Existing `Trips.create_batch` prevalidates rows and uses `Trips.create` for each trip. Operations Head trips auto-assign or await resources; Dispatcher requests remain Pending Review. Inspect results and retry only failed rows. The UI does not promise all rows are atomically created when a runtime error occurs after prevalidation.

## Files changed by this implementation

| File | Purpose |
| --- | --- |
| `public/assets/js/modules/operations/trip-planner.js` (new) | Unified workspace, independent entries, quantity, review, results/retries |
| `public/assets/js/modules/operations/trips.js` | Remove superseded entry screens; improve trip lists, incidents and drawer; support direct view links |
| `public/assets/js/core.js` | Role-specific trip navigation, active link/ARIA state, Dispatcher fund label |
| `public/assets/js/modules/general/dashboard.js` | Operations New Trip shortcut |
| `public/assets/css/app.css` | Planner review, filters and next-step presentation |
| `public/index.php` | Load the planner module after Trips |
| `tests/operations_ui.html` (new) | Database-free mocked browser fixture |
| `docs/OPERATIONS_ROUTE_ENFORCEMENT_PROPOSAL.md` (new) | Current fallback behavior and separately approvable enforcement changes |
| `docs/OPERATIONS_BILLING_ANALYSIS.md` (new) | Current vs intended pricing and separate implementation proposal |
| `docs/OPERATIONS_SCHEDULING_PROPOSAL.md` (new) | Existing holds, limitations and future reservation design |
| `docs/OPERATIONS_UI_IMPLEMENTATION.md` (new) | This report and verification instructions |

Other pre-existing working-tree changes, including `backend/bootstrap.php`, `.gitignore`, Composer/PHPUnit configuration and testing changes, are not part of this UI implementation and were not overwritten.

## Backend integrations and business-rule limitations

No backend policy, financial calculation, resource-hold rule or database structure changed. The only PHP edit is adding the frontend module to the HTML shell's script list. The UI reuses `Routes.selectable`, `Trips.create_batch`, trip details/actions and the shared map/distance behavior. The route selector intentionally receives no monetary rate information.

Remaining conflicts requiring separate approval:

1. The business requires an approved route; current trip APIs still permit map/manual distance alternatives. UI warnings acknowledge the conflict without enforcing a new policy. See [route-enforcement proposal](OPERATIONS_ROUTE_ENFORCEMENT_PROPOSAL.md).
2. Actual billing still uses `max(km × client_rates.rate_per_km, minimum_charge)`, rounded to two decimals, plus existing charges. Approved route Flat rates are separately stored and do not currently drive this calculation. See [billing analysis](OPERATIONS_BILLING_ANALYSIS.md).
3. Future scheduling uses present availability and exclusive active holds, with existing scheduled-shift crew rules. It has no time-interval reservation calendar. See [scheduling proposal](OPERATIONS_SCHEDULING_PROPOSAL.md).

## Verification actually executed

Database-free checks ran first.

| Check | Actual result |
| --- | --- |
| Existing default PHPUnit suite | **282 tests, 302 assertions, passed** (PHP 8.2.12, PHPUnit 11.5.57) |
| Local headless Chrome fixture | **25 checks passed, 0 failed**; all API responses mocked, map provider disabled |
| `node --check` on core, dashboard, Trips and planner | Passed |
| `php -l public/index.php` | Passed |
| `git diff --check` | Passed |
| PHPUnit Integration suite | **12 skipped, 0 assertions**: opt-in/test credentials not configured; no disposable databases created or used |
| Authenticated live workflow, live map provider, actual billing and concurrency integration | Not run; no development-database changes authorized |

The browser fixture covers quantity expansion, multi-client entries, approved/manual route labels, individual edits, unique keys, serialization, partial failures and failed-row-only retries, invalid quantity, role-scoped truck types, Dispatcher approval wording, combined Active Trip filters, Trip History deep links, incident filtering and both sidebars. The fixture disables modal animation for deterministic headless execution; its initial transition-timing failure was corrected in the test harness. It does not prove server-side persistence, real map routing or production visual acceptance. The generated local browser profile was removed after the run.

## Local verification instructions

From `C:\xampp\htdocs\mulawin-fleetops-v2v`:

```powershell
& C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit
node --check public/assets/js/modules/operations/trip-planner.js
node --check public/assets/js/modules/operations/trips.js
node --check public/assets/js/core.js
node --check public/assets/js/modules/general/dashboard.js
& C:\xampp\php\php.exe -l public/index.php
git diff --check
```

Open `tests/operations_ui.html` directly as a local file in Chrome to run the mocked fixture without Apache, credentials, a map service or a database. Read the `RESULT: 25 passed, 0 failed` text. Its sample company/trip data are fixtures only; this is not an application entry point. Do not load it through the application server (the tests directory is intentionally web-blocked).

For a visual check, open the existing local application in a browser and sign in as Operations Head and each Dispatcher. Inspect the sidebar links, New Trip layout at desktop/mobile widths, status/type filters, History filters, incident actions and role-aware drawer. Viewing the existing application is separate from the mocked fixture. Do not submit real trips to the development database for testing this change.

For end-to-end persistence/concurrency checks, first provide an explicitly configured local test user and use only the existing guarded isolated launchers documented in `tests/README.md`. Enable `FLEETOPS_DB_TESTS=1`, explicit `TEST_DB_USER`/`TEST_DB_PASS`, and verify the launcher's random run ownership and `_test` database protections. Never substitute application credentials or reset the development database. An integration-suite skip is not an integration pass.
