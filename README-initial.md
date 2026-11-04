# R.P. Mulawin Trucking — Fleet Management System V2 (Mulawin FleetOps)

Aligned build: the **folder structure of the V2 zip**, the **design of the `mulawin_fleetops` repo** (green sidebar, gold accent, Bootstrap 5, Chart.js),
the **workflow of the FMS PDF** (`R-P-Mulawin-Trucking_-Trucking-Manangement-System.pdf`; Scenario A, B at C ay galing sa
updated na bersyon 2 ng PDF), and the **formulas of the company Excel files**
(Billing P&L, Drivers Payroll, Car Carrier and Container Monitoring).

> Walang sample na kumpanya data. Bagong EMPTY database ang gamit. Ang Admin ang maglalagay ng totoong users, clients, trucks at crew.

---

## A. Install sa XAMPP (bagong empty database)

1. I-install ang **XAMPP (PHP 8.2 o mas bago)**. I-start ang **Apache** at **MySQL**.
2. I-copy ang folder na ito sa `C:\xampp\htdocs\RP_Mulawin_FMS_V2`.
   Dapat may `C:\xampp\htdocs\RP_Mulawin_FMS_V2\public\index.php`.
3. Buksan ang `http://localhost/phpmyadmin/` at gumawa ng **bagong empty database** na `mulawin_v2` (Collation: `utf8mb4_unicode_ci`).
4. Piliin ang database, tapos **Import** sa ganitong ayos:
   1. `database/schema.sql`
   2. `database/extension.sql`
   (Ang `database/migrations/` ay para lang sa existing na database na ina-update, halimbawa ang live.
   Hindi ito kailangan sa bagong install.)
5. I-copy ang `.env.example` at gawing `.env` (nasa mismong project folder). Sa default XAMPP:
   `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=mulawin_v2`, `DB_USER=root`, `DB_PASS=` (blank).
6. Gumawa ng **unang Admin account** (pumili ng isa):
   - **Command line (recommended):** buksan ang PowerShell sa project folder:
     `C:\xampp\php\php.exe scripts\create_user.php admin admin "Pangalan Mo"`
     Lalabas ang temporary password **isang beses lang**. Papalitan ito sa unang login.
   - **Browser:** ilagay sa `.env` ang `INSTALL_TOKEN=` na may 32+ random na characters, buksan ang
     `http://localhost/RP_Mulawin_FMS_V2/public/install.php`, at gumawa ng account.
     Pagkatapos, **burahin ang laman ng INSTALL_TOKEN** at **i-delete ang `public/install.php`**.
7. Buksan ang `http://localhost/RP_Mulawin_FMS_V2/` (diretso ito sa `public/`) at mag-login.
8. Optional check: `C:\xampp\php\php.exe scripts\preflight.php` (lahat dapat PASS) at
   `C:\xampp\php\php.exe tests\formula_test.php` (formula vs Excel).
9. Optional na buong automated test (TEST COPY LANG, XAMPP o Hostinger): `tests\run_system_test.bat`.
   Basahin muna ang `tests/SYSTEM_TEST_GUIDE.md`.

### Unang setup sa loob ng system (ayon sa role)

| Sino | Saan | Ano ang gagawin |
|---|---|---|
| Admin | Reports & Administration > User Accounts | Gumawa ng account kada empleyado at role |
| Admin | Fleet Management > Fleet Status & Trucks | Ilagay ang trucks (OR/CR, insurance, expiry, regular driver/helper) |
| Admin | Fleet Management > Drivers & Helpers | Ilagay ang drivers (may license expiry) at helpers (PDF v6: drivers at helpers lang) |
| Billing | Financial & Billing > Clients, Routes & Rates | Clients, routes (total km + RFID/toll), client rates |
| Finance | Finance & Payables > Record > Budget | Purchasing budget (kailangan bago ma-approve ang purchase) |
| Payroll | Payroll > Trip pay rates | Trip pay rate kada destination (driver at helper) |
| Purchasing | Parts Inventory | Parts at verified opening stock (Adjust stock) |
| Admin / Finance / Payroll | Formula Settings | I-check ang mga numero ng computation |

---

## B. Roles (FMS PDF "User Roles and Access")

`admin` (Admin / Head Management), `operations_head`, `car_carrier_dispatcher`, `container_wingvan_dispatcher`
(Day/Night shift = same team), `motorpool`, `purchasing`, `finance`, `billing`, `payroll`, `audit` (read-only).
Ang page access ay nasa `backend/Core/Access.php`; bawat module ay nagche-check ulit ng role bago mag-save.

## C. Main workflow (bagong FMS PDF: Scenario A, B at C)

```
Scenario A: Client → Operations Head gumagawa ng trip (truck type = dispatcher type)
            → SYSTEM auto-assigns truck, driver (+ driver 2 for car carrier), helper → "Pre-Assigned"
Scenario B: Client → Dispatcher gumagawa ng delivery request → "Pending Review"
            → Operations Head nire-review at kinukumpleto ang trip details (confirm)
            → SYSTEM auto-assigns → "Pre-Assigned"
Pareho sa A at B (sabay pwedeng gawin ang fund at ang checklist):
   → Dispatcher Fund Request: pipili ng preset categories (Forklift Operator ₱100, Checker ₱100,
     Passway ₱200, Driver Meal ₱300, Helper Meal ₱200) + pwedeng magdagdag; system ang nagko-compute ng total
   → Operations Head Fund Approval (lahat ng halaga): Approve = "Ready for Release" (lalabas sa Finance);
     Reject = babalik sa Dispatcher para i-revise at i-resubmit
   → Finance Confirm Release (pwede kahit hindi pa tapos ang checklist) → fund "Released"
   → Dispatcher: Start checklist (min. 15 min) → 57-item pre-dispatch checklist all OK → trip "Ready for Dispatch"
   → SYSTEM dispatch validation: Confirm Dispatch enabled lang kapag fund Released AT trip Ready for Dispatch
   → Dispatcher Confirm Dispatch → trip "Dispatched", fund "Completed"
   → Progress / delay (with cause) / waybill → Arrival checklist (odometer) → Submit completed trip
Container: confirm nomination/booking + pre-advice bago ang checklist. Wing Van: confirm with client + give truck details.
Scenario C (truck breakdown): Dispatcher Incident Report → trip "On Hold - Incident Reported" → Maintenance assesses:
   Minor: mechanic sa lokasyon → Maintenance "Repaired - Cleared to Continue" → Dispatcher Resume Trip → "In Transit"
          (hindi Second Attempt)
   Major: truck "Under Maintenance", trip "For Reschedule" → repair → truck Available → Dispatcher Reschedule Trip
          → pre-dispatch checklist ulit (fund kung kailangan) → Confirm Redispatch = Second Attempt
Preventive maintenance: km traveled (odometer out/in) is added; at 10,000 km (setting) the system creates the PM job.
Purchasing: Motorpool parts request → Purchasing releases from stock, or purchase request
          (≤ ₱10,000 Finance, > ₱10,000 Admin) → system budget check (insufficient = rejected by system)
          → PO → receipt (stock-in + payable + parts expense).
Billing: completed trips → invoice (many trips per invoice) → collections → outstanding / aging.
Payroll: attendance → payroll (wage + trip pay − deductions) → finalize (payslips) → Finance disburses.
```

## D. Folder structure at module isolation

```
index.php                      opens public/ when the project folder is visited
config/formulas.php            LAHAT NG DEFAULT NA NUMERO AT FORMULA (may Tagalog na paliwanag)
backend/bootstrap.php          shared: .env, session, database, input checks, audit, roles
backend/Actions.php            loads ONE module per request inside try/catch (module isolation)
backend/Data.php               session info (user, sidebar, notifications)
backend/Core/                  shared rules: Settings (formula engine), Access (pages/roles),
                               FleetState (truck status), TripFunds (fund request categories), Money, Notify
backend/Modules/<Department>/  modules naka-grupo ayon sa department (folder lang; hindi binago ang sidebar):
  Operations/                  Fleet.php, Trips.php, Inspections/Checklist.php (57-item checklist ng kumpanya)
  Maintenance/                 Maintenance.php, Purchasing.php (truck parts)
  Accounting/                  Funds.php, Finance.php, Billing.php, Payroll.php
  General/                     Analytics.php (dashboards/reports), Documents.php
  Administration/              Admin.php (users, formula settings, activity log, backup)
public/index.php               the only browser entry point (HTML shell + JSON API)
public/assets/js/core.js       shell, router, tables, forms, charts
public/assets/js/i18n.js       wika ng screen (English o Tagalog); salin sa public/assets/js/i18n/tl.js
public/assets/js/modules/<department>/   screen files, parehong grupo:
  operations/                  fleet.js, trips.js
  maintenance/                 maintenance.js, purchasing.js
  accounting/                  finance.js (Trip Funds at Finance), billing.js, payroll.js
  general/                     dashboard.js, documents.js, reports.js
  administration/              admin.js
public/assets/css/             layout.css + login.css (from the repo) and app.css
database/schema.sql            core tables          database/extension.sql   module tables
scripts/                       create_user.php, preflight.php
storage/private/               uploaded documents (not public)   storage/backups/   SQL backups
tests/                         formula_test.php, e2e_workflow.py, system_test.py (automated test, see SYSTEM_TEST_GUIDE.md)
docs/                          traceability, pending decisions, formula guide, test report
```

**Module isolation:** bawat page ay hiwalay na kumukuha ng data at hiwalay na module file (PHP at JS).
Kapag may error ang isang module (kahit syntax error), ang page lang na iyon ang may mensaheng
"temporarily unavailable"; gumagana pa rin ang ibang modules. Ito ay na-test (tingnan `docs/TEST_REPORT.md`).
Kapag patay ang buong database, lahat ng database pages ay hindi gagana (normal ito).

**Navigation:** isang sidebar section lang ang bukas, nakadikit ang page header, tabs sa mahahabang page
(Reports, Formula Settings, Finance), tables na 25 rows bawat page na may Prev at Next. Detalye: CHANGELOG (2026-11-01).

**Pagdagdag ng module:** idagdag sa `Actions::MODULES` (pangalan => department), gumawa ng
`backend/Modules/<Department>/<Name>.php`, idagdag ang pages sa `backend/Core/Access.php`, at kung may bagong
screen file, idagdag sa `$jsModules` ng `public/index.php`.

**Mga gabay:** may hiwalay na user guide bawat department (Operations, Maintenance, Accounting) at para sa
Admin at Audit, at isang Technical Documentation (architecture, API, database, data sources, security).

## E0. Wika ng screen (English o Tagalog)

Bawat user ay pipili sa dropdown ng pangalan niya (kanang itaas, kung nasaan ang Log Out): **English** (default) o
**Tagalog**. Naka-save ito sa account. Hindi isinasalin ang mga pangalan ng page, mga status at termino ng PDF at Excel,
at ang mga printout. Para magpalit o magdagdag ng salin: i-edit ang `public/assets/js/i18n/tl.js` (English ⇒ Tagalog).

## E. Pagbago ng formula (kahit hindi marunong mag-code)

1. **Formula Settings page** (Admin, Finance, Payroll): palitan ang numero, Save. May "Reset" pabalik sa default.
2. **`config/formulas.php`**: ang mga default na numero, may paliwanag sa Tagalog kada linya.
3. Ang mga lumang record ay hindi nagbabago; naka-save sa bawat fund request at payroll ang values na ginamit.
4. Lahat ng pagbabago ay nasa Activity Log. Detalyadong gabay: `docs/GABAY_PAGBAGO_NG_FORMULA.md`.

## F. Security at files

- Password: at least 8 characters na may letra at numero (hal. `test1234`). Palitan ang `PASSWORD_MIN_LENGTH` sa `backend/bootstrap.php` kung gusto ng mas mahaba.
- Password hashing, CSRF token sa bawat save, login throttle, auto logout (SESSION_IDLE_MINUTES), role check sa server.
- **Lock ng account:** 5 maling password (kahit saang computer) = naka-lock nang 15 minuto. Ang reset ng Admin ay nag-a-unlock din.
- **Recovery code ng Admin** (walang email ang system): pangalan > Recovery code, i-print at itago. Kapag nakalimutan o na-hack ang
  Admin password: sa login page, **Forgot the Admin password?** Isang beses lang gumagana ang code. Kapag napalitan ang password,
  mala-log out ang lahat ng lumang session ng account. Huling paraan (IT, may access sa server): `php scripts/reset_password.php USERNAME`.
- **Limit bawat role:** User Accounts > Limits per role (default: tig-iisa; dispatchers bawat shift; 0 = walang limit). Ang punong
  role ay hindi lalabas sa pagpipilian.
- **Mapa:** sa Add route at sa trip (Details at Map button) may Google Maps na mapa ng ruta (walang API key at walang bayad). Ang km ay
  tina-type pa rin sa Route; makikita ang layo sa "Open in Google Maps".
- Documents: PDF/JPG/PNG/WebP, 10 MB bawat file, hanggang 20 sabay; random file names sa `storage/private`; download lang via login + role check.
- Ang `.htaccess` ay nagbabawal sa `backend`, `config`, `database`, `docs`, `scripts`, `storage`, `tests`, `.env` at `.sql` (na-test sa Apache).
- Backup: Reports & Administration > Backup (SQL file). Kopyahin din ang `storage/private`. Restore: import sa bagong empty database.

## G. Mga hindi pa kumpirmado ng kumpanya

Kapag walang sagot sa PDF, gumamit ng default (karamihan galing sa repo o Excel) at may `TODO PENDING COMPANY CONFIRMATION`
na comment sa code. Listahan: `docs/PENDING_COMPANY_CONFIRMATION.md`.
