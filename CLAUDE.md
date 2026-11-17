# Mulawin FleetOps V2 — Claude Code project instructions

Read and follow `AGENTS.md` at the repository root and `docs/OBJECTIVES_TRACEABILITY.md` before making changes. The actual system is PHP + JavaScript + MySQL + XAMPP, not Django/React. When relevant, also read `docs/MULAWIN_UI_WIREFRAME_IMPLEMENTATION_SPEC.md`.

Work on `luis-maintenance-ui` in `C:\xampp\htdocs\RP_Mulawin_FMS_V2`. Prioritize completing and verifying required end-to-end workflows, especially Maintenance–Purchasing–Accounting, before adding more UI or analytics features. Avoid repeated broad audits. Implement a bounded vertical slice and verify the critical paths.

Protect `mulawin_v2`: no writes, migrations, seeding, cleanup or destructive actions without the user's explicit approval and a verified backup/recovery plan. Preserve existing records and demo records. Never push, merge, or discard uncommitted work without approval. Keep manual command and edit approvals.

On each implementation, state objective IDs, exact changed files, user-visible change, relevant checks, remaining risks and the next action. Distinguish demo data from genuine history and don't claim validated forecasts without evidence.

## UI/UX skills

Taste, a11y, bans, voice, and icon library for this project live in `.ux-profile.md`.
Run `setup-ui-ux-skills` again only to change those defaults.
Before UI or microcopy work, read `.ux-profile.md`, then the matching domain skill (page-patterns, viewports, forms, surfaces, loaders, empty-states, copy, motion).
Before creating a new page, read `page-patterns` and name the pattern. Do not write page markup until the pattern is named.
Layouts must pass `viewports` at 375px and 1280px.
Before finishing UI work, run `ux-audit`.
