-- READ-ONLY check of migration 2026-11-09_09_billing_adjustments. Changes nothing; safe to run any time.
-- Run it in phpMyAdmin (SQL tab) on the FleetOps database and read the "state" column:
--   COMPLETE      everything applied and recorded. Nothing to do.
--   NOT APPLIED   nothing applied. Import database/migrations/2026-11-09_09_billing_adjustments.sql.
--   PARTIAL       step 1 (the ALTER TABLE) succeeded but the migration is not recorded.
--                 Import database/migrations/recovery/2026-11-09_09_billing_adjustments_finish.sql.
--                 Do NOT import the migration file again.
--   UNEXPECTED    stop. Do not run any migration statement. Restore the backup or ask for help.
SELECT new_columns, new_checks, new_fks, status_default, recorded,
  CASE
    WHEN recorded = 1 AND new_columns = 8 AND new_checks = 4 AND new_fks = 2 AND status_default LIKE '%Pending Approval%' THEN 'COMPLETE'
    WHEN recorded = 0 AND new_columns = 0 AND new_checks = 0 AND new_fks = 0 THEN 'NOT APPLIED'
    WHEN recorded = 0 AND new_columns = 8 AND new_checks = 4 AND new_fks = 2 THEN 'PARTIAL'
    ELSE 'UNEXPECTED'
  END AS state
FROM (SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'billing_charges'
     AND column_name IN ('kind','request_type','replaces_id','status','reason','decided_by','decided_at','decision_notes')) AS new_columns,
  (SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()
     AND constraint_name IN ('chk_bcharge_kind','chk_bcharge_request','chk_bcharge_status','chk_bcharge_decision')) AS new_checks,
  (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'billing_charges'
     AND constraint_name IN ('fk_bcharge_replaces','fk_bcharge_decider')) AS new_fks,
  (SELECT column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'billing_charges'
     AND column_name = 'status') AS status_default,
  (SELECT COUNT(*) FROM schema_migrations WHERE id = '2026-11-09_09_billing_adjustments') AS recorded
) s;
