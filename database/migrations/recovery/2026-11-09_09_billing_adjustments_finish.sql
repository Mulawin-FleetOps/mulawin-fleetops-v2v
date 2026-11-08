-- RECOVERY for migration 2026-11-09_09_billing_adjustments: use ONLY when the check file says PARTIAL
-- (step 1, the ALTER TABLE, succeeded but the migration was not recorded).
-- It runs steps 2-4 of the migration. It never repeats step 1.
-- If step 1 did NOT run, the first statement fails ("Unknown column") and nothing is changed or recorded.
-- If the migration is already COMPLETE, the last statement fails ("Duplicate entry") and nothing changes.

-- STEP 2
UPDATE billing_charges SET decision_notes='Recorded before the approval workflow (kept as approved)'
 WHERE status='Approved' AND decided_by IS NULL AND decision_notes IS NULL;

-- STEP 3
ALTER TABLE billing_charges ALTER COLUMN status SET DEFAULT 'Pending Approval';

-- STEP 4 (last)
INSERT INTO schema_migrations (id) VALUES ('2026-11-09_09_billing_adjustments');
