-- Additive driver-to-specific-truck authorizations, managed from Driver masterlist.
-- Backfill legacy fixed pairings so no existing driver loses permission on upgrade.
-- This does not alter historical trip assignments or drop vehicle constraints.
CREATE TABLE IF NOT EXISTS driver_truck_authorizations (
    driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    authorized_by INT NULL,
    authorized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (driver_id, vehicle_id),
    KEY idx_driver_truck_vehicle (vehicle_id),
    CONSTRAINT fk_driver_truck_driver FOREIGN KEY (driver_id) REFERENCES personnel(id),
    CONSTRAINT fk_driver_truck_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    CONSTRAINT fk_driver_truck_authorized_by FOREIGN KEY (authorized_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO driver_truck_authorizations (driver_id,vehicle_id,authorized_by)
SELECT v.assigned_driver_id,v.id,NULL FROM vehicles v
JOIN personnel p ON p.id=v.assigned_driver_id AND p.person_type='Driver'
WHERE v.assigned_driver_id IS NOT NULL;
