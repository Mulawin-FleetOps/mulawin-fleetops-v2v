-- CHECKLIST_42_ATTENDANCE_PHASE1_V1
-- Fresh install: included in schema.sql + extension.sql. Existing DB: import this ONCE.
-- Shift remains NULL for existing personnel until Admin assigns Day or Night.
INSERT INTO schema_migrations (id) VALUES ('2026-11-08_08_attendance');
ALTER TABLE personnel ADD COLUMN duty_shift VARCHAR(5) NULL COMMENT 'Day or Night; assigned by Admin' AFTER person_type;
ALTER TABLE mechanics ADD COLUMN duty_shift VARCHAR(5) NULL COMMENT 'Day or Night; assigned by Admin' AFTER full_name;
CREATE TABLE attendance_marks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  duty_date DATE NOT NULL,
  duty_shift VARCHAR(5) NOT NULL,
  personnel_id INT NULL,
  mechanic_id INT NULL,
  status VARCHAR(7) NOT NULL,
  marked_by INT NOT NULL,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_att_person (duty_date,duty_shift,personnel_id),
  UNIQUE KEY uq_att_mech (duty_date,duty_shift,mechanic_id),
  INDEX idx_att_date (duty_date,duty_shift),
  CONSTRAINT fk_att_person FOREIGN KEY (personnel_id) REFERENCES personnel(id),
  CONSTRAINT fk_att_mech FOREIGN KEY (mechanic_id) REFERENCES mechanics(id),
  CONSTRAINT fk_att_admin FOREIGN KEY (marked_by) REFERENCES users(id),
  CONSTRAINT chk_att_kind CHECK ((personnel_id IS NOT NULL AND mechanic_id IS NULL) OR (personnel_id IS NULL AND mechanic_id IS NOT NULL)),
  CONSTRAINT chk_att_shift CHECK (duty_shift IN ('Day','Night')),
  CONSTRAINT chk_att_status CHECK (status IN ('Present','Absent'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
