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
    const shown = rows.filter(r => (!q.truck || r.plate_number === q.truck) && (!q.status || r.display_status === q.status) && (!q.source || r.source === q.source));
    const total = shown.reduce((a, r) => a + r.total_cost, 0);
    // STAGE_A_MOTORPOOL_UI: KPI tiles from the loaded records (each opens this page filtered by outcome) and a back link.
    const cnt = (s) => rows.filter(r => r.display_status === s).length;
    ctx.el.innerHTML = `<div class="mp-ws">${UI.crumb('maintenance_overview', 'Maintenance Overview')}${UI.kpiTiles([
      { label: 'Finished records', value: rows.length, note: 'completed or cancelled', icon: 'bi-journal-check', tone: 'gray', go: 'maint_history' },
      { label: 'Returned to service', value: cnt('Returned to service'), note: 'verified repairs', icon: 'bi-check2-circle', tone: 'green', go: 'maint_history?status=Returned to service' },
      { label: 'Awaiting verification', value: cnt('Awaiting verification'), note: 'repaired, not yet verified', icon: 'bi-clipboard-check', tone: cnt('Awaiting verification') ? 'amber' : 'gray', go: 'maint_history?status=Awaiting verification' },
      { label: 'Cancelled', value: cnt('Cancelled'), note: 'reports made by mistake', icon: 'bi-x-circle', tone: 'gray', go: 'maint_history?status=Cancelled' },
      { label: 'Repair cost shown', value: UI.money(total), note: shown.length + ' record(s) in the list below', icon: 'bi-cash-coin', tone: 'blue' },
    ])}</div>` + filters;
    const box = document.createElement('div'); ctx.el.append(box);
    const open = (r) => App.go('maintenance', { open: r.id });
    box.innerHTML = UI.table([
      ['Record', 'job_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${r.source === 'Incident' ? 'Incident ' + UI.esc(r.incident_ref || '') : 'Garage report'}</div>`],
      ['Truck', 'plate_number'], ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`], ['Mechanic', 'mechanic'],
      ['Completed', 'completed_on', 'date'], ['Returned to service', 'verified_at', 'datetime'], ['Outcome', 'display_status', 'badge'], ['Total cost', 'total_cost', 'money'], ['Attachments', 'attachments', 'num']], shown,
      { title: 'Maintenance records (' + shown.length + ') · total cost ' + UI.money(total), actions: () => UI.btn('view', 'Open'), onAction: (a, r) => open(r), rowClick: open,
        empty: 'No finished maintenance records match.' });
  },
});
