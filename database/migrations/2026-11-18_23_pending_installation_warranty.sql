-- Add a distinct state when a supplier's warranty starts upon installation, but
-- the actual installation date has not been confirmed. Preserve all existing rows.
ALTER TABLE part_warranty_batches
  DROP CONSTRAINT chk_warranty_status,
  DROP CONSTRAINT chk_warranty_complete,
  ADD CONSTRAINT chk_warranty_status CHECK (
    warranty_status IN ('With Warranty','No Warranty','Not Yet Confirmed','Pending Installation')
  ),
  ADD CONSTRAINT chk_warranty_complete CHECK (
    (warranty_status='With Warranty' AND warranty_months BETWEEN 1 AND 120
      AND warranty_start IS NOT NULL AND warranty_expires IS NOT NULL
      AND (start_basis IN ('Delivery','Purchase','Invoice','Installation','Other') OR start_basis IS NULL))
    OR (warranty_status IN ('No Warranty','Not Yet Confirmed') AND warranty_months IS NULL
      AND warranty_start IS NULL AND warranty_expires IS NULL AND start_basis IS NULL)
    OR (warranty_status='Pending Installation' AND warranty_months BETWEEN 1 AND 120
      AND warranty_start IS NULL AND warranty_expires IS NULL AND start_basis='Installation')
  );
INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-18_23_pending_installation_warranty');
