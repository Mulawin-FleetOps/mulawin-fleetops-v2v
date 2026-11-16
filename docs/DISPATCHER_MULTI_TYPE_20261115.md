# Dispatcher accounts: multiple truck types and Day/Night shifts

## Final UI / requirements
In Head Management → User Accounts, choose **Role: Dispatcher**. The modal shows:
- **Truck Types**: choose any **one, two, or all three** from Car Carrier, Container, Wing Van. No individual vehicle selection.
- **Assigned Shift**: Day or Night. Both are selectable; **multiple active Dispatcher accounts can share a shift**. Existing trip responsibility, attendance and resource holds still prevent conflicting assignments.

The Audit role remains unavailable for new accounts; no existing Audit user or audit log is deleted. Temporary-password onboarding is unchanged.

## Data and compatibility
A new nullable `users.dispatcher_truck_types` JSON column stores the selected types.
The previous single `dispatcher_truck_type` column is retained as the primary legacy group marker. The internal `users.role` still uses Car Carrier or Container/Wing Van Dispatcher for compatibility; the multi-type selection is authoritative for trip/vehicle permissions.

Existing accounts with no JSON selection continue to use their original single-type/legacy group scope until an Admin edits them. No backfill or removal of existing accounts, trucks or trip records is attempted. The unused dispatcher-to-individual-truck authorization table from migration 15 is retained, not dropped.

## Required additive migration for existing `mulawin_v2`
The new file is:

`database/migrations/2026-11-15_17_dispatcher_multi_types.sql`

It **must be run after** `2026-11-15_16_dispatcher_truck_type.sql`. Verify that migration 16 is installed. Back up and verify the target database before applying migration 17. The migration is **not automatically executed** by a Git pull, and must be applied only once. It adds one nullable JSON column plus a history marker and does not delete data.

Preflight:

```sql
USE mulawin_v2;
SELECT id FROM schema_migrations WHERE id IN (
  '2026-11-15_16_dispatcher_truck_type',
  '2026-11-15_17_dispatcher_multi_types');
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'
AND COLUMN_NAME IN ('dispatcher_truck_type','dispatcher_truck_types');
```

Only when 16 is verified installed, 17 is not installed, the backup is confirmed and the column is not present, apply 17 using the MySQL CLI or Workbench. Verify `users.dispatcher_truck_types` and the migration marker afterwards.

## Authorization / turnover
- The user can see and use all eligible vehicles matching **any selected truck type**; resource assignments still require available fixed crew, recorded attendance, suitable maintenance status and globally conflict-free vehicle holds.
- Operations Head planning picks a responsible Dispatcher with the required truck type and shift, not merely a matching historical role string.
- Turnover responsibility remains explicitly addressed to a recipient and moves only on acceptance. Cross-group eligible recipients can accept trips of a type they are assigned. A single turnover endorsement containing both historical Car Carrier and Container/Wing Van groups is disallowed: endorse each operational group separately to preserve immutable historical turnover grouping.
- Existing Dispatcher account role/shift/type changes remain blocked while they own unfinished trip work or pending turnover, to avoid stranding ownership.
- Existing user accounts with null JSON selection are not assigned new type permissions by this migration.

## Testing needed before production
JavaScript syntax checks can be performed from the repository, but PHP lint, PHPUnit, DB integration tests, and live browser tests must still be executed. Specifically verify: create one-, two-, and three-type accounts; Day and Night both selectable; overlapping Day accounts; multi-type Truck and Trips filtering; resource and crew attendance; cross-type Ops Head planning; cross-group turnover and active-vehicle holds; and other non-Dispatcher roles.

**Do not run destructive migrations, delete accounts, or force-push.**
