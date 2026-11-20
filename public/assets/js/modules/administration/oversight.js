/* assets/js/modules/administration/oversight.js — HEAD MANAGEMENT (Admin) workspace   HEAD_MANAGEMENT_V1
   Pages: admin_overview, admin_approvals, admin_operations, admin_maintenance, admin_purchasing, admin_finance,
   admin_reports (Executive Reports: items requiring attention, by workflow group and recorded date), admin_analytics (topic-based trends; weekly finance policy).
   Users & Roles = the existing User Management page ('admin'); Audit Trail = the existing read-only Audit Logs ('audit_logs').
   Data: backend/Modules/Administration/Oversight.php (read only). Approval decisions call the EXISTING actions
   (Purchasing.po_decide, Purchasing.count_review, Billing.charge_decide), which check the Admin role, the current state
   and separation of duties again. Department records open in their own pages (read-only for the Admin there). */
'use strict';
const HM = {
  list: (items, empty) => UI.wsList(items, empty),
  entry: (go, title, sub, side) => UI.wsEntry(go, title, sub, side),
  pill: (n, tone) => `<span class="badge-s ${tone || (+n ? 'amber' : 'gray')}">${UI.esc(n)}</span>`,
  /** Floating suggestions content (same look as the Motorpool / Purchasing reports). */
  sug: (items, empty) => items && items.length ? `<ul class="ws-sug">${items.map(x => `<li>${UI.esc(x.text)}${x.go && UI.canGo(x.go) ? ` <button type="button" class="btn btn-link btn-sm" data-go="${UI.esc(x.go)}">${UI.esc(x.label || 'Open')}</button>` : ''}</li>`).join('')}</ul>`
    : `<div class="ws-sug-empty">${UI.esc(empty)}</div>`,
  exceptionEntries: (rows) => rows.map(x => HM.entry(x.go, `<b>${UI.esc(x.title)}</b>`, UI.esc(x.sub), HM.pill(UI.num(x.n), x.tone === 'red' ? 'red' : 'amber'))),
  /** Drawer listing the rows behind a figure, with the total that equals the figure. */
  breakdown(title, basis, table, totalLabel, total) {
    UI.drawer(UI.esc(title), `<p class="small text-muted mb-2">${basis}</p>${table}${totalLabel ? `<div class="mr-recon"><span>${UI.esc(totalLabel)}</span><b>${total}</b></div>` : ''}`, { subtitle: 'Source records' });
  },
  bindClicks(root, map) { root.querySelectorAll('[data-hm]').forEach(el => { const fn = map[el.dataset.hm]; if (!fn) return;
    el.classList.add('clickable'); el.setAttribute('role', 'button'); el.tabIndex = 0; el.onclick = fn; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }; }); },
};

// ---------------------------------------------------------------- Overview
App.page('admin_overview', {
  title: 'Head Management Overview',
  subtitle: 'Cross-department visibility and the decisions that need management attention.',
  render(ctx) {
    const d = ctx.data, k = d.kpis && !Array.isArray(d.kpis) ? d.kpis : {};
    UI.tool(ctx, 'Executive reports', () => App.go('admin_reports'), 'bi-graph-up');
    UI.tool(ctx, 'Review approvals', () => App.go('approvals'), 'bi-check2-square', 'primary');
    const tiles = [
      { label: 'Awaiting your approval', value: UI.num(k.approvals), note: 'decisions routed to the Admin', tone: k.approvals ? 'amber' : 'gray', go: 'approvals' },
      { label: 'Active trips', value: UI.num(k.active_trips), note: 'dispatched or in transit (now)', tone: 'gray', go: 'admin_operations' },
      { label: 'Trucks under repair', value: UI.num(k.trucks_repair), note: 'truck status Under Maintenance', tone: k.trucks_repair ? 'amber' : 'gray', go: 'admin_maintenance' },
      { label: 'Open purchase orders', value: UI.num(k.open_pos), note: 'awaiting approval or delivery', tone: 'gray', go: 'admin_purchasing' },
      { label: 'Outstanding receivables', value: UI.money(k.receivables), note: 'open invoices, unpaid balance', tone: 'gray', go: 'admin_finance' },
      { label: 'Low-stock parts', value: UI.num(k.low_stock), note: 'at or below the reorder level', tone: k.low_stock ? 'red' : 'gray', go: 'admin_purchasing' },
    ];
    const att = Array.isArray(d.attention) ? d.attention : [], dec = Array.isArray(d.decisions) ? d.decisions : [], act = Array.isArray(d.activity) ? d.activity : [];
    const deps = Array.isArray(d.departments) ? d.departments : [];
    ctx.el.innerHTML = `<div class="maint-overview mp-ws">${UI.kpiTiles(tiles, 'ws-kpi6')}
      ${UI.quickBar([{ label: 'Approvals', icon: 'bi-check2-square', go: 'approvals' }, { label: 'Financial oversight', icon: 'bi-cash-coin', go: 'admin_finance' },
        { label: 'Users & roles', icon: 'bi-people', go: 'admin' }, { label: 'Audit trail', icon: 'bi-journal-text', go: 'audit_logs' }, { label: 'Documents', icon: 'bi-folder2-open', go: 'documents' },
        { label: 'Company dashboard', icon: 'bi-grid-1x2', go: 'dashboard' }])}
      <div class="ws-grid2">
        ${UI.wsPanel('Needs management attention', 'bi-flag', HM.list(HM.exceptionEntries(att), 'No management exception right now.'), { cls: 'ws-l1', count: att.length })}
        ${UI.wsPanel('Department status', 'bi-diagram-3', HM.list(deps.map(x => HM.entry(x.go, `<b>${UI.esc(x.name)}</b>`,
          x.items.map(([l, n]) => `${UI.esc(l)} <b>${UI.num(n)}</b>`).join(' · '), '')), 'No department data.'), { cls: 'ws-r1' })}
        ${UI.wsPanel('Recent cross-department activity', 'bi-activity', HM.list(act.map(e => HM.entry('audit_logs', `<b>${UI.esc(e.action)}</b> <span class="mo-ref">${UI.esc(e.area)}${e.record_ref ? ' · ' + UI.esc(e.record_ref) : ''}</span>`,
          `${UI.esc(e.actor)} · ${UI.datetime(e.created_at)}`, '')), 'No recorded activity yet.'), { cls: 'ws-l2', go: 'audit_logs', goLabel: 'Audit trail' })}
        ${UI.wsPanel('Pending management decisions', 'bi-check2-square', HM.list(dec.map(r => HM.entry('approvals?open=' + encodeURIComponent(r.key), `<b>${UI.esc(r.ref)}</b> <span class="mo-ref">${UI.esc(r.type)}</span>`,
          `${UI.esc(r.dept)} · ${UI.esc(r.requester || '')} · ${UI.money(r.amount)}`, HM.pill(r.actionable ? 'Your decision' : 'Own request', r.actionable ? 'amber' : 'gray'))), 'Nothing is waiting for an Admin decision.'), { cls: 'ws-r2', count: dec.length, go: 'approvals' })}
      </div></div>`;
  },
});

// ---------------------------------------------------------------- Approvals
const HMApproval = {
  /** Details drawer of one queue row; decision buttons only when the backend's own rules allow the Admin to decide now. */
  async open(r) {
    const seq = App.navSeq;
    try {
      if (r.kind === 'po') {
        const x = await App.api('Purchasing.po_details', { po_id: r.id }); if (seq !== App.navSeq) return; const o = x.po;
        const el = UI.drawer(UI.esc(o.po_ref), `${HMApproval.next(r)}
          ${UI.kv([['Request', 'Purchase order above the approval limit (' + UI.esc(o.approver_role === 'admin' ? 'routed to the Admin' : 'routed to Finance') + ')'], ['Status', UI.badge(o.status) + (o.payment_status ? ' ' + UI.badge(o.payment_status) : '')],
            ['Supplier', `<b>${UI.esc(o.supplier)}</b>`], ['Purpose', UI.e(o.purpose)], ['Parts request', o.request_ref ? UI.esc(o.request_ref) : 'Not linked'], ['Requested by', UI.esc(o.requested_by_name) + ' · ' + UI.datetime(o.created_at)],
            ['Amount', `<b>${UI.money(o.total_amount)}</b>`], o.decided_at ? ['Decision', UI.esc(o.decided_by_name || 'System') + ' · ' + UI.datetime(o.decided_at) + (o.decision_notes ? `<div class="cell-sub">${UI.esc(o.decision_notes)}</div>` : '')] : null])}
          ${UI.h('Items')}${UI.table([['Part', 'part_number', (v, l) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(l.description)}</div>`], ['Qty', 'quantity', (v, l) => UI.num(v) + ' ' + UI.esc(l.unit)], ['Unit price', 'unit_price', 'money'], ['Amount', 'line_total', 'money']], x.lines, { plain: true })}
          ${UI.h('Supporting documents')}${UI.docs(x.documents)}${UI.h('Approval history')}${PurUI.timeline(x.history)}
          <div class="d-flex flex-wrap gap-2 mt-3" data-acts>${r.actionable && o.status === 'Pending Approval' ? UI.btn('approve', 'Approve', 'success', 'bi-check-lg') + UI.btn('reject', 'Reject', 'outline-danger', 'bi-x-lg') : ''}
            ${UI.canGo(r.go) ? UI.btn('src', 'Open purchase order', 'outline-secondary', 'bi-box-arrow-up-right') : ''}</div>`, { subtitle: 'Purchasing · ' + UI.esc(r.type) });
        HMApproval.bind(el, r, {
          approve: () => UI.confirmAction('Approve ' + UI.esc(o.po_ref), `Approve ${UI.money(o.total_amount)} to ${UI.esc(o.supplier)}? The system checks the purchasing budget and reserves the amount; if the budget is not enough the PO is rejected automatically.`,
            'Purchasing.po_decide', { po_id: o.id, decision: 'approve' }, { submit: 'Approve' }),
          reject: () => UI.confirmAction('Reject ' + UI.esc(o.po_ref), 'The Purchasing Officer will be notified.', 'Purchasing.po_decide', { po_id: o.id, decision: 'reject' },
            { danger: true, submit: 'Reject', fields: [{ name: 'notes', label: 'Reason', required: true, col: 12 }] }) });
      } else if (r.kind === 'count') {
        const x = await App.api('Purchasing.count_details', { count_id: r.id }); if (seq !== App.navSeq) return; const c = x.count;
        const el = UI.drawer(UI.esc(c.count_ref), `${HMApproval.next(r)}
          ${UI.kv([['Request', 'Stock count adjustment (posting changes the stock)'], ['Status', UI.badge(c.status)], ['Part', `<b>${UI.esc(c.part_number)}</b> · ${UI.esc(c.description)}`],
            ['System / counted', UI.num(c.system_qty) + ' → ' + UI.num(c.counted_qty) + ' ' + UI.esc(c.unit)], ['Difference', `<b>${+c.variance > 0 ? '+' : ''}${UI.num(c.variance)}</b> · ${UI.money(Math.abs(+c.variance_value))}`],
            ['Reason', UI.e(c.reason)], ['Counted by', UI.esc(c.counted_by_name) + ' · ' + UI.datetime(c.counted_at)],
            c.reviewed_at ? ['Review', UI.esc(c.reviewed_by_name) + ' · ' + UI.datetime(c.reviewed_at) + (c.review_notes ? `<div class="cell-sub">${UI.esc(c.review_notes)}</div>` : '')] : null])}
          ${r.own ? '<div class="alert alert-secondary small py-2">You recorded this count, so another Admin must review it.</div>' : ''}
          ${UI.h('Evidence')}${UI.docs(x.documents, 'No evidence file attached.')}
          <div class="d-flex flex-wrap gap-2 mt-3" data-acts>${r.actionable && c.status === 'Submitted' ? UI.btn('post', 'Post adjustment', 'success', 'bi-check-lg') + UI.btn('reject', 'Reject count', 'outline-danger', 'bi-x-lg') : ''}
            ${UI.canGo(r.go) ? UI.btn('src', 'Open in Inventory', 'outline-secondary', 'bi-box-arrow-up-right') : ''}</div>`, { subtitle: 'Purchasing · stock count' });
        HMApproval.bind(el, r, { post: () => PurUI.countReview(c, 'post'), reject: () => PurUI.countReview(c, 'reject') });
      } else if (r.kind === 'route') {
        const el = UI.drawer(UI.esc(r.ref), `${HMApproval.next(r)}
          ${UI.kv([['Request','Route rate approval'],['Status',UI.badge(r.raw_status)],
            ['Route',UI.esc(r.summary)],['Requested by',UI.esc(r.requester || '—')+' · '+UI.datetime(r.submitted)],
            ['Proposed rate',UI.money(r.amount)]])}
          <div class="d-flex flex-wrap gap-2 mt-3" data-acts>
            ${r.actionable ? UI.btn('approve','Approve rate','success','bi-check-lg')+UI.btn('reject','Reject rate','outline-danger','bi-x-lg') : ''}
            ${UI.canGo(r.go) ? UI.btn('src','Open route records','outline-secondary','bi-box-arrow-up-right') : ''}
          </div>`,{subtitle:'Client & Commercial · route rate'});
        HMApproval.bind(el,r,{
          approve:()=>UI.confirmAction('Approve rate on '+UI.esc(r.ref),
            'The existing route approval workflow will validate client eligibility and the current rate version.',
            'Routes.decide',{rate_id:r.id,decision:'approve'}, {submit:'Approve'}),
          reject:()=>UI.confirmAction('Reject rate on '+UI.esc(r.ref),
            'The proposed rate will be rejected without activating it.',
            'Routes.decide',{rate_id:r.id,decision:'reject'},
            {danger:true,submit:'Reject',fields:[{name:'reason',label:'Reason',required:true,col:12}]})
        });
      } else {
        const x = await App.api('Billing.details', { billing_id: r.billing_id }); if (seq !== App.navSeq) return; const b = x.billing;
        const req = [...(x.requests || []), ...(x.charges || [])].find(ch => +ch.id === r.id) || {};
        const el = UI.drawer(UI.esc(r.ref), `${HMApproval.next(r)}
          ${UI.kv([['Request', UI.esc(r.type)], ['Status', UI.badge(r.raw_status)], ['Description', UI.e(req.description || r.summary)], ['Amount', `<b>${UI.money(r.amount)}</b>`],
            ['Reason', UI.e(req.reason)], ['Requested by', UI.esc(r.requester) + ' · ' + UI.datetime(r.submitted)], ['Billing total now', UI.money(b.total_amount)],
            r.decided_at ? ['Decision', UI.esc(r.decider || '') + ' · ' + UI.datetime(r.decided_at) + (r.notes ? `<div class="cell-sub">${UI.esc(r.notes)}</div>` : '')] : null])}
          ${r.own ? '<div class="alert alert-secondary small py-2">You requested this change, so another Admin must decide it.</div>' : ''}
          ${UI.h('Supporting documents')}${UI.docs(x.documents)}
          <div class="d-flex flex-wrap gap-2 mt-3" data-acts>${r.actionable ? UI.btn('approve', 'Approve', 'success', 'bi-check-lg') + UI.btn('reject', 'Reject', 'outline-danger', 'bi-x-lg') : ''}
            ${UI.canGo(r.go) ? UI.btn('src', 'Open billing record', 'outline-secondary', 'bi-box-arrow-up-right') : ''}</div>`, { subtitle: 'Billing · ' + UI.esc(r.type) });
        HMApproval.bind(el, r, {
          approve: () => UI.confirmAction('Approve request on ' + UI.esc(r.ref), 'The billing total changes when this request is approved.', 'Billing.charge_decide', { charge_id: r.id, decision: 'approve' },
            { submit: 'Approve', fields: [{ name: 'notes', label: 'Note (optional)', col: 12 }] }),
          reject: () => UI.confirmAction('Reject request on ' + UI.esc(r.ref), 'The billing total does not change. Billing is notified with your reason.', 'Billing.charge_decide', { charge_id: r.id, decision: 'reject' },
            { danger: true, submit: 'Reject', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] }) });
      }
    } catch (e) { UI.toast(e.message, 'error'); }
  },
  next: (r) => `<div class="ws-next ${r.status === 'Pending' ? '' : 'is-done'}"><i class="bi ${r.status === 'Pending' ? 'bi-arrow-right-circle' : 'bi-check-circle'}" aria-hidden="true"></i><div>
    <b>${r.status === 'Pending' ? (r.actionable ? 'Waiting for your decision' : 'Waiting for another Admin') : UI.esc(r.raw_status)}</b><div>${UI.esc(r.summary || '')}</div></div></div>`,
  bind(el, r, acts) {
    el.querySelectorAll('[data-acts] [data-act]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.act === 'src') { UI.closeDrawer(); return UI.goTo(r.go); }
      UI.closeDrawer(); acts[b.dataset.act]?.();
    }));
  },
};

App.page('admin_approvals', {
  title: 'Approvals',
  subtitle: 'Requests the existing workflow routes to Head Management for a decision.',
  render(ctx) {
    const d = ctx.data, q = ctx.query, all = Array.isArray(d.queue) ? d.queue : [];
    const types = [...new Set(all.map(r => r.type))].sort();
    const base = all.filter(r => !q.type || r.type === q.type);
    const TABS = [['pending', 'Pending', r => r.status === 'Pending'], ['decided', 'Decided (90 days)', r => r.status !== 'Pending'], ['all', 'All', () => true]];
    const tab = TABS.some(t => t[0] === q.tab) ? q.tab : 'pending';
    const rows = base.filter(TABS.find(t => t[0] === tab)[2]);
    ctx.el.innerHTML = UI.statusTabs(ctx.page, q, 'tab', TABS.map(([k, l, f]) => [k, l, base.filter(f).length]), tab)
      + UI.generalFilters(ctx, [{ name: 'type', label: 'Request types', options: types }])
      + `<div class="small text-muted mb-2">Only decisions the system assigns to the Admin appear here: purchase orders above the approval limit, stock count adjustments and billing charge requests.
         Purchase orders up to the limit are approved by Finance and trip funds by the Operations Head.</div>`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.innerHTML = UI.table([
      ['Reference', 'ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(r.summary || '')}</div>`],
      ['Request type', 'type'], ['Department', 'dept'], ['Requester', 'requester'], ['Submitted', 'submitted', 'date'],
      ['Amount', 'amount', 'money'], ['Status', 'status', 'badge'], ['Next', 'next', (v, r) => r.status === 'Pending' && r.actionable ? '<span class="badge-s amber">You (Admin)</span>' : UI.esc(v)]], rows,
      { showAllColumns: true, directActions: true, actions: (r) => UI.ibtn('view', r.actionable ? 'Review and decide' : 'View details', r.actionable ? 'bi-check2-square' : 'bi-eye', r.actionable ? 'outline-primary' : 'outline-secondary'),
        onAction: (a, r) => HMApproval.open(r), rowClick: (r) => HMApproval.open(r),
        empty: tab === 'pending' ? 'Nothing is waiting for an Admin decision.' : 'No request in this list.' });
    const once = UI.takeQuery(ctx, 'open');
    if (once.open) { const r = all.find(x => x.key === once.open); if (r) HMApproval.open(r); else UI.toast('That request is no longer in the queue.', 'warn'); }
  },
});

// ---------------------------------------------------------------- shared chart helper (Chart.js; one unit per chart)
HM.charts = [];
HM.destroyCharts = () => { HM.charts.forEach(ch => { try { ch.destroy(); } catch { /* gone */ } }); HM.charts = []; };
HM.DIV = { car_carrier_dispatcher: 'Car Carrier', container_wingvan_dispatcher: 'Container / Wing Van' };
/** Chart with click-to-popover. kind: line | bar | hbar | doughnut | stack. detail(i, dsIndex) -> popover html. */
HM.chart = (cv, kind, labels, datasets, opt = {}) => {
  if (!cv || typeof Chart === 'undefined') return null;
  const money = opt.money, fmt = money ? UI.money : (v) => UI.num(v);
  const isLine = kind === 'line', isDonut = kind === 'doughnut', horiz = kind === 'hbar' || kind === 'stack';
  const cfg = { type: isLine ? 'line' : isDonut ? 'doughnut' : 'bar',
    data: { labels, datasets: datasets.map((d, j) => ({ label: d.label, data: d.data, borderColor: d.color, backgroundColor: isDonut ? d.colors : d.color, borderWidth: isDonut ? 2 : (isLine ? 2 : 0),
      pointRadius: isLine ? (labels.length > 40 ? 2 : 3) : undefined, pointHoverRadius: isLine ? 6 : undefined, tension: 0, fill: false, borderRadius: isLine || isDonut ? 0 : 4, maxBarThickness: 34 })) },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: horiz ? 'y' : 'x', interaction: { mode: isLine ? 'index' : 'nearest', intersect: !isLine },
      scales: isDonut ? {} : { [horiz ? 'x' : 'y']: { beginAtZero: true, stacked: kind === 'stack', ticks: money ? { callback: (v) => UI.compactMoney(v) } : { precision: 0 }, title: { display: !!opt.axis, text: opt.axis } },
        [horiz ? 'y' : 'x']: { stacked: kind === 'stack', ticks: { autoSkip: true, maxRotation: 0 } } },
      plugins: { legend: { display: isDonut ? true : datasets.length > 1, position: isDonut ? 'right' : 'top', align: 'start', labels: { usePointStyle: true, pointStyle: isLine ? 'line' : 'rect', boxWidth: 14, boxHeight: isLine ? 3 : 10, padding: 12, font: { size: 12 } } },
        tooltip: { callbacks: { title: (it) => opt.titles ? opt.titles[it[0].dataIndex] : it[0].label, label: (it) => `${it.dataset.label || it.label}: ${fmt(it.raw)}` } } },
      onClick: (evt, els, ch) => { if (!opt.detail) return; const hit = isLine ? ch.getElementsAtEventForMode(evt, 'index', { intersect: false }, false) : els; if (hit.length) open(hit[0].index, hit[0].datasetIndex); } } };
  if (isDonut) cfg.options.cutout = '66%';
  const ch = new Chart(cv, cfg); HM.charts.push(ch);
  const rect = (i, j) => () => { const r = cv.getBoundingClientRect(), el = ch.getDatasetMeta(j || 0).data[i]; const x = el ? el.x : ch.chartArea.left, y = el ? el.y : ch.chartArea.top;
    return { left: r.left + x, right: r.left + x, top: r.top + y - 6, bottom: r.top + y + 6 }; };
  const open = (i, j) => { const html = opt.detail(i, j); if (html) UI.openPointPop(cv, rect(i, j), (opt.title || 'Details') + ': ' + labels[i], html); };
  let cur = -1;
  cv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cur = cur < 0 ? (e.key === 'ArrowRight' ? 0 : labels.length - 1) : Math.max(0, Math.min(labels.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      const act = datasets.map((_, j) => ({ datasetIndex: j, index: cur })); ch.setActiveElements(act); ch.tooltip.setActiveElements(act, { x: 0, y: 0 }); ch.update('none'); }
    if ((e.key === 'Enter' || e.key === ' ') && cur >= 0 && opt.detail) { e.preventDefault(); open(cur, 0); }
  });
  return ch;
};
HM.canvas = (id, label, h = 240) => `<div class="mr-chart" style="height:${h}px"><canvas id="${id}" tabindex="0" aria-label="${UI.esc(label)}. Arrow keys choose a value, Enter opens its details."></canvas></div>`;
HM.empty = (text) => `<div class="mo-empty hm-empty"><i class="bi bi-info-circle" aria-hidden="true"></i> ${UI.esc(text)}</div>`;
HM.pp = (title, rows, links) => `<div class="ws-pp-sec"><div class="ws-pp-h">${UI.esc(title)}</div><ul class="ws-pp-kv">${rows.map(([l, v]) => `<li><i style="background:transparent"></i><span>${UI.esc(l)}</span><b>${v}</b></li>`).join('')}</ul>
  ${links && links.length ? `<div class="ws-pp-links">${links.filter(([g]) => UI.canGo(g)).map(([g, l]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-go="${UI.esc(g)}">${UI.esc(l)}</button>`).join('')}</div>` : ''}</div>`;

// ---------------------------------------------------------------- Operations monitoring (read only)
App.page('admin_operations', {
  title: 'Operations Monitoring',
  subtitle: 'Trips, trips needing attention and fleet availability. Dispatch work stays in the Operations workspace.',
  render(ctx) {
    const d = ctx.data, q = ctx.query, g = d.groups || {};
    const trips = Array.isArray(d.trips) ? d.trips : [], fleet = Array.isArray(d.fleet) ? d.fleet : [], funds = d.funds || {}, att = d.attention || [];
    const groupOf = (t) => (g.active || []).includes(t.status) ? 'active' : (g.scheduled || []).includes(t.status) ? 'scheduled' : (g.exceptions || []).includes(t.status) ? 'exceptions' : t.status === 'Completed' ? 'completed' : 'other';
    const TABS = [['active', 'Active'], ['scheduled', 'Scheduled'], ['exceptions', 'On hold / reschedule'], ['completed', 'Completed (30 days)'], ['all', 'All']];
    const tab = TABS.some(t => t[0] === q.group) ? q.group : 'all';
    const cnt = (k) => k === 'all' ? trips.length : trips.filter(t => groupOf(t) === k).length;
    const tiles = [
      { label: 'Active trips', value: UI.num(cnt('active')), note: 'dispatched or in transit (now)', tone: 'gray', go: 'admin_operations?group=active' },
      { label: 'Scheduled / being prepared', value: UI.num(cnt('scheduled')), note: 'review to ready for dispatch', tone: 'gray', go: 'admin_operations?group=scheduled' },
      { label: 'On hold / reschedule', value: UI.num(cnt('exceptions')), note: 'trip exceptions (now)', tone: cnt('exceptions') ? 'red' : 'gray', go: 'admin_operations?group=exceptions' },
      { label: 'Completed (30 days)', value: UI.num(cnt('completed')), note: 'trips completed in the last 30 days', tone: 'gray', go: 'admin_operations?group=completed' },
    ];
    const total = fleet.reduce((a, r) => a + +r.n, 0);
    ctx.el.innerHTML = `${UI.kpiTiles(tiles, 'ws-kpi4')}
      <div class="ws-grid2 hm-fit">
        ${UI.wsPanel('Trips needing attention', 'bi-exclamation-octagon', att.length ? HM.list(att.map(t => HM.entry('trips?open=' + t.id, `<b>${UI.esc(t.trip_ref)}</b> <span class="mo-ref">${UI.esc(HM.DIV[t.dispatcher_role] || t.truck_type || '')}${t.dispatcher ? ' · ' + UI.esc(t.dispatcher) + (t.dispatcher_shift ? ' (' + UI.esc(t.dispatcher_shift) + ')' : '') : ''}</span>`,
          t.open_incident ? `Unresolved incident ${UI.esc(t.open_incident)}${t.incident_type ? ' · ' + UI.esc(t.incident_type) : ''}` : 'Status: ' + UI.esc(t.status), UI.badge(t.status))), '')
          : HM.empty('No trip is on hold, waiting for reschedule or resources, or linked to an unresolved incident.'), { cls: 'ws-l1', count: att.length })}
        ${UI.wsPanel('Fleet availability', 'bi-truck', HM.list(fleet.map(r => HM.entry('trucks?status=' + encodeURIComponent(r.status), `<b>${UI.esc(r.status)}</b>`,
          total ? Math.round(r.n / total * 100) + '% of ' + UI.num(total) + ' active trucks' : '', HM.pill(UI.num(r.n), 'gray'))), 'No active truck.'),
          { cls: 'ws-r1', foot: `Trip funds: ${UI.num(+funds.pending || 0)} awaiting the Operations Head · ${UI.num(+funds.to_release || 0)} ready for Finance to release.` })}
      </div>
      <h2 class="ref-h mt-3">Trips</h2>${UI.statusTabs('admin_operations', q, 'group', TABS.map(([k, l]) => [k, l, cnt(k)]), tab)}`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.innerHTML = UI.table([['Trip', 'trip_ref', (v, t) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(t.truck_type || '')}</div>`], ['Status', 'status', 'badge'], ['Client', 'client'], ['Truck', 'plate_number'],
      ['Dispatcher', 'dispatcher', (v, t) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(HM.DIV[t.dispatcher_role] || '')}${t.dispatcher_shift ? ' · ' + UI.esc(t.dispatcher_shift) : ''}</div>` : '<span class="text-muted">—</span>'],
      ['Route', 'pickup_point', (v, t) => `<span class="cell-clamp">${UI.esc(v || '')} → ${UI.esc(t.delivery_point || '')}</span>`], ['Scheduled', 'scheduled_at', 'datetime']],
      trips.filter(t => tab === 'all' || groupOf(t) === tab),
      { showAllColumns: true, directActions: true, actions: () => UI.ibtn('view', 'Trip details', 'bi-eye'), onAction: (a, t) => App.go('trips', { open: t.id }), rowClick: (t) => App.go('trips', { open: t.id }),
        empty: 'No trip in this list.' });
  },
});

// ---------------------------------------------------------------- Maintenance monitoring (read only)
App.page('admin_maintenance', {
  title: 'Maintenance Monitoring',
  subtitle: 'Repairs needing attention, truck maintenance status and repair records. Repair work stays with the Motorpool.',
  render(ctx) {
    const d = ctx.data, q = ctx.query, s = d.summary && !Array.isArray(d.summary) ? d.summary : {}, n = (k) => +s[k] || 0;
    const fleet = d.fleet && !Array.isArray(d.fleet) ? d.fleet : {}, inRepair = fleet.in_repair || [], jobs = d.jobs || [], att = d.attention || [];
    const st = (j) => j.status === 'Cancelled' ? 'cancelled' : j.verified_at ? 'returned' : j.status === 'Completed' ? 'verify' : 'open';
    const TABS = [['open', 'Open'], ['verify', 'Awaiting verification'], ['returned', 'Returned to service'], ['cancelled', 'Cancelled'], ['all', 'All (90 days)']];
    const tab = TABS.some(t => t[0] === q.state) ? q.state : 'open';
    const cnt = (x) => x === 'all' ? jobs.length : jobs.filter(j => st(j) === x).length;
    const tiles = [
      { label: 'Open repairs', value: UI.num(n('new_reports') + n('under_inspection') + n('under_repair') + n('for_verification')), note: `${n('new_reports')} new · ${n('under_inspection') + n('under_repair')} in progress (now)`, tone: 'gray', go: 'admin_maintenance?state=open' },
      { label: 'Awaiting verification', value: UI.num(n('for_verification')), note: 'repaired, still out of service', tone: n('for_verification') ? 'amber' : 'gray', go: 'admin_maintenance?state=verify' },
      { label: 'Waiting for parts', value: UI.num(att.filter(a => a.reason === 'parts').length), note: 'active repairs with an open parts request', tone: att.some(a => a.reason === 'parts') ? 'amber' : 'gray' },
      { label: 'Trucks under maintenance', value: UI.num(inRepair.length), note: fleet.active_trucks ? `of ${fleet.active_trucks} active trucks` : 'now', tone: inRepair.length ? 'amber' : 'gray', go: 'trucks?status=Under Maintenance' },
    ];
    ctx.el.innerHTML = `${UI.kpiTiles(tiles, 'ws-kpi4')}
      <div class="ws-grid2 hm-fit">
        ${UI.wsPanel('Repairs needing attention', 'bi-flag', att.length ? HM.list(att.map(a => HM.entry('maintenance?open=' + a.id, `<b>${UI.esc(a.job_ref)}</b> <span class="mo-ref">${UI.esc(a.plate_number)}</span>`,
          a.reason === 'verify' ? `Repaired ${UI.num(a.days)} day(s) ago, not yet verified: truck still out of service` : `Waiting for parts: ${UI.esc(a.requests || '')}`, HM.pill(a.reason === 'verify' ? 'Verification' : 'Parts', 'amber'))), '')
          : HM.empty('No repair is waiting for verification or for parts.'), { cls: 'ws-l1', count: att.length })}
        ${UI.wsPanel('Truck maintenance status', 'bi-truck', inRepair.length ? HM.list(inRepair.map(t => HM.entry('maintenance?open=' + t.job_id, `<b>${UI.esc(t.plate_number)}</b> <span class="mo-ref">${UI.esc(t.job_ref)} · ${UI.esc(t.truck_type || '')}</span>`,
          '', UI.badge(+t.awaiting_verification ? 'Awaiting verification' : t.status))), '') : HM.empty('Every active truck is in service.'), { cls: 'ws-r1', count: inRepair.length })}
      </div>
      <h2 class="ref-h mt-3">Repair records</h2>${UI.statusTabs('admin_maintenance', q, 'state', TABS.map(([x, l]) => [x, l, cnt(x)]), tab)}`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.innerHTML = UI.table([['Repair', 'job_ref', (v, j) => `<b>${UI.esc(v)}</b><div class="cell-sub">${j.source === 'Incident' ? 'Trip incident' : 'Garage report'}</div>`], ['Truck', 'plate_number', (v, j) => `${UI.esc(v)}<div class="cell-sub">${UI.esc(j.truck_type)}</div>`],
      ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`], ['Mechanic', 'mechanic', (v) => v ? UI.esc(v) : '<span class="text-muted">Not assigned</span>'],
      ['Status', 'status', (v, j) => UI.badge(j.verified_at ? 'Returned to service' : v === 'Completed' ? 'Awaiting verification' : v) + (+j.open_parts ? `<div class="cell-sub">${j.open_parts} parts request(s) open</div>` : '')],
      ['Reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date']], jobs.filter(j => tab === 'all' || st(j) === tab),
      { showAllColumns: true, directActions: true, actions: () => UI.ibtn('view', 'Repair details', 'bi-eye') + UI.ibtn('hist', 'Truck maintenance history', 'bi-clock-history'),
        onAction: (a, j) => a === 'hist' ? App.go('maint_history', { truck: j.plate_number }) : App.go('maintenance', { open: j.id }), rowClick: (j) => App.go('maintenance', { open: j.id }), empty: 'No repair in this list.' });
  },
});

// ---------------------------------------------------------------- Purchasing monitoring (read only)
App.page('admin_purchasing', {
  title: 'Purchasing Monitoring',
  subtitle: 'Purchase orders, purchasing issues and stock alerts. Stock changes stay in the Purchasing workflow.',
  render(ctx) {
    const d = ctx.data, q = ctx.query, orders = d.orders || [], req = d.requests || [], low = d.lowStock || [], iss = d.issues || [];
    const grp = (o) => o.status === 'Pending Approval' ? 'approval' : ['Approved', 'Partially Received'].includes(o.status) ? 'receive' : /^Rejected/.test(o.status) ? 'rejected' : 'done';
    const TABS = [['approval', 'Awaiting approval'], ['receive', 'To receive'], ['done', 'Received / closed'], ['rejected', 'Rejected'], ['all', 'All']];
    const tab = TABS.some(t => t[0] === q.po) ? q.po : 'all';
    const cnt = (x) => x === 'all' ? orders.length : orders.filter(o => grp(o) === x).length;
    const tiles = [
      { label: 'Requests to process', value: UI.num(req.filter(r => r.status === 'Requested').length), note: `${UI.num(req.filter(r => r.status !== 'Requested').length)} short of stock`, tone: 'gray', go: 'parts_requests?tab=todo' },
      { label: 'POs awaiting approval', value: UI.num(cnt('approval')), note: 'Finance (up to the limit) or Admin', tone: cnt('approval') ? 'amber' : 'gray', go: 'admin_purchasing?po=approval' },
      { label: 'POs to receive', value: UI.num(cnt('receive')), note: 'approved, delivery not complete', tone: 'gray', go: 'admin_purchasing?po=receive' },
      { label: 'Low-stock parts', value: UI.num(low.length), note: 'at or below the reorder level', tone: low.length ? 'red' : 'gray', go: 'inventory?stock=low' },
    ];
    ctx.el.innerHTML = `${UI.kpiTiles(tiles, 'ws-kpi4')}
      <div class="ws-grid2 hm-fit">
        ${UI.wsPanel('Purchasing issues requiring attention', 'bi-flag', iss.length ? HM.list(iss.map(x => HM.entry(x.go, `<b>${UI.esc(x.ref)}</b> <span class="mo-ref">${UI.esc(x.reason)}</span>`,
          `Next: ${UI.esc(x.next)}${x.since ? ' · since ' + UI.date(x.since) : ''}`, UI.badge(x.status))), '') : HM.empty('No budget-rejected order, stock shortage or ledger mismatch.'),
          { cls: 'ws-l1', count: iss.length, foot: 'Delivery delays are not listed: purchase orders record no expected delivery date.' })}
        ${UI.wsPanel('Low-stock alerts', 'bi-exclamation-triangle', low.length ? HM.list(low.map(p => HM.entry('inventory?open=' + p.id, `<b>${UI.esc(p.part_number)}</b> <span class="mo-ref">${UI.esc(p.description)}</span>`,
          `On hand ${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)} · reorder level ${UI.num(p.reorder_level)}`, HM.pill('Low', 'red'))), '') : HM.empty('No part is at or below its reorder level.'),
          { cls: 'ws-r1', count: low.length, tipHtml: HM.sug(d.partTips, 'No part is low on stock right now.') })}
      </div>
      <h2 class="ref-h mt-3">Purchase orders</h2>${UI.statusTabs('admin_purchasing', q, 'po', TABS.map(([x, l]) => [x, l, cnt(x)]), tab)}`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.innerHTML = UI.table([['PO', 'po_ref', (v, o) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(o.created_at)}</div>`], ['Supplier', 'supplier', (v) => `<span class="cell-clamp">${UI.esc(v || '')}</span>`],
      ['Total', 'total_amount', 'money'], ['Received', 'received_units', (v, o) => `${UI.num(v)} / ${UI.num(o.ordered_units)} units`], ['Status', 'status', 'badge'], ['Payment', 'payment_status', 'badge'],
      ['Approver', 'approver_role', (v) => v === 'admin' ? 'Admin' : 'Finance']], orders.filter(o => tab === 'all' || grp(o) === tab),
      { showAllColumns: true, directActions: true, actions: (o) => UI.ibtn('view', 'Purchase order details', 'bi-eye') + (+o.documents ? UI.ibtn('docs', o.documents + ' supporting document(s)', 'bi-paperclip') : '')
          + (o.status === 'Pending Approval' && o.approver_role === 'admin' ? UI.ibtn('decide', 'Review in Approvals', 'bi-check2-square', 'outline-primary') : ''),
        onAction: (a, o) => a === 'decide' ? App.go('admin_approvals', { open: 'po:' + o.id }) : App.go('purchase_orders', { open: o.id }), rowClick: (o) => App.go('purchase_orders', { open: o.id }),
        empty: 'No purchase order in this list.' });
    UI.bindTips(ctx.el);
  },
});

// ---------------------------------------------------------------- Financial oversight: weekly collection-funded budget
App.page('admin_finance', {
  title: 'Financial Oversight',
  subtitle: 'Weekly budget (previous week collections + unused budget carried forward), payables, commitments, receivables and collections.',
  render(ctx) {
    const d = ctx.data, wk = d.week || {}, pw = d.prevWeek || {}, w = d.weekly || {}, sg = d.suggestions || {}, mb = d.monthlyBudget && !Array.isArray(d.monthlyBudget) ? d.monthlyBudget : {};
    const prevCol = d.prevCollections || [], wkCol = d.weekCollections || [], pays = d.payments || [], com = d.commitments || [], pay = d.payables || [], poPay = d.poPayables || [], rec = d.receivables || [], dec = d.decisions || [];
    const sum = (rows, f) => rows.reduce((a, x) => a + +(typeof f === 'function' ? f(x) : x[f]), 0);
    const range = (r) => UI.date(r.from) + ' – ' + UI.date(r.to);
    const NA = '<span class="hm-na">Not established</span>';
    const shift = (n) => { const t = new Date(wk.from + 'T00:00:00'); t.setDate(t.getDate() + n * 7); return t.toISOString().slice(0, 10); };
    UI.tool(ctx, 'Next week', () => App.go('admin_finance', { week: shift(1) }), 'bi-chevron-right'); UI.tool(ctx, 'Previous week', () => App.go('admin_finance', { week: shift(-1) }), 'bi-chevron-left');
    const tiles = [
      { label: 'Previous week collections', value: UI.money(w.prev_collections), note: `Period total · ${range(pw)}`, tone: 'gray' },
      { label: 'Current week starting budget', value: w.starting_budget === null ? '—' : UI.money(w.starting_budget), note: w.starting_budget === null ? 'Not established: carry-forward not recorded' : 'collections + carry-forward', tone: w.starting_budget === null ? 'amber' : 'gray' },
      { label: 'Paid & committed', value: UI.money(w.paid_committed), note: `paid this week ${UI.money(w.payments)} · committed now ${UI.money(w.commitments)}`, tone: 'gray' },
      { label: 'Available budget', value: w.available === null ? '—' : UI.money(w.available), note: w.available === null ? 'Not established without a starting budget' : 'starting − paid − committed', tone: w.available === null ? 'amber' : (w.available < 0 ? 'red' : 'gray') },
    ];
    const totalKnown = (+w.payments || 0) + (+w.commitments || 0);
    const pct = (v) => totalKnown ? (v / totalKnown * 100).toFixed(1) : 0;
    const row = (key, label, value, note) => `<li class="hm-brow" data-hm="${key}" role="button" tabindex="0"><span>${UI.esc(label)}<small>${note}</small></span><b>${value}</b></li>`;
    const breakdown = `<ul class="hm-brk">
        ${row('carry', 'Previous week unused balance', NA, 'carry-forward (no recorded closing balance)')}
        ${row('prevcol', 'Previous week collections', UI.money(w.prev_collections), `${UI.num(prevCol.length)} client payment(s) · ${range(pw)}`)}
        ${row('alloc', 'Current week allocation', w.starting_budget === null ? NA : UI.money(w.starting_budget), '= unused balance + collections')}
        ${row('paid', 'Payments this week', UI.money(w.payments), `${UI.num(pays.length)} voucher(s) · ${range(wk)}`)}
        ${row('commit', 'Outstanding commitments', UI.money(w.commitments), `${UI.num(com.length)} approved PO(s) not yet paid (now)`)}
        ${row('avail', 'Available balance', w.available === null ? NA : UI.money(w.available), '= allocation − payments − commitments')}</ul>
      <div class="hm-stack" role="img" aria-label="Paid ${pct(w.payments)} percent, committed ${pct(w.commitments)} percent of the known amounts"><span class="m-spent" style="width:${pct(w.payments)}%"></span><span class="m-res" style="width:${pct(w.commitments)}%"></span></div>
      <div class="ws-legend"><span><i style="background:var(--blue)"></i>Paid ${UI.money(w.payments)}</span><span><i style="background:var(--amber)"></i>Committed ${UI.money(w.commitments)}</span>
        <span>${w.starting_budget === null ? 'Share of an allocation that is not recorded yet' : 'of ' + UI.money(w.starting_budget)}</span></div>`;
    const payTotal = sum(poPay, o => Math.max(0, +o.received_value - +o.paid_amount)) + sum(pay, 'balance');
    const recBal = sum(rec, 'balance');
    ctx.el.innerHTML = `<div class="ws-filters ws-period no-print" role="group" aria-label="Week"><label class="small" for="hmWeek">Week</label>
        <input id="hmWeek" type="date" class="form-control form-control-sm" value="${UI.esc(wk.from)}" aria-label="Any date in the week"><span class="small text-muted">${range(wk)} · Monday to Sunday, Philippine time</span></div>
      ${UI.kpiTiles(tiles, 'ws-kpi4')}
      <div class="ws-grid2 hm-fit">
        ${UI.wsPanel('Weekly budget breakdown', 'bi-piggy-bank', breakdown, { cls: 'ws-l1 hm-span2', tipHtml: HM.sug(sg.weekly || [], 'Weekly budget suggestions need a recorded starting budget; none is recorded yet.'),
          foot: 'A paid PO moves from committed to paid, so it is never counted twice. ' + (mb.id ? `Finance's separate monthly Purchasing budget (${UI.money(mb.amount)}, ${UI.date(mb.period_start)} – ${UI.date(mb.period_end)}, ${UI.money(mb.available)} available) is not the weekly budget.` : '') })}
        ${UI.wsPanel('Payables & commitments', 'bi-wallet2', HM.list([
            ...poPay.map(o => HM.entry('purchase_orders?open=' + o.id, `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`, `Payable: received ${UI.money(o.received_value)}, paid ${UI.money(o.paid_amount)} · no due date recorded`, `<b>${UI.money(Math.max(0, +o.received_value - +o.paid_amount))}</b>`)),
            ...pay.map(x => HM.entry('finance', `<b>${UI.esc(x.payable_ref)}</b> <span class="mo-ref">${UI.esc(x.payee || '')}</span>`, `Payable: due ${UI.date(x.due_on)}${+x.days_overdue > 0 ? ' · ' + x.days_overdue + ' day(s) overdue' : ''}`, `<b>${UI.money(x.balance)}</b>`)),
            ...com.filter(c => !poPay.some(o => o.id === c.id)).map(c => HM.entry('purchase_orders?open=' + c.id, `<b>${UI.esc(c.po_ref)}</b> <span class="mo-ref">${UI.esc(c.supplier || '')}</span>`, 'Commitment: approved, not yet received', `<b>${UI.money(c.reserved_amount)}</b>`)),
          ], 'No payable or commitment.'), { cls: 'ws-r1', tipHtml: HM.sug(sg.payables || [], 'No payable is past or near its recorded due date.'),
          foot: `<button type="button" class="btn btn-link btn-sm p-0" data-hm="payables">Payables due ${UI.money(payTotal)}</button> · current · ${dec.length ? `<button type="button" class="btn btn-link btn-sm p-0" data-hm="decisions">${dec.length} waiting for Finance approval or release (not payables)</button>` : 'nothing waiting for Finance'}${UI.canGo('finance') ? ' · <a href="#finance">Payables & payments</a>' : ''}` })}
        ${UI.wsPanel('Receivables & collections', 'bi-hourglass-split', HM.list([
            ...rec.map(x => HM.entry('billing_receivables', `<b>${UI.esc(x.invoice_number || x.trip_ref || '')}</b> <span class="mo-ref">${UI.esc(x.client)}</span>`, `Receivable: due ${UI.date(x.due_date)}${+x.days_overdue > 0 ? ' · ' + x.days_overdue + ' day(s) overdue' : ''}`, `<b>${UI.money(x.balance)}</b>`)),
            ...wkCol.map(c => HM.entry('billing_collections', `<b>${UI.esc(c.invoice_number || '')}</b> <span class="mo-ref">${UI.esc(c.client)}</span>`, `Collected ${UI.date(c.payment_date)}${c.ar_number ? ' · AR ' + UI.esc(c.ar_number) : ''}`, `<b>${UI.money(c.amount)}</b>`)),
          ], 'No open invoice and no collection this week.'), { cls: 'ws-r2', tipHtml: HM.sug(sg.receivables || [], 'Receivables need no follow-up under the current rules.'),
          foot: `<button type="button" class="btn btn-link btn-sm p-0" data-hm="receivables">Receivables ${UI.money(recBal)}</button> · current · collected this week ${UI.money(sum(wkCol, 'amount'))}${UI.canGo('billing_receivables') ? ' · <a href="#billing_receivables">Receivables</a>' : ''}` })}
      </div>`;
    UI.bindTips(ctx.el);
    ctx.el.querySelector('#hmWeek').addEventListener('change', (e) => { if (e.target.value) App.go('admin_finance', { week: e.target.value }); });
    const T = (cols, rows, empty) => UI.table(cols, rows, { plain: true, limit: 15, empty });
    const colCols = [['Date', 'payment_date', 'date'], ['Invoice', 'invoice_number'], ['Client', 'client'], ['Method', 'payment_method'], ['AR / reference', 'ar_number', (v, x) => UI.esc(v || x.reference_number || '—')], ['Amount', 'amount', 'money']];
    const open = {
      carry: () => HM.breakdown('Previous week unused balance', 'The weekly policy carries the unused budget of the previous week forward. No table or Finance step records a weekly allocation or its closing balance yet, so this amount cannot be established from the records. It is not estimated.', '', '', ''),
      prevcol: () => HM.breakdown('Previous week collections', `Client payments recorded with a payment date from ${range(pw)} (collections.payment_date).`, T(colCols, prevCol, 'No collection was recorded in the previous week.'), `Total of ${prevCol.length} collection(s)`, UI.money(w.prev_collections)),
      alloc: () => HM.breakdown('Current week allocation', 'Starting budget = previous week collections + previous week unused balance. The collections are known (' + UI.money(w.prev_collections) + '); the unused balance is not recorded, so the allocation is not established.', '', 'Allocation', 'Not established'),
      paid: () => HM.breakdown('Payments this week', `Cash paid out (disbursement vouchers) released from ${range(wk)}: purchase orders, trip funds and other payables.`,
        T([['Voucher', 'voucher_number'], ['Released', 'released_on', 'date'], ['For', 'source_ref', (v, x) => UI.esc((v || '') + ' (' + String(x.source_type).replace('_', ' ') + ')')], ['Payee', 'payee'], ['Method', 'payment_method'], ['Amount', 'amount', 'money']], pays, 'No payment this week.'), `Total of ${pays.length} voucher(s)`, UI.money(w.payments)),
      commit: () => HM.breakdown('Outstanding commitments', 'Current: approved purchase orders whose reserved amount is not yet paid. Paying a PO moves the paid amount out of this list into payments.',
        T([['PO', 'po_ref'], ['Supplier', 'supplier'], ['Approved', 'decided_at', 'date'], ['Status', 'status', 'badge'], ['Received', 'received_value', 'money'], ['Committed', 'reserved_amount', 'money']], com, 'Nothing is committed.'), `Total of ${com.length} PO(s)`, UI.money(w.commitments)),
      avail: () => HM.breakdown('Available balance', 'Available = allocation − payments this week − outstanding commitments. Payments ' + UI.money(w.payments) + ' and commitments ' + UI.money(w.commitments) + ' are known; the allocation is not established, so the available balance is not shown.', '', 'Available', 'Not established'),
      payables: () => HM.breakdown('Payables due', 'Current: received value of POs not yet paid (no due date is recorded on POs) and other payables (amount − paid). Requests still waiting for Finance approval are not payables.',
        UI.h('PO payables') + T([['PO', 'po_ref'], ['Supplier', 'supplier'], ['Received', 'received_value', 'money'], ['Paid', 'paid_amount', 'money'], ['Due', 'received_value', (v, o) => UI.money(Math.max(0, +v - +o.paid_amount))]], poPay, 'No PO payable.')
        + UI.h('Other payables') + T([['Payable', 'payable_ref'], ['Payee', 'payee'], ['Due on', 'due_on', 'date'], ['Status', 'status', 'badge'], ['Balance', 'balance', 'money']], pay, 'No other payable.'), 'Total due', UI.money(payTotal)),
      decisions: () => HM.breakdown('Waiting for Finance', 'Purchase orders waiting for Finance approval and approved trip funds waiting for release. These are decisions, not payable obligations; they are not included in any total above.',
        T([['Request', 'ref'], ['Type', 'kind'], ['Since', 'since', 'date'], ['Amount', 'amount', 'money']], dec, 'Nothing is waiting.'), 'Requests', UI.num(dec.length)),
      receivables: () => HM.breakdown('Receivables', 'Current: open invoices (Invoiced / Partially Paid), invoice total − paid.',
        T([['Invoice', 'invoice_number'], ['Client', 'client'], ['Due', 'due_date', 'date'], ['Status', 'status', 'badge'], ['Balance', 'balance', 'money']], rec, 'No open invoice.')
        + UI.h('Collected this week') + T(colCols, wkCol, 'No collection this week.'), 'Total receivable', UI.money(recBal)),
    };
    ['prevcol', 'alloc', 'paid', 'avail'].forEach((key, i) => { const el = ctx.el.querySelectorAll('.kpi-tile')[i]; if (el) el.dataset.hm = key; });
    HM.bindClicks(ctx.el, open);
  },
});

// ---------------------------------------------------------------- Executive reports: items requiring attention
// UNSUPPORTED_CLASSIFICATION_CLEANUP: no High / Medium priority, no "critical" count, no risk list. Items are grouped by
// workflow (waiting for Head Management, open department issues) and ordered by their recorded date.
App.page('admin_reports', {
  title: 'Executive Reports',
  subtitle: 'Items requiring attention, department performance and recent management decisions, from recorded statuses and dates.',
  render(ctx) {
    const d = ctx.data, items = d.items || [], perf = d.performance || [], recent = d.recent || [], w = d.weekly || {};
    const tiles = [
      { label: 'Waiting for your decision', value: UI.num(d.decisions), note: `${UI.num(d.waiting)} pending Head Management approval(s)`, tone: d.decisions ? 'amber' : 'gray', go: 'admin_approvals' },
      { label: 'Open issues', value: UI.num(d.open), note: 'open department issues by recorded status', tone: 'gray' },
      { label: 'Weekly financial position', value: w.available === null || w.available === undefined ? '—' : UI.money(w.available), note: w.available === null || w.available === undefined ? 'Not established: weekly allocation not recorded' : 'available this week', tone: 'gray', go: 'admin_finance' },
      { label: 'Past-due balances', value: UI.money(d.overdue), note: 'invoices and payables past their recorded due date', tone: 'gray', go: 'admin_finance' },
    ];
    const GROUPS = [['waiting', 'Waiting for Head Management'], ['issues', 'Open department issues']];
    const fmt = (p, v) => p.unit === 'money' ? UI.money(v) : UI.num(v);
    const finding = (p) => +p.now === 0 && +p.prev === 0 ? 'No recorded activity in either window' : +p.prev === 0 ? 'No activity in the previous window' : (+p.now >= +p.prev ? 'Up' : 'Down') + ' ' + Math.abs(Math.round((+p.now - +p.prev) / +p.prev * 100)) + '%';
    const row = (x) => `<tr><td><b>${UI.esc(x.ref)}</b></td><td>${UI.esc(x.issue)}</td><td>${UI.badge(x.status)}</td><td>${UI.esc(x.dept)}</td><td class="col-grow"><span class="cell-clamp">${UI.esc(x.reason)}</span></td><td>${UI.esc(x.next)}</td><td>${x.since ? UI.date(x.since) : '—'}</td>
      <td class="actions-col"><div class="row-icons">${UI.canGo(x.go) ? `<button type="button" class="btn btn-sm btn-${x.decide ? 'outline-primary' : 'outline-secondary'} icon-act" data-go="${UI.esc(x.go)}" title="${x.decide ? 'Review and decide' : 'Open source record'}" aria-label="${x.decide ? 'Review and decide ' : 'Open '}${UI.esc(x.ref)}"><i class="bi ${x.decide ? 'bi-check2-square' : 'bi-box-arrow-up-right'}"></i></button>` : ''}</div></td></tr>`;
    const body = GROUPS.map(([g, label]) => { const rows = items.filter(x => x.group === g);
      return `<tr class="hm-group"><th colspan="8">${UI.esc(label)} <span class="text-muted fw-normal">${UI.num(rows.length)}</span></th></tr>`
        + (rows.length ? rows.map(row).join('') : `<tr><td colspan="8" class="text-muted">${g === 'waiting' ? 'No approval is waiting for Head Management.' : 'No open department issue under the recorded statuses.'}</td></tr>`); }).join('');
    const waiting = items.filter(x => x.group === 'waiting' && x.decide);
    ctx.el.innerHTML = `${UI.kpiTiles(tiles, 'ws-kpi4')}
      <section class="panel ws-panel mb-3"><div class="panel-head"><h2 class="panel-title">Items requiring attention <span class="text-muted fw-normal">${UI.num(items.length)}</span></h2></div>
        <div class="panel-body flush"><div class="ref-tablebox"><table class="data-table hm-pri"><thead><tr><th>Reference</th><th>Item</th><th>Status</th><th>Department</th><th class="col-grow">Recorded reason</th><th>Next step</th><th>Date</th><th class="actions-col">Actions</th></tr></thead>
        <tbody>${body}</tbody></table></div></div><div class="ws-panel-foot">Grouped by workflow and ordered by the recorded date (oldest first). "Past due" uses each invoice's or payable's recorded due date.</div></section>
      <div class="ws-grid2 hm-fit">
        ${UI.wsPanel('Department performance', 'bi-bar-chart', `<ul class="hm-perf">${perf.map(p => `<li class="clickable" data-go="${UI.esc(p.go)}" role="link" tabindex="0"><span><b>${UI.esc(p.dept)}</b><small>${UI.esc(p.measure)}</small></span>
          <span class="hm-perf-v"><b>${fmt(p, p.now)}</b><small>last 30 days · previous ${fmt(p, p.prev)}</small></span><span class="hm-perf-f">${UI.esc(finding(p))}</span></li>`).join('')}</ul>`,
          { cls: 'ws-l1', foot: 'Each department in its own unit; values are never compared across departments.' })}
        ${UI.wsPanel('Recent management decisions', 'bi-clock-history', recent.length ? HM.list(recent.map(x => HM.entry(x.go, `<b>${UI.esc(x.ref)}</b> <span class="mo-ref">${UI.esc(x.type)}</span>`,
            `${UI.esc(x.decider || '')}${x.decider ? ' · ' : ''}${UI.datetime(x.decided_at)}`, UI.badge(x.status))), '')
          : HM.empty('No management decision was recorded in the last 90 days.'),
          { cls: 'ws-r1', count: recent.length, tipHtml: HM.sug(waiting.map(x => ({ text: `Review ${x.ref} (${x.issue}), waiting since ${UI.date(x.since)}.`, go: x.go, label: 'Review' })), 'No approval is waiting for you.') })}
      </div>`;
    UI.bindTips(ctx.el);
    const pr = document.createElement('button'); pr.className = 'btn btn-sm btn-outline-secondary'; pr.innerHTML = '<i class="bi bi-printer"></i> Print';
    pr.onclick = () => UI.print(`<h2>Executive Report</h2><div>${UI.datetime(new Date().toISOString())}</div>` + ctx.el.innerHTML); ctx.tools.append(pr);
  },
});

// Near-real-time analytics: one poller for the active Admin analytics route.
// It does not call App.route(), change the URL, or refresh the browser.
const AnalyticsAutoSync = {
  active: null,
  attach(ctx, renderPage) {
    const route = App.current;
    if (!route || route.page !== ctx.page || document.getElementById('pageBody') !== ctx.el) return;
    const token = JSON.stringify({page:ctx.page,query:ctx.query});
    let job = this.active;
    if (!job || job.route !== route || job.token !== token) {
      if (job?.timer) clearInterval(job.timer);
      job = {route,token,ctx,renderPage,last:JSON.stringify(ctx.data),updated:new Date(),busy:false,error:false,timer:null};
      this.active = job;
      job.timer = setInterval(() => this.poll(job), 30000);
    } else {
      job.ctx = ctx;
      job.renderPage = renderPage;
      job.last = JSON.stringify(ctx.data);
    }
    this.status(job);
  },
  status(job) {
    const el = job.ctx.el.querySelector('#ax-sync-status');
    if (!el) return;
    el.textContent = job.error ? 'Sync unavailable · showing last loaded data'
      : 'Auto-sync every 30s · Last checked ' + job.updated.toLocaleTimeString();
    el.setAttribute('role','status');
  },
  async poll(job) {
    if (this.active !== job || App.current !== job.route ||
        document.getElementById('pageBody') !== job.ctx.el) {
      clearInterval(job.timer);
      if (this.active === job) this.active = null;
      return;
    }
    if (job.busy || document.hidden || document.querySelector('.modal.show') ||
        (document.activeElement && job.ctx.el.contains(document.activeElement) &&
         /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) return;
    job.busy = true;
    try {
      const fresh = await App.data(job.ctx.page, job.ctx.query);
      if (this.active !== job || App.current !== job.route) return;
      const fingerprint = JSON.stringify(fresh);
      if (fingerprint !== job.last) {
        // Preserve the exact investigation, viewport and nested scroll positions.
        const root = job.ctx.el;
        const chosen = root.querySelector('#ax-evidence-details [data-incident-ref]')?.dataset.incidentRef;
        const scrollY = window.scrollY;
        const scrollers = [...root.querySelectorAll('*')].filter(n => n.scrollTop > 0)
          .map(n => ({id:n.id,cls:n.className,top:n.scrollTop,left:n.scrollLeft}))
          .filter(n => typeof n.cls === 'string' && (n.id || n.cls));
        job.ctx.data = fresh;
        await job.renderPage(job.ctx);
        if (chosen) {
          const rows = job.ctx._incidentEvidenceRows || [];
          const i = rows.findIndex(r => String(r.incident_ref) === chosen);
          const btn = i >= 0 ? job.ctx.el.querySelector('[data-ax-evidence="'+i+'"]') : null;
          if (btn) { job.restoring = true; btn.click(); job.restoring = false; }
        }
        scrollers.forEach(saved => {
          const node = saved.id ? root.querySelector('#'+CSS.escape(saved.id))
            : [...root.querySelectorAll('*')].find(n => n.className === saved.cls);
          if(node){node.scrollTop=saved.top;node.scrollLeft=saved.left;}
        });
        window.scrollTo(0,scrollY);
        job.last = fingerprint;
      }
      job.updated = new Date();
      job.error = false;
    } catch (e) {
      job.error = true;
      console.warn('Analytics background sync failed:',e);
    } finally {
      job.busy = false;
      if(this.active === job) this.status(job);
    }
  }
};

// ---------------------------------------------------------------- Head Admin analytics — Objective 5
// Descriptive: recorded totals and trends. Diagnostic: ranked patterns for review.
// The same server-validated reports feed the charts; no sample numbers or new actions.
['admin_analytics', 'admin_descriptive_analytics', 'admin_diagnostic_analytics'].forEach(analyticsPage => App.page(analyticsPage, {
  title: analyticsPage === 'admin_diagnostic_analytics' ? 'Diagnostic Analytics' : 'Descriptive Analytics',
  subtitle: 'Objective 5 · Company-wide historical reports and evidence-based analysis',
  render(ctx) {
    if (analyticsPage === 'admin_analytics') { App.go('admin_descriptive_analytics', ctx.query); return; }
    HM.destroyCharts();
    const diagnostic = analyticsPage === 'admin_diagnostic_analytics';
    const d = ctx.data || {}, q = ctx.query || {}, per = d.period || {};
    const topic = d.topic || 'operations', kind = d.reportKind || 'general';
    const report = d.reportData || {}, sections = report.sections || {};
    const trips = sections.trips || {}, fleet = sections.fleet || {}, money = sections.money || {};
    const areas = [['operations','Trip Operations','bi-signpost-split','5.1.1 / 5.2.1'],
      ['maintenance','Maintenance','bi-wrench-adjustable','5.1.2 / 5.2.2'],
      ['finance','Finance','bi-cash-stack','5.1.3 / 5.2.3'],
      ['purchasing','Inventory & Stock','bi-box-seam','5.1.4 / 5.2.4']];
    const selected = areas.find(x => x[0] === topic) || areas[0];
    const colors = ['#24794c','#4d91ba','#eba843','#bd7163','#7775ab','#64a99a'];
    const positive = values => (values || []).some(v => Number(v) !== 0 && Number.isFinite(Number(v)));
    const moneyFmt = val => UI.money(Number(val || 0));
    const cardValue = c => c.format === 'money' ? moneyFmt(c.value) : UI.num(Number(c.value || 0));
    const go = (next) => App.go(analyticsPage, Object.assign({}, q, next));
    const categoryGo = id => go({ topic: id, report: id === 'purchasing' ? 'purchasing' : 'general', entity: 'truck' });
    const escape = value => UI.esc(String(value == null ? '—' : value));
    const kpis = [];
    const chartJobs = [];
    const charts = [];
    const reportTable = (heading, columns, rows, limit) => {
      const safe = (rows || []).slice(0, limit || 10);
      return '<div class="ax-table-wrap"><h3>' + escape(heading) + '</h3><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr>'
        + columns.map(c => '<th scope="col">' + escape(c[0]) + '</th>').join('') + '</tr></thead><tbody>'
        + (safe.length ? safe.map(row => '<tr>' + columns.map(c => '<td>' + escape(typeof c[1] === 'function' ? c[1](row) : row[c[1]]) + '</td>').join('') + '</tr>').join('')
          : '<tr><td colspan="' + columns.length + '" class="text-muted">No recorded results for these filters.</td></tr>')
        + '</tbody></table></div></div>';
    };
    const recordTable = (s, title, limit) => {
      const table = (s.tables || []).find(t => t.title === title);
      if (!table) return '';
      return reportTable(title, table.columns.map(c => [c[0], c[1]]), table.rows || [], limit);
    };
    const cardsOf = (s, labels) => {
      const all = s.cards || [];
      labels.forEach(label => { const match = all.find(c => c.label === label); if (match) kpis.push(match); });
    };
    const value = (s, label) => Number(((s.cards || []).find(c => c.label === label) || {}).value || 0);
    const plot = (title, type, labels, datasets, opts) => {
      const rows = (labels || []).filter(x => x != null);
      const hasSeries = (datasets || []).some(ds => positive(ds.data));
      const chartId = 'ax-chart-' + chartJobs.length;
      if (rows.length && hasSeries) chartJobs.push(() => HM.chart(ctx.el.querySelector('#' + chartId), type, rows, datasets, opts || {}));
      else chartJobs.push(() => null);
      const amounts = type === 'doughnut' ? ((datasets || [])[0]?.data || []).map(v => Math.max(0, Number(v) || 0)) : [];
      const validIndices = amounts.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
      const totalValue = amounts.reduce((a, b) => a + b, 0);
      const single = type === 'doughnut' && validIndices.length === 1;
      // A full-circle doughnut with one nonzero category obscures the actual
      // comparison. Use a clear horizontal bar when only one category exists.
      if (rows.length && hasSeries && single) {
        chartJobs[chartJobs.length - 1] = () => HM.chart(ctx.el.querySelector('#' + chartId), 'hbar',
          [rows[validIndices[0]]], [{label:'Recorded value',data:[amounts[validIndices[0]]],color:colors[0]}],opts || {});
      }
      const body = rows.length && hasSeries ? HM.canvas(chartId, title, single ? 155 : 225) : HM.empty('No recorded values in the selected period.');
      let explanation = (opts || {}).note || '';
      if (type === 'doughnut' && hasSeries) {
        const ranked = validIndices.map(i => ({label:String(rows[i]),amount:amounts[i]})).sort((a,b)=>b.amount-a.amount);
        const totalText = (opts || {}).money ? UI.money(totalValue) : UI.num(totalValue);
        const leading = ranked.slice(0, 4).map(item => escape(item.label) + ': ' +
          ((item.amount / totalValue) * 100).toFixed(1) + '% (' +
          ((opts || {}).money ? UI.money(item.amount) : UI.num(item.amount)) + ')').join(' · ');
        explanation = (single
          ? 'Only one category has a positive recorded value, so a comparison bar is shown instead of a 100% ring. '
          : 'The chart shows each recorded category as a share of the total. ')
          + 'Recorded total: ' + totalText + '. ' + leading +
          (ranked.length > 4 ? ' · Other categories are available in the chart legend.' : '') +
          (explanation ? ' ' + escape(explanation) : '');
      } else {
        const generic = type === 'line' ? 'This chart shows how recorded values changed across the selected time buckets.'
          : type === 'hbar' ? 'This chart ranks recorded values by item so the largest contributors can be compared.'
          : type === 'stack' ? 'This chart compares stacked recorded contributions across the displayed groups.'
          : 'This chart compares the recorded values across the displayed groups.';
        explanation = generic + (explanation ? ' ' + escape(explanation) : '') +
          (diagnostic ? ' The chart identifies patterns and contributors, not a proven root cause.' : '');
      }
      const guide = explanation ? '<p class="ax-chart-explain"><strong>Why this chart?</strong> ' + explanation + '</p>' : '';
      charts.push('<div class="ax-chart-card">' + UI.wsPanel(title, 'bi-bar-chart-line',
        '<div class="ax-chart-inner">' + body + guide + '</div>', {}) + '</div>');
    };
    let supporting = '', note = '';
    const basic = (label, n, hint, format) => kpis.push({label, value: n, hint: hint || '', format: format || ''});

    if (kind === 'management') {
      const items = report.items || [], perf = report.performance || [];
      basic('Waiting for management', report.waiting || 0);
      basic('Open issues', report.open || 0);
      basic('Overdue balances', report.overdue || 0, 'Recorded outstanding balances past due date', 'money');
      plot('Department performance · last 30 days', 'bar', perf.map(p=>p.dept), [
        {label:'Last 30 days',data:perf.map(p=>Number(p.now)),color:colors[0]},
        {label:'Previous 30 days',data:perf.map(p=>Number(p.prev)),color:colors[1]}],
        {note:'Departments may use different units; compare each department to its own previous value.'});
      const byDept = {};
      items.filter(x => x.group === 'issues').forEach(x => { byDept[x.dept] = (byDept[x.dept] || 0) + 1; });
      plot('Recorded issues by department', 'hbar', Object.keys(byDept), [{label:'Issues',data:Object.values(byDept),color:colors[3]}]);
      supporting = reportTable('Management decisions and issues', [['Department','dept'],['Record','ref'],['Issue','issue'],['Recorded reason','reason'],['Next step','next']], items, 20);
      note = 'Management report: live workflow exceptions and 30-day performance. These are not automatic root-cause conclusions.';
    } else if (kind === 'audit') {
      const summary = report.summary || {}, byArea = summary.byArea || [], byUser = summary.byUser || [];
      basic('Audit events', summary.total || 0, 'Latest 20,000 event cap; check date range');
      basic('Areas with activity', byArea.length);
      basic('Users with activity', byUser.length);
      plot('Audit events by area', 'hbar', byArea.slice(0,10).map(x=>x.area), [{label:'Events',data:byArea.slice(0,10).map(x=>Number(x.n)),color:colors[0]}]);
      plot('Events with field changes by area', 'bar', byArea.slice(0,10).map(x=>x.area), [{label:'Field-change events',data:byArea.slice(0,10).map(x=>Number(x.changes)),color:colors[1]}]);
      supporting = reportTable('Audit activity by user', [['User','actor'],['Role','role'],['Events','n']], byUser, 20);
      note = 'Audit event volume is not a performance rating or evidence of wrongdoing.';
    } else if (topic === 'operations') {
      if (diagnostic) {
        // Incident reporting is an active workflow. Historical manual Delay
        // updates are NOT used as a primary diagnostic category.
        const evidence = d.incidentEvidence || {}, records = Array.isArray(evidence.records) ? evidence.records : [];
        const type = String(q.incident_type || '');
        const types = [...new Set(records.map(x=>String(x.incident_type || 'Not coded')))].sort();
        const counts = types.map(t=>records.filter(x=>String(x.incident_type || 'Not coded')===t).length);
        const selected = types.includes(type) ? type : '';
        const filtered = selected ? records.filter(x=>String(x.incident_type || 'Not coded')===selected) : records;
        const linked = filtered.filter(x=>x.job_id).length;
        const uniqueTrips = new Set(filtered.map(x=>String(x.trip_id))).size;
        basic('Recorded incidents', Number(evidence.total ?? records.length), 'Incident date within selected period');
        basic('Trips with incidents', uniqueTrips, 'Unique trips in current evidence view');
        basic('Linked repair records', linked, 'Explicit incident and trip relationship');
        plot('Recorded incidents by type', 'hbar', types, [{label:'Incidents',data:counts,color:colors[3]}],
          {note:'Click a category below to filter incident records. Multiple incidents may belong to the same trip.'});
        const filters = '<div class="ax-subfilter" role="group" aria-label="Filter incidents by recorded type">'
          + '<button type="button" class="btn btn-sm '+(!selected?'btn-success':'btn-outline-secondary')+'" data-ax-incident-type="">All types</button>'
          + types.map(t=>'<button type="button" class="btn btn-sm '+(t===selected?'btn-success':'btn-outline-secondary')+'" data-ax-incident-type="'+escape(t)+'">'+escape(t)+' ('+counts[types.indexOf(t)]+')</button>').join('')
          + '</div>';
        const tableRows = filtered.slice(0,100).map((r,i)=>'<tr><td>'+escape(r.incident_ref)+'</td><td>'+escape(r.incident_type)+'</td><td>'+escape(r.trip_ref)+'</td><td>'+escape(r.plate_number)+'</td><td>'+escape(r.incident_at)+'</td><td>'+escape(r.job_ref||'No linked repair')+'</td><td><button class="btn btn-sm btn-outline-success" type="button" data-ax-evidence="'+i+'">View evidence</button></td></tr>').join('');
        supporting = filters
          + '<section class="ax-table-wrap"><h3>Recorded incident evidence</h3>'
          + '<p class="small text-muted">Showing '+Math.min(filtered.length,100)+' of '+filtered.length+' loaded records. Date basis: incident date. '
          + (Number(evidence.total||0)>records.length?'The evidence list is limited to the latest 1,000 incidents for this period.':'')
          + '</p><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Incident</th><th>Type</th><th>Trip</th><th>Truck</th><th>Incident date</th><th>Linked job</th><th>Evidence</th></tr></thead><tbody>'
          + (tableRows||'<tr><td colspan="7" class="text-muted">No recorded incidents for these filters.</td></tr>')
          + '</tbody></table></div></section><div id="ax-evidence-details" aria-live="polite"></div>';
        // Page-local view model, never persisted or used in a mutation.
        ctx._incidentEvidenceRows = filtered.slice(0,100);
        note = '5.2.1 · Incident, trip and repair records are linked by stored IDs. An incident or repair is not automatically proof of the root cause of another event. No manual Delay category is inferred.';
      } else {
        cardsOf(trips,['Total trips','Completed trips','Cancelled trips','Trips for reschedule','Delivered units (car carrier)','Incidents']);
        const time = d.buckets || [], activity = d.activity || {};
        plot('Trip activity trend · created and completed', 'line', time.map(x=>x.short),
          [{label:'Created',data:activity.created||[],color:colors[0]}, {label:'Completed',data:activity.completed||[],color:colors[1]}],
          {note:'Activity dates are record creation/completion dates. Summary KPIs use trip scheduled dates.'});
        plot('Trips by current status', 'bar', (d.status||[]).map(x=>x.label),
          [{label:'Trips',data:(d.status||[]).map(x=>Number(x.n)),color:colors[0]}]);
        const byClient = ((trips.tables||[]).find(t=>t.title==='Per client')||{}).rows||[];
        plot('Trip volume by client', 'hbar', byClient.slice(0,9).map(x=>x.name),
          [{label:'Trips',data:byClient.slice(0,9).map(x=>Number(x.trips)),color:colors[1]}]);
        plot('Delivered units by client · car carrier', 'bar', byClient.slice(0,9).map(x=>x.name),
          [{label:'Units',data:byClient.slice(0,9).map(x=>Number(x.units)),color:colors[2]}]);
        supporting = recordTable(trips,'Trip records (delivery and return)',12);
        note = '5.1.1 · Scheduled-date trip totals, delivered car-carrier units, and recorded incidents.';
      }
    } else if (topic === 'maintenance') {
      const r = d.report || {}, tl = r.timeline || {}, buckets = r.buckets || [], top = (r.frequency||[]).slice(0,12);
      if (diagnostic) {
        const down = (((fleet.tables||[]).find(x=>x.title==='Highest downtime')||{}).rows||[]).slice(0,10);
        const expensive = (((fleet.tables||[]).find(x=>x.title==='Highest maintenance expenses')||{}).rows||[]).slice(0,10);
        basic('Trucks with downtime', down.filter(x=>Number(x.downtime_days)>0).length, 'Top 10 ranked trucks');
        basic('Trucks with recorded costs', expensive.length, 'Top 10 ranked trucks');
        plot('Highest truck downtime · days', 'hbar', down.map(x=>x.name),
          [{label:'Downtime (days)',data:down.map(x=>Number(x.downtime_days)),color:colors[3]}]);
        plot('Highest maintenance expenses · parts vs other', 'hbar', expensive.map(x=>x.name),
          [{label:'Parts',data:expensive.map(x=>Number(x.parts)),color:colors[0]},
           {label:'Other costs',data:expensive.map(x=>Number(x.other)),color:colors[2]}],
          {money:true,note:'Costs are drawn from released parts and recorded maintenance expenses.'});
        plot('Repeat repairs by truck', 'bar', top.map(x=>x.plate_number),
          [{label:'Repairs',data:top.map(x=>Number(x.repairs)),color:colors[1]}]);
        supporting = recordTable(fleet,'Highest downtime',10)+recordTable(fleet,'Highest maintenance expenses',10);
        note = '5.2.2 · Truck downtime uses status-history intervals; cost rankings reflect recorded parts and other expenses.';
      } else {
        cardsOf(fleet,['Maintenance records','Completed','Downtime (truck-days)','Maintenance expenses']);
        basic('Repairs reported', (tl.reported||[]).reduce((a,b)=>a+Number(b||0),0));
        basic('Trucks in repair frequency list',top.length);
        plot('Maintenance activity over time', 'line', buckets.map(x=>x.short),
          [{label:'Reported',data:tl.reported||[],color:colors[0]}, {label:'Completed',data:tl.completed||[],color:colors[1]}]);
        const costs = (r.cost||{}), cat = [{label:'Parts used',value:Number(costs.parts||0)}]
          .concat((costs.types||[]).map(x=>({label:x.type,value:Number(x.total)}))).filter(x=>x.value>0);
        plot('Maintenance expense composition','doughnut',cat.map(x=>x.label),
          [{label:'Cost',data:cat.map(x=>x.value),colors:colors}],{money:true,note:'Parts used reflects recorded parts costs; other expense types appear only when recorded for the selected dates.'});
        const down = (((fleet.tables||[]).find(x=>x.title==='Highest downtime')||{}).rows||[]).slice(0,10);
        plot('Recorded downtime by truck', 'hbar', down.map(x=>x.name),
          [{label:'Days',data:down.map(x=>Number(x.downtime_days)),color:colors[3]}]);
        supporting = recordTable(fleet,'Maintenance records',12);
        note = '5.1.2 · Activity, truck downtime and maintenance expenses from recorded repairs and vehicle status history.';
      }
    } else if (topic === 'finance') {
      if (diagnostic) {
        const overdue = (((money.tables||[]).find(x=>x.title==='Overdue accounts')||{}).rows||[]).slice(0,12);
        const aging = d.aging||[];
        basic('Outstanding receivables',value(money,'Outstanding receivables'),'All open invoices','money');
        basic('Overdue receivables',value(money,'Overdue'),'All invoices past recorded due date','money');
        basic('Overdue accounts',overdue.length,'Top 12 shown; see full records in Finance');
        plot('Receivables aging by due date','bar',aging.map(x=>x.label),
          [{label:'Balance',data:aging.map(x=>Number(x.value)),color:colors[1]}],{money:true});
        plot('Largest overdue invoices','hbar',overdue.map(x=>x.invoice_number||x.client),
          [{label:'Outstanding balance',data:overdue.map(x=>Number(x.balance)),color:colors[3]}],{money:true});
        plot('Payables grouped by due date','bar',(d.payDue||[]).map(x=>x.label),
          [{label:'Balance',data:(d.payDue||[]).map(x=>Number(x.value)),color:colors[2]}],{money:true});
        supporting = recordTable(money,'Overdue accounts',12)+recordTable(money,'Billing by client',12);
        note = '5.2.3 · Aging buckets and overdue rankings identify outstanding accounts, not causes of nonpayment.';
      } else {
        cardsOf(money,['Billed (invoices)','Collected','Expenses','Outstanding receivables']);
        basic('Overdue accounts balance',value(money,'Overdue'),'Current overdue balance','money');
        const financial = (money.charts||[]).find(x=>x.title==='Billed vs collected vs expenses');
        if(financial)plot('Billed amount vs collections vs expenses','bar',financial.labels,
          (financial.datasets||[]).map((x,i)=>({label:x.label,data:x.data,color:colors[i]})),{money:true});
        plot('Client collections by week','line',(d.weeks||[]).map(x=>x.label),
          [{label:'Collections',data:(d.weeks||[]).map(x=>Number(x.amount)),color:colors[0]}],{money:true});
        plot('Operating expense distribution','doughnut',(d.expenses||[]).map(x=>x.label),
          [{label:'Expenses',data:(d.expenses||[]).map(x=>Number(x.value)),colors:colors}],{money:true,note:'Expenses are grouped by their recorded expense category for the selected dates; unrecorded categories cannot be inferred.'});
        supporting = recordTable(money,'Billing by client',12);
        note = '5.1.3 · Billed, collected and expense amounts are separate accounting measures; they are not automatically net profit.';
      }
    } else {
      const purchase = d.report || {}, inventory = d.inventory || [], stock = d.stockSummary || {}, types = stock.movementTypes || [], parts = stock.perPart || [];
      const by = type => types.find(x=>x.type===type)||{};
      const used = (purchase.topUsed||[]).slice(0,12);
      if (diagnostic) {
        basic('Frequently used parts',used.length,'Top 12 ranked parts');
        basic('Parts with stock-out',parts.filter(x=>Number(x.stock_out)>0).length,'Within first 50 parts');
        plot('Most used parts by issued value','hbar',used.map(x=>x.part_number),
          [{label:'Value issued',data:used.map(x=>Number(x.value)),color:colors[0]}],{money:true});
        plot('Part use frequency · releases','bar',used.map(x=>x.part_number),
          [{label:'Releases',data:used.map(x=>Number(x.releases)),color:colors[1]}]);
        const shortage = (purchase.shortages||[]).slice(0,12);
        plot('Parts with requests not fully released','hbar',shortage.map(x=>x.part_number),
          [{label:'Requests',data:shortage.map(x=>Number(x.requests)),color:colors[3]}]);
        supporting = reportTable('Frequently used parts', [['Part','part_number'],['Unit','unit'],['Issued quantity','units'],['Issued value',x=>moneyFmt(x.value)],['Releases','releases']],used,12);
        note = '5.2.4 · Rankings by monetary value and issue frequency avoid adding incompatible item quantities.';
      } else {
        basic('Stock-in movements',Number(by('Stock In').movements||0),'Recorded stock-in events');
        basic('Stock-out movements',Number(by('Stock Out').movements||0),'Recorded stock-out events');
        basic('Adjustment movements',Number(by('Adjustment').movements||0),'Recorded adjustment events');
        basic('Inventory value',Number(stock.inventoryValue||0),'Current active parts at recorded unit cost','money');
        plot('Stock in vs stock out · value','line',(purchase.buckets||[]).map(x=>x.short),
          [{label:'Stock in',data:(purchase.flow||{}).in||[],color:colors[0]},
           {label:'Stock out',data:(purchase.flow||{}).out||[],color:colors[2]}],{money:true});
        plot('Inventory value by category · now','doughnut',inventory.map(x=>x.label),
          [{label:'Value',data:inventory.map(x=>Number(x.value)),colors:colors}],{money:true,note:'Current active inventory value is quantity on hand multiplied by recorded unit cost, grouped by Part Type. Unlike movement charts, this is a current snapshot, not a period total.'});
        plot('Movement value by type','bar',types.map(x=>x.type),
          [{label:'Value',data:types.map(x=>Number(x.value)),color:colors[1]}],{money:true});
        supporting = reportTable('Stock movements per part · quantities keep their own units',
          [['Part','part_number'],['Unit','unit'],['Stock-in','stock_in'],['Stock-out','stock_out'],['Net adjustment','adjustments'],['On hand','quantity_on_hand']],parts,15);
        note = '5.1.4 · Quantities are shown per part and unit; top metrics count movement records to avoid mixing units.';
      }
    }
    const metricHtml = '<div class="ax-kpis">' + kpis.map(c => '<div class="ax-kpi"><div class="ax-kpi-icon"><i class="bi '+escape(c.icon||'bi-graph-up')+'"></i></div><span>'+escape(c.label)+'</span><strong>'+ (c.format==='money'?moneyFmt(c.value):cardValue(c)) +'</strong><small>'+escape(c.hint||'From recorded data')+'</small></div>').join('') + '</div>';
    const focusHtml = '<div class="ax-categories">' + areas.map(a=>'<button type="button" class="ax-category '+(topic===a[0]?'active':'')+'" data-ax-topic="'+a[0]+'"><i class="bi '+a[2]+'"></i><span>'+a[1]+'</span><small>'+ (diagnostic?a[3].split(' / ')[1]:a[3].split(' / ')[0])+'</small></button>').join('') + '</div>';
    const baseQuery = 'topic='+encodeURIComponent(topic)+'&report='+encodeURIComponent(kind)+'&from='+encodeURIComponent(per.from||'')+'&to='+encodeURIComponent(per.to||'');
    const modeNav = '<div class="ax-mode-tabs"><a href="#admin_descriptive_analytics?'+baseQuery+'" class="'+(!diagnostic?'active':'')+'"><i class="bi bi-bar-chart-line"></i> Descriptive Analytics</a>'
      + '<a href="#admin_diagnostic_analytics?'+baseQuery+'" class="'+(diagnostic?'active':'')+'"><i class="bi bi-search"></i> Diagnostic Analytics</a></div>';
    const reportNav = '<div class="ax-report-nav"><span>Other consolidated reports:</span>'
      + [['management','Management'],['audit','Audit']].map(([id,name])=>'<a class="'+(kind===id?'active':'')+'" href="#'+analyticsPage+'?topic='+encodeURIComponent(topic)+'&report='+id+'&from='+encodeURIComponent(per.from||'')+'&to='+encodeURIComponent(per.to||'')+'">'+name+'</a>').join('')+'</div>';
    const visuals = '<div class="ax-charts">' + charts.join('') + '</div>';
    const css = '<style>'
      // The analytics card owns the full header, just like the other reports.
      // Hide the generic page heading so no empty band remains above the card.
      + '#pageContent:has(.ax-shell) > .page-head{display:none!important;}'
      + '.ax-shell{background:#f6f9f7;border:1px solid #e0e9e2;border-radius:16px;padding:20px;max-width:100%;}'
      + '.ax-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:15px;}'
      + '.ax-header h2{font-size:22px;font-weight:750;margin:4px 0 5px;letter-spacing:-.03em}.ax-header p{font-size:12px;color:#69786f;margin:0;max-width:750px;}'
      + '.ax-header-right{display:flex;align-items:flex-end;flex-direction:column;gap:9px;min-width:190px;}'
      + '#pageContent:has(.ax-shell) .ax-header-right .page-access-actions{display:flex;flex-direction:column;align-items:flex-end;gap:7px;margin:0;}'
      + '#pageContent:has(.ax-shell) .ax-header-right .page-access-tag{display:inline-flex;align-items:center;gap:6px;align-self:flex-end;margin:0;padding:6px 11px;border:1px solid #d6e9dd;border-radius:999px;background:#eaf6ee;color:#126c45;font-size:11px;font-weight:600;line-height:1.4;white-space:nowrap;}'
      + '#pageContent:has(.ax-shell) .ax-header-right .report-back-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;align-self:flex-end;padding:7px 12px;border:1px solid #c8dccf;border-radius:6px;background:#fff;color:#275d45;font-size:12px;font-weight:500;line-height:1.3;white-space:nowrap;box-shadow:none;}'
      + '#pageContent:has(.ax-shell) .ax-header-right .report-back-btn:hover{background:#f3f9f5;border-color:#9fc9ac;}'
      + '.ax-sync-meta{display:flex;align-items:center;justify-content:flex-end;gap:5px;color:#687c70;font-size:12px;white-space:normal;text-align:right;}'
      + '@media(max-width:650px){.ax-header-right{align-items:flex-start;width:100%;}#pageContent:has(.ax-shell) .ax-header-right .page-access-actions{align-items:flex-start;}#pageContent:has(.ax-shell) .ax-header-right .page-access-tag,#pageContent:has(.ax-shell) .ax-header-right .report-back-btn{align-self:flex-start;}.ax-sync-meta{text-align:left;justify-content:flex-start;}}'
      + '.ax-objective{display:inline-block;border-radius:20px;background:#e5f2e9;color:#207549;padding:5px 10px;font-size:11px;font-weight:650;}'
      + '.ax-mode-tabs{display:flex;gap:10px;border-bottom:1px solid #dfe7e2;margin:12px 0 18px;flex-wrap:wrap;}'
      + '.ax-mode-tabs a{padding:11px 13px;text-decoration:none;color:#63766a;font-size:13px;font-weight:650;border-bottom:3px solid transparent;}'
      + '.ax-mode-tabs a.active{color:#176d48;border-color:#176d48;}'
      + '.ax-filters{display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:12px;background:#fff;border:1px solid #e5ebe7;border-radius:11px;margin-bottom:16px;}'
      + '.ax-filters label{display:block;font-size:11px;font-weight:650;color:#536c60;margin-bottom:4px;}'
      + '.ax-filters input{max-width:170px}.ax-categories{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px;}'
      + '.ax-category{background:#fff;border:1px solid #dfe8e2;border-radius:12px;padding:15px 12px;display:flex;align-items:center;gap:8px;text-align:left;color:#496154;font-size:12px;font-weight:650;}'
      + '.ax-category .bi{font-size:17px;color:#27835b;}.ax-category small{margin-left:auto;color:#8b9d90;font-weight:500;}'
      + '.ax-category.active{border-color:#258553;box-shadow:0 0 0 1px #258553;background:#eff8f2;color:#145c3e;}'
      + '.ax-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px;}'
      + '.ax-kpi{background:#fff;border:1px solid #e0e8e3;border-radius:12px;padding:13px 16px;display:grid;grid-template-columns:auto 1fr;column-gap:9px;align-items:center;}'
      + '.ax-kpi-icon{grid-row:span 3;background:#eef7f1;border-radius:9px;color:#18794e;width:34px;height:34px;display:grid;place-items:center;}'
      + '.ax-kpi span{font-size:11px;color:#63776b;}.ax-kpi strong{font-size:23px;font-weight:750;line-height:1.25;color:#203d2c;overflow-wrap:anywhere;}'
      + '.ax-kpi small{font-size:10px;color:#849489;}.ax-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:18px;}'
      + '.ax-chart-card{min-width:0;}.ax-chart-card .ws-panel{height:100%;}.ax-caption{font-size:11px;color:#738377;margin:9px 0 0;}'
      + '.ax-chart-inner{display:grid;gap:12px;min-width:0;padding:2px 0 4px;}'
      + '.ax-chart-inner .mr-chart{width:100%;max-width:100%;min-width:0;overflow:hidden;}'
      + '.ax-chart-explain{margin:0;padding:10px 12px;background:#f7faf8;border:1px solid #e4ece6;border-radius:8px;color:#5d7164;font-size:11px;line-height:1.6;overflow-wrap:anywhere;}'
      + '.ax-chart-explain strong{color:#285840;font-weight:750;}'
      + '.ax-table-wrap{padding:16px;background:#fff;border:1px solid #e1e9e3;border-radius:12px;margin-top:12px;overflow:auto;}'
      + '.ax-table-wrap h3{font-size:14px;font-weight:700;color:#284634;margin:0 0 12px;}'
      + '.ax-table-wrap table{font-size:12px;}.ax-report-nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:22px;font-size:12px;color:#728078;}'
      + '.ax-report-nav a{padding:6px 11px;background:#fff;border:1px solid #dce6df;border-radius:16px;text-decoration:none;color:#287852;}'
      + '.ax-report-nav a.active{background:#1d754b;color:#fff}.ax-subfilter{display:flex;align-items:center;gap:10px;margin:12px 0;}'
      + '.ax-subfilter label{font-size:12px;white-space:nowrap}.ax-subfilter select{max-width:230px}.ax-note{font-size:11px;color:#708073;padding:10px 0 0;}'
      + '@media(max-width:950px){.ax-categories{grid-template-columns:repeat(2,1fr)}.ax-kpis{grid-template-columns:repeat(2,1fr)}}'
      + '@media(max-width:650px){.ax-shell{padding:12px}.ax-charts{grid-template-columns:1fr}.ax-category{font-size:11px}.ax-kpis{grid-template-columns:1fr 1fr}.ax-kpi strong{font-size:20px}.ax-mode-tabs a{font-size:12px}}'
      + '</style>';
    ctx.el.innerHTML = css + '<div class="ax-shell"><div class="ax-header"><div><span class="ax-objective">OBJECTIVE 5 · HEAD ADMIN ONLY</span>'
      + '<h2>'+(diagnostic?'Diagnostic':'Descriptive')+' Analytics · '+escape(kind==='management'?'Management Reports':kind==='audit'?'Audit Reports':selected[1])+'</h2>'
      + '<p>'+(diagnostic?'Investigate recurring issues, ranked contributors, receivables aging and part consumption.':'Recorded performance summaries, totals and trends by reporting period.')+'</p></div>'
      + '<div class="ax-header-right no-print"><div class="page-access-actions">'
      + '<span class="page-access-tag"><i class="bi bi-shield-check" aria-hidden="true"></i> <span>Management access</span></span>'
      + '<button type="button" class="btn btn-sm btn-outline-secondary report-back-btn" data-ax-back-reports>'
      + '<i class="bi bi-arrow-left" aria-hidden="true"></i> Back to Reports</button></div>'
      + '<div class="ax-sync-meta"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> <span id="ax-sync-status" class="small text-muted" aria-live="polite"></span></div></div></div>'
      + modeNav
      + '<div class="ax-filters"><div><label for="ax-from">From</label><input type="date" class="form-control form-control-sm" id="ax-from" value="'+escape(per.from||'')+'"></div>'
      + '<div><label for="ax-to">To</label><input type="date" class="form-control form-control-sm" id="ax-to" value="'+escape(per.to||'')+'"></div>'
      + '<button type="button" class="btn btn-success btn-sm" id="ax-apply">Apply dates</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" id="ax-month">This month</button>'
      + '<button type="button" class="btn btn-outline-secondary btn-sm" id="ax-quarter">Last 3 months</button>'
      + '</div>'
      + focusHtml + '<h3 class="h6 mb-3">'+escape(diagnostic?'Diagnostic findings':'Performance overview')+'</h3>'
      + metricHtml + visuals + supporting + '<p class="ax-note">'+escape(note)+'</p>' + reportNav + '</div>';
    ctx.el.querySelector('[data-ax-back-reports]')?.addEventListener('click', () => App.go('reports_center'));
    ctx.el.querySelectorAll('[data-ax-topic]').forEach(button => button.addEventListener('click',()=>categoryGo(button.dataset.axTopic)));
    ctx.el.querySelector('#ax-apply')?.addEventListener('click',()=>{
      const from=ctx.el.querySelector('#ax-from').value,to=ctx.el.querySelector('#ax-to').value;
      if(from && to && from<=to)go({from,to});else UI.toast('Choose a valid date range.','warning');
    });
    ctx.el.querySelector('#ax-month')?.addEventListener('click',()=>{
      const now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1);
      const iso=x=>[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
      go({from:iso(from),to:iso(now)});
    });
    ctx.el.querySelector('#ax-quarter')?.addEventListener('click',()=>{
      const now=new Date(),from=new Date(now.getFullYear(),now.getMonth()-2,1);
      const iso=x=>[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
      go({from:iso(from),to:iso(now)});
    });
    ctx.el.querySelector('#ax-entity')?.addEventListener('change',e=>go({entity:e.target.value}));
    ctx.el.querySelectorAll('[data-ax-incident-type]').forEach(button=>button.addEventListener('click',()=>{
      go({incident_type:button.dataset.axIncidentType||''});
    }));
    ctx.el.querySelectorAll('[data-ax-evidence]').forEach(button=>button.addEventListener('click',()=>{
      const row=(ctx._incidentEvidenceRows||[])[Number(button.dataset.axEvidence)];
      const target=ctx.el.querySelector('#ax-evidence-details');
      if(!row||!target)return;
      target.innerHTML='<section data-incident-ref="'+escape(row.incident_ref)+'" class="panel mt-3"><div class="panel-head"><h2 class="panel-title">Supporting record · '+escape(row.incident_ref)+'</h2></div><div class="panel-body">'
        +'<p class="small text-muted">Read-only snapshot of the recorded relationship. Review the source modules for full historical details.</p>'
        +'<dl class="row small"><dt class="col-sm-4">Incident type / status</dt><dd class="col-sm-8">'+escape(row.incident_type)+' · '+escape(row.incident_status)+'</dd>'
        +'<dt class="col-sm-4">Recorded problem</dt><dd class="col-sm-8">'+escape(row.problem)+'</dd>'
        +'<dt class="col-sm-4">Location</dt><dd class="col-sm-8">'+escape(row.location)+'</dd>'
        +'<dt class="col-sm-4">Trip / status</dt><dd class="col-sm-8">'+escape(row.trip_ref)+' · '+escape(row.trip_status)+'</dd>'
        +'<dt class="col-sm-4">Linked maintenance job</dt><dd class="col-sm-8">'+escape(row.job_ref||'None recorded')+'</dd>'
        +(row.job_id?'<dt class="col-sm-4">Repair status / problem</dt><dd class="col-sm-8">'+escape(row.job_status)+' · '+escape(row.repair_problem)+'</dd>':'')
        +'</dl><div class="d-flex flex-wrap gap-2"><button class="btn btn-sm btn-outline-success" type="button" data-ax-open-source="trips">Open Trip Management</button>'
        +(row.job_id?'<button class="btn btn-sm btn-outline-success" type="button" data-ax-open-source="maintenance">Open Repair Management</button>':'')
        +'</div></div></section>';
      target.querySelectorAll('[data-ax-open-source]').forEach(b=>b.addEventListener('click',()=>App.go(b.dataset.axOpenSource)));
      if (!AnalyticsAutoSync.active?.restoring) target.scrollIntoView({block:'nearest',behavior:'smooth'});
    }));

    chartJobs.forEach(job=>{try{job();}catch(err){console.error('Analytics chart error',err);}});
    // In the Operations diagnostic, clicking an incident-type bar opens its
    // filtered evidence list. The accessible category buttons work without a chart.
    if (diagnostic && topic === 'operations' && kind === 'general' && typeof Chart !== 'undefined') {
      const canvas=ctx.el.querySelector('#ax-chart-0');
      canvas?.addEventListener('click',event=>{
        const chart=Chart.getChart(canvas);
        if(!chart)return;
        const hits=chart.getElementsAtEventForMode(event,'nearest',{intersect:true},false);
        if(!hits.length)return;
        const types=[...new Set(((d.incidentEvidence||{}).records||[])
          .map(r=>String(r.incident_type||'Not coded')))].sort();
        const chosen=types[hits[0].index];
        if(chosen)go({incident_type:chosen});
      });
      if(canvas) { canvas.style.cursor='pointer'; canvas.setAttribute('aria-label','Incident types chart. Select a category using the filter buttons below the chart.'); }
    }

    AnalyticsAutoSync.attach(ctx, App.pages[analyticsPage].render);
  },
}));
