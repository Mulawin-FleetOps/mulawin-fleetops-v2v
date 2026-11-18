/* assets/js/modules/maintenance/mechanics.js — MECHANIC MASTERLIST + MECHANIC ATTENDANCE (Time In / Time Out)
   Mechanics who do corrective maintenance. Availability follows attendance: Unavailable (not timed in),
   Available (timed in) or Assigned (timed in and working on a repair, set by the system).
   The Time In / Time Out buttons call Mechanics.time_in / Mechanics.time_out; the server decides and the screen reloads from the saved state.
   Backend: backend/Modules/Maintenance/Mechanics.php */
'use strict';
const MechUI = {
  data: null,
  form(m = {}) {
    UI.formModal(m.id ? 'Edit ' + UI.esc(m.full_name) : 'Add mechanic', [
      { name: 'full_name', label: 'Full name (LAST NAME, FIRST NAME)', required: true, col: 12, value: m.full_name },
      { name: 'contact_number', label: 'Contact number', col: 12, value: m.contact_number, placeholder: '0917 123 4567' },
      { name: 'specialization', label: 'Specialization / skills', col: 6, value: m.specialization, placeholder: 'e.g. engine, electrical, brakes' },
      { name: 'notes', label: 'Notes', col: 12, value: m.notes }],
      'Mechanics.save', { extra: m.id ? { id: m.id } : {}, size: '', intro: m.id ? '' : 'The Mechanic ID (MEC-###) is given by the system. New mechanics start Unavailable until they Time In.' });
  },
  /** Attendance page only: the server checks saved Time In / Time Out state. */
  async toggle(m, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await App.api(+m.timed_in ? 'Mechanics.time_out' : 'Mechanics.time_in', { id: m.id });
      UI.toast(r.message || 'Saved.');
    } catch (e) { UI.toast(e.message, 'error'); }
    App.route();
  },
  async open(id) {
    const can = MechUI.data.can.edit;
    let r; try { r = await App.api('Mechanics.details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const m = r.mechanic;
    const timedIn = !!(r.attendance[0] && !r.attendance[0].time_out);
    const acts = [];
    if (can && +m.active) {
      acts.push(['edit', 'Edit', 'outline-secondary', 'bi-pencil']);

      acts.push(['deact', 'Deactivate', 'outline-danger', '']);
    } else if (can) acts.push(['react', 'Reactivate', 'outline-success', '']);
    const html = `<div class="mb-2">${UI.badge(+m.active ? m.availability : 'Inactive')}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.map(([a, l, c, ic]) => `<button class="btn btn-sm btn-${c}" data-a="${a}">${ic ? `<i class="bi ${ic}"></i> ` : ''}${l}</button>`).join('')}</div>` : ''}
      ${UI.h('Details')}${UI.kv([['Mechanic ID', UI.e(m.mechanic_code)], ['Full name', `<b>${UI.esc(m.full_name)}</b>`], ['Contact', UI.e(m.contact_number)],
        ['Specialization', UI.e(m.specialization)], ['Notes', UI.e(m.notes)]])}
      ${UI.h('Attendance (Time In / Time Out)')}${UI.table([['Time In', 'time_in', 'datetime'], ['Time Out', 'time_out', (v) => v ? UI.datetime(v) : '<span class="badge-s green">Still timed in</span>'], ['Timed in by', 'time_in_by'], ['Timed out by', 'time_out_by']], r.attendance,
        { plain: true, empty: 'No Time In recorded yet.' })}
      ${UI.h('Repair assignments')}${UI.table([['Record', 'job_ref'], ['Truck', 'plate_number'], ['Problem', 'problem'], ['Status', 'status', 'badge'], ['Date reported', 'reported_on', 'date'], ['Completion date', 'completed_on', 'date']], r.jobs,
        { plain: true, empty: 'No repair assigned yet.', rowClick: (j) => App.go('maintenance', { open: j.id }) })}`;
    const el = UI.drawer(UI.esc(m.full_name), html, { subtitle: 'Mechanic ' + UI.esc(m.mechanic_code) });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') MechUI.form(m);
      if (a === 'deact') UI.confirmAction('Deactivate ' + UI.esc(m.full_name), 'The mechanic is removed from the lists. Repair history is kept.', 'Mechanics.set_active', { id: m.id, active: 0 }, { danger: true, submit: 'Deactivate' });
      if (a === 'react') UI.confirmAction('Reactivate ' + UI.esc(m.full_name), 'The mechanic returns to the masterlist.', 'Mechanics.set_active', { id: m.id, active: 1 });
    });
  },
};

App.page('mechanics', {
  title: 'Mechanic Masterlist',
  subtitle: 'Review mechanic availability.',
  render(ctx) {
    const d = MechUI.data = ctx.data, q = ctx.query;
    if (d.can.edit) UI.tool(ctx, 'Add mechanic', () => MechUI.form(), 'bi-plus-lg', 'primary');
    if (App.me.user.role === 'admin') UI.tool(ctx, 'Attendance', () => AttendanceUI.open('Mechanic'), 'bi-clipboard-check', 'outline-primary');
    // REF_FIDELITY_V1: availability tabs (same URL keys as before: ?availability=, ?inactive=1), then the reference list.
    const active = d.mechanics.filter(m => +m.active), inactive = d.mechanics.filter(m => !+m.active);
    const AV = ['Available', 'Assigned', 'Unavailable'];
    const key = q.inactive ? 'inactive' : (AV.includes(q.availability) ? q.availability : '');
    const rows = key === 'inactive' ? inactive : key ? active.filter(m => m.availability === key) : active;
    const tab = (spec, label, n, on) => `<button type="button" role="tab" aria-selected="${on}" class="tab ${on ? 'active' : ''}" data-go="${UI.esc(spec)}">${UI.esc(label)} <span class="tab-count">${UI.num(n)}</span></button>`;
    const statusSummary = `<div class="mp-action-stages mb-3">
      <button type="button" class="mp-action-stage" data-go="mechanics?availability=Available"><span class="mp-action-stage-icon"><i class="bi bi-person-check"></i></span><span class="mp-action-stage-content"><b>Available</b><small>Timed in, ready to assign</small></span><strong class="mp-action-stage-count">${active.filter(m => m.availability === 'Available').length}</strong></button>
      <button type="button" class="mp-action-stage" data-go="mechanics?availability=Assigned"><span class="mp-action-stage-icon"><i class="bi bi-wrench-adjustable"></i></span><span class="mp-action-stage-content"><b>Assigned</b><small>Working on a repair</small></span><strong class="mp-action-stage-count">${active.filter(m => m.availability === 'Assigned').length}</strong></button>
      <button type="button" class="mp-action-stage" data-go="mechanics?availability=Unavailable"><span class="mp-action-stage-icon"><i class="bi bi-person-dash"></i></span><span class="mp-action-stage-content"><b>Not on duty</b><small>Must Time In before assignment</small></span><strong class="mp-action-stage-count">${active.filter(m => m.availability === 'Unavailable').length}</strong></button></div>`;
    ctx.el.innerHTML = '<div class="mp-wireframe-marker" hidden></div>' + statusSummary + `<div class="line-tabs ws-status-tabs no-print" role="tablist">${tab('mechanics', 'All active', active.length, key === '')}
      ${AV.map(a => tab('mechanics?availability=' + a, a === 'Assigned' ? 'On a repair' : a, active.filter(m => m.availability === a).length, key === a)).join('')}
      ${tab('mechanics?inactive=1', 'Inactive', inactive.length, key === 'inactive')}</div>`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.classList.add('mp-reference-table', 'mp-ops-table');
    box.innerHTML = `<div class="mp-records-heading"><div><strong>Mechanic Records</strong><small>${UI.num(rows.length)} mechanic${rows.length === 1 ? '' : 's'}</small></div><small>Skills, duty status and repair assignments</small></div>` + UI.table([
      ['Mechanic', 'full_name', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(m.mechanic_code)}</div>`],
      ['Specialization', 'specialization'],
      ['Attendance', 'timed_in', (v, m) => +v ? `<span class="badge-s green">Timed in</span><div class="cell-sub">${UI.datetime(m.last_time_in)}</div>` : (m.last_time_out ? `<span class="badge-s amber">Timed out</span><div class="cell-sub">${UI.datetime(m.last_time_out)}</div>` : '<span class="text-muted">Not timed in</span>')],
      ['Availability', 'availability', (v, m) => UI.badge(+m.active ? v : 'Inactive')],
      ['Current assignment', 'job_ref', (v, m) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(m.job_truck)} · ${UI.esc(m.job_status)}</div>` : '<span class="text-muted">—</span>'],
      ['Completed repairs', 'completed_jobs', 'num']], rows,
      { showAllColumns: true, directActions: true,
        actions: () => UI.ibtn('view', 'Open mechanic', 'bi-eye'),
        onAction: (a, m) => MechUI.open(m.id), rowClick: (m) => MechUI.open(m.id),
        empty: d.mechanics.length ? 'No mechanic in this list.' : 'No mechanics yet. Add the mechanics who repair the trucks.' });
  },
});

/* MOTORPOOL_WORKSPACE_PHASE1 — Mechanic Attendance (Time In / Time Out board + session history).
   Data: Mechanics::read('mechanic_attendance') — board (active mechanics, open Time In, current repair;
   Admin only: today's daily Present / Absent mark) and sessions overlapping ?from= / ?to= (default today).
   Writes: ONLY the existing Mechanics.time_in / Mechanics.time_out through MechUI.toggle (Admin + Motorpool;
   the server checks the role, an open session, and that a mechanic with an active repair cannot Time Out).
   Operations Head and Audit see the page read-only. URL filter: ?duty=in|out, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD.
   REF_FIDELITY_V1: duty tabs + the reference list layout (no KPI row, no card grid). */
const MechAtt = {
  /** Minutes -> "3h 05m". */
  duration(min) {
    const m = Math.max(0, +min || 0), h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
  },
};

App.page('mechanic_attendance', {
  title: 'Mechanic Attendance',
  subtitle: 'Monitor attendance and duty records.',
  render(ctx) {
    const d = MechUI.data = ctx.data, q = ctx.query, can = d.can || {};
    const board = Array.isArray(d.board) ? d.board : [];
    const sessions = Array.isArray(d.sessions) ? d.sessions : [];
    const range = d.range || {};
    const isAdmin = App.me.user.role === 'admin';
    if (isAdmin && typeof AttendanceUI !== 'undefined') UI.tool(ctx, 'Daily attendance (Present / Absent)', () => AttendanceUI.open('Mechanic'), 'bi-clipboard-check', 'outline-primary');
    const tab = q.tab === 'sessions' ? 'sessions' : 'attendance';
    const on = board.filter(m => m.open_time_in);
    const attendanceIntro = `<div class="panel mb-3"><div class="panel-body py-2 px-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div><strong><i class="bi bi-clock-history me-1" aria-hidden="true"></i> Mechanic duty board</strong><div class="small text-muted">${UI.num(on.length)} timed in · ${UI.num(board.length - on.length)} not timed in. A mechanic with an active repair cannot Time Out.</div></div>
      </div></div>`;
    ctx.el.innerHTML = '<div class="mp-wireframe-marker" hidden></div>' + attendanceIntro + UI.statusTabs('mechanic_attendance', q, 'tab', [['attendance', 'Attendance', board.length], ['sessions', 'Sessions', sessions.length]], tab);
    const rows = board.map(m => ({ ...m, timed_in: m.open_time_in ? 1 : 0 }));
    if (tab === 'attendance') {
    const box = document.createElement('div'); ctx.el.append(box);
    // Buttons call the existing actions only (MechUI.toggle -> Mechanics.time_in / time_out, server-checked; MechUI.open -> Mechanics.details).
    box.innerHTML = UI.table([
      ['Mechanic', 'full_name', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(m.mechanic_code)}${m.specialization ? ' · ' + UI.esc(m.specialization) : ''}</div>`],
      ['Today', 'open_time_in', (v, m) => v ? `<span class="badge-s green">Timed in</span><div class="cell-sub">since ${UI.datetime(v)}</div>`
        : (m.last_time_out ? `<span class="badge-s amber">Timed out</span><div class="cell-sub">${UI.datetime(m.last_time_out)}</div>` : '<span class="badge-s gray">Not timed in</span>')],
      ['On duty', 'minutes_on_duty', (v, m) => m.open_time_in ? MechAtt.duration(v) : '<span class="text-muted">—</span>'],
      ['Availability', 'availability', 'badge'],
      ['Current repair', 'job_ref', (v, m) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(m.job_truck || '')} · ${UI.esc(m.job_status || '')}</div>` : '<span class="text-muted">—</span>'],
      ...(isAdmin ? [['Daily mark', 'daily_mark', (v) => v ? UI.badge(v) : '<span class="text-muted">Not marked</span>']] : [])], rows,
      { showAllColumns: true, directActions: true,
        actions: (m) => (can.edit ? `<button type="button" class="btn btn-sm ${m.open_time_in ? 'btn-outline-secondary' : 'btn-outline-primary'}" data-act="toggle" aria-label="${m.open_time_in ? 'Time Out' : 'Time In'} ${UI.esc(m.full_name)}">${m.open_time_in ? 'Time Out' : 'Time In'}</button>` : '') + UI.ibtn('view', 'Open mechanic', 'bi-eye'),
        onAction: (a, m, b) => a === 'toggle' ? MechUI.toggle(m, b) : MechUI.open(m.id), rowClick: (m) => MechUI.open(m.id),
        empty: board.length ? 'No mechanic in this list.' : 'No active mechanics. Add mechanics in the Mechanic Masterlist.' });

    box.classList.add('mp-reference-table', 'mp-ops-table');
    box.insertAdjacentHTML('afterbegin', `<div class="mp-records-heading"><div><strong>Attendance Records</strong><small>${UI.num(rows.length)} mechanic${rows.length === 1 ? '' : 's'}</small></div><small>Duty status and current assignments</small></div>`);

    } else {
    // Session history for the chosen dates.
    const label = range.from === range.to ? UI.date(range.from) : `${UI.date(range.from)} – ${UI.date(range.to)}`;
    const hist = document.createElement('section'); hist.className = 'mt-4 mp-session-section'; ctx.el.append(hist);
    hist.innerHTML = `<h2 class="ref-h">Time In / Time Out sessions · ${UI.esc(label)}</h2>`
      + UI.generalFilters(ctx, [{ name: 'from', label: 'Sessions from', type: 'date' }, { name: 'to', label: 'Sessions to', type: 'date' }])
      + UI.table([
        ['Mechanic', 'full_name', (v, s) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(s.mechanic_code)}</div>`],
        ['Time In', 'time_in', 'datetime'],
        ['Time Out', 'time_out', (v) => v ? UI.datetime(v) : '<span class="badge-s green">Still timed in</span>'],
        ['Duration', 'minutes', (v) => MechAtt.duration(v)],
        ['Timed in by', 'time_in_by'],
        ['Timed out by', 'time_out_by'],
      ], sessions, { showAllColumns: true, empty: `No Time In recorded for these dates (at most ${range.max_days || 62} days at a time).` });
    }
  },
});
