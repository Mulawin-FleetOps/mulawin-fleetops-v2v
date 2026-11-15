# Dispatcher account setup — truck type, not individual trucks

## Final account modal
Admin selects **Role: Dispatcher**. Then selects **Truck Type** (exactly
one of **Car Carrier**, **Container**, **Wing Van**) and **Shift** (Day or Night).
Other roles have no Dispatcher-specific fields. The Audit role is not available
for new accounts; old Audit accounts and audit records are not deleted.

The saved database `users.role` remains compatible with the existing modules:
- Car Carrier -> `car_carrier_dispatcher`
- Container or Wing Van -> `container_wingvan_dispatcher`

`users.dispatcher_truck_type` distinguishes Container from Wing Van.

## Upgrade required
Apply `database/migrations/2026-11-15_16_dispatcher_truck_type.sql`
to the existing `mulawin_v2` database **after a verified backup** and
before testing the upgraded app. This adds one nullable column and a CHECK
constraint; it does not delete any account, truck or assignment.

Existing Dispatcher accounts stay `dispatcher_truck_type = NULL` until
an Admin edits them; this retains their legacy role-group scope. On edit,
Admin must choose the actual truck type. Existing legacy accounts occupy
the old group/shift vacancy until configured or deactivated.

## Runtime rules
Accounts can use eligible **trucks of their selected type**, not individually
checked truck IDs. The existing fixed driver/helper links, attendance,
maintenance restrictions, global vehicle holds, role/shift assignment and
trip responsibility/turnover protections remain in effect. A trip cannot
be planned for or transferred to a Dispatcher with a mismatched selected type.

The earlier `dispatcher_truck_authorizations` table (migration 15)
is retained for compatibility and data preservation, but this new flow no
longer reads or writes it. **Do not drop it as part of this change.**

## Terminal preflight and migration
After `git pull`, and before launching the app, verify the target DB,
ensure a recent restore-tested backup, and use your installed MySQL 8
client (the MySQL command's `-p` prompts for the password; do not put it
on the command line). Run the migration once:

```powershell
cmd /c '"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p mulawin_v2 < "database\migrations\2026-11-15_16_dispatcher_truck_type.sql"'
```

Verify both column and migration marker using read-only SQL.

## Manual regression checklist
- Admin New User: Role has Dispatcher, not the two internal dispatcher roles
- Dispatcher fields: exactly Truck Type and Day/Night Shift (no truck list)
- Save and edit one Car Carrier, Container and Wing Van account
- Inactive/deactivated and existing legacy Dispatcher accounts preserved
- Duplicate active account of same truck type + shift rejected
- Both Container Day and Wing Van Day allowed once legacy blocking
  accounts have been assigned a specific type
- Truck availability and assignment show only selected type
- Wrong-type trip responsibility/turnover rejected
- Global overlapping vehicle assignment still rejected
- Other roles, Audit history, login and temporary passwords unaffected

PHP lint, app integration/DB tests, and full browser/regression tests must
be run on a test environment before production rollout.
