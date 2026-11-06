-- =====================================================================
--  2026-11-06_04_maps_routing.sql  —  Road distance (openrouteservice) for Client Routes (Checklist #5)
-- =====================================================================
--  For an EXISTING database. Import ONCE, AFTER 2026-11-06_02_client_routes.sql and
--  2026-11-06_03_audit_changes.sql. A fresh install does not need it (extension.sql has it).
--
--  Steps: Admin > Backup > Create backup (download it) -> upload the new code ->
--         phpMyAdmin -> choose the database -> Import this file ONCE.
--
--  What it does (ADDITIVE ONLY — no row is changed, no column is removed):
--   1. map_cache       : saved map answers (same points = no new call to the map service)
--   2. map_api_usage   : calls per day per service (stops before the free daily quota is used up)
--   3. map_user_usage  : calls per user per minute
--   4. client_routes   : 6 new nullable columns for the computed road distance and the manual override.
--      Existing routes keep distance_source = 'Manual' and get NULL in the new columns.
--
--  If the import stops halfway, see docs/CLAUDE_05_OSM_ROUTING.md, "Partially failed migration".
-- =====================================================================

-- Stops here (duplicate key error) if this migration was already imported.
INSERT INTO schema_migrations (id) VALUES ('2026-11-06_04_maps_routing');

CREATE TABLE map_cache (
  cache_key CHAR(64) PRIMARY KEY COMMENT 'sha256 of service + provider + option + rounded points or search text',
  service VARCHAR(20) NOT NULL,
  payload MEDIUMTEXT NOT NULL COMMENT 'JSON answer (no API key, no user data)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX idx_map_cache_expiry (expires_at),
  CONSTRAINT chk_map_cache_service CHECK (service IN ('route','search','reverse'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE map_api_usage (
  usage_date DATE NOT NULL,
  service VARCHAR(20) NOT NULL,
  calls INT NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, service),
  CONSTRAINT chk_map_usage_service CHECK (service IN ('route','search','reverse'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE map_user_usage (
  user_id INT NOT NULL,
  minute_start DATETIME NOT NULL,
  calls INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, minute_start),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE client_routes
  ADD COLUMN route_option VARCHAR(20) NULL COMMENT 'recommended, avoid_tolls or general_roads (NULL = typed km only)',
  ADD COLUMN distance_computed_km DECIMAL(10,2) NULL COMMENT 'road km computed by the map service (NULL = not computed)',
  ADD COLUMN distance_provider VARCHAR(60) NULL COMMENT 'e.g. openrouteservice/driving-hgv',
  ADD COLUMN distance_computed_at DATETIME NULL,
  ADD COLUMN distance_override_reason VARCHAR(300) NULL COMMENT 'why the final km differs from the computed km',
  ADD COLUMN route_geometry MEDIUMTEXT NULL COMMENT 'route line (encoded polyline) for display',
  ADD CONSTRAINT chk_route_option CHECK (route_option IS NULL OR route_option IN ('recommended','avoid_tolls','general_roads')),
  ADD CONSTRAINT chk_route_computed_km CHECK (distance_computed_km IS NULL OR (distance_computed_km > 0 AND distance_computed_km <= 3000)),
  ADD CONSTRAINT chk_route_distance_source CHECK (distance_source IN ('Manual','Map','Map (edited)'));
