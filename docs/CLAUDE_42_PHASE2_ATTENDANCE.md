# Checklist #42 Phase 2 — Crew attendance with auto-assignment and Confirm Dispatch

Branch: `feature/claude-42-phase2-attendance-dispatch` · Marker: `CHECKLIST_42_ATTENDANCE_PHASE2_V1`

## Approved decisions (2026-11-08)

1. Drivers **and** helpers in Admin attendance; Driver 2 checked on Car Carrier trips; helper shifts managed like drivers'.
2. Confirm Dispatch / Redispatch uses the **actual server dispatch time** (Philippine time) for the duty date and shift.
3. Assigned shift ≠ dispatch shift → blocked with an explanation; no automatic shift change, no cross-shift attendance.
4. Crew without a shift must be backfilled by Admin **before** hard enforcement.
5. No Operations Head override; Admin corrects attendance (audited).
6. Crew replacement still requires a new pre-dispatch checklist.
7. Operations Head is notified (no duplicates) when assigned crew of an upcoming, not-dispatched trip is marked Absent.
Plus: shift-aware auto-assignment (scheduled shift for planning; skip Absent; Not Yet Marked allowed), no change to
dispatched / in-transit trips, one source of shift boundaries, Present never bypasses availability / license /
double-booking, server-side enforcement.

## Step 1 — Preparation (this PR; no trip behaviour change)

| Change | File |
| --- | --- |
| `CrewAttendance::shiftFor()` — the single duty date + shift rule (Admin start hours; Night keeps its start date) | `backend/Core/CrewAttendance.php` (new) |
| `CrewAttendance::unassignedCrew()` — active drivers / helpers with no shift | same |
| Crew roster (`kind = Driver`, kept for compatibility) now lists drivers **and** helpers, with crew type | `backend/Modules/Administration/Attendance.php` |
| Attendance list returns the unassigned crew; Admin bell "N driver(s)/helper(s) have no Day/Night shift" (deduplicated, resolves when 0) | same |
| Phase 1 bell reminder uses `shiftFor()` for the Night date (same result as before) | same |
| Admin must pick a shift when saving a driver **or helper**; others still cannot change shifts | `backend/Modules/Operations/Fleet.php` |
| Modal title "Crew Attendance (Drivers and Helpers)", crew type per row, warning listing crew without a shift | `public/assets/js/attendance.js` |
| Masterlist form/column: shift for drivers and helpers ("Unassigned" badge) | `public/assets/js/modules/operations/fleet.js` |
| Settings validation: Day / Night start hours must be whole hours and different (409); identical values already in the database fall back to 6 / 18 so a Night shift always exists | `backend/Modules/Administration/Admin.php`, `backend/Core/CrewAttendance.php` |

No migration (`personnel.duty_shift` already exists for helpers). Trips, auto-assignment and Confirm Dispatch are not
touched. Tests: `tests/run_crew_attendance_tests.php` (56 checks).

## Step 2 — Rollout strategy (approved 2026-11-08; separate follow-up PR)

**One Admin setting, no migration:** `crew_attendance_dispatch_check` in the existing `app_settings` table.

| Value | Name | Auto-assignment | Confirm Dispatch / Redispatch | Absent notice to Ops Head |
| --- | --- | --- | --- | --- |
| 1 (default after deploy) | **Warn** | shift-aware: same shift as the trip's scheduled shift first, never Absent for that shift; if none, other / unassigned-shift crew allowed and the assignment note says so | allowed; the trip screen and the dispatch history show "Attendance not confirmed: NAME (Not Yet Marked / Absent / other shift)" | yes |
| 2 | **Enforce** | same shift only, never Absent | **refused** (409) unless every assigned driver / Driver 2 / helper is Present in the dispatch-time shift and assigned to that shift | yes |

- **Guard:** the backend refuses switching to Enforce while `unassignedCrew()` is not empty (message lists the names).
  The Admin sees the same list in the Attendance modal and the bell.
- **Preparation checklist for Admin:** (1) assign every active driver and helper a shift until the warning disappears;
  (2) mark attendance for a few shifts in Warn mode and check that dispatch history shows no "not confirmed" notes
  for crews that were actually present; (3) switch to Enforce.
- **Rollback:** switch back to Warn in Settings — no deploy, no data change.
- Why a setting and not only a deployment order: real dispatches cannot stop while the Admin backfills shifts and
  learns the routine; Warn produces evidence in the trip history first; switching back is instant.
  Without a setting, rollback needs a code revert.

## Remaining decisions

1. Approve the Warn → Enforce setting (default Warn) and the Enforce guard.
2. **Warn mode fallback:** may auto-assignment pick other-shift / unassigned-shift crew when no same-shift crew is free
   (flagged), or should it leave the trip "Awaiting Resources"?
3. **Early dispatch across a shift boundary:** a trip scheduled 18:05 may be confirmed from 17:50 (15-minute allowance),
   which is still the Day shift. Night crew would be blocked until 18:00. Accept (wait until 18:00), or use the
   trip's scheduled shift while inside the early allowance?
4. **Absent notice scope:** notify when the Absent shift (date + shift) is the trip's scheduled shift, or the current
   shift for a trip already past its schedule — proposed. Any wider scope?
