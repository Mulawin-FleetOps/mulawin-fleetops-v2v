/* assets/js/modules/maintenance/mechanics.js — MECHANIC MASTERLIST
   Mechanics who do corrective maintenance. Availability: Available, Assigned (working on a
   repair, set by the system) or Unavailable (set by hand with a reason).
   Backend: backend/Modules/Maintenance/Mechanics.php */
'use strict';
const MechUI = {
  data: null,
  form(m = {}) {
    UI.formModal(m.id ? 'Edit ' + UI.esc(m.full_name) : 'Add mechanic', [
      { name: 'full_name', label: 'Full name (LAST NAME, FIRST NAME)', required: true, col: 12, value: m.full_name },
      { name: 'contact_number', label: 'Contact number', col: 6, value: m.contact_number, placeholder: '0917 123 4567' },
      { name: 'specialization', label: 'Specialization / skills', col: 6, value: m.specialization, placeholder: 'e.g. engine, electrical, brakes' },
      { name: 'notes', label: 'Notes', col: 12, value: m.notes }],
      'Mechanics.save', { extra: m.id ? { id: m.id } : {}, size: '', intro: m.id ? '' : 'The Mechanic ID (MEC-###) is given by the system. New mechanics start as Available.' });
  },
  async open(id) {
    const can = MechUI.data.can.edit;
    let r; try { r = await App.api('Mechanics.details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const m = r.mechanic;
    const acts = [];
    if (can && +m.active) {
      acts.push(['edit', 'Edit', 'outline-secondary', 'bi-pencil']);
      if (m.availability === 'Unavailable') acts.push(['avail', 'Set Available', 'outline-success', 'bi-check-circle']);
      else if (m.availability === 'Available') acts.push(['unavail', 'Set Unavailable', 'outline-secondary', 'bi-slash-circle']);
      acts.push(['deact', 'Deactivate', 'outline-danger', '']);
    } else if (can) acts.push(['react', 'Reactivate', 'outline-success', '']);
    const html = `<div class="mb-2">${UI.badge(+m.active ? m.availability : 'Inactive')}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.map(([a, l, c, ic]) => `<button class="btn btn-sm btn-${c}" data-a="${a}">${ic ? `<i class="bi ${ic}"></i> ` : ''}${l}</button>`).join('')}</div>` : ''}
      ${UI.h('Details')}${UI.kv([['Mechanic ID', UI.e(m.mechanic_code)], ['Full name', `<b>${UI.esc(m.full_name)}</b>`], ['Contact', UI.e(m.contact_number)],
        ['Specialization', UI.e(m.specialization)], ['Unavailable because', m.availability === 'Unavailable' ? UI.e(m.unavailable_reason) : '—'], ['Notes', UI.e(m.notes)]])}
      ${UI.h('Repair assignments')}${UI.table([['Record', 'job_ref'], ['Truck', 'plate_number'], ['Problem', 'problem'], ['Status', 'status', 'badge'], ['Reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date']], r.jobs,
        { plain: true, empty: 'No repair assigned yet.', rowClick: (j) => App.go('maintenance', { open: j.id }) })}`;
    const el = UI.drawer(UI.esc(m.full_name), html, { subtitle: 'Mechanic ' + UI.esc(m.mechanic_code) });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') MechUI.form(m);
      if (a === 'avail') UI.confirmAction('Set ' + UI.esc(m.full_name) + ' Available', 'The mechanic can be assigned to new repairs again.', 'Mechanics.availability', { id: m.id, availability: 'Available' });
      if (a === 'unavail') UI.confirmAction('Set ' + UI.esc(m.full_name) + ' Unavailable', 'The mechanic will not appear in the repair assignment list.', 'Mechanics.availability', { id: m.id, availability: 'Unavailable' },
        { fields: [{ name: 'reason', label: 'Reason (e.g. on leave)', required: true, col: 12 }] });
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
    const q = ctx.query;
    const active = d.mechanics.filter(m => +m.active);
    let rows = q.inactive ? d.mechanics : active;
    if (q.availability) rows = rows.filter(m => m.availability === q.availability);
    const n = (s) => active.filter(m => m.availability === s).length;
    ctx.el.innerHTML = UI.statusStrip([
      { label: 'Active mechanics', value: active.length },
      { label: 'Available', value: n('Available'), color: 'green' },
      { label: 'Assigned to a repair', value: n('Assigned'), color: 'blue' },
      { label: 'Unavailable', value: n('Unavailable'), color: n('Unavailable') ? 'red' : '' },
    ]) + UI.filterModal(ctx, [
      { name: 'availability', label: 'Availability', type: 'select', options: UI.list(['Available', 'Assigned', 'Unavailable']), col: 12 },
      { name: 'inactive', label: 'Include deactivated mechanics', type: 'checkbox', col: 12 }], { hint: 'Showing all active mechanics.' })
      + UI.table([
        ['Mechanic', 'full_name', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(m.mechanic_code)}</div>`],
        ['Specialization', 'specialization'], ['Contact', 'contact_number'],
        ['Availability', 'availability', (v, m) => UI.badge(+m.active ? v : 'Inactive')],
        ['Current assignment', 'job_ref', (v, m) => v ? `${UI.esc(v)}<div class="cell-sub">${UI.esc(m.job_truck)} · ${UI.esc(m.job_status)}</div>` : '<span class="text-muted">—</span>'],
        ['Completed repairs', 'completed_jobs', 'num']], rows,
        { actions: () => UI.btn('view', 'Open'), onAction: (a, m) => MechUI.open(m.id), rowClick: (m) => MechUI.open(m.id),
          empty: d.mechanics.length ? 'No mechanic matches the filter.' : 'No mechanics yet. Add the mechanics who repair the trucks.' });
  },
});
