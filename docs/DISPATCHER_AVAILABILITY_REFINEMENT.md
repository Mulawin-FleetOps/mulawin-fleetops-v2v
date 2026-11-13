# Dispatcher Truck & Personnel Availability refinement

Implemented November 10, 2026 in the verified Windows checkout `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. The repository root, branch, working tree, existing Dispatcher implementation, shared layout/table controls, and authorized Fleet availability projection were inspected before edits.

## Design and structure

The page follows the approved reference's compact header, grouped pill switcher, elevated search toolbar, aligned table controls, and unified raised records container. The explicit title correction takes precedence over the green title in the image: the actual routed page heading is **`#1F2937`**, a dark neutral, for both Dispatcher roles. Other page headings retain their existing styling.

The exact existing description remains below the title. A neutral `READ-ONLY REFERENCE` badge sits at the right on desktop/laptop and wraps cleanly at smaller widths. The two navigation links are grouped into one pill container, with a raised white active pill, professional green accents, and compact count badges.

Counts come from the existing authorized truck/personnel arrays, before search and record filters. They represent each tab's scoped records, rather than inventing availability totals or copying the screenshot's numbers. A missing section displays an em dash instead of a false zero. Container/Wing Van accounts retain `Driver & Helper Availability`; Car Carrier accounts retain `Driver Availability`. No role switcher was introduced.

The toolbar immediately follows the tabs. Search remains solid professional green, Filters remains outlined, and the existing active-filter indicator, draft values, Apply/Clear behavior, and keyboard support remain. Truck search describes only real fields: plate, truck type, and current trip. Personnel search includes the existing name, personnel role, trip, and truck fields.

The existing record count, working List/Grid toggle, and 12/24/48 page-size selector are aligned in the table's top row. No nonfunctional controls were added. The records container retains the existing elevation system, white rows, light gray headers, vivid status badges, visible separators, and compact spacing. Existing truck/personnel columns, maintenance restrictions, attendance, and license information are preserved.

The footer is inside the same table surface, with an accurate record/page summary on the left and explicit Previous/Next buttons on the right. They use the existing table state and renderer, work in List and Grid views, and disable correctly for the first, last, and empty pages. Their decoration is enabled only for this availability page; unrelated tables retain their existing behavior.

The operational personnel requirement and current-snapshot/reservation note are retained as a compact information strip within the records container. This removes the disconnected paragraph formerly between the tabs and toolbar without losing its meaning.

## Actual files modified

| File | Change |
| --- | --- |
| `public/assets/js/modules/operations/dispatcher.js` | Availability header badge, pill navigation/counts, integrated note, personnel-role search, scoped Previous/Next footer |
| `public/assets/css/dispatcher.css` | Availability-only dark title/header, neutral badge, responsive pill switcher, compact aligned controls and note |
| `tests/dispatcher_ui.html` | Both-role routed title checks, counts, filter combinations, personnel search, pagination, empty/unavailable data, no header leakage; expanded previews |
| `tests/run_ops_head_browser.cjs` | Additional availability/personnel/laptop/mobile/empty/filter captures and checks for ordering, overlap, clipping, title color, footer, and keyboard behavior |
| `docs/DISPATCHER_AVAILABILITY_REFINEMENT.md` | This report |

No shared component source, PHP/backend implementation, database schema, dependencies, or unrelated page design was changed. Existing uncommitted work remains intact.

## Verification

Actual executed results:

- PHPUnit: **345 tests, 403 assertions passed**.
- Browser fixtures: **331 checks passed**, comprising 25 shared Operations, 72 Operations Head, 49 Trip Approvals, and 185 Dispatcher checks.
- Responsive layout checks: **42 passed** across the existing regressions and the added availability views.
- Native filter keyboard/focus checks: **5 passed**, including the availability filter at tablet width.
- Reduced-motion card hover check: **passed**.
- Dispatcher JavaScript and browser runner syntax: **passed**.
- `git diff --check`: **clean**.

The browser suite checks the actual router-generated heading for both Dispatcher roles, confirms `rgb(31, 41, 55)` with at least 4.5:1 contrast against the page background, verifies that the badge/title styling does not leak into Trip History, and exercises real frontend pagination and List/Grid/page-size behavior. All API calls/uploads in the fixtures are mocked. These results do not claim live database persistence, authenticated production data verification, or a complete accessibility audit.

Availability layouts were checked at 1440px desktop, 1100px laptop, 820px tablet, and 390px mobile widths, including both personnel labels, empty records, and an open filter panel. Checks reject broken ordering, overlapping pills, clipped toolbar/page controls, document overflow, and missing footer/context information. Desktop truck/personnel, laptop, and mobile screenshots were visually inspected.

Generated screenshots/results are ignored under `tests/reports/`:

- `dispatcher-availability-desktop.png`
- `dispatcher-availability-laptop.png`
- `dispatcher-availability-tablet.png`
- `dispatcher-personnel-desktop.png`
- `dispatcher-personnel-tablet.png`
- `dispatcher-availability-mobile.png`
- `dispatcher-personnel-mobile.png`
- `dispatcher-availability-empty.png`
- `dispatcher-availability-filters.png`
- `ops-head-browser.txt`
- `dispatcher-refinement-checks.txt`

Run `node tests/run_ops_head_browser.cjs` for mocked checks and screenshots. Test-only local-file previews in `tests/dispatcher_ui.html` include `?preview=availability`, `?preview=availability-personnel`, `?preview=availability-empty`, and `?preview=availability-filters`; append `&role=cc` for Car Carrier. These files must not be served through Apache.

## Limits and safety

The authorized availability read payload does not contain a capacity/model field or a Dispatcher availability-record detail action. No capacity/model values or new detail/edit permissions were invented from the screenshot. Existing read-only fields and working table controls are preserved. Wider personnel tables retain internal horizontal scrolling at narrow widths rather than hiding authorized columns.

Live authenticated/database integration was not run. The browser fixtures use synthetic test data only, never screenshot samples or production writes. Existing server authorization, account scopes, assignment rules, availability statuses, Maintenance processes, and other Dispatcher workflows remain unchanged.

Only the specified local Windows project was modified. No commit, push, merge, deployment, branch deletion, remote GitHub change, database write, reset, drop, or truncate was performed. Composer, PHPUnit, existing tests, and all unrelated local modifications were preserved.
