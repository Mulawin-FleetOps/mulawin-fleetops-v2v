# Advance scheduling and resource reservations

Status: limitation analysis and future proposal only; no reservation logic implemented. Approved study objectives remain unchanged.

## Current behavior

Trips have a scheduled date/time and server-side time-window rules. `Trips::autoAssign()` chooses resources that are free **now**, and Operations Head creation/approval can immediately call `applyAssignment()` even for a future trip. Batch processing orders rows by schedule; that order is not a reservation calendar.

`FleetState::hold()` writes exclusive `trip_assignments` rows; their primary key `(resource_type, resource_id)` prevents another active trip from holding the same truck or person. Availability checks, transactions/row locks, maintenance exclusions, licensing and existing attendance protections remain in place. Crew planning already considers the scheduled shift and the configured Warn/Enforce behavior. That shift awareness does not provide time-interval reservations.

The assignment table has no start/end reservation interval. Two non-overlapping future trips cannot both hold the same resource. An early assignment may hold resources for a distant schedule, and a later trip can remain Awaiting Resources despite apparent future capacity. `assignWaiting()` retries queued trips when release/availability events occur; it is not an interval scheduler. On completion crew can be released while the truck remains held until arrival checks. The UI does not promise future availability or overlapping holds.

## Proposed future design, requiring approval

1. Agree pickup/loading, transit, unloading, return-to-yard and turnaround durations, safety buffers, timezone, crew/rest constraints and maintenance blackout periods. Treat uncertain end times explicitly rather than assuming a trip ends at delivery.
2. Add a separate reservation model: trip/attempt, resource/role, start/end interval, Tentative/Confirmed/Activated/Released/Cancelled state, version and audit actor. Keep tentative planning distinct from live `trip_assignments` holds.
3. Enforce interval overlap in server transactions: serialize changes by locking the resource rows in a consistent order, query active reservations with `existing.start < proposed.end AND existing.end > proposed.start`, then insert/update. A simple uniqueness constraint cannot protect arbitrary time intervals in this MySQL design. Every mutation path must use the same service.
4. Recheck maintenance, licensing, shifts/attendance and all existing dispatch gates before activation. At the agreed preparation horizon, atomically convert an eligible reservation to the existing exclusive live hold. Never remove the current conflict guard before replacement concurrency protections are proven.
5. On delays, incidents or return overruns, extend occupancy under locks, flag affected reservations and ask Operations to replan; do not silently overlap or release resources still in use. Define cancellation, reassignment, redispatch and arrival-check release behavior explicitly.
6. Add role-aware availability timelines that distinguish forecast capacity, tentative reservations, confirmed reservations, live holds and maintenance. Label confidence and show conflicts; avoid a general promise of future availability.
7. Roll out separately with legacy holds grandfathered and tests for touching/overlapping intervals, turnaround, overnight shifts, absent crew, concurrent reservation/dispatch/reassignment, maintenance and incident overruns, cancellations and unchanged financial totals.

This redesign preserves all existing hold rules and server conflict protections.
