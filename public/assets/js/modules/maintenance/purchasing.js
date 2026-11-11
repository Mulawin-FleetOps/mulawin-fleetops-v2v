/* assets/js/modules/maintenance/purchasing.js — PURCHASING WORKSPACE (Overview, Parts Requests, Purchase Orders, Inventory, Stock Movements)
   A. Parts request (stock-out): Motorpool requests (from Repair Management) -> Purchasing checks stock and releases.
   B. Purchase order (stock-in): Purchasing creates -> routed to Finance (<= limit) or Admin
      (> limit) -> budget check -> approved PO (with e-signature) -> receiving (partial allowed).
   Printable REQUEST FORM (PDF #13) and PURCHASE ORDER.
   Supplier details are typed in the PO form and saved with the PO (no supplier masterlist tab);
   suppliers used before are suggested and fill in their address and contact.
   Backend: backend/Modules/Maintenance/Purchasing.php (payment: Accounting/Finance.php) */
'use strict';
const PurUI = {
  data: null,
  lineEditor(withPrice, lines = []) {
    const parts = PurUI.data.parts.filter(p => +p.active);
    const row = (l = {}) => `<div class="row g-2 mb-1 pl-row"><div class="col-${withPrice ? 6 : 9}"><select class="form-select form-select-sm" data-part><option value="">Choose part…</option>
        ${parts.map(p => `<option value="${p.id}" data-cost="${p.unit_cost}" ${String(p.id) === String(l.part_id) ? 'selected' : ''}>${UI.esc(p.part_number)} · ${UI.esc(p.description)} (on hand ${p.quantity_on_hand} ${UI.esc(p.unit)})</option>`).join('')}</select></div>
      <div class="col-${withPrice ? 2 : 3}"><input class="form-control form-control-sm" type="number" min="1" max="100000" placeholder="Qty" data-qty value="${UI.esc(l.quantity || '')}"></div>
      ${withPrice ? `<div class="col-2"><input class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="Unit price" data-price value="${UI.esc(l.unit_price || '')}"></div><div class="col-2 small text-end pt-1" data-lt></div>` : ''}</div>`;
    const rows = (lines.length ? lines : [{}, {}, {}]).map(row).join('');
    return `<div class="small text-muted mb-1">${withPrice ? 'Part · Qty · Unit price · Amount' : 'Part · Qty'} ${parts.length ? '' : '<b class="text-danger">No parts yet: Purchasing adds them on the Inventory page.</b>'}</div><div data-lines>${rows}</div>
      <button type="button" class="btn btn-sm btn-link p-0" data-addrow>+ Add item</button>${withPrice ? '<div class="text-end fw-bold" data-total></div><div class="small text-end" data-route></div>' : ''}`;
  },
  wireLines(w, withPrice) {
    const host = w.querySelector('[data-lines]');
    const tpl = host.querySelector('.pl-row').outerHTML;
    w.querySelector('[data-addrow]').onclick = () => { host.insertAdjacentHTML('beforeend', tpl); host.lastElementChild.querySelectorAll('input').forEach(i => i.value = ''); host.lastElementChild.querySelector('select').value = ''; calc(); };
    const calc = () => {
      if (!withPrice) return;
      let t = 0;
      host.querySelectorAll('.pl-row').forEach(r => { const q = +r.querySelector('[data-qty]').value || 0, p = +r.querySelector('[data-price]').value || 0; r.querySelector('[data-lt]').textContent = q && p ? UI.money(q * p) : ''; t += q * p; });
      w.querySelector('[data-total]').textContent = 'Total: ' + UI.money(t);
      const lim = +PurUI.data.threshold;
      w.querySelector('[data-route]').innerHTML = t ? (t <= lim ? `Approval goes to <b>Finance</b> (PHP ${UI.num(lim)} and below).` : `Approval goes to the <b>Admin</b> (above PHP ${UI.num(lim)}).`) : '';
    };
    host.addEventListener('input', calc);
    host.addEventListener('change', (e) => { if (withPrice && e.target.matches('[data-part]')) { const pr = e.target.closest('.pl-row').querySelector('[data-price]'); if (!pr.value) pr.value = +e.target.selectedOptions[0]?.dataset.cost || ''; } calc(); });
    calc();
  },
  readLines(w, withPrice) {
    return [...w.querySelectorAll('.pl-row')].map(r => ({ part_id: r.querySelector('[data-part]').value, quantity: r.querySelector('[data-qty]').value, ...(withPrice ? { unit_price: r.querySelector('[data-price]').value } : {}) }))
      .filter(l => l.part_id || l.quantity);
  },
  /** Supplier fields of the PO form; picking a suggested supplier fills the empty fields. */
  supplierFields() {
    return [
      { name: 'supplier_name', label: 'Supplier name', required: true, col: 6, attrs: 'list="poSupList" autocomplete="off" maxlength="150"', help: 'Type the name. Suppliers used before are suggested.' },
      { name: 'supplier_contact', label: 'Contact person (optional)', col: 6, attrs: 'maxlength="120"' },
      { name: 'supplier_address', label: 'Supplier address (optional)', col: 12, attrs: 'maxlength="255"' },
      { name: 'supplier_phone', label: 'Contact number (optional)', col: 6, attrs: 'maxlength="60" inputmode="tel"', placeholder: '0917 123 4567' },
      { name: 'supplier_email', label: 'Supplier email (optional)', type: 'email', col: 6, attrs: 'maxlength="120"' },
    ];
  },
  wireSupplier(w) {
    const list = PurUI.data.supplierSuggestions || [];
    w.querySelector('form').insertAdjacentHTML('beforeend', `<datalist id="poSupList">${list.map(x => `<option value="${UI.esc(x.name)}"></option>`).join('')}</datalist>`);
    const f = (n) => w.querySelector(`[name="${n}"]`);
    f('supplier_name').addEventListener('change', () => {
      const hit = list.find(x => x.name.toUpperCase() === f('supplier_name').value.trim().toUpperCase()); if (!hit) return;
      [['supplier_address', 'address'], ['supplier_contact', 'contact_person'], ['supplier_phone', 'contact_number'], ['supplier_email', 'email']]
        .forEach(([field, key]) => { if (!f(field).value.trim() && hit[key]) f(field).value = hit[key]; });
    });
  },
  newPO(prefill = {}) {
    const d = PurUI.data;
    UI.modal('Purchase Order Request', UI.fields([
      ...PurUI.supplierFields(),
      { name: 'part_request_id', label: 'Related parts request (optional)', type: 'select', col: 6, value: prefill.part_request_id, options: (d.linkableRequests || (d.requests || []).filter(r => ['Not Available', 'Partially Released', 'Requested'].includes(r.status))).map(r => [r.id, r.request_ref + ' · ' + r.plate_number]) },
      { name: 'purpose', label: 'Purpose', required: true, col: 12, value: prefill.purpose }]) + '<div class="mt-2">' + PurUI.lineEditor(true, prefill.lines || []) + '</div>'
      + (d.budget && d.budget.id && +d.budget.in_period ? `<div class="small text-muted mt-2">Purchasing budget available now: <b>${UI.money(d.budget.available)}</b> (checked again at approval).</div>`
        : d.budget && d.budget.id ? `<div class="small text-danger mt-2">The purchasing budget period ended on ${UI.date(d.budget.period_end)}: approval will be rejected until Finance sets a new budget.</div>`
        : '<div class="small text-danger mt-2">No active purchasing budget: approval will be rejected until Finance sets one.</div>'),
      async (x, form, w) => { const r = await App.api('Purchasing.po_create', { ...x, lines: PurUI.readLines(w, true) }); UI.result(r); App.route(); },
      { submit: 'Submit for approval', onShow: (w) => { PurUI.wireLines(w, true); PurUI.wireSupplier(w); } });
  },
  async processRequest(rq) {
    const r = await App.api('Purchasing.request_details', { request_id: rq.id });
    const rows = r.lines.map(l => { const left = l.quantity - l.released_qty, can = Math.min(left, l.quantity_on_hand);
      return `<tr><td>${UI.esc(l.part_number)}<div class="small text-muted">${UI.esc(l.description)}</div></td><td class="num">${l.quantity}</td><td class="num">${l.released_qty}</td><td class="num">${l.quantity_on_hand}</td>
        <td><input class="form-control form-control-sm" type="number" min="0" max="${left}" value="${can > 0 ? can : 0}" data-rel="${l.id}" ${left ? '' : 'disabled'}></td></tr>`; }).join('');
    const wrap = UI.modal('Process ' + UI.esc(rq.request_ref), `<p class="small text-muted">Truck ${UI.esc(rq.plate_number)} · ${UI.esc(rq.purpose)}. Release what is in stock; the inventory is updated automatically.</p>
      <table class="data-table"><thead><tr><th>Part</th><th class="num">Requested</th><th class="num">Released</th><th class="num">On hand</th><th>Release now</th></tr></thead><tbody>${rows}</tbody></table>
      ${UI.fields([{ name: 'notes', label: 'Notes', col: 12 }])}`,
      async (x, form) => { const release = [...form.querySelectorAll('[data-rel]')].map(i => ({ line_id: i.dataset.rel, qty: +i.value || 0 }));
        const res = await App.api('Purchasing.request_process', { request_id: rq.id, release, notes: x.notes }); UI.result(res); App.route(); },
      { submit: 'Release parts', extraFooter: '<button type="button" class="btn btn-outline-danger btn-sm me-auto" data-na>Not available (no stock)</button>' });
    wrap.querySelector('[data-na]').onclick = async () => { if (!await UI.confirmProceed('Confirm no stock', 'Mark this parts request as not available because the required stock is unavailable?', 'Confirm not available')) return; try { const res = await App.api('Purchasing.request_process', { request_id: rq.id, not_available: 1 }); UI.result(res); bootstrap.Modal.getInstance(wrap).hide(); App.route(); } catch (e) { UI.toast(e.message, 'error'); } };
  },
  async printRequest(rq) {
    const r = await App.api('Purchasing.request_details', { request_id: rq.id }); const q = r.request;
    UI.printForm('REQUEST FORM', `<div class="pf-grid"><div><b>Truck No. / Trailer No.:</b> ${UI.esc(q.plate_number)}${q.truck_number ? ' #' + UI.esc(q.truck_number) : ''}</div><div><b>DATE:</b> ${UI.date(q.created_at)}</div>
      <div><b>Model No. / Engine No.:</b> ${UI.esc([q.make_brand, q.engine_number].filter(Boolean).join(' / '))}</div><div><b>Series No.:</b> ${UI.esc(q.request_ref)}</div></div>
      <div class="mt-1"><b>PARTICULARS</b></div><table><thead><tr><th style="width:12%">ITEM NO.</th><th>ITEMS / DESCRIPTION</th><th class="num" style="width:12%">QTY.</th><th style="width:12%">UNIT</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${UI.esc(l.description)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td></tr>`).join('')}${UI.pfBlank(4, r.lines.length, 12)}
      <tr><th colspan="2">TOTAL</th><th class="num">${r.lines.reduce((a, l) => a + +l.quantity, 0)}</th><th></th></tr></tbody></table>
      <div><b>Reason / Purpose:</b> ${UI.esc(q.purpose)}${q.job_ref ? ' (' + UI.esc(q.job_ref) + ')' : ''}</div>
      <div class="pf-signs">${UI.sign('Requested by', q.requested_by_name, q.requested_by, 'part_request', q.id)}${UI.sign('Received by', q.processed_by_name || '', q.processed_by, 'part_request', q.id)}${UI.sign('Approved by')}</div>`, { number: q.request_ref });
  },
  async printPO(o) {
    const r = await App.api('Purchasing.po_details', { po_id: o.id }); const p = r.po;
    const approved = ['Approved', 'Partially Received', 'Received', 'Closed'].includes(p.status);
    UI.printForm('PURCHASE ORDER', `<div class="pf-grid"><div><b>SUPPLIER:</b> ${UI.esc(p.supplier)}</div><div><b>DATE:</b> ${UI.date(p.created_at)}</div>
      <div><b>ADDRESS:</b> ${UI.esc(p.supplier_address || '')}</div><div><b>CONTACT:</b> ${UI.esc([p.supplier_contact, p.supplier_phone, p.supplier_email].filter(Boolean).join(' · '))}</div>
      <div style="grid-column:1/3"><b>PURPOSE:</b> ${UI.esc(p.purpose)}${p.request_ref ? ' (from ' + UI.esc(p.request_ref) + ')' : ''}</div></div>
      <table><thead><tr><th>Part no.</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${UI.esc(l.description)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td><td class="num">${UI.money(l.unit_price)}</td><td class="num">${UI.money(l.line_total)}</td></tr>`).join('')}${UI.pfBlank(6, r.lines.length, 8)}
      <tr><th colspan="5">TOTAL</th><th class="num">${UI.money(p.total_amount)}</th></tr></tbody></table>
      <div class="pf-note">Status: ${UI.esc(p.status)}${approved ? ' · Approved by ' + UI.esc(p.decided_by_name) + ' (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ') on ' + UI.datetime(p.decided_at) + '. Budget reserved by the system.' : ' · NOT APPROVED — do not use for purchasing.'}</div>
      <div class="pf-signs">${UI.sign('Requested by (Purchasing Officer)', p.requested_by_name, p.requested_by, 'purchase_order', p.id)}${UI.sign('Approved by (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ')' + (approved ? ' · approved in the system' : ''), approved ? p.decided_by_name : '', approved ? p.decided_by : null, 'purchase_order', p.id)}</div>`, { number: p.po_ref });
  },
  async receive(o) {
    const r = await App.api('Purchasing.po_details', { po_id: o.id });
    const rows = r.lines.map(l => { const left = l.quantity - l.received_qty;
      return `<tr><td>${UI.esc(l.part_number)}<div class="small text-muted">${UI.esc(l.description)}</div></td><td class="num">${l.quantity}</td><td class="num">${l.received_qty}</td>
        <td><input class="form-control form-control-sm" type="number" min="0" max="${left}" value="${left}" data-rcv="${l.id}" ${left ? '' : 'disabled'}></td></tr>`; }).join('');
    UI.modal('Receive parts for ' + UI.esc(o.po_ref), `<p class="small text-muted">Check the actual parts and quantities against the approved PO. Enter only what arrived; a short delivery stays "Partially Received".</p>
      <table class="data-table"><thead><tr><th>Part</th><th class="num">Ordered</th><th class="num">Received</th><th>Received now</th></tr></thead><tbody>${rows}</tbody></table>
      ${UI.fields([{ name: 'supplier_invoice_no', label: 'Supplier invoice / delivery receipt no.', col: 6 }, { name: 'receipt', label: 'Delivery receipt / invoice file (optional)', type: 'file', col: 6 }])}`,
      async (x, form) => { const receive = [...form.querySelectorAll('[data-rcv]')].map(i => ({ line_id: i.dataset.rcv, qty: +i.value || 0 }));
        const res = await App.apiForm('Purchasing.po_receive', { po_id: o.id, receive, supplier_invoice_no: x.supplier_invoice_no }, form); UI.result(res); App.route(); }, { submit: 'Record received parts' });
  },
};


/** Row actions and forms shared by the Purchasing pages (Purchasing Officer acts, Finance/Admin approve, Admin/Audit read). */
PurUI.kit = (d, can) => {
    // STAGE_B_PURCHASING_UI: one action list per record, shown as icon buttons in table rows and as labelled buttons
    // in the details drawer (big = true). Only actions the role and the record's status allow are listed.
    const act = (big) => (key, label, icon, cls) => big ? UI.btn(key, label, cls, icon) : UI.ibtn(key, label, icon, cls);
    const reqActs = (r, big) => { const a = act(big);
      return (can.stock && ['Requested', 'Partially Released', 'Not Available'].includes(r.status) ? a('process', 'Process request (check stock and release)', 'bi-box-arrow-up', 'primary') : '')
      + (can.stock && ['Not Available', 'Partially Released'].includes(r.status) ? a('po', 'Create PO for the shortage', 'bi-cart-plus', 'outline-primary') : '')
      + a('print', 'Print request form', 'bi-printer', 'outline-secondary'); };
    const reqAct = async (a, r) => {
      if (a === 'print') PurUI.printRequest(r);
      if (a === 'process') PurUI.processRequest(r);
      if (a === 'po') { const x = await App.api('Purchasing.request_details', { request_id: r.id });
        PurUI.newPO({ part_request_id: r.id, purpose: 'Parts for ' + r.plate_number + ' (' + r.request_ref + ')', lines: x.lines.filter(l => l.quantity - l.released_qty > 0).map(l => ({ part_id: l.part_id, quantity: l.quantity - l.released_qty, unit_price: (d.parts.find(p => p.id == l.part_id) || {}).unit_cost })) }); }
    };
    const poActs = (o, big) => {
      const a = act(big); let h = '';
      if (o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig))) h += a('approve', 'Approve PO', 'bi-check-lg', 'success') + a('reject', 'Reject PO', 'bi-x-lg', 'outline-danger');
      if (can.stock && ['Approved', 'Partially Received'].includes(o.status)) h += a('receive', 'Receive items', 'bi-box-arrow-in-down', 'primary') + (big ? a('close', 'Close balance (no further delivery)', 'bi-slash-circle', 'outline-secondary') : '');
      return h + a('print', 'Print PO', 'bi-printer', 'outline-secondary');
    };
    const poAct = (a, o) => {
      if (a === 'print') PurUI.printPO(o);
      if (a === 'approve') UI.confirmAction('Approve ' + UI.esc(o.po_ref), `Approve ${UI.money(o.total_amount)} to ${UI.esc(o.supplier)}? The system checks the purchasing budget and reserves the amount; if the budget is not enough the PO is rejected automatically.`
        + (App.me.user.has_signature ? '' : '<div class="small text-warning mt-2">You have no e-signature yet (name menu > My e-signature). Your name is printed instead.</div>'), 'Purchasing.po_decide', { po_id: o.id, decision: 'approve' }, { submit: 'Approve' });
      if (a === 'reject') UI.confirmAction('Reject ' + UI.esc(o.po_ref), 'The Purchasing Officer will be notified.', 'Purchasing.po_decide', { po_id: o.id, decision: 'reject' }, { danger: true, fields: [{ name: 'notes', label: 'Reason', required: true, col: 12 }] });
      if (a === 'receive') PurUI.receive(o);
      if (a === 'close') UI.confirmAction('Close ' + UI.esc(o.po_ref), 'Use this when the rest of the order will not be delivered. The reserved budget of the undelivered items is released.', 'Purchasing.po_close', { po_id: o.id }, { fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
    };
    const partActs = (p, big) => { const a = act(big); return can.stock ? a('adjust', 'Adjust stock', 'bi-plus-slash-minus', 'outline-primary') + a('edit', 'Edit part', 'bi-pencil', 'outline-secondary') : ''; };
    const partForm = (p = {}) => UI.formModal(p.id ? 'Edit part ' + UI.esc(p.part_number) : 'Add part', [
      { name: 'part_number', label: 'Part no. / ID', required: true, col: 4, value: p.part_number }, { name: 'description', label: 'Description', required: true, col: 8, value: p.description },
      { name: 'category', label: 'Category', col: 4, value: p.category }, { name: 'unit', label: 'Unit', required: true, col: 4, value: p.unit || 'pc' }, { name: 'unit_cost', label: 'Unit cost', type: 'money', required: true, col: 4, value: p.unit_cost },
      { name: 'reorder_level', label: 'Reorder level (low-stock alert)', type: 'number', required: true, col: 4, value: p.reorder_level ?? 0 }, { name: 'warranty_info', label: 'Warranty', col: 4, value: p.warranty_info },
      ...(p.id ? [] : [{ name: 'opening_qty', label: 'Opening quantity on hand', type: 'number', col: 4, value: 0 }])], 'Purchasing.part_save', { extra: p.id ? { id: p.id } : {} });
    const partAct = (a, p) => a === 'edit' ? partForm(p) : UI.formModal('Adjust stock of ' + UI.esc(p.part_number), [
      { name: 'quantity_delta', label: 'Quantity to add (+) or remove (-)', type: 'number', min: -100000, required: true, col: 6 }, { name: 'reason', label: 'Reason (count correction, damaged, ...)', required: true, col: 6 }],
      'Purchasing.adjust', { extra: { part_id: p.id }, intro: 'On hand now: ' + p.quantity_on_hand + ' ' + UI.esc(p.unit) + '.' });
  return { reqActs, reqAct, poActs, poAct, partActs, partForm, partAct };
};

/** Page toolbar button. */
PurUI.tool = (ctx, label, icon, fn, cls = 'btn-primary') => { const b = document.createElement('button'); b.className = 'btn btn-sm ' + cls; b.innerHTML = `<i class="bi ${icon}"></i> ${label}`; b.onclick = fn; ctx.tools.append(b); };
PurUI.prep = (ctx) => { PurUI.data = ctx.data; return { d: ctx.data, can: ctx.data.can, k: PurUI.kit(ctx.data, ctx.data.can) }; };
PurUI.waitingForMe = (d, can) => (d.orders || []).filter(o => o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig)));

/* STAGE_B_PURCHASING_UI — who has the next step, derived only from the stored statuses and the approval routing
   (approver_role) of each record. No employee is named; the responsible role is the one the workflow rules assign. */
PurUI.poNext = (o) => {
  const due = Math.max(0, (+o.received_value || 0) - (+o.paid_amount || 0));
  if (o.status === 'Pending Approval') return o.approver_role === 'finance' ? ['finance', 'Finance', 'Approve or reject'] : ['admin', 'Admin', 'Approve or reject'];
  if (['Approved', 'Partially Received'].includes(o.status)) return ['purchasing', 'Purchasing', due > 0 ? 'Receive the rest (Finance can pay ' + UI.money(due) + ' received)' : 'Receive delivered items'];
  if (['Pending Payment', 'Partially Paid'].includes(o.payment_status) && due > 0) return ['finance', 'Finance', 'Record payment of ' + UI.money(due)];
  if (/^Rejected/.test(o.status)) return [null, 'No one', 'Rejected: create a new PO if still needed'];
  return [null, 'Completed', o.payment_status === 'Paid' ? 'Received and paid' : 'Closed'];
};
PurUI.reqNext = (r) => {
  const pos = r.linked_pos || '';
  const openPo = /\((Pending Approval|Approved|Partially Received)\)/.test(pos);
  if (r.status === 'Requested') return ['purchasing', 'Purchasing', 'Check stock and release'];
  if (['Partially Released', 'Not Available'].includes(r.status)) return openPo ? ['purchasing', 'Purchasing', 'Waiting for the linked PO delivery, then release'] : ['purchasing', 'Purchasing', 'Release from stock or create a PO for the shortage'];
  return [null, 'Completed', r.status === 'Released' ? 'All parts released' : 'Cancelled'];
};
PurUI.chip = ([role, who]) => {
  const me = role && UI.role(role);
  return `<span class="wait-chip ${role ? (me ? 'is-you' : '') : 'is-done'}"><i class="bi ${role ? 'bi-person-workspace' : 'bi-check2'}" aria-hidden="true"></i>${UI.esc(me ? 'You (' + who + ')' : who)}</span>`;
};
PurUI.nextBox = (n) => `<div class="ws-next ${n[0] ? '' : 'is-done'}"><i class="bi ${n[0] ? 'bi-arrow-right-circle' : 'bi-check-circle'}" aria-hidden="true"></i><div><b>${n[0] ? 'Waiting for ' + UI.esc(n[1]) : UI.esc(n[1])}</b><div>${UI.esc(n[2])}</div></div></div>`;
PurUI.timeline = (rows) => (rows || []).length ? `<ul class="ws-timeline">${rows.map(h => `<li><b>${UI.esc(h.action.charAt(0).toUpperCase() + h.action.slice(1))}</b> · ${UI.esc(h.actor)}<div class="tl-when">${UI.datetime(h.created_at)}</div>${h.details ? `<div class="cell-sub">${UI.esc(h.details)}</div>` : ''}</li>`).join('')}</ul>` : '<div class="text-muted small">No activity recorded.</div>';
PurUI.bar = (done, total) => `${UI.num(done)} / ${UI.num(total)}<span class="qty-bar" aria-hidden="true"><span style="width:${total ? Math.min(100, Math.round(done / total * 100)) : 0}%"></span></span>`;
PurUI.bindDrawerActions = (root, row, onAct) => root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { UI.closeDrawer(); onAct(b.dataset.act, row); }));

/** Parts request drawer: summary, next step, lines (requested / released / outstanding / on hand), linked POs, activity. */
PurUI.openRequest = async (r, k) => {
  const x = await App.api('Purchasing.request_details', { request_id: r.id }); const q = x.request;
  const lines = x.lines.map(l => ({ ...l, outstanding: Math.max(0, l.quantity - l.released_qty) }));
  const short = lines.filter(l => l.outstanding > 0 && l.outstanding > (+l.quantity_on_hand || 0)).length;
  const html = `${PurUI.nextBox(PurUI.reqNext({ ...r, status: q.status }))}
    ${UI.kv([['Status', UI.badge(q.status)], ['Truck', UI.e(q.plate_number) + (q.truck_number ? ' · ' + UI.esc(q.truck_number) : '')], ['Repair', UI.e(q.job_ref)], ['Purpose', UI.e(q.purpose)],
      ['Requested', UI.esc(q.requested_by_name) + ' · ' + UI.datetime(q.created_at)], ['Processed', q.processed_at ? UI.esc(q.processed_by_name || '') + ' · ' + UI.datetime(q.processed_at) : 'Not processed yet'],
      q.notes ? ['Notes', UI.esc(q.notes)] : null])}
    ${UI.h('Parts', short ? `<span class="badge-s red">${short} line(s) short in stock</span>` : '')}
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Part</th><th class="count-col">Requested</th><th class="count-col">Released</th><th class="count-col">Outstanding</th><th class="count-col">On hand</th></tr></thead>
    <tbody>${lines.map(l => `<tr><td><b>${UI.esc(l.part_number)}</b><div class="cell-sub">${UI.esc(l.description)}</div></td><td class="count-col">${UI.num(l.quantity)}</td><td class="count-col">${UI.num(l.released_qty)}</td>
      <td class="count-col">${l.outstanding ? `<b>${UI.num(l.outstanding)}</b>` : '0'}</td><td class="count-col">${UI.num(l.quantity_on_hand)} ${UI.esc(l.unit)}</td></tr>`).join('')}</tbody></table></div>
    ${UI.h('Linked purchase orders')}${(x.orders || []).length ? `<ul class="ws-trucks">${x.orders.map(o => `<li class="${UI.canGo('purchase_orders') ? 'clickable' : ''}" data-po="${o.id}" tabindex="0"><span><b>${UI.esc(o.po_ref)}</b> · ${UI.esc(o.supplier || '')}<div class="cell-sub">${UI.date(o.created_at)} · ${UI.money(o.total_amount)}</div></span><span>${UI.badge(o.status)} ${o.payment_status ? UI.badge(o.payment_status) : ''}</span></li>`).join('')}</ul>` : '<div class="text-muted small">No purchase order is linked to this request.</div>'}
    ${UI.h('Activity')}${PurUI.timeline(x.history)}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.reqActs(r, true)}</div>`;
  const el = UI.drawer(UI.esc(q.request_ref), html, { subtitle: 'Parts request · ' + UI.esc(q.plate_number) });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  root.querySelectorAll('[data-po]').forEach(li => li.addEventListener('click', () => { if (UI.canGo('purchase_orders')) { UI.closeDrawer(); App.go('purchase_orders', { open: li.dataset.po }); } }));
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), r, k.reqAct);
};

/** Purchase order drawer: supplier, amounts (total / received / paid / balance), line progress, payments, documents, activity. */
PurUI.openPO = async (o, k) => {
  const x = await App.api('Purchasing.po_details', { po_id: o.id }); const p = x.po;
  const received = x.lines.reduce((a, l) => a + l.received_qty * l.unit_price, 0);
  const row = { ...o, ...p, received_value: received };
  const html = `${PurUI.nextBox(PurUI.poNext(row))}
    ${UI.kv([['Status', UI.badge(p.status) + (p.payment_status ? ' ' + UI.badge(p.payment_status) : '')], ['Supplier', `<b>${UI.esc(p.supplier)}</b>` + [p.supplier_contact, p.supplier_phone, p.supplier_email].filter(Boolean).map(v => `<div class="cell-sub">${UI.esc(v)}</div>`).join('') + (p.supplier_address ? `<div class="cell-sub">${UI.esc(p.supplier_address)}</div>` : '')],
      ['Purpose', UI.e(p.purpose)], ['Parts request', p.request_ref ? UI.esc(p.request_ref) : 'Not linked'],
      ['Requested', UI.esc(p.requested_by_name) + ' · ' + UI.datetime(p.created_at)],
      ['Approval', (p.approver_role === 'finance' ? 'Finance' : 'Admin') + (p.decided_at ? ' · ' + UI.esc(p.decided_by_name || 'System') + ' · ' + UI.datetime(p.decided_at) : ' · not decided yet') + (p.decision_notes ? `<div class="cell-sub">${UI.esc(p.decision_notes)}</div>` : '')],
      p.supplier_invoice_no ? ['Supplier invoice', UI.esc(p.supplier_invoice_no)] : null])}
    ${UI.h('Amounts')}${UI.kv([['PO total', UI.money(p.total_amount)], ['Received value', UI.money(received)], ['Paid', UI.money(p.paid_amount)], ['Received, not yet paid', UI.money(Math.max(0, received - p.paid_amount))]])}
    ${UI.h('Items')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Part</th><th>Received / ordered</th><th class="money-col">Unit price</th><th class="money-col">Amount</th></tr></thead>
    <tbody>${x.lines.map(l => `<tr><td><b>${UI.esc(l.part_number)}</b><div class="cell-sub">${UI.esc(l.description)}</div></td><td class="cell-nowrap">${PurUI.bar(+l.received_qty, +l.quantity)} ${UI.esc(l.unit)}</td><td class="money-col">${UI.money(l.unit_price)}</td><td class="money-col">${UI.money(l.line_total)}</td></tr>`).join('')}</tbody></table></div>
    ${(x.payments || []).length ? UI.h('Payments') + UI.table([['Voucher', 'voucher_number'], ['Released', 'released_on', 'date'], ['Method', 'payment_method'], ['Amount', 'amount', 'money']], x.payments, { plain: true }) : ''}
    ${UI.h('Documents')}${UI.docs(x.documents)}
    ${UI.h('Activity')}${PurUI.timeline(x.history)}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.poActs(row, true)}</div>`;
  const el = UI.drawer(UI.esc(p.po_ref), html, { subtitle: 'Purchase order · ' + UI.esc(p.supplier) });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), row, k.poAct);
};

/** Part drawer: stock figures, 90-day usage and the last 50 movements with their PO / request references. */
PurUI.openPart = async (pt, k) => {
  const x = await App.api('Purchasing.part_history', { part_id: pt.id }); const p = x.part;
  const html = `${UI.kv([['Description', UI.esc(p.description)], ['Category', UI.e(p.category)], ['On hand', `<b>${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)}</b>` + (+p.reorder_level > 0 && +p.quantity_on_hand <= +p.reorder_level ? ' <span class="badge-s red">Low stock</span>' : '')],
      ['Reorder level', UI.num(p.reorder_level)], ['Unit cost', UI.money(p.unit_cost)], ['Stock value', UI.money(p.stock_value)], ['Issued, last 90 days', UI.num(x.usage.issued_90d) + ' ' + UI.esc(p.unit) + ' in ' + UI.num(x.usage.issues_90d) + ' release(s)'],
      p.warranty_info ? ['Warranty', UI.esc(p.warranty_info)] : null])}
    ${UI.h('Stock movements (latest 50)')}${UI.table([['Date and time', 'created_at', 'datetime'], ['Type', 'movement_type', 'badge'], ['Qty', 'quantity_delta', (v) => (v > 0 ? '+' : '') + UI.num(v)], ['Reference', 'reference', (v, m) => UI.e(v || m.reason)], ['Truck', 'plate_number'], ['By', 'actor']], x.movements, { plain: true, limit: 10, empty: 'No stock movement recorded.' })}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.partActs(pt, true)}</div>`;
  const el = UI.drawer(UI.esc(p.part_number), html, { subtitle: 'Inventory part' });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), pt, k.partAct);
};

/** Opens the record named by ?open=<id> once (links from the Overview, notifications and other drawers). */
PurUI.openFromQuery = (ctx, rows, fn) => { const o = UI.takeQuery(ctx, 'open').open; if (!o) return; const r = rows.find(x => String(x.id) === String(o)); if (r) fn(r); else UI.toast('That record is not in this list.', 'warn'); };
/** Short attention-list panel used by the Purchasing Overview (same look as the Maintenance Overview lists). */
PurUI.list = (title, icon, items, empty, more) => `<section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi ${icon} me-1" aria-hidden="true"></i>${UI.esc(title)} <span class="text-muted fw-normal">(${items.length})</span></h2>${more ? `<div class="panel-tools"><button type="button" class="btn btn-link btn-sm p-0" data-go="${UI.esc(more)}">View all</button></div>` : ''}</div>
  <div class="panel-body flush">${items.length ? `<ul class="mo-list mo-scroll">${items.join('')}</ul>` : `<div class="mo-empty">${UI.esc(empty)}</div>`}</div></section>`;
PurUI.item = (go, top, sub, side) => `<li class="mo-item clickable" data-go="${UI.esc(go)}" role="link" tabindex="0"><div class="mo-item-main"><div class="mo-item-top">${top}</div>${sub ? `<div class="mo-item-issue">${sub}</div>` : ''}</div><div class="mo-item-side">${side}</div></li>`;

// ---------------------------------------------------------------- Purchasing Overview (landing page of the Purchasing Officer)
App.page('purchasing_overview', {
  title: 'Purchasing Overview',
  subtitle: 'What needs action now: parts requests, purchase orders, low stock and the purchasing budget.',
  render(ctx) {
    const { d } = PurUI.prep(ctx), c = d.counts || {}, n = (k) => +c[k] || 0, b = d.budget || {}, pay = d.payments || {};
    const expired = b.id && !+b.in_period;
    const tiles = [
      { label: 'Requests to process', value: n('requests_open'), note: 'new parts requests from Motorpool', icon: 'bi-box-arrow-up', tone: n('requests_open') ? 'amber' : 'gray', go: 'parts_requests?tab=todo' },
      { label: 'Requests to follow up', value: n('requests_followup'), note: 'partially released or not available', icon: 'bi-arrow-repeat', tone: n('requests_followup') ? 'amber' : 'gray', go: 'parts_requests?tab=followup' },
      { label: 'POs awaiting approval', value: n('po_pending'), note: 'with Finance or Admin', icon: 'bi-hourglass-split', tone: n('po_pending') ? 'blue' : 'gray', go: 'purchase_orders?tab=approval' },
      { label: 'POs to receive', value: n('po_to_receive'), note: 'approved, delivery not complete', icon: 'bi-truck', tone: n('po_to_receive') ? 'blue' : 'gray', go: 'purchase_orders?tab=receive' },
      { label: 'Low-stock parts', value: n('low_stock'), note: 'at or below the reorder level', icon: 'bi-exclamation-triangle', tone: n('low_stock') ? 'red' : 'gray', go: 'inventory?stock=low' },
      { label: 'Inventory value', value: UI.money(n('inventory_value')), note: 'on hand × unit cost, active parts', icon: 'bi-boxes', tone: 'green', go: 'inventory' },
    ];
    PurUI.tool(ctx, 'New purchase order', 'bi-cart-plus', () => App.go('purchase_orders', { new: 1 }), 'btn-primary');
    const reqItems = (d.requests || []).map(r => PurUI.item('parts_requests?open=' + r.id, `<b>${UI.esc(r.request_ref)}</b> <span class="mo-ref">${UI.esc(r.plate_number)}${r.job_ref ? ' · ' + UI.esc(r.job_ref) : ''}</span>`, UI.esc(r.items || ''), UI.badge(r.status) + `<span class="mo-ref">${UI.date(r.created_at)}</span>`));
    const rcvItems = (d.receiving || []).map(o => PurUI.item('purchase_orders?open=' + o.id, `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`, UI.money(o.total_amount), UI.badge(o.status)));
    const aprItems = (d.approvals || []).map(o => PurUI.item('purchase_orders?open=' + o.id, `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')} · ${UI.money(o.total_amount)}</span>`,
      o.status === 'Pending Approval' ? 'Waiting for ' + (o.approver_role === 'finance' ? 'Finance' : 'Admin') + ' since ' + UI.date(o.created_at) : 'Rejected for insufficient budget on ' + UI.date(o.decided_at), UI.badge(o.status)));
    const lowItems = (d.lowStock || []).map(p => PurUI.item('inventory?open=' + p.id, `<b>${UI.esc(p.part_number)}</b> <span class="mo-ref">${UI.esc(p.description)}</span>`,
      `On hand ${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)} · reorder level ${UI.num(p.reorder_level)}`, `<span class="badge-s red">Reorder</span>`));
    const used = b.id ? (+b.spent_amount + +b.reserved_amount) : 0, pct = (v) => b.id && +b.amount ? Math.min(100, v / b.amount * 100).toFixed(1) : 0;
    const budget = `<section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi bi-piggy-bank me-1" aria-hidden="true"></i>Purchasing budget</h2></div><div class="panel-body">
      ${b.id ? `<div class="d-flex justify-content-between flex-wrap gap-1"><span><b>${UI.money(b.available)}</b> available</span><span class="text-muted small">${UI.date(b.period_start)} – ${UI.date(b.period_end)}</span></div>
        <div class="ws-budget-meter" role="img" aria-label="Spent ${pct(b.spent_amount)} percent, reserved ${pct(b.reserved_amount)} percent"><span class="m-spent" style="width:${pct(b.spent_amount)}%"></span><span class="m-res" style="width:${pct(b.reserved_amount)}%"></span></div>
        <div class="ws-legend"><span><i style="background:var(--blue)"></i>Paid ${UI.money(b.spent_amount)}</span><span><i style="background:var(--amber)"></i>Reserved by approved POs ${UI.money(b.reserved_amount)}</span><span>Budget ${UI.money(b.amount)}</span></div>
        ${expired ? '<div class="alert alert-warning py-1 px-2 mt-2 mb-0 small">The budget period has ended. Finance must set a new purchasing budget before new POs can be approved.</div>' : ''}
        ${+b.amount && used / b.amount >= 0.8 ? `<div class="alert alert-warning py-1 px-2 mt-2 mb-0 small">${Math.round(used / b.amount * 100)}% of the budget is paid or reserved (alert at 80%).</div>` : ''}`
      : '<div class="text-muted">No active purchasing budget. POs cannot be approved until Finance sets one.</div>'}
      <div class="ws-foot">Payment status: ${UI.num(pay.n || 0)} PO(s) with received items not fully paid${+pay.due ? ' · ' + UI.money(pay.due) + ' for Finance to pay' : ''}.</div></div></section>`;
    ctx.el.innerHTML = `<div class="maint-overview mp-ws">${UI.kpiTiles(tiles)}
      <div class="mo-grid"><div class="mo-main">
        ${PurUI.list('Parts requests to act on', 'bi-box-arrow-up', reqItems, 'No parts request is waiting.', 'parts_requests?tab=todo')}
        ${PurUI.list('Purchase orders to receive', 'bi-truck', rcvItems, 'No approved purchase order is waiting for delivery.', 'purchase_orders?tab=receive')}
      </div><div class="mo-side">${budget}
        ${PurUI.list('Approvals and budget rejections', 'bi-hourglass-split', aprItems, 'No PO is waiting for approval.', 'purchase_orders?tab=approval')}
        ${PurUI.list('Reorder suggestions', 'bi-exclamation-triangle', lowItems, 'No part is at or below its reorder level.', 'inventory?stock=low')}
      </div></div></div>`;
  },
});

// ---------------------------------------------------------------- Parts Requests (stock-out)
App.page('parts_requests', {
  title: 'Parts Requests',
  subtitle: 'Release parts from stock for Motorpool repair requests; create a purchase order for any shortage.',
  render(ctx) {
    const { d, k } = PurUI.prep(ctx), q = ctx.query, all = d.requests || [];
    const TABS = { todo: ['To process', r => r.status === 'Requested'], followup: ['Follow up', r => ['Partially Released', 'Not Available'].includes(r.status)],
      released: ['Released', r => r.status === 'Released'], cancelled: ['Cancelled', r => r.status === 'Cancelled'], all: ['All', () => true] };
    const tab = TABS[q.tab] ? q.tab : 'todo';
    const cnt = (t) => all.filter(TABS[t][1]).length;
    const trucks = [...new Set(all.map(r => r.plate_number))].sort();
    const rows = all.filter(TABS[tab][1]).filter(r => (!q.truck || r.plate_number === q.truck) && (!q.po || (q.po === 'linked' ? !!r.linked_pos : !r.linked_pos)));
    ctx.el.innerHTML = `${UI.crumb('purchasing_overview', 'Purchasing Overview')}${UI.kpiTiles([
      { label: 'To process', value: cnt('todo'), note: 'new requests', icon: 'bi-inbox', tone: cnt('todo') ? 'amber' : 'gray', go: 'parts_requests?tab=todo' },
      { label: 'Follow up', value: cnt('followup'), note: 'partially released or not available', icon: 'bi-arrow-repeat', tone: cnt('followup') ? 'amber' : 'gray', go: 'parts_requests?tab=followup' },
      { label: 'Released', value: cnt('released'), note: 'all parts issued', icon: 'bi-check2-circle', tone: 'green', go: 'parts_requests?tab=released' }])}
      <div class="line-tabs no-print" role="tablist">${Object.entries(TABS).map(([key, [label]]) => `<button type="button" role="tab" class="tab ${key === tab ? 'active' : ''}" data-go="parts_requests?${new URLSearchParams({ ...q, tab: key })}">${label} <span class="text-muted">${cnt(key)}</span></button>`).join('')}</div>
      ${UI.generalFilters(ctx, [{ name: 'truck', label: 'Trucks', options: trucks }, { name: 'po', label: 'PO link', all: 'With or without PO', options: [['linked', 'Has a linked PO'], ['none', 'No linked PO']] }])}`;
    const box = document.createElement('div'); ctx.el.append(box);
    const open = (r) => PurUI.openRequest(r, k);
    box.innerHTML = UI.table([
      ['Request', 'request_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(r.created_at)}</div>`],
      ['Truck / repair', 'plate_number', (v, r) => `${UI.esc(v)}${r.job_ref ? `<div class="cell-sub">${UI.esc(r.job_ref)}</div>` : ''}`],
      ['Parts', 'items', (v) => `<span class="cell-clamp" title="${UI.esc(v)}">${UI.esc(v)}</span>`],
      ['Released', 'released_units', (v, r) => `<span class="cell-nowrap">${PurUI.bar(+v, +r.requested_units)}</span>`],
      ['Status', 'status', 'badge'],
      ['Waiting for', 'status', (v, r) => { const n = PurUI.reqNext(r); return PurUI.chip(n) + `<div class="cell-sub">${UI.esc(n[2])}</div>`; }],
      ['Linked PO', 'linked_pos', (v) => v ? `<span class="cell-clamp">${UI.esc(v)}</span>` : '<span class="text-muted">None</span>']], rows,
      { title: TABS[tab][0] + ' (' + rows.length + ')', showAllColumns: true, directActions: true, actions: (r) => k.reqActs(r), onAction: k.reqAct, rowClick: open,
        empty: 'No parts request in this list.' });
    PurUI.openFromQuery(ctx, all, open);
  },
});

// ---------------------------------------------------------------- Purchase Orders (stock-in)
App.page('purchase_orders', {
  title: 'Purchase Orders',
  subtitle: 'Approval, receiving and payment status of every purchase order.',
  render(ctx) {
    const { d, can, k } = PurUI.prep(ctx), q = ctx.query, all = d.orders || [];
    if (can.stock) PurUI.tool(ctx, 'New purchase order', 'bi-cart-plus', () => PurUI.newPO());
    const TABS = { approval: ['Awaiting approval', o => o.status === 'Pending Approval'], receive: ['To receive', o => ['Approved', 'Partially Received'].includes(o.status)],
      payment: ['Awaiting payment', o => ['Pending Payment', 'Partially Paid'].includes(o.payment_status) && (+o.received_value || 0) > (+o.paid_amount || 0)],
      done: ['Completed', o => ['Received', 'Closed'].includes(o.status) && !(['Pending Payment', 'Partially Paid'].includes(o.payment_status))],
      rejected: ['Rejected', o => /^Rejected/.test(o.status)], all: ['All', () => true] };
    const mine = PurUI.waitingForMe(d, can);
    const tab = TABS[q.tab] ? q.tab : (mine.length ? 'approval' : (can.stock ? 'receive' : 'all'));
    const cnt = (t) => all.filter(TABS[t][1]).length;
    const suppliers = [...new Set(all.map(o => o.supplier).filter(Boolean))].sort();
    const rows = all.filter(TABS[tab][1]).filter(o => (!q.supplier || o.supplier === q.supplier) && (!q.payment || o.payment_status === q.payment));
    ctx.el.innerHTML = `${UI.crumb('purchasing_overview', 'Purchasing Overview')}${UI.kpiTiles([
      { label: 'Awaiting approval', value: cnt('approval'), note: mine.length ? mine.length + ' waiting for you' : 'with Finance or Admin', icon: 'bi-hourglass-split', tone: cnt('approval') ? 'blue' : 'gray', go: 'purchase_orders?tab=approval' },
      { label: 'To receive', value: cnt('receive'), note: 'approved, delivery not complete', icon: 'bi-truck', tone: cnt('receive') ? 'blue' : 'gray', go: 'purchase_orders?tab=receive' },
      { label: 'Awaiting payment', value: cnt('payment'), note: 'received items not fully paid', icon: 'bi-cash-stack', tone: cnt('payment') ? 'amber' : 'gray', go: 'purchase_orders?tab=payment' },
      { label: 'Rejected', value: cnt('rejected'), note: 'by the approver or for budget', icon: 'bi-x-octagon', tone: cnt('rejected') ? 'red' : 'gray', go: 'purchase_orders?tab=rejected' }])}
      <div class="line-tabs no-print" role="tablist">${Object.entries(TABS).map(([key, [label]]) => `<button type="button" role="tab" class="tab ${key === tab ? 'active' : ''}" data-go="purchase_orders?${new URLSearchParams({ ...q, tab: key })}">${label} <span class="text-muted">${cnt(key)}</span></button>`).join('')}</div>
      ${UI.generalFilters(ctx, [{ name: 'supplier', label: 'Suppliers', options: suppliers }, { name: 'payment', label: 'Payment statuses', options: [...new Set(all.map(o => o.payment_status).filter(Boolean))].sort() }])}`;
    const box = document.createElement('div'); ctx.el.append(box);
    const open = (o) => PurUI.openPO(o, k);
    box.innerHTML = UI.table([
      ['PO', 'po_ref', (v, o) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(o.created_at)}</div>`],
      ['Supplier', 'supplier', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`],
      ['Total', 'total_amount', 'money'],
      ['Received', 'received_value', 'money'],
      ['Status', 'status', 'badge'], ['Payment', 'payment_status', 'badge'],
      ['Waiting for', 'status', (v, o) => { const n = PurUI.poNext(o); return PurUI.chip(n) + `<div class="cell-sub">${UI.esc(n[2])}</div>`; }]], rows,
      { title: TABS[tab][0] + ' (' + rows.length + ')', showAllColumns: true, directActions: true, actions: (o) => k.poActs(o), onAction: k.poAct, rowClick: open,
        empty: 'No purchase order in this list.' });
    const once = UI.takeQuery(ctx, 'new');
    if (once.new && can.stock) PurUI.newPO();
    PurUI.openFromQuery(ctx, all, open);
  },
});

// ---------------------------------------------------------------- Inventory
App.page('inventory', {
  title: 'Inventory',
  subtitle: 'Parts on hand, reorder levels and stock value. Open a part to see its stock movements.',
  render(ctx) {
    const { d, can, k } = PurUI.prep(ctx), q = ctx.query;
    if (can.stock) PurUI.tool(ctx, 'Add part', 'bi-plus-lg', () => k.partForm());
    const parts = d.parts || [], active = parts.filter(p => +p.active), low = active.filter(p => +p.low_stock), out = active.filter(p => +p.quantity_on_hand <= 0);
    const cats = [...new Set(parts.map(p => p.category).filter(Boolean))].sort();
    const rows = parts.filter(p => (!q.category || p.category === q.category)
      && (!q.stock || (q.stock === 'low' ? +p.active && +p.low_stock : q.stock === 'out' ? +p.active && +p.quantity_on_hand <= 0 : q.stock === 'inactive' ? !+p.active : +p.active)));
    ctx.el.innerHTML = `${UI.crumb('purchasing_overview', 'Purchasing Overview')}${UI.kpiTiles([
      { label: 'Active parts', value: active.length, note: cats.length + ' categories', icon: 'bi-box-seam', tone: 'gray', go: 'inventory?stock=active' },
      { label: 'Inventory value', value: UI.money(active.reduce((a, p) => a + +p.stock_value, 0)), note: 'on hand × unit cost', icon: 'bi-boxes', tone: 'green' },
      { label: 'Low stock', value: low.length, note: 'at or below the reorder level', icon: 'bi-exclamation-triangle', tone: low.length ? 'red' : 'gray', go: 'inventory?stock=low' },
      { label: 'Out of stock', value: out.length, note: 'none on hand', icon: 'bi-slash-circle', tone: out.length ? 'red' : 'gray', go: 'inventory?stock=out' }])}
      ${UI.generalFilters(ctx, [{ name: 'category', label: 'Categories', options: cats }, { name: 'stock', label: 'Stock levels', all: 'All parts', options: [['active', 'Active parts'], ['low', 'Low stock'], ['out', 'Out of stock'], ['inactive', 'Inactive parts']] }])}`;
    const box = document.createElement('div'); ctx.el.append(box);
    const open = (p) => PurUI.openPart(p, k);
    box.innerHTML = UI.table([
      ['Part no.', 'part_number', (v, p) => `<b>${UI.esc(v)}</b>${+p.active ? '' : ' <span class="badge-s">Inactive</span>'}`],
      ['Description', 'description', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`], ['Category', 'category'],
      ['On hand', 'quantity_on_hand', (v, p) => `<span class="cell-nowrap">${UI.num(v)} ${UI.esc(p.unit)}${+p.low_stock ? ' <span class="badge-s red">Low</span>' : ''}</span>`],
      ['Reorder level', 'reorder_level', 'num'], ['Unit cost', 'unit_cost', 'money'], ['Stock value', 'stock_value', 'money']], rows,
      { title: 'Parts (' + rows.length + ')', showAllColumns: true, directActions: true, actions: (p) => k.partActs(p), onAction: k.partAct, rowClick: open, empty: 'No part matches.' });
    PurUI.openFromQuery(ctx, parts, open);
  },
});

// ---------------------------------------------------------------- Stock Movements
App.page('stock_movements', {
  title: 'Stock Movements',
  subtitle: 'Stock-in (PO receiving), stock-out (released parts) and adjustments. Latest 500 records.',
  render(ctx) {
    const { d } = PurUI.prep(ctx), q = ctx.query, all = d.movements || [];
    const parts = [...new Set(all.map(m => m.part_number))].sort();
    const rows = all.filter(m => (!q.type || m.movement_type === q.type) && (!q.part || m.part_number === q.part)
      && (!q.from || String(m.created_at).slice(0, 10) >= q.from) && (!q.to || String(m.created_at).slice(0, 10) <= q.to));
    const sum = (t) => rows.filter(m => m.movement_type === t).reduce((a, m) => a + Math.abs(+m.quantity_delta), 0);
    const val = (t) => rows.filter(m => m.movement_type === t).reduce((a, m) => a + Math.abs(+m.quantity_delta) * +m.unit_cost, 0);
    ctx.el.innerHTML = `${UI.crumb('purchasing_overview', 'Purchasing Overview')}${UI.kpiTiles([
      { label: 'Stock in', value: UI.num(sum('Stock In')) + ' units', note: UI.money(val('Stock In')) + ' received', icon: 'bi-box-arrow-in-down', tone: 'green', go: 'stock_movements?type=Stock In' },
      { label: 'Stock out', value: UI.num(sum('Stock Out')) + ' units', note: UI.money(val('Stock Out')) + ' released to repairs', icon: 'bi-box-arrow-up', tone: 'blue', go: 'stock_movements?type=Stock Out' },
      { label: 'Adjustments', value: rows.filter(m => m.movement_type === 'Adjustment').length, note: 'count corrections, damage, opening stock', icon: 'bi-sliders', tone: 'amber', go: 'stock_movements?type=Adjustment' }])}
      ${UI.generalFilters(ctx, [{ name: 'type', label: 'Movement types', options: [...new Set(all.map(m => m.movement_type))].sort() }, { name: 'part', label: 'Parts', options: parts },
        { name: 'from', label: 'From date', type: 'date' }, { name: 'to', label: 'To date', type: 'date' }])}
      <div class="small text-muted mb-2">Totals above follow the filters. Values use the unit cost recorded on each movement.</div>`;
    const box = document.createElement('div'); ctx.el.append(box);
    const ref = (m) => m.reference_type === 'purchase_order' ? 'purchase_orders?open=' + m.reference_id : m.reference_type === 'part_request' ? 'parts_requests?open=' + m.reference_id : '';
    box.innerHTML = UI.table([
      ['Date and time', 'created_at', 'datetime'],
      ['Part', 'part_number', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub cell-clamp">${UI.esc(m.description)}</div>`],
      ['Type', 'movement_type', 'badge'], ['Qty', 'quantity_delta', (v) => `<span class="cell-nowrap">${v > 0 ? '+' : ''}${UI.num(v)}</span>`],
      ['Reason', 'reason', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`], ['Truck', 'plate_number'], ['By', 'actor']], rows,
      { title: 'Movements (' + rows.length + ')', showAllColumns: true, directActions: true,
        actions: (m) => ref(m) && UI.canGo(ref(m)) ? UI.ibtn('ref', m.reference_type === 'purchase_order' ? 'Open purchase order' : 'Open parts request', m.reference_type === 'purchase_order' ? 'bi-cart-check' : 'bi-box-arrow-up') : '',
        onAction: (a, m) => UI.goTo(ref(m)), empty: 'No stock movement matches.' });
  },
});
