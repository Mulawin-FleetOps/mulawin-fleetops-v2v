-- Additive planning ownership. NULL preserves legacy group-wide trip access.
-- No departure-time inference, account assignment, or historical backfill.
SET @fleetops_planning_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='dispatcher_shift'),
  'DO 0',
  'ALTER TABLE trips ADD COLUMN dispatcher_shift VARCHAR(5) NULL COMMENT ''Manual planning ownership; NULL for legacy group-wide trips'' AFTER dispatcher_role, ADD CONSTRAINT chk_trip_dispatcher_shift CHECK (dispatcher_shift IS NULL OR (dispatcher_shift IN (''Day'',''Night'') AND dispatcher_role IS NOT NULL AND dispatcher_role IN (''car_carrier_dispatcher'',''container_wingvan_dispatcher''))), ADD INDEX idx_trip_dispatcher_shift (dispatcher_role,dispatcher_shift,status)'
);
PREPARE fleetops_planning_stmt FROM @fleetops_planning_sql;
EXECUTE fleetops_planning_stmt;
DEALLOCATE PREPARE fleetops_planning_stmt;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-10_10_trip_dispatcher_shift');
