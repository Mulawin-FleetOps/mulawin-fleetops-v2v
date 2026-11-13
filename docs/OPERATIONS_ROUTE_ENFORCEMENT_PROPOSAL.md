# Approved-route enforcement: proposal only

Status: **not implemented; separate business approval required**. This document does not revise the approved Objectives of the Study.

## Current backend behavior

- `backend/Modules/Operations/Trips.php::distanceColumns()` accepts a nullable `client_route_id`. With an ID it calls `RouteDistance::fromClientRoute()`; without one it calls `RouteDistance::resolve()`.
- `backend/Core/RouteDistance.php::selectable()` requires an Approved route, a current Approved rate, an Active client, and matching client/truck type when provided. Route requests at Pending Rate / Pending Approval are excluded. An Approved route with a pending rate revision remains eligible using its existing approved rate.
- `RouteDistance::resolve()` permits Manual distance when the route option or pins are absent, or the routing service is unavailable. With valid pins/option, the server computes Map distance. Editing computed/approved-route distance requires a reason; a difference over 15% warns rather than blocks.
- `Trips::create()` requires positive resolved distance for Operations Head creation. Dispatcher requests may omit distance and are reviewed later. `Trips::createBatch()` prevalidates eligible route OR map inputs OR positive manual distance for Operations Head rows; dispatcher requests retain existing relaxed distance requirements. Each row is created through the ordinary creation workflow.
- `Trips::review()` and Operations Head `edit()` resolve and validate distance, but do not globally require a route ID. `distanceUnchanged()` preserves an existing distance snapshot, including a previously approved route that is no longer offered for new work.
- Dispatch blockers currently cover workflow, resources, funds, time windows, attendance and inspection requirements; they do not establish mandatory approved-route compliance. UI warnings added by the redesign are informational and do not change that fact.

The redesign deliberately retains map/manual paths and displays an explicit missing-approved-route warning in entry, queue, review and details. It neither creates an approval nor guarantees dispatch enforcement.

## Exact proposed changes after approval

1. Confirm the enforcement boundary: require a route for all new requests, or permit incomplete dispatcher intake but require it before Operations Head approval and dispatch. Decide treatment of already scheduled, dispatched and completed trips. Decide whether approved-route distance edits remain permissible. These are business decisions, not UI defaults.
2. Add a shared server rule (proposed `Trips::requireApprovedRoute`) that takes client ID, truck type, route ID and transition context. Use `RouteDistance::selectable()` as the eligibility source; reject missing, mismatched, inactive and unapproved routes. Apply the rule **before** the `distanceUnchanged()` shortcut where current eligibility must be enforced.
3. Invoke the rule in `create`, `createBatch` prevalidation, `review` approval and Operations Head `edit` when route/client/truck changes. Add it to dispatch blockers and recheck inside `dispatch`'s transaction, including redispatch if the approved policy requires it. Keep cancellation, incident reporting, completion and historical reads usable for legacy trips.
4. Lock/re-read the relevant route and approved rate during each enforcing mutation, consistent with the existing client → route → rate lock order. Coordinate with route deactivation/rate-revision transactions to prevent a check/write race. Never rely on a selector result obtained earlier in the browser.
5. Keep map/manual tools for measuring or documenting distance, but require an independently eligible approved route at the chosen enforcing transitions. Decide whether endpoints must match canonical route labels/pins or whether deviations require explicit approval; matching IDs alone does not settle that policy.
6. Return specific validation messages and route eligibility in details/read payloads if needed. Align `newPage`, review/edit forms and the drawer with those server rules. Do not expand dispatcher access to rate amounts or approval actions.
7. Prefer no blanket `NOT NULL` migration: nullable legacy records and incomplete requests may need to remain valid. If rate-approval provenance must be retained on trips, add explicit route/rate-version snapshot fields through a separately reviewed migration and legacy transition policy. Do not backfill speculative approvals.
8. Add isolated tests for missing route, wrong client/type, each pending/inactive state, current approved rate plus pending revision, changed route at approval/dispatch, concurrent deactivation/revision, legacy grandfathering, retries, distance overrides, permissions and unchanged billing.

Acceptance: API calls cannot bypass the approved enforcement boundary; tests prove no unauthorized financial or legacy-record changes. No part of this proposal is enabled by the UI work.
