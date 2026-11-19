-- Additive Motorpool catalog. Install only after backup; no data is removed.
CREATE TABLE IF NOT EXISTS mechanic_specializations (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE, active TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mechanic_skills (mechanic_id INT NOT NULL, specialization_id INT NOT NULL, PRIMARY KEY(mechanic_id,specialization_id), FOREIGN KEY (mechanic_id) REFERENCES mechanics(id), FOREIGN KEY (specialization_id) REFERENCES mechanic_specializations(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS motorpool_components (id INT AUTO_INCREMENT PRIMARY KEY, component_key VARCHAR(45) NOT NULL UNIQUE, section_key VARCHAR(30) NOT NULL, label VARCHAR(170) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS motorpool_component_skills (component_id INT NOT NULL,specialization_id INT NOT NULL, PRIMARY KEY(component_id,specialization_id), FOREIGN KEY(component_id) REFERENCES motorpool_components(id), FOREIGN KEY(specialization_id) REFERENCES mechanic_specializations(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS maintenance_job_components (maintenance_job_id INT NOT NULL, component_id INT NOT NULL, PRIMARY KEY(maintenance_job_id,component_id), FOREIGN KEY(maintenance_job_id) REFERENCES maintenance_jobs(id), FOREIGN KEY(component_id) REFERENCES motorpool_components(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS motorpool_vehicle_component_exclusions (vehicle_id INT NOT NULL,component_id INT NOT NULL,PRIMARY KEY(vehicle_id,component_id),FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),FOREIGN KEY(component_id) REFERENCES motorpool_components(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE maintenance_jobs ADD COLUMN assignment_finalized_at DATETIME NULL, ADD COLUMN assignment_finalized_by INT NULL, ADD COLUMN parts_requirement VARCHAR(25) NULL;
INSERT IGNORE INTO mechanic_specializations (name) VALUES ('Engine'),('Electrical'),('Brakes'),('Transmission'),('Suspension'),('Tires & Wheels'),('Hydraulics'),('Air Conditioning'),('General Mechanic');
INSERT IGNORE INTO motorpool_components (component_key,section_key,label) VALUES
('tractor_head_01','tractor_head','WINSHIELD'),
('tractor_head_02','tractor_head','SIDE/WIDE/BALL MIRROR (5pcs.)'),
('tractor_head_03','tractor_head','WIPER ARM & WIPER BLADE (3pairs)'),
('tractor_head_04','tractor_head','DOORS WINDOW GLASS (2pcs.)'),
('tractor_head_05','tractor_head','DOORS DRIVER/PASSENGER (2pcs.)'),
('tractor_head_06','tractor_head','HEAD LIGHTS (LH & RH)'),
('tractor_head_07','tractor_head','SIGNAL LIGHTS'),
('tractor_head_08','tractor_head','CLEARANCE LIGHT (8pcs.)'),
('tractor_head_09','tractor_head','TAIL LIGHTS (LH & RH)'),
('tractor_head_10','tractor_head','BACK HORN'),
('tractor_head_11','tractor_head','DIESEL TANK'),
('tractor_head_12','tractor_head','TANK COVER'),
('tractor_head_13','tractor_head','BATTERIES'),
('tractor_head_14','tractor_head','TOOL BOX'),
('tractor_head_15','tractor_head','PLATE LIGHT'),
('tractor_head_16','tractor_head','HYDRAULIC HOSE & COUPLING'),
('tractor_head_17','tractor_head','AIR HOSE AND GLAD HAND'),
('tractor_head_18','tractor_head','TIRES'),
('tractor_head_19','tractor_head','SPARE TIRE'),
('tractor_head_20','tractor_head','AIRCON'),
('trailer_01','trailer','CLEARANCE LIGHT (24pcs.)'),
('trailer_02','trailer','TAIL LIGHT LH & RH'),
('trailer_03','trailer','BACK LIGHT'),
('trailer_04','trailer','BACK-UP T-LIGHT'),
('trailer_05','trailer','BACK HORN'),
('trailer_06','trailer','RATCHET TIE DOWN'),
('trailer_07','trailer','IRON/ALLOY LADDER'),
('trailer_08','trailer','LASHING CABLE'),
('trailer_09','trailer','TIRE LH & RH'),
('trailer_10','trailer','LANDING GEARS'),
('trailer_11','trailer','HYDRAULIC CYLINDERS LH & RH');
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_06';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_07';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_08';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_09';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_10';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Engine' WHERE c.component_key='tractor_head_11';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Engine' WHERE c.component_key='tractor_head_12';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_13';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='tractor_head_15';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Hydraulics' WHERE c.component_key='tractor_head_16';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Brakes' WHERE c.component_key='tractor_head_17';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Tires & Wheels' WHERE c.component_key='tractor_head_18';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Tires & Wheels' WHERE c.component_key='tractor_head_19';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Air Conditioning' WHERE c.component_key='tractor_head_20';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='trailer_01';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='trailer_02';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='trailer_03';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='trailer_04';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Electrical' WHERE c.component_key='trailer_05';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Tires & Wheels' WHERE c.component_key='trailer_09';
INSERT IGNORE INTO motorpool_component_skills (component_id,specialization_id) SELECT c.id,s.id FROM motorpool_components c JOIN mechanic_specializations s ON s.name='Hydraulics' WHERE c.component_key='trailer_11';
-- Legacy mechanics.specialization remains unchanged for review; unverified text does not grant a skill.
-- Component mappings are preliminary. Operators must confirm each skill, and exclude inapplicable equipment per vehicle.
