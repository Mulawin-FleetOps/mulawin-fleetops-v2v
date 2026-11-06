# Phase 1 — Validation and Purchasing (2026-11-06)

Branch: `feature/phase1-validation-purchasing` (from `main` at `b8dccf3`).

## What changed for users

| Who | Change |
| --- | --- |
| Purchasing Officer | New PO: type the supplier (name required; address, contact person, number, email optional). Suppliers used before are suggested and fill in their details. The Suppliers tab is gone. |
| Finance | PO payables, payment voucher and expense show the supplier typed in the PO. "Add payable": type the payee (the supplier dropdown is removed). |
| Operations Head / Dispatchers | A new trip, a changed schedule and a reschedule cannot be earlier than now (Philippine time, 5-minute grace) or more than 365 days ahead. Editing a not-yet-dispatched trip without changing its schedule still works, with a warning if the time has passed. Sending the same New Trip form twice makes one trip. |
| Operations Head | A driver always needs the license number and expiry. Phone numbers must be real phone numbers. Map pins must be complete and inside the Philippines. |
| Admin | New account and "Set new password" have a Confirm password field, checked on the server. |
| Everyone | Own password change and Admin recovery: confirmation checked on the server too. Passwords: 8 to 72 characters. |

## Changed files

| File | Change |
| --- | --- |
| `backend/bootstrap.php` | `intField` max, stricter `numberField` (+ max), new `phoneField`, `futureDateTimeField`, `MAX_QUANTITY`, `PASSWORD_MAX_BYTES` |
| `backend/Modules/Maintenance/Purchasing.php` | Supplier snapshot in `poCreate`, `supplierSuggestions`, LEFT JOIN + COALESCE in the order list and `poDetails`, quantity caps, phone check |
| `backend/Modules/Accounting/Finance.php` | PO payables and PO payment read the snapshot (LEFT JOIN) |
| `backend/Modules/General/Analytics.php` | Partially received POs report reads the snapshot (LEFT JOIN) |
| `backend/Modules/Operations/Trips.php` | `scheduleField`, `coordinates`, distance cap, `request_key`, schedule rule in create / review / edit / reschedule, caps on units and odometer |
| `backend/Modules/Operations/Fleet.php` | Driver license on every driver save; phone check |
| `backend/Modules/Operations/Clients.php` | Phone check |
| `backend/Modules/Administration/Admin.php` | Password max length; server-side confirmation (create, Admin set, own change) |
| `backend/Core/AccountSecurity.php` | Comment only (the system has email login codes) |
| `public/index.php` | Admin recovery: max length and confirmation on the server |
| `public/assets/js/core.js` | `UI.nowManila()`, `UI.uuid()`; recovery screen sends the confirmation |
| `public/assets/js/modules/maintenance/purchasing.js` | Supplier fields + suggestions; Suppliers tab removed; email on the printed PO |
| `public/assets/js/modules/accounting/finance.js` | Payable form without supplier dropdown |
| `public/assets/js/modules/operations/trips.js` | Schedule picker min/max in Philippine time, past-time message, form key, distance max |
| `public/assets/js/modules/administration/admin.js` | Confirm password fields |
| `database/extension.sql` | Fresh install: `schema_migrations`, PO snapshot columns, `trips.request_key` |
| `database/migrations/2026-11-06_00_schema_migrations.sql` | New |
| `database/migrations/2026-11-06_01_phase1_supplier_snapshot_and_trip_key.sql` | New |
| `CHANGELOG.md`, `docs/HOSTINGER_PREPARATION.md`, `docs/PHASE1_CHANGES.md` | Documentation |

No file was deleted. No table or column was deleted. The `suppliers` table and `Purchasing.supplier_save` stay (old data).

## How to install on an existing database (XAMPP or Hostinger)

1. Admin > Backup > Create backup, and download it. Also copy `storage/private`.
2. Copy the changed files over the old ones (same folders).
3. phpMyAdmin > the database > Import `database/migrations/2026-11-06_00_schema_migrations.sql`.
   Before importing, open it and remove from the INSERT any older migration that is NOT applied on that server
   (the file says how to check).
4. Import `database/migrations/2026-11-06_01_phase1_supplier_snapshot_and_trip_key.sql`.
   If it says `Duplicate entry ... for key 'PRIMARY'`, it was already imported: nothing was changed, do not retry.
5. Run `php scripts/preflight.php` (or open the system), log in, open Parts & Purchasing and Trip Management.

Fresh install: `schema.sql` + `extension.sql` as before (both migrations are already included and marked applied).

## Rollback

- Code only (usually enough): put back the previous files. The new columns are nullable and the old code ignores them.
  One exception: purchase orders created AFTER Phase 1 have no `supplier_id`, and the old code hides them from the
  PO list and Finance. So once new POs exist, roll back the database too, or stay on Phase 1.
- Code and database: restore the backup from step 1, then put back the previous files.

## Tests actually run (2026-11-05, local)

Environment: Ubuntu 24.04, PHP 8.3.6 built-in server, MariaDB 10.11.14, headless Chromium (Playwright).
Database: `schema.sql` + `extension.sql`, 9 test accounts (one per role), `scripts/seed_test_data.php`,
login through the real email OTP flow (local test mail server).

| Suite | Result |
| --- | --- |
| `php -l` on every PHP file, `node --check` on every JS file | clean |
| Baseline API regression (page access matrix for 9 roles x 15 pages, PO create/approve/receive/pay, trip create/review/edit) on the ORIGINAL code | 148 passed, 0 failed |
| Same baseline on the Phase 1 code | 148 passed, 0 failed |
| Phase 1 API tests (every new rule called directly through the API, role boundaries, old POs after migration) | 55 passed, 0 failed |
| Browser: every page for every role without JS errors or failed sections; PO form; trip schedule picker; new-account confirmation | 110 passed, 0 failed |
| Migration on a database with existing POs: old POs filled in; second import stopped by `schema_migrations` | passed |
| Fresh install vs upgraded database: same columns in `purchase_orders` and `trips` | identical |

Not yet run: your own `tests/` suite (not in the repository yet); XAMPP on Windows; Hostinger staging copy.

## Notes

- Bug found and fixed during testing: supplier suggestions showed empty details when the newest PO of a supplier
  had no address typed. Each field now takes the newest non-empty value (POs first, then the old supplier list).
- Docs list migrations that are not in the repository: `2026-11-02_billing_drafts.sql`, `2026-11-03_user_language.sql`
  and `2026-11-04_account_security.sql`. `billing_drafts` and `users.language` are not in the current schema either.
  Please send the files, or confirm they are obsolete so the docs can be corrected.
