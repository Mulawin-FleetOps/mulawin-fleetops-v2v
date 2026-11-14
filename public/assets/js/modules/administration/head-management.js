/* Head Management read-only oversight. Actions stay with their owning departments. */
'use strict';
const HeadOversight = {
  panel(title, cols, rows, empty, interactive = true) {
    const records = rows || [];
    if (!interactive) return '<section class="card mb-3"><div class="card-body"><h2 class="h6 mb-3">'+UI.esc(title)+'</h2>'
      +UI.table(cols,records,{showAllColumns:true,viewSwitch:false,empty})+'</div></section>';
    const facetKeys = ['status','truck_type','person_type','availability','severity'];
    const facet = facetKeys.find(key => cols.some(column => column[1] === key));
    const options = facet ? [...new Set(records.map(row => row[facet]).filter(Boolean))].sort() : [];
    const id = 'head-filter-' + (++this.panelId);
    const sortId = id + '-sort';
    return '<section class="card mb-3 head-monitor-panel" data-head-panel>'
      + '<div class="head-monitor-header"><h2 class="h6 mb-0">'+UI.esc(title)+'</h2>'
      + '<span class="head-monitor-subcount" data-head-count>'+records.length+' records</span></div>'
      + '<div class="head-monitor-tools record-workspace-search">'
      + '<div class="head-search-box"><i class="bi bi-search" aria-hidden="true"></i>'
      + '<input type="search" class="form-control head-monitor-search" data-head-search placeholder="Search this list" aria-label="Search '+UI.esc(title)+'"></div>'
      + (facet ? '<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="'+id+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter <span data-head-filter-count></span></button>' : '')
      + '<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" aria-controls="'+sortId+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
      + '<button type="button" class="btn btn-sm btn-outline-success" data-head-export><i class="bi bi-download" aria-hidden="true"></i> Export</button>'
      + '<div class="record-workspace-popovers">'
      + (facet ? '<div class="record-workspace-popover" id="'+id+'" hidden><strong>Filter '+UI.esc(title)+'</strong>'
        + '<label>'+UI.esc(facet.replace(/_/g,' '))+'<select class="form-select form-select-sm" data-head-facet>'
        + '<option value="">All</option>'+options.map(value => '<option value="'+UI.esc(value)+'">'+UI.esc(value)+'</option>').join('')+'</select></label>'
        + '<div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
        + '<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>' : '')
      + '<div class="record-workspace-popover record-workspace-sort-panel" id="'+sortId+'" hidden>'
      + '<strong>Sort records</strong><label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="default" data-record-sort checked> Default order</label>'
      + '<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="asc" data-record-sort> First column A–Z</label>'
      + '<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="desc" data-record-sort> First column Z–A</label></div></div>'
      + '</div><div class="head-monitor-table" data-head-panel-table></div></section>';
  },
  panelId: 0,
  csv(rows, cols, name) {
    const quote = value => '"' + String(value ?? '').replace(/"/g,'""')
      .replace(/^[\s\uFEFF]*[=+\-@\t\r]/, match => "'" + match) + '"';
    const csv = '\uFEFF' + [cols.map(col => quote(col[0])).join(','),
      ...rows.map(row => cols.map(col => quote(row[col[1]])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mulawin_' + name.toLowerCase().replace(/[^a-z0-9]+/g,'_') + '_' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  },
  // The shared renderer hides table headers on empty admin tables. Restore
  // headers and the regular pager here without modifying other departments.
  finishTable(slot) {
    const body = slot.querySelector('[data-tbody]');
    if (!body) return;
    const id = body.dataset.tbody;
    const table = UI._tables[id];
    if (!table) return;
    const rows = UI.tableRows(id);
    const pager = slot.querySelector('[data-tpager]');
    if (!rows.length) {
      const heading = table.columns.map(([label,,format]) =>
        '<th>'+UI.esc(UI.columnLabel(label,format))+'</th>').join('');
      const cols = table.columns.length + (table.hasActions ? 1 : 0);
      body.innerHTML = '<table class="data-table"><thead><tr>'+heading
        +(table.hasActions?'<th class="actions-col">Action</th>':'')
        +'</tr></thead><tbody><tr><td colspan="'+cols+'"><div class="table-empty" role="status">'
        +UI.esc(table.opts.empty || 'No records available.')+'</div></td></tr></tbody></table>';
    }
    if (!pager) return;
    const pages = Math.max(1,Math.ceil(rows.length/table.limit));
    pager.innerHTML = UI.recordPager({total:rows.length,page:table.page+1,pages,pageSize:table.limit});
    const buttons = pager.querySelectorAll('button');
    if (buttons[0]) buttons[0].onclick = () => {table.page--;UI.drawTable(id);this.finishTable(slot);};
    if (buttons[1]) buttons[1].onclick = () => {table.page++;UI.drawTable(id);this.finishTable(slot);};
  },
  mount(root, sections) {
    root.querySelectorAll('[data-head-panel]').forEach((panel, i) => {
      const config = sections[i];
      if (!config) return;
      const [cols, records, empty, tableOptions = {}] = config;
      const rows = records || [];
      const slot = panel.querySelector('[data-head-panel-table]');
      const search = panel.querySelector('[data-head-search]');
      const facet = panel.querySelector('[data-head-facet]');
      const count = panel.querySelector('[data-head-count]');
      const indicator = panel.querySelector('[data-head-filter-count]');
      let filtered = rows;
      let sort = 'default';
      const draw = () => {
        const term = search.value.trim().toLocaleLowerCase();
        const chosen = facet?.value || '';
        const field = ['status','truck_type','person_type','availability','severity']
          .find(key => cols.some(column => column[1] === key));
        filtered = rows.filter(row => (!chosen || row[field] === chosen)
          && (!term || cols.some(column => String(row[column[1]] ?? '').toLocaleLowerCase().includes(term))));
        if (sort !== 'default') {
          const key = cols[0][1];
          filtered = [...filtered].sort((a,b) => (sort === 'asc' ? 1 : -1)
            * String(a[key] ?? '').localeCompare(String(b[key] ?? ''),undefined,{numeric:true}));
        }
        slot.innerHTML = UI.table(cols,filtered,{...tableOptions,showAllColumns:true,viewSwitch:false,empty});
        count.textContent = filtered.length === rows.length ? rows.length + ' records' : filtered.length + ' of ' + rows.length + ' records';
        if (indicator) indicator.textContent = chosen ? '(1)' : '';
        UI.activate(slot);
        this.finishTable(slot);
      };
      search.addEventListener('input',draw);
      RecordComponents.bindDropdowns(panel,{
        apply: () => { draw(); panel.querySelector('.record-workspace-filter-trigger')?.click(); },
        reset: () => { if(facet) facet.value=''; draw();panel.querySelector('.record-workspace-filter-trigger')?.click(); },
        sort: value => {sort=value;draw();}
      },{filter:facet?.closest('.record-workspace-popover')?.id || 'head-no-filter',sort:panel.querySelector('.record-workspace-sort-panel').id});
      panel.querySelector('[data-head-export]').addEventListener('click', () => {
        if (tableOptions.exportRows) tableOptions.exportRows(filtered);
        else this.csv(filtered,cols,panel.querySelector('h2').textContent);
      });
      draw();
    });
  },
  note() {
    return '<p class="small text-muted mb-3">Company-wide monitoring only. Changes to Trucks, Drivers, Helpers and Mechanics are handled by their assigned departments.</p>';
  }
};
App.page('head-fleet',{
  title:'Fleet & Personnel Status',
  subtitle:'Read-only truck, driver, helper and mechanic activity.',
  render(ctx) {
    const d=ctx.data||{};
    ctx.el.innerHTML=HeadOversight.note()
      +HeadOversight.panel('Trucks',
        [['Truck','plate_number'],['Type','truck_type'],['Status','status','badge'],['Driver','driver_name'],['Helper','helper_name'],['Current Trip','active_trip']],
        d.vehicles,'No truck records available.')
      +HeadOversight.panel('Drivers & Helpers',
        [['Name','full_name'],['Role','person_type'],['Availability','availability','badge'],['Regular Truck','regular_truck'],['Active','active',v=>Number(v)===1?'Yes':'No']],
        d.personnel,'No personnel records available.')
      +HeadOversight.panel('Mechanics',
        [['Name','full_name'],['Active Jobs','open_jobs'],['Active','active',v=>Number(v)===1?'Yes':'No']],
        d.mechanics,'No mechanics recorded.');
    HeadOversight.mount(ctx.el,[
      [[['Truck','plate_number'],['Type','truck_type'],['Status','status','badge'],['Driver','driver_name'],['Helper','helper_name'],['Current Trip','active_trip']],d.vehicles,'No truck records available.'],
      [[['Name','full_name'],['Role','person_type'],['Availability','availability','badge'],['Regular Truck','regular_truck'],['Active','active',v=>Number(v)===1?'Yes':'No']],d.personnel,'No personnel records available.'],
      [[['Name','full_name'],['Active Jobs','open_jobs'],['Active','active',v=>Number(v)===1?'Yes':'No']],d.mechanics,'No mechanics recorded.']
    ]);
    UI.activate(ctx.el);
  }
});
App.page('head-approvals',{
  title:'Approvals & Exceptions',
  subtitle:'Company-wide decisions and unresolved issues.',
  render(ctx) {
    const d=ctx.data||{};
    ctx.el.innerHTML='<p class="small text-muted mb-3">These are monitoring queues, not universal approval permissions. Open the relevant departmental page for authorized actions.</p>'
      +HeadOversight.panel('Route rates awaiting approval',
        [['Route','route_ref'],['Client','company_name'],['Origin','origin_label'],['Destination','destination_label'],['Proposed Rate','rate_amount','money']],
        d.route_rates,'No route rates pending approval.')
      +HeadOversight.panel('Open maintenance work',
        [['Job','job_ref'],['Truck','plate_number'],['Status','status','badge'],['Problem','problem']],
        d.maintenance,'No open maintenance jobs.')
      +HeadOversight.panel('Unresolved incidents',
        [['Incident','incident_ref'],['Trip','trip_ref'],['Status','status','badge']],
        d.incidents,'No unresolved incidents.')
      +HeadOversight.panel('Trip fund requests awaiting department review',
        [['Fund','fund_ref'],['Trip','trip_ref'],['Status','status','badge']],
        d.funds,'No fund requests awaiting approval.');
    HeadOversight.mount(ctx.el,[
      [[['Route','route_ref'],['Client','company_name'],['Origin','origin_label'],['Destination','destination_label'],['Proposed Rate','rate_amount','money']],d.route_rates,'No route rates pending approval.'],
      [[['Job','job_ref'],['Truck','plate_number'],['Status','status','badge'],['Problem','problem']],d.maintenance,'No open maintenance jobs.'],
      [[['Incident','incident_ref'],['Trip','trip_ref'],['Status','status','badge']],d.incidents,'No unresolved incidents.'],
      [[['Fund','fund_ref'],['Trip','trip_ref'],['Status','status','badge']],d.funds,'No fund requests awaiting approval.']
    ]);
    UI.activate(ctx.el);
  }
});


/* The executive trip page is separate from Operations Head's creation and
 * Dispatcher workflows. Only read-only HeadManagement APIs are used. */
const HeadTripsUI = {
  item(value) { return value == null || value === '' ? '—' : UI.esc(String(value)); },
  date(value) { return value ? UI.datetime(value) : '—'; },
  status(value) { return value ? UI.badge(value) : '—'; },
  delayed(trip) {
    return ['Pending Review','Awaiting Resources','Pre-Assigned','Ready for Dispatch'].includes(trip.status)
      && Boolean(trip.scheduled_at)
      && new Date(String(trip.scheduled_at).replace(' ','T')).getTime() < Date.now();
  },
  issue(trip) {
    const issues = [];
    if (this.delayed(trip)) issues.push('Past schedule');
    if (Number(trip.open_incidents) > 0) issues.push(trip.open_incidents + ' open incident(s)');
    if (['For Reschedule', 'On Hold - Incident Reported'].includes(trip.status)) issues.push(trip.status);
    return issues.length ? issues.map(v => UI.badge(v)).join(' ') : '—';
  },
  async details(id) {
    try {
      const result = await App.api('HeadManagement.trip_details', {trip_id:id});
      const data = result || {};
      const t = data.trip;
      if (!t) throw new Error('Trip details are unavailable.');
      const e = v => HeadTripsUI.item(v);
      const events = data.events || [];
      const updates = data.updates || [];
      const incidents = data.incidents || [];
      const detailHtml =
        '<p class="small text-muted">Monitoring only. Trip changes are handled by the Operations Head and assigned Dispatcher.</p>'
        + '<h6>Trip & Route</h6>' + UI.kv([
          ['Status',HeadTripsUI.status(t.status)],
          ['Client',e(t.client)],
          ['Pickup',e(t.pickup_point)],
          ['Destination',e(t.delivery_point)],
          ['Truck type',e(t.truck_type)],
          ['Scheduled departure',HeadTripsUI.date(t.scheduled_at)],
          ['Actual dispatch',HeadTripsUI.date(t.dispatched_at)],
          ['Completed',HeadTripsUI.date(t.completed_at)]
        ])
        + '<h6 class="mt-3">Assigned Resources</h6>' + UI.kv([
          ['Truck',e(t.plate_number)],
          ['Driver',e(t.driver_name)],
          ['Second driver',e(t.driver2_name)],
          ['Helper',e(t.helper_name)],
          ['Responsible Dispatcher',e(t.dispatcher_name)],
          ['Dispatcher shift',e(t.dispatcher_shift)]
        ])
        + '<h6 class="mt-3">Trip Fund & Completion</h6>' + UI.kv([
          ['Fund status',e(t.fund_status)],
          ['Fund amount',t.fund_amount == null ? '—' : UI.money(t.fund_amount)],
          ['Delivery notes',e(t.delivery_notes)]
        ])
        + '<h6 class="mt-3">Activity Timeline</h6>'
        + HeadOversight.panel('Trip events',
          [['Time','created_at','datetime'],['Event','event_type'],['Previous','from_status'],['New','to_status'],['Performed by','actor'],['Notes','notes']],
          events,'No trip events recorded.',false)
        + HeadOversight.panel('Progress & delays',
          [['Time','created_at','datetime'],['Type','update_type'],['Cause','delay_cause'],['Updated by','actor'],['Notes','note']],
          updates,'No progress updates recorded.',false)
        + HeadOversight.panel('Incidents',
          [['Reference','incident_ref'],['Status','status','badge'],['Severity','severity'],['Date and time','incident_at','datetime'],['Issue','problem']],
          incidents,'No incidents reported.',false);
      UI.drawer('Trip ' + e(t.trip_ref), detailHtml, {subtitle:e(t.client)});
    } catch(error) {
      UI.toast(error.message || 'Unable to load trip details.','error');
    }
  },
  columns() {
    return [
      ['Trip / Client','trip_ref',(value,row)=>'<strong>'+UI.esc(value||'—')+'</strong><div class="cell-sub">'+UI.esc(row.client||'—')+'</div>'],
      ['Route / Truck','pickup_point',(value,row)=>'<strong>'+UI.esc(value||'—')+'</strong> → '+UI.esc(row.delivery_point||'—')+'<div class="cell-sub">'+UI.esc(row.plate_number||'—')+'</div>'],
      ['Scheduled Dispatch','scheduled_at','datetime'],
      ['Status','status','badge'],
      ['Issues','_issues',(_,row)=>HeadTripsUI.issue(row)]
    ];
  },
  /** Route preview is a saved road shape, never a live vehicle tracker. */
  mountRoutePreview(root, trip) {
    const box=root.querySelector('[data-head-route-map]');
    if (!box || !trip?.route_geometry) return;
    try {
      UI.routeMap(box,trip,{
        a:[Number(trip.pickup_lat),Number(trip.pickup_lng)],
        b:[Number(trip.delivery_lat),Number(trip.delivery_lng)],
        aLabel:'Pickup: '+trip.pickup_point,
        bLabel:'Destination: '+trip.delivery_point,
        geometry:trip.route_geometry
      });
    } catch(error) {
      box.innerHTML='<p class="small text-muted p-3">Saved road route could not be displayed.</p>';
    }
  },
  /** Only rows already visible in a monitoring tab are exported. No server writes. */
  exportRows(rows) {
    const cols=[
      ['Trip No.','trip_ref'],['Client','client'],['Pickup','pickup_point'],
      ['Destination','delivery_point'],['Truck','plate_number'],['Driver','driver_name'],
      ['Helper','helper_name'],['Dispatcher','dispatcher_name'],['Schedule','scheduled_at'],
      ['Status','status'],['Open incidents','open_incidents']
    ];
    const quote=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+\-@]/,x=>"'"+x)+'"';
    const csv='\uFEFF'+[cols.map(([n])=>quote(n)).join(','),...rows.map(row=>cols.map(([,key])=>quote(row[key])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='mulawin_trip_monitoring_'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  renderTripTable(body, rows, empty) {
    const cols = HeadTripsUI.columns();
    body.innerHTML = HeadOversight.panel('Company Trip Records',cols,rows,empty);
    HeadOversight.mount(body,[[cols,rows,empty,{
      actions:()=>UI.btn('view','View Details','outline-primary'),
      onAction:(_,trip)=>HeadTripsUI.details(trip.id),
      rowClick:trip=>HeadTripsUI.details(trip.id),
      exportRows:filtered=>HeadTripsUI.exportRows(filtered)
    }]]);
    const panel=body.querySelector('[data-head-panel]');
    const tools=panel.querySelector('.head-monitor-tools');
    const filters=panel.querySelector('.record-workspace-popovers');
    const filterBtn=panel.querySelector('.record-workspace-filter-trigger');
    if(!filterBtn) return;
    const popover=panel.querySelector('#'+filterBtn.getAttribute('aria-controls'));
    const statuses=[...new Set(rows.map(row=>row.status).filter(Boolean))].sort();
    const types=[...new Set(rows.map(row=>row.truck_type).filter(Boolean))].sort();
    // Additional trip-specific fields are inside the existing filter panel.
    const choices = values=>values.map(value=>'<option value="'+UI.esc(value)+'">'+UI.esc(value)+'</option>').join('');
    const select=popover.querySelector('[data-head-facet]');
    if (select) {
      select.replaceWith(document.createRange().createContextualFragment(
        '<label>Trip status<select class="form-select form-select-sm" data-head-trip-status><option value="">All statuses</option>'+choices(statuses)+'</select></label>'
        +'<label>Truck type<select class="form-select form-select-sm" data-head-trip-type><option value="">All truck types</option>'+choices(types)+'</select></label>'
        +'<label>Scheduled date<input class="form-control form-control-sm" type="date" data-head-date></label>'
      ));
    }
    // Keep the common table shell while applying all three trip filters
    // to the same displayed and exported rows.
    const status=popover.querySelector('[data-head-trip-status]');
    const type=popover.querySelector('[data-head-trip-type]');
    const date=popover.querySelector('[data-head-date]');
    const originalRows=rows;
    const search=panel.querySelector('[data-head-search]');
    const slot=panel.querySelector('[data-head-panel-table]');
    const count=panel.querySelector('[data-head-count]');
    const indicator=panel.querySelector('[data-head-filter-count]');
    let selectedSort='default',filtered=originalRows;
    const render=()=>{
      const query=search.value.trim().toLocaleLowerCase();
      filtered=originalRows.filter(row=>(!status.value||row.status===status.value)
        &&(!type.value||row.truck_type===type.value)
        &&(!date.value||String(row.scheduled_at||'').slice(0,10)===date.value)
        &&(!query||['trip_ref','client','pickup_point','delivery_point','plate_number','driver_name','helper_name','dispatcher_name','status']
          .some(key=>String(row[key]??'').toLocaleLowerCase().includes(query))));
      if(selectedSort!=='default')filtered=[...filtered].sort((a,b)=>(selectedSort==='asc'?1:-1)*String(a.trip_ref??'').localeCompare(String(b.trip_ref??''),undefined,{numeric:true}));
      slot.innerHTML=UI.table(cols,filtered,{showAllColumns:true,viewSwitch:false,empty,
        actions:()=>UI.btn('view','View Details','outline-primary'),
        onAction:(_,trip)=>HeadTripsUI.details(trip.id),
        rowClick:trip=>HeadTripsUI.details(trip.id)});
      count.textContent=filtered.length===rows.length?rows.length+' records':filtered.length+' of '+rows.length+' records';
      const n=[status.value,type.value,date.value].filter(Boolean).length;
      indicator.textContent=n?'('+n+')':'';
      UI.activate(slot);
      HeadOversight.finishTable(slot);
    };
    // Replace the default workspace handlers to support the three trip fields.
    const replacement=panel.cloneNode(true);
    panel.replaceWith(replacement);
    const newSearch=replacement.querySelector('[data-head-search]');
    const newStatus=replacement.querySelector('[data-head-trip-status]');
    const newType=replacement.querySelector('[data-head-trip-type]');
    const newDate=replacement.querySelector('[data-head-date]');
    const newSlot=replacement.querySelector('[data-head-panel-table]');
    const newCount=replacement.querySelector('[data-head-count]');
    const newIndicator=replacement.querySelector('[data-head-filter-count]');
    const draw=()=>{
      const term=newSearch.value.trim().toLocaleLowerCase();
      filtered=rows.filter(row=>(!newStatus.value||row.status===newStatus.value)
        &&(!newType.value||row.truck_type===newType.value)
        &&(!newDate.value||String(row.scheduled_at||'').slice(0,10)===newDate.value)
        &&(!term||['trip_ref','client','pickup_point','delivery_point','plate_number','driver_name','helper_name','dispatcher_name','status']
          .some(key=>String(row[key]??'').toLocaleLowerCase().includes(term))));
      if(selectedSort!=='default')filtered=[...filtered].sort((a,b)=>(selectedSort==='asc'?1:-1)*String(a.trip_ref??'').localeCompare(String(b.trip_ref??''),undefined,{numeric:true}));
      newSlot.innerHTML=UI.table(cols,filtered,{showAllColumns:true,viewSwitch:false,empty,
        actions:()=>UI.btn('view','View Details','outline-primary'),
        onAction:(_,trip)=>HeadTripsUI.details(trip.id),
        rowClick:trip=>HeadTripsUI.details(trip.id)});
      newCount.textContent=filtered.length===rows.length?rows.length+' records':filtered.length+' of '+rows.length+' records';
      const n=[newStatus.value,newType.value,newDate.value].filter(Boolean).length;
      newIndicator.textContent=n?'('+n+')':'';
      UI.activate(newSlot);
      HeadOversight.finishTable(newSlot);
    };
    newSearch.oninput=draw;
    RecordComponents.bindDropdowns(replacement,{
      apply:()=>{draw();replacement.querySelector('.record-workspace-filter-trigger').click();},
      reset:()=>{newStatus.value='';newType.value='';newDate.value='';draw();replacement.querySelector('.record-workspace-filter-trigger').click();},
      sort:value=>{selectedSort=value;draw()}
    },{filter:replacement.querySelector('.record-workspace-filter-trigger').getAttribute('aria-controls'),sort:replacement.querySelector('.record-workspace-sort-panel').id});
    replacement.querySelector('[data-head-export]').onclick=()=>HeadTripsUI.exportRows(filtered);
    draw();
  },
  render(ctx) {
    const d=ctx.data||{}, summary=d.summary||{};
    const active=d.active||[],history=d.history||[],incidents=d.incidents||[];
    const count=key=>Number(summary[key]||0);
    const statusOf=t=>t.status==='Completed'?'Completed':
      ['Dispatched','In Transit','On Hold - Incident Reported'].includes(t.status)?'On Trip':
      ['Cancelled','Rejected'].includes(t.status)?'Closed':'Scheduled';
    const buckets=['Completed','On Trip','Scheduled','Closed'];
    const all=[...active,...history];
    const values=buckets.map(label=>all.filter(t=>statusOf(t)===label).length);
    const total=values.reduce((n,v)=>n+v,0);
    const route=d.route_preview;
    const chart=UI.chartHtml({
      title:'Trip Operations Overview',
      type:'doughnut',
      labels:buckets,
      datasets:[{label:'Trips',data:values}],
      how:'Company-wide stored trip records. Delays and incidents can overlap these categories.'
    });
    const mapPanel=UI.card('Saved Road Route Preview',route
      ? '<div class="head-route-map" data-head-route-map></div>'
        +'<div class="head-map-caption"><b>'+UI.esc(route.trip_ref)+'</b> · '
        +UI.esc(route.pickup_point)+' → '+UI.esc(route.delivery_point)
        +'<p class="mb-0 small text-muted">Saved road geometry only — not real-time truck tracking.</p></div>'
      : '<div class="head-route-empty"><i class="bi bi-geo-alt" aria-hidden="true"></i><strong>No saved map route available</strong><span>Routes appear here only when verified road geometry is stored. No GPS location is inferred.</span></div>');
    ctx.el.innerHTML='<div class="head-trip-dashboard">'
      +'<div class="head-trip-intro"><span><i class="bi bi-truck" aria-hidden="true"></i> Company-wide operations overview</span><span class="small text-muted"><i class="bi bi-eye" aria-hidden="true"></i> Read-only · Saved operational records</span></div>'
      +'<div class="head-trip-kpis">'+[
        ['Scheduled / Preparing',count('scheduled'),'bi-calendar-check','blue'],
        ['On Trip / In Transit',count('ongoing'),'bi-truck','green'],
        ['Completed Today',count('completed_today'),'bi-check-circle','purple'],
        ['Delayed / Problem',count('delayed_problem'),'bi-exclamation-triangle','red']
      ].map(([title,value,icon,tone])=>'<div class="head-kpi '+tone+'"><div class="head-kpi-icon"><i class="bi '+icon+'" aria-hidden="true"></i></div><div><span>'+UI.esc(title)+'</span><strong>'+value+'</strong></div></div>').join('')
      +'</div><div class="head-trip-overview"><div class="head-trip-chart">'+chart
      +'<div class="head-chart-total">'+total+' total trip'+(total===1?'':'s')+'</div></div><div class="head-trip-map">'+mapPanel+'</div></div>'
      +'<section class="head-trip-records"><div data-head-trip-tabs></div></section></div>';
    const root=ctx.el.querySelector('[data-head-trip-tabs]');
    const tabs=[
      ['active','Active & Scheduled ('+active.length+')',body=>HeadTripsUI.renderTripTable(body,active,'No active or scheduled trips.')],
      ['history','Trip History',body=>HeadTripsUI.renderTripTable(body,history,'No completed or closed trips.')],
      ['incidents','Incidents ('+incidents.filter(x=>x.status!=='Resolved').length+' open)',body=>{
        const cols=[
          ['Incident','incident_ref'],['Trip','trip_ref'],['Client','client'],
          ['Truck','plate_number'],['Status','status','badge'],
          ['Severity','severity'],['Reported','incident_at','datetime']
        ];
        body.innerHTML=HeadOversight.panel('Reported Trip Incidents',cols,incidents,'No incidents reported.');
        HeadOversight.mount(body,[[cols,incidents,'No incidents reported.',{
          actions:()=>UI.btn('view','View Trip','outline-primary'),
          onAction:(_,incident)=>HeadTripsUI.details(incident.trip_id)
        }]]);
      }]

    ];
    UI.tabs(root,tabs,ctx.query?.tab||'active');
    UI.activate(ctx.el);
    if(route) HeadTripsUI.mountRoutePreview(ctx.el,route);
    if(Object.keys(d._errors||{}).length) UI.toast('Some monitoring data could not be loaded. Check the server log.','error');
  }
};
App.page('head-trips',{
  title:'Trip Monitoring',
  subtitle:'Company-wide trip progress, assignments, delays and history — read-only.',
  render(ctx){ HeadTripsUI.render(ctx); }
});
