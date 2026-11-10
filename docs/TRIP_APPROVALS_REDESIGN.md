# Trip Approvals and Operations Head sidebar cleanup

Implemented November 10, 2026 in the local Windows checkout `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. Existing modified and untracked work was preserved. No commit, push, merge, deployment, migration, or development-database change was performed.

## Implemented presentation

Trip Approvals now opens `#trips?view=approvals`, a dedicated view of the existing Trips page. Its page title, browser title, breadcrumb, and active sidebar item identify Trip Approvals. The subtitle is **Review and process dispatcher-submitted trip requests.** It has no New Trip button, Active/History/Incidents tabs, or operational monitoring cards.

Three compact, clickable cards display Pending Review, Approved, and Rejected. Pending Review is the default; the selected card is visibly marked. Search uses the requested placeholder. Client, truck type, requesting dispatcher, request-date range, and approval status are available in a collapsible filter area. Search/filters work together, Reset Filters retains the category, and pagination retains the filters. General Trip Management and Incidents links start with their own clean queries.

The responsive request table shows trip/client, route/truck type, scheduled dispatch, requester/request date, approval decision, and Review/View. No table-row approve/reject buttons were added. Loading, unavailable, empty, validation, and API error states use the existing shell and dedicated drawer feedback.

## Verified decision classification and pagination

The read-only backend projection lives in `Trips::read` when `view=approvals`; it uses the existing authorization requirement for Operations Head review. There is no new approval table, official status, schema, or decision engine.

Only trips whose recorded `intake_source` is `Dispatcher` enter these queues. Operations Head's own automatically confirmed trips do not inflate dispatcher approval history.

Classification follows the actual persisted evidence:

- Approved: both `approved_by` and `approved_at` are recorded, or an existing `trip details confirmed by Operations Head` event exists. This classification remains available when the operational trip becomes Awaiting Resources, Pre-Assigned, Dispatched, Completed, or another subsequent status.
- Rejected: an existing `trip request rejected` event records the transition to Rejected.
- Pending Review: the trip remains Pending Review and neither processed-decision classification applies.
- Known dispatcher requests without classifiable decision evidence are excluded from those categories and counted separately in an explanatory note. For example, an unreviewed cancelled request does not become an invented rejection. Records lacking Dispatcher intake provenance are not silently treated as dispatcher requests.

Search covers trip reference, client, pickup, delivery, and requesting user. Dates filter `created_at`, not scheduled dispatch. IDs, truck type, category, dates, and page values are validated; SQL filter values are bound parameters. Counts apply the same search/request filters across all three categories and all result pages. The selected category has an exact total and 12-row server-side pages; out-of-range page numbers clamp to the last available page. This view does not rely on the general Trip History API's 1,000-row cap. The Dashboard's pending-approval count now uses the same Dispatcher intake provenance.

The SQL projection and frontend are implemented, but actual MariaDB execution is not claimed as verified in this session: isolated test credentials were absent.

## Review drawer and decisions

Review/View loads the existing protected `Trips.details` response. The drawer header shows the trip reference, Trip Request Review, the evidence-based approval decision, and the actual official trip status. The desktop drawer occupies 720px, leaving the workspace visible; mobile adapts to the viewport.

Its sections are:

1. Request Information: client, truck type, route/approved-route linkage, dispatch schedule, requester, request date, approval decision, and official trip status.
2. Delivery Information: existing instructions, consignee, booking, cargo units, or relevant shipment/container fields.
3. Resource Information: recorded truck/crew and available restrictions. Pending requests explain that existing automatic assignment occurs after approval and can result in Awaiting Resources. There are no manual assignment or maintenance processing controls here.
4. Supporting Records: authorized trip documents and existing event history, including confirmation, rejection, and recorded modifications.

Pending requests also have a collapsible **Confirm or Correct Trip Details** form. This reuses the existing delivery fields and map/distance widget, preserving required truck type, scheduling, distance, route eligibility, and shipment validations. Missing essential values open the correction form automatically. Conditional fields are validated only when applicable, consistently with the existing review modal.

The fixed footer has Reject Trip and Approve Trip. Rejection opens a confirmation area requiring a trimmed reason of at most 300 characters. Submission disables the decision controls immediately, checks the current protected record, and calls the unchanged `Trips.review` action. That backend still validates authorization, locks the trip, requires Pending Review, records events/rejection reasons, resolves notifications, and performs existing resource assignment. No permission, scheduling, financial, or transition rules were changed.

Success displays the actual backend response, refreshes counts/list, and reloads the drawer with the actual resulting trip status. An already-processed request or concurrent HTTP 409 refreshes to the current record. A retry always rechecks the current record before another decision. Previously approved/rejected records expose Close and read-only supporting information; they have no approval/rejection form or management controls in this interface.

Drawer opening waits for any prior close transition to finish. Navigating away from the approval view closes its drawer. The shared router also discards stale responses from an older same-page query, preventing rapid filter/navigation requests from replacing newer results.

## Sidebar cleanup and permission conflict

The former Operations Head More Tools group contained **Mechanic Masterlist** and **Corrective Maintenance**. Both were authorized read-only destinations for that role; their processing actions already belonged to other roles. No additional required Operations Head mutation tool was found in that group.

Operations Head now displays only these groups/items:

| Group | Items |
| --- | --- |
| Overview | Dashboard |
| Trip Operations | Trip Planning; Trip Approvals; Trip Management; Trip Fund Approvals |
| Masterlists | Truck Masterlist; Driver & Helper Masterlist; Client Masterlist; Client Routes |
| Monitoring & Records | Incidents & Maintenance; Reports; Documents |

There is no More Tools menu and no standalone Mechanics or Corrective Maintenance link. Incidents & Maintenance continues to open `#trips?tab=incidents`. Existing incident cards/details and trip details retain affected trucks, linked maintenance references/status, holds, recommendations, and the Dispatcher rescheduling explanation. The shortcut exposes no mechanic editing, repair-cost entry, completion, or clearance action.

**Existing backend-policy conflict:** `Access::pages()` still authorizes Operations Head read-only access to the standalone Mechanics and Maintenance pages and their permitted detail APIs. Removing those read permissions would be a separate backend permission change, so it was not silently bundled into this UI update. Hiding the links is not represented as revoking that access.

Existing mutation rules remain enforced server-side: Mechanics management is Admin/Motorpool; corrective maintenance processing is Motorpool. Operations Head cannot perform those mutations by direct API. Dispatcher roles cannot open the maintenance pages under the existing page policy. Motorpool and other roles retain their previous authorized pages, navigation, and functions. No maintenance backend file, shared endpoint, record, table, or business process was removed or modified.

## Files in this update

| File | Change |
| --- | --- |
| `public/assets/js/modules/operations/trip-approvals.js` (new) | Dedicated list, categories, filters, review/read-only drawer, existing decision API integration |
| `public/assets/js/modules/operations/ops-head.js` | Approval entry point/Dashboard links; remove role-specific extras; close approval drawer on view changes |
| `public/assets/css/ops-head.css` | Approval cards, toolbar, advanced filters, drawer/footer, mobile layout |
| `public/assets/js/core.js` | Dedicated approval active state; discard stale same-page query responses |
| `public/index.php` | Load the approval presentation after shared modules |
| `backend/Modules/Operations/Trips.php` | Authorized read-only decision projection, filtering, counts, server pagination |
| `backend/Modules/General/Analytics.php` | Align pending-approval count with Dispatcher request provenance |
| `tests/trip_approvals_ui.html` (new) | Mocked approval/sidebar workflow fixture and visual previews |
| `tests/Unit/TripApprovalAccessTest.php` (new) | Actual role-denial checks before database access; unchanged maintenance policy; invalid date range |
| `tests/trip_approval_tests.php` (new) | Guarded isolated MariaDB classification, decisions, pagination, date filters, concurrency/audit scenarios |
| `tests/run_trip_approval_tests.php` (new) | Existing safe disposable-database launcher for those scenarios |
| `tests/ops_head_ui.html` | Updated sidebar/Dashboard regression expectations |
| `tests/run_ops_head_browser.cjs` | Add approval fixture and settled desktop/mobile drawer checks/screenshots |
| `tests/README.md`, `docs/OPERATIONS_HEAD_REDESIGN.md`, this report | Verification instructions and superseding navigation information |

`backend/Core/Access.php`, Mechanics.php, and Maintenance.php were inspected and left unchanged. Pre-existing planner, fund, fleet, test-framework, Composer, CSS, bootstrap, and other local changes remain in place.

## Actual verification

| Check | Final result |
| --- | --- |
| Database-free PHPUnit | PASS: 301 tests, 337 assertions |
| Existing Operations browser fixture | PASS: 25 checks |
| Existing Operations Head browser fixture | PASS: 72 checks |
| New Trip Approvals browser fixture | PASS: 49 checks |
| Exact viewport checks | PASS: 8 layouts across 1440px and 390px, including settled approval drawers and visible fixed footers |
| PHP syntax | PASS for affected PHP files and new test files |
| JavaScript syntax | PASS for affected JavaScript and browser runner |
| `git diff --check` | PASS |
| PHPUnit Integration | SKIPPED: 13 suites, 0 assertions; explicit isolated DB opt-in/credentials absent |
| Authenticated live persistence, true database race, actual notification/audit writes | NOT RUN |

The mocked approval fixture verifies the dedicated title/breadcrumb/sidebar, three decision cards, default/selected categories, completed approved requests, source exclusions, historical gaps, collapsed filters, combined filters/reset, empty lists, full request details, automatic assignment explanation, sticky actions, duplicate clicks, rejection validation, actual response display, list/count/drawer refresh, processed read-only states, stale checks, simulated concurrent 409 handling, validation-error recovery, pagination, clean navigation, and Motorpool/Dispatcher sidebar preservation.

PHPUnit executes the real role checks for unauthorized approval reads/decisions and Operations Head mechanic mutations without database access. Existing authorization tests also cover denied maintenance-processing actions. These tests prove the checked permission branches; they do not substitute for a full authenticated HTTP test.

The new isolated MariaDB suite is present and PHP-syntax checked but **was not database-executed**. It covers Dispatcher-only counts, server pagination, recorded approvals after completion, rejection evidence/reasons, legacy evidence gaps, request-date filters, stale/invalid decisions, unauthorized roles, and two-process approval with exactly one success and one stale refusal plus a single confirmation event. Its concurrency assertions must not be reported as passed until that suite runs with verified test credentials.

## Reproduce and inspect locally

From the repository root in PowerShell:

```powershell
& C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result
node tests/run_ops_head_browser.cjs
git diff --check
```

The browser runner mocks every application API, uses local Chrome and Node built-ins, writes ignored screenshots/results into `tests/reports/`, and removes only its generated browser profile after checking its absolute path. Open `tests/trip_approvals_ui.html` as a local file to see fixture results. Add `?preview=list` or `?preview=drawer` for test-only visuals. The tests directory remains blocked through Apache.

For actual interface review, open `http://localhost/mulawin-fleetops-v2v/`, sign in as Operations Head, and hard-refresh. Select Trip Approvals and check the three categories, filters, pagination, Review/View, rejection reason, and fixed footer. Compare Trip Management and Incidents & Maintenance to verify distinct workspaces. Check the sidebar at desktop/mobile widths, then sign in as Motorpool to verify existing maintenance navigation. Use a verified isolated test instance for record-changing decisions; the development database was not used for testing.

Isolated database execution remains opt-in through `tests/README.md`: explicit dedicated `TEST_DB_USER`/`TEST_DB_PASS`, loopback host, per-run randomized database names, manifest/ownership guards, and `FLEETOPS_DB_TESTS=1` for PHPUnit Integration. Never substitute application credentials or reset development data.

## Remaining limits

- No supplied design screenshots were available; local visuals follow the written specification.
- New SQL counts/list queries and the real decision/concurrency scenarios still need the isolated MariaDB run. Mocked UI outcomes are not persistence results.
- Missing historical provenance or decision evidence is disclosed/excluded rather than inferred from operational status.
- Existing authorized read-only direct access to the maintenance pages remains as described above. Revoking it requires a separately approved backend policy change.
- Billing formulas, resource assignment, scheduling, official statuses, documents, maintenance processing, notifications, and audit-write behavior retain the existing implementation.
