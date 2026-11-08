# Hosting preparation (Hostinger or similar) — not yet tested on a real host

Tested only on: Apache 2.4 + PHP 8.3 + MariaDB 10.11 (local), with the `.htaccess` rules of this project.

## Safest deployment layout (SECURITY_DOTPATH_BLOCK_V1)

**Recommended — only `public/` on the web.** Put the project OUTSIDE `public_html` and point the domain's document
root to its `public/` folder. Then `.env`, `.git`, `backend`, `storage`, backups and docs are simply not on the web.

```
/home/<account>/RP_Mulawin_FMS_V2/          <- project (NOT reachable from the web)
    .env  backend/  config/  database/  storage/  ...
    public/                                 <- domain document root (hPanel > Websites > Advanced / document root)
```
Hostinger Git deploy: deploy into `/home/<account>/RP_Mulawin_FMS_V2` (not into `public_html`), then set the
document root to `RP_Mulawin_FMS_V2/public`.

**Only if the plan cannot change the document root** — whole folder inside `public_html`. This works because the
`.htaccess` files block every dot-path (`.git`, `.env`, `.github`, ...; `/.well-known/` stays open for SSL) and the
folders `backend`, `config`, `database`, `docs`, `scripts`, `storage`, `tests`, `automation`, plus `.sql/.md/.bak/...`
files. It depends on `.htaccess` being honoured, so:
- Prefer uploading WITHOUT the `.git` folder (File Manager / zip upload). If you use Git deploy here, the `.git` folder
  is on the web server and only `.htaccess` keeps it private.
- Never leave copies like `RP_Mulawin_FMS_V2_old/` or `.zip` backups inside `public_html`.

**Check after every deployment** (read-only GET requests, from your laptop):
```
TEST_BASE_URL=https://your-domain TEST_LAYOUT=public php tests/run_htaccess_tests.php            (recommended layout)
TEST_BASE_URL=https://your-domain/RP_Mulawin_FMS_V2 php tests/run_htaccess_tests.php            (folder in public_html)
```
Every line must be PASS (for example `/.git/config`, `/.env`, `/storage/private/` not served; app and assets working).
Tested locally on Apache 2.4 (with and without mod_rewrite). Hostinger uses LiteSpeed, which reads the same
`.htaccess` rules — run the check there to confirm.

Steps: PHP 8.2+ with pdo_mysql, fileinfo, mbstring → create a NEW empty database and a database user → import
`database/schema.sql` then `database/extension.sql` → copy `.env.example` to `.env`, set `APP_ENV=production` and the
database values → create the first Admin (`php scripts/create_user.php admin <username> "<name>"` via SSH, or
`public/install.php` with a 32+ character INSTALL_TOKEN, then clear the token and delete install.php) → use HTTPS →
test every role on a staging copy first → schedule regular backups (Backup page) and copy `storage/private`.

## Updating an existing live database

When a new file appears in `database/migrations/`, the code change needs it. Steps: Admin > Backup > Create backup
(download it) → push or upload the new code → phpMyAdmin on Hostinger → choose the live database → Import the
migration file → open the system and check. Migrations so far:

| File | What it does |
|---|---|
| `2026-11-02_billing_drafts.sql` | Creates `billing_drafts` (FMS PDF v7 billing draft) and makes drafts for trips already on the road or completed but not yet invoiced. Safe to import once. |
| `2026-11-04_account_security.sql` | Adds `users.failed_logins`, `locked_until`, `recovery_hash` and `password_changed_at` (account lock, Admin recovery code, sign out of old sessions after a password change). Safe to import twice. Until it is imported, login still works without these protections. |
| `2026-11-03_user_language.sql` | Adds `users.language` (screen language per account: English default or Tagalog). Safe to import twice. Until it is imported the system still works in English, but changing the language shows a message to import it. |
| `2026-11-05_arrival_checklist.sql` | Arrival checklist: adds `inspections.kind` (Pre-Dispatch / Arrival), `damage_notes`, `maintenance_job_id` and one checklist per trip attempt per kind. **Import it together with the new code** (the new code needs these columns, and the old code cannot read two checklists per trip). Import once. |
| `2026-11-06_00_schema_migrations.sql` | Creates `schema_migrations`, the record of applied migrations. Before importing, remove from its INSERT the older migrations that are NOT applied on that server (the file explains how to check). From now on every migration starts by writing its name there, so a second import stops with "Duplicate entry" before changing anything. |
| `2026-11-06_01_phase1_supplier_snapshot_and_trip_key.sql` | Phase 1: supplier details saved in each purchase order (`supplier_name` ... `supplier_email`, old POs filled in from `suppliers`; `supplier_id` optional) and `trips.request_key` (blocks duplicate trips). Import after the file above, together with the Phase 1 code. |
| `2026-11-05_checklist_timer.sql` | Checklist timer: adds `checklist_starts` and `inspections.started_at`. Import **after** `2026-11-05_arrival_checklist.sql`, together with the new code. Import once. The minimum is set by the Admin in User Management > Settings. |

## Automated test sa Hostinger TEST COPY

- Patakbuhin ang `tests\run_system_test.bat` sa laptop (hindi sa server), piliin ang `2) Hostinger`, at ilagay ang link ng
  **test copy**. Kailangang i-type ang `TEST` bago ito tumuloy. Huwag gamitin sa live na database.
- Hindi kailangang i-upload ang `tests/` folder (bawal din itong buksan sa web dahil sa `.htaccess`).
- Huwag i-upload ang `tests/system_test_accounts.json` at `tests/reports/`.
- Guide: `tests/SYSTEM_TEST_GUIDE.md`.
