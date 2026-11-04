# Technical Documentation: RP Mulawin FleetOps

Nov 1, 2026 · @kenneth

Ang dokumentong ito ang buong paliwanag ng system: paano ito binuo, paano gumagana ang bawat bahagi, saan galing ang data, at paano nagkakabit ang lahat. Pinapalitan nito ang naunang technical doc (v1), na may lumang mga file path bago ang department folders.

## 1. Overview at tech stack

Ang **Mulawin FleetOps** (RP\_Mulawin\_FMS\_V2) ay web system ng R.P. Mulawin Trucking para sa trips at dispatch, fleet, maintenance at purchasing, trip funds, finance, billing at payroll. Sinusunod nito ang workflow ng FMS PDF (bersyon 2: Scenario A, B at C) at ang mga formula ng Excel files ng kumpanya (Billing P&L at Drivers Payroll).

| Bahagi | Gamit | Paliwanag |
| --- | --- | --- |
| Server language | PHP 8.2 o mas bago | Walang framework. Plain PHP na may `declare(strict_types=1)`. |
| Database | MySQL o MariaDB (InnoDB, utf8mb4) | 44 tables. Konektado gamit ang PDO na may prepared statements. |
| Web server | Apache (XAMPP sa local, Hostinger sa live) | Gumagamit ng `.htaccess` para harangin ang mga private folder. |
| Frontend | Vanilla JavaScript (single-page app) | `core.js` at isang JS file bawat grupo ng pahina. Walang build step. |
| UI library | Bootstrap 5.3.3 at Bootstrap Icons 1.11.3 | Naka-vendor sa `public/assets/vendor` (walang CDN). |
| Charts | Chart.js 4.4.0 | Para sa dashboards at reports. Naka-vendor din. |
| Timezone | Asia/Manila | Pareho sa PHP at sa MySQL session. |

### Ang laki ng system

- 11 backend modules, naka-grupo sa 5 department folders.
- 10 roles, 22 na pahina.
- 44 database tables (11 sa `schema.sql`, 33 sa `extension.sql`).
- Mga 7,200 na linya ng PHP at JavaScript (hindi kasama ang vendor libraries).

### Mga prinsipyo ng pagkakagawa

1. **Isang pinto lang.** Lahat ng request ay dumadaan sa `public/index.php`.
2. **Modular.** Bawat module ay hiwalay na file. Kapag nasira ang isa, gumagana pa rin ang iba.
3. **Ang server ang nagpapasya.** Ang role check, validation at status rules ay nasa backend, hindi lang sa screen.
4. **Lahat ay nakatala.** Bawat mahalagang galaw ay may record sa `audit_events` (Activity Log).
5. **Formulas na nababago.** Ang mga numero ng computation ay nasa `config/formulas.php` at Formula Settings, hindi naka-hardcode.
6. **Taglish na comments** sa code, para madaling maintindihan ng susunod na developer.

## 2. Folder structure ayon sa department

Ang mga module ay naka-grupo sa folders ayon sa department. Hindi ito nagbabago ng sidebar; sa code at docs lang ang grupo.

| Department | Backend module (PHP) | Screen file (JS) | Mga pahina |
| --- | --- | --- | --- |
| Operations | `Operations/Fleet.php`, `Operations/Trips.php`, `Operations/Inspections/Checklist.php` | `operations/fleet.js`, `operations/trips.js` | Fleet Status & Trucks, Drivers & Helpers, Dispatch Board, Trip Records & Waybills, Incidents |
| Maintenance | `Maintenance/Maintenance.php`, `Maintenance/Purchasing.php` | `maintenance/maintenance.js`, `maintenance/purchasing.js` | Maintenance, Parts Inventory, Purchasing |
| Accounting | `Accounting/Funds.php`, `Finance.php`, `Billing.php`, `Payroll.php` | `accounting/finance.js`, `billing.js`, `payroll.js` | Trip Funds & Allowances, Finance & Payables, Billing & Collections, Clients Routes & Rates, Payroll, Attendance, Cash Advance & Balances |
| General | `General/Analytics.php`, `General/Documents.php` | `general/dashboard.js`, `documents.js`, `reports.js` | Dashboard, Documents, Reports & Analytics |
| Administration | `Administration/Admin.php` | `administration/admin.js` | User Accounts, Formula Settings, Activity Log, Backup |

Ang Trip Funds ay nasa Accounting sa backend (`Funds.php`), pero ang screen nito ay nasa `accounting/finance.js` dahil Finance ang nagre-release.

### Buong folder

```
RP_Mulawin_FMS_V2/
├─ index.php                 # nagre-redirect sa public/
├─ .env                      # DB at app settings (hindi kasama sa git)
├─ public/                   # ito lang ang bukas sa browser
│  ├─ index.php              # HTML shell + JSON API (isang pinto)
│  ├─ install.php            # unang Admin account (burahin pagkatapos)
│  └─ assets/
│     ├─ css/                # layout.css, login.css, app.css
│     ├─ js/core.js          # App, UI, api(), routing, tables, forms
│     ├─ js/modules/<department>/<file>.js
│     └─ vendor/             # Bootstrap, Bootstrap Icons, Chart.js
├─ backend/                  # bawal sa browser (.htaccess)
│  ├─ bootstrap.php          # env, session, db(), helpers, roles, audit()
│  ├─ Actions.php            # router: Module.action at page data
│  ├─ Data.php               # sino ang naka-login, sidebar, notifications
│  ├─ Core/                  # shared na rules ng lahat ng module
│  └─ Modules/<Department>/<Module>.php
├─ config/formulas.php       # default values ng formulas (galing Excel at PDF)
├─ database/schema.sql       # 11 core tables
├─ database/extension.sql    # 33 tables ng V2 workflow
├─ database/migrations/      # SQL para sa existing database (live)
├─ storage/backups/          # .sql backups
├─ storage/private/          # mga na-upload na documents
├─ scripts/                  # create_user.php, preflight.php
├─ tests/                    # formula_test.php, e2e_workflow.py, system_test.py
└─ docs/                     # guides, traceability, test report
```

### Ang Core (shared na rules)

| File | Gamit | Gumagamit |
| --- | --- | --- |
| `Access.php` | Listahan ng 22 na pahina: label, icon, sidebar section, module, JS file at roles na pwedeng magbukas | Actions, Data |
| `FleetState.php` | Iisang rule ng status ng truck: Available, Assigned, On Trip, Under Maintenance, Unavailable | Trips, Maintenance, Fleet |
| `TripFunds.php` | Fund request ng dispatcher (categories, computation, mga status) | Funds, Trips |
| `Money.php` | Payment details (method, cheque, bank, reference) at voucher number | Funds, Finance, Payroll |
| `Notify.php` | Notification sa bell. Kapag pumalya, hindi napipigil ang pangunahing transaksyon. | Lahat |
| `Settings.php` | Formula engine: binabasa ang `config/formulas.php` at ang mga binago sa Formula Settings | Trips, Fleet, Maintenance, Purchasing, Billing, Payroll, Documents, Analytics, Admin (at Funds sa TripFunds) |

Dagdag (PDF 7): `Core/BillingDraft.php` gumagawa ng billing draft bawat trip sa Confirm Dispatch, gamit ang client rate ng route. Tinatawag ng Trips (dispatch, at complete kung wala pang draft). Kapag pumalya, hindi napipigil ang dispatch.

## 3. Architecture at request lifecycle

&#91;embedded content: request lifecycle · browser hanggang database\]

Pagbalik, sumusunod ang sagot sa parehong daan pataas: ang module ay nagbabalik ng PHP array, ginagawang JSON ng `index.php` (`{"ok": true, "data": ...}` o `{"ok": false, "error": "..."}`), at ipinapakita ng screen.

### A. Pagbukas ng isang pahina (read)

1. Pinindot ng user ang pahina sa sidebar. Nagbabago ang URL hash, halimbawa `#trips` o `#payroll?period=3`.
2. `App.route()` sa `core.js` ang humahanap ng page definition (`App.page('trips', ...)`).
3. `App.data('trips', query)` ang tumatawag sa `GET index.php?api=data&page=trips`.
4. Sa `index.php`, ang `case 'data'` ay tumatawag sa `Actions::pageData()`.
5. `currentUser()` ang tumitingin ng session, idle timeout (default 60 minuto) at kung active pa ang user.
6. `Access::canOpen()` ang tumitingin kung kasama ang role sa listahan ng pahina. Kung hindi: 403.
7. `Actions::load()` ang nagre-require ng module file (halimbawa `Modules/Operations/Trips.php`).
8. `Trips::read($u, 'trips', $query)` ang nagbabasa sa database gamit ang `readSections()`. Kapag pumalya ang isang bahagi, walang laman lang ang bahaging iyon at may maliit na babala; tuloy ang iba.
9. Ibinabalik ang data bilang JSON at ang `render(ctx)` ng page ang gumuguhit ng tables, cards at charts.

### B. Pag-save o pag-approve (action)

1. Pinindot ng user ang button, halimbawa **Confirm Release**. Ang `UI.formModal()` ang nagpapakita ng form.
2. `App.api('Funds.release', data)` ang nagpapadala ng `POST index.php?api=Funds.release` na may header na `X-CSRF-Token`.
3. Sa `index.php`, ang `default` case ay nagche-check ng POST at CSRF, tapos `Actions::run()`.
4. Sinusuri ng `Actions::run()` ang pangalan (`Module.action`), ang user, at kung kailangan pang palitan ang password.
5. `Funds::action()` ang pumipili ng private function gamit ang `match`.
6. Sa loob: `requireRole()` para sa role, mga field helper (`idField`, `moneyField`, `dateField`) para sa input, at `must()` para sa business rules.
7. Lahat ng pagsulat ay nasa `transaction()`. Kapag may error kahit saan, walang nase-save (rollback).
8. Sa parehong transaksyon: `audit()` para sa Activity Log at `Notify::roles()` o `Notify::user()` para sa bell.
9. Ibinabalik ang `message` (at `warning` kung meron). Ang `UI.result()` ang nagpapakita ng toast at nire-reload ang pahina.

### C. Paano hinahawakan ang errors

| Uri | Galing sa | HTTP code | Makikita ng user |
| --- | --- | --- | --- |
| Business rule | `must()` o `BusinessRuleException` | 400, 403, 404, 409 | Ang mismong mensahe, halimbawa "The fund is not Ready for Release yet" |
| Hindi naka-login | `currentUser()` | 401 | Bumabalik sa login screen |
| Sirang module | `Actions::load()` | 503 | "The X module is temporarily unavailable. Other modules are still working." |
| Database error | `PDOException` | 500 | "This record already exists (duplicate)." o pangkalahatang mensahe; detalye ay nasa server error log |
| Iba pang error | `Throwable` | 500 | "Unexpected error. See the server error log." |

## 4. Frontend: paano gumagana ang screen

Ang screen ay **single-page app**: isang HTML page lang ang nilo-load (`public/index.php` na walang `?api=`), at ang JavaScript ang nagpapalit ng laman. Walang build tool; diretso ang mga `.js` file.

### A. Pagkakasunod ng pag-load

1. Nilo-load ng HTML shell ang Bootstrap, Chart.js, `core.js`, at ang 11 na screen files (`$jsModules` sa `index.php`). May `?v=<filemtime>` ang bawat file para laging bago kapag na-update.
2. Bawat screen file ay nagre-register ng mga pahina: `App.page('payroll', { title, subtitle, render(ctx) })`.
3. `App.start()` ang tumatawag sa `?api=whoami`. Kung hindi naka-login, login screen. Kung naka-login, `?api=me`.
4. Ang `?api=me` (`backend/Data.php`) ang nagbabalik ng user, CSRF token, sidebar (`Access::navFor`), notifications, pangalan at address ng kumpanya, truck types at role labels.
5. Kung `must_change_password`, ang change password screen muna. Kung hindi, `App.shell()` ang gumuguhit ng sidebar at header.
6. Bawat 60 segundo, `refreshBell()` ang kumukuha ulit ng notifications.

### B. Ang `core.js`

| Bahagi | Gamit |
| --- | --- |
| `App.request`, `App.api`, `App.data`, `App.upload` | Lahat ng tawag sa server. Kapag 401, balik sa login. |
| `App.route`, `App.go` | Router gamit ang URL hash (`#page?x=y`). Pahinang wala sa sidebar ng role ay balik sa Dashboard. |
| `ctx` ng bawat page | `page`, `query`, `el`, `tools`, `me`, `data`, `reload()`, `go()`, `setQuery()` |
| `UI.table`, `UI.activate` | Tables na may Search, bilang ng records, **CSV**, Prev at Next (25 rows bawat page), at action buttons bawat linya |
| `UI.formModal`, `UI.confirmAction`, `UI.modal` | Mga form at confirm. Pagka-save, toast at reload ng pahina. |
| `UI.field`, `UI.fields`, `UI.formData` | Mga input: text, number, money, date, select, textarea, checkbox, file at iba pa |
| `UI.blocks`, `UI.cards`, `UI.chartHtml`, `UI.drawChart` | Dashboard cards (may grupo kapag may group ang card), charts (maxCharts, ang iba ay nasa Show more) at tables (higit sa isa = iisang card na may pills; walang laman = isang linya) mula sa iisang spec ng backend |
| `UI.tabs` | Tabs sa loob ng pahina (naaalala ang huling tab). Ang UI.groupTabs ay tabs na may pills sa loob, halimbawa sa Finance at Formula Settings. |
| `UI.fundForm` | Form ng fund request (categories at total) |
| `UI.print` | Pag-print ng payslips, vouchers at forms |
| `UI.csv` | Excel-friendly na CSV (may BOM, at ligtas sa formula injection) |
| `UI.money`, `UI.date`, `UI.badge`, `UI.esc` | Format ng pera (₱), petsa, status badge, at escape ng text laban sa XSS |

### C. Ang isang page, halimbawa

```js
App.page('audit_log', {
  title: 'Activity Log',
  render(ctx) {
    const d = ctx.data;                   // galing sa Admin::read(..., 'audit_log')
    ctx.el.innerHTML = UI.table([...columns], d.events, { id: 'alog' });
    UI.activate(ctx.el);                  // binubuhay ang search, CSV at buttons
  },
});
```

### D. Hiwalay ang bawat page

- Kapag hindi na-load ang isang screen file, ang pahina lang na iyon ang may mensaheng "This module's screen ... did not load. Other modules still work."
- Kapag nag-error ang data o render ng isang pahina, "Only this page is affected." Gumagana pa rin ang sidebar at ibang pahina.
- Kapag may `_errors` ang data (isang bahagi ang pumalya), dilaw na babala lang sa itaas ng pahina.

### E. CSS

`layout.css` (sidebar, header, cards), `login.css` (login screen) at `app.css` (tables, badges, forms, print). Kulay: green na sidebar at gold na accent.

### F. Navigation (polish, 2026-11-01)

Para hindi mahaba at hindi nakaka-overwhelm ang mga page. Walang binago sa data, workflow o database.

| Ano | Saan sa code | Paano gumagana |
| --- | --- | --- |
| Accordion na sidebar | `App.openSection()` sa `core.js` | Isang section lang ang bukas; ang `route()` ang nagbubukas ng section ng current page |
| Nakadikit na header at Back to top | `.page-header-sticky`, `#toTop`, `window.onscroll` | Nakadikit ang title at buttons; nawawala ang subtitle habang naka-scroll; lumalabas ang Back to top pagkalipas ng 400px |
| Compact cards sa work pages | `#pageBody.work-page` sa `app.css` | Lahat ng page maliban sa Dashboard at Reports |
| Pagination | `UI.drawTable` (`t.page`, `t.limit`) | 25 rows bawat page; Search at CSV ay sakop ang lahat ng rows |
| Reports tabs at More filters | `general/reports.js` | Tab bawat section ng `Analytics::reports`; ang ibang filters ay nakatago hangga't walang gamit |
| Dashboard | `general/dashboard.js` (`maxCharts: 2`), `Analytics::group()` | Mga card ng Admin at Ops Head ay may grupo (Trips, Fleet, Pera) |
| Formula Settings | `administration/admin.js` | Tabs: Values (pill bawat group, editable muna, View only sa huli), Computation lists, Example |
| Finance & Payables | `accounting/finance.js` | Tabs: Gastos at Bayarin, Empleyado, Plano |

Resulta (pinakamahabang page): Reports 6,949px hanggang 1,454px, Formula Settings 4,806px hanggang 900px, Admin Dashboard 2,706px hanggang 1,557px. Wala nang page na lampas 1,700px sa test data.

## 5. API reference

Internal API ang system: ginagamit lang ng sariling screen, hindi public. Lahat ay nasa `public/index.php?api=...`, JSON ang sagot, at kailangan ng naka-login na session (maliban sa `whoami` at `login`).

### A. Mga endpoint

| Endpoint | Method | Ginagawa | Sumasagot |
| --- | --- | --- | --- |
| `?api=whoami` | GET | Kung naka-login at ang CSRF token | `{ok, signedIn, csrf}` |
| `?api=login` | POST (form + csrf) | Login. 5 maling subok sa loob ng 15 minuto ay haharangin. | `{ok}` |
| `?api=logout` | POST | Logout at sira ang session | `{ok}` |
| `?api=me` | GET | User, sidebar, notifications, company info, roles | `Data::me()` |
| `?api=data&page=<id>` | GET | Data ng isang pahina (kasama ang filters sa query string) | `<Module>::read()` |
| `?api=<Module>.<action>` | POST JSON + `X-CSRF-Token` | Pag-save, approve, release at iba pa | `<Module>::action()` |
| `?api=document_upload` | POST multipart | Upload ng isa o maraming file | `Documents::upload()` |
| `?api=document_download&id=<n>` | GET | Download o view (`&inline=1`) ng document | ang file |
| `?api=backup_download&file=<name>` | GET (Admin lang) | Download ng .sql backup | ang file |

Halimbawa ng tawag mula sa screen:

```js
await App.api('Funds.release', { fund_id: 6, payment_method: 'Cash', released_on: '2026-11-01' });
// POST index.php?api=Funds.release  →  {"ok":true,"data":{"fund_id":6,"message":"Fund released and disbursement recorded."}}
```

### B. Lahat ng actions

Ang "Tables" ay ang mga sinusulatan ng action (bukod sa `audit_events` at `notifications`, na halos lahat ay sinusulatan). "Dispatcher (sariling team)" = Car Carrier o Container / Wing Van Dispatcher, at dapat kanya ang trip.

**Operations: `Trips` (Modules/Operations/Trips.php)**

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| `Trips.create` | Operations Head, Dispatcher | Bagong trip (Scenario A) o delivery request (Scenario B) | trips, trip\_events |
| `Trips.review` | Operations Head | Approve o reject ng delivery request | trips, trip\_events |
| `Trips.auto_assign` | Operations Head, Dispatcher | Subukang mag-auto-assign ulit ng truck at crew | trips, vehicles, trip\_events |
| `Trips.reassign` | Operations Head | Manual na palit ng truck o crew, may dahilan | trips, vehicles |
| `Trips.details` | Operations Head, Dispatcher | I-edit ang detalye ng trip | trips |
| `Trips.checklist_start` | Dispatcher (sariling team) | Simulan ang Departure o Arrival checklist | inspections |
| `Trips.checklist_departure` | Dispatcher (sariling team) | I-save ang pre-dispatch checklist → Ready for Dispatch | inspections, trips |
| `Trips.dispatch` | Dispatcher (sariling team) | Confirm Dispatch (kailangan Released ang fund) | trips, fund\_requests, vehicles, personnel, vehicle\_status\_log |
| `Trips.progress` | Dispatcher (sariling team) | Trip update o delay | trip\_updates |
| `Trips.incident` | Dispatcher (sariling team) | Report incident → On Hold, gagawa ng maintenance job | incidents, maintenance\_jobs, trips |
| `Trips.arrival` | Dispatcher (sariling team) | Arrival checklist at odometer → Returned | inspections, trips, vehicles, maintenance\_jobs |
| `Trips.complete` | Dispatcher (sariling team) | Mark as Completed | trips |
| `Trips.resume` | Dispatcher (sariling team) | Ituloy ang trip pagkatapos ma-clear ang repair | incidents, trips |
| `Trips.reschedule` | Dispatcher (sariling team) | Bagong schedule ng trip na For Reschedule | trips |
| `Trips.cancel` | Operations Head | Cancel ng trip (at ng fund nito) | trips, fund\_requests |
| `Trips.waybill_add` | Dispatcher, Admin, Billing | I-record ang waybill | waybills |

**Operations: `Fleet` (Modules/Operations/Fleet.php)**

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| `Fleet.vehicle_save` | Admin | Bago o edit ng truck | vehicles |
| `Fleet.vehicle_status` | Admin, Motorpool | Palit ng status ng truck | vehicles, vehicle\_status\_log |
| `Fleet.vehicle_active` | Admin | Active o inactive na truck | vehicles |
| `Fleet.person_save` | Admin | Bago o edit ng driver, helper o staff | personnel |
| `Fleet.person_pay` | Admin, Payroll | Pay info (daily rate, frequency, group) | personnel |
| `Fleet.person_availability` | Admin, Operations Head | Available o unavailable na tao | personnel |

**Maintenance: `Maintenance` at `Purchasing`**

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| `Maintenance.job_add` | Motorpool | Manual na maintenance job | maintenance\_jobs, vehicles |
| `Maintenance.assess` | Motorpool | Assess ng incident: minor (repair on site) o major (For Reschedule) | maintenance\_jobs, incidents, trips, trip\_events |
| `Maintenance.job_update` | Motorpool | Status, mechanic, expected date | maintenance\_jobs |
| `Maintenance.job_complete` | Motorpool | Tapos ang repair → truck Available, PM reset | maintenance\_jobs, incidents, maintenance\_schedules, vehicles |
| `Maintenance.part_request` | Motorpool | Humingi ng parts sa Purchasing | part\_requests, maintenance\_jobs |
| `Maintenance.part_use` | Motorpool | Gamit na parts sa job | maintenance\_parts\_used |
| `Maintenance.cost_add` | Motorpool | Labor o ibang gastos | maintenance\_costs, expenses |
| `Maintenance.schedule_add` / `schedule_start` / `schedule_cancel` | Motorpool | Preventive maintenance schedule | maintenance\_schedules |
| `Purchasing.supplier_save` | Purchasing | Supplier | suppliers |
| `Purchasing.part_save` | Purchasing | Part sa inventory | parts |
| `Purchasing.adjust` | Purchasing | Adjust stock | parts, stock\_movements |
| `Purchasing.issue` | Purchasing | Release parts sa part request | parts, stock\_movements, part\_requests, maintenance\_jobs |
| `Purchasing.not_available` | Purchasing | Walang stock ng hiniling | part\_requests |
| `Purchasing.pr_create` | Purchasing | Purchase request (Finance kung ≤ ₱10,000, Admin kung lampas) | purchase\_requests |
| `Purchasing.decide` | Admin o Finance | Approve (may budget check) o reject | purchase\_requests, budgets |
| `Purchasing.po_create` | Purchasing | Purchase order | purchase\_orders, purchase\_requests |
| `Purchasing.receive` | Purchasing | Stock-in at gagawa ng payable | purchase\_orders, parts, stock\_movements, accounts\_payable, expenses |

**Accounting: `Funds`, `Finance`, `Billing`, `Payroll`**

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| `Funds.request` | Dispatcher (sariling team) | Fund request para sa Pre-Assigned trip | fund\_requests |
| `Funds.revise` | Dispatcher (sariling team) | Ayusin at ipasa ulit ang na-reject | fund\_requests |
| `Funds.approve` / `Funds.reject` | Operations Head | Approve → Ready for Release, o reject na may dahilan | fund\_requests |
| `Funds.release` | Finance | Confirm Release | fund\_requests, payment\_vouchers, disbursements, expenses |
| `Funds.liquidate` | Finance | Liquidation ng nagastos | fund\_requests, expenses |
| `Finance.expense_add` | Finance | Gastos | expenses, disbursements |
| `Finance.payable_add` / `payable_pay` | Finance | Payable at bayad nito | accounts\_payable, disbursements |
| `Finance.budget_set` | Finance | Budget (halimbawa Purchasing) | budgets |
| `Finance.cash_advance` | Finance | Cash advance sa empleyado | disbursements, employee\_ledgers, ledger\_entries |
| `Finance.payroll_disburse` | Finance | Bayaran ang payroll na na-submit | payroll\_periods, disbursements, expenses |
| `Billing.client_save` / `rate_save` | Admin, Billing | Client at client rates | clients, client\_rates |
| `Billing.route_save` | Admin, Operations Head, Billing | Route (km at RFID/toll) | routes |
| `Billing.invoice_create` | Billing | Invoice mula sa completed trips | billings, billing\_items |
| `Billing.invoice_cancel` | Billing | Cancel (kung walang bayad pa) | billings, billing\_items |
| `Billing.collection_add` | Billing | Bayad ng client | collections, billings |
| `Payroll.rate_save` | Payroll | Trip pay rate | trip\_pay\_rates |
| `Payroll.period_create` / `period_compute` | Payroll | Bagong payroll at recompute | payroll\_periods, payroll\_lines |
| `Payroll.line_update` / `line_add` / `line_remove` | Payroll | Ayusin ang linya ng empleyado | payroll\_lines |
| `Payroll.finalize` / `reopen` / `submit` | Payroll | Finalize (ibabawas ang hulog), reopen, submit sa Finance | payroll\_periods, ledger\_entries, employee\_ledgers |
| `Payroll.attendance_save` | Payroll | Attendance | attendance |
| `Payroll.ledger_add` / `ledger_payment` / `ledger_installment` | Payroll | Cash advance, uniform, damages, cash bond | employee\_ledgers, ledger\_entries |

**Billing drafts (PDF 7, idinagdag 2026-11-02)**

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| (system) sa `Trips.dispatch` | System | Billing draft ng trip batay sa client rate ng route | billing\_drafts |
| `Billing.draft_update` | Billing | Ayusin ang basis, quantity, rate at description habang Draft | billing\_drafts |
| `Billing.draft_verify` | Billing | Verified na ang required documents (kailangan may waybill) | billing\_drafts |
| `Billing.draft_finalize` | Billing | Finalize: trip Completed + verified + may rate | billing\_drafts |
| `Billing.draft_reopen` | Billing | Ibalik sa Draft ang finalized na hindi pa naka-invoice (may dahilan) | billing\_drafts |
| `Billing.invoice_create` | Billing | Invoice mula sa finalized billings (`draft_ids`), hindi na tina-type ang rate | billings, billing\_items, billing\_drafts |
| `Billing.invoice_cancel` | Billing | Cancel; babalik sa Finalized ang mga billing | billings, billing\_items, billing\_drafts |

PDF 6: ang `Fleet.person_save` ay Driver o Helper na lang, wala nang Employee/Contractor at Active/Resigned sa screen. Para sa drivers at helpers lang ang Payroll at cash advance.

**Administration: `Admin`** (General: `Analytics` ay read lang; `Documents` ay sa upload/download endpoint)

| Action | Sino | Ginagawa | Tables |
| --- | --- | --- | --- |
| `Admin.user_save` / `user_toggle` / `user_password` | Admin | Account, activate/deactivate, reset password | users |
| `Admin.change_password` | Lahat (sarili) | Palit ng sariling password | users |
| `Admin.setting_save` / `setting_reset` | Ayon sa group (Admin, Finance, Payroll) | Isang formula value | app\_settings |
| `Admin.items_save` / `items_reset` | Ayon sa listahan | Computation lists | formula\_items |
| `Admin.backup_create` | Admin | Gumawa ng .sql backup | (file sa storage/backups) |
| `Admin.notifications_read` | Lahat | Markahan na nabasa | notifications |

## 6. Paano gumagana ang bawat module sa backend

### A. Operations: Trips at Fleet

&#91;embedded content: trip status flow · Scenario A, B at C\]

Ang Scenario A ay diretso sa auto-assign (Pre-Assigned o Awaiting Resources). Ang Scenario B ay dumadaan muna sa Pending Review. Ang arrival ay galing sa Dispatched o In Transit. Ang Rejected (review) at Cancelled (Operations Head, bago umalis) ay mga dulo na hindi na tumutuloy.

**Auto-assign (`Trips::autoAssign`).** Kapag na-confirm ang trip, naghahanap ang system ng truck at crew:

1. Truck: active, tamang truck type, walang bukas na maintenance job, at walang ibang trip sa parehong araw. Kung ngayong araw ang trip, Available lang; kung sa susunod, pwede rin ang Assigned o On Trip.
2. Pagkakasunod: unahin ang hindi pa aabot sa preventive maintenance (10,000 km), tapos ang may pinakakaunting trip sa huling 30 araw (fair rotation), tapos ang pinakamababang km mula sa huling PM.
3. Driver: may valid na license, libre sa araw na iyon, at pinakakaunting trip. Kung kasama sa listahan ang regular driver ng truck, siya ang pipiliin.
4. Car Carrier: dalawang driver. Container at Wing Van: driver at helper.
5. Kapag kumpleto: `Pre-Assigned`, truck ay `Assigned`. Kapag kulang: `Awaiting Resources` na may dahilan.
6. Naka-lock ang truck row (`FOR UPDATE`) para hindi makuha ng dalawang dispatcher ang iisang truck.

**Confirm Dispatch (`Trips::dispatchBlockers`).** Enabled lang kapag ang trip ay `Ready for Dispatch` at ang fund ay `Released`. Sa redispatch (attempt 2 pataas), optional ang fund. Pagka-dispatch: truck at crew ay `On Trip`, fund ay `Completed`.

**Arrival.** Kailangang mas mataas ang arrival odometer kaysa departure. Idinadagdag ang km sa truck; kapag umabot sa 10,000 km mula sa huling PM, gagawa ng preventive maintenance schedule (at kung naka-on ang auto hold, Under Maintenance ang truck).

**Bawat pagbabago ng status** ay may record sa `trip_events` at `audit_events`. Ang `FleetState` ang iisang lugar na nagbabago ng status ng truck at nagtatala sa `vehicle_status_log`.

### B. Accounting: Trip Funds

1. Dispatcher: `Funds.request` gamit ang preset categories (Forklift Operator 100, Checker 100, Passway 200, Driver Meal Allowance 300, Helper Meal Allowance 200, mula sa Formula Settings). Status: `Pending Approval`.
2. Operations Head: approve → `Ready for Release`, o reject na may dahilan → `Rejected` (pwedeng i-revise at ipasa ulit).
3. Finance: `Funds.release` → `Released`. Gagawa ng payment voucher, disbursement at expense (category Trip Allowance).
4. Dispatch → `Completed`. Kapag na-cancel ang trip → `Cancelled`.
5. Finance: liquidation. Ang expense ay papalitan ng aktuwal na nagastos at itatala ang ibinalik.

### C. Maintenance at Purchasing

1. Incident mula sa Operations → `incidents` (Reported) at `maintenance_jobs` (source Incident).
2. `Maintenance.assess`: **Minor** → incident Under Repair, mechanic sa lugar. **Major** → truck Under Maintenance, trip at incident For Reschedule.
3. `Maintenance.job_complete`: incident `Repaired - Cleared to Continue` (minor) o `Resolved` (major), truck balik sa Available sa pamamagitan ng `FleetState::reconcile`, at reset ng PM km kung preventive.
4. Parts: `part_request` → Purchasing `issue` (bawas stock) o `not_available` → `pr_create`.
5. Purchase request: approver ay Finance kung ≤ ₱10,000, Admin kung lampas. Sa approve, sinusuri ang active na Purchasing budget; kapag kulang, kusang `Rejected - Insufficient Budget`.
6. `po_create` → `receive`: dagdag stock, `stock_movements`, `accounts_payable` at expense.

### D. Accounting: Finance, Billing at Payroll

- **Finance:** expenses, payables at bayad, budgets, cash advance, at disbursement ng payroll. Lahat ng labas ng pera ay dumadaan sa `Money::paymentFields` at `Money::voucher`, kaya pare-pareho ang payment details at may voucher number.
- **Billing:** invoice mula sa completed trips. Bawat linya: rate × quantity (Per Trip, Per Unit o Per KM). Net = gross − discount. Mula 2026-11-02 (PDF 7), galing ang invoice sa finalized billing drafts; kailangan Completed at verified ang documents (tingnan ang G). `collection_add` ang nagbabawas ng balance ng invoice.
- **Payroll:** `period_create` ang kumukuha ng tao sa payroll group, attendance at completed trips na may waybill, tapos kinukuwenta ang bawat linya gamit ang `Settings` (tingnan ang section 9). `finalize` ang nagbabawas ng hulog sa `employee_ledgers`; `reopen` ang nagbabalik nito; `submit` ang nagpapasa sa Finance.

### E. General: Analytics at Documents

- **Analytics** ay read lang. Iba ang dashboard bawat role (Management, Operations, Dispatcher, Maintenance, Purchasing, Finance, Billing, Payroll, Audit). Iisang format ang ibinabalik (`title`, `alerts`, `cards`, `charts`, `tables`) na ginuguhit ng `UI.blocks`. Tuwing nilo-load ang dashboard, tumatakbo ang `Notify::dailyReminders` (expiring documents at licenses, low stock, maintenance due), isang beses bawat araw bawat record.
- **Charts (display lang):** ang `Analytics::chart()` ay may `$opt`: `format` = `'money'` (₱ sa axis at tooltip), `horizontal` (pahigang bar para sa mahahabang pangalan), `stacked` (Parts + Labor + Other). Sa `core.js`, ang `UI.chartConfig` ang gumagawa ng Chart.js settings, ang `UI.meaningColors` ang iisang kulay bawat kahulugan (status, Billed, Collected, Expenses, aging), at ang doughnut tooltip ay may porsyento. Ang mga bilang ay buong numero lang sa axis.
- **Card links:** ang `page` ng card ay pwedeng `page`, `page?filter=x` o `page#tab=key` (`_` = pangunahing tabs, ibang key = tab group, halimbawa `finance#fin=money&fin:money=exp`). Ang `UI.goTo` ang nagse-set ng tab na bubuksan, at ang `UI.canGo` ang nagtatago ng link kapag wala sa menu ng role ang page.
- **Print ng Reports:** ang `UI.printReport(sections, meta)` ang gumagawa ng print (header na may kumpanya, period, filters at kung sino ang nag-print, cards, charts bilang larawan mula sa `UI.chartImage`, at buong tables). Laging bago ang laman ng `#printArea`, kaya hindi na lumalabas ang lumang payslip o blangkong page.
- **Wika ng screen (English o Tagalog):** naka-save sa `users.language` (`en` default, `tl`), pinapalitan ng user mismo sa `Admin.set_language` (lahat ng role, sarili lang). Ang `public/assets/js/i18n.js` ang tagasalin: pagka-render, isinasalin ang text, placeholder, title at aria-label gamit ang `public/assets/js/i18n/tl.js` (eksaktong parirala, patterns para sa mensaheng may numero o pangalan, at mga parirala sa loob ng mas mahabang mensahe). Hindi isinasalin ang sidebar, breadcrumb at page title (pangalan ng page), ang `#printArea` (printouts) at anumang may class na `no-i18n`; wala sa diksiyunaryo ang mga status at termino ng PDF at Excel. Ang `i18n/en.js` ay para sa ilang tekstong Tagalog sa source kapag English ang napili. Migration para sa live: `database/migrations/2026-11-03_user_language.sql` (ligtas kahit dalawang beses; bago ito ma-import, gumagana pa rin ang system sa English).
- **Documents:** upload sa `storage/private` (random na pangalan, hindi ang orihinal; PDF, JPG, PNG o WebP lang, hanggang 10 MB bawat file), record sa `documents`, at may rules kung aling role ang pwedeng mag-upload o tumingin ng bawat uri. Download ay dumadaan lang sa `?api=document_download`.

### F. Administration

Users, Formula Settings (`app_settings` at `formula_items`), Activity Log (`audit_events`) at Backup (sinusulat ng PHP ang buong database bilang .sql sa `storage/backups`).

### G. Billing draft (PDF 7)

1. **Confirm Dispatch** (ongoing na ang trip): `BillingDraft::createFor` ang gumagawa ng draft. Rate = client rate ng client + route + truck type (route-specific muna, tapos "Any route"). Quantity: Per Trip = 1, Per Unit = units planned, Per KM = route km. Walang rate = draft pa rin, `rate` ay NULL.
2. **Billing > Billing drafts**: Edit (habang Draft), **Verify documents** (kailangan may waybill), **Finalize** (trip Completed + verified + may rate).
3. **Ready to invoice**: naka-grupo per client ang Finalized. Ang invoice ay gumagawa ng `billings` at `billing_items` mula sa drafts, tapos `Invoiced` na ang draft.
4. **Cancel invoice**: binubura ang `billing_items` at bumabalik sa Finalized ang drafts.
5. Isang draft lang bawat trip (`trip_id` UNIQUE), kahit may Second Attempt.

Status: `Draft` → `Finalized` → `Invoiced` (at pabalik sa `Draft` gamit ang Return to draft, o sa `Finalized` kapag na-cancel ang invoice).

## 7. Database

MySQL o MariaDB, InnoDB engine, `utf8mb4`. 44 tables: 11 sa `database/schema.sql` (core) at 33 sa `database/extension.sql` (V2 workflow). I-import nang magkasunod. May 73 na foreign keys, kaya hindi pwedeng mag-save ng record na tumuturo sa wala.

&#91;embedded content: pangunahing relationships · bawat linya ay foreign key\]

Sa kaliwa ang mga "master" na tinuturo ng trip; sa kanan ang mga record na ginagawa habang tumatakbo ang trip. Ang `payroll_lines` ay nakakabit sa `personnel`; ang `maintenance_jobs` sa `incidents` (at sa `vehicles` at `trips`); ang `billing_items` sa `trips` at `billings`.

### A. Lahat ng tables ayon sa area

| Area | Table | Laman at mahahalagang columns | Nakakabit sa (FK) |
| --- | --- | --- | --- |
| Access | `users` | username, password\_hash, full\_name, role, shift, active, must\_change\_password, last\_login\_at |  |
| Access | `audit_events` | Activity Log: actor\_id, area, record\_ref, action, details, created\_at | users |
| Access | `notifications` | Bell: user\_id, category, message, page, dedupe\_key, is\_read | users |
| Settings | `app_settings` | Binagong formula values: setting\_key, setting\_value | users |
| Settings | `formula_items` | Computation lists: scope, name, calc, amount, divisor, only\_if\_attended, ledger, active | users |
| Fleet | `vehicles` | plate\_number, truck\_type, OR/CR, registration at insurance, status, odometer\_km, km\_since\_pm, assigned driver at helper | personnel |
| Fleet | `vehicle_status_log` | Kasaysayan ng status ng truck: from\_status, to\_status, reason | vehicles, users |
| Fleet | `personnel` | Drivers, helpers, staff: person\_type, employment\_status, license\_expiry, availability, payroll\_group, pay\_frequency, daily\_rate |  |
| Operations | `trips` | Ang trip: trip\_ref, intake\_source, truck\_type, dispatcher\_role, route, schedule, container/seal/shipment, client\_rate, truck at crew, status, attempt\_number | clients, routes, vehicles, personnel, users |
| Operations | `trip_events` | Bawat palit ng status: from\_status, to\_status, notes | trips, users |
| Operations | `trip_updates` | Progress at delay: update\_type, delay\_cause, note | trips, users |
| Operations | `inspections` | Departure at Arrival checklist: items\_json, odometer\_km, fuel\_level, has\_not\_ok | trips, vehicles, users |
| Operations | `incidents` | Incident: severity (Minor/Major), details, problem, location, status | trips, vehicles, users |
| Operations | `waybills` | waybill\_number, client\_waybill\_number, dr\_number, units, submitted\_on | trips, users |
| Maintenance | `maintenance_jobs` | job\_number, source (Manual, Incident, Preventive), maintenance\_type, status, expected\_completion | vehicles, incidents, trips |
| Maintenance | `maintenance_schedules` | Preventive maintenance: due\_on, due\_odometer\_km, status | vehicles, maintenance\_jobs |
| Maintenance | `maintenance_costs` | Labor at iba pang gastos ng job | maintenance\_jobs |
| Maintenance | `maintenance_parts_used` | Parts na nagamit sa job, quantity, unit\_cost | maintenance\_jobs, part\_requests, parts |
| Purchasing | `parts` | part\_number, description, unit\_cost, reorder\_level, quantity\_on\_hand | suppliers |
| Purchasing | `stock_movements` | Bawat galaw ng stock: movement\_type, quantity\_delta, reference | parts |
| Purchasing | `part_requests` | Hiling ng Motorpool: requested\_qty, status | vehicles, maintenance\_jobs, parts |
| Purchasing | `purchase_requests` | pr\_number, quantity, amount, approver\_role, status, budget\_id | parts, part\_requests, suppliers |
| Purchasing | `purchase_orders` | po\_number, ordered\_on, expected\_on, received\_on, warranty\_until | purchase\_requests, suppliers |
| Purchasing | `suppliers` | Supplier details |  |
| Funds | `fund_requests` | amount, breakdown\_json, status, approve, release at liquidation details | trips |
| Finance | `expenses` | category, amount, incurred\_on, source at source\_id (saan galing) | trips, vehicles |
| Finance | `disbursements` | Lahat ng labas ng pera: source\_type, payment\_method, cheque, bank, reference, amount | payment\_vouchers, users |
| Finance | `payment_vouchers` | voucher\_number, reference\_type, payee, amount, status | users |
| Finance | `accounts_payable` | Utang sa supplier: amount, paid\_amount, due\_on, status | suppliers |
| Finance | `budgets` | category, budget\_amount, used\_amount, period, status | users |
| Billing | `clients` | name, company\_name, contact, payment\_terms\_days |  |
| Billing | `routes` | origin, destination, distance\_km, toll\_fee |  |
| Billing | `client_rates` | truck\_type, rate\_basis, amount, effective\_on | clients, routes |
| Billing | `billings` | invoice\_number, invoice\_date, due\_date, gross\_amount, discount, net\_amount, status | clients |
| Billing | `billing_items` | Linya ng invoice: rate\_basis, quantity, rate, amount | billings, trips |
| Billing | `collections` | Bayad: amount, payment\_date, payment\_method, reference | billings |
| Payroll | `trip_pay_rates` | driver\_rate at helper\_rate bawat truck type at route o destination | routes |
| Payroll | `attendance` | work\_date, status (Present, Absent, VL, SIL, Rest Day) | personnel |
| Payroll | `payroll_periods` | period\_name, payroll\_group, date\_from, date\_to, status, formula\_snapshot |  |
| Payroll | `payroll_lines` | daily\_rate, days\_worked, trips\_count, regular\_wage, trip\_pay, earnings\_json, deductions\_json, gross\_pay, net\_pay | payroll\_periods, personnel |
| Payroll | `employee_ledgers` | Cash Advance, Uniform, Damages, Cash Bond: total\_amount, installment, balance, status | personnel |
| Payroll | `ledger_entries` | Bawat bawas o bayad sa ledger | employee\_ledgers |
| Records | `documents` | category, entity\_type, entity\_id, original\_filename, storage\_name, expires\_on | users |

| Area | Table | Laman at mahahalagang columns | Nakakabit sa (FK) |
| --- | --- | --- | --- |
| Billing (PDF 7) | `billing_drafts` | Isang billing bawat trip: rate\_basis, quantity, rate, amount, status (Draft, Finalized, Invoiced), docs\_verified\_by/at, finalized\_by/at, billing\_id | trips, clients, users, billings |

PDF 6: ang `personnel.person_type` ay Driver o Helper na lang. Nasa database pa ang `employment_type` at `employment_status` para sa lumang records, pero hindi na ipinapakita; laging `Active` ang bago.

### B. Mga patakaran sa data

- **Pera** ay `DECIMAL`, hindi float, at ipinapasok bilang string mula sa `moneyField()`.
- **Mga status** ay plain text na sinusuri ng code (halimbawa `Trips::STATUSES`), para madaling basahin sa phpMyAdmin.
- **`attempt_number`** sa trips, fund\_requests, inspections at incidents ang naghihiwalay ng unang biyahe at ng redispatch (Second Attempt).
- **`source` at `source_id`** sa expenses, accounts\_payable at employee\_ledgers ang nagsasabi kung saan galing ang record (halimbawa "Fund Release" at ang id ng fund request).
- **`formula_snapshot`** sa payroll\_periods ang nagtatago ng formula values na ginamit (sine-save pagka-Finalize), kaya hindi nagbabago ang lumang payroll kahit baguhin ang Formula Settings.
- **Reference numbers** (TRP para sa trip, JOB, PR, PO at PV para sa voucher) ay ginagawa ng `refNumber()` mula sa prefix at id. Ang invoice number ay tina-type ng Billing at sinusuring hindi pa nagamit.

## 8. Saan kinukuha ng bawat pahina ang data

Bawat pahina ay may iisang `read()` sa module nito. Ang `Access.php` ang nagsasabi kung aling module ang may-ari ng pahina. Ang listahan sa ibaba ay ang mga table na binabasa (SELECT at JOIN).

| Pahina (sidebar) | Page id | Backend | Mga table na binabasa |
| --- | --- | --- | --- |
| Dashboard | `dashboard` | `Analytics::read` (iba bawat role) | Ayon sa role: trips, vehicles, personnel, maintenance\_jobs, fund\_requests, billings, collections, expenses, disbursements, payroll\_periods, payroll\_lines, parts, purchase\_requests, documents, audit\_events. Sumusulat din ng notifications (daily reminders). |
| Fleet Status & Trucks | `fleet` | `Fleet::read` | vehicles, personnel (regular crew), trips (aktibong trip), maintenance\_jobs, vehicle\_status\_log, users |
| Drivers & Helpers | `crew` | `Fleet::read` | personnel, trips, vehicles, clients |
| Dispatch Board | `trips` | `Trips::read` | trips, clients, routes, vehicles, personnel, fund\_requests, inspections, trip\_updates, trip\_events, users. Checklist items mula sa `Inspections/Checklist.php`; fund categories mula sa formula\_items. |
| Trip Records & Waybills | `trip_records` | `Trips::read` | trips, waybills, trip\_updates, trip\_events, inspections, fund\_requests, billing\_items, clients, vehicles, personnel, users. Billing at Payroll: Completed lang. Dispatcher: sariling team lang. |
| Incidents | `incidents` | `Trips::read` | incidents, trips, vehicles, maintenance\_jobs, clients, users |
| Maintenance | `maintenance` | `Maintenance::read` | maintenance\_jobs, incidents, trips, vehicles, maintenance\_schedules, maintenance\_costs, maintenance\_parts\_used, part\_requests, parts, users |
| Parts Inventory | `inventory` | `Purchasing::read` | parts, suppliers, part\_requests, maintenance\_jobs, vehicles, stock\_movements, users |
| Purchasing | `purchasing` | `Purchasing::read` | purchase\_requests, purchase\_orders, parts, part\_requests, suppliers, budgets, vehicles, users |
| Trip Funds & Allowances | `funds` | `Funds::read` | fund\_requests, trips, clients, vehicles, users (at formula\_items para sa categories) |
| Finance & Payables | `finance` | `Finance::read` | expenses, accounts\_payable, suppliers, payment\_vouchers, disbursements, budgets, payroll\_periods, payroll\_lines, employee\_ledgers, personnel, vehicles, trips, users |
| Billing & Collections | `billing` | `Billing::read` | billing\_drafts, trips, waybills, vehicles, billings, billing\_items, collections, clients, users |
| Clients, Routes & Rates | `clients` | `Billing::read` | clients, routes, client\_rates, billings, collections, trips |
| Payroll | `payroll` | `Payroll::read` | payroll\_periods, payroll\_lines, personnel, trip\_pay\_rates, routes (at app\_settings at formula\_items para sa computation) |
| Attendance | `attendance` | `Payroll::read` | personnel, attendance |
| Cash Advance & Balances | `balances` | `Payroll::read` | employee\_ledgers, ledger\_entries, personnel |
| Documents | `documents` | `Documents::read` | documents, users (at ang record na kinakabitan para sa link) |
| Reports & Analytics | `reports` | `Analytics::read` | Mga section ayon sa role: Trips, Fleet, Money, Payroll at Stock. May filters: petsa, grupo (day, week, month), client, truck, driver, dispatcher, truck type, status. |
| Formula Settings | `settings` | `Admin::read` | app\_settings, formula\_items, at default sa `config/formulas.php` |
| User Accounts | `users` | `Admin::read` | users |
| Activity Log | `audit_log` | `Admin::read` | audit\_events, users (Audit: Finance, Billing, Purchasing, Payroll, Documents, Operations lang) |
| Backup | `backup` | `Admin::read` | Mga file sa `storage/backups` (hindi table) |

### Halimbawa: saan galing ang "Outstanding receivables" sa Management Dashboard

1. Ang screen ay tumatawag ng `?api=data&page=dashboard`.
2. Ang `Analytics::read` ay pumipili ng `management()` dahil Admin ang role.
3. Ang card ay galing sa `self::outstanding($p)`: kabuuan ng `billings.net_amount` (status Issued o Partially Paid) bawas ang kabuuan ng `collections.amount` ng mga invoice na iyon.
4. Ang card ay may `page: 'billing'`, kaya kapag pinindot ay pupunta sa Billing & Collections.

## 9. Formulas at Formula Settings

Lahat ng computation ay dumadaan sa `backend/Core/Settings.php` (formula engine), para iisang lugar lang ang babaguhin kapag nagbago ang formula ng kumpanya.

### A. Saan galing ang value

1. **Default:** `config/formulas.php`. Dalawang bahagi: `values` (isang numero bawat setting) at `items` (mga listahan: fund categories, P&L expenses, payroll earnings, payroll deductions). May `source` ang bawat isa (halimbawa "Payroll N14").
2. **Binago sa screen:** kapag nag-Save sa Formula Settings, nasa `app_settings` (values) o `formula_items` (listahan). Ito ang mas nauuna kaysa sa default.
3. **Reset:** binubura ang record sa database, kaya babalik sa default ng file.
4. **Lumang record:** hindi nagbabago. Ang fund request ay may `breakdown_json`; ang payroll ay may `formula_snapshot` (galing sa `Settings::snapshot`).

### B. Mga uri ng computation (`calc`)

| calc | Formula | Halimbawa |
| --- | --- | --- |
| `fixed` | parehong halaga | PhilHealth 75 |
| `percent_of_rate` | % × rate ng biyahe | Misc. Logistics 3% |
| `per_day` | (amount ÷ divisor) × araw na Present | SSS (775 ÷ 24) × araw |
| `per_km` | amount × km |  |
| `per_trip` | amount × bilang ng trips sa period |  |
| `fuel` | (km ÷ km per liter) × presyo ng diesel | Fuel & Oil |
| `route_toll` | RFID/toll na naka-save sa route | RFID |
| `manual` | tina-type ng tao | Trade Test, SSS Loan |
| `ledger` | hulog mula sa balance ng empleyado | AR EMP - CA, Uniform, Damages |

Ang `only_if_attended` ay katumbas ng `IF(D<>"", ...)` sa Excel: ibabawas lang kung may araw na Present.

### C. Payroll line (`Payroll::computeLine`), galing sa DRIVERS PAYROLL.xlsx

```
Araw na Present     = bilang ng attendance na Present sa period (o override)
Regular wage        = daily_rate × araw na Present
Trip pay            = kabuuan ng trip pay rate ng bawat Completed trip na may waybill
                      (rate ng helper kung helper siya sa trip; route muna, tapos destination)
Gross pay           = regular wage + trip pay + additional earnings
Deductions          = SSS + PhilHealth + Pag-IBIG + loans at manual
                      + hulog ng Cash Advance, Uniform, Damages (hindi lalampas sa balance)
                      + Savings / Cash Bond 500 (kung may pasok)
Net pay             = gross pay − deductions
```

### D. Projected P&L bawat trip (`Settings::projectedPnl`), galing sa Billing P&L workbook

```
Gross sales   = rate ng client
Fuel & Oil    = (km ÷ 4 km/L) × ₱100
RFID          = toll ng route
Misc.         = 3% (Logistics) at 5% (PDI) ng rate
Salaries      = Admin 769.23, Logistics 1,500, PDI 2,307.69 (dummy values sa Excel, papalitan)
Net income    = gross sales − total expense
Margin %      = net income ÷ gross sales × 100
```

Nakikita ito sa Clients, Routes & Rates at sa halimbawa ng Formula Settings.

### E. Patunay na tugma sa Excel (`tests/formula_test.php`)

| Check | Inaasahan (Excel) |
| --- | --- |
| Fuel, 143 km | 3,575 |
| P&L total expense (rate 15,000, 143 km, RFID 651) | 10,002.92 |
| P&L net income | 4,997.08 |
| Margin | 33.31% |
| SSS, 6 araw | 193.75 |
| PhilHealth, Pag-IBIG, Cash Bond (may pasok) | 75, 50, 500 |
| Walang pasok | 0 na statutory deductions |
| Fund categories | 100, 100, 200, 300, 200 |

Para sa mas detalyadong gabay sa pagbabago ng formula, tingnan ang `docs/GABAY_PAGBAGO_NG_FORMULA.md`.

## 10. Security, roles at module isolation

### A. Login at session

| Proteksyon | Paano ginawa |
| --- | --- |
| Password | `password_hash()` at `password_verify()` ng PHP. Hindi nakikita ang password kahit ng Admin. Hindi bababa sa 8 characters, may letra at numero. |
| Unang login | `must_change_password = 1` sa bagong account at sa reset. Walang ibang action na papayagan hangga't hindi napapalitan. |
| Maling password | 5 maling subok sa loob ng 15 minuto bawat browser session ay haharangin. |
| Session | Cookie na `HttpOnly`, `SameSite=Strict`, `Secure` kapag HTTPS, at strict mode. Bagong session id pagka-login (`session_regenerate_id`). |
| Idle timeout | 60 minuto na walang galaw (nababago sa `SESSION_IDLE_MINUTES` sa `.env`). |
| Deactivated user | Bawat request ay tumitingin kung `active = 1` pa ang user. |

### B. Mga request

- **CSRF:** lahat ng POST ay may token (`X-CSRF-Token` header o `csrf` field) na sinusuri gamit ang `hash_equals`.
- **SQL injection:** lahat ng query ay prepared statements (`ATTR_EMULATE_PREPARES = false`). Ang mga field helper ay tumitingin ng haba, uri, petsa at pinapayagang values.
- **XSS:** lahat ng text mula sa database ay dumadaan sa `UI.esc()` bago ipakita.
- **CSV injection:** ang value na nagsisimula sa `=`, `+`, `-` o `@` ay nilalagyan ng `'` sa CSV.
- **Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, at `noindex` para sa search engines.
- **Errors:** hindi ipinapakita sa user ang detalye ng database o PHP error; nasa server error log lang.

### C. Mga file at folder

- `public/` lang ang dapat bukas sa browser. Ang `backend`, `config`, `database`, `docs`, `scripts`, `storage` at `tests` ay hinaharang ng `.htaccess` (sa root at sa bawat folder: `Require all denied`).
- Ang `.env`, `.sql` at `.log` ay hinaharang din.
- Uploads: sinusuri ang tunay na file type gamit ang `finfo`, random na pangalan, at nasa `storage/private`. Download ay dumadaan lang sa API na may role check.
- Backup download: Admin lang, at ang pangalan ng file ay dapat tugma sa `mulawin_backup_YYYYMMDD_HHMMSS.sql`.

### D. Roles: dalawang beses sinusuri

1. **Pahina:** `Access::canOpen()` bago ibigay ang data ng pahina. Ang sidebar ay galing sa parehong listahan, kaya hindi lumalabas ang pahinang bawal.
2. **Action:** sa loob ng bawat action, `requireRole()` o `must(hasRole(...))`. Kahit may tumawag ng API nang direkta, haharangin pa rin.
3. **Dispatcher team:** Car Carrier at Container / Wing Van ay hiwalay. Ang `mustBeTripDispatcher()` ang tumitingin na sa sariling team ang trip (Day at Night shift ay iisang team).
4. **Audit:** read-only. Walang action na pinapayagan sa Audit maliban sa sariling password at notifications.

### E. Module isolation

| Antas | Kapag may sira | Epekto |
| --- | --- | --- |
| Backend module | `Actions::load()` ay nasa try/catch (kasama ang ParseError) | 503 sa module na iyon lang; gumagana ang iba |
| Bahagi ng pahina | `readSections()` | Walang laman ang bahaging iyon at may babala; tuloy ang iba |
| Dashboard | try/catch sa bawat dashboard | "Some dashboard numbers could not be loaded." |
| Notification | try/catch sa `Notify` | Hindi napipigil ang pangunahing save |
| Screen file | Hiwalay na `<script>` bawat department file | Ang pahina lang ang may "did not load" na mensahe |

Nasubukan ito: sinadyang sirain ang `Accounting/Payroll.php`, at ang payroll ay 503 habang ang trips, billing at dashboard ay 200.

### F. Tamang data kahit sabay-sabay

- Lahat ng save ay nasa `transaction()`: buo o wala.
- Ang mga record na binabago ay naka-lock (`SELECT ... FOR UPDATE`), halimbawa ang trip, fund request, truck at payroll period, para hindi magbanggaan ang dalawang user.

## 11. Deployment, backup, testing at pag-maintain ng code

### A. Kailangan ng server

- PHP 8.2 o mas bago, na may `pdo_mysql`, `fileinfo` at `mbstring`.
- MySQL o MariaDB, Apache na may `.htaccess` (`mod_rewrite` para sa folder blocking).
- Writable na `storage/private` at `storage/backups`.

### B. Install (local o Hostinger)

1. Gumawa ng bagong empty database (`utf8mb4_unicode_ci`).
2. I-import ang `database/schema.sql`, tapos `database/extension.sql`.
3. Kopyahin ang `.env.example` bilang `.env` at ilagay ang DB values. Sa live: `APP_ENV=production`.
4. Gumawa ng unang Admin: `php scripts/create_user.php admin <username> "<Pangalan>"`, o `public/install.php` gamit ang `INSTALL_TOKEN` (32+ characters), tapos burahin ang token at ang `install.php`.
5. Patakbuhin ang `php scripts/preflight.php`. Dapat lahat PASS.
6. Sa Hostinger: mas maganda kung ang document root ay `RP_Mulawin_FMS_V2/public`. Kung hindi pwede, pwede sa loob ng `public_html` dahil hinaharang ng `.htaccess` ang private folders. Gumamit ng HTTPS.

**Update ng existing database (halimbawa ang live):** kapag may bagong file sa `database/migrations/`, i-import ito sa phpMyAdmin pagkatapos ng backup. Ngayon: `2026-11-02_billing_drafts.sql` (gumagawa ng `billing_drafts` at ng drafts para sa mga trip na nakaalis na o tapos na pero wala pang invoice). Ligtas itong i-import nang isang beses lang. Kasunod: 2026-11-03\_user\_language.sql (idinadagdag ang users.language para sa wika ng screen; ligtas kahit dalawang beses).

### C. Mga setting sa `.env`

| Key | Gamit | Default |
| --- | --- | --- |
| `APP_ENV` | development o production | development |
| `APP_TIMEZONE` | Timezone ng PHP at MySQL | Asia/Manila |
| `SESSION_NAME`, `SESSION_IDLE_MINUTES` | Pangalan ng cookie at idle logout | rp\_mulawin\_fms\_v2, 60 |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Database | 127.0.0.1, 3306, mulawin\_v2, root, (blank) |
| `COMPANY_NAME`, `COMPANY_ADDRESS` | Nakalagay sa payslips at reports | R P MULAWIN TRUCKING SERVICE |
| `INSTALL_TOKEN` | Para lang sa unang Admin sa browser | (blank) |

Huwag i-upload sa GitHub ang `.env` (nasa `.gitignore`).

### D. Backup at restore

- **Backup:** Admin > Backup > Create backup. Ang `Admin::backupCreate` ay nagsusulat ng bawat table bilang SQL sa `storage/backups/mulawin_backup_YYYYMMDD_HHMMSS.sql`. Kopyahin din ang `storage/private` (uploads).
- **Restore:** bagong empty database → Import ng .sql → palitan ang `DB_NAME` sa `.env` → ibalik ang `storage/private`.

### E. Testing

| Test | Ano ang sinusuri | Paano patakbuhin |
| --- | --- | --- |
| `scripts/preflight.php` | PHP version at extensions, `.env`, writable folders, bawat module ay naglo-load, mga table | `php scripts/preflight.php` |
| `tests/formula_test.php` | 15 checks laban sa Excel (P&L, fund categories, payroll) | `php tests/formula_test.php` (sa bagong database) |
| `tests/e2e_workflow.py` | Buong workflow sa API, lahat ng 10 roles, Scenario A, B at C | `python3 tests/e2e_workflow.py` \<temporary password ng admin1> (sa empty na TEST database lang) |
| `tests/system_test.py` | Automated system test para sa tester: XAMPP o Hostinger test copy. Login bilang Admin, gumagawa ng test account kada role kung wala, buong workflow at negative tests sa API, restore ng settings, browser click-through ng bawat page at tab ng 10 roles na may screenshots, HTML report (tests/reports/). Huling run: 404 checks, 0 failures. | `tests\run_system_test.bat` o `python tests/system_test.py` (kailangan: pip install requests playwright; python -m playwright install chromium). Guide: tests/SYSTEM\_TEST\_GUIDE.md. TEST COPY LANG. |

Ang e2e test ay kailangan ng Python `requests`, tumatakbong app sa `FMS_URL`, at ng `mysql` command line.

Huling resulta (nasa `docs/TEST_REPORT.md`): preflight PASS, formula 15/15, e2e 205 checks at 0 failures, at bawat pahina ng bawat role sa browser ay walang error.

### F. Paano magdagdag o magbago

- **Bagong action sa module:** magdagdag ng `'pangalan' => self::pangalan($u, $d)` sa `match` ng `action()`, gumawa ng private function na may `requireRole`, field helpers, `must()` at `transaction()`, at tawagin sa screen gamit ang `App.api('Module.pangalan', data)`.
- **Bagong pahina:** idagdag sa `Access::pages()` (label, icon, section, module, JS file, roles), magdagdag ng branch sa `read()` ng module, at `App.page('id', {...})` sa JS file ng department.
- **Bagong module:** idagdag sa `Actions::MODULES` kasama ang department, gumawa ng `backend/Modules/<Department>/<Name>.php`, at kung may bagong screen file, idagdag sa `$jsModules` ng `public/index.php`.
- **Bagong formula value:** idagdag sa `config/formulas.php` (may group, label, unit at source), tapos gamitin sa code gamit ang `Settings::value('key')`.
- **Bagong table:** idagdag sa `database/extension.sql` (at gumawa ng hiwalay na migration SQL para sa live database).

### G. Mga bukas pang tanong sa kumpanya

Ang mga patakarang wala sa PDF ay may working default na galing sa repo o Excel, may `TODO PENDING COMPANY CONFIRMATION` sa code, at nakalista sa `docs/PENDING_COMPANY_CONFIRMATION.md` (halimbawa C01 auto-assign priority, C05 budget periods, C07 fund sa redispatch, C10 tax sa billing). Karamihan ay nababago na sa Formula Settings.
