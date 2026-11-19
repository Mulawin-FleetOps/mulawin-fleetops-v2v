# Fleet-wide crew standard: 1 Driver + 1 Helper

## Business rule
For **Car Carrier, Container and Wing Van**, the required operational crew for all **new** trip assignments is exactly one eligible authorized Driver and one eligible Helper. The previous optional Car Carrier Driver 2 path is retired.

## Changes on luis
- `backend/Core/DispatcherResources.php`: candidate response no longer exposes a Second Driver list; server rejects any `driver2_id` in new assignment requests, checks Helper attendance/availability, and writes `driver2_id=NULL`.
- `backend/Core/CrewAttendance.php`: confirm dispatch and redispatch readiness require active Driver and Helper for every truck type; old two-driver crews fail readiness with an explicit reassignment message.
- `backend/Core/FixedAssignments.php`: fixed Truck pairing no longer special-cases Car Carrier to reject helpers; requires a Regular Helper for each newly saved fixed pair.
- `backend/Modules/Operations/Fleet.php`: saving the selected Driver's fixed Truck pairing requires a Regular Helper if that Truck does not already have one; duplicate helper assignment and active-trip checks remain.
- `public/assets/js/modules/operations/fleet.js`: helper selector supports all truck types, including Car Carrier.
- `public/assets/js/modules/operations/dispatcher.js`: all assignment forms use only Driver, Truck, Helper and optional documented Helper-substitution reason; readiness and dispatch UI use the same requirement.
- `public/assets/js/modules/operations/trips.js`: shows current Driver + Helper; explicitly labels Driver 2 on historical trips only.

## Data preservation and transition policy
Do NOT delete or rename `trips.driver2_id`; existing trip and audit references remain intact. No automatic rewrite or conversion of completed, dispatched, or otherwise active trips. Any trip still in a pre-dispatch/redispatch state with an existing Driver 2 must be manually reassigned by authorized users to one Driver + one Helper. A historical two-driver crew can still be inspected after completion; that historical record is not silently changed.

Vehicles may still be created in the masterlist before an operational crew is assigned. **Before an actual new trip is dispatched**, however, its crew must pass the new Driver + Helper readiness checks. Neither a regular pairing nor a trip crew member can be overridden contrary to existing authorization, attendance, active-trip, or maintenance holds.

## Regression tests required before release
1. Add a new active Helper, then add a Driver on a Car Carrier Truck and choose that Helper; verify the fixed pair is saved, and reload the form to verify the selection persists.
2. Repeat for Container and Wing Van.
3. Reject Driver pairing without a Regular Helper when a new fixed Truck is chosen.
4. Verify a Helper already paired to another active Truck remains ineligible.
5. Verify the Dispatcher resource assignment form never offers Driver 2 and the API rejects a forged non-null `driver2_id`.
6. Assign each truck type with one Driver + Helper; verify attendance, checklist, confirm dispatch, status, and trip history work.
7. Verify a previous pre-dispatch Car Carrier trip with a legacy Driver 2 cannot dispatch until manually reassigned; verify historical completed trip retains its previous Driver 2 identity.
8. Verify cancel, incident, maintenance hold, reschedule, and return/checklist workflows still function, as well as group-scoped permissions.
9. Run PHP lint on all changed PHP files and JS syntax checks, then complete tests against a **staging** database before deployment.
10. Check whether any deployed migration or other client still expects the old `second_drivers` API response.

No database migration was authored; **no live DB changes or staging-browser regression tests are represented as completed**.
