-- Security S2: Remember this device (hashed server-side tokens) + verified email ownership.
-- Run ONCE in phpMyAdmin, after Security S1 migration and before S2 code deployment.
CREATE TABLE IF NOT EXISTS trusted_login_devices (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL,
 token_hash CHAR(64) NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_used_at DATETIME NULL,
 UNIQUE KEY uq_trusted_token (token_hash),
 INDEX idx_trusted_user (user_id, expires_at),
 CONSTRAINT fk_trusted_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS email_change_challenges (
 user_id INT NOT NULL PRIMARY KEY,
 new_email VARCHAR(190) NOT NULL,
 code_hash VARCHAR(255) NOT NULL,
 expires_at DATETIME NOT NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_email_change_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
