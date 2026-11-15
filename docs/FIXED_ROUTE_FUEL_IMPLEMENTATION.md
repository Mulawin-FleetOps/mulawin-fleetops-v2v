# Fixed route and fuel pricing — local implementation

Implemented on `kenneth`, starting at `d8a4d95`, with a clean working tree.
No operational database connection, migration, invoice correction, commit, push,
service restart or deployment was performed for this change.

Existing route request/approval transactions, rate versions, approved-route
planning, batch planning, maps, account responsibility/turnover, attendance,
resource assignment, inspections, funds, maintenance, billing status transitions,
adjustment approvals, collections and payment allocations remain in use.

## Behavior

- New complete client profiles become Active after accreditation. Legacy client
  rate writes are retired. Existing `client_rates` rows are retained read-only;
  old Pending Rate clients require an explicit accreditation-based activation.
- Only `admin` (Head Management) enters/revises contractual route rates and
  approves them, including its own entry. Pending revisions leave the previous
  approved version effective. Billing cannot change the contract rate.
- Pricing navigation reuses Route Rates and adds one Fuel Adjustment page using
  Settings. Diesel prices, per-truck efficiency and the verified garage are
  append-only, effective-dated records with actor/reference history. No example
  production price, efficiency or financial garage coordinate is seeded.
- A past effective date requires explicit confirmation against a referenced
  historical source. Existing versions cannot be overwritten. Previous effective
  values remain applicable until another takes effect; Tuesday is guidance.
- Fuel uses only garage-to-pickup plus pickup-to-delivery road kilometers through
  existing Routing. No return leg, straight-line fallback or fuel override exists.
  Provisional map coordinates remain preview-only until a verified garage is set.
- Dispatch stores rate ID/version, settings IDs/values, route/pin/option and road
  distance snapshots. Diesel and efficiency use the actual Manila dispatch date.
  Money is calculated with MariaDB DECIMAL; the modal's editable price remains
  the fixed contract amount, with read-only server-calculated fuel information.
- Missing inputs leave fuel/complete total NULL, permit dispatch/completion, and
  block invoice finalization server-side. The stored legacy base field holds the
  fixed amount provisionally, explicitly labelled as fuel pending. A missing
  migration is a separate installation blocker, not missing business input.
- Redispatch reuses the first billing snapshot and never adds a second fuel line.
  Existing legacy bills retain their original monetary values.
- Pricing Impact in Billing pages through every billing record (200 per page).
  Its proposal includes existing/proposed amounts, missing inputs, source snapshot
  and a fingerprint. Head Management can explicitly apply a verified proposal to
  an unpaid, unissued open record with a reason; the action locks and audits it.
  Issued/paid/cancelled records are preview-only. No correction is posted for them.
- Bills without historical dispatch snapshots are marked unreconciled. Missing
  old road distances cannot be inferred using today's routing. Same-day missing
  road inputs can be resolved through the original stored pins and reviewed again.

## Exact file inventory

Backend:
`backend/Core/Access.php`, `BillingDraft.php`, `RouteDistance.php`, `Settings.php`,
`TripPricing.php` (new);
`backend/Modules/Accounting/Billing.php`,
`backend/Modules/Administration/Admin.php`,
`backend/Modules/Operations/Clients.php`, `Routes.php`, `Trips.php`.

Frontend:
`public/assets/js/modules/accounting/billing.js`,
`public/assets/js/modules/administration/admin.js`,
`public/assets/js/modules/operations/clients.js`, `dispatcher.js`, `routes.js`,
`trips.js`.

Schema:
`database/extension.sql`,
`database/migrations/2026-11-13_13_fixed_route_fuel.sql` (new).
Migration 13 creates only `pricing_settings_history` and `billing_pricing` plus
its marker. It does not backfill, drop, rewrite or reprice historical records.
Migrations 11 and 12 retain their approved hashes.

Verification:
`tests/Unit/RouteSafetyTest.php`, `PricingAuthorizationTest.php` (new),
`tests/planning_account_tests.php`, `turnover_tests.php`,
`run_ops_head_browser.cjs`, `pricing_tests.php` (new), `pricing_ui.html` (new),
`run_pricing_server.ps1` (new), `run_pricing_tests.php` (new).
This document is the remaining changed file. Existing isolation launchers and
operational-target protections were not weakened.

## Executed verification

- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/run_pricing_server.ps1`:
  **29 checks passed** on independently initialized MariaDB 10.4.32, including
  fresh/upgrade parity and repeated migration 13. Real service actions cover
  registration, route request, Head Management entry/approval/revision, planning,
  resource assignment, dispatch snapshot, turnover, completion, verification,
  adjustment approval, invoice finalization and collection. Checklist and released
  fund prerequisites are isolated fixtures; routing uses the existing test transport.
  Negative checks cover unauthorized edits, unverified historical settings/garage,
  stale recalculation, missing fuel, paid protection and unreconciled legacy bills.
- Existing guarded turnover server: **247 checks passed**, including selected-trip
  concurrency, account guards, attendance/resource protection and HTTP authorization.
  Upgrade parity now includes migration 13; planning no longer seeds legacy rates.
- Focused PHPUnit: **51 tests / 210 assertions passed** for pricing authorization,
  navigation, route safety, dispatcher planning/workflow, turnover and licensing.
- `run_ops_head_browser.cjs --pricing-only`: **9 assertions passed** in local Chrome
  using database-free mocked responses: fixed-rate modal, read-only fuel fields,
  backend estimate, fixed-only submission, settings, history and paid report controls.
- Changed PHP/JavaScript syntax and `git diff --check` passed.

Initial rehearsal failures were corrected: PHP SQL quoting, missing required
synthetic fund/trip fields, and fixture action/table names. The final runs above
passed. Browser process creation required sandbox escalation; the run then passed.
No live authenticated pricing/browser-to-operational-database check is claimed.

## Activation and reconciliation boundaries

Not yet activated: migration 13 must be separately authorized, backed up,
installed and verified after existing prerequisites. Head Management must supply
verified garage coordinates, effective diesel and all three truck efficiencies.
No financial source is fabricated to make the first dispatch invoice-ready.

Operational historical billings were not queried, so no real reconciliation count
or correction amount is claimed. Run the read-only Pricing Impact report after
installation. Records lacking dispatch evidence remain blocked for recalculation;
issued/paid invoice corrections require a separately reviewed accounting decision.
