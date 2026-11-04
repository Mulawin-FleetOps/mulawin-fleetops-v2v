/* assets/js/modules/operations/fleet.js — TRUCK MASTERLIST and DRIVER & HELPER MASTERLIST
   The only place where trucks, drivers and helpers are added or edited. Every other
   module (trips, maintenance, purchasing, reports) points to these records.
   Backend: backend/Modules/Operations/Fleet.php */
'use strict';
const FleetUI = {
  docBadge(days, date) {
    if (!date) return '<span class="text-muted">—</span>';
    return UI.date(date) + ' ' + UI.days(days);
  },
  truckForm(v, d) {
    const fields = [
      { name: 'plate_number', label: 'Plate number', required: true, col: 4, value: v.plate_number, placeholder: 'NAJ5941' },
      { name: 'truck_number', label: 'Truck / unit no.', col: 4, value: v.truck_number, placeholder: 'e.g. 6 or W2' },
      { name: 'truck_type', label: 'Truck type', type: 'select', options: UI.list(App.me.truckTypes), required: true, col: 4, value: v.truck_type },
      { name: 'make_brand', label: 'Make / brand', col: 4, value: v.make_brand }, { name: 'model', label: 'Model', col: 4, value: v.model },
      { name: 'mv_file_number', label: 'MV file no.', col: 4, value: v.mv_file_number },
      { name: 'chassis_number', label: 'Chassis no.', col: 4, value: v.chassis_number }, { name: 'engine_number', label: 'Engine no.', col: 4, value: v.engine_number },
      { name: 'or_number', label: 'OR no.', col: 4, value: v.or_number }, { name: 'cr_number', label: 'CR no.', col: 4, value: v.cr_number },
      { name: 'registration_expiry', label: 'Registration expiry', type: 'date', col: 4, value: v.registration_expiry },
      { name: 'insurance_provider', label: 'Insurance provider', col: 4, value: v.insurance_provider }, { name: 'insurance_policy_number', label: 'Policy no.', col: 4, value: v.insurance_policy_number },
      { name: 'insurance_expiry', label: 'Insurance expiry', type: 'date', col: 4, value: v.insurance_expiry },
      { name: 'assigned_driver_id', label: 'Regular driver', type: 'select', options: UI.opts(d.drivers, p => p.full_name), col: 6, value: v.assigned_driver_id, help: 'Chosen first by the automatic assignment when free.' },
      { name: 'assigned_helper_id', label: 'Regular helper', type: 'select', options: UI.opts(d.helpers, p => p.full_name), col: 6, value: v.assigned_helper_id },
      { name: 'notes', label: 'Notes', col: 12, value: v.notes },
    ];
    UI.formModal(v.id ? 'Edit truck ' + UI.esc(v.plate_number) : 'Add truck', fields, 'Fleet.truck_save', { extra: v.id ? { id: v.id } : {},
      intro: 'OR/CR and insurance files can be attached in the truck details (Documents).' });
  },
  async truckDetails(id, d) {
    let r; try { r = await App.api('Fleet.truck_details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const v = r.truck;
    const canEdit = d.can.edit, canStatus = d.can.status;
    const acts = [];
    if (canEdit) acts.push(`<button class="btn btn-sm btn-outline-primary" data-a="edit"><i class="bi bi-pencil"></i> Edit</button>`);
    if (canStatus && +v.active) {
      if (v.status === 'Unavailable') acts.push(`<button class="btn btn-sm btn-success" data-a="avail"><i class="bi bi-check-circle"></i> Set Available</button>`);
      if (['Available', 'Assigned'].includes(v.status)) acts.push(`<button class="btn btn-sm btn-outline-danger" data-a="unavail"><i class="bi bi-slash-circle"></i> Set Unavailable</button>`);
      if (UI.role('motorpool') && ['Available', 'Assigned', 'Unavailable'].includes(v.status) && !r.openJob) acts.push(`<button class="btn btn-sm btn-outline-danger" data-a="maint"><i class="bi bi-wrench-adjustable"></i> Report problem</button>`);
    }
    if (canEdit) acts.push(`<button class="btn btn-sm btn-outline-secondary" data-a="docs"><i class="bi bi-paperclip"></i> Attach OR/CR / insurance</button>`,
      `<button class="btn btn-sm btn-outline-${+v.active ? 'danger' : 'success'}" data-a="active">${+v.active ? 'Deactivate' : 'Reactivate'}</button>`);
    const html = `<div class="d-flex gap-2 align-items-center mb-2">${UI.badge(v.status)}${+v.active ? '' : ' <span class="badge-s red">Inactive</span>'}${v.status_reason ? `<span class="small text-muted">${UI.esc(v.status_reason)}</span>` : ''}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}</div>` : ''}
      ${UI.h('Truck')}${UI.kv([['Plate / unit', `<b>${UI.esc(v.plate_number)}</b>${v.truck_number ? ' #' + UI.esc(v.truck_number) : ''}`], ['Type', UI.e(v.truck_type)], ['Make / model', UI.esc([v.make_brand, v.model].filter(Boolean).join(' ') || '—')],
        ['Chassis / engine', UI.esc([v.chassis_number, v.engine_number].filter(Boolean).join(' / ') || '—')], ['Regular driver', UI.e(v.driver_name)], ['Regular helper', UI.e(v.helper_name)],
        ['Notes', UI.e(v.notes)]])}
      ${r.openJob ? `<div class="next-step warn"><i class="bi bi-wrench-adjustable"></i> Under corrective maintenance: <a href="#maintenance?open=${r.openJob.id}">${UI.esc(r.openJob.job_ref)}</a> (${UI.esc(r.openJob.status === 'Completed' ? 'repair done, waiting for verification' : r.openJob.status)}). The truck cannot be assigned until the repair is verified.</div>` : ''}
      ${UI.h('Vehicle documents')}${UI.kv([['MV file no.', UI.e(v.mv_file_number)], ['OR / CR no.', UI.esc([v.or_number, v.cr_number].filter(Boolean).join(' / ') || '—')],
        ['Registration expiry', UI.date(v.registration_expiry)], ['Insurance', UI.esc([v.insurance_provider, v.insurance_policy_number].filter(Boolean).join(' · ') || '—')], ['Insurance expiry', UI.date(v.insurance_expiry)]])}
      <div class="mt-2">${UI.docs(r.documents, 'No OR/CR or insurance files attached yet.')}</div>
      ${UI.h('Trips (latest 50)')}${UI.table([['Trip', 'trip_ref'], ['Status', 'status', 'badge'], ['Schedule', 'scheduled_at', 'date'], ['Client', 'client'], ['Driver', 'driver_name'], ['Route', 'delivery_point']], r.trips, { plain: true, empty: 'No trips yet.' })}
      ${UI.h('Maintenance history')}${UI.table([['Record', 'job_ref'], ['Source', 'source'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date'], ['Cost', 'cost', 'money']], r.maintenance,
        { plain: true, empty: 'No maintenance records.', rowClick: (m) => { UI.closeDrawer(); App.go('maintenance', { open: m.id }); } })}
      ${UI.h('Status history')}<ul class="timeline">${r.statusLog.map(l => `<li><span class="when">${UI.datetime(l.created_at)} · ${UI.esc(l.actor || 'System')}</span><br>${UI.esc(l.from_status || 'new')} → <b>${UI.esc(l.to_status)}</b>${l.reason ? ' · ' + UI.esc(l.reason) : ''}</li>`).join('') || '<li>No changes yet.</li>'}</ul>`;
    const el = UI.drawer('Truck ' + UI.esc(v.plate_number), html, { subtitle: UI.esc(v.truck_type) });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') FleetUI.truckForm(v, d);
      if (a === 'avail') UI.confirmAction('Set ' + UI.esc(v.plate_number) + ' Available', 'The truck can be assigned to trips again.', 'Fleet.truck_status', { id: v.id, status: 'Available' }, { submit: 'Set Available' });
      if (a === 'unavail') UI.confirmAction('Set ' + UI.esc(v.plate_number) + ' Unavailable', 'A pre-assigned trip of this truck is re-assigned automatically (or waits for resources).', 'Fleet.truck_status', { id: v.id, status: 'Unavailable' },
        { danger: true, submit: 'Set Unavailable', fields: [{ name: 'reason', label: 'Reason (e.g. registration renewal)', required: true, col: 12 }] });
      if (a === 'maint') { UI.closeDrawer(); App.go('maintenance', { report: v.id }); }
      if (a === 'docs') UI.modal('Attach files to ' + UI.esc(v.plate_number), UI.fields([
          { name: 'category', label: 'Document', type: 'select', options: UI.list(['OR/CR', 'Insurance', 'Permit / Pass', 'Other']), required: true, col: 6 },
          { name: 'expires_on', label: 'Expiry date (for reminders)', type: 'date', col: 6 },
          { name: 'files', label: 'Files (PDF / photo)', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="application/pdf,image/*"' }]),
        async (dd, form) => { const fd = new FormData(); fd.append('entity_type', 'vehicle'); fd.append('entity_id', v.id); fd.append('category', dd.category); fd.append('expires_on', dd.expires_on || '');
          [...form.querySelector('[name=files]').files].forEach(f => fd.append('files[]', f)); const res = await App.upload(fd); UI.result(res); FleetUI.truckDetails(v.id, d); }, { size: '', submit: 'Upload' });
      if (a === 'active') UI.confirmAction((+v.active ? 'Deactivate ' : 'Reactivate ') + UI.esc(v.plate_number), +v.active ? 'The truck leaves the masterlist choices. Its past trips and records stay.' : 'The truck returns to the masterlist.', 'Fleet.truck_active', { id: v.id, active: +v.active ? 0 : 1 }, { danger: +v.active });
    });
  },
  crewForm(p) {
    UI.formModal(p.id ? 'Edit ' + UI.esc(p.full_name) : 'Add driver or helper', [
      { name: 'full_name', label: 'Name (LAST NAME, FIRST NAME)', required: true, col: 8, value: p.full_name, placeholder: 'JUEGOS, HECTOR' },
      { name: 'person_type', label: 'Type', type: 'select', options: UI.list(['Driver', 'Helper']), required: true, col: 4, value: p.person_type },
      { name: 'employee_no', label: 'Employee no.', col: 4, value: p.employee_no }, { name: 'contact_number', label: 'Contact number', col: 4, value: p.contact_number },
      { name: 'date_hired', label: 'Date hired', type: 'date', col: 4, value: p.date_hired },
      { name: 'license_number', label: "Driver's license no. (drivers)", col: 6, value: p.license_number }, { name: 'license_expiry', label: 'License expiry', type: 'date', col: 6, value: p.license_expiry },
      { name: 'address', label: 'Address', col: 12, value: p.address }, { name: 'notes', label: 'Notes', col: 12, value: p.notes }],
      'Fleet.crew_save', { extra: p.id ? { id: p.id } : {}, intro: 'Drivers need a license number and expiry. A driver with an expired license is not assigned automatically.' });
  },
  async crewDetails(id, d) {
    let r; try { r = await App.api('Fleet.crew_details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const p = r.person;
    const acts = d.can.edit ? [`<button class="btn btn-sm btn-outline-primary" data-a="edit"><i class="bi bi-pencil"></i> Edit</button>`,
      +p.active ? (p.availability === 'Unavailable' ? `<button class="btn btn-sm btn-success" data-a="avail">Set Available</button>` : `<button class="btn btn-sm btn-outline-danger" data-a="unavail">Set Unavailable</button>`) : '',
      `<button class="btn btn-sm btn-outline-${+p.active ? 'danger' : 'success'}" data-a="active">${+p.active ? 'Deactivate' : 'Reactivate'}</button>`] : [];
    const html = `<div class="mb-2">${UI.badge(p.availability)} ${+p.active ? '' : '<span class="badge-s red">Inactive</span>'} ${p.unavailable_reason ? `<span class="small text-muted">${UI.esc(p.unavailable_reason)}</span>` : ''}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}</div>` : ''}
      ${UI.h('Details')}${UI.kv([['Type', UI.e(p.person_type)], ['Employee no.', UI.e(p.employee_no)], ['Contact', UI.e(p.contact_number)], ['Address', UI.e(p.address)],
        ["License", UI.esc([p.license_number, p.license_expiry ? 'expires ' + UI.date(p.license_expiry) : ''].filter(Boolean).join(' · ') || '—')], ['Date hired', UI.date(p.date_hired)], ['Notes', UI.e(p.notes)]])}
      ${UI.h('Trip history')}${UI.table([['Trip', 'trip_ref'], ['As', 'role_on_trip'], ['Status', 'status', 'badge'], ['Schedule', 'scheduled_at', 'date'], ['Truck', 'plate_number'], ['Client', 'client'], ['To', 'delivery_point']], r.trips, { empty: 'No trips yet.' })}`;
    const el = UI.drawer(UI.esc(p.full_name), html, { subtitle: UI.esc(p.person_type) });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') FleetUI.crewForm(p);
      if (a === 'avail') UI.confirmAction('Set ' + UI.esc(p.full_name) + ' Available', 'This person can be assigned to trips again.', 'Fleet.crew_status', { id: p.id, availability: 'Available' });
      if (a === 'unavail') UI.confirmAction('Set ' + UI.esc(p.full_name) + ' Unavailable', 'A pre-assigned trip is re-assigned automatically.', 'Fleet.crew_status', { id: p.id, availability: 'Unavailable' },
        { danger: true, fields: [{ name: 'reason', label: 'Reason (leave, sick, ...)', required: true, col: 12 }] });
      if (a === 'active') UI.confirmAction((+p.active ? 'Deactivate ' : 'Reactivate ') + UI.esc(p.full_name), +p.active ? 'Past trips keep the name.' : 'The person returns to the masterlist.', 'Fleet.crew_active', { id: p.id, active: +p.active ? 0 : 1 }, { danger: +p.active });
    });
  },
};

App.page('trucks', {
  title: 'Truck Masterlist',
  subtitle: 'All registered trucks, their availability, current trip, documents and maintenance.',
  render(ctx) {
    const d = ctx.data;
    if (d.can.edit) UI.tool(ctx, 'Add truck', () => FleetUI.truckForm({}, d), 'bi-plus-lg', 'primary');
    const q = ctx.query;
    let rows = d.trucks.filter(v => (q.inactive ? true : +v.active) && (!q.truck_type || v.truck_type === q.truck_type) && (!q.status || v.status === q.status)
      && (!q.docs || (q.docs === 'expiring' && ((v.reg_days !== null && +v.reg_days <= +d.alertDays) || (v.ins_days !== null && +v.ins_days <= +d.alertDays)))));
    const act = d.trucks.filter(v => +v.active), n = (s) => act.filter(v => v.status === s).length;
    ctx.el.innerHTML = UI.statusStrip([
      { label: 'Total trucks', value: act.length },
      { label: 'Available', value: n('Available'), color: 'green', go: 'trucks?status=Available' },
      { label: 'Assigned / on trip', value: n('Assigned') + n('On Trip'), color: 'blue', note: n('On Trip') + ' on the road' },
      { label: 'Under maintenance', value: n('Under Maintenance'), color: n('Under Maintenance') ? 'red' : '', go: 'trucks?status=Under%20Maintenance' },
      { label: 'Unavailable', value: n('Unavailable'), color: n('Unavailable') ? 'red' : '', go: 'trucks?status=Unavailable' },
    ]) + UI.filterModal(ctx, [
      { name: 'truck_type', label: 'Truck type', type: 'select', options: UI.list(App.me.truckTypes), col: 6 },
      { name: 'status', label: 'Status', type: 'select', options: UI.list(['Available', 'Assigned', 'On Trip', 'Under Maintenance', 'Unavailable']), col: 6 },
      { name: 'docs', label: 'Documents', type: 'select', options: [['expiring', 'Registration or insurance expiring / expired']], col: 6 },
      { name: 'inactive', label: 'Include inactive trucks', type: 'checkbox', col: 12 }], { hint: 'Showing all active trucks.' }) + UI.table([
      ['Truck', 'plate_number', (v, r) => `<b>${UI.esc(v)}</b>${+r.active ? '' : ' <span class="badge-s red">Inactive</span>'}<div class="cell-sub">${r.truck_number ? 'Unit #' + UI.esc(r.truck_number) : 'No unit no.'}</div>`],
      ['Type', 'truck_type'],
      ['Availability', 'status', (v, r) => UI.badge(v) + (r.status_reason && v === 'Unavailable' ? `<div class="cell-sub">${UI.esc(r.status_reason)}</div>` : '')],
      ['Current assignment', 'trip_ref', (v, r) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(r.trip_status)}</div>` : (r.open_job ? `${UI.esc(r.open_job)}<div class="cell-sub">${UI.esc(r.open_job_status === 'Completed' ? 'waiting for verification' : r.open_job_status)}${r.expected_back ? ' · back ' + UI.date(r.expected_back) : ''}</div>` : '<span class="text-muted">—</span>')],
      ['Regular driver', 'driver_name'], ['Registration', 'registration_expiry', (v, r) => FleetUI.docBadge(r.reg_days, v)], ['Insurance', 'insurance_expiry', (v, r) => FleetUI.docBadge(r.ins_days, v)]], rows,
      { actions: () => UI.btn('view', 'Open'), onAction: (a, v) => FleetUI.truckDetails(v.id, d), rowClick: (v) => FleetUI.truckDetails(v.id, d), empty: 'No truck matches the filter.' });
    UI.activate(ctx.el);
    if (q.open) FleetUI.truckDetails(q.open, d);
  },
});

App.page('crew', {
  title: 'Driver Masterlist',
  subtitle: 'Drivers and helpers: availability, current trip and license expiry.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    if (d.can.edit) UI.tool(ctx, 'Add driver or helper', () => FleetUI.crewForm({}), 'bi-plus-lg', 'primary');
    const act = d.crew.filter(p => +p.active);
    const rows = d.crew.filter(p => (q.inactive ? true : +p.active) && (!q.person_type || p.person_type === q.person_type) && (!q.availability || p.availability === q.availability)
      && (!q.license || (p.license_days !== null && +p.license_days <= +d.alertDays)));
    const c = (t, a) => act.filter(p => p.person_type === t && (!a || p.availability === a)).length;
    ctx.el.innerHTML = UI.statusStrip([
      { label: 'Drivers', value: c('Driver') },
      { label: 'Drivers available', value: c('Driver', 'Available'), color: 'green' },
      { label: 'Drivers on trip', value: c('Driver', 'On Trip'), color: 'blue' },
      { label: 'Helpers available', value: c('Helper', 'Available') + ' / ' + c('Helper') },
      { label: 'Unavailable', value: act.filter(p => p.availability === 'Unavailable').length, color: act.some(p => p.availability === 'Unavailable') ? 'red' : '' },
    ]) + UI.filterModal(ctx, [
      { name: 'person_type', label: 'Type', type: 'select', options: UI.list(['Driver', 'Helper']), col: 6 },
      { name: 'availability', label: 'Availability', type: 'select', options: UI.list(['Available', 'On Trip', 'Unavailable']), col: 6 },
      { name: 'license', label: 'License', type: 'select', options: [['expiring', 'Expiring / expired']], col: 6 },
      { name: 'inactive', label: 'Include inactive drivers and helpers', type: 'checkbox', col: 12 }], { hint: 'Showing all active drivers and helpers.' }) + UI.table([
      ['Name', 'full_name', (v, r) => `<b>${UI.esc(v)}</b>${+r.active ? '' : ' <span class="badge-s red">Inactive</span>'}<div class="cell-sub">${UI.esc(r.employee_no ? 'ID ' + r.employee_no : r.person_type)}</div>`], ['Type', 'person_type'],
      ['Availability', 'availability', (v, r) => UI.badge(v) + (r.unavailable_reason ? `<div class="small text-muted">${UI.esc(r.unavailable_reason)}</div>` : '')],
      ['Current trip', 'trip_ref', (v, r) => v ? `${UI.esc(v)} <span class="small text-muted">${UI.esc(r.trip_plate || '')} · ${UI.esc(r.trip_status)}</span>` : '—'],
      ['Regular truck', 'regular_truck'], ['License expiry', 'license_expiry', (v, r) => FleetUI.docBadge(r.license_days, v)], ['Completed trips', 'completed_trips', 'num'], ['Contact', 'contact_number']], rows,
      { actions: () => UI.btn('view', 'Open'), onAction: (a, p) => FleetUI.crewDetails(p.id, d), rowClick: (p) => FleetUI.crewDetails(p.id, d), empty: 'No driver or helper matches the filter.' });
    UI.activate(ctx.el);
  },
});
