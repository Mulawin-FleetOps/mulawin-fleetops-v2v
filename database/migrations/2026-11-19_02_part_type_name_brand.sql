-- Additive inventory identity migration. Run ONCE on an existing installation after backup.
-- Does not invent specifications, rename historical part IDs, alter stock, or rewrite PO/request FKs.
-- Legacy descriptions remain intact; old rows have NULL part_type and brand pending review.
ALTER TABLE parts
  ADD COLUMN part_type VARCHAR(100) NULL AFTER part_number,
  ADD COLUMN brand VARCHAR(100) NULL AFTER description;
CREATE INDEX idx_parts_type_name ON parts(part_type, description);
-- Existing part_number remains UNIQUE and is still the stable identifier.
-- The server validates exact new Type + Specific Name + Brand combinations.
