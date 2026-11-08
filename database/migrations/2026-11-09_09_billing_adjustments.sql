-- BILLING_ADJUSTMENT_APPROVAL_V1
-- Billing charges and per-trip rate adjustments need Admin approval before they count in the invoice.
-- Fresh install: already in extension.sql. Existing DB: back up, then import this ONCE, BEFORE deploying the new PHP/JS.
--
-- SAFE ORDER (MariaDB / MySQL DDL is not transactional; each statement commits on its own):
--   STEP 1  ONE ALTER TABLE with every column and constraint change. A single ALTER is all-or-nothing:
--           if it fails, the table is exactly as before. Existing charges get status 'Approved' from the
--           column default IN THE SAME STATEMENT, so old charges are never "pending" and no total changes.
--           Importing this file again stops HERE ("Duplicate column name 'kind'") without changing anything.
--   STEP 2  Note on the old (grandfathered) charges. Safe to repeat.
--   STEP 3  New rows default to 'Pending Approval' (never approved by accident). Safe to repeat.
--   STEP 4  The migration is recorded LAST, only after steps 1-3 succeeded.
-- Check the state at any time: database/migrations/checks/2026-11-09_09_billing_adjustments_check.sql
-- Recovery (stopped after step 1): see docs/CLAUDE_BILLING_ADJUSTMENT_APPROVAL.md. Do not re-run step 1.

-- STEP 1
ALTER TABLE billing_charges
  ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'Additional Charge' AFTER billing_id,
  ADD COLUMN request_type VARCHAR(10) NOT NULL DEFAULT 'New' AFTER kind,
  ADD COLUMN replaces_id INT NULL AFTER request_type,
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Approved' AFTER amount,
  ADD COLUMN reason VARCHAR(300) NULL AFTER status,
  ADD COLUMN decided_by INT NULL AFTER created_at,
  ADD COLUMN decided_at DATETIME NULL AFTER decided_by,
  ADD COLUMN decision_notes VARCHAR(300) NULL AFTER decided_at,
  DROP CONSTRAINT chk_bcharge_amount,
  ADD CONSTRAINT fk_bcharge_replaces FOREIGN KEY (replaces_id) REFERENCES billing_charges(id),
  ADD CONSTRAINT fk_bcharge_decider FOREIGN KEY (decided_by) REFERENCES users(id),
  ADD CONSTRAINT chk_bcharge_amount CHECK (amount <> 0 AND (kind = 'Rate Adjustment' OR amount > 0)),
  ADD CONSTRAINT chk_bcharge_kind CHECK (kind IN ('Additional Charge','Rate Adjustment')),
  ADD CONSTRAINT chk_bcharge_request CHECK (request_type IN ('New','Change','Removal') AND ((request_type = 'New') = (replaces_id IS NULL))),
  ADD CONSTRAINT chk_bcharge_status CHECK (status IN ('Pending Approval','Approved','Rejected','Superseded','Removed','Withdrawn')),
  ADD CONSTRAINT chk_bcharge_decision CHECK (status <> 'Pending Approval' OR (decided_by IS NULL AND decided_at IS NULL));

-- STEP 2
UPDATE billing_charges SET decision_notes='Recorded before the approval workflow (kept as approved)'
 WHERE status='Approved' AND decided_by IS NULL AND decision_notes IS NULL;

-- STEP 3
ALTER TABLE billing_charges ALTER COLUMN status SET DEFAULT 'Pending Approval';

-- STEP 4 (last)
INSERT INTO schema_migrations (id) VALUES ('2026-11-09_09_billing_adjustments');
