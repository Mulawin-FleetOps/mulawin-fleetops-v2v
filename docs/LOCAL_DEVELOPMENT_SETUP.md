# Local development setup report

Verified on November 10, 2026 (Asia/Manila).

Local URL: **http://mulawin-fleetops-v2v.test/**

| Component | Status | Details |
|---|---|---|
| Git repository | PASS | Existing clean checkout on `main`, commit `657a76137fc7b1ccd6956f1ecd2dfdc653de5e16`; remote `https://github.com/Mulawin-FleetOps/mulawin-fleetops-v2v.git`. Remote main matched this commit. No pull needed. |
| PHP | PASS | Herd PHP 8.6.0 RC3; required PDO MySQL, mbstring, fileinfo, and curl extensions loaded. |
| Laravel Herd | PASS | 2.0.2; running Nginx and PHP CGI; project folder is inside the existing parked `C:\Users\micha\Herd` directory. `herd which` selects LocalValetDriver. |
| MySQL | PASS | Running MySQL80 service; `SELECT VERSION()` returned 8.0.45; port 3306. |
| Database schema | PASS | Created previously absent `mulawin_v2`; 52/52 expected tables, all InnoDB, 112 foreign keys, 83 check constraints, 13 migration markers; foreign-key enforcement enabled. |
| Environment | PASS | `.env` copied from example and ignored by Git; 127.0.0.1:3306, database mulawin_v2, supplied root credentials, Asia/Manila; MySQL session timezone +08:00. No secrets included in this report. |
| Application startup | PASS | Root page and application HTML returned HTTP 200; `php scripts/preflight.php` returned READY with exit code 0. |
| Authentication | PASS | Created localadmin; 8 HTTP smoke assertions passed, including login, CSRF rejection, authenticated session, first-login gate, protected trip API, logout, and signed-out session. Password change remains for the user at first login. |
| Automated tests | PASS (executed subset) | Authentication source/generator suite: 32 passed, 0 failed. Web exposure suite: 58 passed, 0 failed. Database-reset integration suites were not executed. |
| Browser UI/console | NOT TESTED | Browser automation host unavailable. HTTP checks do not establish visual correctness or an error-free browser console. |

## Executable paths

| Tool | Version | Path |
|---|---|---|
| PHP | 8.6.0 RC3 | `C:\Users\micha\.config\herd\bin\php86\php.exe` (PATH wrapper: `C:\Users\micha\.config\herd\bin\php.bat`) |
| PHP configuration | — | `C:\Users\micha\.config\herd\bin\php86\php.ini` |
| Herd | 2.0.2 | `C:\Program Files\Herd\Herd.exe`; CLI `C:\Users\micha\.config\herd\bin\herd.bat` |
| Git | 2.54.0.windows.1 | `C:\Program Files\Git\cmd\git.exe` |
| Composer | 2.10.3 | `C:\Users\micha\.config\herd\bin\composer.bat` |
| Node.js | 24.16.0 | `C:\Program Files\nodejs\node.exe` |
| NPM | 11.15.0 | `C:\Program Files\nodejs\npm.ps1` |
| MySQL server | 8.0.45 | `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe` |

MySQL's command-line client was absent from PATH; PHP PDO handled inspection and import. No Composer manifest or frontend package manifest is present, and the app serves vendored frontend assets directly. No dependency installation or frontend build was required.

## Changes and startup

1. Started the installed Herd desktop app. The calling environment had `ELECTRON_RUN_AS_NODE=1`; this was omitted only for launching Herd, then restored in the calling process. No application was reinstalled.
2. Created ignored `.env` from `.env.example` and populated the supplied MySQL password. Existing timezone and local defaults were retained. INSTALL_TOKEN and SEED_TEST_TOKEN remain empty.
3. Added root `LocalValetDriver.php` for project-only Nginx routing. It serves static files only inside `public/`, executes the explicit application/installer entry points, refuses private directories and dot-paths case-insensitively, checks resolved static paths, and returns 404 for other paths. The browser seed endpoint is not routed. Existing `.htaccess` files were preserved; no Herd global configuration was edited.
4. Inspected existing database names and confirmed mulawin_v2 did not exist. Validated fresh SQL statement types and table references, then created mulawin_v2 with utf8mb4_unicode_ci and imported `database/schema.sql` (17 statements) followed by `database/extension.sql` (46 statements). Fresh SQL already contains the migration changes; individual migrations were not replayed. No optional masterlist or business test data was imported.
5. Created the requested local development Admin through `scripts/create_user.php`, using a generated password, and set its first-login password-change flag. Username: **localadmin**. Display name: Local Development Admin. Placeholder email: localadmin@mulawin.test.

Retrieve the temporary login password from `storage/private/local-admin.credentials.txt`. This file is ignored by Git and blocked from HTTP access. Complete the required password change when signing in. Replace the placeholder email and configure SMTP before using email verification features.

For later sessions, start Herd and MySQL80, then open the URL above. No `php artisan`, standalone PHP development server, or XAMPP is needed.

## Verification and limits

- PHP syntax: all 75 original PHP files passed `php -l`; the added driver passed separately (76 total).
- JavaScript syntax: all 18 application JavaScript files passed `node --check`.
- `php scripts/preflight.php`: READY, exit 0; all 15 backend modules load and all 20 tables checked by the script are accessible.
- Additional database inspection: every table declared by fresh SQL exists (52/52), all use InnoDB, foreign-key enforcement is on, and PHP/MySQL timezones agree.
- `php tests/auth_no_otp_tests.php`: 32 passed, 0 failed; includes 3,000 generated temporary-password samples. This suite checks source wiring and password generation, not the full authenticated workflow.
- `$env:TEST_BASE_URL='http://mulawin-fleetops-v2v.test'; $env:TEST_LAYOUT='public'; php tests/run_htaccess_tests.php`: 58 passed, 0 failed. This tests effective HTTP protection under Herd even though Apache rules themselves are not executed by Nginx.
- Additional live HTTP authentication smoke: 8 passed, 0 failed. Valid login returned 200; invalid CSRF returned 403; `me` reported `user.setup_required=true`; trip data returned 403 before password setup; logout with X-CSRF-Token returned 200 and whoami then reported signedIn=false.
- Unauthenticated `me` and trip data returned 401, GET login returned 405, and browser seed/private PHP paths returned 404/403 as applicable. HTML, API, CSS, JavaScript, and vendored Bootstrap assets were accessible.
- No port conflict was found: initially only MySQL listened on the inspected ports; after startup Herd owned 127.0.0.1:80 and PHP CGI 127.0.0.1:9086. Ports 443, 8000, 8080, and 9000 were not listening. This setup uses HTTP.
- `git diff --check` passed. No commits or pushes were performed; application business logic and remote main were not changed. GCT project files and databases were not modified.

The database-backed integration launchers call `test_recreate()`, which issues DROP DATABASE even for guarded test databases. They were intentionally not run because the setup instructions prohibit DROP DATABASE and equivalent resets. Full workflow, migration-chain, concurrent-action, upload, and email integration coverage therefore remains unverified.

No browser visual inspection or console capture was available. Successful login and first-login restrictions were verified through the actual HTTP API; the password-change form and authenticated dashboard were not exercised in a browser.

Optional integrations remain unconfigured: ORS_API_KEY is empty, so automatic road distance/address search is disabled and manual distance entry remains available; SMTP credentials are empty, so email verification and notices are not ready. These do not prevent username/password login or initial forced password setup.
