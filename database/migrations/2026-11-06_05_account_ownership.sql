-- Security S1: credential ownership / verified password changes.
-- Run ONCE using phpMyAdmin after backup, before testing new PHP/JS.
ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS password_change_challenges (
    user_id INT NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pw_change_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Existing employees remain enrolled; new Admin-created or Admin-reset accounts are forced to change.
