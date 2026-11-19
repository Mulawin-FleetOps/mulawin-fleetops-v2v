-- Additive, append-only Dispatcher clarifications for incident assessments.
-- Keep the original incidents.problem/details immutable; preserve actors and timestamps.
CREATE TABLE IF NOT EXISTS incident_clarifications (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 incident_id INT NOT NULL,
 trip_id INT NOT NULL,
 actor_id INT NOT NULL,
 details VARCHAR(2000) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_ic_incident (incident_id,id),
 CONSTRAINT fk_ic_incident FOREIGN KEY (incident_id) REFERENCES incidents(id),
 CONSTRAINT fk_ic_trip FOREIGN KEY (trip_id) REFERENCES trips(id),
 CONSTRAINT fk_ic_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
