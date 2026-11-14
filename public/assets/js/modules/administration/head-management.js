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
