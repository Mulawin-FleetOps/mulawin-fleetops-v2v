# Checklist #5 — OpenStreetMap at automatic na kilometer (road distance)

Branch: `feature/claude-05-osm-routing-distance`. Saklaw: **Phase 1 (infrastructure) + Phase 2 (Client Routes) lang.**
Hindi pa ginalaw ang Trip Management (Phase 3, hiwalay na approval).

> **Implementation defaults, hindi pa final na business policy.** Kailangan pa ng kumpirmasyon ng kumpanya
> ang kilometer billing at ang toll-road policy bago gamitin sa production.

## 1. Ano ang nagbago (para sa users)

| Saan | Ano ang bago |
| --- | --- |
| Lahat ng mapa (trip form, trip details, Client Routes) | **OpenStreetMap** na ang mapa. Wala na ang MapTiler. Laging nakikita ang attribution na "© OpenStreetMap contributors". |
| Address search at "address ng pin" | Dumadaan na sa **server natin** (openrouteservice geocoding). Button o Enter lang ang search (walang search-as-you-type) para hindi maubos ang daily quota. |
| **Client Routes > Request route** | May mapa. I-pin ang Origin at Destination (o i-search). **Kusang lalabas ang road distance (km)** at ang aktwal na daan sa mapa. May **Route option**: Recommended (default), Avoid toll roads, General roads only. |
| Pagbago ng km | Puwedeng palitan ang km. Kapag iba sa computed, **kailangan ng dahilan**. Kapag lampas **15%** ang diperensya, may babala (sa screen at pagka-save). |
| Route details | Ipinapakita ang final km, ang computed km, ang option, kung kailan kinuwenta, ang dahilan ng pagbabago, at ang mapa na may daan. |
| Trip form (New trip) | **Pareho pa rin**: straight-line guide lang at tina-type ang billable km. OpenStreetMap at server-side search lang ang nagbago. |

**Kapag walang `ORS_API_KEY` o hindi sumasagot ang map service:** gumagana pa rin ang lahat. Tina-type ang km at ang address,
at ang route ay nase-save bilang `Manual` (safe manual-km fallback).

## 2. Paano gumagana

```
Browser (map.js, routes.js)
   │  App.api('Maps.route' | 'Maps.geocode' | 'Maps.reverse')   ← may login, CSRF at role check
   ▼
backend/Modules/General/Maps.php
   ▼
backend/Core/Routing.php ── cache (map_cache) ── daily guard (map_api_usage) ── per-user limit (map_user_usage)
   │  HTTPS, Authorization: <ORS_API_KEY>   (ang key ay nasa .env lang)
   ▼
openrouteservice (api.heigit.org) — directions (driving-hgv), geocoding, reverse geocoding
```

- **Hindi pinagkakatiwalaan ang km na galing sa browser.** Sa `Routes.request`, kinukuwenta ULIT ng server ang road distance
  (karaniwang galing sa cache, kaya walang dagdag na quota) bago mag-save:
  - walang route option o walang pins → `distance_source = Manual`
  - hindi available ang service → `Manual`, at may note sa user
  - km = computed (2 decimals) → `Map`
  - km ≠ computed → **kailangan ng `distance_override_reason`** → `Map (edited)`; may babala kapag lampas 15%
- **Km:** 2 decimals (meters ÷ 1000, ni-round sa 2 decimals; walang round-up sa whole km).
- **Route options** (`Routing::OPTIONS`):
  - `recommended`: walang iniiwasan
  - `avoid_tolls`: `avoid_features: tollways`
  - `general_roads`: `highways` + `tollways`
- **Profile:** `driving-hgv` (truck, may `vehicle_type: hgv`). Puwedeng `driving-car` sa `.env`.
- **Sanity checks:** babala kapag mas maikli ang road km kaysa sa straight line, o kapag higit 3× nito. Bawal ang lampas 3,000 km.
  Bawal ang pin sa labas ng Pilipinas.

## 3. Security

- **Nasa `.env` lang ang `ORS_API_KEY`** at sa `Authorization` header ito ipinapadala (hindi sa URL).
  - Hindi ito kasama sa `App.me` o sa kahit anong response.
  - Hindi ito isinusulat sa error log: status code lang ang nilo-log.
  - Tinanggal na rin ang MapTiler key na dating ipinapadala sa browser.
- **`Maps.*` endpoints:** kailangang naka-login, may CSRF, at isa sa mga role na ito: Admin, Operations Head, o dispatchers.
- **`ORS_BASE_URL`:**
  - galing lang sa `.env`, hindi sa request
  - HTTPS lang; ang `http://127.0.0.1` ay pinapayagan lang kapag `APP_ENV=test`
  - walang user/password at walang query
  - walang redirects; naka-verify ang TLS; may timeout (5 s connect, 10 s total)
- **Quota protection:**
  - cache ng 30 araw
  - daily guard (default 1,800 route / 900 search / 900 reverse; ang free plan ay 2,000 / 1,000 / 1,000)
  - per-user limit (30 bawat minuto)
- **Privacy:** coordinates at search text lang ang ipinapadala sa HeiGIT (Germany). Walang pangalan ng client o ng tao.

## 4. Setup (owner)

1. Gumawa ng libreng account sa **https://account.heigit.org** at gumawa ng API key (Standard plan).
2. Sa `.env` ng server, ilagay ang `ORS_API_KEY=<key>`. **Huwag i-commit ang `.env`.**
   Nasa `.env.example` ang ibang settings at ang defaults ng mga ito.
3. Patakbuhin ang `php scripts/preflight.php`. Dapat `PASS` ang curl at ang `ORS_API_KEY`.
4. Mag-login bilang Operations Head → Client Routes → Request route → i-pin ang dalawang lugar → dapat lumabas ang km.

## 5. Database (`2026-11-06_04_maps_routing.sql`, additive lang)

- Bagong tables: `map_cache`, `map_api_usage`, `map_user_usage`.
- `client_routes` + 6 nullable columns:
  - `route_option`
  - `distance_computed_km`
  - `distance_provider`
  - `distance_computed_at`
  - `distance_override_reason`
  - `route_geometry`
- May CHECK sa `route_option`, sa `distance_computed_km`, at sa `distance_source` (`Manual` / `Map` / `Map (edited)`).
- Walang binago o binurang row. Ang mga lumang route ay `Manual` pa rin.

### Upgrade (existing database)
1. **Admin > Backup > Create backup**, at i-download ito.
2. I-upload ang bagong code.
3. Sa phpMyAdmin, i-import ang `database/migrations/2026-11-06_04_maps_routing.sql` **isang beses**.
   Kailangang naka-import na ang `..._02_client_routes` at `..._03_audit_changes`. Kapag `Duplicate entry ... PRIMARY` ang lumabas, na-import na ito dati.
4. I-check:
   ```sql
   SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id='2026-11-06_04_maps_routing') AS tracked,
          (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
             AND table_name IN ('map_cache','map_api_usage','map_user_usage')) AS tables_found,
          (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
             AND table_name='client_routes' AND column_name='route_option') AS columns_found;
   ```
   Tama kapag `1`, `3` at `1`.

### Fresh install
`schema.sql` + `extension.sql`, gaya ng dati.

### Partially failed migration
Kapag iba ang resulta ng check (hal. `tracked = 1` pero `tables_found < 3` o `columns_found = 0`), patakbuhin ito sa **MariaDB**
(Hostinger at XAMPP), pagkatapos ay i-import ulit ang migration at patakbuhin ulit ang check:
```sql
DROP TABLE IF EXISTS map_user_usage;
DROP TABLE IF EXISTS map_api_usage;
DROP TABLE IF EXISTS map_cache;
ALTER TABLE client_routes DROP CONSTRAINT IF EXISTS chk_route_option, DROP CONSTRAINT IF EXISTS chk_route_computed_km,
  DROP CONSTRAINT IF EXISTS chk_route_distance_source;
ALTER TABLE client_routes DROP COLUMN IF EXISTS route_option, DROP COLUMN IF EXISTS distance_computed_km,
  DROP COLUMN IF EXISTS distance_provider, DROP COLUMN IF EXISTS distance_computed_at,
  DROP COLUMN IF EXISTS distance_override_reason, DROP COLUMN IF EXISTS route_geometry;
DELETE FROM schema_migrations WHERE id='2026-11-06_04_maps_routing';
```
Ligtas ito sa partial state: wala pang route na may computed distance kapag hindi natapos ang migration.
Sinusubukan ang procedure na ito ng `tests/map_tests.php` (section J).

## 6. Tests

```
TEST_DB_USER=<user> TEST_DB_PASS=<pw> php tests/run_map_tests.php      # Checklist #5
TEST_DB_USER=<user> TEST_DB_PASS=<pw> php tests/run_route_tests.php    # Checklist #20 + buong migration chain
```

- Disposable `*_test` databases lang ang ginagamit; hindi binabasa ang `.env` ng project (`tests/_launcher.php`).
- **Walang tunay na tawag sa openrouteservice.** Fake transport ang gamit, at para sa curl code ay local mock server (`tests/_mock_ors.php`, 127.0.0.1).
- **Live check gamit ang tunay na key** (ikaw ang magpapatakbo; blocked ang api.heigit.org sa test sandbox ni Claude):
  - mag-login at subukan ang Request route sa 3–4 na kilalang ruta (hal. Tanauan → Malvar, Tanauan → Batangas Port) at sa tatlong option
  - ikumpara ang km sa odometer o sa ibang mapa

## 7. Rollback

- **Code lang (karaniwang sapat):** i-revert ang merge.
  - Additive ang tables at columns; hindi sila ginagamit ng lumang code.
  - Sa lumang code, kailangan ulit ang `MAPTILER_API_KEY` sa `.env` para lumabas ang mapa.
- **Kasama ang database:** gamitin ang SQL sa section 5 ("Partially failed migration").
  **Babala:** buburahin nito ang computed distance, ang override reason at ang route line ng lahat ng route. Mag-backup muna.

## 8. Mga file

| File | Uri | Bakit |
| --- | --- | --- |
| `backend/Core/Routing.php` | bago | ORS adapter: route, search, reverse, cache, limits, error mapping |
| `backend/Modules/General/Maps.php` | bago | `Maps.route`, `Maps.geocode`, `Maps.reverse` para sa screen |
| `public/assets/js/map.js` | bago | Inilipat mula sa `core.js`: OSM tiles, server-side search, route line, picker options |
| `public/assets/js/core.js` | binago | Tinanggal ang map section (lumipat sa `map.js`) |
| `backend/Modules/Operations/Routes.php` | binago | Server re-verification ng km, override reason, 15% warning, distance fields sa details |
| `public/assets/js/modules/operations/routes.js` | binago | Mapa, route option, auto km at override sa Request route; mapa sa details |
| `backend/Data.php` | binago | `map` settings (walang key); tinanggal ang `mapKey` / `mapStyle` |
| `backend/Actions.php`, `public/index.php`, `public/assets/css/app.css` | 1 linya bawat isa | Register ng `Maps`; load ng `map.js`; tanggal ang MapTiler logo style |
| `database/migrations/2026-11-06_04_maps_routing.sql`, `database/extension.sql` | bago / dagdag | Tables at columns |
| `.env.example`, `scripts/preflight.php` | binago | ORS / OSM settings; curl at key check; table check |
| `tests/_launcher.php`, `tests/run_map_tests.php`, `tests/map_tests.php`, `tests/_mock_ors.php` | bago | Tests at mock server |
| `tests/run_route_tests.php`, `tests/route_tests.php` | binago | Gumagamit na ng shared launcher; ang migration test ay "migration chain" na (tingnan ang section 9) |

Hindi ginalaw: Activity Log at audit (`Admin.php`, `admin.js`, `audit()` / `auditWithChanges()`), `Trips.php`, `trips.js`, `Funds.php`, `BillingDraft.php`, `client_rates`.

## 9. Pag-ayos sa #20 test suite

Sa latest `main`, sira na ang migration test ng `tests/route_tests.php`. Umaasa ito sa eksaktong porma ng migration list sa
`extension.sql`, kaya nasira ito nang idagdag ang `2026-11-06_03_audit_changes`. Bug ito ng **test**, hindi ng app.
Ngayon:
- kinukuha ng test sa git ang schema bago ang `..._02_client_routes`
- ini-import ang **lahat** ng migrations mula roon ayon sa order (02, 03, 04, …)
- kinukumpara ang resulta sa fresh install

Hindi na ito masisira kapag may bagong migration ang ibang developer.

## 10. Mga kilalang limitasyon

- Hindi pa nasubukan ang live openrouteservice mula sa sandbox ni Claude (network blocked).
  Mock ang lahat ng automated test; kailangan ng live check (section 6).
- Ang ORS geocoding (Pelias) ay may sariling accuracy sa PH. Kapag mali ang resulta ng search, i-click na lang ang mapa.
- Kakaunti ang truck restriction tags (bigat, taas) sa OSM sa PH, kaya madalas pareho lang ang resulta ng `driving-hgv` at ng car.
- Estimate ang computed km. Ang "confirmed billable distance" (Objective 3.1) ay kinukumpirma pa rin ng tao.
- Hindi pa konektado sa Trip Management (Phase 3) at sa billing.
- Ang daily guard ay bumibilang lang ng tawag ng system na ito. Kung may ibang system na gumagamit ng parehong key, puwedeng maubos ang quota nang mas maaga; gumamit ng hiwalay na key.
