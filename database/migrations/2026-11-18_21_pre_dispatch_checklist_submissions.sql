-- Append-only full pre-dispatch checklist submissions (each reinspection kept).
-- Additive; original inspections table and trip/dispatch constraints are unchanged.
-- Apply only through the approved backup + migration process.
CREATE TABLE IF NOT EXISTS pre_dispatch_checklist_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  attempt_number INT NOT NULL,
  items_json MEDIUMTEXT NOT NULL,
  has_not_ok TINYINT NOT NULL DEFAULT 0,
  odometer_km INT NULL,
  fuel_level VARCHAR(20) NULL,
  remarks VARCHAR(500) NULL,
  maintenance_job_id INT NULL,
  actor_id INT NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pdc_submissions_trip (trip_id, attempt_number, id),
  INDEX idx_pdc_submissions_repair (maintenance_job_id),
  CONSTRAINT fk_pdc_sub_trip FOREIGN KEY (trip_id) REFERENCES trips(id),
  CONSTRAINT fk_pdc_sub_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_pdc_sub_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT fk_pdc_sub_repair FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
