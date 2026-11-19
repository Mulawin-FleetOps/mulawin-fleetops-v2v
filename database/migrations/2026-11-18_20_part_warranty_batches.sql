-- Warranty terms are part defaults; actual coverage is recorded by PO receipt batch.
-- No historical warranty dates are inferred or backfilled. Review operational backup before applying.
SET @warranty_col_exists = (
 SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='parts' AND COLUMN_NAME='warranty_months'
);
SET @warranty_col_sql = IF(@warranty_col_exists=0,
 'ALTER TABLE parts ADD COLUMN warranty_months SMALLINT UNSIGNED NULL AFTER warranty_info',
 'DO 0');
PREPARE warranty_col_stmt FROM @warranty_col_sql;
EXECUTE warranty_col_stmt;
DEALLOCATE PREPARE warranty_col_stmt;

CREATE TABLE IF NOT EXISTS part_warranty_batches (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 po_line_id INT NOT NULL,
 part_id INT NOT NULL,
 received_qty INT NOT NULL,
 warranty_months SMALLINT UNSIGNED NOT NULL,
 warranty_start DATE NOT NULL,
 warranty_expires DATE NOT NULL,
 received_by INT NOT NULL,
 received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines(id),
 FOREIGN KEY (part_id) REFERENCES parts(id),
 FOREIGN KEY (received_by) REFERENCES users(id),
 INDEX idx_warranty_expiry (warranty_expires),
 INDEX idx_warranty_part (part_id, warranty_expires),
 CONSTRAINT chk_part_warranty_qty CHECK (received_qty > 0),
 CONSTRAINT chk_part_warranty_months CHECK (warranty_months BETWEEN 1 AND 120),
 CONSTRAINT chk_part_warranty_dates CHECK (warranty_expires > warranty_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations(id) VALUES('2026-11-18_20_part_warranty_batches');
