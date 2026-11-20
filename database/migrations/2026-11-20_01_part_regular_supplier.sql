-- PART_REGULAR_SUPPLIER_V1 (2026-11-20)
-- Apply ONCE to existing MySQL databases after backup, using the same
-- migration mechanism as the other FleetOps incremental migrations.
-- Additive, nullable field. Does not create a new supplier masterlist,
-- change historical POs, or alter stock valuation.
ALTER TABLE parts ADD COLUMN regular_supplier_name VARCHAR(150) NULL DEFAULT NULL;
-- New part forms use this column only after it exists. Existing parts
-- automatically have no preferred supplier until Purchasing sets one.
