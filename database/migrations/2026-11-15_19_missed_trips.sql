-- Additive status extension: overdue unassigned trips become Missed after dispatch time.
-- No existing trips are rewritten by this migration. Runtime archival records audited transitions.
SET @missed_constraint = (
    SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_trip_status' LIMIT 1
);
SET @missed_sql = IF(@missed_constraint IS NOT NULL AND LOCATE('Missed', @missed_constraint)>0,
    'DO 0',
    IF(@missed_constraint IS NULL,
      'ALTER TABLE trips ADD CONSTRAINT chk_trip_status CHECK (status IN (''Pending Review'',''Awaiting Resources'',''Pre-Assigned'',''Ready for Dispatch'',''Dispatched'',''On Hold - Incident Reported'',''In Transit'',''For Reschedule'',''Completed'',''Cancelled'',''Rejected'',''Missed''))',
      'ALTER TABLE trips DROP CHECK chk_trip_status, ADD CONSTRAINT chk_trip_status CHECK (status IN (''Pending Review'',''Awaiting Resources'',''Pre-Assigned'',''Ready for Dispatch'',''Dispatched'',''On Hold - Incident Reported'',''In Transit'',''For Reschedule'',''Completed'',''Cancelled'',''Rejected'',''Missed''))'
    )
);
PREPARE missed_stmt FROM @missed_sql;
EXECUTE missed_stmt;
DEALLOCATE PREPARE missed_stmt;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-15_19_missed_trips');
