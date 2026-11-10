/* Unified Operations trip workspace. Uses the existing create_batch contract and distance widget. */
'use strict';

TripUI.create = () => App.go('trips', { new: 1 });
TripUI.batchPage = ctx => TripUI.newPage(ctx); // Preserve bookmarked planning links.
TripUI.newPage = function(ctx) {
  const isOps = UI.role('operations_head'), entries = [], limit = 20;
  let editing = null, busy = false, form, baseline;
  ctx.setTitle('New Trip', 'Add independent entries, expand quantities, then review each trip before submitting.');
  ctx.el.innerHTML = `<div class="ops-planner"><div class="alert alert-info small">Choose an approved route for the selected client and truck type. Pending route requests are not approved routes. Map and manual distance tools remain available; using them does not establish route approval.</div>
    <div data-editor></div><section class="panel mt-3" aria-label="Trip entries"><div class="panel-head"><h2 class="panel-title">Trips to review</h2><span data-count aria-live="polite"></span></div>
    <div class="panel-body"><div data-queue></div><div data-results role="status"></div><div class="d-flex gap-2 mt-3 flex-wrap"><button type="button" class="btn btn-primary" data-review>Review trips</button><button type="button" class="btn btn-outline-secondary" data-exit>Back to Active Trips</button></div></div></section></div>`;
  const editor = ctx.el.querySelector('[data-editor]'), queue = ctx.el.querySelector('[data-queue]');
  const results = ctx.el.querySelector('[data-results]'), review = ctx.el.querySelector('[data-review]');
  const clientName = v => (TripUI.data.clients || []).find(c => String(c.id) === String(v.client_id))?.company_name || '';
  const routeBadge = v => v.client_route_id ? '<span class="badge-s green">Approved route selected</span>' : '<span class="badge-s amber">No approved route selected · follow-up required</span>';
  const pending = () => entries.filter(x => !x.result?.trip_id);
  const fail = message => { const e = form.querySelector('.form-error'); e.textContent = message; e.style.display = 'block'; e.scrollIntoView({ block: 'center' }); };
  const dirty = () => UI.modalEditSnapshot(form) !== baseline;
  const lock = () => { ctx.el.querySelectorAll('button').forEach(b => b.disabled = busy); review.disabled = busy || !pending().length || !!editing; };
  const renderQueue = () => {
    ctx.el.querySelector('[data-count]').textContent = `${entries.length} / ${limit} separate trips`;
    queue.innerHTML = entries.length ? `<div class="table-responsive"><table class="data-table"><thead><tr><th>Trip</th><th>Client / route</th><th>Truck / schedule</th><th>Distance</th><th>Result</th><th>Actions</th></tr></thead><tbody>${entries.map((x, i) => `<tr><td>${i + 1}</td><td><b>${UI.esc(clientName(x.data))}</b><div class="cell-sub">${UI.esc(x.data.pickup_point)} → ${UI.esc(x.data.delivery_point)}</div>${routeBadge(x.data)}</td><td>${UI.esc(x.data.truck_type)}<div class="cell-sub">${UI.datetime(x.data.scheduled_at)}</div></td><td>${UI.num(x.data.distance_km || 0, 2)} km</td><td>${x.result ? UI.esc(x.result.result) + (x.result.trip_id ? `<button type="button" class="btn btn-link btn-sm" data-open="${x.result.trip_id}">${UI.esc(x.result.trip_ref)}</button>` : `<div class="text-danger small">${UI.esc(x.result.message)}</div>`) : 'Awaiting submission'}</td><td>${x.result?.trip_id ? '' : `<button type="button" class="btn btn-sm btn-outline-primary" data-edit="${x.key}">Edit</button> <button type="button" class="btn btn-sm btn-outline-danger" data-remove="${x.key}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-muted mb-0">Add your first trip entry. Each quantity creates a separate trip with its own assignment and workflow.</p>';
    queue.querySelectorAll('[data-open]').forEach(b => b.onclick = () => TripUI.open(b.dataset.open));
    queue.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      if (busy || (dirty() && !await UI.confirmProceed('Replace entry form?', 'Discard the unsaved entry in the form?', 'Discard entry'))) return;
      editing = entries.find(x => x.key === b.dataset.edit); renderEditor(editing.data); renderQueue(); editor.scrollIntoView({ block: 'start' });
    });
    queue.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
      if (busy) return;
      const i = entries.findIndex(x => x.key === b.dataset.remove);
      if (entries[i] === editing) { editing = null; renderEditor(); }
      entries.splice(i, 1); renderQueue();
    });
    lock();
  };
  const renderEditor = (initial = {}) => {
    const defs = TripUI.deliveryFields(initial, { withClient: true, needsKm: isOps });
    const fields = Object.fromEntries(defs.filter(x => x.name).map(x => [x.name, x]));
    fields.client_route_id.label = 'Approved client route';
    fields.client_route_id.help = 'Select the approved route for this client and truck type. Pending requests are not eligible.';
    const pick = names => UI.fields(names.filter(n => fields[n]).map(n => fields[n]));
    const section = (n, title, body) => `<section class="form-section"><div class="form-section-head"><span class="form-section-num">${n}</span><h2 class="form-section-title">${title}</h2></div><div class="form-section-body">${body}</div></section>`;
    editor.innerHTML = `<form class="form-page" novalidate>${TripUI.datalists()}<div><div class="alert alert-danger form-error" role="alert"></div>
      ${section(1, 'Client, truck type and schedule', pick(['client_id', 'truck_type', 'consignee', 'scheduled_at']) + '<div data-rate-warning role="status"></div>')}
      ${section(2, 'Approved route and distance', pick(['client_route_id']) + '<div class="alert alert-warning small" data-route-notice role="status"></div><div data-mapbox class="mb-3"></div>' + pick(['pickup_point', 'delivery_point', 'route_option', 'distance_km', 'km_info', 'distance_override_reason']) + ['pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng'].map(n => `<input type="hidden" name="${n}" value="${UI.esc(initial[n] || '')}">`).join(''))}
      ${section(3, 'Cargo and booking details', pick(['booking_reference', 'units_planned', 'container_number', 'container_size', 'seal_number', 'shipment_number', 'delivery_details']))}</div>
      <aside class="form-aside"><section class="panel"><div class="panel-head"><h2 class="panel-title">${editing ? 'Edit trip entry' : 'Add trip entry'}</h2></div><div class="panel-body"><p class="small text-muted">Entries can use different clients, routes, truck types and schedules.</p><label class="form-label" for="tripQuantity">Quantity of separate trips</label><input id="tripQuantity" class="form-control" type="number" min="1" max="20" step="1" value="1" ${editing ? 'disabled' : ''}>
      <p class="form-help">Cargo units remain separate from trip quantity. Maximum 20 trips per submission.</p><div class="form-check my-3"><input class="form-check-input" type="checkbox" id="tripAddresses"><label class="form-check-label small" for="tripAddresses">I checked the pickup and destination addresses.</label></div><div class="d-grid gap-2"><button type="submit" class="btn btn-primary">${editing ? 'Save entry changes' : 'Add entry to review'}</button><button type="button" class="btn btn-outline-secondary" data-reset>${editing ? 'Cancel editing' : 'Clear entry'}</button></div><p class="form-help mt-3">${isOps ? 'After final review, trips use existing automatic assignment rules.' : 'After final review, requests go to the Operations Head for approval.'} A future schedule can hold resources as soon as assignment occurs. This is not a reservation calendar.</p></div></section></aside></form>`;
    form = editor.querySelector('form');
    TripUI.wireForm(form, form, initial);
    const notice = () => {
      const selected = !!form.querySelector('[name=client_route_id]').value;
      const box = form.querySelector('[data-route-notice]');
      box.className = `alert alert-${selected ? 'success' : 'warning'} small`;
      box.textContent = selected ? 'Approved client route selected. The server rechecks eligibility at submission.' : 'No approved route selected. The business workflow requires a client-specific approved route for this truck type. Map/manual distance does not establish approval. Pending route requests cannot be selected here.';
    };
    form.addEventListener('change', notice); form.addEventListener('input', notice);
    // Route loading and map changes are asynchronous and can clear the selected route.
    const activeForm = form;
    const tick = setInterval(() => { if (editor.contains(activeForm) && document.body.contains(editor)) notice(); else clearInterval(tick); }, 1000);
    notice(); baseline = UI.modalEditSnapshot(form);
    form.querySelector('[data-reset]').onclick = async () => {
      if (busy || (dirty() && !await UI.confirmProceed('Clear entry?', 'Discard the unsaved entry in the form?', 'Clear entry'))) return;
      editing = null; renderEditor(); renderQueue();
    };
    form.onsubmit = e => {
      e.preventDefault(); if (busy) return;
      form.querySelector('.form-error').style.display = 'none';
      const invalid = [...form.querySelectorAll('input,select,textarea')].find(x => !x.disabled && x.offsetParent !== null && !x.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      const data = UI.formData(form); form._distance?.clean(data);
      if (!data.truck_type) return fail('Choose the truck type for this entry.');
      if (data.scheduled_at < UI.nowManila(-5) || data.scheduled_at > UI.nowManila(365 * 1440)) return fail('Schedule must be within the allowed date range (Philippine time).');
      if (!form.querySelector('#tripAddresses').checked) return fail('Check the pickup and destination addresses, then tick the confirmation box.');
      const quantity = Number(form.querySelector('#tripQuantity').value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > limit || (!editing && entries.length + quantity > limit)) return fail('Use a whole quantity from 1 to 20, with at most 20 separate trips in this submission.');
      // Retain reference distance for editing; the server independently recomputes it on save.
      const state = form._distance?.state;
      if (state?.computed != null) { data.distance_computed_km = state.computed; data.distance_source = state.kind === 'route' ? 'Approved Route' : 'Map'; }
      if (editing) { editing.data = data; editing.result = null; editing = null; }
      else for (let i = 0; i < quantity; i++) entries.push({ key: UI.uuid(), data: { ...data } });
      renderEditor(); renderQueue();
    };
  };
  review.onclick = () => {
    if (busy || editing || !pending().length) return;
    if (dirty()) return fail('Add or clear the current form entry before reviewing the queued trips.');
    const rows = pending(), fallback = rows.filter(x => !x.data.client_route_id).length;
    UI.modal('Review New Trips', `<p>${rows.length} separate trip record(s) will be ${isOps ? 'created and assigned using existing availability rules' : 'sent to the Operations Head for review'}.</p>${fallback ? `<div class="alert alert-warning">${fallback} trip(s) have no approved route selected. Map/manual distance does not satisfy route approval. Follow up on the approved route requirement before dispatch.</div>` : ''}<ol class="ops-review-list">${rows.map(x => `<li><b>${UI.esc(clientName(x.data))} · ${UI.esc(x.data.truck_type)}</b><div>${UI.esc(x.data.pickup_point)} → ${UI.esc(x.data.delivery_point)}</div><div>${UI.datetime(x.data.scheduled_at)} · ${UI.num(x.data.distance_km || 0, 2)} km</div>${routeBadge(x.data)}${x.data.distance_override_reason ? `<div>Distance override: ${UI.esc(x.data.distance_override_reason)}</div>` : ''}</li>`).join('')}</ol><div class="form-check"><input type="checkbox" name="reviewed" value="1" id="tripsReviewed" class="form-check-input" required><label for="tripsReviewed" class="form-check-label">I reviewed every trip, including route approval warnings.</label></div>`, async () => {
      busy = true; lock();
      try {
        const response = await App.api('Trips.create_batch', { rows: rows.map(x => ({ ...x.data, request_key: x.key, row_no: entries.indexOf(x) + 1 })) });
        response.results.forEach(r => { const x = entries.find(x => x.key === r.request_key); if (x) x.result = r; });
        results.textContent = response.message + (pending().length ? ' Edit failed entries and review to retry. Created trips will not be submitted again.' : ' All trips created.');
        UI.toast(response.message);
      } finally { busy = false; renderQueue(); }
    }, { submit: isOps ? 'Create trips' : 'Send requests', confirmBeforeSubmit: false });
  };
  ctx.el.querySelector('[data-exit]').onclick = async () => {
    if (busy) return;
    if ((pending().length || dirty()) && !await UI.confirmProceed('Leave New Trip?', 'Discard unsaved entries and form changes?', 'Discard changes')) return;
    App.go('trips', { tab: 'active' });
  };
  renderEditor(); renderQueue();
};
