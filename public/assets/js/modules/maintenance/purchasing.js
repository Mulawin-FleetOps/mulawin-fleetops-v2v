/* assets/js/modules/maintenance/purchasing.js — PARTS & PURCHASING
   A. Parts request (stock-out): Motorpool requests -> Purchasing checks stock and releases.
   B. Purchase order (stock-in): Purchasing creates -> routed to Finance (<= limit) or Admin
      (> limit) -> budget check -> approved PO (with e-signature) -> receiving (partial allowed).
   Printable REQUEST FORM (PDF #13) and PURCHASE ORDER.
   Backend: backend/Modules/Maintenance/Purchasing.php (payment: Accounting/Finance.php) */
'use strict';
const PurUI = {
  data: null,
  lineEditor(withPrice, lines = []) {
    const parts = PurUI.data.parts.filter(p => +p.active);
    const row = (l = {}) => `<div class="row g-2 mb-1 pl-row"><div class="col-${withPrice ? 6 : 9}"><select class="form-select form-select-sm" data-part><option value="">Choose part…</option>
        ${parts.map(p => `<option value="${p.id}" data-cost="${p.unit_cost}" ${String(p.id) === String(l.part_id) ? 'selected' : ''}>${UI.esc(p.part_number)} · ${UI.esc(p.description)} (on hand ${p.quantity_on_hand} ${UI.esc(p.unit)})</option>`).join('')}</select></div>
      <div class="col-${withPrice ? 2 : 3}"><input class="form-control form-control-sm" type="number" min="1" placeholder="Qty" data-qty value="${UI.esc(l.quantity || '')}"></div>
      ${withPrice ? `<div class="col-2"><input class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="Unit price" data-price value="${UI.esc(l.unit_price || '')}"></div><div class="col-2 small text-end pt-1" data-lt></div>` : ''}</div>`;
    const rows = (lines.length ? lines : [{}, {}, {}]).map(row).join('');
    return `<div class="small text-muted mb-1">${withPrice ? 'Part · Qty · Unit price · Amount' : 'Part · Qty'} ${parts.length ? '' : '<b class="text-danger">No parts yet: Purchasing adds them in the Inventory tab.</b>'}</div><div data-lines>${rows}</div>
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
  newRequest(vehicleId, jobId) {
    const d = PurUI.data;
    UI.modal('Parts request (Request Form)', UI.fields([
      { name: 'vehicle_id', label: 'Truck', type: 'select', required: true, col: 6, value: vehicleId, options: d.trucks.map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]) },
      { name: 'maintenance_job_id', label: 'For maintenance record (optional)', type: 'select', col: 6, value: jobId, options: d.openJobs.map(j => [j.id, j.job_ref + ' · ' + j.problem.slice(0, 40)]) },
      { name: 'purpose', label: 'Reason / purpose', required: true, col: 12 }]) + '<div class="mt-2">' + PurUI.lineEditor(false) + '</div>',
      async (x, form, w) => { const r = await App.api('Purchasing.request_create', { ...x, lines: PurUI.readLines(w, false) }); UI.result(r); App.go('purchasing'); },
      { submit: 'Send to Purchasing', onShow: (w) => PurUI.wireLines(w, false) });
  },
  newPO(prefill = {}) {
    const d = PurUI.data;
    UI.modal('Purchase Order Request', UI.fields([
      { name: 'supplier_id', label: 'Supplier', type: 'select', required: true, col: 6, options: UI.opts(d.suppliers.filter(s => +s.active), s => s.name) },
      { name: 'part_request_id', label: 'Related parts request (optional)', type: 'select', col: 6, value: prefill.part_request_id, options: d.requests.filter(r => ['Not Available', 'Partially Released', 'Requested'].includes(r.status)).map(r => [r.id, r.request_ref + ' · ' + r.plate_number]) },
      { name: 'purpose', label: 'Purpose', required: true, col: 12, value: prefill.purpose }]) + '<div class="mt-2">' + PurUI.lineEditor(true, prefill.lines || []) + '</div>'
      + (d.budget && d.budget.id ? `<div class="small text-muted mt-2">Purchasing budget available now: <b>${UI.money(d.budget.available)}</b> (checked again at approval).</div>` : '<div class="small text-danger mt-2">No active purchasing budget: approval will be rejected until Finance sets one.</div>'),
      async (x, form, w) => { const r = await App.api('Purchasing.po_create', { ...x, lines: PurUI.readLines(w, true) }); UI.result(r); App.route(); },
      { submit: 'Submit for approval', onShow: (w) => PurUI.wireLines(w, true) });
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
    wrap.querySelector('[data-na]').onclick = async () => { try { const res = await App.api('Purchasing.request_process', { request_id: rq.id, not_available: 1 }); UI.result(res); bootstrap.Modal.getInstance(wrap).hide(); App.route(); } catch (e) { UI.toast(e.message, 'error'); } };
  },
  async printRequest(rq) {
    const r = await App.api('Purchasing.request_details', { request_id: rq.id }); const q = r.request;
    UI.printForm('REQUEST FORM', `<div class="pf-grid"><div><b>Truck No. / Trailer No.:</b> ${UI.esc(q.plate_number)}${q.truck_number ? ' #' + UI.esc(q.truck_number) : ''}</div><div><b>DATE:</b> ${UI.date(q.created_at)}</div>
      <div><b>Model No. / Engine No.:</b> ${UI.esc([q.make_brand, q.engine_number].filter(Boolean).join(' / '))}</div><div><b>Series No.:</b> ${UI.esc(q.request_ref)}</div></div>
      <div class="mt-1"><b>PARTICULARS</b></div><table><thead><tr><th style="width:12%">ITEM NO.</th><th>ITEMS / DESCRIPTION</th><th class="num" style="width:12%">QTY.</th><th style="width:12%">UNIT</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${UI.esc(l.description)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td></tr>`).join('')}${UI.pfBlank(4, r.lines.length, 12)}
      <tr><th colspan="2">TOTAL</th><th class="num">${r.lines.reduce((a, l) => a + +l.quantity, 0)}</th><th></th></tr></tbody></table>
      <div><b>Reason / Purpose:</b> ${UI.esc(q.purpose)}${q.job_ref ? ' (' + UI.esc(q.job_ref) + ')' : ''}</div>
      <div class="pf-signs">${UI.sign('Requested by', q.requested_by_name, q.requested_by)}${UI.sign('Received by', q.processed_by_name || '', q.processed_by)}${UI.sign('Approved by')}</div>`, { number: q.request_ref });
  },
  async printPO(o) {
    const r = await App.api('Purchasing.po_details', { po_id: o.id }); const p = r.po;
    const approved = ['Approved', 'Partially Received', 'Received', 'Closed'].includes(p.status);
    UI.printForm('PURCHASE ORDER', `<div class="pf-grid"><div><b>SUPPLIER:</b> ${UI.esc(p.supplier)}</div><div><b>DATE:</b> ${UI.date(p.created_at)}</div>
      <div><b>ADDRESS:</b> ${UI.esc(p.supplier_address || '')}</div><div><b>CONTACT:</b> ${UI.esc([p.supplier_contact, p.supplier_phone].filter(Boolean).join(' · '))}</div>
      <div style="grid-column:1/3"><b>PURPOSE:</b> ${UI.esc(p.purpose)}${p.request_ref ? ' (from ' + UI.esc(p.request_ref) + ')' : ''}</div></div>
      <table><thead><tr><th>Part no.</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${UI.esc(l.description)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td><td class="num">${UI.money(l.unit_price)}</td><td class="num">${UI.money(l.line_total)}</td></tr>`).join('')}${UI.pfBlank(6, r.lines.length, 8)}
      <tr><th colspan="5">TOTAL</th><th class="num">${UI.money(p.total_amount)}</th></tr></tbody></table>
      <div class="pf-note">Status: ${UI.esc(p.status)}${approved ? ' · Approved by ' + UI.esc(p.decided_by_name) + ' (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ') on ' + UI.datetime(p.decided_at) + '. Budget reserved by the system.' : ' · NOT APPROVED — do not use for purchasing.'}</div>
      <div class="pf-signs">${UI.sign('Requested by (Purchasing Officer)', p.requested_by_name, p.requested_by)}${UI.sign('Approved by (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ')' + (approved ? ' · approved in the system' : ''), approved ? p.decided_by_name : '', approved ? p.decided_by : null)}</div>`, { number: p.po_ref });
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

App.page('purchasing', {
  title: 'Parts & Purchasing',
  subtitle: 'Parts requests (stock-out), purchase orders (stock-in), inventory and suppliers.',
  render(ctx) {
    const d = PurUI.data = ctx.data, can = d.can;
    const add = (label, icon, fn, cls = 'btn-primary') => { const b = document.createElement('button'); b.className = 'btn btn-sm ' + cls; b.innerHTML = `<i class="bi ${icon}"></i> ${label}`; b.onclick = fn; ctx.tools.append(b); };
    if (can.request) add('Request parts', 'bi-box-arrow-up', () => PurUI.newRequest());
    if (can.stock) add('New purchase order', 'bi-cart-plus', () => PurUI.newPO());
    const lowStock = d.parts.filter(p => +p.active && +p.low_stock);
    const invValue = d.parts.filter(p => +p.active).reduce((a, p) => a + +p.stock_value, 0);
    const pendingApproval = d.orders.filter(o => o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig)));
    ctx.el.innerHTML = UI.cards([
      { label: 'Parts requests to process', value: d.requests.filter(r => r.status === 'Requested').length, icon: 'bi-box-arrow-up', color: 'amber' },
      { label: 'POs waiting for approval', value: d.orders.filter(o => o.status === 'Pending Approval').length, icon: 'bi-hourglass-split', color: 'blue', hint: pendingApproval.length ? pendingApproval.length + ' for you' : '' },
      { label: 'POs to receive', value: d.orders.filter(o => ['Approved', 'Partially Received'].includes(o.status)).length, icon: 'bi-truck', color: 'blue' },
      { label: 'Inventory value', value: invValue, format: 'money', icon: 'bi-cash', color: 'green' },
      { label: 'Low-stock items', value: lowStock.length, icon: 'bi-exclamation-triangle', color: 'red' },
      { label: 'Purchasing budget available', value: d.budget && d.budget.id ? +d.budget.available : 'No budget', format: d.budget && d.budget.id ? 'money' : '', icon: 'bi-piggy-bank', color: 'gray' },
    ]);
    const reqActs = (r) => UI.btn('print', 'Print form', 'outline-secondary') + (can.stock && ['Requested', 'Partially Released', 'Not Available'].includes(r.status) ? UI.btn('process', 'Check & release', 'primary') : '')
      + (can.stock && ['Not Available', 'Partially Released'].includes(r.status) ? UI.btn('po', 'Create PO', 'outline-primary') : '') + (can.request && r.status === 'Requested' ? UI.btn('cancel', 'Cancel', 'outline-danger') : '');
    const reqAct = async (a, r) => {
      if (a === 'print') PurUI.printRequest(r);
      if (a === 'process') PurUI.processRequest(r);
      if (a === 'cancel') UI.confirmAction('Cancel ' + UI.esc(r.request_ref), 'The request will not be processed.', 'Purchasing.request_cancel', { request_id: r.id }, { danger: true });
      if (a === 'po') { const x = await App.api('Purchasing.request_details', { request_id: r.id });
        PurUI.newPO({ part_request_id: r.id, purpose: 'Parts for ' + r.plate_number + ' (' + r.request_ref + ')', lines: x.lines.filter(l => l.quantity - l.released_qty > 0).map(l => ({ part_id: l.part_id, quantity: l.quantity - l.released_qty, unit_price: (d.parts.find(p => p.id == l.part_id) || {}).unit_cost })) }); }
    };
    const poActs = (o) => {
      let h = UI.btn('print', 'Print PO', 'outline-secondary');
      if (o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig))) h += UI.btn('approve', 'Approve', 'success') + UI.btn('reject', 'Reject', 'outline-danger');
      if (can.stock && ['Approved', 'Partially Received'].includes(o.status)) h += UI.btn('receive', 'Receive', 'primary') + UI.btn('close', 'Close balance', 'outline-secondary');
      return h;
    };
    const poAct = (a, o) => {
      if (a === 'print') PurUI.printPO(o);
      if (a === 'approve') UI.confirmAction('Approve ' + UI.esc(o.po_ref), `Approve ${UI.money(o.total_amount)} to ${UI.esc(o.supplier)}? The system checks the purchasing budget and reserves the amount; if the budget is not enough the PO is rejected automatically.`
        + (App.me.user.has_signature ? '' : '<div class="small text-warning mt-2">You have no e-signature yet (name menu > My e-signature). Your name is printed instead.</div>'), 'Purchasing.po_decide', { po_id: o.id, decision: 'approve' }, { submit: 'Approve' });
      if (a === 'reject') UI.confirmAction('Reject ' + UI.esc(o.po_ref), 'The Purchasing Officer will be notified.', 'Purchasing.po_decide', { po_id: o.id, decision: 'reject' }, { danger: true, fields: [{ name: 'notes', label: 'Reason', required: true, col: 12 }] });
      if (a === 'receive') PurUI.receive(o);
      if (a === 'close') UI.confirmAction('Close ' + UI.esc(o.po_ref), 'Use this when the rest of the order will not be delivered. The reserved budget of the undelivered items is released.', 'Purchasing.po_close', { po_id: o.id }, { fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
    };
    const partActs = () => can.stock ? UI.btn('edit', 'Edit') + UI.btn('adjust', 'Adjust stock', 'outline-secondary') : '';
    const partForm = (p = {}) => UI.formModal(p.id ? 'Edit part ' + UI.esc(p.part_number) : 'Add part', [
      { name: 'part_number', label: 'Part no. / ID', required: true, col: 4, value: p.part_number }, { name: 'description', label: 'Description', required: true, col: 8, value: p.description },
      { name: 'category', label: 'Category', col: 4, value: p.category }, { name: 'unit', label: 'Unit', required: true, col: 4, value: p.unit || 'pc' }, { name: 'unit_cost', label: 'Unit cost', type: 'money', required: true, col: 4, value: p.unit_cost },
      { name: 'reorder_level', label: 'Reorder level (low-stock alert)', type: 'number', required: true, col: 4, value: p.reorder_level ?? 0 }, { name: 'warranty_info', label: 'Warranty', col: 4, value: p.warranty_info },
      ...(p.id ? [] : [{ name: 'opening_qty', label: 'Opening quantity on hand', type: 'number', col: 4, value: 0 }])], 'Purchasing.part_save', { extra: p.id ? { id: p.id } : {} });
    const partAct = (a, p) => a === 'edit' ? partForm(p) : UI.formModal('Adjust stock of ' + UI.esc(p.part_number), [
      { name: 'quantity_delta', label: 'Quantity to add (+) or remove (-)', type: 'number', min: -100000, required: true, col: 6 }, { name: 'reason', label: 'Reason (count correction, damaged, ...)', required: true, col: 6 }],
      'Purchasing.adjust', { extra: { part_id: p.id }, intro: 'On hand now: ' + p.quantity_on_hand + ' ' + UI.esc(p.unit) + '.' });
    const supForm = (s = {}) => UI.formModal(s.id ? 'Edit supplier' : 'Add supplier', [
      { name: 'name', label: 'Supplier name', required: true, col: 12, value: s.name }, { name: 'contact_person', label: 'Contact person', col: 6, value: s.contact_person },
      { name: 'contact_number', label: 'Contact number', col: 6, value: s.contact_number }, { name: 'email', label: 'Email', col: 6, value: s.email }, { name: 'address', label: 'Address', col: 6, value: s.address },
      ...(s.id ? [{ name: 'active', label: 'Active', type: 'checkbox', value: s.active, col: 12 }] : [])], 'Purchasing.supplier_save', { extra: s.id ? { id: s.id } : {} });
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, [
      ['requests', 'Parts requests', () => UI.table([['Request', 'request_ref'], ['Date', 'created_at', 'date'], ['Truck', 'plate_number'], ['Maintenance', 'job_ref'], ['Items', 'items'], ['Purpose', 'purpose'],
        ['Status', 'status', 'badge'], ['Requested by', 'requested_by_name'], ['Processed by', 'processed_by_name']], d.requests, { title: 'Truck-parts requests (stock-out)', actions: reqActs, onAction: reqAct })],
      ['orders', 'Purchase orders', () => UI.table([['PO', 'po_ref'], ['Date', 'created_at', 'date'], ['Supplier', 'supplier'], ['Items (received/ordered)', 'items'], ['Total', 'total_amount', 'money'],
        ['Approver', 'approver_role', (v) => v === 'finance' ? 'Finance' : 'Admin'], ['Status', 'status', 'badge'], ['Payment', 'payment_status', 'badge'], ['Paid', 'paid_amount', 'money'], ['Decided by', 'decided_by_name']], d.orders,
        { title: 'Purchase order requests (stock-in)', actions: poActs, onAction: poAct })],
      ['inventory', `Inventory${lowStock.length ? ' (' + lowStock.length + ' low)' : ''}`, (body) => {
        const h = UI.table([['Part no.', 'part_number'], ['Description', 'description'], ['Category', 'category'], ['On hand', 'quantity_on_hand', (v, p) => `${UI.num(v)} ${UI.esc(p.unit)}${+p.low_stock ? ' <span class="badge-s red">Low</span>' : ''}`],
          ['Reorder level', 'reorder_level', 'num'], ['Unit cost', 'unit_cost', 'money'], ['Stock value', 'stock_value', 'money'], ['Warranty', 'warranty_info']], d.parts, { title: 'Parts inventory', actions: partActs, onAction: partAct,
          tools: can.stock ? '<button class="btn btn-sm btn-primary" data-addpart><i class="bi bi-plus"></i> Add part</button>' : '' });
        setTimeout(() => body.querySelector('[data-addpart]')?.addEventListener('click', () => partForm()), 0);
        return h;
      }],
      ['movements', 'Stock movements', () => UI.table([['When', 'created_at', 'datetime'], ['Part', 'part_number'], ['Description', 'description'], ['Type', 'movement_type', 'badge'], ['Qty', 'quantity_delta', 'num'],
        ['Unit cost', 'unit_cost', 'money'], ['Reason', 'reason'], ['Truck', 'plate_number'], ['By', 'actor']], d.movements, { title: 'Stock-in, stock-out and adjustments (latest 500)' })],
      ['suppliers', 'Suppliers', (body) => {
        const h = UI.table([['Supplier', 'name'], ['Contact', 'contact_person'], ['Phone', 'contact_number'], ['Email', 'email'], ['Address', 'address'], ['Active', 'active', 'yes']], d.suppliers,
          { title: 'Supplier database', actions: () => can.stock ? UI.btn('edit', 'Edit') : '', onAction: (a, s) => supForm(s), tools: can.stock ? '<button class="btn btn-sm btn-primary" data-addsup><i class="bi bi-plus"></i> Add supplier</button>' : '' });
        setTimeout(() => body.querySelector('[data-addsup]')?.addEventListener('click', () => supForm()), 0);
        return h;
      }],
    ], can.approveSmall || can.approveBig ? 'orders' : null);
    const once = UI.takeQuery(ctx, 'request_for', 'job');
    if (once.request_for && can.request) PurUI.newRequest(once.request_for, once.job);
  },
});
