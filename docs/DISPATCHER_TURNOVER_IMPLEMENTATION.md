# Dispatcher turnover, attendance and resource workflow

## Required schema for other checkouts

Before using this code, other developers must back up their own database, verify
prerequisites and install migration 11 followed by migration 12, validating each
stage before proceeding. File existence or a migration marker alone does not
prove a partially installed schema is correct. This Git release performs no
database migration or account backfill.

Approved SHA256 values:
- `2026-11-11_11_operations_v43.sql`: `976b06778e9863bafdf7ba12ea7d26f325b81b6c776f499730b59c9c8ab2eb06`
- `2026-11-12_12_dispatcher_turnover.sql`: `340db0bc4b6484128762adb1da64646bc98b7dbc4c47ce5881315a8a164eb2c9`

## Verified starting point and plan

Local `C:/xampp/htdocs/mulawin-fleetops-v2v`, branch `kenneth`, HEAD `9e27a6e`.
The working tree was clean at task start. Root AGENTS.md was read; no nested
instructions were found. No operational database connection is permitted or used.

Current-source audit:
- `DispatcherScope::tripSql/permitsTrip` scope by group and original planning
  shift, not current account. No executable clock/login-triggered turnover exists.
- `Trips::dispatch` writes dispatcher_id as the actual dispatch actor. Creation
  records dispatcher_role/dispatcher_shift and no individual account owner.
- `DispatcherAttendance::isCurrent/blocker/record` and `CrewAttendance` invalidate
  sessions by duty date/shift and require personnel.duty_shift.
- Fleet/Mechanics masterlists and Admin rosters impose permanent duty shifts.
- `Trips::complete` releases personnel while keeping the vehicle hold. Arrival
  already locks the trip/vehicle, records a unique inspection and releases holds.
- Admin mechanic attendance is Present/Absent marking, not Time In/Out. Repair
  eligibility separately checks active records, manual unavailability and active
  maintenance assignments; attendance must never substitute for these facts.

Confirmed user decisions: Operations Head explicitly assigns initial account
responsibility; an Admin Absent conflict blocks new assignments until corrected.

Dependency map: UI/API -> Trips/Funds/Documents/SignatureAccess -> DispatcherScope
-> account responsibility -> DispatcherAttendance/CrewAttendance/DispatcherResources
-> FleetState. Admin attendance/masterlists, mechanic rosters, notifications and
monitoring are part of the same change. Finance/billing transactions remain intact.

Sequence:
1. Baseline guarded unit/browser checks and source/schema dependency inventory.
2. Add responsibility, turnover headers and referenced trips as additive tables;
   preserve users.shift, trips ownership fields and attendance history columns.
3. Centralize account-owner authorization and explicit Operations Head initial
   assignment. No inferred owners or automatic historical backfill.
4. Endorse a reviewed snapshot to one active same-group recipient. Pending does
   not change responsibility. Accept all referenced trips in one locked transaction;
   guard versions, participant identities, group types and duplicate acceptance.
5. Remove permanent resource-shift eligibility; retain session/audit timestamps,
   group, fixed pairing, active/licensing/holds and Admin absence checks.
6. Retain returning personnel until arrival and protect older returning records
   without rewriting old holds. Existing arrival maintenance reconciliation remains.
7. Add minimal turnover drawers/actions in existing Trips and monitoring pages.
8. Verify fresh and upgrade migrations only on a verified owned disposable server,
   then focused authorization, concurrency, attendance and UI regressions.

Proposed state model: Unowned -> explicitly assigned account -> Pending turnover
(outgoing still owns) -> Accepted (incoming owns). No reject/cancel/emergency/
partial-accept endpoints; those policies remain unapproved. Same-group overlapping
accounts cannot mutate another account's trips. Multiple pending transfers of the
same trip are prevented; acceptance is recipient-only and atomic.

Permissions: Operations Head assigns initial owners and reads history; responsible
Dispatcher endorses; named active same-group recipient reviews and accepts;
outgoing retains mutations until acceptance; other accounts/groups are denied.
No Operations Head Dispatcher-processing or mechanic repair permission is added.

Schema dependencies inspected in source: users(id/role/shift/active), trips and
its original dispatcher fields/personnel IDs, trip_assignments primary resource
key/FK, inspection trip/attempt/kind uniqueness, checklist_starts, trip_events,
trip_updates, personnel/mechanics duty_shift, vehicles fixed pairings, attendance_marks
per-date/bucket uniqueness and actor FKs, dispatcher_attendance_sessions generated
open-person uniqueness and request-key uniqueness, maintenance_jobs generated active
mechanic/open-vehicle uniqueness, vehicle_status_log, audit_events and notifications.
No triggers were found in versioned SQL. Live schema is deliberately unverified.

Policy gaps left without controls: unaccepted turnover escalation, unavailable
outgoing/incoming accounts, rejection/cancellation, partial corrections, emergency
intervention and missed-Time-Out backdating. No automatic closure or override.


## Implemented behavior and state model

The state model above is implemented. Operations Head now uses **Responsibility &
Turnover** from Trips or Dispatch Monitoring to explicitly assign an unowned trip.
Dispatcher Trips has **Shift Turnover**. Review Work returns a database snapshot
of outstanding trips, assigned Truck/personnel, current fund status, holds and
incident/repair references. Endorsement verifies the reviewed fingerprint before
persisting its immutable reference snapshot. Endorsement changes no owner or trip.

Pending -> Accepted is the only turnover transition. The named active recipient
accepts the entire referenced set in one transaction, with header/trip/responsibility
locks and version checks. A unique pending-trip key prevents overlapping pending
turnovers. Request keys make endorsement retries reuse the header; serialized
acceptance returns a duplicate result without repeating ownership updates/events.
Unique-key/deadlock/lock-timeout conflicts return a controlled 409 rather than
silently overriding another transaction. There is no cancellation/rejection,
partial acceptance, global group takeover, emergency override or auto-accept path.

Ownership lives separately from `trips.dispatcher_role`, `dispatcher_shift` and
`dispatcher_id`. In existing code dispatcher_id is the actual confirmed-dispatch
actor; it is not an initial-account assignment. Formal turnover never updates
these original fields. Progress records use existing trip_updates types and store
the actual authenticated actor; trip_events retain actual actors and unchanged
status when recording a transfer. No trip, document, fund, assignment or status
is cloned or silently completed during turnover.

`DispatcherScope::tripSql` and `permitsTrip` now require the current account and
truck group. Trips, Funds, Documents and SignatureAccess reuse those boundaries;
Fund submission still locks the trip before checking ownership. Incoming review
is limited to the addressed turnover snapshot until acceptance. Outgoing mutations
are denied afterward. Operations Head retains read-only monitoring and initial
account assignment without Dispatcher progress, completion or maintenance rights.
Task notifications go to the current responsible account. Unowned work prompts
Operations Head for explicit initial assignment.

Personnel sessions no longer expire by duty date or shift. Permanent duty_shift
controls/columns were removed from personnel and mechanic masterlists; old stored
values are preserved. New records use NULL and edits preserve historical values.
Current attendance displays come from sessions. Fixed Truck/Driver pairing,
substitute Helper reasons, two distinct Car Carrier Drivers, active records,
licenses and resource holds remain independent checks. Admin Absent marks made
during an open session block eligibility until corrected; a new Time In also
checks today's latest Admin mark. Time In does not erase Admin records.

Legacy attendance_marks and dispatcher_attendance_sessions keep their original
Day/Night fields as reporting buckets, not permanent personnel assignments.
Admin Present/Absent rosters include every active Driver/Helper or Mechanic in
the selected historical bucket without filtering by permanent shift. No new
attendance role or mandatory Dispatcher attendance was added. Mechanic attendance
never marks a busy mechanic Available; maintenance assignment checks remain intact.
Readiness now reports actual missing open sessions/absence, not shift mismatches.

Completion retains all person/vehicle holds until the existing arrival transaction.
The shared personTrip lookup also detects older Completed returns with a vehicle
hold even if old code already removed their personnel holds. This prevents new
assignment and premature Time Out without fabricating/backfilling stored holds.
Arrival All OK releases applicable holds and reconciles vehicle availability;
NOT OK continues through existing corrective maintenance. Manual unavailability
and genuine repair restrictions remain authoritative. Old explicit releaseCrew
calls are guarded against releasing a pending-return trip.

Monitoring workload cards continue to describe original planning group/shift;
that scope is explicitly labelled. View details shows the current account, while
turnover history records the account chain. No historical assignment is inferred
from time of day or from an event actor.

## Migration and rollout boundaries

Created `database/migrations/2026-11-12_12_dispatcher_turnover.sql` and included the
same additive definitions in the fresh-install extension. Operations are three
CREATE TABLE IF NOT EXISTS statements and an INSERT IGNORE migration marker:

| New table | Data and safeguards |
| --- | --- |
| trip_responsibilities | One trip primary key, initial/current account, initial assigning actor/time, version; user/trip FKs and current-account index |
| dispatcher_turnovers | Outgoing/intended incoming accounts, existing truck-group key, Pending/Accepted state, endorsement/acceptance actors/times, remarks, unique request key; participant/state constraints and indexes |
| dispatcher_turnover_trips | Referenced trip, original responsibility version, immutable summary JSON; composite key, trip/header FKs, unique nullable pending-trip key |

No old column/table/record is dropped, rewritten, backdated or auto-owned. DDL can
implicitly commit; this is not a transactionally rollbackable operational change.
Existence guards do not validate a pre-existing table's definition. The disposable
fresh/upgrade fingerprint comparison checks columns, indexes, foreign keys and
checks, but the operational schema was deliberately not inspected or altered.

**The operational migration is NOT applied.** Install only after a separately
authorized operational preflight/backup. Code must not be activated against an
old schema: Dispatcher reads fail closed with an installation message. After
installation, Operations Head must explicitly assign initial responsibility for
existing work (and any historical records requiring Dispatcher access). No prior
actor is treated as the owner automatically. Newly planned trips likewise wait
for that explicit account assignment before Dispatcher processing.

Rollout sequence: preserve the current working tree; verify actual operational
schema/target and writers under separate authorization; back up and verify a
restore; apply/inspect the additive migration; have Operations Head review and
assign initial owners; verify role-specific read/mutation access; enable normal
turnover. Do not restore old shift-only authorization over accepted turnovers as
an automatic rollback, because it could authorize an account that no longer owns
that work. Retain all new history during any separately reviewed recovery.

## Affected-file inventory

| Files | Functions / purpose |
| --- | --- |
| backend/Core/DispatcherTurnover.php (new) | ready, action, summary, listing, account validation and fingerprint; initial ownership, review, endorsement, atomic acceptance/history |
| backend/Core/DispatcherScope.php | tripSql/permitsTrip central account/group scope |
| backend/Core/DispatcherAttendance.php | isCurrent, absent, blocker, read, record; shift-independent sessions, Admin conflicts, returning-duty Time Out guard |
| backend/Core/CrewAttendance.php | dispatchFindings, readiness, assignmentCheck, unassignedCrew; live session readiness without fixed resource shifts |
| backend/Core/FleetState.php | personTrip, personBlocker, releaseCrew guard; returning-duty integrity and legacy projections |
| backend/Core/Notify.php | tripRoles sends current-account tasks or requests explicit initial ownership |
| backend/Modules/Operations/Trips.php | action routing, select, lockTrip, guarded reads, progress, complete and attendance summaries; no early personnel release |
| backend/Modules/Operations/Fleet.php | crewSave, read/dispatcherAvailability; preserve legacy shift metadata and project actual session/returning state |
| backend/Modules/Accounting/Funds.php | submit/details account-responsibility checks; Finance release logic unchanged |
| backend/Modules/Administration/Attendance.php | roster/save; active personnel/mechanics without permanent shift partition |
| backend/Modules/Maintenance/Mechanics.php | save preserves old metadata and no longer requires shift; repair processing unchanged |
| database/extension.sql and new migration above | Three additive tables, fresh/upgrade parity |
| public/assets/js/modules/operations/dispatcher-turnover.js (new) | open, preview, details, records; existing shared forms/drawers/tables and actual APIs |
| public/index.php | Load the new UI module |
| public/assets/js/modules/operations/dispatcher.js | Trips turnover tool, account distinction, attendance descriptions/history and shift-free resource references |
| public/assets/js/modules/operations/dispatcher-monitoring.js | Operations Head history/assignment tool and current-account distinction |
| public/assets/js/modules/operations/ops-head.js | Initial responsibility/turnover tool and actual session readiness |
| public/assets/js/modules/operations/trips.js | Record Progress action and session-based attendance text |
| public/assets/js/modules/operations/fleet.js and modules/maintenance/mechanics.js | Remove permanent-shift inputs/columns |
| public/assets/js/attendance.js and modules/administration/admin.js | Distinguish legacy attendance batches from permanent staff shifts; accurate mode label |
| AGENTS.md | Preserve these approved rules for subsequent prompts |
| tests/Unit/DispatcherPlanningTest.php and DispatcherWorkflowTest.php | Replace superseded shift-ownership/session-expiry expectations with approved account/open-session rules |
| tests/Unit/TurnoverAuthorizationTest.php (new) | Unauthorized roles fail before database access |
| tests/turnover_tests.php and turnover_concurrency_worker.php (new) | Guarded real MariaDB migration/workflow/authorization/concurrency tests |
| tests/run_turnover_tests.php, run_turnover_server.ps1, turnover_server_setup.php (new) | Existing isolation launcher plus independently initialized and verified owned MariaDB server |
| tests/dispatcher_turnover_ui.html (new), dispatcher_ui.html, run_ops_head_browser.cjs | Turnover workflow/forms, updated retired-shift expectation, focused responsive mode |
| docs/DISPATCHER_TURNOVER_IMPLEMENTATION.md | This audit/design/change report |

No dependency/framework, sidebar destination, study objective, Finance release,
Purchasing, Billing transaction, maintenance processing policy or remote resource
was changed. Document/signature authorization follows the shared scope without
removing endpoints or business functions.

## Verification actually executed

Baseline (before source corrections):

```powershell
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'Dispatcher|CrewAttendance|CrewDispatch|OperationsV43|TripApproval|Fleet' --do-not-cache-result
```

160 tests / 359 assertions passed. Following implementation, four old expectations
failed because they demanded group-wide/shift-based ownership or attendance
expiry at midnight. Those tests now assert the approved current-account and open
session behavior. No authorization guard was weakened to satisfy an old fixture.

Final commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run_turnover_server.ps1
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter 'Dispatcher|CrewAttendance|CrewDispatch|OperationsV43|TripApproval|Fleet|Turnover' --do-not-cache-result
node tests/run_ops_head_browser.cjs --fixtures-only
node tests/run_ops_head_browser.cjs --turnover-only
git diff --check
```

The server script creates a new owned temporary datadir and independent local
port, starts MariaDB with --no-defaults and loopback binding, verifies @@datadir
and @@port, and creates explicit test-only credentials without displaying them.
It invokes the existing guarded launcher, which creates token-owned *_test
schemas in a temporary application copy. Both databases and the dedicated server/
datadir are cleaned up using verified identities. No operational credentials or
operational database connection are used.

- **65 disposable MariaDB 10.4.32 checks passed**, including fresh vs upgrade
  schema parity, repeatable migration, sentinel record preservation, role/group
  denial, explicit initial ownership, pending access boundaries, actual SELECT
  account projections, same-group recipient validation, inactive-recipient denial,
  concurrent acceptance (one transfer plus one idempotent retry), reverse/multiple
  turnovers, actual progress and Night completion actors, original-field preservation, preserved billing transition, rejection of partial-acceptance payloads, cross-date open
  sessions, Admin absence conflicts/correction, inactive personnel, expired
  licenses, retained returning holds, legacy missing-hold protection, All OK and
  NOT OK arrivals, duplicate completion/arrival rejection, same-group incoming
  Time Out actors, shift-free mechanic attendance and busy-mechanic restrictions.
- **161 targeted unit tests / 404 assertions passed** after the approved rule
  updates. Unauthorized turnover/progress roles are rejected before DB access.
- **670 browser assertions passed across twelve database-free fixtures**,
  including 16 turnover checks, 314 Dispatcher checks and existing Operations Head,
  monitoring, routes, reports, analytics and shared component checks.
- Focused turnover mode also passed all 16 turnover assertions at **390, 820 and
  1440px**, with form/drawer/page bounds and dialog closure checked. The mobile
  capture was visually inspected. Standard List/Grid behavior remains functional
  where supported; work-review tables use List only with existing components.
- Modified PHP/JavaScript syntax and diff whitespace checks passed.

During verification, one fixture initially omitted a mandatory user email; it was
corrected. The old personnel-drawer expectation still required a permanent shift;
it now requires license information without that restriction. A visual inspection
caught saved dialogs remaining open in the new fixture: it submitted before
Bootstrap's show transition finished. The fixture now waits for the actual modal
transition and checks closure, without changing shared modal behavior.

## Remaining boundaries and policy decisions

There is no live authenticated XAMPP/browser-to-MariaDB end-to-end claim. Browser
checks mock API data; database tests exercise real application service methods
and SQL on disposable MariaDB. The exhaustive historical integration scripts for
retired automatic allocation and permanent-shift policies were not run as if they
represented the new workflow; only the stated baseline/targeted/new suites ran.
No concurrent arrival test was run: duplicate arrival tests plus existing trip/
vehicle locks and unique inspection constraints were verified. No operational
migration, record backfill, staging, commit, push, merge or
remote deployment was performed.

Turnover history loads the latest 500 headers; the initial-owner chooser loads
up to 1,000 unowned trips, unfinished work first. Closed historical records do
not acquire account ownership by inference. Operations Head retains monitoring
visibility; any Dispatcher access to unowned legacy history requires an explicit
initial account decision. Legacy duty fields remain for historical compatibility.

Company decisions still required before implementing exceptions: escalation when
a recipient never accepts; unavailable outgoing staff; inactive/absent incoming
staff beyond rejecting acceptance; cancelling/rejecting an endorsement; partial
acceptance/correction; emergency override; and retrospective missed-Time-Out
correction/backdating. Normal Time Out is still permitted only when no active or
returning duty holds remain, with its actual timestamp and actor. No arbitrary
midnight closure, overwrite, override or automatic handover was added.

## Selected-trip turnover update

The outgoing Dispatcher now explicitly selects one or more ongoing trips in the
existing Shift Turnover drawer. Nothing is selected automatically. The selected
set is reviewed again by the server, then endorsed to one active same-group
account. Unselected trips stay with the outgoing account. Incoming Turnovers
filters addressed history; details show current statuses alongside the immutable
endorsement snapshot. Operations Head uses Dispatcher Responsibility for monitoring
and retains the separate initial-owner tool. New/Batch Planning account assignment
is unchanged.

The existing preview/endorse/details/accept endpoints, three turnover tables,
request keys, responsibility versions and transactional acceptance are reused.
Endorsement requires explicit unique positive trip IDs; its fingerprint covers
only those trips. Reusing a request key for a different set is rejected. Closed
work is excluded, except Completed trips retaining the returning vehicle hold.
Acceptance rechecks eligibility, ownership, version, account activity and group
for every reference and rolls back the complete set on any failure. Repeated
acceptance stays idempotent. No rejection/cancellation/emergency policy was added;
if referenced work becomes ineligible before acceptance, the pending endorsement
is blocked rather than partially transferred.

Focused verification: 247 checks passed on the guarded independently owned
MariaDB server, including 13 real password/session/CSRF HTTP API checks against
its temporary PHP application. Single/multi selections, unchanged unselected work,
concurrent acceptance, stale requests, atomic failure, Arrival Pending, actor
history, attendance/holds/resources and financial-record preservation were checked.
PHPUnit: 27 tests / 129 assertions passed. Browser fixture: 21 assertions passed,
plus responsive interactions at 390, 820 and 1440px. These browser fixtures mock
API data; the separate HTTP integration uses real PHP and disposable MariaDB.

Read-only operational verification confirmed both existing migration markers 11
and 12 and all three turnover tables on local mulawin_v2 / port 3306. The earlier
report's unapplied-migration statements describe its historical starting point;
activation was completed separately. This selected-trip update adds no schema
change or operational records, and runs no operational migration. Existing staged
source work was retained without staging, commit, push or deployment.
