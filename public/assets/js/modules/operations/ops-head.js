/* Operations Head presentation. Existing modules and server authorization remain authoritative. */
'use strict';
const OpsHead = {
  is: () => UI.role('operations_head'),
  closed: ['Completed', 'Cancelled', 'Rejected'],
  groups: {
    pending: ['Pending Review'], awaiting: ['Awaiting Resources'], preparing: ['Pre-Assigned', 'Ready for Dispatch'],
    road: ['Dispatched', 'In Transit'], problems: ['On Hold - Incident Reported', 'For Reschedule'],
  },
  matches(t, group) { return !group || (group === 'arrival' ? !!+t.awaiting_arrival : (this.groups[group] || []).includes(t.status)); },
  datetime(v) {
    if (!v) return '—';
    const d = new Date(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(v) ? v.replace(' ', 'T') + '+08:00' : v);
    return Number.isNaN(+d) ? '—' : new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(d);
  },
  link(page, query = {}) { return '#' + page + (Object.keys(query).length ? '?' + new URLSearchParams(query) : ''); },
  panel(title, html, action = '') { return `<section class="oh-panel"><div class="oh-panel-head"><h2>${title}</h2>${action}</div><div class="oh-panel-body">${html}</div></section>`; },
  metrics(items) { return `<div class="oh-metrics">${items.map(([label, count, href]) => `<${href ? 'a' : 'div'} class="oh-metric" ${href ? `href="${UI.esc(href)}"` : ''}><span>${UI.esc(label)}</span><strong>${count == null ? 'Unavailable' : UI.num(count)}</strong>${href ? '<i class="bi bi-arrow-up-right" aria-hidden="true"></i>' : ''}</${href ? 'a' : 'div'}>`).join('')}</div>`; },
  bindTrips(el) { el.querySelectorAll('[data-oh-trip]').forEach(b => b.onclick = () => TripUI.open(b.dataset.ohTrip)); },
  search(el, draw, label = 'Search records') {
    el.innerHTML = `<label class="oh-search"><i class="bi bi-search" aria-hidden="true"></i><input class="form-control" type="search" aria-label="${UI.esc(label)}" placeholder="${UI.esc(label)}"></label><div data-list></div>`;
    const input = el.querySelector('input'); input.oninput = () => draw(input.value.trim().toLowerCase(), el.querySelector('[data-list]'));
    draw('', el.querySelector('[data-list]'));
  },
  dashboard(ctx) {
    ctx.setTitle('Dashboard', 'Operations overview and priority tasks.');
    UI.tool(ctx, 'Refresh', () => ctx.reload(), 'bi-arrow-clockwise', 'outline-secondary');
    const d = ctx.data;
    const tripLink = group => this.link('trips', group === 'pending' ? { view: 'approvals' } : { tab: 'active', group });
    const open = d.incidents?.open;
    ctx.el.innerHTML = this.metrics([
      ['Pending Trip Approvals', d.counts?.pending, tripLink('pending')], ['Awaiting Resources', d.counts?.awaiting, tripLink('awaiting')],
      ['Trips on the Road', d.counts?.road, tripLink('road')], ['Open Incidents', open, this.link('trips', { tab: 'incidents', incident: 'open' })],
    ]) + `<div class="oh-dashboard-grid">${this.panel("Today's Trip Schedule", d.schedule ?
      `<div class="table-responsive"><table class="data-table"><thead><tr><th>Trip / Client</th><th>Scheduled dispatch (PHT)</th><th>Truck type</th><th>Status</th></tr></thead><tbody>${d.schedule.map(t => `<tr><td><button class="btn btn-link p-0" data-oh-trip="${+t.id}">${UI.esc(t.trip_ref)}</button><div>${UI.esc(t.client)}</div></td><td>${this.datetime(t.scheduled_at)}</td><td>${UI.esc(t.truck_type)}</td><td>${UI.badge(t.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="table-empty">No trips scheduled today.</td></tr>'}</tbody></table></div>` : '<p role="alert">Schedule unavailable. Refresh to try again.</p>',
      '<a href="#trips?tab=active">View All</a>')}
      ${this.panel('Priority Actions', `<div class="oh-queues"><a href="${tripLink('pending')}">Review Trip Requests <b>${d.counts?.pending ?? '—'}</b></a><a href="#funds">Review Trip Fund Requests <b>${d.funds?.pending ?? '—'}</b></a><a href="#trips?tab=incidents&incident=open">Monitor Incidents <b>${open ?? '—'}</b></a></div>`)}
      ${this.panel('Fleet Availability', d.fleet ? `<dl class="oh-fleet">${[['Available', ['Available']], ['On Trip', ['On Trip']], ['Under Repair', ['Under Maintenance']], ['Assigned / Restricted / Unavailable', ['Assigned', 'Unavailable']]].map(([label, statuses]) => `<div><dt>${label}</dt><dd>${d.fleet.filter(x => statuses.includes(x.status)).reduce((n, x) => n + +x.count, 0)}</dd></div>`).join('')}</dl>` : '<p>Fleet data unavailable.</p>', '<a href="#trucks">Truck Masterlist</a>')}
      ${this.panel('Recent Activity', d.activity ? `<ul class="timeline">${d.activity.map(e => `<li><span class="when">${this.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</span><br><button class="btn btn-link p-0" data-oh-trip="${+e.trip_id}">${UI.esc(e.reference)}</button> · ${UI.esc(e.action)}</li>`).join('') || '<li>No operational activity recorded.</li>'}</ul>` : '<p>Activity unavailable.</p>')}</div>`;
    this.bindTrips(ctx.el);
  },

  trips(ctx) {
    if (ctx.query.view === 'approvals') return this.approvals(ctx);
    if (document.querySelector('.oh-approval-drawer')) { this._approvalSequence++; UI.closeDrawer(); }
    const d = TripUI.data = ctx.data, tab = ['active', 'history', 'incidents'].includes(ctx.query.tab) ? ctx.query.tab : 'active';
    if ((ctx.query.new || ctx.query.batch) && d.can.create) return this.planner(ctx);
    ctx.setTitle('Trip Management', 'Monitor, manage, and coordinate operational trips.');
    ctx.el.innerHTML = `<nav class="oh-tabs" aria-label="Trip Management tabs">${[['active', 'Active Trips'], ['history', 'Trip History'], ['incidents', 'Incidents']].map(([id, label]) => `<a href="#trips?tab=${id}" ${tab === id ? 'class="active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav><div data-workspace></div>`;
    const workspace = ctx.el.querySelector('[data-workspace]');
    if (tab === 'incidents') return this.incidents(workspace, d.incidents, ctx.query);
    const rows = d[tab];
    if (!Array.isArray(rows)) { workspace.innerHTML = '<div class="alert alert-warning" role="alert">Trip records are unavailable. Refresh this page to retry.</div>'; return; }
    const history = tab === 'history';
    const groups = history ? [['Completed', 'Completed'], ['Cancelled', 'Cancelled'], ['Rejected', 'Rejected']] : [['Pending Review', 'pending'], ['Awaiting Resources', 'awaiting'], ['Preparing', 'preparing'], ['On the Road', 'road'], ['Problems', 'problems'], ['Arrival Pending', 'arrival']];
    workspace.innerHTML = this.metrics(groups.map(([label, group]) => [label, rows.filter(t => history ? t.status === group : this.matches(t, group)).length, this.link('trips', { tab, ...(history ? { status: group } : { group }) })])) +
      `<form class="oh-filters" aria-label="Trip filters"><label class="oh-filter-wide">Search<input name="search" class="form-control" type="search" placeholder="Trip, client, route, truck" value="${UI.esc(ctx.query.q || '')}"></label><label>Status<select name="status" class="form-select"><option value="">All statuses</option>${(history ? this.closed : d.statuses || []).map(s => `<option ${ctx.query.status === s ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}</select></label><label>Client<select name="client" class="form-select"><option value="">All clients</option>${(d.filterOptions?.clients || []).map(c => `<option value="${+c.id}" ${String(ctx.query.client_id) === String(c.id) ? 'selected' : ''}>${UI.esc(c.company_name)}</option>`).join('')}</select></label><label>Truck Type<select name="type" class="form-select"><option value="">All types</option>${TripUI.truckTypeOptions().map(t => `<option ${ctx.query.truck_type === t ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select></label><label>Schedule From<input name="from" class="form-control" type="date" value="${UI.esc(ctx.query.from || '')}"></label><label>Schedule To<input name="to" class="form-control" type="date" value="${UI.esc(ctx.query.to || '')}"></label><label>Assigned Truck<select name="truck" class="form-select"><option value="">All trucks</option>${(d.filterOptions?.trucks || []).map(t => `<option value="${+t.id}" ${String(ctx.query.vehicle_id) === String(t.id) ? 'selected' : ''}>${UI.esc(t.plate_number)}</option>`).join('')}</select></label><button type="button" class="btn btn-outline-secondary" data-reset-filters>Reset Filters</button></form><div data-group-note></div><div data-trip-list></div>`;
    const filters = workspace.querySelector('form');
    filters.querySelectorAll('input,select').forEach(input => { if (!input.id) input.id = 'oh-trip-' + input.name; input.parentElement.htmlFor = input.id; });
    let page = 0;
    const draw = () => {
      const f = Object.fromEntries(new FormData(filters)), group = !history ? ctx.query.group : '';
      const filtered = rows.filter(t => (history || this.matches(t, group)) && (!f.status || t.status === f.status) && (!f.client || String(t.client_id) === f.client) && (!f.type || t.truck_type === f.type) && (!f.truck || String(t.vehicle_id) === f.truck) && (!f.from || String(t.scheduled_at).slice(0, 10) >= f.from) && (!f.to || String(t.scheduled_at).slice(0, 10) <= f.to) && [t.trip_ref, t.client, t.pickup_point, t.delivery_point, t.plate_number].join(' ').toLowerCase().includes(f.search.trim().toLowerCase()));
      workspace.querySelector('[data-group-note]').innerHTML = group ? `<p class="small">Monitoring group: <b>${UI.esc(groups.find(x => x[1] === group)?.[0] || group)}</b> · <a href="#trips?tab=active">Clear group</a></p>` : '';
      const size = 12, pages = Math.max(1, Math.ceil(filtered.length / size)); page = Math.min(page, pages - 1);
      const approvals = group === 'pending';
      const list = workspace.querySelector('[data-trip-list]');
      list.innerHTML = `<div class="table-responsive"><table class="data-table oh-trips-table"><thead><tr><th>Trip / Client</th><th>Route / Truck</th><th>${history ? 'Closure / Schedule' : 'Scheduled Dispatch (PHT)'}</th>${approvals ? '<th>Requested By</th>' : ''}<th>Status</th><th>Action</th></tr></thead><tbody>${filtered.slice(page * size, (page + 1) * size).map(t => `<tr><td data-label="Trip / Client"><b>${UI.esc(t.trip_ref)}</b><div>${UI.esc(t.client)}</div><small>${UI.esc(t.truck_type)}</small></td><td data-label="Route / Truck">${UI.esc(t.pickup_point)} → ${UI.esc(t.delivery_point)}<div class="cell-sub">${UI.esc(t.plate_number || 'Awaiting assignment')}</div></td><td data-label="${history ? 'Closure / Schedule' : 'Schedule'}">${history ? (t.completed_at ? this.datetime(t.completed_at) : 'Closure date not recorded') + '<div class="cell-sub">Scheduled: ' + this.datetime(t.scheduled_at) + '</div>' : this.datetime(t.scheduled_at)}</td>${approvals ? `<td data-label="Requested By">${UI.esc(t.created_by_name || '—')}</td>` : ''}<td data-label="Status">${UI.badge(t.status)}${+t.awaiting_arrival ? '<div class="badge-s amber">Arrival Pending</div>' : ''}</td><td data-label="Action"><button type="button" class="btn btn-sm btn-outline-success" data-oh-trip="${+t.id}">${approvals ? 'Review' : 'View'}</button></td></tr>`).join('') || `<tr><td colspan="${approvals ? 6 : 5}" class="table-empty">No trips match these filters.</td></tr>`}</tbody></table></div><div class="oh-pagination"><span>${filtered.length} result(s) · Page ${page + 1} of ${pages}${history ? ' · Up to 1,000 records loaded by the existing API' : ''}</span><div><button class="btn btn-sm btn-outline-secondary" data-prev ${page ? '' : 'disabled'}>Previous</button> <button class="btn btn-sm btn-outline-secondary" data-next ${page < pages - 1 ? '' : 'disabled'}>Next</button></div></div>`;
      list.querySelector('[data-prev]').onclick = () => { page--; draw(); }; list.querySelector('[data-next]').onclick = () => { page++; draw(); }; this.bindTrips(list);
    };
    filters.onsubmit = event => event.preventDefault();
    filters.oninput = filters.onchange = () => { page = 0; draw(); };
    filters.querySelector('[data-reset-filters]').onclick = () => App.go('trips', { tab });
    draw();
    if (ctx.query.open) TripUI.open(UI.takeQuery(ctx, 'open').open);
  },

  incidents(workspace, rows, query) {
    if (!Array.isArray(rows)) { workspace.innerHTML = '<p role="alert">Incident records are unavailable.</p>'; return; }
    const repair = i => i.job_status === 'Under Repair';
    workspace.innerHTML = this.metrics([['Open Incidents', rows.filter(i => i.status !== 'Resolved').length, '#trips?tab=incidents&incident=open'], ['Under Repair', rows.filter(repair).length, '#trips?tab=incidents&incident=repair'], ['Resolved', rows.filter(i => i.status === 'Resolved').length, '#trips?tab=incidents&incident=resolved']]) + '<div data-incidents></div>';
    this.search(workspace.querySelector('[data-incidents]'), (search, list) => {
      const filtered = rows.filter(i => (!query.incident || (query.incident === 'open' ? i.status !== 'Resolved' : query.incident === 'repair' ? repair(i) : i.status === 'Resolved')) && [i.incident_ref, i.trip_ref, i.plate_number, i.problem, i.details, i.location].join(' ').toLowerCase().includes(search));
      list.innerHTML = `<p class="small text-muted">${filtered.length} result(s) · Up to 300 records loaded${query.incident ? ' · <a href="#trips?tab=incidents">Show all incidents</a>' : ''}</p><div class="oh-incident-grid">${filtered.map(i => `<article class="oh-panel"><div class="oh-panel-head"><h3>${UI.esc(i.incident_ref)}</h3>${UI.badge(i.status)}</div><div class="oh-panel-body"><b>${UI.esc(i.problem || i.incident_type)}</b>${UI.kv([['Trip / Truck', UI.esc(i.trip_ref) + ' · ' + UI.esc(i.plate_number)], ['Location', UI.e(i.location)], ['Severity', UI.e(i.severity || 'Not assessed')], ['Trip Status', UI.badge(i.trip_status)], ['Maintenance', UI.esc(i.job_ref || 'Not yet linked') + (i.job_status ? ' · ' + UI.esc(i.job_status) : '')], ['Next Action', UI.esc(i.recommendation || (i.status === 'Reported' ? 'Await Maintenance assessment.' : i.status === 'Resolved' ? 'Resolved.' : 'Monitor maintenance coordination.'))]])}<button class="btn btn-sm btn-outline-success" data-incident="${+i.id}">View Details</button></div></article>`).join('') || '<div class="table-empty">No incidents match.</div>'}</div>`;
      list.querySelectorAll('[data-incident]').forEach(b => b.onclick = () => this.incident(rows.find(i => String(i.id) === b.dataset.incident)));
    }, 'Search incident, trip, truck, description or location');
  },
  incident(i) {
    const el = UI.drawer(UI.esc(i.incident_ref), this.panel('Incident & Maintenance Coordination', UI.kv([['Trip', UI.esc(i.trip_ref)], ['Truck', UI.esc(i.plate_number)], ['Problem', UI.e(i.problem)], ['Details', UI.e(i.details)], ['Location', UI.e(i.location)], ['Reported', this.datetime(i.incident_at)], ['Severity', UI.e(i.severity || 'Not assessed')], ['Incident Status', UI.badge(i.status)], ['Trip Status', UI.badge(i.trip_status)], ['Maintenance Record', UI.e(i.job_ref)], ['Repair Status', UI.e(i.job_status)], ['Recommendation', UI.e(i.recommendation)]]) + '<p class="small text-muted">Maintenance personnel perform repairs and clearance. Trip rescheduling follows the existing Dispatcher workflow.</p>') + `<button class="btn btn-primary" data-oh-trip="${+i.trip_id}">View Linked Trip</button> <button class="btn btn-outline-secondary" data-print-incident>Print Incident Report</button>`, { subtitle: UI.esc(i.plate_number) });
    this.bindTrips(el); el.querySelector('[data-print-incident]').onclick = () => TripUI.printIncident(i, {});
  },

  funds(ctx) {
    ctx.setTitle('Trip Fund Approvals', 'Review and approve dispatcher fund requests.');
    const rows = ctx.data.funds;
    if (!Array.isArray(rows)) { ctx.el.innerHTML = '<p role="alert">Fund requests are unavailable.</p>'; return; }
    const approved = f => ['Ready for Release', 'Released'].includes(f.status);
    ctx.el.innerHTML = this.metrics([['Pending', rows.filter(f => f.status === 'Pending Approval').length, '#funds?approval=pending'], ['Approved', rows.filter(approved).length, '#funds?approval=approved'], ['Rejected', rows.filter(f => f.status === 'Rejected').length, '#funds?approval=rejected']]) + `<nav class="oh-tabs" aria-label="Fund approval filters">${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All Requests']].map(([id, label]) => `<a href="#funds?approval=${id}" ${(ctx.query.approval || 'pending') === id ? 'class="active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav><div data-funds></div>`;
    this.search(ctx.el.querySelector('[data-funds]'), (search, list) => {
      const group = ctx.query.approval || 'pending';
      const filtered = rows.filter(f => (group === 'all' || (group === 'approved' ? approved(f) : f.status === (group === 'rejected' ? 'Rejected' : 'Pending Approval'))) && [f.fund_ref, f.trip_ref, f.requested_by_name, f.breakdown].join(' ').toLowerCase().includes(search));
      list.innerHTML = UI.table([['Request / Trip', 'fund_ref', (v, f) => `<b>${UI.esc(v)}</b><div>${UI.esc(f.trip_ref)}</div>`], ['Dispatcher', 'requested_by_name'], ['Expense Categories', 'breakdown'], ['Amount', 'amount', 'money'], ['Requested', 'created_at', v => this.datetime(v)], ['Approval', 'status', v => UI.badge(approved({status: v}) ? 'Approved' : v)], ['Finance Release', 'status', v => UI.esc(v === 'Released' ? 'Released' : v === 'Ready for Release' ? 'Awaiting Finance' : '—')]], filtered, { showAllColumns: true, actions: () => UI.btn('review', 'Review Details'), onAction: (a, f) => this.openFund(f.id), empty: 'No fund requests match.' });
      UI.activate(list);
    }, 'Search request, trip, dispatcher or expense category');
    if (ctx.query.open) this.openFund(UI.takeQuery(ctx, 'open').open);
  },
  async openFund(id) {
    let f;
    try { f = (await App.api('Funds.details', { fund_id: id })).fund; } catch (ex) { return UI.toast(ex.message, 'error'); }
    const canApprove = f.status === 'Pending Approval' && !this.closed.includes(f.trip_status);
    const el = UI.drawer(UI.esc(f.fund_ref), this.panel('Request Information', UI.kv([['Related Trip', UI.esc(f.trip_ref)], ['Requested By', UI.e(f.requested_by_name)], ['Request Date', this.datetime(f.created_at)], ['Amount', UI.money(f.amount)], ['Approval Status', UI.badge(['Ready for Release', 'Released'].includes(f.status) ? 'Approved' : f.status)], ['Finance Release', UI.e(f.status === 'Released' ? 'Released' : f.status === 'Ready for Release' ? 'Awaiting Finance' : null)], ['Notes / Justification', UI.e(f.notes)]])) + this.panel('Expense Breakdown', UI.table([['Category', 'category_name'], ['Amount', 'amount', 'money']], f.lines, { plain: true })) + this.panel('Approval History', (f.history || []).length ? `<ul class="timeline">${f.history.map(e => `<li>${UI.esc(e.action)}<br><small>${this.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</small></li>`).join('')}</ul>` : UI.kv([['Approved By', UI.e(f.approved_by_name)], ['Approved At', this.datetime(f.approved_at)], ['Rejection Reason', UI.e(f.rejected_reason)]])) + this.panel('Documents', UI.docs(f.documents)) + `<div class="oh-form-footer"><button class="btn btn-outline-secondary" data-related-trip>View Related Trip</button>${canApprove ? '<button class="btn btn-outline-danger" data-reject>Reject</button><button class="btn btn-primary" data-approve>Approve Request</button>' : ''}</div>`, { subtitle: UI.esc(f.trip_ref) });
    el.querySelector('[data-related-trip]').onclick = () => { UI.closeDrawer(); App.go('trips', { tab: 'active', open: f.trip_id }); };
    const decide = decision => UI.confirmAction(`${decision === 'approve' ? 'Approve' : 'Reject'} ${UI.esc(f.fund_ref)}`, decision === 'approve' ? `Approve ${UI.money(f.amount)}? Finance will handle release.` : 'Provide a reason for the dispatcher to revise this request.', 'Funds.decide', { fund_id: f.id, decision }, { submit: decision === 'approve' ? 'Approve' : 'Reject', danger: decision === 'reject', fields: decision === 'reject' ? [{ name: 'reason', label: 'Reason', required: true, col: 12, attrs: 'maxlength="300"' }] : [], after: () => { UI.closeDrawer(); App.route(); } });
    el.querySelector('[data-approve]')?.addEventListener('click', () => decide('approve'));
    el.querySelector('[data-reject]')?.addEventListener('click', () => decide('reject'));
  },

  routes(ctx) {
    ctx.setTitle('Client Routes', 'Manage client routes and route requests.');
    const d = ctx.data;
    if (d.can.request) UI.tool(ctx, 'Request New Route', () => RouteUI.request(d), 'bi-plus-lg', 'primary');
    if (!Array.isArray(d.routes)) { ctx.el.innerHTML = '<p role="alert">Routes are unavailable.</p>'; return; }
    const tab = ctx.query.tab === 'requests' ? 'requests' : 'approved';
    ctx.el.innerHTML = `<nav class="oh-tabs" aria-label="Client Routes tabs"><a href="${this.link('routes', { ...ctx.query, tab: 'approved' })}" ${tab === 'approved' ? 'class="active" aria-current="page"' : ''}>Approved Routes</a><a href="${this.link('routes', { ...ctx.query, tab: 'requests' })}" ${tab === 'requests' ? 'class="active" aria-current="page"' : ''}>Route Requests</a></nav><div data-routes></div>`;
    this.search(ctx.el.querySelector('[data-routes]'), (search, list) => {
      const rows = d.routes.filter(r => (tab === 'approved' ? r.status === 'Approved' : r.status !== 'Approved' || r.pending_rate_id) && [r.route_ref, r.client, r.truck_type, r.origin_label, r.destination_label, r.status].join(' ').toLowerCase().includes(search));
      const cols = [['Client', 'client'], ['Route', 'origin_label', (v, r) => `${UI.esc(r.origin_label)} → ${UI.esc(r.destination_label)}`], ['Truck Type', 'truck_type'], ...(tab === 'approved' ? [['Distance (km)', 'distance_km', 'num'], ['Recorded Approved Rate', 'rate_amount', (v, r) => RouteUI.rateText(r.rate_type, v, r.minimum_charge)]] : [['Request Date', 'requested_at', v => this.datetime(v)]]), ['Status', 'status', (v, r) => UI.badge(v) + (r.pending_rate_id && v === 'Approved' ? '<div class="small">Rate revision pending</div>' : '')]];
      list.innerHTML = UI.table(cols, rows, { showAllColumns: true, actions: () => UI.btn('view', 'View Details'), onAction: (a, r) => RouteUI.open(r.id, d), empty: 'No routes match.' }); UI.activate(list);
    }, 'Search client, truck type, route or status');
  },

  decorateTrip(el, r) {
    const t = r.trip, body = el.querySelector('.offcanvas-body');
    el.classList.add('oh-trip-drawer');
    el.querySelector('.offcanvas-header > div').insertAdjacentHTML('beforeend', UI.badge(t.status));
    el.querySelector('.btn-close').setAttribute('aria-label', 'Close Trip Details');
    const originalActions = body.querySelector('.drawer-actions');
    const sections = new Map();
    // Move the existing rendered sections so their authorized actions and event handlers survive.
    [...body.querySelectorAll('.drawer-h')].forEach(h => {
      const label = h.querySelector('span').textContent, fragment = document.createDocumentFragment();
      let node = h.nextSibling;
      while (node && !(node.nodeType === 1 && node.classList.contains('drawer-h'))) { const next = node.nextSibling; fragment.append(node); node = next; }
      const buttons = [...h.querySelectorAll('button')]; buttons.forEach(b => fragment.prepend(b));
      sections.set(label, fragment); h.remove();
    });
    const ins = r.inspections.find(i => +i.attempt_number === +t.attempt_number && i.kind === 'Pre-Dispatch');
    const arr = r.inspections.find(i => +i.attempt_number === +t.attempt_number && i.kind === 'Arrival');
    const fund = r.funds.find(f => +f.attempt_number === +t.attempt_number);
    const approved = !!t.approved_at;
    const dispatched = !!t.dispatched_at;
    const prepared = !!ins?.completed_at && !+ins.has_not_ok;
    const progress = t.status === 'Completed' ? 5 : dispatched ? 4 : prepared ? 3 : t.vehicle_id ? 2 : approved ? 1 : 0;
    const kv = UI.kv;
    const text = UI.e;
    body.innerHTML = this.panel('Trip Summary', kv([['Client', text(t.client)], ['Approved Route', text(t.client_route_ref || (t.client_route_id ? 'Linked route' : 'No approved route linked'))], ['Route', `${UI.esc(t.pickup_point)} → ${UI.esc(t.delivery_point)}`], ['Truck', text(t.plate_number)], ['Driver / Helper', [t.driver_name, t.driver2_name, t.helper_name].filter(Boolean).map(UI.esc).join(' · ') || '—'], ['Schedule (PHT)', this.datetime(t.scheduled_at)]])) +
      this.panel('Trip Progress', UI.steps(['Approved', 'Assigned', 'Prepared', 'Dispatched', 'Completed'], progress, { compact: true, warn: ['For Reschedule', 'On Hold - Incident Reported', 'Cancelled', 'Rejected'].includes(t.status) }) + `<p class="small mb-0">Official status: ${UI.badge(t.status)}</p><p class="small text-muted">${UI.esc(TripUI.next(t))}</p>`) +
      this.panel('Operational Readiness', kv([['Trip Request Approval', t.status === 'Rejected' ? 'Rejected' : approved ? 'Approved' : t.status === 'Cancelled' ? 'Cancelled' : 'Pending Review'], ['Truck & Crew Assignment', t.status === 'Completed' ? 'See recorded truck and crew below' : t.vehicle_id && t.driver_id && (t.truck_type === 'Car Carrier' ? t.driver2_id : t.helper_id) ? 'Assigned' : 'Incomplete / awaiting resources'], ['Trip Fund', fund ? UI.badge(fund.status) : (+t.attempt_number > 1 ? 'No new request (optional for redispatch)' : 'Not requested')], ['Pre-Dispatch Checklist', ins ? (prepared ? 'Completed' : 'NOT OK / incomplete') : 'Not completed'], ['Dispatch', dispatched ? this.datetime(t.dispatched_at) : 'Not dispatched'], ['Arrival Checklist', t.status === 'Completed' ? (+t.awaiting_arrival ? (arr ? 'Recorded; clearance pending' : 'Pending') : arr ? 'Recorded' : 'Not recorded') : 'Not yet applicable']])) + '<div data-trip-sections></div>';
    const content = body.querySelector('[data-trip-sections]');
    const append = (title, html, open = false) => {
      const details = document.createElement('details'); details.className = 'oh-detail-section'; details.open = open;
      const summary = document.createElement('summary'); summary.textContent = title; details.append(summary);
      const inner = document.createElement('div'); inner.className = 'oh-detail-body';
      if (typeof html === 'string') inner.innerHTML = html; else if (html) inner.append(html);
      details.append(inner); content.append(details); return details;
    };
    append('Trip Overview', kv([['Reference', text(t.trip_ref)], ['Client', text(t.client)], ['Truck Type', text(t.truck_type)], ['Requested By', text(t.created_by_name)], ['Created', this.datetime(t.created_at)], ['Official Status', UI.badge(t.status)], t.cancel_reason ? ['Cancellation / Rejection Reason', text(t.cancel_reason)] : null]), true);
    const route = append('Route & Schedule', kv([['Approved Route', text(t.client_route_ref)], ['Pickup', text(t.pickup_point)], ['Delivery', text(t.delivery_point)], ['Dispatch Schedule (PHT)', this.datetime(t.scheduled_at)], ['Billable Distance', UI.num(t.distance_km, 2) + ' km'], ['Distance Source', text(t.distance_source)], ['Computed Distance', t.distance_computed_km ? UI.num(t.distance_computed_km, 2) + ' km' : '—'], ['Override Reason', text(t.distance_override_reason)], ['Checklist Opens', this.datetime(t.time_gates?.checklist_opens_at)], ['Dispatch Opens', this.datetime(t.time_gates?.dispatch_opens_at)]]));
    const savedMap = sections.get('Trip')?.querySelector?.('[data-routemap]');
    if (savedMap) { route.querySelector('.oh-detail-body').append(savedMap); route.addEventListener('toggle', () => window.dispatchEvent(new Event('resize'))); }
    append('Shipment & Delivery', kv([['Instructions', text(t.delivery_details)], ['Booking Reference', text(t.booking_reference)], ['Consignee', text(t.consignee)], ...(t.truck_type === 'Car Carrier' ? [['Cargo Units', text(t.units_planned)]] : [['Shipment Number', text(t.shipment_number)]]), ...(t.truck_type === 'Container' ? [['Container Number', text(t.container_number)], ['Container Size', text(t.container_size)], ['Seal Number', text(t.seal_number)]] : [])]));
    append('Truck & Crew', kv([['Truck', text(t.plate_number)], ['Vehicle Status', UI.badge(t.truck_status)], ['Driver', text(t.driver_name)], ['Second Driver', text(t.driver2_name)], ['Helper', text(t.helper_name)], ['Dispatcher', text(t.dispatcher_name)], ['Team', text(UI.label(t.dispatcher_role))], ...(t.dispatcher_shift ? [['Planning Dispatcher Shift', text(t.dispatcher_shift)]] : []), ['Attendance Mode', text(t.crew_attendance?.mode)], ['Attendance Shift', text(t.crew_attendance?.dispatch_shift)]]) + (t.crew_attendance?.crew || []).map(c => `<p class="small">${UI.esc(c.role)} · ${UI.esc(c.full_name || c.name || '')}: ${UI.esc(c.issue || 'Present')}${c.problem ? ' · ' + UI.esc(c.problem) : ''}${c.outside_scheduled_shift ? ' · Outside scheduled shift' : ''}</p>`).join('') + (t.crew_attendance?.missing || []).map(x => `<p class="text-danger small">${UI.esc(x)}</p>`).join(''));
    const funds = append('Trip Funds & Fuel', sections.get('Fund request'));
    funds.querySelector('.oh-detail-body').insertAdjacentHTML('beforeend', kv([['Estimated Fuel Cost', t.fuel_estimate ? UI.money(t.fuel_estimate) : '—']]));
    if (fund) { const b = document.createElement('button'); b.className = 'btn btn-sm btn-outline-success'; b.textContent = 'View Fund Request'; b.onclick = () => this.openFund(fund.id); funds.querySelector('.oh-detail-body').append(b); }
    append('Pre-Dispatch Checklist', [...sections].find(([key]) => key.startsWith('Pre-dispatch checklist'))?.[1]);
    append('Dispatch & Progress', sections.get('Updates and delays'));
    const incidents = append('Incidents & Maintenance', sections.get('Incidents') || '<p>No incidents recorded.</p>'); incidents.dataset.incidentSection = '';
    const completion = append('Completion & Arrival', sections.get('Completion') || '<p>Trip is not completed.</p>');
    if (sections.get('Arrival checklist')) completion.querySelector('.oh-detail-body').append(sections.get('Arrival checklist'));
    append('Documents', sections.get('Documents'));
    append('Activity Timeline', sections.get('History'));
    if (originalActions) body.prepend(originalActions);
    // Move one existing authorized action to a fixed footer; moving preserves its listener.
    const primary = originalActions?.querySelector('button:not([disabled])');
    el.querySelector('.oh-drawer-footer')?.remove();
    const footer = document.createElement('div'); footer.className = 'oh-drawer-footer';
    if (primary) { primary.className = 'btn btn-primary'; footer.append(primary); }
    else { const close = document.createElement('button'); close.className = 'btn btn-outline-secondary'; close.textContent = 'Close Details'; close.onclick = () => UI.closeDrawer(); footer.append(close); }
    el.append(footer);
  },

  crew(ctx) {
    const d = ctx.data;
    if (d.can.edit) UI.tool(ctx, 'Add Driver or Helper', () => FleetUI.crewForm({}), 'bi-plus-lg', 'primary');
    ctx.el.innerHTML = '<form class="oh-filters"><label>Personnel Type<select name="type" class="form-select"><option value="">All personnel</option><option>Driver</option><option>Helper</option></select></label><label>Availability<select name="availability" class="form-select"><option value="">All availability</option><option>Available</option><option>On Trip</option><option>Unavailable</option></select></label><label>Records<select name="records" class="form-select"><option value="active">Active</option><option value="all">Include inactive</option></select></label></form><p class="small text-muted">Attendance readiness refers to the current shift only; trip dispatch applies its own checks.</p><div data-crew></div>';
    if (!Array.isArray(d.crew)) { ctx.el.innerHTML = '<p role="alert">Personnel records are unavailable.</p>'; return; }
    const filters = ctx.el.querySelector('form'), box = ctx.el.querySelector('[data-crew]');
    const render = () => {
      const f = Object.fromEntries(new FormData(filters));
      const rows = d.crew.filter(p => (f.records === 'all' || +p.active) && (!f.type || p.person_type === f.type) && (!f.availability || p.availability === f.availability));
      box.innerHTML = UI.table([['Name', 'full_name'], ['Type', 'person_type'], ['Assigned Truck', 'regular_truck'], ['Duty Shift', 'duty_shift'], ['Attendance Readiness', 'id', (v, p) => !d.attendance ? 'Unavailable' : !p.duty_shift ? 'Shift unassigned' : p.duty_shift !== d.attendanceContext?.shift ? 'Off current shift' : UI.badge(d.attendance.find(a => +a.personnel_id === +p.id)?.status || 'Not Yet Marked')], ['Availability', 'availability', 'badge'], ['License Expiry', 'license_expiry', 'date']], rows, { showAllColumns: true, actions: () => UI.btn('view', 'View Details'), onAction: (a, p) => FleetUI.crewDetails(p.id, d), empty: 'No personnel match.' }); UI.activate(box);
    };
    filters.onsubmit = event => event.preventDefault(); filters.onchange = render; render();
  },

  planner(ctx) {
    ctx.setTitle('New Trip', 'Create and schedule one or multiple trips.');
    let entries = [], drafts = [], busy = false, attempted = false, uncertain = false;
    const recoveryKey = `fleetops:operations-planning:${App.me.user.id}`;
    const remember = () => {
      try {
        if (drafts.length && drafts.every(x => x.result?.trip_id)) sessionStorage.removeItem(recoveryKey);
        else sessionStorage.setItem(recoveryKey, JSON.stringify({ entries: entries.map(({id, data, route}) => ({id, data, route, routes: route ? [route] : [], seq: 0, loading: false})), drafts, attempted, uncertain }));
      } catch { /* In-memory request keys still protect retries in this page. */ }
    };
    const clients = ctx.data.clients || [];
    const clientName = id => clients.find(c => String(c.id) === String(id))?.company_name || 'Choose client';
    const dispatcherOptions = type => !['Car Carrier','Container','Wing Van'].includes(type) ? [] : ['Day','Night'].map(shift => [`${type === 'Car Carrier' ? 'car_carrier_dispatcher' : 'container_wingvan_dispatcher'}:${shift}`, `${type === 'Car Carrier' ? 'Car Carrier' : 'Container / Wing Van'} Dispatcher (${shift})`]);
    const dispatcherName = data => dispatcherOptions(data.truck_type).find(([key]) => key === data.dispatcher_assignment)?.[1] || 'Choose dispatcher';
    const total = () => entries.reduce((n, e) => n + (+e.data.quantity || 0), 0);
    const error = message => { const box = ctx.el.querySelector('[data-plan-error]'); box.textContent = message; box.hidden = !message; };
    const update = () => {
      ctx.el.querySelector('[data-total]').textContent = `Total Required Trucks: ${total()}`;
      ctx.el.querySelector('[data-entry-count]').textContent = `Planning Entries: ${entries.length}. Individual Trip Records to Create: ${total()}. Each generated trip will have its own record and resource assignment.`;
      ctx.el.querySelector('[data-add]').disabled = total() >= 20 || busy;
      entries.forEach((e, i) => {
        const card = ctx.el.querySelector(`[data-entry="${e.id}"]`);
        if (!card) return;
        card.querySelector('[data-entry-label]').textContent = `Trip Entry ${i + 1}`;
        card.querySelector('[data-entry-summary]').textContent = `${clientName(e.data.client_id)} · ${e.data.truck_type || 'Truck type'} · ${e.data.scheduled_at ? OpsHead.datetime(e.data.scheduled_at) : 'Schedule'} · ${e.data.quantity} required truck(s)`;
      });
    };
    const add = () => {
      if (total() >= 20) return error('A submission can contain at most 20 trips.');
      entries.push({ id: UI.uuid(), data: { quantity: 1 }, routes: [], loading: false, seq: 0 }); renderPlanning();
    };
    const renderPlanning = () => {
      ctx.el.innerHTML = `<div class="oh-planner"><div class="alert alert-danger" data-plan-error role="alert" hidden></div><form data-planning novalidate><div data-entries></div><button type="button" class="btn btn-outline-success oh-add-entry" data-add>+ Add Another Trip Entry</button>${this.panel('Planning Summary', '<div class="oh-planning-total"><strong data-total></strong><p data-entry-count></p><small>Schedules use Philippine time (Asia/Manila). Resources are checked by the existing assignment workflow.</small></div>')}<div class="oh-form-footer"><button type="button" class="btn btn-outline-secondary" data-clear>Clear Form</button><button type="submit" class="btn btn-primary">Review Trips</button></div></form></div>`;
      const list = ctx.el.querySelector('[data-entries]');
      entries.forEach((e, i) => {
        const card = document.createElement('details'); card.className = 'oh-entry'; card.dataset.entry = e.id; card.open = e.expanded !== false;
        card.ontoggle = () => e.expanded = card.open;
        card.innerHTML = `<summary><b data-entry-label>Trip Entry ${i + 1}</b><span data-entry-summary></span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary><div class="oh-entry-body">${i ? '<button type="button" class="btn btn-sm btn-outline-danger oh-remove" data-remove>Remove Entry</button>' : ''}<div class="oh-form-grid">${UI.fields([
          { name: 'client_id', label: 'Client', type: 'select', required: true, col: 6, value: e.data.client_id, options: clients.map(c => [c.id, c.company_name]) },
          { name: 'truck_type', label: 'Truck Type', type: 'select', required: true, col: 6, value: e.data.truck_type, options: UI.list(TripUI.truckTypeOptions()) },
          { name: 'client_route_id', label: 'Approved Route', type: 'select', required: true, col: 12, options: [], value: '' },
          { name: 'scheduled_at', label: 'Scheduled Date & Time (PHT)', type: 'datetime', required: true, col: 12, value: e.data.scheduled_at, attrs: `min="${UI.nowManila()}" max="${UI.nowManila(365 * 1440)}"` },
          { type: 'html', col: 6, html: `<label class="form-label" for="qty-${e.id}">Number of Required Trucks</label><div class="oh-stepper"><button type="button" class="btn btn-outline-secondary" data-minus aria-label="Decrease number of required trucks">−</button><input id="qty-${e.id}" name="quantity" type="number" class="form-control" min="1" max="20" step="1" required value="${e.data.quantity}"><button type="button" class="btn btn-outline-secondary" data-plus aria-label="Increase number of required trucks">+</button></div>` },
          { name: 'dispatcher_assignment', label: 'Assign Dispatcher', type: 'select', required: true, col: 6, placeholder: 'Choose dispatcher...', options: dispatcherOptions(e.data.truck_type), value: e.data.dispatcher_assignment, attrs: `aria-describedby="dispatcher-error-${e.id}"` },
          { name: 'delivery_details', label: 'Delivery Details / Instructions', type: 'textarea', rows: 3, col: 12, value: e.data.delivery_details, attrs: 'maxlength="500"' },
        ])}</div><p class="small text-muted mb-0" data-route-state role="status"></p></div>`;
        list.append(card);
        // UI.fields uses generic IDs. Each independent card receives unique accessible IDs.
        card.querySelectorAll('[name]').forEach(input => {
          const oldId = input.id; input.id = `${e.id}-${input.name}`;
          if (oldId) card.querySelectorAll('label').forEach(l => { if (l.htmlFor === oldId) l.htmlFor = input.id; });
          input.oninput = input.onchange = () => { e.data[input.name] = input.value; update(); };
        });
        const pick = card.querySelector('[name=client_route_id]'), note = card.querySelector('[data-route-state]');
        const dispatcher = card.querySelector('[name=dispatcher_assignment]');
        dispatcher.insertAdjacentHTML('afterend',`<div id="dispatcher-error-${e.id}" class="invalid-feedback" data-dispatcher-error hidden>Choose a compatible dispatcher group and shift.</div>`);
        const dispatcherError = card.querySelector('[data-dispatcher-error]');
        card.querySelector('.oh-stepper').parentElement.className='col-md-6';
        const fillDispatchers = () => {
          const options = dispatcherOptions(e.data.truck_type);
          if(!options.some(([value]) => value === e.data.dispatcher_assignment))e.data.dispatcher_assignment = '';
          dispatcher.innerHTML = '<option value="">Choose dispatcher...</option>' + options.map(([value,label]) => `<option value="${value}">${UI.esc(label)}</option>`).join('');
          dispatcher.value = e.data.dispatcher_assignment || '';
          dispatcher.disabled = !options.length;
          dispatcher.classList.remove('is-invalid');dispatcher.removeAttribute('aria-invalid');dispatcherError.hidden = true;dispatcherError.style.display='';
        };
        dispatcher.onchange = dispatcher.oninput = () => { e.data.dispatcher_assignment = dispatcher.value;dispatcher.classList.remove('is-invalid');dispatcher.removeAttribute('aria-invalid');dispatcherError.hidden = true;dispatcherError.style.display='';update(); };
        fillDispatchers();
        const fillRoutes = () => {
          pick.innerHTML = '<option value="">Choose an approved route</option>' + e.routes.map(r => `<option value="${+r.id}">${UI.esc(r.route_ref + ' · ' + r.origin_label + ' → ' + r.destination_label)}</option>`).join('');
          pick.value = e.data.client_route_id || ''; pick.disabled = e.loading || !e.data.client_id || !e.data.truck_type;
        };
        const loadRoutes = async () => {
          const seq = ++e.seq; e.routes = []; e.data.client_route_id = ''; e.route = null;
          if (!e.data.client_id || !e.data.truck_type) { e.loading = false; e.routeMessage = 'Choose a client and truck type.'; e.refresh(); return; }
          e.loading = true; e.routeMessage = 'Loading approved routes…'; e.refresh();
          try {
            const r = await App.api('Routes.selectable', { client_id: e.data.client_id, truck_type: e.data.truck_type });
            if (seq !== e.seq) return;
            e.routes = r.routes || []; e.routeMessage = e.routes.length ? '' : 'No approved routes are available for this client and truck type.';
          } catch (ex) { if (seq === e.seq) e.routeMessage = ex.message + ' Change the client or truck type to retry.'; }
          finally { if (seq === e.seq) { e.loading = false; e.refresh(); } }
        };
        ['client_id', 'truck_type'].forEach(n => card.querySelector(`[name=${n}]`).onchange = event => { e.data[n] = event.target.value;if(n==='truck_type')fillDispatchers(); loadRoutes(); update(); });
        pick.onchange = () => { e.data.client_route_id = pick.value; e.route = e.routes.find(r => String(r.id) === pick.value); };
        card.querySelector('[data-minus]').onclick = () => { e.data.quantity = Math.max(1, (+e.data.quantity || 1) - 1); card.querySelector('[name=quantity]').value = e.data.quantity; update(); };
        card.querySelector('[data-plus]').onclick = () => { if (total() >= 20) return error('Maximum combined quantity is 20 trips.'); e.data.quantity = (+e.data.quantity || 1) + 1; card.querySelector('[name=quantity]').value = e.data.quantity; update(); };
        card.querySelector('[data-remove]')?.addEventListener('click', () => { e.seq++; entries = entries.filter(x => x !== e); renderPlanning(); });
        e.refresh = () => { fillRoutes(); note.textContent = e.routeMessage || ''; };
        e.refresh();
      });
      ctx.el.querySelector('[data-add]').onclick = add;
      ctx.el.querySelector('[data-clear]').onclick = async () => {
        if (!await UI.confirmProceed('Clear Form', 'Discard all planning entries and delivery instructions?', 'Clear Form')) return;
        entries.forEach(e => e.seq++); entries = []; drafts = []; add();
      };
      ctx.el.querySelector('form').onsubmit = event => {
        event.preventDefault(); error('');
        if (entries.some(e => e.loading)) return error('Wait for approved routes to finish loading.');
        if (total() > 20 || entries.some(e => !Number.isInteger(+e.data.quantity) || +e.data.quantity < 1)) return error('Use whole quantities of at least 1, with at most 20 trips combined.');
        const invalid = [...ctx.el.querySelectorAll('input,select,textarea')].find(input => input.name!=='dispatcher_assignment' && !input.disabled && !input.checkValidity());
        if (invalid) { invalid.closest('details').open = true; invalid.reportValidity(); return; }
        const missingDispatcher = entries.find(e => !dispatcherOptions(e.data.truck_type).some(([value]) => value === e.data.dispatcher_assignment));
        if(missingDispatcher){const card=ctx.el.querySelector(`[data-entry="${missingDispatcher.id}"]`), select=card.querySelector('[name=dispatcher_assignment]'), feedback=card.querySelector('[data-dispatcher-error]');card.open=true;select.classList.add('is-invalid');select.setAttribute('aria-invalid','true');feedback.hidden=false;feedback.style.display='block';select.focus();return error('Choose a compatible dispatcher group and shift for every trip entry.');}
        for (const e of entries) {
          if (!e.route || String(e.route.id) !== String(e.data.client_route_id)) return error('Select an approved route for every trip entry.');
          if (e.data.scheduled_at < UI.nowManila(-5) || e.data.scheduled_at > UI.nowManila(365 * 1440)) return error('Use an allowed schedule in Philippine time.');
          const c = clients.find(c => String(c.id) === String(e.data.client_id));
          if (c?.rate_types != null && !c.rate_types.split('|').includes(e.data.truck_type)) return error(`${c.company_name} has no existing billing rate for ${e.data.truck_type}. Billing must set it before trip creation.`);
        }
        // Preserve row identity and overrides when returning to planning; drop only removed rows.
        drafts = entries.flatMap(e => Array.from({ length: +e.data.quantity }, (_, index) => {
          const old = drafts.find(x => x.entry === e.id && x.index === index);
          const supported = ['booking_reference', 'consignee', ...(e.data.truck_type === 'Car Carrier' ? ['units_planned'] : ['shipment_number']), ...(e.data.truck_type === 'Container' ? ['container_number', 'container_size', 'seal_number'] : [])];
          const overrides = Object.fromEntries(Object.entries(old?.overrides || {}).filter(([name]) => supported.includes(name)));
          return { key: old?.key || UI.uuid(), entry: e.id, index, overrides, data: { ...e.data, quantity: undefined,
            pickup_point: e.route.origin_label, delivery_point: e.route.destination_label, distance_km: e.route.distance_km,
            route_option: e.route.route_option || '', pickup_lat: e.route.origin_lat, pickup_lng: e.route.origin_lng, delivery_lat: e.route.destination_lat, delivery_lng: e.route.destination_lng } };
        })); renderReview();
      };
      update();
    };
    const renderReview = () => {
      ctx.el.innerHTML = `<div class="oh-planner"><div class="alert alert-danger" data-plan-error role="alert" hidden></div><form data-review-form><div class="oh-review-head"><h2>Review Trips</h2><b>${drafts.length} Individual Trips</b></div><div data-review-entries></div><p data-submission-note role="status">Review the shipment details below. Shared values can be changed by returning to planning.</p><div class="oh-form-footer"><button type="button" class="btn btn-outline-secondary" data-back ${attempted ? 'disabled' : ''}>Back to Planning</button>${attempted && !uncertain ? '<button type="button" class="btn btn-outline-secondary" data-start-another>Start Another Plan</button>' : ''}<button type="submit" class="btn btn-primary" data-confirm>Confirm &amp; Create Trips</button></div></form></div>`;
      const list = ctx.el.querySelector('[data-review-entries]');
      entries.forEach((e, i) => {
        const section = document.createElement('section'); section.className = 'oh-panel';
        section.innerHTML = `<div class="oh-panel-head"><h3>Planning Entry ${i + 1} · ${e.data.quantity} Required Truck(s)</h3></div><div class="oh-panel-body"><p><b>${UI.esc(clientName(e.data.client_id))} · ${UI.esc(e.data.truck_type)}</b><br>${UI.esc(e.route.origin_label)} → ${UI.esc(e.route.destination_label)}<br>${this.datetime(e.data.scheduled_at)}<br><span data-review-dispatcher>${UI.esc(dispatcherName(e.data))}</span><br>${UI.esc(e.data.delivery_details || 'No delivery instructions.')}</p><div data-drafts></div></div>`;
        list.append(section);
        drafts.filter(x => x.entry === e.id).forEach(x => {
          const row = document.createElement('details'); row.className = 'oh-draft'; row.open = !x.result?.trip_id;
          const fields = [ ['booking_reference', 'Booking Reference', 150], ['consignee', 'Consignee / Brand', 120],
            ...(e.data.truck_type === 'Car Carrier' ? [['units_planned', 'Cargo Units', 100]] : [['shipment_number', 'Shipment Number', 60]]),
            ...(e.data.truck_type === 'Container' ? [['container_number', 'Container Number', 60], ['container_size', 'Container Size', 20], ['seal_number', 'Seal Number', 60]] : []),
          ];
          row.innerHTML = `<summary>Draft Trip ${drafts.indexOf(x) + 1} <span data-row-result>${x.result ? UI.esc(x.result.result) + ' · ' + UI.esc(x.result.trip_ref || x.result.message || '') : 'Awaiting confirmation'}</span></summary><div class="oh-form-grid">${UI.fields(fields.map(([name, label, max]) => ({ name, label, col: 6, type: name === 'units_planned' ? 'number' : 'text', min: 1, attrs: name === 'units_planned' ? 'max="100" step="1"' : `maxlength="${max}"`, value: x.overrides[name] || '' })))}</div>${x.result?.trip_id ? `<button type="button" class="btn btn-link" data-oh-trip="${+x.result.trip_id}">View ${UI.esc(x.result.trip_ref)} · ${UI.esc(x.result.trip_status)}</button>` : ''}`;
          section.querySelector('[data-drafts]').append(row);
          row.querySelectorAll('[name]').forEach(input => { const old = input.id; input.id = `${x.key}-${input.name}`; row.querySelectorAll('label').forEach(l => { if (l.htmlFor === old) l.htmlFor = input.id; }); input.disabled = !!x.result?.trip_id || uncertain; input.oninput = () => x.overrides[input.name] = input.value; });
        });
      });
      this.bindTrips(ctx.el);
      ctx.el.querySelector('[data-back]').onclick = renderPlanning;
      ctx.el.querySelector('[data-start-another]')?.addEventListener('click', async () => {
        if (drafts.some(x => !x.result?.trip_id) && !await UI.confirmProceed('Start Another Plan', 'Discard the failed drafts? Created trips will remain in Trip Management.', 'Start Another Plan')) return;
        try { sessionStorage.removeItem(recoveryKey); } catch { /* Storage is optional. */ }
        entries = []; drafts = []; attempted = false; uncertain = false; add();
      });
      const confirm = ctx.el.querySelector('[data-confirm]');
      confirm.disabled = drafts.every(x => x.result?.trip_id);
      if (attempted) ctx.el.querySelector('[data-submission-note]').textContent = uncertain ? 'The server response was interrupted. Retry these same drafts to safely retrieve existing results; shared values are locked.' : 'Created trips are locked. Retry failed drafts with their original request keys. Start another plan from Trip Planning when finished.';
      ctx.el.querySelector('form').onsubmit = async event => {
        event.preventDefault(); if (busy || confirm.disabled) return;
        const pending = drafts.filter(x => !x.result?.trip_id);
        busy = true; attempted = true; confirm.disabled = true; confirm.textContent = 'Creating Trips…';
        uncertain = true; remember();
        ctx.el.querySelectorAll('input,button').forEach(input => input.disabled = true);
        try {
          const response = await App.api('Trips.create_batch', { rows: pending.map(x => ({ ...x.data, ...x.overrides, request_key: x.key, row_no: drafts.indexOf(x) + 1 })) });
          if (!Array.isArray(response.results) || pending.some(x => !response.results.some(r => r.request_key === x.key))) throw new Error('Incomplete submission response. Retry to retrieve the results safely.');
          response.results.forEach(r => { const x = drafts.find(x => x.key === r.request_key); if (x) x.result = r; });
          uncertain = false; remember(); renderReview();
          ctx.el.querySelector('[data-submission-note]').textContent = response.message || 'Submission results are shown for each trip.';
        } catch (ex) {
          // A validated 400 is the existing batch endpoint's preflight refusal: no new rows were created.
          // Network/5xx outcomes stay locked until a retry reconciles the original keys.
          const preflight = ex.status === 400;
          uncertain = !preflight;
          if (preflight && drafts.every(x => !x.result?.trip_id)) attempted = false;
          remember();
          renderReview(); error(ex.message + (preflight ? ' Correct the entries before retrying.' : ' Retry with the same request keys.'));
        }
        finally { busy = false; }
      };
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
      if (saved?.attempted && Array.isArray(saved.entries) && Array.isArray(saved.drafts) && saved.drafts.length && saved.drafts.length <= 20) {
        entries = saved.entries; drafts = saved.drafts; attempted = true; uncertain = !!saved.uncertain;
        renderReview(); return;
      }
    } catch { /* Ignore invalid/unsupported local recovery data. */ }
    add();
  },
};

// Install presentation only after the shared modules have registered their existing pages.
(() => {
  const shell = App.shell;
  App.shell = function() {
    shell.call(this);
    document.body.classList.toggle('operations-head', OpsHead.is());
    if (!OpsHead.is()) return;
    const allowed = new Map(this.me.nav.map(n => [n.id, n]));
    const item = (id, label, icon, query = {}, section = '') => allowed.has(id) ? `<a class="nav-item-link" href="${OpsHead.link(id, query)}" data-nav="${id}" ${section ? `data-ops-section="${section}"` : ''}><i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></a>` : '';
    const sections = [ ['Overview', [item('dashboard', 'Dashboard', 'bi-grid-1x2')]], ['Trip Operations', [item('trips', 'Trip Planning', 'bi-calendar-plus', { new: 1 }, 'planning'), item('trips', 'Trip Approvals', 'bi-clipboard-check', { view: 'approvals' }, 'approvals'), item('trips', 'Trip Management', 'bi-signpost-split', { tab: 'active' }, 'management'), item('funds', 'Trip Fund Approvals', 'bi-cash-coin')]], ['Masterlists', [item('trucks', 'Truck Masterlist', 'bi-truck'), item('crew', 'Driver & Helper Masterlist', 'bi-person-badge'), item('clients', 'Client Masterlist', 'bi-building'), item('routes', 'Client Routes', 'bi-signpost-2')]], ['Monitoring & Records', [item('trips', 'Incidents & Maintenance', 'bi-wrench-adjustable', { tab: 'incidents' }, 'incidents'), item('reports', 'Reports', 'bi-bar-chart-line'), item('documents', 'Documents', 'bi-folder2-open')]] ];
    // Former extras were Mechanics and Corrective Maintenance, both read-only for this role.
    // Operational coordination remains under Trips > Incidents. Backend access policy is unchanged.
    document.querySelector('.sidebar-nav').innerHTML = sections.map(([label, links]) => `<div class="nav-section">${label}</div>${links.join('')}`).join('');
    const toggle = document.createElement('button'); toggle.className = 'icon-btn oh-collapse-nav'; toggle.type = 'button'; toggle.setAttribute('aria-label', 'Collapse navigation'); toggle.setAttribute('aria-expanded', 'true'); toggle.innerHTML = '<i class="bi bi-layout-sidebar-inset" aria-hidden="true"></i>';
    toggle.onclick = () => { const collapsed = document.body.classList.toggle('oh-nav-collapsed'); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation'); };
    document.querySelector('.topbar').prepend(toggle);
  };
  const drawer = UI.drawer;
  UI.drawer = (...args) => {
    const previous = document.querySelector('.offcanvas.app-drawer');
    previous?.querySelector('.oh-drawer-footer')?.remove(); previous?.classList.remove('oh-trip-drawer');
    return drawer(...args);
  };
  const openTrip = TripUI.open;
  TripUI.open = async function(id) {
    if (OpsHead.is() && !TripUI.data) {
      try { TripUI.data = await App.data('trips'); } catch (ex) { return UI.toast(ex.message, 'error'); }
    }
    return openTrip.call(this, id);
  };
  for (const [page, render] of Object.entries({ dashboard: ctx => OpsHead.dashboard(ctx), trips: ctx => OpsHead.trips(ctx), funds: ctx => OpsHead.funds(ctx), routes: ctx => OpsHead.routes(ctx), crew: ctx => OpsHead.crew(ctx) })) {
    const original = App.pages[page].render;
    App.pages[page].render = function(ctx) { return OpsHead.is() ? render(ctx) : original.call(this, ctx); };
  }
  const reports = App.pages.reports.render;
  App.pages.reports.render = function(ctx) {
    const result = reports.call(this, ctx);
    if (OpsHead.is() && Object.keys(ctx.data.sections || {}).length) {
      const label = document.createElement('label'); label.className = 'oh-report-category'; label.textContent = 'Report Category';
      const select = document.createElement('select'); select.className = 'form-select';
      Object.entries(ctx.data.sections).forEach(([key, section]) => { const option = document.createElement('option'); option.value = key; option.textContent = section.title; select.append(option); });
      select.onchange = () => ctx.el.querySelector(`[data-tab="${CSS.escape(select.value)}"]`)?.click(); label.append(select); ctx.el.prepend(label);
    }
    return result;
  };
})();
