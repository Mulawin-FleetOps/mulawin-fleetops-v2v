# Hosting preparation (Hostinger or similar) — not yet tested on a real host

Tested only on: Apache 2.4 + PHP 8.3 + MariaDB 10.11 (local), with the `.htaccess` rules of this project.

Option 1 (simplest): upload the whole `RP_Mulawin_FMS_V2` folder inside `public_html`. The `.htaccess` files block
`backend`, `config`, `database`, `docs`, `scripts`, `storage`, `tests`, `.env` and `.sql`. Open `https://your-domain/RP_Mulawin_FMS_V2/`.

Option 2 (better): upload the folder OUTSIDE `public_html` and set the domain document root to `RP_Mulawin_FMS_V2/public`
(if the plan allows changing the document root).

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

## Automated test sa Hostinger TEST COPY

- Patakbuhin ang `tests\run_system_test.bat` sa laptop (hindi sa server), piliin ang `2) Hostinger`, at ilagay ang link ng
  **test copy**. Kailangang i-type ang `TEST` bago ito tumuloy. Huwag gamitin sa live na database.
- Hindi kailangang i-upload ang `tests/` folder (bawal din itong buksan sa web dahil sa `.htaccess`).
- Huwag i-upload ang `tests/system_test_accounts.json` at `tests/reports/`.
- Guide: `tests/SYSTEM_TEST_GUIDE.md`.
