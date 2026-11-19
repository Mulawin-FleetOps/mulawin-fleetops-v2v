-- Drafts do not create operational personnel/vehicle records until final Save.
-- Single unfinished Add Driver, Add Helper, and Add Truck per authorized account.
CREATE TABLE IF NOT EXISTS fleet_form_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  draft_type ENUM('driver','helper','truck') NOT NULL,
  fields_json MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fleet_form_draft_owner_type (owner_id,draft_type),
  CONSTRAINT fk_fleet_form_draft_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-19_25_fleet_form_drafts');
