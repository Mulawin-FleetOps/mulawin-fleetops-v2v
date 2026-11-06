-- =====================================================================
--  2026-11-06_00_schema_migrations.sql  —  record of applied migrations
-- =====================================================================
--  For an EXISTING database. Import ONCE, before any other 2026-11-06 migration.
--  A fresh install does not need it (database/extension.sql already creates the table).
--
--  From now on every migration file starts with:
--      INSERT INTO schema_migrations (id) VALUES ('<file name without .sql>');
--  If the migration was already imported, that line fails (duplicate key) and phpMyAdmin
--  STOPS before any change is made. This prevents running a migration twice.
--
--  BEFORE IMPORTING: check which older migrations are really applied on this server and
--  delete from the INSERT below the ones that are NOT applied. How to check:
--    2026-11-04_account_security : users table has the column recovery_hash
--    2026-11-05_arrival_checklist: inspections table has the column kind
--    2026-11-05_checklist_timer  : the table checklist_starts exists
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(80) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (id) VALUES
  ('2026-11-04_account_security'),
  ('2026-11-05_arrival_checklist'),
  ('2026-11-05_checklist_timer'),
  ('2026-11-06_00_schema_migrations');
