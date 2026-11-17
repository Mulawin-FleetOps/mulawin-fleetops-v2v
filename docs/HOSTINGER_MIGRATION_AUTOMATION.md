# FleetOps migration automation — guarded rollout

**Current status:** GitHub source checks prepared; **automatic production migration is NOT active**.
Hostinger Single Web Hosting has PHP Cron Jobs, but there is no verified post-deployment hook or unattended per-release backup mechanism yet. Keep the current deployment auto-trigger and migration cron disabled.

## What was changed

- `scripts/migrate.php`: CLI-only; default is read-only `--status`. `--apply` needs all explicit environment checks below. Pending SQL files are parsed before executing any DDL. A MySQL advisory lock prevents overlapping runs of this runner. On a failed migration, execution stops and its history entry is not added by the runner.
- `scripts/lib/migration_sql.php`: offline-testable SQL splitter; rejects unsupported mysql-client directives and routines/triggers.
- `tests/migration_safety_checks.php`: no-database parser and guard tests.
- `.github/workflows/migration-safety.yml`: PHP 8.2 lint and offline checks only. Never connects to production or deploys.

## Command safety

```sh
php scripts/migrate.php --status    # default; reads pending migrations, no changes
php scripts/migrate.php --apply     # NEVER schedule until all rollout gates are met
```

Applying is disabled unless **all** server-side `.env` values are set:
```dotenv
MIGRATIONS_ENABLED=1
MIGRATIONS_EXPECTED_DB=<verified actual target database>
MIGRATIONS_APPROVED_IDS=<explicit comma-separated migration IDs reviewed for this deployment>
MIGRATIONS_BACKUP_VERIFIED=1
```

Never commit real `.env` secrets. `MIGRATIONS_BACKUP_VERIFIED` is a *manual attestation*, not automatic backup verification. Do not leave it permanently enabled for unattended cron execution. MySQL DDL may commit even if later statements fail; the advisory lock and tracking table cannot undo partial DDL.

## Known rollout blockers (2026-11-17)

1. On the Hostinger `u826906339_mulawin_test` database, migration history has entries through `2026-11-15_16_dispatcher_truck_type`, but the column for 17 and table for 18 are missing.
2. `chk_trip_status` **already permits** `Missed`, yet migration 19 is missing from history. The runner intentionally refuses to reapply migration 19 until schema/history drift is reviewed and reconciled.
3. `database/schema.sql` defines `dispatcher_truck_types`, while `database/extension.sql` also includes an unconditional `ALTER TABLE` to add it, along with other historical alters. A fresh import of these unchanged files is not a reliable migration test baseline.
4. No approved repeatable tested deployment completion signal, automatic backup/restore verification, or unattended production rollout workflow exists. **Do not enable a migration cron yet.**

## Required before production activation

1. Verify which Git ref Hostinger deploys, its working directory, and that the deployed commit is complete before invoking the runner. Do not assume a scheduled cron fires after deployment.
2. Create a disposable local test schema that matches the *pre-migration* state; test 17, 18 and 19 individually, repeated runs, and intentionally failing migrations. Never test destructive scenarios against an existing user database.
3. Reconcile the current migration 19 schema/history mismatch via an explicitly reviewed change. Confirm the actual production schema and necessary dependencies before modifying data.
4. Establish automated, verified per-deployment backups and rehearse recovery. Enforce approval for each migration release.
5. Validate a locked, deployment-aware, fail-closed runner on a staging copy, then only enable a protected server-side cron with independent monitoring and error alerting.
6. Only then consider setting `MIGRATIONS_ENABLED=1` for an approved release. Avoid indefinite broad migration approval.

## GitHub CI

Open **Actions → PHP Migration Safety** on GitHub and inspect the latest run. CI does **not** prove database migration correctness; integration tests and staging acceptance are still required.

## Hostinger

Hostinger may expose a PHP Cron Job form with a PHP binary and script path. Because the deployed application root was observed as `public_html`, a possible CLI script path is `/home/<account>/domains/<domain>/public_html/scripts/migrate.php` or `/home/<account>/public_html/scripts/migrate.php` depending on setup. **Do not paste a guessed path or schedule `--apply`.** Verify the absolute path via File Manager or Hostinger support, and test read-only status only after deployment correctness has been verified.
