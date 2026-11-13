/* Explicit, account-addressed turnover inside the existing Trips/monitoring workflows. */
'use strict';
const DispatcherTurnoverUI={
  async open(view='all'){
    try{
      const d=await App.api('Trips.turnover_list',{}),ops=UI.role('operations_head');
      if(!d.schema_ready)return UI.toast('Install and verify the additive turnover migration before using account responsibility.','error');
      const el=UI.drawer(ops?'Dispatcher Responsibility':view==='incoming'?'Incoming Turnovers':'Shift Turnover',
        '<p>Original trip assignments and recorded actors are preserved. Responsibility changes only after the named recipient accepts.</p><p class="small text-muted">Showing up to 500 recent turnovers. Search applies to the loaded history.</p>'+
        (!ops?'<div class="btn-group mb-3"><button class="btn btn-outline-secondary" data-incoming>Incoming Turnovers</button><button class="btn btn-outline-secondary" data-all-turnovers>All Turnovers</button></div>':'')+
        (ops?'<button class="btn btn-primary mb-3" data-initial>Assign Initial Dispatcher</button>':'<button class="btn btn-primary mb-3" data-endorse>Review Work for Turnover</button>')+
        UI.table([['Outgoing','outgoing_name'],['Incoming','incoming_name'],['Group','dispatcher_role',v=>UI.esc(App.me.roles?.[v]||v)],['Status','status',(v,r)=>UI.badge(r.current_status||v)+(r.current_status&&r.current_status!==v?'<div class="small text-muted">Endorsed: '+UI.esc(v)+'</div>':'')],['Endorsed','endorsed_at','datetime'],['Accepted','accepted_at','datetime']],view==='incoming'?d.rows.filter(h=>+h.incoming_id===+App.me.user.id):d.rows,{showAllColumns:true,actions:()=>UI.btn('view','View'),onAction:(a,r)=>this.details(r.id),empty:'No recorded turnovers.'}));
      if(ops)el.querySelector('[data-initial]').onclick=()=>{
        const form=UI.formModal('Assign Initial Responsible Dispatcher',[
          {name:'trip_id',label:'Unowned Trip',type:'select',required:true,options:(d.unowned||[]).map(t=>[t.id,t.trip_ref+' - '+t.truck_type]),col:12},
          {name:'dispatcher_id',label:'Responsible Account',type:'select',required:true,options:d.accounts.map(u=>[u.id,u.full_name+' - '+(App.me.roles?.[u.role]||u.role)+' / '+(u.shift||'Unspecified')]),col:12}
        ],'Trips.turnover_assign_initial',{after:()=>{this.open();App.route();},intro:'Choose an active account in the trip truck group. Initial assignment cannot overwrite an existing owner.'});
        const trip=form.querySelector('[name=trip_id]'),account=form.querySelector('[name=dispatcher_id]');
        const update=()=>{const selected=d.unowned.find(t=>String(t.id)===trip.value);[...account.options].forEach(o=>{const u=d.accounts.find(a=>String(a.id)===o.value);o.disabled=!!u&&!!selected&&u.role!==selected.dispatcher_role;});if(account.selectedOptions[0]?.disabled)account.value='';};trip.onchange=update;update();
      };
      else {el.querySelector('[data-endorse]').onclick=()=>this.preview(d.accounts);el.querySelector('[data-incoming]').onclick=()=>this.open('incoming');el.querySelector('[data-all-turnovers]').onclick=()=>this.open();}
    }catch(error){UI.toast(error.message,'error');}
  },
  records(rows,selected=null){const columns=[['Trip','trip_ref'],['Status','status',(v,r)=>UI.badge(r.current_status||v)+(r.current_status&&r.current_status!==v?'<div class="small text-muted">Endorsed: '+UI.esc(v)+'</div>':'')],['Truck / Personnel','truck_type',(v,r)=>UI.esc(v)+'<div>'+UI.esc(r.plate_number||'Unassigned Truck')+'</div><div>'+UI.esc([r.driver_name,r.driver2_name,r.helper_name].filter(Boolean).join(' / ')||'Personnel not assigned')+'</div>'],['Original Group','dispatcher_role',v=>UI.esc(App.me.roles?.[v]||v)],['Original Shift','dispatcher_shift'],['Scheduled','scheduled_at','datetime'],['Outstanding Work','holds',(v,r)=>UI.esc((v||[]).length+' resource hold(s)')+(r.fund_status?'<div>Fund: '+UI.esc(r.fund_status)+'</div>':'')+(r.status==='Completed'&&(v||[]).some(h=>h.resource_type==='vehicle')?'<div>Arrival inspection pending</div>':'')+(r.incidents||[]).filter(i=>i.status!=='Resolved').map(i=>'<div>'+UI.esc(i.incident_ref+' / '+i.status+(i.job_ref?' / '+i.job_ref+' / '+i.repair_status:''))+'</div>').join('')]];if(selected)columns.unshift(['Select','id',(v,r)=>'<input type="checkbox" class="form-check-input" data-turnover-trip="'+UI.esc(v)+'" aria-label="Select '+UI.esc(r.trip_ref)+'" '+(selected.has(+v)?'checked ':'')+(r.pending_turnover_id?'disabled':'')+'>'+(r.pending_turnover_id?'<div class="small text-muted">Pending #'+UI.esc(r.pending_turnover_id)+'</div>':'')]);return UI.table(columns,rows,{viewSwitch:false,showAllColumns:true,empty:'No eligible ongoing trips.'});},
  async preview(accounts){
    try{
      const d=await App.api('Trips.turnover_preview',{}),selected=new Set(),el=UI.drawer('Select Trips for Turnover',
        '<p>Select only the ongoing trips you want to endorse. Pending trips cannot be selected again.</p>'+this.records(d.rows,selected)+(d.rows.length?'<div class="form-check mt-3"><input type="checkbox" class="form-check-input" id="turnover-select-all" data-turnover-all><label class="form-check-label" for="turnover-select-all">Select all eligible trips</label></div><button class="btn btn-primary mt-3" data-submit-endorsement disabled>Review Selected Trips (0)</button>':''));
      const button=el.querySelector('[data-submit-endorsement]'),all=el.querySelector('[data-turnover-all]');
      const update=()=>{if(button){button.disabled=!selected.size;button.textContent='Review Selected Trips ('+selected.size+')';}if(all){const n=d.rows.filter(t=>!t.pending_turnover_id).length;all.checked=n>0&&selected.size===n;all.indeterminate=selected.size>0&&selected.size<n;}};
      el.addEventListener('change',event=>{const input=event.target;if(input.matches('[data-turnover-trip]')){input.checked?selected.add(+input.dataset.turnoverTrip):selected.delete(+input.dataset.turnoverTrip);update();}if(input.matches('[data-turnover-all]')){selected.clear();if(input.checked)d.rows.filter(t=>!t.pending_turnover_id).forEach(t=>selected.add(+t.id));el.querySelectorAll('[data-turnover-trip]').forEach(c=>c.checked=selected.has(+c.dataset.turnoverTrip));update();}});
      button?.addEventListener('click',()=>this.reviewSelected(accounts,[...selected]));
    }catch(error){UI.toast(error.message,'error');}
  },
  async reviewSelected(accounts,tripIds){
    try{
      const d=await App.api('Trips.turnover_preview',{trip_ids:tripIds}),el=UI.drawer('Review Selected Trips',this.records(d.rows)+'<button class="btn btn-primary mt-3" data-confirm-selected>Endorse Turnover</button>');
      el.querySelector('[data-confirm-selected]').onclick=()=>UI.formModal('Endorse Selected Trips',[
        {name:'incoming_id',label:'Incoming Dispatcher',type:'select',required:true,options:accounts.filter(u=>+u.id!==+App.me.user.id&&u.role===App.me.user.role).map(u=>[u.id,u.full_name+' / '+(u.shift||'Unspecified')]),col:12},
        {name:'remarks',label:'Turnover Remarks',type:'textarea',col:12}
      ],'Trips.turnover_endorse',{extra:{trip_ids:d.rows.map(t=>+t.id),fingerprint:d.fingerprint,request_key:UI.uuid()},after:()=>this.open(),intro:'Only these '+d.rows.length+' selected trip(s) will be endorsed: '+d.rows.map(t=>t.trip_ref).join(', ')+'. You retain responsibility until the named recipient accepts.'});
    }catch(error){UI.toast(error.message,'error');}
  },
  async details(id){
    try{
      const d=await App.api('Trips.turnover_details',{turnover_id:id}),h=d.turnover,
        canAccept=UI.isDispatcher()&&+h.incoming_id===+App.me.user.id&&h.status==='Pending';
      const current=new Map((d.current_rows||[]).map(t=>[+t.id,t.status])),rows=d.rows.map(t=>({...t,current_status:current.get(+t.id)}));
      const el=UI.drawer('Turnover #'+UI.esc(h.id),UI.kv([['Outgoing Account',UI.esc(h.outgoing_name||h.outgoing_id)],['Incoming Account',UI.esc(h.incoming_name||h.incoming_id)],['Status',UI.badge(h.status)],['Endorsed',UI.datetime(h.endorsed_at)],['Accepted',UI.datetime(h.accepted_at)],['Remarks',UI.e(h.remarks)]])+'<p>Current status is shown alongside the preserved endorsement snapshot. Acceptance covers every referenced trip.</p>'+this.records(rows)+(canAccept?'<button class="btn btn-primary mt-3" data-accept-turnover>Accept Turnover</button>':''));
      el.querySelector('[data-accept-turnover]')?.addEventListener('click',()=>UI.confirmAction('Accept Turnover','Accept responsibility for all referenced trips? Original assignments and trip statuses remain unchanged.','Trips.turnover_accept',{turnover_id:id},{after:()=>{this.open();App.route();}}));
    }catch(error){UI.toast(error.message,'error');}
  }
};
