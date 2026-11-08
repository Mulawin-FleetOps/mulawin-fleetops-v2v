# Batch trip planning

Branch: `feature/claude-batch-trip-planning` · Marker: `BATCH_TRIP_PLANNING_V1` · **No database change.**

## Design (smallest safe)
- One page, **Trips → Batch planning** (`#trips?batch=1`), for the same users who can create a trip:
  Operations Head (trips are confirmed and auto-assigned, Scenario A) and dispatchers (requests go to Pending Review,
  Scenario B, own truck types only). One row per trip: client, truck type, approved route (optional), pickup, delivery,
  schedule, km, consignee. Map pins are not used in batch rows — choose an approved route or type the km (New trip still
  has the map).
- New action `Trips.create_batch` (max **20 rows**):
  1. **Checks every row first, writing nothing.** Any wrong row → nothing is created; the answer lists every problem by
     row number (missing km, past schedule, inactive client, no rate, unusable route, other team's truck type, ...).
     Identical-looking rows (same client, truck type, route and time) are **allowed**: a client may need several trucks.
  2. **Creates each row through the existing `create()`** (same rules, events, auto-assignment, Awaiting Resources,
     notifications), **earliest schedule first** so earlier trips get trucks and crew first. Results are returned in the
     order entered: Created / Already created / Not created, with trip number, status, truck and message.
     **Partial success** (approved): a row that fails while saving (rare: database / server problem, route changed a
     moment earlier) is "Not created" and the other rows stay created. The page locks the created rows and its button
     becomes **Retry not-created row(s)**: only those rows are sent again, with their original keys and row numbers.
- **Duplicates** are prevented only by the per-row form key — never by comparing business fields. Every row has its own form key (`trips.request_key`, already UNIQUE). Re-sending the batch (double
  click, retry, two tabs at once) returns the existing trips as "Already created"; two simultaneous sends are handled
  (unique-key race caught). The send button is disabled while sending.
- Each trip then follows its own review, checklist, fund, dispatch and billing. Existing trips are never changed.
- Activity Log: one "trip batch planned" entry with the summary and trip numbers (plus each trip's normal history).

## Tests
`tests/run_trip_batch_tests.php` (65 checks) incl. a two-process duplicate-send test.

## Decisions (approved 2026-11-08)
1. Operations Head and dispatchers may use Batch Planning; dispatcher rows stay Pending Review.
2. Earliest scheduled trips are created (and get resources) first.
3. No map pins in Batch Planning for now.
4. Maximum 20 rows per batch.
5. Partial success is acceptable for unexpected failures while saving; failed rows can be retried alone.
