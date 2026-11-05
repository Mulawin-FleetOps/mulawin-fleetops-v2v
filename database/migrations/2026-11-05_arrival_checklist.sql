-- =====================================================================
--  2026-11-05_arrival_checklist.sql  —  Arrival checklist (PDF #11 section G)
-- =====================================================================
--  For an EXISTING database (Hostinger / XAMPP) that was installed before this change.
--  A fresh install does not need it (database/extension.sql already has these columns).
--
--  Steps: Admin > Backup > Create backup (download it) -> upload the new code ->
--         phpMyAdmin -> choose the database -> Import this file ONCE.
--
--  What it does:
--   - inspections.kind: 'Pre-Dispatch' (old rows) or 'Arrival'
--   - one checklist per trip attempt PER KIND (was: one per trip attempt)
--   - damage_notes and maintenance_job_id for the arrival checklist
--  Existing records are not changed: every old checklist becomes 'Pre-Dispatch'.
--  Trips completed before this change do not need an arrival checklist.
-- =====================================================================

ALTER TABLE inspections
  ADD COLUMN kind VARCHAR(15) NOT NULL DEFAULT 'Pre-Dispatch' AFTER attempt_number,
  ADD COLUMN damage_notes VARCHAR(1000) NULL COMMENT 'arrival: damage, defects, missing equipment, reported incidents' AFTER remarks,
  ADD COLUMN maintenance_job_id INT NULL COMMENT 'arrival: corrective maintenance record opened for the NOT OK items' AFTER damage_notes;

-- New unique key first, so the trip_id foreign key always has an index, then drop the old one.
ALTER TABLE inspections ADD UNIQUE KEY uq_inspection_kind (trip_id, attempt_number, kind);
ALTER TABLE inspections DROP INDEX uq_inspection;

ALTER TABLE inspections ADD CONSTRAINT chk_inspection_kind CHECK (kind IN ('Pre-Dispatch','Arrival'));
ALTER TABLE inspections ADD CONSTRAINT fk_inspection_job FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id);
