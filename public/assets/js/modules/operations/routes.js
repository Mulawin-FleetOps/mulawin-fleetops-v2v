/* assets/js/modules/operations/routes.js — CLIENT ROUTES (Checklist #20)
   Approved routes per client and truck type, with versioned contractual rates.
   Provisional flow: Operations Head requests -> Billing enters the rate -> Admin approves / rejects.
   A rate revision of an Approved route keeps the old rate in use until the Admin approves the new one.
   Only Approved routes will be selectable in planning (not connected to Trip Management yet).
   Backend: backend/Modules/Operations/Routes.php */
'use strict';
const RouteUI = {
  /**
   * Same steps, in the same order, as Routes::normalize() on the server: upper case -> every
   * run of non-letters/non-digits becomes one space -> every run of whitespace becomes one space -> trim.
   * Used only for the "similar route" warning; the database unique key is the real duplicate check.
   */
  norm: (v) => String(v ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim(),
  rateText(type, amount, min) {
    if (!type) return '—';
    return type === 'Flat' ? UI.money(amount) : `${UI.money(amount)}/km${+min > 0 ? ` (minimum ${UI.money(min)})` : ''}`;
  },
  name: (r) => `${r.origin_label} → ${r.destination_label}`,
  waiting: (r) => ['Pending Rate', 'Pending Approval'].includes(r.status) || (r.status === 'Approved' && r.pending_rate_id),

  request(d) {
    const fields = [
      { name: 'client_id', label: 'Client', type: 'select', required: true, col: 8, options: UI.opts(d.clients, c => c.company_name + (c.status !== 'Active' ? ` (${c.status})` : '')), value: d.filterClient || '' },
      { name: 'truck_type', label: 'Truck type', type: 'select', required: true, col: 4, options: UI.list(d.truckTypes) },
      { name: 'origin', label: 'Origin (pickup point)', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. TANAUAN, BATANGAS' },
      { name: 'destination', label: 'Destination (delivery point)', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. MALVAR, BATANGAS' },
      { type: 'html', col: 12, html: '<div data-routemapbox></div>' },
      { type: 'hidden', name: 'origin_lat' }, { type: 'hidden', name: 'origin_lng' }, { type: 'hidden', name: 'destination_lat' }, { type: 'hidden', name: 'destination_lng' },
      ...(d.routing ? [{ name: 'route_option', label: 'Route option', type: 'select', col: 8, placeholder: false, value: d.defaultRouteOption,
        options: Object.entries(d.routeOptions || {}), help: 'Used for the road distance. The company still has to confirm the toll-road policy.' }] : []),
      { name: 'distance_km', label: 'Distance (km)', type: 'number', step: '0.01', min: '0.01', required: true, col: 4, attrs: `max="${+d.maxDistance}"`,
        help: d.routing ? 'Filled in from the road distance when both points are pinned. You may change it (a reason is required).' : 'Type the km (automatic road distance is not set up on the server).' },
      { type: 'html', col: 12, html: '<div class="small" data-kminfo></div>' },
      { name: 'distance_override_reason', label: 'Reason for changing the computed km', required: true, col: 12, attrs: 'maxlength="300"' },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="500"' },
    ];
    const st = { computed: null, option: null, seq: 0 };
    UI.modal('Request a new route', '<p class="modal-intro">Pin the origin and the destination on the map (or search them). The road distance fills in the km. Origin to destination is one direction: the return trip is a separate route. The route is sent to Billing for the rate, then to the Admin for approval.</p>'
      + UI.fields(fields), async (f, form) => {
      // Send the route option only when the road distance was computed; otherwise the km is saved as Manual.
      if (st.computed === null) { delete f.route_option; delete f.distance_override_reason; }
      else if (Math.abs(+f.distance_km - st.computed) < 0.005) delete f.distance_override_reason;
      // Soft warning: same client and truck type, and one place name contains the other (e.g. "TANAUAN" and "TANAUAN CITY").
      const o = RouteUI.norm(f.origin), t = RouteUI.norm(f.destination);
      const close = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
      const similar = d.routes.filter(r => String(r.client_id) === String(f.client_id) && r.truck_type === f.truck_type
        && ['Pending Rate', 'Pending Approval', 'Approved'].includes(r.status) && close(RouteUI.norm(r.origin_label), o) && close(RouteUI.norm(r.destination_label), t));
      if (similar.length && form.dataset.ack !== o + '|' + t) {
        form.dataset.ack = o + '|' + t;
        throw new Error('Similar route already exists: ' + similar.map(r => `${r.route_ref} ${RouteUI.name(r)} (${r.status})`).join('; ') + '. Check it first. Click "Send request" again to continue anyway.');
      }
      const r = await App.api('Routes.request', f); UI.result(r); App.route();
    }, { submit: 'Send request', onShow: (wrap, form) => RouteUI.wireDistance(wrap, form, d, st) });
  },

  /** Map, route option, automatic km and manual override of the Request route form (Checklist #5). */
  wireDistance(wrap, form, d, st) {
    const km = form.querySelector('[name=distance_km]'), opt = form.querySelector('[name=route_option]');
    const info = form.querySelector('[data-kminfo]');
    const reasonBox = form.querySelector('[name=distance_override_reason]').closest('[class*="col-"]');
    const ratio = +d.overrideWarningRatio || 0.15;
    const noService = '<span class="text-muted">Automatic road distance is not set up on the server. Type the km.</span>';
    const checkOverride = () => {
      const show = st.computed !== null && km.value !== '' && Math.abs(+km.value - st.computed) >= 0.005;
      reasonBox.classList.toggle('d-none', !show);
      const warn = info.querySelector('[data-kmwarn]');
      if (warn) warn.textContent = show && Math.abs(+km.value - st.computed) > ratio * st.computed
        ? `Warning: the km differs from the computed road distance by more than ${Math.round(ratio * 100)}%.` : '';
    };
    const say = (html) => { info.innerHTML = html; checkOverride(); };
    reasonBox.classList.add('d-none');
    km.addEventListener('input', checkOverride);
    const compute = async (points, picker) => {
      st.computed = null;
      if (!d.routing) { say(noService); return; }
      if (!points.pickup || !points.delivery) { say('<span class="text-muted">Pin both points to get the road distance.</span>'); return; }
      const seq = ++st.seq;
      say('<span class="text-muted"><span class="spinner-border spinner-border-sm"></span> Computing the road distance…</span>');
      let r;
      try { r = await UI.Map.route(points.pickup, points.delivery, opt ? opt.value : d.defaultRouteOption); }
      catch (e) { r = { available: false, message: e.message }; }
      if (seq !== st.seq) return;   // an older answer: ignore
      if (!r.available) {
        say(`<span class="text-danger">${UI.esc(r.message || 'Road distance is not available.')}</span>`); return;
      }
      st.computed = +r.distance_km; st.option = r.option;
      km.value = st.computed.toFixed(2);
      if (r.geometry && picker) picker.showRoute(UI.Map.decode(r.geometry));
      say(`Road distance: <b>${UI.num(r.distance_km, 2)} km</b> · about ${UI.num(r.duration_min, 0)} min · ${UI.esc(r.option_label)}
        <span class="text-muted">(straight line ${UI.num(r.straight_km, 1)} km)</span>
        ${r.warning ? `<div class="text-warning">${UI.esc(r.warning)}</div>` : ''}
        <button type="button" class="btn btn-link btn-sm p-0 ms-2" data-usekm>Use the computed km</button>
        <div class="text-warning" data-kmwarn></div>`);
      info.querySelector('[data-usekm]').onclick = () => { km.value = st.computed.toFixed(2); checkOverride(); };
    };
    const map = UI.mapPicker(form.querySelector('[data-routemapbox]'), form, {}, {
      fields: { pickup: { addr: 'origin', lat: 'origin_lat', lng: 'origin_lng' }, delivery: { addr: 'destination', lat: 'destination_lat', lng: 'destination_lng' } },
      labels: { pickup: 'Origin', delivery: 'Destination' },
      footNote: d.routing ? 'Road distance by openrouteservice (estimate). Check it before sending.' : 'Type the km.',
      onChange: compute,
    });
    if (opt && map) opt.addEventListener('change', () => compute(map.picker.points(), map.picker));
    wrap.addEventListener('shown.bs.modal', () => map && map.invalidateSize());
    if (!d.routing) say(noService);
  },

  rate(route, d) {
    const revision = route.status === 'Approved';
    const fields = [
      { name: 'rate_amount', label: 'Rate (PHP)', type: 'money', required: true, col: 6 },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="300"' },
    ];
    const intro = `<p class="modal-intro"><b>${UI.esc(route.route_ref)}</b> · ${UI.esc(route.client)} · ${UI.esc(RouteUI.name(route))} · ${UI.esc(route.truck_type)} · ${UI.num(route.distance_km, 2)} km</p>`
      + (revision ? `<div class="alert alert-info py-2 small">Current approved rate: <b>${RouteUI.rateText(route.rate_type, route.rate_amount, route.minimum_charge)}</b>. It stays in use until the Admin approves this revision.</div>` : '');
    UI.modal((revision ? 'Revise rate of ' : 'Enter rate of ') + UI.esc(route.route_ref), intro + UI.fields(fields), async (f) => {
      const r = await App.api('Routes.rate_enter', { route_id: route.id, ...f, rate_type: 'Flat' }); UI.result(r); UI.closeDrawer(); App.route();
    }, { submit: 'Send for approval', size: '' });
  },

  decide(route, decision) {
    const text = `<b>${UI.esc(route.route_ref)}</b> · ${UI.esc(route.client)} · ${UI.esc(RouteUI.name(route))} · ${UI.esc(route.truck_type)}<br>
      Proposed rate (version ${UI.esc(route.pending_version)}): <b>${RouteUI.rateText(route.pending_rate_type, route.pending_rate_amount, route.pending_minimum_charge)}</b>, entered by ${UI.e(route.pending_entered_by_name)}.
      ${route.status === 'Approved' ? `<br>Current rate: ${RouteUI.rateText(route.rate_type, route.rate_amount, route.minimum_charge)}.` : ''}
      <br><span class="small text-muted">${decision === 'approve'
        ? (route.status === 'Approved' ? 'The current rate will be replaced. Its record is kept in the history.' : 'The route can then be used for planning.')
        : (route.status === 'Approved' ? 'Only this revision is rejected. The route stays Approved with its current rate.' : 'The route request is closed. A new request is needed to use this route.')}</span>`;
    UI.confirmAction(decision === 'approve' ? 'Approve rate' : 'Reject rate', text, 'Routes.decide', { rate_id: route.pending_rate_id, decision }, {
      submit: decision === 'approve' ? 'Approve' : 'Reject', danger: decision === 'reject',
      fields: [decision === 'approve' ? { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="300"' } : { name: 'reason', label: 'Reason for rejection', required: true, col: 12, attrs: 'maxlength="300"' }],
    });
  },

  async open(id, d) {
    let r; try { r = await App.api('Routes.details', { route_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const x = r.route, me = d.me, can = d.can;
    const acts = [];
    if (can.rate && (x.status === 'Pending Rate' || (x.status === 'Approved' && !x.pending_rate_id)))
      acts.push(`<button class="btn btn-sm btn-primary" data-a="rate"><i class="bi bi-cash"></i> ${x.status === 'Approved' ? 'Revise rate' : 'Enter rate'}</button>`);
    if (can.approve && x.pending_rate_id) {
      if (+x.pending_entered_by === +me) acts.push('<span class="small text-muted align-self-center">You entered this rate, so another approver must decide it.</span>');
      else acts.push('<button class="btn btn-sm btn-success" data-a="approve"><i class="bi bi-check-lg"></i> Approve rate</button>', '<button class="btn btn-sm btn-outline-danger" data-a="reject"><i class="bi bi-x-lg"></i> Reject rate</button>');
    }
    if (can.withdraw && ['Pending Rate', 'Pending Approval'].includes(x.status) && +x.requested_by === +me) acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="withdraw">Withdraw request</button>');
    if (can.deactivate && x.status === 'Approved') acts.push('<button class="btn btn-sm btn-outline-danger" data-a="deactivate">Deactivate route</button>');
    const html = `<div class="mb-2">${UI.badge(x.status)} ${x.pending_rate_id && x.status === 'Approved' ? UI.badge('Pending Approval') + ' <span class="small text-muted">rate revision</span>' : ''}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}</div>` : ''}
      ${UI.h('Route')}${UI.kv([['Client', `<b>${UI.esc(x.client)}</b>`], ['Origin', UI.e(x.origin_label)], ['Destination', UI.e(x.destination_label)], ['Truck type', UI.e(x.truck_type)],
        ['Distance', UI.num(x.distance_km, 2) + ' km · ' + UI.esc(x.distance_source)],
        x.distance_computed_km ? ['Computed road distance', UI.num(x.distance_computed_km, 2) + ' km · ' + UI.esc((d.routeOptions || {})[x.route_option] || x.route_option || '') + ' · ' + UI.esc(x.distance_provider || '') + ' · ' + UI.datetime(x.distance_computed_at)] : null,
        x.distance_override_reason ? ['Reason the km was changed', UI.esc(x.distance_override_reason)] : null, ['Notes', UI.e(x.notes)], ['Requested by', UI.esc(x.requested_by_name) + ' · ' + UI.datetime(x.requested_at)],
        x.closed_reason ? ['Closed', UI.esc(x.closed_reason) + (x.closed_by_name ? ' · ' + UI.esc(x.closed_by_name) : '') + (x.closed_at ? ' · ' + UI.datetime(x.closed_at) : '')] : null])}
      ${UI.h('Current approved rate')}${x.rate_id ? UI.kv([['Rate', `<b>${RouteUI.rateText(x.rate_type, x.rate_amount, x.minimum_charge)}</b>`], ['Version', UI.e(x.rate_version)], ['Effective since', UI.datetime(x.effective_from)]]) : '<div class="text-muted small">No approved rate yet.</div>'}
      ${x.pending_rate_id ? UI.h('Waiting for approval') + UI.kv([['Proposed rate', `<b>${RouteUI.rateText(x.pending_rate_type, x.pending_rate_amount, x.pending_minimum_charge)}</b>`], ['Version', UI.e(x.pending_version)], ['Entered by', UI.esc(x.pending_entered_by_name) + ' · ' + UI.datetime(x.pending_entered_at)]]) : ''}
      ${UI.h('Rate history')}${UI.table([['Version', 'version_no'], ['Rate', 'rate_amount', (v, t) => RouteUI.rateText(t.rate_type, t.rate_amount, t.minimum_charge)], ['Status', 'status', 'badge'],
        ['Entered by', 'entered_by_name'], ['Decided by', 'decided_by_name'], ['Effective from', 'effective_from', 'datetime'], ['Effective to', 'effective_to', 'datetime'], ['Remarks', 'decision_notes']], r.rates, { plain: true, empty: 'No rate entered yet.' })}
      ${UI.h('History')}${UI.table([['Date', 'created_at', 'datetime'], ['Action', 'event_type'], ['By', 'actor'], ['Status', 'to_status', 'badge'], ['Details', 'notes']], r.events, { plain: true })}`;
    const el = UI.drawer(UI.esc(x.route_ref), html.replace(UI.h('Current approved rate'), (x.origin_lat && x.destination_lat ? '<div class="route-map mb-3" data-routedetailmap style="height:240px"></div>' : '') + UI.h('Current approved rate')), { subtitle: 'Client route' });
    const mbox = el.querySelector('[data-routedetailmap]');
    if (mbox) setTimeout(() => UI.routeMap(mbox, null, { a: [+x.origin_lat, +x.origin_lng], b: [+x.destination_lat, +x.destination_lng],
      aLabel: 'Origin: ' + x.origin_label, bLabel: 'Destination: ' + x.destination_label, geometry: x.route_geometry || '' }), 350);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'rate') RouteUI.rate(x, d);
      if (a === 'approve' || a === 'reject') RouteUI.decide(x, a);
      if (a === 'withdraw') UI.confirmAction('Withdraw ' + UI.esc(x.route_ref), 'The request will be closed. Its history is kept.', 'Routes.withdraw', { route_id: x.id },
        { submit: 'Withdraw', danger: true, fields: [{ name: 'reason', label: 'Reason', required: true, col: 12, attrs: 'maxlength="300"' }] });
      if (a === 'deactivate') UI.confirmAction('Deactivate ' + UI.esc(x.route_ref), 'The route can no longer be selected. Its rates and history are kept.', 'Routes.deactivate', { route_id: x.id },
        { submit: 'Deactivate', danger: true, fields: [{ name: 'reason', label: 'Reason', required: true, col: 12, attrs: 'maxlength="300"' }] });
    });
  },
};

App.page('routes', {
  title: 'Client Routes',
  subtitle: 'Approved routes per client and truck type, with their contractual rates. Only Approved routes can be used for planning.',
  render(ctx) {
    const d = ctx.data, me = d.me;
    if (d.can.request) UI.tool(ctx, 'Request route', () => RouteUI.request(d), 'bi-plus-lg', 'primary');
    const rows = d.routes || [];
    const count = (fn) => rows.filter(fn).length;
    const clientOpts = [...new Map([...rows.map(r => [String(r.client_id), r.client]), ...(d.clients || []).map(c => [String(c.id), c.company_name])]).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    ctx.el.innerHTML = UI.cards([
      { label: 'Approved routes', value: count(r => r.status === 'Approved'), color: 'green' },
      { label: 'Waiting for rate', value: count(r => r.status === 'Pending Rate'), color: 'blue' },
      { label: 'Waiting for approval', value: count(r => r.pending_rate_id), color: 'amber', hint: 'new routes and rate revisions' },
    ]) + UI.filterModal(ctx, [{ name: 'client_id', label: 'Client', type: 'select', options: clientOpts, col: 12 }], { hint: 'Showing routes of all clients.' });
    // Short list (main details only); everything else is in the details window.
    const cols = [['Route', 'route_ref'], ['Client', 'client'], ['Origin → destination', 'origin_label', (v, r) => UI.esc(RouteUI.name(r))], ['Truck type', 'truck_type'],
      ['Km', 'distance_km', 'num'], ['Rate', 'rate_amount', (v, r) => RouteUI.rateText(r.rate_type, r.rate_amount, r.minimum_charge)], ['Status', 'status', 'badge']];
    const actions = (r) => {
      let b = UI.btn('view', 'View');
      if (d.can.rate && r.status === 'Pending Rate') b += UI.btn('rate', 'Enter rate', 'primary');
      if (d.can.approve && r.pending_rate_id && +r.pending_entered_by !== +me) b += UI.btn('decide', 'Review rate', 'primary');
      return b;
    };
    const onAction = (a, r) => { if (a === 'rate') RouteUI.rate(r, d); else RouteUI.open(r.id, d); };
    const list = (fn, empty) => UI.table(cols, rows.filter(fn), { actions, onAction, empty, rowClick: (r) => RouteUI.open(r.id, d) });
    UI.tabs(ctx.el, [
      ['waiting', `Waiting <span class="badge bg-secondary">${count(RouteUI.waiting)}</span>`, () => list(RouteUI.waiting, 'Nothing is waiting for a rate or approval.')],
      ['approved', 'Approved', () => list(r => r.status === 'Approved', 'No approved route yet.')],
      ['closed', 'Rejected / Withdrawn / Inactive', () => list(r => ['Rejected', 'Withdrawn', 'Inactive'].includes(r.status), 'No closed route.')],
    ], count(RouteUI.waiting) ? 'waiting' : 'approved');
    UI.activate(ctx.el);
  },
});
