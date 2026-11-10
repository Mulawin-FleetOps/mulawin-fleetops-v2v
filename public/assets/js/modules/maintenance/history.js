/* assets/js/modules/maintenance/history.js — MAINTENANCE HISTORY
   Finished and cancelled maintenance records with cost and attachment count. Opening a record
   shows the full detail (incident, photos, parts, costs) from Maintenance.details, which checks the role again.
   Backend: backend/Modules/Maintenance/Maintenance.php (read, page maint_history) */
'use strict';
App.page('maint_history', {
  title: 'Maintenance History',
  subtitle: 'Completed and cancelled repairs: findings, costs and attachments.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    const rows = (d.records || []).map(r => ({ ...r, total_cost: (+r.parts_cost || 0) + (+r.other_cost || 0),
      display_status: r.status === 'Cancelled' ? 'Cancelled' : (r.verified_at ? 'Returned to service' : 'Awaiting verification') }));
    const filters = UI.filterModal(ctx, [
      { name: 'truck', label: 'Truck', type: 'select', options: (d.trucks || []).map(t => [t.plate_number, t.plate_number]), col: 6 },
      { name: 'status', label: 'Outcome', type: 'select', options: ['Returned to service', 'Awaiting verification', 'Cancelled'], col: 6 },
      { name: 'source', label: 'Source', type: 'select', options: [['Incident', 'Trip incident'], ['On-Premise', 'Garage report']], col: 6 }],
      { hint: 'All finished records.' });
    ctx.el.innerHTML = filters;
    const shown = rows.filter(r => (!q.truck || r.plate_number === q.truck) && (!q.status || r.display_status === q.status) && (!q.source || r.source === q.source));
    const total = shown.reduce((a, r) => a + r.total_cost, 0);
    const box = document.createElement('div'); ctx.el.append(box);
    const open = (r) => App.go('maintenance', { open: r.id });
    box.innerHTML = UI.table([
      ['Record', 'job_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${r.source === 'Incident' ? 'Incident ' + UI.esc(r.incident_ref || '') : 'Garage report'}</div>`],
      ['Truck', 'plate_number'], ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`], ['Mechanic', 'mechanic'],
      ['Completed', 'completed_on', 'date'], ['Outcome', 'display_status', 'badge'], ['Total cost', 'total_cost', 'money'], ['Attachments', 'attachments', 'num']], shown,
      { title: 'Maintenance records (' + shown.length + ') · total cost ' + UI.money(total), actions: () => UI.btn('view', 'Open'), onAction: (a, r) => open(r), rowClick: open,
        empty: 'No finished maintenance records match.' });
  },
});
