# FleetOps migration automation — guarded rollout

**Current status:** GitHub source, isolated MySQL tests, and guarded `--auto` mode prepared; **automatic production migration is NOT active**.
Hostinger Single Web Hosting has PHP Cron Jobs, but there is no verified post-deployment receipt producer or unattended per-release backup mechanism yet. Keep the current deployment auto-trigger and migration cron disabled.

## What was changed

- `scripts/migrate.php`: CLI-only; default is read-only `--status`. `--apply` and `--auto` need explicit environment checks below. Pending SQL files are parsed before executing any DDL. A MySQL advisory lock prevents overlapping runs of this runner. On a failed migration, execution stops and its history entry is not added by the runner.
- `scripts/lib/migration_sql.php`: offline-testable SQL splitter; rejects unsupported mysql-client directives and routines/triggers.
- `tests/migration_safety_checks.php`: no-database parser and guard tests.
- `.github/workflows/migration-safety.yml`: PHP 8.2 lint, offline parser checks, and disposable MySQL integration tests. Never connects to Hostinger production or deploys.

## Command safety

```sh
php scripts/migrate.php --status    # default; reads pending migrations, no changes
php scripts/migrate.php --apply     # manual, with explicit approval
php scripts/migrate.php --auto      # unattended; fail-closed without post-deploy receipt
```

Manual applying is disabled unless **all** server-side `.env` values are set:
```dotenv
MIGRATIONS_ENABLED=1
MIGRATIONS_EXPECTED_DB=<verified actual target database>
MIGRATIONS_APPROVED_IDS=<explicit comma-separated migration IDs reviewed for this deployment>
MIGRATIONS_BACKUP_VERIFIED=1
```

Unattended `--auto` requires `MIGRATIONS_ENABLED=1`, `MIGRATIONS_EXPECTED_DB`, and exact `MIGRATIONS_APPROVED_IDS`, plus a server-side `MIGRATIONS_RELEASE_RECEIPT` absolute path to a JSON receipt **outside** the deployed application. This receipt must be written by an independently trusted post-deployment process **after Git deployment completes and a fresh database backup is made**. It must contain:
- `ready_at`: Unix timestamp of completion (max 60 minutes old)
- `files`: map of **all pending migration basenames** to the SHA-256 hashes of their final deployed contents
- `backup_path`: absolute path of backup file **outside** deployed tree
- `backup_sha256`: SHA-256 of the backup file

The runner verifies file hashes, timestamps, backup path and checksum, and fails closed when any check is absent or wrong. **A SHA-256 match only verifies file integrity, not that a SQL backup is complete or restorable.** The external producer must actually verify backup completion and restoration feasibility. The Hostinger hPanel Git integration does not expose a verified post-deployment hook in the official documentation consulted, and no such trusted producer has been configured, so **DO NOT schedule `--auto` yet**.

Never commit real `.env` secrets. `MIGRATIONS_BACKUP_VERIFIED` is a *manual attestation*, not automatic backup verification. Do not leave it permanently enabled for unattended cron execution. MySQL DDL may commit even if later statements fail; the advisory lock and tracking table cannot undo partial DDL.

## Known rollout blockers (2026-11-17)

1. **Updated status:** User verified on Hostinger `u826906339_mulawin_test` that migrations 17, 18 and 19 are all recorded and their corresponding schema objects exist (1/1/1 check). No need to re-run these migrations.
2. An older read of migration history/schema disagreed with the later verification; future rollout must always compare the actual target schema with migration history.
3. `database/schema.sql` defines `dispatcher_truck_types`, while `database/extension.sql` also includes an unconditional `ALTER TABLE` to add it, along with other historical alters. A fresh import of these unchanged files is not a reliable migration test baseline.
4. No approved repeatable tested deployment completion signal, automatic backup/restore verification, or unattended production rollout workflow exists. **Do not enable a migration cron yet.**

## Required before production activation

1. Verify which Git ref Hostinger deploys, its working directory, and that the deployed commit is complete before invoking the runner. Do not assume a scheduled cron fires after deployment.
2. Review the GitHub CI disposable MySQL integration test results. Expand tests to include intentionally failing and interrupted migrations before unattended activation. Never test destructive scenarios against an existing user database.
3. Recheck real schema/history together before every release; no schema-history mismatch remained for migrations 17–19 at the user's latest verification.
4. Establish automated, verified per-deployment backups and rehearse recovery. Enforce approval for each migration release.
5. Configure and validate an independently trusted post-deployment receipt producer and verified per-release backup process; validate on staging before switching the existing single cron from `--status` to `--auto`. Record error output and monitor failures.
6. Only then consider setting `MIGRATIONS_ENABLED=1` for an approved release. Avoid indefinite broad migration approval.

## GitHub CI

Open **Actions → PHP Migration Safety** on GitHub and inspect the latest run. CI includes a disposable minimal-schema integration test for migrations 17–19. It does **not** establish that all future migrations will be safe against full production schema, nor that deployment ordering or production backups are verified.

## Hostinger

Hostinger may expose a PHP Cron Job form with a PHP binary and script path. Because the deployed application root was observed as `public_html`, a possible CLI script path is `/home/<account>/domains/<domain>/public_html/scripts/migrate.php` or `/home/<account>/public_html/scripts/migrate.php` depending on setup. **Do not paste a guessed path or schedule `--apply`.** Verify the absolute path via File Manager or Hostinger support, and test read-only status only after deployment correctness has been verified.
