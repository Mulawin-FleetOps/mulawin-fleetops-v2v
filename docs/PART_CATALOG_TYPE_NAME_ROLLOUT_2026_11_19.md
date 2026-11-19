# Part catalog: Part ID / Part Type / specific Part Name

Branch: `luis`. Code and SQL were committed, but the existing XAMPP/production database migration has **not** been run.

## Approved fields

- `part_number`: existing unique permanent **Part ID**. Generated on insert (e.g. `PART-000001`), never renumber legacy parts.
- `part_type`: general type such as Tire. Required for **new** parts, nullable for unclassified historical parts.
- `description`: existing **Part Name / Specification**, required. It continues to store the specific actual item identity; no historical description is overwritten.
- `brand`: optional manufacturer / brand.
- `category`: optional inventory grouping, distinct from Part Type.
- Existing unit, unit cost, reorder level, on-hand and all historical record links remain unchanged.

Two different parts may share a Type, or the same specific Name if their Brand differs. The server prevents saving a duplicate populated (Type, Name, Brand) combination; the database continues to use the immutable Part ID as primary reference. No legacy part types or specifications are inferred from generic descriptions (for example, `tires`).

## User interface

- Purchasing Inventory parts list: separate Part ID, Part Type, Part Name, plus stock/availability and actions. Brand appears beneath the specific Name and in part detail; the Category remains available for filtering.
- Add/Edit Part: system-generated ID; explicit Type, specific Name, optional Brand and Category.
- Purchase Order items: `Part Type — specific Part Name — Brand` (recorded values only); supplier autofill remains linked to the unchanged real `part_id`.
- Motorpool request selector and details: same verified part identity; old unclassified records are clearly marked rather than invented.
- Request summaries use actual item names, not raw generic numeric IDs, when the migration is present.
- Parts Request, PO, receiving, stock count, stock movements, reservations and Finance continue to reference stable `parts.id`, not Part Name.

## Deploy on existing database

1. Take and verify a database backup. Review prior outstanding purchasing migrations independently.
2. Run `database/migrations/2026-11-19_02_part_type_name_brand.sql` **once**, not `database/extension.sql` over an existing database.
3. Deploy updated code on the `luis` branch.
4. Review historical parts in Inventory. Supply Type and correct specific Name only from real stock labels, purchasing documents or an authorized user.
5. Do not create a second part to "fix" an old item with stock movements. Edit the existing catalog identity after verification.

## Acceptance cases (not executed against live data)

- New Tire / exact size / Brand creates a unique Part ID with on-hand=0; a different size or brand can be a distinct part.
- Duplicate Type/Name/Brand is rejected on edit and create; same name with another brand is permitted.
- Legacy `tires` record retains its original part ID, description, quantity and movement history; Type says unclassified until confirmed.
- Motorpool selects correct variant in a real request; reservations and stock-out still reference original part_id.
- Purchasing selects the same variant for a PO; supplier suggestion uses that exact part's previous confirmed PO history.
- Receiving increments stock for the exact part ID, not all parts of that type; warranty and count history remain intact.
- Role permissions prevent Motorpool from editing catalog identity.
- Existing installation before migration clearly warns that catalog edits require migration, while readable existing lists remain available.
- Confirm layouts at desktop/tablet widths and verify actual browser dropdowns.

## Verification status

GitHub source-level checks confirm new fields and JavaScript syntax. PHP lint, SQL migration execution, browser checks, cross-role acceptance and concurrent duplicate-creation tests remain pending; do not claim production readiness based on the code commits.
