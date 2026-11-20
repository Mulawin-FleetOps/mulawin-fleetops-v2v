-- Diesel PO is separate from cash fund disbursements and from client Billing SOA.
-- Additive only: existing fund_requests.diesel_po_json and trip documents are preserved.
-- Existing historical JSON orders are NOT automatically backfilled or reclassified.
CREATE TABLE IF NOT EXISTS diesel_purchase_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fund_request_id INT NOT NULL,
  trip_id INT NOT NULL,
  po_number VARCHAR(4) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  decision_reason VARCHAR(500) NULL,
  received_by INT NULL,
  received_driver_id INT NULL,
  received_at DATETIME NULL,
  receipt_notes VARCHAR(500) NULL,
  verified_by INT NULL,
  verified_at DATETIME NULL,
  verification_notes VARCHAR(500) NULL,
  UNIQUE KEY uq_diesel_po_fund (fund_request_id),
  UNIQUE KEY uq_diesel_po_number (po_number),
  KEY idx_diesel_po_trip (trip_id),
  KEY idx_diesel_po_status (status),
  CONSTRAINT chk_diesel_po_state CHECK (status IN ('Draft','Awaiting SOA','Rejected','SOA Received','Verified','Discrepancy'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-20_03_diesel_po_soa_workflow');
