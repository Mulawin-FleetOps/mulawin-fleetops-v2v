-- Additive shipment fields for individual trip planning.
-- Existing trips retain their records; no data is removed or updated.
-- Operational migration: verify a backup and target database before applying.
ALTER TABLE trips
  ADD COLUMN cargo_description VARCHAR(300) NULL,
  ADD COLUMN cargo_quantity INT NULL,
  ADD COLUMN cargo_unit VARCHAR(30) NULL,
  ADD COLUMN vehicle_details VARCHAR(300) NULL,
  ADD COLUMN estimated_weight_kg DECIMAL(10,2) NULL;
