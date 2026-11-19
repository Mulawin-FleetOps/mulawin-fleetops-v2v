-- Add receipt-level warranty confirmation without guessing dates for existing purchases.
-- Existing dated warranty batches remain With Warranty; old stock and PO data are unchanged.
ALTER TABLE part_warranty_batches
  MODIFY COLUMN warranty_months SMALLINT UNSIGNED NULL,
  MODIFY COLUMN warranty_start DATE NULL,
  MODIFY COLUMN warranty_expires DATE NULL,
  ADD COLUMN warranty_status VARCHAR(24) NOT NULL DEFAULT 'With Warranty' AFTER received_qty,
  ADD COLUMN start_basis VARCHAR(24) NULL AFTER warranty_status,
  ADD COLUMN updated_by INT NULL AFTER received_by,
  ADD COLUMN updated_at DATETIME NULL AFTER updated_by,
  ADD CONSTRAINT fk_warranty_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  ADD CONSTRAINT chk_warranty_status CHECK (warranty_status IN ('With Warranty','No Warranty','Not Yet Confirmed')),
  ADD CONSTRAINT chk_warranty_complete CHECK (
    (warranty_status='With Warranty' AND warranty_months BETWEEN 1 AND 120
      AND warranty_start IS NOT NULL AND warranty_expires IS NOT NULL AND start_basis IS NOT NULL)
    OR (warranty_status IN ('No Warranty','Not Yet Confirmed') AND warranty_months IS NULL
      AND warranty_start IS NULL AND warranty_expires IS NULL AND start_basis IS NULL)
    OR (warranty_status='With Warranty' AND start_basis IS NULL
      AND warranty_months BETWEEN 1 AND 120 AND warranty_start IS NOT NULL AND warranty_expires IS NOT NULL)
  );
CREATE INDEX idx_warranty_status ON part_warranty_batches(warranty_status, part_id);
INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-18_22_warranty_receipt_confirmation');
