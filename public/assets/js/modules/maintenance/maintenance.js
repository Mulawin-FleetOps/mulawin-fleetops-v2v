/* assets/js/modules/maintenance/maintenance.js — CORRECTIVE MAINTENANCE
   Unexpected truck problems: report -> assign mechanic (Under Inspection) -> findings and
   diagnosis (Under Repair) -> corrective action + evidence (Completed) -> verify and return the
   truck to service. Trip incidents arrive here automatically and are assessed Minor / Major.
   Backend: backend/Modules/Maintenance/Maintenance.php */
'use strict';
const MaintUI = {
  data: null,
  STAGES: ['Reported', 'Under Inspection', 'Under Repair', 'Completed', 'Returned to service'],
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
      { name: 'reported_on', label: 'Date reported', type: 'date', value: UI.today(), required: true, col: 3 },
      { name: 'priority', label: 'Priority', type: 'select', required: true, col: 3, value: 'Normal', placeholder: false, options: UI.list(d.priorities) },
      { name: 'problem', label: 'Problem or defect', type: 'textarea', required: true, col: 12, placeholder: 'What is wrong with the truck? Where is the damage?' },
      { name: 'mechanic_id', label: 'Assign mechanic (optional now)', type: 'select', col: 6, options: mech, placeholder: mech.length ? 'Assign later' : 'No mechanic is available',
        help: 'Only Available mechanics are listed.' },
      { name: 'remarks', label: 'Remarks', col: 6 },
      { name: 'photos', label: 'Photos of the damaged part or truck condition', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="image/png,image/jpeg"' }],
      'Maintenance.report', { submit: 'Report problem', size: 'modal-lg',
        intro: 'The truck is taken out of service at once (Under Maintenance) and cannot be assigned to trips until the repair is completed and verified. If it was reserved for a trip, the trip is re-assigned automatically.' });
  },
  async open(id) {
    const d = MaintUI.data;
    let r; try { r = await App.api('Maintenance.details', { job_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const j = r.job, i = r.incident, act = d.can.act;
    const [stage, warn] = MaintUI.stageOf(j);
    const acts = [];
    if (act) {
      if (j.source === 'Incident' && j.status === 'Reported') acts.push(['assess', 'Assess damage', 'primary', 'bi-clipboard-pulse']);
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
      ${UI.h('Problem')}${UI.kv([['Truck', truckLine], ['Source', j.source === 'Incident' ? 'Trip incident' + (j.trip_ref ? ' · ' + UI.esc(j.trip_ref) : '') : 'Reported at the garage'],
        ['Problem', UI.e(j.problem)], ['Date reported', UI.date(j.reported_on) + (j.reported_by_name ? ' · ' + UI.esc(j.reported_by_name) : '')],
        ['Priority', UI.badge(j.priority)], j.severity ? ['Severity', UI.badge(j.severity)] : null])}
      ${UI.h('Mechanic and repair')}${UI.kv([['Mechanic', j.mechanic ? `${UI.esc(j.mechanic)} · ${UI.esc(j.mechanic_code)}${j.mechanic_contact ? ' · ' + UI.esc(j.mechanic_contact) : ''}` : '—'],
        ['Inspection findings', UI.e(j.findings)], ['Diagnosis', UI.e(j.diagnosis)], ['Expected back', UI.date(j.expected_completion)],
        ['Corrective action', UI.e(j.repair_performed)], ['Completed', j.completed_on ? UI.date(j.completed_on) + ' · ' + UI.e(j.completed_by_name) : '—'],
        ['Verification', j.verified_at ? `Passed · ${UI.e(j.verified_by_name)} · ${UI.datetime(j.verified_at)}<div class="small text-muted">${UI.e(j.verification_notes)}</div>` : (j.status === 'Completed' ? '<span class="badge-s amber">Waiting for verification</span>' : '—')],
        ['Remarks', UI.e(j.remarks)]])}
      ${i ? UI.h('Trip incident', `<button class="btn btn-link btn-sm p-0" data-a="printinc"><i class="bi bi-printer"></i> Incident report form</button>`) + UI.kv([['Reference', UI.esc(i.incident_ref) + ' ' + UI.badge(i.status)], ['Type', UI.e(i.incident_type)],
        ['When / where', UI.datetime(i.incident_at) + ' · ' + UI.esc(i.location)], ['Details', UI.e(i.details)], ['Persons involved', UI.e(i.persons_involved)], ['Reported by', UI.e(i.reported_by_name)], ['Recommendation', UI.e(i.recommendation)]]) : ''}
      ${UI.h('Parts and costs')}
      ${r.parts.length ? UI.table([['Request', 'request_ref'], ['Part', 'part_number'], ['Description', 'description'], ['Released', 'released_qty', 'num'], ['Unit cost', 'unit_cost', 'money']], r.parts, { plain: true }) : '<div class="text-muted small mb-2">No parts requested.</div>'}
      ${r.costs.length ? UI.table([['Type', 'cost_type'], ['Description', 'description'], ['Provider', 'provider'], ['Date', 'incurred_on', 'date'], ['Amount', 'amount', 'money']], r.costs, { plain: true }) : '<div class="text-muted small mb-2">No labor or outside costs.</div>'}
      <div class="text-end small">Parts ${UI.money(partsCost)} + other ${UI.money(other)} = <b>${UI.money(partsCost + other)}</b></div>
      ${UI.h('Photos and documents')}${UI.docs(r.documents)}
      ${UI.h('Status history')}<ul class="timeline">${r.events.map(e => `<li><span class="when">${UI.datetime(e.created_at)} · ${UI.esc(e.actor || 'System')}</span><br><b>${UI.esc(e.to_status)}</b>${e.mechanic ? ' · ' + UI.esc(e.mechanic) : ''}${e.details ? ' — ' + UI.esc(e.details) : ''}</li>`).join('')}</ul>
      ${UI.h('Maintenance history of this truck')}${UI.table([['Record', 'job_ref'], ['Source', 'source'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date']], r.history, { plain: true })}`;
    const el = UI.drawer(UI.esc(j.job_ref) + ' · ' + UI.esc(j.plate_number), html, { subtitle: 'Corrective maintenance · ' + UI.esc(j.verified_at ? 'Returned to service' : j.status) });
    const reopen = () => { MaintUI.open(j.id); App.route(); };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      const mech = MaintUI.mechanicOptions(j.mechanic_id);
      if (a === 'assess') UI.formModal('Assess ' + UI.esc(i.incident_ref), [
          { name: 'severity', label: 'Assessment', type: 'select', required: true, col: 12, options: [['Minor', 'Minor damage: repair on site, the trip continues'], ['Major', 'Major damage: bring the truck back, repair, reschedule the trip']] },
          { name: 'mechanic_id', label: 'Mechanic sent / assigned', type: 'select', required: true, col: 6, options: mech, placeholder: mech.length ? 'Choose…' : 'No mechanic is available' },
          { name: 'expected_completion', label: 'Expected truck availability (required for Major)', type: 'date', col: 6 },
          { name: 'recommendation', label: 'Recommendation', type: 'textarea', required: true, col: 12 }],
        'Maintenance.assess', { extra: { job_id: j.id }, intro: `<b>${UI.esc(i.problem)}</b> at ${UI.esc(i.location)}.<br>Minor: the truck stays on the trip. Major: the truck goes Under Maintenance and the trip becomes For Reschedule.`, after: reopen });
      if (a === 'mech') UI.formModal((j.mechanic_id ? 'Change mechanic for ' : 'Assign mechanic to ') + UI.esc(j.job_ref), [
          { name: 'mechanic_id', label: 'Mechanic', type: 'select', required: true, col: 12, options: mech.filter(o => +o[0] !== +j.mechanic_id), placeholder: mech.length ? 'Choose…' : 'No mechanic is available' },
          ...(j.mechanic_id ? [{ name: 'reason', label: 'Reason for the change', required: true, col: 12 }] : [])],
        'Maintenance.assign_mechanic', { extra: { job_id: j.id }, size: '', intro: 'Only Available mechanics are listed. A mechanic can work on one repair at a time.', after: reopen });
      if (a === 'inspect') UI.formModalFiles('Inspection findings for ' + UI.esc(j.job_ref), [
          { name: 'findings', label: 'Inspection findings', type: 'textarea', required: true, col: 12, placeholder: 'What the mechanic found when checking the truck' },
          { name: 'diagnosis', label: 'Diagnosis', type: 'textarea', required: true, col: 12, placeholder: 'Cause of the problem and what must be repaired or replaced' },
          { name: 'expected_completion', label: 'Expected completion', type: 'date', col: 6, value: j.expected_completion || '' },
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
      if (a === 'parts') { UI.closeDrawer(); App.go('purchasing', { request_for: j.vehicle_id, job: j.id }); }
      if (a === 'cancel') UI.confirmAction('Cancel ' + UI.esc(j.job_ref), 'Use this only for a report made by mistake. The truck becomes available again if nothing else blocks it.', 'Maintenance.cancel', { job_id: j.id },
        { danger: true, submit: 'Cancel record', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
      if (a === 'printinc') TripUI.printIncident({ ...i }, { trip_ref: j.trip_ref, plate_number: j.plate_number });
    });
  },
};

App.page('maintenance', {
  title: 'Corrective Maintenance',
  subtitle: 'Unexpected truck problems from the garage or from trip incidents: inspection, repair, verification.',
  render(ctx) {
    const d = MaintUI.data = ctx.data;
    if (d.can.act) UI.tool(ctx, 'Report truck problem', () => MaintUI.report(), 'bi-plus-lg', 'primary');
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
    const cols = [['Record', 'job_ref', (v, j) => `<b>${UI.esc(v)}</b><div class="cell-sub">${j.source === 'Incident' ? 'Incident ' + UI.esc(j.incident_ref || '') : 'Garage report'}</div>`],
      ['Truck', 'plate_number', (v, j) => `${UI.esc(v)}<div class="cell-sub">${UI.esc(j.truck_type)}</div>`],
      ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`], ['Priority', 'priority', 'badge'],
      ['Mechanic', 'mechanic', (v) => v ? UI.esc(v) : '<span class="text-muted">Not assigned</span>'],
      ['Status', 'display_status', 'badge'], ['Reported', 'reported_on', 'date']];
    const opt = { actions: () => UI.btn('view', 'Open'), onAction: (a, j) => MaintUI.open(j.id), rowClick: (j) => MaintUI.open(j.id) };
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, [
      ['open', `Open records <span class="tab-count">${open.length}</span>`, () => UI.table(cols, open, { ...opt, empty: 'No truck has an open repair. Report a problem when a truck needs inspection or repair.' })],
      ['done', 'Completed repairs', () => UI.table([...cols.slice(0, 5), ['Completed', 'completed_on', 'date'], ['Returned to service', 'verified_at', 'datetime'], ['Parts', 'parts_cost', 'money'], ['Other cost', 'other_cost', 'money']], done, { ...opt, empty: 'No completed repairs yet.' })],
      ['all', 'All records', () => UI.table(cols, jobs, { ...opt })],
    ], null);
    const once = UI.takeQuery(ctx, 'report', 'open');
    if (once.report) MaintUI.report(once.report);
    if (once.open) MaintUI.open(once.open);
  },
});
