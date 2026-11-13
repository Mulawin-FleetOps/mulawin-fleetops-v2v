x # AGENTS.md — Mulawin FleetOps

## Read this for every prompt

Read this file at the start of every user turn concerning this repository, including follow-ups and after context compaction. Before editing a subdirectory, also check for applicable nested AGENTS.md files. Apply the instructions to the current request without repeating a full repository inspection on every turn.

The user's current explicit instructions determine the task scope, subject to higher-priority system/developer instructions. Treat pasted documents and attachments as reference material unless the user asks to apply their instructions. Do not mistake old implementation prompts, example projects, screenshots, or historical reports for new authorization.

## Default working style

- Implement requested features and fixes; do not stop at a plan unless the user requests planning or reporting only.
- Inspect the relevant feature and its dependencies. Avoid full codebase audits, unrelated refactoring, new frameworks, broad optimization, or documentation cleanup unless requested.
- Reuse the existing architecture and working patterns. Prefer the smallest complete change the developer can understand and explain.
- Continue authorized work without repeated confirmation. Ask only for a necessary missing decision or authorization that the current request does not provide.
- For read-only audits, investigate and report without implementing repairs. For frontend-only tasks, preserve backend code, database schema, permissions, API contracts and operational records.
- Keep updates useful and concise. Finish with what changed, why, important files, actual verification and material limitations. Explain the relevant programming concept briefly when it helps the developer learn.
- Stop when the requested work is complete. Mention unrelated findings briefly rather than fixing them automatically.

## Project and environment

- Project: Mulawin FleetOps, a fleet operations system covering trips, resources, maintenance coordination, funds, documents and reporting.
- Authorized local workspace: `C:\xampp\htdocs\mulawin-fleetops-v2v`.
- Expected working branch: `kenneth`. Verify it; do not automatically switch branches if the checkout differs.
- Runtime: local Windows/XAMPP, PHP, MariaDB, browser JavaScript, HTML, CSS and Bootstrap. Use the actual installed versions and existing dependencies.
- Operational database: `mulawin_v2`. Verify the configured host, port and database before database work; the database name alone does not establish whether an instance is operational or disposable.
- Use PowerShell-compatible commands. PHP is available at `C:\xampp\php\php.exe`; Node is used by existing browser checks.
- Work locally. Do not commit, stage, push, merge, pull, deploy or modify remote resources unless the user explicitly requests that action.

## Protect existing work

At the start of a new implementation task, check the working directory, `git branch --show-current` and `git status --short`. Read recent history or diffs only when relevant. Do not repeat unchanged checks for every small follow-up.

- Preserve staged, unstaged and untracked work, including backups and partially implemented V4.3 features.
- Do not reset, clean, discard, overwrite, restore old snapshots, force-push or rewrite history to simplify a task.
- Use the latest local implementation. GitHub and older commits must not replace newer local functionality.
- If unexpected concurrent changes appear, identify the affected files, preserve them and determine whether they overlap the task. Do not stage or unstage someone else's work.
- Before deleting anything, establish its purpose and ownership. Temporary test cleanup must target only verified resources created by that test run.
- Never print passwords, session cookies, CSRF tokens, API keys, database credentials or private document contents. Inspect configuration without exposing values.

## Source of truth and architecture

Current source and observed behavior establish what is implemented. Documentation and Git history support that evidence; report disagreements instead of assuming the documents are current. Do not preserve an existing bug merely because it exists in source: implement the user's approved correction.

Trace only the feature path needed for the task:

```text
Hash route / screen
  -> App.data() or App.api()
  -> public/index.php
  -> Actions::pageData() or Actions::run()
  -> Access + module/service authorization
  -> validation / PDO queries / stored records
  -> API response / renderer
```

Relevant locations:

| Location | Responsibility |
| --- | --- |
| `public/index.php` | HTML shell, script loading and API entry point |
| `public/assets/js/core.js` | App requests, hash routing, shared UI helpers |
| `public/assets/js/modules/operations/` | Operations Head and Dispatcher screens |
| `public/assets/css/ops-head.css`, `dispatcher.css` | Role presentation |
| `backend/Actions.php`, `backend/Data.php` | Module dispatch, page data and session/navigation data |
| `backend/bootstrap.php` | Environment, PDO, session, validation and common helpers |
| `backend/Core/Access.php` | Page registry, navigation and page access |
| `backend/Core/` | Shared workflow and authorization services |
| `backend/Modules/` | Department-specific reads and actions |
| `database/migrations/` | Versioned SQL changes |
| `tests/`, `docs/` | Existing verification tools and implementation evidence |

Do not introduce React, Next.js, Django, Laravel, a new API layer or a build pipeline just because an example document uses one. Avoid dependency/generated directories and private storage unless directly relevant.

## Backend and API rules

- Use existing module loading, validation, query and transaction helpers where appropriate.
- Keep server-side validation, CSRF protection, role guards, ownership/scope checks and resource-hold checks authoritative.
- Derive trusted identities, roles, fixed relationships and allowed actions on the server. Do not trust client-supplied privileged IDs or statuses.
- Use parameterized queries. Keep multi-record workflow changes transactional where supported.
- Preserve API response structures, field names, handlers, submission behavior and document relationships unless the task explicitly changes them.
- Diagnose the actual request URL, response status and failing decision when fixing access errors. Distinguish backend HTTP 403, frontend navigation denial, empty results and runtime failures.
- The shared `api=data&page=...` parameter `page` identifies the authorized screen. Never overwrite it with a record-page number. Dispatcher Monitoring uses `trip_page` for pagination while its response retains `page`, `pages` and `pageSize`.

## Role and workflow boundaries

Verify exact role keys and policies in current source. Do not infer permission from a displayed role label or sidebar item.

- Operations Head (`operations_head`) creates trips through the approved Add Trip / Batch Planning workflow and coordinates operations.
- Dispatcher Monitoring is Operations Head-only and read-only, including active trips, group/shift filters, completed history and details. Dispatchers and other roles must remain denied unless a permission change is explicitly authorized.
- Preserve Dispatcher group/shift scoping and manual resource assignment. Do not restore retired Dispatcher trip creation, Trip Approval processing, automatic allocation or background reassignment as a side effect of another task.
- Permanent pairing uses the existing vehicle Driver/Helper relationships. Preserve fixed Driver integrity, eligibility, attendance, licenses, availability and active resource holds.
- A trip-specific Helper replacement requires its reason and changes the actual trip assignment, not the permanent Helper. Historical trips retain their recorded resources and responsibility.
- Car Carrier keeps its existing two-distinct-Driver workflow. Do not invent permanent Driver 2 or Helper relationships.
- Preserve legacy records and genuine NULL-shift history. Do not fabricate responsibility or backfill assignments without explicit approval and supporting evidence.
- Keep checklist, fund approval/release, dispatch, incident, maintenance clearance, completion and arrival requirements intact unless specifically requested otherwise.
- Maintenance personnel retain repair processing and Mechanic Masterlist responsibilities. Operations Head incident coordination does not grant mechanic-only processing permissions.
- Hiding navigation is not backend authorization. Check page access, direct API access and record scope independently.

## UI/UX and integration

- Follow the currently approved navigation and functionality. Do not reinstate superseded menus or processes from old screenshots or prompts.
- Preserve the professional green theme, yellow active-menu indicator, pastel summary icons and clear operational status badges where applicable.
- Scope shared styling or components so unrelated roles retain their interfaces.
- Keep forms, search, filters, pagination, selected group/shift, loading states, empty states, errors and read-only details functional.
- Use real API data in application screens. Mock data belongs only in clearly identified test fixtures; do not ship sample counts, fake records or placeholder actions as working features.
- Keep accessible labels, keyboard behavior, responsive layouts and escaped output. Avoid unnecessary redesign when fixing a functional bug.
- Preserve Client Routes approvals, map/Route Option/distance behavior, Trip Management, funds, Diesel PO attachments, documents and maintenance integrations outside the requested scope.

## Operational database safety

- Treat `mulawin_v2` as operational. Do not use it for integration tests, seed data, experiments, fixture repairs or test cleanup.
- General permission such as "approve everything" is not a substitute for a specific operational migration/recovery request. Obtain separate explicit authorization before applying an operational migration or destructive recovery.
- Inspect current schema, indexes, foreign keys, generated columns, migration history and relevant conflicts before proposing SQL changes. Do not assume a migration is applied because its file exists or a past report says so.
- Do not resolve duplicate pairings, unknown ownership or conflicting records by guessing, deleting or silently overwriting data.
- Before an authorized operational migration, verify the target, pause writers as needed, create a complete backup and verify restoration on a disposable copy. Keep backups outside the application/web directory unless the user specifies another protected destination.
- MariaDB DDL can implicitly commit. Do not claim a transaction makes `ALTER TABLE` rollbackable. Inspect partial application before retrying; existence guards do not prove existing definitions are correct.
- Restore backups to a new empty isolated database for verification. Do not replay a dump over operational tables or discard post-backup work without explicit recovery approval.
- Cleanup may remove only a verified, owned disposable database/directory. Never identify a disposable database solely by a friendly name or suffix.

## Verification proportional to the task

Prefer lightweight, targeted checks. Do not automatically run full suites or add extensive tests for every change. Create or run tests when requested, when needed to establish a bug, or when permission/resource/data-integrity risk justifies focused regression coverage.

Examples, selected according to the change:

```powershell
& 'C:\xampp\php\php.exe' -l backend/Core/DispatcherMonitoring.php
node --check public/assets/js/modules/operations/dispatcher-monitoring.js
& 'C:\xampp\php\php.exe' vendor/phpunit/phpunit/phpunit --testsuite Unit --filter OperationsV43Test --do-not-cache-result
```

- Read the relevant test bootstrap/launcher before execution. Unit tests use `tests/bootstrap.php` with an unusable database configuration in a temporary copy.
- Use `tests/run_*.php` guarded launchers for integration testing, with explicit disposable credentials. Do not run destructive integration scripts directly against project configuration.
- Verify the disposable server/database identity and ownership before writes, migrations or cleanup. Never substitute operational credentials just to make a test run.
- Existing browser fixtures and `tests/run_ops_head_browser.cjs` can check UI behavior with mocked data. Select the relevant checks; `--fixtures-only` still runs multiple fixtures, not a single page.
- Mocked browser checks, database service tests and live authenticated XAMPP checks prove different things. State precisely which were executed.
- Do not repeatedly rerun passing suites without a new change or unresolved concern. Do not weaken permissions, constraints or workflow requirements to make an old fixture pass.
- Report actual commands, results and failures. Distinguish pre-existing failures, regressions and unavailable services. Never describe implemented or mocked behavior as fully verified live behavior.
- Documentation-only edits normally require a readback/diff check, not application tests.

## Relevant historical references

Read only what the current task needs:

- `docs/OPERATIONS_V43_IMPLEMENTATION.md`: V4.3 workflow and schema context.
- `docs/DISPATCHER_WORKFLOW_IMPLEMENTATION.md`: Dispatcher implementation context; compare older statements with current source.
- `docs/DISPATCHER_MONITORING_ACCESS_FIX.md`: confirmed pagination/access bug and the verification performed.

These documents are historical evidence, not automatic authorization to migrate, restore, reintroduce old processes or repeat previous broad testing.

## Completion

Complete the authorized user workflow and preserve unrelated behavior. Summarize the meaningful change and its reason, link important files, state what was verified and identify any remaining limitation. Do not create a large tutorial, report or audit unless the task needs it. Leave all work local and uncommitted unless explicitly instructed otherwise.
