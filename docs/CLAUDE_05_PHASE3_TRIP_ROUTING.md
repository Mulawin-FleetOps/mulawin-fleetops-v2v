# Checklist #5 Phase 3 — Road distance in Trip Management

Branch: `feature/claude-05-phase3-trip-routing` · Migration: `database/migrations/2026-11-07_07_trip_routing.sql`
Builds on Phase 1 + 2 (`docs/CLAUDE_05_OSM_ROUTING.md`) and Client Routes (`docs/CLAUDE_20_CLIENT_ROUTES.md`).

## What changed for the users

| Screen | Change |
| --- | --- |
| Trips > New trip (page and window) | Optional **Approved client route** list (client + truck type). Map pins + **Route option** (Recommended / Avoid toll roads / General roads only) fill in the **road km**. The km has 2 decimals. Changing the km needs a **reason**; above 15% a warning is shown. |
| Trips > Review request (Operations Head) | Same distance tools. The saved distance is kept when nothing about it changes. |
| Trips > Edit details (Operations Head) | Same. A trip that already uses an approved route keeps it even if the route is deactivated later (history). |
| Trip details | Distance source, computed / approved-route km, route reference, option, reason, and the road line on the map. |
| Client Routes | No visible change (shares the same distance code). |

Manual trip creation still works: with no route, no pins, no `ORS_API_KEY`, or when the map service does not answer,
the typed km is saved as **Manual** (with a note when the map service failed).

## Rules (server side; the browser values are never trusted alone)

One rule set for trips and client routes: `backend/Core/RouteDistance.php`.

| Input | Result (`trips.distance_source`) |
| --- | --- |
| No route option, or a point not pinned | `Manual` (typed km) |
| Pins + route option | road distance computed **again on the server** → `Map`; km different from it → `Map (edited)` + reason required |
| Approved client route chosen | route km, pins and line copied from the route → `Client Route`; km different → `Client Route (edited)` + reason |
| Map service unavailable | `Manual` + note "Automatic km was not available …" |

- A route is usable only when: route **Approved**, a current **Approved** rate exists, client **Active**, same client,
  same truck type. Dispatchers only see / use routes of their own truck-type team. Checked when the form is saved and
  again inside the save transaction.
- Reason: required for any difference of 0.01 km or more, max 300 characters. Warning above 15% (`RouteDistance::OVERRIDE_WARNING_RATIO`).
- Map calls are made **before** the database transaction (no lock held while the map service answers); cache, daily guard
  and per-user limit from Phase 1 + 2 still apply.
- `Routes.selectable` (new) returns route data for the trip form **without route rates** (pricing stays with Billing).

## Billing — NOT changed

The billing draft is still `max(trips.distance_km × client_rates.rate_per_km, minimum_charge)`. An approved route only
supplies the **km** (and the pins / line). Its flat or per-km route rate is **not** used yet — see the open questions.

## Database (additive only)

`trips`: `distance_source` (default `Manual` → every existing trip becomes Manual), `route_option`, `distance_computed_km`,
`distance_provider`, `distance_computed_at`, `distance_override_reason`, `client_route_id` (FK to `client_routes`), with CHECK
constraints. New table `trip_routes (trip_id, geometry)` for the road line (kept apart so trip lists stay small).
Fresh install: already in `database/extension.sql` (and marked applied in `schema_migrations`).

## Install / upgrade

### XAMPP (local)
1. Back up the database (phpMyAdmin > Export, or Admin > Backup).
2. `git pull` the branch (or copy the files).
3. phpMyAdmin > your database > Import `database/migrations/2026-11-07_07_trip_routing.sql` **once**.
4. Optional: put `ORS_API_KEY=...` in `.env` (without it everything works with typed km).
5. Run the tests (disposable `_test` databases only):
   ```
   set TEST_DB_USER=root
   set TEST_DB_PASS=
   C:\xampp\php\php.exe tests\run_trip_routing_tests.php
   C:\xampp\php\php.exe tests\run_map_tests.php
   C:\xampp\php\php.exe tests\run_route_tests.php
   ```

### Hostinger (only after approval and merge; not part of this PR)
1. Admin > Backup > Create backup and download it.
2. Upload the changed files (list in the PR).
3. hPanel > phpMyAdmin > database > Import the migration file once.
4. Hard-refresh the browser (Ctrl+F5) so the new `map.js` / `trips.js` load.

### Manual test steps (both)
1. Operations Head > Trips > New trip: choose client + Wing Van. If the client has an approved Wing Van route, pick it →
   pickup / delivery / km fill in, route option is locked. Change km → reason field appears; > 15% → warning. Save → trip
   details show "Client Route (edited)", the route reference and the reason.
2. New trip without a route: click the map twice (pickup, destination) → km fills in; change the route option → km changes.
   Save → details show "Map" and the road line.
3. Without `ORS_API_KEY`: the screen says "Type the km"; typed km saves as Manual.
4. Dispatcher: New request (own truck type only); Operations Head > Review → choose a route or keep the km → Confirm.
5. Edit details of a trip without touching the distance → the distance stays the same (same "computed at" time).
6. Regression: fund request → pre-dispatch checklist → dispatch → billing draft = km × client rate per km →
   complete (still needs waybill, AR and **DR** files).

## Partially failed migration

Check:
```sql
SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id='2026-11-07_07_trip_routing') AS tracked,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='trip_routes') AS table_found,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='trips'
     AND column_name IN ('distance_source','route_option','distance_computed_km','distance_provider','distance_computed_at','distance_override_reason','client_route_id')) AS columns_found;
```
Complete = `1, 1, 7`. Anything else (e.g. `1, 0, 7`): run the cleanup below, then import the file again.
```sql
DROP TABLE IF EXISTS trip_routes;
ALTER TABLE trips DROP FOREIGN KEY IF EXISTS fk_trip_client_route;
ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_trip_distance_source, DROP CONSTRAINT IF EXISTS chk_trip_route_option, DROP CONSTRAINT IF EXISTS chk_trip_computed_km;
ALTER TABLE trips DROP COLUMN IF EXISTS distance_source, DROP COLUMN IF EXISTS route_option, DROP COLUMN IF EXISTS distance_computed_km,
  DROP COLUMN IF EXISTS distance_provider, DROP COLUMN IF EXISTS distance_computed_at, DROP COLUMN IF EXISTS distance_override_reason, DROP COLUMN IF EXISTS client_route_id;
DELETE FROM schema_migrations WHERE id='2026-11-07_07_trip_routing';
```
(Tested in `tests/trip_routing_tests.php` section L: the recovered database equals a fresh install.)

## Rollback

- Code: revert the PR merge commit (`git revert -m 1 <merge sha>`). The old code ignores the new columns, so the
  database can stay as it is.
- Database (only if really needed; **loses** the distance source / reason / route link / road lines of trips saved after
  the upgrade — the billable `distance_km` itself stays): run the cleanup SQL above. Back up first.

## Tests

`tests/run_trip_routing_tests.php` (new, 90+ checks, fake map service): automatic distance, 3 options, override reason and
15% warning, browser values ignored, Manual fallback (no option, no pins, service down, not configured), approved-route
eligibility (other client, other truck type, pending / inactive route, no approved rate, inactive client, deleted id),
review and edit (unchanged distance kept, deactivated route kept, switch to manual), invalid inputs, roles, screen
settings, trip workflow regression (assignment, dispatch, billing draft per km, DR requirement), migration recovery.
Also run `tests/run_map_tests.php` and `tests/run_route_tests.php`.

## Limitations

- No live openrouteservice call was made (the sandbox blocks it); tests use a fake service and a local mock server.
  Check one real trip in XAMPP with a real key before going live.
- OpenStreetMap tiles were not visible in the sandbox browser test (blocked network); the map logic still worked.
- The route line is a display aid; the billable km is what is saved and billed.
- Batch planning / scheduling is not part of this phase.

## Open business-policy questions

1. **Approved-route billing**: today billing uses km × client rate per km even when an approved route (with its own flat or
   per-km route rate) is chosen. Options: A) keep this (current); B) bill the route rate (flat or per km) with a snapshot
   on the trip — needs approval and a BillingDraft change; C) require an approved route for every trip of clients that have one.
2. **Toll roads**: default option is Recommended (toll roads allowed). Confirm the company policy, and whether toll fees are
   charged to the client.
3. **Which km is billed** when the computed km and the contract km differ (current: the km in the form, with a reason).
4. Upgraded databases: migrations 05 / 06 (account security) have no tracker row of their own; a small tracker migration is
   suggested (separate PR, owner: account-security work).
