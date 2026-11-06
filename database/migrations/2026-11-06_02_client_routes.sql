-- =====================================================================
--  2026-11-06_02_client_routes.sql  —  Approved routes per client (Checklist #20)
-- =====================================================================
--  For an EXISTING database. Import ONCE, AFTER 2026-11-06_00_schema_migrations.sql
--  (the schema_migrations table must exist). A fresh install does not need it:
--  database/extension.sql already has these tables and marks this migration as applied.
--
--  Steps: Admin > Backup > Create backup (download it) -> upload the new code ->
--         phpMyAdmin -> choose the database -> Import this file ONCE.
--
--  What it does (ADDITIVE ONLY — no existing table, column or row is changed):
--   1. client_routes        : one route = client + truck type + origin -> destination (directional)
--   2. client_route_rates   : versioned contractual rates (Flat or Per Km); an approved rate is never edited
--   3. client_route_events  : history of every request, rate entry, approval, rejection and deactivation
--  The old client_rates table (rate per km) and billing are NOT touched.
--
--  If the import stops halfway (for example a lost connection), see
--  docs/CLAUDE_20_CLIENT_ROUTES.md, section "Partially failed migration".
-- =====================================================================

-- Stops here (duplicate key error) if this migration was already imported.
INSERT INTO schema_migrations (id) VALUES ('2026-11-06_02_client_routes');

-- One route of one client for one truck type. Directional: A -> B and B -> A are different routes.
-- active_key: only ONE open or approved route per client + truck type + normalized origin + destination
-- (database rule, also safe when two people submit at the same time). Rejected, Withdrawn and
-- Inactive routes stay as history and do not block a new request.
CREATE TABLE client_routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_ref VARCHAR(32) NOT NULL UNIQUE,
  client_id INT NOT NULL,
  truck_type VARCHAR(25) NOT NULL,
  origin_label VARCHAR(200) NOT NULL COMMENT 'origin as displayed',
  destination_label VARCHAR(200) NOT NULL COMMENT 'destination as displayed',
  origin_key VARCHAR(200) NOT NULL COMMENT 'normalized origin (duplicate check)',
  destination_key VARCHAR(200) NOT NULL COMMENT 'normalized destination (duplicate check)',
  origin_lat DECIMAL(10,7) NULL,
  origin_lng DECIMAL(10,7) NULL,
  destination_lat DECIMAL(10,7) NULL,
  destination_lng DECIMAL(10,7) NULL,
  distance_km DECIMAL(10,2) NOT NULL COMMENT 'operational reference and analytics',
  distance_source VARCHAR(30) NOT NULL DEFAULT 'Manual' COMMENT 'Manual, or the map provider used (provider-independent)',
  notes VARCHAR(500) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending Rate',
  requested_by INT NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_reason VARCHAR(300) NULL COMMENT 'reason of rejection, withdrawal or deactivation',
  closed_by INT NULL,
  closed_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_key TINYINT AS (CASE WHEN status IN ('Pending Rate','Pending Approval','Approved') THEN 1 ELSE NULL END) STORED,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (closed_by) REFERENCES users(id),
  UNIQUE KEY uq_route_active (client_id, truck_type, origin_key, destination_key, active_key),
  INDEX idx_route_client (client_id, status),
  INDEX idx_route_status (status),
  CONSTRAINT chk_route_type CHECK (truck_type IN ('Car Carrier','Container','Wing Van')),
  CONSTRAINT chk_route_status CHECK (status IN ('Pending Rate','Pending Approval','Approved','Rejected','Withdrawn','Inactive')),
  CONSTRAINT chk_route_distance CHECK (distance_km > 0 AND distance_km <= 3000),
  CONSTRAINT chk_route_ends CHECK (origin_key <> destination_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contractual rate versions of a route. Billing enters, Admin approves (separation of duties).
--   Flat   : rate_amount = amount for the whole trip
--   Per Km : rate_amount = amount per km, never lower than minimum_charge
-- An Approved row is never edited: a revision is a NEW row; on approval the old one becomes Superseded.
-- current_key: at most ONE current approved rate per route.  pending_key: at most ONE pending rate per route.
CREATE TABLE client_route_rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  version_no INT NOT NULL,
  rate_type VARCHAR(10) NOT NULL,
  rate_amount DECIMAL(12,2) NOT NULL,
  minimum_charge DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending Approval',
  entered_by INT NOT NULL,
  entered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entry_notes VARCHAR(300) NULL,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decision_notes VARCHAR(300) NULL,
  effective_from DATETIME NULL COMMENT 'set when approved',
  effective_to DATETIME NULL COMMENT 'set when replaced by a newer approved rate',
  current_key TINYINT AS (CASE WHEN status = 'Approved' THEN 1 ELSE NULL END) STORED,
  pending_key TINYINT AS (CASE WHEN status = 'Pending Approval' THEN 1 ELSE NULL END) STORED,
  FOREIGN KEY (route_id) REFERENCES client_routes(id),
  FOREIGN KEY (entered_by) REFERENCES users(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  UNIQUE KEY uq_route_rate_version (route_id, version_no),
  UNIQUE KEY uq_route_rate_current (route_id, current_key),
  UNIQUE KEY uq_route_rate_pending (route_id, pending_key),
  CONSTRAINT chk_route_rate_type CHECK (rate_type IN ('Flat','Per Km')),
  CONSTRAINT chk_route_rate_status CHECK (status IN ('Pending Approval','Approved','Rejected','Superseded')),
  CONSTRAINT chk_route_rate_amount CHECK (rate_amount > 0 AND minimum_charge >= 0),
  CONSTRAINT chk_route_rate_min CHECK (rate_type = 'Per Km' OR minimum_charge = 0),
  CONSTRAINT chk_route_rate_version CHECK (version_no >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- History of each route (who requested, entered the rate, approved, rejected, deactivated).
CREATE TABLE client_route_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  rate_id INT NULL,
  actor_id INT NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(20) NOT NULL DEFAULT '',
  to_status VARCHAR(20) NOT NULL DEFAULT '',
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (route_id) REFERENCES client_routes(id),
  FOREIGN KEY (rate_id) REFERENCES client_route_rates(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_route_events (route_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
