-- V4.3: reuse the authoritative vehicle/person relationships; never backfill or rewrite assignments.
-- Preflight: SELECT assigned_driver_id, COUNT(*) FROM vehicles WHERE active=1
-- AND assigned_driver_id IS NOT NULL GROUP BY assigned_driver_id HAVING COUNT(*)>1;
-- If duplicates exist the UNIQUE constraint deliberately fails. Resolve them explicitly before retrying.
SET @fleetops_v43_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vehicles' AND COLUMN_NAME='active_fixed_driver_id'),
  'DO 0',
  'ALTER TABLE vehicles ADD COLUMN active_fixed_driver_id INT GENERATED ALWAYS AS (CASE WHEN active=1 THEN assigned_driver_id ELSE NULL END) STORED, ADD UNIQUE KEY uq_vehicle_active_fixed_driver (active_fixed_driver_id)'
);
PREPARE fleetops_v43_stmt FROM @fleetops_v43_sql;
EXECUTE fleetops_v43_stmt;
DEALLOCATE PREPARE fleetops_v43_stmt;
SET @fleetops_v43_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vehicles' AND INDEX_NAME='uq_vehicle_active_fixed_driver'),
  'DO 0',
  'ALTER TABLE vehicles ADD UNIQUE KEY uq_vehicle_active_fixed_driver (active_fixed_driver_id)'
);
PREPARE fleetops_v43_stmt FROM @fleetops_v43_sql;
EXECUTE fleetops_v43_stmt;
DEALLOCATE PREPARE fleetops_v43_stmt;
SET @fleetops_v43_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='helper_substitution_reason'),
  'DO 0',
  'ALTER TABLE trips ADD COLUMN helper_substitution_reason VARCHAR(255) NULL COMMENT ''Trip-only helper substitution; permanent helper remains on vehicles'''
);
PREPARE fleetops_v43_stmt FROM @fleetops_v43_sql;
EXECUTE fleetops_v43_stmt;
DEALLOCATE PREPARE fleetops_v43_stmt;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-11_11_operations_v43');
