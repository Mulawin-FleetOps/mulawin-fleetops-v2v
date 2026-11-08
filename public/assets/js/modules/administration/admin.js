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
    const addPasswordVisibility = (wrap) => {
      ['password', 'password_confirm'].forEach(name => {
        const field = wrap.querySelector(`input[name="${name}"]`);
        if (!field) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-outline-secondary mt-1';
        button.textContent = 'Show password';
        button.setAttribute('aria-label', `Show ${name === 'password' ? 'password' : 'confirmation password'}`);
        button.setAttribute('aria-pressed', 'false');
        field.insertAdjacentElement('afterend', button);
        button.addEventListener('click', () => {
          const show = field.type === 'password';
          field.type = show ? 'text' : 'password';
          button.textContent = show ? 'Hide password' : 'Show password';
          button.setAttribute('aria-pressed', String(show));
        });
      });
    };
    const userForm = (u = {}) => {
      const availableRoles = roles.filter(([role]) => roleAvailable(role, u));
      const wrap = UI.formModal(u.id ? 'Edit ' + UI.esc(u.username) : 'New user account', [
        { name: 'full_name', label: 'Full name', required: true, col: 6, value: u.full_name },
        ...(u.id ? [] : [{ name: 'username', label: 'Username', required: true, col: 6, help: 'Letters, numbers, dot, dash or underscore.' }]),
        { name: 'email', label: 'Email (login codes are sent here)', type: 'email', required: true, col: 6, value: u.email },
        ...(u.id ? [] : [{ name: 'password', label: 'Password', type: 'password', required: true, col: 6, attrs: 'autocomplete="new-password" maxlength="72"', help: (App.me.passwordMin || 8) + '+ characters with letters and numbers. Give it to the user privately.' },
          { name: 'password_confirm', label: 'Confirm password', type: 'password', required: true, col: 6, attrs: 'autocomplete="new-password" maxlength="72"', help: 'Type the same password again.' }]),
        { name: 'role', label: 'Role', type: 'select', options: availableRoles, required: true, col: 6, value: u.role },
        { name: 'shift', label: 'Shift (dispatchers)', type: 'select', options: UI.list(shifts), col: 6, value: u.shift }], 'Admin.user_save', { extra: u.id ? { id: u.id } : {},
          transform: (x) => { if (!u.id && x.password !== x.password_confirm) throw new Error('The password and the confirmation do not match.'); return x; } });
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
      if (!u.id) addPasswordVisibility(wrap);
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
              if (a === 'pw') {
                const passwordResetModal = UI.formModal('Reset password for ' + UI.esc(u.username), [{ name: 'password', label: 'New password', type: 'password', required: true, col: 12, attrs: 'autocomplete="new-password" maxlength="72"', help: 'Share the new password securely. Existing sessions are signed out, and email verification is still required at sign-in.' },
                { name: 'password_confirm', label: 'Confirm new password', type: 'password', required: true, col: 12, attrs: 'autocomplete="new-password" maxlength="72"' }], 'Admin.user_password',
                { extra: { user_id: u.id }, size: '', transform: (x) => { if (x.password !== x.password_confirm) throw new Error('The passwords do not match.'); return x; } });
                addPasswordVisibility(passwordResetModal);
              }
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
      // CHECKLIST_42_ATTENDANCE_PHASE2_V1: time-of-day settings (format 'hour') are shown and chosen as 12-hour
      // times (6 -> 6:00 AM, 18 -> 6:00 PM); the value sent and stored is still the hour 0-23.
      const hour12 = (h) => `${(+h % 12) || 12}:00 ${+h < 12 ? 'AM' : 'PM'}`;
      const settingText = (v, s) => s.format === 'hour' ? `${hour12(v)} <span class="small text-muted">${UI.esc(s.unit)}</span>` : `${UI.num(v, 2)} ${UI.esc(s.unit)}`;
      const settingField = (s) => s.format === 'hour'
        ? { name: 'value', label: `Time (${s.unit})`, type: 'select', options: Array.from({ length: 24 }, (_, h) => [String(h), hour12(h)]), value: String(Math.round(+s.value)), required: true, col: 12 }
        : { name: 'value', label: `Value (${s.unit}, ${s.min} to ${s.max})`, type: 'number', step: 'any', value: s.value, required: true, col: 12 };
      tabs.push(['settings', 'Settings', () => UI.table([['Setting', 'label', (v, s) => `<b>${UI.esc(v)}</b>${s.help ? `<div class="small text-muted">${UI.esc(s.help)}</div>` : ''}`], ['Value', 'value', settingText],
          ['Default', 'default', settingText]], d.settings, { title: 'System settings', actions: () => UI.btn('edit', 'Change'),
          onAction: (a, s) => UI.formModal(UI.esc(s.label), [settingField(s)], 'Admin.setting_save', { extra: { key: s.key }, size: '' }) })
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
      const html = UI.kv(fields) + (changes.length
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
    UI.tabs(box, tabs, ctx.query.from || ctx.query.area ? 'log' : null);
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-addcat]')) catForm();
      if (e.target.closest('[data-backup]')) { if (!await UI.confirmProceed('Create backup', 'Create a new database backup now?', 'Create backup')) return; try { UI.result(await App.api('Admin.backup_create', {})); App.route(); } catch (x) { UI.toast(x.message, 'error'); } }
    });
  },
});
