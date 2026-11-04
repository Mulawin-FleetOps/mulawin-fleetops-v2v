/* assets/js/modules/operations/trips.js — TRIPS (create, assign, fund, checklist, dispatch, progress, incident, complete)
   One page for the whole trip workflow of PDF #12 (Scenarios A, B and C).
   - Active tab: every open trip as a card with a progress bar and the next step (who does what).
   - History tab: closed trips with ONE filter modal.
   - Incidents tab: incident reports (printable Incident Report Form, PDF #13).
   - Click a trip: details drawer with the actions allowed for your role.
   Backend: backend/Modules/Operations/Trips.php (fund request: Accounting/Funds.php) */
'use strict';
const TripUI = {
  STAGES: ['Requested', 'Assigned', 'Fund & checklist', 'Dispatched', 'Completed'],
  data: null,

  /** Current stage index and whether it is a problem state. */
  stage(t) {
    switch (t.status) {
      case 'Pending Review': return [0, false];
      case 'Awaiting Resources': return [1, true];
      case 'Pre-Assigned': case 'Ready for Dispatch': return [2, false];
      case 'For Reschedule': return [2, true];
      case 'Dispatched': case 'In Transit': return [3, false];
      case 'On Hold - Incident Reported': return [3, true];
      case 'Completed': return [5, false];
      default: return [0, true];
    }
  },
  isDelayed(t) { return ['Pending Review', 'Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch'].includes(t.status) && new Date(String(t.scheduled_at).replace(' ', 'T')) < new Date(); },
  flags(t) {
    const f = [];
    if (TripUI.isDelayed(t)) f.push(UI.badge('Delayed'));
    if (+t.delay_count) f.push(`<span class="badge-s amber">${+t.delay_count} delay update(s)</span>`);
    if (t.incident_status && t.incident_status !== 'Resolved') f.push(`<span class="badge-s red">Incident: ${UI.esc(t.incident_status)}</span>`);
    if (+t.attempt_number > 1) f.push(`<span class="badge-s blue">Attempt #${+t.attempt_number}</span>`);
    return f.join(' ');
  },
  fundText(t) {
    if (!t.fund_status) return +t.attempt_number > 1 ? 'Fund: optional for redispatch' : 'Fund: not requested yet';
    return 'Fund: ' + t.fund_status;
  },
  /** Plain-language next step and who does it. */
  next(t) {
    switch (t.status) {
      case 'Pending Review': return 'Operations Head reviews the request and confirms the details.';
      case 'Awaiting Resources': return 'Waiting for a free truck and crew. The system assigns automatically when one is free.';
      case 'Pre-Assigned': {
        const s = [];
        if (!t.fund_status && +t.attempt_number === 1) s.push('dispatcher submits the fund request');
        if (t.fund_status === 'Rejected') s.push('dispatcher revises the rejected fund request');
        if (t.fund_status === 'Pending Approval') s.push('Operations Head approves the fund');
        if (t.fund_status === 'Ready for Release') s.push('Finance releases the fund');
        s.push('dispatcher does the pre-dispatch checklist');
        return 'Next: ' + s.join('; ') + '.';
      }
      case 'Ready for Dispatch':
        if (!t.fund_status && +t.attempt_number > 1) return 'Checklist done. Dispatcher can Confirm Redispatch.';
        if (t.fund_status === 'Released') return 'Checklist done and fund released. Dispatcher can Confirm Dispatch.';
        return 'Checklist done. Waiting for the fund (' + (t.fund_status || 'not requested') + ').';
      case 'Dispatched': case 'In Transit': return 'On the road. Dispatcher records updates and completes the trip with the waybill and acknowledgement receipt.';
      case 'On Hold - Incident Reported':
        if (t.incident_status === 'Reported') return 'Maintenance assesses the damage (minor or major).';
        if (t.incident_status === 'Repaired - Cleared to Continue') return 'Repaired on site. Dispatcher resumes the trip.';
        return 'Mechanic is repairing the truck on site.';
      case 'For Reschedule': return t.truck_status === 'Assigned' ? 'Truck is repaired. Dispatcher reschedules the trip.' : 'Truck is being repaired (major damage). Then the dispatcher reschedules.';
      case 'Completed': return 'Completed' + (t.billing_status ? ' · Billing: ' + t.billing_status : '');
      default: return t.cancel_reason ? 'Reason: ' + t.cancel_reason : '';
    }
  },
  needsMe(t) {
    const r = App.me.user.role;
    if (r === 'operations_head') return t.status === 'Pending Review' || t.fund_status === 'Pending Approval' || t.status === 'Awaiting Resources';
    if (UI.isDispatcher() && t.dispatcher_role === r) {
      return (t.status === 'Pre-Assigned') || (t.status === 'Ready for Dispatch' && (t.fund_status === 'Released' || (!t.fund_status && +t.attempt_number > 1)))
        || t.fund_status === 'Rejected' || (t.status === 'On Hold - Incident Reported' && t.incident_status === 'Repaired - Cleared to Continue')
        || (t.status === 'For Reschedule' && t.truck_status === 'Assigned');
    }
    if (r === 'finance') return t.fund_status === 'Ready for Release';
    if (r === 'motorpool') return t.status === 'On Hold - Incident Reported' && t.incident_status === 'Reported';
    return false;
  },
  card(t) {
    const [st, warn] = TripUI.stage(t);
    const crew = [t.driver_name, t.driver2_name, t.helper_name].filter(Boolean).join(', ');
    return `<div class="trip-card ${TripUI.needsMe(t) ? 'needs-me' : ''}" data-trip="${t.id}">
      <div class="tc-top"><div><span class="tc-ref">${UI.esc(t.trip_ref)}</span> <span class="small text-muted">${UI.esc(t.truck_type || 'type not set')}</span></div>${UI.badge(t.status)}</div>
      <div class="tc-route"><b>${UI.esc(t.client)}</b>${t.consignee ? ' · ' + UI.esc(t.consignee) : ''}<br><i class="bi bi-geo-alt text-success"></i> ${UI.esc(t.pickup_point)} <i class="bi bi-arrow-right"></i> <i class="bi bi-geo text-danger"></i> ${UI.esc(t.delivery_point)}</div>
      <div class="tc-meta"><span><i class="bi bi-calendar-event"></i> ${UI.datetime(t.scheduled_at)}</span><span><i class="bi bi-truck"></i> ${UI.esc(t.plate_number || 'no truck yet')}</span>${crew ? `<span><i class="bi bi-person"></i> ${UI.esc(crew)}</span>` : ''}
        ${['Pre-Assigned', 'Ready for Dispatch'].includes(t.status) ? `<span><i class="bi bi-cash-coin"></i> ${UI.esc(TripUI.fundText(t))}</span>` : ''}</div>
      ${UI.steps(TripUI.STAGES, st, { compact: true, warn })}
      ${TripUI.flags(t) ? `<div class="tc-flags">${TripUI.flags(t)}</div>` : ''}
      <div class="tc-next">${UI.esc(TripUI.next(t))}</div></div>`;
  },

  // ------------------------------------------------------------------ forms
  truckTypeOptions() {
    const r = App.me.user.role;
    if (r === 'car_carrier_dispatcher') return ['Car Carrier'];
    if (r === 'container_wingvan_dispatcher') return ['Container', 'Wing Van'];
    return App.me.truckTypes;
  },
  /** Live availability of trucks and crew for the chosen truck type (shown in the trip form). */
  availability(type) {
    const d = TripUI.data; if (!d || !d.trucks) return '';
    const trucks = d.trucks.filter(v => (!type || v.truck_type === type));
    const free = trucks.filter(v => v.status === 'Available' && !v.on_trip);
    const drivers = (d.crew || []).filter(p => p.person_type === 'Driver' && p.availability === 'Available' && !p.on_trip && (!p.license_expiry || p.license_expiry >= UI.today()));
    const helpers = (d.crew || []).filter(p => p.person_type === 'Helper' && p.availability === 'Available' && !p.on_trip);
    const need = type === 'Car Carrier' ? 'driver(s)' : 'driver(s) and helper(s)';
    const ok = free.length && drivers.length && (type === 'Car Carrier' || helpers.length);
    return `<div class="alert ${ok ? 'alert-success' : 'alert-warning'} py-2 small mb-0"><b>Available now${type ? ' (' + UI.esc(type) + ')' : ''}:</b> ${free.length} of ${trucks.length} truck(s), ${drivers.length} driver(s)${type === 'Car Carrier' ? '' : ', ' + helpers.length + ' helper(s)'}.
      ${ok ? 'The system will assign them automatically.' : `Not enough free trucks / ${need}: the trip will wait as "Awaiting Resources" and is assigned automatically when they are free.`}
      ${free.length ? `<details class="mt-1"><summary>Show available trucks</summary>${free.map(v => UI.esc(v.plate_number) + (v.truck_number ? ' (#' + UI.esc(v.truck_number) + ')' : '')).join(', ')}</details>` : ''}</div>`;
  },
  deliveryFields(t = {}, opts = {}) {
    const d = TripUI.data;
    const types = TripUI.truckTypeOptions();
    return [
      ...(opts.withClient ? [{ name: 'client_id', label: 'Client (Active clients with a billing rate)', type: 'select', required: true, col: 8, value: t.client_id,
          options: (d.clients || []).map(c => [c.id, c.company_name + (c.rate_types ? '' : ' (no rate)')]) }] : []),
      { name: 'consignee', label: 'Consignee / brand', col: 4, value: t.consignee, attrs: 'list="dlConsignee"', placeholder: 'e.g. JETOUR, COCA COLA' },
      { name: 'truck_type', label: 'Truck type', type: 'select', options: UI.list(types), value: t.truck_type || (types.length === 1 ? types[0] : ''), required: opts.needsKm, col: 4,
        help: 'Decides the dispatcher team: Car Carrier, or Container / Wing Van.' },
      { name: 'scheduled_at', label: 'Scheduled date and time', type: 'datetime', required: true, col: 4, value: t.scheduled_at ? String(t.scheduled_at).slice(0, 16).replace(' ', 'T') : '' },
      { name: 'distance_km', label: 'Billable distance (km)', type: 'number', step: '0.01', required: opts.needsKm, col: 4, value: t.distance_km,
        help: 'Pickup point to delivery point. Billing = km x client rate.' },
      { name: 'pickup_point', label: 'Pickup point', required: true, col: 6, value: t.pickup_point, attrs: 'list="dlPlaces"' },
      { name: 'delivery_point', label: 'Delivery point', required: true, col: 6, value: t.delivery_point, attrs: 'list="dlPlaces"' },
      { type: 'html', html: '<div data-mapbox></div>' },
      { type: 'hidden', name: 'pickup_lat', value: t.pickup_lat }, { type: 'hidden', name: 'pickup_lng', value: t.pickup_lng },
      { type: 'hidden', name: 'delivery_lat', value: t.delivery_lat }, { type: 'hidden', name: 'delivery_lng', value: t.delivery_lng },
      { name: 'delivery_details', label: 'Delivery details', type: 'textarea', rows: 2, col: 12, value: t.delivery_details },
      { name: 'booking_reference', label: 'Booking / nomination details', col: 6, value: t.booking_reference },
      { name: 'units_planned', label: 'Units (car carrier)', type: 'number', min: 1, col: 3, value: t.units_planned },
      { name: 'container_number', label: 'Container no.', col: 3, value: t.container_number },
      { name: 'container_size', label: 'Container size', col: 3, value: t.container_size, placeholder: '1X20 / X40' },
      { name: 'seal_number', label: 'Seal no.', col: 3, value: t.seal_number },
      { name: 'shipment_number', label: 'Shipment no.', col: 3, value: t.shipment_number },
      { type: 'html', html: '<div data-avail class="mt-1"></div>' },
    ];
  },
  datalists() {
    const d = TripUI.data || {};
    return `<datalist id="dlPlaces">${(d.places || []).map(p => `<option value="${UI.esc(p)}">`).join('')}</datalist>
      <datalist id="dlConsignee">${(d.consignees || []).map(p => `<option value="${UI.esc(p)}">`).join('')}</datalist>`;
  },
  /** Wires map, availability and type-specific fields of a trip form. */
  wireForm(wrap, form, t = {}) {
    UI.mapPicker(wrap.querySelector('[data-mapbox]'), form, t);
    const typeSel = form.querySelector('[name=truck_type]');
    const show = () => {
      const type = typeSel.value;
      const toggle = (name, on) => { const el = form.querySelector(`[name=${name}]`); if (el) el.closest('[class*=col-]').style.display = on ? '' : 'none'; };
      toggle('units_planned', !type || type === 'Car Carrier');
      ['container_number', 'container_size', 'seal_number'].forEach(n => toggle(n, !type || type === 'Container'));
      toggle('shipment_number', !type || type !== 'Car Carrier');
      const av = wrap.querySelector('[data-avail]'); if (av) av.innerHTML = TripUI.availability(type);
      const client = form.querySelector('[name=client_id]');
      if (client && client.value && type) {
        const c = (TripUI.data.clients || []).find(x => String(x.id) === client.value);
        if (c && !(c.rate_types || '').split('|').includes(type)) av.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger py-2 small mb-1">${UI.esc(c.company_name)} has no billing rate for ${UI.esc(type)} yet. Ask Billing to set it.</div>`);
      }
    };
    typeSel.addEventListener('change', show);
    form.querySelector('[name=client_id]')?.addEventListener('change', show);
    show();
  },

  create() {
    const isOps = UI.role('operations_head');
    UI.modal(isOps ? 'New trip (client to Operations Head)' : 'New trip request (client to dispatcher)',
      `<div class="small text-muted mb-2">${isOps ? 'Pick the client, enter the delivery details, pin the route and type the km. The system assigns an available truck, driver and helper right away.'
        : 'Encode the delivery information from the client. The Operations Head reviews it, then the system assigns the truck and crew.'}</div>
       ${TripUI.datalists()}${UI.fields(TripUI.deliveryFields({}, { withClient: true, needsKm: isOps }))}`,
      async (d) => { const r = await App.api('Trips.create', d); UI.result(r); App.route(); if (r.trip_id) setTimeout(() => TripUI.open(r.trip_id), 400); },
      { submit: isOps ? 'Create trip and auto-assign' : 'Send request', onShow: (w, f) => TripUI.wireForm(w, f) });
  },
  /**
   * New Trip Request page (#trips?new=1): one page with numbered sections instead of a modal,
   * because this is the main form of the system (client -> pickup/destination -> cargo -> assignment -> files).
   */
  newPage(ctx) {
    const isOps = UI.role('operations_head');
    const d = TripUI.data;
    ctx.setTitle(isOps ? 'New trip' : 'New trip request', isOps
      ? 'Encode the client\'s delivery. The system assigns an available truck, driver and helper right away.'
      : 'Encode the delivery information from the client. The Operations Head reviews it, then the system assigns the truck and crew.');
    const back = document.createElement('button'); back.type = 'button'; back.className = 'btn btn-sm btn-outline-secondary';
    back.innerHTML = '<i class="bi bi-arrow-left"></i> Back to trips'; back.onclick = () => App.go('trips'); ctx.tools.append(back);
    const all = Object.fromEntries(TripUI.deliveryFields({}, { withClient: true, needsKm: isOps }).filter(f => f.name).map(f => [f.name, f]));
    const pick = (names, cols = {}) => UI.fields(names.map(n => ({ ...all[n], col: cols[n] || all[n].col })));
    const section = (n, title, desc, body) => `<section class="form-section"><div class="form-section-head"><span class="form-section-num">${n}</span><div>
      <h2 class="form-section-title">${title}</h2><p class="form-section-desc">${desc}</p></div></div><div class="form-section-body">${body}</div></section>`;
    const clients = (d.clients || []);
    ctx.el.innerHTML = `<form class="form-page" id="ntForm" novalidate>${TripUI.datalists()}
      <div>
        <div class="alert alert-danger form-error" role="alert"></div>
        ${clients.length ? '' : '<div class="alert alert-warning">No Active client with a billing rate yet. Billing must set the client\'s rate first (Client Masterlist).</div>'}
        ${section(1, 'Client and schedule', 'Who the delivery is for, which truck type, and when the truck should be at the pickup point.',
          pick(['client_id', 'consignee', 'truck_type', 'scheduled_at'], { client_id: 8, consignee: 4, truck_type: 6, scheduled_at: 6 }))}
        ${section(2, 'Pickup and destination', 'Search a place or click the map to pin both points, then check the address text below the map.',
          `<div data-mapbox class="mb-3"></div>${pick(['pickup_point', 'delivery_point', 'distance_km'], { distance_km: 4 })}
           <input type="hidden" name="pickup_lat"><input type="hidden" name="pickup_lng"><input type="hidden" name="delivery_lat"><input type="hidden" name="delivery_lng">`)}
        ${section(3, 'Cargo and booking details', 'Only the fields for the chosen truck type are shown.',
          pick(['booking_reference', 'units_planned', 'container_number', 'container_size', 'seal_number', 'shipment_number', 'delivery_details']))}
        ${section(4, 'Assignment', 'Trucks and crew are assigned by the system from the masterlists (only available, valid records).', '<div data-avail></div>')}
        ${section(5, 'Attachments (optional)', 'Booking or nomination copy, delivery order, client instructions. PDF, JPG, PNG or WebP, up to 10 MB each.',
          `<input class="form-control form-control-sm" type="file" name="attachments" id="ntFiles" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp">
           <ul class="doc-list mt-2" id="ntFileList"></ul>`)}
      </div>
      <aside class="form-aside"><section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-card-checklist"></i> Summary</h2></div>
        <div class="panel-body"><dl class="kv" id="ntSum"></dl>
          <div class="form-check mt-3"><input class="form-check-input" type="checkbox" id="ntConfirm"><label class="form-check-label small" for="ntConfirm">I checked the pickup and destination addresses.</label></div>
          <div class="d-grid gap-2 mt-3"><button type="submit" class="btn btn-primary">${isOps ? 'Create trip and auto-assign' : 'Send request'}</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" data-cancel>Cancel</button></div>
          <p class="form-help mt-2 mb-0">${isOps ? 'The trip is confirmed right away.' : 'The Operations Head is notified and reviews the request.'}</p></div></section></aside>
    </form>`;
    const form = ctx.el.querySelector('#ntForm');
    const err = form.querySelector('.form-error');
    TripUI.wireForm(form, form);
    const files = form.querySelector('#ntFiles');
    const val = (n) => { const el = form.querySelector(`[name=${n}]`); if (!el) return ''; return el.tagName === 'SELECT' ? (el.value ? el.selectedOptions[0].textContent : '') : el.value.trim(); };
    const summary = () => {
      const pinned = (k) => form.querySelector(`[name=${k}_lat]`).value ? ' <span class="badge-s green">pinned</span>' : '';
      const rows = [['Client', UI.esc(val('client_id'))], ['Truck type', UI.esc(val('truck_type'))], ['Schedule', val('scheduled_at') ? UI.datetime(val('scheduled_at').replace('T', ' ')) : ''],
        ['Pickup', UI.esc(val('pickup_point')) + (val('pickup_point') ? pinned('pickup') : '')], ['Destination', UI.esc(val('delivery_point')) + (val('delivery_point') ? pinned('delivery') : '')],
        ['Distance', val('distance_km') ? UI.num(val('distance_km'), 2) + ' km' : ''], ['Files', files.files.length ? files.files.length + ' file(s)' : 'none']];
      form.querySelector('#ntSum').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v || '<span class="text-muted">—</span>'}</dd>`).join('');
      form.querySelector('#ntFileList').innerHTML = [...files.files].map(f => `<li><i class="bi bi-paperclip"></i><div>${UI.esc(f.name)}<div class="cell-sub">${UI.num(f.size / 1024, 0)} KB</div></div></li>`).join('');
    };
    form.addEventListener('input', summary); form.addEventListener('change', summary);
    form.querySelectorAll('[name=pickup_point],[name=delivery_point]').forEach(x => x.addEventListener('input', () => { form.querySelector('#ntConfirm').checked = false; }));
    // Map pins set the hidden lat/lng fields from code (no input event), so refresh the summary briefly while the page is open.
    const tick = setInterval(() => { if (document.body.contains(form)) summary(); else clearInterval(tick); }, 1500);
    summary();
    form.querySelector('[data-cancel]').onclick = () => App.go('trips');
    const fail = (msg, el) => { err.textContent = msg; err.style.display = 'block'; if (el) { el.classList.add('is-invalid'); el.focus(); } else window.scrollTo({ top: 0, behavior: 'smooth' }); };
    form.onsubmit = async (e) => {
      e.preventDefault(); err.style.display = 'none';
      form.querySelectorAll('.is-invalid').forEach(x => x.classList.remove('is-invalid'));
      const missing = [...form.querySelectorAll('[required]')].filter(x => x.offsetParent !== null).find(x => !String(x.value).trim());
      if (missing) return fail('Please fill in: ' + (form.querySelector(`label[for="${missing.id}"]`)?.textContent || missing.name).replace(/\s*\*$/, ''), missing);
      const big = [...files.files].find(f => f.size > 10000000); if (big) return fail(big.name + ' is larger than 10 MB.', files);
      if (!form.querySelector('#ntConfirm').checked) return fail('Please check the pickup and destination addresses, then tick the confirmation box.', form.querySelector('#ntConfirm'));
      const btn = form.querySelector('button[type=submit]'), label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
      try {
        const r = await App.apiForm('Trips.create', UI.formData(form), form);
        UI.result(r); App.go('trips', r.trip_id ? { open: r.trip_id } : {});
      } catch (x) { fail(x.message); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    };
  },
  review(t) {
    const wrap = UI.modal('Review request ' + UI.esc(t.trip_ref), `<div class="small text-muted mb-2">Requested by ${UI.esc(t.created_by_name)} for <b>${UI.esc(t.client)}</b>. Complete the truck type, km and details, then confirm. The system assigns the truck and crew.</div>
      ${TripUI.datalists()}${UI.fields(TripUI.deliveryFields(t, { needsKm: true }))}`,
      async (d) => { const r = await App.api('Trips.review', { ...d, trip_id: t.id, decision: 'approve' }); UI.result(r); UI.closeDrawer(); App.route(); },
      { submit: 'Confirm and auto-assign', onShow: (w, f) => TripUI.wireForm(w, f, t), extraFooter: '<button type="button" class="btn btn-outline-danger btn-sm me-auto" id="rvReject">Reject request</button>' });
    wrap.querySelector('#rvReject').onclick = () => { bootstrap.Modal.getInstance(wrap).hide();
      UI.confirmAction('Reject request ' + UI.esc(t.trip_ref), 'The dispatcher will be notified.', 'Trips.review', { trip_id: t.id, decision: 'reject' }, { danger: true, submit: 'Reject', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] }); };
  },
  edit(t) {
    if (UI.role('operations_head')) {
      UI.modal('Edit trip ' + UI.esc(t.trip_ref), TripUI.datalists() + UI.fields(TripUI.deliveryFields(t, { needsKm: true }).filter(f => f.name !== 'truck_type')),
        async (d) => { const r = await App.api('Trips.edit', { ...d, trip_id: t.id }); UI.result(r); TripUI.open(t.id); App.route(); },
        { onShow: (w, f) => { UI.mapPicker(w.querySelector('[data-mapbox]'), f, t); w.querySelector('[data-avail]').remove(); } });
    } else {
      UI.formModal('Trip details ' + UI.esc(t.trip_ref), [
        { name: 'booking_reference', label: 'Booking / nomination details', value: t.booking_reference, col: 6 }, { name: 'units_planned', label: 'Units (car carrier)', type: 'number', min: 1, value: t.units_planned, col: 6 },
        { name: 'container_number', label: 'Container no.', value: t.container_number, col: 4 }, { name: 'container_size', label: 'Container size', value: t.container_size, col: 4 },
        { name: 'seal_number', label: 'Seal no.', value: t.seal_number, col: 4 }, { name: 'shipment_number', label: 'Shipment no.', value: t.shipment_number, col: 6 },
        { name: 'delivery_details', label: 'Delivery details', type: 'textarea', value: t.delivery_details, col: 12 }],
        'Trips.edit', { extra: { trip_id: t.id }, after: () => { TripUI.open(t.id); App.route(); } });
    }
  },
  reassign(t) {
    const d = TripUI.data;
    const trucks = (d.trucks || []).filter(v => v.truck_type === t.truck_type);
    const label = (ok, txt, why) => ok ? txt : `${txt} — ${why}`;
    const truckOpts = trucks.map(v => { const mine = String(v.id) === String(t.vehicle_id); const ok = mine || (v.status === 'Available' && !v.on_trip);
      return [v.id, label(ok, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '') + (mine ? ' (current)' : ''), v.on_trip ? 'on ' + v.on_trip : v.status)]; });
    const people = (type, cur) => (d.crew || []).filter(p => p.person_type === type).map(p => { const mine = [t.driver_id, t.driver2_id, t.helper_id].map(String).includes(String(p.id));
      const ok = mine || (p.availability === 'Available' && !p.on_trip); return [p.id, label(ok, p.full_name + (mine ? ' (current)' : ''), p.on_trip ? 'on ' + p.on_trip : p.availability)]; });
    UI.formModal('Change assignment of ' + UI.esc(t.trip_ref), [
      { name: 'vehicle_id', label: 'Truck (' + t.truck_type + ')', type: 'select', options: truckOpts, value: t.vehicle_id, required: true, col: 12 },
      { name: 'driver_id', label: 'Driver', type: 'select', options: people('Driver'), value: t.driver_id, required: true, col: 6 },
      t.truck_type === 'Car Carrier' ? { name: 'driver2_id', label: 'Driver 2', type: 'select', options: people('Driver'), value: t.driver2_id, col: 6 }
        : { name: 'helper_id', label: 'Helper', type: 'select', options: people('Helper'), value: t.helper_id, required: true, col: 6 },
      { name: 'reason', label: 'Reason for the change', required: true, col: 12 }],
      'Trips.reassign', { extra: { trip_id: t.id }, intro: 'Busy or unavailable trucks and people are marked; the system refuses them.', after: () => { TripUI.open(t.id); App.route(); } });
  },
  checklist(t) {
    const secs = TripUI.data.checklist || [];
    const body = `<div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2"><div class="small text-muted">Truck <b>${UI.esc(t.plate_number)}</b>. Mark every item OK or NOT OK. Any NOT OK item keeps the trip from being Ready for Dispatch.</div>
      <button type="button" class="btn btn-sm btn-outline-success" id="chkAll"><i class="bi bi-check2-all"></i> Mark all OK</button></div>
      ${secs.map(s => `<div class="chk-sec"><h6>${UI.esc(s.title)}</h6>${s.items.map((label, i) => { const k = s.key + '_' + String(i + 1).padStart(2, '0');
        return `<div class="chk-row" data-k="${k}"><span>${UI.esc(label)}</span><div class="btn-group" role="group">
          <input type="radio" class="btn-check" name="c_${k}" id="ok_${k}" value="OK"><label class="btn btn-outline-success" for="ok_${k}">OK</label>
          <input type="radio" class="btn-check" name="c_${k}" id="no_${k}" value="NOT OK"><label class="btn btn-outline-danger" for="no_${k}">NOT OK</label></div>
          <input class="form-control form-control-sm" placeholder="Remarks" data-rem="${k}" maxlength="250"></div>`; }).join('')}</div>`).join('')}
      ${UI.fields([{ name: 'odometer_km', label: 'Odometer (km)', type: 'number', col: 4 }, { name: 'fuel_level', label: 'Fuel level', type: 'select', options: UI.list(['Full', '3/4', '1/2', '1/4', 'Low']), col: 4 },
        { name: 'remarks', label: 'Remarks', col: 4 }])}`;
    UI.modal('Pre-dispatch checklist ' + UI.esc(t.trip_ref), body, async (d, form) => {
      const items = {}; const missing = [];
      form.querySelectorAll('.chk-row').forEach(r => { const k = r.dataset.k; const v = form.querySelector(`input[name="c_${k}"]:checked`);
        if (!v) missing.push(r.firstElementChild.textContent); items[k] = { condition: v ? v.value : '', remarks: form.querySelector(`[data-rem="${k}"]`).value }; });
      if (missing.length) throw new Error('Mark OK or NOT OK for: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' and ' + (missing.length - 5) + ' more' : ''));
      const r = await App.api('Trips.checklist', { trip_id: t.id, items, meta: {}, odometer_km: d.odometer_km, fuel_level: d.fuel_level, remarks: d.remarks });
      UI.result(r); TripUI.open(t.id); App.route();
    }, { size: 'modal-xl', submit: 'Submit checklist', onShow: (w) => {
      w.querySelector('#chkAll').onclick = () => w.querySelectorAll('input[value=OK]').forEach(x => { x.checked = true; x.closest('.chk-row').classList.remove('bad'); });
      w.addEventListener('change', (e) => { if (e.target.classList.contains('btn-check')) e.target.closest('.chk-row').classList.toggle('bad', e.target.value === 'NOT OK'); });
    } });
  },
  complete(t) {
    const cc = t.truck_type === 'Car Carrier';
    const body = `<div class="small text-muted mb-2">Record the completion details and attach the supporting documents. <b>Complete Trip</b> stays disabled until everything required is there.</div>
      ${UI.fields([
        { name: 'completed_at', label: 'Actual completion date and time', type: 'datetime', value: (() => { const x = new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); })(), required: true, col: 6 },
        { name: 'waybill_number', label: 'Waybill no.', required: true, col: 6, value: t.waybill_number },
        ...(cc ? [{ name: 'units_delivered', label: 'Units delivered', type: 'number', min: 1, value: t.units_planned, required: true, col: 6 }] : []),
        { name: 'delivery_notes', label: 'Delivery / return notes', col: cc ? 6 : 12 },
        { name: 'waybill', label: 'Waybill file (PDF or photo)' + (+t.waybill_docs ? ' — already attached: ' + t.waybill_docs : ''), type: 'file', col: 6, attrs: 'accept="application/pdf,image/*"' },
        { name: 'ack_receipt', label: 'Acknowledgement receipt file' + (+t.ar_docs ? ' — already attached: ' + t.ar_docs : ''), type: 'file', col: 6, attrs: 'accept="application/pdf,image/*"' },
        { name: 'other', label: 'Other documents (optional)', type: 'file', multiple: true, col: 12, attrs: 'accept="application/pdf,image/*"' }])}
      <ul class="req-list" data-req></ul>`;
    UI.modal('Complete trip ' + UI.esc(t.trip_ref), body, async (d, form) => {
      const r = await App.apiForm('Trips.complete', { ...d, trip_id: t.id }, form); UI.result(r); TripUI.open(t.id); App.route();
    }, { submit: 'Complete Trip', onShow: (w, form) => {
      const btn = form.querySelector('button[type=submit]');
      const check = () => {
        const has = (n) => form.querySelector(`[name=${n}]`).files.length > 0;
        const items = [['Completion date and time', !!form.completed_at.value], ['Waybill number', !!form.waybill_number.value.trim()],
          ...(cc ? [['Units delivered', +form.units_delivered.value > 0]] : []),
          ['Waybill file', has('waybill') || +t.waybill_docs > 0], ['Acknowledgement receipt file', has('ack_receipt') || +t.ar_docs > 0]];
        w.querySelector('[data-req]').innerHTML = items.map(([l, ok]) => `<li class="${ok ? 'ok' : 'no'}"><i class="bi ${ok ? 'bi-check-circle-fill' : 'bi-x-circle'}"></i> ${UI.esc(l)}${ok ? '' : ' — missing'}</li>`).join('');
        btn.disabled = items.some(x => !x[1]);
      };
      form.addEventListener('input', check); form.addEventListener('change', check); check();
    } });
  },
  incident(t) {
    const x = new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    UI.formModalFiles('Incident report ' + UI.esc(t.trip_ref), [
      { name: 'incident_type', label: 'Incident type', type: 'select', options: UI.list(TripUI.data.incidentTypes), required: true, col: 6 },
      { name: 'incident_at', label: 'Incident date and time', type: 'datetime', value: x.toISOString().slice(0, 16), required: true, col: 6 },
      { name: 'location', label: 'Location of the incident', required: true, col: 6 },
      { name: 'persons_involved', label: 'Persons involved', col: 6, value: [t.driver_name, t.driver2_name, t.helper_name].filter(Boolean).join(', ') },
      { name: 'problem', label: 'Reported problem or damage', required: true, col: 6 },
      { name: 'reason', label: 'Reason / cause (if known)', col: 6 },
      { name: 'details', label: 'Incident details', type: 'textarea', rows: 4, required: true, col: 12 },
      { name: 'photos', label: 'Photos (optional)', type: 'file', multiple: true, col: 6, attrs: 'accept="image/*"' },
      { name: 'attachments', label: 'Police report / other documents (optional)', type: 'file', multiple: true, col: 6, attrs: 'accept="application/pdf,image/*"' }],
      'Trips.incident', { extra: { trip_id: t.id }, intro: 'The driver called in the breakdown. This puts the trip On Hold and sends the report to Maintenance.', submit: 'Submit incident report',
        after: () => { TripUI.open(t.id); App.route(); } });
  },
  progress(t) {
    UI.formModal('Trip update ' + UI.esc(t.trip_ref), [
      { name: 'update_type', label: 'Type', type: 'select', options: UI.list(TripUI.data.updateTypes), required: true, col: 6, value: 'Progress' },
      { name: 'delay_cause', label: 'Delay cause (for Delay)', type: 'select', options: UI.list(TripUI.data.delayCauses), col: 6 },
      { name: 'note', label: 'Note', type: 'textarea', required: true, col: 12 }], 'Trips.progress', { extra: { trip_id: t.id }, after: () => { TripUI.open(t.id); App.route(); } });
  },

  printIncident(i, t) {
    UI.printForm('INCIDENT REPORT', `<div class="pf-grid"><div><b>NAME:</b> ${UI.esc(i.reported_by_name)}</div><div><b>DATE:</b> ${UI.date(i.created_at)}</div>
      <div><b>DEPARTMENT:</b> Operations</div><div><b>REFERENCE:</b> ${UI.esc(i.incident_ref)} / ${UI.esc(t.trip_ref || i.trip_ref || '')}</div></div>
      <div class="pf-grid"><div><b>INCIDENT TYPE:</b> ${UI.esc(i.incident_type)}</div><div><b>TRUCK:</b> ${UI.esc(t.plate_number || i.plate_number || '')}</div>
      <div><b>INCIDENT DATE:</b> ${UI.date(i.incident_at)}</div><div><b>TIME:</b> ${UI.esc(String(i.incident_at).slice(11, 16))}</div>
      <div style="grid-column:1/3"><b>LOCATION / PERSON/S INVOLVED IN INCIDENT:</b> ${UI.esc(i.location)}${i.persons_involved ? ' / ' + UI.esc(i.persons_involved) : ''}</div>
      <div style="grid-column:1/3"><b>REASON:</b> ${UI.esc(i.reason || '')}</div></div>
      <div><b>INCIDENT DETAILS:</b></div><div class="pf-box" style="min-height:160px">${UI.esc(i.problem)}\n\n${UI.esc(i.details)}</div>
      <div class="pf-signs">${UI.sign('Reported by (name and signature)', i.reported_by_name, i.reported_by)}${UI.sign('Received by (name and signature)', i.assessed_by_name || '', i.assessed_by)}</div>
      <div class="mt-2"><b>RECOMMENDATION:</b></div><div class="pf-box">${UI.esc(i.recommendation || '')}${i.severity ? '\nAssessment: ' + UI.esc(i.severity) + ' damage' : ''}</div>
      <div class="pf-signs">${UI.sign('Recommended by (name and signature)')}${UI.sign('Approved by (name and signature)')}</div>`, { number: i.incident_ref });
  },

  // ------------------------------------------------------------------ details drawer
  async open(id) {
    let r;
    try { r = await App.api('Trips.details', { trip_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const t = r.trip, me = App.me.user, mine = UI.isDispatcher() && t.dispatcher_role === me.role, ops = UI.role('operations_head');
    const [st, warn] = TripUI.stage(t);
    const btn = (act, label, cls = 'outline-primary', icon = '', disabled = false) => `<button class="btn btn-sm btn-${cls}" data-tact="${act}" ${disabled ? 'disabled' : ''}>${icon ? `<i class="bi ${icon}"></i> ` : ''}${UI.esc(label)}</button>`;
    const acts = [];
    let why = '';
    const pre = ['Awaiting Resources', 'Pre-Assigned', 'Ready for Dispatch', 'For Reschedule'];
    if (ops) {
      if (t.status === 'Pending Review') acts.push(btn('review', 'Review and confirm', 'primary', 'bi-clipboard-check'));
      if (t.status === 'Awaiting Resources') acts.push(btn('auto', 'Try auto-assign now', 'primary', 'bi-magic'));
      if (pre.includes(t.status)) acts.push(btn('reassign', 'Change assignment', 'outline-primary', 'bi-arrow-left-right'), btn('edit', 'Edit details', 'outline-secondary', 'bi-pencil'));
      if (['Pending Review', ...pre].includes(t.status)) acts.push(btn('cancel', 'Cancel trip', 'outline-danger', 'bi-x-circle'));
    }
    if (mine) {
      const curFund = r.funds.find(f => +f.attempt_number === +t.attempt_number);
      if (['Pre-Assigned', 'Ready for Dispatch'].includes(t.status) && (!curFund || curFund.status === 'Rejected')) acts.push(btn('fund', curFund ? 'Revise fund request' : 'Submit fund request', 'primary', 'bi-cash-coin'));
      if (t.status === 'Pre-Assigned') acts.push(btn('checklist', 'Pre-dispatch checklist', 'primary', 'bi-ui-checks'));
      if (['Pre-Assigned', 'Ready for Dispatch'].includes(t.status)) {
        const blocked = t.dispatch_blockers.length > 0;
        acts.push(btn('dispatch', +t.attempt_number > 1 ? 'Confirm Redispatch' : 'Confirm Dispatch', blocked ? 'secondary' : 'success', 'bi-send', blocked));
        if (blocked) why = 'Confirm Dispatch is enabled when: ' + t.dispatch_blockers.join(' ');
      }
      if (['Dispatched', 'In Transit'].includes(t.status)) acts.push(btn('complete', 'Complete trip', 'success', 'bi-flag'), btn('incident', 'Report incident', 'outline-danger', 'bi-exclamation-triangle'));
      if (t.status === 'On Hold - Incident Reported') {
        const ok = t.incident_status === 'Repaired - Cleared to Continue';
        acts.push(btn('resume', 'Resume trip', ok ? 'success' : 'secondary', 'bi-play-circle', !ok));
        if (!ok) why = 'Resume is enabled after Maintenance confirms the on-site repair (now: ' + t.incident_status + ').';
      }
      if (t.status === 'For Reschedule') {
        const ok = t.truck_status === 'Assigned' || !t.vehicle_id;
        acts.push(btn('reschedule', 'Reschedule trip', ok ? 'primary' : 'secondary', 'bi-calendar-plus', !ok));
        if (!ok) why = 'The truck is ' + t.truck_status + '. Reschedule after Maintenance confirms the repair (or the Operations Head assigns another truck).';
      }
      if (t.status === 'Awaiting Resources') acts.push(btn('auto', 'Try auto-assign now', 'outline-primary', 'bi-magic'));
      if (!['Completed', 'Cancelled', 'Rejected', 'Pending Review'].includes(t.status)) acts.push(btn('progress', 'Add update / delay', 'outline-secondary', 'bi-chat-left-text'), btn('edit', 'Booking / container details', 'outline-secondary', 'bi-pencil'));
    }
    const fund = r.funds.find(f => +f.attempt_number === +t.attempt_number);
    const ins = r.inspections.find(i => +i.attempt_number === +t.attempt_number);
    const crew = [['Driver', t.driver_name], ...(t.truck_type === 'Car Carrier' ? [['Driver 2', t.driver2_name]] : [['Helper', t.helper_name]])];
    let checklistHtml = '<div class="text-muted small">Not done yet.</div>';
    if (ins) {
      const items = JSON.parse(ins.items_json || '{}').items || {};
      const bad = []; (TripUI.data.checklist || []).forEach(s => s.items.forEach((label, i) => { const k = s.key + '_' + String(i + 1).padStart(2, '0'); if (items[k] && items[k].condition === 'NOT OK') bad.push(label + (items[k].remarks ? ' (' + items[k].remarks + ')' : '')); }));
      checklistHtml = UI.kv([['Result', bad.length ? '<span class="badge-s red">NOT OK items</span>' : '<span class="badge-s green">All 57 items OK</span>'], ['Done by', UI.e(ins.actor) + ' · ' + UI.datetime(ins.completed_at)],
        ['Odometer / fuel', UI.e(ins.odometer_km) + ' km · ' + UI.e(ins.fuel_level)], bad.length ? ['NOT OK', UI.esc(bad.join('; '))] : null, ins.remarks ? ['Remarks', UI.esc(ins.remarks)] : null]);
    }
    const html = `${UI.steps(TripUI.STAGES, st, { warn })}
      <div class="d-flex flex-wrap gap-1 align-items-center mb-1">${UI.badge(t.status)} ${TripUI.flags(t)}</div>
      <div class="small text-muted">${UI.esc(TripUI.next(t))}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}${why ? `<div class="why"><i class="bi bi-info-circle"></i> ${UI.esc(why)}</div>` : ''}</div>` : ''}
      ${UI.h('Trip')}
      ${UI.kv([['Client', `<b>${UI.esc(t.client)}</b>${t.consignee ? ' · ' + UI.esc(t.consignee) : ''}`], ['Route', `${UI.esc(t.pickup_point)} <i class="bi bi-arrow-right"></i> ${UI.esc(t.delivery_point)}`],
        ['Billable distance', t.distance_km ? UI.num(t.distance_km, 2) + ' km' + (t.fuel_estimate ? ` <span class="text-muted small">(est. diesel ${UI.money(t.fuel_estimate)})</span>` : '') : '—'],
        ['Schedule', UI.datetime(t.scheduled_at)], ['Truck type', UI.e(t.truck_type)], ['Truck', t.plate_number ? `<b>${UI.esc(t.plate_number)}</b>${t.truck_number ? ' #' + UI.esc(t.truck_number) : ''} ${UI.badge(t.truck_status)}` : '—'],
        ...crew.map(([l, v]) => [l, UI.e(v)]), ['Dispatcher team', UI.e(UI.label(t.dispatcher_role))], ['Dispatched by', UI.e(t.dispatcher_name)],
        ['Delivery details', UI.e(t.delivery_details)], ['Booking / nomination', UI.e(t.booking_reference)],
        t.truck_type === 'Car Carrier' ? ['Units', UI.e(t.units_planned) + (t.units_delivered ? ' planned · ' + t.units_delivered + ' delivered' : '')] : ['Container / seal / shipment', [t.container_number, t.container_size, t.seal_number, t.shipment_number].filter(Boolean).map(UI.esc).join(' · ') || '—'],
        ['Created', UI.e(t.created_by_name) + ' (' + UI.esc(t.intake_source) + ') · ' + UI.datetime(t.created_at)], t.cancel_reason ? ['Cancel / reject reason', UI.esc(t.cancel_reason)] : null])}
      <div class="route-map" data-routemap></div>
      ${UI.h('Fund request', fund ? `<button class="btn btn-sm btn-link p-0" data-tact="printfund">Print request form</button>` : '')}
      ${fund ? UI.kv([['Reference', UI.esc(fund.fund_ref)], ['Status', UI.badge(fund.status)], ['Amount', UI.money(fund.amount)], ['Breakdown', fund.lines.map(l => UI.esc(l.category_name) + ' ' + UI.money(l.amount)).join('<br>')],
          ['Requested', UI.e(fund.requested_by_name)], ['Approved', UI.e(fund.approved_by_name)], ['Released', fund.released_at ? UI.e(fund.released_by_name) + ' · ' + UI.datetime(fund.released_at) : '—'],
          fund.rejected_reason ? ['Rejected because', UI.esc(fund.rejected_reason)] : null])
        : `<div class="text-muted small">${+t.attempt_number > 1 ? 'No new fund request for this attempt (optional for a redispatch).' : 'No fund request yet.'}</div>`}
      ${UI.h('Pre-dispatch checklist' + (+t.attempt_number > 1 ? ' (attempt #' + t.attempt_number + ')' : ''))}${checklistHtml}
      ${r.incidents.length ? UI.h('Incidents') + r.incidents.map(i => `<div class="border rounded p-2 mb-2 small"><div class="d-flex justify-content-between"><b>${UI.esc(i.incident_ref)} · ${UI.esc(i.incident_type)}</b>${UI.badge(i.status)}</div>
          ${UI.esc(i.problem)} @ ${UI.esc(i.location)} · ${UI.datetime(i.incident_at)}<br>Severity: ${UI.e(i.severity)}${i.recommendation ? ' · ' + UI.esc(i.recommendation) : ''} · Maintenance record ${UI.e(i.job_ref)} (${UI.e(i.job_status)})
          <div><button class="btn btn-link btn-sm p-0" data-printinc="${i.id}">Print Incident Report Form</button></div></div>`).join('') : ''}
      ${t.status === 'Completed' ? UI.h('Completion') + UI.kv([['Completed', UI.datetime(t.completed_at)], ['Waybill no.', UI.e(t.waybill_number)], ['Notes', UI.e(t.delivery_notes)],
          r.billing ? ['Billing', UI.badge(r.billing.status) + ' ' + UI.money(r.billing.total_amount)] : null]) : ''}
      ${UI.h('Updates and delays')}${r.updates.length ? `<ul class="timeline">${r.updates.map(u => `<li><span class="when">${UI.datetime(u.created_at)} · ${UI.esc(u.actor)}</span><br><b>${UI.esc(u.update_type)}</b>${u.delay_cause ? ' (' + UI.esc(u.delay_cause) + ')' : ''}: ${UI.esc(u.note)}</li>`).join('')}</ul>` : '<div class="text-muted small">No updates.</div>'}
      ${UI.h('Documents')}${UI.docs(r.documents)}
      ${UI.h('History')}<ul class="timeline">${r.events.map(e => `<li><span class="when">${UI.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</span><br>${UI.esc(e.event_type)}${e.from_status !== e.to_status && e.to_status ? ` <span class="text-muted">(${UI.esc(e.from_status || 'new')} → ${UI.esc(e.to_status)})</span>` : ''}${e.notes ? '<br><span class="text-muted">' + UI.esc(e.notes) + '</span>' : ''}</li>`).join('')}</ul>`;
    const el = UI.drawer('Trip ' + UI.esc(t.trip_ref), html, { subtitle: UI.esc(t.client) });
    UI.routeMap(el.querySelector('[data-routemap]'), t);
    el.querySelectorAll('[data-printinc]').forEach(b => b.onclick = () => TripUI.printIncident(r.incidents.find(i => String(i.id) === b.dataset.printinc), t));
    el.querySelectorAll('[data-tact]').forEach(b => b.onclick = () => {
      const a = b.dataset.tact;
      if (a === 'review') TripUI.review(t);
      if (a === 'auto') App.api('Trips.auto_assign', { trip_id: t.id }).then(x => { UI.result(x); TripUI.open(t.id); App.route(); }).catch(e => UI.toast(e.message, 'error'));
      if (a === 'reassign') TripUI.reassign(t);
      if (a === 'edit') TripUI.edit(t);
      if (a === 'cancel') UI.confirmAction('Cancel ' + UI.esc(t.trip_ref), 'The truck and crew are freed. A released fund must be liquidated by Finance.', 'Trips.cancel', { trip_id: t.id }, { danger: true, submit: 'Cancel trip', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
      if (a === 'fund') { const old = r.funds.find(f => +f.attempt_number === +t.attempt_number);
        UI.fundForm({ title: 'Fund request for ' + t.trip_ref, categories: TripUI.data.fundCategories, action: 'Funds.submit', payload: { trip_id: t.id },
          selected: old ? old.lines.filter(l => +l.is_preset).map(l => l.category_name) : [], extra: old ? old.lines.filter(l => !+l.is_preset).map(l => ({ name: l.category_name, amount: l.amount })) : [],
          intro: old && old.rejected_reason ? 'Rejected because: ' + UI.esc(old.rejected_reason) + '. Revise and resubmit.' : 'Choose the applicable expenses. The system takes the preset amounts and computes the total.',
          after: () => { TripUI.open(t.id); App.route(); } }); }
      if (a === 'checklist') TripUI.checklist(t);
      if (a === 'dispatch') UI.confirmAction((+t.attempt_number > 1 ? 'Confirm Redispatch ' : 'Confirm Dispatch ') + UI.esc(t.trip_ref), 'Confirm only when the truck is actually leaving. The billing draft is generated now.', 'Trips.dispatch', { trip_id: t.id }, { submit: 'Confirm' });
      if (a === 'complete') TripUI.complete(t);
      if (a === 'incident') TripUI.incident(t);
      if (a === 'resume') UI.confirmAction('Resume ' + UI.esc(t.trip_ref), 'The trip continues (In Transit). This is not a second attempt.', 'Trips.resume', { trip_id: t.id }, { submit: 'Resume trip' });
      if (a === 'reschedule') UI.formModal('Reschedule ' + UI.esc(t.trip_ref), [{ name: 'scheduled_at', label: 'New dispatch schedule', type: 'datetime', required: true, col: 12 }], 'Trips.reschedule',
        { extra: { trip_id: t.id }, intro: 'After rescheduling, do the pre-dispatch checklist again. Confirm Redispatch records the Second Attempt.', after: () => { TripUI.open(t.id); App.route(); } });
      if (a === 'progress') TripUI.progress(t);
      if (a === 'printfund') FundUI.print(fund.id);
    });
  },
};

App.page('trips', {
  title: 'Trip Management',
  subtitle: 'Create trips, follow their progress and do the next step. Click a trip for details.',
  render(ctx) {
    const d = TripUI.data = ctx.data;
    if (ctx.query.new && d.can.create) return TripUI.newPage(ctx);
    if (d.can.create) {
      const b = document.createElement('button'); b.className = 'btn btn-sm btn-primary';
      b.innerHTML = `<i class="bi bi-plus-lg"></i> ${UI.role('operations_head') ? 'New trip' : 'New trip request'}`; b.onclick = () => App.go('trips', { new: 1 }); ctx.tools.append(b);
    }
    const counts = (s) => d.active.filter(t => s.includes(t.status)).length;
    ctx.el.innerHTML = UI.cards([
      { label: 'Waiting (review / resources)', value: counts(['Pending Review', 'Awaiting Resources']), icon: 'bi-hourglass-split', color: 'amber' },
      { label: 'Preparing (fund & checklist)', value: counts(['Pre-Assigned', 'Ready for Dispatch']), icon: 'bi-ui-checks', color: 'blue' },
      { label: 'On the road', value: counts(['Dispatched', 'In Transit']), icon: 'bi-truck', color: 'green' },
      { label: 'Problems (incident / reschedule)', value: counts(['On Hold - Incident Reported', 'For Reschedule']), icon: 'bi-exclamation-triangle', color: 'red' },
    ]);
    const filterFields = [
      { name: 'from', label: 'Schedule from', type: 'date', col: 6 }, { name: 'to', label: 'Schedule to', type: 'date', col: 6 },
      { name: 'q', label: 'Search (trip no., place, waybill, booking)', col: 12 },
      { name: 'status', label: 'Status', type: 'select', options: UI.list(['Completed', 'Cancelled', 'Rejected']), col: 6 },
      { name: 'truck_type', label: 'Truck type', type: 'select', options: UI.list(App.me.truckTypes), col: 6 },
      { name: 'client_id', label: 'Client', type: 'select', options: UI.opts(d.filterOptions.clients, c => c.company_name), col: 6 },
      { name: 'vehicle_id', label: 'Truck', type: 'select', options: UI.opts(d.filterOptions.trucks, v => v.plate_number), col: 6 },
      { name: 'person_id', label: 'Driver / helper', type: 'select', options: UI.opts(d.filterOptions.drivers, p => p.full_name + ' (' + p.person_type + ')'), col: 6 },
      { name: 'dispatcher_id', label: 'Dispatcher', type: 'select', options: UI.opts(d.filterOptions.dispatchers, u => u.full_name), col: 6 },
    ];
    const tabs = [
      ['active', `Active trips (${d.active.length})`, (body) => {
        body.innerHTML = `<div class="board-tools"><div class="table-search"><i class="bi bi-search"></i><input class="form-control form-control-sm" type="search" placeholder="Search trip no., client, place, truck…" id="tbSearch" aria-label="Search active trips"></div>
          ${['operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'finance', 'motorpool'].includes(App.me.user.role) ? '<div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="tbMine"><label class="form-check-label small" for="tbMine">Only trips waiting for me</label></div>' : ''}
          <span class="small text-muted ms-auto" id="tbCount"></span></div><div class="trip-board" id="tbBoard"></div>`;
        const draw = () => {
          const q = (body.querySelector('#tbSearch').value || '').toLowerCase(), mineOnly = body.querySelector('#tbMine')?.checked;
          const rows = d.active.filter(t => (!q || [t.trip_ref, t.client, t.pickup_point, t.delivery_point, t.plate_number, t.driver_name, t.status, t.consignee].join(' ').toLowerCase().includes(q)) && (!mineOnly || TripUI.needsMe(t)));
          body.querySelector('#tbCount').textContent = rows.length + ' trip(s)';
          body.querySelector('#tbBoard').innerHTML = rows.length ? rows.map(TripUI.card).join('') : `<div class="panel" style="grid-column:1/-1"><div class="table-empty"><i class="bi bi-signpost-split"></i>${d.active.length ? 'No active trip matches the search.' : 'No active trips.' + (d.can.create ? ' Use “New trip” to encode a client delivery.' : '')}</div></div>`;
          body.querySelectorAll('[data-trip]').forEach(c => c.onclick = () => TripUI.open(c.dataset.trip));
        };
        body.querySelector('#tbSearch').oninput = draw; body.querySelector('#tbMine')?.addEventListener('change', draw); draw();
      }],
      ['history', 'Completed and closed', (body) => {
        body.innerHTML = (UI.filterModal(ctx, filterFields, { note: 'Filters apply to completed, cancelled and rejected trips.' }) || '') + UI.table([
          ['Trip', 'trip_ref'], ['Status', 'status', 'badge'], ['Client', 'client'], ['Type', 'truck_type'], ['Truck', 'plate_number'], ['Driver', 'driver_name'],
          ['From', 'pickup_point'], ['To', 'delivery_point'], ['Schedule', 'scheduled_at', 'datetime'], ['Completed', 'completed_at', 'datetime'], ['Waybill', 'waybill_number'], ['Billing', 'billing_status', 'badge']],
          d.history, { title: 'Trip records', actions: () => UI.btn('view', 'View', 'outline-primary'), onAction: (a, t) => TripUI.open(t.id), empty: 'No trips match.' });
      }],
      ['incidents', `Incidents (${d.incidents.filter(i => i.status !== 'Resolved').length} open)`, (body) => {
        body.innerHTML = UI.table([['Incident', 'incident_ref'], ['When', 'incident_at', 'datetime'], ['Trip', 'trip_ref'], ['Truck', 'plate_number'], ['Type', 'incident_type'], ['Problem', 'problem'],
          ['Location', 'location'], ['Severity', 'severity', 'badge'], ['Status', 'status', 'badge'], ['Reported by', 'reported_by_name']], d.incidents,
          { title: 'Incident reports', actions: () => UI.btn('trip', 'Open trip') + UI.btn('print', 'Print form', 'outline-secondary'),
            onAction: (a, i) => a === 'trip' ? TripUI.open(i.trip_id) : TripUI.printIncident(i, {}) });
      }],
    ];
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, tabs, ctx.query.q || ctx.query.status || ctx.query.from ? 'history' : null);
    const once = UI.takeQuery(ctx, 'open');
    if (once.open) TripUI.open(once.open);
  },
});
