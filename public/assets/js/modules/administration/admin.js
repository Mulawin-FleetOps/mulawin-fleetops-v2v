/* assets/js/modules/administration/admin.js — ADMINISTRATION (Head Management)
   User accounts and roles, system settings and fund categories, activity log, backup.
   Audit can read the activity log only.
   Backend: backend/Modules/Administration/Admin.php */
'use strict';
const HeadAdminPage = {
  title: 'User Management',
  subtitle: 'User accounts, settings, activity log and backup.',
  render(ctx) {
    const d = ctx.data, isAdmin = d.can.admin, roles = Object.entries(d.roles);
    // Adjustment: vacancy-aware account role/shift options and password visibility.
    const dispatcherRoles = ['car_carrier_dispatcher', 'container_wingvan_dispatcher'];
    const shifts = ['Day', 'Night'];
    const activeAccounts = (d.users || []).filter(x => Number(x.active) === 1);
    const occupied = (role, shift, excludeId) => activeAccounts.some(x =>
      String(x.id) !== String(excludeId ?? '') && x.role === role &&
      (!dispatcherRoles.includes(role) || x.shift === shift));
    const roleAvailable = (role, u) => {
      if (u.id && u.role === role) return true; // Keep existing role visible while editing.
      return dispatcherRoles.includes(role)
        ? shifts.some(s => !occupied(role, s, u.id))
        : !occupied(role, null, u.id);
    };
    /** Shows a generated temporary password ONCE. It is never stored by the browser app and cannot be retrieved again. */
    const showTempPassword = (r) => {
      UI.modal('Temporary password for ' + UI.esc(r.temporary_for || 'the account'),
        `<p class="small">Give this password to the user privately. It is shown <b>only once</b> and cannot be viewed again; the user must change it at first login. It is not emailed.</p>
         <div class="input-group mb-2"><input class="form-control font-monospace" id="tmpPw" readonly value="${UI.esc(r.temporary_password)}" aria-label="Temporary password">
         <button class="btn btn-outline-secondary" type="button" id="tmpPwCopy">Copy</button></div>`, null,
        { size: '', onShow: (wrap) => {
          wrap.querySelector('#tmpPwCopy').onclick = async () => { try { await navigator.clipboard.writeText(r.temporary_password); UI.toast('Copied.'); } catch { wrap.querySelector('#tmpPw').select(); UI.toast('Press Ctrl+C to copy.'); } };
          wrap.addEventListener('hidden.bs.modal', () => { r.temporary_password = ''; const i = wrap.querySelector('#tmpPw'); if (i) i.value = ''; });
        } });
    };
    const userForm = (u = {}) => {
      const availableRoles = roles.filter(([role]) => roleAvailable(role, u));
      const wrap = UI.formModal(u.id ? 'Edit ' + UI.esc(u.username) : 'New user account', [
        { name: 'full_name', label: 'Full name', required: true, col: 6, value: u.full_name },
        ...(u.id ? [] : [{ name: 'username', label: 'Username', required: true, col: 6, help: 'Letters, numbers, dot, dash or underscore.' }]),
        { name: 'email', label: 'Email', type: 'email', required: true, col: 6, value: u.email },
        { name: 'role', label: 'Role', type: 'select', options: availableRoles, required: true, col: 6, value: u.role },
        { name: 'shift', label: 'Shift (dispatchers)', type: 'select', options: UI.list(shifts), col: 6, value: u.shift }], 'Admin.user_save', { extra: u.id ? { id: u.id } : {},
          intro: u.id ? '' : 'The system generates a one-time temporary password. You will see it once after saving.',
          after: (r) => { App.route(); if (r.temporary_password) showTempPassword(r); } });
      const role = wrap.querySelector('[name=role]');
      const shiftInput = wrap.querySelector('[name=shift]');
      const shiftWrapper = shiftInput.closest('[class*=col-]');
      const refreshShifts = () => {
        const dispatch = dispatcherRoles.includes(role.value);
        shiftWrapper.style.display = dispatch ? '' : 'none';
        shiftInput.required = dispatch;
        if (!dispatch) { shiftInput.value = ''; return; }
        const current = shiftInput.value;
        const options = shifts.filter(s => (u.id && role.value === u.role && s === u.shift) ||
          !occupied(role.value, s, u.id));
        shiftInput.replaceChildren(new Option('Choose…', ''), ...options.map(s => new Option(s, s)));
        shiftInput.value = options.includes(current) ? current : '';
      };
      role.addEventListener('change', () => { shiftInput.value = ''; refreshShifts(); });
      refreshShifts();
    };
    const tabs = [];
    if (isAdmin) {
      tabs.push(['users', 'User accounts', (body) => {
        const accounts=d.users||[];
        const total=accounts.length,active=accounts.filter(u=>Number(u.active)===1).length;
        const state={scope:'all',role:'',order:'default'};
        const categories=[
          {value:'all',label:'All Accounts'},
          {value:'active',label:'Active'},
          {value:'inactive',label:'Inactive'}
        ];
        const roleChoices=[...new Set(accounts.map(u=>u.role).filter(Boolean))].sort();
        const roleOptions=roleChoices.map(role=>'<option value="'+UI.esc(role)+'">'+UI.esc(d.roles[role]||role)+'</option>').join('');
        const filterId='head-user-record-filter',sortId='head-user-record-sort';
        const toolbar='<button type="button" class="btn btn-sm btn-primary record-workspace-add" data-adduser><i class="bi bi-person-plus" aria-hidden="true"></i> New Account</button>'
          +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="'+filterId+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter</button>'
          +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" aria-controls="'+sortId+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
          +'<div class="record-workspace-popovers"><div class="record-workspace-popover" id="'+filterId+'" hidden>'
          +'<strong>Filter accounts</strong><label>Role<select class="form-select form-select-sm" data-head-user-role>'
          +'<option value="">All roles</option>'+roleOptions+'</select></label>'
          +'<div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
          +'<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
          +'<div class="record-workspace-popover record-workspace-sort-panel" id="'+sortId+'" hidden>'
          +'<strong>Sort accounts</strong>'
          +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="default" data-record-sort checked> Default order</label>'
          +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="asc" data-record-sort> Name A–Z</label>'
          +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="desc" data-record-sort> Name Z–A</label></div></div>';
        const columns=[['Name','full_name'],['Username','username'],['Email','email'],
          ['Role','role',v=>UI.esc(d.roles[v]||v)],['Shift','shift'],
          ['Status','active',v=>Number(v)?UI.badge('Active'):UI.badge('Inactive')],
          ['E-signature','has_signature','yes'],['Last login','last_login_at','datetime']];
        const h=UI.table(columns,accounts,{
          title:'User Accounts',tools:toolbar,showAllColumns:true,viewSwitch:false,
          actions:u=>UI.btn('edit','Edit')+UI.btn('pw','Reset password','outline-secondary')
            +(u.id==App.me.user.id?'':UI.btn('toggle',Number(u.active)?'Deactivate':'Activate',
              Number(u.active)?'outline-danger':'outline-success')),
          onAction:(a,u)=>{
            if(a==='edit')userForm(u);
            if(a==='pw')UI.confirmAction('Reset password for '+UI.esc(u.username),
              'A new random temporary password will be generated and shown to you once. The current password cannot be viewed. Existing sessions are signed out and the user must change the new password at next login.',
              'Admin.user_password',{user_id:u.id},{submit:'Generate temporary password',
                after:r=>{UI.closeDrawer();App.route();if(r.temporary_password)showTempPassword(r);}});
            if(a==='toggle')UI.confirmAction((Number(u.active)?'Deactivate ':'Activate ')+UI.esc(u.full_name),
              Number(u.active)?'The user can no longer log in. Records made by this user are kept.':'The user can log in again.',
              'Admin.user_toggle',{user_id:u.id,active:Number(u.active)?0:1},{danger:Boolean(Number(u.active))});
          }
        });
        const summary=RecordComponents.kpis([
          {label:'Total Accounts',value:total,icon:'bi-people',color:'blue'},
          {label:'Active Accounts',value:active,icon:'bi-person-check',color:'green'},
          {label:'Inactive Accounts',value:total-active,icon:'bi-person-dash',color:'red'},
          {label:'Assigned Roles',value:new Set(accounts.map(u=>u.role).filter(Boolean)).size,icon:'bi-shield-check',color:'purple'}
        ]);
        const reference='<details class="head-user-role-reference"><summary><i class="bi bi-shield-check" aria-hidden="true"></i>'
          +'<span>Role & Access Reference</span><small>View configured user roles</small><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>'
          +'<div class="head-user-role-reference-body"><p>Permissions are enforced by the server. Account roles shown here are a reference, not an authorization policy.</p>'
          +'<div class="head-user-role-tags">'+roles.map(([,label])=>'<span>'+UI.esc(label)+'</span>').join('')+'</div></div></details>';
        const html='<div class="head-user-management">'+summary
          +RecordComponents.panel(h,RecordComponents.categories(categories,'all','data-head-user-category'))
          +reference+'</div>';
        // Mount after UI.tabs inserts the returned HTML, preserving table handlers.
        setTimeout(()=>{
          const root=body.querySelector('.head-user-management');
          if(!root)return;
          RecordComponents.mountPanel(root,{title:'User Accounts'});
          const tbody=root.querySelector('[data-tbody]'),id=tbody?.dataset.tbody;
          const table=id?UI._tables[id]:null;
          if(!table)return;
          const original=table.rows.slice();
          const roleSelect=root.querySelector('[data-head-user-role]');
          const draw=()=>{
            let rows=original.filter(u=>(state.scope==='all'||(Number(u.active)===1)===(state.scope==='active'))
              &&(!state.role||u.role===state.role));
            if(state.order!=='default')rows.sort((a,b)=>(state.order==='asc'?1:-1)
              *String(a.full_name||'').localeCompare(String(b.full_name||''),undefined,{numeric:true}));
            table.rows=rows;table.page=0;UI.drawTable(id);
            root.querySelectorAll('[data-head-user-category]').forEach(button=>{
              const selected=button.dataset.headUserCategory===state.scope;
              button.classList.toggle('btn-primary',selected);
              button.classList.toggle('btn-outline-secondary',!selected);
              button.setAttribute('aria-pressed',String(selected));
            });
          };
          root.querySelectorAll('[data-head-user-category]').forEach(button=>button.addEventListener('click',()=>{
            state.scope=button.dataset.headUserCategory;draw();
          }));
          root.querySelector('[data-adduser]')?.addEventListener('click',()=>userForm());
          RecordComponents.bindDropdowns(root,{
            apply:menu=>{state.role=menu.querySelector('[data-head-user-role]').value;draw();
              root.querySelector('.record-workspace-filter-trigger')?.click();},
            reset:()=>{state.role='';roleSelect.value='';draw();
              root.querySelector('.record-workspace-filter-trigger')?.click();},
            sort:value=>{state.order=value;draw();}
          },{filter:filterId,sort:sortId});
        },0);
        return html;
      }]);
      // CHECKLIST_42_ATTENDANCE_PHASE2_V1: time-of-day settings (format 'hour') are shown and chosen as 12-hour
      // times (6 -> 6:00 AM, 18 -> 6:00 PM); the value sent and stored is still the hour 0-23.
      const hour12 = (h) => `${(+h % 12) || 12}:00 ${+h < 12 ? 'AM' : 'PM'}`;
      const modeName = (v) => +v === 2 ? 'Enforce' : 'Warn';
      const settingText = (v, s) => s.format === 'hour' ? `${hour12(v)} <span class="small text-muted">${UI.esc(s.unit)}</span>`
        : s.format === 'attendance_mode' ? `<b>${modeName(v)}</b>` : `${UI.num(v, 2)} ${UI.esc(s.unit)}`;
      const settingField = (s) => s.format === 'hour'
        ? { name: 'value', label: `Time (${s.unit})`, type: 'select', options: Array.from({ length: 24 }, (_, h) => [String(h), hour12(h)]), value: String(Math.round(+s.value)), required: true, col: 12 }
        : s.format === 'attendance_mode'
        ? { name: 'value', label: 'Mode', type: 'select', options: [['1', 'Warn (dispatch allowed; attendance noted)'], ['2', 'Enforce (dispatch needs valid attendance)']], value: String(Math.round(+s.value)), required: true, col: 12 }
        : { name: 'value', label: `Value (${s.unit}, ${s.min} to ${s.max})`, type: 'number', step: 'any', value: s.value, required: true, col: 12 };
      // CHECKLIST_42_ATTENDANCE_ENFORCEMENT_V1: show readiness before the Admin switches Warn / Enforce.
      const readinessHtml = (r) => {
        const un = r.unassigned || [], tr = r.trips || [];
        if (!un.length && !tr.length) return '<div class="alert alert-success py-2 small mb-0">Ready: every active driver and helper has a shift, and no upcoming trip has crew on another shift.</div>';
        return `<div class="alert alert-warning py-2 small mb-0">${un.length ? `<b>${un.length} driver(s)/helper(s) have no shift</b> (Enforce is refused until they have one): ${un.slice(0, 15).map(x => UI.esc(x.full_name)).join(', ')}${un.length > 15 ? ', ...' : ''}.<br>` : ''}`
          + `${tr.length ? `<b>${tr.length} upcoming trip(s)</b> would be blocked under Enforce:<ul class="mb-0">${tr.slice(0, 10).map(x => `<li>${UI.esc(x.trip_ref)} · ${UI.datetime(x.scheduled_at)}: ${x.issues.map(UI.esc).join('; ')}</li>`).join('')}</ul>` : ''}</div>`;
      };
      const settingModal = async (s) => {
        const intro = s.format === 'attendance_mode' ? readinessHtml(await App.api('Attendance.readiness', {})) : undefined;
        UI.formModal(UI.esc(s.label), [settingField(s)], 'Admin.setting_save', { extra: { key: s.key }, size: '', intro });
      };
      tabs.push(['settings', 'Settings', () => UI.table([['Setting', 'label', (v, s) => `<b>${UI.esc(v)}</b>${s.help ? `<div class="small text-muted">${UI.esc(s.help)}</div>` : ''}`], ['Value', 'value', settingText],
          ['Default', 'default', settingText]], d.settings, { title: 'System settings', actions: () => UI.btn('edit', 'Change'),
          onAction: (a, s) => settingModal(s) })
        + UI.table([['Category', 'name'], ['Preset amount', 'amount', 'money'], ['Display order', 'sort_order', 'num'], ['Active', 'active', 'yes']], d.fundCategories, { title: 'Fund request categories (preset amounts the dispatcher picks)',
          tools: '<button class="btn btn-sm btn-primary" data-addcat><i class="bi bi-plus"></i> Add category</button>', actions: () => UI.btn('edit', 'Edit'), onAction: (a, c) => catForm(c) })]);
      tabs.push(['backup', 'Backup', () => `<div class="card"><div class="card-body-custom"><p class="small">A backup saves all database records into one .sql file. Keep a copy outside this computer together with the <code>storage/private</code> folder (uploaded files).
          To restore: create an empty database and import the .sql file in phpMyAdmin.</p><button class="btn btn-primary btn-sm" data-backup><i class="bi bi-hdd"></i> Create backup now</button></div></div>`
        + UI.table([['File', 'name'], ['Backup date', 'date'], ['Size', 'size', (v) => UI.num(v / 1024, 1) + ' KB']], d.backups, { title: 'Backups', actions: () => UI.btn('dl', 'Download'), onAction: (a, b) => { window.location = 'index.php?api=backup_download&file=' + encodeURIComponent(b.name); } })]);
    }
    const catForm = (c = {}) => UI.formModal(c.id ? 'Edit category' : 'Add category', [{ name: 'name', label: 'Category', required: true, col: 6, value: c.name }, { name: 'amount', label: 'Preset amount', type: 'money', required: true, col: 3, value: c.amount },
      { name: 'sort_order', label: 'Order', type: 'number', col: 3, value: c.sort_order ?? 0 }, { name: 'active', label: 'Active (shown to dispatchers)', type: 'checkbox', value: c.id ? c.active : 1, col: 12 }], 'Admin.fund_category_save', { extra: c.id ? { id: c.id } : {} });
    // Audit Phase 1: concise list, action-first drawer and verified changed fields.
    const activityDetails = (e) => {
      const fields = [
        ['Date and time', UI.datetime(e.created_at)],
        ['Performed by', UI.e(e.actor)],
        ['Email address', UI.e(e.actor_email || '—')],
        ['User role', UI.esc(d.roles[e.role] || e.role || 'System')],
        ['Action performed', UI.e(e.action)],
        ['What was done', UI.e(e.details || 'No additional description was recorded.')],
      ];
      let changes = [];
      if (e.changes_json) {
        try { const parsed = JSON.parse(e.changes_json); if (Array.isArray(parsed)) changes = parsed; } catch (_) { /* legacy or invalid optional data */ }
      }
      const html = UI.kv(fields) + UI.activity([{action:e.action,created_at:e.created_at,actor:e.actor,notes:e.details}]) + (changes.length
        ? UI.h('Changes made') + UI.table([['Field', 'field', v => UI.esc(v)],
          ['Before', 'before', v => UI.esc(v === null || v === '' ? '—' : String(v))],
          ['After', 'after', v => UI.esc(v === null || v === '' ? '—' : String(v))]],
          changes, { plain: true, limit: 30 })
        : '<p class="small text-muted mt-3">No field-by-field changes recorded for this activity.</p>');
      const drawer = UI.drawer('Activity details', html, { subtitle: 'Read-only audit record' });
      UI.activate(drawer);
    };
    tabs.push(['log', 'Activity log', () => UI.filterModal(ctx, [{ name: 'from', label: 'Start date', type: 'date', col: 6 }, { name: 'to', label: 'End date', type: 'date', col: 6 },
        { name: 'actor_id', label: 'User', type: 'select', options: UI.opts(d.actors, u => u.full_name), col: 12 }],
        { hint: `Showing ${UI.date(d.range.from)} – ${UI.date(d.range.to)}.` })
      + UI.table([['Date & time', 'created_at', 'datetime'], ['User', 'actor'], ['Activity', 'action']], d.events,
        { title: 'Activity log', actions: () => UI.btn('view', 'View'), onAction: (a, e) => { if (a === 'view') activityDetails(e); }, rowClick: activityDetails })]);
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, tabs, ctx.query?.headSettings ? 'settings' : (ctx.query?.from || ctx.query?.area ? 'log' : null));
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-addcat]')) catForm();
      if (e.target.closest('[data-backup]')) { if (!await UI.confirmProceed('Create backup', 'Create a new database backup now?', 'Create backup')) return; try { UI.result(await App.api('Admin.backup_create', {})); App.route(); } catch (x) { UI.toast(x.message, 'error'); } }
    });
  },
};
App.page('admin', HeadAdminPage);
App.page('head-settings', {
  ...HeadAdminPage,
  title:'System Configuration',
  subtitle:'Head Management settings and controls.',
  render(ctx) {
    HeadAdminPage.render({...ctx, query:{...(ctx.query||{}),headSettings:true}});
  }
});

// Fuel controls reuse Settings, standard cards/tables and the existing modal system.
const FuelAdjustmentUI={
 edit(ctx,key){
  const diesel=key==='diesel',current=ctx.data.current?.[key],value=current?JSON.parse(current.value_json).value:'',fields=[
   ...(!diesel?[{name:'truck_type',label:'Truck Type',value:key,attrs:'readonly'}]:[]),
   {name:'value',label:diesel?'New Diesel Price (PHP/L)':'Fuel Efficiency (KM/L)',type:'number',required:true,value,step:'0.0001',min:0.0001,attrs:'max="'+(diesel?'1000':'100')+'"'},
   ...(diesel?[{name:'effective_date',label:'Effective Date',type:'date',required:true,value:UI.today()},{name:'historical_verified',label:'Historical source verified',type:'select',options:[['','Not confirmed'],['1','Verified against source']]}]:[]),
   {name:'reference',label:'Reason / Reference',required:true,type:'textarea',attrs:'maxlength="300"'}
  ];
  let reviewed=null;
  UI.modal(diesel?'Edit Weekly Diesel Price':'Edit Fuel Efficiency','<div data-fuel-fields>'+UI.fields(fields.map(f=>({...f,col:12})))+'</div><div data-fuel-review hidden></div>',async(d,form)=>{
   const payload={setting_key:key,value:d.value,reference:d.reference,...(diesel?{effective_date:d.effective_date,historical_verified:d.historical_verified}: {})};
   if(!reviewed||JSON.stringify(payload)!==JSON.stringify(reviewed))throw Error('Review the update before confirming.');
   const result=await App.api('Admin.pricing_save',reviewed);UI.result(result);await ctx.reload();
  },{submit:'Confirm Update',confirmBeforeSubmit:false,size:'',extraFooter:'<button type="button" class="btn btn-outline-secondary btn-sm" data-fuel-back hidden>Back</button><button type="button" class="btn btn-primary btn-sm" data-fuel-review-button>Review Update</button>',onShow:(wrap,form)=>{
   const confirm=form.querySelector('[type=submit]'),reviewButton=form.querySelector('[data-fuel-review-button]'),back=form.querySelector('[data-fuel-back]'),panel=form.querySelector('[data-fuel-fields]'),review=form.querySelector('[data-fuel-review]');confirm.hidden=true;
   const historical=()=>{if(!diesel)return;const input=form.elements.historical_verified,past=form.elements.effective_date.value<UI.today();input.parentElement.hidden=!past;input.disabled=!past;input.required=past;if(!past)input.value='';};
   if(diesel){form.elements.effective_date.addEventListener('change',historical);historical();}
   reviewButton.onclick=()=>{
    historical();const invalid=[...form.querySelectorAll('input,select,textarea')].find(input=>!input.disabled&&!input.checkValidity());if(invalid){invalid.reportValidity();return;}
    const d=UI.formData(form);reviewed={setting_key:key,value:d.value,reference:d.reference,...(diesel?{effective_date:d.effective_date,historical_verified:d.historical_verified}: {})};
    review.innerHTML=UI.kv([['Setting',diesel?'Weekly Diesel Price':UI.esc(key)],['New value',UI.esc(d.value)+(diesel?' PHP/L':' KM/L')],...(diesel?[['Effective Date',UI.esc(d.effective_date)]]:[['Applies','Immediately on confirmation (Asia/Manila)']]),['Reason / Reference',UI.esc(d.reference)]]);
    panel.hidden=true;review.hidden=false;reviewButton.hidden=true;confirm.hidden=false;back.hidden=false;confirm.focus();
   };
   back.onclick=()=>{reviewed=null;panel.hidden=false;review.hidden=true;reviewButton.hidden=false;confirm.hidden=true;back.hidden=true;};
  }});
 },
 render(ctx){
  const current=ctx.data.current||{};
  const diesel=current.diesel;
  const types=ctx.data.truckTypes||['Car Carrier','Container','Wing Van'];
  const history=(ctx.data.history||[]).filter(r=>r.setting_key==='diesel'||types.includes(r.setting_key));
  const number=row=>{
    if(!row)return null;
    try {const value=JSON.parse(row.value_json).value;return Number.isFinite(Number(value))?Number(value):null;}
    catch {return null;}
  };
  const configured=types.filter(type=>number(current[type])!==null).length;
  const latest=history.reduce((best,row)=>{
    const date=row.effective_at||row.effective_date||row.created_at;
    const previous=best?.effective_at||best?.effective_date||best?.created_at;
    return !best||String(date||'')>String(previous||'')?row:best;
  },null);
  const categories=[
    {value:'diesel',label:'Diesel Price'},
    {value:'efficiency',label:'Truck Efficiency'},
    {value:'history',label:'Configuration History'}
  ];
  const dieselValue=number(diesel);
  const kpis=[
    {label:'Current Diesel Price',value:dieselValue===null?'Not set':dieselValue,format:dieselValue===null?'':'money',icon:'bi-fuel-pump',color:'green'},
    {label:'Effective Date',value:diesel?UI.date(diesel.effective_date):'Not set',icon:'bi-calendar-check',color:'blue'},
    {label:'Configured Truck Types',value:configured+' of '+types.length,icon:'bi-truck',color:'purple'},
    {label:'Latest Configuration',value:latest?UI.date(latest.effective_at||latest.effective_date):'None',icon:'bi-clock-history',color:'amber'}
  ];
  ctx.el.innerHTML='<div class="head-fuel-workspace">'
    +RecordComponents.kpis(kpis)
    +'<div class="head-fuel-config" data-head-fuel-records></div></div>';
  const root=ctx.el.querySelector('[data-head-fuel-records]');
  const buttons=selected=>RecordComponents.categories(categories,selected,'data-head-fuel-tab');
  const attachTabs=()=>{
    root.querySelectorAll('[data-head-fuel-tab]').forEach(button=>
      button.addEventListener('click',()=>show(button.dataset.headFuelTab)));
  };
  const show=category=>{
    if(category==='diesel'){
      root.innerHTML='<section class="record-workspace-panel">'
        +'<div class="record-workspace-heading"><div><h2>Fuel Configuration</h2>'
        +'<p class="record-workspace-count">Weekly diesel pricing, truck efficiency and audit history</p></div>'
        +'<button type="button" class="btn btn-sm btn-primary" data-edit-diesel>'
        +'<i class="bi bi-pencil" aria-hidden="true"></i> Edit Price</button></div>'
        +'<div class="record-workspace-category-row">'+buttons(category)+'</div>'
        +'<div class="head-fuel-diesel-content">'
        +'<div class="head-fuel-section-heading"><div class="head-fuel-section-icon"><i class="bi bi-fuel-pump" aria-hidden="true"></i></div>'
        +'<div><h3>Weekly Diesel Price</h3><p>Current company-wide diesel configuration</p></div>'
        +'<span class="head-fuel-config-state '+(dieselValue===null?'is-missing':'is-ready')+'">'
        +(dieselValue===null?'Not configured':'Configured')+'</span></div>'
        +'<div class="head-fuel-setting-grid">'
        +'<div class="head-fuel-setting"><span class="head-fuel-setting-label">Current price per liter</span>'
        +'<strong>'+ (dieselValue===null?'Not configured':UI.money(dieselValue))+'</strong><small>Philippine peso per liter</small></div>'
        +'<div class="head-fuel-setting"><span class="head-fuel-setting-label">Effective date</span>'
        +'<strong>'+ (diesel?UI.date(diesel.effective_date):'Not configured')+'</strong><small>Current effective price record</small></div></div>'
        +'<div class="head-fuel-policy"><i class="bi bi-info-circle" aria-hidden="true"></i>'
        +'<p>Diesel price updates normally occur on Tuesdays. The previous effective price remains applicable until the next price takes effect. Historical invoices are not automatically recalculated.</p></div>'
        +'</div></section>';
      root.querySelector('[data-edit-diesel]').onclick=()=>this.edit(ctx,'diesel');
    }else{
      const isEfficiency=category==='efficiency';
      if(!isEfficiency && history.length===0){
        root.innerHTML='<section class="record-workspace-panel">'
          +'<div class="record-workspace-heading"><div><h2>Configuration History</h2>'
          +'<p class="record-workspace-count">0 recorded changes</p></div></div>'
          +'<div class="record-workspace-category-row">'+buttons(category)+'</div>'
          +'<div class="head-fuel-history-empty" role="status">'
          +'<div class="head-fuel-history-empty-icon"><i class="bi bi-clock-history" aria-hidden="true"></i></div>'
          +'<h3>No configuration changes yet</h3>'
          +'<p>Changes to diesel pricing and truck fuel efficiency will appear here after they are saved, including their effective date and reference.</p>'
          +'<div class="head-fuel-history-note"><i class="bi bi-shield-check" aria-hidden="true"></i> Historical pricing records are retained for auditing.</div>'
          +'</div></section>';
      }else{
        const columns=isEfficiency
          ?[['Truck Type','type',(v,r)=>'<div class="head-fuel-truck-label"><span class="head-fuel-truck-icon"><i class="bi bi-truck" aria-hidden="true"></i></span><span><b>'+UI.esc(v)+'</b><small>Fuel efficiency setting</small></span></div>'],
            ['Current Efficiency','value',v=>v===null?'<span class="head-fuel-muted-value">Not configured</span>':'<strong class="head-fuel-efficiency-value">'+UI.num(v,4)+' <small>km/L</small></strong>'],
            ['Configuration','status',(_,r)=>r.value===null?'<span class="head-fuel-status is-missing"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> Needs setup</span>':'<span class="head-fuel-status is-ready"><i class="bi bi-check-circle" aria-hidden="true"></i> Configured</span>']]
          :[['Setting','setting_key',v=>'<span class="head-fuel-history-setting"><i class="bi '+(v==='diesel'?'bi-fuel-pump':'bi-truck')+'" aria-hidden="true"></i> '+UI.esc(v==='diesel'?'Diesel Price':v)+'</span>'],
            ['Effective','effective_date',(v,r)=>r.effective_at?UI.esc(r.effective_at):UI.date(v)],
            ['Value','value_json',(v,r)=>{try{return '<strong>'+UI.esc(JSON.parse(v).value)+'</strong> <small>'+ (r.setting_key==='diesel'?'PHP/L':'km/L')+'</small>'}catch{return '—'}}],
            ['Reason / Reference','reference',v=>UI.esc(v||'—')]];
        const rows=isEfficiency?types.map(type=>({type,value:number(current[type])})):history;
        const options={showAllColumns:true,viewSwitch:false,
          empty:isEfficiency?'No truck types available.':'No diesel or fuel efficiency updates.',
          ...(isEfficiency?{actions:()=>UI.btn('edit','Edit','outline-primary'),
            onAction:(_,row)=>this.edit(ctx,row.type)}:{})};
        root.innerHTML=RecordComponents.panel(UI.table(columns,rows,options),buttons(category));
        UI.activate(root);
        RecordComponents.mountPanel(root,{title:isEfficiency?'Truck Fuel Efficiency':'Configuration History'});
        const categoryRow=root.querySelector('.record-workspace-category-row');
        categoryRow?.insertAdjacentHTML('afterend',isEfficiency
          ?'<div class="head-fuel-table-intro"><div class="head-fuel-table-intro-icon"><i class="bi bi-speedometer2" aria-hidden="true"></i></div>'
           +'<div><strong>Fuel efficiency by truck type</strong><p>Configure kilometers per liter for each truck type. Values are used in fuel cost estimates; no default efficiency is assumed.</p></div>'
           +'<span class="head-fuel-table-progress">'+configured+' of '+types.length+' configured</span></div>'
          :'<div class="head-fuel-table-intro"><div class="head-fuel-table-intro-icon"><i class="bi bi-journal-check" aria-hidden="true"></i></div>'
           +'<div><strong>Pricing change history</strong><p>Review saved values, effective dates and reasons for previous changes.</p></div>'
           +'<span class="head-fuel-table-progress">'+history.length+' recorded changes</span></div>');
      }
    }
    attachTabs();
  };
  show('diesel');
  UI.activate(ctx.el);
 }
};
App.page('fuel-adjustment',{title:'Fuel & Operating Costs',render(ctx){FuelAdjustmentUI.render(ctx);}});
