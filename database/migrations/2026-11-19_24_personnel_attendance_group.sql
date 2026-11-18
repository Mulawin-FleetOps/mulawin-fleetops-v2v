-- Attendance scope is independent from fixed truck/crew authorization.
-- NULL retains legacy group resolution through verified vehicle relationships.
ALTER TABLE personnel
    ADD COLUMN attendance_group VARCHAR(40) NULL DEFAULT NULL AFTER person_type;
