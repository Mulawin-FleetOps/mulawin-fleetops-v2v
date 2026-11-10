# Dispatcher UI refinement — Controlled Vivid

The final approved visual direction now supersedes this stage's general color and surface styling. See [Final Dispatcher design refinement](DISPATCHER_FINAL_REFINEMENT.md) for the professional green theme, pastel icons, yellow sidebar marker, stronger elevation, final table treatment, and latest validation. The centralized filter and form workflows introduced here remain in place.

Implemented locally on November 10, 2026 in `C:\xampp\htdocs\mulawin-fleetops-v2v`, branch `kenneth`. This refines the implemented Dispatcher module; the earlier [redesign report](DISPATCHER_REDESIGN.md) records its underlying workflows and known Diesel PO limitation.

## Scope and files

The checkout path, Git root, branch, and existing modified/untracked files were inspected before editing. Existing unrelated changes, Composer dependencies, PHPUnit installation, backend actions, role authorization, official statuses, and the approved eight-item Dispatcher navigation were preserved. This refinement changes no PHP, database schema, records, or Maintenance/Finance business processes. Both authenticated Dispatcher roles retain their existing server-enforced scopes.

Files changed for this refinement:

- `public/assets/js/modules/operations/dispatcher.js` — centralized filters, form sections, summary-card markup, semantic presentation.
- `public/assets/css/dispatcher.css` — Dispatcher-scoped palette, contrast, compact spacing, responsive panels and forms.
- `tests/dispatcher_ui.html` — mocked functional, contrast, and preview coverage.
- `tests/run_ops_head_browser.cjs` — additional responsive captures and native keyboard verification.
- `tests/README.md` — refinement checks and preview instructions.
- `docs/DISPATCHER_REDESIGN.md` — link to this refinement report.
- `docs/DISPATCHER_REFINEMENT.md` — this report.

Ignored browser screenshots and logs are generated under `tests/reports/`.

## Centralized filters

Every Dispatcher records section now has one search field with Search and Filters controls. The compact panel contains a heading, labeled fields, Close, Clear Filters, and Apply Filters. A count on Filters reflects committed nondefault criteria; search remains independent. Values are drafts until Apply. Closing or pressing Escape discards drafts and returns focus; outside interaction closes the panel. Search preserves committed criteria. Clear resets criteria while preserving the independent search and the active workspace/tab. Request status resets to Pending Review.

Committed state uses existing URL query parameters, so opening details does not erase the context. Applying criteria resets pagination appropriately. Inverted date ranges are rejected with an accessible field message, and correcting either date clears the validation error. Desktop panels align with the toolbar; narrower screens use an inset panel with bounded scrolling. Keyboard focus remains visible.

| Records | Available criteria |
| --- | --- |
| Trip Requests | Recorded review category, client, authorized truck type, requester, request date range; existing server pagination/filtering |
| Trip Operations | Operational queue (six Dashboard destinations plus Awaiting Resources), official trip status, authorized truck type, client, schedule range |
| Trip History | Historical trip status, authorized truck type, client, schedule range |
| Trip Fund Requests | Request status/follow-up queue and request date range |
| Diesel PO Requests | Actual document attachment status, associated trip, authorized truck type |
| Incident Reports | Incident status, existing incident type, recorded maintenance status |
| Truck Availability | Current availability and authorized truck type |
| Driver / Driver & Helper Availability | Current availability and actual personnel role |
| Documents | Document category, directly associated trip, upload date range |

Shared table search boxes are removed only inside these Dispatcher record mounts. Existing table view controls, page sizes, paging, and record actions remain available. Trip Operations uses the centralized queue control instead of repeating Dashboard cards above the table. Major funds/fuel and availability tabs remain separate from filters. Dashboard cards still open their corresponding queue, and the Filters indicator reflects that queue.

## Forms and cards

New Trip Request is one form with three numbered sections: Client and Trip Information; Dispatch Schedule and Delivery; Additional Instructions. Client/type share a desktop row, the approved route spans the form, and shipment fields retain role/type-dependent visibility. Required fields, approved-route dependencies, schedule validation, existing submission, duplicate protection, and uncertain-response recovery are preserved. Cancel and Submit remain at the lower right.

Fund forms reuse the original inputs and submission handler, reorganized into Associated Trip, Preset Expense Categories, Additional Expenses, and Request Summary. Backend-configured preset amounts remain fixed. Custom inputs have persistent labels, existing validation, and automatic totals; the summary updates the selected preset/custom breakdown. Original confirmation, revision, and duplicate-submission protections remain.

Both incident entry points still use the same protected trip action and eligibility check. The existing form is grouped into Associated Trip, Incident Information, and Incident Description and Evidence. Description and evidence uploads span the form. Required fields, photographs, attachment handling, trip holds, and Maintenance coordination remain unchanged.

Existing Diesel attachment forms now show associated trip/truck context and a supporting-document section. No quantity, station, purchasing permission, approval, or issuance fields were invented.

The Dashboard retains exactly six white cards, real counts, exact labels, and functional destinations. Decorative arrows are removed. Icon accents are green for preparation/readiness, blue for progress/arrival, red for holds, and amber for rescheduling. Critical incident coordination appears first in Pending Operational Actions with a restrained red accent. No Quick Actions section was added.

## Color and accessibility

Dispatcher-scoped tokens apply Option B: green `#15803D` primary actions, blue `#2563EB` information accents, amber `#D97706` palette direction with darker `#92400E` readable foregrounds, red `#DC2626` critical accents, `#0F172A` primary text, `#475569` secondary text, and `#F5F7FA` page background. Status surfaces use approved green/blue/amber/red tints with darker foregrounds. Preset forms and tables remain neutral. The sidebar retains the green identity with high-contrast labels and a clear active state.

Input and secondary-button boundaries use `#7C899B` to meet the non-text contrast target; the lighter neutral panel border is decorative. Keyboard outlines use `#1D4ED8`, with white outlines inside the dark sidebar. Disabled controls retain readable text and visible boundaries. Labels, required indicators, status text, and focus states provide cues beyond color.

Browser checks calculate WCAG relative luminance from actual computed foreground/background colors. Representative measured combinations:

| Combination | Contrast |
| --- | ---: |
| Summary text / white | 17.85:1 |
| Primary action / green | 5.02:1 |
| Secondary action / white | 10.35:1 |
| Disabled action | 6.74:1 |
| Green status | 6.49:1 |
| Blue status | 5.49:1 |
| Amber status | 6.37:1 |
| Red status | 5.30:1 |
| Secondary text / white | 7.58:1 |
| Summary icons / their tints | 4.24:1–6.37:1 |
| Input boundary / white | 3.55:1 |
| Keyboard outline / white | 6.70:1 |

Placeholder and sidebar navigation contrast also meet 4.5:1 in the measured checks. These are representative computed-style and keyboard checks, not a claim of complete WCAG certification or an assistive-technology audit.

## Verification and limitations

Actual executed results:

| Check | Result |
| --- | --- |
| PHPUnit, `--do-not-cache-result` | PASS — 345 tests, 403 assertions |
| Mocked browser fixtures | PASS — 293 checks: 25 shared Operations, 72 Operations Head, 49 Trip Approvals, 147 Dispatcher |
| Responsive layout checks | PASS — 30 layouts across the existing role regressions and refined Dispatcher pages |
| Native filter keyboard/focus checks | PASS — 4 desktop/tablet/mobile variants, Escape, Enter, focus return, visible outline contrast |
| JavaScript syntax and whitespace | PASS — Dispatcher module and browser runner parse; `git diff --check` clean |
| Live authenticated persistence / database integration | NOT RUN — no dedicated disposable-database credentials or opt-in |

The native keyboard check was corrected to send a complete Enter event, including its text event. The filter dialog itself receives initial focus so opening it does not inadvertently activate a native select; Tab reaches its controls, and Escape returns to Filters. Earlier failed verification runs were corrected and rerun successfully; the figures above describe the final run.

Browser fixtures mock every API and upload; they do not verify real database persistence or authenticated upload/download behavior. Responsive captures cover 1920px, 1440px, 820px, and 390px widths, including 568px-tall mobile filter panels, fund/incident modals, tables, and the trip drawer. Checks reject document overflow, horizontally clipped form controls, panels outside the viewport, and hidden drawer footers. Desktop request, fund, and Dashboard screenshots and the mobile filter screenshot were also visually inspected. Full browser results are in ignored `tests/reports/ops-head-browser.txt` and `tests/reports/dispatcher-refinement-checks.txt`.

Diesel PO creation, approval, and issuance remain unavailable because the verified repository implements document attachments only. The existing safe disabled request action and explanation remain; authorized attachments and viewing still work. No new purchasing workflow was introduced.

Existing loaded-list limits remain: history/funds/fuel trips up to 1,000 rows, incidents up to 300, and documents up to 2,000. Filters on these pages operate over the authorized loaded records; Trip Requests retains server pagination. Document trip filtering uses actual direct trip associations, without inventing a relationship for incident-linked files. Availability remains a current snapshot rather than a future reservation.

No dedicated disposable-database credentials or integration opt-in were present. No database test was run against the development database; no database was created, reset, dropped, truncated, or overwritten. No remote GitHub changes, commit, push, merge, branch deletion, or deployment were performed. All source edits remain in the verified local checkout.
