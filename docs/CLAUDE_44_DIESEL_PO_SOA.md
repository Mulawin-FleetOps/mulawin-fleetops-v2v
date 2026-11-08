# Checklist #44 — Diesel PO and Supplier SOA attachments (attachments only)

Branch: `feature/claude-44-diesel-po-soa-attachments` · Marker: `CHECKLIST_44_DIESEL_PO_SOA_ATTACHMENTS_V1` · **No database change.**

| What | How |
| --- | --- |
| **Diesel PO** (optional) | Trip Details → **Attach Diesel PO** (dispatcher of the trip's team). Allowed while the trip is Pre-Assigned, Ready for Dispatch, Dispatched, On Hold, In Transit, For Reschedule or Completed. One or more files; can be added later. New action `Trips.diesel_po`. |
| **Supplier SOA** (optional) | **Complete Trip** window, next to Waybill, Acknowledgement Receipt and Delivery Receipt (field `supplier_soa`, one or more files). |
| Storage | Existing `Files::store`: PDF / JPG / PNG / WebP checked by content, max 10 MB each, random private file name, `documents` row linked to the trip (`entity_type='trip'`), audit "document uploaded", trip history entry. A refused save keeps nothing (files removed on rollback). |
| Viewing | Trip Details document list (with counts `diesel_po_docs`, `soa_docs`) and the Documents page (categories **Diesel PO**, **Supplier SOA**). Download through the existing `Documents::download` permission check: Finance, Billing, Audit, Operations Head and the trip's dispatcher team can view and download; other teams / roles cannot. |

Unchanged: Waybill, Acknowledgement Receipt and **DR remain required** for completion; the SOA never replaces them.
Not added: diesel purchase approval, purchasing / finance workflow, supplier records, payments, SOA reconciliation.

Tests: `tests/run_trip_documents_tests.php` (58 checks). Rollback: revert the merge commit (uploaded files stay as
ordinary trip documents).
