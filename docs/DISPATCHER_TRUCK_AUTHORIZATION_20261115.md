# Dispatcher account truck authorizations — additive rollout

## Scope

Head Management > User Accounts now shows **Assigned Shift** (Day/Night) and a
searchable **Assigned Trucks** checklist only for Car Carrier and Container /
Wing Van Dispatcher roles. The former **Audit** option is not offered for new
accounts; existing Audit users and audit records are retained.

The Admin can authorize one truck for multiple accounts (including Day/Night).
Account authorizations are **not trip ownership**: `trip_responsibilities`,
formal endorsement/acceptance and vehicle resource holds still govern work.
No vehicles, trip records, or historical user accounts are automatically updated.

## Database installation (manual only)

The code expects the additive migration:

`database/migrations/2026-11-15_15_dispatcher_truck_authorizations.sql`

It creates `dispatcher_truck_authorizations` with:

- Composite unique primary key (`dispatcher_id`, `vehicle_id`)
- Foreign keys to `users` and `vehicles` and the Admin authorizing user
- An index on (`vehicle_id`, `dispatcher_id`)
- `authorized_at` timestamp and schema migration history marker

**Never run on an operational database without independent authorization,
a recent verified backup/restore, schema preflight, and a planned maintenance
window.** MySQL DDL may commit implicitly. Do not run `migrate:fresh`, reset
the database, use force-push, or delete accounts to install it.

Preflight (read-only):

```sql
USE mulawin_v2;
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dispatcher_truck_authorizations';
SELECT id FROM schema_migrations
 WHERE id='2026-11-15_15_dispatcher_truck_authorizations';
SELECT id, truck_number, plate_number, truck_type, active FROM vehicles
 WHERE active=1 AND truck_type IN ('Car Carrier','Container','Wing Van');
```

After a separately authorized install, check:

```sql
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dispatcher_truck_authorizations';
SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
 FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dispatcher_truck_authorizations';
SELECT id FROM schema_migrations
 WHERE id='2026-11-15_15_dispatcher_truck_authorizations';
```

The table must contain `dispatcher_id`, `vehicle_id`, `authorized_by` and
`authorized_at`, and the required primary/foreign-key constraints. A migration
marker alone is not proof of schema validity.

## Existing accounts and runtime behavior

Existing Dispatcher accounts do not automatically receive vehicle access.
After installation, an Admin must **edit each active dispatcher account** and
select its authorized trucks. Save one account at a time and verify the results.
Until then, Dispatcher truck availability/assignment fails closed (or yields no
authorized trucks), not a silently unrestricted pool. Do this setup before
enabling Dispatcher traffic against the upgraded code.

Only compatible, active trucks can be saved:

- Car Carrier Dispatcher: Car Carrier trucks
- Container/Wing Van Dispatcher: Container and Wing Van trucks

Actual truck resource assignment rechecks the account's authorized vehicle
list, group, live attendance, fixed Driver/Helper links, maintenance status,
and existing global resource holds. Trips planned by Operations Head must have
a responsible Dispatcher with at least one compatible authorized active truck.
Revoking an account's authorization for a truck on its outstanding work is
blocked until that work is properly resolved/turned over.

The existing vacancy restriction for one active account per Dispatcher
role/shift remains unchanged; this change does **not** create unlimited
additional accounts per shift or modify shift turnover policy.

## Verification (not yet run against live app)

- Open Add/Edit User modal as Admin; Audit unavailable on new account
- Dispatcher role shows Day/Night choices and truck checklist
- Non-dispatcher role hides shift/truck fields
- Search, select, deselect, and edit persist truck IDs
- Incompatible/inactive vehicle selection rejected server-side
- Cross-group or unauthorized vehicle assignment rejected
- Same truck can be authorized to both Day and Night, but not dispatched
  simultaneously because existing vehicle holds apply
- Existing trip responsibility and turnover remain unchanged
- Retry with no migration installed returns a setup error, not silent access
- Run PHPUnit, browser UI fixtures, PHP lint, and full regression suites on
  an isolated disposable test database before production rollout

## Current verification boundary

The new files are committed on the development branch only. No user database
was accessed or migrated by this implementation. PHP lint, browser tests,
and integration tests remain to be executed in the real local checkout.
