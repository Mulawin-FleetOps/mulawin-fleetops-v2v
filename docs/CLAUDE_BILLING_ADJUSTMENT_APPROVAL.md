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
| Withdraw | Only the Billing user who made a pending request can withdraw it (403 for anyone else; status Withdrawn, kept as history). |
| Total above zero | A request, and an approval, is refused if the approved total would become zero or negative. |
| Finalize | Refused while any request of that billing is pending. The total is recomputed from approved lines at finalize. Finalized (Invoiced / Partially Paid / Paid) records accept no request or decision. |
| Trip operations | Requests exist only for For Billing records (trip completed). Planning, dispatch and completion do not read `billing_charges`. |
| Documents | Billing verification now requires Waybill **+ Delivery Receipt** + Acknowledgement Receipt (Trip Completion already requires the DR). |
| Notifications / audit | Every Admin gets "Billing approval" (key `billing-adj-<id>`), resolved on decision or withdrawal; the requester is told the result. Request, change, removal, withdrawal, approval and rejection are audited. |

## Install (existing database)
1. **Back up the database** (phpMyAdmin → Export).
2. Run the read-only check `database/migrations/checks/2026-11-09_09_billing_adjustments_check.sql`. The `state` column must say **NOT APPLIED**.
3. Import `database/migrations/2026-11-09_09_billing_adjustments.sql` **once**.
4. Run the check again. It must say **COMPLETE**.
5. Only then deploy the PHP/JS. Fresh installs: `schema.sql` + `extension.sql` already contain the change (the check says COMPLETE).

Existing charges become **Approved** (grandfathered, note "Recorded before the approval workflow"); no billing total and
no finalized invoice changes.

### Why the order is safe
MariaDB / MySQL DDL is not transactional: every statement is saved on its own. The migration therefore has four steps:

| Step | Statement | If it fails |
| --- | --- | --- |
| 1 | **One** `ALTER TABLE billing_charges` with every new column, the replaced amount CHECK and all new constraints. Existing rows get `status='Approved'` from the column default in this same statement. | A single ALTER is all-or-nothing: the table stays exactly as before and nothing is recorded (state **NOT APPLIED**). Fix the cause and import the file again. |
| 2 | Grandfather note on the old charges (repeatable). | State **PARTIAL**. |
| 3 | `status` default becomes `'Pending Approval'` (repeatable). | State **PARTIAL**. |
| 4 | `INSERT INTO schema_migrations` — **last**, only after 1-3 succeeded. | State **PARTIAL**. |

Importing the migration a second time stops at step 1 (`Duplicate column name 'kind'`) **before** changing anything,
so the amount CHECK is never dropped twice.

### Recovery from a partially applied migration
1. **Do not** import the migration again and **do not** run its ALTER statements by hand.
2. Run the check file and read `state`:
   * **COMPLETE** — nothing to do.
   * **NOT APPLIED** — step 1 did not run (or failed and rolled back). Read the error, fix the cause, import the migration file again.
   * **PARTIAL** — step 1 succeeded but the import stopped before the marker (for example, a lost connection). The data is
     already safe in this state (old charges are Approved, totals unchanged). Import
     `database/migrations/recovery/2026-11-09_09_billing_adjustments_finish.sql` (steps 2-4 only), then run the check:
     it must say COMPLETE.
   * **UNEXPECTED** — stop. Do not run any statement. Send the check result for review, or restore the backup.
3. The recovery file is safe by itself: on a database where step 1 never ran it fails at its first statement
   (`Unknown column`) and changes nothing; on a COMPLETE database it fails at the marker (`Duplicate entry`) and changes nothing.

Tested in `tests/run_billing_adjustment_tests.php` section A: normal upgrade, failed step 1 (simulated name clash),
stop after step 1 + recovery, mistaken recovery, repeated imports — each compared with a fresh install, with billings
(For Billing, Invoiced, Paid) unchanged.

## Older For Billing trips without a Delivery Receipt
Billing verification now needs Waybill + **Delivery Receipt** + Acknowledgement Receipt. Trip Completion now requires
the DR, but trips completed **before** that rule may be in For Billing without a DR file. Those records
show "Missing" in the Documents column and **Verify documents** is refused ("Missing supporting documents: Delivery Receipt").

What to do: upload the **real, signed DR** for that trip (Documents page or the trip's documents), then verify. Do not
upload a placeholder or another trip's file, and do not mark records verified in the database — the DR is the client's
proof of delivery behind the invoice. Already Invoiced / Paid records are not affected (they are never verified again).

To list the affected records before deploying:
```sql
SELECT b.id, t.trip_ref, c.company_name FROM billings b JOIN trips t ON t.id=b.trip_id JOIN clients c ON c.id=b.client_id
 WHERE b.status='For Billing' AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type='trip' AND d.entity_id=t.id AND d.category='Delivery Receipt');
```

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

Tests: `tests/run_billing_adjustment_tests.php` (173 checks, incl. migration recovery and two-process races:
request vs finalize, approval vs finalize, rejection vs finalize, finalize vs late request, two Admins approving, change vs removal).
