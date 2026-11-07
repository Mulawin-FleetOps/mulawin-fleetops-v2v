-- =====================================================================
--  2026-11-07_07_trip_routing.sql  —  Road distance in Trip Management (Checklist #5 Phase 3)
-- =====================================================================
--  For an EXISTING database. Import ONCE, AFTER 2026-11-06_04_maps_routing.sql
--  (and after 05 / 06 of the account security work). A fresh install does not need it:
--  database/extension.sql already has these statements and marks this migration as applied.
--
--  Steps: Admin > Backup > Create backup (download it) -> upload the new code ->
--         phpMyAdmin -> choose the database -> Import this file ONCE.
--
--  What it does (ADDITIVE ONLY — no row is changed, no column is removed):
--   1. trips        : 7 new columns for the distance source, the computed / approved-route km,
--                     the route option, the manual override reason and the approved client route used.
--                     Existing trips get distance_source = 'Manual' (their km was typed) and NULL elsewhere.
--   2. trip_routes  : the road line of a trip (kept apart so the trip lists stay small).
--  Billing is NOT changed: the billing draft still uses trips.distance_km x client rate per km.
--
--  If the import stops halfway, see docs/CLAUDE_05_PHASE3_TRIP_ROUTING.md, "Partially failed migration".
-- =====================================================================

-- Stops here (duplicate key error) if this migration was already imported.
INSERT INTO schema_migrations (id) VALUES ('2026-11-07_07_trip_routing');

ALTER TABLE trips
  ADD COLUMN distance_source VARCHAR(30) NOT NULL DEFAULT 'Manual' COMMENT 'Manual, Map, Map (edited), Client Route, Client Route (edited)',
  ADD COLUMN route_option VARCHAR(20) NULL COMMENT 'recommended, avoid_tolls or general_roads',
  ADD COLUMN distance_computed_km DECIMAL(10,2) NULL COMMENT 'road km computed by the map service, or the km of the approved client route',
  ADD COLUMN distance_provider VARCHAR(60) NULL COMMENT 'e.g. openrouteservice/driving-hgv or Client route RTE-2026-0001',
  ADD COLUMN distance_computed_at DATETIME NULL,
  ADD COLUMN distance_override_reason VARCHAR(300) NULL COMMENT 'why the billable km differs from the computed / route km',
  ADD COLUMN client_route_id INT NULL COMMENT 'approved client route chosen for this trip (history: kept even if the route is later deactivated)',
  ADD CONSTRAINT fk_trip_client_route FOREIGN KEY (client_route_id) REFERENCES client_routes(id),
  ADD CONSTRAINT chk_trip_distance_source CHECK (distance_source IN ('Manual','Map','Map (edited)','Client Route','Client Route (edited)')),
  ADD CONSTRAINT chk_trip_route_option CHECK (route_option IS NULL OR route_option IN ('recommended','avoid_tolls','general_roads')),
  ADD CONSTRAINT chk_trip_computed_km CHECK (distance_computed_km IS NULL OR (distance_computed_km > 0 AND distance_computed_km <= 3000));

CREATE TABLE trip_routes (
  trip_id INT PRIMARY KEY,
  geometry MEDIUMTEXT NOT NULL COMMENT 'route line (encoded polyline) for display',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
