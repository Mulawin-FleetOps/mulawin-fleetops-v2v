-- =====================================================================
--  2026-11-05_checklist_timer.sql  —  Minimum checklist duration (PDF #11 section G)
-- =====================================================================
--  For an EXISTING database. Import AFTER 2026-11-05_arrival_checklist.sql, together
--  with the new code. Import once. A fresh install does not need it.
--
--  - checklist_starts: when the dispatcher opened each checklist (per trip attempt and kind)
--  - inspections.started_at: start time kept with the submitted checklist
--  The minimum (default 15 minutes, 0 = off) is changed by the Admin in
--  User Management > Settings > "Minimum checklist duration".
-- =====================================================================

CREATE TABLE checklist_starts (
  trip_id INT NOT NULL,
  attempt_number INT NOT NULL,
  kind VARCHAR(15) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_by INT NOT NULL,
  PRIMARY KEY (trip_id, attempt_number, kind),
  CONSTRAINT chk_cstart_kind CHECK (kind IN ('Pre-Dispatch','Arrival')),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (started_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE inspections ADD COLUMN started_at DATETIME NULL COMMENT 'when the checklist was opened (minimum duration timer)' AFTER actor_id;
