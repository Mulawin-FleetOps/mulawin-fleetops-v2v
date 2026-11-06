-- =====================================================================
--  2026-11-06_01_phase1_supplier_snapshot_and_trip_key.sql  —  Phase 1
-- =====================================================================
--  For an EXISTING database. Import AFTER 2026-11-06_00_schema_migrations.sql,
--  together with the Phase 1 code. A fresh install does not need it.
--  Steps: Admin > Backup > Create backup (download it) -> upload the new code ->
--         phpMyAdmin -> choose the database -> Import this file ONCE.
--
--  What it does (nothing is deleted):
--   1. purchase_orders: supplier details are saved IN the purchase order (snapshot):
--      supplier_name, supplier_address, supplier_contact, supplier_phone, supplier_email.
--      supplier_id becomes optional (kept for old purchase orders).
--      Old purchase orders are filled in from the suppliers table, so they still show,
--      print and pay exactly as before. The suppliers table is kept.
--   2. trips.request_key: blocks a duplicate trip when the same New Trip form is sent twice
--      (double click, slow internet, retry).
-- =====================================================================

-- Stops here (duplicate key error) if this migration was already imported.
INSERT INTO schema_migrations (id) VALUES ('2026-11-06_01_phase1_supplier_snapshot_and_trip_key');

ALTER TABLE purchase_orders
  ADD COLUMN supplier_name    VARCHAR(150) NULL COMMENT 'supplier details saved with the PO (snapshot)' AFTER supplier_id,
  ADD COLUMN supplier_address VARCHAR(255) NULL AFTER supplier_name,
  ADD COLUMN supplier_contact VARCHAR(120) NULL COMMENT 'contact person' AFTER supplier_address,
  ADD COLUMN supplier_phone   VARCHAR(60)  NULL AFTER supplier_contact,
  ADD COLUMN supplier_email   VARCHAR(120) NULL AFTER supplier_phone,
  MODIFY supplier_id INT NULL COMMENT 'old supplier masterlist link (purchase orders made before the snapshot)';

UPDATE purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
   SET o.supplier_name = s.name, o.supplier_address = s.address, o.supplier_contact = s.contact_person,
       o.supplier_phone = s.contact_number, o.supplier_email = s.email
 WHERE o.supplier_name IS NULL;

ALTER TABLE purchase_orders ADD INDEX idx_po_supplier_name (supplier_name);

ALTER TABLE trips
  ADD COLUMN request_key CHAR(36) NULL COMMENT 'one per New Trip form; blocks duplicate submissions' AFTER trip_ref,
  ADD UNIQUE KEY uq_trip_request_key (request_key);
