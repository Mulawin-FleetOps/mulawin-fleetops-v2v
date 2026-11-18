/* Dispatcher presentation only. Session roles and existing server actions remain authoritative. */
'use strict';
const DispatcherUI = {
  is: () => UI.isDispatcher(),
  types: () => TripUI.truckTypeOptions(),
  categories: [
    ['preparation','Pre-Dispatch Preparation',['Pre-Assigned'],'bi-truck','green'],
    ['ready','Ready for Dispatch',['Ready for Dispatch'],'bi-calendar-check','green'],
    ['progress','Trips in Progress',['Dispatched','In Transit'],'bi-truck-flatbed','cyan'],
    ['hold','Trips on Hold',['On Hold - Incident Reported'],'bi-exclamation-triangle-fill','orange'],
    ['reschedule','Pending Rescheduling',['For Reschedule'],'bi-calendar-event-fill','purple'],
    ['arrival','Pending Arrival Inspection',[],'bi-flag-fill','blue'],
  ],
  labels: {'Pre-Assigned':'Pre-Dispatch Preparation','Dispatched':'Trips in Progress','In Transit':'Trips in Progress','On Hold - Incident Reported':'Trips on Hold','For Reschedule':'Pending Rescheduling'},
  datetime: v => OpsHead.datetime(v),
  href: (page,q={}) => OpsHead.link(page,q),
  status(value) { const color=value==='Under Repair'?'red':value==='For Reschedule'?'amber':UI.badgeColor(value);return value?`<span class="badge-s ${color}">${UI.esc(this.labels[value]||value)}</span>`:UI.badge(value); },
  fundStatus(value) { const color=value==='Ready for Release'?'green':UI.badgeColor(value);return value?`<span class="badge-s ${color}">${UI.esc(value==='Ready for Release'?'Approved — Awaiting Release':value==='Rejected'?'Requires Revision':value)}</span>`:UI.badge(value); },
  matches(t,key) { return !key || key==='awaiting' ? !key || t.status==='Awaiting Resources' : key==='arrival' ? t.status==='Completed'&&!!+t.awaiting_arrival : (this.categories.find(c=>c[0]===key)?.[2]||[]).includes(t.status); },
  panel(title,body,action='') { return `<section class="ds-panel"><div class="ds-panel-head"><h2>${title}</h2>${action}</div><div class="ds-panel-body">${body}</div></section>`; },
  cards(data) {
    const count=fn=>Array.isArray(data.active)?data.active.filter(fn).length:null;
    const cards=[
      ['Trips Awaiting Resource Assignment',count(t=>t.status==='Awaiting Resources'),'trips',{group:'awaiting'},'bi-truck','resources'],
      ['Trips Requiring Dispatch Preparation',count(t=>['Pre-Assigned','Ready for Dispatch'].includes(t.status)),'trips',{group:'preparation'},'bi-calendar-check','active'],
      ['Incidents',data.incidentCount?.count,'trips',{tab:'incidents',incident:'open'},'bi-exclamation-triangle','incidents'],
      ['Trip Fund Follow-ups',count(t=>['Pre-Assigned','Ready for Dispatch'].includes(t.status)&&(['Pending Approval','Ready for Release','Rejected'].includes(t.fund_status)||(!t.fund_status&&+t.attempt_number===1))),'trips',{group:'preparation'},'bi-cash-coin','attendance'],
    ];
    return `<div class="ds-summary" aria-label="Operational Summary Cards">${cards.map(([label,count,page,query,icon,color])=>`<a class="ds-summary-card" href="${this.href(page,query)}"><span class="ds-card-icon ${color}"><i class="bi ${icon}" aria-hidden="true"></i></span><span class="ds-card-copy"><strong>${count==null?'Unavailable':UI.num(count)}</strong><span>${label}</span></span></a>`).join('')}</div>`;
  },
  recordKpis(items) {
    // Counts are derived only from the already-authorized records for this page.
    return '<section class="ds-summary-section dispatcher-record-kpis" aria-label="Record summary">'
      +'<div class="dispatcher-record-kpi-grid">'+items.map(([label,value,icon,color])=>
        '<div class="ds-summary-card"><span class="ds-card-icon '+color+'"><i class="bi '+icon+'" aria-hidden="true"></i></span>'
        +'<span class="ds-card-copy"><span>'+UI.esc(label)+'</span><strong>'+UI.num(value)+'</strong></span></div>'
      ).join('')+'</div></section>';
  },
  section(title,body) { return `<fieldset class="ds-form-section"><legend>${UI.esc(title)}</legend>${body}</fieldset>`; },
  options(rows,key,label=key) { return [...new Map((rows||[]).filter(r=>r[key]!=null&&r[key]!=='').map(r=>[String(r[key]),[r[key],r[label]||r[key]]])).values()]; },
  contains(row,keys,text) { return keys.map(k=>row[k]??'').join(' ').toLowerCase().includes((text||'').trim().toLowerCase()); },
  // Search and committed filters live in the URL. Opening details never changes this context.
  filters(ctx,fields,{searchKey='search',placeholder='Search records…',values=ctx.query,searchButton=true}={}) {
    const id='ds-filters-'+UI.uuid(),count=fields.filter(f=>String(values[f.name]??f.default??'')!==String(f.default??'')).length;
    return `<div class="ds-filterbar" data-ds-filters><form class="ds-search-bar" role="search"><label class="visually-hidden" for="${id}-search">Search records</label><div class="ds-search-input"><i class="bi bi-search" aria-hidden="true"></i><input id="${id}-search" class="form-control" name="q" type="search" maxlength="200" placeholder="${UI.esc(placeholder)}" value="${UI.esc(values[searchKey]||'')}"></div>${searchButton?'<button class="btn btn-primary" type="submit"><i class="bi bi-search" aria-hidden="true"></i> Search</button>':''}</form><button type="button" class="btn btn-outline-success ds-filter-toggle" aria-expanded="false" aria-controls="${id}"><i class="bi bi-funnel" aria-hidden="true"></i> Filters${count?` <span class="ds-filter-count" aria-label="${count} active filters">${count}</span>`:''}</button><div class="ds-filter-panel" id="${id}" role="dialog" tabindex="-1" aria-label="Filter Records" hidden><div class="ds-filter-heading"><h2>Filter Records</h2><button type="button" class="btn-close" data-filter-close aria-label="Close filters"></button></div><form data-filter-form>${UI.fields(fields.map(f=>({...f,col:12,value:values[f.name]??f.default??''})))}<div class="ds-filter-actions"><button class="btn btn-outline-secondary" type="button" data-filter-clear>Clear Filters</button><button class="btn btn-primary" type="submit">Apply Filters</button></div></form></div></div>`;
  },
  bindFilters(ctx,fields,{base={},searchKey='search',values=ctx.query}={}) {
    const bar=ctx.el.querySelector('[data-ds-filters]');if(!bar)return;
    const toggle=bar.querySelector('.ds-filter-toggle'),panel=bar.querySelector('.ds-filter-panel'),form=panel.querySelector('form'),search=bar.querySelector('input[type=search]');
    const close=(restore=false)=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');if(restore)toggle.focus();};
    const navigate=(filters,text=search.value.trim())=>{close(true);App.go(ctx.page,{...base,...Object.fromEntries(Object.entries({...filters,[searchKey]:text}).filter(([,v])=>v!==''&&v!=null))});};
    const committed=()=>Object.fromEntries(fields.map(f=>[f.name,values[f.name]??f.default??'']));
    toggle.onclick=()=>{if(!panel.hidden){close(true);return;}const state=committed();fields.forEach(f=>form.elements[f.name].value=state[f.name]);form.querySelectorAll('input').forEach(el=>el.setCustomValidity(''));panel.hidden=false;toggle.setAttribute('aria-expanded','true');panel.focus({preventScroll:true});};
    panel.querySelector('[data-filter-close]').onclick=()=>close(true);
    panel.querySelector('[data-filter-clear]').onclick=()=>navigate(Object.fromEntries(fields.map(f=>[f.name,f.default??''])));
    form.addEventListener('input',()=>form.querySelectorAll('input').forEach(input=>input.setCustomValidity('')));
    form.onsubmit=e=>{e.preventDefault();const d=UI.formData(form);for(const [from,to] of [['from','to'],['request_from','request_to']]){const end=form.elements[to];if(end){end.setCustomValidity(d[from]&&d[to]&&d[from]>d[to]?'End date must be on or after the start date.':'');if(!end.reportValidity())return;}}navigate(d);};
    bar.querySelector('form[role=search]').onsubmit=e=>{e.preventDefault();navigate(committed());};
    bar.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopPropagation();close(true);}});
    bar.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(bar.isConnected&&!bar.contains(document.activeElement))close();}));
    this.activeFilterClose?.();this.activeFilterClose=()=>close();
  },
  activateRecords(root,{serverPaged=false}={}) {
    // Configure only these Dispatcher table instances before the shared renderer draws.
    root.querySelectorAll('[data-tbody]').forEach(box=>{const table=UI._tables[box.dataset.tbody];if(table){table.opts.dsRecords=true;table.opts.dsServerPaged=serverPaged;table.limit=10;}});
    root.querySelectorAll('.rpm-record-size-label').forEach(el=>el.remove());
    UI.activate(root);
    // Keep shared List/Grid controls; search is centralized above the records.
    root.querySelectorAll('.table-search').forEach(el=>el.remove());
    root.querySelectorAll('.panel').forEach(el=>el.classList.add('ds-records'));
    root.querySelectorAll('[data-tbody]').forEach(box=>{const table=UI._tables[box.dataset.tbody];if(table){table.opts.dsRecords=true;table.opts.dsServerPaged=serverPaged;this.decorateRecordsTable(box.dataset.tbody);}});
  },
  emptyTable(columns,message,hasActions=false) {
    return `<table class="data-table ds-empty-table"><thead><tr>${columns.map(([label,,format])=>`<th>${UI.esc(UI.columnLabel(label,format))}</th>`).join('')}${hasActions?'<th>Action</th>':''}</tr></thead><tbody><tr><td colspan="${columns.length+(hasActions?1:0)}"><div class="ds-empty-state" role="status"><i class="bi bi-search" aria-hidden="true"></i><b>${UI.esc(message)}</b><span>Try another search or clear filters to see more records.</span></div></td></tr></tbody></table>`;
  },
  decorateRecordsTable(id) {
    const t=UI._tables[id],box=document.querySelector(`[data-tbody="${id}"]`);if(!t?.opts.dsRecords||!box)return;
    const actionHeading=box.querySelector('th.actions-col .visually-hidden');if(actionHeading){actionHeading.classList.remove('visually-hidden');actionHeading.textContent='Action';}
    const rows=UI.tableRows(id),pager=box.parentElement.querySelector(`[data-tpager="${id}"]`);
    if(!rows.length)box.innerHTML=this.emptyTable(t.columns,t.opts.empty||'No matching records.',t.hasActions);
    if(!t.opts.dsServerPaged&&pager){
      t.page=Math.min(Math.max(t.page,0),Math.max(0,Math.ceil(rows.length/t.limit)-1));
      const pages=Math.max(1,Math.ceil(rows.length/t.limit)),first=rows.length?t.page*t.limit+1:0,last=Math.min((t.page+1)*t.limit,rows.length);
      pager.innerHTML=`<span class="pager-info">Showing ${first}${rows.length?'–'+last:''} of ${rows.length} records</span><nav class="pager-pages" aria-label="Record pages"><button type="button" class="pg" data-record-prev aria-label="Previous page" ${t.page===0?'disabled':''}>Previous</button><span>Page ${t.page+1} of ${pages}</span><button type="button" class="pg" data-record-next aria-label="Next page" ${t.page>=pages-1?'disabled':''}>Next</button></nav>`;
      pager.querySelector('[data-record-prev]').onclick=()=>{t.page--;UI.drawTable(id);};pager.querySelector('[data-record-next]').onclick=()=>{t.page++;UI.drawTable(id);};
      return;
    }
  },
  groupModal(modal,groups) {
    const body=modal.querySelector('.modal-body');modal.classList.add('ds-structured-modal');
    groups.forEach(([title,names,html=''])=>{
      const section=document.createElement('fieldset');section.className='ds-form-section';section.innerHTML=`<legend>${UI.esc(title)}</legend>${html}<div class="row g-2"></div>`;
      names.forEach(name=>{const input=body.querySelector(`[name="${name}"]`),col=input?.closest('[class*=col-]');if(col){if(['details','photos','attachments','diesel_po'].includes(name))col.className='col-md-12';section.querySelector('.row').append(col);}});
      body.insertBefore(section,body.querySelector('.form-error'));
    });
    body.querySelectorAll(':scope > .row').forEach(row=>{if(!row.children.length)row.remove();});
  },
  bindTrips(el) { el.querySelectorAll('[data-ds-trip]').forEach(b=>b.onclick=()=>b.dataset.dsAction==='assign'?this.assignResources(b.dataset.dsTrip):TripUI.open(b.dataset.dsTrip)); },
  tripAction(t) {
    if(t.status==='Awaiting Resources'||(t.status==='For Reschedule'&&(!t.vehicle_id||t.truck_status!=='Assigned')))return ['Assign','assign'];
    if(['Pre-Assigned','Ready for Dispatch'].includes(t.status))return ['Manage','manage'];
    if(t.status==='On Hold - Incident Reported'&&t.incident_status==='Repaired - Cleared to Continue')return ['Manage','manage'];
    if(t.status==='For Reschedule'&&(!t.vehicle_id||t.truck_status==='Assigned'))return ['Manage','manage'];
    return ['View','view'];
  },
  async assignResources(id) {
    let d;
    try { d=await App.api('Trips.dispatcher_resources',{trip_id:id}); }
    catch(error){return UI.toast(error.message,'error');}
    const trip=d.trip||{},cc=trip.truck_type==='Car Carrier';
    const pairs=d.drivers||[],helpers=d.helpers||[];
    // These pairs have already passed the server's attendance, authorization,
    // truck availability and resource-hold checks for this trip.
    // Show eligible Drivers even if a complete crew is not yet available.
    // Saving still requires a valid authorized Truck and full crew.
    const eligiblePairs=pairs;
    const uniqueDrivers=[...new Map(eligiblePairs.map(p=>[String(p.id),p])).values()]
      .sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    const available=uniqueDrivers.length>0;
    const planned=[...(TripUI.data?.active||[]),...(TripUI.data?.history||[])]
      .find(row=>String(row.id)===String(trip.id))||{};
    const summary='<section class="ds-assignment-plan" aria-label="Operations Head trip plan">'
      +'<div class="ds-assignment-plan-title"><i class="bi bi-clipboard-check" aria-hidden="true"></i><strong>Trip Information</strong>'
      +'<span class="ds-assignment-type">'+UI.esc(trip.truck_type||planned.truck_type||'Truck type unavailable')+'</span></div>'
      +'<dl><div><dt>Trip / Client</dt><dd><strong>'+UI.esc(trip.trip_ref||planned.trip_ref||'Trip')+'</strong>'
      +'<span>'+UI.esc(planned.client||'Client not available')+'</span></dd></div>'
      +'<div><dt>Scheduled Dispatch</dt><dd>'+UI.esc(this.datetime(planned.scheduled_at))+'</dd></div></dl>'
      +'<details class="ds-assignment-route"><summary>View planned route <i class="bi bi-chevron-down" aria-hidden="true"></i></summary>'
      +'<p>'+UI.esc(planned.pickup_point||'Pickup not specified')+' → '+UI.esc(planned.delivery_point||'Destination not specified')+'</p></details></section>';
    const notice=available
      ?'<p class="ds-assignment-hint"><i class="bi bi-info-circle" aria-hidden="true"></i> '
        +(cc?'Select an eligible Driver. The system first checks for a second authorized Driver; if none is eligible, a timed-in Helper can be assigned.'
          :'Select an eligible Driver. The linked Truck and regular Helper fill automatically.')
        +'</p>'
      :'<div class="alert alert-warning" role="status"><strong>No eligible assignment is available.</strong>'
        +'<p class="mb-0 mt-1">'+(cc
          ?'An eligible timed-in Driver and either a second authorized Driver or eligible Helper are required.'
          :'An eligible timed-in Driver, Truck and Helper are required.')
        +' Check attendance, truck authorization, maintenance and active-trip conflicts.</p></div>';
    const fields=UI.fields([
      {name:'driver_id',label:'Primary Driver',type:'select',required:true,col:12,
        placeholder:'Select an available Driver',
        options:uniqueDrivers.map(p=>[p.id,p.name+(p.shift_warning?' — '+p.shift_warning:'')])},
      {name:'vehicle_id',label:'Compatible Truck',type:'select',required:true,col:12,options:[]},
      ...(cc?[{name:'driver2_id',label:'Second Authorized Driver',type:'select',col:12,options:[]}]:[]),
      {name:'helper_id',label:'Trip Helper',type:'select',required:!cc,col:12,
        options:helpers.map(p=>[p.id,p.name+(p.shift_warning?' — '+p.shift_warning:'')])},
      {name:'helper_substitution_reason',label:'Helper replacement reason',col:12,attrs:'maxlength="255"'}
    ]);
    const selection='<section class="ds-assignment-selection" aria-label="Resource Assignment">'
      +'<h3><i class="bi bi-people" aria-hidden="true"></i> Resource Assignment</h3>'
      +'<div class="ds-assignment-fields">'+fields+'</div>'
      +'<button type="button" class="btn btn-sm btn-outline-secondary ds-assignment-change-helper" data-change-helper hidden>'
        +'<i class="bi bi-arrow-left-right" aria-hidden="true"></i> Change Helper</button>'
      +'<div class="ds-assignment-preview" data-assignment-preview aria-live="polite">'
      +'<i class="bi bi-truck" aria-hidden="true"></i><span>Select a Driver to view their compatible Truck and crew.</span></div>'
      +'</section>';
    const submit=async values=>{
      const pair=eligiblePairs.find(p=>String(p.id)===String(values.driver_id)
        &&String(p.vehicle_id)===String(values.vehicle_id));
      if(!pair)throw new Error('Choose an eligible Driver and their authorized Truck.');
      if(cc&&values.driver2_id){
        if(values.helper_id||!pairs.some(p=>String(p.id)===String(values.driver2_id)
          &&String(p.vehicle_id)===String(pair.vehicle_id)&&String(p.id)!==String(pair.id)))
          throw new Error('Choose a different eligible Driver authorized for the same Car Carrier.');
      }else if(!helpers.some(p=>String(p.id)===String(values.helper_id))){
        throw new Error('Choose an eligible, timed-in Helper for the trip.');
      }
      const result=await App.api('Trips.assign_resources',{
        ...values,trip_id:trip.id,vehicle_id:pair.vehicle_id,driver_id:pair.id
      });
      UI.result(result);UI.closeDrawer();App.route();
    };
    return UI.modal('Assign Resources — '+UI.esc(trip.trip_ref||'Trip'),
      summary+notice+selection,submit,
      {submit:'Confirm Assignment',confirmBeforeSubmit:true,onShow:(wrap,form)=>{
        wrap.classList.add('ds-resource-assignment-modal');
        const driver=form.querySelector('[name=driver_id]');
        const truck=form.querySelector('[name=vehicle_id]');
        const secondary=form.querySelector('[name=helper_id]');
        const secondDriver=cc?form.querySelector('[name=driver2_id]'):null;
        const secondDriverRow=secondDriver?.closest('[class*=col-]');
        const reason=form.querySelector('[name=helper_substitution_reason]');
        const reasonRow=reason?.closest('[class*=col-]');
        const truckRow=truck.closest('[class*=col-]');
        const helperRow=secondary.closest('[class*=col-]');
        const changeHelper=wrap.querySelector('[data-change-helper]');
        const preview=wrap.querySelector('[data-assignment-preview]');
        const submitButton=form.querySelector('[type=submit]');
        if(!available){
          // With no candidates, show only the Driver control and a clear
          // explanation; do not show empty Truck / crew pickers.
          truckRow.hidden=true;
          helperRow.hidden=true;
          if(secondDriverRow)secondDriverRow.hidden=true;
          if(reasonRow)reasonRow.hidden=true;
          driver.disabled=true;
          truck.disabled=true;
          secondary.disabled=true;
          if(secondDriver)secondDriver.disabled=true;
          if(reason)reason.disabled=true;
          if(submitButton)submitButton.disabled=true;
          const preview=wrap.querySelector('[data-assignment-preview]');
          if(preview)preview.innerHTML='<i class="bi bi-info-circle" aria-hidden="true"></i><span>No eligible Drivers can be selected yet. Record Time In on Attendance, then verify Truck authorization and any active-trip or maintenance holds before retrying.</span>';
          return;
        }
        let changingHelper=false,usingSecondDriver=false;
        const current=()=>eligiblePairs.find(p=>String(p.id)===driver.value
          &&String(p.vehicle_id)===truck.value);
        const options=(select,entries,placeholder)=>{
          select.replaceChildren(new Option(placeholder,''));
          entries.forEach(entry=>select.add(new Option(entry.label,String(entry.id))));
          select.value='';
        };
        const showPreview=()=>{
          const pair=current(),chosen=usingSecondDriver
            ?pairs.find(p=>String(p.id)===secondDriver?.value&&String(p.vehicle_id)===String(pair?.vehicle_id))
            :helpers.find(p=>String(p.id)===secondary.value);
          if(!pair){
            preview.classList.remove('is-ready');
            preview.innerHTML='<i class="bi bi-truck" aria-hidden="true"></i><span>Select a Driver to view their compatible Truck and crew.</span>';
          }else{
            const primary=uniqueDrivers.find(p=>String(p.id)===driver.value);
            preview.classList.toggle('is-ready',!!chosen);
            preview.innerHTML='<strong><i class="bi bi-check-circle" aria-hidden="true"></i> Assignment Summary</strong>'
              +'<dl><div><dt>Primary Driver</dt><dd>'+UI.esc(primary?.name||'—')+'</dd></div>'
              +'<div><dt>Truck</dt><dd>'+UI.esc(pair.plate_number||'—')+'</dd></div>'
              +'<div><dt>'+(usingSecondDriver?'Second Driver':'Helper')+'</dt><dd>'
              +UI.esc(chosen?.name||(usingSecondDriver?'No second authorized Driver available':'Select an eligible timed-in Helper'))+'</dd></div></dl>';
          }
          if(submitButton)submitButton.disabled=!pair||!chosen||(!!reason?.required&&!reason.value.trim());
        };
        const syncHelper=()=>{
          if(usingSecondDriver){showPreview();return;}
          const pair=current();
          const preferred=helpers.find(p=>String(p.id)===String(pair?.regular_helper_id));
          if(!pair){secondary.value='';changingHelper=false;}
          else if(preferred&&!changingHelper){secondary.value=String(preferred.id);}
          else if(!preferred&&pair&&!changingHelper){secondary.value='';changingHelper=true;}
          const replacing=!!pair&&!!secondary.value
            &&String(secondary.value)!==String(pair.regular_helper_id||'');
          if(reasonRow)reasonRow.hidden=!replacing;
          if(reason){reason.disabled=!replacing;reason.required=replacing;if(!replacing)reason.value='';}
          if(helperRow)helperRow.hidden=!!preferred&&!changingHelper;
          if(changeHelper){
            changeHelper.hidden=!pair||!preferred||usingSecondDriver;
            changeHelper.textContent=changingHelper?'Use Regular Helper':'Change Helper';
          }
          showPreview();
        };
        driver.onchange=()=>{
          const selected=eligiblePairs.filter(p=>String(p.id)===driver.value);
          const byVehicle=[...new Map(selected.map(p=>[String(p.vehicle_id),p])).values()];
          options(truck,byVehicle.map(p=>({id:p.vehicle_id,label:p.plate_number})),
            'Select an authorized Truck');
          truckRow.hidden=byVehicle.length<=1;
          if(byVehicle.length===1)truck.value=String(byVehicle[0].vehicle_id);
          changingHelper=false;
          truck.onchange();
        };
        truck.onchange=()=>{
          const pair=current();
          changingHelper=false;
          if(cc){
            const second=[...new Map(pairs.filter(p=>pair
              &&String(p.vehicle_id)===String(pair.vehicle_id)
              &&String(p.id)!==String(pair.id)).map(p=>[String(p.id),p])).values()];
            usingSecondDriver=second.length>0;
            options(secondDriver,second.map(p=>({id:p.id,label:p.name
              +(p.shift_warning?' — '+p.shift_warning:'')})),'Select an eligible Second Driver');
            const fixed=second.find(p=>String(p.id)===String(pair?.regular_driver_id));
            const automatic=fixed||(second.length===1?second[0]:null);
            if(usingSecondDriver){
              secondary.value='';
              if(automatic)secondDriver.value=String(automatic.id);
              secondDriverRow.hidden=!!automatic;
              helperRow.hidden=true;
              if(reasonRow)reasonRow.hidden=true;
              if(reason){reason.value='';reason.required=false;reason.disabled=true;}
              if(changeHelper)changeHelper.hidden=true;
              showPreview();
              return;
            }
            secondDriver.value='';
            secondDriverRow.hidden=true;
          }
          const preferred=helpers.find(p=>String(p.id)===String(pair?.regular_helper_id));
          if(pair&&preferred)secondary.value=String(preferred.id);
          else secondary.value='';
          syncHelper();
        };
        secondary.onchange=()=>syncHelper();
        if(secondDriver)secondDriver.onchange=showPreview;
        if(reason)reason.addEventListener('input',showPreview);
        if(changeHelper)changeHelper.onclick=()=>{
          changingHelper=!changingHelper;
          const pair=current(),preferred=helpers.find(p=>String(p.id)===String(pair?.regular_helper_id));
          if(!changingHelper&&preferred)secondary.value=String(preferred.id);
          syncHelper();
          if(changingHelper)secondary.focus();
        };
        driver.value='';
        driver.dispatchEvent(new Event('change'));
      }});
  },
  async ensureTrips() {
    const identity=App.me.user.id+':'+App.me.user.role;
    if (this.tripIdentity!==identity || !TripUI.data?.checklist || !TripUI.data?.active) { TripUI.data=await App.data('trips'); this.tripIdentity=identity; }
    return TripUI.data;
  },
  dashboard(ctx) {
    this.tripIdentity='';
    ctx.setTitle('Dashboard', DispatcherUI.types().join(', ') + ' dispatch preparation and operational priorities.');
    UI.tool(ctx,'Refresh',()=>ctx.reload(),'bi-arrow-clockwise','outline-secondary');
    const rows=ctx.data.active;
    const actionable=Array.isArray(rows)?rows.filter(t=>t.status!=='Pending Review'):null;
    const count=fn=>Array.isArray(rows)?rows.filter(fn).length:null;
    const queues=[
      ['Incidents Requiring Coordination',ctx.data.incidentCount?.count,this.href('trips',{tab:'incidents',incident:'open'})],
      ['Resource Assignments Pending',count(t=>t.status==='Awaiting Resources'),this.href('trips',{group:'awaiting'})],
      ['Pre-Dispatch Checklists Required',count(t=>t.status==='Pre-Assigned'),this.href('trips',{group:'preparation'})],
      ['Trip Fund Requests Requiring Follow-Up',count(t=>['Pre-Assigned','Ready for Dispatch'].includes(t.status)&&(['Pending Approval','Ready for Release','Rejected'].includes(t.fund_status)||(!t.fund_status&&+t.attempt_number===1))),this.href('trips',{group:'preparation'})],
      ['Trips Requiring Rescheduling',count(t=>t.status==='For Reschedule'),this.href('trips',{group:'reschedule'})],
      ['Pending Arrival Inspections',count(t=>t.status==='Completed'&&+t.awaiting_arrival),this.href('trips',{group:'arrival'})],
      ['Current-Shift Attendance Pending',ctx.data.attendanceWork?.not_timed_in,this.href('crew',{view:'attendance'})],
    ];
    ctx.el.innerHTML=`<section class="ds-summary-section" aria-label="Operational Summary">${this.cards(ctx.data)}</section>`+
      this.panel('Scheduled & Active Trips',actionable?'<div class="ds-dashboard-trips">'+this.tripTable(actionable.slice(0,6))+'</div>':'<p role="alert">Trip records unavailable. Refresh to try again.</p>','<a href="#trips">View All Trips</a>')+
      this.panel('Needs Action',`<div class="ds-action-queue">${queues.filter(([,n])=>n==null||+n>0).map(([label,n,href])=>`<a href="${href}"${label==='Incidents Requiring Coordination'?' class="ds-urgent"':''}><span>${label}</span><b>${n==null?'Unavailable':UI.num(n)}</b><i class="bi bi-chevron-right" aria-hidden="true"></i></a>`).join('')||'<p class="text-muted mb-0">No pending operational actions.</p>'}</div>`);
    this.bindTrips(ctx.el);
  },
  tripTable(rows,history=false) {
    // Shared five-column Trips presentation. Dispatcher actions remain authoritative.
    const schedule=(value,sub='')=>{
      const label=this.datetime(value);
      const comma=label.lastIndexOf(', ');
      const date=comma>=0?label.slice(0,comma):label;
      const time=comma>=0?label.slice(comma+2):'';
      return '<div class="fleet-trip-dispatch"><strong>'+UI.esc(date)+'</strong>'
        +(time?'<span><i class="bi bi-clock" aria-hidden="true"></i> '+UI.esc(time)+'</span>':'')
        +(sub?'<span>'+UI.esc(sub)+'</span>':'')+'</div>';
    };
    const lines=rows.map(t=>{
      const [action,kind]=history?['View','view']:this.tripAction(t);
      const route=UI.esc(t.pickup_point||'Pickup not specified')
        +' <span class="fleet-trip-route-arrow" aria-hidden="true">→</span> '
        +UI.esc(t.delivery_point||'Destination not specified');
      return '<tr>'
        +'<td><div class="fleet-trip-identity"><strong class="fleet-trip-ref">'+UI.esc(t.trip_ref)+'</strong><span class="fleet-trip-client">'+UI.esc(t.client||'Client not specified')+'</span></div></td>'
        +'<td><div class="fleet-trip-route"><span class="fleet-trip-route-path">'+route+'</span>'
        +'<span class="fleet-trip-truck"><i class="bi bi-truck" aria-hidden="true"></i> '+UI.esc(t.truck_type||'Truck type pending')+' · '+UI.esc(t.plate_number||'Awaiting assignment')+'</span></div></td>'
        +'<td>'+schedule(history&&t.completed_at?t.completed_at:t.scheduled_at,history&&t.completed_at?'Completed':'')+'</td>'
        +'<td><div class="fleet-trip-status">'+this.status(t.status)
        +(+t.awaiting_arrival?'<span class="cell-sub">Pending Arrival Inspection</span>':'')+'</div></td>'
        +'<td><button type="button" class="btn btn-sm btn-outline-success" data-ds-trip="'+(+t.id)+'" data-ds-action="'+UI.esc(kind)+'">'
        +(kind==='view'?'<i class="bi bi-eye" aria-hidden="true"></i> ':'')+UI.esc(action)+'</button></td></tr>';
    }).join('');
    return '<div class="oh-dispatch-table-wrap"><table class="data-table"><thead><tr>'
      +'<th>Trip / Client</th><th>Route / Truck</th><th>'+(history?'Completion / Schedule':'Scheduled Dispatch')+'</th>'
      +'<th>Status</th><th>Action</th></tr></thead><tbody>'
      +(lines||'<tr class="fleet-empty-row"><td colspan="5"><div class="ds-empty-state" role="status"><i class="bi bi-search" aria-hidden="true"></i><b>No trips match the selected filters.</b><span>Try adjusting your search or filters.</span></div></td></tr>')
      +'</tbody></table></div>';
  },
  next(t) {
    if(t.status==='Pre-Assigned')return t.fund_status==='Rejected'?'Revise trip fund request':'Complete dispatch preparation';
    if(t.status==='Ready for Dispatch')return t.fund_status==='Released'||(!t.fund_status&&+t.attempt_number>1)?'Review readiness and confirm dispatch':'Follow up trip fund release';
    if(t.status==='Completed'&&+t.awaiting_arrival)return 'Complete arrival inspection when the truck returns';
    if(t.status==='Awaiting Resources')return 'Assign a timed-in regular driver and linked truck';
    if(t.status==='For Reschedule')return 'Review clearance and reschedule';
    if(t.status==='On Hold - Incident Reported')return t.incident_status==='Repaired - Cleared to Continue'?'Resume trip after recorded clearance':'Monitor incident and corrective maintenance';
    if(['Dispatched','In Transit'].includes(t.status))return 'Monitor progress and record completion';
    return t.status==='Pending Review'?'Await Operations Head review':'View supporting records';
  },
  trips(ctx) {
    const q=ctx.query;
    if(q.view==='requests')return this.requests(ctx);
    if(q.view==='new-request'||q.new)return this.newRequest(ctx);
    TripUI.data=ctx.data;
    this.tripIdentity=App.me.user.id+':'+App.me.user.role;
    if(q.batch)return this.requests(ctx); // Existing authorized batch request workflow remains reachable.
    if(q.tab==='incidents'||q.view==='incidents')return this.incidents(ctx);
    const history=q.tab==='history';
    // Shift Turnover is an action on the active Trips page only, not on
    // History, Incidents or the other Dispatcher views.
    if(!history&&typeof DispatcherTurnoverUI!=='undefined')
      UI.tool(ctx,'Shift Turnover',()=>DispatcherTurnoverUI.open(),'bi-arrow-left-right','outline-secondary');
    ctx.setTitle(history?'Trip History':'Trips',history?'Review completed, cancelled, and rejected trip records.':'Prepare, dispatch, and monitor authorized trips.');
    const rows=ctx.data[history?'history':'active'];
    const fields=[
      ...(!history?[{name:'group',label:'Operational Queue',type:'select',placeholder:'All operational queues',options:[...this.categories.map(c=>[c[0],c[1]]),['awaiting','Awaiting Resources']]}]:[]),
      {name:'status',label:'Trip Status',type:'select',placeholder:'All statuses',options:(history?['Completed','Cancelled','Rejected']:(ctx.data.statuses||[]).filter(s=>!['Pending Review','Cancelled','Rejected'].includes(s))).map(s=>[s,['Dispatched','In Transit'].includes(s)?this.labels[s]+' — '+s:this.labels[s]||s])},
      {name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())},
      {name:'client_id',label:'Client',type:'select',placeholder:'All clients',options:UI.opts(ctx.data.filterOptions?.clients||[],c=>c.company_name)},
      {name:'from',label:'Schedule From',type:'date'},{name:'to',label:'Schedule To',type:'date'},
    ],opts={base:history?{tab:'history'}:{},values:{...q,search:q.search||q.q||''}};
    // Dashboard metrics are derived only from this dispatcher's authorized trip data,
    // never Operations Head's company-wide opsSummary.
    const authorized=Array.isArray(ctx.data.active)
      ?ctx.data.active.filter(t=>t.status!=='Pending Review'&&!['Cancelled','Rejected'].includes(t.status)):[];
    const activeTrips=authorized.filter(t=>t.status!=='Completed');
    const needsAction=authorized.filter(t=>['Awaiting Resources','Pre-Assigned','Ready for Dispatch','For Reschedule'].includes(t.status)
      ||(t.status==='Completed'&&+t.awaiting_arrival)
      ||(t.status==='On Hold - Incident Reported'&&t.incident_status==='Repaired - Cleared to Continue'));
    const incidentTrips=authorized.filter(t=>t.status==='On Hold - Incident Reported'
      ||(t.incident_status&& !['None','Resolved','Closed','Repaired - Cleared to Continue'].includes(t.incident_status)));
    const awaitingArrival=authorized.filter(t=>t.status==='Completed'&&+t.awaiting_arrival);
    const metrics=RecordComponents.kpis([
      {label:'Active Trips',value:activeTrips.length},
      {label:'Needs Action',value:needsAction.length,color:'amber'},
      {label:'Trips with Incidents',value:incidentTrips.length,color:'red'},
      {label:'Pending Arrival Inspections',value:awaitingArrival.length,color:'blue'}
    ]);
    // Shared records toolbar and dropdown contract; filter values stay in route query.
    const filterId='dispatcher-trip-filter',sortId='dispatcher-trip-sort';
    const filterCount=fields.filter(field=>String(q[field.name]||'')!=='').length;
    const searchToolbar='<form class="table-search" role="search" data-dispatch-trip-search>'
      +'<label class="visually-hidden" for="dispatcher-trip-search">Search trip records</label>'
      +'<i class="bi bi-search" aria-hidden="true"></i>'
      +'<input id="dispatcher-trip-search" type="search" class="form-control" name="search" maxlength="200"'
      +' placeholder="Search trip, client, route or truck" value="'+UI.esc(q.search||q.q||'')+'"></form>'
      +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger"'
      +' aria-controls="'+filterId+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter'
      +(filterCount?' ('+filterCount+')':'')+'</button>'
      +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger"'
      +' aria-controls="'+sortId+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
      +'<div class="record-workspace-popovers">'
      +'<div id="'+filterId+'" class="record-workspace-popover record-workspace-popover-wide" hidden>'
      +'<strong>Filter Trips</strong><form data-dispatch-trip-filter-form>'
      +UI.fields(fields.map(field=>({...field,col:12,value:q[field.name]||''})))
      +'<div class="record-workspace-popover-actions">'
      +'<button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
      +'<button type="submit" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button>'
      +'</div></form></div>'
      +'<div id="'+sortId+'" class="record-workspace-popover record-workspace-sort-panel" hidden>'
      +'<strong>Sort Trips</strong>'
      +[['latest','Scheduled: Latest first'],['earliest','Scheduled: Earliest first'],['reference','Trip reference']].map(([value,label])=>
        '<label class="record-workspace-sort-option"><input type="radio" name="dispatcher-trip-order" data-record-sort value="'
        +value+'"'+((q.sort||'latest')===value?' checked':'')+'> '+label+'</label>').join('')
      +'</div></div>';
    ctx.el.innerHTML='<div class="fleet-trips-workspace dispatcher-trips-workspace">'+metrics+RecordComponents.panel(
      '<div class="record-workspace-heading"><div><h2>'+(history?'Trip History Records':'Active Trip Records')+'</h2>'
      +'<p class="record-workspace-count" data-trip-record-count></p></div></div>'
      +'<div class="record-workspace-search">'+searchToolbar+'</div>'
      +'<div class="record-workspace-category-row record-workspace-view-tabs">'+RecordComponents.tripGroupControls()+'</div>'
      +'<section aria-label="Trip records" data-trip-records></section>')+'</div>';
    ctx.el.querySelector('.record-workspace-panel')?.classList.add('oh-dispatch-records');
    const searchForm=ctx.el.querySelector('[data-dispatch-trip-search]');
    const filterForm=ctx.el.querySelector('[data-dispatch-trip-filter-form]');
    const filterFields=fields.map(field=>field.name);
    const go=next=>App.go('trips',{...q,...next});
    searchForm.onsubmit=event=>{
      event.preventDefault();
      go({search:searchForm.elements.search.value.trim()});
    };
    filterForm.onsubmit=event=>{
      event.preventDefault();
      const values=UI.formData(filterForm);
      if(values.from&&values.to&&values.from>values.to){
        const to=filterForm.elements.to;
        to.setCustomValidity('End date must be on or after start date.');
        to.reportValidity();
        return;
      }
      go(Object.fromEntries(filterFields.map(key=>[key,values[key]||''])));
    };
    filterForm.addEventListener('input',()=>filterForm.elements.to?.setCustomValidity(''));
    RecordComponents.bindDropdowns(ctx.el,{
      reset:()=>go(Object.fromEntries(filterFields.map(key=>[key,'']))),
      sort:value=>go({sort:value}),
    },{filter:filterId,sort:sortId});
    const box=ctx.el.querySelector('[data-trip-records]');
    if(!Array.isArray(rows)){box.innerHTML='<p role="alert">Trip records unavailable.</p>';return;}
    const search=(q.search||q.q||'').trim().toLowerCase();
    const filtered=rows.filter(t=>(history||t.status!=='Pending Review')&&(history||this.matches(t,q.group))&&(!q.status||t.status===q.status)&&(!q.truck_type||t.truck_type===q.truck_type)&&(!q.client_id||String(t.client_id)===String(q.client_id))&&(!q.from||String(t.scheduled_at).slice(0,10)>=q.from)&&(!q.to||String(t.scheduled_at).slice(0,10)<=q.to)&&[t.trip_ref,t.client,t.pickup_point,t.delivery_point,t.plate_number].join(' ').toLowerCase().includes(search));
    filtered.sort((a,b)=>{
      if(q.sort==='reference')return String(a.trip_ref||'').localeCompare(String(b.trip_ref||''),undefined,{numeric:true});
      const left=String(a.scheduled_at||''),right=String(b.scheduled_at||'');
      return q.sort==='earliest'?left.localeCompare(right):right.localeCompare(left);
    });
    let page=0,grouped=true;const collapsed=new Set();
    const pageSize=5;const draw=()=>{
      const displayed=grouped?RecordComponents.clientTripSort(filtered,'client'):filtered;
      const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);
      ctx.el.querySelector('[data-trip-record-count]').textContent=filtered.length+' matching record'+(filtered.length===1?'':'s');
      const shown=displayed.slice(page*pageSize,(page+1)*pageSize);
      box.innerHTML=this.tripTable(shown,history)
        +(filtered.length?'<div class="table-pager oh-dispatch-pager">'
        +UI.recordPager({total:filtered.length,page:page+1,pages,pageSize,note:history?'Up to 1,000 records loaded':''})
        +'</div>':'');
      const previous=box.querySelector('[data-prev]'),next=box.querySelector('[data-next]');
      if(previous)previous.onclick=()=>{page--;draw();};
      if(next)next.onclick=()=>{page++;draw();};
      this.bindTrips(box);
      if(grouped&&shown.length){
        box.querySelectorAll('tbody tr').forEach(row=>row.dataset.clientTripRow='1');
        RecordComponents.decorateTripGroups(box,shown,displayed,'client',collapsed,!!search);
      }
    };draw();
    RecordComponents.bindTripGroupControls(ctx.el,value=>{grouped=value;page=0;collapsed.clear();draw();});
    box.addEventListener('click',event=>{
      const button=event.target.closest('[data-trip-client-group]');
      if(!button)return;
      const name=button.dataset.tripClientGroup;
      if(collapsed.has(name))collapsed.delete(name);else collapsed.add(name);
      box.querySelectorAll('[data-trip-client-group]').forEach(control=>{
        if(control.dataset.tripClientGroup===name)control.setAttribute('aria-expanded',String(!collapsed.has(name)));
      });
      box.querySelectorAll('[data-client-trip-row]').forEach(row=>{
        if(row.dataset.tripClientName===name)row.hidden=collapsed.has(name);
      });
    });
    if(q.open)TripUI.open(UI.takeQuery(ctx,'open').open);
  },
  requests(ctx) {
    ctx.setTitle('Trips','New trips are created and scheduled by Operations Head.');
    ctx.el.innerHTML='<div class="alert alert-info">Trip Requests are retired. Open your assigned trips in Trips.</div><a class="btn btn-primary" href="#trips">Trips</a>';
  },
  newRequest(ctx) { return this.requests(ctx); },

  funds(ctx) {
    ctx.setTitle('Funds & Fuel','Track cash trip funds and authorized Diesel PO documents.');
    const d=ctx.data, diesel=ctx.query.tab==='diesel';
    const funds=Array.isArray(d.funds)?d.funds:null;
    const fuelTrips=Array.isArray(d.fuelTrips)?d.fuelTrips:null;
    // Compact request/document status counts; operational dashboard keeps full KPIs.
    const counts=diesel
      ?(fuelTrips ? [['Authorized trips',fuelTrips.length],['Documents attached',fuelTrips.filter(t=>Number(t.diesel_po_docs)>0).length],['Missing documents',fuelTrips.filter(t=>!Number(t.diesel_po_docs)).length]] : [])
      :(funds ? [['Fund requests',funds.length],['Pending approval',funds.filter(f=>f.status==='Pending Approval').length],['Ready for release',funds.filter(f=>f.status==='Ready for Release').length],['Released',funds.filter(f=>f.status==='Released').length]] : []);
    const kpis=counts.length?'<div class="small text-muted mb-2">'+counts.map(([name,n])=>UI.esc(name)+': <b>'+UI.num(n)+'</b>').join(' · ')+'</div>':'';
    ctx.el.innerHTML=kpis+`<nav class="ds-fund-view-tabs" aria-label="Trip Funds and Fuel tabs"><a href="#funds" ${diesel?'':'class="active" aria-current="page"'}>Trip Fund Requests</a><a href="#funds?tab=diesel" ${diesel?'class="active" aria-current="page"':''}>Diesel PO Requests</a></nav><div data-fund-workspace></div>`;
    const box=ctx.el.querySelector('[data-fund-workspace]');
    if(diesel){
      const fields=[{name:'document_status',label:'Document Status',type:'select',placeholder:'All document statuses',options:[['attached','Document Attached'],['missing','No Document Attached']]},{name:'trip_id',label:'Associated Trip',type:'select',placeholder:'All trips',options:UI.opts(d.fuelTrips||[],t=>t.trip_ref)},{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{tab:'diesel'}};
      box.innerHTML='<p id="diesel-workflow-gap" class="alert alert-info">Diesel PO request submission, approval, and issuance are not available in the current system. You can attach and view existing Diesel PO documents linked to your authorized trips below.</p>'+this.filters(ctx,fields,{...opts,placeholder:'Search trip or truck…'})+'<div data-diesel-table></div>';
      if(!Array.isArray(d.fuelTrips)||!Array.isArray(d.dieselDocuments)){box.insertAdjacentHTML('beforeend','<p role="alert">Diesel PO document records unavailable.</p>');return;}
      const q=ctx.query,filter=q.document_status,rows=d.fuelTrips.filter(t=>(!filter||(filter==='attached'?+t.diesel_po_docs>0:!+t.diesel_po_docs))&&(!q.trip_id||String(t.id)===q.trip_id)&&(!q.truck_type||t.truck_type===q.truck_type)&&this.contains(t,['trip_ref','plate_number','truck_type'],q.search));const table=box.querySelector('[data-diesel-table]');table.innerHTML=UI.table([['Trip','trip_ref'],['Truck','plate_number'],['Document Status','diesel_po_docs',v=>UI.esc(+v?'Document Attached ('+v+')':'No Document Attached')]],rows,{showAllColumns:true,actions:()=>UI.btn('details','View'),onAction:(a,t)=>this.openDiesel(t,d),empty:'No authorized trip documents match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);this.standardRecords(ctx,table,{title:'Diesel PO Records',tabs:'.ds-fund-view-tabs',searchFields:['trip_ref','plate_number','truck_type']});return;
    }
    const fields=[{name:'status',label:'Request Status',type:'select',placeholder:'All requests / request history',options:[['Pending Approval','Pending Approval'],['Ready for Release','Approved — Awaiting Release'],['Released','Released'],['Rejected','Requires Revision'],['followup','Requires Follow-Up']]},{name:'from',label:'Request Date From',type:'date'},{name:'to',label:'Request Date To',type:'date'}],opts={values:{...ctx.query,status:ctx.query.status||(ctx.query.queue==='followup'?'followup':'')}};
    box.innerHTML=this.filters(ctx,fields,{...opts,placeholder:'Search fund reference, trip, or expense…'})+'<div data-funds-table></div>';
    if(!Array.isArray(d.funds)){box.insertAdjacentHTML('beforeend','<p role="alert">Fund requests unavailable.</p>');return;}
    const q=opts.values,status=q.status,rows=d.funds.filter(f=>(!status||(status==='followup'?['Pending Approval','Ready for Release','Rejected'].includes(f.status)&&!['Completed','Cancelled','Rejected'].includes(f.trip_status):f.status===status))&&(!q.from||String(f.created_at).slice(0,10)>=q.from)&&(!q.to||String(f.created_at).slice(0,10)<=q.to)&&this.contains(f,['fund_ref','trip_ref','breakdown','requested_by_name'],q.search));const table=box.querySelector('[data-funds-table]');table.innerHTML=UI.table([['Request / Trip','fund_ref',(v,f)=>`<b>${UI.esc(v)}</b><div>${UI.esc(f.trip_ref)}</div>`],['Requested Amount','amount','money'],['Status','status',v=>this.fundStatus(v)]],rows,{showAllColumns:true,actions:()=>UI.btn('view','View'),onAction:(a,f)=>this.openFund(f.id,d),empty:'No fund requests match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);this.standardRecords(ctx,table,{title:'Trip Fund Records',tabs:'.ds-fund-view-tabs',searchFields:['fund_ref','trip_ref','breakdown','requested_by_name']});
  },
  chooseFundTrip(d) {
    const rows=d.eligibleTrips||[];
    if(!rows.length)return UI.toast('No eligible pre-dispatch trip needs a new or revised fund request.','warn');
    const modal=UI.modal('Submit Fund Request',this.section('01 — Associated Trip','<p class="form-help">Choose the trip that needs funds. Review its expense categories on the next form.</p>'+UI.fields([{name:'trip_id',label:'Eligible Trip',type:'select',required:true,col:12,options:rows.map(t=>[t.id,t.trip_ref+' · '+(t.plate_number||'Assignment pending')])}])),async values=>{
      const details=await App.api('Trips.details',{trip_id:values.trip_id}),t=details.trip;
      const old=details.funds.find(f=>+f.attempt_number===+t.attempt_number&&f.status==='Rejected');
      modal.addEventListener('hidden.bs.modal',()=>this.fundForm(t,d.categories,old),{once:true});
    },{submit:'Continue',confirmBeforeSubmit:false});
  },
  fundForm(t,categories,old=null) {
    UI.fundForm({title:old?'Revise Trip Fund Request':'Submit Fund Request',categories,action:'Funds.submit',payload:{trip_id:t.id},selected:old?old.lines.filter(l=>+l.is_preset).map(l=>l.category_name):[],presetAmounts:Object.fromEntries((old?.lines||[]).filter(l=>+l.is_preset).map(l=>[l.category_name,l.amount])),editablePresets:true,optionalDieselPo:true,dieselPo:old?.diesel_po||(old?.diesel_po_json?JSON.parse(old.diesel_po_json):null),dieselPoVehicle:t.truck_type||old?.truck_type||'',dieselPoPlate:t.plate_number||old?.plate_number||'',extra:old?old.lines.filter(l=>!+l.is_preset).map(l=>({name:l.category_name,amount:l.amount})):[],notes:old?.notes||'',intro:`${UI.esc(t.trip_ref)}. Select applicable preset categories and adjust the amount for this request if needed. Other expenses can be added below. Review the total before submitting.`,after:()=>{UI.closeDrawer();App.route();}});
    const modal=[...document.querySelectorAll('.modal')].at(-1),form=modal?.querySelector('form');
    if(form){
      modal.classList.add('ds-structured-modal','ds-fund-request-modal');const body=modal.querySelector('.modal-body'),cats=[...form.querySelectorAll('.fund-cat')].map(c=>c.closest('label')),extras=[...form.querySelectorAll('.fund-extra')],notes=form.querySelector('[name=notes]'),notesBox=notes.parentElement,total=form.querySelector('#fundTotal'),totalBox=total.parentElement;
      body.querySelector('p')?.remove();body.querySelectorAll('h6').forEach(h=>h.remove());
      const sections=['01 — Associated Trip','02 — Preset Expense Categories','03 — Additional Expenses','04 — Diesel Purchase Order (Optional)','05 — Request Summary'].map((title,index)=>{const el=document.createElement('fieldset');el.className='ds-form-section '+['ds-fund-trip','ds-fund-presets','ds-fund-extras','ds-fund-diesel','ds-fund-summary'][index];el.innerHTML=`<legend>${title}</legend>`;body.insertBefore(el,body.querySelector('.form-error'));return el;});
      sections[0].insertAdjacentHTML('beforeend',
        '<div class="ds-fund-trip-summary">'
        +'<div class="ds-fund-trip-reference"><span class="ds-fund-trip-label">Eligible Trip</span><strong>'+UI.e(t.trip_ref)+'</strong></div>'
        +'<div class="ds-fund-trip-meta">'
        +'<div><span class="ds-fund-trip-label">Truck</span><strong>'+UI.e(t.plate_number||'Assignment pending')+'</strong></div>'
        +'<div><span class="ds-fund-trip-label">Client</span><strong>'+UI.e(t.client||'Not specified')+'</strong></div>'
        +'</div></div>');
      sections[1].insertAdjacentHTML('beforeend','<p class="form-help">Select the categories needed and edit their amounts for this request. Configured amounts are the default.</p>');cats.forEach(el=>sections[1].append(el));if(!cats.length)sections[1].insertAdjacentHTML('beforeend','<p>No preset categories are available.</p>');
      sections[2].insertAdjacentHTML('beforeend','<p class="form-help">Optional expenses need a unique name and a positive amount.</p>');
      const expenseRows=document.createElement('div');expenseRows.className='ds-additional-expense-list';sections[2].append(expenseRows);
      const renumberExpenses=()=>{
        [...expenseRows.querySelectorAll('.fund-extra')].forEach((row,index)=>{
          row.querySelectorAll('input').forEach((input,i)=>{
            input.name=(i?'extra_amount_':'extra_name_')+index;
            input.id='ds-extra-'+index+'-'+i;
            const label=input.parentElement.querySelector('label');
            if(label){label.htmlFor=input.id;label.textContent=(i?'Requested Amount':'Custom Expense Name')+' '+(index+1);}
          });
          row.querySelector('[data-remove-expense]')?.parentElement?.remove();
          if(index>0){
            const actions=document.createElement('div');actions.className='col-12 text-end';
            const remove=document.createElement('button');remove.type='button';
            remove.className='btn btn-sm btn-outline-danger ds-remove-expense';
            remove.dataset.removeExpense='1';remove.textContent='Remove Expense';
            actions.append(remove);row.append(actions);
          }
        });
      };
      const prepareExpenseRow=(row)=>{
        row.querySelectorAll('input').forEach((input,i)=>{
          const label=document.createElement('label');
          label.className='form-label';label.textContent=i?'Requested Amount':'Custom Expense Name';
          input.before(label);
        });
        expenseRows.append(row);
      };
      extras.forEach(prepareExpenseRow);
      renumberExpenses();
      const addExpense=document.createElement('button');addExpense.type='button';
      addExpense.className='btn btn-sm btn-outline-success mt-2 ds-add-expense';
      addExpense.textContent='Add Another Expense';
      sections[2].append(addExpense);
      addExpense.addEventListener('click',()=>{
        const first=expenseRows.querySelector('.fund-extra');
        if(!first)return;
        const row=first.cloneNode(true);
        row.querySelectorAll('input').forEach(input=>{input.value='';input.setCustomValidity('');});
        row.querySelector('[data-remove-expense]')?.parentElement?.remove();
        expenseRows.append(row);
        renumberExpenses();
        row.querySelector('input')?.focus();
      });
      expenseRows.addEventListener('click',event=>{
        const button=event.target.closest('[data-remove-expense]');
        if(!button||!expenseRows.contains(button))return;
        button.closest('.fund-extra')?.remove();
        renumberExpenses();
        form.dispatchEvent(new Event('input',{bubbles:true}));
      });
      const dieselAttachment=form.querySelector('[data-fund-diesel-attachment]');
      if(dieselAttachment)sections[3].append(dieselAttachment);
      notes.id='ds-notes-'+UI.uuid();notesBox.querySelector('label').htmlFor=notes.id;const breakdown=document.createElement('ul');breakdown.className='ds-fund-breakdown';breakdown.setAttribute('aria-label','Selected expenses');sections[4].append(breakdown,notesBox,totalBox);totalBox.classList.add('ds-fund-total');total.setAttribute('aria-live','polite');
      const summary=()=>{const lines=[...form.querySelectorAll('.fund-cat:checked')].map(c=>[c.dataset.name,c.closest('label').querySelector('.fund-preset-amount')?.value||c.dataset.amount]);extras.forEach(row=>{const [name,amount]=row.querySelectorAll('input');if(name.value.trim()&&+amount.value>0)lines.push([name.value.trim(),amount.value]);});breakdown.innerHTML=lines.map(([name,amount])=>`<li><span>${UI.esc(name)}</span><b>${UI.money(amount)}</b></li>`).join('')||'<li>No expenses selected.</li>';};form.addEventListener('input',summary);form.addEventListener('change',summary);summary();
    }
    if(form){form.addEventListener('input',event=>{if(event.target.closest('.fund-extra'))event.target.setCustomValidity('');});form.addEventListener('submit',event=>{
      const names=new Set((categories||[]).map(c=>c.name.trim().toLowerCase()));let invalid=null;
      form.querySelectorAll('.fund-extra').forEach(row=>{const [name,amount]=row.querySelectorAll('input');name.setCustomValidity('');amount.setCustomValidity('');if(!name.value.trim()&&!amount.value)return;const normalized=name.value.trim().toLowerCase();if(!normalized||names.has(normalized)){name.setCustomValidity('Use a unique custom expense name; preset categories belong in the section above.');invalid ||= name;}names.add(normalized);if(!/^\d+(?:\.\d{1,2})?$/.test(amount.value)||+amount.value<=0){amount.setCustomValidity('Enter a positive custom amount with at most two decimals.');invalid ||= amount;}});
      if(invalid){event.preventDefault();event.stopImmediatePropagation();invalid.reportValidity();}
    },true);}
  },
  async openFund(id,d) {
    let f;try{f=(await App.api('Funds.details',{fund_id:id})).fund;}catch(ex){return UI.toast(ex.message,'error');}
    const po=f.diesel_po;
    const poPanel=po?this.panel('Diesel Purchase Order',
      UI.kv([['P.O. Number',UI.e(po.po_number)],['Date',UI.e(po.po_date)],['Vehicle',UI.e(po.vehicle)],
        ['Plate Number',UI.e(po.plate_number)],['PO Total',UI.money(po.total_amount)]])
      +UI.table([['Liters','liters'],['Amount per Liter','unit_price','money'],['Total','total','money']],po.lines||[],{plain:true})):'';
    const el=UI.drawer(UI.esc(f.fund_ref),this.panel('Trip Fund Request',UI.kv([['Trip',UI.e(f.trip_ref)],['Requested By',UI.e(f.requested_by_name)],['Request Date',this.datetime(f.created_at)],['Requested Amount',UI.money(f.amount)],['Status',this.fundStatus(f.status)],['Approved By',UI.e(f.approved_by_name)],['Finance Release',f.status==='Released'?'Released':f.status==='Ready for Release'?'Awaiting Finance release':'Not released'],['Remarks',UI.e(f.notes)],f.rejected_reason?['Reason for Revision',UI.e(f.rejected_reason)]:null]))+this.panel('Expense Breakdown',UI.table([['Category','category_name'],['Amount','amount','money']],f.lines,{plain:true}))+poPanel+'<div class="ds-form-footer"><button class="btn btn-outline-success" data-ds-trip="'+(+f.trip_id)+'">View Related Trip</button>'+((f.status==='Rejected'&&['Pre-Assigned','Ready for Dispatch'].includes(f.trip_status)&&f.dispatcher_role===App.me.user.role)?'<button class="btn btn-primary" data-revise-fund>Revise Request</button>':'')+'</div>',{subtitle:UI.esc(f.trip_ref)});
    this.bindTrips(el);el.querySelector('[data-revise-fund]')?.addEventListener('click',()=>this.fundForm({id:f.trip_id,trip_ref:f.trip_ref},d.categories,f));
  },
  async openDiesel(t,d) {
    let docs=d.dieselDocuments.filter(doc=>+doc.trip_id===+t.id);
    if(+t.diesel_po_docs>docs.length)try{docs=(await App.api('Trips.details',{trip_id:t.id})).documents.filter(doc=>doc.category==='Diesel PO');}catch(ex){return UI.toast(ex.message,'error');}
    const canAttach=Number(t.responsible_dispatcher_id)===Number(App.me.user.id)&&['Pre-Assigned','Ready for Dispatch','Dispatched','On Hold - Incident Reported','In Transit','For Reschedule','Completed'].includes(t.status);
    const el=UI.drawer('Diesel PO Documents',this.panel('Linked Trip',UI.kv([['Trip',UI.e(t.trip_ref)],['Truck',UI.e(t.plate_number)],['Type',UI.e(t.truck_type)],['Status',this.status(t.status)]]))+UI.docs(docs)+'<p class="small text-muted mt-3">Documents are existing attachments. No request approval or PO issuance status is implied.</p>'+(canAttach?'<button class="btn btn-primary" data-attach-diesel>Attach Diesel PO Document</button>':''),{subtitle:UI.esc(t.trip_ref)});
    el.querySelector('[data-attach-diesel]')?.addEventListener('click',()=>{const modal=UI.formModalFiles('Attach Diesel PO Document',[{name:'diesel_po',label:'Diesel PO Document',type:'file',multiple:true,required:true,col:12,attrs:'accept="application/pdf,image/jpeg,image/png,image/webp"'}],'Trips.diesel_po',{extra:{trip_id:t.id},intro:'Attach an existing document to this trip. This does not create or approve a Diesel PO request.',after:()=>{UI.closeDrawer();App.route();}});this.groupModal(modal,[['01 — Associated Trip',[],UI.kv([['Trip',UI.e(t.trip_ref)],['Truck',UI.e(t.plate_number)]])],['02 — Supporting Documents',['diesel_po']]]);});
  },
  incidents(ctx) {
    ctx.setTitle('Incidents','Review incident records and monitor corrective maintenance coordination.');
    const rows=ctx.data.incidents;
    const kpis=Array.isArray(rows)
      ?'<div class="small text-muted mb-2">Incidents: <b>'+UI.num(rows.length)+'</b>'
       +' · Open: <b>'+UI.num(rows.filter(i=>i.status!=='Resolved').length)+'</b>'
       +' · Resolved: <b>'+UI.num(rows.filter(i=>i.status==='Resolved').length)+'</b>'
       +' · Linked to maintenance: <b>'+UI.num(rows.filter(i=>Boolean(i.job_ref)).length)+'</b></div>':'';
    const fields=[{name:'incident',label:'Incident Status',type:'select',placeholder:'All incidents',options:[['open','Open Incidents'],...this.options(rows,'status') ]},{name:'incident_type',label:'Incident Type',type:'select',placeholder:'All incident types',options:this.options(rows,'incident_type')},{name:'job_status',label:'Maintenance Status',type:'select',placeholder:'All maintenance statuses',options:this.options(rows,'job_status').map(([v,l])=>[v,l==='Under Repair'?'Under Corrective Maintenance':l])}],opts={base:{tab:'incidents'}};
    ctx.el.innerHTML=kpis+this.filters(ctx,fields,{...opts,placeholder:'Search incident, trip, truck, or location…'})+'<div data-incidents></div>';
    if(!Array.isArray(rows)){ctx.el.insertAdjacentHTML('beforeend','<p role="alert">Incident records unavailable.</p>');return;}
    const q=ctx.query,filter=q.incident,filtered=rows.filter(i=>(!filter||(filter==='open'?i.status!=='Resolved':i.status===filter))&&(!q.incident_type||i.incident_type===q.incident_type)&&(!q.job_status||i.job_status===q.job_status)&&this.contains(i,['incident_ref','trip_ref','plate_number','problem','location'],q.search));const table=ctx.el.querySelector('[data-incidents]');table.innerHTML=UI.table([['Incident / Trip','incident_ref',(v,i)=>`<b>${UI.esc(v)}</b><div>${UI.esc(i.trip_ref)}</div>`],['Truck','plate_number'],['Problem','problem'],['Incident Status','status',v=>this.status(v)],['Maintenance Status','job_status',v=>v?this.status(v):'Awaiting assessment']],filtered,{showAllColumns:true,actions:()=>UI.btn('view','View'),onAction:(a,i)=>this.openIncident(i),empty:'No incident reports match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);this.standardRecords(ctx,table,{title:'Incident Records',searchFields:['incident_ref','trip_ref','plate_number','problem','location']});
  },
  openIncident(i) {
    const el=UI.drawer(UI.esc(i.incident_ref),this.panel('Incident Information',UI.kv([['Trip',UI.e(i.trip_ref)],['Truck',UI.e(i.plate_number)],['Incident Type',UI.e(i.incident_type)],['Problem',UI.e(i.problem)],['Description',UI.e(i.details)],['Location',UI.e(i.location)],['Reported',this.datetime(i.incident_at)],['Severity',UI.e(i.severity||'Not assessed')],['Incident Status',UI.badge(i.status)],['Corrective Maintenance',UI.e(i.job_ref)],['Maintenance Status',UI.e(i.job_status)],['Recommendation',UI.e(i.recommendation)]]))+'<p class="small text-muted">Maintenance personnel record findings, repairs, costs, completion, and clearance. Dispatchers resume or reschedule only through the existing trip controls.</p><button class="btn btn-primary" data-ds-trip="'+(+i.trip_id)+'">View Linked Trip</button>',{subtitle:UI.esc(i.plate_number)});this.bindTrips(el);
  },
  async reportIncident() {
    let d;try{d=await this.ensureTrips();}catch(ex){return UI.toast(ex.message,'error');}
    const eligible=d.active.filter(t=>Number(t.responsible_dispatcher_id)===Number(App.me.user.id)&&['Dispatched','In Transit'].includes(t.status)&&t.vehicle_id);
    if(!eligible.length)return UI.toast('No dispatched or in-transit trip is eligible for an incident report.','warn');
    const modal=UI.modal('Submit Incident Report',UI.fields([{name:'trip_id',label:'Associated Trip / Vehicle',type:'select',required:true,col:12,options:eligible.map(t=>[t.id,t.trip_ref+' · '+t.plate_number])}]),async values=>{const r=await App.api('Trips.details',{trip_id:values.trip_id});if(r.trip.dispatcher_role!==App.me.user.role||!['Dispatched','In Transit'].includes(r.trip.status))throw new Error('This trip is no longer eligible for incident reporting.');modal.addEventListener('hidden.bs.modal',()=>TripUI.incident(r.trip),{once:true});},{submit:'Continue',confirmBeforeSubmit:false});
  },

  truckRecords(ctx, availability=false) {
    // Shared Trips-style workspace for Dispatcher Trucks. The API already
    // scopes records to the signed-in dispatcher's authorized truck categories.
    const q=ctx.query, rows=ctx.data.trucks;
    ctx.setTitle('Trucks','Review authorized trucks, operational status and dispatch readiness.');
    if(!Array.isArray(rows)){
      ctx.el.innerHTML='<p role="alert">Truck records are unavailable.</p>';
      return;
    }
    const view=availability?'availability':'masterlist';
    const searchTerms=['plate_number','truck_type','driver_name','helper_name','trip_ref','status'];
    const filtered=rows.filter(r=>(!q.availability||r.status===q.availability)
      &&(!q.truck_type||r.truck_type===q.truck_type)
      &&this.contains(r,searchTerms,q.search));
    const sort=q.sort||'plate';
    const sorted=[...filtered].sort((a,b)=>{
      const val=key=>String(key==='status'?a.status:key==='type'?a.truck_type:a.plate_number||'');
      const other=key=>String(key==='status'?b.status:key==='type'?b.truck_type:b.plate_number||'');
      return sort==='plate_desc'?other('plate').localeCompare(val('plate'),undefined,{numeric:true})
        :sort==='type'?val('type').localeCompare(other('type'))||val('plate').localeCompare(other('plate'))
        :sort==='status'?val('status').localeCompare(other('status'))||val('plate').localeCompare(other('plate'))
        :val('plate').localeCompare(other('plate'),undefined,{numeric:true});
    });
    const fields=[
      {name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())},
      {name:'availability',label:'Status',type:'select',placeholder:'All statuses',options:this.options(rows,'status')}
    ];
    const detailColumns=[
      ['Plate No.','plate_number'],['Truck Type','truck_type'],
      ['Regular Driver','driver_name'],['Regular Helper','helper_name'],
      ['Status','status','badge'],
      ['Dispatch Eligibility','assignment_available',(value,truck)=>value===true
        ?'<span class="badge-s green">Eligible</span>'
        :value===false?'<span class="badge-s amber">Not eligible</span><div class="cell-sub">'+UI.esc(truck.assignment_reason||'')+'</div>'
        :'Not verified'],
      ['Current Trip','trip_ref'],
      ['Maintenance Restriction','open_job',(value,truck)=>value?UI.esc(value)+' · '+UI.esc(truck.open_job_status||''):UI.esc(truck.status_reason||'None recorded')]
    ];
    const availabilityColumns=[
      ['Plate No.','plate_number'],['Truck Type','truck_type'],['Status','status','badge'],
      ['Current Trip','trip_ref']
    ];
    const columns=availability?availabilityColumns:[detailColumns[0],detailColumns[1],detailColumns[4]];
    const filterId='dispatcher-truck-filter',sortId='dispatcher-truck-sort';
    const options=[['plate','Plate: A to Z'],['plate_desc','Plate: Z to A'],['type','Truck type'],['status','Status']];
    const filterCount=fields.filter(field=>Boolean(q[field.name])).length;
    const tools='<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" '
      +'aria-controls="'+filterId+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter'
      +(filterCount?' ('+filterCount+')':'')+'</button>'
      +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" '
      +'aria-controls="'+sortId+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
      +'<div class="record-workspace-popovers">'
      +'<div id="'+filterId+'" class="record-workspace-popover record-workspace-popover-wide" hidden>'
      +'<strong>Filter Trucks</strong><form data-truck-filter-form>'
      +UI.fields(fields.map(field=>({...field,col:12,value:q[field.name]||''})))
      +'<div class="record-workspace-popover-actions">'
      +'<button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
      +'<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button>'
      +'</div></form></div>'
      +'<div id="'+sortId+'" class="record-workspace-popover record-workspace-sort-panel" hidden>'
      +'<strong>Sort Trucks</strong>'
      +options.map(([value,label])=>'<label class="record-workspace-sort-option"><input type="radio" '
        +'name="truck-sort" data-record-sort value="'+value+'"'+(sort===value?' checked':'')+'> '+label+'</label>').join('')
      +'</div></div>';
    const table=UI.table(columns,sorted,{
      showAllColumns:true,tools,limit:10,dsRecords:true,
      actions:()=>UI.btn('view','View'),
      onAction:async(action,row)=>{
        try{
          const result=await App.api('Fleet.truck_details',{id:row.id});
          if(!result.truck)throw new Error('Truck record is unavailable.');
          UI.drawer(UI.esc(result.truck.plate_number),
            UI.kv(detailColumns.map(([label,key,formatter])=>[label,UI.fmt(formatter,result.truck[key],result.truck)])),
            {subtitle:'Operational reference'});
        }catch(error){UI.toast(error.message,'error');}
      },
      empty:'No matching trucks found.'
    });
    const tabs=RecordComponents.tabs([
      {value:'masterlist',label:'Master List'},
      {value:'availability',label:'Availability'}
    ],view,'data-dispatch-truck-view');
    // Shared dispatcher KPI cards use the complete authorized roster, not
    // the currently filtered table; no additional API queries are necessary.
    const truckKpis=this.recordKpis([
      ['Total Trucks',rows.length,'bi-truck','resources'],
      ['Available',rows.filter(r=>r.status==='Available').length,'bi-check-circle','active'],
      ['On Current Trip',rows.filter(r=>Boolean(r.trip_ref)).length,'bi-signpost-split','blue'],
      ['Not Available',rows.filter(r=>r.status!=='Available').length,'bi-clock-history','attendance']
    ]);
    ctx.el.innerHTML=truckKpis+'<div class="fleet-trips-workspace dispatcher-trips-workspace dispatcher-trucks-workspace">'
      +RecordComponents.panel('<div class="record-workspace-tabs">'+tabs+'</div>'+table)
      +'</div>';
    // Move the live shared table search and existing action controls into the
    // same card header used by Trip Records without cloning their listeners.
    RecordComponents.mountPanel(ctx.el,{title:availability?'Truck Availability Records':'Truck Records'});
    RecordComponents.mountViewTabs(ctx.el);
    const search=ctx.el.querySelector('[data-tsearch]');
    if(search){
      search.placeholder='Search plate, type, driver or trip';
      search.value=q.search||'';
    }
    const tableBox=ctx.el.querySelector('[data-tbody]');
    if(tableBox&&UI._tables[tableBox.dataset.tbody]){
      UI._tables[tableBox.dataset.tbody].opts.dsRecords=true;
      UI._tables[tableBox.dataset.tbody].limit=10;
    }
    UI.activate(ctx.el);
    if(search&&search.value)search.dispatchEvent(new Event('input',{bubbles:true}));
    if(tableBox)this.decorateRecordsTable(tableBox.dataset.tbody);
    const go=next=>App.go('trucks',{...q,view,search:search?.value||'',...next});
    ctx.el.querySelectorAll('[data-dispatch-truck-view]').forEach(button=>{
      button.onclick=()=>App.go('trucks',{view:button.dataset.dispatchTruckView});
    });
    RecordComponents.bindDropdowns(ctx.el,{
      apply:()=>{
        const form=ctx.el.querySelector('[data-truck-filter-form]');
        const values=UI.formData(form);
        go(Object.fromEntries(fields.map(field=>[field.name,values[field.name]||''])));
      },
      reset:()=>go(Object.fromEntries(fields.map(field=>[field.name,'']))),
      sort:value=>go({sort:value})
    },{filter:filterId,sort:sortId});
  },
  standardRecords(ctx, host, {title='Records', tabs=null, context=null, searchFields=[]}={}) {
    // Move the existing shared table and filter controls; never recreate
    // action cells, attendance handlers, or their permission checks.
    const panel=host.querySelector('.panel');
    const filters=ctx.el.querySelector('[data-ds-filters]');
    if(!panel||!filters)return;
    const layout=document.createElement('div');
    layout.className='fleet-trips-workspace dispatcher-trips-workspace dispatcher-standard-workspace';
    layout.innerHTML=RecordComponents.panel('');
    const workspace=layout.querySelector('.record-workspace-panel');
    host.before(layout);
    workspace.append(panel);
    RecordComponents.mountPanel(layout,{title});
    // The shared table has its own .panel; unwrap it after moving its controls.
    // This avoids two stacked borders, padding regions, and empty footer space.
    while(panel.firstChild)workspace.append(panel.firstChild);
    panel.remove();
    const searchRow=workspace.querySelector('.record-workspace-search');
    const existing=workspace.querySelector('.record-workspace-search .table-search');
    existing?.remove();
    searchRow.append(filters);
    const search=filters.querySelector('input[type=search]');
    const searchButton=filters.querySelector('.ds-search-bar button[type=submit]');
    searchButton?.remove();
    const filterButton=filters.querySelector('.ds-filter-toggle');
    if(filterButton){
      // Use the same compact action-button treatment as Trips / Trucks.
      filterButton.className='btn btn-sm btn-outline-secondary ds-filter-toggle record-workspace-filter-trigger';
      [...filterButton.childNodes].filter(node=>node.nodeType===3).forEach(node=>{
        node.textContent=node.textContent.replace('Filters','Filter');
      });
    }
    const tabsEl=tabs?ctx.el.querySelector(tabs):null;
    if(tabsEl){
      const row=workspace.querySelector('.record-workspace-category-row');
      row.classList.add('record-workspace-view-tabs');
      row.append(tabsEl);
      tabsEl.classList.add('record-workspace-tabs');
      tabsEl.querySelectorAll('a').forEach(a=>a.classList.add('record-workspace-tab'));
    }else{
      workspace.querySelector('.record-workspace-category-row')?.remove();
    }
    const contextEl=context?ctx.el.querySelector(context):null;
    if(contextEl)workspace.querySelector('.record-workspace-heading')?.append(contextEl);
    const tbody=workspace.querySelector('[data-tbody]');
    const table=tbody&&UI._tables[tbody.dataset.tbody];
    if(!table)return;
    const initial=[...table.rows];
    const redraw=()=>{
      const text=(search?.value||'').trim().toLowerCase();
      table.rows=initial.filter(row=>!text||this.contains(row,searchFields,text));
      const key=sortPanel.querySelector('input:checked')?.value||'default';
      if(key!=='default'){
        const [column,direction]=key.split(':');
        table.rows.sort((a,b)=>{
          const aValue=String(a[column]??''),bValue=String(b[column]??'');
          const result=aValue.localeCompare(bValue,undefined,{numeric:true,sensitivity:'base'});
          return direction==='desc'?-result:result;
        });
      }
      table.page=0;
      UI.drawTable(tbody.dataset.tbody);
      this.decorateRecordsTable(tbody.dataset.tbody);
    };
    const sortId='ds-sort-'+UI.uuid();
    const button=document.createElement('button');
    button.type='button';
    button.className='btn btn-sm btn-outline-secondary record-workspace-sort-trigger';
    button.setAttribute('aria-controls',sortId);
    button.setAttribute('aria-expanded','false');
    button.innerHTML='<i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort';
    const sortPanel=document.createElement('div');
    sortPanel.className='record-workspace-popover record-workspace-sort-panel';
    sortPanel.id=sortId;
    sortPanel.hidden=true;
    const sortable=table.columns.filter(([,key])=>typeof key==='string').slice(0,4);
    const options=[['default','Default order'],...sortable.flatMap(([label,key])=>[
      [key+':asc',label+' — A to Z'],[key+':desc',label+' — Z to A']])];
    sortPanel.innerHTML='<strong>Sort Records</strong>'+options.map(([value,label])=>
      '<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="'+UI.esc(value)+'" '
      +(value==='default'?'checked':'')+'> '+UI.esc(label)+'</label>').join('');
    const popovers=document.createElement('div');
    popovers.className='record-workspace-popovers';
    popovers.append(sortPanel);
    searchRow.append(button,popovers);
    const close=()=>{sortPanel.hidden=true;button.setAttribute('aria-expanded','false');};
    button.onclick=()=>{
      const opening=sortPanel.hidden;sortPanel.hidden=!opening;
      button.setAttribute('aria-expanded',String(opening));
    };
    sortPanel.addEventListener('change',event=>{if(event.target.matches('input[type=radio]')){redraw();close();}});
    const onOutside=event=>{
      if(!layout.isConnected){document.removeEventListener('pointerdown',onOutside);return;}
      if(!popovers.contains(event.target)&&event.target!==button)close();
    };
    document.addEventListener('pointerdown',onOutside);
    search?.addEventListener('input',redraw);
    workspace.classList.add('oh-dispatch-records');
    // Funds uses an extra workspace container. Remove it once all its
    // children (tabs and table) have been moved into the shared card.
    if(host!==ctx.el&&!host.children.length&&!host.textContent.trim())host.remove();
  },
  // Keep Drivers KPIs consistent across Master List and Availability.
  // Values represent the full authorized roster, independently of table filters.
  driverKpis(rows) {
    const available=rows.filter(r=>r.availability==='Available').length;
    const onTrip=rows.filter(r=>Boolean(r.trip_ref)).length;
    const unavailable=rows.filter(r=>r.availability!=='Available').length;
    return this.recordKpis([
      ['Total Personnel',rows.length,'bi-people','resources'],
      ['Available',available,'bi-check-circle','active'],
      ['On Current Trip',onTrip,'bi-truck','blue'],
      ['Not Available',unavailable,'bi-clock-history','attendance']
    ]);
  },
  resourceTabs(ctx, availability) {
    const q={...ctx.query};delete q.tab;delete q.page;
    const id='ds-resource-'+ctx.page;
    const nav=document.createElement('nav');nav.className='ds-availability-tabs ds-resource-tabs';nav.setAttribute('aria-label','Resource views');
    nav.innerHTML='<div class="ds-availability-tab-group" role="tablist" aria-label="Resource views">'+[['masterlist','Master List'],['availability','Availability']].map(([view,label])=>{const active=(view==='availability')===availability;return '<a role="tab" id="'+id+'-'+view+'" aria-controls="'+id+'-records" aria-selected="'+active+'" tabindex="'+(active?'0':'-1')+'" href="'+UI.esc(this.href(ctx.page,{...q,view}))+'" '+(active?'class="active" aria-current="page"':'')+'>'+label+'</a>';}).join('')+'</div>';
    ctx.el.prepend(nav);const panel=ctx.el.querySelector(availability?'[data-availability]':'[data-master-records]');if(panel){panel.id=id+'-records';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',id+'-'+(availability?'availability':'masterlist'));}
    const links=[...nav.querySelectorAll('a')];links.forEach((link,index)=>{link.onclick=event=>{event.preventDefault();const target=UI.goParts(link.getAttribute('href').replace(/^#/,''));App.go(target.page,target.query);};link.onkeydown=event=>{let next;if(event.key==='ArrowRight'||event.key==='ArrowLeft')next=1-index;else if(event.key==='Home')next=0;else if(event.key==='End')next=1;else return;event.preventDefault();links[next].focus();links[next].click();};});
  },
  availability(ctx) {
    if(ctx.page==='trucks'&&ctx.query.tab==='personnel'){const q={...ctx.query,view:'availability'};delete q.tab;return App.go('crew',q);}
    if(ctx.page==='trucks')return this.truckRecords(ctx,true);
    ctx.setTitle(ctx.page==='crew'?(UI.role('car_carrier_dispatcher')?'Drivers':'Drivers & Helpers'):'Trucks','Assignments and availability follow existing fleet rules.');
    const personnel=ctx.page==='crew',d=ctx.data;
    ctx.tools?.closest('.page-head')?.classList.add('ds-availability-head');
    ctx.el.innerHTML='<section class="ds-availability" aria-label="Resource availability"><div data-availability></div></section>';
    this.resourceTabs(ctx,true);
    const rows=d[personnel?'personnel':'trucks'],box=ctx.el.querySelector('[data-availability]');
    if(!Array.isArray(rows)){box.innerHTML='<p role="alert">Availability records unavailable.</p>';return;}
    if(personnel)ctx.el.insertAdjacentHTML('afterbegin',this.driverKpis(rows));
    const detailColumns=personnel?[['Name','full_name'],['Role','person_type'],['Availability','availability','badge'],['Current Trip','trip_ref'],['Truck','plate_number'],['Attendance','attendance_status',v=>UI.esc(v||'Not Timed In')],['License Expiry','license_expiry',(v,p)=>p.person_type==='Helper'?'Not applicable':v?UI.date(v):'Not recorded']]:[['Plate No.','plate_number'],['Truck Type','truck_type'],['Availability','status','badge'],['Current Trip','trip_ref'],['Maintenance Restriction','open_job',(v,t)=>v?UI.esc(v)+' · '+UI.esc(t.open_job_status==='Under Repair'?'Under Corrective Maintenance':t.open_job_status==='Completed'?'Awaiting Maintenance Clearance':t.open_job_status):UI.esc(t.status_reason||'None recorded')]];
    const fields=[{name:'availability',label:'Availability',type:'select',placeholder:'All availability statuses',options:this.options(rows,personnel?'availability':'status')},personnel?{name:'person_type',label:'Role',type:'select',placeholder:'All authorized personnel',options:this.options(rows,'person_type')}:{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{view:'availability'}},q=ctx.query;
    box.innerHTML=this.filters(ctx,fields,{...opts,placeholder:personnel?'Search name, role, trip, or truck…':'Search plate number, type, or current trip…'})+'<div data-availability-records></div>';
    const filtered=rows.filter(r=>(!q.availability||r[personnel?'availability':'status']===q.availability)&&(!q.person_type||r.person_type===q.person_type)&&(!q.truck_type||r.truck_type===q.truck_type)&&this.contains(r,personnel?['full_name','person_type','trip_ref','plate_number']:['plate_number','trip_ref','truck_type'],q.search)),table=box.querySelector('[data-availability-records]');const columns=personnel?[detailColumns[0],detailColumns[1],detailColumns[4],detailColumns[2]]:detailColumns.slice(0,3);table.innerHTML=UI.table(columns,filtered,{showAllColumns:true,dsAvailability:true,actions:()=>UI.btn('view','View'),onAction:async(a,r)=>{try{const result=await App.api(personnel?'Fleet.crew_details':'Fleet.truck_details',{id:r.id}),record=result[personnel?'person':'truck'];if(!record)throw new Error('Record unavailable.');UI.drawer(UI.esc(personnel?record.full_name:record.plate_number),UI.kv(detailColumns.map(([label,key,fmt])=>[label,UI.fmt(fmt,record[key],record)])),{subtitle:'Operational reference'});}catch(ex){UI.toast(ex.message,'error');}},empty:'No matching records found.'});this.activateRecords(table);
    table.querySelector('.panel-body')?.insertAdjacentHTML('beforeend',`<p class="ds-availability-note"><i class="bi bi-info-circle" aria-hidden="true"></i><span>${UI.role('car_carrier_dispatcher')?'Car Carrier dispatch requires two distinct eligible drivers or an eligible driver and timed-in helper.':'Container and Wing Van dispatch requires an eligible driver and helper.'} Availability is a current reference, not a future resource reservation.</span></p>`);
    this.bindFilters(ctx,fields,opts);
    if(personnel)this.standardRecords(ctx,table,{title:'Driver Availability Records',tabs:'.ds-resource-tabs',searchFields:['full_name','person_type','trip_ref','plate_number']});
  },
  masterlist(ctx) {
    if(ctx.page==='trucks')return this.truckRecords(ctx,false);
    const personnel=ctx.page==='crew',label=personnel?(UI.role('car_carrier_dispatcher')?'Drivers':'Drivers & Helpers'):'Trucks',d=ctx.data,q=ctx.query;
    ctx.setTitle(label,'Operational records for your Dispatcher group.');
    ctx.tools?.closest('.page-head')?.classList.add('ds-availability-head');
    const rows=d[personnel?'personnel':'trucks'];if(!Array.isArray(rows)){ctx.el.innerHTML='<p role="alert">Master records unavailable.</p>';return;}
    const driverSummary=personnel?this.driverKpis(rows):'';
    const fields=[{name:'availability',label:'Availability',type:'select',placeholder:'All statuses',options:this.options(rows,personnel?'availability':'status')},personnel?{name:'person_type',label:'Role',type:'select',placeholder:'All authorized roles',options:this.options(rows,'person_type')}:{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{view:'masterlist'}};
    ctx.el.innerHTML=driverSummary+this.filters(ctx,fields,{...opts,placeholder:personnel?'Search personnel, regular truck, or current trip…':'Search plate, type, regular driver, or current trip…'})+'<div data-master-records></div>';
    const filtered=rows.filter(r=>(!q.availability||r[personnel?'availability':'status']===q.availability)&&(!q.person_type||r.person_type===q.person_type)&&(!q.truck_type||r.truck_type===q.truck_type)&&this.contains(r,personnel?['full_name','person_type','regular_truck','trip_ref']:['plate_number','truck_type','driver_name','trip_ref'],q.search));
    const detailColumns=personnel?[['Name','full_name'],['Role','person_type'],['Fixed Truck','regular_truck'],['Availability','availability','badge'],['Current Trip','trip_ref'],['License Expiry','license_expiry',(v,p)=>p.person_type==='Helper'?'Not applicable':v?UI.date(v):'Not recorded']]:[['Plate No.','plate_number'],['Truck Type','truck_type'],['Fixed Driver','driver_name'],['Regular Helper','helper_name'],['Status','status','badge'],['Assignment Availability','assignment_available',(v,t)=>v===true?'<span class="badge-s green">Driver and truck ready</span>':v===false?'<span class="badge-s amber">Not eligible</span><div class="cell-sub">'+UI.esc(t.assignment_reason)+'</div>':'See operational status'],['Current Trip','trip_ref'],['Maintenance Restriction','open_job',(v,t)=>v?UI.esc(v)+' · '+UI.esc(t.open_job_status):'None recorded']];
    const columns=personnel?detailColumns.slice(0,4):[detailColumns[0],detailColumns[1],detailColumns[4]];
    const box=ctx.el.querySelector('[data-master-records]');box.innerHTML=UI.table(columns,filtered,{showAllColumns:true,actions:()=>UI.btn('view','View'),onAction:async(a,r)=>{try{const result=await App.api(personnel?'Fleet.crew_details':'Fleet.truck_details',{id:r.id}),record=result[personnel?'person':'truck'];if(!record)throw new Error('Record unavailable.');UI.drawer(UI.esc(personnel?record.full_name:record.plate_number),UI.kv(detailColumns.map(([label,key,fmt])=>[label,UI.fmt(fmt,record[key],record)])),{subtitle:'Operational reference'});}catch(ex){UI.toast(ex.message,'error');}},empty:'No matching records found.'});this.activateRecords(box);this.bindFilters(ctx,fields,opts);this.resourceTabs(ctx,false);if(personnel)this.standardRecords(ctx,box,{title:'Driver Records',tabs:'.ds-resource-tabs',searchFields:['full_name','person_type','regular_truck','trip_ref']});
  },
  attendanceKeys: new Map(),
  attendanceBusy: new Set(),
  openAttendanceTimeIn(ctx, person) {
    // Open a confirmation form instead of recording the current time on click.
    const identity=[App.me.user.id,person.id,'time_in',person.session?.id||0].join(':');
    if(this.attendanceBusy.has(identity))return;
    const now=UI.nowManila();
    const selected=UI.fields([{
      name:'time_in_at',label:'Actual Time In (Philippine Time)',
      type:'datetime',required:true,col:12,value:now,
      attrs:'max="'+now+'"'
    }]);
    UI.modal('Record Time In — '+UI.esc(person.full_name),
      '<p class="small text-muted mb-2">Select the actual time this person arrived. The current time is prefilled; adjust it before confirming. Choose a time within the current attendance day (starting at 6:00 AM). Backdating is limited to 24 hours.</p>'
      +selected,
      async values=>{
        if(this.attendanceBusy.has(identity))throw new Error('This attendance record is already being processed.');
        this.attendanceBusy.add(identity);
        const key=this.attendanceKeys.get(identity)||UI.uuid();
        this.attendanceKeys.set(identity,key);
        try{
          const result=await App.api('Attendance.time_in',{
            personnel_id:person.id,request_key:key,time_in_at:values.time_in_at
          });
          this.attendanceKeys.delete(identity);
          UI.result(result);
          await ctx.reload();
        }catch(error){
          if(error.status&&error.status<500)this.attendanceKeys.delete(identity);
          throw error;
        }finally{this.attendanceBusy.delete(identity);}
      },{submit:'Confirm Time In',confirmBeforeSubmit:true});
  },
  openAttendanceBatch(ctx, operation, selected) {
    const rows=[...selected];
    if(!rows.length)return UI.toast('Select eligible personnel first.','warn');
    const inMode=operation==='time_in',now=UI.nowManila();
    const fields=inMode?UI.fields([{
      name:'time_in_at',label:'Actual Time In (Philippine Time)',
      type:'datetime',required:true,col:12,value:now,attrs:'max="'+now+'"'
    }]):'';
    const names=rows.map(r=>'<li>'+UI.esc(r.full_name)+'</li>').join('');
    const key=UI.uuid();
    UI.modal((inMode?'Record Time In':'Record Time Out')+' — '+rows.length+' selected',
      '<p class="small text-muted">Review the checklist before recording attendance. '
      +(inMode?'Select the actual arrival time within the current attendance day.':'Time Out will use the current server time.')
      +'</p><ul class="ds-attendance-batch-names">'+names+'</ul>'+fields,
      async values=>{
        const payload={operation,request_key:key,
          items:rows.map(r=>({personnel_id:r.id,...(!inMode?{session_id:r.session?.id}:{})}))};
        if(inMode)payload.time_in_at=values.time_in_at;
        const result=await App.api('Attendance.batch',payload);
        UI.result(result);
        await ctx.reload();
      },{submit:inMode?'Confirm Time In':'Confirm Time Out',confirmBeforeSubmit:true});
  },
  attendance(ctx) {
    const crewType=ctx.query.crew_type==='Helper'?'Helper':'Driver';
    const crewLabel=crewType==='Driver'?'Driver':'Helper';
    ctx.setTitle(crewLabel+' Attendance','Record Time In and Time Out for authorized '+crewLabel.toLowerCase()+'s. Open sessions continue across midnight and turnover.');
    const d=ctx.data,q=ctx.query,rows=d.rows;if(!Array.isArray(rows)){ctx.el.innerHTML='<p role="alert">Attendance roster unavailable.</p>';return;}
    const crewRows=rows.filter(r=>r.person_type===crewType);
    const fields=[{name:'attendance_status',label:'Attendance Status',type:'select',placeholder:'All attendance states',options:this.options(crewRows,'attendance_status')}],opts={base:{view:'attendance',crew_type:crewType}};
    // Compact attendance status counts; the roster and action buttons remain intact.
    const kpis='<div class="small text-muted mb-2">'+UI.esc(crewLabel)+'s: <b>'+UI.num(crewRows.length)+'</b>'
      +' · Timed In: <b>'+UI.num(crewRows.filter(r=>r.attendance_status==='Timed In').length)+'</b>'
      +' · Not Timed In: <b>'+UI.num(crewRows.filter(r=>r.attendance_status==='Not Timed In').length)+'</b>'
      +' · Timed Out: <b>'+UI.num(crewRows.filter(r=>r.attendance_status==='Timed Out').length)+'</b></div>';
    ctx.el.innerHTML=(!d.schema_ready?'<p role="alert" class="alert alert-warning">Dispatcher attendance sessions are not installed. Apply the additive Dispatcher attendance migration.</p>':'')+kpis+this.filters(ctx,fields,{...opts,placeholder:'Search '+crewLabel.toLowerCase()+' name…'})+'<nav class="ds-attendance-crew-tabs" aria-label="Attendance pages"><div class="ds-attendance-crew-links">'+['Driver','Helper'].map(type=>'<a href="'+UI.esc(this.href(ctx.page,{view:'attendance',crew_type:type}))+'" '+(type===crewType?'class="active" aria-current="page"':'')+'>'+type+' Attendance ('+rows.filter(r=>r.person_type===type).length+')</a>').join('')+'</div></nav><p class="ds-record-context">Attendance date: '+UI.esc(d.attendance_date||d.shift?.date||'Unavailable')+' <span class="ds-attendance-reset-note">· Resets daily at 6:00 AM (PH)</span></p><div data-attendance-records></div><p class="small text-muted">Time Out is blocked while personnel are held by an active trip. One Time In and Time Out cycle is allowed per attendance date; previous records remain in History.</p>';
    const checklist={mode:'time_in',selected:new Set()};
    const selectable=r=>r.can_record!==false&&r.action===(checklist.mode==='time_in'?'Time In':'Time Out');
    const checkbox=r=>selectable(r)
      ?'<input type="checkbox" class="form-check-input ds-attendance-check" data-attendance-check="'+(+r.id)+'" aria-label="Select '+UI.esc(r.full_name)+'" '+(checklist.selected.has(String(r.id))?'checked':'')+'>'
      :'<span class="ds-attendance-check-placeholder" aria-hidden="true"></span>';
    const filtered=crewRows.filter(r=>(!q.attendance_status||r.attendance_status===q.attendance_status)&&this.contains(r,['full_name','person_type'],q.search)),box=ctx.el.querySelector('[data-attendance-records]');
    box.innerHTML=UI.table([['Name','full_name',(v,r)=>'<div class="ds-attendance-person-row">'+checkbox(r)+'<div class="ds-attendance-person"><strong>'+UI.esc(v)+'</strong>'+(+r.has_truck_link?'':'<small class="d-block text-muted">Attendance only · no truck link</small>')+'<button type="button" class="ds-attendance-history" data-attendance-history="'+(+r.id)+'" aria-label="View attendance history for '+UI.esc(v)+'"><i class="bi bi-clock-history" aria-hidden="true"></i> History</button></div></div>'],['Role','person_type',v=>'<span class="ds-attendance-role">'+UI.esc(v)+'</span>'],['Time In','session',session=>session?.time_in?'<span class="ds-attendance-time">'+UI.esc(this.datetime(session.time_in))+'</span>':'<span class="ds-attendance-empty">Not recorded</span>'],['Time Out','session',session=>session?.time_out?'<span class="ds-attendance-time">'+UI.esc(this.datetime(session.time_out))+'</span>':'<span class="ds-attendance-empty">—</span>'],['Status','attendance_status',v=>`<span class="ds-attendance-status ${v==='Timed In'?'is-in':v==='Timed Out'?'is-out':'is-pending'}"><span class="ds-attendance-dot" aria-hidden="true"></span>${UI.esc(v)}</span>`]],filtered,{showAllColumns:true,actions:r=>r.action==='Completed'
      ?'<span class="ds-attendance-completed" title="'+UI.esc(r.action_reason||'Attendance cycle completed')+'"><i class="bi bi-check-circle" aria-hidden="true"></i> Completed</span>'
      :`<button type="button" class="btn btn-sm ${r.action==='Time Out'?'ds-attendance-action-out':'ds-attendance-action-in'}" data-act="record" title="${UI.esc(r.action_reason||'')}" ${!d.schema_ready||r.can_record===false?'disabled':''}>${UI.esc(r.action)}</button>`,onAction:async(a,r,button)=>{
      if(r.action==='Time In')return this.openAttendanceTimeIn(ctx,r);
      const operation='time_out',identity=[App.me.user.id,r.id,operation,r.session?.id||0].join(':');if(this.attendanceBusy.has(identity))return;
      this.attendanceBusy.add(identity);const key=this.attendanceKeys.get(identity)||UI.uuid();this.attendanceKeys.set(identity,key);button.disabled=true;button.textContent='Recording…';
      try{const result=await App.api('Attendance.'+operation,{personnel_id:r.id,session_id:r.session?.id,request_key:key});this.attendanceKeys.delete(identity);UI.result(result);await ctx.reload();}catch(ex){if(ex.status&&ex.status<500)this.attendanceKeys.delete(identity);UI.toast(ex.message,'error');}finally{this.attendanceBusy.delete(identity);if(button.isConnected){button.disabled=false;button.textContent=r.action;}}
    },empty:'No authorized personnel match.'});this.activateRecords(box);this.bindFilters(ctx,fields,opts);this.standardRecords(ctx,box,{title:crewLabel+' Attendance Records',tabs:'.ds-attendance-crew-tabs',context:'.ds-record-context',searchFields:['full_name','person_type']});ctx.el.querySelector('.dispatcher-standard-workspace')?.classList.add('dispatcher-attendance-workspace');
    const workspace=ctx.el.querySelector('.dispatcher-attendance-workspace');
    workspace?.querySelectorAll('.ds-attendance-crew-tabs a').forEach(link=>link.addEventListener('click',event=>{
      event.preventDefault();
      const target=UI.goParts(link.getAttribute('href').replace(/^#/,''));
      App.go(target.page,target.query);
    }));
    const toolbar=document.createElement('div');
    toolbar.className='ds-attendance-checklist-toolbar';
    toolbar.innerHTML='<div class="ds-attendance-checklist-mode" role="group" aria-label="Checklist operation">'
      +'<button type="button" data-attendance-mode="time_in" class="active">Time In</button>'
      +'<button type="button" data-attendance-mode="time_out">Time Out</button></div>'
      +'<label class="ds-attendance-select-all"><input type="checkbox" class="form-check-input" data-attendance-all> Select all eligible</label>'
      +'<span class="ds-attendance-selection-count" data-attendance-count>0 selected</span>'
      +'<button type="button" class="btn btn-sm btn-primary ds-attendance-batch-button" data-attendance-batch disabled>Record Time In (0)</button>';
    workspace?.querySelector('.table-wrap')?.before(toolbar);
    const tableId=workspace?.querySelector('[data-tbody]')?.dataset.tbody;
    const tableState=tableId&&UI._tables[tableId];
    const updateChecklist=()=>{
      const eligible=(tableState?.rows||[]).filter(selectable);
      const all=toolbar.querySelector('[data-attendance-all]');
      all.disabled=!eligible.length;
      all.checked=eligible.length>0&&eligible.every(r=>checklist.selected.has(String(r.id)));
      all.indeterminate=!all.checked&&eligible.some(r=>checklist.selected.has(String(r.id)));
      toolbar.querySelector('[data-attendance-count]').textContent=checklist.selected.size+' selected';
      const button=toolbar.querySelector('[data-attendance-batch]');
      button.disabled=checklist.selected.size===0;
      button.textContent='Record '+(checklist.mode==='time_in'?'Time In':'Time Out')+' ('+checklist.selected.size+')';
      toolbar.querySelectorAll('[data-attendance-mode]').forEach(b=>{
        const active=b.dataset.attendanceMode===checklist.mode;
        b.classList.toggle('active',active);
        b.setAttribute('aria-pressed',String(active));
      });
    };
    workspace?.addEventListener('change',event=>{
      const item=event.target.closest('[data-attendance-check]');
      if(item){
        const id=item.dataset.attendanceCheck;
        if(item.checked)checklist.selected.add(id);else checklist.selected.delete(id);
        updateChecklist();
      }
    });
    toolbar.querySelector('[data-attendance-all]').addEventListener('change',event=>{
      (tableState?.rows||[]).filter(selectable).forEach(r=>{
        if(event.target.checked)checklist.selected.add(String(r.id));
        else checklist.selected.delete(String(r.id));
      });
      if(tableId)UI.drawTable(tableId);
      updateChecklist();
    });
    toolbar.querySelectorAll('[data-attendance-mode]').forEach(button=>button.addEventListener('click',()=>{
      checklist.mode=button.dataset.attendanceMode;
      checklist.selected.clear();
      if(tableId)UI.drawTable(tableId);
      updateChecklist();
    }));
    toolbar.querySelector('[data-attendance-batch]').addEventListener('click',()=>{
      const selected=crewRows.filter(r=>checklist.selected.has(String(r.id))&&selectable(r));
      if(selected.length!==checklist.selected.size)return UI.toast('Attendance eligibility changed. Refresh and select again.','warn');
      this.openAttendanceBatch(ctx,checklist.mode,selected);
    });
    updateChecklist();
    // Refresh the displayed duty date when Manila reaches 6:00 AM.
    // Clearing the previous timer avoids duplicate refreshes on rerender.
    if(this.attendanceResetTimer)clearTimeout(this.attendanceResetTimer);
    const manilaTime=UI.nowManila();
    const [,hour,minute]=manilaTime.match(/T(\d{2}):(\d{2})/)||[];
    if(hour!==undefined){
      const currentMinutes=Number(hour)*60+Number(minute);
      const minutesUntilReset=(360-currentMinutes+1440)%1440||1440;
      this.attendanceResetTimer=setTimeout(()=>{
        if(box.isConnected&&location.hash.includes('view=attendance'))ctx.reload();
      },minutesUntilReset*60000+2500);
    }
    box.onclick=async event=>{const button=event.target.closest('[data-attendance-history]');if(!button)return;button.disabled=true;try{const h=await App.api('Attendance.dispatcher_history',{personnel_id:button.dataset.attendanceHistory});const el=UI.drawer('Attendance History · '+UI.esc(h.person.full_name),UI.table([['Recorded Duty Date','duty_date'],['Recorded Batch','duty_shift'],['Time In','time_in',v=>this.datetime(v)],['Time Out','time_out',v=>this.datetime(v)],['Recorded In By','timed_in_by_name'],['Recorded Out By','timed_out_by_name']],h.sessions,{plain:true,limit:10,empty:'No attendance sessions recorded.'}));UI.activate(el);}catch(ex){UI.toast(ex.message,'error');}finally{button.disabled=false;}};
  },
  documents(ctx) {
    ctx.setTitle('Documents','Search and view authorized trip and incident documents. Submit files through their trip workflows.');
    const d=ctx.data;
    if(!Array.isArray(d.documents)){ctx.el.innerHTML='<p role="alert">Document records unavailable.</p>';return;}
    const fields=[{name:'category',label:'Document Category',type:'select',placeholder:'All document categories',options:this.options(d.documents,'category')},{name:'trip_id',label:'Associated Trip',type:'select',placeholder:'All trips and other records',options:this.options(d.documents.filter(doc=>doc.entity_type==='trip'),'entity_id','record_label')},{name:'from',label:'Upload Date From',type:'date'},{name:'to',label:'Upload Date To',type:'date'}],q=ctx.query;
    ctx.el.innerHTML=this.filters(ctx,fields,{placeholder:'Search filename, linked record, or uploader…'})+'<div data-documents></div>';
    const rows=d.documents.filter(doc=>(!q.category||doc.category===q.category)&&(!q.trip_id||(doc.entity_type==='trip'&&String(doc.entity_id)===q.trip_id))&&(!q.from||String(doc.created_at).slice(0,10)>=q.from)&&(!q.to||String(doc.created_at).slice(0,10)<=q.to)&&this.contains(doc,['original_filename','record_label','uploader','category'],q.search)),box=ctx.el.querySelector('[data-documents]');box.innerHTML=UI.table([['Document / Type','original_filename',(v,doc)=>UI.esc(v)+'<div class="cell-sub">'+UI.esc(doc.category)+'</div>'],['Associated Trip / Record','record_label'],['File Status','days_left',v=>v!=null&&+v<0?'<span class="badge-s red">Expired</span>':'<span class="badge-s green">Attached</span>']],rows,{showAllColumns:true,actions:()=>UI.btn('view','View / Download'),onAction:(a,doc)=>UI.drawer(UI.esc(doc.original_filename),UI.kv([['Associated Record',UI.e(doc.record_label)],['Document Type',UI.e(doc.category)],['Uploaded',this.datetime(doc.created_at)],['Uploaded By',UI.e(doc.uploader)],['Expiry',UI.date(doc.expires_on)],['Notes',UI.e(doc.notes)]])+UI.docs([doc]),{subtitle:UI.esc(doc.record_label)}),empty:'No authorized documents match.'});this.activateRecords(box);this.bindFilters(ctx,fields);
  },

  decorateTrip(el,r) {
    const t=r.trip,body=el.querySelector('.offcanvas-body'),actions=body.querySelector('.drawer-actions'),sections=new Map(),progress=body.querySelector('.ui-workflow');
    el.classList.add('ds-trip-drawer');el.querySelector('.btn-close').setAttribute('aria-label','Close Trip Details');
    // Hide superseded Dispatcher Trip Details controls without changing existing records.
    body.querySelectorAll('button').forEach(button=>{
      if(button.matches('[data-tact="dieselpo"]')||button.textContent.trim()==='Booking / container details')button.remove();
    });
    el.querySelector('.offcanvas-header > div').insertAdjacentHTML('beforeend',this.status(t.status));
    [...body.querySelectorAll('.drawer-h')].forEach(h=>{const title=h.querySelector('span').textContent,fragment=document.createDocumentFragment();let node=h.nextSibling;while(node&&!(node.nodeType===1&&node.classList.contains('drawer-h'))){const next=node.nextSibling;fragment.append(node);node=next;}h.querySelectorAll('button').forEach(b=>fragment.prepend(b));sections.set(title,fragment);h.remove();});
    const inspection=r.inspections.find(i=>i.kind==='Pre-Dispatch'&&+i.attempt_number===+t.attempt_number),arrival=r.inspections.find(i=>i.kind==='Arrival'&&+i.attempt_number===+t.attempt_number),fund=r.funds.find(f=>+f.attempt_number===+t.attempt_number);
    const preparing=['Pre-Assigned','Ready for Dispatch','For Reschedule'].includes(t.status);
    const crewAssigned=!!(t.vehicle_id&&t.driver_id&&(t.truck_type==='Car Carrier'?(t.driver2_id||t.helper_id):t.helper_id));
    const inspectionCompleted=!!(inspection?.completed_at&&+inspection.vehicle_id===+t.vehicle_id&&+inspection.has_not_ok===0);
    const blockers=preparing?(t.dispatch_blockers||[]):[];
    const readinessItems=[
      {label:'Truck & Crew',detail:crewAssigned?'Assigned':'Assignment required',done:crewAssigned},
      {label:'Trip Funds',detail:fund?this.fundStatus(fund.status):+t.attempt_number>1?'Optional for redispatch':'Not requested',done:fund?.status==='Released'},
      {label:'Pre-Dispatch Inspection',detail:inspectionCompleted?'Completed':inspection?.has_not_ok?'Requires Attention':'Pending',done:inspectionCompleted},
      {label:'Diesel PO Documents',detail:+t.diesel_po_docs?(+t.diesel_po_docs)+' attached':'Optional · None attached',done:+t.diesel_po_docs>0,optional:true}
    ];
    if(t.status==='Completed')readinessItems.push({label:'Arrival Inspection',detail:+t.awaiting_arrival?(arrival?'Clearance pending':'Inspection pending'):arrival?'Recorded':'Not recorded',done:!!arrival&&!+t.awaiting_arrival});
    const readinessHtml='<section class="ds-trip-overview-readiness" aria-label="Trip readiness summary">'
      +'<div class="ds-trip-overview-heading"><div><span class="ds-trip-overview-eyebrow">Operational Summary</span><h2>Readiness Overview</h2></div>'+this.status(t.status)+'</div>'
      +'<div class="ds-trip-overview-grid">'+readinessItems.map(item=>'<div class="ds-trip-overview-check"><span class="ds-trip-overview-check-icon '+(item.done?'is-complete':item.optional?'is-optional':'is-pending')+'"><i class="bi '+(item.done?'bi-check-circle-fill':item.optional?'bi-file-earmark':'bi-clock-history')+'" aria-hidden="true"></i></span><div><span class="ds-trip-overview-label">'+UI.esc(item.label)+'</span><strong>'+item.detail+'</strong></div></div>').join('')+'</div>'
      +(blockers.length?'<div class="ds-trip-overview-alert" role="status"><strong>Dispatch restrictions</strong><ul>'+blockers.map(b=>'<li>'+UI.esc(b)+'</li>').join('')+'</ul></div>':'')
      +'</section>';
    body.innerHTML=readinessHtml+'<div data-ds-sections></div>';
    const container=body.querySelector('[data-ds-sections]');
    const append=(title,content,open=false)=>{const detail=document.createElement('details');detail.className='ds-detail';detail.open=open;const summary=document.createElement('summary');summary.textContent=title;const inner=document.createElement('div');inner.className='ds-detail-body';if(typeof content==='string')inner.innerHTML=content;else if(content)inner.append(content);detail.append(summary,inner);container.append(detail);return inner;};
    const overview=append('Trip Overview','<div class="ds-trip-overview-info">'
      +'<section class="ds-trip-overview-info-card"><div class="ds-trip-overview-info-title"><i class="bi bi-info-circle" aria-hidden="true"></i><h4>Trip Information</h4></div>'
      +UI.kv([['Client',UI.e(t.client)],['Scheduled Dispatch',this.datetime(t.scheduled_at)],['Status',this.status(t.status)],['Next Action',UI.esc(this.next(t))]])+'</section>'
      +'<section class="ds-trip-overview-info-card"><div class="ds-trip-overview-info-title"><i class="bi bi-signpost-split" aria-hidden="true"></i><h4>Route Details</h4></div>'
      +UI.kv([['Origin',UI.e(t.pickup_point)],['Destination',UI.e(t.delivery_point)],['Approved Client Route',UI.e(t.client_route_ref||'No approved route linked')]])+'</section>'
      +'<section class="ds-trip-overview-info-card"><div class="ds-trip-overview-info-title"><i class="bi bi-clock-history" aria-hidden="true"></i><h4>Record Information</h4></div>'
      +UI.kv([['Requesting User',UI.e(t.created_by_name)],['Created',this.datetime(t.created_at)],...(t.cancel_reason?[['Recorded Closure Reason',UI.e(t.cancel_reason)]]:[])])+'</section></div>',true);
    const savedMap=sections.get('Trip')?.querySelector('[data-routemap]');if(savedMap)overview.append(savedMap);
    if(t.pricing_estimate)append('Pricing',UI.kv([['Pricing basis',t.pricing_estimate.frozen?'Dispatch snapshot':'Current estimate only'],['Fixed route rate',t.pricing_estimate.fixed===null||t.pricing_estimate.fixed===undefined?'Unavailable':UI.money(t.pricing_estimate.fixed)],['Fuel charge',t.pricing_estimate.fuel===null?'Fuel Estimate Unavailable':UI.money(t.pricing_estimate.fuel)],['Total',t.pricing_estimate.total===null||t.pricing_estimate.total===undefined?'Pending Fuel Calculation':UI.money(t.pricing_estimate.total)]]));
    append('Delivery & Shipment',UI.kv([['Delivery Instructions',UI.e(t.delivery_details)],['Consignee',UI.e(t.consignee)],['Booking Reference',UI.e(t.booking_reference)],...(t.truck_type==='Car Carrier'?[['Cargo Units',UI.e(t.units_planned)]]:[['Shipment Number',UI.e(t.shipment_number)]]),...(t.truck_type==='Container'?[['Container Number',UI.e(t.container_number)],['Container Size',UI.e(t.container_size)],['Seal Number',UI.e(t.seal_number)]]:[])]));
    append('Truck & Personnel',UI.kv([['Original Dispatcher Group',UI.e(App.me.roles?.[t.dispatcher_role]||t.dispatcher_role)],['Original Dispatcher Shift',UI.e(t.dispatcher_shift)],['Recorded Dispatch Account',UI.e(t.dispatcher_name)],['Current Responsible Dispatcher',UI.e(t.responsible_dispatcher_name||'Not yet assigned by Operations Head')],['Vehicle',UI.e(t.plate_number)],['Vehicle Availability',UI.e(t.truck_status)],['Driver 1',UI.e(t.driver_name)],...(t.truck_type==='Car Carrier'&&t.driver2_id?[['Driver 2',UI.e(t.driver2_name)]]:[['Helper',UI.e(t.helper_name)]]),['Attendance Policy',UI.e(t.crew_attendance?.mode)],['Attendance Basis','Open Time In session']])+(t.crew_attendance?.crew||[]).map(c=>`<p class="small">${UI.esc(c.role)}: ${UI.esc(c.issue||'Present')}${c.problem?' · '+UI.esc(c.problem):''}${c.outside_scheduled_shift?' · Outside scheduled shift':''}</p>`).join('')+(t.crew_attendance?.missing||[]).map(x=>`<p class="text-danger small">${UI.esc(x)}</p>`).join(''));
    // Present recorded fund information as a compact summary and itemized breakdown.
    // Retain the existing Print request form element and its bound action.
    const fuel=append('Funds & Fuel',sections.get('Fund request'));
    if(fund){
      const printAction=fuel.querySelector('[data-tact="printfund"]');
      const fundStatusLabel=fund.status==='Ready for Release'?'Approved — Awaiting Release':fund.status==='Rejected'?'Requires Revision':fund.status;
      const fundLines=Array.isArray(fund.lines)?fund.lines:[];
      const lineItems=fundLines.map(line=>'<tr><td>'+UI.esc(line.category_name)+'</td><td class="ds-trip-fund-money">'+UI.money(line.amount)+'</td></tr>').join('');
      fuel.replaceChildren();
      const head=document.createElement('div');head.className='ds-trip-fund-heading';
      head.innerHTML='<div class="ds-trip-fund-heading-copy"><span class="ds-trip-fund-eyebrow">Trip Fund Request</span><strong>'+UI.esc(fund.fund_ref||'—')+'</strong><span class="ds-trip-fund-state">'+UI.badge(fundStatusLabel)+'</span></div>'
        +'<div class="ds-trip-fund-amount"><span>Total requested</span><strong>'+UI.money(fund.amount)+'</strong></div>';
      if(printAction){printAction.classList.add('ds-trip-fund-print');printAction.textContent='Print Request Form';head.append(printAction);}
      const main=document.createElement('section');main.className='ds-trip-fund-card';
      main.append(head);
      const progress=document.createElement('div');progress.className='ds-trip-fund-progress';
      progress.innerHTML=UI.fundProgress(fund);
      main.append(progress);
      const details=document.createElement('div');details.className='ds-trip-fund-details';
      details.innerHTML='<div class="ds-trip-fund-subheading"><strong>Expense Breakdown</strong><span>'+fundLines.length+' item'+(fundLines.length===1?'':'s')+'</span></div>'
        +'<div class="ds-trip-fund-table-wrap"><table class="ds-trip-fund-table"><thead><tr><th scope="col">Expense category</th><th scope="col">Amount</th></tr></thead><tbody>'
        +(lineItems||'<tr><td colspan="2">No expense lines recorded.</td></tr>')
        +'</tbody><tfoot><tr><th scope="row">Total</th><td class="ds-trip-fund-money">'+UI.money(fund.amount)+'</td></tr></tfoot></table></div>';
      // Keep all recorded line items accessible without occupying the full screen.
      const breakdown=document.createElement('details');breakdown.className='ds-trip-fund-breakdown';
      breakdown.open=fund.status==='Rejected';
      const breakdownTitle=document.createElement('summary');breakdownTitle.textContent='Expense Breakdown ('+fundLines.length+' items)';
      breakdown.append(breakdownTitle,details);
      main.append(breakdown);
      const meta=document.createElement('dl');meta.className='ds-trip-fund-meta';
      const fundFields=[['Requested by',fund.requested_by_name],['Submitted',fund.created_at?UI.datetime(fund.created_at):'—'],
        ['Approved by',fund.approved_by_name||'Not recorded'],['Released',fund.released_at?UI.datetime(fund.released_at):'Not recorded']];
      if(fund.rejected_reason)fundFields.push(['Reason for revision',fund.rejected_reason]);
      meta.innerHTML=fundFields.map(([label,value])=>'<div><dt>'+UI.esc(label)+'</dt><dd>'+UI.esc(value||'—')+'</dd></div>').join('');
      const metadata=document.createElement('details');metadata.className='ds-trip-fund-metadata';
      const metadataTitle=document.createElement('summary');metadataTitle.textContent='Request Details';
      metadata.append(metadataTitle,meta);
      main.append(metadata);
      fuel.append(main);
    }
    fuel.querySelectorAll('.badge-s').forEach(b=>{if(b.textContent==='Ready for Release')b.textContent='Approved — Awaiting Release';if(b.textContent==='Rejected')b.textContent='Requires Revision';});

    const fundButton=actions?.querySelector('[data-tact=fund]');if(fundButton){fundButton.textContent=fund?.status==='Rejected'?'Revise Trip Funds':'Request Trip Funds';fundButton.onclick=()=>this.fundForm(t,TripUI.data.fundCategories,fund?.status==='Rejected'?fund:null);fuel.append(fundButton);}

    append('Pre-Dispatch Checklist',[...sections].find(([title])=>title.startsWith('Pre-dispatch checklist'))?.[1]);
    const dispatch=append('Dispatch & Progress','<div class="ds-trip-ops-summary">'
      +'<div class="ds-trip-ops-status"><span>Current Status</span>'+this.status(t.status)+'</div>'
      +'<div class="ds-trip-ops-status"><span>Dispatched</span><strong>'+this.datetime(t.dispatched_at)+'</strong></div>'
      +'<div class="ds-trip-ops-next"><span>Next Action</span><strong>'+UI.esc(this.next(t))+'</strong></div>'
      +'</div>');
    const updates=sections.get('Updates and delays');
    if(updates&&updates.childNodes.length){
      const updatesGroup=document.createElement('details');updatesGroup.className='ds-trip-ops-extra';
      const title=document.createElement('summary');title.textContent='Recorded Updates';
      updatesGroup.append(title,updates);dispatch.append(updatesGroup);
    }
    if(progress){
      const timeline=document.createElement('details');timeline.className='ds-trip-ops-extra ds-trip-ops-timeline';
      const title=document.createElement('summary');title.textContent='Full Trip Timeline';
      timeline.append(title,progress);dispatch.append(timeline);
    }
    if(t.time_gates?.checklist_opens_at||t.time_gates?.dispatch_opens_at){
      const timing=document.createElement('details');timing.className='ds-trip-ops-extra';
      const title=document.createElement('summary');title.textContent='Dispatch Window Details';
      const windowInfo=document.createElement('div');windowInfo.className='ds-trip-ops-extra-body';
      windowInfo.innerHTML=UI.kv([['Checklist Opens',this.datetime(t.time_gates?.checklist_opens_at)],['Dispatch Opens',this.datetime(t.time_gates?.dispatch_opens_at)]]);
      timing.append(title,windowInfo);dispatch.append(timing);
    }
    const incidents=append('Incidents & Maintenance',sections.get('Incidents')||'<p>No incident reports recorded.</p>');const incidentButton=actions?.querySelector('[data-tact=incident]');if(incidentButton){incidentButton.textContent='Submit Incident Report';incidents.prepend(incidentButton);}
    const completion=append('Completion & Arrival',sections.get('Completion')||'<p>Trip completion is not recorded.</p>');
    if(!t.completed_at){
      const empty=[...completion.querySelectorAll('p')].find(p=>p.textContent.trim()==='Trip completion is not recorded.');
      if(empty){
        empty.className='ds-trip-completion-pending';
        empty.innerHTML='<i class="bi bi-clipboard2-check" aria-hidden="true"></i><span><strong>Awaiting Trip Completion</strong><small>Complete the trip after delivery and submit the required supporting documents.</small></span>';
      }
    }if(sections.get('Arrival checklist'))completion.append(sections.get('Arrival checklist'));if(+t.awaiting_arrival)completion.insertAdjacentHTML('afterbegin','<p class="small">The delivery is completed, but the vehicle remains held until arrival inspection and any required maintenance clearance.</p>');
    completion.querySelectorAll('dt').forEach(label=>{if(label.textContent==='Billing'){label.nextElementSibling?.remove();label.remove();}});
    append('Documents',sections.get('Documents'));append('Activity Timeline',sections.get('History'));
    this.tripPills(el,t,r,actions,{inspection,arrival,fund});
  },
  tripPills(el,t,r,actions,{inspection,arrival,fund}) {
    const body=el.querySelector('.offcanvas-body'),parts=new Map([...body.querySelectorAll('.ds-detail')].map(d=>[d.querySelector('summary').textContent,d.querySelector('.ds-detail-body')])),readiness=body.querySelector('.ds-trip-overview-readiness'),prefix='ds-trip-'+UI.uuid();
    const preparing=['Pre-Assigned','Ready for Dispatch','For Reschedule'].includes(t.status),inspectionDone=inspection?.completed_at&&+inspection.vehicle_id===+t.vehicle_id&&+inspection.has_not_ok===0;
    const outstandingIncident=r.incidents.some(i=>i.status!=='Resolved');
    const operationSections=preparing?['Pre-Dispatch Checklist','Dispatch & Progress','Incidents & Maintenance']:['Dispatch & Progress','Pre-Dispatch Checklist','Incidents & Maintenance'];
    // Four workflow-based tabs; retain the original content and action nodes.
    const defs=[
      ['Overview',['Trip Overview','Delivery & Shipment','Truck & Personnel','Activity Timeline'],''],
      ['Funds & Documents',['Funds & Fuel','Documents','Pricing'],preparing&&fund?.status!=='Released'&&+t.attempt_number===1?'attention':''],
      ['Trip Operations',operationSections,outstandingIncident?'attention':inspectionDone?'complete':preparing?'attention':''],
      ['Completion & Arrival',['Completion & Arrival'],t.completed_at&&arrival?.completed_at&&+arrival.vehicle_id===+t.vehicle_id&&+arrival.has_not_ok===0&&!+t.awaiting_arrival?'complete':+t.awaiting_arrival?'attention':'']
    ];
    const nav=document.createElement('div');nav.className='ds-trip-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Trip details sections');
    const panels=defs.map(([name,keys,state],index)=>{const panel=document.createElement('section');panel.className='ds-trip-pane';panel.id=prefix+'-pane-'+index;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',prefix+'-tab-'+index);panel.tabIndex=0;panel.hidden=index!==0;
      keys.forEach((key,position)=>{
        const content=parts.get(key);if(!content)return;
        if(keys.length===1){panel.append(content);return;}
        if(position===0){
          const section=document.createElement('section');section.className='ds-trip-primary-section';
          const heading=document.createElement('h3');heading.className='ds-trip-part-title';heading.textContent=key;
          section.append(heading,content);panel.append(section);
        }else{
          const group=document.createElement('details');group.className='ds-trip-subsection';
          const summary=document.createElement('summary');summary.textContent=key;
          group.append(summary,content);panel.append(group);
        }
      });if(index===0&&readiness)panel.prepend(readiness);
      const button=document.createElement('button');button.type='button';button.className='ds-trip-tab';button.id=prefix+'-tab-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-selected',String(index===0));button.tabIndex=index===0?0:-1;button.innerHTML=(state?`<i class="bi ${state==='complete'?'bi-check-circle-fill':'bi-exclamation-triangle-fill'} ds-pill-${state}" aria-hidden="true"></i> `:'')+UI.esc(name);if(state)button.setAttribute('aria-label',name+(state==='complete'?' — recorded completion verified':' — needs attention'));nav.append(button);return panel;
    });
    if(actions)actions.querySelectorAll('[data-tact]').forEach(button=>{
      const act=button.dataset.tact;
      // Completion belongs to the final tab, not the active dispatch stage.
      const index=['fund','dieselpo','printfund'].includes(act)?1
        :['checklist','dispatch','update','resume','reschedule','incident'].includes(act)?2
        :['complete','arrival'].includes(act)?3:0;
      panels[index].prepend(button);
    });
    if(t.status==='Awaiting Resources'||(t.status==='For Reschedule'&&(!t.vehicle_id||t.truck_status!=='Assigned'))){const assign=document.createElement('button');assign.type='button';assign.className='btn btn-primary';assign.dataset.assignResources=t.id;assign.textContent='Assign Resources';assign.onclick=()=>this.assignResources(t.id);panels[0].prepend(assign);}
    body.replaceChildren(nav,...panels);body.querySelectorAll('.wf-steps').forEach(node=>node.remove());
    const footer=document.createElement('div');footer.className='ds-drawer-footer';const close=document.createElement('button');close.type='button';close.className='btn btn-outline-secondary';close.textContent='Close Details';close.onclick=()=>UI.closeDrawer();footer.append(close);el.append(footer);
    const primary=panels.map(panel=>{const button=panel.querySelector('[data-assign-resources],button.btn-primary:not([disabled]),button.btn-success:not([disabled])');if(!button)return null;const marker=document.createComment('contextual trip action');button.before(marker);return {button,marker};});let selected=-1;
    const select=index=>{if(selected>=0&&primary[selected])primary[selected].marker.after(primary[selected].button);selected=index;panels.forEach((panel,i)=>{panel.hidden=i!==index;const tab=nav.children[i];tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});if(primary[index])footer.append(primary[index].button);};
    [...nav.children].forEach((button,index)=>{button.onclick=()=>select(index);button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%panels.length;else if(event.key==='ArrowLeft')next=(index+panels.length-1)%panels.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=panels.length-1;else return;event.preventDefault();select(next);nav.children[next].focus();nav.children[next].scrollIntoView({block:'nearest',inline:'nearest'});};});select(0);
  },
};

(() => {
  // Refine only explicitly marked Dispatcher records; shared role renderers stay intact.
  const drawTable=UI.drawTable;UI.drawTable=function(id){if(DispatcherUI.is()&&UI._tables[id]?.opts.dsRecords)UI._tables[id].limit=10;drawTable(id);if(DispatcherUI.is())DispatcherUI.decorateRecordsTable(id);};
  window.addEventListener('resize',()=>DispatcherUI.activeFilterClose?.());
  document.addEventListener('click',event=>{if(!event.target.closest('[data-ds-filters]'))DispatcherUI.activeFilterClose?.();});
  // Protect Dispatcher modal submissions across confirmation and network awaits.
  const modal=UI.modal;UI.modal=(...args)=>{const element=modal(...args);if(DispatcherUI.is()){const form=element.querySelector('form'),submit=form?.onsubmit;if(submit){let submitting=false;form.onsubmit=async event=>{if(submitting){event.preventDefault();return;}submitting=true;try{await submit.call(form,event);}finally{submitting=false;}};}}return element;};
  const shell=App.shell;
  App.shell=function(){shell.call(this);document.body.classList.toggle('dispatcher-role',DispatcherUI.is());if(!DispatcherUI.is())return;
    const allowed=new Set(this.me.nav.map(n=>n.id));
    const link=(page,label,icon,query={},section='')=>allowed.has(page)?`<a class="nav-item-link" data-nav="${page}" ${section?`data-dispatch-section="${section}"`:''} href="${DispatcherUI.href(page,query)}"><i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></a>`:'';
    // Preserve dispatcher-specific authorized destinations while using the
    // same accessible expandable navigation component as all other roles.
    const navigation=[
      {title:'Trip Management',icon:'bi-signpost-split',items:
        link('trips','Trips','bi-truck',{},'management')
        +link('trips','Incidents','bi-exclamation-triangle',{tab:'incidents'},'incidents')},
      {title:'Fleet & Personnel',icon:'bi-people',items:
        link('crew','Attendance','bi-calendar-check',{view:'attendance'},'attendance')
        +link('trucks','Trucks','bi-truck',{view:'masterlist'},'trucks')
        +link('crew',UI.role('car_carrier_dispatcher')?'Drivers':'Drivers & Helpers','bi-person-badge',{view:'masterlist'},'personnel')},
      {title:'Records & History',icon:'bi-folder2-open',items:
        link('trips','Trip History','bi-clock-history',{tab:'history'},'history')
        +link('documents','Documents','bi-folder2-open')}
    ];
    // Dashboard is a first-level destination; only operational categories expand.
    // The link helper still checks the server-authorized navigation list.
    document.querySelector('.sidebar-nav').innerHTML=
      link('dashboard','Dashboard','bi-grid-1x2')+
      navigation.map(group=>UI.sidebarGroup(group)).join('');
    // Keep the group of the active destination expanded on route changes.
    const activeHash=window.location.hash.split('?')[0].replace(/^#/,'');
    const activeSection=new URLSearchParams(window.location.hash.split('?')[1]||'');
    document.querySelectorAll('.sidebar-nav .head-nav-group').forEach(group=>{
      const selected=[...group.querySelectorAll('[data-nav]')].some(item=>{
        if(item.dataset.nav!==activeHash)return false;
        const destination=new URL(item.href,window.location.href).hash.split('?');
        const params=new URLSearchParams(destination[1]||'');
        return (!params.has('tab')||params.get('tab')===activeSection.get('tab'))
          && (!params.has('view')||params.get('view')===activeSection.get('view'));
      });
      if(selected)group.open=true;
    });
  };
  for(const [page,render] of Object.entries({dashboard:ctx=>DispatcherUI.dashboard(ctx),trips:ctx=>DispatcherUI.trips(ctx),funds:ctx=>App.go('trips',{group:'preparation'}),trucks:ctx=>ctx.query.view==='availability'?DispatcherUI.availability(ctx):DispatcherUI.masterlist(ctx),crew:ctx=>ctx.query.view==='attendance'?DispatcherUI.attendance(ctx):ctx.query.view==='availability'?DispatcherUI.availability(ctx):DispatcherUI.masterlist(ctx),documents:ctx=>DispatcherUI.documents(ctx)})){
    const original=App.pages[page].render;App.pages[page].render=function(ctx){if(!DispatcherUI.is())return original.call(this,ctx);return render({...ctx,setTitle:(title,subtitle)=>{ctx.setTitle(title,subtitle);document.title=title+' · Mulawin FleetOps';const crumbs=document.querySelector('#crumbs');if(crumbs)crumbs.innerHTML='<span class="crumb-page">'+UI.esc(title)+'</span>';}});};
  }
  const open=TripUI.open;TripUI.open=async function(id){if(DispatcherUI.is())try{await DispatcherUI.ensureTrips();}catch(ex){return UI.toast(ex.message,'error');}return open.call(this,id);};
  const drawer=UI.drawer;UI.drawer=(...args)=>{const previous=document.querySelector('.app-drawer');previous?.classList.remove('ds-trip-drawer');previous?.querySelector('.ds-drawer-footer')?.remove();return drawer(...args);};
  const incident=TripUI.incident;TripUI.incident=function(t){if(!DispatcherUI.is())return incident.call(this,t);if(Number(t.responsible_dispatcher_id)!==Number(App.me.user.id)||!['Dispatched','In Transit'].includes(t.status))return UI.toast('This trip is not eligible for an incident report.','error');incident.call(this,t);const modal=[...document.querySelectorAll('.modal')].at(-1);if(modal){modal.querySelector('.modal-title').textContent='Submit Incident Report · '+t.trip_ref;DispatcherUI.groupModal(modal,[['01 — Associated Trip',[],`<p class="small"><b>Associated Trip:</b> ${UI.esc(t.trip_ref)} · <b>Vehicle:</b> ${UI.esc(t.plate_number)}</p>`],['02 — Incident Information',['incident_type','incident_at','location','persons_involved','problem','reason']],['03 — Incident Description and Evidence',['details','photos','attachments']]]);const date=modal.querySelector('[name=incident_at]');if(date)date.value=UI.nowManila();}};
})();
