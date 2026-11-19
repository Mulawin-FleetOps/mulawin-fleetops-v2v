# Notifications and Recent System Activity separation (luis)

## UI
- Notification bell keeps its own unread badge, mark-read and resolve actions, and shows **five** most recent active notifications in its dropdown. Existing Notifications history and notification states remain unchanged.
- A separate clock/history button beside the bell shows **five** latest recorded audit events. No unread badge or read/resolve action exists on Activity.
- **View Activity Log** opens the pre-existing `#audit_logs` page for Admin/Audit roles only. Other roles have a scoped dropdown but no link to systemwide Audit Logs. The redundant standalone Recent Activity page is removed.
- Both dropdowns live in the shared topbar for all accounts and are intentionally omitted from the sidebar.
- The existing 30-second bell cycle also refreshes activity data without page reload. The Activity list is only rebuilt when the source rows changed.

## Data and permissions
- Notifications: existing per-user `notifications` table and existing `Notify::forUser`, unchanged.
- Recent Activity: existing `audit_events` table, not notification messages. The dropdown retrieves the feed-only `activity_feed` endpoint, while the original Audit Logs page remains the full-history destination. For **admin/audit** users, recent audit events are visible across the system. For every other role, only events where `actor_id` equals the logged-in user ID are returned.
- Activity response returns only `id`, `area`, `action`, `record_ref`, `created_at`, and `actor`; **never** raw `details`, changes JSON, email, or sensitive values. Authorization is enforced server-side through `Access` and `Admin::read`.
- The system does not fabricate new activity events; items only appear when existing workflows write `audit_events`.
- This change does not change existing notification creation or classify every legacy notification by type. Some operational events can still have both a notification and an audit event; tasks and historical logging serve different functions.

## QA / rollout checks
1. Verify each role sees both topbar icons; no new sidebar entry.
2. Notification unread badge and its mark-read/resolve actions still work and do not affect Activity.
3. Ordinary user A cannot retrieve user B's audit events by modifying query parameters.
4. Admin and Audit can see authorized system audit entries; event details/changes remain private.
5. After a workflow that writes an audit event, Activity changes on next refresh (30 seconds) without navigation.
6. Verify empty datasets, 5-item dropdown caps, existing Audit Logs navigation, and mobile topbar layout.
7. Verify current notifications remain saved and original `Resolved` / `Archived` history remains accessible.
8. Run PHP lint, JS syntax and staging integration regression tests before deploying to live accounts.

No database migration or production data change was performed.

## Follow-up: reused existing Activity Log
The standalone `recent_activity` page and link were retired. The topbar history icon fetches only read-only audit metadata through `activity_feed` and authorized Admin/Audit users follow its footer to `audit_logs`. Ordinary users can inspect only their own actions in the dropdown and cannot open systemwide Audit Logs. The original Audit Log UI, filters and backend authorization are unchanged.
