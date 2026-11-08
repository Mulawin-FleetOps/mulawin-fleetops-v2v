# Billing Rate Approval — charges and per-trip rate adjustments need Admin approval

Marker: `BILLING_ADJUSTMENT_APPROVAL_V1` · Migration: `database/migrations/2026-11-09_09_billing_adjustments.sql`

## Rules
| What | How |
| --- | --- |
| Automatic billing | Unchanged: base = MAX(distance km × client rate per km, minimum charge). `client_rates` and `base_amount` are never changed by an adjustment. |
| Request (Billing only) | **Request charge / adjustment** in the billing record (For Billing only). Type **Additional Charge** (positive) or **Rate Adjustment** (peso amount, Increase or Decrease/discount; reason required). Saved as **Pending Approval**. |
| Decision (Admin only) | Approve or reject (reject needs a reason) from the **Approvals** tab or the billing record. The requester can never decide (separation of duties). |
| Total | Only **Approved** lines count (`Billing::COUNTED`). Pending, Rejected, Withdrawn, Superseded and Removed rows never enter the total or the printed invoice. |
| Change / removal of an approved line | Never edited or deleted. **Change** / **Remove** creates a new pending request pointing to the line (`replaces_id`). Approving it supersedes / removes the old line in the same transaction; rejecting it leaves the old line as it was. One open request per line. |
| Withdraw | Billing can withdraw a pending request (status Withdrawn; kept as history). |
| Total above zero | A request, and an approval, is refused if the approved total would become zero or negative. |
| Finalize | Refused while any request of that billing is pending. The total is recomputed from approved lines at finalize. Finalized (Invoiced / Partially Paid / Paid) records accept no request or decision. |
| Trip operations | Requests exist only for For Billing records (trip completed). Planning, dispatch and completion do not read `billing_charges`. |
| Documents | Billing verification now requires Waybill **+ Delivery Receipt** + Acknowledgement Receipt (Trip Completion already requires the DR). |
| Notifications / audit | Every Admin gets "Billing approval" (key `billing-adj-<id>`), resolved on decision or withdrawal; the requester is told the result. Request, change, removal, withdrawal, approval and rejection are audited. |

## Install (existing database)
1. Back up the database.
2. Import `database/migrations/2026-11-09_09_billing_adjustments.sql` **once** (a second import is refused by `schema_migrations`).
3. Deploy the PHP/JS. Fresh installs: `schema.sql` + `extension.sql` already contain the change.

Existing charges become **Approved** (grandfathered, note "Recorded before the approval workflow"); no billing total changes.

## Rollback
* **Code only:** revert the merge commit. The added columns are harmless to the old code **only while every row is Approved**.
* **After new requests exist (limitation):** the old code adds up *every* `billing_charges` row. Pending, Rejected, Withdrawn, Superseded, Removed and Removal-request rows would then be counted, and the old Remove button would hard-delete rows. Before reverting the code, review and clean those rows for **For Billing** records only, for example:
  ```sql
  -- review first
  SELECT b.id, b.status, c.* FROM billing_charges c JOIN billings b ON b.id=c.billing_id
   WHERE NOT (c.status='Approved' AND c.request_type<>'Removal');
  ```
  Moving or deleting those rows erases approval history, so export them first. Do not touch Invoiced / Paid records:
  their stored totals are final and were computed from approved lines only.
* **Schema:** dropping the new columns / constraints is possible but not needed for the old code; the old
  `chk_bcharge_amount (amount > 0)` cannot be restored while approved discounts (negative rows) exist.

Tests: `tests/run_billing_adjustment_tests.php` (126 checks).
