/* Shared Approvals inbox. Decisions always call existing authorized backend handlers. */
'use strict';
App.page('approvals', {
  title:'Approvals',
  subtitle:'Requests requiring a decision from your account.',
  render(ctx) {
    const role = App.me?.user?.role || '';
    // Admin's existing full approval page already contains PO, stock-count and
    // billing review drawers, and enforces separation of duties.
    if (role === 'admin' && App.pages.admin_approvals) {
      return App.pages.admin_approvals.render(ctx);
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
