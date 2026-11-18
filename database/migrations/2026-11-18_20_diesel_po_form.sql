-- Optional structured Diesel PO fields attached to a fund request.
-- This additive migration preserves all existing fund and document records.
ALTER TABLE fund_requests ADD COLUMN diesel_po_json JSON NULL;
INSERT IGNORE INTO schema_migrations (id) VALUES ('2026-11-18_20_diesel_po_form');
