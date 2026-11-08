-- BILLING_ADJUSTMENT_APPROVAL_V1
-- Billing charges and per-trip rate adjustments need Admin approval before they count in the invoice.
-- Fresh install: already in extension.sql. Existing DB: import this ONCE, BEFORE deploying the new PHP/JS.
-- Existing charges are kept as Approved (grandfathered), so no billing total changes.
-- Rollback limits: see docs/CLAUDE_BILLING_ADJUSTMENT_APPROVAL.md.
INSERT INTO schema_migrations (id) VALUES ('2026-11-09_09_billing_adjustments');
ALTER TABLE billing_charges DROP CONSTRAINT chk_bcharge_amount;
ALTER TABLE billing_charges
  ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'Additional Charge' AFTER billing_id,
  ADD COLUMN request_type VARCHAR(10) NOT NULL DEFAULT 'New' AFTER kind,
  ADD COLUMN replaces_id INT NULL AFTER request_type,
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Pending Approval' AFTER amount,
  ADD COLUMN reason VARCHAR(300) NULL AFTER status,
  ADD COLUMN decided_by INT NULL AFTER created_at,
  ADD COLUMN decided_at DATETIME NULL AFTER decided_by,
  ADD COLUMN decision_notes VARCHAR(300) NULL AFTER decided_at;
UPDATE billing_charges SET status='Approved', decision_notes='Recorded before the approval workflow (kept as approved)';
ALTER TABLE billing_charges
  ADD CONSTRAINT fk_bcharge_replaces FOREIGN KEY (replaces_id) REFERENCES billing_charges(id),
  ADD CONSTRAINT fk_bcharge_decider FOREIGN KEY (decided_by) REFERENCES users(id),
  ADD CONSTRAINT chk_bcharge_amount CHECK (amount <> 0 AND (kind = 'Rate Adjustment' OR amount > 0)),
  ADD CONSTRAINT chk_bcharge_kind CHECK (kind IN ('Additional Charge','Rate Adjustment')),
  ADD CONSTRAINT chk_bcharge_request CHECK (request_type IN ('New','Change','Removal') AND ((request_type = 'New') = (replaces_id IS NULL))),
  ADD CONSTRAINT chk_bcharge_status CHECK (status IN ('Pending Approval','Approved','Rejected','Superseded','Removed','Withdrawn')),
  ADD CONSTRAINT chk_bcharge_decision CHECK (status <> 'Pending Approval' OR (decided_by IS NULL AND decided_at IS NULL));
