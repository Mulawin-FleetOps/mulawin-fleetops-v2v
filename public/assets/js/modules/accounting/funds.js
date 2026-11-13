/* assets/js/modules/accounting/funds.js — TRIP FUNDS
   Dispatcher submits (or revises) the fund request; Operations Head approves or rejects;
   Finance releases (Confirm Release) and later records the liquidation.
   Printable REQUEST FOR CASH FUND form (PDF #13).
   Backend: backend/Modules/Accounting/Funds.php */
'use strict';
const FundUI = {
  async details(id) {
    let f;try{f=(await App.api('Funds.details',{fund_id:id})).fund;}catch(error){return UI.toast(error.message,'error');}
    const html=UI.fundProgress(f)+UI.h('Request')+UI.kv([['Reference',UI.e(f.fund_ref)],['Trip',UI.e(f.trip_ref)],['Client',UI.e(f.client)],['Truck',UI.e(f.plate_number)],['Trip status',UI.e(f.trip_status)],['Requested by',UI.e(f.requested_by_name)],['Amount',UI.money(f.amount)],['Status',UI.badge(f.status)],['Rejection reason',UI.e(f.rejected_reason)],['Notes',UI.e(f.notes)]])+UI.h('Breakdown')+UI.table([['Category','category_name'],['Amount','amount','money']],f.lines||[],{plain:true})+UI.h('Release & Liquidation')+UI.kv([['Approved by',UI.e(f.approved_by_name)],['Released by',UI.e(f.released_by_name)],['Voucher',UI.e(f.voucher_number)],['Payment method',UI.e(f.payment_method)],['Reference',UI.e(f.reference_number)],['Released',UI.datetime(f.released_at)],['Liquidation status',UI.e(f.liquidation_status)],['Spent',UI.money(f.liquidated_amount)],['Returned',UI.money(f.returned_amount)],['Liquidation notes',UI.e(f.liquidation_notes)]])+UI.h('Documents')+UI.docs(f.documents||[])+UI.h('Activity')+UI.activity(f.history||[]);
    const drawer=UI.drawer(UI.esc(f.fund_ref),html,{subtitle:'Read-only fund request'});
    UI.drawerSections(drawer,[['summary','Summary',['Request']],['breakdown','Expense Breakdown',['Breakdown']],['release','Release & Liquidation',['Release & Liquidation']],['docs','Documents',['Documents']],['history','Activity',['Activity']]],{key:'fund-details'});
  },
  async print(id) {
    let r; try { r = await App.api('Funds.details', { fund_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const f = r.fund;
    UI.printForm('REQUEST FOR CASH FUND', `<div class="pf-grid"><div><b>DEPARTMENT:</b> Operations (${UI.esc(UI.label(f.dispatcher_role))})</div><div><b>DATE:</b> ${UI.date(f.created_at)}</div>
      <div><b>NAME:</b> ${UI.esc(f.requested_by_name)}</div><div><b>TRIP:</b> ${UI.esc(f.trip_ref)} · ${UI.esc(f.plate_number || '')}</div>
      <div style="grid-column:1/3"><b>PURPOSE:</b> Trip allowance: ${UI.esc(f.client)}, ${UI.esc(f.pickup_point)} to ${UI.esc(f.delivery_point)} (${UI.datetime(f.scheduled_at)})${f.driver_name ? ', driver ' + UI.esc(f.driver_name) : ''}</div>
      <div style="grid-column:1/3"><b>AMOUNT REQUESTED:</b> ${UI.money(f.amount)}</div></div>
      <table><thead><tr><th>Expense category</th><th class="num">Amount</th></tr></thead><tbody>${f.lines.map(l => `<tr><td>${UI.esc(l.category_name)}${+l.is_preset ? '' : ' (added)'}</td><td class="num">${UI.money(l.amount)}</td></tr>`).join('')}
      <tr><th>TOTAL</th><th class="num">${UI.money(f.amount)}</th></tr></tbody></table>
      <div class="pf-note">NOTE: SUBJECT FOR LIQUIDATION</div><div><b>REMARKS:</b></div><div class="pf-box" style="min-height:34px">${UI.esc(f.notes || '')}</div>
      <div class="pf-signs">${UI.sign('Requested by', f.requested_by_name, f.requested_by, 'fund_request', f.id)}${UI.sign('Approved by (Operations Head)', f.approved_by_name || '', f.approved_by, 'fund_request', f.id)}</div>
      <div class="drawer-h mt-3">FOR ACCOUNTING USE</div>
      <div><b>ACCOUNTING REMARKS:</b></div><div class="pf-box" style="min-height:34px">${f.voucher_number ? 'Released ' + UI.date(f.released_on) + ' via ' + UI.esc(f.payment_method) + ', voucher ' + UI.esc(f.voucher_number) + (f.reference_number ? ', ref ' + UI.esc(f.reference_number) : '') + (f.cheque_number ? ', cheque ' + UI.esc(f.cheque_number) : '') : ''}
${f.liquidation_status === 'Liquidated' ? 'Liquidated: spent ' + UI.money(f.liquidated_amount) + ', returned ' + UI.money(f.returned_amount) : ''}</div>
      <div class="pf-signs">${UI.sign('Checked by (Finance)', f.released_by_name || '', f.released_by, 'fund_request', f.id)}${UI.sign('Approved by')}</div>`, { number: f.fund_ref });
  },
};

App.page('funds', {
  title: 'Trip Funds',
  subtitle: 'Trip allowance requests: dispatcher submits, Operations Head approves, Finance releases.',
  render(ctx) {
    const d = ctx.data;
    if (d.can.submit) {
      const b = document.createElement('button'); b.className = 'btn btn-sm btn-primary'; b.innerHTML = '<i class="bi bi-plus-lg"></i> New fund request';
      b.onclick = () => {
        if (!d.eligibleTrips.length) return UI.toast('No pre-assigned trip needs a fund request right now.', 'warn');
        UI.modal('New fund request', UI.fields([{ name: 'trip_id', label: 'Trip', type: 'select', required: true, col: 12, options: d.eligibleTrips.map(t => [t.id, `${t.trip_ref} · ${t.plate_number || ''} · ${t.pickup_point} → ${t.delivery_point}`]) }]),
          async (x) => { UI.fundForm({ title: 'Fund request', categories: d.categories, action: 'Funds.submit', payload: { trip_id: x.trip_id }, intro: 'Choose the applicable expenses. The system takes the preset amounts and computes the total.' }); },
          { size: '', submit: 'Continue' });
      };
      ctx.tools.append(b);
    }
    const n = (s) => d.funds.filter(f => f.status === s).length;
    const toLiq = d.funds.filter(f => f.status === 'Released' && f.liquidation_status === 'Not Liquidated' && ['Completed', 'Cancelled'].includes(f.trip_status));
    // Keep rejected requests actionable after retiring the All requests tab.
    const needsRevision = d.funds.filter(f => f.status === 'Rejected' && !['Completed', 'Cancelled', 'Rejected'].includes(f.trip_status));
    // Read-only/archive records: every request belongs to exactly one tab.
    const history = d.funds.filter(f => !['Pending Approval', 'Ready for Release'].includes(f.status) && !toLiq.includes(f) && !needsRevision.includes(f));
    const counts = [
      {label:'Pending Approval',value:n('Pending Approval'),color:'amber'},
      {label:'Awaiting Finance Release',value:n('Ready for Release'),color:'blue'},
      {label:'Needs Revision',value:needsRevision.length,color:'red'},
      {label:'Released',value:n('Released'),color:'green'},
    ];
    ctx.el.innerHTML = RecordComponents.kpis(counts);
    const cols = [['Fund', 'fund_ref'], ['Trip', 'trip_ref'], ['Client', 'client'], ['Truck', 'plate_number'], ['Breakdown', 'breakdown'], ['Amount', 'amount', 'money'],
      ['Status', 'status', 'badge'], ['Requested by', 'requested_by_name'], ['Request date', 'created_at', 'date']];
    const actions = (f) => {
      let h = UI.btn('details', 'View Details') + UI.btn('print', 'Print form', 'outline-secondary');
      if (UI.canGo('trips')) h += UI.btn('trip', 'View trip');
      if (d.can.approve && f.status === 'Pending Approval') h += UI.btn('approve', 'Approve', 'success') + UI.btn('reject', 'Reject', 'outline-danger');
      if (d.can.release && f.status === 'Ready for Release') {
        if (f.release_allowed_now) h += UI.btn('release', 'Confirm Release', 'primary');
        else h += `<span class="small text-muted" title="Refresh this page once the window opens"><i class="bi bi-clock"></i> Release opens ${UI.datetime(f.release_opens_at)} (PH time)</span>`;
      }
      if (d.can.release && f.status === 'Released' && f.liquidation_status === 'Not Liquidated' && ['Completed', 'Cancelled'].includes(f.trip_status)) h += UI.btn('liquidate', 'Liquidate', 'outline-primary');
      if (d.can.submit && f.status === 'Rejected' && !['Completed', 'Cancelled', 'Rejected'].includes(f.trip_status)) h += UI.btn('revise', 'Revise', 'primary');
      return h;
    };
    const onAction = async (a, f) => {
      if (a === 'details') return FundUI.details(f.id);
      if (a === 'print') FundUI.print(f.id);
      if (a === 'trip' && UI.canGo('trips')) App.go('trips', { tab: 'active', open: f.trip_id });
      if (a === 'approve') UI.confirmAction('Approve ' + UI.esc(f.fund_ref), `Approve ${UI.money(f.amount)} for ${UI.esc(f.trip_ref)}? It goes to Finance for release.<br><span class="small text-muted">${UI.esc(f.breakdown)}</span>`, 'Funds.decide', { fund_id: f.id, decision: 'approve' }, { submit: 'Approve' });
      if (a === 'reject') UI.confirmAction('Reject ' + UI.esc(f.fund_ref), 'The dispatcher must revise the request and submit it again.', 'Funds.decide', { fund_id: f.id, decision: 'reject' }, { danger: true, submit: 'Reject', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
      if (a === 'release') {
        if (!f.release_allowed_now) return UI.toast('Release is not yet allowed. Refresh this page when the release window opens.', 'error');
        // CHECKLIST_36_CASH_ONLY_TRIP_FUND_RELEASE_V1: cash only; the server records today's date (nothing to choose here).
        UI.confirmAction('Confirm release of ' + UI.esc(f.fund_ref),
          `Release <b>${UI.money(f.amount)}</b> in <b>cash</b> for ${UI.esc(f.trip_ref)} (${UI.esc(f.breakdown)}).`
          + `<br><span class="small text-muted">Payment method: Cash · Release date: recorded automatically as today (Philippine time). A payment voucher is generated.</span>`,
          'Funds.release', { fund_id: f.id }, { submit: 'Confirm Release' });
      }
      if (a === 'liquidate') UI.formModalFiles('Liquidation of ' + UI.esc(f.fund_ref), [
        { name: 'liquidated_amount', label: 'Actual expenses (₱)', type: 'money', required: true, col: 6, value: f.amount },
        { name: 'liquidation_notes', label: 'Notes', col: 6 }, { name: 'receipts', label: 'Receipts (optional)', type: 'file', multiple: true, col: 12 }],
        'Funds.liquidate', { extra: { fund_id: f.id }, intro: `Released: ${UI.money(f.amount)}. Returned cash = released minus spent.` });
      if (a === 'revise') { const r = await App.api('Trips.details', { trip_id: f.trip_id }); const old = r.funds.find(x => x.id == f.id);
        UI.fundForm({ title: 'Revise ' + f.fund_ref, categories: d.categories, action: 'Funds.submit', payload: { trip_id: f.trip_id }, selected: old.lines.filter(l => +l.is_preset).map(l => l.category_name),
          extra: old.lines.filter(l => !+l.is_preset).map(l => ({ name: l.category_name, amount: l.amount })), intro: 'Rejected because: ' + UI.esc(f.rejected_reason || '') }); }
    };
    const def = UI.role('operations_head') ? 'pending' : UI.role('finance') ? 'release' : d.can.submit ? 'revision' : 'history';
    const views = [
      {value:'pending',label:'Pending Approval',count:n('Pending Approval'),rows:d.funds.filter(f=>f.status==='Pending Approval'),empty:'Nothing waiting for approval.'},
      {value:'release',label:'To Release',count:n('Ready for Release'),rows:d.funds.filter(f=>f.status==='Ready for Release'),empty:'Nothing to release.'},
      {value:'liquidate',label:'For Liquidation',count:toLiq.length,rows:toLiq,empty:'Nothing for liquidation.',extra:[['Release Date','released_at','date'],['Voucher','voucher_number']]},
      {value:'revision',label:'Needs Revision',count:needsRevision.length,rows:needsRevision,empty:'No fund requests need revision.'},
      {value:'history',label:'History',count:history.length,rows:history,empty:'No historical fund requests.',extra:[['Liquidation','liquidation_status','badge'],['Voucher','voucher_number']]}
    ];
    const workspace=document.createElement('div');
    workspace.className='fund-approval-workspace';
    ctx.el.append(workspace);
    let active=views.find(v=>v.value===(ctx.query?.tab||def))||views[0];
    const renderView=()=>{
      const toolbar='<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="fund-filter-panel" aria-expanded="false"><i class="bi bi-funnel"></i> Filter</button>'
        +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" aria-controls="fund-sort-panel" aria-expanded="false"><i class="bi bi-arrow-down-up"></i> Sort</button>'
        +'<div class="record-workspace-popovers"><div id="fund-filter-panel" class="record-workspace-popover" hidden><strong>Filter Fund Requests</strong>'
        +'<label>Status<select name="status" class="form-select form-select-sm"><option value="">All statuses</option>'
        +[...new Set(active.rows.map(f=>f.status))].map(status=>'<option value="'+UI.esc(status)+'">'+UI.esc(status)+'</option>').join('')
        +'</select></label><div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button><button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
        +'<div id="fund-sort-panel" class="record-workspace-popover record-workspace-sort-panel" hidden><strong>Sort Requests</strong>'
        +[['newest','Newest first'],['oldest','Oldest first'],['amount-high','Highest amount'],['amount-low','Lowest amount']].map(([value,label],i)=>'<label class="record-workspace-sort-option"><input type="radio" name="fund_sort" data-record-sort value="'+value+'" '+(!i?'checked':'')+'> '+label+'</label>').join('')
        +'</div></div>';
      const tabs=RecordComponents.tabs(views.map(v=>({value:v.value,label:v.label+' ('+v.count+')'})),active.value,'data-fund-view');
      const compactCols=[
        ['Request / Trip','fund_ref',(value,f)=>'<b>'+UI.esc(value)+'</b><div class="cell-sub">'+UI.esc(f.trip_ref||'')+'</div>'],
        ['Dispatcher','requested_by_name'],
        ['Expense Categories','breakdown'],
        ['Amount','amount','money'],
        ['Requested','created_at','date'],
        ['Status','status','badge']
      ];
      const table=UI.table([...compactCols,...(active.extra||[])],active.rows,{
        tools:toolbar,actions,onAction,showAllColumns:true,empty:active.empty
      });
      workspace.innerHTML=tabs+RecordComponents.panel(table);
      UI.activate(workspace);
      RecordComponents.mountPanel(workspace,{title:active.label+' Records'});
      workspace.querySelector('.record-workspace-category-row')?.remove();
      workspace.querySelectorAll('[data-fund-view]').forEach(button=>button.addEventListener('click',()=>{
        active=views.find(v=>v.value===button.dataset.fundView)||active;
        renderView();
      }));
      const tbody=workspace.querySelector('[data-tbody]');
      const state=tbody?UI._tables[tbody.dataset.tbody]:null;
      const original=state?state.rows.slice():[];
      let status='';
      let sort='newest';
      const refresh=()=>{
        if(!state)return;
        let rows=original.filter(f=>!status||f.status===status);
        rows.sort((a,b)=>{
          if(sort==='amount-high'||sort==='amount-low'){
            const delta=Number(a.amount||0)-Number(b.amount||0);
            return sort==='amount-high'?-delta:delta;
          }
          const diff=String(a.created_at||'').localeCompare(String(b.created_at||''));
          return sort==='oldest'?diff:-diff;
        });
        state.rows=rows;
        // Shared table pages use zero-based indexing. Show the first matching row.
        state.page=0;
        UI.drawTable(tbody.dataset.tbody);
      };
      RecordComponents.bindDropdowns(workspace,{
        apply(panel){status=panel.querySelector('[name="status"]')?.value||'';refresh();},
        reset(){status='';const field=workspace.querySelector('#fund-filter-panel [name="status"]');if(field)field.value='';refresh();},
        sort(value){sort=value;refresh();}
      },{filter:'fund-filter-panel',sort:'fund-sort-panel'});
    };
    renderView();
  },
});
