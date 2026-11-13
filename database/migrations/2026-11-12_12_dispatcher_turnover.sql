-- Additive, no original ownership/history backfill. Apply before deploying turnover code.
CREATE TABLE IF NOT EXISTS trip_responsibilities (
 trip_id INT NOT NULL PRIMARY KEY,
 initial_dispatcher_id INT NOT NULL,
 current_dispatcher_id INT NOT NULL,
 assigned_by INT NOT NULL,
 assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 FOREIGN KEY (trip_id) REFERENCES trips(id),
 FOREIGN KEY (initial_dispatcher_id) REFERENCES users(id),
 FOREIGN KEY (current_dispatcher_id) REFERENCES users(id),
 FOREIGN KEY (assigned_by) REFERENCES users(id),
 INDEX idx_responsible_account(current_dispatcher_id,trip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dispatcher_turnovers (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 outgoing_id INT NOT NULL,
 incoming_id INT NOT NULL,
 dispatcher_role VARCHAR(40) NOT NULL,
 status VARCHAR(10) NOT NULL DEFAULT 'Pending',
 endorsed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 accepted_at DATETIME NULL,
 accepted_by INT NULL,
 remarks VARCHAR(1000) NULL,
 request_key CHAR(36) NOT NULL UNIQUE,
 FOREIGN KEY(outgoing_id) REFERENCES users(id),
 FOREIGN KEY(incoming_id) REFERENCES users(id),
 FOREIGN KEY(accepted_by) REFERENCES users(id),
 INDEX idx_turnover_incoming(incoming_id,status,id),
 INDEX idx_turnover_outgoing(outgoing_id,status,id),
 CHECK (outgoing_id<>incoming_id),
 CHECK (status IN ('Pending','Accepted')),
 CHECK (dispatcher_role IN ('car_carrier_dispatcher','container_wingvan_dispatcher')),
 CHECK ((status='Pending' AND accepted_at IS NULL AND accepted_by IS NULL) OR (status='Accepted' AND accepted_at IS NOT NULL AND accepted_at>=endorsed_at AND accepted_by IS NOT NULL AND accepted_by=incoming_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dispatcher_turnover_trips (
 turnover_id BIGINT UNSIGNED NOT NULL,
 trip_id INT NOT NULL,
 responsibility_version INT UNSIGNED NOT NULL,
 summary_json LONGTEXT NOT NULL,
 pending_trip_id INT NULL,
 PRIMARY KEY(turnover_id,trip_id),
 UNIQUE KEY uq_pending_trip_turnover(pending_trip_id),
 FOREIGN KEY(turnover_id) REFERENCES dispatcher_turnovers(id),
 FOREIGN KEY(trip_id) REFERENCES trips(id),
 FOREIGN KEY(pending_trip_id) REFERENCES trips(id),
 CHECK(pending_trip_id IS NULL OR pending_trip_id=trip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations(id) VALUES ('2026-11-12_12_dispatcher_turnover');
