# AGENTS.md — Mulawin FleetOps V2

## Mission and source of truth
Complete the actual PHP/JavaScript/MySQL/XAMPP Mulawin FleetOps application against the approved capstone objectives. Deliver understandable, role-correct, end-to-end working workflows, not disconnected dashboards, dummy buttons, invented analytics, or a cosmetic rebrand. The user's objectives in `docs/OBJECTIVES_TRACEABILITY.md` are the acceptance contract; actual code, database schema, and observed behavior determine implementation status. If they conflict, report the discrepancy.

**Working tree:** `C:\xampp\htdocs\RP_Mulawin_FMS_V2`  
**Working branch:** `luis-maintenance-ui`  
**Local app:** `http://localhost/RP_Mulawin_FMS_V2/public/index.php`  
**Existing application database:** `mulawin_v2`

This is NOT SmartLivestock. Do not introduce Django, React, Next.js, PostgreSQL or a new framework. Respect the existing PHP modules, shared JS UI helpers, CSS tokens, roles, database schema, audit and notification conventions.

## Operating mode: finish features, not perpetual audits
1. Before edits, inspect `git status`, branch, and just the affected frontend → request → PHP action/read → permissions → data tables. Note other people's uncommitted work.
2. For a requested feature, implement the smallest complete vertical slice with actual UI interactions, server-side validation, read/write, permissions, status handling, and useful errors. Do not stop at a report unless the user requests a report.
3. Do not repeat broad audits or redesign unrelated working sections. Keep a concise objective-by-objective ledger: VERIFIED / IMPLEMENTED / PARTIAL / BROKEN / MISSING / BLOCKED.
4. Deduplicate only after locating callers, role dependencies, data migration impact and ownership. Avoid removing behavior merely because it looks redundant. Prefer one authoritative record/transition and multiple role-appropriate views.
5. Never claim '100%', 'bug-free', 'predictive', or 'verified' without corresponding evidence. State exact limits and residual risk.
6. Use manual approval for every write, command or Git operation when Claude Code requests it. Never silently push, merge, reset, clean, delete records, or launch destructive migration/seeder.
7. After a bounded feature change, report: objective IDs, files, old/new flow, verification evidence, outstanding issues, next concrete slice.

## Database and secrets: critical
- `mulawin_v2` holds real preexisting records **and approved demonstration transactions**. Read-only queries are allowed for focused troubleshooting. Obtain explicit approval before any write to this database, including browser actions that change records, migration, seeding, approval, payment, attendance, or cleanup.
- Before approved schema/data changes: create a timestamped backup of `mulawin_v2` **and `storage/private`** outside Git/public, verify the backup can be restored to a disposable database, then show precise operation, impact, rollback plan. Existing demonstrations may affect reports, budgets and inventory: do not assume they are production data or delete them automatically.
- Never `DROP`, `TRUNCATE`, recreate or reset `mulawin_v2`, never run broad seeders or migrations on it without separate approval. Never leak `.env`, SMTP keys, DB credentials, account passwords, login manifests, or private documents.
- Keep authorized transactions through existing application actions and their server-side role checks. Do not hand-edit business status fields to manufacture successful workflows. Ensure multi-step writes are atomic where appropriate, idempotent or double-submit protected, audit-logged, and accompanied by clear failure states.
- `C:\xampp\fleetops_visual_test` and port 8081 are retired for implementation/review. All actual work and browser verification target the working tree / URL above. Focused temporary disposable DBs for **explicitly approved automated regression tests** are still acceptable with strict guards; never mistake 'no second visual app' for 'no tests'.

## Business ownership and integrated state transitions
**Operations:** fleet/truck documents, drivers/helpers, clients, accreditations, routes and approved rates, trip scheduling/approval, availability assignment, fuel/fund requests, checklists, dispatch, delivery, incident and rescheduling, crew attendance.

**Motorpool Custodian / Maintenance:** receive inspection/incident reports; inspect and assess; assign mechanics and attendance; repair and costs/evidence; parts request to Purchasing; completion; independent verification; release truck availability; maintenance history. Avoid duplicate repair records for the same incident. Never mark a truck available while an active blocking repair exists.

**Purchasing Officer:** receive Motorpool parts request; check/reserve/release stock; for shortages create linked PO; route approvals by configured threshold; receive deliveries, update stock movements; expose linked request/repair and payment status without granting Finance authority.

**Finance / Accounting:** approved client routes/rates and fuel PO approval as defined by the actual role model; trip fund/fuel allowance decisions and disbursement; PO approval/payment, payable obligations, budget reservations and actual spending; completed-trip billing, invoice/charges, collections, receivables aging, supporting documents. Preserve separation between approval, receipt, payment, invoice and collection; these are different events.

**Head Management / Admin:** authorized users/roles, masterlists, clients/accreditations/routes/rates and approvals, complete audit history, consolidated performance views. Do not duplicate a separate 'Head' implementation when an existing Admin/Operations Head permission path works.

Each event must have a clear initiating role, approver if needed, allowed status transitions, linked identifiers, timestamp, actor, evidence, and downstream effect. Check shared fleet availability, budget and inventory updates for double counting.

## Deliver the stated objectives, not speculative extras
The companion `docs/OBJECTIVES_TRACEABILITY.md` tracks IDs **1.1–1.11, 2.1–2.7, 3.1–3.7, 4.1–4.5, 5.1.1–5.1.4, 5.2.1–5.2.4**. Keep the existing numbering and prove each with a role-based walkthrough. Do not add unrelated workflow screens to make the system look larger. For each capability, confirm: needed data, authoritative action, access role, visible UI, cross-module links, validation and acceptance test.

**Priority order:**
- **P0 integrity and end-to-end execution:** permissions; truck/incident/repair availability; parts/request/PO/receiving/stock; approval/budget/payment; dispatch/funds; billing/collection; migration compatibility. Fix blockers first.
- **P1 complete remaining objectives:** attendance, documents, accreditation/rate approvals, rescheduling, audit, reporting; remove misleading duplicate or dead UI only after usage proof.
- **P2 analytics and UX:** reproducible descriptive/diagnostic dashboards; compact, role-based UI; useful filters, action states, loading/empty/error states; mobile responsiveness.
- **P3 experimental modeling:** predictive/prescriptive functions only if data and evaluation warrant them, otherwise present valid rule-based decision support with explicit limitations.

## UI rules
- Respect the agreed Motorpool and Purchasing separation and `docs/MULAWIN_UI_WIREFRAME_IMPLEMENTATION_SPEC.md` where present. Use existing page routes and access matrix; server authorization is mandatory even when buttons are hidden.
- Maintenance Overview: six useful clickable KPIs; immediately below them compact Quick Actions; **no Repair Workflow bar**; below use two columns: left Needs Attention then Recent Maintenance Activity, right Mechanic Status then Trucks in Repair. Keep record panels approximately 3–4 rows tall and internally scrollable, without dropping records. Keep page height reasonably compact and readable. Verify phone/tablet/desktop.
- Purchasing Overview and lists should expose who must act next, actual linked requests, POs, inventory movements and Finance status. No fake affordances. Preserve working Admin/Operations/Finance navigation while updating role-specific sidebars.
- Prefer remove/merge over adding redundant cards/tables. Every KPI must have an accurate definition, time period, source and appropriate drill-down. Never imply a button is functional unless it is.

## Analytics: scientifically honest and explainable
**Descriptive** (required): trip statuses, deliveries/incidents; repairs/downtime/costs; billing/collections/expenses; stock in/out/adjustments/value. Make date ranges, denominators, status definitions, currency treatment and data completeness visible.

**Diagnostic** (required): incidents/trip counts by driver/helper/truck/client/dispatcher (include rate/exposure, not only count); highest downtime and costs per truck with parts/labor split; receivables aging with invoice due dates, partial payments and as-of date; frequent parts by issued quantity/value and time period. Show a drill-down to source records. Explain these are associations, NOT proven causes.

**Predictive** (not in supplied numbered objectives; optional only when specifically requested): first assess amount, span and quality of historical non-demo data. Do not train a credible business forecast on six fictional trucks or seeded demo workflows. If insufficient, show 'Insufficient historical data' and record the data needed. If a demonstration using synthetic history is separately approved, label it **simulation, not validated real-world prediction**, and isolate synthetic data. Start with a transparent baseline (last value, moving average, seasonal naive where meaningful). Random Forest is an ensemble of decision trees; it may predict numerical outcomes via `RandomForestRegressor` or classes via classifier, but it is not automatically appropriate for sparse sequences. Compare with baseline using **chronological** holdouts / rolling-origin evaluation (never random train/test split for forecasting), report sample size, MAE/RMSE or relevant metrics, leakage checks, and error versus baseline. Avoid accuracy claims when the sample is too small.

**Prescriptive**: label transparent rules and constraints honestly: e.g., low stock + average usage → reorder suggestion; overdue receivable → collection priority; frequent breakdown + downtime → schedule inspection; approaching budget limit → purchasing alert. Show formula, threshold, input record, rationale, confidence/limitation and human approval; never auto-pay, auto-approve or auto-dispatch based on a model. Rule-based recommendations are useful decision support, **not automatically machine learning**.

**Regression terminology:** clarify whether someone means statistical regression (predict a number such as repair cost), or software regression testing (check that changes didn't break workflows). Do not confuse them.

## Test and acceptance policy
Feature-first does **not** mean skipping correctness. Use quick lint (`php -l`, `node --check`) on changed files, then targeted runtime/browser checks. For Finance, stock, payments, billing, permissions, migrations or cross-module state changes, run the relevant **safe isolated** regression suites and an end-to-end scenario without unapproved writes to `mulawin_v2`. Preserve audit/budget/stock invariants. Report tests actually run, passed/failed, and what remains untested. Capstone-wide regression sweep is a final release gate, not a repeated requirement after every CSS edit.

Required workflow demos (with approved data/actions):
1. Client + approved route/rate → trip → truck/crew availability → funds/fuel → checklist → dispatch → delivery + documents → billing → collection → receivables.
2. Trip incident/photo → hold → Motorpool repair/part shortage → Purchasing request/PO → authorized approval → receiving/stock release → payment → repair verification → availability/reschedule.
3. Mechanic and driver/helper attendance → assignments → history and permissions.
4. Wrong-role direct API invocation is refused; no sensitive Finance data leaks into Motorpool or Purchasing payloads.
5. Accounting money invariants: budgets, reserved/paid amounts, AP/AR balances, credit/partial payment behavior, audit links.

A module is DONE only when its required objective has a real UI, role-safe backend, valid records and transitions, cross-module effects, error handling, and recorded verification. If schema migrations are pending in `mulawin_v2`, explicitly resolve their safe release strategy with approval before dependent features can be called verified.

## Branch integration and collaboration
- Work only on the designated branch; never overwrite or cherry-pick colleagues' work blindly. Record owner/branch, dependencies, altered DB migrations and shared files (`core.js`, `Access.php`, `app.css`, DB schema) per feature.
- Before taking another branch: fetch after user approval; compare merge base and changed paths; inventory conflicting routes, roles, DB objects, API contracts and dependencies; backup `mulawin_v2`; merge **into an integration branch** rather than directly into main or rewriting history. Require user approval for merge and migrations.
- Feature commits should be narrow; separate functional code, safe migrations, demo utilities, and UI polish. Do not commit secrets, SQL backups, manifests, generated accounts or private files.
- Integration gate: lint, conflict resolution, schema compatibility, role matrix, cross-team end-to-end flows, targeted regressions, browser smoke checks. Resolve duplicate features into one authoritative flow; do not leave two dashboards both claiming ownership of a business transaction.
- GitHub remote synchronization / push / release remains explicitly user-approved. Never force push.

## Reporting and next-action format
Each work segment ends with:
- **Objective IDs and user-visible outcome**
- **Files changed and purpose**
- **Verified** (exact commands/tests/browser role and outcomes) vs **not verified**
- **Data safety** (whether `mulawin_v2` changed, with authorization)
- **Risks/blockers, including external-branch dependencies**
- **Next implementable slice** (do not propose another general audit by default)

When user asks to finish the system, work sequentially on P0 gaps, requesting only necessary approvals, and keep the objective ledger current. Do not promise perfect reliability; earn confidence with evidence.
