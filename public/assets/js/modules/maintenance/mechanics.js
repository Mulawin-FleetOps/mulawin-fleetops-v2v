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
  /** Time In / Time Out: the server checks the saved state; the screen is reloaded from it (no alert or confirm dialogs). */
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
      acts.push(['toggle', timedIn ? 'Time Out' : 'Time In', timedIn ? 'outline-secondary' : 'success', 'bi-clock']);
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
      if (a === 'toggle') { UI.closeDrawer?.(); MechUI.toggle({ id: m.id, timed_in: timedIn ? 1 : 0 }); }
      if (a === 'deact') UI.confirmAction('Deactivate ' + UI.esc(m.full_name), 'The mechanic is removed from the lists. Repair history is kept.', 'Mechanics.set_active', { id: m.id, active: 0 }, { danger: true, submit: 'Deactivate' });
      if (a === 'react') UI.confirmAction('Reactivate ' + UI.esc(m.full_name), 'The mechanic returns to the masterlist.', 'Mechanics.set_active', { id: m.id, active: 1 });
    });
  },
};

App.page('mechanics', {
  title: 'Mechanic Masterlist',
  subtitle: 'Mechanics who inspect and repair trucks under corrective maintenance.',
  render(ctx) {
    const d = MechUI.data = ctx.data;
    if (d.can.edit) UI.tool(ctx, 'Add mechanic', () => MechUI.form(), 'bi-plus-lg', 'primary');
    if (App.me.user.role === 'admin') UI.tool(ctx, 'Attendance', () => AttendanceUI.open('Mechanic'), 'bi-clipboard-check', 'outline-primary');
    const q = ctx.query;
    const active = d.mechanics.filter(m => +m.active);
    let rows = q.inactive ? d.mechanics.filter(m => !+m.active) : active;
    if (q.availability) rows = rows.filter(m => m.availability === q.availability);
    const n = (s) => active.filter(m => m.availability === s).length;
    // Quick availability tabs supplement (but do not replace) Filter modal controls.
    const quickStatuses = [['', 'All'], ['Available', 'Available'], ['Assigned', 'Assigned'], ['Unavailable', 'Unavailable'], ['__inactive__', 'Inactive']];
    const quickTabs = `<div class="d-flex flex-wrap align-items-center gap-2 mb-3" role="group" aria-label="Mechanic availability shortcuts">
      ${quickStatuses.map(([value, label]) => `<button type="button" class="btn btn-sm ${String(q.inactive ? '__inactive__' : (q.availability || '')) === value ? 'btn-primary' : 'btn-outline-secondary'}" data-mechanic-quick="${UI.esc(value)}" aria-pressed="${String(q.inactive ? '__inactive__' : (q.availability || '')) === value}">${UI.esc(label)}</button>`).join('')}
    </div>`;
    ctx.el.innerHTML = UI.statusStrip([
      { label: 'Active mechanics', value: active.length },
      { label: 'Available', value: n('Available'), color: 'green' },
      { label: 'Assigned to a repair', value: n('Assigned'), color: 'blue' },
      { label: 'Unavailable', value: n('Unavailable'), color: n('Unavailable') ? 'red' : '' },
    ]) + quickTabs + UI.filterModal(ctx, [
      { name: 'availability', label: 'Availability', type: 'select', options: UI.list(['Available', 'Assigned', 'Unavailable']), col: 12 },
      { name: 'inactive', label: 'Include deactivated mechanics', type: 'checkbox', col: 12 }], { hint: 'Showing all active mechanics.' })
      + UI.table([
        ['Mechanic', 'full_name', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(m.mechanic_code)}</div>`],
        ['Specialization', 'specialization'],
        ['Attendance', 'timed_in', (v, m) => +v ? '<span class="badge-s green">Timed In</span>' : (m.last_time_out ? '<span class="badge-s amber">Timed Out</span>' : '<span class="text-muted">Not timed in</span>')],
        ['Time In', 'last_time_in', (v) => v ? UI.datetime(v) : '<span class="text-muted">—</span>'],
        ['Time Out', 'last_time_out', (v, m) => +m.timed_in ? '<span class="text-muted">—</span>' : (v ? UI.datetime(v) : '<span class="text-muted">—</span>')],
        ['Availability', 'availability', (v, m) => UI.badge(+m.active ? v : 'Inactive')],
        ['Current assignment', 'job_ref', (v, m) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(m.job_truck)} · ${UI.esc(m.job_status)}</div>` : '<span class="text-muted">—</span>'],
        ['Completed repairs', 'completed_jobs', 'num']], rows,
        { actions: (m) => (d.can.edit && +m.active ? UI.btn('toggle', +m.timed_in ? 'Time Out' : 'Time In', +m.timed_in ? 'outline-secondary' : 'success', 'bi-clock') + ' ' : '') + UI.btn('view', 'Open'),
          onAction: (a, m, b) => a === 'toggle' ? MechUI.toggle(m, b) : MechUI.open(m.id), rowClick: (m) => MechUI.open(m.id),
          empty: d.mechanics.length ? 'No mechanic matches the filter.' : 'No mechanics yet. Add the mechanics who repair the trucks.' });
    // Quick tabs replace the redundant Filter button on this masterlist.
    ctx.el.querySelector('.filter-summary [data-fopen]')?.remove();
    ctx.el.querySelectorAll('[data-mechanic-quick]').forEach(button => {
      button.addEventListener('click', () => {
        const next = { ...ctx.query };
        const value = button.dataset.mechanicQuick;
        delete next.availability;
        delete next.inactive;
        if (value === '__inactive__') next.inactive = '1';
        else if (value) next.availability = value;
        App.go(ctx.page, next);
      });
    });
  },
});

/* MOTORPOOL_WORKSPACE_PHASE1 — Mechanic Attendance (Time In / Time Out board + session history).
   Data: Mechanics::read('mechanic_attendance') — board (active mechanics, open Time In, current repair;
   Admin only: today's daily Present / Absent mark) and sessions overlapping ?from= / ?to= (default today).
   Writes: ONLY the existing Mechanics.time_in / Mechanics.time_out through MechUI.toggle (Admin + Motorpool;
   the server checks the role, an open session, and that a mechanic with an active repair cannot Time Out).
   Operations Head and Audit see the page read-only. URL filter: ?duty=in|out, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD. */
const MechAtt = {
  /** Minutes -> "3h 05m". */
  duration(min) {
    const m = Math.max(0, +min || 0), h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
  },
};

App.page('mechanic_attendance', {
  title: 'Mechanic Attendance',
  subtitle: 'Time In and Time Out of the mechanics. Only timed-in mechanics are Available for repairs.',
  render(ctx) {
    const d = MechUI.data = ctx.data, q = ctx.query, can = d.can || {};
    const board = Array.isArray(d.board) ? d.board : [];
    const sessions = Array.isArray(d.sessions) ? d.sessions : [];
    const range = d.range || {};
    const isAdmin = App.me.user.role === 'admin';
    if (isAdmin && typeof AttendanceUI !== 'undefined') UI.tool(ctx, 'Daily attendance (Present / Absent)', () => AttendanceUI.open('Mechanic'), 'bi-clipboard-check', 'outline-primary');
    if (UI.canGo('mechanics')) UI.tool(ctx, 'Mechanic masterlist', () => App.go('mechanics'), 'bi-person-gear');

    // KPI cards: same availability values as the Mechanic Masterlist (mechanics.availability of active mechanics).
    const onDuty = board.filter(m => m.open_time_in);
    const count = (s) => board.filter(m => m.availability === s).length;
    const cards = [
      { label: 'On duty now', value: onDuty.length, note: 'timed in', color: onDuty.length ? 'green' : '', go: 'mechanic_attendance?duty=in' },
      { label: 'Available', value: count('Available'), note: 'can take a repair', color: 'green', go: 'mechanics?availability=Available' },
      { label: 'Assigned to a repair', value: count('Assigned'), color: 'blue', go: 'mechanics?availability=Assigned' },
      { label: 'Unavailable', value: count('Unavailable'), note: 'not timed in', color: count('Unavailable') ? 'red' : '', go: 'mechanics?availability=Unavailable' },
    ];
    const filters = [
      { name: 'duty', label: 'Board: show', type: 'select', col: 12, options: [['in', 'Timed in only'], ['out', 'Not timed in only']] },
      { name: 'from', label: 'Sessions from', type: 'date', col: 6 },
      { name: 'to', label: 'Sessions to', type: 'date', col: 6 },
    ];
    ctx.el.innerHTML = UI.statusStrip(cards) + UI.filterModal(ctx, filters, { hint: 'Showing all active mechanics and today\'s sessions.', note: `Sessions: at most ${range.max_days || 62} days at a time.` });

    // Board of active mechanics.
    const duty = q.duty === 'in' || q.duty === 'out' ? q.duty : '';
    const rows = board.filter(m => !duty || (duty === 'in' ? !!m.open_time_in : !m.open_time_in))
      .map(m => ({ ...m, timed_in: m.open_time_in ? 1 : 0 }));
    const cols = [
      ['Mechanic', 'full_name', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(m.mechanic_code)}${m.specialization ? ' · ' + UI.esc(m.specialization) : ''}</div>`],
      ['Attendance', 'open_time_in', (v, m) => v ? `<span class="badge-s green">Timed In</span><div class="cell-sub">since ${UI.datetime(v)}</div>`
        : (m.last_time_out ? `<span class="badge-s amber">Timed Out</span><div class="cell-sub">${UI.datetime(m.last_time_out)}</div>` : '<span class="text-muted">Not timed in</span>')],
      ['On duty', 'minutes_on_duty', (v, m) => m.open_time_in ? MechAtt.duration(v) : '<span class="text-muted">—</span>'],
      ['Availability', 'availability', 'badge'],
      ['Current repair', 'job_ref', (v, m) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(m.job_truck || '')} · ${UI.esc(m.job_status || '')}</div>` : '<span class="text-muted">—</span>'],
      ...(isAdmin ? [['Daily mark (today)', 'daily_mark', (v) => v ? UI.badge(v) : '<span class="text-muted">Not marked</span>']] : []),
    ];
    const box = document.createElement('div');
    ctx.el.append(box);
    box.innerHTML = UI.table(cols, rows, {
      title: 'Mechanics today',
      actions: (m) => (can.edit ? UI.btn('toggle', m.open_time_in ? 'Time Out' : 'Time In', m.open_time_in ? 'outline-secondary' : 'success', 'bi-clock') + ' ' : '') + UI.btn('view', 'Open'),
      onAction: (a, m, b) => (a === 'toggle' ? MechUI.toggle(m, b) : MechUI.open(m.id)),
      rowClick: (m) => MechUI.open(m.id),
      empty: board.length ? 'No mechanic matches the filter.' : 'No active mechanics. Add mechanics in the Mechanic Masterlist.',
    });

    // Session history for the chosen dates.
    const label = range.from === range.to ? UI.date(range.from) : `${UI.date(range.from)} – ${UI.date(range.to)}`;
    const hist = document.createElement('div');
    hist.className = 'mt-3';
    ctx.el.append(hist);
    hist.innerHTML = UI.table([
      ['Mechanic', 'full_name', (v, s) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(s.mechanic_code)}</div>`],
      ['Time In', 'time_in', 'datetime'],
      ['Time Out', 'time_out', (v) => v ? UI.datetime(v) : '<span class="badge-s green">Still timed in</span>'],
      ['Duration', 'minutes', (v) => MechAtt.duration(v)],
      ['Timed in by', 'time_in_by'],
      ['Timed out by', 'time_out_by'],
    ], sessions, { title: 'Time In / Time Out sessions · ' + UI.esc(label), showDates: true, empty: 'No Time In recorded for these dates.' });
  },
});
