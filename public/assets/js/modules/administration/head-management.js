/* Head Management read-only oversight. Actions stay with their owning departments. */
'use strict';
const HeadOversight = {
  panel(title, cols, rows, empty, interactive = true) {
    const records = rows || [];
    if (!interactive) return '<section class="card mb-3"><div class="card-body"><h2 class="h6 mb-3">'+UI.esc(title)+'</h2>'
      +UI.table(cols,records,{showAllColumns:true,viewSwitch:false,empty})+'</div></section>';
    const facet = ['status','truck_type','person_type','availability','severity']
      .find(key => cols.some(column => column[1] === key));
    const options = facet ? [...new Set(records.map(row => row[facet]).filter(Boolean))].sort() : [];
    const id = 'head-filter-' + (++this.panelId);
    return '<section class="card mb-3 head-monitor-panel" data-head-panel>'
      + '<div class="card-body"><div class="head-monitor-heading"><h2 class="h6 mb-0">'+UI.esc(title)+'</h2>'
      + '<span class="small text-muted" data-head-count>'+records.length+' records</span></div>'
      + '<div class="head-monitor-tools record-workspace-search">'
      + '<input type="search" class="form-control form-control-sm head-monitor-search" data-head-search placeholder="Search records..." aria-label="Search '+UI.esc(title)+'">'
      + (facet ? '<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="'+id+'" aria-expanded="false"><i class="bi bi-funnel"></i> Filters <span data-head-filter-count></span></button>'
        + '<div class="record-workspace-popovers"><div class="record-workspace-popover" id="'+id+'" hidden>'
        + '<strong>Filter '+UI.esc(title)+'</strong><label>'+UI.esc(facet.replace(/_/g,' '))+'<select class="form-select form-select-sm" data-head-facet>'
        + '<option value="">All</option>'+options.map(value => '<option value="'+UI.esc(value)+'">'+UI.esc(value)+'</option>').join('')+'</select></label>'
        + '<div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
        + '<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div></div>' : '')
      + '<button type="button" class="btn btn-sm btn-outline-secondary" data-head-reset>Clear</button>'
      + '</div><div data-head-panel-table></div></div></section>';
  },
  panelId: 0,
  mount(root, sections) {
    root.querySelectorAll('[data-head-panel]').forEach((panel, i) => {
      const config = sections[i];
      if (!config) return;
      const [cols, records, empty] = config;
      const rows = records || [];
      const slot = panel.querySelector('[data-head-panel-table]');
      const search = panel.querySelector('[data-head-search]');
      const facet = panel.querySelector('[data-head-facet]');
      const count = panel.querySelector('[data-head-count]');
      const indicator = panel.querySelector('[data-head-filter-count]');
      const draw = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const selected = facet?.value || '';
        const field = ['status','truck_type','person_type','availability','severity']
          .find(key => cols.some(column => column[1] === key));
        const filtered = rows.filter(row =>
          (!selected || row[field] === selected) &&
          (!query || cols.some(column => String(row[column[1]] ?? '').toLocaleLowerCase().includes(query))));
        slot.innerHTML = UI.table(cols,filtered,{showAllColumns:true,viewSwitch:false,empty});
        count.textContent = filtered.length + ' of ' + rows.length + ' records';
        if (indicator) indicator.textContent = selected ? '(1)' : '';
        UI.activate(slot);
      };
      search.addEventListener('input',draw);
      panel.querySelector('[data-head-reset]').addEventListener('click', () => {
        search.value = '';
        if (facet) facet.value = '';
        draw();
      });
      if (facet) RecordComponents.bindDropdowns(panel,{
        apply: () => { draw(); panel.querySelector('.record-workspace-filter-trigger').click(); },
        reset: () => { facet.value = ''; draw(); panel.querySelector('.record-workspace-filter-trigger').click(); }
      },{filter:facet.closest('.record-workspace-popover').id,sort:'head-no-sort'});
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
  table(rows, empty) {
    return UI.table([
      ['Trip','trip_ref'], ['Client','client'], ['Pickup','pickup_point'],
      ['Destination','delivery_point'], ['Truck','plate_number'],
      ['Driver','driver_name'], ['Helper','helper_name'],
      ['Dispatcher','dispatcher_name'], ['Schedule','scheduled_at','datetime'],
      ['Status','status','badge'], ['Issues','_issues',(_,trip) => HeadTripsUI.issue(trip)]
    ], rows, {
      title:'Company Trip Records',
      showAllColumns:true,
      viewSwitch:false,
      actions:() => UI.btn('view','View Details','outline-primary'),
      onAction:(_,trip) => HeadTripsUI.details(trip.id),
      rowClick:(trip) => HeadTripsUI.details(trip.id),
      empty
    });
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
    const statuses = [...new Set(rows.map(x=>x.status).filter(Boolean))].sort();
    const types = [...new Set(rows.map(x=>x.truck_type).filter(Boolean))].sort();
    const choices = (values) => values.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('');
    const filterId = 'head-trip-filter-' + (++HeadOversight.panelId);
    body.innerHTML = '<div class="head-trip-toolbar record-workspace-search">'
      + '<input type="search" class="form-control form-control-sm head-monitor-search" data-head-search aria-label="Search trips" placeholder="Search trip, client, truck...">'
      + '<button class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" type="button" aria-expanded="false" aria-controls="'+filterId+'"><i class="bi bi-sliders"></i> Filters <span data-head-filter-count></span></button>'
      + '<div class="record-workspace-popovers"><div class="record-workspace-popover" id="'+filterId+'" hidden>'
      + '<strong>Filter trips</strong>'
      + '<label>Trip status<select class="form-select form-select-sm" data-head-status><option value="">All statuses</option>'+choices(statuses)+'</select></label>'
      + '<label>Truck type<select class="form-select form-select-sm" data-head-type><option value="">All truck types</option>'+choices(types)+'</select></label>'
      + '<label>Schedule date<input type="date" class="form-control form-control-sm" data-head-date aria-label="Filter by scheduled date"></label>'
      + '<div class="record-workspace-popover-actions"><button class="btn btn-sm btn-outline-secondary" data-record-filter-reset type="button">Clear</button>'
      + '<button class="btn btn-sm btn-primary" data-record-filter-apply type="button">Apply filters</button></div></div></div>'
      + '<button class="btn btn-sm btn-outline-secondary" data-head-reset type="button"><i class="bi bi-arrow-counterclockwise"></i> Clear</button>'
      + '<button class="btn btn-sm btn-outline-success ms-auto" data-head-export type="button"><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>'
      + '</div><div class="head-monitor-results" data-head-visible-count></div><div data-head-trip-list></div>';
    const slot = body.querySelector('[data-head-trip-list]');
    const search = body.querySelector('[data-head-search]');
    const status = body.querySelector('[data-head-status]');
    const type = body.querySelector('[data-head-type]');
    const date = body.querySelector('[data-head-date]');
    let filtered = rows;
    const draw = () => {
      const term = search.value.trim().toLocaleLowerCase();
      filtered = rows.filter(t=>(!status.value || t.status===status.value)
        && (!type.value || t.truck_type===type.value)
        && (!date.value || String(t.scheduled_at||'').slice(0,10)===date.value)
        && (!term || ['trip_ref','client','pickup_point','delivery_point','plate_number','driver_name','helper_name','dispatcher_name','status']
          .some(key=>String(t[key]??'').toLocaleLowerCase().includes(term))));
      slot.innerHTML = HeadTripsUI.table(filtered,empty);
      body.querySelector('[data-head-visible-count]').textContent = filtered.length+' of '+rows.length+' trip records';
      const count = [status.value,type.value,date.value].filter(Boolean).length;
      body.querySelector('[data-head-filter-count]').textContent = count ? '('+count+')' : '';
      UI.activate(slot);
    };
    search.addEventListener('input',draw);
    const clear=()=>{search.value='';status.value='';type.value='';date.value='';draw();};
    body.querySelector('[data-head-reset]').onclick=clear;
    RecordComponents.bindDropdowns(body,{
      apply:()=>{draw();body.querySelector('.record-workspace-filter-trigger').click();},
      reset:()=>{status.value='';type.value='';date.value='';draw();body.querySelector('.record-workspace-filter-trigger').click();}
    },{filter:filterId,sort:'head-no-sort'});
    body.querySelector('[data-head-export]').onclick=()=>HeadTripsUI.exportRows(filtered);
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
        body.innerHTML=UI.table([
          ['Incident','incident_ref'],['Trip','trip_ref'],['Client','client'],
          ['Truck','plate_number'],['Status','status','badge'],['Severity','severity'],
          ['Reported','incident_at','datetime']
        ],incidents,{
          title:'Reported Trip Incidents',showAllColumns:true,viewSwitch:false,
          actions:()=>UI.btn('view','View Trip','outline-primary'),
          onAction:(_,incident)=>HeadTripsUI.details(incident.trip_id),
          empty:'No incidents reported.'
        });
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
