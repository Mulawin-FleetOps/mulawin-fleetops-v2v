-- Additive dispatcher truck-type selection. No vehicle/account deletion.
-- Each Dispatcher can select one, two or three fleet categories.
ALTER TABLE users ADD COLUMN dispatcher_truck_types JSON NULL AFTER dispatcher_truck_type;
INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-15_17_dispatcher_multi_types');
