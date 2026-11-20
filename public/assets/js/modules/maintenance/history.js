/* assets/js/modules/maintenance/history.js — MAINTENANCE HISTORY
   Finished and cancelled maintenance records with cost and attachment count. Opening a record
   shows the full detail (incident, photos, parts, costs) from Maintenance.details, which checks the role again.
   Backend: backend/Modules/Maintenance/Maintenance.php (read, page maint_history) */
'use strict';
// Standalone read-only Maintenance History details. Never navigate to Repair
// Management or reuse its editable/action-bearing drawer.
const MaintHistoryDetails = {
  async open(record) {
    const seq = App.navSeq;
    let data;
    try { data = await App.api('Maintenance.details', { job_id: record.id }); }
    catch (error) { return UI.toast(error.message || 'Unable to load history details.', 'error'); }
    if (seq !== App.navSeq) return;
    const job = data.job || {};
    const parts = Array.isArray(data.parts) ? data.parts : [];
    const costs = Array.isArray(data.costs) ? data.costs : [];
    const events = Array.isArray(data.events) ? data.events : [];
    const documents = Array.isArray(data.documents) ? data.documents : [];
    const partsCost = parts.reduce((n,p) => n + (+p.released_qty || 0) * (+p.unit_cost || 0), 0);
    const otherCost = costs.reduce((n,c) => n + (+c.amount || 0), 0);
    const outcome = job.status === 'Cancelled' ? 'Cancelled'
      : job.verified_at ? 'Returned to service' : 'Awaiting verification';
    const esc = value => UI.esc(value == null || value === '' ? '—' : String(value));
    const partsTable = parts.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Part</th><th>Request</th><th class="text-end">Requested</th><th class="text-end">Released</th><th class="text-end">Released value</th></tr></thead>
      <tbody>${parts.map(p => `<tr><td><strong>${esc(p.description || p.part_number)}</strong>
        <div class="cell-sub">${esc(p.part_number)}</div></td><td>${esc(p.request_ref)}</td>
        <td class="text-end">${UI.num(p.quantity || 0)}</td><td class="text-end">${UI.num(p.released_qty || 0)}</td>
        <td class="text-end">${UI.money((+p.released_qty || 0) * (+p.unit_cost || 0))}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="mp-history-detail-empty">No parts were requested for this repair.</p>';
    const costTable = costs.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Type</th><th>Description</th><th class="text-end">Amount</th></tr></thead>
      <tbody>${costs.map(c => `<tr><td>${esc(c.cost_type)}</td><td>${esc(c.description || c.provider)}</td>
      <td class="text-end">${UI.money(c.amount || 0)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="mp-history-detail-empty">No labor or outside costs recorded.</p>';
    const eventHistory = events.length ? `<ol class="mp-repair-status-timeline">
      ${events.map(e => `<li class="mp-repair-history-event">
        <div class="mp-repair-history-marker" aria-hidden="true"><span></span></div>
        <div class="mp-repair-history-card">
          <div class="mp-repair-history-top"><strong class="mp-repair-history-status">${esc(e.to_status || e.event_type || 'Activity')}</strong>
            <span class="mp-repair-history-time">${e.created_at ? UI.datetime(e.created_at) : 'Time not recorded'}</span></div>
          ${e.to_status && e.from_status !== e.to_status ? `<div class="mp-repair-history-change">${esc(e.from_status || 'Not recorded')} → ${esc(e.to_status)}</div>` : ''}
          ${e.details ? `<p class="mp-repair-history-note">${esc(e.details)}</p>` : ''}
          <div class="mp-repair-history-meta">${esc(e.actor || 'Actor not recorded')}${e.mechanic ? ' · Mechanic: '+esc(e.mechanic) : ''}</div>
        </div>
      </li>`).join('')}</ol>` : '<p class="mp-history-detail-empty">No status history recorded.</p>';
    // Reuse the authenticated shared document viewer: inline photo thumbnails,
    // click-to-preview images/PDFs, and the existing protected download links.
    // Keep this standalone Maintenance History drawer read-only.
    const docs = UI.docs(documents, 'No attached documents recorded.');
    const html = `<div class="mp-history-detail-readonly">
      <div class="mp-history-detail-summary">
        <span class="mp-history-readonly-label">Recorded maintenance history · Read-only</span>
        <div class="d-flex flex-wrap align-items-center gap-2"><strong>${esc(job.job_ref)}</strong>${UI.badge(outcome)}</div>
      </div>
      ${UI.h('Overview')}
      ${UI.kv([['Truck',esc(job.plate_number)],['Source',esc(job.source)],['Problem',esc(job.problem)],
        ['Reported',job.reported_on ? UI.date(job.reported_on) : '—'],
        ['Completed',job.completed_on ? UI.date(job.completed_on) : '—'],
        ['Verified',job.verified_at ? UI.datetime(job.verified_at) : 'Not yet verified'],
        ['Reported by',esc(job.reported_by_name)],['Remarks',UI.e(job.remarks)]])}
      ${UI.h('Inspection & Repairs')}
      ${UI.kv([['Lead mechanic',esc(job.mechanic)],['Inspection findings',UI.e(job.findings)],
        ['Diagnosis',UI.e(job.diagnosis)],['Corrective action',UI.e(job.repair_performed)],
        ['Verification notes',UI.e(job.verification_notes)]])}
      ${UI.h('Parts & Costs')}
      <div class="mp-history-cost-summary"><span>Parts: <b>${UI.money(partsCost)}</b></span>
        <span>Labor & others: <b>${UI.money(otherCost)}</b></span>
        <span>Total: <b>${UI.money(partsCost + otherCost)}</b></span></div>
      <h4 class="mp-history-detail-subheading">Requested parts</h4>${partsTable}
      <h4 class="mp-history-detail-subheading">Labor & other costs</h4>${costTable}
      ${UI.h('Documents')}${docs}
      ${UI.h('Status History')}${eventHistory}
    </div>`;
    UI.drawer(esc(job.job_ref) + ' · ' + esc(job.plate_number), html,
      { subtitle: 'Maintenance History · Read-only' });
  },
};

App.page('maint_history', {
  title: 'Maintenance History',
  subtitle: 'Review completed repairs.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    const rows = (d.records || []).map(r => ({ ...r, total_cost: (+r.parts_cost || 0) + (+r.other_cost || 0),
      display_status: r.status === 'Cancelled' ? 'Cancelled' : (r.verified_at ? 'Returned to service' : 'Awaiting verification') }));
    // REF_FIDELITY_V1: outcome tabs (?status=) + truck / source filters, then the reference list (search + Reset + table).
    const base = rows.filter(r => (!q.truck || r.plate_number === q.truck) && (!q.source || r.source === q.source));
    const OUT = ['Returned to service', 'Awaiting verification', 'Cancelled'];
    const tab = OUT.includes(q.status) ? q.status : '';
    const shown = base.filter(r => !tab || r.display_status === tab);
    const total = shown.reduce((a, r) => a + r.total_cost, 0);
    ctx.el.innerHTML = '<div class="mp-wireframe-marker" hidden></div>' + UI.statusTabs('maint_history', q, 'status', [['', 'All', base.length], ...OUT.map(o => [o, o, base.filter(r => r.display_status === o).length])], tab)
      + UI.filterModal(ctx, [
        { name: 'truck', label: 'Truck', type: 'select', options: (d.trucks || []).map(t => [t.plate_number, t.plate_number]), col: 6 },
        { name: 'source', label: 'Source', type: 'select', options: [['Incident', 'Trip incident'], ['On-Premise', 'Garage report']], col: 6 }],
        { hint: 'All trucks and sources.' });
    const box = document.createElement('div');
    box.classList.add('mp-reference-table', 'mp-ops-table', 'mp-history-records');
    ctx.el.append(box);
    box.innerHTML = `<div class="mp-records-heading"><div><strong>Maintenance History Records</strong><small>${UI.num(shown.length)} record${shown.length === 1 ? '' : 's'}</small></div><small>Completed and cancelled maintenance records</small></div>`;
    const open = (r) => MaintHistoryDetails.open(r);
    box.insertAdjacentHTML('beforeend', UI.table([
      ['Record', 'job_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${r.source === 'Incident' ? 'Incident ' + UI.esc(r.incident_ref || '') : 'Garage report'}</div>`],
      ['Truck', 'plate_number'], ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`], ['Mechanic', 'mechanic'],
      ['Completed', 'completed_on', 'date'], ['Outcome', 'display_status', 'badge'], ['Total cost', 'total_cost', 'money']], shown,
      { showAllColumns: true, directActions: true, limit: 10, groupBy: 'plate_number', groupLabel: 'Truck', actions: () => UI.btn('view', 'Details', 'outline-primary'), onAction: (a, r) => open(r), rowClick: open,
        empty: 'No finished maintenance records match.' })
      );
    if (typeof RecordComponents !== 'undefined') RecordComponents.maintenanceWorkspace(ctx.el, {box:'.mp-history-records'});
    const historyFilters = box.querySelector('.record-workspace-search .ui-filter-toolbar');
    const searchBar = box.querySelector('.record-workspace-search .table-search');
    if (historyFilters && searchBar) searchBar.insertAdjacentElement('afterend', historyFilters);
    box.insertAdjacentHTML('afterend', `<p class="small text-muted mt-2">Total cost of the records shown: <b>${UI.money(total)}</b> (released parts + labor and outside services).</p>`);
  },
});
