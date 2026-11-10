/* Dispatcher presentation only. Session roles and existing server actions remain authoritative. */
'use strict';
const DispatcherUI = {
  is: () => UI.isDispatcher(),
  types: () => UI.role('car_carrier_dispatcher') ? ['Car Carrier'] : ['Container','Wing Van'],
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
  status(value) { const color=['Pre-Assigned','Ready for Dispatch'].includes(value)?'green':value==='For Reschedule'?'amber':UI.badgeColor(value);return value?`<span class="badge-s ${color}">${UI.esc(this.labels[value]||value)}</span>`:UI.badge(value); },
  fundStatus(value) { const color=value==='Rejected'?'amber':value==='Ready for Release'?'green':UI.badgeColor(value);return value?`<span class="badge-s ${color}">${UI.esc(value==='Ready for Release'?'Approved — Awaiting Release':value==='Rejected'?'Requires Revision':value)}</span>`:UI.badge(value); },
  matches(t,key) { return !key || key==='awaiting' ? !key || t.status==='Awaiting Resources' : key==='arrival' ? t.status==='Completed'&&!!+t.awaiting_arrival : (this.categories.find(c=>c[0]===key)?.[2]||[]).includes(t.status); },
  panel(title,body,action='') { return `<section class="ds-panel"><div class="ds-panel-head"><h2>${title}</h2>${action}</div><div class="ds-panel-body">${body}</div></section>`; },
  cards(rows,selected='') {
    return `<div class="ds-summary" aria-label="Operational Summary Cards">${this.categories.map(([key,label,,icon,color])=>`<a class="ds-summary-card${selected===key?' selected':''}" href="${this.href('trips',{group:key})}" ${selected===key?'aria-current="page"':''}><span class="ds-card-icon ${color}"><i class="bi ${icon}" aria-hidden="true"></i></span><span class="ds-card-copy"><strong>${Array.isArray(rows)?rows.filter(t=>this.matches(t,key)).length:'—'}</strong><span>${label}</span></span></a>`).join('')}</div>`;
  },
  section(title,body) { return `<fieldset class="ds-form-section"><legend>${UI.esc(title)}</legend>${body}</fieldset>`; },
  options(rows,key,label=key) { return [...new Map((rows||[]).filter(r=>r[key]!=null&&r[key]!=='').map(r=>[String(r[key]),[r[key],r[label]||r[key]]])).values()]; },
  contains(row,keys,text) { return keys.map(k=>row[k]??'').join(' ').toLowerCase().includes((text||'').trim().toLowerCase()); },
  // Search and committed filters live in the URL. Opening details never changes this context.
  filters(ctx,fields,{searchKey='search',placeholder='Search records…',values=ctx.query}={}) {
    const id='ds-filters-'+UI.uuid(),count=fields.filter(f=>String(values[f.name]??f.default??'')!==String(f.default??'')).length;
    return `<div class="ds-filterbar" data-ds-filters><form class="ds-search-bar" role="search"><label class="visually-hidden" for="${id}-search">Search records</label><div class="ds-search-input"><i class="bi bi-search" aria-hidden="true"></i><input id="${id}-search" class="form-control" name="q" type="search" maxlength="200" placeholder="${UI.esc(placeholder)}" value="${UI.esc(values[searchKey]||'')}"></div><button class="btn btn-primary" type="submit"><i class="bi bi-search" aria-hidden="true"></i> Search</button></form><button type="button" class="btn btn-outline-success ds-filter-toggle" aria-expanded="false" aria-controls="${id}"><i class="bi bi-funnel" aria-hidden="true"></i> Filters${count?` <span class="ds-filter-count" aria-label="${count} active filters">${count}</span>`:''}</button><div class="ds-filter-panel" id="${id}" role="dialog" tabindex="-1" aria-label="Filter Records" hidden><div class="ds-filter-heading"><h2>Filter Records</h2><button type="button" class="btn-close" data-filter-close aria-label="Close filters"></button></div><form data-filter-form>${UI.fields(fields.map(f=>({...f,col:12,value:values[f.name]??f.default??''})))}<div class="ds-filter-actions"><button class="btn btn-outline-secondary" type="button" data-filter-clear>Clear Filters</button><button class="btn btn-primary" type="submit">Apply Filters</button></div></form></div></div>`;
  },
  bindFilters(ctx,fields,{base={},searchKey='search',values=ctx.query}={}) {
    const bar=ctx.el.querySelector('[data-ds-filters]');if(!bar)return;
    const toggle=bar.querySelector('.ds-filter-toggle'),panel=bar.querySelector('.ds-filter-panel'),form=panel.querySelector('form'),search=bar.querySelector('input[type=search]');
    const close=(restore=false)=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');if(restore)toggle.focus();};
    const navigate=(filters,text=search.value.trim())=>{close(true);App.go(ctx.page,{...base,...Object.fromEntries(Object.entries({...filters,[searchKey]:text}).filter(([,v])=>v!==''&&v!=null))});};
    const committed=()=>Object.fromEntries(fields.map(f=>[f.name,values[f.name]??f.default??'']));
    toggle.onclick=()=>{if(!panel.hidden){close(true);return;}const state=committed();fields.forEach(f=>form.elements[f.name].value=state[f.name]);form.querySelectorAll('input').forEach(el=>el.setCustomValidity(''));panel.removeAttribute('style');panel.hidden=false;toggle.setAttribute('aria-expanded','true');if(innerWidth>600){panel.style.top='calc(100% + 6px)';panel.style.bottom='auto';const below=innerHeight-panel.getBoundingClientRect().top-16;if(below<240&&bar.getBoundingClientRect().top>240){panel.style.top='auto';panel.style.bottom='calc(100% + 6px)';panel.style.maxHeight=Math.min(620,bar.getBoundingClientRect().top-16)+'px';}else panel.style.maxHeight=Math.max(120,Math.min(620,below))+'px';}panel.focus();};
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
    if(t.status==='Awaiting Resources')return ['Assign Resources','assign'];
    if(['Pre-Assigned','Ready for Dispatch'].includes(t.status))return ['Manage','manage'];
    if(t.status==='On Hold - Incident Reported'&&t.incident_status==='Repaired - Cleared to Continue')return ['Manage','manage'];
    if(t.status==='For Reschedule'&&(!t.vehicle_id||t.truck_status==='Assigned'))return ['Manage','manage'];
    return ['View Details','view'];
  },
  async assignResources(id) {
    let d;try{d=await App.api('Trips.dispatcher_resources',{trip_id:id});}catch(ex){return UI.toast(ex.message,'error');}
    if(!d.drivers?.length)return UI.toast('No timed-in regular driver has an available linked truck. Check Attendance and the master records.','warn');
    const cc=d.trip.truck_type==='Car Carrier';
    const modal=UI.modal('Assign Resources · '+UI.esc(d.trip.trip_ref),UI.fields([
      {name:'driver_id',label:cc?'Driver 1':'Regular Driver',type:'select',required:true,col:6,options:d.drivers.map(r=>[r.id,r.name])},
      {name:'truck_display',label:'Permanently Assigned Truck',col:6,attrs:'readonly aria-readonly="true"',help:'The truck follows the selected regular driver.'},
      {name:cc?'driver2_id':'helper_id',label:cc?'Driver 2':'Helper',type:'select',required:true,col:12,options:(cc?d.second_drivers:d.helpers).map(r=>[r.id,r.name])},
    ]),async values=>{const driver=d.drivers.find(r=>String(r.id)===values.driver_id);if(!driver)throw new Error('Select an eligible regular driver.');const result=await App.api('Trips.assign_resources',{trip_id:d.trip.id,driver_id:driver.id,vehicle_id:driver.vehicle_id,...(cc?{driver2_id:values.driver2_id}:{helper_id:values.helper_id})});UI.result(result);UI.closeDrawer();App.route();},{submit:'Assign Resources',onShow:(wrap,form)=>{
      const pick=form.querySelector('[name=driver_id]'),secondary=form.querySelector(`[name=${cc?'driver2_id':'helper_id'}]`);
      pick.onchange=()=>{const driver=d.drivers.find(r=>String(r.id)===pick.value);form.querySelector('[name=truck_display]').value=driver?.plate_number||'';secondary.querySelectorAll('option').forEach(o=>o.disabled=cc&&o.value===pick.value);if(cc&&secondary.value===pick.value)secondary.value='';if(!cc&&driver)secondary.value=d.helpers.some(r=>r.id===driver.regular_helper_id)?driver.regular_helper_id:'';};
    }});return modal;
  },
  async ensureTrips() {
    const identity=App.me.user.id+':'+App.me.user.role;
    if (this.tripIdentity!==identity || !TripUI.data?.checklist || !TripUI.data?.active) { TripUI.data=await App.data('trips'); this.tripIdentity=identity; }
    return TripUI.data;
  },
  dashboard(ctx) {
    this.tripIdentity='';
    ctx.setTitle('Dashboard', UI.role('car_carrier_dispatcher')?'Car Carrier dispatch preparation and operational priorities.':'Container and Wing Van dispatch preparation and operational priorities.');
    UI.tool(ctx,'Refresh',()=>ctx.reload(),'bi-arrow-clockwise','outline-secondary');
    const rows=ctx.data.active;
    const actionable=Array.isArray(rows)?rows.filter(t=>t.status!=='Pending Review'):null;
    const count=fn=>Array.isArray(rows)?rows.filter(fn).length:null;
    const queues=[
      ['Incidents Requiring Coordination',ctx.data.incidentCount?.count,this.href('trips',{tab:'incidents',incident:'open'})],
      ['Resource Assignments Pending',count(t=>t.status==='Awaiting Resources'),this.href('trips',{group:'awaiting'})],
      ['Pre-Dispatch Checklists Required',count(t=>t.status==='Pre-Assigned'),this.href('trips',{group:'preparation'})],
      ['Trip Fund Requests Requiring Follow-Up',count(t=>['Pre-Assigned','Ready for Dispatch'].includes(t.status)&&(['Pending Approval','Ready for Release','Rejected'].includes(t.fund_status)||(!t.fund_status&&+t.attempt_number===1))),this.href('funds',{queue:'followup'})],
      ['Trips Requiring Rescheduling',count(t=>t.status==='For Reschedule'),this.href('trips',{group:'reschedule'})],
      ['Pending Arrival Inspections',count(t=>t.status==='Completed'&&+t.awaiting_arrival),this.href('trips',{group:'arrival'})],
      ['Current-Shift Attendance Pending',ctx.data.attendanceWork?.not_timed_in,this.href('crew',{view:'attendance'})],
    ];
    ctx.el.innerHTML=`<section class="ds-summary-section" aria-label="Operational Summary">${this.cards(rows)}</section>`+
      this.panel('Scheduled and Active Trips',actionable?'<div class="ds-dashboard-trips">'+this.tripTable(actionable.slice(0,6))+'</div>':'<p role="alert">Trip records unavailable. Refresh to try again.</p>','<a href="#trips">View All Trips</a>')+
      this.panel('Pending Operational Actions',`<div class="ds-action-queue">${queues.filter(([,n])=>n==null||+n>0).map(([label,n,href])=>`<a href="${href}"${label==='Incidents Requiring Coordination'?' class="ds-urgent"':''}><span>${label}</span><b>${n==null?'Unavailable':UI.num(n)}</b><i class="bi bi-chevron-right" aria-hidden="true"></i></a>`).join('')||'<p class="text-muted mb-0">No pending operational actions.</p>'}</div>`);
    this.bindTrips(ctx.el);
  },
  tripTable(rows,history=false) {
    return `<div class="table-responsive"><table class="data-table ds-trip-table${rows.length?'':' ds-is-empty'}"><thead><tr><th>Trip / Client</th><th>Truck / Route</th><th>${history?'Completion / Schedule':'Scheduled Dispatch (PHT)'}</th><th>Operational Status</th><th>${history?'Arrival Inspection':'Next Action'}</th><th>Action</th></tr></thead><tbody>${rows.map(t=>`<tr><td data-label="Trip / Client"><b>${UI.esc(t.trip_ref)}</b><div>${UI.esc(t.client)}</div></td><td data-label="Truck / Route">${UI.esc(t.plate_number||'Assignment pending')} · ${UI.esc(t.truck_type||'Type pending')}<div class="cell-sub">${UI.esc(t.pickup_point)} → ${UI.esc(t.delivery_point)}</div></td><td data-label="Schedule">${history&&t.completed_at?this.datetime(t.completed_at)+'<div class="cell-sub">Scheduled: '+this.datetime(t.scheduled_at)+'</div>':this.datetime(t.scheduled_at)}</td><td data-label="Operational Status">${this.status(t.status)}</td><td data-label="${history?'Arrival Inspection':'Next Action'}">${history?(+t.awaiting_arrival?'Pending Arrival Inspection':t.status==='Completed'?'See recorded inspection':'Not applicable'):UI.esc(this.next(t))}</td><td data-label="Action"><button type="button" class="btn btn-sm btn-outline-success" data-ds-trip="${+t.id}" data-ds-action="${history?'view':this.tripAction(t)[1]}">${history?'View Details':this.tripAction(t)[0]}</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="ds-empty-state" role="status"><i class="bi bi-search" aria-hidden="true"></i><b>No trips match these filters.</b><span>Try another search or clear filters to see more trips.</span></div></td></tr>'}</tbody></table></div>`;
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
    if(q.batch)return TripUI.newPage(ctx); // Existing authorized batch request workflow remains reachable.
    if(q.tab==='incidents'||q.view==='incidents')return this.incidents(ctx);
    const history=q.tab==='history';
    ctx.setTitle(history?'Trip History':'Trip Management',history?'Review completed, cancelled, and rejected trip records.':'Prepare, dispatch, and monitor authorized trips.');
    const rows=ctx.data[history?'history':'active'];
    const fields=[
      ...(!history?[{name:'group',label:'Operational Queue',type:'select',placeholder:'All operational queues',options:[...this.categories.map(c=>[c[0],c[1]]),['awaiting','Awaiting Resources']]}]:[]),
      {name:'status',label:'Trip Status',type:'select',placeholder:'All statuses',options:(history?['Completed','Cancelled','Rejected']:(ctx.data.statuses||[]).filter(s=>!['Pending Review','Cancelled','Rejected'].includes(s))).map(s=>[s,['Dispatched','In Transit'].includes(s)?this.labels[s]+' — '+s:this.labels[s]||s])},
      {name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())},
      {name:'client_id',label:'Client',type:'select',placeholder:'All clients',options:UI.opts(ctx.data.filterOptions?.clients||[],c=>c.company_name)},
      {name:'from',label:'Schedule From',type:'date'},{name:'to',label:'Schedule To',type:'date'},
    ],opts={base:history?{tab:'history'}:{},values:{...q,search:q.search||q.q||''}};
    ctx.el.innerHTML=this.filters(ctx,fields,{...opts,placeholder:'Search trip, client, route, or truck…'})+'<section class="ds-records" aria-label="Trip records" data-trip-records></section>';
    this.bindFilters(ctx,fields,opts);
    const box=ctx.el.querySelector('[data-trip-records]');
    if(!Array.isArray(rows)){box.innerHTML='<p role="alert">Trip records unavailable.</p>';return;}
    const search=(q.search||q.q||'').trim().toLowerCase();
    const filtered=rows.filter(t=>(history||t.status!=='Pending Review')&&(history||this.matches(t,q.group))&&(!q.status||t.status===q.status)&&(!q.truck_type||t.truck_type===q.truck_type)&&(!q.client_id||String(t.client_id)===String(q.client_id))&&(!q.from||String(t.scheduled_at).slice(0,10)>=q.from)&&(!q.to||String(t.scheduled_at).slice(0,10)<=q.to)&&[t.trip_ref,t.client,t.pickup_point,t.delivery_point,t.plate_number].join(' ').toLowerCase().includes(search));
    let page=0;const pageSize=10;const draw=()=>{const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);box.innerHTML=`<div class="ds-record-controls"><span>${filtered.length} record(s)</span></div>`+this.tripTable(filtered.slice(page*pageSize,(page+1)*pageSize),history)+`<div class="ds-pagination"><span>${filtered.length?`${page*pageSize+1}–${Math.min((page+1)*pageSize,filtered.length)}`:'0'} of ${filtered.length} · Page ${page+1} of ${pages}${history?' · Up to 1,000 records loaded':''}</span><nav aria-label="Trip record pages"><button type="button" class="btn btn-sm btn-outline-secondary" data-prev ${page?'':'disabled'}>Previous</button> <button type="button" class="btn btn-sm btn-outline-secondary" data-next ${page<pages-1?'':'disabled'}>Next</button></nav></div>`;box.querySelector('[data-prev]').onclick=()=>{page--;draw();};box.querySelector('[data-next]').onclick=()=>{page++;draw();};this.bindTrips(box);};draw();
    if(q.open)TripUI.open(UI.takeQuery(ctx,'open').open);
  },
  requests(ctx) {
    ctx.setTitle('Trip Requests','Submit and monitor dispatcher trip requests and recorded review decisions.');
    UI.tool(ctx,'New Trip Request',()=>App.go('trips',{view:'new-request'}),'bi-plus-lg','primary');
    const a=ctx.data.approval;
    if(!a){ctx.el.innerHTML='<p role="alert">Request records unavailable.</p>';return;}
    const fields=[{name:'approval',label:'Request Status',type:'select',placeholder:false,default:'pending',options:[['pending','Pending Review'],['approved','Approved Requests'],['rejected','Rejected Requests']]},
      {name:'client_id',label:'Client',type:'select',placeholder:'All clients',options:UI.opts(ctx.data.filterOptions?.clients||[],c=>c.company_name)},
      {name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())},
      {name:'requester_id',label:'Requested By',type:'select',placeholder:'All requesters',options:UI.opts(ctx.data.filterOptions?.requesters||[],r=>r.full_name)},
      {name:'request_from',label:'Request Date From',type:'date'},{name:'request_to',label:'Request Date To',type:'date'}],opts={base:{view:'requests'},searchKey:'q',values:{...ctx.query,approval:a.category}};
    ctx.el.innerHTML=this.filters(ctx,fields,{...opts,placeholder:'Search request, client, route, or requester…'})+`<section class="ds-records" aria-label="Trip request records"><div class="ds-record-controls"><span>${UI.esc({pending:'Pending Review',approved:'Approved Requests',rejected:'Rejected Requests'}[a.category])} · ${UI.num(a.total)} request(s)</span></div><div data-requests></div><div class="ds-pagination"><span>${a.total?`${(a.page-1)*(a.pageSize||10)+1}–${Math.min(a.page*(a.pageSize||10),a.total)}`:'0'} of ${a.total} · Page ${a.page} of ${a.pages}</span><nav aria-label="Request pages"><button type="button" class="btn btn-sm btn-outline-secondary" data-prev ${a.page>1?'':'disabled'}>Previous</button> <button type="button" class="btn btn-sm btn-outline-secondary" data-next ${a.page<a.pages?'':'disabled'}>Next</button></nav></div></section>${a.counts.unclassified?'<p class="small text-muted">Some historical requests have no recorded approval/rejection evidence and are excluded from these categories.</p>':''}`;
    const box=ctx.el.querySelector('[data-requests]');box.innerHTML=UI.table([['Trip / Client','trip_ref',(v,t)=>`<b>${UI.esc(v)}</b><div>${UI.esc(t.client)}</div>`],['Route / Type','pickup_point',(v,t)=>`${UI.esc(v)} → ${UI.esc(t.delivery_point)}<div>${UI.esc(t.truck_type)}</div>`],['Scheduled Dispatch','scheduled_at',v=>this.datetime(v)],['Request Date','created_at',v=>this.datetime(v)],['Review Status','approval_category',v=>UI.badge({pending:'Pending Review',approved:'Approved',rejected:'Rejected'}[v])]],a.rows,{plain:true,limit:10,actions:()=>UI.btn('view','View Details'),onAction:(action,t)=>TripUI.open(t.id),empty:'No requests match.'});this.activateRecords(box,{serverPaged:true});
    this.bindFilters(ctx,fields,opts);
    ctx.el.querySelector('[data-prev]').onclick=()=>App.go('trips',{...ctx.query,approval_page:a.page-1});ctx.el.querySelector('[data-next]').onclick=()=>App.go('trips',{...ctx.query,approval_page:a.page+1});
  },
  newRequest(ctx) {
    TripUI.data=ctx.data;
    this.tripIdentity=App.me.user.id+':'+App.me.user.role;
    ctx.setTitle('New Trip Request','Submit an authorized trip request for Operations Head review.');
    const fields=Object.fromEntries(TripUI.deliveryFields({}, {withClient:true,needsKm:false}).filter(f=>f.name).map(f=>[f.name,f]));
    const order=['client_id','truck_type','client_route_id','scheduled_at','consignee','booking_reference','units_planned','container_number','container_size','seal_number','shipment_number','delivery_details'];
    order.forEach(name=>fields[name].col=['client_route_id','delivery_details'].includes(name)?12:6);
    fields.client_id.col=6;fields.truck_type.col=6;fields.truck_type.required=true;fields.truck_type.value=this.types().length===1?this.types()[0]:'';
    fields.truck_type.help='Only truck types authorized for your account are available.';
    fields.client_route_id.label='Approved Client Route';fields.client_route_id.required=true;fields.client_route_id.placeholder='Choose a client and truck type first';fields.client_route_id.help='Routes are specific to the selected client and truck type.';fields.client_route_id.col=12;
    fields.scheduled_at.col=6;fields.delivery_details.col=12;
    fields.scheduled_at.label='Scheduled Dispatch Date and Time (PHT)';fields.delivery_details.label='Delivery Instructions';
    ctx.el.innerHTML=this.panel('New Trip Request',`<form class="ds-request-form" novalidate><p class="ds-form-intro">Choose a client and an approved route, then enter the dispatch schedule and shipment details. <span class="ds-required">*</span> Required fields.</p><div class="alert alert-danger" data-request-error role="alert" hidden></div>${this.section('01 — Client and Trip Information',UI.fields(order.slice(0,3).map(name=>fields[name]))+'<p class="form-help mb-0" data-route-message role="status"></p>')}${this.section('02 — Dispatch Schedule and Delivery',UI.fields(order.slice(3,-1).map(name=>fields[name])))}${this.section('03 — Additional Instructions',UI.fields([fields.delivery_details]))}<div class="ds-form-footer"><a class="btn btn-outline-secondary" href="#trips?view=requests">Cancel</a><button class="btn btn-primary" type="submit">Submit Trip Request</button></div><div data-request-result role="status"></div></form>`);
    const form=ctx.el.querySelector('form'),pick=form.querySelector('[name=client_route_id]'),note=form.querySelector('[data-route-message]'),error=form.querySelector('[data-request-error]');
    let routes=[],seq=0,busy=false,uncertain=false,completed=false;
    const keyName=`fleetops:dispatcher-request:${App.me.user.id}`;let key=UI.uuid(),frozen=null;
    const save=()=>{try{sessionStorage.setItem(keyName,JSON.stringify({key,payload:frozen}));}catch{}};
    const setError=text=>{error.textContent=text;error.hidden=!text;};
    const toggleFields=()=>{const type=form.querySelector('[name=truck_type]').value;[['units_planned',type==='Car Carrier'],['container_number',type==='Container'],['container_size',type==='Container'],['seal_number',type==='Container'],['shipment_number',type!=='Car Carrier']].forEach(([name,on])=>{const el=form.querySelector(`[name=${name}]`);el.closest('[class*=col-]').hidden=!on;el.disabled=!on;});};
    const load=async()=>{const n=++seq;routes=[];pick.value='';pick.innerHTML='<option value="">Loading approved routes…</option>';pick.disabled=true;toggleFields();const client=form.querySelector('[name=client_id]').value,type=form.querySelector('[name=truck_type]').value;if(!client||!type){pick.innerHTML='<option value="">Choose a client and truck type</option>';return;}try{const r=await App.api('Routes.selectable',{client_id:client,truck_type:type});if(n!==seq)return;routes=r.routes||[];pick.innerHTML='<option value="">Choose an approved route</option>'+routes.map(r=>`<option value="${+r.id}">${UI.esc(r.route_ref+' · '+r.origin_label+' → '+r.destination_label)}</option>`).join('');note.textContent=routes.length?'':'No approved route is available for this client and truck type.';}catch(ex){if(n===seq)note.textContent=ex.message;}finally{if(n===seq)pick.disabled=false;}};
    ['client_id','truck_type'].forEach(n=>form.querySelector(`[name=${n}]`).onchange=load);toggleFields();pick.disabled=true;
    const lock=()=>{form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=el.hasAttribute('data-created-trip')?false:busy||uncertain||completed);if(!busy&&!uncertain&&!completed)toggleFields();form.querySelector('button[type=submit]').disabled=busy||completed;};
    try{const cached=JSON.parse(sessionStorage.getItem(keyName)||'null');if(cached?.key&&cached.payload){key=cached.key;frozen=cached.payload;uncertain=true;Object.entries(frozen).forEach(([name,value])=>{const input=form.querySelector(`[name="${CSS.escape(name)}"]`);if(input)input.value=value??'';});pick.innerHTML=`<option value="${UI.esc(frozen.client_route_id)}">${UI.esc(frozen.pickup_point)} → ${UI.esc(frozen.delivery_point)} (previous selection)</option>`;pick.value=frozen.client_route_id;toggleFields();form.querySelector('button[type=submit]').textContent='Retry Original Request';note.textContent='A previous submission has an uncertain result. Retry to check the recorded result before sending again.';lock();}}catch{}
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||completed)return;setError('');
      if(!uncertain){const invalid=[...form.querySelectorAll('[name]')].find(el=>!el.disabled&&!el.closest('[hidden]')&&!el.checkValidity());if(invalid){invalid.reportValidity();return;}const route=routes.find(r=>String(r.id)===pick.value);if(!route)return setError('Select an approved client route.');const d=UI.formData(form);frozen={...d,request_key:key,pickup_point:route.origin_label,delivery_point:route.destination_label,distance_km:route.distance_km,pickup_lat:route.origin_lat,pickup_lng:route.origin_lng,delivery_lat:route.destination_lat,delivery_lng:route.destination_lng};}
      const wasUncertain=uncertain;busy=true;save();lock();try{let r;if(uncertain){const saved=(await App.data('trips',{view:'request-result',request_key:key})).submission;if(saved)r={...saved,message:`Request ${saved.trip_ref} was already created. Current trip status: ${saved.status}.`};}r ||= await App.api('Trips.create',frozen);completed=true;uncertain=false;try{sessionStorage.removeItem(keyName);}catch{}form.querySelector('[data-request-result]').textContent=r.message;form.querySelector('[data-request-result]').insertAdjacentHTML('beforeend',` <button type="button" class="btn btn-link" data-created-trip="${+r.trip_id}">View Request</button>`);form.querySelector('[data-created-trip]').onclick=()=>TripUI.open(r.trip_id);}catch(ex){uncertain=wasUncertain||!ex.status||ex.status>=500;if(!uncertain)try{sessionStorage.removeItem(keyName);}catch{}setError(ex.message+(uncertain?' Retry with the same request key.':''));}finally{busy=false;lock();}
    };
  },

  funds(ctx) {
    ctx.setTitle('Trip Funds & Fuel','Track cash trip funds and authorized Diesel PO documents.');
    const d=ctx.data, diesel=ctx.query.tab==='diesel';
    ctx.el.innerHTML=`<nav class="ds-tabs" aria-label="Trip Funds and Fuel tabs"><a href="#funds" ${diesel?'':'class="active" aria-current="page"'}>Trip Fund Requests</a><a href="#funds?tab=diesel" ${diesel?'class="active" aria-current="page"':''}>Diesel PO Requests</a></nav><div data-fund-workspace></div>`;
    const box=ctx.el.querySelector('[data-fund-workspace]');
    if(diesel){
      const fields=[{name:'document_status',label:'Document Status',type:'select',placeholder:'All document statuses',options:[['attached','Document Attached'],['missing','No Document Attached']]},{name:'trip_id',label:'Associated Trip',type:'select',placeholder:'All trips',options:UI.opts(d.fuelTrips||[],t=>t.trip_ref)},{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{tab:'diesel'}};
      box.innerHTML='<p id="diesel-workflow-gap" class="alert alert-info">Diesel PO request submission, approval, and issuance are not available in the current system. You can attach and view existing Diesel PO documents linked to your authorized trips below.</p>'+this.filters(ctx,fields,{...opts,placeholder:'Search trip or truck…'})+'<div data-diesel-table></div>';
      if(!Array.isArray(d.fuelTrips)||!Array.isArray(d.dieselDocuments)){box.insertAdjacentHTML('beforeend','<p role="alert">Diesel PO document records unavailable.</p>');return;}
      const q=ctx.query,filter=q.document_status,rows=d.fuelTrips.filter(t=>(!filter||(filter==='attached'?+t.diesel_po_docs>0:!+t.diesel_po_docs))&&(!q.trip_id||String(t.id)===q.trip_id)&&(!q.truck_type||t.truck_type===q.truck_type)&&this.contains(t,['trip_ref','plate_number','truck_type'],q.search));const table=box.querySelector('[data-diesel-table]');table.innerHTML=UI.table([['Trip','trip_ref'],['Truck','plate_number'],['Truck Type','truck_type'],['Trip Status','status',v=>this.status(v)],['Document Status','diesel_po_docs',v=>UI.esc(+v?'Document Attached ('+v+')':'No Document Attached')]],rows,{showAllColumns:true,actions:()=>UI.btn('details','View Details'),onAction:(a,t)=>this.openDiesel(t,d),empty:'No authorized trip documents match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);return;
    }
    const fields=[{name:'status',label:'Request Status',type:'select',placeholder:'All requests / request history',options:[['Pending Approval','Pending Approval'],['Ready for Release','Approved — Awaiting Release'],['Released','Released'],['Rejected','Requires Revision'],['followup','Requires Follow-Up']]},{name:'from',label:'Request Date From',type:'date'},{name:'to',label:'Request Date To',type:'date'}],opts={values:{...ctx.query,status:ctx.query.status||(ctx.query.queue==='followup'?'followup':'')}};
    box.innerHTML=this.filters(ctx,fields,{...opts,placeholder:'Search fund reference, trip, or expense…'})+'<div data-funds-table></div>';
    if(!Array.isArray(d.funds)){box.insertAdjacentHTML('beforeend','<p role="alert">Fund requests unavailable.</p>');return;}
    const q=opts.values,status=q.status,rows=d.funds.filter(f=>(!status||(status==='followup'?['Pending Approval','Ready for Release','Rejected'].includes(f.status)&&!['Completed','Cancelled','Rejected'].includes(f.trip_status):f.status===status))&&(!q.from||String(f.created_at).slice(0,10)>=q.from)&&(!q.to||String(f.created_at).slice(0,10)<=q.to)&&this.contains(f,['fund_ref','trip_ref','breakdown','requested_by_name'],q.search));const table=box.querySelector('[data-funds-table]');table.innerHTML=UI.table([['Request / Trip','fund_ref',(v,f)=>`<b>${UI.esc(v)}</b><div>${UI.esc(f.trip_ref)}</div>`],['Expense Categories','breakdown'],['Requested Amount','amount','money'],['Status','status',v=>this.fundStatus(v)],['Request Date','created_at',v=>this.datetime(v)],['Requested By','requested_by_name']],rows,{showAllColumns:true,actions:()=>UI.btn('view','View Details'),onAction:(a,f)=>this.openFund(f.id,d),empty:'No fund requests match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);
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
    UI.fundForm({title:old?'Revise Trip Fund Request':'Submit Fund Request',categories,action:'Funds.submit',payload:{trip_id:t.id},selected:old?old.lines.filter(l=>+l.is_preset).map(l=>l.category_name):[],extra:old?old.lines.filter(l=>!+l.is_preset).map(l=>({name:l.category_name,amount:l.amount})):[],notes:old?.notes||'',intro:`${UI.esc(t.trip_ref)}. Select applicable preset categories; configured amounts are fixed. Custom expenses use their own amounts. Review the breakdown and total before submitting.`,after:()=>{UI.closeDrawer();App.route();}});
    const modal=[...document.querySelectorAll('.modal')].at(-1),form=modal?.querySelector('form');
    if(form){
      modal.classList.add('ds-structured-modal');const body=modal.querySelector('.modal-body'),cats=[...form.querySelectorAll('.fund-cat')].map(c=>c.closest('label')),extras=[...form.querySelectorAll('.fund-extra')],notes=form.querySelector('[name=notes]'),notesBox=notes.parentElement,total=form.querySelector('#fundTotal'),totalBox=total.parentElement;
      body.querySelector('p')?.remove();body.querySelectorAll('h6').forEach(h=>h.remove());
      const sections=['01 — Associated Trip','02 — Preset Expense Categories','03 — Additional Expenses','04 — Request Summary'].map(title=>{const el=document.createElement('fieldset');el.className='ds-form-section';el.innerHTML=`<legend>${title}</legend>`;body.insertBefore(el,body.querySelector('.form-error'));return el;});
      sections[0].innerHTML+=UI.kv([['Eligible Trip',UI.e(t.trip_ref)],['Truck',UI.e(t.plate_number||'Assignment pending')],...(t.client?[['Client',UI.e(t.client)]]:[])]);
      sections[1].insertAdjacentHTML('beforeend','<p class="form-help">Select applicable categories. Configured amounts are fixed.</p>');cats.forEach(el=>sections[1].append(el));if(!cats.length)sections[1].insertAdjacentHTML('beforeend','<p>No preset categories are available.</p>');
      sections[2].insertAdjacentHTML('beforeend','<p class="form-help">Optional expenses need a unique name and a positive amount.</p>');extras.forEach((row,index)=>{row.querySelectorAll('input').forEach((input,i)=>{input.id='ds-extra-'+UI.uuid();input.name=(i?'extra_amount_':'extra_name_')+index;const label=document.createElement('label');label.className='form-label';label.htmlFor=input.id;label.textContent=(i?'Requested Amount':'Custom Expense Name')+' '+(index+1);input.before(label);});sections[2].append(row);});
      notes.id='ds-notes-'+UI.uuid();notesBox.querySelector('label').htmlFor=notes.id;const breakdown=document.createElement('ul');breakdown.className='ds-fund-breakdown';breakdown.setAttribute('aria-label','Selected expenses');sections[3].append(breakdown,notesBox,totalBox);totalBox.classList.add('ds-fund-total');total.setAttribute('aria-live','polite');
      const summary=()=>{const lines=[...form.querySelectorAll('.fund-cat:checked')].map(c=>[c.dataset.name,c.dataset.amount]);extras.forEach(row=>{const [name,amount]=row.querySelectorAll('input');if(name.value.trim()&&+amount.value>0)lines.push([name.value.trim(),amount.value]);});breakdown.innerHTML=lines.map(([name,amount])=>`<li><span>${UI.esc(name)}</span><b>${UI.money(amount)}</b></li>`).join('')||'<li>No expenses selected.</li>';};form.addEventListener('input',summary);form.addEventListener('change',summary);summary();
    }
    if(form){form.querySelectorAll('.fund-extra input').forEach(input=>input.addEventListener('input',()=>input.setCustomValidity('')));form.addEventListener('submit',event=>{
      const names=new Set((categories||[]).map(c=>c.name.trim().toLowerCase()));let invalid=null;
      form.querySelectorAll('.fund-extra').forEach(row=>{const [name,amount]=row.querySelectorAll('input');name.setCustomValidity('');amount.setCustomValidity('');if(!name.value.trim()&&!amount.value)return;const normalized=name.value.trim().toLowerCase();if(!normalized||names.has(normalized)){name.setCustomValidity('Use a unique custom expense name; preset categories use their configured amount.');invalid ||= name;}names.add(normalized);if(!/^\d+(?:\.\d{1,2})?$/.test(amount.value)||+amount.value<=0){amount.setCustomValidity('Enter a positive custom amount with at most two decimals.');invalid ||= amount;}});
      if(invalid){event.preventDefault();event.stopImmediatePropagation();invalid.reportValidity();}
    },true);}
  },
  async openFund(id,d) {
    let f;try{f=(await App.api('Funds.details',{fund_id:id})).fund;}catch(ex){return UI.toast(ex.message,'error');}
    const el=UI.drawer(UI.esc(f.fund_ref),this.panel('Trip Fund Request',UI.kv([['Trip',UI.e(f.trip_ref)],['Requested By',UI.e(f.requested_by_name)],['Requested Amount',UI.money(f.amount)],['Status',this.fundStatus(f.status)],['Approved By',UI.e(f.approved_by_name)],['Finance Release',f.status==='Released'?'Released':f.status==='Ready for Release'?'Awaiting Finance release':'Not released'],['Remarks',UI.e(f.notes)],f.rejected_reason?['Reason for Revision',UI.e(f.rejected_reason)]:null]))+this.panel('Expense Breakdown',UI.table([['Category','category_name'],['Amount','amount','money']],f.lines,{plain:true}))+'<div class="ds-form-footer"><button class="btn btn-outline-success" data-ds-trip="'+(+f.trip_id)+'">View Related Trip</button>'+((f.status==='Rejected'&&['Pre-Assigned','Ready for Dispatch'].includes(f.trip_status)&&f.dispatcher_role===App.me.user.role)?'<button class="btn btn-primary" data-revise-fund>Revise Request</button>':'')+'</div>',{subtitle:UI.esc(f.trip_ref)});
    this.bindTrips(el);el.querySelector('[data-revise-fund]')?.addEventListener('click',()=>this.fundForm({id:f.trip_id,trip_ref:f.trip_ref},d.categories,f));
  },
  async openDiesel(t,d) {
    let docs=d.dieselDocuments.filter(doc=>+doc.trip_id===+t.id);
    if(+t.diesel_po_docs>docs.length)try{docs=(await App.api('Trips.details',{trip_id:t.id})).documents.filter(doc=>doc.category==='Diesel PO');}catch(ex){return UI.toast(ex.message,'error');}
    const canAttach=t.dispatcher_role===App.me.user.role&&['Pre-Assigned','Ready for Dispatch','Dispatched','On Hold - Incident Reported','In Transit','For Reschedule','Completed'].includes(t.status);
    const el=UI.drawer('Diesel PO Documents',this.panel('Linked Trip',UI.kv([['Trip',UI.e(t.trip_ref)],['Truck',UI.e(t.plate_number)],['Type',UI.e(t.truck_type)],['Operational Status',this.status(t.status)]]))+UI.docs(docs)+'<p class="small text-muted mt-3">Documents are existing attachments. No request approval or PO issuance status is implied.</p>'+(canAttach?'<button class="btn btn-primary" data-attach-diesel>Attach Diesel PO Document</button>':''),{subtitle:UI.esc(t.trip_ref)});
    el.querySelector('[data-attach-diesel]')?.addEventListener('click',()=>{const modal=UI.formModalFiles('Attach Diesel PO Document',[{name:'diesel_po',label:'Diesel PO Document',type:'file',multiple:true,required:true,col:12,attrs:'accept="application/pdf,image/jpeg,image/png,image/webp"'}],'Trips.diesel_po',{extra:{trip_id:t.id},intro:'Attach an existing document to this trip. This does not create or approve a Diesel PO request.',after:()=>{UI.closeDrawer();App.route();}});this.groupModal(modal,[['01 — Associated Trip',[],UI.kv([['Trip',UI.e(t.trip_ref)],['Truck',UI.e(t.plate_number)]])],['02 — Supporting Documents',['diesel_po']]]);});
  },
  incidents(ctx) {
    ctx.setTitle('Incident Reports','Submit incident reports and monitor authorized maintenance coordination.');
    UI.tool(ctx,'Submit Incident Report',()=>this.reportIncident(),'bi-plus-lg','primary');
    const rows=ctx.data.incidents;
    const fields=[{name:'incident',label:'Incident Status',type:'select',placeholder:'All incidents',options:[['open','Open Incidents'],...this.options(rows,'status') ]},{name:'incident_type',label:'Incident Type',type:'select',placeholder:'All incident types',options:this.options(rows,'incident_type')},{name:'job_status',label:'Maintenance Status',type:'select',placeholder:'All maintenance statuses',options:this.options(rows,'job_status').map(([v,l])=>[v,l==='Under Repair'?'Under Corrective Maintenance':l])}],opts={base:{tab:'incidents'}};
    ctx.el.innerHTML=this.filters(ctx,fields,{...opts,placeholder:'Search incident, trip, truck, or location…'})+'<div data-incidents></div>';
    if(!Array.isArray(rows)){ctx.el.insertAdjacentHTML('beforeend','<p role="alert">Incident records unavailable.</p>');return;}
    const q=ctx.query,filter=q.incident,filtered=rows.filter(i=>(!filter||(filter==='open'?i.status!=='Resolved':i.status===filter))&&(!q.incident_type||i.incident_type===q.incident_type)&&(!q.job_status||i.job_status===q.job_status)&&this.contains(i,['incident_ref','trip_ref','plate_number','problem','location'],q.search));const table=ctx.el.querySelector('[data-incidents]');table.innerHTML=UI.table([['Incident / Trip','incident_ref',(v,i)=>`<b>${UI.esc(v)}</b><div>${UI.esc(i.trip_ref)}</div>`],['Truck','plate_number'],['Problem / Location','problem',(v,i)=>UI.esc(v)+'<div>'+UI.esc(i.location)+'</div>'],['Status','status','badge'],['Maintenance Status','job_status',v=>UI.esc(v==='Under Repair'?'Under Corrective Maintenance':v||'Awaiting assessment')],['Reported','incident_at',v=>this.datetime(v)]],filtered,{showAllColumns:true,actions:()=>UI.btn('view','View Details'),onAction:(a,i)=>this.openIncident(i),empty:'No incident reports match.'});this.activateRecords(table);this.bindFilters(ctx,fields,opts);
  },
  openIncident(i) {
    const el=UI.drawer(UI.esc(i.incident_ref),this.panel('Incident Information',UI.kv([['Trip',UI.e(i.trip_ref)],['Truck',UI.e(i.plate_number)],['Incident Type',UI.e(i.incident_type)],['Problem',UI.e(i.problem)],['Description',UI.e(i.details)],['Location',UI.e(i.location)],['Reported',this.datetime(i.incident_at)],['Severity',UI.e(i.severity||'Not assessed')],['Incident Status',UI.badge(i.status)],['Corrective Maintenance',UI.e(i.job_ref)],['Maintenance Status',UI.e(i.job_status)],['Recommendation',UI.e(i.recommendation)]]))+'<p class="small text-muted">Maintenance personnel record findings, repairs, costs, completion, and clearance. Dispatchers resume or reschedule only through the existing trip controls.</p><button class="btn btn-primary" data-ds-trip="'+(+i.trip_id)+'">View Linked Trip</button>',{subtitle:UI.esc(i.plate_number)});this.bindTrips(el);
  },
  async reportIncident() {
    let d;try{d=await this.ensureTrips();}catch(ex){return UI.toast(ex.message,'error');}
    const eligible=d.active.filter(t=>t.dispatcher_role===App.me.user.role&&['Dispatched','In Transit'].includes(t.status)&&t.vehicle_id);
    if(!eligible.length)return UI.toast('No dispatched or in-transit trip is eligible for an incident report.','warn');
    const modal=UI.modal('Submit Incident Report',UI.fields([{name:'trip_id',label:'Associated Trip / Vehicle',type:'select',required:true,col:12,options:eligible.map(t=>[t.id,t.trip_ref+' · '+t.plate_number])}]),async values=>{const r=await App.api('Trips.details',{trip_id:values.trip_id});if(r.trip.dispatcher_role!==App.me.user.role||!['Dispatched','In Transit'].includes(r.trip.status))throw new Error('This trip is no longer eligible for incident reporting.');modal.addEventListener('hidden.bs.modal',()=>TripUI.incident(r.trip),{once:true});},{submit:'Continue',confirmBeforeSubmit:false});
  },
  availability(ctx) {
    if(ctx.query.view!=='availability')return App.go('trucks',{view:'availability',tab:ctx.page==='crew'?'personnel':'trucks'});
    ctx.setTitle('Truck & Personnel Availability','Read-only operational reference. Assignments and availability follow the existing fleet rules.');
    const personnel=ctx.query.tab==='personnel',label=UI.role('car_carrier_dispatcher')?'Driver Availability':'Driver & Helper Availability',d=ctx.data;
    ctx.tools?.closest('.page-head')?.classList.add('ds-availability-head');
    const count=key=>Array.isArray(d[key])?UI.num(d[key].length):'—';
    ctx.el.innerHTML=`<section class="ds-availability" aria-label="Availability workspace"><nav class="ds-availability-tabs" aria-label="Availability tabs"><div class="ds-availability-tab-group"><a href="#trucks?view=availability" ${personnel?'':'class="active" aria-current="page"'}><span>Truck Availability</span><span class="ds-tab-count" aria-label="${count('trucks')} authorized truck records">${count('trucks')}</span></a><a href="#trucks?view=availability&tab=personnel" ${personnel?'class="active" aria-current="page"':''}><span>${label}</span><span class="ds-tab-count" aria-label="${count('personnel')} authorized personnel records">${count('personnel')}</span></a></div></nav><div data-availability></div></section>`;
    const rows=d[personnel?'personnel':'trucks'],box=ctx.el.querySelector('[data-availability]');
    if(!Array.isArray(rows)){box.innerHTML='<p role="alert">Availability records unavailable.</p>';return;}
    const columns=personnel?[['Name','full_name'],['Personnel Role','person_type'],['Availability','availability','badge'],['Current Trip','trip_ref'],['Truck','plate_number'],['Duty Shift','duty_shift'],['Current Shift Attendance','attendance_status',(v,p)=>!p.duty_shift?'Shift unassigned':p.duty_shift!==d.attendanceContext?.shift?'Off current shift':UI.esc(v||'Not Yet Marked')],['License Expiry','license_expiry',(v,p)=>p.person_type==='Helper'?'Not applicable':v?UI.date(v):'Not recorded']]:[['Plate Number','plate_number'],['Truck Type','truck_type'],['Current Availability','status','badge'],['Current Trip','trip_ref'],['Maintenance Restriction','open_job',(v,t)=>v?UI.esc(v)+' · '+UI.esc(t.open_job_status==='Under Repair'?'Under Corrective Maintenance':t.open_job_status==='Completed'?'Awaiting Maintenance Clearance':t.open_job_status):UI.esc(t.status_reason||'None recorded')]];
    const fields=[{name:'availability',label:'Availability',type:'select',placeholder:'All availability statuses',options:this.options(rows,personnel?'availability':'status')},personnel?{name:'person_type',label:'Personnel Role',type:'select',placeholder:'All authorized personnel',options:this.options(rows,'person_type')}:{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{view:'availability',...(personnel?{tab:'personnel'}:{})}},q=ctx.query;
    box.innerHTML=this.filters(ctx,fields,{...opts,placeholder:personnel?'Search name, role, trip, or truck…':'Search plate number, type, or current trip…'})+'<div data-availability-records></div>';
    const filtered=rows.filter(r=>(!q.availability||r[personnel?'availability':'status']===q.availability)&&(!q.person_type||r.person_type===q.person_type)&&(!q.truck_type||r.truck_type===q.truck_type)&&this.contains(r,personnel?['full_name','person_type','trip_ref','plate_number']:['plate_number','trip_ref','truck_type'],q.search)),table=box.querySelector('[data-availability-records]');table.innerHTML=UI.table(columns,filtered,{showAllColumns:true,dsAvailability:true,empty:'No authorized availability records match.'});this.activateRecords(table);
    table.querySelector('.panel-body')?.insertAdjacentHTML('beforeend',`<p class="ds-availability-note"><i class="bi bi-info-circle" aria-hidden="true"></i><span>${UI.role('car_carrier_dispatcher')?'Car Carrier dispatch requires two distinct eligible drivers.':'Container and Wing Van dispatch requires an eligible driver and helper.'} Availability is a current reference, not a future resource reservation.</span></p>`);
    this.bindFilters(ctx,fields,opts);
  },
  masterlist(ctx) {
    const personnel=ctx.page==='crew',label=personnel?(UI.role('car_carrier_dispatcher')?'Driver Master List':'Driver & Helper Master Lists'):'Truck Master List',d=ctx.data,q=ctx.query;
    ctx.setTitle(label,'Read-only operational records for your Dispatcher group.');
    ctx.tools?.closest('.page-head')?.classList.add('ds-availability-head');
    const rows=d[personnel?'personnel':'trucks'];if(!Array.isArray(rows)){ctx.el.innerHTML='<p role="alert">Master records unavailable.</p>';return;}
    const fields=[{name:'availability',label:'Availability',type:'select',placeholder:'All statuses',options:this.options(rows,personnel?'availability':'status')},personnel?{name:'person_type',label:'Personnel Role',type:'select',placeholder:'All authorized roles',options:this.options(rows,'person_type')}:{name:'truck_type',label:'Truck Type',type:'select',placeholder:'All authorized types',options:UI.list(this.types())}],opts={base:{view:'masterlist'}};
    ctx.el.innerHTML=this.filters(ctx,fields,{...opts,placeholder:personnel?'Search personnel, regular truck, or current trip…':'Search plate, type, regular driver, or current trip…'})+'<div data-master-records></div>';
    const filtered=rows.filter(r=>(!q.availability||r[personnel?'availability':'status']===q.availability)&&(!q.person_type||r.person_type===q.person_type)&&(!q.truck_type||r.truck_type===q.truck_type)&&this.contains(r,personnel?['full_name','person_type','regular_truck','trip_ref']:['plate_number','truck_type','driver_name','trip_ref'],q.search));
    const columns=personnel?[['Name','full_name'],['Personnel Role','person_type'],['Permanent Truck','regular_truck'],['Availability','availability','badge'],['Duty Shift','duty_shift'],['Current Trip','trip_ref'],['License Expiry','license_expiry',(v,p)=>p.person_type==='Helper'?'Not applicable':v?UI.date(v):'Not recorded']]:[['Plate Number','plate_number'],['Truck Type','truck_type'],['Regular Driver','driver_name'],['Regular Helper','helper_name'],['Operational Status','status','badge'],['Assignment Availability','assignment_available',(v,t)=>v===true?'<span class="badge-s green">Driver and truck ready</span>':v===false?'<span class="badge-s amber">Not eligible</span><div class="cell-sub">'+UI.esc(t.assignment_reason)+'</div>':'See operational status'],['Current Trip','trip_ref'],['Maintenance Restriction','open_job',(v,t)=>v?UI.esc(v)+' · '+UI.esc(t.open_job_status):'None recorded']];
    const box=ctx.el.querySelector('[data-master-records]');box.innerHTML=UI.table(columns,filtered,{showAllColumns:true,actions:()=>UI.btn('view','View Details'),onAction:async(a,r)=>{try{const result=await App.api(personnel?'Fleet.crew_details':'Fleet.truck_details',{id:r.id}),record=result[personnel?'person':'truck'];if(!record)throw new Error('Record unavailable.');UI.drawer(UI.esc(personnel?record.full_name:record.plate_number),UI.kv(columns.map(([label,key,fmt])=>[label,UI.fmt(fmt,record[key],record)])),{subtitle:'Read-only operational reference'});}catch(ex){UI.toast(ex.message,'error');}},empty:'No authorized records match.'});this.activateRecords(box);this.bindFilters(ctx,fields,opts);
  },
  attendanceKeys: new Map(),
  attendanceBusy: new Set(),
  attendance(ctx) {
    ctx.setTitle(UI.role('car_carrier_dispatcher')?'Driver Attendance':'Driver & Helper Attendance','Record current-shift attendance for authorized personnel.');
    const d=ctx.data,q=ctx.query,rows=d.rows;if(!Array.isArray(rows)){ctx.el.innerHTML='<p role="alert">Attendance roster unavailable.</p>';return;}
    const fields=[{name:'person_type',label:'Personnel Role',type:'select',placeholder:'All authorized roles',options:this.options(rows,'person_type')},{name:'attendance_status',label:'Attendance Status',type:'select',placeholder:'All attendance states',options:this.options(rows,'attendance_status')}],opts={base:{view:'attendance'}};
    ctx.el.innerHTML=(!d.schema_ready?'<p role="alert" class="alert alert-warning">Dispatcher attendance sessions are not installed. Apply the additive Dispatcher attendance migration.</p>':'')+this.filters(ctx,fields,{...opts,placeholder:'Search personnel name or role…'})+'<p class="ds-record-context">'+UI.esc(d.shift?.date)+' · '+UI.esc(d.shift?.shift)+' shift (PHT)</p><div data-attendance-records></div><p class="small text-muted">Time Out is blocked while personnel are held by an active trip. Each new Time In preserves the preceding session.</p>';
    const filtered=rows.filter(r=>(!q.person_type||r.person_type===q.person_type)&&(!q.attendance_status||r.attendance_status===q.attendance_status)&&this.contains(r,['full_name','person_type'],q.search)),box=ctx.el.querySelector('[data-attendance-records]');
    box.innerHTML=UI.table([['Personnel','full_name'],['Personnel Role','person_type'],['Duty Shift','duty_shift'],['Attendance Status','attendance_status',v=>`<span class="badge-s ${v==='Timed In'?'green':v==='Open Previous Shift'?'amber':''}">${UI.esc(v)}</span>`],['Latest Time In','session',s=>this.datetime(s?.time_in)],['Latest Time Out','session',s=>this.datetime(s?.time_out)],['History','id',id=>`<button type="button" class="btn btn-sm btn-link" data-attendance-history="${+id}">History</button>`]],filtered,{showAllColumns:true,actions:r=>`<button type="button" class="btn btn-sm btn-${r.action==='Time Out'?'outline-secondary':'primary'}" data-act="record" title="${UI.esc(r.action_reason||'')}" ${!d.schema_ready||r.can_record===false?'disabled':''}>${UI.esc(r.action)}</button>`,onAction:async(a,r,button)=>{
      const operation=r.action==='Time Out'?'time_out':'time_in',identity=[App.me.user.id,r.id,operation,r.session?.id||0].join(':');if(this.attendanceBusy.has(identity))return;
      this.attendanceBusy.add(identity);const key=this.attendanceKeys.get(identity)||UI.uuid();this.attendanceKeys.set(identity,key);button.disabled=true;button.textContent='Recording…';
      try{const result=await App.api('Attendance.'+operation,{personnel_id:r.id,session_id:r.session?.id,request_key:key});this.attendanceKeys.delete(identity);UI.result(result);await ctx.reload();}catch(ex){if(ex.status&&ex.status<500)this.attendanceKeys.delete(identity);UI.toast(ex.message,'error');}finally{this.attendanceBusy.delete(identity);if(button.isConnected){button.disabled=false;button.textContent=r.action;}}
    },empty:'No authorized personnel match.'});this.activateRecords(box);this.bindFilters(ctx,fields,opts);
    box.onclick=async event=>{const button=event.target.closest('[data-attendance-history]');if(!button)return;button.disabled=true;try{const h=await App.api('Attendance.dispatcher_history',{personnel_id:button.dataset.attendanceHistory});const el=UI.drawer('Attendance History · '+UI.esc(h.person.full_name),UI.table([['Shift Date','duty_date'],['Shift','duty_shift'],['Time In','time_in',v=>this.datetime(v)],['Time Out','time_out',v=>this.datetime(v)],['Recorded In By','timed_in_by_name'],['Recorded Out By','timed_out_by_name']],h.sessions,{plain:true,limit:10,empty:'No attendance sessions recorded.'}));UI.activate(el);}catch(ex){UI.toast(ex.message,'error');}finally{button.disabled=false;}};
  },
  documents(ctx) {
    ctx.setTitle('Documents','Search and view authorized trip and incident documents. Submit files through their trip workflows.');
    const d=ctx.data;
    if(!Array.isArray(d.documents)){ctx.el.innerHTML='<p role="alert">Document records unavailable.</p>';return;}
    const fields=[{name:'category',label:'Document Category',type:'select',placeholder:'All document categories',options:this.options(d.documents,'category')},{name:'trip_id',label:'Associated Trip',type:'select',placeholder:'All trips and other records',options:this.options(d.documents.filter(doc=>doc.entity_type==='trip'),'entity_id','record_label')},{name:'from',label:'Upload Date From',type:'date'},{name:'to',label:'Upload Date To',type:'date'}],q=ctx.query;
    ctx.el.innerHTML=this.filters(ctx,fields,{placeholder:'Search filename, linked record, or uploader…'})+'<div data-documents></div>';
    const rows=d.documents.filter(doc=>(!q.category||doc.category===q.category)&&(!q.trip_id||(doc.entity_type==='trip'&&String(doc.entity_id)===q.trip_id))&&(!q.from||String(doc.created_at).slice(0,10)>=q.from)&&(!q.to||String(doc.created_at).slice(0,10)<=q.to)&&this.contains(doc,['original_filename','record_label','uploader','category'],q.search)),box=ctx.el.querySelector('[data-documents]');box.innerHTML=UI.table([['Document','original_filename'],['Linked Record','record_label'],['Document Type','category'],['Uploaded','created_at',v=>this.datetime(v)],['Uploaded By','uploader']],rows,{showAllColumns:true,actions:()=>UI.btn('view','View / Download'),onAction:(a,doc)=>UI.drawer(UI.esc(doc.original_filename),UI.docs([doc]),{subtitle:UI.esc(doc.record_label)}),empty:'No authorized documents match.'});this.activateRecords(box);this.bindFilters(ctx,fields);
  },

  decorateTrip(el,r) {
    const t=r.trip,body=el.querySelector('.offcanvas-body'),actions=body.querySelector('.drawer-actions'),sections=new Map(),progress=body.querySelector('.wf-steps');
    el.classList.add('ds-trip-drawer');el.querySelector('.btn-close').setAttribute('aria-label','Close Trip Details');
    el.querySelector('.offcanvas-header > div').insertAdjacentHTML('beforeend',this.status(t.status));
    [...body.querySelectorAll('.drawer-h')].forEach(h=>{const title=h.querySelector('span').textContent,fragment=document.createDocumentFragment();let node=h.nextSibling;while(node&&!(node.nodeType===1&&node.classList.contains('drawer-h'))){const next=node.nextSibling;fragment.append(node);node=next;}h.querySelectorAll('button').forEach(b=>fragment.prepend(b));sections.set(title,fragment);h.remove();});
    const inspection=r.inspections.find(i=>i.kind==='Pre-Dispatch'&&+i.attempt_number===+t.attempt_number),arrival=r.inspections.find(i=>i.kind==='Arrival'&&+i.attempt_number===+t.attempt_number),fund=r.funds.find(f=>+f.attempt_number===+t.attempt_number);
    const preparing=['Pre-Assigned','Ready for Dispatch','For Reschedule'].includes(t.status);
    body.innerHTML=this.panel('Operational Readiness',UI.kv([
      ['Resource Assignment',t.vehicle_id&&t.driver_id&&(t.truck_type==='Car Carrier'?t.driver2_id:t.helper_id)?'Truck and required personnel assigned':'See current resource assignment'],
      ['Trip Fund Status',fund?this.fundStatus(fund.status):+t.attempt_number>1?'No new request (optional for redispatch)':'Not requested'],
      ['Diesel PO Documents',+t.diesel_po_docs?`${+t.diesel_po_docs} document(s) attached`:'No documents attached'],
      ['Pre-Dispatch Checklist',inspection?(+inspection.has_not_ok?'NOT OK items recorded':'Completed'):'Not completed'],
      ['Dispatch Readiness',preparing?((t.dispatch_blockers||[]).length?(t.dispatch_blockers||[]).map(UI.esc).join('<br>'):'Existing prerequisites satisfied; server rechecks at dispatch'):'See current operational status'],
      ...(t.status==='Completed'?[['Arrival Inspection',+t.awaiting_arrival?(arrival?'Recorded; clearance pending':'Pending Arrival Inspection'):arrival?'Recorded':'No inspection recorded']]:[]),
    ]))+'<div data-ds-sections></div>';
    const container=body.querySelector('[data-ds-sections]');
    const append=(title,content,open=false)=>{const detail=document.createElement('details');detail.className='ds-detail';detail.open=open;const summary=document.createElement('summary');summary.textContent=title;const inner=document.createElement('div');inner.className='ds-detail-body';if(typeof content==='string')inner.innerHTML=content;else if(content)inner.append(content);detail.append(summary,inner);container.append(detail);return inner;};
    const overview=append('Trip Overview',UI.kv([['Client',UI.e(t.client)],['Route',UI.esc(t.pickup_point)+' → '+UI.esc(t.delivery_point)],['Approved Client Route',UI.e(t.client_route_ref||'No approved route linked')],['Scheduled Dispatch (PHT)',this.datetime(t.scheduled_at)],['Operational Status',this.status(t.status)],['Requesting User',UI.e(t.created_by_name)],['Created',this.datetime(t.created_at)],t.cancel_reason?['Recorded Closure Reason',UI.e(t.cancel_reason)]:null]),true);
    const savedMap=sections.get('Trip')?.querySelector('[data-routemap]');if(savedMap)overview.append(savedMap);
    append('Delivery & Shipment',UI.kv([['Delivery Instructions',UI.e(t.delivery_details)],['Consignee',UI.e(t.consignee)],['Booking Reference',UI.e(t.booking_reference)],...(t.truck_type==='Car Carrier'?[['Cargo Units',UI.e(t.units_planned)]]:[['Shipment Number',UI.e(t.shipment_number)]]),...(t.truck_type==='Container'?[['Container Number',UI.e(t.container_number)],['Container Size',UI.e(t.container_size)],['Seal Number',UI.e(t.seal_number)]]:[])]));
    append('Truck & Personnel',UI.kv([['Vehicle',UI.e(t.plate_number)],['Vehicle Availability',UI.e(t.truck_status)],['Driver 1',UI.e(t.driver_name)],...(t.truck_type==='Car Carrier'?[['Driver 2',UI.e(t.driver2_name)]]:[['Helper',UI.e(t.helper_name)]]),['Attendance Policy',UI.e(t.crew_attendance?.mode)],['Relevant Shift',UI.e(t.crew_attendance?.dispatch_shift)]])+(t.crew_attendance?.crew||[]).map(c=>`<p class="small">${UI.esc(c.role)}: ${UI.esc(c.issue||'Present')}${c.problem?' · '+UI.esc(c.problem):''}${c.outside_scheduled_shift?' · Outside scheduled shift':''}</p>`).join('')+(t.crew_attendance?.missing||[]).map(x=>`<p class="text-danger small">${UI.esc(x)}</p>`).join(''));
    const fuel=append('Trip Funds & Fuel',sections.get('Fund request'));fuel.insertAdjacentHTML('beforeend','<p id="ds-diesel-unavailable" class="form-help">Diesel PO request submission, approval, and issuance are unavailable. Existing Diesel PO documents can still be attached to this trip.</p>');
    fuel.querySelectorAll('.badge-s').forEach(b=>{if(b.textContent==='Ready for Release')b.textContent='Approved — Awaiting Release';if(b.textContent==='Rejected')b.textContent='Requires Revision';});
    const dieselButton=actions?.querySelector('[data-tact=dieselpo]');if(dieselButton){dieselButton.textContent='Attach Diesel PO Document';fuel.append(dieselButton);}
    const fundButton=actions?.querySelector('[data-tact=fund]');if(fundButton){fundButton.textContent=fund?.status==='Rejected'?'Revise Trip Funds':'Request Trip Funds';fundButton.onclick=()=>this.fundForm(t,TripUI.data.fundCategories,fund?.status==='Rejected'?fund:null);fuel.append(fundButton);}
    if(['Pre-Assigned','Ready for Dispatch'].includes(t.status))fuel.insertAdjacentHTML('beforeend','<button type="button" class="btn btn-outline-secondary" disabled aria-describedby="ds-diesel-unavailable">Request Diesel PO</button>');
    append('Pre-Dispatch Checklist',[...sections].find(([title])=>title.startsWith('Pre-dispatch checklist'))?.[1]);
    const dispatch=append('Dispatch & Progress',sections.get('Updates and delays'));if(progress)dispatch.prepend(progress);dispatch.insertAdjacentHTML('beforeend',UI.kv([['Next Action',UI.esc(this.next(t))],['Dispatched',this.datetime(t.dispatched_at)],['Checklist Opens',this.datetime(t.time_gates?.checklist_opens_at)],['Dispatch Opens',this.datetime(t.time_gates?.dispatch_opens_at)]]));
    const incidents=append('Incidents & Maintenance',sections.get('Incidents')||'<p>No incident reports recorded.</p>');const incidentButton=actions?.querySelector('[data-tact=incident]');if(incidentButton){incidentButton.textContent='Submit Incident Report';incidents.prepend(incidentButton);}
    const completion=append('Completion & Arrival',sections.get('Completion')||'<p>Trip completion is not recorded.</p>');if(sections.get('Arrival checklist'))completion.append(sections.get('Arrival checklist'));if(+t.awaiting_arrival)completion.insertAdjacentHTML('afterbegin','<p class="small">The delivery is completed, but the vehicle remains held until arrival inspection and any required maintenance clearance.</p>');
    completion.querySelectorAll('dt').forEach(label=>{if(label.textContent==='Billing'){label.nextElementSibling?.remove();label.remove();}});
    append('Documents',sections.get('Documents'));append('Activity Timeline',sections.get('History'));
    this.tripPills(el,t,r,actions,{inspection,arrival,fund});
  },
  tripPills(el,t,r,actions,{inspection,arrival,fund}) {
    const body=el.querySelector('.offcanvas-body'),parts=new Map([...body.querySelectorAll('.ds-detail')].map(d=>[d.querySelector('summary').textContent,d.querySelector('.ds-detail-body')])),readiness=body.querySelector('.ds-panel'),prefix='ds-trip-'+UI.uuid();
    const preparing=['Pre-Assigned','Ready for Dispatch','For Reschedule'].includes(t.status),inspectionDone=inspection?.completed_at&&+inspection.vehicle_id===+t.vehicle_id&&+inspection.has_not_ok===0;
    // There is no verified Diesel request/issuance lifecycle, so a combined Fuel completion is not claimed.
    const fuelDone=false;
    const defs=[['Overview',['Trip Overview','Delivery & Shipment','Truck & Personnel','Documents','Activity Timeline'],''],['Trip Funds & Fuel',['Trip Funds & Fuel'],fuelDone?'complete':preparing&&fund?.status!=='Released'?'attention':''],['Pre-Dispatch',['Pre-Dispatch Checklist'],inspectionDone?'complete':preparing?'attention':''],['Dispatch & Progress',['Dispatch & Progress'],t.completed_at&&t.dispatched_at?'complete':preparing&&t.dispatch_blockers?.length?'attention':''],['Incidents',['Incidents & Maintenance'],r.incidents.some(i=>i.status!=='Resolved')?'attention':''],['Arrival & Completion',['Completion & Arrival'],t.completed_at&&arrival?.completed_at&&+arrival.vehicle_id===+t.vehicle_id&&+arrival.has_not_ok===0&&!+t.awaiting_arrival?'complete':+t.awaiting_arrival?'attention':'']];
    const nav=document.createElement('div');nav.className='ds-trip-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Trip details sections');
    const panels=defs.map(([name,keys,state],index)=>{const panel=document.createElement('section');panel.className='ds-trip-pane';panel.id=prefix+'-pane-'+index;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',prefix+'-tab-'+index);panel.tabIndex=0;panel.hidden=index!==0;
      keys.forEach(key=>{const content=parts.get(key);if(!content)return;if(keys.length>1){const h=document.createElement('h3');h.className='ds-trip-part-title';h.textContent=key;panel.append(h);}panel.append(content);});if(index===0&&readiness)panel.prepend(readiness);
      const button=document.createElement('button');button.type='button';button.className='ds-trip-tab';button.id=prefix+'-tab-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-selected',String(index===0));button.tabIndex=index===0?0:-1;button.innerHTML=(state?`<i class="bi ${state==='complete'?'bi-check-circle-fill':'bi-exclamation-triangle-fill'} ds-pill-${state}" aria-hidden="true"></i> `:'')+UI.esc(name);if(state)button.setAttribute('aria-label',name+(state==='complete'?' — recorded completion verified':' — needs attention'));nav.append(button);return panel;
    });
    if(actions)actions.querySelectorAll('[data-tact]').forEach(button=>{const act=button.dataset.tact,index=act==='checklist'?2:['dispatch','complete','update'].includes(act)?3:['resume','reschedule','incident'].includes(act)?4:act==='arrival'?5:0;panels[index].prepend(button);});
    if(t.status==='Awaiting Resources'){const assign=document.createElement('button');assign.type='button';assign.className='btn btn-primary';assign.dataset.assignResources=t.id;assign.textContent='Assign Resources';assign.onclick=()=>this.assignResources(t.id);panels[0].prepend(assign);}
    body.replaceChildren(nav,...panels);body.querySelectorAll('.wf-steps').forEach(node=>node.remove());
    const footer=document.createElement('div');footer.className='ds-drawer-footer';const close=document.createElement('button');close.type='button';close.className='btn btn-outline-secondary';close.textContent='Close Details';close.onclick=()=>UI.closeDrawer();footer.append(close);el.append(footer);
    const primary=panels.map(panel=>{const button=panel.querySelector('[data-assign-resources],button.btn-primary:not([disabled]),button.btn-success:not([disabled])');if(!button)return null;const marker=document.createComment('contextual trip action');button.before(marker);return {button,marker};});let selected=-1;
    const select=index=>{if(selected>=0&&primary[selected])primary[selected].marker.after(primary[selected].button);selected=index;panels.forEach((panel,i)=>{panel.hidden=i!==index;const tab=nav.children[i];tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});if(primary[index])footer.append(primary[index].button);};
    [...nav.children].forEach((button,index)=>{button.onclick=()=>select(index);button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%6;else if(event.key==='ArrowLeft')next=(index+5)%6;else if(event.key==='Home')next=0;else if(event.key==='End')next=5;else return;event.preventDefault();select(next);nav.children[next].focus();nav.children[next].scrollIntoView({block:'nearest',inline:'nearest'});};});select(0);
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
    document.querySelector('.sidebar-nav').innerHTML=`<div class="nav-section">Overview</div>${link('dashboard','Dashboard','bi-grid-1x2')}<div class="nav-section">Trip Operations</div>${link('trips','Trip Requests','bi-send',{view:'requests'},'requests')}${link('trips','Trip Management','bi-truck',{},'management')}${link('funds','Trip Funds & Fuel','bi-cash-coin')}${link('trips','Incident Reports','bi-exclamation-triangle',{tab:'incidents'},'incidents')}<div class="nav-section">Reference & Records</div>${link('crew',UI.role('car_carrier_dispatcher')?'Driver Attendance':'Driver & Helper Attendance','bi-calendar-check',{view:'attendance'},'attendance')}${link('trucks','Truck Master List','bi-truck',{view:'masterlist'},'trucks')}${link('crew',UI.role('car_carrier_dispatcher')?'Driver Master List':'Driver & Helper Master Lists','bi-person-badge',{view:'masterlist'},'personnel')}${link('trips','Trip History','bi-clock-history',{tab:'history'},'history')}${link('documents','Documents','bi-folder2-open')}`;
    const toggle=document.createElement('button');toggle.className='icon-btn ds-collapse-nav';toggle.type='button';toggle.setAttribute('aria-label','Collapse navigation');toggle.setAttribute('aria-expanded','true');toggle.innerHTML='<i class="bi bi-layout-sidebar-inset" aria-hidden="true"></i>';toggle.onclick=()=>{const collapsed=document.body.classList.toggle('ds-nav-collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));};document.querySelector('.topbar').prepend(toggle);
  };
  for(const [page,render] of Object.entries({dashboard:ctx=>DispatcherUI.dashboard(ctx),trips:ctx=>DispatcherUI.trips(ctx),funds:ctx=>DispatcherUI.funds(ctx),trucks:ctx=>ctx.query.view==='availability'&&ctx.query.tab==='personnel'?App.go('crew',{view:'masterlist'}):DispatcherUI.masterlist(ctx),crew:ctx=>ctx.query.view==='attendance'?DispatcherUI.attendance(ctx):DispatcherUI.masterlist(ctx),documents:ctx=>DispatcherUI.documents(ctx)})){
    const original=App.pages[page].render;App.pages[page].render=function(ctx){if(!DispatcherUI.is())return original.call(this,ctx);return render({...ctx,setTitle:(title,subtitle)=>{ctx.setTitle(title,subtitle);document.title=title+' · Mulawin FleetOps';const crumbs=document.querySelector('#crumbs');if(crumbs)crumbs.innerHTML='<span class="crumb-page">'+UI.esc(title)+'</span>';}});};
  }
  const open=TripUI.open;TripUI.open=async function(id){if(DispatcherUI.is())try{await DispatcherUI.ensureTrips();}catch(ex){return UI.toast(ex.message,'error');}return open.call(this,id);};
  const drawer=UI.drawer;UI.drawer=(...args)=>{const previous=document.querySelector('.app-drawer');previous?.classList.remove('ds-trip-drawer');previous?.querySelector('.ds-drawer-footer')?.remove();return drawer(...args);};
  const incident=TripUI.incident;TripUI.incident=function(t){if(!DispatcherUI.is())return incident.call(this,t);if(t.dispatcher_role!==App.me.user.role||!['Dispatched','In Transit'].includes(t.status))return UI.toast('This trip is not eligible for an incident report.','error');incident.call(this,t);const modal=[...document.querySelectorAll('.modal')].at(-1);if(modal){modal.querySelector('.modal-title').textContent='Submit Incident Report · '+t.trip_ref;DispatcherUI.groupModal(modal,[['01 — Associated Trip',[],`<p class="small"><b>Associated Trip:</b> ${UI.esc(t.trip_ref)} · <b>Vehicle:</b> ${UI.esc(t.plate_number)}</p>`],['02 — Incident Information',['incident_type','incident_at','location','persons_involved','problem','reason']],['03 — Incident Description and Evidence',['details','photos','attachments']]]);const date=modal.querySelector('[name=incident_at]');if(date)date.value=UI.nowManila();}};
})();
