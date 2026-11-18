# Kenneth Operations audit and approved-scope fixes

Audit date: November 11, 2026 (Asia/Shanghai). Source baseline: `665910d`.

## A. Environment verification

| Check | Observed result |
| --- | --- |
| Workspace | `C:\xampp\htdocs\mulawin-fleetops-v2v` — accessible local Windows checkout |
| Repository root | `C:/xampp/htdocs/mulawin-fleetops-v2v` |
| Branch | `kenneth`; no branch switch |
| Starting tracked changes | None |
| Starting untracked work | `public/assets/js/modules/operations/routes.js.backup` — preserved |
| Backup SHA-256 before/after | `B5F4975204635CF575180017311FA709654D61FE0A5A0CDB198A1AE2CEDC8604` |

Relevant recent history:

- `665910d` — Merge latest kenneth changes and resolve routes conflict. Despite its title, the committed route script still contained two unresolved conflict blocks.
- `b015f25` — Update Operations and Dispatcher UI, including browser regressions.
- `17469d2` / `fdd4d1a` — route modal layout, garage hierarchy and copy.
- `9665c28` / `45850df` — operational distance labels, option refresh and routing status.
- `0b9e287` — Fix Operation and Dispatcher, including existing testing infrastructure.

No commit, push, pull, merge, rebase, reset, deployment, database migration or database record mutation was performed. The Objectives of the Study were not changed.

Final local status: two modified tracked files (`routes.js`, the browser runner), three new audit/test files (this report, `routes_ui.html`, `RouteSafetyTest.php`), and the unchanged pre-existing untracked backup. Nothing was staged or committed; branch and HEAD remain `kenneth` / `665910d`.

## B. Issues discovered

Paths below are relative to the verified repository root.

| ID / severity | File and component | Root cause and actual impact | Disposition |
| --- | --- | --- | --- |
| R1 — High | `public/assets/js/modules/operations/routes.js`, `RouteUI.request()` | Two committed conflict blocks caused `SyntaxError: Unexpected token '<<'`. The script could not register `RouteUI` or the Client Routes page. Dependent Operations renderers could consequently fail as well. | Fixed locally. |
| R2 — Low | Same form, Route Option | The visible selector remained after its removal was approved. Deleting the field without an internal value would also omit the option from computed-distance submissions, allowing the server to classify them as Manual. | Visible selector removed; configured internal option retained and tested. |
| R3 — High | `backend/Modules/Operations/Trips.php`: `create()`, `createBatch()`, `review()`, `dispatchBlockers()` | Approved routes are mandatory for new Operations Head creation, but Dispatcher API intake permits absent route IDs. Review can accept manual/map distance without a route. Dispatch has no independent route-approval guard. Thus the intended rule is not enforced at every final acceptance point. | Policy/enforcement proposal only; no backend change. |
| R4 — High | `Trips.php`: `distanceColumns()` / `distanceUnchanged()` | The unchanged-distance shortcut compares route ID, coordinates, km, option and override reason, but not truck type. It returns before `RouteDistance::fromClientRoute()` validates client/type eligibility. Changing the truck type during review can therefore retain a route validated for the previous type. Review also lacks the selected-route transaction recheck used by creation. | Reproduced without DB access; deferred with the route-validation proposal. |
| R5 — High | `backend/Core/BillingDraft.php`, `createFor()` | Dispatch billing selects `client_rates` by client/truck and calculates the legacy km-based amount. It never reads `client_route_rates`. An approved Flat route rate is not the price used for the resulting draft. | Financial integration gap; no calculation changed. |
| R6 — Medium | `database/extension.sql`, trip routing migration; `Trips.php`, `BillingDraft.php` | Trips retain `client_route_id` but no approved route-rate version ID. Billings snapshot legacy amounts but do not identify a route-rate version. Historical contractual provenance cannot be recovered reliably from a later current-rate lookup. | Additive schema/snapshot proposal only. |
| R7 — Medium | `backend/Modules/Operations/Routes.php`, `selectableAction()`; `public/assets/js/modules/operations/ops-head.js`, planner | The selectable API intentionally projects out `rate_type`, `rate_amount`, `minimum_charge` and rate-version IDs. The planner's conditional approved-rate display consequently receives none of these fields from the real API. | API/UI integration proposal; do not expose financial data to additional roles implicitly. |
| R8 — Medium | `Trips.php`, `hasRate()` and client projection; `Clients.php`, `rateSave()`; Operations planner | Trip eligibility and client activation still depend on legacy `client_rates`. Approving a contractual route rate alone does not satisfy these gates. Updating billing in isolation would leave planning blocked or inconsistent. | Include in the coordinated integration plan. |

Additional observations requiring policy decisions rather than silent fixes:

- `RouteDistance::fromClientRoute()` supplies approved coordinates/reference km, but `Trips::distanceColumns()` does not canonicalize submitted pickup/delivery text from the selected route. The primary forms populate it correctly; a direct API caller can supply different labels. Any strict endpoint-identity rule must be enforced server-side for new work.
- Saved distances deliberately remain usable when an existing route is later deactivated. Decide how this applies to accepted but undispatched trips before adding a new dispatch guard. Closed historical records must not be invalidated automatically.
- Some older backend comments still describe route selection as unconnected; executable code and the findings below are the authority for this audit.

### Approved-route enforcement: answers to the requested questions

| Question | Current behavior and evidence |
| --- | --- |
| How are routes selected? | Primary Operations planning and Dispatcher request forms call `Routes.selectable` with client and truck type. `RouteDistance::selectable()` joins an Approved route, current Approved rate and Active client; it filters by client/type and optionally route ID. |
| Can pending routes be selected? | Not through that API. Pending Rate, Pending Approval, Rejected, Withdrawn and Inactive routes are excluded. An already Approved route with a pending rate revision continues using its existing Approved rate. |
| Can a trip be created without an approved route? | Operations Head `create()` requires a route; batch preflight does too. Dispatcher `create()` and Dispatcher batch requests can omit it and enter Pending Review. |
| Can Dispatchers submit while a route is pending? | The primary Dispatcher form requires an approved selection and cannot select a pending route. Direct API/manual-distance intake and the existing bookmarked batch flow can submit a request without an approved route. This does not itself approve the pending route. |
| Does Operations approval require a route? | No universal requirement. `review()` validates delivery fields and positive km and checks a legacy client rate; its distance resolver accepts manual/map distance without a route. |
| Is missing route approval a dispatch blocker? | No. `dispatchBlockers()` covers status/checklist, funds, scheduling, crew and resource rules, but not route approval. |
| Are client and truck type verified? | Yes for explicit fresh selection through `fromClientRoute()` / `selectable()` and create-time rechecks. The unchanged-distance review shortcut is an exception; see R4. |
| Are rate revisions historical? | Yes for the route-rate catalog. Revisions create new version rows; approval marks the old row Superseded with `effective_to`, activates the new row, and records events in one transaction. Existing rate amounts are retained. Trips do not pin those versions. |

Safe diagnostic of R4: using the real `Trips::distanceColumns()` method under `tests/bootstrap.php` with database access disabled, an existing Container route ID 9 and unchanged distance/pins were passed with a new Wing Van truck type. The result retained `client_route_id=9` and returned `truck_type=Wing Van`. This demonstrates the validation shortcut; it did not read or mutate an actual trip.

### Route-specific billing: current behavior

- Route identity includes client, truck type, directional normalized pickup/delivery keys. The schema allows the same endpoints for the same client under different truck types, with separate route/rate rows.
- `Routes::POLICY` currently allows Operations Head requests, Billing rate entry and Admin decisions. Separation of duties prevents the rate's author from deciding it. The enabled route rate type is Flat; the database also supports Per Km, which is not implicitly enabled by this audit.
- `BillingDraft::createFor()` currently reads `client_rates.rate_per_km` and `minimum_charge`, then computes `round(max(trip distance × legacy rate, legacy minimum), 2)`. This describes existing code, not a proposed contractual pricing formula.
- `Routes.selectableAction()` omits the selected rate ID/version from its trip-facing response; `fromClientRoute()` uses the rate to determine eligibility but does not save a rate-version link on the trip.
- The billing record stores its own distance, legacy rate/minimum, base amount and total. A new legacy rate affects future dispatch draft generation. `createFor()` may refresh an existing Ongoing or Cancelled draft on redispatch; it does not refresh For Billing/Invoiced/Partially Paid/Paid records through that path.
- `Billing::editable()` restricts adjustments to For Billing. Finalization requires verification and no pending adjustments and recomputes approved charges against the stored base; it does not retrieve a newly approved route rate. Existing invoices are therefore not automatically repriced by a route-rate revision.
- Historical rate-version provenance is missing, rather than safely inferable. Do not attach today's approved version retrospectively to past work or recalculate old invoices.

## C. Changes implemented

| Exact path | Change, reason and preserved behavior |
| --- | --- |
| `C:\xampp\htdocs\mulawin-fleetops-v2v\public\assets\js\modules\operations\routes.js` | Combined both conflict versions deliberately: retained client and `d.filterType` preselection, Pickup/Delivery labels, fixed garage card, map preview, stop sequence, legend, distance summaries, pin controls, directions and manual fallback. Kept `Routes.request`, success feedback, optional `options.after`, default `App.route()`, `rpm-route-dialog`, `wireDistance()` and Billing/Admin footer. Replaced only this form's visible Route Option selector with a hidden configured default. Updated the obsolete frontend integration comment. |
| `C:\xampp\htdocs\mulawin-fleetops-v2v\tests\routes_ui.html` | New database-free browser fixture exercises the actual route form, shared distance widget and local Leaflet library. APIs are mocked and network tiles disabled; it covers rendering, submission/callbacks, auto km, manual fallback, outage, required override reason, similar-route acknowledgement and shared-field isolation. |
| `C:\xampp\htdocs\mulawin-fleetops-v2v\tests\Unit\RouteSafetyTest.php` | New pure validation and real denied-role checks; uses the existing unit sandbox with unusable DB credentials. No financial or route acceptance policy is changed. |
| `C:\xampp\htdocs\mulawin-fleetops-v2v\tests\run_ops_head_browser.cjs` | Includes the route fixture and desktop/tablet/mobile route previews in the existing runner. Existing fixtures, fixture-only mode and checks remain. Waits for modal presentation to settle before screenshots. |
| `C:\xampp\htdocs\mulawin-fleetops-v2v\docs\KENNETH_OPERATIONS_AUDIT.md` | This audit, limitations and separate implementation proposal. |

Backend PHP, schemas, migrations, records, authentication, permissions, financial calculations, `composer.json`, `composer.lock`, `phpunit.xml`, `tests/EnvironmentTest.php` and test database isolation protections were not modified.

## D. Testing results

| Test | Expected | Observed | Result |
| --- | --- | --- | --- |
| Initial `node --check .../routes.js` | Parseable source | `SyntaxError: Unexpected token '<<'` at the committed conflict marker | Failed before fix |
| Final application JS syntax | No syntax errors | 23 application JS files passed; browser runner also parses | Passed |
| PHP syntax | No syntax errors | 97 PHP files in backend/config/public/tests passed | Passed |
| Conflict-marker scan | No unresolved markers in application JS | No `<<<<<<<`, `=======` or `>>>>>>>` marker lines remain in `public/assets/js/**/*.js` | Passed |
| Safe PHPUnit suite | Non-destructive tests pass | 401 tests, 575 assertions, no failures | Passed |
| Route browser fixture | Preserve real form/map interactions and payloads | 24 checks passed using real local Leaflet and widget code, mocked API responses | Passed |
| Existing browser fixtures | No Operations/Dispatcher regressions | 25 Operations, 78 Operations Head, 49 Approvals, 268 Dispatcher, 33 reports, 40 analytics checks passed; 517 total including route checks | Passed |
| Responsive checks | Usable route form and existing role layouts | 66 layouts passed, including route modal at 1440/820/390 px; screenshots manually reviewed | Passed |
| Existing print/export/keyboard checks | Preserve supported interactions | Analytics PDF and full filtered CSV generated; five native filter focus/keyboard checks and reduced motion passed | Passed |
| R4 isolated diagnostic | Establish whether truck-type change skips eligibility | Retained old route with new truck type without DB access | Confirmed bug, deferred |
| Disposable DB integration suite | Run only with explicit isolated test configuration | 16 tests skipped, zero assertions; DB-test flag and dedicated credentials absent | Skipped / database scenarios Not Executed |
| Live authenticated page/API transactions, concurrency and external routing provider | Dedicated environment/provider verification | No development/production database or live provider used | Not Executed |
| Backup preservation | Same contents | SHA-256 matches starting backup | Passed |
| Diff checks | No whitespace errors or unapproved backend/config changes | `git diff --check` clean; protected backend/database/config files unchanged | Passed |

Commands used include `node --check`, `C:\xampp\php\php.exe -l`, `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result`, the Integration testsuite with its existing skip gates, and `node tests/run_ops_head_browser.cjs`.

Database safety review: `tests/bootstrap.php` copies application dependencies to a temporary unit sandbox and disables database connections. Integration is opt-in through `FLEETOPS_DB_TESTS=1` plus explicit `TEST_DB_USER` and `TEST_DB_PASS`; none were configured. `tests/_launcher.php` restricts hosts to loopback, appends random suffixes to test names, requires `_test`, excludes the application database name, uses an isolation manifest, and verifies ownership tokens before deleting its own disposable databases. These safeguards were preserved. No test database was created or contacted in this audit.

### Operations workflow review

| Area | Reviewed behavior and verification boundary |
| --- | --- |
| Operations dashboard and planner | Four real-data cards; client/type approved route selection; independent multi-client batch rows; existing max 20; review does not create records; explicit submission, request keys, partial retry and recovery. Browser contracts passed; SQL-backed creation not executed. |
| Approvals and management | Server-paged approval categories, compact search/filters, existing review/reject actions and active/history views. Route acceptance exceptions are R3/R4, not a UI redesign target. |
| Funds | Operations Head approval remains separate from Finance release. Dispatcher request/revision and release visibility remain; role guards and browser contracts passed. |
| Trucks, drivers/helpers and clients | Authorized masterlist records/details retained. Car Carrier uses two drivers; Container/Wing Van uses driver/helper. `DispatcherScope` and `DispatcherResources` enforce group, permanent truck, attendance, availability and maintenance eligibility. DB-backed eligibility/concurrency remain unexecuted. |
| Client Routes | Script restored; selectable rules and route request form verified as above. Rate approval/version persistence reviewed in source, not on a live DB. |
| Incidents and Maintenance | Trip incident handler links the incident to a corrective job and places the trip On Hold. Resume/reschedule retain existing status/clearance guards. Maintenance personnel retain processing responsibility; no new permissions granted. |
| Reports | Existing Trips / Fleet and Maintenance analytics, recorded calculations, printing and export interfaces retained. Mocked browser and print/export checks passed; live aggregate accuracy not revalidated against a DB. |
| Dispatcher | Four supported dashboard metrics, role-specific menus, tabs, inline filters, compact tables, detail actions, eligible trip incident reporting, unified attendance and history preserved. 268 browser checks passed. |
| Server authorization | `Actions::pageData()` checks authenticated access; module actions separately enforce role/record restrictions. Database-free authorization tests execute real guards. Hiding navigation is not authorization: existing Operations Head read access to maintenance/mechanic pages remains in `Access`, while mechanic/maintenance mutation guards remain restricted. |

## E. Remaining integration gaps

1. **Confirmed bugs:** R4 truck-type eligibility shortcut; R7 missing planner rate display data. Both remain documented for coordinated approval, rather than changing business validation/API financial visibility silently.
2. **Missing functionality:** R5/R6 approved route-rate billing and historical rate-version linkage. The previously documented Diesel PO request/approval/issuance lifecycle also remains unavailable; existing attachment/viewing functionality is preserved.
3. **Business-rule inconsistencies:** R3 frontend vs API route requirement; R8 legacy rate gates; endpoint-label canonicalization; treatment of accepted work after route deactivation; rate-version binding time (acceptance vs dispatch).
4. **Database/migration requirements:** No migration was executed. New route-rate foreign keys/snapshots and pricing-source fields require an additive compatibility design; live installation state was not queried.
5. **Features requiring explicit approval:** Strict enforcement at acceptance/dispatch, any legacy-trip exception, new financial response fields, version pinning, pricing-source migration and changes to financial calculations. These are proposals only.

## F. Recommended next implementation — proposal, not executed

| Order | Scope / affected files and dependencies | Risk | Safe implementation and validation |
| --- | --- | --- | --- |
| 1 | Confirm acceptance policy: pending Dispatcher intake, legacy open trips, deactivated routes and rate binding time | High business impact | Recommend allowing clearly marked pending intake if desired, but requiring a matching approved route at final Operations acceptance. Decide whether previously accepted undispatched work is blocked by later deactivation. Do not assume a policy for historical records. |
| 2 | Route enforcement: `Trips.php` create/batch/review/edit/dispatch/reschedule paths; `RouteDistance.php`; planner, approvals and Dispatcher frontend | High | Make client/type/route matching unavoidable even when distance is unchanged; recheck eligibility under the final transaction using a lock order compatible with route/rate approval. Canonicalize new route endpoints if approved. Keep server-derived distance validation and override reasons. Preserve duplicate/recovery keys, partial batch behavior and resource/status guards. Test forged/missing/pending/mismatched routes, type edits, deactivation/revision races and legacy exceptions in owned disposable DBs. |
| 3 | Rate provenance: additive migration, `Trips.php`, `Routes.php`, `client_route_rates`, trip/billing detail APIs | High | Choose and persist the approved version at the approved binding point; capture the approved type/amount/minimum as auditable snapshots. Nullable links and explicit legacy pricing source preserve old records. Do not infer old contractual versions from current rates. Keep separation of duties and existing rate-version events. |
| 4 | Billing integration: `BillingDraft.php`, `Accounting/Billing.php`, `Operations/Clients.php`, billing schema/UI and reports | High financial impact | Use the pinned approved rate model for eligible new work only. Flat is currently enabled; do not assume all rates are per km or silently enable another model. Agree exact model/rounding/additional-charge semantics first. Preserve stored invoice amounts, finalized-record locks, adjustments and collections. Replace legacy planning gates only as part of the same compatibility change. Existing `billings.rate_per_km` is non-null, so model representation needs explicit schema design. |
| 5 | Workflow/UI consistency: `ops-head.js`, `trip-approvals.js`, `trip-planner.js`, `dispatcher.js`, `routes.js` and approved API projections | Medium | Make the same accepted-route state visible across entry paths. Return monetary rate summaries only to authorized roles; otherwise show route/version references. Preserve Dispatcher group scope, attendance, maintenance holds and existing release authority. |
| 6 | Regression and integration rollout: existing PHPUnit/browser suites and isolated legacy runners | Medium | Supply dedicated loopback test-only credentials, verify host/name/ownership and unique names before connecting, then run fresh/migration/concurrency cases. Include same-client/same-endpoints/different-type rates, superseded versions, flat vs authorized per-km cases, no-history-repricing assertions, active/historical legacy records, billing adjustments and full resource/incident workflows. Do not use development/production DBs or unowned existing DBs. Review locally before any commit/deployment. |

Current fixes require no database changes. All proposed policy/financial/schema changes above await a separate explicit approval.
