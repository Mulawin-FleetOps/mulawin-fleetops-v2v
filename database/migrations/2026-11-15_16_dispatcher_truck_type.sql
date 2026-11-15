-- Additive: record one truck type for new Dispatcher accounts.
-- Existing Dispatcher accounts remain NULL until explicitly edited by Admin.
-- An unset type retains the legacy role-based type scope.
ALTER TABLE users
  ADD COLUMN dispatcher_truck_type VARCHAR(25) NULL AFTER shift,
  ADD CONSTRAINT chk_user_dispatcher_type CHECK (
    dispatcher_truck_type IS NULL OR
    (role='car_carrier_dispatcher' AND dispatcher_truck_type='Car Carrier') OR
    (role='container_wingvan_dispatcher' AND dispatcher_truck_type IN ('Container','Wing Van'))
  );
INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-15_16_dispatcher_truck_type');
