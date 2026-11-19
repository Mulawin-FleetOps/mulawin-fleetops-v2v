-- PURCHASING_ORDER_RESERVATION_V1
-- Existing databases ONLY: take a verified backup and run this migration once.
-- GitHub commits do NOT execute this SQL. Fresh installs require an equivalent schema update.
-- Existing PO records and request lines remain unchanged; legacy POs explicitly remain exempt
-- from the new supplier-order confirmation (there is no historical proof of order submission).
-- A new PO after migration requires confirmation before physical receiving.
ALTER TABLE purchase_orders
  ADD COLUMN order_confirmation_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN ordered_at DATETIME NULL,
  ADD COLUMN ordered_by INT NULL,
  ADD CONSTRAINT fk_po_ordered_by FOREIGN KEY (ordered_by) REFERENCES users(id),
  ADD CONSTRAINT chk_po_order_confirmation CHECK (order_confirmation_required IN (0,1)),
  ADD CONSTRAINT chk_po_order_actor CHECK ((ordered_at IS NULL AND ordered_by IS NULL) OR (ordered_at IS NOT NULL AND ordered_by IS NOT NULL));

-- Line-level reservation is separate from stock on hand and from Purchasing budget reservation.
-- Zero default for historical requests: never manufacture allocations for past records.
ALTER TABLE part_request_lines
  ADD COLUMN reserved_qty INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_preq_reservation CHECK (reserved_qty >= 0 AND reserved_qty + released_qty <= quantity);

CREATE INDEX idx_preq_lines_part ON part_request_lines(part_id);
