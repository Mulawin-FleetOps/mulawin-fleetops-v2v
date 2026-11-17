# FleetOps Hostinger automatic SQL migration rollout

## Current deployment
- Hostinger Git auto-deployment: ON; repository Mulawin-FleetOps/mulawin-fleetops-v2v; branch luis.
- Live PHP Cron Job currently runs the **read-only** migration status checker.
- Database: u826906339_mulawin_test (verified from CLI output).
- Live path: /home/u826906339/domains/azure-mosquito-762573.hostingersite.com/public_html/scripts/migrate.php
- Migration history and schema 17,18,19 were previously verified; do not reapply them.
- Do not assert live auto-apply is active before the release preflight and the cron replacement are confirmed.

## What is implemented on luis
- --status: displays database and pending migration files, never modifies schema.
- --backup-test: creates a private SQL snapshot, verifies its SHA-256 and closing marker, changes no schema.
- --apply: explicit manual apply with ID allowlist, expected database, and operator backup attestation.
- --auto: unattended mode with exact database match, MySQL GET_LOCK, hash-approved SQL files, quiet-period verification, PHP InnoDB backup, SHA-256 verification, post-backup file recheck, failure lock on partial migration, and migration history.
- scripts/approve_migration.php: developer authorizes a new SQL file hash before it can run automatically. Commit approved.json with the SQL.
- GitHub Actions migration-safety.yml tests parser, approval/stability, backup and full migration application against disposable MySQL.

## One-time Hostinger settings after CI succeeds
Edit the PRIVATE server-side public_html/.env file; preserve all existing credentials.
Add these values:
MIGRATIONS_ENABLED=1
MIGRATIONS_EXPECTED_DB=u826906339_mulawin_test

No permanent backup attestation is needed for --auto. The default private backup directory is:
 /home/u826906339/domains/azure-mosquito-762573.hostingersite.com/.fleetops-migration-private
It is created automatically with restricted permissions and is **outside public_html**.
Do not put SQL backups in public_html.

Run a one-time PHP Cron Job with:
 /usr/bin/php /home/u826906339/domains/azure-mosquito-762573.hostingersite.com/public_html/scripts/migrate.php --backup-test
Review output: the command must finish successfully, produce a SQL file with SHA-256, and execute NO migrations.
Review backup size, available disk and restore the backup in a disposable environment before production activation.
The CI restore test only verifies the disposable fixture, NOT production database recoverability.
If the database contains views, routines, events, triggers or non-InnoDB tables, built-in backup deliberately refuses to continue; establish verified native MySQL backups instead. If it fails, DO NOT enable --auto.

Once backup preflight and CI are green, replace the existing read-only cron job with:
 /usr/bin/php /home/u826906339/domains/azure-mosquito-762573.hostingersite.com/public_html/scripts/migrate.php --auto
Schedule: * * * * * (every minute), if Hostinger allows.
Do not run parallel cron entries executing --apply or --auto.

## Future SQL releases (developer workflow)
1. Add a SQL file to database/migrations using the standard naming convention. It should be backward-compatible with the newly deployed application.
2. Review SQL for irreversible/destructive operations. Confirm compatibility with existing production data.
3. Run locally: php scripts/approve_migration.php 2026-11-XX_20_example.sql
4. Commit BOTH the migration .sql and database/migrations/approved.json in the same GitHub push to luis.
5. GitHub Actions checks the release; Hostinger deploys luis automatically.
6. The scheduled --auto runner detects the approved pending SQL, waits at least five minutes for the relevant deployed files to remain unchanged, then takes a private backup before applying.
7. On failure, the runner leaves migration-failed.lock in the private directory. **Manual diagnosis and schema/history reconciliation** are required before retrying; never delete the lock without investigating.
8. Review the Hostinger Cron output and database history to verify completion.

## Important limits
- Hostinger Git integration does not supply this runner a cryptographically authenticated deployment-complete event. A 5-minute unchanged-file check **reduces but does not eliminate** the risk of overlapping an incomplete/stalled deployment. For truly guaranteed ordering, use a supported deployment pipeline with a documented completion trigger and maintenance/readiness controls.
- This backup implementation supports InnoDB base tables only, without views, triggers, stored routines, or events. The backup verifier checks file integrity, not full logical consistency or restorable production behavior.
- On MySQL, DDL is often nontransactional. If the nth statement fails, earlier DDL may remain applied. GET_LOCK and schema_migrations do not roll back partial migrations.
- Backup files contain sensitive database records. Keep private directory protected, avoid public download links, and set retention/disk monitoring manually. No automatic deletion was implemented to avoid unintentionally removing recovery copies.
- The current setup requires explicit review of each new SQL migration hash. It is automatic *execution of approved migrations*, not automatic approval of arbitrary SQL pushed to the branch.
- Do not enable unattended migrations on a production database until CI results and a fresh production backup/restore procedure have been reviewed.
