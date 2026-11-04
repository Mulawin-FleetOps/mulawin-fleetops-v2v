-- =====================================================================
-- Mulawin FleetOps (RP Mulawin Trucking)  |  database/extension.sql
-- PART 2 OF 2: trips, funds, incidents, maintenance, purchasing,
--              inventory, finance and billing. Import AFTER schema.sql.
-- Empty database only.
-- =====================================================================
SET NAMES utf8mb4;

-- =====================================================================
-- OPERATIONS: TRIPS  (Objective 1.3 - 1.6; PDF #12 Scenario A, B, C)
-- =====================================================================
-- Trip status flow:
--   Pending Review               dispatcher request waiting for the Operations Head (Scenario B)
--   Awaiting Resources           confirmed, but no free truck / driver / helper yet
--   Pre-Assigned                 system assigned the truck, driver and helper
--   Ready for Dispatch           pre-dispatch checklist complete (all OK)
--   Dispatched                   truck left (needs fund Released + Ready for Dispatch)
--   On Hold - Incident Reported  breakdown reported, Maintenance assessing
--   In Transit                   trip resumed after a minor on-site repair
--   For Reschedule               major damage, truck returned for repair
--   Completed                    delivery done, completion details and documents saved
--   Cancelled / Rejected
-- attempt_number: 1 = first dispatch, 2 = Second Attempt after major damage.
CREATE TABLE trips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_ref VARCHAR(32) NOT NULL UNIQUE,
  intake_source VARCHAR(20) NOT NULL COMMENT 'Operations Head (Scenario A) or Dispatcher (Scenario B)',
  created_by INT NOT NULL,
  client_id INT NOT NULL,
  consignee VARCHAR(120) NULL COMMENT 'brand / consignee (CLIENT column of the monitoring sheets)',
  truck_type VARCHAR(25) NULL,
  dispatcher_role VARCHAR(40) NULL,
  dispatcher_id INT NULL,
  pickup_point VARCHAR(200) NOT NULL,
  pickup_lat DECIMAL(10,7) NULL,
  pickup_lng DECIMAL(10,7) NULL,
  delivery_point VARCHAR(200) NOT NULL,
  delivery_lat DECIMAL(10,7) NULL,
  delivery_lng DECIMAL(10,7) NULL,
  distance_km DECIMAL(10,2) NULL COMMENT 'billable km from pickup point to delivery point (typed by Ops Head)',
  scheduled_at DATETIME NOT NULL,
  delivery_details VARCHAR(500) NULL,
  booking_reference VARCHAR(150) NULL COMMENT 'booking / nomination details, when applicable',
  units_planned INT NULL COMMENT 'car carrier units',
  container_number VARCHAR(60) NULL,
  container_size VARCHAR(20) NULL,
  seal_number VARCHAR(60) NULL,
  shipment_number VARCHAR(60) NULL,
  vehicle_id INT NULL,
  driver_id INT NULL,
  driver2_id INT NULL COMMENT 'car carrier DRIVER 2',
  helper_id INT NULL,
  assignment_mode VARCHAR(10) NULL COMMENT 'Auto or Manual',
  status VARCHAR(35) NOT NULL DEFAULT 'Pending Review',
  attempt_number INT NOT NULL DEFAULT 1,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  dispatched_at DATETIME NULL,
  completed_at DATETIME NULL COMMENT 'actual completion date and time',
  units_delivered INT NULL,
  delivery_notes VARCHAR(500) NULL,
  waybill_number VARCHAR(100) NULL,
  cancel_reason VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (dispatcher_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (driver_id) REFERENCES personnel(id),
  FOREIGN KEY (driver2_id) REFERENCES personnel(id),
  FOREIGN KEY (helper_id) REFERENCES personnel(id),
  INDEX idx_trip_schedule (scheduled_at),
  INDEX idx_trip_status (status),
  INDEX idx_trip_vehicle (vehicle_id, status),
  CONSTRAINT chk_trip_status CHECK (status IN ('Pending Review','Awaiting Resources','Pre-Assigned','Ready for Dispatch','Dispatched',
                                               'On Hold - Incident Reported','In Transit','For Reschedule','Completed','Cancelled','Rejected')),
  CONSTRAINT chk_trip_type CHECK (truck_type IS NULL OR truck_type IN ('Car Carrier','Container','Wing Van')),
  CONSTRAINT chk_trip_distance CHECK (distance_km IS NULL OR distance_km >= 0),
  CONSTRAINT chk_trip_attempt CHECK (attempt_number >= 1),
  CONSTRAINT chk_trip_crew CHECK ((driver2_id IS NULL OR driver2_id <> driver_id) AND (helper_id IS NULL OR helper_id <> driver_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- DOUBLE-BOOKING SAFEGUARD (database level).
-- One row per truck or person that is held by an active trip.
-- PRIMARY KEY (resource_type, resource_id) means the database itself refuses
-- to put the same truck or the same driver/helper on two active trips.
-- Rows are added on assignment and removed when the trip is completed,
-- cancelled or re-assigned.
CREATE TABLE trip_assignments (
  resource_type VARCHAR(10) NOT NULL COMMENT 'vehicle or person',
  resource_id INT NOT NULL,
  trip_id INT NOT NULL,
  role VARCHAR(10) NOT NULL COMMENT 'truck, driver, driver2, helper',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_type, resource_id),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  INDEX idx_ta_trip (trip_id),
  CONSTRAINT chk_ta_type CHECK (resource_type IN ('vehicle','person'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- History of every approval, assignment, dispatch and completion (PDF #11 II.D).
CREATE TABLE trip_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  actor_id INT NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(35) NOT NULL DEFAULT '',
  to_status VARCHAR(35) NOT NULL DEFAULT '',
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_trip_events (trip_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Trip progress and delay updates recorded by the dispatcher (Objective 1.5).
CREATE TABLE trip_updates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  actor_id INT NOT NULL,
  update_type VARCHAR(20) NOT NULL,
  delay_cause VARCHAR(30) NULL,
  note VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_trip_updates (trip_id),
  CONSTRAINT chk_update_type CHECK (update_type IN ('Progress','Loading','Unloading','Delivery','Delay','Other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pre-dispatch checklist (57 items from the company checklist scans). One per trip attempt.
CREATE TABLE inspections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  attempt_number INT NOT NULL,
  items_json MEDIUMTEXT NOT NULL,
  has_not_ok TINYINT NOT NULL DEFAULT 0,
  odometer_km INT NULL,
  fuel_level VARCHAR(20) NULL,
  remarks VARCHAR(500) NULL,
  actor_id INT NOT NULL,
  completed_at DATETIME NOT NULL,
  UNIQUE KEY uq_inspection (trip_id, attempt_number),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Incident reports (Objective 1.6; PDF #12 Scenario C; Incident Report Form in PDF #13).
-- Status: Reported -> Under Repair -> Repaired - Cleared to Continue (minor) -> Resolved
--                                  -> Resolved (major, after the truck is repaired)
CREATE TABLE incidents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_ref VARCHAR(32) NOT NULL UNIQUE,
  trip_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  incident_type VARCHAR(40) NOT NULL,
  incident_at DATETIME NOT NULL,
  location VARCHAR(200) NOT NULL,
  persons_involved VARCHAR(255) NULL,
  reason VARCHAR(255) NULL,
  problem VARCHAR(255) NOT NULL COMMENT 'reported problem or damage',
  details TEXT NOT NULL,
  severity VARCHAR(10) NULL COMMENT 'Minor or Major (Maintenance assessment)',
  recommendation VARCHAR(500) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Reported',
  reported_by INT NOT NULL,
  assessed_by INT NULL,
  assessed_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (assessed_by) REFERENCES users(id),
  INDEX idx_incident_status (status),
  CONSTRAINT chk_incident_status CHECK (status IN ('Reported','Under Repair','Repaired - Cleared to Continue','Resolved')),
  CONSTRAINT chk_incident_severity CHECK (severity IS NULL OR severity IN ('Minor','Major'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- TRIP FUND REQUESTS  (Objective 1.4 and 3.5; PDF #12 steps 4-6; Request for Cash Fund form)
-- Pending Approval -> Ready for Release (Ops Head approved) -> Released (Finance)
--                  -> Rejected (back to the dispatcher, who revises and resubmits)
-- Cancelled when the trip is cancelled before release.
-- =====================================================================
CREATE TABLE fund_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fund_ref VARCHAR(32) NOT NULL UNIQUE,
  trip_id INT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  amount DECIMAL(12,2) NOT NULL,
  notes VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending Approval',
  requested_by INT NOT NULL,
  approved_by INT NULL, approved_at DATETIME NULL,
  rejected_reason VARCHAR(300) NULL,
  released_by INT NULL, released_at DATETIME NULL,
  disbursement_id INT NULL,
  liquidation_status VARCHAR(20) NOT NULL DEFAULT 'Not Liquidated',
  liquidated_amount DECIMAL(12,2) NULL COMMENT 'actual amount spent',
  returned_amount DECIMAL(12,2) NULL COMMENT 'unused cash returned',
  liquidation_notes VARCHAR(300) NULL,
  liquidated_by INT NULL, liquidated_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fund_trip_attempt (trip_id, attempt_number),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (released_by) REFERENCES users(id),
  FOREIGN KEY (liquidated_by) REFERENCES users(id),
  INDEX idx_fund_status (status),
  CONSTRAINT chk_fund_status CHECK (status IN ('Pending Approval','Ready for Release','Released','Rejected','Cancelled')),
  CONSTRAINT chk_fund_amount CHECK (amount > 0),
  CONSTRAINT chk_fund_liq CHECK (liquidation_status IN ('Not Liquidated','Liquidated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fund_request_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fund_request_id INT NOT NULL,
  category_name VARCHAR(80) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  is_preset TINYINT NOT NULL DEFAULT 1,
  FOREIGN KEY (fund_request_id) REFERENCES fund_requests(id) ON DELETE CASCADE,
  CONSTRAINT chk_fund_line_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- PURCHASING AND INVENTORY  (Objective 2.4 - 2.6; PDF #12 Maintenance Module A and B)
-- =====================================================================
CREATE TABLE suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  contact_person VARCHAR(120) NULL,
  contact_number VARCHAR(60) NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_number VARCHAR(70) NOT NULL UNIQUE,
  description VARCHAR(200) NOT NULL,
  category VARCHAR(80) NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'pc',
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'latest purchase cost',
  reorder_level INT NOT NULL DEFAULT 0,
  quantity_on_hand INT NOT NULL DEFAULT 0,
  warranty_info VARCHAR(150) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_parts_qty CHECK (quantity_on_hand >= 0),
  CONSTRAINT chk_parts_cost CHECK (unit_cost >= 0 AND reorder_level >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- MECHANIC MASTERLIST  (supports Corrective Maintenance only)
-- availability: Available | Assigned (has an active repair, set by the system) | Unavailable (manual, with reason)
-- =====================================================================
CREATE TABLE mechanics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mechanic_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'MEC-001, given by the system',
  full_name VARCHAR(100) NOT NULL,
  contact_number VARCHAR(40) NULL,
  specialization VARCHAR(150) NULL COMMENT 'e.g. engine, electrical, brakes, welding',
  availability VARCHAR(15) NOT NULL DEFAULT 'Available',
  unavailable_reason VARCHAR(150) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mechanic_name (full_name),
  CONSTRAINT chk_mechanic_availability CHECK (availability IN ('Available','Assigned','Unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- CORRECTIVE MAINTENANCE  (Objective 2.1 - 2.3; PDF #12 Vehicle Maintenance Management)
-- source: Incident (from a trip incident report) or On-Premise (problem found at the garage)
-- status: Reported -> Under Inspection (mechanic assigned) -> Under Repair (diagnosis recorded)
--         -> Completed (repair done) ; or Cancelled
-- The truck stays out of service until the repair is VERIFIED (verified_at), not just Completed.
-- open_key: only ONE unresolved record per truck (database rule).
-- active_mechanic: a mechanic can have only ONE active repair at a time (database rule).
-- =====================================================================
CREATE TABLE maintenance_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_ref VARCHAR(32) NOT NULL UNIQUE,
  vehicle_id INT NOT NULL,
  source VARCHAR(15) NOT NULL,
  incident_id INT NULL UNIQUE,
  trip_id INT NULL,
  problem VARCHAR(500) NOT NULL COMMENT 'reported problem or damage',
  reported_on DATE NOT NULL COMMENT 'date reported',
  priority VARCHAR(10) NOT NULL DEFAULT 'Normal',
  severity VARCHAR(10) NULL COMMENT 'Minor or Major (incidents)',
  mechanic_id INT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Reported',
  findings TEXT NULL COMMENT 'inspection findings',
  diagnosis TEXT NULL,
  expected_completion DATE NULL COMMENT 'expected vehicle availability',
  repair_performed TEXT NULL COMMENT 'corrective action performed',
  completed_on DATE NULL,
  remarks VARCHAR(500) NULL,
  verified_at DATETIME NULL COMMENT 'operational check passed: truck returned to service',
  verified_by INT NULL,
  verification_notes VARCHAR(500) NULL,
  started_by INT NULL, started_at DATETIME NULL,
  completed_by INT NULL, completed_at DATETIME NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  open_key TINYINT AS (CASE WHEN status = 'Cancelled' OR verified_at IS NOT NULL THEN NULL ELSE 1 END) STORED,
  active_mechanic INT AS (CASE WHEN status IN ('Reported','Under Inspection','Under Repair') THEN mechanic_id ELSE NULL END) STORED,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id),
  FOREIGN KEY (started_by) REFERENCES users(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id),
  UNIQUE KEY uq_mjob_one_open_per_truck (vehicle_id, open_key),
  UNIQUE KEY uq_mjob_one_job_per_mechanic (active_mechanic),
  INDEX idx_mjob_status (status, vehicle_id),
  CONSTRAINT chk_mjob_source CHECK (source IN ('Incident','On-Premise')),
  CONSTRAINT chk_mjob_status CHECK (status IN ('Reported','Under Inspection','Under Repair','Completed','Cancelled')),
  CONSTRAINT chk_mjob_priority CHECK (priority IN ('Low','Normal','High','Critical'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Status history of each maintenance record (who moved it, mechanic changes, verification).
CREATE TABLE maintenance_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  maintenance_job_id INT NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  mechanic_id INT NULL,
  details VARCHAR(500) NULL,
  actor_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id),
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_mevent_job (maintenance_job_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE maintenance_costs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  maintenance_job_id INT NOT NULL,
  cost_type VARCHAR(30) NOT NULL COMMENT 'Labor, Outside Service, Materials, Other',
  description VARCHAR(255) NOT NULL,
  provider VARCHAR(150) NULL,
  amount DECIMAL(12,2) NOT NULL,
  incurred_on DATE NOT NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT chk_mcost_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Truck-parts request (stock-out): Motorpool Custodian -> Purchasing Officer (REQUEST FORM, PDF #13).
CREATE TABLE part_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_ref VARCHAR(32) NOT NULL UNIQUE,
  vehicle_id INT NOT NULL,
  maintenance_job_id INT NULL,
  purpose VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Requested',
  requested_by INT NOT NULL,
  processed_by INT NULL,
  processed_at DATETIME NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (processed_by) REFERENCES users(id),
  CONSTRAINT chk_preq_status CHECK (status IN ('Requested','Partially Released','Released','Not Available','Cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE part_request_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_request_id INT NOT NULL,
  part_id INT NOT NULL,
  quantity INT NOT NULL,
  released_qty INT NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NULL COMMENT 'cost at the time of release',
  UNIQUE KEY uq_preq_line (part_request_id, part_id),
  FOREIGN KEY (part_request_id) REFERENCES part_requests(id),
  FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT chk_preq_qty CHECK (quantity > 0 AND released_qty >= 0 AND released_qty <= quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Purchasing budget set by Finance (Objective 3.6).
-- available = amount - reserved_amount - spent_amount
CREATE TABLE budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(30) NOT NULL DEFAULT 'Purchasing',
  amount DECIMAL(14,2) NOT NULL,
  reserved_amount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'approved POs not yet paid',
  spent_amount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'actual payments',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'Active',
  set_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (set_by) REFERENCES users(id),
  CONSTRAINT chk_budget_amounts CHECK (amount > 0 AND reserved_amount >= 0 AND spent_amount >= 0),
  CONSTRAINT chk_budget_status CHECK (status IN ('Active','Closed')),
  CONSTRAINT chk_budget_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Purchase Order Request (stock-in), PDF #12 Maintenance Module B.
-- status: Pending Approval -> Approved | Rejected | Rejected - Insufficient Budget
--         Approved -> Partially Received -> Received   (Closed = undelivered balance cancelled)
-- payment_status (after approval): Pending Payment -> Partially Paid -> Paid
CREATE TABLE purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_ref VARCHAR(32) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  part_request_id INT NULL COMMENT 'parts request that started this purchase, if any',
  purpose VARCHAR(255) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  approver_role VARCHAR(20) NOT NULL COMMENT 'finance (limit and below) or admin (above limit)',
  status VARCHAR(40) NOT NULL DEFAULT 'Pending Approval',
  payment_status VARCHAR(20) NULL,
  budget_id INT NULL,
  reserved_amount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'part of the budget still reserved for this PO',
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  supplier_invoice_no VARCHAR(80) NULL,
  requested_by INT NOT NULL,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decision_notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (part_request_id) REFERENCES part_requests(id),
  FOREIGN KEY (budget_id) REFERENCES budgets(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_po_status (status, payment_status),
  CONSTRAINT chk_po_status CHECK (status IN ('Pending Approval','Approved','Rejected','Rejected - Insufficient Budget','Partially Received','Received','Closed')),
  CONSTRAINT chk_po_pay CHECK (payment_status IS NULL OR payment_status IN ('Pending Payment','Partially Paid','Paid')),
  CONSTRAINT chk_po_amounts CHECK (total_amount > 0 AND reserved_amount >= 0 AND paid_amount >= 0 AND paid_amount <= total_amount),
  CONSTRAINT chk_po_approver CHECK (approver_role IN ('finance','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchase_order_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT NOT NULL,
  part_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(14,2) NOT NULL,
  received_qty INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_po_line (purchase_order_id, part_id),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT chk_po_line CHECK (quantity > 0 AND unit_price > 0 AND received_qty >= 0 AND received_qty <= quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every stock change (stock-in, stock-out, adjustment) for inventory history (Objective 2.6, 5.5).
CREATE TABLE stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_id INT NOT NULL,
  movement_type VARCHAR(12) NOT NULL,
  quantity_delta INT NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason VARCHAR(150) NOT NULL,
  reference_type VARCHAR(20) NULL COMMENT 'purchase_order, part_request, adjustment',
  reference_id INT NULL,
  vehicle_id INT NULL,
  maintenance_job_id INT NULL,
  actor_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (maintenance_job_id) REFERENCES maintenance_jobs(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_stock_part (part_id, created_at),
  CONSTRAINT chk_stock_type CHECK (movement_type IN ('Stock In','Stock Out','Adjustment')),
  CONSTRAINT chk_stock_delta CHECK (quantity_delta <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- FINANCE  (Objective 3.5 and 3.6)
-- =====================================================================
-- Every cash release: trip fund release, PO payment, other bill payment.
-- voucher_number is the payment voucher reference.
CREATE TABLE disbursements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  voucher_number VARCHAR(40) NOT NULL UNIQUE,
  source_type VARCHAR(20) NOT NULL,
  source_id INT NOT NULL,
  payee VARCHAR(180) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  cheque_number VARCHAR(60) NULL,
  bank_name VARCHAR(100) NULL,
  reference_number VARCHAR(100) NULL,
  amount DECIMAL(12,2) NOT NULL,
  released_on DATE NOT NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_disb_date (released_on),
  INDEX idx_disb_source (source_type, source_id),
  CONSTRAINT chk_disb_source CHECK (source_type IN ('fund_request','purchase_order','payable')),
  CONSTRAINT chk_disb_method CHECK (payment_method IN ('Cash','Cheque','Bank Transfer','E-wallet')),
  CONSTRAINT chk_disb_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE fund_requests ADD CONSTRAINT fk_fund_disb FOREIGN KEY (disbursement_id) REFERENCES disbursements(id);

-- Other bills to pay (accounts payable that do not come from a purchase order).
CREATE TABLE payables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payable_ref VARCHAR(32) NOT NULL UNIQUE,
  supplier_id INT NULL,
  payee VARCHAR(150) NOT NULL,
  category VARCHAR(40) NOT NULL,
  vehicle_id INT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_on DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Unpaid',
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT chk_pay_status CHECK (status IN ('Unpaid','Partially Paid','Paid')),
  CONSTRAINT chk_pay_amounts CHECK (amount > 0 AND paid_amount >= 0 AND paid_amount <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Expenses. source tells where the row came from, so nothing is counted twice:
--   Fund Release (trip allowance), PO Payment (parts), Payable (bill paid),
--   Maintenance (repair cost), Manual (Finance typed it).
CREATE TABLE expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(40) NOT NULL,
  trip_id INT NULL,
  vehicle_id INT NULL,
  amount DECIMAL(12,2) NOT NULL,
  incurred_on DATE NOT NULL,
  payee VARCHAR(150) NULL,
  reference_number VARCHAR(100) NULL,
  description VARCHAR(500) NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'Manual',
  source_id INT NULL,
  recorded_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_expense_date (incurred_on),
  INDEX idx_expense_source (source, source_id),
  CONSTRAINT chk_exp_source CHECK (source IN ('Fund Release','PO Payment','Payable','Maintenance','Manual','Liquidation')),
  CONSTRAINT chk_exp_amount CHECK (amount <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- BILLING AND COLLECTION  (Objective 3.2 - 3.4; PDF #12 steps 10-12, Accounting Module)
-- One billing record per trip.
-- status:
--   Ongoing     -> billing draft made by the system at Confirm Dispatch (view only)
--   For Billing -> trip completed; Billing verifies documents and adds charges
--   Invoiced    -> invoice finalized, waiting for payment
--   Partially Paid / Paid
--   Cancelled   -> trip was cancelled after dispatch
-- =====================================================================
CREATE TABLE billings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL UNIQUE,
  client_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Ongoing',
  distance_km DECIMAL(10,2) NOT NULL,
  rate_per_km DECIMAL(12,2) NOT NULL,
  minimum_charge DECIMAL(12,2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(14,2) NOT NULL COMMENT 'MAX(distance x rate, minimum charge)',
  charges_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14,2) NOT NULL,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  docs_verified_by INT NULL,
  docs_verified_at DATETIME NULL,
  invoice_number VARCHAR(40) NULL UNIQUE,
  invoice_date DATE NULL,
  due_date DATE NULL,
  finalized_by INT NULL,
  finalized_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (docs_verified_by) REFERENCES users(id),
  FOREIGN KEY (finalized_by) REFERENCES users(id),
  INDEX idx_billing_status (status, client_id),
  INDEX idx_billing_invoice_date (invoice_date),
  CONSTRAINT chk_billing_status CHECK (status IN ('Ongoing','For Billing','Invoiced','Partially Paid','Paid','Cancelled')),
  CONSTRAINT chk_billing_amounts CHECK (total_amount >= 0 AND amount_paid >= 0 AND amount_paid <= total_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Additional charges added by Billing before the invoice is finalized.
CREATE TABLE billing_charges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  description VARCHAR(150) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  added_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (billing_id) REFERENCES billings(id),
  FOREIGN KEY (added_by) REFERENCES users(id),
  CONSTRAINT chk_bcharge_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client payments (needs the acknowledgement receipt file before it is accepted).
CREATE TABLE collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  reference VARCHAR(100) NOT NULL,
  ar_number VARCHAR(40) NOT NULL COMMENT 'acknowledgement receipt number',
  cheque_number VARCHAR(60) NULL,
  bank_name VARCHAR(100) NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (billing_id) REFERENCES billings(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_collection_date (payment_date),
  CONSTRAINT chk_coll_method CHECK (payment_method IN ('Cash','Cheque','Bank Transfer','E-wallet')),
  CONSTRAINT chk_coll_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
