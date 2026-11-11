# tests/

Automated tests. This folder is blocked from the web by the root `.htaccess`.

## Suites

| Command | What |
| --- | --- |
| `php tests/run_route_tests.php` | Client Routes (Checklist #20) and the whole migration chain (base schema + every migration = fresh install) |
| `php tests/run_map_tests.php` | OpenStreetMap / road distance (Checklist #5). No real call to openrouteservice (fake transport + local mock server `tests/_mock_ors.php`) |
| `php tests/run_trip_routing_tests.php` | Road distance in Trip Management (Checklist #5 Phase 3): approved client routes, overrides, Manual fallback, trip workflow regression. Fake map service only |
| `php tests/run_trip_schedule_tests.php` | Trip schedule restrictions (Checklist #38/#40): checklist and Confirm Dispatch windows, Admin settings, date rollover, Asia/Manila, reschedule, workflow regression |
| `php tests/run_fund_release_tests.php` | Cash-only trip fund release (#36) and Trip Fund tabs (#37): API refusals, server date, double click, two Finance users at once (two processes), release window, closed trips, nothing written by failures |
| `php tests/run_mechanic_attendance_tests.php` | Dispatcher-only account shifts, mechanic masterlist without shift, Time In / Time Out, availability, assignment, migration and rollback |
| `php tests/run_maintenance_overview_tests.php` | Maintenance Overview: page rights, counts at every repair step, parts follow-up, trip incident flow, counts = Repair Management records, recent activity, read-only |
| `php tests/run_motorpool_workspace_tests.php` | Motorpool workspace (Parts Requests + Mechanic Attendance pages) through the real `Actions::pageData` / `Actions::run` (child process per user): access per role, no cost / stock / budget / supplier / PO data in the Motorpool payload, request create / release / Not Available / cancel, notification pages, attendance board, daily mark Admin-only, date range clamp, Time In / Time Out refusals, read-only |
| `php tests/run_job_helpers_tests.php` | More than one mechanic per repair (migration 12): behaviour before the migration (clear refusal, existing flows unchanged), migration = fresh install with no row changed, add / remove assisting mechanics (roles, timed-in, busy, duplicates, all-or-nothing), busy for Time Out / deactivation / lead assignment, release on completion and cancellation, history, events and audit. Databases: `mulawin_jh_fresh_test`, `mulawin_jh_reference_test` |
| `php tests/run_purchasing_finance_tests.php` | Purchasing -> Finance money integrity: PO create -> approve -> partial receive -> pay -> close with the budget reserved/spent invariant; closed-unreceived PO leaves the payables (G5); expired budget period (G7); budget renewal carries open POs and their reserve (G8); PO history, part history and their role refusals. Database: `mulawin_pf_fresh_test` |
| `php tests/run_accounting_workspace_tests.php` | Finance / Billing / Audit workspace reads: Billing through verify -> finalize -> collect (Overview, Collections, Receivables figures = sums of stored invoices; overdue and aging buckets), Finance Overview = Payables & Payments rows, page payloads, Audit Logs / Transaction History / Reports (types, field changes, counts), role refusals through the real dispatcher for every new page, reads write nothing. Database: `mulawin_acct_fresh_test` |
| `php tests/workspace_access_tests.php` | No database. Page map per role (Motorpool / Purchasing workspaces), menu order, every page has a module and a screen, source checks of the scoped reads |
| `php tests/run_phase2_migration_safety_tests.php` | Phase 2 migrations: record is the last step, partial-failure states, recovery files, nothing legacy changed, fresh-install order |
| `php tests/run_crew_attendance_tests.php` | Daily attendance without shifts: roster of every active driver/helper/mechanic, marking, history, masterlist without shift, daily bell, migration of legacy shift-based marks and rollback |
| `php tests/run_crew_dispatch_tests.php` | #42 Phase 2 enforcement: Warn/Enforce + guard, Present/Absent/Not Yet Marked/shift mismatch at dispatch, overnight dates, cross-shift early dispatch, shift-aware auto-assign and fallback, Absent notice, redispatch, two-process concurrency |
| `php tests/run_trip_documents_tests.php` | #44 Diesel PO / Supplier SOA attachments: upload, file checks, nothing left on failure, roles and statuses, required completion documents unchanged, Finance view/download rights |
| `php tests/run_trip_batch_tests.php` | Batch trip planning: separate trips, Awaiting Resources, all-or-nothing validation, duplicate sends (incl. two processes), limits, dispatcher requests, approved routes, existing trips untouched, normal dispatch afterwards |
| `php tests/run_billing_adjustment_tests.php` | Billing Rate Approval: migration (marker last, failed / partial / repeated import + recovery file, old charges grandfathered, totals unchanged, fresh = upgrade), Pending until Admin approval, no self-approval, discounts / increases, atomic change and removal, withdraw, total stays above zero, DR in verification, finalize blocked while pending, invoiced / paid untouched, DB constraints, only the requester withdraws, two-process races (request / approval / finalize), trip operations unaffected |
| `php tests/run_account_security_tests.php` | Current-password lock: wrong current password in password / email change counts toward the login lock (5 = 15 minutes), shared counter, atomic and serialized (stale rows, two processes), locked account refused even with the right password or code, notice to the previous email address (masked, no code / link), mail failure keeps the change. Local SMTP receiver only. |
| `TEST_BASE_URL=... php tests/run_htaccess_tests.php` | Web exposure (read-only GET, no database): `.git`, `.env` and other dot-paths, private folders, backups and docs are not served; app, API and assets still work. `TEST_LAYOUT=public` when the document root is `public/`. Run after every deployment. |

Both need `TEST_DB_USER` / `TEST_DB_PASS` (see below). The shared launcher is `tests/_launcher.php`.

## Client Routes (Checklist #20)

```
TEST_DB_USER=<mysql user> TEST_DB_PASS=<password> php tests/run_route_tests.php
```

Windows / XAMPP:

```
set TEST_DB_USER=root
set TEST_DB_PASS=
C:\xampp\php\php.exe tests\run_route_tests.php
```

Safety rules:

- The project `.env` is never read. The launcher copies the code to a temporary folder with its own test `.env`.
- Only databases ending in `_test` are created or dropped (`<prefix>_fresh_test`, `<prefix>_upgrade_test`,
  `<prefix>_partial_test`; prefix `mulawin_routes`, change it with `TEST_DB_PREFIX`).
- The run stops when a name does not end in `_test` or equals `DB_NAME` of the project `.env`.
- `tests/route_tests.php` refuses to run on its own (it only runs inside the temporary copy).
- The base schema for the migration checks is read from git as `<commit>~1` (quoted). `^` is not used: on Windows
  `cmd.exe` drops an unquoted `^`, which loaded the schema AFTER the migration and broke the upgrade checks.

Exit code 0 = all tests passed. Details: `docs/CLAUDE_20_CLIENT_ROUTES.md`.
