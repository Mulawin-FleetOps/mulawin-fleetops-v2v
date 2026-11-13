-- Additive pricing history. No defaults, backfill, invoice or payment changes.
CREATE TABLE IF NOT EXISTS pricing_settings_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 setting_key VARCHAR(40) NOT NULL,
 effective_date DATE NOT NULL,
 value_json LONGTEXT NOT NULL,
 reference VARCHAR(300) NOT NULL,
 actor_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_pricing_effective(setting_key,effective_date),
 FOREIGN KEY(actor_id) REFERENCES users(id),
 CHECK(JSON_VALID(value_json)),
 CHECK(setting_key IN ('diesel','Wing Van','Container','Car Carrier','garage'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS billing_pricing (
 billing_id INT PRIMARY KEY,
 snapshot_json LONGTEXT NOT NULL,
 captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(billing_id) REFERENCES billings(id),
 CHECK(JSON_VALID(snapshot_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-13_13_fixed_route_fuel');
