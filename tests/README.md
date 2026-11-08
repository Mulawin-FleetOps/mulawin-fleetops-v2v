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
| `php tests/run_crew_attendance_tests.php` | #42 Phase 2 preparation: shift boundaries (overnight, Admin hours), crew roster with helpers, helper shifts, unassigned-shift warning and bell, Phase 1 behaviour, no trip effect yet |
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

Exit code 0 = all tests passed. Details: `docs/CLAUDE_20_CLIENT_ROUTES.md`.
