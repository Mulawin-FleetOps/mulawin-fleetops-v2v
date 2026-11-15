-- Additive Dispatcher attendance sessions. Existing attendance_marks and operational rows are untouched.
CREATE TABLE IF NOT EXISTS dispatcher_attendance_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  personnel_id INT NOT NULL,
  dispatcher_role VARCHAR(40) NOT NULL,
  duty_date DATE NOT NULL,
  duty_shift VARCHAR(5) NOT NULL,
  time_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_out DATETIME NULL,
  timed_in_by INT NOT NULL,
  timed_out_by INT NULL,
  request_key CHAR(36) NOT NULL,
  time_out_key CHAR(36) NULL,
  open_personnel_id INT GENERATED ALWAYS AS (CASE WHEN time_out IS NULL THEN personnel_id ELSE NULL END) STORED,
  UNIQUE KEY uq_dispatcher_open_person (open_personnel_id),
  UNIQUE KEY uq_dispatcher_time_in_key (request_key),
  UNIQUE KEY uq_dispatcher_time_out_key (time_out_key),
  INDEX idx_dispatcher_session_person (personnel_id,id),
  INDEX idx_dispatcher_session_shift (duty_date,duty_shift),
  CONSTRAINT fk_ds_person FOREIGN KEY (personnel_id) REFERENCES personnel(id),
  CONSTRAINT fk_ds_in_user FOREIGN KEY (timed_in_by) REFERENCES users(id),
  CONSTRAINT fk_ds_out_user FOREIGN KEY (timed_out_by) REFERENCES users(id),
  CONSTRAINT chk_ds_role CHECK (dispatcher_role IN ('car_carrier_dispatcher','container_wingvan_dispatcher')),
  CONSTRAINT chk_ds_shift CHECK (duty_shift IN ('Day','Night')),
  CONSTRAINT chk_ds_times CHECK (time_out IS NULL OR time_out>=time_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-10_09_dispatcher_sessions');
