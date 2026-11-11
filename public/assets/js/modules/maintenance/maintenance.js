/* MAINTENANCE_CLEANUP_41_43_V1: no priority/ETA controls; preserve safety repair plan. */
/* assets/js/modules/maintenance/maintenance.js — CORRECTIVE MAINTENANCE
   Unexpected truck problems: report -> assign mechanic (Under Inspection) -> findings and
   diagnosis (Under Repair) -> corrective action + evidence (Completed) -> verify and return the
   truck to service. Trip incidents arrive here automatically and are assessed Minor / Major.
   Backend: backend/Modules/Maintenance/Maintenance.php */
'use strict';
const MaintUI = {
  data: null,
  STAGES: ['Reported', 'Under Inspection', 'Under Repair', 'Completed', 'Returned to service'],
  /** Filters of the Open records list (Overview cards link here). Same rules as the backend overview counts. */
  VIEWS: {
    reported: ['New reports', (j) => j.status === 'Reported'],
    in_progress: ['Under inspection or repair', (j) => ['Under Inspection', 'Under Repair'].includes(j.status)],
    verify: ['Awaiting verification', (j) => j.status === 'Completed' && !j.verified_at],
  },
  stageOf(j) {
    if (j.status === 'Cancelled') return [0, true];
    if (j.verified_at) return [5, false];
    return [Math.max(0, MaintUI.STAGES.indexOf(j.status)), false];
  },
  /** Plain-language next step shown on the record. */
  nextStep(j) {
    if (j.status === 'Cancelled') return 'Cancelled.';
    if (j.verified_at) return 'Repair verified. The truck is back in service.';
    if (j.status === 'Reported') return j.source === 'Incident' ? 'Assess the incident (Minor or Major) and choose the mechanic.' : 'Assign an available mechanic to start the inspection.';
    if (j.status === 'Under Inspection') return 'Record the inspection findings and the diagnosis.';
    if (j.status === 'Under Repair') return 'Record the corrective action, the completion date and the evidence.';
    return 'Check the truck, then verify it to return it to service.';
  },
  mechanicOptions(currentId) {
    return (MaintUI.data.mechanics || []).filter(m => m.availability === 'Available' || +m.id === +currentId)
      .map(m => [m.id, `${m.full_name} · ${m.mechanic_code}${m.specialization ? ' · ' + m.specialization : ''}`]);
  },
  /** Report a truck problem found at the garage. */
  report(vehicleId) {
    const d = MaintUI.data;
    const ok = d.trucks.filter(v => !v.open_job && !v.on_road);
    const mech = MaintUI.mechanicOptions();
    UI.formModalFiles('Report a truck problem', [
      { name: 'vehicle_id', label: 'Affected truck', type: 'select', required: true, col: 6, value: vehicleId,
        options: ok.map(v => [v.id, `${v.plate_number}${v.truck_number ? ' · #' + v.truck_number : ''} · ${v.truck_type} (${v.status})`]),
        help: d.trucks.length > ok.length ? 'Trucks on the road or already under repair are not listed.' : '' },
      { name: 'reported_on', label: 'Date reported', type: 'date', value: UI.today(), required: true, col: 6 },
      { name: 'problem', label: 'Problem or defect', type: 'textarea', required: true, col: 12, placeholder: 'What is wrong with the truck? Where is the damage?' },
      { name: 'mechanic_id', label: 'Assign mechanic (optional now)', type: 'select', col: 6, options: mech, placeholder: mech.length ? 'Assign later' : 'No mechanic is available',
        help: 'Only Available mechanics are listed.' },
      { name: 'remarks', label: 'Remarks', col: 6 },
      { name: 'photos', label: 'Photos of the damaged part or truck condition', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="image/png,image/jpeg"' }],
      'Maintenance.report', { submit: 'Report problem', size: 'modal-lg',
        intro: 'The truck is taken out of service at once (Under Maintenance) and cannot be assigned to trips until the repair is completed and verified. If it was reserved for a trip, the trip is re-assigned automatically.' });
  },
  /** Parts request form (Request Form). Motorpool sees part identity and availability only: no costs, no stock counts. */
  async requestParts(vehicleId, jobId) {
    const d = MaintUI.data;
    let parts; try { parts = (await App.api('Purchasing.request_catalog')).parts; } catch (e) { return UI.toast(e.message, 'error'); }
    const openJobs = (d.jobs || []).filter(j => ['Under Inspection', 'Under Repair'].includes(j.status));
    const row = () => `<div class="row g-2 mb-1 pl-row"><div class="col-9"><select class="form-select form-select-sm" data-part><option value="">Choose part…</option>
        ${parts.map(p => `<option value="${p.id}">${UI.esc(p.part_number)} · ${UI.esc(p.description)} (${UI.esc(p.availability)})</option>`).join('')}</select></div>
      <div class="col-3"><input class="form-control form-control-sm" type="number" min="1" max="100000" placeholder="Qty" data-qty></div></div>`;
    UI.modal('Request parts', UI.fields([
      { name: 'vehicle_id', label: 'Truck', type: 'select', required: true, col: 6, value: vehicleId, options: d.trucks.map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]) },
      { name: 'maintenance_job_id', label: 'For repair record', type: 'select', col: 6, value: jobId, options: openJobs.map(j => [j.id, j.job_ref + ' · ' + j.plate_number + ' · ' + j.problem.slice(0, 30)]),
        help: 'Choose the open repair these parts are for.' },
      { name: 'purpose', label: 'Reason for the request', required: true, col: 12 }])
      + `<div class="mt-2"><div class="small text-muted mb-1">Part · Quantity</div><div data-lines>${row()}${row()}${row()}</div>
         <button type="button" class="btn btn-sm btn-link p-0" data-addrow>+ Add item</button></div>`,
      async (x, form, w) => {
        const lines = [...w.querySelectorAll('.pl-row')].map(r => ({ part_id: r.querySelector('[data-part]').value, quantity: r.querySelector('[data-qty]').value })).filter(l => l.part_id || l.quantity);
        const r = await App.api('Purchasing.request_create', { ...x, lines }); UI.result(r); App.route();
      },
      { submit: 'Send to Purchasing', onShow: (w) => { w.querySelector('[data-addrow]').onclick = () => w.querySelector('[data-lines]').insertAdjacentHTML('beforeend', row()); } });
  },
  /** Fulfilment progress of one parts request: requested vs released units and current availability. */
  async openRequest(rq) {
    let r; try { r = await App.api('Purchasing.request_details', { request_id: rq.id }); } catch (e) { return UI.toast(e.message, 'error'); }
    UI.modal('Parts request ' + UI.esc(r.request.request_ref), `<p class="small text-muted">Truck ${UI.esc(r.request.plate_number)}${r.request.job_ref ? ' · repair ' + UI.esc(r.request.job_ref) : ''} · ${UI.esc(r.request.purpose)}<br>Status: ${UI.badge(r.request.status)}${r.request.notes ? ' · ' + UI.esc(r.request.notes) : ''}</p>
      ${UI.table([['Part', 'part_number'], ['Description', 'description'], ['Requested', 'quantity', 'num'], ['Released', 'released_qty', 'num'], ['Availability now', 'availability', 'badge']], r.lines, { plain: true })}`, null, { submit: '', size: 'modal-lg' });
  },
  async open(id) {
    const d = MaintUI.data;
    let r; try { r = await App.api('Maintenance.details', { job_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const j = r.job, i = r.incident, act = d.can.act;
    const [stage, warn] = MaintUI.stageOf(j);
    const acts = [];
    if (act) {
      if (j.source === 'Incident' && j.status === 'Reported') acts.push(['assess', 'Select repair plan', 'primary', 'bi-clipboard-pulse']);
      if (j.source !== 'Incident' && j.status === 'Reported') acts.push(['mech', 'Assign mechanic', 'primary', 'bi-person-gear']);
      if (j.status === 'Under Inspection') acts.push(['inspect', 'Record findings', 'primary', 'bi-search']);
      if (j.status === 'Under Repair') acts.push(['complete', 'Complete repair', 'primary', 'bi-check2-circle']);
      if (j.status === 'Completed' && !j.verified_at) acts.push(['verify', 'Verify & return to service', 'primary', 'bi-shield-check']);
      if (['Under Inspection', 'Under Repair'].includes(j.status)) acts.push(['mech', 'Change mechanic', 'outline-secondary', 'bi-arrow-left-right'],
        ['cost', 'Add cost', 'outline-secondary', 'bi-cash'], ['parts', 'Request parts', 'outline-secondary', 'bi-box-seam']);
      if (j.source !== 'Incident' && ['Reported', 'Under Inspection', 'Under Repair'].includes(j.status)) acts.push(['cancel', 'Cancel record', 'outline-danger', '']);
    }
    const partsCost = r.parts.reduce((a, p) => a + (+p.released_qty) * (+p.unit_cost || 0), 0), other = r.costs.reduce((a, c) => a + +c.amount, 0);
    const truckLine = `<b>${UI.esc(j.plate_number)}</b>${j.truck_number ? ' · #' + UI.esc(j.truck_number) : ''} · ${UI.esc(j.truck_type)} · ${UI.badge(j.truck_status)}`;
    const html = `${UI.steps(MaintUI.STAGES, stage, { warn })}
      <div class="next-step ${j.verified_at ? 'done' : ''}"><i class="bi ${j.verified_at ? 'bi-check-circle' : 'bi-arrow-right-circle'}"></i> ${UI.esc(MaintUI.nextStep(j))}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.map(([a, l, c, ic]) => `<button class="btn btn-sm btn-${c}" data-a="${a}">${ic ? `<i class="bi ${ic}"></i> ` : ''}${UI.esc(l)}</button>`).join('')}</div>` : ''}
      ${UI.h('Problem')}${UI.kv([['Truck', truckLine], ['Source', j.source === 'Incident' ? 'Trip incident' + (j.trip_ref ? ' · ' + UI.esc(j.trip_ref) : '') : (r.arrival ? 'Arrival checklist · ' + UI.esc(j.trip_ref || '') + ' · ' + UI.esc(r.arrival.actor) + ' · ' + UI.datetime(r.arrival.completed_at) : 'Reported at the garage')],
        r.arrival && r.arrival.damage_notes ? ['Damage / missing (arrival)', UI.esc(r.arrival.damage_notes)] : null,
        ['Problem', UI.e(j.problem)], ['Date reported', UI.date(j.reported_on) + (j.reported_by_name ? ' · ' + UI.esc(j.reported_by_name) : '')],
        ])}
      ${UI.h('Mechanic and repair')}${UI.kv([['Mechanic', j.mechanic ? `${UI.esc(j.mechanic)} · ${UI.esc(j.mechanic_code)}${j.mechanic_contact ? ' · ' + UI.esc(j.mechanic_contact) : ''}` : '—'],
        ['Inspection findings', UI.e(j.findings)], ['Diagnosis', UI.e(j.diagnosis)],
        ['Corrective action', UI.e(j.repair_performed)], ['Repair completion date', j.completed_on ? UI.date(j.completed_on) + ' · ' + UI.e(j.completed_by_name) : '—'],
        ['Verification', j.verified_at ? `Passed · ${UI.e(j.verified_by_name)} · ${UI.datetime(j.verified_at)}<div class="small text-muted">${UI.e(j.verification_notes)}</div>` : (j.status === 'Completed' ? '<span class="badge-s amber">Waiting for verification</span>' : '—')],
        ['Remarks', UI.e(j.remarks)]])}
      ${i ? UI.h('Trip incident', `<button class="btn btn-link btn-sm p-0" data-a="printinc"><i class="bi bi-printer"></i> Incident report form</button>`) + UI.kv([['Reference', UI.esc(i.incident_ref) + ' ' + UI.badge(i.status)], ['Type', UI.e(i.incident_type)],
        ['Incident date and time / location', UI.datetime(i.incident_at) + ' · ' + UI.esc(i.location)], ['Details', UI.e(i.details)], ['Persons involved', UI.e(i.persons_involved)], ['Reported by', UI.e(i.reported_by_name)], ['Recommendation', UI.e(i.recommendation)]]) : ''}
      ${UI.h('Parts and costs')}
      ${r.parts.length ? UI.table([['Request', 'request_ref'], ['Part', 'part_number'], ['Description', 'description'], ['Released', 'released_qty', 'num'], ['Unit cost', 'unit_cost', 'money']], r.parts, { plain: true }) : '<div class="text-muted small mb-2">No parts requested.</div>'}
      ${r.costs.length ? UI.table([['Type', 'cost_type'], ['Description', 'description'], ['Provider', 'provider'], ['Date', 'incurred_on', 'date'], ['Amount', 'amount', 'money']], r.costs, { plain: true }) : '<div class="text-muted small mb-2">No labor or outside costs.</div>'}
      <div class="text-end small">Parts ${UI.money(partsCost)} + other ${UI.money(other)} = <b>${UI.money(partsCost + other)}</b></div>
      ${UI.h('Photos and documents')}${UI.docs(r.documents)}
      ${UI.h('Status history')}<ul class="timeline">${r.events.map(e => `<li><span class="when">${UI.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</span><br><b>${UI.esc(e.to_status)}</b>${e.mechanic ? ' · ' + UI.esc(e.mechanic) : ''}${e.details ? ' — ' + UI.esc(e.details) : ''}</li>`).join('')}</ul>
      ${UI.h('Maintenance history of this truck')}${UI.table([['Record', 'job_ref'], ['Source', 'source'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Date reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date']], r.history, { plain: true })}`;
    const el = UI.drawer(UI.esc(j.job_ref) + ' · ' + UI.esc(j.plate_number), html, { subtitle: 'Corrective maintenance · ' + UI.esc(j.verified_at ? 'Returned to service' : j.status) });
    const reopen = () => { MaintUI.open(j.id); App.route(); };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      const mech = MaintUI.mechanicOptions(j.mechanic_id);
      if (a === 'assess') UI.formModal('Repair plan for ' + UI.esc(i.incident_ref), [
          { name: 'severity', label: 'Repair plan', type: 'select', required: true, col: 12, options: [['Minor', 'Repair at the incident location; continue the trip after clearance'], ['Major', 'Return the truck for repair; reschedule the trip']] },
          { name: 'mechanic_id', label: 'Mechanic sent / assigned', type: 'select', required: true, col: 6, options: mech, placeholder: mech.length ? 'Choose…' : 'No mechanic is available' },
          { name: 'recommendation', label: 'Repair recommendation', type: 'textarea', required: true, col: 12 }],
        'Maintenance.assess', { extra: { job_id: j.id }, intro: `<b>${UI.esc(i.problem)}</b> at ${UI.esc(i.location)}.<br>Select the actual repair approach: repair at the incident location and continue after clearance, or return the truck for repair and reschedule the trip.`, after: reopen });
      if (a === 'mech') UI.formModal((j.mechanic_id ? 'Change mechanic for ' : 'Assign mechanic to ') + UI.esc(j.job_ref), [
          { name: 'mechanic_id', label: 'Mechanic', type: 'select', required: true, col: 12, options: mech.filter(o => +o[0] !== +j.mechanic_id), placeholder: mech.length ? 'Choose…' : 'No mechanic is available' },
          ...(j.mechanic_id ? [{ name: 'reason', label: 'Reason for the change', required: true, col: 12 }] : [])],
        'Maintenance.assign_mechanic', { extra: { job_id: j.id }, size: '', intro: 'Only Available mechanics are listed. A mechanic can work on one repair at a time.', after: reopen });
      if (a === 'inspect') UI.formModalFiles('Inspection findings for ' + UI.esc(j.job_ref), [
          { name: 'findings', label: 'Inspection findings', type: 'textarea', required: true, col: 12, placeholder: 'What the mechanic found when checking the truck' },
          { name: 'diagnosis', label: 'Diagnosis', type: 'textarea', required: true, col: 12, placeholder: 'Cause of the problem and what must be repaired or replaced' },
          { name: 'photos', label: 'More photos (optional)', type: 'file', multiple: true, col: 6, attrs: 'accept="image/png,image/jpeg"' }],
        'Maintenance.inspect', { extra: { job_id: j.id }, submit: 'Save and start repair', after: reopen });
      if (a === 'complete') UI.formModalFiles('Complete repair ' + UI.esc(j.job_ref), [
          { name: 'repair_performed', label: 'Corrective action performed', type: 'textarea', required: true, col: 12 },
          { name: 'completed_on', label: 'Completion date', type: 'date', value: UI.today(), required: true, col: 6 }, { name: 'remarks', label: 'Remarks', col: 6 },
          { name: 'evidence', label: 'Evidence of the repair (photos or documents, required)', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="application/pdf,image/png,image/jpeg"' }],
        'Maintenance.complete', { extra: { job_id: j.id }, submit: 'Complete repair', intro: 'Add parts and labor costs before completing. The mechanic becomes available again. The truck stays out of service until you verify it.', after: reopen });
      if (a === 'verify') {
        const wrap = UI.formModal('Verify & return to service · ' + UI.esc(j.plate_number), [
          { name: 'result', label: 'Operational check result', type: 'select', required: true, col: 12, placeholder: false, options: [['Passed', 'Passed: the truck is safe and operational'], ['Failed', 'Failed: the problem is not fixed']] },
          { name: 'verification_notes', label: 'What was checked (road test, engine, brakes, lights…)', type: 'textarea', required: true, col: 12 },
          { name: 'mechanic_id', label: 'Mechanic to continue the repair (if failed)', type: 'select', col: 12, options: MaintUI.mechanicOptions(j.mechanic_id), value: j.mechanic_id, placeholder: 'Same mechanic' }],
          'Maintenance.verify', { extra: { job_id: j.id }, size: '', submit: 'Save verification', after: reopen,
            intro: 'Passed returns the truck to service (Available, or Assigned if a trip is waiting). Failed sends the record back to Under Repair.' });
        const res = wrap.querySelector('[name=result]'), mc = wrap.querySelector('[name=mechanic_id]').closest('[class*=col-]');
        const t = () => { mc.style.display = res.value === 'Failed' ? '' : 'none'; }; res.onchange = t; t();
      }
      if (a === 'cost') UI.formModal('Repair cost for ' + UI.esc(j.job_ref), [
          { name: 'cost_type', label: 'Type', type: 'select', options: UI.list(d.costTypes), required: true, col: 6 }, { name: 'amount', label: 'Amount (₱)', type: 'money', required: true, col: 6 },
          { name: 'description', label: 'Description', required: true, col: 12 }, { name: 'provider', label: 'Supplier / service provider', col: 6 }, { name: 'incurred_on', label: 'Date', type: 'date', value: UI.today(), required: true, col: 6 }],
        'Maintenance.add_cost', { extra: { job_id: j.id }, after: () => MaintUI.open(j.id) });
      if (a === 'parts') { UI.closeDrawer(); MaintUI.requestParts(j.vehicle_id, j.id); }
      if (a === 'cancel') UI.confirmAction('Cancel ' + UI.esc(j.job_ref), 'Use this only for a report made by mistake. The truck becomes available again if nothing else blocks it.', 'Maintenance.cancel', { job_id: j.id },
        { danger: true, submit: 'Cancel record', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
      if (a === 'printinc') TripUI.printIncident({ ...i }, { trip_ref: j.trip_ref, plate_number: j.plate_number });
    });
  },
};

App.page('maintenance', {
  title: 'Repair Management',
  subtitle: 'Truck problems from the garage or from trip incidents: assessment, mechanic, repair, parts requests and verification.',
  render(ctx) {
    const d = MaintUI.data = ctx.data;
    // MOTORPOOL_WORKSPACE_PHASE1: the former "Parts requests" tab is now its own page. Old links / remembered tab go there.
    try {
      if (d.can.act && sessionStorage.getItem('tab:maintenance') === 'parts') {
        sessionStorage.removeItem('tab:maintenance');
        if (UI.canGo('mp_parts_requests')) return App.go('mp_parts_requests');
      }
    } catch { /* storage unavailable: stay on Repair Management */ }
    if (d.can.act) UI.tool(ctx, 'Report truck problem', () => MaintUI.report(), 'bi-plus-lg', 'primary');
    if (d.can.act) UI.tool(ctx, 'Request parts', () => MaintUI.requestParts(), 'bi-box-seam');
    if (d.can.act && UI.canGo('mp_parts_requests')) UI.tool(ctx, 'Parts requests', () => App.go('mp_parts_requests'), 'bi-list-check');
    const jobs = d.jobs.map(j => ({ ...j, display_status: j.verified_at ? 'Returned to service' : (j.status === 'Completed' ? 'Awaiting verification' : j.status) }));
    const open = jobs.filter(j => !['Cancelled'].includes(j.status) && !j.verified_at);
    const by = (s) => open.filter(j => j.status === s);
    const reported = by('Reported'), inspection = by('Under Inspection'), repair = by('Under Repair'), verify = by('Completed');
    const done = jobs.filter(j => j.verified_at);
    ctx.el.innerHTML = UI.statusStrip([
      { label: 'Reported', value: reported.length, note: reported.filter(j => j.source === 'Incident').length + ' from trip incidents', color: reported.length ? 'amber' : '' },
      { label: 'Under inspection', value: inspection.length, color: inspection.length ? 'blue' : '' },
      { label: 'Under repair', value: repair.length, color: repair.length ? 'blue' : '' },
      { label: 'Awaiting verification', value: verify.length, note: 'truck still out of service', color: verify.length ? 'amber' : '' },
      { label: 'Returned to service', value: done.length, note: 'all time', color: 'green' },
    ]);
    const cols = [['Record', 'job_ref', (v, j) => `<b>${UI.esc(v)}</b><div class="cell-sub">${j.source === 'Incident' ? 'Incident ' + UI.esc(j.incident_ref || '') : (j.trip_ref ? 'Arrival checklist ' + UI.esc(j.trip_ref) : 'Garage report')}</div>`],
      ['Truck', 'plate_number', (v, j) => `${UI.esc(v)}<div class="cell-sub">${UI.esc(j.truck_type)}</div>`],
      ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`],
      ['Mechanic', 'mechanic', (v) => v ? UI.esc(v) : '<span class="text-muted">Not assigned</span>'],
      ['Status', 'display_status', 'badge'], ['Date reported', 'reported_on', 'date']];
    const opt = { actions: () => UI.btn('view', 'Open'), onAction: (a, j) => MaintUI.open(j.id), rowClick: (j) => MaintUI.open(j.id) };
    // MAINTENANCE_OVERVIEW_PHASE1_V1: ?view= comes from the Overview cards. It only narrows the Open records list.
    const view = MaintUI.VIEWS[ctx.query.view];
    const openShown = view ? open.filter(view[1]) : open;
    const viewBar = view ? `<div class="mo-filter-bar"><i class="bi bi-funnel"></i> Showing <b>${UI.esc(view[0])}</b> (${openShown.length} of ${open.length} open records) <a href="#maintenance">Show all open records</a></div>` : '';
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, [
      ['open', `Open records <span class="tab-count">${open.length}</span>`, () => viewBar + UI.table(cols, openShown, { ...opt, empty: view ? 'No open record matches this filter.' : 'No truck has an open repair. Report a problem when a truck needs inspection or repair.' })],
      ['done', 'Completed repairs', () => UI.table([...cols.slice(0, 4), ['Completion date', 'completed_on', 'date'], ['Returned to service', 'verified_at', 'datetime']], done, { ...opt, empty: 'No completed repairs yet.' })],
      ['all', 'All records', () => UI.table(cols, jobs, { ...opt })],
      // Parts requests are listed on their own page (mp_parts_requests); "Request parts" stays on every repair record.
    ], view ? 'open' : null, { forceActive: !!view });
    const once = UI.takeQuery(ctx, 'report', 'open');
    if (once.report) MaintUI.report(once.report === 'new' ? undefined : once.report);
    if (once.open) MaintUI.open(once.open);
  },
});

/* MOTORPOOL_WORKSPACE_PHASE1 — Parts Requests (Motorpool Custodian).
   Data: Purchasing::read('mp_parts_requests') — the department's requests, status counts, and what the
   Request parts form needs (trucks, open repairs). No costs, stock counts, budget, supplier or purchase-order data.
   Actions (existing, server-checked): Purchasing.request_create (form), Purchasing.request_details (Details),
   Purchasing.request_cancel (only while Requested). Releasing stock stays with the Purchasing Officer.
   URL filter: ?status=<key> with key = open | requested | partially_released | not_available | released | cancelled,
   ?vehicle_id=<truck id>. Every card, link and the filter modal use these same keys. */
const MpParts = {
  /** URL key -> database status. 'open' = still waiting for parts. */
  STATUS: { requested: 'Requested', partially_released: 'Partially Released', not_available: 'Not Available', released: 'Released', cancelled: 'Cancelled' },
  OPEN: ['Requested', 'Partially Released', 'Not Available'],
  match(r, key) {
    if (!key) return true;
    return key === 'open' ? MpParts.OPEN.includes(r.status) : r.status === MpParts.STATUS[key];
  },
  nextStep(r) {
    return {
      'Requested': 'Waiting for the Purchasing Officer to check the stock and release.',
      'Partially Released': 'Part of the items were released; the rest waits for stock.',
      'Not Available': 'No stock. Follow up with the Purchasing Officer.',
      'Released': 'All items released.',
      'Cancelled': 'Cancelled; it will not be processed.',
    }[r.status] || '';
  },
};

App.page('mp_parts_requests', {
  title: 'Parts Requests',
  subtitle: 'Request parts for repairs and follow their release by the Purchasing Officer.',
  render(ctx) {
    const d = MaintUI.data = ctx.data, q = ctx.query, can = d.can || {};
    const s = d.summary && !Array.isArray(d.summary) ? d.summary : null;
    const n = (k) => s ? +s[k] || 0 : '—';
    if (can.act) UI.tool(ctx, 'Request parts', () => MaintUI.requestParts(), 'bi-plus-lg', 'primary');
    const trucks = Array.isArray(d.trucks) ? d.trucks : [];
    const rows = (Array.isArray(d.requests) ? d.requests : []).map(r => ({ ...r,
      progress: `${UI.num(+r.released_units)} of ${UI.num(+r.requested_units)} released`, next: MpParts.nextStep(r) }));
    const key = q.status === 'open' || MpParts.STATUS[q.status] ? q.status : '';
    const truck = q.vehicle_id ? String(q.vehicle_id) : '';
    const shown = rows.filter(r => MpParts.match(r, key) && (!truck || String(r.vehicle_id) === truck));

    // KPI cards: each one opens this page filtered by its status key.
    const card = (label, k, color, note) => ({ label, value: n(k), color: s && s[k] ? color : '', note, go: 'mp_parts_requests?status=' + k });
    const cards = [
      card('Requested', 'requested', 'amber', 'waiting for Purchasing'),
      card('Partially released', 'partially_released', 'blue', 'rest waits for stock'),
      card('Not available', 'not_available', 'red', 'no stock: follow up'),
      card('Released', 'released', 'green', 'all items released'),
    ];
    // Filter modal fields: names are the URL parameters (status, vehicle_id).
    const statusOptions = [['open', 'Open (requested, partially released, not available)']].concat(Object.entries(MpParts.STATUS));
    const truckOptions = trucks.map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]);
    const filters = [
      { name: 'status', label: 'Status', type: 'select', col: 12, options: statusOptions },
      { name: 'vehicle_id', label: 'Truck', type: 'select', col: 12, options: truckOptions },
    ];
    ctx.el.innerHTML = UI.statusStrip(cards) + UI.filterModal(ctx, filters, { hint: 'Showing all parts requests of the Motorpool.' });

    const cols = [
      ['Request', 'request_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(r.created_at)}</div>`],
      ['Truck', 'plate_number'],
      ['Repair record', 'job_ref', (v) => v ? UI.esc(v) : '<span class="text-muted">—</span>'],
      ['Items', 'items', (v) => `<span class="cell-clip">${UI.esc(v || '')}</span>`],
      ['Progress', 'progress'],
      ['Status', 'status', 'badge'],
      ['Request date', 'created_at', 'date'],
      ['Purpose', 'purpose'],
      ['Next step', 'next'],
      ['Notes from Purchasing', 'notes'],
    ];
    const cancel = (r) => UI.confirmAction('Cancel ' + UI.esc(r.request_ref), 'The request will not be processed by Purchasing.',
      'Purchasing.request_cancel', { request_id: r.id }, { danger: true, submit: 'Cancel request' });
    const opt = {
      actions: (r) => UI.btn('view', 'Details') + (r.status === 'Requested' && can.act ? UI.btn('cancel', 'Cancel', 'outline-danger') : ''),
      onAction: (a, r) => (a === 'cancel' ? cancel(r) : MaintUI.openRequest(r)),
      rowClick: (r) => MaintUI.openRequest(r),
    };
    const box = document.createElement('div');
    ctx.el.append(box);
    if (key || truck) {
      box.innerHTML = UI.table(cols, shown, { ...opt, title: 'Parts requests (filtered)', empty: 'No parts request matches this filter.' });
    } else {
      const open = rows.filter(r => MpParts.OPEN.includes(r.status));
      UI.tabs(box, [
        ['open', `Open <span class="tab-count">${open.length}</span>`, () => UI.table(cols, open, { ...opt, empty: 'No open parts request. Use Request parts when a repair needs parts.' })],
        ['released', 'Released', () => UI.table(cols, rows.filter(r => r.status === 'Released'), { ...opt, empty: 'No released request yet.' })],
        ['cancelled', 'Cancelled', () => UI.table(cols, rows.filter(r => r.status === 'Cancelled'), { ...opt, empty: 'No cancelled request.' })],
        ['all', 'All requests', () => UI.table(cols, rows, { ...opt, empty: 'No parts requests yet. Use Request parts on a repair record.' })],
      ]);
    }
    const once = UI.takeQuery(ctx, 'open');
    if (once.open) {
      const r = rows.find(x => String(x.id) === String(once.open));
      if (r) MaintUI.openRequest(r);
    }
  },
});

/* MAINTENANCE_OVERVIEW_PHASE1_V1 — Maintenance Overview (landing page for the Motorpool Custodian).
   Read-only: every number and row comes from Maintenance::read('maintenance_overview').
   Actions reuse the existing screens: Report a truck problem (MaintUI.report), Repair Management
   (#maintenance, with ?view= filters and ?open=<id>), Parts requests (Repair Management > Parts requests; Parts Requests page for Admin / Audit). */
const MaintOverview = {
  ACTIONS: {
    assess: 'Assess the incident (Minor or Major)',
    assign: 'Assign a mechanic',
    verify: 'Verify and return to service',
    parts_follow_up: 'Parts not available: follow up with Purchasing',
  },
  statusOf(r) {
    if (r.kind === 'parts') return r.status;
    return r.status === 'Completed' ? 'Awaiting verification' : r.status;
  },
  truck(r) { return `<b>${UI.esc(r.plate_number)}</b>${r.truck_number ? ` <span class="text-muted">#${UI.esc(r.truck_number)}</span>` : ''}`; },
  attentionItem(r, can) {
    const ref = r.kind === 'parts' ? [r.request_ref, r.job_ref].filter(Boolean).join(' · ') : r.job_ref;
    const tag = r.source === 'Incident' && r.kind === 'job' ? `<span class="mo-tag">Trip incident${r.incident_ref ? ' ' + UI.esc(r.incident_ref) : ''}</span>` : '';
    const viewBtn = r.job_id
      ? `<button type="button" class="btn btn-sm btn-outline-primary" data-open-job="${+r.job_id}">View repair</button>`
      : (can.parts ? `<button type="button" class="btn btn-sm btn-outline-primary" data-go="${can.requestParts ? 'mp_parts_requests?status=not_available' : 'parts_requests'}">View request</button>` : '');
    return `<li class="mo-item">
      <div class="mo-item-main">
        <div class="mo-item-top">${MaintOverview.truck(r)} <span class="mo-ref">${UI.esc(ref)}</span> ${tag}</div>
        <div class="mo-item-issue" title="${UI.esc(r.issue)}">${UI.esc(r.issue)}</div>
        <div class="mo-item-next"><i class="bi bi-arrow-right-circle"></i> ${UI.esc(MaintOverview.ACTIONS[r.next_action] || 'Open the record')}
          <span class="mo-since">· waiting since ${UI.datetime(r.since)}</span></div>
      </div>
      <div class="mo-item-side">${UI.badge(MaintOverview.statusOf(r))}${viewBtn}</div></li>`;
  },
  activityItem(e) {
    const what = [e.job_ref || e.request_ref, e.plate_number].filter(Boolean).map(UI.esc).join(' · ');
    const extra = e.kind === 'parts_released' || e.kind === 'parts_requested' ? (e.units ? `${UI.num(+e.units)} unit(s)` : '') : (e.mechanic ? 'Mechanic: ' + UI.esc(e.mechanic) : '');
    const open = e.job_id ? ` data-open-job="${+e.job_id}" role="button" tabindex="0"` : '';
    return `<li class="mo-act${e.job_id ? ' clickable' : ''}"${open}>
      <div class="mo-act-label">${UI.esc(e.label)}</div>
      <div class="mo-act-what">${what}${extra ? ' · ' + extra : ''}</div>
      ${e.details && e.kind === 'job' ? `<div class="mo-act-details">${UI.esc(e.details)}</div>` : ''}
      <div class="mo-act-when">${UI.datetime(e.at)} · ${UI.esc(e.actor || 'System')}</div></li>`;
  },
};

App.page('maintenance_overview', {
  title: 'Maintenance Overview',
  subtitle: 'What is happening now, what needs your action, and the latest maintenance activity.',
  render(ctx) {
    const d = MaintUI.data = ctx.data, can = d.can || {};
    const s = Array.isArray(d.summary) ? null : d.summary;   // a failed read section comes back as []

    const n = (k) => s ? +s[k] || 0 : '—';
    const cards = [
      { label: 'New reports', value: n('new_reports'), note: s ? `${n('new_incidents')} from trip incidents` : '', color: s && s.new_reports ? 'amber' : '', go: 'maintenance?view=reported' },
      { label: 'Under repair', value: s ? n('under_inspection') + n('under_repair') : '—', note: s ? `${n('under_inspection')} under inspection · ${n('under_repair')} under repair` : '', color: s && (s.under_inspection + s.under_repair) ? 'blue' : '', go: 'maintenance?view=in_progress' },
      { label: 'For verification', value: n('for_verification'), note: 'repair completed, truck still out of service', color: s && s.for_verification ? 'amber' : '', go: 'maintenance?view=verify' },
    ];
    if (can.parts) cards.push({ label: 'Pending parts requests', value: n('pending_parts'), note: s ? `${n('parts_requested')} requested · ${n('parts_partially_released')} partially released` : '', color: s && s.pending_parts ? 'blue' : '', go: can.requestParts ? 'mp_parts_requests?status=open' : 'parts_requests' });

    const att = Array.isArray(d.attention) ? d.attention : [];
    const lim = (d.limits && d.limits.attention) || 25;
    const attShown = att.slice(0, lim);
    const act = Array.isArray(d.activity) ? d.activity : [];
    const failed = d._errors || {};

    const attentionBody = failed.attention ? '<div class="mo-empty text-danger">The list could not be loaded. Reload the page.</div>'
      : attShown.length ? `<ul class="mo-list">${attShown.map(r => MaintOverview.attentionItem(r, can)).join('')}</ul>`
        + (att.length > lim ? `<div class="mo-more">Showing the ${lim} records waiting the longest. <a href="#maintenance">Open Repair Management</a> for the rest.</div>` : '')
      : '<div class="mo-empty"><i class="bi bi-check2-circle"></i> Nothing needs your action right now.</div>';
    const activityBody = failed.activity ? '<div class="mo-empty text-danger">Recent activity could not be loaded. Reload the page.</div>'
      : act.length ? `<ul class="mo-acts">${act.map(MaintOverview.activityItem).join('')}</ul>`
      : '<div class="mo-empty">No maintenance activity recorded yet.</div>';

    ctx.el.innerHTML = `<div class="maint-overview">
      ${UI.statusStrip(cards)}
      <div class="mo-grid">
        <section class="panel mo-attention"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-flag"></i> Needs attention</h2>
          <span class="text-muted small">${failed.attention ? '' : att.length > lim ? lim + '+ records' : att.length + ' record' + (att.length === 1 ? '' : 's')}</span></div>
          <div class="panel-body flush">${attentionBody}</div></section>
        <div class="mo-side">
          <section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-lightning"></i> Quick actions</h2></div>
            <div class="panel-body mo-quick">
              ${can.act ? '<button type="button" class="btn btn-primary" data-q="report"><i class="bi bi-plus-lg"></i> Report truck issue</button>' : ''}
              <button type="button" class="btn btn-outline-secondary" data-go="maintenance"><i class="bi bi-wrench-adjustable"></i> Repair management</button>
              <button type="button" class="btn btn-link mo-quick-link" data-go="maint_history"><i class="bi bi-clock-history"></i> Maintenance history (completed repairs)</button>
              ${can.requestParts ? '<button type="button" class="btn btn-link mo-quick-link" data-go="mp_parts_requests"><i class="bi bi-box-seam"></i> Parts requests</button>' : ''}
              ${UI.canGo('mechanic_attendance') ? '<button type="button" class="btn btn-link mo-quick-link" data-go="mechanic_attendance"><i class="bi bi-clock-history"></i> Mechanic attendance (Time In / Time Out)</button>' : ''}
            </div></section>
          <section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-activity"></i> Recent maintenance activity</h2></div>
            <div class="panel-body flush">${activityBody}</div></section>
        </div>
      </div></div>`;

    const root = ctx.el.querySelector('.maint-overview');
    root.querySelector('[data-q="report"]')?.addEventListener('click', () => MaintUI.report());
    root.querySelectorAll('[data-open-job]').forEach(x => {
      const go = () => App.go('maintenance', { open: x.dataset.openJob });
      x.addEventListener('click', go);
      if (x.tagName !== 'BUTTON') x.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  },
});
