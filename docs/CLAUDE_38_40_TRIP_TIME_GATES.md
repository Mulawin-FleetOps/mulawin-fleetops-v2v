# Checklist #38 / #40 — Trip schedule restrictions (time gates)

Branch: `feature/claude-38-40-trip-time-gates` · Marker: `CHECKLIST_38_40_TRIP_TIME_GATES_V1` · **No database migration.**

Checklist text: *"hindi dapat nakakapag report, checklist or any action hanggat wala pa sa schedule"* (#38) and
*"… pati confirm dispatch ay naka disable … pwede i-set ng admin yung hours/time"* (#40).

## Rule

Planning and approval stay allowed any time; **execution** waits for the trip's **current** schedule
(Philippine time, server clock). Counted in hours/minutes, not dates.

| Action | When | Where enforced |
| --- | --- | --- |
| Create, review, edit before dispatch (#27), assignment, cancel | any time | unchanged |
| Fund request submit / revise, Operations Head approval | any time (planning) | unchanged |
| Reschedule after an incident (new schedule) | any time | unchanged |
| **Fund release** | from `fund_release_lead_hours` (default **2 h**) before | `Funds.php` — #40 phase 1, unchanged |
| **Pre-dispatch checklist** (open **and** submit) | from `checklist_lead_hours` (default **2 h**) before | `Trips::checklistStart`, `Trips::checklist` |
| **Confirm Dispatch / Redispatch** | from `dispatch_early_minutes` (default **15 min**) before | `Trips::dispatchBlockers` (checked under the row lock in `Trips::dispatch`) |
| Incident report, resume, completion, arrival checklist | after dispatch | already status-gated; dispatch is now time-gated |

- **Late dispatch** (after the schedule) is allowed; the trip history and the result say e.g. "Dispatched 1 h 30 min after the scheduled time".
- **Schedule changed after the checklist** (trip already Ready for Dispatch): no new checklist; Confirm Dispatch follows the new time.
- A checklist opened inside the window is refused on submit if the schedule was moved later (re-checked on submit).
- **Second attempt**: the windows follow the new schedule set at reschedule (or by a later edit).
- 12:30 AM trip: checklist opens 10:30 PM the evening before; Confirm Dispatch at 12:15 AM.

## Admin settings (Administration > Settings; stored in `app_settings`, no migration)

| Key | Label | Default | Range |
| --- | --- | --- | --- |
| `checklist_lead_hours` | Enable pre-dispatch checklist before dispatch | 2 hours | 0–24 (0 = only at the scheduled time) |
| `dispatch_early_minutes` | Allow Confirm Dispatch before the scheduled time | 15 minutes | 0–240 (0 = only at the scheduled time) |

Note: with checklist window 0 and dispatch allowance 15, the effective earliest dispatch is the scheduled time plus the
checklist duration (Confirm Dispatch still needs Ready for Dispatch).

## Screen

Trip details: under **Schedule**, "Pre-dispatch checklist from … · Confirm Dispatch from … (Philippine time)" and a red note
when the schedule has passed. The **Pre-dispatch checklist** button is disabled with "Pre-dispatch checklist opens …"; the
**Confirm Dispatch** reasons include "Scheduled dispatch is …; Confirm Dispatch opens …". The server refuses the same
actions (HTTP 409) if called directly.

## Files

| File | Change |
| --- | --- |
| `backend/Modules/Operations/Trips.php` | `timeGates()`, checklist window (open + submit), dispatch window in `dispatchBlockers()`, late note, `time_gates` in details |
| `backend/Core/Settings.php` | 2 new settings (added next to #40; the #42 attendance lines are untouched) |
| `public/assets/js/modules/operations/trips.js` | disabled checklist button + reason, windows under Schedule |
| `tests/trip_schedule_tests.php`, `tests/run_trip_schedule_tests.php` | new suite (70 checks) |
| `tests/route_tests.php`, `tests/trip_routing_tests.php` | workflow tests now set the departure 5 minutes ahead before Confirm Dispatch |

Not touched: Fleet, Mechanics, Attendance, FleetState, auto-assignment / availability, Funds.

## Install / test

1. Copy the files (or `git pull` after merge). No SQL to import.
2. Optional: Administration > Settings > adjust the two new values.
3. Tests (disposable `_test` databases):
   ```
   php tests/run_trip_schedule_tests.php
   php tests/run_trip_routing_tests.php
   php tests/run_route_tests.php
   php tests/run_map_tests.php
   ```
4. Manual (XAMPP): create a trip for tomorrow → dispatcher sees the checklist disabled with the opening time; fund request and
   approval still work; set a trip ~1 hour ahead → checklist works, Confirm Dispatch still disabled until 15 minutes before.

## Rollback

Revert the merge commit. The two settings rows (if saved by the Admin) can stay in `app_settings`; old code ignores them.
