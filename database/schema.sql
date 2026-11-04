-- =====================================================================
-- Mulawin FleetOps (RP Mulawin Trucking)  |  database/schema.sql
-- PART 1 OF 2: users, settings and the MASTERLISTS
--              (trucks, drivers & helpers, clients and client rates).
--
-- HOW TO USE
--   1. Create a NEW, EMPTY database (example name: mulawin_v2, utf8mb4).
--   2. Import this file first, then database/extension.sql.
--   3. Optional: import database/seed_masterlists.sql (trucks, drivers,
--      helpers and clients taken from the company monitoring workbooks).
--   4. Never import over an existing company database.
--
-- DESIGN RULES
--   * Every module points to the SAME masterlist rows by id (foreign keys).
--     A trip never stores its own copy of a truck, driver or client.
--   * Records are deactivated, never deleted, so old trips stay complete.
--   * Unique keys stop duplicate plate numbers, licenses, client names, ...
--   * CHECK constraints keep status values valid even if a bug slips in.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- USERS AND ACCESS  (Objective 4.1; PDF #11 II.A)
-- Roles: admin, operations_head, car_carrier_dispatcher,
-- container_wingvan_dispatcher, motorpool, purchasing, finance, billing, audit
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(70) NOT NULL UNIQUE,
  email VARCHAR(190) NOT NULL COMMENT 'login OTP codes are sent here',
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(40) NOT NULL,
  shift VARCHAR(10) NULL COMMENT 'Day or Night (dispatchers only)',
  signature_document_id INT NULL COMMENT 'e-signature image used on approved purchase orders',
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  recovery_hash VARCHAR(255) NULL COMMENT 'Admin one-time recovery code (hashed)',
  password_changed_at DATETIME NULL,
  active TINYINT NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  INDEX idx_users_role (role, active),
  CONSTRAINT chk_users_role CHECK (role IN ('admin','operations_head','car_carrier_dispatcher','container_wingvan_dispatcher',
                                            'motorpool','purchasing','finance','billing','audit')),
  CONSTRAINT chk_users_shift CHECK (shift IS NULL OR shift IN ('Day','Night'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Email OTP login (second step after the password). Codes are stored hashed, expire,
-- work once, and a new code cancels the older ones (invalidated_at).
CREATE TABLE login_otps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  invalidated_at DATETIME NULL,
  request_ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_otp_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Activity log (Objective 4.2): who created, updated, approved or processed a record, with date and time.
CREATE TABLE audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL COMMENT 'NULL = done automatically by the system',
  area VARCHAR(60) NOT NULL,
  record_ref VARCHAR(70) NOT NULL,
  action VARCHAR(120) NOT NULL,
  details VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_area (area, record_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bell notifications (pending approvals, trip updates, expiring documents).
CREATE TABLE notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category VARCHAR(60) NOT NULL,
  message VARCHAR(300) NOT NULL,
  page VARCHAR(60) NULL COMMENT 'page opened from the notification',
  dedupe_key VARCHAR(120) NULL COMMENT 'same key = same task; resolving the task resolves it for everyone',
  state VARCHAR(10) NOT NULL DEFAULT 'Unread',
  read_at DATETIME NULL,
  resolved_at DATETIME NULL,
  resolved_by INT NULL COMMENT 'NULL = resolved automatically when the task was done',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id),
  UNIQUE KEY uq_notification_dedupe (user_id, dedupe_key),
  INDEX idx_notifications_user (user_id, state, created_at),
  INDEX idx_notifications_key (dedupe_key),
  CONSTRAINT chk_notification_state CHECK (state IN ('Unread','Read','Resolved','Archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- System settings changed by the Admin (purchase limit, reminder days, VAT, ...).
CREATE TABLE app_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fund request categories with preset amounts (PDF #12 Scenario A step 4 / B step 4).
CREATE TABLE fund_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  amount DECIMAL(12,2) NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT chk_fund_cat_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO fund_categories (name, amount, sort_order) VALUES
  ('Forklift Operator', 100.00, 1),
  ('Checker', 100.00, 2),
  ('Passway', 200.00, 3),
  ('Driver Meal Allowance', 300.00, 4),
  ('Helper Meal Allowance', 200.00, 5);

-- ---------------------------------------------------------------------
-- CLIENT MASTERLIST  (Objective 1.2 and 3.1; PDF #12 Scenario A step 2)
-- Status flow:
--   Incomplete   -> imported or missing accreditation files (cannot be used for trips)
--   Pending Rate -> Ops Head saved the complete profile; waiting for Billing to set the rate
--   Active       -> Billing set the billing rate; can be selected for trips
--   Inactive     -> no longer used (old trips keep the link)
-- ---------------------------------------------------------------------
CREATE TABLE clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_code VARCHAR(20) NULL UNIQUE,
  company_name VARCHAR(150) NOT NULL UNIQUE COMMENT 'registered name (billed party)',
  trade_name VARCHAR(150) NULL,
  nature_of_business VARCHAR(150) NULL,
  tin VARCHAR(30) NULL UNIQUE,
  business_address VARCHAR(255) NULL,
  contact_person VARCHAR(120) NULL,
  contact_position VARCHAR(80) NULL,
  contact_number VARCHAR(60) NULL,
  email VARCHAR(120) NULL,
  payment_terms_days INT NULL COMMENT 'blank = default from Settings',
  status VARCHAR(20) NOT NULL DEFAULT 'Incomplete',
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  rate_set_by INT NULL,
  rate_set_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (rate_set_by) REFERENCES users(id),
  INDEX idx_clients_status (status),
  CONSTRAINT chk_clients_status CHECK (status IN ('Incomplete','Pending Rate','Active','Inactive')),
  CONSTRAINT chk_clients_terms CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Billing rate per client and truck type, based on billable distance
-- (Objective 3.1: "billing rates based on confirmed billable distance").
-- Billing amount = distance (km, pickup point to delivery point) x rate_per_km + additional charges.
CREATE TABLE client_rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  truck_type VARCHAR(25) NOT NULL,
  rate_per_km DECIMAL(12,2) NOT NULL,
  minimum_charge DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'billing never goes below this amount (0 = none)',
  updated_by INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_client_rate (client_id, truck_type),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT chk_rate_type CHECK (truck_type IN ('Car Carrier','Container','Wing Van')),
  CONSTRAINT chk_rate_amount CHECK (rate_per_km > 0 AND minimum_charge >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DRIVER AND HELPER MASTERLIST  (PDF #11 II.C; Objective 1.1 assigned drivers and helpers)
-- availability:
--   Available   -> free
--   On Trip     -> set by the system while assigned to an active trip
--   Unavailable -> set by Ops Head / Admin (leave, sick, suspended, ...)
-- ---------------------------------------------------------------------
CREATE TABLE personnel (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_no VARCHAR(40) NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL COMMENT 'LAST, FIRST (same as the monitoring sheets)',
  person_type VARCHAR(10) NOT NULL,
  contact_number VARCHAR(60) NULL,
  address VARCHAR(255) NULL,
  license_number VARCHAR(60) NULL UNIQUE,
  license_expiry DATE NULL,
  date_hired DATE NULL,
  availability VARCHAR(20) NOT NULL DEFAULT 'Available',
  unavailable_reason VARCHAR(150) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_personnel_name (full_name, person_type),
  INDEX idx_personnel_type (person_type, active, availability),
  CONSTRAINT chk_personnel_type CHECK (person_type IN ('Driver','Helper')),
  CONSTRAINT chk_personnel_avail CHECK (availability IN ('Available','On Trip','Unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- TRUCK MASTERLIST  (Objective 1.1; PDF #11 II.B; OFFICIAL RECEIPT REGISTRATION sheet)
-- status:
--   Available         -> can be assigned
--   Assigned          -> reserved for a trip that has not left yet (system)
--   On Trip           -> dispatched (system)
--   Under Maintenance -> open corrective maintenance record, until the repair is verified (system)
--   Unavailable       -> set by Ops Head / Admin / Motorpool (e.g. expired registration)
-- ---------------------------------------------------------------------
CREATE TABLE vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  truck_number VARCHAR(20) NULL UNIQUE COMMENT 'unit number used in the monitoring sheets (e.g. 6, W2)',
  plate_number VARCHAR(20) NOT NULL UNIQUE,
  truck_type VARCHAR(25) NOT NULL,
  make_brand VARCHAR(80) NULL,
  model VARCHAR(80) NULL,
  chassis_number VARCHAR(80) NULL,
  engine_number VARCHAR(80) NULL,
  mv_file_number VARCHAR(80) NULL,
  or_number VARCHAR(80) NULL,
  cr_number VARCHAR(80) NULL,
  registration_expiry DATE NULL,
  insurance_provider VARCHAR(120) NULL,
  insurance_policy_number VARCHAR(80) NULL,
  insurance_expiry DATE NULL,
  assigned_driver_id INT NULL COMMENT 'regular driver (preferred by auto-assignment)',
  assigned_helper_id INT NULL COMMENT 'regular helper',
  status VARCHAR(25) NOT NULL DEFAULT 'Available',
  status_reason VARCHAR(150) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_driver_id) REFERENCES personnel(id),
  FOREIGN KEY (assigned_helper_id) REFERENCES personnel(id),
  INDEX idx_vehicle_status (truck_type, status, active),
  CONSTRAINT chk_vehicle_type CHECK (truck_type IN ('Car Carrier','Container','Wing Van')),
  CONSTRAINT chk_vehicle_status CHECK (status IN ('Available','Assigned','On Trip','Under Maintenance','Unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every truck status change (used for downtime analytics, Objective 5.3).
CREATE TABLE vehicle_status_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  from_status VARCHAR(25) NULL,
  to_status VARCHAR(25) NOT NULL,
  reason VARCHAR(255) NULL,
  actor_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_vsl (vehicle_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DOCUMENTS  (PDF #11 II.M / II.O). Files are kept in storage/private
-- with random names and are only given out after a permission check.
-- entity_type + entity_id link a file to a trip, truck, client, ...
-- ---------------------------------------------------------------------
CREATE TABLE documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT NULL,
  original_filename VARCHAR(220) NOT NULL,
  storage_name VARCHAR(100) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL,
  byte_size INT NOT NULL,
  expires_on DATE NULL,
  notes VARCHAR(255) NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_doc_expiry (expires_on),
  INDEX idx_doc_entity (entity_type, entity_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE users ADD CONSTRAINT fk_users_signature FOREIGN KEY (signature_document_id) REFERENCES documents(id);
