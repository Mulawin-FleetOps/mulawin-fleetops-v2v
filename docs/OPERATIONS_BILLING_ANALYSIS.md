# Billing mechanism and intended route-specific rates

Status: analysis and proposal only. Existing financial behavior is unchanged; the approved Objectives of the Study are unchanged.

| Concern | Current implementation | Intended route-specific mechanism |
| --- | --- | --- |
| Billing source | `client_rates`, keyed by client + truck type | Approved version of `client_route_rates` for the chosen directional client route + truck type |
| Base calculation | `round(max(distance_km * rate_per_km, minimum_charge), 2)` | Must be agreed for each enabled rate type; approved Flat rates should not silently become km multipliers |
| Approval evidence | Existence of a legacy client rate is required for trip creation/approval | Route-rate version, approval actor/time and effective period establish approval provenance |
| Route linkage | A trip may link `client_route_id` for distance selection | Billing must use and retain the relevant approved route-rate version |
| Existing drafts | Draft generation reads current legacy rate at dispatch; eligible Ongoing/Cancelled drafts may refresh on redispatch | Explicit snapshot/refresh rules required; completed/invoiced/paid amounts need protection |

## What the code does today

`backend/Core/BillingDraft.php::createFor()` reads `rate_per_km` and `minimum_charge` from `client_rates` using only `client_id` and `truck_type`. It does not use `client_route_rates` or a route ID for its amount. It snapshots km, legacy rate, minimum and base into `billings`; total includes `charges_total`. Existing adjustment approval rules remain separate and unchanged.

`Trips::hasRate()` and its client options also depend on `client_rates`. Therefore an approved route rate alone does not remove the current requirement for a legacy client/truck-type rate.

`backend/Modules/Operations/Routes.php` maintains versioned route rates with entry/revision, approval/rejection, supersession and events. Its current policy enables **Flat**; the database and constants also recognize **Per Km**, but policy does not enable entry of that type. A pending revision does not replace the current approved version. `RouteDistance::selectable()` checks current approval for planning; the `Routes.selectable` API deliberately omits rate amounts and versions from trip-selector output. A header comment in Routes predates the distance integration: current executable code connects routes to trip distance, but still not to billing calculations.

Illustration only (not an approved or recorded amount): at 100 km, a legacy rate of PHP 50/km and minimum PHP 4,000 produces PHP 5,000. A route's separately approved Flat amount of PHP 8,000 would describe a different pricing basis. The UI must not relabel PHP 5,000 as an approved route rate. The redesign displays route distance and approval linkage, and does not calculate or display a new route price.

## Proposed implementation after separate approval

1. Agree enabled Flat/Per Km formulas, minimum treatment, extra charges, return legs, route deviations, taxes, currency rounding, effective-time selection (booking/approval/dispatch), revised-rate handling and redispatch rules. No formula may be inferred from a route label.
2. Add explicit route ID, approved rate-version ID, basis, amount/minimum and approval/effective metadata snapshots to the billing contract/schema. Keep legacy pricing identifiable and immutable where already finalized. Never manufacture an approved rate from legacy computed totals.
3. Resolve and lock the approved rate version through a shared pricing service. Change `BillingDraft::createFor()` and the appropriate validation/read contracts to use that service only for an explicitly approved rollout cohort. Preserve existing charge-approval logic.
4. Review every direct `client_rates` dependency, including trip client eligibility, Billing calculations, Client Masterlist screens and reports. A partial switch only in the New Trip UI would misrepresent backend behavior.
5. Define a controlled transition for existing requests, assignments, dispatched trips and drafts. Do not rewrite historical invoices, collections or payroll consequences. Run read-only comparisons on disposable fixtures before an approved migration.
6. Test Flat and any authorized Per Km pricing, rounding/minimum boundaries, rate revisions and races, inactive routes, retries, redispatch, additional-charge approvals, completion/finalization/collection, legacy unchanged totals and role visibility.

No billing, rate approval, schema or financial API changes were made by this redesign.
