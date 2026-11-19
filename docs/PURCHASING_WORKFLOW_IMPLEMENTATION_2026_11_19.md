# Purchasing Workflow — implementation and deployment notes (2026-11-19)

Branch: `luis`. These source changes were committed; **neither an existing database migration nor browser acceptance tests were executed by this change**.

## Independent workflows

1. **Motorpool Parts Request**: Motorpool creates a request, associated with a truck and optionally an open repair. A real available quantity is reserved atomically when the new line is created (once the migration is applied). A shortage stays outstanding; no purchase order is automatically created. Purchasing explicitly releases stock. Cancellation of an unprocessed request clears reservation. The original request record remains in history.
2. **Purchasing PO**: Purchasing creates an independent PO for stock replenishment or optionally links it to a Motorpool shortage. Finance/Admin approval continues to enforce the existing approval limit and reserve purchasing budget. **Approval is not supplier ordering**. Purchasing must explicitly confirm the actual supplier order; new POs after migration cannot be received before confirmation. Historical POs retain their existing receiving eligibility, with no fabricated order time.
3. **Physical receiving**: Purchasing records delivered units, evidence and warranty coverage. Only this action adds on-hand stock. Partial receipt is supported; available newly received units are allocated to outstanding requests in oldest-request order. A PO payment never performs receiving.
4. **Inventory**: On Hand is physical quantity; Reserved is allocated, not yet released stock; Available = MAX(0, On Hand - Reserved). Stock release reduces both the relevant reservation and on-hand, and cannot take other requests' reserved inventory.
5. **Stock movements and counts**: Existing physical stock-in/stock-out/adjustment log remains authoritative. Reservation itself is not a stock movement. Admin-reviewed stock counts cannot post a quantity below recorded reservations.
6. **Finance**: Payment and budget logic stay separate. Purchasing PO API payloads omit payment_status and paid_amount for the Purchasing role; Finance retains its existing workflows.

## Required deployment order

- Back up the actual database, check the backup, and confirm a recovery plan.
- For an **existing installation**, apply `database/migrations/2026-11-19_01_purchasing_order_and_stock_reservations.sql` once. Do **not** import `database/extension.sql` over an existing DB.
- For a **new empty install**, the fresh-install `database/extension.sql` already contains the new columns; do not also import the migration.
- Deploy `luis` after the schema update. Backend feature detection keeps old installations readable; prior to migration, reservation and mandatory ordering cannot be assumed active.
- Verify DB column existence before acceptance: `purchase_orders.order_confirmation_required`, `purchase_orders.ordered_at`, `purchase_orders.ordered_by`, `part_request_lines.reserved_qty`.
- Do not backfill historical `ordered_at` or `reserved_qty` using guesses.

## Mandatory real-database acceptance checks (not yet executed)

- New Motorpool request with sufficient physical free stock: reservation increases; physical quantity unchanged; no PO generated.
- New request with a shortage: reserve only available units, leave the rest outstanding; original request remains.
- Concurrent requests for the same last stock: no double reservation; verify InnoDB lock/deadlock behavior.
- Existing reserved request: release correctly reduces the specific reservation and physical stock; cannot use another request's reservation.
- Cancel a still-Requested request: releases held stock and retains its history.
- PO submitted independently (no request), approved by correct role: no `ordered_at`, no stock-in; receiving refused for new PO until Purchasing confirms ordering.
- After Purchasing order confirmation: receiving supports partial quantity, physical movement and warranty evidence; no duplicate receipt.
- Supplier delivery allocates available stock to outstanding requests; Motorpool does not show it as Released until Purchasing actually releases it.
- Paying a PO in Finance must not change delivery status, inventory quantity or request fulfillment.
- Stock count lower than active reservations is refused; normal reviewed count retains Admin and evidence rules.
- Purchasing cannot see Finance payment status in PO listing, details or API; Finance remains able to process authorized payments.
- Previous approved, partially received, received, rejected and closed POs remain readable and valid. Audit and notifications remain intact.
- Verify cross-role pages on laptop/mobile; JS source syntax checks do not replace live behavior tests.

## Rollback cautions

Code rollback after new reservations have been recorded can leave active reserved quantities unused by old code; do not simply revert the application without an inventory reconciliation plan. Do not drop the new columns while new records reference them. Historical records and physical stock movements must never be reset as a shortcut.
