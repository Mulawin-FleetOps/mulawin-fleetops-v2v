# Checklist #20 — Client Routes (Approved Routes Masterlist + Route Request)

Branch: `feature/claude-20-client-route-masterlist` (galing sa `main` @ `9e13957`).
Status: **provisional policy** — hinihintay pa ang final na desisyon ng kumpanya (tingnan ang huling section).

## 1. Ano ang nadagdag (para sa users)

| Sino | Ano ang bago |
| --- | --- |
| Operations Head | Bagong page **Masterlists > Client Routes**. "Request route": client, truck type, origin, destination, distance (km), notes. May babala kung may kahawig na route na (hal. "TANAUAN" vs "TANAUAN CITY"). Puwedeng i-withdraw ang sariling request habang hindi pa approved. |
| Billing & Collection | "Enter rate" sa route na Pending Rate. "Revise rate" sa Approved route (bagong version; ang lumang rate ang gamit hanggang ma-approve ang bago). |
| Admin | "Approve rate" / "Reject rate" (kailangan ng dahilan kapag reject). "Deactivate route". |
| Finance, Audit | Tingin lang (view-only). |
| Lahat ng may access sa Client Masterlist | Sa client details, may bagong section na **Approved routes** (read-only). |

Walang nagbago sa Trip Management, Trip Funds, Billing draft, at sa lumang **Billing rates (rate per km)** ng client.
Hindi pa ginagamit ang routes sa paggawa ng trip — iyon ay para sa susunod na assignment (batch planning).

## 2. Workflow (provisional)

```
Ops Head: Request route ─────────▶ Pending Rate
Billing:  Enter rate (version 1) ─▶ Pending Approval
Admin:    Approve ───────────────▶ Approved   (puwede nang piliin sa planning sa susunod)
          Reject (may dahilan) ──▶ Rejected   (terminal: kailangan ng bagong request)
Ops Head: Withdraw (sariling request, bago ma-approve) ─▶ Withdrawn
Admin:    Deactivate (Approved lang, may dahilan) ─────▶ Inactive

RATE REVISION ng Approved route:
Billing:  Revise rate (version N+1, Pending Approval) — Approved pa rin ang route, LUMANG rate ang gamit
Admin:    Approve ─▶ lumang rate = Superseded (may effective_to), bagong rate = Approved (effective agad)
          Reject  ─▶ revision lang ang Rejected; Approved pa rin ang route at ang lumang rate
```

Mga patakaran na laging sinusuri sa **server** (hindi lang sa screen):

- **Dalawang magkaibang listahan** (PR #1 review):
  - `Routes::selectableFor()` = **planning eligibility**. Ito LANG ang gagamitin ng batch planning sa susunod. Kasama lang ang route kapag Approved ito, may current Approved rate, AT **Active** ang client (`Routes::PLANNING_CLIENT_STATUSES`, gaya ng patakaran ng Trip Management ngayon). Hindi kasama ang Pending, Rejected, Withdrawn at Inactive routes, pati ang routes ng Inactive / Pending Rate / Incomplete na client. Dapat itong tawagin ulit ng planning sa server bago mag-save.
  - `Routes::approvedFor()` = **record / display**. Approved routes kahit ano ang status ng client. Ginagamit sa client details para hindi maitago ang history ng client na na-deactivate. **Huwag** itong gamitin sa pagpili ng route para sa trip.
- **Client eligibility sa approval:** sinusuri ulit ang client sa oras ng approval (bagong route at rate revision). Kapag Inactive na (o hindi na `Active` / `Pending Rate`), hindi papayagan ang approve; puwede pa ring i-reject para maisara ang request. Naka-lock ang client row habang nagde-decide (lock order: client → route → rates), kaya hindi ito mababago sa gitna ng approval.
- Ang Approved route ay laging may isang valid na Approved rate.
- **Separation of duties:** hindi puwedeng i-approve/reject ng isang user ang rate na siya mismo ang nag-enter.
- Isang pending rate lang bawat route; isang current Approved rate lang bawat route.
- Hindi ine-edit o binubura ang approved rate. Bawat pagbabago ay bagong version; nananatili ang luma bilang history.
- Directional: magkaibang route ang A → B at B → A.
- Puwedeng parehong route pero ibang truck type (iba ang rate).

## 3. Saan nakalagay ang policy (madaling palitan)

Lahat ng provisional na desisyon ay nasa **isang constant**: `Routes::POLICY` sa
`backend/Modules/Operations/Routes.php`:

```php
'request'         => ['operations_head'],
'withdraw'        => ['operations_head'],
'rate'            => ['billing'],
'approve'         => ['admin'],
'deactivate'      => ['admin'],
'view'            => ['admin', 'operations_head', 'billing', 'finance', 'audit'],
'client_statuses' => ['Active', 'Pending Rate'],
'rate_types'      => ['Flat'],      // 'Per Km' ay suportado na ng database
```

Kapag nagbago ang desisyon ng kumpanya (hal. i-enable ang Per Km), dito lang babaguhin. Walang database change.
Kung babaguhin ang `view`, baguhin din ang roles ng page `routes` sa `backend/Core/Access.php` para magtugma.

## 4. Database (3 bagong tables, walang binago sa luma)

| Table | Laman |
| --- | --- |
| `client_routes` | Isang route: client, truck type, origin/destination (label + normalized key), optional map pins, `distance_km`, `distance_source` (`Manual` ngayon; pangalan ng map provider sa hinaharap — provider-independent), status, sino ang nag-request / nagsara at bakit. |
| `client_route_rates` | Mga version ng rate: `rate_type` (`Flat` o `Per Km`), `rate_amount`, `minimum_charge` (Per Km lang), status (`Pending Approval`, `Approved`, `Rejected`, `Superseded`), sino ang nag-enter at nag-decide, `effective_from`, `effective_to`. |
| `client_route_events` | History ng bawat hakbang (sino, kailan, mula/papuntang status, detalye). Nakasulat din sa Activity Log (`audit_events`, area = `Routes`). |

**Mga database rule (gumagana kahit may sabay na request):**

- `uq_route_active` — isang open/approved route lang bawat client + truck type + normalized origin + normalized destination.
  Ginagamit ang generated column `active_key` (1 kapag Pending Rate / Pending Approval / Approved; NULL kapag sarado),
  parehong pattern ng `maintenance_jobs.open_key`.
- `uq_route_rate_current` — isang Approved rate lang bawat route (`current_key`).
- `uq_route_rate_pending` — isang Pending Approval rate lang bawat route (`pending_key`).
- CHECK constraints: truck type, status, distance 0 < km ≤ 3000, origin ≠ destination, rate > 0, minimum charge para sa Per Km lang.

**Normalization** (`Routes::normalize()`): uppercase, tanggal ang punctuation, isang space lang.
`" Tanauan,  Batangas "` at `"TANAUAN BATANGAS"` ay iisa. Pero ang `"TANAUAN"` at `"TANAUAN CITY"` ay magkaiba
— sinasadya ito (para walang maling pagsasama); ang screen ang nagbababala kapag may kahawig.

**Para sa billing integration sa hinaharap:** dahil hindi nagbabago ang approved rate row, ang billing ay
magse-save lang ng `client_route_rates.id` + kopya ng halaga (snapshot). Hindi pa ito ginagawa ngayon;
`client_rates` (rate per km) at `BillingDraft.php` pa rin ang gamit ng billing.

## 5. Paano i-install

### A. Existing database (XAMPP o Hostinger) — upgrade

Kailangang naka-apply na ang `2026-11-06_00_schema_migrations.sql` (may table na `schema_migrations`).

1. **Admin > Backup > Create backup** at i-download. (Kopyahin din ang `storage/private`.)
2. I-upload / kopyahin ang bagong code (parehong folders).
3. phpMyAdmin > piliin ang database > **Import** `database/migrations/2026-11-06_02_client_routes.sql` **isang beses**.
   - Kung lumabas ang `Duplicate entry '2026-11-06_02_client_routes' for key 'PRIMARY'`: na-import na ito dati; walang nabago. Huwag ulitin.
4. I-check (SQL tab):
   ```sql
   SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id='2026-11-06_02_client_routes') AS tracked,
          (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
             AND table_name IN ('client_routes','client_route_rates','client_route_events')) AS tables_found;
   ```
   Tama kapag `tracked = 1` at `tables_found = 3`.
5. Mag-login at buksan ang **Masterlists > Client Routes**.

### B. Fresh install

`database/schema.sql` tapos `database/extension.sql`, gaya ng dati. Kasama na ang 3 tables at naka-mark na applied ang migration.

### C. Partially failed migration (hal. naputol ang connection habang nag-iimport)

Ang `CREATE TABLE` sa MySQL/MariaDB ay **hindi** nasa iisang transaction, kaya puwedeng maiwan ang database na kalahati lang ang na-import.
Ang unang linya ng migration ay ang `INSERT INTO schema_migrations`, kaya posibleng `tracked = 1` pero kulang ang tables.

1. Patakbuhin ang check query sa step A.4.
   - `tracked = 1` at `tables_found = 3` → tapos na; walang gagawin.
   - `tracked = 0` at `tables_found = 0` → hindi nagsimula; i-import lang ulit.
   - Kahit anong iba (hal. `tracked = 1`, `tables_found = 1`) → **partial**. Ituloy sa step 2.
2. Siguraduhing walang laman ang mga bagong table (bago pa lang sila, kaya dapat 0):
   ```sql
   SELECT COUNT(*) FROM client_routes;   -- patakbuhin lang para sa table na umiiral
   ```
   Kung may laman na (ibig sabihin ginamit na ang system), **huwag ituloy**; ibalik ang backup sa step A.1.
3. Linisin at i-import ulit:
   ```sql
   DROP TABLE IF EXISTS client_route_events;
   DROP TABLE IF EXISTS client_route_rates;
   DROP TABLE IF EXISTS client_routes;
   DELETE FROM schema_migrations WHERE id='2026-11-06_02_client_routes';
   ```
   Tapos i-import ulit ang migration file at patakbuhin ulit ang check (dapat `1` at `3`).

Ang buong procedure na ito ay sinubukan ng `tests/route_tests.php` (section A2).

## 6. Paano i-test

Kailangan ng MySQL/MariaDB user na puwedeng gumawa ng databases na nagtatapos sa `_test`.
Hindi ginagamit ng tests ang `.env` ng project: kinokopya ang code sa temporary folder na may sariling test `.env`.
Tatanggi ang test kapag ang pangalan ng database ay hindi nagtatapos sa `_test` o kapag kapareho ito ng `DB_NAME` sa `.env`.

```
# Linux / Hostinger SSH
TEST_DB_USER=root TEST_DB_PASS= php tests/run_route_tests.php

# XAMPP (Windows Command Prompt)
set TEST_DB_USER=root
set TEST_DB_PASS=
C:\xampp\php\php.exe tests\run_route_tests.php
```

Ginagawa at binubura nito ang: `mulawin_routes_fresh_test`, `mulawin_routes_upgrade_test`, `mulawin_routes_partial_test`.

## 7. Rollback

- **Code lang (karaniwang sapat):** ibalik ang mga lumang file (o i-revert ang merge commit). Puwedeng maiwan ang 3 tables: hindi sila ginagamit ng lumang code at walang ibang table na nakaturo sa kanila.
- **Code at database** (kapag sigurado na hindi kailangang itago ang route history):
  ```sql
  DROP TABLE IF EXISTS client_route_events;
  DROP TABLE IF EXISTS client_route_rates;
  DROP TABLE IF EXISTS client_routes;
  DELETE FROM schema_migrations WHERE id='2026-11-06_02_client_routes';
  ```
  **Babala:** buburahin nito ang lahat ng route, rate at approval history. Mag-backup muna.

## 8. Mga file

| File | Uri | Bakit |
| --- | --- | --- |
| `backend/Modules/Operations/Routes.php` | bago | Lahat ng route logic: request, rate entry/revision, approve/reject, withdraw, deactivate, details, approved routes ng client |
| `public/assets/js/modules/operations/routes.js` | bago | Screen ng Client Routes |
| `database/migrations/2026-11-06_02_client_routes.sql` | bago | Upgrade ng existing database |
| `tests/run_route_tests.php`, `tests/route_tests.php`, `tests/README.md` | bago | Automated tests |
| `docs/CLAUDE_20_CLIENT_ROUTES.md` | bago | Itong dokumento |
| `database/extension.sql` | binago (dagdag lang) | Fresh install: 3 tables + migration id |
| `backend/Actions.php` | 1 linya | I-register ang `Routes` module (Operations) |
| `backend/Core/Access.php` | 1 entry | Page `routes` (Client Routes) sa Masterlists |
| `public/index.php` | 1 linya | I-load ang `operations/routes.js` |
| `public/assets/js/modules/operations/clients.js` | maliit | Read-only na "Approved routes" section sa client details (kumukuha sa `Routes.for_client`) |
| `CHANGELOG.md` | dagdag | Entry |

Hindi ginalaw: `Trips.php`, `trips.js`, `Funds.php`, `core.js`, `BillingDraft.php`, `Clients.php`, `client_rates`.

## 9. Mga kilalang limitasyon

- Typed pa ang distance (`distance_source = Manual`); ang map-based distance ay sa routing assignment (#5).
- Hindi pa konektado sa New Trip / batch planning at sa billing. Kapag ikinonekta na, `Routes::selectableFor()` ang gagamitin (hindi `approvedFor()`).
- Ang "similar route" warning sa screen ay tulong lang; ang database unique key pa rin ang tunay na duplicate check. Pareho na ang normalization steps ng screen at server (sinusubukan ng test section L kapag may Node.js).
- Hindi pa nakikita sa Dashboard / Reports.
- Walang "reactivate": kapag na-deactivate, mag-request ng bago (nananatili ang luma bilang history).
- Ang Approved rate ng isang Inactive route ay naiiwang `Approved` sa history (ito ang huling valid na rate bago na-deactivate); hindi ito mapipili dahil Inactive ang route.
- Ang dispatchers na may access sa Client Masterlist ay nakikita ang approved routes at rate ng client (gaya ng nakikita na nila ang rate per km doon ngayon). Aayusin kasama ng department isolation (#39) kung kailangan.
- Hindi pa kasama sa `scripts/preflight.php` table check ang 3 bagong tables (shared file; hindi bahagi ng scope).
- Ang rate revision ay effective agad pagka-approve; wala pang future-dated rate.

## 10. Mga desisyon na hinihintay pa sa kumpanya

1. Flat lang ba, o may route na Per Km? (Suportado na ng database ang dalawa; Flat lang ang naka-enable.)
2. Final na approval chain: Ops Head → Billing → Admin? (Provisional.)
3. Puwede bang mag-request ng route para sa client na Pending Rate pa? (Provisional: oo.)
4. Kailangan ba ng future-dated na rate revisions (hal. bagong contract simula sa susunod na buwan)?
5. Kailangan ba ng "return to Billing for correction" imbes na terminal na reject?
