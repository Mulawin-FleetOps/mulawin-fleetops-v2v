/* assets/js/modules/operations/fleet.js — TRUCK MASTERLIST and DRIVER & HELPER MASTERLIST
   The only place where trucks, drivers and helpers are added or edited. Every other
   module (trips, maintenance, purchasing, reports) points to these records.
   Backend: backend/Modules/Operations/Fleet.php */
'use strict';
const FleetUI = {
  // Shared presentation for Truck, Driver and Helper detail drawers.
  // Move existing DOM nodes (never clone them), retaining all action and table handlers.
  decorateDetailDrawer(drawer) {
    drawer.classList.add('fleet-master-detail-drawer');
    const body=drawer.querySelector('.offcanvas-body');
    if(!body)return;
    const actions=body.querySelector('.drawer-actions');
    if(actions)actions.classList.add('fleet-detail-actions');
    const status=body.firstElementChild;
    if(status && status!==actions && status.classList.contains('mb-2') ||
       status && status!==actions && status.classList.contains('d-flex')){
      status.classList.add('fleet-detail-status');
    }
    const headings=[...body.querySelectorAll(':scope > .drawer-h')];
    const icons=['bi-info-circle','bi-file-earmark-check','bi-clock-history','bi-wrench-adjustable','bi-list-check'];
    headings.forEach((heading,index)=>{
      const title=heading.querySelector('span')?.textContent?.trim()||'Details';
      const section=document.createElement('details');
      section.className='fleet-detail-section';
      section.open=index===0;
      const label=document.createElement('summary');
      const icon=document.createElement('i');
      icon.className='bi '+(icons[index]||'bi-folder2-open');
      icon.setAttribute('aria-hidden','true');
      const name=document.createElement('strong');name.textContent=title;
      const chevron=document.createElement('i');chevron.className='bi bi-chevron-down fleet-detail-chevron';
      chevron.setAttribute('aria-hidden','true');
      label.append(icon,name,chevron);
      const content=document.createElement('div');content.className='fleet-detail-section-body';
      let next=heading.nextSibling;
      while(next && !(next.nodeType===1&&next.classList.contains('drawer-h'))){
        const moving=next;next=next.nextSibling;content.append(moving);
      }
      section.append(label,content);heading.replaceWith(section);
    });
  },
  // Checklist #13/#14: prominent type tabs; no change to server-side filters.
  masterlistTypeTabs(page, param, options, current) {
    return `<div class="btn-group btn-group-sm flex-wrap" role="group" aria-label="${page === 'trucks' ? 'Truck types' : 'Personnel types'}">
      ${options.map(([value, label]) => `<button type="button" class="btn ${String(current || '') === String(value) ? 'btn-primary' : 'btn-outline-secondary'}" data-masterlist-tab="${UI.esc(page)}" data-param="${UI.esc(param)}" data-value="${UI.esc(value)}" aria-pressed="${String(current || '') === String(value) ? 'true' : 'false'}">${UI.esc(label)}</button>`).join('')}
    </div>`;
  },
  bindMasterlistTypeTabs(ctx) {
    ctx.el.querySelectorAll('[data-masterlist-tab]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.param;
        const value = button.dataset.value;
        const next = { ...ctx.query };
        if (value) next[key] = value;
        else delete next[key];
        App.go(ctx.page, next);
      });
    });
  },
  docBadge(days, date) {
    if (!date) return '<span class="text-muted">—</span>';
    return UI.date(date) + ' ' + UI.days(days);
  },
  truckRows(d,q) {
    return d.trucks.filter(v=>(q.inactive?true:+v.active)&&(!q.truck_type||v.truck_type===q.truck_type)&&(!q.status||v.status===q.status)&&(!q.docs||(q.docs==='expiring'&&((v.reg_days!==null&&+v.reg_days<=+d.alertDays)||(v.ins_days!==null&&+v.ins_days<=+d.alertDays)))));
  },
  truckForm(v, d) {
    const truckInfo = [
      { name: 'plate_number', label: 'Plate Number', required: true, col: 6, value: v.plate_number, placeholder: 'NAJ5941' },
      { name: 'truck_type', label: 'Truck Type', type: 'select', options: UI.list(App.me.truckTypes), required: true, col: 6, value: v.truck_type },
      { name: 'truck_number', label: 'Unit Number', col: 6, value: v.truck_number, placeholder: 'e.g. W2' },
      { name: 'make_brand', label: 'Make / Brand', col: 6, value: v.make_brand },
      { name: 'model', label: 'Model', col: 6, value: v.model },
    ];
    const fixedCrew = [
      { name: 'assigned_driver_id', label: 'Fixed Driver', type: 'select', options: UI.opts(d.drivers, p => p.full_name), col: 6, value: v.assigned_driver_id, help: 'Regular pairing used during dispatch.' },
      { name: 'assigned_helper_id', label: 'Regular Helper', type: 'select', options: UI.opts(d.helpers, p => p.full_name), col: 6, value: v.assigned_helper_id },
    ];
    const documents = [
      { name: 'mv_file_number', label: 'MV File No.', col: 6, value: v.mv_file_number },
      { name: 'chassis_number', label: 'Chassis No.', col: 6, value: v.chassis_number },
      { name: 'engine_number', label: 'Engine No.', col: 6, value: v.engine_number },
      { name: 'or_number', label: 'OR No.', col: 6, value: v.or_number },
      { name: 'cr_number', label: 'CR No.', col: 6, value: v.cr_number },
      { name: 'registration_expiry', label: 'Registration Expiry', type: 'date', col: 6, value: v.registration_expiry },
      { name: 'insurance_provider', label: 'Insurance Provider', col: 6, value: v.insurance_provider },
      { name: 'insurance_policy_number', label: 'Policy No.', col: 6, value: v.insurance_policy_number },
      { name: 'insurance_expiry', label: 'Insurance Expiry', type: 'date', col: 6, value: v.insurance_expiry },
      { name: 'notes', label: 'Notes', type: 'textarea', col: 12, value: v.notes },
    ];
    const groups = [
      FormComponents.section('Truck Information', 'bi-truck', truckInfo),
      // Retain legacy truck assignment values without showing duplicate editable controls.
      UI.fields(fixedCrew.map(field=>({name:field.name,type:'hidden',value:field.value}))),
      FormComponents.collapsible('Registration & Insurance', 'Vehicle documents, insurance and notes', 'bi-file-earmark-text', documents),
    ];
    return FormComponents.modal(
      v.id ? 'Edit Truck ' + UI.esc(v.plate_number) : 'Add Truck',
      groups, 'Fleet.truck_save', {
        extra: v.id ? { id: v.id } : {},
        intro: 'Truck authorizations are now managed in Drivers & Helpers. OR/CR and insurance files can be attached from Truck Details → Documents.',
        submit: v.id ? 'Save Changes' : 'Save Truck',
        after: v.id ? () => FleetUI.truckDetails(v.id, d) : undefined,
      }
    );
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
      ${UI.h('Truck')}${UI.kv([['Plate / unit', `<b>${UI.esc(v.plate_number)}</b>${v.truck_number ? ' #' + UI.esc(v.truck_number) : ''}`], [UI.role('operations_head')?'Truck Type':'Type', UI.e(v.truck_type)], ['Make / model', UI.esc([v.make_brand, v.model].filter(Boolean).join(' ') || '—')],
        ['Chassis / engine', UI.esc([v.chassis_number, v.engine_number].filter(Boolean).join(' / ') || '—')], ['Authorized Drivers', UI.e(v.authorized_driver_names||v.driver_name)], ['Regular Helper (preferred)', UI.e(v.helper_name)],
        ['Notes', UI.e(v.notes)]])}
      ${r.openJob ? `<div class="next-step warn"><i class="bi bi-wrench-adjustable"></i> Under corrective maintenance: <a href="#maintenance?open=${r.openJob.id}">${UI.esc(r.openJob.job_ref)}</a> (${UI.esc(r.openJob.status === 'Completed' ? 'repair done, waiting for verification' : r.openJob.status)}). The truck cannot be assigned until the repair is verified.</div>` : ''}
      ${UI.h('Vehicle documents')}${UI.kv([['MV file no.', UI.e(v.mv_file_number)], ['OR / CR no.', UI.esc([v.or_number, v.cr_number].filter(Boolean).join(' / ') || '—')],
        ['Registration expiry', UI.date(v.registration_expiry)], ['Insurance', UI.esc([v.insurance_provider, v.insurance_policy_number].filter(Boolean).join(' · ') || '—')], ['Insurance expiry', UI.date(v.insurance_expiry)]])}
      <div class="mt-2">${UI.docs(r.documents, 'No OR/CR or insurance files attached yet.')}</div>
      ${UI.h('Trips (latest 50)')}${(r.trips||[]).length ? UI.table([['Trip', 'trip_ref'], ['Status', 'status', 'badge'], ['Schedule', 'scheduled_at', 'datetime'], ['Client', 'client'], ['Driver', 'driver_name'], ['Route', 'delivery_point']], r.trips, { plain: true, empty: 'No trips yet.' }) : '<div class="fleet-detail-empty"><i class="bi bi-inbox" aria-hidden="true"></i><strong>No trip history yet</strong><span>Trips assigned to this truck will appear here.</span></div>'}
      ${UI.h('Maintenance history')}${(r.maintenance||[]).length ? UI.table([['Record', 'job_ref'], ['Source', 'source'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date'], ['Cost', 'cost', 'money']], r.maintenance,
        { plain: true, empty: 'No maintenance records.', rowClick: (m) => { UI.closeDrawer(); App.go('maintenance', { open: m.id }); } }) : '<div class="fleet-detail-empty"><i class="bi bi-tools" aria-hidden="true"></i><strong>No maintenance history</strong><span>Repair records will appear here when available.</span></div>'}
      ${UI.h('Status history')}<ul class="timeline">${r.statusLog.map(l => `<li><span class="when">${UI.datetime(l.created_at)} · ${UI.esc(l.actor || 'System')}</span><br>${UI.esc(l.from_status || 'new')} → <b>${UI.esc(l.to_status)}</b>${l.reason ? ' · ' + UI.esc(l.reason) : ''}</li>`).join('') || '<li>No changes yet.</li>'}</ul>`;
    const el = UI.drawer('Truck ' + UI.esc(v.plate_number), html, { subtitle: UI.esc(v.truck_type) });
    this.decorateDetailDrawer(el);
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
  crewForm(p, d = {}) {
    if(UI.role('operations_head'))return FleetUI.opsCrewForm(p,d);
    UI.formModal(p.id ? 'Edit ' + UI.esc(p.full_name) : 'Add driver or helper', [
      { name: 'full_name', label: 'Name (LAST NAME, FIRST NAME)', required: true, col: 8, value: p.full_name, placeholder: 'JUEGOS, HECTOR' },
      { name: 'person_type', label: 'Type', type: 'select', options: UI.list(['Driver', 'Helper']), required: true, col: 4, value: p.person_type },
      { name: 'attendance_group', label: 'Attendance Group', type: 'select', col: 6, required: true, value: p.attendance_group, options: [['car_carrier_dispatcher','Car Carrier'],['container_wingvan_dispatcher','Container / Wing Van']], help: 'Used for attendance if no regular truck is linked. Does not grant truck authorization.' },
      { name: 'employee_no', label: 'Employee no.', col: 4, value: p.employee_no }, { name: 'contact_number', label: 'Contact number', col: 4, value: p.contact_number },
      { name: 'date_hired', label: 'Employment start date', type: 'date', col: 4, value: p.date_hired },
      { name: 'license_number', label: "Driver's license no. (drivers)", col: 6, value: p.license_number }, { name: 'license_expiry', label: 'Driver’s license expiry date', type: 'date', col: 6, value: p.license_expiry },
      { name: 'address', label: 'Address', col: 12, value: p.address }, { name: 'notes', label: 'Notes', col: 12, value: p.notes }],
      'Fleet.crew_save', { extra: p.id ? { id: p.id } : {}, intro: 'Drivers need a license number and expiry. A driver with an expired license is not assigned automatically.' });
  },
  async opsCrewForm(p,d) {
    if(!d.assignmentTrucks||!d.assignmentHelpers){
      try { d=await App.data('crew'); }
      catch(error){ return UI.toast(error.message,'error'); }
    }
    const type=p.person_type==='Helper'?'Helper':'Driver',driver=type==='Driver';
    const allTrucks=d.assignmentTrucks||[];
    const already=String(p.authorized_truck_ids||'').split(',').map(Number).filter(id=>Number.isInteger(id)&&id>0);
    // Preserve legacy fixed links when upgrading a database that has not yet
    // displayed the additive authorization backfill.
    if(driver&&!already.length&&p.fixed_truck_id)already.push(+p.fixed_truck_id);
    const groups=['Car Carrier','Container','Wing Van'];
    const selectedTrucks=new Set(already);
    // Existing Trucks can be changed to an unclaimed, available Truck.
    const truckOptions=allTrucks.filter(truck=>groups.includes(truck.truck_type));
    // All active trucks are searchable; existing authorizations are locked.
    const truckCategories=['All',...groups];
    const regularTruck=allTrucks.find(truck=>already.includes(+truck.id));
    const existingHelperId=already.length===1?Number(regularTruck?.assigned_helper_id||0):0;
    const availableHelpers=(d.assignmentHelpers||[]).filter(helper=>
      !helper.assigned_vehicle_id||Number(helper.id)===existingHelperId);

    const authorizedBoxes=driver?'<div class="driver-auth-selector" data-driver-truck-selector>'
      +'<label class="driver-auth-search-label" for="driver-truck-search">Find a truck</label>'
      +'<div class="driver-auth-search-field"><i class="bi bi-search" aria-hidden="true"></i>'
      +'<input id="driver-truck-search" type="search" class="form-control form-control-sm" '
      +'placeholder="Search truck plate or unit number..." autocomplete="off" data-driver-truck-search></div>'
      +'<div class="driver-auth-filters" role="group" aria-label="Filter trucks by category">'
      +truckCategories.map((group,index)=>'<button type="button" class="driver-auth-filter'+(index===0?' is-active':'')+'"'
        +' data-driver-truck-filter="'+UI.esc(group)+'" aria-pressed="'+(index===0?'true':'false')+'">'
        +UI.esc(group)+'</button>').join('')+'</div>'
      +'<div class="driver-auth-list" role="group" aria-label="Truck selection">'
      +truckOptions.map(truck=>{
        const selected=selectedTrucks.has(+truck.id);
        const owners=String(truck.authorized_driver_ids||'').split(',').filter(Boolean);
        const otherDriver=owners.some(id=>String(id)!==String(p.id||''))
          ||(!!truck.assigned_driver_id&&String(truck.assigned_driver_id)!==String(p.id||''));
        const today=UI.nowManila().slice(0,10);
        const expiredDocs=(!!truck.registration_expiry&&truck.registration_expiry<today)
          ||(!!truck.insurance_expiry&&truck.insurance_expiry<today);
        const unavailable=!selected&&(otherDriver||expiredDocs
          ||['Unavailable','Under Maintenance','On Trip'].includes(truck.status)
          ||!!Number(truck.has_active_trip||0)||!!Number(truck.has_open_job||0));
        const locked=unavailable;
        const plate=String(truck.plate_number||'');
        const unit=String(truck.truck_number||'');
        return '<label class="driver-auth-option'+(locked?' is-locked':'')+'"'
          +' data-driver-truck-option data-truck-type="'+UI.esc(truck.truck_type)+'"'
          +' data-truck-search="'+UI.esc((plate+' '+unit+' '+truck.truck_type).toLowerCase())+'"'
          +' data-truck-blocked="'+(unavailable?'1':'0')+'">'
          +'<input type="checkbox" name="auth_truck_'+Number(truck.id)+'" value="1"'
          +(selected?' checked':'')
          +(locked?' disabled':'')+'>'
          +'<span class="driver-auth-option-info"><strong>'+UI.esc(plate)+'</strong>'
          +'<small>'+UI.esc(truck.truck_type)+(unit?' · Unit '+UI.esc(unit):'')+'</small></span>'
          +'<span class="driver-auth-option-status'+(unavailable?' is-unavailable':selected?' is-selected':' is-available')+'">'
          +(selected?'Current Truck':unavailable?(otherDriver?'Assigned · Locked':'Unavailable'):'Available')+'</span></label>';
      }).join('')
      +'<p class="driver-auth-empty" data-driver-truck-empty hidden>No matching trucks found.</p>'
      +'</div><div class="driver-auth-footer"><span data-driver-truck-results></span>'
      +'<span class="driver-auth-count" role="status" aria-live="polite" data-authorized-count></span></div>'
      +'</div>':'';    const identity=[
      {name:'person_type',type:'hidden',value:type},
      {name:'full_name',label:'Full Name (LAST NAME, FIRST NAME)',required:true,col:12,value:p.full_name},
      {name:'attendance_group',label:'Attendance Group',type:'select',required:true,col:6,value:p.attendance_group,options:[['car_carrier_dispatcher','Car Carrier'],['container_wingvan_dispatcher','Container / Wing Van']],help:'For Time In when no regular truck exists. Trip authorization stays separate.'},
      {name:'employee_no',label:'Employee No.',col:4,value:p.employee_no},
      {name:'contact_number',label:'Contact Number',col:4,value:p.contact_number},
      {name:'date_hired',label:'Date Hired',type:'date',col:4,value:p.date_hired},
      ...(!driver?[
        {name:'license_number',type:'hidden',value:p.license_number},
        {name:'license_expiry',type:'hidden',value:p.license_expiry},
      ]:[]),
    ];
    const licensing=driver?[
      {name:'license_number',label:'License Number',required:true,col:6,value:p.license_number},
      {name:'license_expiry',label:'License Expiry',type:'date',required:true,col:6,value:p.license_expiry},
    ]:[];
    const additional=[
      {name:'address',label:'Address',col:12,value:p.address},
      {name:'notes',label:'Notes',type:'textarea',rows:2,col:12,value:p.notes},
    ];
    const section=FormComponents.section('Driver License','bi-card-checklist',licensing);
    const authorization='<section class="record-form-section driver-auth-section">'
      +'<div class="record-form-section-title"><i class="bi bi-truck" aria-hidden="true"></i>'
      +'<h3>Authorized Trucks</h3></div>'
      +'<p class="form-help">Choose one available Truck. Selecting another replaces the current choice. '
      +'Already assigned, unavailable, and trip-held Trucks are locked. The server rechecks when saving.</p>'
      +authorizedBoxes+'</section>';
    const helperSection='<section class="record-form-section driver-auth-section">'
      +'<div class="record-form-section-title"><i class="bi bi-people" aria-hidden="true"></i><h3>Regular Helper</h3></div>'
      +'<p class="form-help">Select one available regular helper. Existing pairings remain locked; trip-level crew assignments are separate.</p>'
      +'<div class="driver-auth-selector" data-driver-helper-selector>'
      +'<label class="driver-auth-search-label" for="driver-helper-search">Find a helper</label>'
      +'<div class="driver-auth-search-field"><i class="bi bi-search" aria-hidden="true"></i>'
      +'<input id="driver-helper-search" type="search" class="form-control form-control-sm" '
      +'placeholder="Search helper name or employee number..." autocomplete="off" data-driver-helper-search></div>'
      +'<div class="driver-auth-list" role="group" aria-label="Regular helper selection">'
      +(d.assignmentHelpers||[]).map(helper=>{
        const selected=Number(helper.id)===existingHelperId;
        const assigned=!!helper.assigned_vehicle_id&&!selected;
        const name=String(helper.full_name||'');
        const employee=String(helper.employee_no||'');
        return '<label class="driver-auth-option'+(selected||assigned?' is-locked':'')+'"'
          +' data-driver-helper-option data-helper-search="'+UI.esc((name+' '+employee).toLowerCase())+'">'
          +'<input type="checkbox" name="regular_helper_choice_'+Number(helper.id)+'" value="1"'
          +(selected?' checked':'')+(selected||assigned?' disabled':'')+'>'
          +'<span class="driver-auth-option-info"><strong>'+UI.esc(name)+'</strong><small>'
          +UI.esc(employee?'Employee '+employee:'Helper')+'</small></span>'
          +'<span class="driver-auth-option-status '+(selected?'is-selected':assigned?'is-unavailable':'is-available')+'">'
          +(selected?'Assigned · Locked':assigned?'Assigned':'Available')+'</span></label>';
      }).join('')
      +'<p class="driver-auth-empty" data-driver-helper-empty hidden>No matching helpers found.</p>'
      +'</div><div class="driver-auth-footer"><span data-driver-helper-results></span>'
      +'<span class="driver-auth-count" role="status" data-driver-helper-count></span></div></div></section>';
    const sections=[
      FormComponents.section('Personal Information','bi-person-badge',identity),
      ...(driver?[section,authorization,helperSection]:[]),
      FormComponents.section('Additional Information','bi-file-earmark-text',additional),
    ];
    return FormComponents.modal((p.id?'Edit ':'Add ')+type,sections,'Fleet.crew_save',{
      intro:'Role: '+type+'. A fixed Truck can be reassigned by the Operations Head if both resources are free from active trips.',
      extra:p.id?{id:p.id}:{},
      submit:'Save '+type,
      compact:true,
      compactSize:driver?'normal':'small',
      transform:(values,form)=>{
        if(!driver)return values;
        const authorized=[...form.querySelectorAll('[data-driver-truck-selector] input:checked')]
          .map(input=>Number(input.name.slice('auth_truck_'.length)));
        for(const key of Object.keys(values).filter(k=>/^auth_truck_\d+$/.test(k)))delete values[key];
        const selectedHelper=form.querySelector('[data-driver-helper-selector] input:checked');
        // When changing Trucks, use the Helper linked to the target Truck.
        // Never move the previous Truck's Helper without explicit selection.
        const chosenTruck=allTrucks.find(t=>Number(t.id)===authorized[0]);
        const regularHelper=selectedHelper?Number(selectedHelper.name.slice('regular_helper_choice_'.length))
          :Number(chosenTruck?.assigned_helper_id||0)||null;
        for(const key of Object.keys(values).filter(k=>/^regular_helper_choice_\d+$/.test(k)))delete values[key];
        return {...values,authorized_vehicle_ids:JSON.stringify(authorized),regular_helper_id:regularHelper||''};
      },
      after(){UI.closeDrawer();App.route();},
      onShow(wrap,form){
        if(!driver)return;
        const selector=form.querySelector('[data-driver-truck-selector]');
        const inputs=[...selector.querySelectorAll('.driver-auth-option input[type=checkbox]')];
        const options=[...selector.querySelectorAll('[data-driver-truck-option]')];
        const count=selector.querySelector('[data-authorized-count]');
        const resultCount=selector.querySelector('[data-driver-truck-results]');
        const empty=selector.querySelector('[data-driver-truck-empty]');
        const search=selector.querySelector('[data-driver-truck-search]');
        const filters=[...selector.querySelectorAll('[data-driver-truck-filter]')];
        let category='All';
        let syncHelpersForTruck=()=>{};
        const update=()=>{
          const selected=inputs.find(input=>input.checked);
          count.textContent=selected
            ?(already.includes(Number(selected.name.slice('auth_truck_'.length)))
              ?'Current Truck selected':'Replacement selected · save to reassign')
            :'Select a Truck';
          inputs.forEach(input=>{
            const option=input.closest('.driver-auth-option');
            const blocked=option.dataset.truckBlocked==='1';
            input.disabled=blocked;
            option.classList.toggle('is-locked',blocked);
            const badge=option.querySelector('.driver-auth-option-status');
            if(badge){
              badge.className='driver-auth-option-status '+(input.checked?'is-selected':blocked?'is-unavailable':'is-available');
              badge.textContent=input.checked?(already.includes(Number(input.name.slice('auth_truck_'.length)))?'Current Truck':'Selected · Pending Save')
                :blocked?'Assigned / Unavailable':'Available';
            }
          });
          syncHelpersForTruck();
        };
        const filterOptions=()=>{
          const term=search.value.trim().toLowerCase();
          let visible=0;
          options.forEach(option=>{
            const matches=(category==='All'||option.dataset.truckType===category)
              &&(!term||(option.dataset.truckSearch||'').includes(term));
            option.hidden=!matches;
            if(matches)visible++;
          });
          if(empty)empty.hidden=visible>0;
          if(resultCount)resultCount.textContent='Showing '+visible+' of '+options.length+' trucks';
        };
        filters.forEach(button=>button.addEventListener('click',()=>{
          category=button.dataset.driverTruckFilter;
          filters.forEach(other=>{
            const active=other===button;
            other.classList.toggle('is-active',active);
            other.setAttribute('aria-pressed',String(active));
          });
          filterOptions();
        }));
        search.addEventListener('input',filterOptions);
        inputs.forEach(input=>input.addEventListener('change',()=>{
          if(input.checked)inputs.forEach(other=>{if(other!==input)other.checked=false;});
          else if(!inputs.some(other=>other.checked))input.checked=true;
          update();
        }));
        update();
        filterOptions();
        const helperSelector=form.querySelector('[data-driver-helper-selector]');
        const helperInputs=[...helperSelector.querySelectorAll('input[type=checkbox]')];
        const helperOptions=[...helperSelector.querySelectorAll('[data-driver-helper-option]')];
        const helperSearch=helperSelector.querySelector('[data-driver-helper-search]');
        const helperCount=helperSelector.querySelector('[data-driver-helper-count]');
        const helperResults=helperSelector.querySelector('[data-driver-helper-results]');
        const helperEmpty=helperSelector.querySelector('[data-driver-helper-empty]');
        const refreshHelpers=()=>{
          const term=helperSearch.value.trim().toLowerCase();
          let visible=0;
          helperOptions.forEach(option=>{
            option.hidden=!!term&&!(option.dataset.helperSearch||'').includes(term);
            if(!option.hidden)visible++;
          });
          helperEmpty.hidden=visible>0;
          helperResults.textContent='Showing '+visible+' of '+helperOptions.length+' helpers';
        };
        syncHelpersForTruck=()=>{
          const selected=inputs.find(input=>input.checked);
          const truckId=selected?Number(selected.name.slice('auth_truck_'.length)):0;
          const truck=allTrucks.find(v=>Number(v.id)===truckId);
          const fixedHelper=Number(truck?.assigned_helper_id||0);
          // A Car Carrier has no regular Helper in the current backend model.
          const isCarrier=truck?.truck_type==='Car Carrier';
          helperInputs.forEach(input=>{
            const helperId=Number(input.name.slice('regular_helper_choice_'.length));
            const helper=(d.assignmentHelpers||[]).find(h=>Number(h.id)===helperId);
            const otherTruck=!!helper?.assigned_vehicle_id&&Number(helper.assigned_vehicle_id)!==truckId;
            const selectedFixed=!isCarrier&&fixedHelper>0&&helperId===fixedHelper;
            input.checked=selectedFixed;
            input.disabled=isCarrier||otherTruck||fixedHelper>0;
            const option=input.closest('.driver-auth-option');
            option?.classList.toggle('is-locked',input.disabled);
            const status=option?.querySelector('.driver-auth-option-status');
            if(status){
              status.className='driver-auth-option-status '+(selectedFixed?'is-selected':input.disabled?'is-unavailable':'is-available');
              status.textContent=selectedFixed?'Regular Helper · Locked':input.disabled?'Assigned / Unavailable':'Available';
            }
          });
          helperCount.textContent=isCarrier?'No regular Helper for Car Carrier'
            :fixedHelper?'Regular Helper of selected Truck'
            :'Select an available Helper if needed';
        };
        helperInputs.forEach(input=>input.addEventListener('change',()=>{
          if(input.checked)helperInputs.forEach(other=>{if(other!==input)other.checked=false;});
          helperCount.textContent=helperInputs.some(input=>input.checked)?'1 Helper selected':'No Helper selected';
        }));
        helperSearch.addEventListener('input',refreshHelpers);
        syncHelpersForTruck();refreshHelpers();
        form.addEventListener('submit',event=>{
          if(inputs.some(input=>input.checked))return;
          event.preventDefault();event.stopImmediatePropagation();
          const error=wrap.querySelector('.form-error');
          if(error){error.textContent='Select at least one authorized truck.';error.style.display='block';}
          inputs[0]?.focus();
        },true);
      },
    });
  },
  async crewDetails(id, d) {
    let r; try { r = await App.api('Fleet.crew_details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const p = r.person;
    const acts = d.can.edit ? [`<button class="btn btn-sm btn-outline-primary" data-a="edit"><i class="bi bi-pencil"></i> Edit</button>`,
      +p.active ? (p.availability === 'Unavailable' ? `<button class="btn btn-sm btn-success" data-a="avail">Set Available</button>` : `<button class="btn btn-sm btn-outline-danger" data-a="unavail">Set Unavailable</button>`) : '',
      `<button class="btn btn-sm btn-outline-${+p.active ? 'danger' : 'success'}" data-a="active">${+p.active ? 'Deactivate' : 'Reactivate'}</button>`] : [];
    const html = `<div class="mb-2">${UI.badge(p.availability)} ${+p.active ? '' : '<span class="badge-s red">Inactive</span>'} ${p.unavailable_reason ? `<span class="small text-muted">${UI.esc(p.unavailable_reason)}</span>` : ''}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}</div>` : ''}
      ${UI.h(UI.role('operations_head')?'Overview':'Details')}${UI.kv([[UI.role('operations_head')?'Role':'Type', UI.e(p.person_type)], ['Employee no.', UI.e(p.employee_no)], ['Contact', UI.e(p.contact_number)], ['Address', UI.e(p.address)],
        ["License", UI.esc([p.license_number, p.license_expiry ? 'expires ' + UI.date(p.license_expiry) : ''].filter(Boolean).join(' · ') || '—')], ['Date hired', UI.date(p.date_hired)], ...(p.person_type==='Driver'?[['Authorized Trucks', UI.e(p.authorized_truck_names||'None selected')]]:[]), ['Notes', UI.e(p.notes)]])}
      ${UI.h('Trip history')}${(r.trips||[]).length ? UI.table([['Trip', 'trip_ref'], ['As', 'role_on_trip'], ['Status', 'status', 'badge'], ['Schedule', 'scheduled_at', 'datetime'], ['Truck', 'plate_number'], ['Client', 'client'], ['To', 'delivery_point']], r.trips, { empty: 'No trips yet.' }) : '<div class="fleet-detail-empty"><i class="bi bi-inbox" aria-hidden="true"></i><strong>No trip history yet</strong><span>Trips assigned to this person will appear here.</span></div>'}`;
    const el = UI.drawer(UI.esc(p.full_name), html, { subtitle: UI.esc(p.person_type) });
    this.decorateDetailDrawer(el);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') FleetUI.crewForm(p,d);
      if (a === 'avail') UI.confirmAction('Set ' + UI.esc(p.full_name) + ' Available', 'This person can be assigned to trips again.', 'Fleet.crew_status', { id: p.id, availability: 'Available' });
      if (a === 'unavail') UI.confirmAction('Set ' + UI.esc(p.full_name) + ' Unavailable', 'An affected trip returns to manual Dispatcher assignment.', 'Fleet.crew_status', { id: p.id, availability: 'Unavailable' },
        { danger: true, fields: [{ name: 'reason', label: 'Reason (leave, sick, ...)', required: true, col: 12 }] });
      if (a === 'active') UI.confirmAction((+p.active ? 'Deactivate ' : 'Reactivate ') + UI.esc(p.full_name), +p.active ? 'Past trips keep the name.' : 'The person returns to the masterlist.', 'Fleet.crew_active', { id: p.id, active: +p.active ? 0 : 1 }, { danger: +p.active });
    });
  },
};

App.page('trucks', {
  title: 'Trucks',
  subtitle: 'Fleet records, fixed crew assignments and availability.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    const availabilityView = q.tab === 'availability';
    const rows = FleetUI.truckRows(d, { ...q, inactive: availabilityView ? '' : q.inactive });
    const active = d.trucks.filter(v => +v.active);
    const count = status => active.filter(v => v.status === status).length;
    const statuses = ['Available', 'Assigned', 'On Trip', 'Under Maintenance', 'Unavailable'];
    const filterOption = (value, label, selected) => '<option value="' + UI.esc(value) + '"'
      + (String(selected || '') === String(value) ? ' selected' : '') + '>' + UI.esc(label) + '</option>';
    const toolbar = `<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger"
      aria-controls="truck-filter-panel" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter</button>
      <button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger"
      aria-controls="truck-sort-panel" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>
      <div class="record-workspace-popovers">
        <div id="truck-filter-panel" class="record-workspace-popover" hidden>
          <strong>Filter Trucks</strong>
          <label>Status<select name="status" class="form-select form-select-sm">
            ${filterOption('', 'All statuses', q.status)}
            ${statuses.map(status => filterOption(status, status, q.status)).join('')}
          </select></label>
          <label>Documents<select name="docs" class="form-select form-select-sm">
            ${filterOption('', 'All documents', q.docs)}
            ${filterOption('expiring', 'Expiring / expired', q.docs)}
          </select></label>
          <label class="record-workspace-check"><input type="checkbox" name="inactive" ${q.inactive ? 'checked' : ''}> Include inactive trucks</label>
          <div class="record-workspace-popover-actions">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>
            <button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button>
          </div>
        </div>
        <div id="truck-sort-panel" class="record-workspace-popover record-workspace-sort-panel" hidden>
          <strong>Sort Trucks</strong>
          <label class="record-workspace-sort-option"><input type="radio" name="truck_sort" value="default" data-record-sort checked> Default order</label>
          <label class="record-workspace-sort-option"><input type="radio" name="truck_sort" value="plate" data-record-sort> Plate number</label>
          <label class="record-workspace-sort-option"><input type="radio" name="truck_sort" value="type" data-record-sort> Truck type</label>
          <label class="record-workspace-sort-option"><input type="radio" name="truck_sort" value="status" data-record-sort> Status</label>
        </div>
      </div>`
      + (d.can.edit ? '<button type="button" class="btn btn-sm btn-primary record-workspace-add"><i class="bi bi-plus-lg" aria-hidden="true"></i> Add Truck</button>' : '');
    const typeTabs = [['', 'All Trucks'], ...(App.me.truckTypes || []).map(t => [t, t])];
    const columns = [
      ['Plate No.', 'plate_number', (v, r) => `<b>${UI.esc(v)}</b>${+r.active ? '' : ' <span class="badge-s red">Inactive</span>'}<div class="cell-sub">${r.truck_number ? 'Unit #' + UI.esc(r.truck_number) : 'No unit no.'}</div>`],
      ['Truck Type', 'truck_type'],
      ['Status', 'status', (v, r) => UI.badge(v) + (r.status_reason && v === 'Unavailable' ? `<div class="cell-sub">${UI.esc(r.status_reason)}</div>` : '')],
      ['Current Assignment', 'trip_ref', (v, r) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(r.trip_status)}</div>` : (r.open_job ? `${UI.esc(r.open_job)}<div class="cell-sub">${UI.esc(r.open_job_status === 'Completed' ? 'waiting for verification' : r.open_job_status)}${r.expected_back ? ' · back ' + UI.date(r.expected_back) : ''}</div>` : '<span class="text-muted">—</span>')],
      ['Fixed Driver', 'driver_name'],
      ['Regular Helper', 'helper_name'],
    ];
    const tableHtml = UI.table(columns, rows, {
      tools: toolbar,
      actions: () => UI.btn('view', 'View'),
      onAction: (action, vehicle) => FleetUI.truckDetails(vehicle.id, d),
      rowClick: vehicle => FleetUI.truckDetails(vehicle.id, d),
      empty: active.length === 0 ? 'No trucks registered yet. Add your first truck to start managing fleet records.' : 'No trucks match these filters. Try clearing your search or filters.',
    });
    ctx.el.innerHTML = `<div class="fleet-trucks-page">
      <div class="small text-muted mb-2">Active trucks: <b>${UI.num(active.length)}</b>
        · <a href="#trucks?status=Available">Available: ${UI.num(count('Available'))}</a>
        · Assigned / On Trip: ${UI.num(count('Assigned') + count('On Trip'))}
        · <a href="#trucks?status=Under%20Maintenance">Under Maintenance: ${UI.num(count('Under Maintenance'))}</a></div>
      ${RecordComponents.tabs([{value:'master',label:'Master List'},{value:'availability',label:'Availability'}], availabilityView ? 'availability' : 'master','data-truck-view')}
      ${RecordComponents.panel(tableHtml, RecordComponents.categories(typeTabs.map(([value,label]) => ({value,label})),q.truck_type||'','data-truck-type'))}
    </div>`;
    const panel = ctx.el.querySelector('.record-workspace-panel .panel');
    UI.activate(ctx.el);
    RecordComponents.mountPanel(ctx.el, {
      title: 'Truck Records',
      categorySelector: '.record-workspace-categories',
      addSelector: '.record-workspace-add',
    });
    ctx.el.querySelectorAll('[data-truck-view]').forEach(button => button.addEventListener('click', () => {
      const next = { ...ctx.query };
      if (button.dataset.truckView === 'availability') next.tab = 'availability';
      else delete next.tab;
      delete next.inactive;
      App.go(ctx.page, next);
    }));
    ctx.el.querySelectorAll('[data-truck-type]').forEach(button => button.addEventListener('click', () => {
      const next = { ...ctx.query }, value = button.dataset.truckType;
      if (value) next.truck_type = value; else delete next.truck_type;
      App.go(ctx.page, next);
    }));
    ctx.el.querySelector('.record-workspace-add')?.addEventListener('click', () => FleetUI.truckForm({}, d));
    const tableBox = panel?.querySelector('[data-tbody]');
    const tableState = tableBox ? UI._tables[tableBox.dataset.tbody] : null;
    const originalOrder = tableState ? tableState.rows.slice() : [];
    RecordComponents.bindDropdowns(ctx.el, {
      apply(filterPanel) {
        const next = { ...ctx.query };
        const status = filterPanel.querySelector('[name="status"]').value;
        const docs = filterPanel.querySelector('[name="docs"]').value;
        const inactive = filterPanel.querySelector('[name="inactive"]').checked;
        if (status) next.status = status; else delete next.status;
        if (docs) next.docs = docs; else delete next.docs;
        if (inactive) next.inactive = '1'; else delete next.inactive;
        App.go(ctx.page, next);
      },
      reset() {
        const next = { ...ctx.query };
        delete next.status; delete next.docs; delete next.inactive;
        App.go(ctx.page, next);
      },
      sort(key) {
        if (!tableState || !tableBox) return;
        if (key === 'default') tableState.rows = originalOrder.slice();
        else {
          const field = {plate:'plate_number', type:'truck_type', status:'status'}[key];
          if (!field) return;
          tableState.rows = originalOrder.slice().sort((a,b) =>
            String(a[field] || '').localeCompare(String(b[field] || ''), undefined, {numeric:true}));
        }
        tableState.page = 0;
        UI.drawTable(tableBox.dataset.tbody);
      },
    });
    if (q.open) FleetUI.truckDetails(q.open, d);
  },
});

App.page('crew', {
  title: 'Driver & Helper Masterlist',
  subtitle: 'Drivers and helpers: availability, current trip and license expiry.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    if (d.can.edit) UI.tool(ctx, 'Add driver or helper', () => FleetUI.crewForm({}), 'bi-plus-lg', 'primary');
    if (App.me.user.role === 'admin') UI.tool(ctx, 'Attendance', () => AttendanceUI.open('Driver'), 'bi-clipboard-check', 'outline-primary');
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
    ]) + `<div class="d-flex flex-wrap align-items-center gap-2 mb-3">${FleetUI.masterlistTypeTabs('crew', 'person_type', [['', 'All personnel'], ['Driver', 'Drivers'], ['Helper', 'Helpers']], q.person_type)}` + UI.filterModal(ctx, [
      { name: 'availability', label: 'Availability', type: 'select', options: UI.list(['Available', 'On Trip', 'Unavailable']), col: 6 },
      { name: 'license', label: 'License', type: 'select', options: [['expiring', 'Expiring / expired']], col: 6 },
      { name: 'inactive', label: 'Include inactive drivers and helpers', type: 'checkbox', col: 12 }], { hint: 'Showing all active drivers and helpers.' }) + `</div>` + UI.table([
      ['Name', 'full_name', (v, r) => `<b>${UI.esc(v)}</b>${+r.active ? '' : ' <span class="badge-s red">Inactive</span>'}<div class="cell-sub">${UI.esc(r.employee_no ? 'ID ' + r.employee_no : r.person_type)}</div>`], ['Type', 'person_type'],
      ['Availability', 'availability', (v, r) => UI.badge(v) + (r.unavailable_reason ? `<div class="small text-muted">${UI.esc(r.unavailable_reason)}</div>` : '')],
      ['Current trip', 'trip_ref', (v, r) => v ? `${UI.esc(v)} <span class="small text-muted">${UI.esc(r.trip_plate || '')} · ${UI.esc(r.trip_status)}</span>` : '—'],
      ['License expiry', 'license_expiry', (v, r) => FleetUI.docBadge(r.license_days, v)], ['Completed trips', 'completed_trips', 'num']], rows,
      { actions: () => UI.btn('view', 'Open'), onAction: (a, p) => FleetUI.crewDetails(p.id, d), rowClick: (p) => FleetUI.crewDetails(p.id, d), empty: 'No driver or helper matches the filter.' });
    UI.activate(ctx.el);
    FleetUI.bindMasterlistTypeTabs(ctx);
  },
});
