/* REPORT_ACCESS_CENTER_V1 — centralized, permissions-aware entry to EXISTING reports.
 * No dashboard KPIs duplicated; the original report pages keep their KPIs and filters.
 * All authorizations are rechecked by the server on every request.
 */
'use strict';
App.page('reports_center', {
  title: 'Reports',
  subtitle: 'Existing operational and financial reports, with Admin-controlled access.',
  render(ctx) {
    const d=ctx.data||{}, reports=d.reports||[];
    const esc=v=>UI.esc(String(v??''));
    const cards=reports.map(r=>`<a class="rac-report" href="#${esc(r.page)}" aria-label="Open ${esc(r.label)}">
      <span class="rac-icon"><i class="bi bi-file-earmark-bar-graph" aria-hidden="true"></i></span>
      <span class="rac-copy"><strong>${esc(r.label)}</strong><small>Open existing reports, charts, filters and records</small></span>
      <i class="bi bi-arrow-up-right" aria-hidden="true"></i></a>`).join('');
    ctx.el.innerHTML=`<div class="rac-root">
      <section class="panel rac-panel"><div class="panel-head"><h2 class="panel-title">Available Reports</h2></div>
        <div class="panel-body"><p class="text-muted small">Reports you are authorized to access. Summary KPIs remain inside each original report.</p>
        <div class="rac-report-grid">${cards||'<p class="text-muted">No reports have been assigned to this account.</p>'}</div></div>
      </section>${d.admin?'<section class="panel rac-panel" id="rac-manage"><div class="panel-head"><h2 class="panel-title">Report Access Management</h2></div><div class="panel-body" data-rac-body></div></section>':''}
    </div>`;
    if (!d.admin) return;
    const body=ctx.el.querySelector('[data-rac-body]');
    const grantable=d.grantable||[];
    const roles=Object.entries(d.roles||{}).filter(([id])=>id!=='admin');
    const users=(d.users||[]).filter(u=>u.role!=='admin');
    let mode='role', key=roles[0]?.[0]||'', busy=false;
    const records=d.grants||[];
    const lookup=(kind,k,page)=>records.find(x=>x.subject_type===kind && String(x.subject_key)===String(k) && x.report_page===page);
    const selector=()=>mode==='role'?roles.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')
      :users.map(u=>`<option value="${esc(u.id)}">${esc(u.full_name)} (${esc(u.role)})</option>`).join('');
    const build=()=>{
      body.innerHTML=`<p class="small text-muted">Default: no reports for non-admin accounts. Grant by role or override an individual user. Changes are logged and enforced on the server.</p>
        ${!d.installed?'<div class="alert alert-warning">Report access database migration has not been applied yet. Permission changes are disabled until installation.</div>':''}
        <div class="rac-controls"><label>Permission scope<select class="form-select form-select-sm" data-rac-mode><option value="role" ${mode==='role'?'selected':''}>Role defaults</option><option value="user" ${mode==='user'?'selected':''}>Individual account overrides</option></select></label>
        <label>${mode==='role'?'Role':'Account'}<select class="form-select form-select-sm" data-rac-subject>${selector()}</select></label></div>
        <div class="rac-permissions">${grantable.map(item=>{
          const rec=lookup(mode,key,item.page), state=rec?(Number(rec.allowed)?'allow':'deny'):'inherit';
          const inherited=mode==='user'?lookup('role',users.find(u=>String(u.id)===String(key))?.role||'',item.page):null;
          const current=mode==='user'&&state==='inherit'?(inherited&&Number(inherited.allowed)?' (role allows)':' (role denies)'):'';
          return `<div class="rac-permission"><div><strong>${esc(item.label)}</strong><small>${esc(item.page)}${esc(current)}</small></div><select class="form-select form-select-sm" data-rac-page="${esc(item.page)}" ${busy||!d.installed?'disabled':''}>
            <option value="inherit" ${state==='inherit'?'selected':''}>${mode==='role'?'No grant':'Inherit role'}</option>
            <option value="allow" ${state==='allow'?'selected':''}>Allow</option>
            <option value="deny" ${state==='deny'?'selected':''}>Deny</option></select></div>`;
        }).join('')}</div><p class="small text-muted mt-2">Only Admin can change permissions. Explicit account Deny overrides an allowed role. Admin executive and diagnostic analytics remain Admin-only.</p>`;
      body.querySelector('[data-rac-mode]').onchange=e=>{mode=e.target.value;key=mode==='role'?(roles[0]?.[0]||''):(users[0]?String(users[0].id):'');build();};
      body.querySelector('[data-rac-subject]').value=key;
      body.querySelector('[data-rac-subject]').onchange=e=>{key=e.target.value;build();};
      body.querySelectorAll('[data-rac-page]').forEach(el=>el.onchange=async e=>{
        const page=e.target.dataset.racPage, state=e.target.value, prev=lookup(mode,key,page);
        if(busy)return;
        busy=true;
        try {
          // Inherit is recorded as a deny only for roles. User overrides use a
          // distinct reset action so removing an override restores role defaults.
          const action=state==='inherit'&&mode==='user'?'clear_grant':'set_grant';
          await App.api('ReportAccess.'+action,{subject_type:mode,subject_key:key,report_page:page,allowed:state==='allow'});
          const idx=records.findIndex(x=>x.subject_type===mode&&String(x.subject_key)===String(key)&&x.report_page===page);
          if(idx>=0)records.splice(idx,1);
          if(state!=='inherit'||mode==='role')records.push({subject_type:mode,subject_key:key,report_page:page,allowed:state==='allow'?1:0});
          UI.toast('Report access updated. The affected user will see the change after refreshing.', 'success');
        } catch(err){UI.toast(err.message,'error');}
        finally{busy=false;build();}
      });
    };
    if(mode==='role'&&!key&&users.length){mode='user';key=String(users[0].id);}
    build();
  }
});
