/* Shared Approvals inbox. Decisions always call existing authorized backend handlers. */
'use strict';
App.page('approvals', {
  title:'Approvals',
  subtitle:'Requests requiring a decision from your account.',
  render(ctx) {
    const role = App.me?.user?.role || '';
    // Head Management uses this sidebar entry as a read-only decision history.
    // The existing admin_approvals screen remains accessible for actual pending
    // approval actions (e.g. from the executive dashboard).
    if (role === 'admin') {
      const d = ctx.data || {}, q = ctx.query || {};
      const all = Array.isArray(d.queue) ? d.queue : [];
      const decided = all.filter(r => r.status !== 'Pending' && r.decided_at);
      const tabs = [
        ['all','All', () => true],
        ['approved','Approved / Posted', r => /^(Approved|Posted|Partially Received|Received|Completed)$/i.test(r.status)],
        ['rejected','Rejected',r => /reject/i.test(r.status)],
        ['other','Other decisions',r => !/^(Approved|Posted|Partially Received|Received|Completed)$/i.test(r.status) && !/reject/i.test(r.status)]
      ];
      const selected = tabs.some(t=>t[0]===q.tab) ? q.tab : 'all';
      const types = [...new Set(decided.map(r=>r.type).filter(Boolean))].sort();
      const rows = decided.filter(tabs.find(t=>t[0]===selected)[2])
        .filter(r=>!q.type || r.type===q.type)
        .sort((a,b)=>String(b.decided_at).localeCompare(String(a.decided_at)));
      ctx.el.innerHTML = `<section class="panel mb-3"><div class="panel-body">
        <div class="d-flex align-items-center justify-content-between gap-3 flex-wrap">
          <div><h3 class="h6 mb-1">Approval Decision History</h3>
            <p class="small text-muted mb-0">Read-only record of management decisions from the last 90 days.</p></div>
          <button type="button" class="btn btn-sm btn-outline-primary" data-admin-pending>
            <i class="bi bi-clipboard-check" aria-hidden="true"></i> Pending Approvals
          </button>
        </div></div></section>`
        + UI.statusTabs(ctx.page,q,'tab',tabs.map(([key,label,match])=>[key,label,decided.filter(match).length]),selected)
        + UI.generalFilters(ctx,[{name:'type',label:'Decision type',options:types}]);
      ctx.el.querySelector('[data-admin-pending]')?.addEventListener('click',()=>App.go('admin_approvals'));
      if (Object.keys(d._errors||{}).length)
        ctx.el.insertAdjacentHTML('beforeend','<div class="alert alert-warning">Some history records could not be loaded. Please refresh.</div>');
      const container = document.createElement('div');
      container.className='head-approval-history-table mp-reference-table mp-ops-table';
      ctx.el.append(container);
      container.innerHTML = UI.table([
        ['Reference','ref',(v,r)=>`<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(r.summary||'')}</div>`],
        ['Decision type','type'],['Department','dept'],
        ['Decision','status','badge'],['Decided by','decider',v=>UI.esc(v||'Not recorded')],
        ['Decision date','decided_at','datetime'],
        ['Amount','amount','money']
      ],rows,{
        title:'Decision History ('+rows.length+')',showAllColumns:true,limit:12,
        directActions:true,
        actions:()=>UI.btn('view','Details','outline-primary'),
        onAction:(action,r)=>App.pages.admin_approvals
          ? HMApproval.open({...r,actionable:false})
          : UI.goTo(r.go),
        rowClick:r=>App.pages.admin_approvals ? HMApproval.open({...r,actionable:false}) : UI.goTo(r.go),
        empty:'No recorded approval decisions match these filters in the last 90 days.'
      });
      return;
    }
    const data = ctx.data || {}, all = Array.isArray(data.queue) ? data.queue : [];
    const failed = Object.keys(data._errors || {});
    const queue = all.filter(r => r.actionable || (role === 'finance' && r.kind === 'fund_release'));
    const decisions = queue.filter(r => r.actionable);
    const types = [...new Set(queue.map(r => r.type))].sort();
    const shown = queue.filter(r => !ctx.query.type || r.type === ctx.query.type);
    UI.tool(ctx, 'Refresh approvals', () => ctx.reload(), 'bi-arrow-clockwise', 'outline-secondary');
    ctx.el.innerHTML = `<div class="mb-3">${UI.kpiTiles([
      {label:role === 'finance' ? 'Ready for Finance action' : 'Awaiting your approval', value:decisions.length, note:role === 'finance' ? 'Approvals and approved trip funds for release' : 'Requests that need your decision', icon:'bi-check2-square',tone:decisions.length?'amber':'gray'}
    ])}</div>
    ${failed.length ? '<div class="alert alert-warning">Some approval data could not be loaded. Please refresh or contact IT.</div>' : ''}
    ${!queue.length ? '<div class="alert alert-light border">No requests currently require your action. Requests submitted to other departments are tracked in their original records.</div>' : ''}
    ${UI.generalFilters(ctx,[{name:'type',label:'Request type',options:types}])}`;
    if (!shown.length) return;
    const box = document.createElement('div'); ctx.el.append(box);
    box.className = 'approval-inbox-table';
    box.innerHTML = UI.table([
      ['Request','ref',(v,r)=>`<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(r.type)} · ${UI.esc(r.summary || '')}</div><div class="cell-sub">By ${UI.esc(r.requester || 'Unknown')} · ${UI.datetime(r.submitted)}</div>`],
      ['Amount','amount','money'],
      ['Status','status',(value,r)=>`<div>${UI.badge(value)}</div>${r.kind === 'fund_release' && r.actionable && !r.release_allowed_now
        ? `<small class="text-muted d-block mt-1">${r.release_opens_at ? 'Opens '+UI.datetime(r.release_opens_at) : 'Release time unavailable'}</small>`
        : ''}`]
    ],shown,{
      title:(role === 'finance' ? 'Finance approval and fund release queue (' : 'Pending approvals (') + shown.length + ')',
      showAllColumns:true,directActions:true,
      actions:r=>r.kind === 'fund_release'
        ? (r.actionable
            ? (r.release_allowed_now ? UI.btn('release','Release Funds','success','bi-cash-stack') : '')
              + (UI.canGo(r.go)?UI.btn('open','View','outline-secondary','bi-eye'):'')
            : (UI.canGo(r.go)?UI.btn('open','View fund request','outline-primary','bi-eye'):'' ))
        : UI.btn('approve','Approve','success','bi-check-lg')+
          UI.btn('reject','Reject','outline-danger','bi-x-lg')+
          (UI.canGo(r.go)?UI.btn('open','Open record','outline-secondary','bi-eye'):''),
      onAction:(action,r)=>{
        if(action==='open')return UI.goTo(r.go);
        if(r.kind==='fund_release' && action==='release') {
          if(!r.release_allowed_now || !r.actionable) return UI.toast('The fund release window is not open. Refresh approvals to check again.','error');
          return UI.confirmAction('Release '+UI.esc(r.ref),
            'Release <b>'+UI.money(r.amount)+'</b> in <b>cash</b> for '+UI.esc(r.summary)+'.'
            +'<br><span class="small text-muted">The system records the Philippine release date and generates a payment voucher. This action releases funds, it does not approve the request.</span>',
            'Funds.release',{fund_id:+r.key.split(':')[1]},{submit:'Confirm Release'});
        }
        if(r.kind==='po') {
          const approve=action==='approve';
          return UI.confirmAction((approve?'Approve ':'Reject ')+UI.esc(r.ref),
            approve?'The existing purchasing budget and approval limits will be validated before this purchase order is approved.':'The Purchasing Officer will be notified of the rejection.',
            'Purchasing.po_decide',{po_id:+r.key.split(':')[1],decision:approve?'approve':'reject'},
            approve?{submit:'Approve'}:{danger:true,submit:'Reject',fields:[{name:'notes',label:'Reason',required:true,col:12}]});
        }
        if(r.kind==='fund') {
          const approve=action==='approve';
          return UI.confirmAction((approve?'Approve ':'Reject ')+UI.esc(r.ref),
            approve?'The approved trip fund will become available for Finance release.':'The dispatcher must revise and resubmit the fund request.',
            'Funds.decide',{fund_id:+r.key.split(':')[1],decision:approve?'approve':'reject'},
            approve?{submit:'Approve'}:{danger:true,submit:'Reject',fields:[{name:'reason',label:'Reason',required:true,col:12}]});
        }
      }
    });
  }
});
