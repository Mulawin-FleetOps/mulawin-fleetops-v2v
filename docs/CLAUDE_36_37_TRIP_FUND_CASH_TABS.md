# Checklist #36 / #37 — Cash-only trip fund release and Trip Fund tabs

Branch: `feature/claude-36-37-trip-fund-cash-tabs` · Markers: `CHECKLIST_36_CASH_ONLY_TRIP_FUND_RELEASE_V1`,
`CHECKLIST_37_TRIP_FUND_TABS_V1` · **No database migration.**

Checklist text: *"adjust yung sa trip fund release cash lang talaga ang payment method at release date hindi dapat nababago
kung kelan ang release date yon ang marerecord"* (#36) and *"alisin ang 'all request' sa trip fund page, tapos i-rename naman
ang 'to liquidate' nang 'to release'"* (#37).

## #36 — Cash-only release, server date

| | Before | Now |
| --- | --- | --- |
| Release form | payment method (Cash / Cheque / Bank Transfer / E-wallet), release date, cheque / bank / reference | confirmation only: amount, "Payment method: Cash", "Release date: recorded automatically as today" |
| Payment method (API) | any of the 4 | **Cash only**; any other value refused (400) |
| Release date (API) | chosen by Finance, could be backdated | **server date** at release (Philippine time), taken after the row lock; a sent date is refused unless it is today (and is never used) |
| Cheque no. / bank / reference | allowed | refused when filled in (not applicable to cash) |

Unchanged: Finance-only permission, Ready for Release status check, closed-trip check (Cancelled / Rejected / Completed),
release window (#40, `fund_release_lead_hours`), voucher (`PV-YYYY-NNNN`), Trip Allowance expense, audit row
("fund released … via Cash"), notifications, liquidation. Shared `Money::METHODS` / `Money::paymentFields` (Billing
payments, Finance payments, Purchasing) are **not** changed — the cash-only rule is `Funds::cashReleaseFields()`.

Double-click and two Finance users at once: the fund row is locked (`FOR UPDATE`); the second release sees "Released"
and is refused (409). Every refused release writes nothing (no voucher, expense, audit row or notification).

## #37 — Trip Fund tabs

Inspection of the current page (before this change): "All requests" was already removed and "To Liquidate" was already
renamed "For liquidation". The checklist's literal rename ("To Liquidate" → "To Release") would now either duplicate the
"Ready for release" tab or put a release name on the liquidation list (hiding the Liquidate action under a wrong label).

**Arrangement (implemented):**

| Tab | Shows | Main action |
| --- | --- | --- |
| Pending approval | Pending Approval | Approve / Reject (Operations Head) |
| **To Release** (was "Ready for release") | approved requests (status Ready for Release) | Confirm Release (Finance), or "Release opens …" |
| For liquidation | Released, not liquidated, trip Completed / Cancelled | Liquidate (Finance) |
| Needs revision | Rejected, trip still open | Revise (dispatcher) |
| History | everything else | view / print |

The status value "Ready for Release" (database, badges, dashboard) is unchanged; only the tab and card label say "To release".

## Tests

`tests/run_fund_release_tests.php` (new, 70 checks): cash release (voucher, expense, audit, server date), non-Cash methods
and payment details via API, backdated / future / malformed dates, unknown fields ignored, double / triple click, two
Finance users in two PHP processes waiting on the same lock, release window and Admin change, Cancelled / Rejected /
Completed trips, not-approved funds, roles, nothing written by failures, shared payment methods unchanged, tabs, and
regression (release → checklist → dispatch → liquidation).

## Install / rollback

Copy the files (no SQL). Rollback: revert the merge commit.

## Open questions

1. Released funds whose trip is still on the road (Dispatched / In Transit) currently sit in **History** until the trip ends,
   then move to For liquidation. Should they have their own "Released (trip ongoing)" view, or show in For liquidation with
   the Liquidate button disabled until the trip ends?
2. Cash releases have no OR / reference number field now. Is a cash voucher number enough, or do you want an optional
   "received by" / OR number for cash?
3. A refused release after the voucher number is reserved inside the transaction can leave a gap in PV numbers (database
   auto-increment). Acceptable, or must vouchers be gap-free?
