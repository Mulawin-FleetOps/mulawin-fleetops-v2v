-- Admin-controlled report access. Default deny for all non-admin roles.
CREATE TABLE IF NOT EXISTS report_access_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_type ENUM('role','user') NOT NULL,
  subject_key VARCHAR(80) NOT NULL,
  report_page VARCHAR(80) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_report_access_subject (subject_type, subject_key, report_page),
  KEY idx_report_access_page (report_page)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
