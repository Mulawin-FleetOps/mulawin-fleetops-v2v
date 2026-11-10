/* Dedicated Operations Head approval presentation over the existing Trips records/actions. */
'use strict';
OpsHead.approvalLabel = category => ({pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected'}[category] || 'Decision not recorded');
OpsHead.approvalCategory = (t, events = []) => {
  if (t.intake_source !== 'Dispatcher') return null;
  if ((t.approved_by != null && t.approved_at) || events.some(e => e.event_type === 'trip details confirmed by Operations Head')) return 'approved';
  if (events.some(e => e.event_type === 'trip request rejected' && e.to_status === 'Rejected')) return 'rejected';
  return t.status === 'Pending Review' ? 'pending' : null;
};

OpsHead.approvals = function(ctx) {
  if (this.approvalContext && this.approvalContext !== ctx && document.querySelector('.oh-approval-drawer')) {
    this._approvalSequence++; UI.closeDrawer();
  }
  this.approvalContext = ctx;
  ctx.setTitle('Trip Approvals', 'Review and process dispatcher-submitted trip requests.');
  const crumbs = document.querySelector('#crumbs');
  if (crumbs) crumbs.innerHTML = '<span class="crumb-page">Trip Approvals</span>';
  document.title = 'Trip Approvals · Mulawin FleetOps';
  const d = ctx.data.approval, options = ctx.data.filterOptions || {}, q = ctx.query;
  if (!d || !Array.isArray(d.rows)) {
    ctx.el.innerHTML = '<div class="alert alert-warning" role="alert">Trip requests are unavailable. Refresh this page to try again.</div>';
    return;
  }
  const href = category => this.link('trips', {...q, view: 'approvals', approval: category, approval_page: 1});
  const advanced = ['client_id', 'truck_type', 'request_from', 'request_to', 'requester_id'].some(key => q[key]);
  ctx.el.innerHTML = `<div class="oh-approval-workspace">
    <div class="oh-metrics oh-approval-metrics" aria-label="Trip approval categories">${['pending', 'approved', 'rejected'].map(category => `<a class="oh-metric${d.category === category ? ' selected' : ''}" href="${UI.esc(href(category))}" ${d.category === category ? 'aria-current="page"' : ''}><span>${this.approvalLabel(category)}</span><strong>${UI.num(d.counts[category])}</strong><i class="bi bi-arrow-up-right" aria-hidden="true"></i></a>`).join('')}</div>
    <form class="oh-approval-filters" aria-label="Approval search and filters">
      <div class="oh-approval-toolbar"><label class="oh-search"><span class="visually-hidden">Search trip requests</span><input name="q" class="form-control" type="search" maxlength="200" placeholder="Search trip, client, route, or requester..." value="${UI.esc(q.q || '')}"></label><button class="btn btn-primary" type="submit">Search</button><button class="btn btn-outline-secondary" type="button" data-advanced aria-expanded="${advanced}">Filters</button><button class="btn btn-outline-secondary" type="button" data-reset-approvals>Reset Filters</button></div>
      <div class="oh-filters oh-approval-advanced" data-advanced-fields ${advanced ? '' : 'hidden'}>${UI.fields([
        {name:'client_id', label:'Client', type:'select', col:4, placeholder:'All clients', options:UI.opts(options.clients || [], c=>c.company_name), value:q.client_id},
        {name:'truck_type', label:'Truck Type', type:'select', col:4, placeholder:'All truck types', options:UI.list(App.me.truckTypes), value:q.truck_type},
        {name:'requester_id', label:'Requesting Dispatcher', type:'select', col:4, placeholder:'All requesting dispatchers', options:UI.opts(options.requesters || [], u=>u.full_name), value:q.requester_id},
        {name:'request_from', label:'Request Date From', type:'date', col:4, value:q.request_from},
        {name:'request_to', label:'Request Date To', type:'date', col:4, value:q.request_to},
        {name:'approval', label:'Approval Status', type:'select', placeholder:false, col:4, options:['pending','approved','rejected'].map(c=>[c,this.approvalLabel(c)]), value:d.category},
      ])}<button class="btn btn-sm btn-primary mt-3" type="submit">Apply Filters</button></div>
    </form>
    ${d.counts.unclassified ? `<p class="small text-muted" role="note">${UI.num(d.counts.unclassified)} dispatcher request(s) closed without a recorded approval or rejection, or have incomplete historical evidence. These are excluded from the decision categories.</p>` : ''}
    <div class="table-responsive"><table class="data-table oh-trips-table oh-approval-table"><thead><tr><th>Trip / Client</th><th>Route / Truck Type</th><th>Scheduled Dispatch (PHT)</th><th>Requested By</th><th>Approval Status</th><th>Action</th></tr></thead><tbody>${d.rows.map(t => `<tr><td data-label="Trip / Client"><b>${UI.esc(t.trip_ref)}</b><div>${UI.esc(t.client)}</div></td><td data-label="Route / Truck Type">${UI.esc(t.pickup_point)} → ${UI.esc(t.delivery_point)}<div class="cell-sub">${UI.esc(t.truck_type || 'Type to be confirmed')}</div></td><td data-label="Scheduled Dispatch">${this.datetime(t.scheduled_at)}</td><td data-label="Requested By">${UI.esc(t.created_by_name || 'Requester unavailable')}<div class="cell-sub">${this.datetime(t.created_at)}</div></td><td data-label="Approval Status">${UI.badge(this.approvalLabel(t.approval_category))}${t.approval_category === 'approved' ? '<div class="cell-sub">Trip: ' + UI.esc(t.status) + '</div>' : ''}</td><td data-label="Action"><button class="btn btn-sm btn-outline-success" type="button" data-review-request="${+t.id}">${t.approval_category === 'pending' ? 'Review' : 'View'}</button></td></tr>`).join('') || `<tr><td colspan="6" class="table-empty">No ${this.approvalLabel(d.category).toLowerCase()} dispatcher requests match the selected filters.</td></tr>`}</tbody></table></div>
    <div class="oh-pagination"><span>${d.total ? (d.page - 1) * d.pageSize + 1 : 0}–${Math.min(d.page * d.pageSize, d.total)} of ${UI.num(d.total)} request(s) · Page ${d.page} of ${d.pages}</span><div><button type="button" class="btn btn-sm btn-outline-secondary" data-approval-prev ${d.page > 1 ? '' : 'disabled'}>Previous</button> <button type="button" class="btn btn-sm btn-outline-secondary" data-approval-next ${d.page < d.pages ? '' : 'disabled'}>Next</button></div></div>
    <p class="small text-muted">Counts reflect the search and request-date filters across all pages. Approved is a recorded decision; the official operational trip status continues to change.</p>
  </div>`;
  const form = ctx.el.querySelector('form');
  form.onsubmit = event => {
    event.preventDefault();
    const values = UI.formData(form);
    const from = form.querySelector('[name=request_from]'), to = form.querySelector('[name=request_to]');
    to.setCustomValidity(from.value && to.value && from.value > to.value ? 'End date must be on or after the start date.' : '');
    if (!form.reportValidity()) return;
    App.go('trips', {view:'approvals', ...Object.fromEntries(Object.entries(values).filter(([,v])=>v !== '')), approval_page:1});
  };
  form.querySelector('[name=request_from]').onchange = form.querySelector('[name=request_to]').onchange = () => form.querySelector('[name=request_to]').setCustomValidity('');
  form.querySelector('[data-advanced]').onclick = event => {
    const fields = form.querySelector('[data-advanced-fields]'); fields.hidden = !fields.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!fields.hidden));
  };
  form.querySelector('[data-reset-approvals]').onclick = () => App.go('trips', {view:'approvals', approval:d.category});
  ctx.el.querySelector('[data-approval-prev]').onclick = () => App.go('trips', {...q, view:'approvals', approval:d.category, approval_page:d.page - 1});
  ctx.el.querySelector('[data-approval-next]').onclick = () => App.go('trips', {...q, view:'approvals', approval:d.category, approval_page:d.page + 1});
  ctx.el.querySelectorAll('[data-review-request]').forEach(b => b.onclick = () => this.openApproval(b.dataset.reviewRequest, ctx));
  if (q.open) this.openApproval(UI.takeQuery(ctx, 'open').open, ctx);
};

OpsHead.refreshApprovals = async function(ctx) {
  if (!ctx.el.isConnected || !this.is()) return;
  const current = App.current;
  const data = await App.data('trips', {...ctx.query, view:'approvals'});
  if (App.current !== current || !ctx.el.isConnected) return;
  ctx.data = data; this.approvals(ctx);
};

OpsHead.openApproval = async function(id, ctx, feedback = '') {
  if (!this.is()) return;
  const sequence = this._approvalSequence = (this._approvalSequence || 0) + 1;
  const current = App.current;
  const closing = document.querySelector('.app-drawer.hiding');
  if (closing) await new Promise(resolve => closing.addEventListener('hidden.bs.offcanvas', resolve, {once:true}));
  if (sequence !== this._approvalSequence || App.current !== current) return;
  const el = UI.drawer('Trip Request Review', '<div class="loading-block" role="status"><span class="spinner-border spinner-border-sm"></span> Loading request…</div>', {subtitle:'Trip Approvals'});
  el.classList.add('oh-approval-drawer');
  const reportError = message => { const box = el.querySelector('[data-decision-feedback]'); if (box) { box.textContent = message; box.hidden = false; } };
  let r;
  try { r = await App.api('Trips.details', {trip_id:id}); }
  catch (ex) {
    if (sequence !== this._approvalSequence || !el.isConnected) return;
    el.querySelector('.offcanvas-body').innerHTML = `<div class="alert alert-danger" role="alert">${UI.esc(ex.message)}</div><button class="btn btn-outline-secondary" data-retry-details>Retry</button>`;
    el.querySelector('[data-retry-details]').onclick = () => this.openApproval(id,ctx); return;
  }
  if (sequence !== this._approvalSequence || App.current !== current || !el.isConnected) return;
  const t = r.trip, category = this.approvalCategory(t,r.events), pending = category === 'pending';
  el.querySelector('.offcanvas-title').textContent = t.trip_ref + ' · Trip Request Review';
  el.querySelector('.offcanvas-header .small').innerHTML = `${UI.badge(this.approvalLabel(category))} <span>Current trip: ${UI.esc(t.status)}</span>`;
  el.querySelector('.btn-close').setAttribute('aria-label','Close Trip Request Review');
  const kv = UI.kv, text = UI.e;
  el.querySelector('.offcanvas-body').innerHTML = `<div class="alert alert-info" data-decision-feedback role="status" ${feedback ? '' : 'hidden'}>${UI.esc(feedback)}</div>` +
    this.panel('Request Information', kv([['Client',text(t.client)],['Truck Type',text(t.truck_type)],['Approved Route',text(t.client_route_ref || (t.client_route_id ? 'Linked route #' + t.client_route_id : 'No approved route linked'))],['Route',UI.esc(t.pickup_point)+' → '+UI.esc(t.delivery_point)],['Scheduled Dispatch (PHT)',this.datetime(t.scheduled_at)],['Requesting Dispatcher',text(t.created_by_name)],['Request Date',this.datetime(t.created_at)],['Approval Status',UI.badge(this.approvalLabel(category))],['Official Trip Status',UI.badge(t.status)],category==='rejected'?['Rejection Reason',text(t.cancel_reason)]:null])) +
    this.panel('Delivery Information', kv([['Delivery Instructions',text(t.delivery_details)],['Consignee',text(t.consignee)],['Booking Reference',text(t.booking_reference)],...(t.truck_type==='Car Carrier'?[['Cargo Units',text(t.units_planned)]]:[['Shipment Number',text(t.shipment_number)]]),...(t.truck_type==='Container'?[['Container Number',text(t.container_number)],['Container Size',text(t.container_size)],['Seal Number',text(t.seal_number)]]:[])])) +
    this.panel('Resource Information', kv([['Truck',text(t.plate_number)],['Truck Status',text(t.truck_status)],['Driver',text(t.driver_name)],['Second Driver',text(t.driver2_name)],['Helper',text(t.helper_name)],['Assignment',text(t.assignment_mode)]]) + `<p class="small text-muted">${pending ? 'The existing system checks and assigns truck and crew after approval. If no eligible resources are available, the trip enters Awaiting Resources. No manual assignment is required here.' : 'These are recorded trip assignments. Approval history remains read-only here.'}</p>` + (t.crew_attendance?.missing || []).map(issue=>`<p class="small text-warning-emphasis">${UI.esc(issue)}</p>`).join('')) +
    this.panel('Supporting Records', UI.docs(r.documents) + '<h3 class="oh-support-title">Request History</h3>' + ((r.events || []).length ? `<ul class="timeline">${r.events.map(e=>`<li><small>${this.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</small><br>${UI.esc(e.event_type)}${e.to_status ? ' · '+UI.esc(e.to_status) : ''}${e.notes ? '<div>'+UI.esc(e.notes)+'</div>':''}</li>`).join('')}</ul>`:'<p class="small text-muted">No request events recorded.</p>')) +
    (pending ? '<details class="oh-detail-section" data-confirm-fields><summary>Confirm or Correct Trip Details</summary><div class="oh-detail-body"><p class="small text-muted">These existing fields are validated by the trip review API. Complete any missing truck type, route, distance, or shipment information before approval.</p><form data-approval-form novalidate></form></div></details><div class="oh-reject-area" data-reject-area hidden><h3>Reject Trip</h3><label class="form-label" for="oh-reject-reason">Rejection Reason</label><textarea id="oh-reject-reason" class="form-control" maxlength="300" rows="3" required></textarea><div class="oh-form-footer"><button type="button" class="btn btn-outline-secondary" data-cancel-rejection>Cancel</button><button type="button" class="btn btn-danger" data-confirm-rejection>Confirm Rejection</button></div></div>' : '');
  const footer = document.createElement('div'); footer.className = 'oh-drawer-footer oh-approval-footer';
  footer.innerHTML = pending ? '<button type="button" class="btn btn-outline-danger" data-reject-trip>Reject Trip</button><button type="button" class="btn btn-primary" data-approve-trip>Approve Trip</button>' : '<button type="button" class="btn btn-outline-secondary" data-close-review>Close</button>';
  el.append(footer);
  el.querySelector('[data-close-review]')?.addEventListener('click',()=>UI.closeDrawer());
  if (!pending) return;
  TripUI.data ||= {clients:[],places:[],consignees:[]};
  const form = el.querySelector('[data-approval-form]'), corrections = el.querySelector('[data-confirm-fields]');
  form.innerHTML = TripUI.datalists() + UI.fields(TripUI.deliveryFields(t,{needsKm:true}));
  TripUI.wireForm(form,form,t);
  corrections.open = !t.truck_type || !+t.distance_km || !t.pickup_point || !t.delivery_point;
  corrections.ontoggle = () => { if (corrections.open) form._distance?.map?.invalidateSize(); };
  form.onsubmit = event=>event.preventDefault();
  let busy = false;
  const rejection = el.querySelector('[data-reject-area]'), reason = rejection.querySelector('textarea');
  const enable = () => {
    el.querySelectorAll('[data-approve-trip],[data-reject-trip],[data-confirm-rejection],[data-cancel-rejection]').forEach(b=>b.disabled=busy);
    el.querySelector('[data-approve-trip]').disabled=busy || !rejection.hidden;
    form.querySelectorAll('input,select,textarea').forEach(input=>input.disabled = busy || !!input.dataset.reviewWasDisabled);
  };
  const mutate = async decision => {
    if (busy || !this.is()) return;
    let values = {};
    if (decision === 'reject') { reason.value=reason.value.trim(); if (!reason.reportValidity()) return; values.reason=reason.value; }
    else {
      const wasOpen = corrections.open; corrections.open = true;
      // Match the shared review modal: conditional, hidden fields are validated only when applicable.
      const invalid=[...form.querySelectorAll('input,select,textarea')].find(input=>!input.disabled&&input.offsetParent!==null&&!input.checkValidity());
      if (invalid) { corrections.open=true; invalid.reportValidity(); return; }
      corrections.open = wasOpen;
      values=UI.formData(form); form._distance?.clean(values);
    }
    busy=true;
    form.querySelectorAll('input,select,textarea').forEach(input=>{ if(input.disabled) input.dataset.reviewWasDisabled='1'; });
    enable();
    try {
      const latest = await App.api('Trips.details',{trip_id:t.id});
      if (latest.trip.status !== 'Pending Review' || this.approvalCategory(latest.trip,latest.events)!=='pending') {
        await this.refreshApprovals(ctx); await this.openApproval(id,ctx,'This request was already processed. The current recorded decision and trip status are shown.'); return;
      }
      const result = await App.api('Trips.review',{...values,trip_id:t.id,decision});
      let message=result.message || 'The server processed the request.';
      try { await this.refreshApprovals(ctx); } catch(ex) { message+=' List refresh failed: '+ex.message+' Refresh the list to update counts.'; }
      if (el.isConnected && App.current === current) await this.openApproval(id,ctx,message);
    } catch(ex) {
      reportError(ex.message);
      // A stale/concurrent decision must refresh instead of offering invalid actions again.
      if (ex.status===409) {
        try { await this.refreshApprovals(ctx); await this.openApproval(id,ctx,ex.message+' Current record refreshed.'); } catch(refreshError) { reportError(ex.message+' Refresh failed: '+refreshError.message); }
      }
    } finally { busy=false; if(el.isConnected && sequence===this._approvalSequence) enable(); }
  };
  el.querySelector('[data-approve-trip]').onclick=()=>mutate('approve');
  el.querySelector('[data-reject-trip]').onclick=()=>{ rejection.hidden=false; enable(); reason.focus(); };
  el.querySelector('[data-cancel-rejection]').onclick=()=>{ rejection.hidden=true; enable(); };
  el.querySelector('[data-confirm-rejection]').onclick=()=>mutate('reject');
};

// All drawer types share the same Bootstrap container. Remove only this presentation's footer/class.
(() => {
  const drawer = UI.drawer;
  UI.drawer = (...args) => { document.querySelector('.app-drawer')?.classList.remove('oh-approval-drawer'); return drawer(...args); };
})();
