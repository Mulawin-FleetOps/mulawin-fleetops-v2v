/* assets/js/modules/operations/clients.js — CLIENT MASTERLIST
   PDF #12 Scenario A step 2: the Operations Head fills in the digital client information
   sheet (printable), attaches the client signature and the accreditation files; only a
   complete profile can be saved (Pending Rate). Billing sets the rate -> Active.
   Only Active clients can be selected for trips.
   Backend: backend/Modules/Operations/Clients.php */
'use strict';
const ClientUI = {
  infoFields(c = {}) {
    return [
      { name: 'company_name', label: 'Registered name', required: true, col: 8, value: c.company_name },
      { name: 'tin', label: 'TIN', col: 4, value: c.tin, placeholder: '000-000-000-000' },
      { name: 'trade_name', label: 'Trade / business name', col: 6, value: c.trade_name },
      { name: 'nature_of_business', label: 'Nature of business', col: 6, value: c.nature_of_business },
      { name: 'business_address', label: 'Business address', required: true, col: 12, value: c.business_address },
      { name: 'contact_person', label: 'Contact person', required: true, col: 4, value: c.contact_person },
      { name: 'contact_position', label: 'Position', col: 4, value: c.contact_position },
      { name: 'contact_number', label: 'Contact number', required: true, col: 4, value: c.contact_number },
      { name: 'email', label: 'Email', type: 'email', col: 6, value: c.email },
      { name: 'notes', label: 'Notes', col: 6, value: c.notes },
    ];
  },
  fileFields(required) {
    const f = (name, label, img) => ({ name, label, type: 'file', required, col: 6, attrs: `accept="${img ? 'image/*' : 'application/pdf,image/*'}"` });
    return [{ type: 'html', html: '<div class="drawer-h">Requirements (all are needed before saving)</div>' },
      f('signature', 'Client signature (image)', true), f('company_profile', 'Company profile'), f('sec_dti', 'SEC / DTI registration'),
      f('business_permit', 'Business permit'), f('bir_2303', 'Certificate of Registration (BIR Form 2303)')];
  },
  create() {
    const wrap = UI.formModalFiles('New client profile (client information sheet)', [...ClientUI.infoFields(), ...ClientUI.fileFields(true)], 'Clients.create',
      { intro: 'The profile is saved only when every requirement is attached. Billing then sets the rate, and the client becomes Active.',
        submit: 'Save client profile', extraFooter: '<button type="button" class="btn btn-outline-secondary btn-sm me-auto" id="ciBlank"><i class="bi bi-printer"></i> Print blank form for the client</button>' });
    wrap.querySelector('#ciBlank').onclick = () => ClientUI.printSheet({});
  },
  printSheet(c, sigDoc) {
    const row = (l, v) => `<tr><th style="width:32%">${UI.esc(l)}</th><td>${UI.esc(v || '')}&nbsp;</td></tr>`;
    UI.printForm('CLIENT INFORMATION SHEET', `<table>${row('Registered name', c.company_name)}${row('Trade / business name', c.trade_name)}${row('TIN', c.tin)}
      ${row('Nature of business', c.nature_of_business)}${row('Business address', c.business_address)}${row('Contact person', c.contact_person)}${row('Position', c.contact_position)}
      ${row('Contact number', c.contact_number)}${row('Email', c.email)}${row('Payment terms (days)', c.payment_terms_days)}</table>
      <div class="pf-note">Accreditation requirements: <span class="chk"></span>Company profile &nbsp; <span class="chk"></span>SEC / DTI registration &nbsp; <span class="chk"></span>Business permit &nbsp; <span class="chk"></span>Certificate of Registration (BIR Form 2303)</div>
      <div class="pf-signs"><div class="pf-sign"><div class="pf-line">${sigDoc ? `<img src="${UI.docUrl(sigDoc)}" alt="signature">` : ''}</div><div class="pf-sl">Client authorized representative (signature over printed name)</div></div>
      ${UI.sign('Received by (Operations Head)')}</div>`, { number: c.client_code || '' });
  },
  rate(c, rates = []) {
    const get = (t, k) => (rates.find(r => r.truck_type === t) || {})[k] || '';
    const rows = App.me.truckTypes.map(t => `<div class="row g-2 align-items-end mb-1"><div class="col-4"><label class="form-label">${UI.esc(t)}</label></div>
      <div class="col-4"><input class="form-control form-control-sm" type="number" step="0.01" min="0" data-rate="${UI.esc(t)}" placeholder="Rate per km" value="${UI.esc(get(t, 'rate_per_km'))}"></div>
      <div class="col-4"><input class="form-control form-control-sm" type="number" step="0.01" min="0" data-min="${UI.esc(t)}" placeholder="Minimum charge (optional)" value="${+get(t, 'minimum_charge') ? UI.esc(get(t, 'minimum_charge')) : ''}"></div></div>`).join('');
    UI.modal('Billing rate of ' + UI.esc(c.company_name), `<p class="small text-muted">Billing amount = billable km (pickup to delivery) x rate per km, never lower than the minimum charge, plus additional charges added by Billing. Leave a truck type blank if the client does not use it.</p>
      <div class="row g-2 small text-muted"><div class="col-4">Truck type</div><div class="col-4">Rate per km (PHP)</div><div class="col-4">Minimum charge (PHP)</div></div>${rows}
      ${UI.fields([{ name: 'payment_terms_days', label: 'Payment terms (days; blank = default ' + (ClientUI.defaultTerms || 30) + ')', type: 'number', value: c.payment_terms_days ?? '', col: 6 }])}`,
      async (d, form) => {
        const list = App.me.truckTypes.map(t => ({ truck_type: t, rate_per_km: form.querySelector(`[data-rate="${t}"]`).value, minimum_charge: form.querySelector(`[data-min="${t}"]`).value })).filter(x => x.rate_per_km);
        const r = await App.api('Clients.rate_save', { id: c.id, rates: list, payment_terms_days: d.payment_terms_days }); UI.result(r); UI.closeDrawer(); App.route();
      }, { submit: 'Save rate' });
  },
  async open(id, d) {
    let r; try { r = await App.api('Clients.details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const c = r.client;
    const sig = r.documents.find(x => x.category === 'Client Signature');
    const acts = [];
    if (d.can.edit) acts.push('<button class="btn btn-sm btn-outline-primary" data-a="edit"><i class="bi bi-pencil"></i> Edit information</button>',
      '<button class="btn btn-sm btn-outline-secondary" data-a="docs"><i class="bi bi-paperclip"></i> Upload requirements</button>');
    if (d.can.rate && ['Pending Rate', 'Active'].includes(c.status)) acts.push(`<button class="btn btn-sm btn-${c.status === 'Pending Rate' ? 'primary' : 'outline-primary'}" data-a="rate"><i class="bi bi-cash"></i> ${c.status === 'Pending Rate' ? 'Set billing rate' : 'Change rate'}</button>`);
    acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="print"><i class="bi bi-printer"></i> Print information sheet</button>');
    if (d.can.edit) acts.push(`<button class="btn btn-sm btn-outline-${c.status === 'Inactive' ? 'success' : 'danger'}" data-a="active">${c.status === 'Inactive' ? 'Reactivate' : 'Deactivate'}</button>`);
    const html = `<div class="mb-2">${UI.badge(c.status)} <span class="small text-muted">${UI.esc(c.client_code || '')}</span></div>
      ${c.status === 'Incomplete' ? `<div class="alert alert-warning py-2 small">Missing requirements: ${r.missing.map(UI.esc).join(', ') || 'complete the information sheet'}. The client cannot be used for trips yet.</div>` : ''}
      ${c.status === 'Pending Rate' ? '<div class="alert alert-info py-2 small">Profile complete. Waiting for Billing to set the billing rate.</div>' : ''}
      <div class="drawer-actions">${acts.join('')}</div>
      ${UI.h('Client information')}${UI.kv([['Registered name', `<b>${UI.esc(c.company_name)}</b>`], ['Trade name', UI.e(c.trade_name)], ['TIN', UI.e(c.tin)], ['Nature of business', UI.e(c.nature_of_business)],
        ['Address', UI.e(c.business_address)], ['Contact', UI.esc([c.contact_person, c.contact_position].filter(Boolean).join(', ') || '—')], ['Phone / email', UI.esc([c.contact_number, c.email].filter(Boolean).join(' · ') || '—')],
        ['Payment terms', c.payment_terms_days !== null ? c.payment_terms_days + ' days' : 'default'], ['Created by', UI.e(c.created_by_name)], ['Rate set by', c.rate_set_by_name ? UI.esc(c.rate_set_by_name) + ' · ' + UI.datetime(c.rate_set_at) : '—']])}
      ${UI.h('Billing rates')}${r.rates.length ? UI.table([['Truck type', 'truck_type'], ['Rate per km', 'rate_per_km', 'money'], ['Minimum charge', 'minimum_charge', 'money'], ['Updated by', 'updated_by_name'], ['Updated', 'updated_at', 'date']], r.rates) : '<div class="text-muted small">No rate yet.</div>'}
      ${UI.h('Accreditation documents')}${UI.docs(r.documents)}
      ${UI.h('Billing summary')}${UI.kv([['Invoices', UI.num(r.billing.invoices)], ['Billed', UI.money(r.billing.billed)], ['Paid', UI.money(r.billing.paid)], ['Balance', UI.money(r.billing.billed - r.billing.paid)]])}
      ${UI.h('Recent trips')}${UI.table([['Trip', 'trip_ref'], ['Status', 'status', 'badge'], ['Type', 'truck_type'], ['Schedule', 'scheduled_at', 'date'], ['To', 'delivery_point']], r.trips, { empty: 'No trips yet.' })}`;
    const el = UI.drawer(UI.esc(c.company_name), html, { subtitle: 'Client profile' });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') UI.formModal('Edit ' + UI.esc(c.company_name), ClientUI.infoFields(c), 'Clients.update', { extra: { id: c.id }, after: () => { ClientUI.open(c.id, d); App.route(); } });
      if (a === 'docs') UI.formModalFiles('Upload requirements of ' + UI.esc(c.company_name), [...ClientUI.fileFields(false), { name: 'other', label: 'Other client documents (contract, ...)', type: 'file', multiple: true, col: 12 }],
        'Clients.documents', { extra: { id: c.id }, intro: r.missing.length ? 'Still missing: ' + r.missing.map(UI.esc).join(', ') : 'Upload renewed files if needed.', submit: 'Upload', after: () => { ClientUI.open(c.id, d); App.route(); } });
      if (a === 'rate') ClientUI.rate(c, r.rates);
      if (a === 'print') ClientUI.printSheet(c, sig ? sig.id : null);
      if (a === 'active') UI.confirmAction((c.status === 'Inactive' ? 'Reactivate ' : 'Deactivate ') + UI.esc(c.company_name), c.status === 'Inactive' ? 'The client returns to the masterlist.' : 'The client can no longer be chosen for new trips. Old trips and invoices are kept.',
        'Clients.set_active', { id: c.id, active: c.status === 'Inactive' ? 1 : 0 }, { danger: c.status !== 'Inactive' });
    });
  },
};

App.page('clients', {
  title: 'Client Masterlist',
  subtitle: 'Registered clients, accreditation documents and billing rates. Only Active clients can be used for trips.',
  render(ctx) {
    const d = ctx.data, q = ctx.query; ClientUI.defaultTerms = d.defaultTerms;
    if (d.can.edit) { const b = document.createElement('button'); b.className = 'btn btn-sm btn-primary'; b.innerHTML = '<i class="bi bi-plus-lg"></i> New client'; b.onclick = () => ClientUI.create(); ctx.tools.append(b); }
    const n = (s) => d.clients.filter(c => c.status === s).length;
    const need = Object.keys(d.requiredDocs).length;
    const rows = d.clients.filter(c => q.status ? c.status === q.status : c.status !== 'Inactive');
    ctx.el.innerHTML = UI.cards([
      { label: 'Active clients', value: n('Active'), icon: 'bi-building-check', color: 'green' },
      { label: 'Waiting for billing rate', value: n('Pending Rate'), icon: 'bi-hourglass-split', color: 'blue' },
      { label: 'Incomplete requirements', value: n('Incomplete'), icon: 'bi-exclamation-circle', color: 'amber' },
      { label: 'Inactive', value: n('Inactive'), icon: 'bi-archive', color: 'gray' },
    ]) + UI.filterModal(ctx, [{ name: 'status', label: 'Status', type: 'select', options: UI.list(['Active', 'Pending Rate', 'Incomplete', 'Inactive']), col: 12 }], { hint: 'Showing all clients except inactive.' })
      + UI.table([['Code', 'client_code'], ['Client', 'company_name', (v) => `<b>${UI.esc(v)}</b>`], ['Contact', 'contact_person'], ['Phone', 'contact_number'], ['Status', 'status', 'badge'],
        ['Requirements', 'docs_done', (v) => `<span class="badge-s ${+v >= need ? 'green' : 'amber'}">${+v} / ${need}</span>`], ['Rates', 'rates'], ['Trips', 'trip_count', 'num'], ['Balance', 'balance', 'money']],
        rows, { title: 'Clients', actions: (c) => UI.btn('view', 'View') + (d.can.rate && c.status === 'Pending Rate' ? UI.btn('rate', 'Set rate', 'primary') : ''),
          onAction: (a, c) => a === 'rate' ? App.api('Clients.details', { id: c.id }).then(r => ClientUI.rate(r.client, r.rates)) : ClientUI.open(c.id, d) });
    UI.activate(ctx.el);
  },
});
