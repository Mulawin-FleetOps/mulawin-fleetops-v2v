-- Additive General Budget approval queue. Existing budget allocations and commitments remain untouched
-- until Admin approves a replacement. Never backfill an approval decision.
CREATE TABLE IF NOT EXISTS general_budget_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  amount DECIMAL(14,2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  remarks VARCHAR(500) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending Approval',
  submitted_by INT NOT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decision_notes VARCHAR(500) NULL,
  activated_budget_id INT NULL,
  KEY idx_general_budget_requests_status (status, submitted_at),
  CONSTRAINT fk_gbr_submitter FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT fk_gbr_decider FOREIGN KEY (decided_by) REFERENCES users(id),
  CONSTRAINT fk_gbr_budget FOREIGN KEY (activated_budget_id) REFERENCES budgets(id),
  CONSTRAINT chk_gbr_amount CHECK (amount > 0),
  CONSTRAINT chk_gbr_period CHECK (period_end >= period_start),
  CONSTRAINT chk_gbr_status CHECK (status IN ('Pending Approval','Approved','Rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-21_01_general_budget_approvals');
