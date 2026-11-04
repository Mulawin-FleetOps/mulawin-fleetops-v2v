/* assets/js/modules/administration/admin.js — ADMINISTRATION (Head Management)
   User accounts and roles, system settings and fund categories, activity log, backup.
   Audit can read the activity log only.
   Backend: backend/Modules/Administration/Admin.php */
'use strict';
App.page('admin', {
  title: 'User Management',
  subtitle: 'User accounts, settings, activity log and backup.',
  render(ctx) {
    const d = ctx.data, isAdmin = d.can.admin, roles = Object.entries(d.roles);
    const userForm = (u = {}) => {
      const wrap = UI.formModal(u.id ? 'Edit ' + UI.esc(u.username) : 'New user account', [
        { name: 'full_name', label: 'Full name', required: true, col: 6, value: u.full_name },
        ...(u.id ? [] : [{ name: 'username', label: 'Username', required: true, col: 6, help: 'Letters, numbers, dot, dash or underscore.' }]),
        { name: 'email', label: 'Email (login codes are sent here)', type: 'email', required: true, col: 6, value: u.email },
        ...(u.id ? [] : [{ name: 'password', label: 'Password', type: 'password', required: true, col: 6, attrs: 'autocomplete="new-password"', help: (App.me.passwordMin || 8) + '+ characters with letters and numbers. Give it to the user privately.' }]),
        { name: 'role', label: 'Role', type: 'select', options: roles, required: true, col: 6, value: u.role },
        { name: 'shift', label: 'Shift (dispatchers)', type: 'select', options: UI.list(['Day', 'Night']), col: 6, value: u.shift }], 'Admin.user_save', { extra: u.id ? { id: u.id } : {} });
      const role = wrap.querySelector('[name=role]'), shift = wrap.querySelector('[name=shift]').closest('[class*=col-]');
      const t = () => { shift.style.display = /dispatcher/.test(role.value) ? '' : 'none'; }; role.onchange = t; t();
    };
    const tabs = [];
    if (isAdmin) {
      tabs.push(['users', 'User accounts', (body) => {
        const h = UI.table([['Name', 'full_name'], ['Username', 'username'], ['Email', 'email'], ['Role', 'role', (v) => UI.esc(d.roles[v] || v)], ['Shift', 'shift'], ['Active', 'active', (v) => +v ? UI.badge('Active') : UI.badge('Inactive')],
          ['E-signature', 'has_signature', 'yes'], ['Last login', 'last_login_at', 'datetime']], d.users,
          { title: 'Accounts (one per employee; access follows the role)', tools: '<button class="btn btn-sm btn-primary" data-adduser><i class="bi bi-person-plus"></i> New account</button>',
            actions: (u) => UI.btn('edit', 'Edit') + UI.btn('pw', 'Set new password', 'outline-secondary') + (u.id == App.me.user.id ? '' : UI.btn('toggle', +u.active ? 'Deactivate' : 'Activate', +u.active ? 'outline-danger' : 'outline-success')),
            onAction: (a, u) => {
              if (a === 'edit') userForm(u);
              if (a === 'pw') UI.formModal('Set a new password for ' + UI.esc(u.username), [{ name: 'password', label: 'New password', type: 'password', required: true, col: 12, attrs: 'autocomplete="new-password"', help: 'Give it to the user privately. Their open sessions are signed out; logging in still needs the email code.' }], 'Admin.user_password', { extra: { user_id: u.id }, size: '' });
              if (a === 'toggle') UI.confirmAction((+u.active ? 'Deactivate ' : 'Activate ') + UI.esc(u.full_name), +u.active ? 'The user can no longer log in. Records made by this user are kept.' : 'The user can log in again.', 'Admin.user_toggle', { user_id: u.id, active: +u.active ? 0 : 1 }, { danger: +u.active });
            } });
        setTimeout(() => body.querySelector('[data-adduser]')?.addEventListener('click', () => userForm()), 0);
        return h + `<section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-shield-check"></i> What each role can do</h2></div><div class="card-body-custom small"><ul class="mb-0">
          <li><b>Admin (Head Management)</b>: dashboards, reports, users, settings, backup; approves purchase orders above the limit.</li>
          <li><b>Operations Head</b>: creates and reviews trips, approves fund requests, changes assignments, keeps the truck, driver and client masterlists.</li>
          <li><b>Dispatchers</b> (Car Carrier; Container / Wing Van): trip requests, fund requests, checklist, dispatch, updates, incidents, completion of their truck types.</li>
          <li><b>Motorpool Custodian</b>: assesses incidents, corrective maintenance, mechanics, truck availability, requests parts.</li>
          <li><b>Purchasing Officer</b>: releases parts, inventory, suppliers, purchase orders and receiving.</li>
          <li><b>Finance</b>: releases trip funds, approves purchase orders up to the limit, pays, expenses, budget.</li>
          <li><b>Billing and Collection</b>: client rates, billing, invoices, payments, receivables.</li>
          <li><b>Audit</b>: read-only access to records and the activity log.</li></ul></div></section>`;
      }]);
      tabs.push(['settings', 'Settings', () => UI.table([['Setting', 'label', (v, s) => `<b>${UI.esc(v)}</b>${s.help ? `<div class="small text-muted">${UI.esc(s.help)}</div>` : ''}`], ['Value', 'value', (v, s) => `${UI.num(v, 2)} ${UI.esc(s.unit)}`],
          ['Default', 'default', (v, s) => `${UI.num(v, 2)} ${UI.esc(s.unit)}`]], d.settings, { title: 'System settings', actions: () => UI.btn('edit', 'Change'),
          onAction: (a, s) => UI.formModal(UI.esc(s.label), [{ name: 'value', label: `Value (${s.unit}, ${s.min} to ${s.max})`, type: 'number', step: 'any', value: s.value, required: true, col: 12 }], 'Admin.setting_save', { extra: { key: s.key }, size: '' }) })
        + UI.table([['Category', 'name'], ['Preset amount', 'amount', 'money'], ['Order', 'sort_order', 'num'], ['Active', 'active', 'yes']], d.fundCategories, { title: 'Fund request categories (preset amounts the dispatcher picks)',
          tools: '<button class="btn btn-sm btn-primary" data-addcat><i class="bi bi-plus"></i> Add category</button>', actions: () => UI.btn('edit', 'Edit'), onAction: (a, c) => catForm(c) })]);
      tabs.push(['backup', 'Backup', () => `<div class="card"><div class="card-body-custom"><p class="small">A backup saves all database records into one .sql file. Keep a copy outside this computer together with the <code>storage/private</code> folder (uploaded files).
          To restore: create an empty database and import the .sql file in phpMyAdmin.</p><button class="btn btn-primary btn-sm" data-backup><i class="bi bi-hdd"></i> Create backup now</button></div></div>`
        + UI.table([['File', 'name'], ['Date', 'date'], ['Size', 'size', (v) => UI.num(v / 1024, 1) + ' KB']], d.backups, { title: 'Backups', actions: () => UI.btn('dl', 'Download'), onAction: (a, b) => { window.location = 'index.php?api=backup_download&file=' + encodeURIComponent(b.name); } })]);
    }
    const catForm = (c = {}) => UI.formModal(c.id ? 'Edit category' : 'Add category', [{ name: 'name', label: 'Category', required: true, col: 6, value: c.name }, { name: 'amount', label: 'Preset amount', type: 'money', required: true, col: 3, value: c.amount },
      { name: 'sort_order', label: 'Order', type: 'number', col: 3, value: c.sort_order ?? 0 }, { name: 'active', label: 'Active (shown to dispatchers)', type: 'checkbox', value: c.id ? c.active : 1, col: 12 }], 'Admin.fund_category_save', { extra: c.id ? { id: c.id } : {} });
    tabs.push(['log', 'Activity log', () => UI.filterModal(ctx, [{ name: 'from', label: 'From', type: 'date', col: 6 }, { name: 'to', label: 'To', type: 'date', col: 6 },
        { name: 'area', label: 'Area', type: 'select', options: UI.list(d.areas), col: 6 }, { name: 'actor_id', label: 'User', type: 'select', options: UI.opts(d.actors, u => u.full_name), col: 6 }],
        { hint: `Showing ${UI.date(d.range.from)} – ${UI.date(d.range.to)}.` })
      + UI.table([['When', 'created_at', 'datetime'], ['Who', 'actor'], ['Role', 'role', (v) => UI.esc(d.roles[v] || (v ? v : 'System'))], ['Area', 'area'], ['Record', 'record_ref'], ['Action', 'action'], ['Details', 'details']], d.events,
        { title: 'Who created, changed, approved or processed what (with date and time)' })]);
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, tabs, ctx.query.from || ctx.query.area ? 'log' : null);
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-addcat]')) catForm();
      if (e.target.closest('[data-backup]')) { try { UI.result(await App.api('Admin.backup_create', {})); App.route(); } catch (x) { UI.toast(x.message, 'error'); } }
    });
  },
});
