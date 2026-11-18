-- Additive dispatcher account-to-truck authorizations.
-- Review and back up the target database before installing. No automatic migration.
-- One vehicle may be authorized to multiple accounts (including different shifts).
-- This does NOT grant trip ownership or bypass existing vehicle holds.
CREATE TABLE IF NOT EXISTS dispatcher_truck_authorizations (
  dispatcher_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  authorized_by INT NOT NULL,
  authorized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dispatcher_id, vehicle_id),
  INDEX idx_dispatcher_truck_vehicle (vehicle_id, dispatcher_id),
  CONSTRAINT fk_dispatcher_truck_user FOREIGN KEY (dispatcher_id) REFERENCES users(id),
  CONSTRAINT fk_dispatcher_truck_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_dispatcher_truck_authorized_by FOREIGN KEY (authorized_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-15_15_dispatcher_truck_authorizations');
