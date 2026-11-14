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
  renderTripTable(body, rows, empty) {
    const statuses = [...new Set(rows.map(x=>x.status).filter(Boolean))].sort();
    const types = [...new Set(rows.map(x=>x.truck_type).filter(Boolean))].sort();
    body.innerHTML = '<div class="board-tools mb-3 d-flex gap-2 flex-wrap">'
      + '<label class="small">Trip status <select class="form-select form-select-sm" data-head-status>'
      + '<option value="">All statuses</option>' + statuses.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('') + '</select></label>'
      + '<label class="small">Truck type <select class="form-select form-select-sm" data-head-type>'
      + '<option value="">All truck types</option>' + types.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('') + '</select></label>'
      + '</div><div data-head-trip-list></div>';
    const slot = body.querySelector('[data-head-trip-list]');
    const draw = () => {
      const status = body.querySelector('[data-head-status]').value;
      const type = body.querySelector('[data-head-type]').value;
      const filtered = rows.filter(t=>(!status || t.status===status) && (!type || t.truck_type===type));
      slot.innerHTML = HeadTripsUI.table(filtered,empty);
      UI.activate(slot);
    };
    body.querySelector('[data-head-status]').onchange = draw;
    body.querySelector('[data-head-type]').onchange = draw;
    draw();
  },
  render(ctx) {
    const d = ctx.data || {}, total = d.summary || {};
    const active = d.active || [], history = d.history || [], incidents = d.incidents || [];
    const count = key => Number(total[key] || 0);
    ctx.el.innerHTML = '<p class="small text-muted mb-3">Live company-wide trip monitoring. Operational planning, resource assignments and dispatch remain with the responsible teams.</p>'
      + UI.cards([
        {label:'Scheduled / Preparing',value:count('scheduled'),icon:'bi-calendar-check',color:'blue'},
        {label:'On Trip / Incident',value:count('ongoing'),icon:'bi-truck',color:'green'},
        {label:'Completed Today',value:count('completed_today'),icon:'bi-check-circle',color:'green'},
        {label:'Delayed / Problem',value:count('delayed_problem'),icon:'bi-exclamation-triangle',color:'red'}
      ])
      + '<div class="mt-3" data-head-trip-tabs></div>';
    const root = ctx.el.querySelector('[data-head-trip-tabs]');
    const tabs = [
      ['active','Active & Scheduled ('+active.length+')', body => {
        HeadTripsUI.renderTripTable(body,active,'No active or scheduled trips.');
      }],
      ['history','Trip History', body => {
        HeadTripsUI.renderTripTable(body,history,'No completed or closed trips.');
      }],
      ['incidents','Incidents ('+incidents.filter(x=>x.status!=='Resolved').length+' open)', body => {
        body.innerHTML = UI.table([
          ['Incident','incident_ref'],['Trip','trip_ref'],['Client','client'],
          ['Truck','plate_number'],['Status','status','badge'],['Severity','severity'],
          ['Reported','incident_at','datetime']
        ], incidents, {
          title:'Reported Trip Incidents',showAllColumns:true,viewSwitch:false,
          actions:()=>UI.btn('view','View Trip','outline-primary'),
          onAction:(_,incident)=>HeadTripsUI.details(incident.trip_id),
          empty:'No incidents reported.'
        });
      }]
    ];
    UI.tabs(root,tabs,ctx.query?.tab || 'active');
    UI.activate(ctx.el);
    const warnings = d._errors || [];
    if (Object.keys(warnings).length) UI.toast('Some trip monitoring records could not be loaded. Check the server log.','error');
  }
};
App.page('head-trips',{
  title:'Trip Monitoring',
  subtitle:'Company-wide trip progress, assignments, delays and history — read-only.',
  render(ctx){ HeadTripsUI.render(ctx); }
});
