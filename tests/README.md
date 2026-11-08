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
