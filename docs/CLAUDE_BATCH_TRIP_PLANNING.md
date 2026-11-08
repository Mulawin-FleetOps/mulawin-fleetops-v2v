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
     row number (missing km, past schedule, inactive client, no rate, unusable route, other team's truck type, identical
     rows in the batch, ...).
  2. **Creates each row through the existing `create()`** (same rules, events, auto-assignment, Awaiting Resources,
     notifications), **earliest schedule first** so earlier trips get trucks and crew first. Results are returned in the
     order entered: Created / Already created / Not created, with trip number, status, truck and message.
- **Duplicates:** every row has its own form key (`trips.request_key`, already UNIQUE). Re-sending the batch (double
  click, retry, two tabs at once) returns the existing trips as "Already created"; two simultaneous sends are handled
  (unique-key race caught). The send button is disabled while sending.
- Each trip then follows its own review, checklist, fund, dispatch and billing. Existing trips are never changed.
- Activity Log: one "trip batch planned" entry with the summary and trip numbers (plus each trip's normal history).

## Tests
`tests/run_trip_batch_tests.php` (54 checks) incl. a two-process duplicate-send test.

## Decisions to confirm
1. Dispatchers may also use batch planning (their rows are Pending Review requests) — or Operations Head only?
2. Rows are created earliest schedule first (resources go to earlier trips). OK, or strictly in the order typed?
3. Batch rows use approved routes or typed km (no map pins). OK for now?
4. Maximum 20 trips per batch.
5. If a row fails while creating (rare: e.g. its route was deactivated a second earlier), the other rows are kept and that
   row is reported "Not created". OK, or should such a batch be all-or-nothing as well?
