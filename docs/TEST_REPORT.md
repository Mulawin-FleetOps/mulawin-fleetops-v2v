# Test report — 2026-10-31 (after the FMS PDF version 2 flow update)

Environment: Ubuntu 24.04, PHP 8.3.6, MariaDB 10.11.14, PHP built-in server, Chromium (Playwright).
Fresh empty database imported from `database/schema.sql` + `database/extension.sql`.

| Test | Result |
|---|---|
| `php -l` on every PHP file; `node --check` on every JS file | PASS |
| `scripts/preflight.php` (extensions, folders, every module loads, tables) | PASS |
| `tests/formula_test.php` (Billing P&L, fund categories, DRIVERS PAYROLL) — 15 checks | PASS |
| `tests/e2e_workflow.py` full workflow through the API (all 10 roles) — 191 checks, 0 failures | PASS |
| Scenario A: Ops Head creates trip → auto-assign → Pre-Assigned; no automatic fund | PASS |
| Fund request by dispatcher only (own team): 5 preset categories + added line, 100+100+300+50 = ₱550 | PASS |
| Fund approval by Operations Head only (Finance and Admin blocked) → Ready for Release | PASS |
| Finance releases before the checklist; cheque needs a cheque number | PASS |
| Dispatch blocked until trip Ready for Dispatch AND fund Released; no Ops Head clearance needed | PASS |
| Scenario B: delivery request → Pending Review → Ops Head confirms → Pre-Assigned | PASS |
| Fund rejected → dispatcher revises same request (₱20,900, still Ops Head: no ₱15,000 limit) → approved → released | PASS |
| Container: booking + pre-advice required before the checklist | PASS |
| Checklist: 57 items, NOT OK keeps trip Pre-Assigned, restart required, odometer check | PASS |
| Scenario C.1 minor: On Hold → Maintenance assesses Minor → Repaired - Cleared to Continue → Resume → In Transit, attempt stays 1 | PASS |
| Scenario C.2 major: For Reschedule, truck Under Maintenance → repair → Available → Reschedule → checklist → Confirm Redispatch (Second Attempt, same trip, both checklists kept) | PASS |
| Only Motorpool assesses; job cannot be completed before assessment | PASS |
| Preventive maintenance at 10,000 km: PM job created, truck Under Maintenance after the trip, km reset after PM | PASS |
| Liquidation updates the Trip Allowance expense | PASS |
| Purchasing: >₱10k Admin, ≤₱10k Finance; no budget → blocked; insufficient → "Rejected - Insufficient Budget" by system | PASS |
| Billing, payroll, documents, backup (unchanged flows) | PASS |
| Formula Settings: fund categories accept fixed amounts only; new preset used for new request (₱350), old request unchanged (₱550); P&L still uses fuel | PASS |
| Every page for every role in the browser (no JS errors, no failed sections, tabs clicked) | PASS |
| UI click-through: Create trip, Fund request form (live total ₱425), approve, Confirm release, checklist, disabled then enabled Confirm Dispatch, incident form, Assess damage, Confirm repair, Resume trip | PASS |
| Module isolation: broken `Funds.php` → funds page 503, Trips / Dashboard still 200 | PASS |

### Re-test 2026-11-01 (after grouping modules into department folders)

| Test | Result |
|---|---|
| `php -l` on every PHP file; `node --check` on every JS file | PASS |
| `scripts/preflight.php` (every module loads from its department folder) | PASS |
| `tests/formula_test.php` on a fresh database — 15 checks | PASS |
| `tests/e2e_workflow.py` — 191 checks, 0 failures | PASS |
| Every page for every role in the browser | PASS |
| UI click-through (create trip to resume trip) | PASS |
| Module isolation: broken `Accounting/Payroll.php` → payroll 503; trips, billing, dashboard still 200 | PASS |

### Re-test 2026-11-01 (after the navigation polish)

| Test | Result |
|---|---|
| `php -l` / `node --check` on every file | PASS |
| `scripts/preflight.php`; `tests/formula_test.php` on a fresh database (15 checks) | PASS |
| `tests/e2e_workflow.py` — 191 checks, 0 failures | PASS |
| Every page for every role, every tab, sub-tab (pills), table picker and "Show more charts" clicked: no JS errors, no failed sections | PASS |
| UI click-through (create trip to resume trip) | PASS |
| Pagination (Prev/Next, search resets to page 1), sidebar accordion, Back to top | PASS |
| Phone (390 px wide): no page wider than the screen | PASS |

Page height before → after (1440×900 screen, test data): Reports (Admin) 6,949 → 1,454 px; Reports (Audit) 5,858 → 1,454;
Formula Settings 4,806 → 900; Dashboard (Admin) 2,706 → 1,557; Dashboard (Ops Head) 1,724 → 1,394. Longest page now: 1,664 px.

### Re-test 2026-11-02 (FMS PDF v6 and v7 changes)

| Test | Result |
|---|---|
| `php -l` / `node --check` on every file; preflight; formula test on a fresh database (15 checks) | PASS |
| `tests/e2e_workflow.py` with the new billing checks: draft made at dispatch from the route rate; finalize blocked while ongoing, without waybill and before verify; only Billing finalizes; invoice only from finalized billings; edit blocked after finalize; billed twice blocked | PASS, 205 checks, 0 failures |
| Every page and tab for every role in the browser; UI click-through (dispatch makes a draft) | PASS |
| Migration `2026-11-02_billing_drafts.sql` on a copy without the table, imported twice | PASS (drafts for completed unbilled trips, Invoiced for billed trips, no duplicates) |

### Re-test 2026-11-02 (automated system test `tests/system_test.py`)

| Test | Result |
|---|---|
| `tests/system_test.py` on a fresh XAMPP-style database (`--reset`): accounts per role, security, master data, Scenario A, B, C.1, C.2, wing van, maintenance, purchasing, billing drafts and invoices, finance, payroll, formula settings, documents, backup, page access per role, restore of settings, browser click-through of every page, tab and sub-tab for all 10 roles with screenshots, phone width | PASS, 404 checks, 0 failures |
| Same script again on the same database (existing data, accounts reused) | PASS, 0 failures |
| Hostinger option (link + TEST confirmation) against the local server | PASS |
| `tests/e2e_workflow.py` after the login screen change | PASS, 0 failures |

Found by the system test and fixed: after a wrong password the login screen cleared the username. It now keeps the
username and puts the cursor on the password.

### Re-test 2026-11-02 (analytics polish)

| Test | Result |
|---|---|
| `tests/system_test.py` on a fresh database, now also clicking every dashboard card of all 10 roles (right page and tab) and Reports Print (this section and all sections, header and section count) | PASS, 434 checks, 0 failures |
| `tests/e2e_workflow.py` | PASS, 0 failures |
| Report printed to PDF (A4) and checked: header, white background, charts as images, full tables, one section per page | PASS |
| Phone width (390 px): no sideways scrolling | PASS |

### Re-test 2026-11-02 (language: English or Tagalog)

| Test | Result |
|---|---|
| `tests/system_test.py` on a fresh database, with the new language checks (own language saved on the account, only en / tl, every Admin page in Tagalog with no errors, switch back to English from the name menu) | PASS, 448 checks, 0 failures |
| Migration `2026-11-03_user_language.sql` on a database without the column, imported twice; login before the migration still works in English and the language change shows the import message | PASS |
| Backend messages seen in a full test run translated to Tagalog | 127 of 127 |
| `tests/e2e_workflow.py` (payroll period now covers the test day) | PASS, 0 failures |

### Re-test 2026-11-02 (account security, role limits, map)

| Test | Result |
|---|---|
| `tests/system_test.py` on a fresh database with the new checks: limits per role and per shift, Admin limit at least 1, recovery code (needs the current password, Admin only, wrong code refused, one-time use, dashes and small letters accepted), old session signed out after the reset, account lock after 5 wrong passwords from different sessions, unlock by Admin reset, map preview on Add route | PASS, 481 checks, 0 failures |
| Same script again on the same database (accounts reused, limits restored) | PASS, 0 failures |
| `tests/e2e_workflow.py` | PASS, 0 failures |
| `scripts/create_user.php` for a second Admin while the limit is 1 | Refused with the limit message (as designed) |

Not tested here: the Google Maps picture itself (the test machine cannot reach google.com); the map address and link are checked.

Notes:
- `tests/formula_test.php` compares with the Excel defaults, so run it on a database where Formula Settings were not changed.
- The Apache `.htaccess` rules were not changed in this update (last Apache test: PASS).

Not tested: real XAMPP on Windows, Hostinger, many users at the same time, mobile phones in depth, printing on a real printer.
