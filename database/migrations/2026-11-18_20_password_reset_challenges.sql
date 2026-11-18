-- Password recovery challenges for forgotten passwords (all active user roles).
-- Apply with approved migration process after verified database backup.
-- No password, plaintext verification code, or account email stored here.
CREATE TABLE IF NOT EXISTS password_reset_challenges (
  user_id INT NOT NULL PRIMARY KEY,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  requested_at DATETIME NOT NULL,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
