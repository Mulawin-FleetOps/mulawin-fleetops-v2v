/* =====================================================================
   assets/js/core.js — app shell, router and shared screen helpers
   =====================================================================
   - App.start()        sign in (password + email code) and the main shell
   - App.page(id, def)  each module file registers its pages here
   - App.api(name, d)   POST to the backend (Module.action)
   - UI.*               tables, forms, modals, filters, drawers, badges, charts, map, signature
   MODULE ISOLATION: every page loads its own data. If one module file
   (assets/js/modules/<department>/*.js) or its backend fails, only that page shows
   an error; the sidebar and the other pages keep working.
   ===================================================================== */
'use strict';

const UI = {};
const App = {
  pages: {}, me: null, csrf: '', current: null, timer: null,

  /** Called by module files: App.page('trips', {title, subtitle, render}) */
  page(id, def) { this.pages[id] = def; },

  // ---------------------------------------------------------------- API
  async request(url, opts = {}) {
    let res, data;
    try { res = await fetch(url, { credentials: 'same-origin', ...opts }); }
    catch { throw new Error('Cannot reach the server. Check that Apache (XAMPP) is running.'); }
    try { data = await res.json(); }
    catch { throw new Error('The server returned an invalid answer. Check the PHP error log.'); }
    if (res.status === 401 && this.me) { this.me = null; clearInterval(this.timer); this.loginScreen(data.error); throw new Error(data.error || 'Please log in.'); }
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed.');
    return data;
  },
  async api(action, payload = {}) {
    const r = await this.request('index.php?api=' + encodeURIComponent(action), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, body: JSON.stringify(payload) });
    return r.data || {};
  },
  async data(page, query = {}) {
    const qs = new URLSearchParams({ api: 'data', page, ...query });
    return (await this.request('index.php?' + qs.toString())).data;
  },
  /** POST with files: normal fields go in "payload" (JSON), files keep their input names. */
  async apiForm(action, payload, form, extraFiles = {}) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload || {}));
    if (form) form.querySelectorAll('input[type=file][name]').forEach(inp => [...inp.files].forEach(f => fd.append(inp.name + (inp.multiple ? '[]' : ''), f)));
    Object.entries(extraFiles).forEach(([name, file]) => file && fd.append(name, file, file.name || name + '.png'));
    const r = await this.request('index.php?api=' + encodeURIComponent(action), { method: 'POST', headers: { 'X-CSRF-Token': this.csrf }, body: fd });
    return r.data || {};
  },
  async upload(formData) {
    formData.append('csrf', this.csrf);
    return (await this.request('index.php?api=document_upload', { method: 'POST', body: formData })).data;
  },

  // ---------------------------------------------------------------- start
  async start() {
    try {
      const w = await this.request('index.php?api=whoami');
      this.csrf = w.csrf;
      if (w.signedIn) return await this.loadMe();
      if (w.otp) return this.otpScreen(w.otp);
      this.loginScreen();
    } catch (e) { this.loginScreen(e.message); }
  },
  async loadMe() {
    const me = await this.request('index.php?api=me');
    this.me = me; this.csrf = me.csrf;
    this.shell();
    window.onhashchange = () => this.route();
    this.route();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refreshBell(), 30000);
  },
  async postAuth(api, body) {
    const w = await this.request('index.php?api=whoami'); this.csrf = w.csrf;
    return this.request('index.php?api=' + api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, csrf: this.csrf }) });
  },

  /** Two-column sign-in frame used by the password, code and recovery screens. */
  authFrame(inner) {
    document.getElementById('app').innerHTML = `
    <div class="auth-page"><div class="auth-shell">
      <section class="auth-side" aria-hidden="true">
        <div class="auth-side-brand"><img src="assets/img/logo.png" alt="" class="auth-logo" onerror="this.remove()">
          <div><div class="auth-side-company">R.P. Mulawin Trucking Services</div><div class="auth-side-product">Mulawin FleetOps</div></div></div>
        <div class="auth-side-copy"><h2>Fleet operations and financial monitoring</h2>
          <ul><li>Trips from request to payment</li><li>Truck, driver, client and mechanic masterlists</li><li>Corrective maintenance, parts and purchasing</li><li>Billing, collections and reports</li></ul></div>
        <div class="auth-side-foot">Car Carrier · Container · Wing Van</div>
      </section>
      <main class="auth-main"><div class="auth-card" id="authCard">${inner}</div>
        <p class="auth-foot">Mulawin FleetOps &copy; ${new Date().getFullYear()} · Authorized personnel only</p></main>
    </div></div>`;
    return document.getElementById('authCard');
  },
  authAlert(message, ok) {
    return message ? `<div class="alert alert-${ok ? 'success' : 'danger'} auth-alert" role="alert">${UI.esc(message)}</div>` : '';
  },

  loginScreen(message = '', username = '', ok = false) {
    this.authFrame(`
      <div class="auth-head"><h1>Sign in</h1><p>Step 1 of 2 · Enter your username (or email) and password.</p></div>
      ${this.authAlert(message, ok)}
      <form id="loginForm" novalidate>
        <div class="mb-3"><label class="form-label" for="lgU">Username or email</label>
          <input class="form-control" id="lgU" name="username" autocomplete="username" value="${UI.esc(username)}" required></div>
        <div class="mb-4"><label class="form-label" for="lgP">Password</label>
          <div class="input-group"><input class="form-control" type="password" id="lgP" name="password" autocomplete="current-password" required>
          <button class="btn btn-outline-secondary" type="button" id="lgEye" aria-label="Show password"><i class="bi bi-eye"></i></button></div></div>
        <button class="btn btn-primary w-100 auth-btn" type="submit">Continue</button>
        <p class="auth-note">A 6-digit code will be sent to your registered email.</p>
        <div class="auth-links"><span>Forgot your password? Ask the Admin to set a new one.</span>
          <button type="button" class="btn btn-link btn-sm p-0" id="lgRecover">Admin recovery code</button></div>
      </form>`);
    document.getElementById(username ? 'lgP' : 'lgU').focus();
    document.getElementById('lgEye').onclick = (e) => { const p = document.getElementById('lgP'); p.type = p.type === 'password' ? 'text' : 'password'; e.currentTarget.innerHTML = `<i class="bi bi-eye${p.type === 'password' ? '' : '-slash'}"></i>`; };
    document.getElementById('lgRecover').onclick = () => this.recoverScreen();
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.username || !f.password) return this.loginScreen('Enter your username and password.', f.username || '');
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Checking and sending the code…';
      try { const r = await this.postAuth('login', f); this.otpScreen(r.otp, r.notice || '', !!r.notice); }
      catch (err) { this.loginScreen(err.message, f.username || ''); }
    };
  },

  /** Step 2: the code sent to the user's email. */
  otpScreen(otp, message = '', ok = false) {
    this.authFrame(`
      <div class="auth-head"><h1>Check your email</h1><p>Step 2 of 2 · We sent a 6-digit code to <b>${UI.esc(otp.email)}</b>. It expires in ${UI.esc(otp.minutes)} minutes.</p></div>
      ${this.authAlert(message, ok)}
      <form id="otpForm" novalidate>
        <label class="form-label" for="otpCode">Verification code</label>
        <input class="form-control otp-input" id="otpCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required>
        <button class="btn btn-primary w-100 auth-btn mt-3" type="submit">Verify and sign in</button>
        <div class="auth-links mt-3"><button type="button" class="btn btn-link btn-sm p-0" id="otpResend" disabled>Send a new code</button>
          <button type="button" class="btn btn-link btn-sm p-0" id="otpBack">Use a different account</button></div>
        <p class="auth-note">Not in your inbox? Check the Spam folder. Only the newest code works.</p>
      </form>`);
    const input = document.getElementById('otpCode'); input.focus();
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); };
    const resend = document.getElementById('otpResend');
    let wait = +otp.resend_in || 0;
    clearInterval(this._otpTimer);
    const tick = () => { resend.disabled = wait > 0; resend.textContent = wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'; wait--; if (wait < -1) clearInterval(this._otpTimer); };
    tick(); this._otpTimer = setInterval(tick, 1000);
    resend.onclick = async () => {
      resend.disabled = true;
      try { const r = await this.postAuth('otp_resend', {}); this.otpScreen(r.otp, r.data?.message || 'A new code was sent.', true); }
      catch (err) { if (/expired|log in again|username and password/i.test(err.message)) this.loginScreen(err.message); else this.otpScreen({ ...otp, resend_in: 0 }, err.message); }
    };
    document.getElementById('otpBack').onclick = async () => { clearInterval(this._otpTimer); try { await this.postAuth('otp_cancel', {}); } catch { } this.loginScreen(); };
    document.getElementById('otpForm').onsubmit = async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) return this.otpScreen({ ...otp, resend_in: Math.max(0, wait) }, 'Enter the 6-digit code from the email.');
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await this.postAuth('otp_verify', { code }); clearInterval(this._otpTimer); location.hash = ''; await this.loadMe(); }
      catch (err) {
        if (/expired\. Enter|log in again|username and password|locked/i.test(err.message)) { clearInterval(this._otpTimer); return this.loginScreen(err.message); }
        this.otpScreen({ ...otp, resend_in: Math.max(0, wait) }, err.message);
      }
    };
  },

  /**
   * Forgotten Admin password: the printed one-time recovery code (made by the Admin in the
   * name menu > Recovery code) + a new password. Logging in afterwards still needs the email code.
   */
  recoverScreen(message = '') {
    this.authFrame(`<div class="auth-head"><h1>Admin recovery</h1><p>Use the printed recovery code of the Admin account to set a new password.</p></div>
      ${this.authAlert(message)}
      <form id="recForm" novalidate>
        <div class="mb-2"><label class="form-label" for="rcU">Admin username</label><input class="form-control" id="rcU" name="username" autocomplete="username" required></div>
        <div class="mb-2"><label class="form-label" for="rcC">Recovery code</label><input class="form-control text-uppercase" id="rcC" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" required></div>
        <div class="mb-2"><label class="form-label" for="rcP">New password</label><input class="form-control" type="password" id="rcP" name="new_password" autocomplete="new-password" required>
          <div class="form-text">${App.passwordMin || 8}+ characters with letters and numbers.</div></div>
        <div class="mb-3"><label class="form-label" for="rcP2">Type the new password again</label><input class="form-control" type="password" id="rcP2" name="confirm" autocomplete="new-password" required></div>
        <button class="btn btn-primary w-100" type="submit"><i class="bi bi-key me-1"></i> Reset the password</button>
        <div class="text-center mt-3"><button type="button" class="btn btn-link btn-sm p-0" id="rcBack">Back to sign in</button></div>
        <p class="auth-note">No recovery code? Ask IT to run <code>scripts/reset_password.php</code> on the server.</p>
      </form>`);
    document.getElementById('rcBack').onclick = () => this.loginScreen();
    document.getElementById('recForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.username || !f.code || !f.new_password) return this.recoverScreen('Fill in all the fields.');
      if (f.new_password !== f.confirm) return this.recoverScreen('The new passwords do not match.');
      try {
        const w = await this.request('index.php?api=whoami'); this.csrf = w.csrf;
        const r = await this.request('index.php?api=recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username, code: f.code, new_password: f.new_password, csrf: this.csrf }) });
        this.loginScreen(r.data?.message || 'Password reset.', f.username, true);
      } catch (err) { this.recoverScreen(err.message); }
    };
  },

  /** Admin: make a new recovery code (needs the current password). Shown once. */
  recoveryCode() {
    UI.modal('Admin recovery code', `<p class="small">If the Admin password is forgotten, this code lets you set a new password from the sign-in page
      (<b>Admin recovery code</b>). It works <b>one time</b>. Making a new code cancels the old one. Logging in still needs the email code.</p>
      ${UI.fields([{ name: 'current_password', label: 'Your current password', type: 'password', required: true, col: 12 }])}`, async (d) => {
      const r = await App.api('Admin.recovery_code_create', d);
      App.me.user.recovery_ready = true;
      const code = r.code;
      const sheet = `<div class="pf"><div class="pf-head">${UI.logoTag('pf-logo-img')}<div><div class="pf-co">${UI.esc((App.me.company || {}).name || '')}</div></div></div>
        <div class="pf-title">ADMIN RECOVERY CODE</div><p>Admin username: <b>${UI.esc(App.me.user.username)}</b></p>
        <p style="font-size:26px;font-weight:bold;letter-spacing:3px;border:1px dashed #333;padding:12px;text-align:center">${UI.esc(code)}</p>
        <p>Use it on the sign-in page (Admin recovery code). It works one time only. Keep this paper in a safe place.</p>
        <p style="font-size:11px;color:#555">Made on ${UI.esc(new Date().toLocaleString('en-PH'))}</p></div>`;
      UI.modal('Save this recovery code now', `<div class="alert alert-warning small">This code is shown only once. Print it or write it down, then keep it in a safe place.</div>
        <div class="text-center fs-3 fw-bold py-3" style="letter-spacing:3px">${UI.esc(code)}</div>`, null,
        { size: '', extraFooter: '<button type="button" class="btn btn-primary btn-sm" id="rcPrint"><i class="bi bi-printer"></i> Print</button>',
          onShow: (w) => { w.querySelector('#rcPrint').onclick = () => UI.print(sheet); } });
    }, { size: '', submit: 'Make a new code' });
  },

  passwordScreen() {
    const body = UI.fields([{ name: 'current_password', label: 'Current password', type: 'password', required: true, col: 12, attrs: 'autocomplete="current-password"' },
      { name: 'new_password', label: 'New password', type: 'password', required: true, col: 12, attrs: 'autocomplete="new-password"', help: (App.me?.passwordMin || 8) + '+ characters with letters and numbers.' },
      { name: 'confirm', label: 'Type the new password again', type: 'password', required: true, col: 12, attrs: 'autocomplete="new-password"' }]);
    UI.modal('Change password', body, async (d) => {
      if (d.new_password !== d.confirm) throw new Error('The new passwords do not match.');
      await this.api('Admin.change_password', d); UI.toast('Password changed.');
    }, { submit: 'Save password', size: '' });
  },

  async logout() {
    try { await this.request('index.php?api=logout', { method: 'POST', headers: { 'X-CSRF-Token': this.csrf } }); } catch { }
    clearInterval(this.timer); this.me = null; location.hash = ''; this.start();
  },

  // ---------------------------------------------------------------- shell
  shell() {
    const me = this.me, u = me.user;
    const initials = (u.full_name || u.username).split(/[\s,]+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
    const link = (n) => `<a href="#${n.id}" class="nav-item-link" data-nav="${n.id}"><i class="bi ${n.icon}"></i><span>${UI.esc(n.label)}</span></a>`;
    let nav = me.nav.filter(n => !n.section).map(link).join('');
    (me.sections || []).forEach(sec => {
      const items = me.nav.filter(n => n.section === sec && n.id !== 'notifications'); if (!items.length) return;
      nav += `<div class="nav-section">${UI.esc(sec)}</div>${items.map(link).join('')}`;
    });
    document.getElementById('app').innerHTML = `
    <div class="app-shell" id="appShell">
      <aside class="sidebar" id="appSidebar" aria-label="Main menu">
        <a href="#dashboard" class="sidebar-brand">${UI.logoTag('sidebar-logo')}<span><span class="brand-product">Mulawin FleetOps</span><span class="brand-company">R.P. Mulawin Trucking</span></span></a>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-foot">${UI.esc(u.role_label)}${u.shift ? ' · ' + UI.esc(u.shift) + ' shift' : ''}</div>
      </aside>
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <div class="main">
        <header class="topbar no-print">
          <button class="icon-btn d-lg-none" id="menuBtn" type="button" aria-label="Open the menu"><i class="bi bi-list"></i></button>
          <div class="crumbs" id="crumbs"></div>
          <div class="topbar-actions">
            <div class="dropdown">
              <button class="icon-btn bell" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-label="Notifications" id="bellBtn"><i class="bi bi-bell"></i><span class="bell-count d-none" id="bellBadge">0</span></button>
              <div class="dropdown-menu dropdown-menu-end bell-menu">
                <div class="bell-head"><span>Notifications</span><button type="button" class="btn btn-link btn-sm p-0" id="bellReadAll">Mark all as read</button></div>
                <div id="bellList" class="bell-list"></div>
                <a href="#notifications" class="bell-foot" id="bellAll">View all notifications</a>
              </div>
            </div>
            <div class="dropdown">
              <button class="profile-btn" type="button" data-bs-toggle="dropdown"><span class="avatar">${UI.esc(initials)}</span>
                <span class="profile-text"><span class="profile-name">${UI.esc(u.full_name)}</span><span class="profile-role">${UI.esc(u.role_label)}</span></span><i class="bi bi-chevron-down"></i></button>
              <div class="dropdown-menu dropdown-menu-end">
                <div class="dropdown-header">${UI.esc(u.username)} · ${UI.esc(u.email || '')}</div>
                <button class="dropdown-item" id="mySig"><i class="bi bi-pen"></i> My e-signature${u.has_signature ? '' : ' <span class="badge-s amber">not set</span>'}</button>
                <button class="dropdown-item" id="chgPw"><i class="bi bi-key"></i> Change password</button>
                ${u.role === 'admin' ? '<button class="dropdown-item" id="recCode"><i class="bi bi-shield-lock"></i> Recovery code</button>' : ''}
                <div class="dropdown-divider"></div>
                <button class="dropdown-item text-danger" id="logoutBtn"><i class="bi bi-box-arrow-right"></i> Log out</button>
              </div>
            </div>
          </div>
        </header>
        <main class="content" id="pageContent"></main>
      </div>
    </div><div id="printArea"></div>`;
    const sb = document.getElementById('appSidebar'), bd = document.getElementById('sidebarBackdrop');
    document.getElementById('menuBtn').onclick = () => { sb.classList.add('open'); bd.classList.add('show'); };
    bd.onclick = () => { sb.classList.remove('open'); bd.classList.remove('show'); };
    document.getElementById('logoutBtn').onclick = () => UI.confirm('Log out', 'Log out of Mulawin FleetOps?', () => this.logout(), { submit: 'Log out' });
    document.getElementById('chgPw').onclick = () => this.passwordScreen();
    document.getElementById('recCode')?.addEventListener('click', () => this.recoveryCode());
    document.getElementById('mySig').onclick = () => UI.signatureModal();
    document.getElementById('bellReadAll').onclick = async () => { try { this.applyBell(await this.api('Admin.notifications_read', {})); } catch (e) { UI.toast(e.message, 'error'); } };
    document.getElementById('bellAll').onclick = () => bootstrap.Dropdown.getInstance(document.getElementById('bellBtn'))?.hide();
    this.renderBell();
  },

  renderBell() {
    const me = this.me; const badge = document.getElementById('bellBadge'); if (!badge) return;
    badge.textContent = me.unread > 99 ? '99+' : me.unread; badge.classList.toggle('d-none', !me.unread);
    const list = document.getElementById('bellList');
    list.innerHTML = me.notifications.length ? me.notifications.map(n => `
      <div class="bell-item ${n.state === 'Unread' ? 'unread' : ''}" data-nid="${n.id}">
        <div class="bell-item-main" data-nopen="${n.id}" role="button" tabindex="0"><div class="bell-cat">${UI.esc(n.category)}</div><div class="bell-msg">${UI.esc(n.message)}</div>
          <div class="bell-time">${UI.datetime(n.created_at)}</div></div>
        <button type="button" class="btn btn-sm btn-light bell-resolve" data-nresolve="${n.id}" title="Mark as resolved"><i class="bi bi-check2"></i></button>
      </div>`).join('') : '<div class="bell-empty"><i class="bi bi-bell-slash"></i><span>No active notifications.</span></div>';
    list.querySelectorAll('[data-nopen]').forEach(el => el.onclick = async () => {
      const n = me.notifications.find(x => String(x.id) === el.dataset.nopen);
      bootstrap.Dropdown.getInstance(document.getElementById('bellBtn'))?.hide();
      await this.notificationState(n.id, 'Read');
      UI.modal(UI.esc(n.category), `<p class="mb-2">${UI.esc(n.message)}</p><div class="small text-muted">Received ${UI.datetime(n.created_at)}</div>`, null, { size: '',
        extraFooter: `<button type="button" class="btn btn-outline-success btn-sm" data-r>Mark as resolved</button>${n.page && UI.canGo(n.page) ? '<button type="button" class="btn btn-primary btn-sm" data-o>Open</button>' : ''}`,
        onShow: (w) => {
          w.querySelector('[data-r]').onclick = async () => { const r = await this.notificationState(n.id, 'Resolved'); if (r) UI.toast(r.message); bootstrap.Modal.getInstance(w).hide(); };
          w.querySelector('[data-o]')?.addEventListener('click', () => { bootstrap.Modal.getInstance(w).hide(); this.go(n.page); });
        } });
    });
    list.querySelectorAll('[data-nresolve]').forEach(b => b.onclick = async (e) => { e.stopPropagation(); const r = await this.notificationState(b.dataset.nresolve, 'Resolved'); if (r) UI.toast(r.message); });
  },
  /** Applies bell data returned by a notification action (keeps the bell in step at once). */
  applyBell(r) {
    if (!r || !this.me || !r.items) return;
    this.me.notifications = r.items; this.me.unread = r.unread; this.renderBell();
  },
  async notificationState(id, state) {
    try { const r = await this.api('Admin.notifications_read', { id, state }); this.applyBell(r); return r; }
    catch (e) { UI.toast(e.message, 'error'); return null; }
  },
  async refreshBell() {
    if (!this.me) return;
    try { const me = await this.request('index.php?api=me'); this.me.notifications = me.notifications; this.me.unread = me.unread; this.renderBell(); } catch { }
  },

  // ---------------------------------------------------------------- router (#page?x=y)
  go(page, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const hash = '#' + page + (qs ? '?' + qs : '');
    if (location.hash === hash) this.route(); else location.hash = hash;
  },
  async route() {
    if (!this.me) return;
    const [page, qs] = (location.hash.slice(1) || 'dashboard').split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const nav = this.me.nav.find(n => n.id === page);
    if (!nav) return this.go('dashboard');
    this.current = { page, query };
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
    document.getElementById('appSidebar').classList.remove('open'); document.getElementById('sidebarBackdrop').classList.remove('show');
    document.getElementById('crumbs').innerHTML = `${nav.section ? `<span class="crumb-sec">${UI.esc(nav.section)}</span><i class="bi bi-chevron-right"></i>` : ''}<span class="crumb-page">${UI.esc(nav.label)}</span>`;
    document.title = nav.label + ' · Mulawin FleetOps';
    const el = document.getElementById('pageContent');
    const def = this.pages[page];
    if (!def) {
      el.innerHTML = `<div class="page-head"><div><h1 class="page-title">${UI.esc(nav.label)}</h1></div></div>
        <div class="module-down"><i class="bi bi-exclamation-triangle"></i><div>This page's screen file (assets/js/modules/${UI.esc(nav.js)}.js) did not load. The other pages still work. Reload the page or check the file.</div></div>`;
      return;
    }
    el.innerHTML = `<div class="page-head"><div class="page-head-text"><h1 class="page-title" id="pageTitle">${UI.esc(def.title || nav.label)}</h1>${def.subtitle ? `<p class="page-subtitle" id="pageSubtitle">${UI.esc(def.subtitle)}</p>` : ''}</div>
        <div class="page-actions no-print" id="pageTools"></div></div>
        <div id="pageBody" class="page-body"><div class="loading-block"><span class="spinner-border spinner-border-sm"></span> Loading…</div></div>`;
    if (this._lastPage !== page) {
      window.scrollTo(0, 0);
      // A details drawer belongs to its page: close it when the user moves to another page.
      document.querySelectorAll('.offcanvas.app-drawer').forEach(o => { bootstrap.Offcanvas.getInstance(o)?.hide(); o.remove(); });
      document.querySelectorAll('.offcanvas-backdrop').forEach(x => x.remove());
      document.body.style.removeProperty('overflow'); document.body.style.removeProperty('padding-right');
    }
    this._lastPage = page;
    const body = document.getElementById('pageBody');
    const ctx = { page, query, el: body, tools: document.getElementById('pageTools'), me: this.me, data: null,
      reload: () => this.route(), go: (p, q) => this.go(p, q), setQuery: (q) => this.go(page, { ...query, ...q }),
      setTitle: (t, s) => { document.getElementById('pageTitle').textContent = t; const st = document.getElementById('pageSubtitle'); if (st) st.textContent = s || ''; } };
    try {
      ctx.data = def.noData ? {} : await this.data(page, query);
      if (this.current.page !== page) return;
      body.innerHTML = '';
      await def.render(ctx);
      UI.activate(body);
      if (ctx.data && ctx.data._errors && Object.keys(ctx.data._errors).length) {
        body.insertAdjacentHTML('afterbegin', `<div class="alert alert-warning">${Object.values(ctx.data._errors).map(UI.esc).join('<br>')}</div>`);
      }
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="module-down"><i class="bi bi-exclamation-triangle"></i><div>${UI.esc(e.message)}<div class="small mt-1">Only this page is affected. You can keep using the other pages.</div></div></div>`;
    }
  },
};

// =====================================================================
//  UI HELPERS
// =====================================================================
UI.esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
UI.money = (v) => (v === null || v === undefined || v === '') ? '—' : '₱' + Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
UI.num = (v, d = 0) => (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('en-PH', { maximumFractionDigits: d });
UI.date = (v) => v ? new Date(String(v).replace(' ', 'T')).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
UI.datetime = (v) => v ? new Date(String(v).replace(' ', 'T')).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
UI.today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
UI.label = (role) => (App.me && App.me.roles[role]) || role;
UI.role = (...roles) => App.me && roles.includes(App.me.user.role);
UI.isDispatcher = () => UI.role('car_carrier_dispatcher', 'container_wingvan_dispatcher');

/** Status colors: the same meaning everywhere (green = good, blue = in progress, amber = waiting, red = problem). */
UI.badgeColor = (s) => {
  const v = String(s || '');
  if (/^(Available|Completed|Paid|Approved|Released|Liquidated|Received|Active|OK|Resolved|Repaired - Cleared to Continue|Returned to service|Passed|Read)$/.test(v)) return 'green';
  if (/^(Assigned|Pre-Assigned|Ready for Dispatch|Dispatched|In Transit|On Trip|Ready for Release|Ongoing|Invoiced|For Billing|Partially Paid|Partially Released|Partially Received|Stock Out|Pending Payment|Under Inspection|Under Repair|Normal)$/.test(v)) return 'blue';
  if (/^(Pending Approval|Pending Review|Pending Rate|Awaiting Resources|Awaiting verification|Requested|Reported|Not Liquidated|Minor|Adjustment|Incomplete|Unpaid|Closed|High|Unread)$/.test(v)) return 'amber';
  if (/(Under Maintenance|On Hold|For Reschedule|Rejected|Cancelled|Not Available|Unavailable|Major|Overdue|Inactive|Delayed|Insufficient|Critical|Failed)/.test(v)) return 'red';
  return '';
};
UI.badge = (s) => s === null || s === undefined || s === '' ? '—' : `<span class="badge-s ${UI.badgeColor(s)}">${UI.esc(s)}</span>`;
UI.days = (d) => {
  if (d === null || d === undefined || d === '') return '—';
  const n = +d; const c = n < 0 ? 'red' : n <= 30 ? 'amber' : 'green';
  return `<span class="badge-s ${c}">${n < 0 ? 'expired ' + Math.abs(n) + 'd ago' : n === 0 ? 'today' : n + ' days left'}</span>`;
};
UI.fmt = (type, v, row) => {
  if (typeof type === 'function') return type(v, row);
  switch (type) {
    case 'money': return UI.money(v); case 'date': return UI.date(v); case 'datetime': return UI.datetime(v);
    case 'badge': return UI.badge(v); case 'days': return UI.days(v); case 'num': return UI.num(v, 2);
    case 'yes': return +v ? 'Yes' : 'No';
    default: return v === null || v === undefined || v === '' ? '—' : UI.esc(v);
  }
};

/** Toast message (bottom right). type: '' (success), 'error', 'warn', 'info'. */
UI.toast = (msg, type = '') => {
  if (!msg) return;
  const icon = { error: 'bi-x-circle-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[type] || 'bi-check-circle-fill';
  const el = document.createElement('div'); el.className = 'app-toast ' + type; el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="bi ${icon}"></i><span></span><button type="button" class="toast-x" aria-label="Close">&times;</button>`;
  el.querySelector('span').textContent = msg;
  el.querySelector('.toast-x').onclick = () => el.remove();
  document.getElementById('toastZone').append(el); setTimeout(() => el.remove(), type ? 9000 : 5000);
};
/** Shows the result of a backend action (message + warning). */
UI.result = (r) => { UI.toast(r.message || 'Saved.'); if (r.warning) UI.toast(r.warning, 'warn'); };

/** Company logo (redrawn from the reference forms). */
UI.logoTag = (cls = '') => `<img src="assets/img/logo.svg" alt="RPM" class="${cls}">`;

/** A button in the page header (top right). */
UI.tool = (ctx, label, fn, icon = '', cls = 'outline-secondary') => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-' + cls;
  b.innerHTML = (icon ? `<i class="bi ${icon}"></i> ` : '') + UI.esc(label); b.onclick = fn; ctx.tools.append(b); return b;
};

/**
 * Metric strip: one bordered panel divided into segments (label, value, note).
 * items: [{label, value, note, color: green|blue|amber|red, go: 'page?x=y', format: 'money'}]
 */
UI.statusStrip = (items) => `<div class="metric-strip">${(items || []).map(c => { const go = c.go && UI.canGo(c.go);
  return `<div class="metric ${c.color || ''} ${go ? 'clickable' : ''}" ${go ? `data-go="${UI.esc(c.go)}" role="link" tabindex="0"` : ''}>
    <div class="metric-label">${c.color ? '<span class="dot"></span>' : ''}${UI.esc(c.label)}</div>
    <div class="metric-value">${c.format === 'money' ? UI.money(c.value) : UI.esc(typeof c.value === 'number' ? UI.num(c.value, 2) : c.value)}</div>
    ${c.note ? `<div class="metric-note">${UI.esc(c.note)}</div>` : ''}</div>`; }).join('')}</div>`;
/** Dashboard / report cards use the same metric strip. */
UI.cards = (cards) => UI.statusStrip((cards || []).map(c => ({ label: c.label, value: c.value, note: c.hint, color: c.color && c.color !== 'gray' ? c.color : '', go: c.page, format: c.format })));
UI.goParts = (spec) => {
  const [main, mem] = String(spec || '').split('#'); const [page, qs] = main.split('?');
  return { page, query: Object.fromEntries(new URLSearchParams(qs || '')), tabs: [...new URLSearchParams(mem || '')] };
};
UI.canGo = (spec) => !!spec && !!App.me && (App.me.nav || []).some(n => n.id === UI.goParts(spec).page);
UI.goTo = (spec) => {
  const g = UI.goParts(spec);
  g.tabs.forEach(([k, v]) => sessionStorage.setItem('tab:' + g.page + (k === '_' ? '' : ':' + k), v));
  App.go(g.page, g.query);
};

UI.bindGo = (root) => root.querySelectorAll('[data-go]').forEach(x => { x.onclick = () => UI.goTo(x.dataset.go); x.onkeydown = (e) => { if (e.key === 'Enter') UI.goTo(x.dataset.go); }; });

/** Panel with a title row (used by tables, charts and sections). */
UI.card = (title, body, tools = '') => `<section class="panel">${title || tools ? `<div class="panel-head"><h2 class="panel-title">${title}</h2><div class="panel-tools">${tools}</div></div>` : ''}<div class="panel-body flush">${body}</div></section>`;

/**
 * Data table with search, paging and CSV download.
 * columns: [[label, key, format]] ; opts: {title, actions(row) -> html, onAction, rowClick(row), empty, tools, limit, plain}
 *  plain = compact table without panel and toolbar (inside drawers).
 */
UI.table = (columns, rows, opts = {}) => {
  const id = opts.id || 'tbl' + Math.random().toString(36).slice(2, 8);
  UI._tables[id] = { columns, rows: rows || [], opts, limit: opts.limit || (opts.plain ? 8 : 15), page: 0, filter: '' };
  if (opts.plain) return `<div class="plain-table"><div class="table-wrap" data-tbody="${id}"></div><div class="table-pager no-print" data-tpager="${id}"></div></div>`;
  const head = `<div class="table-tools">
      <div class="table-search"><i class="bi bi-search"></i><input class="form-control" type="search" placeholder="Search this list" aria-label="Search this list" data-tsearch="${id}"></div>
      <div class="table-tools-right"><span class="table-count" data-tcount="${id}"></span>${opts.tools || ''}
      <button type="button" class="btn btn-sm btn-outline-secondary" data-tcsv="${id}" title="Download as CSV (opens in Excel)"><i class="bi bi-download"></i> CSV</button></div></div>`;
  const html = `${head}<div class="table-wrap" data-tbody="${id}"></div><div class="table-pager no-print" data-tpager="${id}"></div>`;
  return opts.title ? UI.card(opts.title, html) : `<section class="panel"><div class="panel-body flush">${html}</div></section>`;
};
UI._tables = {};
UI.tableRows = (id) => {
  const t = UI._tables[id]; if (!t) return [];
  const f = t.filter.toLowerCase();
  return f ? t.rows.filter(r => t.columns.some(([, k]) => String(r[k] ?? '').toLowerCase().includes(f))) : t.rows;
};
/** Draws one page of a table, with page numbers. */
UI.drawTable = (id) => {
  const t = UI._tables[id]; const box = document.querySelector(`[data-tbody="${id}"]`); if (!t || !box) return;
  const rows = UI.tableRows(id);
  const count = document.querySelector(`[data-tcount="${id}"]`);
  if (count) count.textContent = rows.length === t.rows.length ? `${rows.length} record${rows.length === 1 ? '' : 's'}` : `${rows.length} of ${t.rows.length}`;
  const pager = box.parentElement.querySelector(`[data-tpager="${id}"]`);
  if (pager) pager.innerHTML = '';
  if (!rows.length) { box.innerHTML = `<div class="table-empty"><i class="bi ${t.filter ? 'bi-search' : 'bi-inbox'}"></i><span>${UI.esc(t.filter ? 'No record matches "' + t.filter + '".' : (t.opts.empty || 'No records yet.'))}</span></div>`; return; }
  const pages = Math.ceil(rows.length / t.limit);
  t.page = Math.min(Math.max(t.page, 0), pages - 1);
  const first = t.page * t.limit, shown = rows.slice(first, first + t.limit);
  const num = (f) => f === 'money' || f === 'num';
  box.innerHTML = `<table class="data-table${t.opts.rowClick ? ' clickable' : ''}"><thead><tr>${t.columns.map(([l, , f]) => `<th class="${num(f) ? 'num' : ''}">${UI.esc(l)}</th>`).join('')}${t.opts.actions ? '<th class="actions-col"><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead>
    <tbody>${shown.map((r) => `<tr data-ri="${t.rows.indexOf(r)}">${t.columns.map(([, k, f]) => `<td class="${num(f) ? 'num' : ''}">${UI.fmt(f, r[k], r)}</td>`).join('')}${t.opts.actions ? `<td class="actions-col"><div class="row-actions" data-row="${id}:${t.rows.indexOf(r)}">${t.opts.actions(r) || ''}</div></td>` : ''}</tr>`).join('')}</tbody></table>`;
  if (pager && pages > 1) {
    const nums = [];
    for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - t.page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    pager.innerHTML = `<span class="pager-info">${first + 1}–${first + shown.length} of ${rows.length}</span><nav class="pager-pages" aria-label="Pages">
      <button type="button" class="pg" data-tpg="${t.page - 1}" ${t.page === 0 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
      ${nums.map(n => n === '…' ? '<span class="pg-gap">…</span>' : `<button type="button" class="pg ${n === t.page ? 'active' : ''}" data-tpg="${n}">${n + 1}</button>`).join('')}
      <button type="button" class="pg" data-tpg="${t.page + 1}" ${t.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button></nav>`;
    pager.querySelectorAll('[data-tpg]').forEach(b => b.onclick = () => { t.page = +b.dataset.tpg; UI.drawTable(id); });
  }
  if (t.opts.onAction) box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = +b.closest('[data-row]').dataset.row.split(':')[1]; t.opts.onAction(b.dataset.act, t.rows[idx], b);
  }));
  if (t.opts.rowClick) box.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.closest('a,button,input,select,label')) return;
    t.opts.rowClick(t.rows[+tr.dataset.ri]);
  }));
};
/** Call after inserting table HTML into the page (the router calls it for the page body). */
UI.activate = (root) => {
  root.querySelectorAll('[data-tbody]').forEach(b => { if (!b.dataset.drawn) { b.dataset.drawn = '1'; UI.drawTable(b.dataset.tbody); } });
  root.querySelectorAll('[data-tsearch]').forEach(inp => { if (inp.dataset.bound) return; inp.dataset.bound = '1';
    inp.addEventListener('input', () => { const t = UI._tables[inp.dataset.tsearch]; t.filter = inp.value.trim(); t.page = 0; UI.drawTable(inp.dataset.tsearch); }); });
  root.querySelectorAll('[data-tcsv]').forEach(b => { if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', () => { const t = UI._tables[b.dataset.tcsv]; UI.csv((t.opts.title || document.title || 'report').replace(/<[^>]+>/g, ''), t.columns, UI.tableRows(b.dataset.tcsv)); }); });
  UI.bindGo(root);
  root.querySelectorAll('[data-chart]').forEach(c => { if (!c.dataset.drawn) { c.dataset.drawn = '1'; UI.drawChart(c); } });
  root.querySelectorAll('[data-tpicker]').forEach(box => { if (!box.dataset.drawn) { box.dataset.drawn = '1'; UI.drawPicker(box); } });
  root.querySelectorAll('[data-chartmore]').forEach(m => m.querySelector('button').onclick = () => {
    const holder = document.createElement('div'); holder.className = 'chart-grid';
    holder.innerHTML = (UI._more[m.dataset.chartmore] || []).map(UI.chartHtml).join('');
    m.replaceWith(holder); holder.querySelectorAll('[data-chart]').forEach(c => UI.drawChart(c));
  });
};
UI.btn = (act, label, cls = 'outline-secondary', icon = '') => `<button type="button" class="btn btn-sm btn-${cls}" data-act="${act}">${icon ? `<i class="bi ${icon}"></i> ` : ''}${UI.esc(label)}</button>`;

/** CSV download (Excel-friendly with BOM). Downloadable reports — PDF V.64. */
UI.csv = (name, columns, rows) => {
  const clean = (v) => { let s = String(v ?? '').replace(/<[^>]+>/g, ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const lines = [columns.map(c => clean(c[0])).join(','), ...rows.map(r => columns.map(([, k]) => clean(r[k])).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + UI.today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ------------------------------------------------------------------ forms
/**
 * fields: [{name, label, type, options:[[value,label]], required, value, help, col, min, step, placeholder, attrs}]
 * types: text, number, money, date, datetime, select, textarea, checkbox, password, file, hidden, html
 */
UI.fields = (fields) => `<div class="row g-2">${fields.map(UI.field).join('')}</div>`;
UI.field = (f) => {
  if (f.type === 'hidden') return `<input type="hidden" name="${f.name}" value="${UI.esc(f.value ?? '')}">`;
  if (f.type === 'html') return `<div class="col-${f.col || 12}">${f.html}</div>`;
  const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 6);
  const req = f.required ? 'required' : '';
  const val = f.value ?? '';
  let input;
  if (f.type === 'select') {
    input = `<select class="form-select form-select-sm" id="${id}" name="${f.name}" ${req} ${f.attrs || ''}>${f.placeholder === false ? '' : `<option value="">${UI.esc(f.placeholder || 'Choose…')}</option>`}
      ${(f.options || []).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${UI.esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${UI.esc(l)}</option>`; }).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea class="form-control form-control-sm" id="${id}" name="${f.name}" rows="${f.rows || 3}" ${req} placeholder="${UI.esc(f.placeholder || '')}">${UI.esc(val)}</textarea>`;
  } else if (f.type === 'checkbox') {
    return `<div class="col-${f.col || 12}"><div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="${id}" name="${f.name}" value="1" ${+val ? 'checked' : ''}>
      <label class="form-check-label small" for="${id}">${UI.esc(f.label)}</label>${f.help ? `<div class="form-help">${UI.esc(f.help)}</div>` : ''}</div></div>`;
  } else {
    const type = { money: 'number', datetime: 'datetime-local' }[f.type] || f.type || 'text';
    const step = f.type === 'money' ? 'step="0.01" min="0"' : (f.type === 'number' ? `step="${f.step || 1}" min="${f.min ?? 0}"` : '');
    input = `<input class="form-control form-control-sm" type="${type}" id="${id}" name="${f.name}" value="${UI.esc(val)}" ${step} ${req} placeholder="${UI.esc(f.placeholder || '')}" ${f.type === 'file' && f.multiple ? 'multiple' : ''} ${f.attrs || ''}>`;
  }
  return `<div class="col-md-${f.col || 6}"><label class="form-label ${f.required ? 'req' : ''}" for="${id}">${UI.esc(f.label)}</label>${input}${f.help ? `<div class="form-help">${UI.esc(f.help)}</div>` : ''}</div>`;
};
/** Reads a form into an object (checkboxes -> 1/0). */
UI.formData = (form) => {
  const d = {};
  new FormData(form).forEach((v, k) => { if (!(v instanceof File)) d[k] = v; });
  form.querySelectorAll('input[type=checkbox][name]').forEach(c => { d[c.name] = c.checked ? 1 : 0; });
  return d;
};

/**
 * Application modal with a form. onSubmit(data, form, wrap) may throw an Error; the message
 * shows inside the modal. Returns the modal element.
 */
UI.modal = (title, bodyHtml, onSubmit, opts = {}) => {
  const wrap = document.createElement('div');
  wrap.className = 'modal fade'; wrap.tabIndex = -1; wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('role', 'dialog');
  wrap.innerHTML = `<div class="modal-dialog ${opts.size ?? 'modal-lg'} modal-dialog-scrollable modal-dialog-centered"><form class="modal-content" novalidate>
    <div class="modal-header"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${bodyHtml}<div class="alert alert-danger mt-3 mb-0 form-error" role="alert"></div></div>
    <div class="modal-footer">${opts.extraFooter || ''}<button type="button" class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${onSubmit ? 'Cancel' : 'Close'}</button>
    ${onSubmit ? `<button type="submit" class="btn btn-${opts.danger ? 'danger' : 'primary'} btn-sm">${UI.esc(opts.submit || 'Save')}</button>` : ''}</div></form></div>`;
  document.body.append(wrap);
  const m = new bootstrap.Modal(wrap);
  const form = wrap.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = wrap.querySelector('.form-error'); err.style.display = 'none';
    form.querySelectorAll('.is-invalid').forEach(x => x.classList.remove('is-invalid'));
    const missing = [...form.querySelectorAll('[required]')].filter(x => x.offsetParent !== null || x.type === 'hidden').find(x => x.type === 'file' ? !x.files.length : !String(x.value).trim());
    if (missing) {
      missing.classList.add('is-invalid');
      err.textContent = 'Please fill in: ' + (form.querySelector(`label[for="${missing.id}"]`)?.textContent || missing.name).replace(/\s*\*$/, '');
      err.style.display = 'block'; missing.focus(); return;
    }
    const btn = form.querySelector('button[type=submit]'); const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
    try { await onSubmit(UI.formData(form), form, wrap); m.hide(); }
    catch (x) { err.textContent = x.message; err.style.display = 'block'; }
    finally { btn.disabled = false; btn.innerHTML = label; }
  };
  wrap.addEventListener('hidden.bs.modal', () => wrap.remove());
  m.show();
  if (opts.onShow) opts.onShow(wrap, form);
  return wrap;
};
/** Standard "form -> action -> reload page" modal. */
UI.formModal = (title, fields, action, opts = {}) => UI.modal(title, (opts.intro ? `<p class="modal-intro">${opts.intro}</p>` : '') + UI.fields(fields), async (d, form, wrap) => {
  const payload = opts.transform ? opts.transform(d, form, wrap) : d;
  const r = await App.api(action, { ...(opts.extra || {}), ...payload });
  UI.result(r);
  if (opts.after) opts.after(r); else App.route();
}, opts);
UI.confirmAction = (title, text, action, payload, opts = {}) => UI.modal(title, `<p class="mb-${opts.fields ? 3 : 0}">${text}</p>${opts.fields ? UI.fields(opts.fields) : ''}`, async (d) => {
  const r = await App.api(action, { ...payload, ...d }); UI.result(r);
  if (opts.after) opts.after(r); else { UI.closeDrawer(); App.route(); }
}, { size: '', submit: opts.submit || 'Confirm', danger: opts.danger });
/** Simple in-app confirmation (replaces the browser's confirm()). */
UI.confirm = (title, text, onYes, opts = {}) => UI.modal(UI.esc(title), `<p class="mb-0">${UI.esc(text)}</p>`, async () => { await onYes(); }, { size: '', submit: opts.submit || 'Confirm', danger: opts.danger });

/**
 * Tabs: tabs = [[key, label(html), htmlFn]]. Remembers the last tab of each page.
 * opts.key = separate memory when a page has more than one tab group; opts.pills = small pills.
 */
UI.tabs = (root, tabs, active, opts = {}) => {
  if (!tabs.length) return;
  const id = 'tabs' + Math.random().toString(36).slice(2, 6);
  const mem = 'tab:' + App.current.page + (opts.key ? ':' + opts.key : '');
  active = active || tabs[0][0];
  root.insertAdjacentHTML('beforeend', `<div class="${opts.pills ? 'pill-tabs' : 'line-tabs'} no-print" id="${id}" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="tab ${k === active ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="${id}body" class="tab-body"></div>`);
  const body = document.getElementById(id + 'body');
  const show = (k) => {
    document.querySelectorAll(`#${id} > [data-tab]`).forEach(b => { const on = b.dataset.tab === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    const t = tabs.find(x => x[0] === k);
    try { body.innerHTML = ''; const out = t[2](body); if (typeof out === 'string') body.innerHTML = out; UI.activate(body); }
    catch (e) { console.error(e); body.innerHTML = `<div class="module-down"><i class="bi bi-exclamation-triangle"></i><div>${UI.esc(e.message)}</div></div>`; }
    sessionStorage.setItem(mem, k);
  };
  document.querySelectorAll(`#${id} > [data-tab]`).forEach(b => b.onclick = () => show(b.dataset.tab));
  const remembered = sessionStorage.getItem(mem);
  show(tabs.some(t => t[0] === remembered) ? remembered : active);
};

// ------------------------------------------------------------------ charts (Chart.js, repo colors)
UI.palette = ['#1f2328', '#d99a1e', '#0b5cad', '#1a7f37', '#b5121b', '#6e7781', '#8250df', '#0891b2', '#9a6700', '#57606a'];
/** One color per meaning in every chart (status, money, aging, truck type). */
UI.meaningColors = {
  'Available': '#1a7f37', 'On Trip': '#0b5cad', 'Under Maintenance': '#b5121b', 'Unavailable': '#8c959f',
  'Billed': '#2563eb', 'Collected': '#15803d', 'Expenses': '#c62828',
  'Cash in (collections)': '#15803d', 'Cash out (disbursements)': '#c62828',
  'All trips': '#1f2328', 'Trips': '#1f2328', 'Completed': '#1a7f37', 'Completed trips': '#1a7f37',
  'Parts': '#0b5cad', 'Labor': '#d99a1e', 'Other': '#6e7781',
  'Not yet due': '#15803d', '1-30 days': '#f59e0b', '31-60 days': '#ea580c', '61-90 days': '#c62828', 'Over 90 days': '#7f1d1d',
  'Assigned': '#0b5cad',
  'Car Carrier': '#1f2328', 'Container': '#d99a1e', 'Wing Van': '#0b5cad',
  'Client': '#d99a1e',
};
UI.colorOf = (label, i) => UI.meaningColors[label] || UI.palette[i % UI.palette.length];
UI._charts = [];
UI.chartEmpty = (c) => !c.labels || !c.labels.length || c.datasets.every(d => !d.data.some(x => +x));
UI.chartHtml = (c) => {
  const id = 'ch' + Math.random().toString(36).slice(2, 8);
  UI._charts[id] = c;
  // Horizontal bars: height follows the number of names so the bars are not crowded.
  const h = c.horizontal ? Math.max(220, Math.min(640, 70 + c.labels.length * 30)) : 0;
  return `<section class="panel chart-panel"><div class="panel-head"><h2 class="panel-title">${UI.esc(c.title)}</h2></div><div class="panel-body">
    ${UI.chartEmpty(c) ? '<div class="table-empty"><i class="bi bi-bar-chart"></i><span>No data for this period.</span></div>' : `<div class="chart-box${c.horizontal ? ' chart-box-h' : ''}" ${h ? `style="height:${h}px"` : ''}><canvas data-chart="${id}"></canvas></div>`}
    ${c.how ? `<div class="chart-how"><i class="bi bi-info-circle"></i> ${UI.esc(c.how)}</div>` : ''}</div></section>`;
};
/** Chart.js settings from a chart spec: peso format, %, colors by meaning, horizontal, stacked. */
UI.chartConfig = (c, forPrint = false) => {
  const round = c.type === 'doughnut' || c.type === 'pie';
  const money = c.format === 'money';
  const fmt = (v) => money ? UI.money(v) : UI.num(v, 2);
  const axisFmt = (v) => money ? '₱' + Number(v).toLocaleString('en-PH', { maximumFractionDigits: 0 }) : UI.num(v, 2);
  const valueAxis = c.horizontal ? 'x' : 'y', nameAxis = c.horizontal ? 'y' : 'x';
  // Counts (trips, units): whole numbers only on the axis.
  const whole = !money && c.datasets.every(d => d.data.every(x => Number.isInteger(+x)));
  return {
    type: c.type,
    data: { labels: c.labels, datasets: c.datasets.map((d, i) => ({ ...d,
      backgroundColor: round ? c.labels.map((l, j) => UI.colorOf(l, j)) : UI.colorOf(d.label, i),
      borderColor: round ? '#fff' : UI.colorOf(d.label, i), tension: .3, fill: false, maxBarThickness: 48 })) },
    options: {
      responsive: !forPrint, maintainAspectRatio: false, animation: forPrint ? false : undefined,
      indexAxis: c.horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: round || c.datasets.length > 1, position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => {
          const v = ctx.raw;
          if (round) { const total = ctx.dataset.data.reduce((a, b) => a + (+b || 0), 0); return `${ctx.label}: ${fmt(v)} (${total ? (v / total * 100).toFixed(1) : 0}%)`; }
          return `${ctx.dataset.label}: ${fmt(v)}`;
        } } },
      },
      scales: round ? {} : {
        [valueAxis]: { beginAtZero: true, stacked: !!c.stacked, ticks: { callback: axisFmt, ...(whole ? { precision: 0 } : {}) } },
        [nameAxis]: { stacked: !!c.stacked, ticks: { autoSkip: !c.horizontal } },
      },
    },
  };
};
UI.drawChart = (canvas) => {
  const c = UI._charts[canvas.dataset.chart]; if (!c || typeof Chart === 'undefined') return;
  new Chart(canvas, UI.chartConfig(c));
};

/** PNG image of a chart, for printing. */
UI.chartImage = (c, w = 900, h = 340) => {
  if (typeof Chart === 'undefined' || UI.chartEmpty(c)) return '';
  const cv = document.createElement('canvas'); cv.width = w; cv.height = c.horizontal ? Math.max(h, 70 + c.labels.length * 26) : h;
  cv.style.position = 'fixed'; cv.style.left = '-10000px'; document.body.append(cv);
  const ch = new Chart(cv, UI.chartConfig(c, true));
  const url = cv.toDataURL('image/png'); ch.destroy(); cv.remove();
  return url;
};

/**
 * Renders the common {alerts, cards, charts, tables} block used by dashboards and reports.
 * Order: alerts (to do) -> cards -> charts -> tables.
 * opts.maxCharts = charts visible at once; opts.stack = show every table (dashboard) instead of a picker.
 */
UI.blocks = (spec, opts = {}) => {
  let h = '';
  if (spec.alerts && spec.alerts.length) h += `<section class="panel attention"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-flag"></i> Needs attention</h2></div>
    <ul class="attention-list">${spec.alerts.map(a => `<li class="lvl-${a.level || 'info'}"><span class="dot"></span><span class="txt">${UI.esc(a.text)}</span>${a.page && UI.canGo(a.page) ? `<button type="button" class="btn btn-sm btn-link" data-go="${UI.esc(a.page)}">Open <i class="bi bi-arrow-right"></i></button>` : ''}</li>`).join('')}</ul></section>`;
  if (spec.cards && spec.cards.length) h += UI.cardGroups(spec.cards);
  const charts = spec.charts || [], max = opts.maxCharts || charts.length;
  if (charts.length) {
    h += `<div class="chart-grid">${charts.slice(0, max).map(UI.chartHtml).join('')}</div>`;
    if (charts.length > max) {
      const id = 'cm' + Math.random().toString(36).slice(2, 8);
      UI._more[id] = charts.slice(max);
      h += `<div class="chart-more no-print" data-chartmore="${id}"><button type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-bar-chart"></i> Show ${charts.length - max} more chart(s)</button></div>`;
    }
  }
  const tables = spec.tables || [];
  if (opts.stack || tables.length === 1) h += tables.map(t => UI.blockTable(t)).join('');
  else if (tables.length > 1) {
    const id = 'tp' + Math.random().toString(36).slice(2, 8);
    UI._pickers[id] = { tables, key: opts.key || '' };
    h += `<section class="panel" data-tpicker="${id}"></section>`;
  }
  return h;
};
UI._more = {}; UI._pickers = {};
UI.blockTable = (t, title = true) => UI.table(t.columns.map(([l, k, f]) => [l, k, f]), t.rows, { title: title ? UI.esc(t.title) + (t.page && UI.canGo(t.page) ? ` <a href="#${t.page}" class="panel-link">Open page <i class="bi bi-arrow-right"></i></a>` : '') : '', limit: t.limit || 10, empty: t.empty });
/** Metric strips; cards with a "group" get a small heading per group. */
UI.cardGroups = (cards) => {
  if (!cards.some(c => c.group)) return UI.cards(cards);
  const groups = [];
  cards.forEach(c => { const g = groups.find(x => x[0] === (c.group || '')); g ? g[1].push(c) : groups.push([c.group || '', [c]]); });
  return groups.map(([g, list]) => `<div class="metric-group">${g ? `<div class="metric-group-title">${UI.esc(g)}</div>` : ''}${UI.cards(list)}</div>`).join('');
};
/** Table picker (reports): pills of the tables that have rows, one line for the empty ones. */
UI.drawPicker = (box) => {
  const p = UI._pickers[box.dataset.tpicker]; if (!p) return;
  const full = p.tables.filter(t => (t.rows || []).length), empty = p.tables.filter(t => !(t.rows || []).length);
  const mem = 'tpick:' + App.current.page + ':' + p.key;
  let cur = sessionStorage.getItem(mem);
  if (!full.some(t => t.title === cur)) cur = full.length ? full[0].title : null;
  const t = full.find(x => x.title === cur);
  box.innerHTML = `${full.length ? `<div class="panel-head"><div class="pill-tabs mb-0">${full.map(x => `<button type="button" class="tab ${x === t ? 'active' : ''}" data-pick="${UI.esc(x.title)}">${UI.esc(x.title)} <span class="tab-count">${x.rows.length}</span></button>`).join('')}</div>
      ${t && t.page && UI.canGo(t.page) ? `<a href="#${t.page}" class="panel-link">Open page <i class="bi bi-arrow-right"></i></a>` : ''}</div>` : ''}
    <div class="panel-body flush">${t ? UI.blockTable(t, false).replace(/^<section class="panel"><div class="panel-body flush">/, '').replace(/<\/div><\/section>$/, '') : ''}</div>
    ${empty.length ? `<div class="picker-empty"><i class="bi bi-info-circle"></i> No records: ${empty.map(x => UI.esc(x.title)).join(', ')}.</div>` : ''}`;
  box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { sessionStorage.setItem(mem, b.dataset.pick); box.dataset.drawn = ''; UI.drawPicker(box); UI.activate(box); });
  UI.activate(box);
};

/** Small list showing a computation (name, how, amount). */
UI.breakdown = (lines, total, totalLabel = 'Total') => `<table class="breakdown w-100">${(lines || []).map(l => `<tr><td>${UI.esc(l.name)}</td><td class="text-muted">${UI.esc(l.explain || '')}</td><td class="num">${UI.money(l.amount)}</td></tr>`).join('')}
  <tr class="total"><td colspan="2">${UI.esc(totalLabel)}</td><td class="num">${UI.money(total)}</td></tr></table>`;

/**
 * Fund Request form (PDF #12 Scenario A step 4 / B step 4).
 * The dispatcher picks the preset categories and may add other categories.
 * The total is shown while choosing; the server still takes the real preset amounts.
 * opts: { title, categories:[{name, amount}], selected:[names], extra:[{name, amount}], notes, action, payload, intro }
 */
UI.fundForm = (opts) => {
  const sel = new Set(opts.selected || []);
  const extra = (opts.extra || []).concat(Array(Math.max(0, 3 - (opts.extra || []).length)).fill({ name: '', amount: '' }));
  const cats = (opts.categories || []).map((c, i) => `<label class="d-flex justify-content-between border rounded px-2 py-1 mb-1">
      <span><input type="checkbox" class="form-check-input me-2 fund-cat" data-name="${UI.esc(c.name)}" data-amount="${+c.amount}" ${sel.has(c.name) ? 'checked' : ''}>${UI.esc(c.name)}</span>
      <span class="num">${UI.money(c.amount)}</span></label>`).join('') || '<div class="text-muted small">No preset categories yet. Ask the Admin to add them in Administration > Settings.</div>';
  const rows = extra.map((l, i) => `<div class="row g-2 mb-1 fund-extra">
      <div class="col-8"><input class="form-control form-control-sm" maxlength="80" placeholder="Other expense category" value="${UI.esc(l.name || '')}"></div>
      <div class="col-4"><input class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="Amount" value="${l.amount === '' ? '' : +l.amount}"></div></div>`).join('');
  const body = `${opts.intro ? `<p class="small text-muted">${opts.intro}</p>` : ''}
    <h6>Fund categories (preset amounts)</h6>${cats}
    <h6 class="mt-3">Other expense categories (optional)</h6>${rows}
    <div class="mt-2"><label class="form-label small">Notes</label><input class="form-control form-control-sm" name="notes" maxlength="255" value="${UI.esc(opts.notes || '')}"></div>
    <div class="fs-6 mt-3 text-end">Total requested fund: <b id="fundTotal">₱0.00</b></div>`;
  UI.modal(opts.title, body, async (d, form) => {
    const categories = [...form.querySelectorAll('.fund-cat:checked')].map(c => c.dataset.name);
    const extraLines = [...form.querySelectorAll('.fund-extra')].map(r => { const [n, a] = r.querySelectorAll('input'); return { name: n.value.trim(), amount: a.value }; }).filter(x => x.name || x.amount);
    if (!categories.length && !extraLines.length) throw new Error('Choose at least one fund category.');
    const r = await App.api(opts.action, { ...opts.payload, categories, extra: extraLines, notes: d.notes || '' });
    UI.result(r); if (opts.after) opts.after(r); else App.route();
  }, { submit: 'Submit Fund Request', onShow(w) {
    const total = () => {
      let t = 0;
      w.querySelectorAll('.fund-cat:checked').forEach(c => t += +c.dataset.amount);
      w.querySelectorAll('.fund-extra').forEach(r => { const a = +r.querySelectorAll('input')[1].value; if (a > 0) t += a; });
      w.querySelector('#fundTotal').textContent = UI.money(t);
    };
    w.addEventListener('input', total); w.addEventListener('change', total); total();
  } });
};

/** Print only the given HTML (forms, invoices). */
/** Puts the form in the print area and opens the print dialog once its images (logo, e-signatures) have loaded (max 3 s). */
UI.print = (html) => {
  const a = document.getElementById('printArea'); a.innerHTML = html;
  const imgs = [...a.querySelectorAll('img')].filter(i => !i.complete);
  const wait = imgs.map(i => new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
  Promise.race([Promise.all(wait), new Promise(r => setTimeout(r, 3000))]).then(() => setTimeout(() => window.print(), 60));
};
/**
 * Prints report sections (Reports page). meta = {title, period, filters}.
 * Includes the header (company, report, period, filters, who printed and when), cards, charts (as images) and full tables.
 */
UI.printReport = (sections, meta = {}) => {
  const e = UI.esc, u = App.me.user, co = (App.me.company || {}).name || '';
  const cards = (list) => (list || []).length ? `<div class="pr-cards">${list.map(c => `<div class="pr-card"><div class="pr-val">${c.format === 'money' ? UI.money(c.value) : e(typeof c.value === 'number' ? UI.num(c.value, 2) : c.value)}</div><div class="pr-lbl">${e(c.label)}</div>${c.hint ? `<div class="pr-hint">${e(c.hint)}</div>` : ''}</div>`).join('')}</div>` : '';
  const charts = (list) => (list || []).map(c => { const round = c.type === 'doughnut' || c.type === 'pie';
    const img = round ? UI.chartImage(c, 520, 300) : UI.chartImage(c); return img ? `<div class="pr-chart${round ? ' pr-half' : ''}"><div class="pr-h3">${e(c.title)}</div><img src="${img}" alt="${e(c.title)}">${c.how ? `<div class="pr-note">${e(c.how)}</div>` : ''}</div>` : ''; }).join('');
  const tables = (list) => {
    const full = (list || []).filter(t => (t.rows || []).length), empty = (list || []).filter(t => !(t.rows || []).length);
    return full.map(t => `<div class="pr-table"><div class="pr-h3">${e(t.title)} <span class="pr-count">(${t.rows.length})</span></div><table><thead><tr>${t.columns.map(([l, , f]) => `<th class="${f === 'money' ? 'num' : ''}">${e(l)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr>${t.columns.map(([, k, f]) => `<td class="${f === 'money' ? 'num' : ''}">${String(UI.fmt(f, r[k], r)).replace(/<(?!\/?(b|i|span)\b)[^>]+>/g, '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')
      + (empty.length ? `<div class="pr-note">No data: ${empty.map(t => e(t.title)).join(', ')}.</div>` : '');
  };
  const html = `<div class="print-report"><div class="pr-head"><div><div class="pr-co">${e(co)}</div><div class="pr-title">${e(meta.title || 'Report')}</div>
      <div class="pr-meta">Period: <b>${e(meta.period || '')}</b>${meta.filters ? ` · ${e(meta.filters)}` : ''}</div></div>
      <div class="pr-by">Printed by ${e(u.full_name)} (${e(u.role_label || u.role)})<br>${e(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
    ${sections.map((s, i) => `<section class="pr-section${i ? ' pr-break' : ''}"><h2>${e(s.title)}</h2>${s.note ? `<div class="pr-note">${e(s.note)}</div>` : ''}${cards(s.cards)}${charts(s.charts)}${tables(s.tables)}</section>`).join('')}</div>`;
  document.getElementById('printArea').innerHTML = html;
  setTimeout(() => window.print(), 50);
};

/** Options helpers for selects. */
UI.opts = (rows, labelFn, valueKey = 'id') => (rows || []).map(r => [r[valueKey], labelFn(r)]);
UI.list = (arr) => (arr || []).map(x => [x, x]);

/**
 * One-shot deep links (?open=, ?report=, ?request_for=): returns the values and removes them from the
 * address without reloading, so a later page refresh after saving does not open the same form again.
 */
UI.takeQuery = (ctx, ...keys) => {
  const out = {}; let changed = false;
  keys.forEach(k => { if (ctx.query[k] !== undefined) { out[k] = ctx.query[k]; delete ctx.query[k]; changed = true; } });
  if (changed) {
    const qs = new URLSearchParams(ctx.query).toString();
    history.replaceState(null, '', '#' + ctx.page + (qs ? '?' + qs : ''));
    if (App.current) App.current.query = { ...ctx.query };
  }
  return out;
};
// ------------------------------------------------------------------ helpers added in the revision
/** Form modal that also sends the files of the form (uses App.apiForm). */
UI.formModalFiles = (title, fields, action, opts = {}) => UI.modal(title, (opts.intro ? `<div class="small text-muted mb-2">${opts.intro}</div>` : '') + UI.fields(fields), async (d, form, wrap) => {
  const payload = opts.transform ? opts.transform(d, form, wrap) : d;
  const r = await App.apiForm(action, { ...(opts.extra || {}), ...payload }, form);
  UI.result(r);
  if (opts.after) opts.after(r); else App.route();
}, opts);

/**
 * ONE simple filter modal per list (no permanent filter bar).
 * fields: same format as UI.fields; values come from the page query.
 * Returns a small bar: [Filter] button, the active filters as chips, and Reset.
 */
UI.filterModal = (ctx, fields, opts = {}) => {
  const id = 'flt' + Math.random().toString(36).slice(2, 8);
  const keys = fields.map(f => f.name);
  const active = keys.filter(k => ctx.query[k]);
  const reset = () => { const q = { ...ctx.query }; keys.forEach(k => delete q[k]); App.go(ctx.page, q); };
  const open = () => {
    const wrap = UI.modal('Filter', UI.fields(fields.map(f => ({ ...f, value: ctx.query[f.name] ?? '' }))) + (opts.note ? `<div class="form-help mt-2">${UI.esc(opts.note)}</div>` : ''), async (d) => {
      const q = { ...ctx.query }; keys.forEach(k => { if (d[k]) q[k] = d[k]; else delete q[k]; });
      App.go(ctx.page, q);
    }, { size: '', submit: 'Apply', extraFooter: '<button type="button" class="btn btn-outline-danger btn-sm me-auto" data-freset>Reset</button>' });
    wrap.querySelector('[data-freset]').onclick = () => { bootstrap.Modal.getInstance(wrap).hide(); reset(); };
  };
  const label = (k) => { const f = fields.find(x => x.name === k); const o = (f.options || []).find(o => String(Array.isArray(o) ? o[0] : o) === String(ctx.query[k])); return `${f.label}: ${o ? (Array.isArray(o) ? o[1] : o) : ctx.query[k]}`; };
  UI._filters[id] = { open, reset };
  return `<div class="filter-summary" data-fid="${id}"><button type="button" class="btn btn-sm btn-outline-secondary" data-fopen><i class="bi bi-funnel"></i> Filter${active.length ? ` <span class="badge bg-warning text-dark">${active.length}</span>` : ''}</button>
    ${active.length ? active.map(k => `<span class="filter-chip">${UI.esc(label(k))}</span>`).join('') + '<button type="button" class="btn btn-link btn-sm p-0 ms-1" data-fclear>Reset</button>' : `<span>${UI.esc(opts.hint || 'Showing all records.')}</span>`}</div>`;
};

UI._filters = {};
// One listener for every filter bar (works even when the bar is drawn later inside a tab).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fopen],[data-fclear]'); if (!b) return;
  const f = UI._filters[b.closest('[data-fid]')?.dataset.fid]; if (!f) return;
  if (b.hasAttribute('data-fopen')) f.open(); else f.reset();
});

/** Side drawer for record details (Bootstrap offcanvas). */
UI.drawer = (title, html, opts = {}) => {
  // Re-use the open drawer (refresh its content) so backdrops never stack up.
  let el = document.querySelector('.offcanvas.app-drawer');
  const head = `<div><h5 class="offcanvas-title mb-0">${title}</h5>${opts.subtitle ? `<div class="small text-muted">${opts.subtitle}</div>` : ''}</div>
    <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>`;
  if (el) {
    el.querySelector('.offcanvas-header').innerHTML = head;
    el.querySelector('.offcanvas-body').innerHTML = html;
    el.querySelector('.offcanvas-body').scrollTop = 0;
    if (!el.classList.contains('show')) bootstrap.Offcanvas.getOrCreateInstance(el).show();
  } else {
    el = document.createElement('div');
    el.className = 'offcanvas offcanvas-end app-drawer'; el.tabIndex = -1;
    el.innerHTML = `<div class="offcanvas-header">${head}</div><div class="offcanvas-body">${html}</div>`;
    document.body.append(el);
    bootstrap.Offcanvas.getOrCreateInstance(el).show();
    el.addEventListener('hidden.bs.offcanvas', () => el.remove());
  }
  UI.activate(el);
  if (opts.onShow) opts.onShow(el);
  return el;
};
UI.closeDrawer = () => document.querySelectorAll('.offcanvas.app-drawer').forEach(o => bootstrap.Offcanvas.getInstance(o)?.hide());

/** Progress stepper: stages = [labels], current = index, opts.warn = text shown in red. */
UI.steps = (stages, current, opts = {}) => `<div class="wf-steps ${opts.compact ? 'wf-steps-compact' : ''}">${stages.map((s, i) => `<div class="wf-step ${i < current ? 'done' : ''} ${i === current ? 'now' : ''} ${i === current && opts.warn ? 'warn' : ''}">
    <span class="dot">${i < current ? '<i class="bi bi-check"></i>' : i + 1}</span><span class="lbl">${UI.esc(s)}</span></div>`).join('')}</div>`;

/** Label / value grid. pairs = [[label, html], ...] (values are already escaped / formatted). */
UI.kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
UI.e = (v) => (v === null || v === undefined || v === '') ? '—' : UI.esc(v);

/** List of documents with view / download links. */
UI.docUrl = (id, inline = true) => 'index.php?api=document_download&id=' + encodeURIComponent(id) + (inline ? '&inline=1' : '');
UI.docs = (list, empty = 'No documents attached.') => (list || []).length ? `<ul class="doc-list">${list.map(d => `<li><i class="bi ${String(d.mime_type || '').startsWith('image') ? 'bi-file-image' : 'bi-file-pdf'}"></i>
    <div><a href="${UI.docUrl(d.id)}" target="_blank" rel="noopener">${UI.esc(d.original_filename)}</a><div class="small text-muted">${UI.esc(d.category)}${d.for ? ' · ' + UI.esc(d.for) : ''} · ${UI.datetime(d.created_at)}${d.uploader ? ' · ' + UI.esc(d.uploader) : ''}</div></div></li>`).join('')}</ul>`
  : `<div class="text-muted small">${UI.esc(empty)}</div>`;

/** Section heading inside drawers. */
UI.h = (text, extra = '') => `<div class="drawer-h"><span>${UI.esc(text)}</span>${extra}</div>`;

/**
 * Printable form with the company header used on every printout (PDF #13 formats).
 * opts.number = form number shown at the top right.
 */
UI.printForm = (title, body, opts = {}) => {
  const co = App.me.company || {};
  UI.print(`<div class="pf"><div class="pf-head">${UI.logoTag('pf-logo-img')}<div class="pf-head-text"><div class="pf-co">${UI.esc(co.name || 'R P MULAWIN TRUCKING SERVICE')}</div>
    <div class="pf-addr">${UI.esc(co.address || '')}</div></div>${opts.number ? `<div class="pf-no">No. <b>${UI.esc(opts.number)}</b></div>` : ''}</div>
    <div class="pf-title">${UI.esc(title)}</div>${body}
    <div class="pf-foot">Printed from Mulawin FleetOps by ${UI.esc(App.me.user.full_name)} on ${UI.esc(new Date().toLocaleString('en-PH'))}</div></div>`);
};
/**
 * Signature line. name = printed name; sig = user id whose saved e-signature should appear
 * above the line (the image loads only for users allowed to see it).
 */
/** Empty table rows so a printed list looks like the paper form (rows = columns count, upTo = total rows wanted). */
UI.pfBlank = (cols, have, upTo = 8) => Array.from({ length: Math.max(0, upTo - have) }, () => `<tr>${'<td>&nbsp;</td>'.repeat(cols)}</tr>`).join('');
UI.sign = (label, name = '', sig = null) => `<div class="pf-sign">${sig ? `<img class="pf-sig-img" src="index.php?api=signature&user=${encodeURIComponent(sig)}" alt="" onerror="this.remove()">` : ''}<div class="pf-line">${UI.esc(name)}</div><div class="pf-sl">${UI.esc(label)}</div></div>`;

// ------------------------------------------------------------------ e-signature (upload or draw)
/**
 * "My e-signature": upload a PNG/JPG image, or draw with mouse / finger / stylus.
 * Both save a real image for the signed-in user; empty drawings are refused.
 */
UI.signatureModal = () => {
  const u = App.me.user;
  const body = `<p class="modal-intro">Your signature is printed on the forms you prepare or approve (purchase orders, cash fund requests, incident reports, invoices).</p>
    ${u.has_signature ? `<div class="sig-current"><span class="small text-muted">Current signature</span><img src="index.php?api=signature&user=${u.id}&t=${Date.now()}" alt="Current signature"></div>` : ''}
    <div class="pill-tabs" role="tablist"><button type="button" class="tab active" data-sigtab="draw"><i class="bi bi-pencil"></i> Draw</button><button type="button" class="tab" data-sigtab="upload"><i class="bi bi-upload"></i> Upload image</button></div>
    <div data-sigpane="draw">
      <div class="sig-pad-wrap"><canvas class="sig-pad" width="560" height="180" aria-label="Signature drawing area"></canvas><span class="sig-hint">Sign here with your mouse, finger or stylus</span></div>
      <div class="d-flex justify-content-between align-items-center mt-2"><span class="small text-muted" data-sigstatus>Empty</span><button type="button" class="btn btn-sm btn-outline-secondary" data-sigclear><i class="bi bi-eraser"></i> Clear</button></div>
    </div>
    <div data-sigpane="upload" class="d-none">
      <label class="form-label" for="sigFile">Signature image (PNG or JPG, up to 2 MB)</label>
      <input class="form-control" type="file" id="sigFile" accept="image/png,image/jpeg">
      <div class="form-help">Use a clear photo or scan of your signature on white paper.</div>
    </div>
    <div class="sig-preview d-none"><span class="small text-muted">Preview</span><img alt="Signature preview"></div>`;
  UI.modal('My e-signature', body, async (d, form, wrap) => {
    const mode = wrap.querySelector('[data-sigtab].active').dataset.sigtab;
    let file = null;
    if (mode === 'draw') {
      if (!wrap._sig.inked()) throw new Error('Draw your signature first (the box is empty).');
      file = await wrap._sig.blob();
    } else {
      file = wrap.querySelector('#sigFile').files[0];
      if (!file) throw new Error('Choose an image file.');
      if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Only PNG or JPG images are accepted.');
      if (file.size > 2 * 1024 * 1024) throw new Error('The image is larger than 2 MB.');
    }
    const r = await App.apiForm('Admin.signature_upload', { method: mode }, null, { signature: file });
    UI.result(r); App.me.user.has_signature = true; App.shell(); App.route();
  }, { size: '', submit: 'Save signature', onShow: (wrap) => {
    const cv = wrap.querySelector('.sig-pad'), ctx2 = cv.getContext('2d');
    const status = wrap.querySelector('[data-sigstatus]'), hint = wrap.querySelector('.sig-hint');
    const prev = wrap.querySelector('.sig-preview'), prevImg = prev.querySelector('img');
    let drawing = false, strokes = 0, last = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    const showPreview = (src) => { prevImg.src = src; prev.classList.toggle('d-none', !src); };
    ctx2.lineWidth = 2.4; ctx2.lineCap = 'round'; ctx2.lineJoin = 'round'; ctx2.strokeStyle = '#111';
    cv.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); hint.style.display = 'none'; const er = wrap.querySelector('.form-error'); if (er) er.style.display = 'none'; e.preventDefault(); });
    wrap.querySelector('#sigFile').addEventListener('change', () => { const er = wrap.querySelector('.form-error'); if (er) er.style.display = 'none'; });
    cv.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx2.beginPath(); ctx2.moveTo(...last); ctx2.lineTo(...p); ctx2.stroke(); last = p; strokes++; });
    const end = () => { if (!drawing) return; drawing = false; status.textContent = strokes > 8 ? 'Signature drawn' : 'Keep drawing'; if (strokes > 8) showPreview(cv.toDataURL('image/png')); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointerleave', end);
    wrap.querySelector('[data-sigclear]').onclick = () => { ctx2.clearRect(0, 0, cv.width, cv.height); strokes = 0; status.textContent = 'Empty'; hint.style.display = ''; showPreview(''); };
    wrap._sig = {
      inked: () => { if (strokes <= 8) return false; const px = ctx2.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n > 150; },
      blob: () => new Promise(res => cv.toBlob(b => res(new File([b], 'signature.png', { type: 'image/png' })), 'image/png')),
    };
    wrap.querySelectorAll('[data-sigtab]').forEach(b => b.onclick = () => {
      wrap.querySelectorAll('[data-sigtab]').forEach(x => x.classList.toggle('active', x === b));
      wrap.querySelectorAll('[data-sigpane]').forEach(p => p.classList.toggle('d-none', p.dataset.sigpane !== b.dataset.sigtab));
      showPreview(b.dataset.sigtab === 'draw' && strokes > 8 ? cv.toDataURL('image/png') : '');
    });
    wrap.querySelector('#sigFile').onchange = (e) => { const f = e.target.files[0]; if (f && /^image\//.test(f.type)) { const rd = new FileReader(); rd.onload = () => showPreview(rd.result); rd.readAsDataURL(f); } else showPreview(''); };
  } });
};

// ------------------------------------------------------------------ map (Leaflet + MapTiler tiles and search)
/**
 * Map tiles come from MapTiler (free plan, API key in .env MAPTILER_API_KEY), not from the
 * OpenStreetMap volunteer tile servers. Attribution "© MapTiler © OpenStreetMap contributors"
 * and the MapTiler logo stay visible, as the provider requires.
 * If the key is missing or the tiles fail, the form still works: addresses and km are typed.
 */
UI.Map = {
  key() { return (App.me && App.me.mapKey) || ''; },
  style() { return (App.me && App.me.mapStyle) || 'streets-v4'; },
  attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>',
  /** Adds the tile layer; returns false (and shows a notice) when the map cannot be used. */
  tiles(map, notice) {
    const key = this.key();
    if (!key) { notice('The map is not set up yet (MAPTILER_API_KEY is empty in .env). Type the addresses and the km; everything else works.'); return false; }
    const layer = L.tileLayer(`https://api.maptiler.com/maps/${encodeURIComponent(this.style())}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      { tileSize: 256, maxZoom: 19, minZoom: 4, crossOrigin: true, attribution: this.attribution }).addTo(map);
    let errors = 0, loaded = 0;
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => { errors++; if (errors === 4 && loaded === 0) notice('Map tiles could not load (no internet, wrong API key, or the free quota is used up). You can still type the addresses and the km.'); });
    const logo = L.control({ position: 'bottomleft' });
    logo.onAdd = () => { const a = L.DomUtil.create('a', 'maptiler-logo'); a.href = 'https://www.maptiler.com'; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler logo" height="18">'; return a; };
    logo.addTo(map);
    return true;
  },
  cache(kind, q) { try { const v = sessionStorage.getItem('geo:' + kind + ':' + q); return v ? JSON.parse(v) : null; } catch { return null; } },
  save(kind, q, v) { try { sessionStorage.setItem('geo:' + kind + ':' + q, JSON.stringify(v)); } catch { } },
  /** Address search (forward geocoding), limited to the Philippines. Results are cached for the session. */
  async search(q) {
    q = q.trim(); if (q.length < 3) return [];
    const hit = this.cache('f', q.toLowerCase()); if (hit) return hit;
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(this.key())}&country=ph&limit=5&language=en`;
    const res = await fetch(url, { referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!res.ok) throw new Error(res.status === 403 ? 'Address search is not allowed for this API key.' : 'Address search failed (' + res.status + ').');
    const j = await res.json();
    const out = (j.features || []).map(f => ({ name: f.place_name || f.text, lat: f.center[1], lng: f.center[0] }));
    this.save('f', q.toLowerCase(), out); return out;
  },
  /** Address of a map point (reverse geocoding), rounded so nearby clicks reuse the cache. */
  async reverse(lat, lng) {
    const k = lat.toFixed(4) + ',' + lng.toFixed(4); const hit = this.cache('r', k); if (hit !== null) return hit;
    const res = await fetch(`https://api.maptiler.com/geocoding/${lng.toFixed(6)},${lat.toFixed(6)}.json?key=${encodeURIComponent(this.key())}&limit=1&language=en`, { referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!res.ok) return '';
    const j = await res.json(); const name = (j.features && j.features[0] && j.features[0].place_name) || '';
    this.save('r', k, name); return name;
  },
};

/**
 * Location picker for the New Trip Request: search an address or click the map to pin the
 * pickup point and the destination; pins can be dragged. The address fields stay editable
 * (manual entry always works). Saves pickup_lat/lng and delivery_lat/lng in the form.
 * The straight-line km is only a guide; the billable km is typed (PDF #12 Scenario A step 3).
 */
UI.mapPicker = (box, form, initial = {}) => {
  const field = (n) => form.querySelector(`[name="${n}"]`);
  box.innerHTML = `<div class="loc-picker">
      <div class="loc-toolbar">
        <div class="seg" role="group" aria-label="Which point to set">
          <button type="button" class="seg-btn active" data-pin="pickup"><span class="pin-dot pickup"></span> Pickup</button>
          <button type="button" class="seg-btn" data-pin="delivery"><span class="pin-dot delivery"></span> Destination</button>
        </div>
        <div class="loc-search"><i class="bi bi-search"></i><input type="search" class="form-control" placeholder="Search a place or address in the Philippines" aria-label="Search a place" data-locq>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-locgo>Search</button></div>
      </div>
      <div class="loc-results d-none" data-locres></div>
      <div class="loc-notice d-none" data-locnote></div>
      <div class="map-canvas" data-mapcanvas></div>
      <div class="loc-foot"><span data-mapinfo>Choose Pickup or Destination, then search or click the map.</span><span class="text-muted">Straight-line distance is a guide only. Type the billable km.</span></div>
    </div>`;
  const note = (msg) => { const n = box.querySelector('[data-locnote]'); n.textContent = msg; n.classList.toggle('d-none', !msg); };
  if (typeof L === 'undefined') { note('The map library did not load. Type the addresses and the km.'); box.querySelector('[data-mapcanvas]').remove(); return null; }
  const map = L.map(box.querySelector('[data-mapcanvas]'), { scrollWheelZoom: false }).setView([14.08, 121.15], 9);
  const usable = UI.Map.tiles(map, note);
  if (!usable) box.querySelectorAll('[data-locq],[data-locgo]').forEach(x => x.disabled = true);
  const icon = (k) => L.divIcon({ className: 'pin-icon ' + k, html: `<i class="bi bi-geo-alt-fill"></i>`, iconSize: [30, 30], iconAnchor: [15, 29] });
  const pins = {}; let active = 'pickup'; let line = null;
  const info = box.querySelector('[data-mapinfo]');
  const label = (k) => k === 'pickup' ? 'pickup point' : 'destination';
  const addrField = (k) => field(k === 'pickup' ? 'pickup_point' : 'delivery_point');
  const update = () => {
    ['pickup', 'delivery'].forEach(k => { const p = pins[k]?.getLatLng(); if (field(k + '_lat')) { field(k + '_lat').value = p ? p.lat.toFixed(7) : ''; field(k + '_lng').value = p ? p.lng.toFixed(7) : ''; } });
    if (line) { line.remove(); line = null; }
    if (pins.pickup && pins.delivery) {
      const a = pins.pickup.getLatLng(), b = pins.delivery.getLatLng();
      line = L.polyline([a, b], { color: '#1f2328', weight: 2, dashArray: '6 6' }).addTo(map);
      info.textContent = `Both points set · straight-line distance ${(a.distanceTo(b) / 1000).toFixed(1)} km`;
    }
  };
  /** Fills the address field from the map point; never overwrites what the user typed without asking. */
  const suggest = async (k, latlng, name) => {
    const f = addrField(k); if (!f) return;
    let addr = name;
    if (!addr && usable) { try { addr = await UI.Map.reverse(latlng.lat, latlng.lng); } catch { addr = ''; } }
    if (!addr) return;
    if (!f.value.trim()) { f.value = addr; f.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (f.value.trim() === addr) return;
    const tip = document.createElement('div'); tip.className = 'loc-suggest';
    tip.innerHTML = `<span>Map address for the ${label(k)}: <b></b></span><button type="button" class="btn btn-sm btn-link p-0">Use it</button>`;
    tip.querySelector('b').textContent = addr;
    tip.querySelector('button').onclick = () => { f.value = addr; f.dispatchEvent(new Event('input', { bubbles: true })); tip.remove(); };
    f.parentElement.querySelectorAll('.loc-suggest').forEach(x => x.remove()); f.parentElement.append(tip);
  };
  const place = (k, latlng, name = '', fly = false) => {
    if (pins[k]) pins[k].setLatLng(latlng);
    else {
      pins[k] = L.marker(latlng, { draggable: true, icon: icon(k), keyboard: true, title: k === 'pickup' ? 'Pickup' : 'Destination' }).addTo(map).bindTooltip(k === 'pickup' ? 'Pickup' : 'Destination');
      pins[k].on('dragend', () => { update(); suggest(k, pins[k].getLatLng()); });
    }
    if (fly) map.setView(latlng, Math.max(map.getZoom(), 14));
    update(); suggest(k, L.latLng(latlng), name);
  };
  const setActive = (k) => { active = k; box.querySelectorAll('[data-pin]').forEach(b => b.classList.toggle('active', b.dataset.pin === k)); info.textContent = `Click the map or search to set the ${label(k)}.`; };
  box.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => setActive(b.dataset.pin));
  map.on('click', (e) => { place(active, e.latlng); if (active === 'pickup' && !pins.delivery) setActive('delivery'); });
  // address search
  const q = box.querySelector('[data-locq]'), res = box.querySelector('[data-locres]');
  const runSearch = async () => {
    if (!usable) return;
    if (q.value.trim().length < 3) { res.innerHTML = '<div class="loc-res-msg">Type at least 3 letters.</div>'; res.classList.remove('d-none'); return; }
    res.innerHTML = '<div class="loc-res-msg"><span class="spinner-border spinner-border-sm"></span> Searching…</div>'; res.classList.remove('d-none');
    try {
      const list = await UI.Map.search(q.value);
      res.innerHTML = list.length ? list.map((r, i) => `<button type="button" class="loc-res" data-ri="${i}"><i class="bi bi-geo-alt"></i> <span></span></button>`).join('') : '<div class="loc-res-msg">No place found. Try another name, or type the address in the field below.</div>';
      res.querySelectorAll('[data-ri]').forEach(b => { const r = list[+b.dataset.ri]; b.querySelector('span').textContent = r.name;
        b.onclick = () => { place(active, L.latLng(r.lat, r.lng), r.name, true); res.classList.add('d-none'); q.value = ''; if (active === 'pickup' && !pins.delivery) setActive('delivery'); }; });
    } catch (e) { res.innerHTML = `<div class="loc-res-msg text-danger">${UI.esc(e.message)} Type the address in the field below.</div>`; }
  };
  box.querySelector('[data-locgo]').onclick = runSearch;
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  // saved points (edit / review)
  if (initial.pickup_lat) place('pickup', L.latLng(+initial.pickup_lat, +initial.pickup_lng), initial.pickup_point || '');
  if (initial.delivery_lat) place('delivery', L.latLng(+initial.delivery_lat, +initial.delivery_lng), initial.delivery_point || '');
  if (pins.pickup && pins.delivery) map.fitBounds(L.latLngBounds([pins.pickup.getLatLng(), pins.delivery.getLatLng()]).pad(0.3));
  else if (pins.pickup) map.setView(pins.pickup.getLatLng(), 13);
  if (pins.pickup && !pins.delivery) setActive('delivery');
  setTimeout(() => map.invalidateSize(), 250);
  return map;
};
/** Read-only route map (trip details). */
UI.routeMap = (box, t) => {
  if (typeof L === 'undefined' || !t.pickup_lat || !t.delivery_lat) { box.innerHTML = ''; box.classList.add('d-none'); return; }
  const map = L.map(box, { scrollWheelZoom: false });
  UI.Map.tiles(map, (msg) => { box.insertAdjacentHTML('beforebegin', `<div class="loc-notice">${UI.esc(msg)}</div>`); });
  const a = [+t.pickup_lat, +t.pickup_lng], b = [+t.delivery_lat, +t.delivery_lng];
  const icon = (k) => L.divIcon({ className: 'pin-icon ' + k, html: `<i class="bi bi-geo-alt-fill"></i>`, iconSize: [30, 30], iconAnchor: [15, 29] });
  L.marker(a, { icon: icon('pickup') }).addTo(map).bindTooltip('Pickup: ' + t.pickup_point); L.marker(b, { icon: icon('delivery') }).addTo(map).bindTooltip('Destination: ' + t.delivery_point);
  L.polyline([a, b], { color: '#1f2328', weight: 2, dashArray: '6 6' }).addTo(map);
  map.fitBounds(L.latLngBounds([a, b]).pad(0.3)); setTimeout(() => map.invalidateSize(), 300);
};

/** Payment fields used by Finance and Billing. */
UI.payFields = (methods, dateName = 'released_on', dateLabel = 'Release date') => [
  { name: 'payment_method', label: 'Payment method', type: 'select', options: UI.list(methods), required: true, col: 6 },
  { name: dateName, label: dateLabel, type: 'date', value: UI.today(), required: true, col: 6 },
  { name: 'reference_number', label: 'Reference no. (bank / e-wallet)', col: 4 },
  { name: 'cheque_number', label: 'Cheque no.', col: 4 }, { name: 'bank_name', label: 'Bank', col: 4 },
];


// Chart.js look that matches the design system.
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#57606a';
  Chart.defaults.borderColor = '#e6e8eb';
}
