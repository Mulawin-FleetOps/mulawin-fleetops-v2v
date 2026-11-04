/* assets/js/modules/general/reports.js — REPORTS (descriptive and diagnostic analytics, Objective 5)
   Trips (with % change vs the previous period), fleet downtime and maintenance cost,
   money (billed, collected, expenses, receivables aging, profit per trip) and inventory.
   Daily / weekly / monthly / custom periods, one filter modal, CSV per table and printing.
   Backend: backend/Modules/General/Analytics.php (reports) */
'use strict';
App.page('reports', {
  title: 'Reports',
  subtitle: 'Summaries computed from the system records. Choose the period, filter, then print or download.',
  render(ctx) {
    const d = ctx.data, q = ctx.query, fo = d.filterOptions;
    const iso = (x) => { const y = new Date(x); y.setMinutes(y.getMinutes() - y.getTimezoneOffset()); return y.toISOString().slice(0, 10); };
    const now = new Date(), mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const presets = [['Today', iso(now), iso(now)], ['This week', iso(mon), iso(now)], ['This month', iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)],
      ['Last month', iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))], ['This year', iso(new Date(now.getFullYear(), 0, 1)), iso(now)]];
    const per = d.period;
    const presetBar = `<div class="d-flex flex-wrap gap-2 align-items-center mb-2 no-print"><span class="small text-muted">Period:</span>${presets.map(([l, f, t]) =>
      `<button type="button" class="btn btn-sm ${per.from === f && per.to === t ? 'btn-primary' : 'btn-outline-secondary'}" data-preset="${f}|${t}">${l}</button>`).join('')}
      <span class="small ms-2"><b>${UI.date(per.from)} – ${UI.date(per.to)}</b> <span class="text-muted">(compared with ${UI.date(per.prevFrom)} – ${UI.date(per.prevTo)})</span></span></div>`;
    const filters = UI.filterModal(ctx, [
      { name: 'from', label: 'From (custom period)', type: 'date', col: 6 }, { name: 'to', label: 'To', type: 'date', col: 6 },
      { name: 'truck_type', label: 'Truck type', type: 'select', options: UI.list(App.me.truckTypes), col: 6 },
      { name: 'status', label: 'Trip status', type: 'select', options: UI.list(d.statuses), col: 6 },
      { name: 'client_id', label: 'Client', type: 'select', options: UI.opts(fo.clients, c => c.company_name), col: 6 },
      { name: 'vehicle_id', label: 'Truck / plate', type: 'select', options: UI.opts(fo.trucks, v => v.plate_number), col: 6 },
      { name: 'person_id', label: 'Driver / helper', type: 'select', options: UI.opts(fo.people, p => p.full_name + ' (' + p.person_type + ')'), col: 6 },
      { name: 'dispatcher_id', label: 'Dispatcher', type: 'select', options: UI.opts(fo.dispatchers, u => u.full_name), col: 6 }],
      { note: 'Truck type, status, client, truck, driver and dispatcher filters apply to the trip report.', hint: 'No filters (all trucks, clients and drivers).' });
    ctx.el.innerHTML = presetBar + filters;
    ctx.el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const [f, t] = b.dataset.preset.split('|'); App.go('reports', { ...q, from: f, to: t }); });
    const keys = Object.keys(d.sections);
    if (!keys.length) { ctx.el.insertAdjacentHTML('beforeend', '<div class="table-empty">No reports for your role.</div>'); return; }
    const meta = () => ({ title: 'Mulawin FleetOps report', period: UI.date(per.from) + ' – ' + UI.date(per.to),
      filters: Object.entries(q).filter(([k, v]) => v && !['from', 'to'].includes(k)).map(([k, v]) => k + ': ' + v).join(', ') });
    const p1 = document.createElement('button'); p1.className = 'btn btn-sm btn-outline-secondary'; p1.innerHTML = '<i class="bi bi-printer"></i> Print this tab';
    const p2 = document.createElement('button'); p2.className = 'btn btn-sm btn-outline-secondary'; p2.innerHTML = '<i class="bi bi-printer-fill"></i> Print all';
    let current = keys[0];
    p1.onclick = () => UI.printReport([d.sections[current]], meta());
    p2.onclick = () => UI.printReport(keys.map(k => d.sections[k]), meta());
    ctx.tools.append(p1, p2);
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, keys.map(k => [k, d.sections[k].title, () => { current = k; const s = d.sections[k];
      return (s.note ? `<div class="small text-muted mb-2"><i class="bi bi-info-circle"></i> ${UI.esc(s.note)}</div>` : '') + UI.blocks(s, { maxCharts: 3, key: 'rep-' + k }); }]));
  },
});
