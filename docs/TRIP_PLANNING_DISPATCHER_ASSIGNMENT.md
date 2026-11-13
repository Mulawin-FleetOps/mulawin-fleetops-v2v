# Operations Head Trip Planning: manual Dispatcher assignment

Implemented locally on November 10, 2026 in `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. Repository root, branch, dirty working tree, parent/repository instructions, planner, account model, creation APIs, route approval, resource services, and tests were inspected before edits. Existing uncommitted work was preserved. No commit, push, merge, deployment, or remote change was performed.

## Audit and minimal implementation

The approved New Trip interface is implemented by `OpsHead.planner` in `ops-head.js`; the older shared `TripUI.newPage` is not its active renderer. The planner already stores independent entries and expands each quantity into individual rows before calling `Trips.create_batch`. Each row already has its own request key, trip ID/reference, lifecycle, and resource holds. The existing combined submission limit is 20 individual trips.

Users already have two Dispatcher authentication roles and a nullable `users.shift` of Day/Night. Existing Admin account rules allow one active account per role/shift slot. Trips already have `dispatcher_role`, but no planning shift. `dispatcher_id` records the account that confirmed dispatch and must not be repurposed as initial ownership. No persistent parent planning-entry or quantity table is required: generated records inherit their entry values through the existing batch payload.

The implementation therefore adds one nullable `trips.dispatcher_shift`, reuses `dispatcher_role`, extends the existing trip scope and action checks, and adds one dropdown to each approved entry card. No new authentication role, account, table, ownership switcher, or handover process was introduced.

## Completed form changes

- The title remains **New Trip**, with **Create and schedule one or multiple trips.** Existing sidebar, header, collapsible entry cards, form components, colors, spacing, approved routes, instructions, Add Another Trip Entry, review, retries, and quantity stepper remain.
- **Number of Trips** is now **Number of Required Trucks**. The internal `quantity` field and 1–20 combined generation limit remain unchanged.
- **Assign Dispatcher** is required, single-select, and placed beside quantity in the existing two-column grid. The schedule occupies the preceding full-width row. Fields stack on mobile using the existing responsive classes. No new stylesheet or visual theme was needed.
- Container and Wing Van offer exactly Container / Wing Van Dispatcher (Day) and (Night). Car Carrier offers exactly Car Carrier Dispatcher (Day) and (Night). The initial placeholder is `Choose dispatcher...`; no shift is selected automatically.
- Changing to an incompatible truck type clears the Dispatcher selection and reloads compatible approved routes. Container-to-Wing Van retains a still-compatible Dispatcher selection while clearing/reloading the route. Client changes clear/reload the route without changing the compatible Dispatcher. Schedule changes never modify ownership.
- Missing Dispatcher selection shows inline validation, opens the affected card, and blocks review. All other existing form validations remain.
- Planning Summary shows planning-entry count, total required trucks, and individual records to create without double-counting. Each review section shows its selected group and shift before confirmation. Accordion headers retain the compact client/type/schedule/quantity summary.

## Assignment, generation, and authorization

The form sends one encoded selection per expanded row, for example `container_wingvan_dispatcher:Night`. The server validates the exact supported shift and matching group, then stores the role and shift separately. It never accepts multiple selections or infers a shift from `scheduled_at`.

Operations Head single creation and batch preflight both require the manual selection and an approved route for the specified client/truck type. This closes the old direct-creation manual-distance fallback for new Operations Head plans, matching the planner's existing approved-route requirement. Existing route request, Billing/approval, trip editing, and Dispatcher request workflows remain in their existing services. No new date/time restriction was added.

Quantity 3 still becomes three independent calls through the existing row-based creation service. Client, type, approved route, schedule, instructions, role, and shift are copied to each row; request keys and resulting trip IDs/references remain distinct. Selection does not copy a vehicle or crew into those rows. The existing automatic assignment service still runs independently for each created trip, using its existing eligibility checks and unique resource holds. Insufficient resources still yield Awaiting Resources.

The original `dispatcher_id` remains unset until dispatch confirmation. Planning ownership is the authenticated account category (`role` + `shift`), rather than the ID of whichever account happens to occupy that category today. Account replacement within an authorized role/shift slot does not lose the queued work.

Trip retrieval and direct actions require both matching operational group and matching explicit planning shift. Creator ownership cannot bypass that check. Scope also reaches trip-linked fund reads/submission, document reads/uploads/downloads, client trip projections, current-trip references in master lists, and linked signatures through the existing central scope helper. No Dispatcher sidebar, attendance page, or incident form was redesigned.

Trip notifications now target the selected role/shift while preserving non-Dispatcher recipients. Four Maintenance notification call sites use that helper to prevent incident/repair notifications from broadcasting a planned trip to the opposite shift. Maintenance assessment/repair/clearance rules and permissions are unchanged. Finance changes are limited to selecting the shift in fund details so the existing authorization helper can enforce it; approval, amounts, revisions, and release remain unchanged.

The stored shift persists through scheduling, resource retries, rescheduling, dispatch, incidents, completion, and arrival. No clock-based handover occurs. Existing trips with NULL planning shift retain their prior group-wide access. Dispatcher-originated requests continue their existing group-wide approval workflow; this task changes Operations Head New Trip planning. No historical backfill or default assignment was performed.

Already-created request keys are reconciled before new-entry validation. An uncertain submission made before this update can retrieve the original result even if its old payload lacks the new selection or its schedule has since elapsed. Such a retry cannot change the existing trip's ownership or create it twice. New unsaved rows still require the new valid fields.

## Database impact

`2026-11-10_10_trip_dispatcher_shift.sql` was applied to the verified local loopback `mulawin_v2` database. It adds the nullable shift column, a Day/Night + Dispatcher-role check, and a role/shift/status index; its schema marker is inserted last. `database/extension.sql` includes the same definition for fresh installs.

The migration uses an information-schema check and a prepared ALTER only when the column is absent. Reimport after installation was executed using the same statement splitting as the test importer and verified as a no-op. No existing tables or records were dropped, truncated, replaced, or seeded. Existing trip values were compared before/after; no backfill occurred. The local database currently has zero trips and zero Dispatcher attendance sessions, so this is not evidence of migration against a populated historical trip dataset. Historical preservation scenarios remain in the isolated test work.

Other installations must apply this migration before using the updated queries. Do not remove the column after real shift assignments have been recorded without preserving that ownership data.

## Files modified for this task

The checkout already had extensive local edits. This inventory describes this task's additions to those files, not the entire Git diff against HEAD.

| File | Purpose |
| --- | --- |
| `public/assets/js/modules/operations/ops-head.js` | Approved form additions, filtering, validation, summary/review inheritance, stored shift in existing details |
| `public/assets/js/modules/operations/trips.js` | Display a stored planning shift in existing trip details; one conditional row |
| `backend/Core/DispatcherPlanning.php` (new) | Pure manual group/shift validation |
| `backend/Core/DispatcherScope.php` | Shift-aware SQL and direct-record policy; NULL compatibility |
| `backend/Core/DispatcherResources.php` | Pass stored ownership through the internal automatic-assignment context; no resource rule changes |
| `backend/Core/Notify.php` | Trip-specific notification recipient filtering |
| `backend/Core/SignatureAccess.php` | Apply the same trip ownership to linked fund/incident signatures |
| `backend/Modules/Operations/Trips.php` | Creation/preflight validation, persistence/audit, duplicate reconciliation, direct action checks, scoped notifications |
| `backend/Modules/Accounting/Funds.php` | Include shift in the fund-detail authorization projection |
| `backend/Modules/Maintenance/Maintenance.php` | Four notification calls only; use shift-aware recipients |
| `database/migrations/2026-11-10_10_trip_dispatcher_shift.sql` (new) | Additive upgrade |
| `database/extension.sql` | Equivalent fresh-install definition and marker |
| `tests/Unit/DispatcherPlanningTest.php` (new) | Selection matrix, invalid choices, fixed ownership, legacy compatibility |
| `tests/ops_head_ui.html` | Mocked filtering/manual selection/inheritance/validation/retry scenarios and planner previews |
| `tests/run_ops_head_browser.cjs` | Desktop/tablet/review captures and adjacent-field/mobile checks |
| `tests/planning_dispatcher_tests.php` (new) | Guarded isolated DB scenarios |
| `tests/run_planning_dispatcher_tests.php` (new) | Existing ownership-guarded disposable DB launcher integration |
| `tests/README.md` | Current verification commands and limits |
| `docs/TRIP_PLANNING_DISPATCHER_ASSIGNMENT.md` | This report |

Composer files, PHPUnit configuration, EnvironmentTest, existing shared test launchers, and prior unrelated edits were preserved. No account configuration or operational records were changed.

## Actual verification

| Command/check | Result |
| --- | --- |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --do-not-cache-result` | **371 tests, 487 assertions passed** |
| `node tests/run_ops_head_browser.cjs` | **359 mocked browser checks passed**: Operations 25, Operations Head 84, Trip Approvals 49, Dispatcher 201 |
| Same Chrome runner | **51 responsive layout checks passed**, including new 1440px planner, 820px planner, and 390px review; quantity/Dispatcher adjacency and mobile stacking checked |
| Same Chrome runner | Five native filter keyboard/focus checks and reduced-motion check passed |
| `C:\xampp\php\php.exe vendor/phpunit/phpunit/phpunit --testsuite Integration --do-not-cache-result` | **15 skipped, 0 assertions**; no isolated credentials/opt-in |
| PHP lint on all changed PHP files and new test files | No syntax errors |
| `node --check` on ops-head.js, trips.js, and run_ops_head_browser.cjs | Passed |
| `git diff --check` | Passed |

Mocked browser checks cover compatible options, no initial shift, schedule independence, clearing incompatible choices/routes, per-entry independence, required selection feedback, summary counts, inherited assignments, no copied crew, distinct request keys, double-click protection, per-trip overrides, partial results, uncertain-response recovery, and existing role screens. New populated previews display three entries requiring 3 + 2 + 4 trucks and nine review drafts. Desktop planner, mobile planner, and mobile review screenshots were visually inspected in ignored `tests/reports/`.

Read-only PHP service smoke checks against existing local Operations Head and Container/Wing Van Day account records returned no section-query errors for Operations Head trips, Dispatcher trips, master lists, funds, or documents. There are no local trips, so this verifies query compatibility, not populated shift retrieval or real assignment. No authenticated HTTP workflow or real trip creation was performed.

The isolated DB suite is written and syntax-checked but **not executed**. It covers nine generated records and inherited ownership, scoped retrieval/actions, wrong/missing assignments, client/type route mismatch, unapproved routes, batch preflight, legacy compatibility, duplicate recovery, fund/document/signature isolation, notification recipients, and repeated migration. The full legacy DB suite is likewise unverified. Existing legacy Operations Head creation fixtures must supply the newly required manual assignment and approved route; older automatic-assignment fixtures also need the session/permanent-link prerequisites described in the previous workflow report. Do not weaken production rules or run fixtures on development records to satisfy old expectations.

## Limitations and manual verification

- The live account audit found only one active Container/Wing Van Day account. The four approved categories remain selectable because they represent responsibility slots, not a user-account dropdown. Plans for an unstaffed category remain assigned to it until an authorized account occupies that slot. This implementation does not create accounts or silently redirect them to another shift.
- No verified handover mechanism exists. Ownership stays at the selected role/shift; this task adds no reassignment endpoint, automatic shift change, or broad Admin bypass. An authorized handover policy/workflow is a separate unresolved requirement.
- Legacy NULL-shift trips and Dispatcher-originated requests retain group-wide behavior. They are not silently assigned to a new category. Broader retrospective ownership assignment and changes to approval-page assignment are outside this New Trip task.
- Database mutation/concurrency tests and complete lifecycle/other-role integration still require dedicated isolated credentials. Safe tests and mocked UI checks do not establish those results.

For manual read-only review, sign in as Operations Head, open Trip Planning, and verify the unchanged New Trip layout, placeholder, compatible options, and current account configuration. Do not submit sample operational records to the development database.

For mutation checks, use the guarded disposable suite or a separately verified isolated copy:

1. Prepare Wing Van Day quantity 3, Container Night quantity 2, and Car Carrier Day quantity 4. Review shows three entries/nine records and each selected responsibility. Schedule an 8 AM Night assignment and an 8 PM Day assignment; verify both remain manually selected and pass the ordinary schedule rules.
2. Change a truck type across groups; verify ownership and incompatible routes clear. Change only the schedule/client; verify the compatible manual ownership remains and routes follow their actual client/type. Attempt review without ownership; verify inline feedback.
3. Submit once, retry original keys, and inspect distinct IDs/references, inherited values, persisted role/shift, and independent resource allocation. No two active generated trips may hold the same truck/person. Insufficient resources must remain Awaiting Resources.
4. Use matching Day/Night Dispatcher accounts to verify new-record retrieval and direct action access. Try opposite-shift details, assignment, funds, documents, and signature access by record ID; expect refusal or omitted listing. Verify legacy NULL-shift trips remain group-visible.
5. Continue one generated trip through existing preparation/dispatch/incident/completion/arrival processing. Verify stored planning shift remains fixed, `dispatcher_id` records the actual dispatch actor, and notifications reach the correct responsibility while Operations Head/Maintenance/Finance retain their existing authorized tasks.
6. Run `run_planning_dispatcher_tests.php` only through the documented dedicated test credentials and ownership guards, or enable the opt-in PHPUnit Integration suite. Record actual failures/skips honestly; never use the application's DB credentials as a substitute.
