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
    const queue = all.filter(r => r.actionable && r.status === 'Pending');
    const types = [...new Set(queue.map(r => r.type))].sort();
    const shown = queue.filter(r => !ctx.query.type || r.type === ctx.query.type);
    UI.tool(ctx, 'Refresh approvals', () => ctx.reload(), 'bi-arrow-clockwise', 'outline-secondary');
    ctx.el.innerHTML = `<div class="mb-3">${UI.kpiTiles([
      {label:'Awaiting your approval', value:queue.length, note:'Requests that need your decision', icon:'bi-check2-square',tone:queue.length?'amber':'gray'}
    ])}</div>
    ${failed.length ? '<div class="alert alert-warning">Some approval data could not be loaded. Please refresh or contact IT.</div>' : ''}
    ${!queue.length ? '<div class="alert alert-light border">No requests are awaiting your approval. Requests you submit to other departments are tracked in their original records.</div>' : ''}
    ${UI.generalFilters(ctx,[{name:'type',label:'Request type',options:types}])}`;
    if (!shown.length) return;
    const box = document.createElement('div'); ctx.el.append(box);
    box.innerHTML = UI.table([
      ['Reference','ref',(v,r)=>`<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(r.summary || '')}</div>`],
      ['Request','type'],['Department','dept'],['Requested by','requester'],
      ['Submitted','submitted','datetime'],['Amount','amount','money'],['Status','status','badge']
    ],shown,{
      title:'Pending approvals (' + shown.length + ')',
      showAllColumns:true,directActions:true,
      actions:r=>UI.btn('approve','Approve','success','bi-check-lg')+
        UI.btn('reject','Reject','outline-danger','bi-x-lg')+
        (UI.canGo(r.go)?UI.btn('open','Open record','outline-secondary','bi-eye'):''),
      onAction:(action,r)=>{
        if(action==='open')return UI.goTo(r.go);
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
