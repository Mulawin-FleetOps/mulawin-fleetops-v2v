-- Mulawin Audit Phase 1. Existing database only, AFTER 2026-11-06_00_schema_migrations.sql.
-- Back up your database before importing. Import once. Fresh installations use schema.sql + extension.sql.
-- Only new audit events get structured before/after rows; historical data is preserved.
INSERT INTO schema_migrations (id) VALUES ('2026-11-06_03_audit_changes');
CREATE TABLE audit_event_changes (
  audit_event_id BIGINT PRIMARY KEY,
  changes_json LONGTEXT NOT NULL,
  CONSTRAINT fk_audit_changes_event FOREIGN KEY (audit_event_id) REFERENCES audit_events(id) ON DELETE CASCADE,
  CONSTRAINT chk_audit_changes_json CHECK (JSON_VALID(changes_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
