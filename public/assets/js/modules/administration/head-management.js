/* Head Management read-only oversight. Actions stay with their owning departments. */
'use strict';
const HeadOversight = {
  panel(title, cols, rows, empty) {
    return '<section class="card mb-3"><div class="card-body"><h2 class="h6 mb-3">'+UI.esc(title)+'</h2>'
      +UI.table(cols,rows||[],{showAllColumns:true,viewSwitch:false,empty})+'</div></section>';
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
          events,'No trip events recorded.')
        + HeadOversight.panel('Progress & delays',
          [['Time','created_at','datetime'],['Type','update_type'],['Cause','delay_cause'],['Updated by','actor'],['Notes','note']],
          updates,'No progress updates recorded.')
        + HeadOversight.panel('Incidents',
          [['Reference','incident_ref'],['Status','status','badge'],['Severity','severity'],['Date and time','incident_at','datetime'],['Issue','problem']],
          incidents,'No incidents reported.');
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
    const today = new Date();
    const day = [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    body.innerHTML = '<div class="head-trip-toolbar">'
      + '<label>Trip status<select class="form-select form-select-sm" data-head-status>'
      + '<option value="">All statuses</option>' + statuses.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('') + '</select></label>'
      + '<label>Truck type<select class="form-select form-select-sm" data-head-type>'
      + '<option value="">All truck types</option>' + types.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('') + '</select></label>'
      + '<label>Schedule date<input type="date" class="form-control form-control-sm" data-head-date aria-label="Filter by scheduled date"></label>'
      + '<button class="btn btn-sm btn-outline-secondary" data-head-reset type="button">Clear filters</button>'
      + '<button class="btn btn-sm btn-outline-success ms-auto" data-head-export type="button"><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>'
      + '</div><div data-head-trip-list></div>';
    const slot = body.querySelector('[data-head-trip-list]');
    let filtered = rows;
    const draw = () => {
      const status = body.querySelector('[data-head-status]').value;
      const type = body.querySelector('[data-head-type]').value;
      const date = body.querySelector('[data-head-date]').value;
      filtered = rows.filter(t=>(!status || t.status===status)
        && (!type || t.truck_type===type)
        && (!date || String(t.scheduled_at||'').slice(0,10)===date));
      slot.innerHTML = HeadTripsUI.table(filtered,empty);
      UI.activate(slot);
    };
    body.querySelectorAll('[data-head-status],[data-head-type],[data-head-date]').forEach(x=>x.onchange=draw);
    body.querySelector('[data-head-reset]').onclick=()=>{
      body.querySelectorAll('[data-head-status],[data-head-type],[data-head-date]').forEach(x=>x.value='');
      draw();
    };
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
