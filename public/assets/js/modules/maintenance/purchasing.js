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
  // Escape each recorded identity component; keep numeric Part ID separate.
  partLabel: p => UI.esc([p.part_type, p.description, p.brand].filter(Boolean).join(' — ')),

  async details(id, kind = 'po') {
    let r;try{r=await App.api(kind==='po'?'Purchasing.po_details':'Purchasing.request_details',kind==='po'?{po_id:id}:{request_id:id});}catch(error){return UI.toast(error.message,'error');}
    const order=kind==='po',record=order?r.po:r.request,lines=r.lines||[],reference=order?record.po_ref:record.request_ref;
    const received=order?lines.reduce((sum,line)=>sum+Number(line.received_qty||0),0):lines.reduce((sum,line)=>sum+Number(line.released_qty||0),0);
    const requested=lines.reduce((sum,line)=>sum+Number(line.quantity||0),0);
    const rejected=String(record.status).startsWith('Rejected')||record.status==='Cancelled';
    const milestones=order?[
      {label:'Submitted',at:record.created_at,state:record.created_at?'complete':'pending'},
      {label:rejected?record.status:'Approval decision',at:record.decided_at,state:rejected?'exception':record.decided_at?'complete':'pending'},
      {label:'Parts received',state:received>0&&received===requested?'complete':received>0?'current':'pending',note:received+' of '+requested+' units recorded; dated receiving history is not provided by this endpoint.'}
    ]:[{label:'Requested',at:record.created_at,state:record.created_at?'complete':'pending'},{label:'Parts released',state:received>0&&received===requested?'complete':rejected?'exception':received>0?'current':'pending',note:received+' of '+requested+' units recorded.'}];
    const html=UI.workflow(milestones,{status:record.status})+UI.h('Overview')+UI.kv([['Reference',UI.e(reference)],['Status',UI.badge(record.status)],['Requested by',UI.e(record.requested_by_name)],['Created',UI.datetime(record.created_at)],['Maintenance record',UI.e(record.job_ref)],['Approval role',UI.e(record.approver_role)],['Purpose',UI.e(record.purpose)],['Supplier',UI.e(record.supplier)],['Truck',UI.e(record.plate_number)],...(order?[['Order total',UI.money(record.total_amount)],['Received value',UI.money(lines.reduce((sum,line)=>sum+Number(line.received_qty||0)*Number(line.unit_price||0),0))],['Supplier invoice',UI.e(record.supplier_invoice_no)]]:[])])+UI.h('Items and Quantities')+UI.table([['Part','part_number'],['Description','description'],['Requested / Ordered','quantity','num'],[order?'Received':'Released',order?'received_qty':'released_qty','num'],...(order?[['Unit price','unit_price','money']]:[])],lines,{plain:true})+UI.h('Processing Record')+UI.kv([['Decision by',UI.e(record.decided_by_name)],['Decision date',UI.datetime(record.decided_at)],['Decision notes',UI.e(record.decision_notes)],['Processed by',UI.e(record.processed_by_name)],['Notes',UI.e(record.notes)]])+(App.me?.user?.role==='purchasing'?'':UI.h('Payments')+UI.table([['Voucher','voucher_number'],['Amount','amount','money'],['Released','released_on','date'],['Recorded by','recorded_by_name']],r.payments||[],{plain:true,empty:'No payment details returned for this record and role.'}))+UI.h('Documents')+UI.docs(r.documents||[]);
    const drawer=UI.drawer(UI.esc(reference),html,{subtitle:(order?'Purchase Order':'Parts Request')+' details'});
    UI.drawerSections(drawer,[['summary','Overview',['Overview']],['items','Items & Quantities',['Items and Quantities']],['record','Processing Record',['Processing Record']],...(App.me?.user?.role==='purchasing'?[]:[['payments','Payments',['Payments']]]),['docs','Documents',['Documents']]],{key:'purchasing-details'});
  },
  /** Editable PO item list — Purchasing backend still validates all lines and prices. */
  lineEditor(withPrice, lines = []) {
    const parts = (PurUI.data.parts || []).filter(p => +p.active);
    const row = (l = {}) => `<div class="purchasing-line pl-row">
      <div class="purchasing-line-fields"><div><label class="form-label">Part</label><select class="form-select" data-part aria-label="Select part to purchase"><option value="">Choose part…</option>
        ${parts.map(p => `<option value="${p.id}" data-cost="${p.unit_cost}" ${String(p.id) === String(l.part_id) ? 'selected' : ''}>${UI.esc([p.part_type, p.description, p.brand].filter(Boolean).join(' — '))}${!p.part_type ? ' (type not classified)' : ''}${withPrice ? "" : " · Available: " + UI.num(p.available_qty ?? p.quantity_on_hand) + " " + UI.esc(p.unit)}</option>`).join('')}</select></div>
        <div><label class="form-label">Quantity</label><input class="form-control" type="number" min="1" max="100000" step="1" placeholder="Qty" data-qty value="${UI.esc(l.quantity || '')}"></div>
        ${withPrice ? `<div><label class="form-label">Unit price (₱)</label><input class="form-control" type="number" min="0" step="0.01" placeholder="Price" data-price value="${UI.esc(l.unit_price ?? '')}"></div>` : ''}</div>
      ${withPrice ? '<div class="purchasing-line-amount" data-lt></div>' : ''}
      <button type="button" class="btn btn-outline-danger btn-sm purchasing-remove" data-remove-row title="Remove item" aria-label="Remove item">Remove</button>
    </div>`;
    return `<section class="purchasing-line-editor"><div class="purchasing-line-title"><div><strong>Items to purchase</strong><small>Choose the part to order, quantity and unit price. Items with zero on-hand stock can still be purchased; stock increases only after receiving.</small></div>
      <button type="button" class="btn btn-outline-primary btn-sm" data-addrow>Add Item</button></div>
      ${parts.length ? '' : '<div class="alert alert-warning small">No parts in catalog. Add a part through Inventory before creating a PO.</div>'}
      ${withPrice ? '<p class="small text-muted mb-2" data-part-supplier-hint aria-live="polite">Choose a part to check previous supplier records.</p>' : ''}
      <div data-lines>${(lines.length ? lines : [{}]).map(row).join('')}</div>
      ${withPrice ? '<div class="purchasing-line-total" data-total></div><div class="small text-muted text-end" data-route></div>' : ''}</section>`;
  },
  wireLines(w, withPrice) {
    const host = w.querySelector('[data-lines]');
    const template = host.querySelector('.pl-row').outerHTML;
    const calc = () => {
      // Prevent a catalog part being selected twice in one PO / request.
      // Disabled options refresh after selection, row addition and row removal.
      const selected = new Set([...host.querySelectorAll('[data-part]')].map(el => el.value).filter(Boolean));
      host.querySelectorAll('[data-part]').forEach(select => {
        [...select.options].forEach(option => {
          if (option.value) option.disabled = selected.has(option.value) && option.value !== select.value;
        });
      });
      let total = 0;
      host.querySelectorAll('.pl-row').forEach(r => {
        const qty = +r.querySelector('[data-qty]').value || 0;
        const price = withPrice ? +r.querySelector('[data-price]').value || 0 : 0;
        if (withPrice) r.querySelector('[data-lt]').textContent = qty && price ? UI.money(qty * price) : '';
        total += qty * price;
      });
      host.querySelectorAll('[data-remove-row]').forEach(b => b.disabled = host.querySelectorAll('.pl-row').length <= 1);
      if (!withPrice) return;
      w.querySelector('[data-total]').textContent = 'Estimated total: ' + UI.money(total);
      const lim = +PurUI.data.threshold;
      w.querySelector('[data-route]').innerHTML = total
        ? (total <= lim ? `Approval route: <b>Finance</b> (up to ${UI.money(lim)}).` : `Approval route: <b>Admin</b> (above ${UI.money(lim)}).`) : '';
    };
    w.querySelector('[data-addrow]').onclick = () => {
      host.insertAdjacentHTML('beforeend', template);
      const last = host.lastElementChild;
      last.querySelectorAll('input').forEach(i => i.value = '');
      last.querySelector('[data-part]').value = '';
      calc();
      w._updatePartSupplier?.();
    };
    host.addEventListener('click', e => {
      const button = e.target.closest('[data-remove-row]');
      if (!button || host.querySelectorAll('.pl-row').length === 1) return;
      button.closest('.pl-row').remove(); calc();
      w._updatePartSupplier?.();
    });
    host.addEventListener('input', calc);
    host.addEventListener('change', e => {
      if (withPrice && e.target.matches('[data-part]')) {
        const input = e.target.closest('.pl-row').querySelector('[data-price]');
        if (!input.value) input.value = e.target.selectedOptions[0]?.dataset.cost || '';
      }
      calc();
      if (e.target.matches('[data-part]')) w._updatePartSupplier?.();
    });
    calc();
  },
  readLines(w, withPrice) {
    const lines = [...w.querySelectorAll('.pl-row')].map(r => ({ part_id: r.querySelector('[data-part]').value, quantity: r.querySelector('[data-qty]').value, ...(withPrice ? { unit_price: r.querySelector('[data-price]').value } : {}) }))
      .filter(l => l.part_id || l.quantity);
    const ids = lines.map(l => l.part_id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error('Each part can only appear once. Update its quantity in the existing row.');
    return lines;
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
  /** Autofill only when actual past PO history clearly identifies one supplier.
   *  Never replace supplier details manually entered by Purchasing. */
  wirePartSuppliers(w) {
    const history = PurUI.data.partSupplierHistory || [];
    const byPart = new Map();
    history.forEach(h => {
      const key = String(h.part_id), name = String(h.name || '').trim();
      if (!key || !name) return;
      if (!byPart.has(key)) byPart.set(key, new Map());
      const names = byPart.get(key);
      const code = name.toUpperCase();
      // SQL orders newest first: do not overwrite the latest supplier snapshot.
      if (!names.has(code)) names.set(code, h);
    });
    const form = w.querySelector('form'), info = w.querySelector('[data-part-supplier-hint]');
    const field = name => form.querySelector('[name="' + name + '"]');
    const keys = [['supplier_address','address'], ['supplier_contact','contact_person'],
      ['supplier_phone','contact_number'], ['supplier_email','email']];
    let auto = null;
    const isAuto = () => auto && Object.entries(auto).every(([key, value]) => field(key).value === value);
    const clearAuto = () => {
      // Clear only values filled by this helper; preserve any manual values.
      if (auto) Object.entries(auto).forEach(([key, value]) => {
        if (field(key).value === value) field(key).value = '';
      });
      auto = null;
    };
    const note = message => { if (info) info.textContent = message; };
    const update = () => {
      const ids = [...w.querySelectorAll('[data-part]')].map(el => el.value).filter(Boolean);
      if (!ids.length) {
        clearAuto();
        note('Choose a part to check previous supplier records.');
        return;
      }
      const histories = ids.map(id => byPart.get(String(id)));
      if (histories.some(h => !h || !h.size)) {
        clearAuto();
        note('No complete supplier history for the selected items. Enter or confirm the supplier manually.');
        return;
      }
      const common = [...histories[0].keys()].filter(name => histories.every(h => h.has(name)));
      if (common.length !== 1) {
        clearAuto();
        note(common.length ? 'More than one historical supplier matches these parts. Choose the supplier manually.'
          : 'The selected parts have different past suppliers. Choose the supplier for this PO manually.');
        return;
      }
      const source = histories[0].get(common[0]);
      const supplier = field('supplier_name');
      if (supplier.value.trim() && (!auto || supplier.value !== auto.supplier_name)) {
        note('Previous supplier: ' + source.name + ' (' + source.po_ref + '). Your entered supplier is kept.');
        return;
      }
      if (auto && !isAuto()) {
        auto = null;
        note('Supplier details were edited manually. Existing values were kept.');
        return;
      }
      clearAuto();
      supplier.value = source.name;
      const snapshot = { supplier_name: supplier.value };
      keys.forEach(([target, sourceKey]) => {
        const input = field(target);
        if (!input.value.trim() && source[sourceKey]) {
          input.value = source[sourceKey];
          snapshot[target] = input.value;
        }
      });
      auto = snapshot;
      note('Auto-filled from the recorded supplier on ' + source.po_ref + '. Review before submitting.');
    };
    // Keep manually entered data authoritative; the matcher runs only on part edits.
    w._updatePartSupplier = update;
    update();
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
      { submit: 'Send for Approval', onShow: (w) => { w.classList.add('purchasing-po-modal'); PurUI.wireLines(w, true); PurUI.wireSupplier(w); PurUI.wirePartSuppliers(w); } });
  },
  async processRequest(rq) {
    const r = await App.api('Purchasing.request_details', { request_id: rq.id });
    const rows = r.lines.map(l => { const left = l.quantity - l.released_qty;
      const reserved = +l.reserved_qty || 0;
      const free = Math.max(0, (+l.quantity_on_hand || 0) - ((PurUI.data.parts || []).find(p => +p.id === +l.part_id)?.reserved_qty || 0));
      const can = Math.min(left, reserved + free);
      return `<tr><td>${UI.esc(l.part_number)}<div class="small text-muted">${PurUI.partLabel(l)}</div></td><td class="num">${l.quantity}</td><td class="num">${l.released_qty}</td><td class="num">${l.quantity_on_hand}</td>
        <td><input class="form-control form-control-sm" type="number" min="0" max="${left}" value="${can > 0 ? can : 0}" data-rel="${l.id}" ${left ? '' : 'disabled'}></td></tr>`; }).join('');
    const missing = r.lines.some(l => (+l.quantity - +l.released_qty) > (+l.reserved_qty || 0) + Math.max(0, (+l.quantity_on_hand || 0) - ((PurUI.data.parts || []).find(p => +p.id === +l.part_id)?.reserved_qty || 0)));
    const canRelease = r.lines.some(l => (+l.reserved_qty || 0) + Math.max(0, (+l.quantity_on_hand || 0) - ((PurUI.data.parts || []).find(p => +p.id === +l.part_id)?.reserved_qty || 0)) > 0 && +l.quantity > +l.released_qty);
    const wrap = UI.modal('Release Parts · ' + UI.esc(rq.request_ref), `<p class="small text-muted">Truck ${UI.esc(rq.plate_number)} · ${UI.esc(rq.purpose)}. Available stock is prefilled for release. If stock is short, use the purchase order shortcut below.</p>
      <table class="data-table"><thead><tr><th>Part</th><th class="num">Requested</th><th class="num">Released</th><th class="num">On hand</th><th>Release now</th></tr></thead><tbody>${rows}</tbody></table>
      ${UI.fields([{ name: 'notes', label: 'Notes', col: 12 }])}`,
      async (x, form) => { const release = [...form.querySelectorAll('[data-rel]')].map(i => ({ line_id: i.dataset.rel, qty: +i.value || 0 }));
        const res = await App.api('Purchasing.request_process', { request_id: rq.id, release, notes: x.notes }); UI.result(res); App.route(); },
      { submit: 'Release Available Parts', extraFooter: (missing ? '<button type="button" class="btn btn-outline-primary btn-sm me-auto" data-shortage-po>Buy Missing Parts</button>' : '') + (!canRelease ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-na>Mark as No Stock</button>' : ''), onShow: (modal) => { if (!canRelease) { const submit = modal.querySelector('button[type="submit"]'); if (submit) submit.disabled = true; } } });
    wrap.querySelector('[data-shortage-po]')?.addEventListener('click', () => {
      const pending = r.lines.filter(l => +l.quantity > +l.released_qty + (+l.reserved_qty || 0)).map(l => ({
        part_id: l.part_id,
        quantity: Math.max(0, (+l.quantity - +l.released_qty) - (+l.reserved_qty || 0)),
        unit_price: (PurUI.data.parts || []).find(p => +p.id === +l.part_id)?.unit_cost ?? 0
      }));
      if (!pending.length) return UI.toast('There is no unreserved shortage for this request.', 'warning');
      wrap.addEventListener('hidden.bs.modal', () => {
        PurUI.newPO({ part_request_id: rq.id, purpose: 'Parts for ' + rq.plate_number + ' (' + rq.request_ref + ')', lines: pending });
      }, { once: true });
      bootstrap.Modal.getInstance(wrap)?.hide();
    });
    wrap.querySelector('[data-na]').onclick = async () => { if (!await UI.confirmProceed('Confirm no stock', 'Mark this parts request as not available because the required stock is unavailable?', 'Confirm not available')) return; try { const res = await App.api('Purchasing.request_process', { request_id: rq.id, not_available: 1 }); UI.result(res); bootstrap.Modal.getInstance(wrap).hide(); App.route(); } catch (e) { UI.toast(e.message, 'error'); } };
  },
  async printRequest(rq) {
    const r = await App.api('Purchasing.request_details', { request_id: rq.id }); const q = r.request;
    UI.printForm('REQUEST FORM', `<div class="pf-grid"><div><b>Truck No. / Trailer No.:</b> ${UI.esc(q.plate_number)}${q.truck_number ? ' #' + UI.esc(q.truck_number) : ''}</div><div><b>DATE:</b> ${UI.date(q.created_at)}</div>
      <div><b>Model No. / Engine No.:</b> ${UI.esc([q.make_brand, q.engine_number].filter(Boolean).join(' / '))}</div><div><b>Series No.:</b> ${UI.esc(q.request_ref)}</div></div>
      <div class="mt-1"><b>PARTICULARS</b></div><table><thead><tr><th style="width:12%">ITEM NO.</th><th>ITEMS / DESCRIPTION</th><th class="num" style="width:12%">QTY.</th><th style="width:12%">UNIT</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${PurUI.partLabel(l)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td></tr>`).join('')}${UI.pfBlank(4, r.lines.length, 12)}
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
      <tbody>${r.lines.map(l => `<tr><td>${UI.esc(l.part_number)}</td><td>${PurUI.partLabel(l)}</td><td class="num">${l.quantity}</td><td>${UI.esc(l.unit)}</td><td class="num">${UI.money(l.unit_price)}</td><td class="num">${UI.money(l.line_total)}</td></tr>`).join('')}${UI.pfBlank(6, r.lines.length, 8)}
      <tr><th colspan="5">TOTAL</th><th class="num">${UI.money(p.total_amount)}</th></tr></tbody></table>
      <div class="pf-note">Status: ${UI.esc(p.status)}${approved ? ' · Approved by ' + UI.esc(p.decided_by_name) + ' (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ') on ' + UI.datetime(p.decided_at) + '. Budget reserved by the system.' : ' · NOT APPROVED — do not use for purchasing.'}</div>
      <div class="pf-signs">${UI.sign('Requested by (Purchasing Officer)', p.requested_by_name, p.requested_by, 'purchase_order', p.id)}${UI.sign('Approved by (' + (p.approver_role === 'finance' ? 'Finance' : 'Admin') + ')' + (approved ? ' · approved in the system' : ''), approved ? p.decided_by_name : '', approved ? p.decided_by : null, 'purchase_order', p.id)}</div>`, { number: p.po_ref });
  },
  /** Date-only warranty preview using the same end-of-month clamp as the PHP backend. */
  warrantyExpiry(start, months) {
  const parts = String(start).split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return '—';
  const first = new Date(parts[0], parts[1] - 1 + Number(months), 1);
  const last = new Date(first.getFullYear(),first.getMonth() + 1,0).getDate();
  first.setDate(Math.min(parts[2],last));
  return [first.getFullYear(),String(first.getMonth()+1).padStart(2,'0'),String(first.getDate()).padStart(2,'0')].join('-');
  },
  async receive(o) {
    const r = await App.api('Purchasing.po_details', { po_id: o.id });
    const ready = !!r.warrantyReady;
    const rows = r.lines.map(l => {
      const left = l.quantity - l.received_qty;
      return `<tr class="purchasing-receive-row">
        <td><b>${UI.esc(l.part_number)}</b><div class="small text-muted">${PurUI.partLabel(l)}</div></td>
        <td class="num">${UI.num(l.quantity)}</td><td class="num">${UI.num(l.received_qty)}</td>
        <td><input class="form-control form-control-sm" type="number" min="0" max="${left}" step="1" value="${left}" data-rcv="${l.id}" ${left && ready ? '' : 'disabled'}></td>
        <td><select class="form-select form-select-sm" data-wstatus="${l.id}" ${left && ready ? '' : 'disabled'}>
          <option value="Not Yet Confirmed" selected>Not Yet Confirmed</option>
          <option value="With Warranty">With Warranty</option>
          <option value="Pending Installation">Pending Installation</option>
          <option value="No Warranty">No Warranty</option>
        </select></td>
      </tr>
      <tr data-wdetails="${l.id}" hidden><td colspan="5"><div class="purchasing-receive-warranty-details">
        <label>Warranty start date basis
          <select class="form-select form-select-sm" data-wbasis="${l.id}">
            <option value="">Choose basis</option>
            <option value="Delivery">Delivery date</option><option value="Purchase">Purchase date</option>
            <option value="Invoice">Invoice date</option><option value="Installation">Installation date</option>
            <option value="Other">Other documented date</option>
          </select></label>
        <label>Warranty Start Date<input class="form-control form-control-sm" type="date" data-wstart="${l.id}"></label>
        <label>Duration (months)<input class="form-control form-control-sm" type="number" min="1" max="120" step="1" data-wmonths="${l.id}"></label>
        <div class="purchasing-receive-expiry">Expiration: <b data-wexpires="${l.id}">—</b></div>
      </div></td></tr>`;
    }).join('');
    UI.modal('Receive parts for ' + UI.esc(o.po_ref), `<div class="purchasing-receive-form">
      <p class="purchasing-receive-intro">Record what was actually delivered. Confirm the warranty from supplier documents; if it is not yet known, select Not Yet Confirmed.</p>
      <div class="purchasing-receive-section">Delivered items</div>
      ${ready ? '' : '<div class="alert alert-warning">Warranty confirmation migration is required before new receiving can be saved.</div>'}
      <div class="table-wrap purchasing-receive-table"><table class="data-table">
        <thead><tr><th>Part</th><th>Ordered</th><th>Received</th><th>Received now</th><th>Warranty status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="purchasing-receive-note">Warranty start and duration are entered only when coverage is confirmed. Every delivery is kept as a separate record.</p>
      <div class="purchasing-receive-section">Delivery documents</div>
      ${UI.fields([{ name: 'supplier_invoice_no', label: 'Invoice / delivery receipt number', col: 12,
        placeholder: 'Enter supplier invoice or delivery receipt number' },
        { name: 'receipt', label: 'Attach receipt or invoice (optional)', type: 'file', col: 12 }])}
      </div>`,
      async (x, form) => {
        const receive = [...form.querySelectorAll('[data-rcv]')].map(i => ({ line_id: i.dataset.rcv, qty: +i.value || 0 }));
        const warranty = receive.filter(i => i.qty > 0).map(i => ({
          line_id: i.line_id, status: form.querySelector('[data-wstatus="' + i.line_id + '"]').value,
          start_basis: form.querySelector('[data-wbasis="' + i.line_id + '"]').value,
          start: form.querySelector('[data-wstart="' + i.line_id + '"]').value,
          months: form.querySelector('[data-wmonths="' + i.line_id + '"]').value
        }));
        const res = await App.apiForm('Purchasing.po_receive', { po_id: o.id, receive, warranty,
          supplier_invoice_no: x.supplier_invoice_no }, form);
        UI.result(res); App.route();
      }, { submit: 'Record received parts', size: 'modal-xl',
        onShow: (wrap) => {
          wrap.classList.add('purchasing-receive-modal');
          const submit = wrap.querySelector('[type="submit"]');
          if (!ready) submit.disabled = true;
          const update = (id) => {
            const status = wrap.querySelector('[data-wstatus="' + id + '"]');
            const details = wrap.querySelector('[data-wdetails="' + id + '"]');
            const qty = wrap.querySelector('[data-rcv="' + id + '"]');
            const covered = status.value === 'With Warranty' && +qty.value > 0;
            const pending = status.value === 'Pending Installation' && +qty.value > 0;
            const show = covered || pending;
            details.hidden = !show;
            const basis = wrap.querySelector('[data-wbasis="' + id + '"]');
            const startInput = wrap.querySelector('[data-wstart="' + id + '"]');
            const monthsInput = wrap.querySelector('[data-wmonths="' + id + '"]');
            const basisCell = basis.closest('label'), startCell = startInput.closest('label');
            basisCell.hidden = pending; startCell.hidden = pending;
            basis.disabled = !covered; basis.required = covered;
            startInput.disabled = !covered; startInput.required = covered;
            monthsInput.disabled = !show; monthsInput.required = show;
            const start = startInput.value;
            const months = +wrap.querySelector('[data-wmonths="' + id + '"]').value;
            wrap.querySelector('[data-wexpires="' + id + '"]').textContent =
              pending ? 'Pending installation date' :
              covered && start && months >= 1 && months <= 120 ? PurUI.warrantyExpiry(start,months) : '—';
          };
          r.lines.forEach(l => {
            wrap.querySelectorAll('[data-wstatus="' + l.id + '"],[data-rcv="' + l.id + '"],[data-wstart="' + l.id + '"],[data-wmonths="' + l.id + '"]')
              .forEach(el => el.addEventListener('change', () => update(l.id)));
            update(l.id);
          });
        } });
  },
};


/** Row actions and forms shared by the Purchasing pages (Purchasing Officer acts, Finance/Admin approve, Admin/Audit read). */
PurUI.kit = (d, can) => {
    // Purchasing actions must say what they do. Preserve the same data-act and permission checks.
    // Use compact text buttons rather than icon-only controls, including in record tables.
    const act = (big) => (key, label, icon, cls) => UI.btn(key, label, cls);
    // One primary action per request. Purchasing sees the shortage-to-PO shortcut
    // inside the request handling form instead of competing table buttons.
    const reqActs = (r, big) => { const a = act(big);
      return (can.stock && ['Requested', 'Partially Released', 'Not Available'].includes(r.status) ? a('process', 'Release Parts', 'bi-box-arrow-up', 'primary') : '')
      + (big ? a('print', 'Print Request', 'bi-printer', 'outline-secondary') : ''); };
    const reqAct = async (a, r) => {
      if (a === 'details') return PurUI.details(r.id, 'request');
      if (a === 'print') PurUI.printRequest(r);
      if (a === 'process') PurUI.processRequest(r);
      
    };
    const poActs = (o, big) => {
      const a = act(big); let h = '';
      if (o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig))) h += a('approve', 'Approve PO', 'bi-check-lg', 'success') + (big ? a('reject', 'Reject PO', 'bi-x-lg', 'outline-danger') : '');
      if (can.stock && o.status === 'Approved' && d.orderTrackingReady && !o.ordered_at) h += a('order', 'Confirm Order Placed', 'bi-cart-check', 'primary');
      if (can.stock && ['Approved', 'Partially Received'].includes(o.status) && (!o.order_confirmation_required || o.ordered_at)) h += a('receive', 'Receive Parts', 'bi-box-arrow-in-down', 'primary') + (big ? a('close', 'Close Remaining Order', 'bi-slash-circle', 'outline-secondary') : '');
      return h + (big ? a('print', 'Print PO', 'bi-printer', 'outline-secondary') : '');
    };
    const poAct = (a, o) => {
      if (a === 'details') return PurUI.details(o.id);
      if (a === 'print') PurUI.printPO(o);
      if (a === 'approve') UI.confirmAction('Approve ' + UI.esc(o.po_ref), `Approve ${UI.money(o.total_amount)} to ${UI.esc(o.supplier)}? The system checks the purchasing budget and reserves the amount; if the budget is not enough the PO is rejected automatically.`
        + (App.me.user.has_signature ? '' : '<div class="small text-warning mt-2">You have no e-signature yet (name menu > My e-signature). Your name is printed instead.</div>'), 'Purchasing.po_decide', { po_id: o.id, decision: 'approve' }, { submit: 'Approve' });
      if (a === 'reject') UI.confirmAction('Reject ' + UI.esc(o.po_ref), 'The Purchasing Officer will be notified.', 'Purchasing.po_decide', { po_id: o.id, decision: 'reject' }, { danger: true, fields: [{ name: 'notes', label: 'Reason', required: true, col: 12 }] });
      if (a === 'order') UI.confirmAction('Confirm supplier order', 'Only confirm after you actually placed this PO with the supplier. Approval or payment alone does not mean ordered or delivered.', 'Purchasing.po_order', { po_id: o.id }, { submit: 'Mark as Ordered' });
      if (a === 'receive') PurUI.receive(o);
      if (a === 'close') UI.confirmAction('Close ' + UI.esc(o.po_ref), 'Use this when the rest of the order will not be delivered. The reserved budget of the undelivered items is released.', 'Purchasing.po_close', { po_id: o.id }, { fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
    };
    // STOCK_COUNT_RECONCILIATION_V1: no direct +/- adjustment. A discrepancy is recorded as a stock count for the Admin to post.
    const partActs = (p, big) => { const a = act(big);
      return (can.count && d.countsReady && +p.active ? a('count', 'Count Stock', 'bi-clipboard-check', 'outline-primary') : '') + (can.stock ? a('edit', 'Edit Part', 'bi-pencil', 'outline-secondary') : ''); };
    const partForm = (p = {}) => {
      if (!d.partIdentityReady) return UI.toast('Part Type / Brand database migration is required before adding or editing parts. Existing stock and records remain readable.', 'warning');
      return UI.formModal(p.id ? 'Edit part' : 'Add part', [
      { name: 'part_id_display', label: 'Part ID', col: 4, value: p.part_number || 'Assigned after saving', attrs: 'readonly aria-readonly="true" tabindex="-1"', help: p.id ? 'Permanent reference · cannot be edited.' : 'Automatically generated when you save.' },
      { name: 'part_type', label: 'Part Type', required: !p.id || !!p.part_type, col: 4, value: p.part_type, placeholder: 'e.g. Tire', attrs: 'maxlength="100"', help: p.id && !p.part_type ? 'Legacy item: classify when its actual type is verified.' : 'General part type; may be shared by different variants.' },
      { name: 'description', label: 'Part Name / Specification', required: true, col: 4, value: p.description, placeholder: 'Specific item or size', attrs: 'maxlength="200"', help: 'Use the exact recorded specification; do not guess for legacy stock.' },
      { name: 'brand', label: 'Brand (optional)', col: 6, value: p.brand, attrs: 'maxlength="100"' },
      { name: 'unit', label: 'Unit of measure', required: true, col: 6, value: p.unit || 'pc', placeholder: 'pc, set, box, liter', attrs: 'maxlength="20"' },
      { name: 'unit_cost', label: 'Unit Cost (₱)', type: 'money', required: true, col: 6, value: p.unit_cost ?? 0, help: 'Cost per unit, not total stock value.' },
      { name: 'reorder_level', label: 'Reorder Level', type: 'number', required: true, col: 6, value: p.reorder_level ?? 0, help: 'Low-stock alert threshold; 0 disables the alert.' },
      { name: 'warranty_info', label: 'Warranty Notes (optional)', col: 12, value: p.warranty_info,
        placeholder: 'Supplier warranty terms, if known. Actual coverage is confirmed during receiving.',
        attrs: 'maxlength="150"' },
      ], 'Purchasing.part_save', { extra: p.id ? { id: p.id } : {}, size: 'modal-lg', submit: p.id ? 'Save changes' : 'Add part',
        transform: ({ part_id_display, ...data }) => data,
        intro: p.id ? 'Update the verified item identity. Part ID and on-hand quantity will not change.' : 'Part ID is assigned automatically. New parts begin with 0 on hand; use actual specifications and the correct Part Type.' });
    };
    const partAct = (a, p) => a === 'edit' ? partForm(p) : a === 'count' ? PurUI.countForm(d, p) : null;
  return { reqActs, reqAct, poActs, poAct, partActs, partForm, partAct };
};

/* STOCK_COUNT_RECONCILIATION_V1 — physical count (Purchasing) -> review (Admin) -> one Adjustment movement.
   Data: Purchasing::read('inventory').counts; actions Purchasing.count_submit / count_review / count_details (server-checked). */
PurUI.countForm = (d, part) => {
  const parts = (d.parts || []).filter(p => +p.active);
  const sel = part ? part.id : '';
  const wrap = UI.modal('Record stock count', `<div class="stock-count-form">
    <p class="modal-intro">Record the physical count for a part. Stock remains unchanged until the Admin reviews and posts the adjustment.</p>
    <div class="stock-count-section-label">Part to count</div>
    ${UI.fields([{ name: 'part_id', label: 'Part Name', type: 'select', required: true, col: 6, value: sel,
      placeholder: 'Select an existing part…',
      options: [...parts].sort((a, b) => a.description.localeCompare(b.description)).map(p => [p.id, p.description]) },
      { name: 'part_code_display', label: 'Part ID', col: 6, value: part?.part_number || '',
        placeholder: 'Auto-filled on selection', attrs: 'readonly aria-readonly="true" tabindex="-1"',
        help: 'Automatically linked to the selected part.' }])}
    <div class="sc-figures" data-fig aria-live="polite"></div>
    <div class="stock-count-section-label">Physical count details</div>
    ${UI.fields([{ name: 'counted_qty', label: 'Actual quantity counted', type: 'number', required: true, col: 12,
      placeholder: 'Enter the number physically counted', attrs: 'min="0" max="100000" step="1"' },
      { name: 'reason', label: 'Reason for Stock Difference', required: true, col: 12,
        placeholder: 'Explain why the actual stock differs from the system', attrs: 'maxlength="255"' }])}
    <div class="stock-count-section-label">Supporting document (optional)</div>
    ${UI.fields([{ name: 'evidence', label: 'Photo or stock count sheet', type: 'file',
      multiple: true, col: 12, attrs: 'accept="application/pdf,image/png,image/jpeg"' }])}
    </div>`,
    async (x, form) => { const r = await App.apiForm('Purchasing.count_submit', { part_id: x.part_id, counted_qty: x.counted_qty, reason: x.reason }, form); UI.result(r); App.route(); },
    { submit: 'Submit for review', confirmBeforeSubmit: false, size: 'modal-lg' });
  wrap.classList.add('stock-count-modal');
  const f = (n) => wrap.querySelector(`[name="${n}"]`), fig = wrap.querySelector('[data-fig]');
  const show = () => {
    const p = parts.find(x => String(x.id) === f('part_id').value), raw = f('counted_qty').value;
    f('part_code_display').value = p ? p.part_number : '';
    if (!p) { fig.innerHTML = ''; return; }
    const open = (d.counts || []).find(c => +c.part_id === +p.id && c.status === 'Submitted');
    const diff = raw === '' ? null : Math.trunc(+raw) - +p.quantity_on_hand;
    fig.innerHTML = `<div class="sc-fig"><span>System quantity</span><b>${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)}</b></div>
      <div class="sc-fig"><span>Counted</span><b>${raw === '' ? '—' : UI.num(+raw) + ' ' + UI.esc(p.unit)}</b></div>
      <div class="sc-fig ${diff ? (diff < 0 ? 'is-short' : 'is-over') : ''}"><span>Stock Difference</span><b>${diff === null ? '—' : (diff > 0 ? '+' : '') + UI.num(diff)}</b>
        ${diff ? `<small>${UI.money(Math.abs(diff) * +p.unit_cost)} at the recorded unit cost</small>` : ''}</div>
      ${open ? `<div class="alert alert-warning py-1 px-2 small mb-0 w-100">${UI.esc(open.count_ref)} for this part is still waiting for review. Only one open count per part is allowed.</div>` : ''}
      ${diff === 0 ? '<div class="alert alert-success py-1 px-2 small mb-0 w-100">The count matches the system: nothing to reconcile.</div>' : ''}`;
  };
  f('part_id').addEventListener('change', show); f('counted_qty').addEventListener('input', show); show();
};
PurUI.countReview = (c, decision) => decision === 'post'
  ? UI.confirmAction('Post ' + UI.esc(c.count_ref), `Set <b>${UI.esc(c.part_number)}</b> from ${UI.num(c.system_qty)} to ${UI.num(c.counted_qty)} ${UI.esc(c.unit)}
      (${+c.variance > 0 ? '+' : ''}${UI.num(c.variance)}, ${UI.money(Math.abs(+c.variance_value))}). One stock adjustment is recorded with your name.
      If the stock changed after the count, posting is refused and the part must be counted again.`, 'Purchasing.count_review', { count_id: c.id, decision: 'post' },
      { submit: 'Post adjustment', fields: [{ name: 'notes', label: 'Review note (optional)', col: 12 }] })
  : UI.confirmAction('Reject ' + UI.esc(c.count_ref), 'The stock does not change. The Purchasing Officer is notified with your reason.', 'Purchasing.count_review',
      { count_id: c.id, decision: 'reject' }, { danger: true, submit: 'Reject count', fields: [{ name: 'notes', label: 'Reason', required: true, col: 12 }] });
PurUI.countActs = (c, can) => c.status === 'Submitted' && can.reviewCount && +c.counted_by !== +App.me.user.id
  ? UI.btn('post', 'Approve Stock Count', 'success') + UI.btn('reject', 'Reject Stock Count', 'outline-danger') : '';
PurUI.openCount = async (c, can) => {
  const seq = App.navSeq; let x; try { x = await App.api('Purchasing.count_details', { count_id: c.id }); } catch (e) { return UI.toast(e.message, 'error'); }
  if (seq !== App.navSeq) return;
  const k = x.count;
  const next = k.status === 'Submitted' ? ['admin', 'Admin', 'Review the count: post the adjustment or reject it'] : [null, k.status, k.status === 'Posted' ? 'Adjustment recorded in Stock Movements' : 'Rejected: the stock did not change'];
  const el = UI.drawer(UI.esc(k.count_ref), `${PurUI.nextBox(next)}
    ${UI.kv([['Status', UI.badge(k.status)], ['Part', `<b>${UI.esc(k.part_number)}</b> · ${UI.esc(k.description)}`],
      ['System quantity', UI.num(k.system_qty) + ' ' + UI.esc(k.unit)], ['Counted quantity', UI.num(k.counted_qty) + ' ' + UI.esc(k.unit)],
      ['Stock Difference', `<b>${+k.variance > 0 ? '+' : ''}${UI.num(k.variance)}</b> · ${UI.money(Math.abs(+k.variance_value))} at ${UI.money(k.unit_cost)} each`],
      ['Reason', UI.e(k.reason)], ['Counted by', UI.esc(k.counted_by_name) + ' · ' + UI.datetime(k.counted_at)],
      ['Review', k.reviewed_at ? UI.esc(k.reviewed_by_name) + ' · ' + UI.datetime(k.reviewed_at) + (k.review_notes ? `<div class="cell-sub">${UI.esc(k.review_notes)}</div>` : '') : 'Waiting for the Admin'],
      k.status === 'Posted' ? ['Posted change', UI.num(k.qty_before) + ' → ' + UI.num(k.qty_after) + ' ' + UI.esc(k.unit)] : null])}
    ${UI.h('Evidence')}${UI.docs(x.documents, 'No evidence file attached.')}
    <div class="d-flex flex-wrap gap-2 mt-3" data-cacts>${k.status === 'Submitted' && can.reviewCount && +k.counted_by !== +App.me.user.id
      ? UI.btn('post', 'Approve Stock Count', 'success') + UI.btn('reject', 'Reject Stock Count', 'outline-danger') : ''}</div>`, { subtitle: 'Stock count · ' + UI.esc(k.part_number) });
  PurUI.bindDrawerActions(el.querySelector('[data-cacts]'), k, (a, row) => PurUI.countReview(row, a));
};

/** Page toolbar button. */
PurUI.tool = (ctx, label, icon, fn, cls = 'btn-primary') => { const b = document.createElement('button'); b.className = 'btn btn-sm ' + cls; b.textContent = label; b.onclick = fn; ctx.tools.append(b); };
PurUI.prep = (ctx) => { PurUI.data = ctx.data; return { d: ctx.data, can: ctx.data.can, k: PurUI.kit(ctx.data, ctx.data.can) }; };
PurUI.waitingForMe = (d, can) => (d.orders || []).filter(o => o.status === 'Pending Approval' && ((o.approver_role === 'finance' && can.approveSmall) || (o.approver_role === 'admin' && can.approveBig)));

/* STAGE_B_PURCHASING_UI — who has the next step, derived only from the stored statuses and the approval routing
   (approver_role) of each record. No employee is named; the responsible role is the one the workflow rules assign. */
PurUI.poNext = (o) => {
  // Purchasing tracks physical parts, not Finance payment status.
  if (o.status === 'Pending Approval') return o.approver_role === 'finance' ? ['finance', 'Finance', 'Review Purchase Order'] : ['admin', 'Admin', 'Review Purchase Order'];
  if (o.status === 'Approved' && o.order_confirmation_required && !o.ordered_at) return ['purchasing', 'Purchasing', 'Confirm the supplier order was placed'];
  if (['Approved', 'Partially Received'].includes(o.status)) return ['purchasing', 'Purchasing', 'Receive the delivered parts'];
   if (/^Rejected/.test(o.status)) return [null, 'No one', 'Rejected: create a new PO if still needed'];
  return [null, 'Completed', o.status === 'Received' ? 'All ordered parts physically received' : 'Closed'];
};
PurUI.reqNext = (r) => {
  const pos = r.linked_pos || '';
  const openPo = /\((Pending Approval|Approved|Partially Received)\)/.test(pos);
  if (r.status === 'Requested') return ['purchasing', 'Purchasing', 'Release available parts'];
  if (['Partially Released', 'Not Available'].includes(r.status)) return openPo ? ['purchasing', 'Purchasing', 'Await delivery, then release parts'] : ['purchasing', 'Purchasing', 'Release parts or buy missing parts'];
  return [null, 'Completed', r.status === 'Released' ? 'All parts released' : 'Cancelled'];
};
PurUI.chip = ([role, who]) => {
  const me = role && UI.role(role);
  return `<span class="wait-chip ${role ? (me ? 'is-you' : '') : 'is-done'}">${UI.esc(me ? 'Your turn — ' + who : who)}</span>`;
};
PurUI.nextBox = (n) => `<div class="ws-next ${n[0] ? '' : 'is-done'}"><i class="bi ${n[0] ? 'bi-arrow-right-circle' : 'bi-check-circle'}" aria-hidden="true"></i><div><b>${n[0] ? 'Waiting for ' + UI.esc(n[1]) : UI.esc(n[1])}</b><div>${UI.esc(n[2])}</div></div></div>`;
PurUI.timeline = (rows) => (rows || []).length ? `<ul class="ws-timeline">${rows.map(h => `<li><b>${UI.esc(h.action.charAt(0).toUpperCase() + h.action.slice(1))}</b> · ${UI.esc(h.actor)}<div class="tl-when">${UI.datetime(h.created_at)}</div>${h.details ? `<div class="cell-sub">${UI.esc(h.details)}</div>` : ''}</li>`).join('')}</ul>` : '<div class="text-muted small">No activity recorded.</div>';
PurUI.bar = (done, total) => `${UI.num(done)} / ${UI.num(total)}<span class="qty-bar" aria-hidden="true"><span style="width:${total ? Math.min(100, Math.round(done / total * 100)) : 0}%"></span></span>`;
PurUI.bindDrawerActions = (root, row, onAct) => root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { UI.closeDrawer(); onAct(b.dataset.act, row); }));

/* PURCHASING_WORKFLOW_PROGRESS_V1 — read-only progress from actual persisted
   request/PO records. No invented delivery, approval dates or sample records. */
PurUI.waitingControl = (next, kind, id) =>
  `<button type="button" class="purchasing-waiting-link" data-purchasing-workflow="${UI.esc(kind)}" data-workflow-id="${UI.esc(id)}" aria-label="View full workflow progress">
    ${PurUI.chip(next)}<span class="cell-sub">${UI.esc(next[2])}</span><span class="purchasing-workflow-hint">View Steps</span>
  </button>`;

PurUI.progressStage = (label, state, at, note) => ({
  label, state, ...(at ? { at } : {}), ...(note ? { note } : {})
});

PurUI.showWorkflow = async (kind, id) => {
  try {
    if (kind !== 'request' && kind !== 'po') return;
    const data = await App.api(kind === 'request' ? 'Purchasing.request_details' : 'Purchasing.po_details',
      kind === 'request' ? { request_id:id } : { po_id:id });
    if (kind === 'request') {
      const r = data.request, lines = data.lines || [], linked = data.orders || [];
      const total = lines.reduce((sum, line) => sum + (+line.quantity || 0), 0);
      const released = lines.reduce((sum, line) => sum + (+line.released_qty || 0), 0);
      const reserved = lines.reduce((sum, line) => sum + (+line.reserved_qty || 0), 0);
      const pending = Math.max(0, total - released - reserved);
      const complete = r.status === 'Released';
      const cancelled = r.status === 'Cancelled';
      const stages = [
        PurUI.progressStage('Motorpool submitted the request', 'complete', r.created_at, 'Request recorded for '+r.plate_number),
        PurUI.progressStage('Inventory allocation', reserved > 0 || released > 0 ? 'complete' : cancelled ? 'exception' : 'current', null,
          UI.num(reserved)+' reserved · '+UI.num(pending)+' not yet reserved'),
        PurUI.progressStage('Purchasing released parts', released === total && total > 0 ? 'complete' : released > 0 ? 'current' : cancelled ? 'exception' : 'pending', null,
          UI.num(released)+' of '+UI.num(total)+' units physically released'),
        PurUI.progressStage('Request fulfilled', complete ? 'complete' : cancelled ? 'exception' : 'pending', null,
          complete ? 'All requested units released' : cancelled ? 'Request cancelled; no further release' : 'Still waiting for remaining parts')
      ];
      const linkedBlock = linked.length
        ? UI.h('Linked purchase orders (only when needed)') +
          `<div class="purchasing-workflow-links">${linked.map(po => `<div class="purchasing-workflow-po"><b>${UI.esc(po.po_ref)}</b> ${UI.badge(po.status)}<small>${UI.esc(po.supplier || 'Supplier not recorded')}</small></div>`).join('')}</div>`
        : '<p class="small text-muted mb-0">No linked purchase order. A parts request does not require a PO when inventory can supply it.</p>';
      UI.modal('Workflow progress · '+UI.esc(r.request_ref),
        UI.workflow(stages, {status:r.status, label:'Parts request workflow progress'}) +
        UI.h('Actual quantities') + UI.kv([['Requested',UI.num(total)],['Reserved',UI.num(reserved)],['Released',UI.num(released)],['Not yet reserved',UI.num(pending)]]) +
        linkedBlock + UI.h('Recorded processing') + UI.kv([
          ['Submitted', UI.datetime(r.created_at)],
          ['Last processed', r.processed_at ? UI.datetime(r.processed_at) : 'Not recorded'],
          ['Processed by', UI.e(r.processed_by_name)]
        ]) + (data.history && data.history.length ? UI.h('Recorded activity') + PurUI.timeline(data.history) : ''),
        null,{size:'modal-lg'});
    } else {
      const po = data.po, lines = data.lines || [];
      const total = lines.reduce((sum,line) => sum + (+line.quantity || 0), 0);
      const received = lines.reduce((sum,line) => sum + (+line.received_qty || 0), 0);
      const rejected = String(po.status).startsWith('Rejected');
      const closed = po.status === 'Closed';
      const approved = ['Approved','Partially Received','Received','Closed'].includes(po.status);
      const ordered = !!po.ordered_at;
      const legacy = !po.order_confirmation_required;
      const stages = [
        PurUI.progressStage('Purchasing submitted PO', 'complete', po.created_at),
        PurUI.progressStage('Finance / Admin approval', rejected ? 'exception' : approved ? 'complete' : 'current',
          po.decided_at, rejected ? 'Rejected: '+(po.decision_notes || 'Decision recorded') :
          (approved ? 'Approved by '+(po.approver_role === 'finance' ? 'Finance' : 'Admin') : 'Awaiting approval by '+(po.approver_role === 'finance' ? 'Finance' : 'Admin'))),
        PurUI.progressStage('Supplier order confirmed', ordered ? 'complete' : rejected ? 'exception' : legacy ? 'pending' : approved ? 'current' : 'pending',
          po.ordered_at, ordered ? 'Confirmed by Purchasing' :
          legacy ? 'Legacy PO — supplier order date not recorded' : 'Purchasing must confirm actual supplier order'),
        PurUI.progressStage('Physical delivery recorded', received >= total && total > 0 ? 'complete' :
          received > 0 ? 'current' : rejected || closed ? 'exception' : 'pending', null,
          UI.num(received)+' of '+UI.num(total)+' units recorded as physically received'),
        PurUI.progressStage('PO receiving finished', po.status === 'Received' ? 'complete' : closed ? 'exception' : 'pending', null,
          po.status === 'Received' ? 'All ordered units received' :
          closed ? 'PO closed; any undelivered balance was closed' : 'Receiving not yet complete')
      ];
      UI.modal('Workflow progress · '+UI.esc(po.po_ref),
        UI.workflow(stages,{status:po.status === 'Approved' && ordered ? 'Ordered' : po.status, label:'Purchase order workflow progress'}) +
        UI.h('Actual quantities') + UI.kv([
          ['Ordered quantity',UI.num(total)],['Received quantity',UI.num(received)],
          ['Awaiting delivery',UI.num(Math.max(0,total-received))],
          ['Linked Motorpool request', po.request_ref ? UI.esc(po.request_ref) : 'None — independent PO']
        ]) +
        (data.history && data.history.length ? UI.h('Recorded activity') + PurUI.timeline(data.history) : ''),
        null,{size:'modal-lg'});
    }
  } catch(err) { UI.toast(err.message || 'Unable to load recorded workflow progress.', 'error'); }
};

/* Event delegation survives paging/filtering when UI.table redraws rows. */
PurUI.bindWorkflowLinks = root => root.addEventListener('click', e => {
  const button = e.target.closest('[data-purchasing-workflow]');
  if (!button || !root.contains(button)) return;
  e.preventDefault();
  e.stopPropagation();
  PurUI.showWorkflow(button.dataset.purchasingWorkflow, button.dataset.workflowId);
});


/** Parts request drawer: summary, next step, lines (requested / released / outstanding / on hand), linked POs, activity. */
PurUI.openRequest = async (r, k) => {
  const seq = App.navSeq; const x = await App.api('Purchasing.request_details', { request_id: r.id }); const q = x.request;
  if (seq !== App.navSeq) return;   // WS_NAV_STATE_V1: the user moved on while loading; do not open on the new page
  const lines = x.lines.map(l => ({ ...l, outstanding: Math.max(0, l.quantity - l.released_qty) }));
  const short = lines.filter(l => l.outstanding > 0 && l.outstanding > (+l.quantity_on_hand || 0)).length;
  const html = `${PurUI.nextBox(PurUI.reqNext({ ...r, status: q.status }))}
    ${UI.kv([['Status', UI.badge(q.status)], ['Reserved units', UI.num(lines.reduce((sum, line) => sum + (+line.reserved_qty || 0), 0))], ['Truck', UI.e(q.plate_number) + (q.truck_number ? ' · ' + UI.esc(q.truck_number) : '')], ['Repair', UI.e(q.job_ref)], ['Purpose', UI.e(q.purpose)],
      ['Requested', UI.esc(q.requested_by_name) + ' · ' + UI.datetime(q.created_at)], ['Processed', q.processed_at ? UI.esc(q.processed_by_name || '') + ' · ' + UI.datetime(q.processed_at) : 'Not processed yet'],
      q.notes ? ['Notes', UI.esc(q.notes)] : null])}
    ${UI.h('Parts', short ? `<span class="badge-s red">${short} line(s) short in stock</span>` : '')}
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Part</th><th class="count-col">Requested</th><th class="count-col">Released</th><th class="count-col">Outstanding</th><th class="count-col">On hand</th></tr></thead>
    <tbody>${lines.map(l => `<tr><td><b>${UI.esc(l.part_number)}</b><div class="cell-sub">${PurUI.partLabel(l)}</div></td><td class="count-col">${UI.num(l.quantity)}</td><td class="count-col">${UI.num(l.released_qty)}</td>
      <td class="count-col">${l.outstanding ? `<b>${UI.num(l.outstanding)}</b>` : '0'}</td><td class="count-col">${UI.num(l.quantity_on_hand)} ${UI.esc(l.unit)}</td></tr>`).join('')}</tbody></table></div>
    ${UI.h('Linked purchase orders')}${(x.orders || []).length ? `<ul class="ws-trucks">${x.orders.map(o => `<li class="${UI.canGo('purchase_orders') ? 'clickable' : ''}" data-po="${o.id}" tabindex="0"><span><b>${UI.esc(o.po_ref)}</b> · ${UI.esc(o.supplier || '')}<div class="cell-sub">${UI.date(o.created_at)} · ${UI.money(o.total_amount)}</div></span><span>${UI.badge(o.status === 'Approved' && o.ordered_at ? 'Ordered' : o.status)}</span></li>`).join('')}</ul>` : '<div class="text-muted small">No purchase order is linked to this request.</div>'}
    ${UI.h('Activity')}${PurUI.timeline(x.history)}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.reqActs(r, true)}</div>`;
  const el = UI.drawer(UI.esc(q.request_ref), html, { subtitle: 'Parts request · ' + UI.esc(q.plate_number) });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  root.querySelectorAll('[data-po]').forEach(li => li.addEventListener('click', () => { if (UI.canGo('purchase_orders')) { UI.closeDrawer(); App.go('purchase_orders', { open: li.dataset.po }); } }));
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), r, k.reqAct);
};

/** Purchasing may finish an unknown warranty or correct supplier-confirmed terms later. */
PurUI.confirmWarranty = (batch, onSaved) => {
  const has = batch.warranty_status === 'With Warranty';
  const wrap = UI.modal('Update warranty · ' + UI.esc(batch.part_number || batch.description || 'Part'),
    UI.fields([
      { name:'status', label:'Warranty Status', type:'select', required:true, col:12,
        value:batch.warranty_status,
        options:[['Not Yet Confirmed','Not Yet Confirmed'],['With Warranty','With Warranty'],
          ['Pending Installation','Pending Installation'],['No Warranty','No Warranty']] },
      { name:'start_basis', label:'Start date basis', type:'select', col:12, value:batch.start_basis || '',
        options:[['','Choose basis'],['Delivery','Delivery date'],['Purchase','Purchase date'],
          ['Invoice','Invoice date'],['Installation','Installation date'],['Other','Other documented date']] },
      { name:'start', label:'Warranty Start Date', type:'date', col:6, value:batch.warranty_start },
      { name:'months', label:'Warranty Duration (months)', type:'number', col:6,
        value:batch.warranty_months || '', attrs:'min="1" max="120" step="1"' },
      { type:'html', col:12, html:'<div class="form-text">Use the actual supplier-confirmed start date. Changes are recorded in the audit history.</div>' }
    ]),
    async x => {
      const result = await App.api('Purchasing.warranty_confirm', { batch_id:batch.id, ...x });
      UI.result(result); if (onSaved) onSaved();
    }, { submit:'Save warranty', onShow: (wrap) => {
      const status = wrap.querySelector('[name="status"]');
      const update = () => {
        const covered = status.value === 'With Warranty';
        const pending = status.value === 'Pending Installation';
        for (const name of ['start_basis','start','months']) {
          const inp=wrap.querySelector('[name="'+name+'"]');
          const visible = name === 'months' ? (covered || pending) : covered;
          inp.disabled=!visible; inp.required=visible;
          const column=inp.closest('[class*="col-"]');
          if(column) column.hidden=!visible;
        }
      };
      status.addEventListener('change', update); update();
    }});
  return wrap;
};

/** Purchase order drawer: supplier, amounts (total / received / paid / balance), line progress, payments, documents, activity. */
PurUI.openPO = async (o, k) => {
  const seq = App.navSeq; const x = await App.api('Purchasing.po_details', { po_id: o.id }); const p = x.po;
  if (seq !== App.navSeq) return;   // WS_NAV_STATE_V1: the user moved on while loading; do not open on the new page
  const received = x.lines.reduce((a, l) => a + l.received_qty * l.unit_price, 0);
  const row = { ...o, ...p, received_value: received };
  const html = `${PurUI.nextBox(PurUI.poNext(row))}
    ${UI.kv([['Parts Status', UI.badge(p.status === 'Approved' && p.ordered_at ? 'Ordered' : p.status)], ['Supplier', `<b>${UI.esc(p.supplier)}</b>` + [p.supplier_contact, p.supplier_phone, p.supplier_email].filter(Boolean).map(v => `<div class="cell-sub">${UI.esc(v)}</div>`).join('') + (p.supplier_address ? `<div class="cell-sub">${UI.esc(p.supplier_address)}</div>` : '')],
      ['Purpose', UI.e(p.purpose)], ['Parts request', p.request_ref ? UI.esc(p.request_ref) : 'Not linked'],
      ['Requested', UI.esc(p.requested_by_name) + ' · ' + UI.datetime(p.created_at)],
      ['Approval', (p.approver_role === 'finance' ? 'Finance' : 'Admin') + (p.decided_at ? ' · ' + UI.esc(p.decided_by_name || 'System') + ' · ' + UI.datetime(p.decided_at) : ' · not decided yet') + (p.decision_notes ? `<div class="cell-sub">${UI.esc(p.decision_notes)}</div>` : '')],
      p.supplier_invoice_no ? ['Supplier invoice', UI.esc(p.supplier_invoice_no)] : null])}
    ${UI.h('Order details')}${UI.kv([['PO total', UI.money(p.total_amount)], ['Ordered with supplier', p.ordered_at ? UI.datetime(p.ordered_at) : (p.order_confirmation_required ? 'Not confirmed yet' : 'Legacy PO: no recorded order confirmation')], ['Received quantities', UI.num(x.lines.reduce((sum, line) => sum + (+line.received_qty || 0), 0)) + ' of ' + UI.num(x.lines.reduce((sum, line) => sum + (+line.quantity || 0), 0))]])}
    ${UI.h('Items')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Part</th><th>Received / ordered</th><th class="money-col">Unit price</th><th class="money-col">Amount</th></tr></thead>
    <tbody>${x.lines.map(l => `<tr><td><b>${UI.esc(l.part_number)}</b><div class="cell-sub">${PurUI.partLabel(l)}</div></td><td class="cell-nowrap">${PurUI.bar(+l.received_qty, +l.quantity)} ${UI.esc(l.unit)}</td><td class="money-col">${UI.money(l.unit_price)}</td><td class="money-col">${UI.money(l.line_total)}</td></tr>`).join('')}</tbody></table></div>
    ${(x.payments || []).length ? UI.h('Payments') + UI.table([['Voucher', 'voucher_number'], ['Released', 'released_on', 'date'], ['Method', 'payment_method'], ['Amount', 'amount', 'money']], x.payments, { plain: true }) : ''}
    ${UI.h('Warranty receipt batches')}
    ${UI.table([['Part','description'],['Quantity','received_qty','num'],['Warranty Status','warranty_status'],
      ['Start','warranty_start','date'],['Expires','warranty_expires','date'],
      ...(App.me?.user?.role === 'purchasing' ? [['Edit','id',v => '<button type="button" class="btn btn-sm btn-outline-secondary" data-warranty-batch="'+UI.esc(v)+'">Update</button>']] : [])],
      x.warrantyBatches || [], { plain:true, empty:'No warranty receipt records yet.' })}
    ${UI.h('Documents')}${UI.docs(x.documents)}
    ${UI.h('Activity')}${PurUI.timeline(x.history)}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.poActs(row, true)}</div>`;
  const el = UI.drawer(UI.esc(p.po_ref), html, { subtitle: 'Purchase order · ' + UI.esc(p.supplier) });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), row, k.poAct);
  root.querySelectorAll('[data-warranty-batch]').forEach(btn => btn.addEventListener('click', () => {
    const batch = (x.warrantyBatches || []).find(b => String(b.id) === btn.dataset.warrantyBatch);
    if (batch) PurUI.confirmWarranty(batch, () => PurUI.openPO(o, k));
  }));
};

/** Part drawer: stock figures, 90-day usage and the last 50 movements with their PO / request references. */
PurUI.openPart = async (pt, k) => {
  const seq = App.navSeq; const x = await App.api('Purchasing.part_history', { part_id: pt.id }); const p = x.part;
  if (seq !== App.navSeq) return;   // WS_NAV_STATE_V1: the user moved on while loading; do not open on the new page
  const html = `${UI.kv([['Part ID', UI.esc(p.part_number)], ['Part Type', UI.e(p.part_type) || 'Not classified'], ['Part Name / Specification', UI.esc(p.description)], ['Brand', UI.e(p.brand)], ['On hand', `<b>${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)}</b>` + (+p.low_stock ? ' <span class="badge-s red">Low stock</span>' : '')], ['Reserved', UI.num(p.reserved_qty || 0) + ' ' + UI.esc(p.unit)], ['Available', UI.num(p.available_qty ?? p.quantity_on_hand) + ' ' + UI.esc(p.unit)],
      ['Reorder level', UI.num(p.reorder_level)], ['Unit cost', UI.money(p.unit_cost)], ['Stock value', UI.money(p.stock_value)], ['Issued, last 90 days', UI.num(x.usage.issued_90d) + ' ' + UI.esc(p.unit) + ' in ' + UI.num(x.usage.issues_90d) + ' release(s)'],

      p.warranty_info ? ['Historical warranty note', UI.esc(p.warranty_info)] : null])}
    ${UI.h('Warranty receipt batches')}
    ${UI.table([['PO','po_ref'],['Quantity','received_qty','num'],['Warranty Status','warranty_status'],
      ['Start','warranty_start','date'],['Expires','warranty_expires','date'],
      ...(App.me?.user?.role === 'purchasing' ? [['Edit','id',v => '<button type="button" class="btn btn-sm btn-outline-secondary" data-warranty-batch="'+UI.esc(v)+'">Update</button>']] : [])],
      x.warrantyBatches || [], { plain:true, empty:'No warranty receipt records yet.' })}
    ${UI.h('Stock movements (latest 50)')}${UI.table([['Date and time', 'created_at', 'datetime'], ['Type', 'movement_type', 'badge'], ['Qty', 'quantity_delta', (v) => (v > 0 ? '+' : '') + UI.num(v)], ['Reference', 'reference', (v, m) => UI.e(v || m.reason)], ['Truck', 'plate_number'], ['By', 'actor']], x.movements, { plain: true, limit: 10, empty: 'No stock movement recorded.' })}
    <div class="d-flex flex-wrap gap-2 mt-3">${k.partActs(pt, true)}</div>`;
  const el = UI.drawer(UI.esc(p.description), html, { subtitle: 'Part ID · ' + UI.esc(p.part_number) });
  const root = el || document.querySelector('.offcanvas.app-drawer');
  PurUI.bindDrawerActions(root.querySelector('.d-flex.flex-wrap.gap-2.mt-3'), pt, k.partAct);
  root.querySelectorAll('[data-warranty-batch]').forEach(btn => btn.addEventListener('click', () => {
    const batch = (x.warrantyBatches || []).find(b => String(b.id) === btn.dataset.warrantyBatch);
    if (batch) PurUI.confirmWarranty({ ...batch, part_number:p.part_number }, () => PurUI.openPart(pt, k));
  }));
};

/** Opens the record named by ?open=<id> once (links from the Overview, notifications and other drawers). */
PurUI.openFromQuery = (ctx, rows, fn) => { const o = UI.takeQuery(ctx, 'open').open; if (!o) return; const r = rows.find(x => String(x.id) === String(o)); if (r) fn(r); else UI.toast('That record is not in this list.', 'warn'); };
/** Short attention-list panel used by the Purchasing Overview (same look as the Maintenance Overview lists). */
PurUI.list = (title, icon, items, empty, more) => `<section class="panel"><div class="panel-head"><h2 class="panel-title"><i class="bi ${icon} me-1" aria-hidden="true"></i>${UI.esc(title)} <span class="text-muted fw-normal">(${items.length})</span></h2>${more ? `<div class="panel-tools"><button type="button" class="btn btn-link btn-sm p-0" data-go="${UI.esc(more)}">View all</button></div>` : ''}</div>
  <div class="panel-body flush">${items.length ? `<ul class="mo-list mo-scroll">${items.join('')}</ul>` : `<div class="mo-empty">${UI.esc(empty)}</div>`}</div></section>`;
PurUI.item = (go, top, sub, side) => `<li class="mo-item clickable" data-go="${UI.esc(go)}" role="link" tabindex="0"><div class="mo-item-main"><div class="mo-item-top">${top}</div>${sub ? `<div class="mo-item-issue">${sub}</div>` : ''}</div><div class="mo-item-side">${side}</div></li>`;

const PurRef = {
  /** Move the existing URL-backed filters into the existing shared table toolbar.
   *  No duplicate inputs or new event handlers: UI.generalFilters remains authoritative. */
  inlineFilters(root, source = root) {
    const filters = source.querySelector('.ws-filters');
    const toolbar = root.querySelector('.ref-toolbar, .table-tools');
    if (!filters || !toolbar) return;
    toolbar.classList.add('purchasing-unified-toolbar');
    filters.classList.add('purchasing-inline-filters');
    const search = toolbar.querySelector('.table-search');
    if (search) search.insertAdjacentElement('afterend', filters);
    else toolbar.prepend(filters);
  },
  /** Shared Purchasing records hierarchy: Search + Filter + Sort above quick status tabs.
   * Existing URL filters, tab click handlers, and row actions are preserved. */
  recordLayout(ctx, box, { filters = [], sortOptions = [], sort = 'newest' } = {}) {
    // Operations record workspace: preserve existing table state, URL-backed filters,
    // permission-checked actions, row clicks and existing search input listeners.
    const toolbar = box.querySelector('.ref-toolbar, .table-tools');
    const search = toolbar?.querySelector('.table-search');
    if (!toolbar || !search) return;
    const heading = box.querySelector('.purchasing-ref-records-head');
    box.classList.add('record-workspace-panel', 'purchasing-operations-records');
    if (heading) {
      heading.classList.add('record-workspace-heading');
      const title = heading.querySelector('strong');
      const subtitle = heading.querySelector('small');
      if (title) {
        const h2 = document.createElement('h2');
        h2.textContent = title.textContent;
        title.replaceWith(h2);
      }
      if (subtitle) subtitle.classList.add('record-workspace-count');
      // Original detail subtitle remains accessible, but is not a competing heading.
      const note = heading.querySelector(':scope > span');
      if (note) note.classList.add('record-workspace-description');
      if (ctx.tools) {
        const buttons = [...ctx.tools.querySelectorAll(':scope > button')];
        if (buttons.length) {
          const actions = document.createElement('div');
          actions.className = 'purchasing-record-header-actions';
          buttons.forEach(button => actions.append(button));
          heading.append(actions);
        }
      }
    }
    const oldFilters = ctx.el.querySelector('.ws-filters');
    if (oldFilters) oldFilters.remove();
    const searchRow = document.createElement('div');
    searchRow.className = 'record-workspace-search';
    searchRow.append(search);
    // Preserve the table's original Reset, live count and grouping controls.
    const reset = toolbar.querySelector('.ref-reset, [data-treset]');
    if (reset) searchRow.append(reset);
    const groups = toolbar.querySelector('[data-group-controls]');
    if (groups) searchRow.append(groups);
    const liveCount = toolbar.querySelector('[data-tcount]');
    const subtitle = heading?.querySelector('.record-workspace-count');
    if (liveCount && subtitle) {
      subtitle.textContent = '';
      subtitle.append(liveCount);
    } else if (liveCount) searchRow.append(liveCount);
    [...toolbar.children].filter(el => el.matches('button')).forEach(button => searchRow.append(button));
    const filterWrap = document.createElement('div');
    filterWrap.className = 'purchasing-po-filter';
    filterWrap.innerHTML = UI.filterModal(ctx, filters, { hint: '' });
    filterWrap.querySelector('.ui-filter-toolbar > span:not(.filter-chip)')?.remove();
    searchRow.append(filterWrap);
    const sortWrap = document.createElement('label');
    sortWrap.className = 'purchasing-po-sort';
    const values = sortOptions.length ? sortOptions : [['newest', 'Newest first'], ['oldest', 'Oldest first']];
    sortWrap.innerHTML = `<i class="bi bi-sort-down" aria-hidden="true"></i><span>Sort</span>
      <select class="form-select form-select-sm" aria-label="Sort ${UI.esc(ctx.page.replace(/_/g, ' '))}">${values.map(([v, label]) =>
        `<option value="${UI.esc(v)}">${UI.esc(label)}</option>`).join('')}</select>`;
    const sortSelect = sortWrap.querySelector('select');
    sortSelect.value = sort;
    sortSelect.addEventListener('change', event => {
      const q = { ...ctx.query };
      if (event.target.value === values[0][0]) delete q.sort;
      else q.sort = event.target.value;
      App.go(ctx.page, q);
    });
    searchRow.append(sortWrap);
    // Replace, rather than nest, the legacy table toolbar: Operations hides
    // .table-tools inside record-workspace-panel by design.
    toolbar.replaceWith(searchRow);
    const tabs = ctx.el.querySelector('.purchasing-record-tabs-slot, .purchasing-po-tabs-slot');
    if (tabs) {
      tabs.classList.add('record-workspace-category-row', 'record-workspace-view-tabs');
      searchRow.insertAdjacentElement('afterend', tabs);
    }
  },
  sortRecords(rows, q, dateKey, referenceKey, amountKey) {
    const sort = ['newest', 'oldest', 'reference', 'amount_high', 'amount_low'].includes(q.sort) ? q.sort : 'newest';
    return [...rows].sort((a,b) => {
      if (sort === 'reference') return String(a[referenceKey] || '').localeCompare(String(b[referenceKey] || ''));
      if (sort === 'amount_high' && amountKey) return (+b[amountKey] || 0) - (+a[amountKey] || 0);
      if (sort === 'amount_low' && amountKey) return (+a[amountKey] || 0) - (+b[amountKey] || 0);
      const first = new Date(a[dateKey] || 0).getTime() || 0;
      const second = new Date(b[dateKey] || 0).getTime() || 0;
      return (sort === 'oldest' ? first - second : second - first)
        || String(a[referenceKey] || '').localeCompare(String(b[referenceKey] || ''));
    });
  },
  cards(items) { return UI.kpiTiles(items, 'ws-kpi4 purchasing-page-kpis'); },
  recordBox(box,title,subtitle,count) {
    box.classList.add('purchasing-records-card','purchasing-ref-records');
    box.insertAdjacentHTML('afterbegin',
      `<div class="purchasing-ref-records-head"><div><strong>${UI.esc(title)}</strong><small>${UI.num(count)} records</small></div><span>${UI.esc(subtitle)}</span></div>`);
    const body=document.createElement('div');body.className='purchasing-ref-records-body';box.append(body);return body;
  }
};
// ---------------------------------------------------------------- Purchasing Overview (landing page of the Purchasing Officer)
App.page('purchasing_overview', {
  title: 'Purchasing Dashboard',
  subtitle: 'Monitor parts requests, purchase orders and inventory.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1');
    const { d, can } = PurUI.prep(ctx), c = d.counts || {}, n = (k) => +c[k] || 0, b = d.budget || {}, st = d.poStatus && !Array.isArray(d.poStatus) ? d.poStatus : {};
    const expired = b.id && !+b.in_period;
    // UI_REFERENCE_V1: four KPI cards -> Quick actions -> left: Needs attention + Recent purchasing activity;
    // right: Purchase order status + Inventory alerts. Every row opens the real record or the filtered list.
    const tiles = [
      { label:'New Parts Requests', value:n('requests_open'), note:'Awaiting stock check', icon:'bi-box-arrow-up', go:'parts_requests?tab=todo', tone:'blue' },
      { label:'Requests for Follow-up', value:n('requests_followup'), note:'Partial release / unavailable', icon:'bi-clock-history', go:'parts_requests?tab=followup', tone:'amber' },
      { label:'POs Awaiting Approval', value:n('po_pending'), note:'Finance / Admin decision', icon:'bi-check2-square', go:'purchase_orders?tab=approval', tone:'purple' },
      { label:'Ready to Order', value:n('po_to_order'), note:'Approved, supplier order not yet placed', icon:'bi-cart-check', go:'purchase_orders?tab=ready', tone:'green' },
    ];
    const reqs = d.requests || [];
    const attention = [
      ...reqs.filter(r => r.status === 'Requested').map(r => UI.wsEntry('parts_requests?open=' + r.id, `<b>${UI.esc(r.request_ref)}</b> <span class="mo-ref">${UI.esc(r.plate_number)}${r.job_ref ? ' · ' + UI.esc(r.job_ref) : ''}</span>`,
        'Check stock and release · ' + UI.esc(r.items || ''), UI.badge(r.status))),
      ...(d.receiving || []).map(o => UI.wsEntry('purchase_orders?open=' + o.id, `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`,
        'Receive delivered items · ' + UI.money(o.total_amount), UI.badge(o.status))),
      ...(d.approvals || []).filter(o => o.status !== 'Pending Approval').map(o => UI.wsEntry('purchase_orders?open=' + o.id, `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`,
        'Rejected for insufficient budget on ' + UI.date(o.decided_at) + ': create a new PO if still needed', UI.badge(o.status))),
    ];
    const refGo = (m) => m.reference_type === 'purchase_order' ? 'purchase_orders?open=' + m.reference_id : m.reference_type === 'part_request' ? 'parts_requests?open=' + m.reference_id
      : m.reference_type === 'stock_count' ? 'inventory?view=counts&open=' + m.reference_id : 'stock_movements';
    const activity = (Array.isArray(d.activity) ? d.activity : []).map(m => UI.wsEntry(refGo(m), `<b>${UI.esc(m.movement_type)}</b> · ${UI.esc(m.part_number)} <span class="mo-ref">${+m.quantity_delta > 0 ? '+' : ''}${UI.num(m.quantity_delta)} ${UI.esc(m.unit)}</span>`,
      `${m.ref ? UI.esc(m.ref) + ' · ' : ''}${UI.esc(m.actor)} · ${UI.datetime(m.created_at)}`, ''));
    const budgetRej = (d.approvals || []).filter(o => o.status !== 'Pending Approval').length;
    const poRows = [
      UI.wsEntry('purchase_orders?tab=approval', '<b>Pending approval</b>', 'With Finance or the Admin', `<span class="badge-s ${+st.pending_approval ? 'blue' : 'gray'}">${UI.num(+st.pending_approval || 0)}</span>`),
      UI.wsEntry('purchase_orders?tab=receive', '<b>Awaiting delivery</b>', `Approved, not fully received${+st.partially_received ? ' · ' + UI.num(st.partially_received) + ' partially received' : ''}`, `<span class="badge-s ${+st.awaiting_delivery ? 'blue' : 'gray'}">${UI.num(+st.awaiting_delivery || 0)}</span>`),
      UI.wsEntry('purchase_orders?tab=ready', '<b>Ready to order</b>', 'Approved, awaiting Purchasing order confirmation', `<span class="badge-s ${+st.ready_to_order ? 'amber' : 'gray'}">${UI.num(+st.ready_to_order || 0)}</span>`),
      budgetRej ? UI.wsEntry('purchase_orders?tab=rejected', '<b>Rejected for budget</b>', 'In the last 30 days', `<span class="badge-s red">${UI.num(budgetRej)}</span>`) : '',
    ].filter(Boolean);
    const budgetFoot = b.id ? `Purchasing budget: <b>${UI.money(b.available)}</b> available of ${UI.money(b.amount)} (${UI.date(b.period_start)} – ${UI.date(b.period_end)})`
        + (expired ? '<div class="text-danger">The budget period has ended: Finance must set a new budget before POs can be approved.</div>'
          : +b.amount && (+b.spent_amount + +b.reserved_amount) / b.amount >= 0.8 ? `<div class="text-warning">${Math.round((+b.spent_amount + +b.reserved_amount) / b.amount * 100)}% of the budget is paid or reserved.</div>` : '')
      : 'No active purchasing budget: POs cannot be approved until Finance sets one.';
    const alerts = [
      ...(d.lowStock || []).map(p => UI.wsEntry('inventory?open=' + p.id, `<b>${UI.esc(p.part_number)}</b> <span class="mo-ref">${UI.esc(p.description)}</span>`,
        `On hand ${UI.num(p.quantity_on_hand)} ${UI.esc(p.unit)} · reorder level ${UI.num(p.reorder_level)}`, '<span class="badge-s red">Low stock</span>')),
      ...reqs.filter(r => r.status !== 'Requested').map(r => UI.wsEntry('parts_requests?open=' + r.id, `<b>${UI.esc(r.request_ref)}</b> <span class="mo-ref">${UI.esc(r.plate_number)}</span>`,
        'Outstanding shortage · ' + UI.esc(r.items || ''), UI.badge(r.status))),
    ];
    const incoming = (d.receiving || []).map(o => UI.wsEntry('purchase_orders?open=' + o.id,
      `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`,
      'Verify physical supplier delivery · ' + UI.money(o.total_amount), UI.badge(o.status)));
    const outstanding = reqs.filter(r => r.status !== 'Released' && r.status !== 'Cancelled');
    const requestsAction = outstanding.map(r => UI.wsEntry('parts_requests?open='+r.id,
      `<b>${UI.esc(r.request_ref)}</b> <span class="mo-ref">${UI.esc(r.plate_number)}</span>`,
      UI.esc(r.items || 'Check requested items'), UI.badge(r.status)));
    const poDependencies = [
      ...(d.approvals || []).filter(o=>o.status==='Pending Approval').map(o=>UI.wsEntry('purchase_orders?open='+o.id,
        `<b>${UI.esc(o.po_ref)}</b> <span class="mo-ref">${UI.esc(o.supplier || '')}</span>`,
        'Finance / Admin approval · ' + UI.money(o.total_amount), UI.badge(o.status))),

    ];
    ctx.el.innerHTML = `<div class="maint-overview mp-ws purchasing-dashboard-ref">${UI.kpiTiles(tiles,'ws-kpi4')}
      ${UI.quickBar([can.stock ? { label:'Process requests', icon:'bi-box-arrow-up', go:'parts_requests?tab=todo' } : null,
        can.stock ? { label:'New purchase order', icon:'bi-cart-plus', act:'newpo', primary:true } : null,
        { label:'Low-stock inventory', icon:'bi-exclamation-triangle', go:'inventory?stock=low' },
        { label:'Stock movements', icon:'bi-arrow-left-right', go:'stock_movements' }])}
      <div class="purchasing-ref-panels purchasing-content-columns">
        <div class="purchasing-content-column">
          ${UI.wsPanel('Parts Requests Needing Action','bi-box-seam', UI.wsList(requestsAction.slice(0,5),'No open parts requests.'), {cls:'ws-l1',count:outstanding.length,go:'parts_requests?tab=todo',goLabel:'View all'})}
          ${UI.wsPanel('Purchase Order Status','bi-cart-check',UI.wsList(poRows,'No outstanding POs.'),{cls:'ws-l2',go:'purchase_orders?tab=all',foot:budgetFoot})}
        </div>
        <div class="purchasing-content-column">
          ${UI.wsPanel('Receiving Queue','bi-box-arrow-in-down',UI.wsList(incoming.slice(0,5),'No deliveries to receive.'),{cls:'ws-r1',count:incoming.length,go:'purchase_orders?tab=receive',goLabel:'View all'})}
          ${UI.wsPanel('Stock Alerts','bi-exclamation-triangle',UI.wsList(alerts.slice(0,5),'No low-stock items or outstanding shortages.'),{cls:'ws-r2',count:alerts.length,go:'inventory?stock=low',goLabel:'View inventory'})}
        </div>
        ${UI.wsPanel('PO Approval Dependencies','bi-diagram-3',UI.wsList(poDependencies,'No external approvals pending.'),{cls:'purchasing-full-panel',go:'purchase_orders?tab=all',goLabel:'All POs'})}
      </div></div>`;
    ctx.el.querySelector('[data-qa="newpo"]')?.addEventListener('click', () => App.go('purchase_orders', { new: 1 }));
  },
});

// ---------------------------------------------------------------- Parts Requests (stock-out)
App.page('parts_requests', {
  title: 'Parts Requests',
  subtitle: 'Review requests and track parts availability.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1', 'purchasing-table-parts-requests');
    const { d, k } = PurUI.prep(ctx), q = ctx.query, all = d.requests || [];
    const TABS = { todo: ['To process', r => r.status === 'Requested'], followup: ['Follow up', r => ['Partially Released', 'Not Available'].includes(r.status)],
      released: ['Released', r => r.status === 'Released'], cancelled: ['Cancelled', r => r.status === 'Cancelled'], all: ['All', () => true] };
    const tab = TABS[q.tab] ? q.tab : 'todo';
    const cnt = (t) => all.filter(TABS[t][1]).length;
    const trucks = [...new Set(all.map(r => r.plate_number))].sort();
    const rows = PurRef.sortRecords(all.filter(TABS[tab][1]).filter(r => (!q.truck || r.plate_number === q.truck) && (!q.po || (q.po === 'linked' ? !!r.linked_pos : !r.linked_pos))), q, 'created_at', 'request_ref');
    // UI_REFERENCE_V1: status tabs with counts, compact filters with Reset, then the list (no separate KPI row).
    ctx.el.innerHTML = `<div class="purchasing-record-tabs-slot">${UI.statusTabs('parts_requests', q, 'tab', [['todo','To process',cnt('todo')], ['followup','Follow up',cnt('followup')], ['released','Released',cnt('released')], ...(tab === 'cancelled' ? [['cancelled','Cancelled',cnt('cancelled')]] : []), ['all','All',cnt('all')]], tab)}</div>`;
    ctx.el.insertAdjacentHTML('afterbegin', PurRef.cards([
      {label:'Total Requests',value:all.length,icon:'bi-clipboard-data'},
      {label:'To Process',value:cnt('todo'),icon:'bi-hourglass-split'},
      {label:'Follow Up',value:cnt('followup'),icon:'bi-exclamation-circle'},
      {label:'Released',value:cnt('released'),icon:'bi-check-circle'}
    ]));
    const box = document.createElement('div'); ctx.el.append(box);
    const target = PurRef.recordBox(box,'Parts Request Records','Motorpool requests and release progress',rows.length);
    const open = (r) => PurUI.openRequest(r, k);
    target.innerHTML = UI.table([
      ['Request', 'request_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(r.created_at)}</div>`],
      ['Truck / repair', 'plate_number', (v, r) => `${UI.esc(v)}${r.job_ref ? `<div class="cell-sub">${UI.esc(r.job_ref)}</div>` : ''}`],
      ['Parts', 'items', (v) => `<span class="cell-clamp" title="${UI.esc(v)}">${UI.esc(v)}</span>`],
      ['Released', 'released_units', (v, r) => `<span class="cell-nowrap">${PurUI.bar(+v, +r.requested_units)}</span>`],
      ['Reserved', 'reserved_units', 'num'],
      ['Status', 'status', 'badge'],
      ['Linked PO', 'linked_pos', (v) => v ? `<span class="cell-clamp">${UI.esc(v)}</span>` : '<span class="text-muted">None</span>'],
      ['Waiting for', 'status', (v, r) => PurUI.waitingControl(PurUI.reqNext(r), 'request', r.id)]], rows,
      { title: TABS[tab][0] + ' (' + rows.length + ')', showAllColumns: true, preserveTableWidth: true, directActions: true, limit: 10, groupBy: 'status', actions: (r) => k.reqActs(r), onAction: k.reqAct, rowClick: open,
        empty: 'No parts request in this list.' });
    PurRef.recordLayout(ctx, box, {
      filters: [{ name: 'truck', label: 'Truck', type: 'select', col: 12, options: trucks.map(truck => [truck, truck]) },
        { name: 'po', label: 'Linked PO', type: 'select', col: 12, options: [['linked', 'Has a linked PO'], ['none', 'No linked PO']] }],
      sortOptions: [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['reference', 'Request number']],
      sort: ['oldest', 'reference'].includes(q.sort) ? q.sort : 'newest'
    });
    PurUI.bindWorkflowLinks(box);
    PurUI.openFromQuery(ctx, all, open);
  },
});

// ---------------------------------------------------------------- Purchase Orders (stock-in)
App.page('purchase_orders', {
  title: 'Purchase Orders',
  subtitle: 'Follow approvals and received deliveries.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1', 'purchasing-table-purchase-orders');
    const { d, can, k } = PurUI.prep(ctx), q = ctx.query, all = d.orders || [];
    if (can.stock) PurUI.tool(ctx, 'Create Purchase Order', 'bi-cart-plus', () => PurUI.newPO());
    const TABS = { approval: ['Awaiting approval', o => o.status === 'Pending Approval'], ready: ['Ready to order', o => o.status === 'Approved' && o.order_confirmation_required && !o.ordered_at], receive: ['To receive', o => ['Approved', 'Partially Received'].includes(o.status) && (!o.order_confirmation_required || !!o.ordered_at)],
      done: ['Completed', o => ['Received', 'Closed'].includes(o.status)],
      rejected: ['Rejected', o => /^Rejected/.test(o.status)], all: ['All', () => true] };
    const mine = PurUI.waitingForMe(d, can);
    const cnt = (t) => all.filter(TABS[t][1]).length;
    // Default tab: what waits for this user; an empty 'To receive' list falls back to All.
    const tab = TABS[q.tab] ? q.tab : (mine.length ? 'approval' : (can.stock && cnt('ready') ? 'ready' : (can.stock && cnt('receive') ? 'receive' : 'all')));
    const suppliers = [...new Set(all.map(o => o.supplier).filter(Boolean))].sort();
    const sort = ['newest', 'oldest', 'po', 'amount_high', 'amount_low'].includes(q.sort) ? q.sort : 'newest';
    const rows = all.filter(TABS[tab][1]).filter(o => (!q.supplier || o.supplier === q.supplier)).sort((a, b) => {
      if (sort === 'po') return String(a.po_ref || '').localeCompare(String(b.po_ref || ''));
      if (sort === 'amount_high') return (+b.total_amount || 0) - (+a.total_amount || 0);
      if (sort === 'amount_low') return (+a.total_amount || 0) - (+b.total_amount || 0);
      const date = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      return (sort === 'oldest' ? date : -date) || String(a.po_ref || '').localeCompare(String(b.po_ref || ''));
    });
    // UI_REFERENCE_V1: status tabs with counts, compact filters with Reset, then the list (no separate KPI row).
    ctx.el.innerHTML = `<div class="purchasing-po-tabs-slot">${UI.statusTabs('purchase_orders', q, 'tab', [['approval','Awaiting approval',cnt('approval')], ['ready','Ready to order',cnt('ready')], ['receive','To receive',cnt('receive')], ['done','Completed',cnt('done')],
        ...(tab === 'rejected' ? [['rejected','Rejected',cnt('rejected')]] : []),
        ['all','All',cnt('all')]], tab)}</div>`;
    ctx.el.insertAdjacentHTML('afterbegin', PurRef.cards([
      {label:'Total Purchase Orders',value:all.length,icon:'bi-cart'},
      {label:'Awaiting Approval',value:cnt('approval'),icon:'bi-hourglass-split'},
      {label:'Ready to Order',value:cnt('ready'),icon:'bi-cart-check'},
      {label:'To Receive',value:cnt('receive'),icon:'bi-box-arrow-in-down'}
    ]));
    const box = document.createElement('div'); ctx.el.append(box);
    const target = PurRef.recordBox(box,'Purchase Order Records','Approval and receiving status',rows.length);
    const open = (o) => PurUI.openPO(o, k);
    target.innerHTML = UI.table([
      ['PO', 'po_ref', (v, o) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(o.created_at)}</div>`],
      ['Supplier', 'supplier', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`],
      ['Total', 'total_amount', 'money'],
      ['Parts Status', 'status', (v, o) => UI.badge(v === 'Approved' && o.ordered_at ? 'Ordered' : v)],
      ['Waiting for', 'status', (v, o) => PurUI.waitingControl(PurUI.poNext(o), 'po', o.id)]], rows,
      { title: TABS[tab][0] + ' (' + rows.length + ')', showAllColumns: true, preserveTableWidth: true, directActions: true, limit: 10, groupBy: 'status', actions: (o) => k.poActs(o), onAction: k.poAct, rowClick: open,
        empty: 'No purchase order in this list.' });
    const once = UI.takeQuery(ctx, 'new');
    if (once.new && can.stock) PurUI.newPO();
    PurRef.recordLayout(ctx, box, {
      filters: [{ name: 'supplier', label: 'Supplier', type: 'select', col: 12, options: suppliers.map(name => [name, name]) }],
      sortOptions: [['newest','Newest first'], ['oldest','Oldest first'], ['po','PO number'], ['amount_high','Highest amount'], ['amount_low','Lowest amount']],
      sort
    });
    PurUI.bindWorkflowLinks(box);
    PurUI.openFromQuery(ctx, all, open);
  },
});

// ---------------------------------------------------------------- Inventory
// What is on hand and what it is worth, plus physical stock counts (STOCK_COUNT_RECONCILIATION_V1).
// Stock changes only through PO receiving (stock in), parts-request release (stock out) or a posted stock count.
App.page('inventory', {
  title: 'Inventory',
  subtitle: 'See current stock and item availability.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1', 'purchasing-table-inventory');
    // Inventory Parts and Stock Counts are separate table layouts even when switching tabs.
    ctx.el.classList.remove('purchasing-inventory-parts-view');
    const { d, can, k } = PurUI.prep(ctx), q = ctx.query;
    if (can.stock) PurUI.tool(ctx, 'Add part', 'bi-plus-lg', () => k.partForm(), 'btn-outline-secondary');
    if (can.count && d.countsReady) PurUI.tool(ctx, 'Record stock count', 'bi-clipboard-check', () => PurUI.countForm(d));
    const parts = d.parts || [], active = parts.filter(p => +p.active), low = active.filter(p => +p.low_stock), out = active.filter(p => +(p.available_qty ?? p.quantity_on_hand) <= 0);
    const counts = d.counts || [], pending = counts.filter(c => c.status === 'Submitted');
    // Keep inventory-health KPIs; avoid summing incompatible part units
    // (pieces, liters, sets, etc.) into a misleading single quantity.
    const identityNotice = !d.partIdentityReady
      ? '<div class="alert alert-warning small">Part Type / Brand migration has not been applied to this database. Existing parts remain visible, but Add/Edit Part will be unavailable until the migration is installed.</div>' : '';
    const inventoryCards = PurRef.cards([
      {label:'Active Parts',value:active.length,note:'Active catalog entries',icon:'bi-box-seam',go:'inventory?stock=active'},
      {label:'Low / Out of Stock',value:low.length,note:'Parts at or below reorder level',icon:'bi-exclamation-triangle',go:'inventory?stock=low'},
      {label:'Stock Counts Awaiting Review',value:d.countsReady?pending.length:'—',note:'Submitted physical counts for Admin review',icon:'bi-clipboard-check',go:d.countsReady?'inventory?view=counts':undefined},
      {label:'Inventory Value',value:UI.money(active.reduce((v,p)=>v+(+p.stock_value||0),0)),note:'On-hand stock × recorded unit cost',icon:'bi-cash-coin'}
    ]);
    const view = q.view === 'counts' ? 'counts' : 'parts';
    const types = [...new Set(parts.map(p => p.part_type).filter(Boolean))].sort();
    const link = (extra) => 'inventory?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, ...extra }).filter(([, v]) => v)));
    // UI_REFERENCE_V1: stock tabs (?stock=) and the Stock counts tab (?view=counts) instead of a KPI row.
    const stockKey = view === 'counts' ? '' : (['low', 'out', 'inactive', 'all'].includes(q.stock) ? q.stock : 'active');
    const tabBtn = (spec, label, n, on) => `<button type="button" role="tab" aria-selected="${on}" class="tab ${on ? 'active' : ''}" data-go="${UI.esc(spec)}">${UI.esc(label)} <span class="tab-count">${UI.num(n)}</span></button>`;
    ctx.el.innerHTML = inventoryCards + identityNotice + `<div class="purchasing-record-tabs-slot"><div class="line-tabs ws-status-tabs no-print" role="tablist">
        ${tabBtn(link({ view: '', stock: '' }), 'Active parts', active.length, stockKey === 'active')}${tabBtn(link({ view: '', stock: 'low' }), 'Low stock', low.length, stockKey === 'low')}
        ${tabBtn(link({ view: '', stock: 'out' }), 'Out of stock', out.length, stockKey === 'out')}${tabBtn(link({ view: '', stock: 'inactive' }), 'Inactive', parts.length - active.length, stockKey === 'inactive')}
        ${d.countsReady ? tabBtn(link({ view: 'counts', part_type: '', category: '', stock: '' }), 'Stock counts', pending.length, view === 'counts') : ''}</div></div>
      <div class="small text-muted mb-2">Inventory value of active parts: <b>${UI.money(active.reduce((a, p) => a + +p.stock_value, 0))}</b> (on hand × recorded unit cost).
        ${d.countsReady && pending.length ? `${UI.num(pending.length)} stock count(s) wait for the Admin.` : ''}</div>
      ${d.countsReady ? '' : `<div class="alert alert-secondary small py-2"><i class="bi bi-lock me-1"></i> Direct stock adjustments are disabled. Stock changes only when a purchase order is received or parts are released.
        Physical count corrections need the stock count and review step (database update 2026-11-12_13, not applied yet).</div>`}`;
    const box = document.createElement('div'); ctx.el.append(box);
    box.classList.add('purchasing-records-card','purchasing-ref-records');
    box.insertAdjacentHTML('afterbegin', `<div class="purchasing-ref-records-head"><div><strong>${view === 'counts' ? 'Stock Count Records' : 'Inventory Records'}</strong><small>${UI.num(view === 'counts' ? counts.length : parts.length)} records</small></div><span>Availability and stock levels</span></div>`);
    const body = document.createElement('div'); body.className='purchasing-ref-records-body'; box.append(body);
    if (view === 'counts') {
      const st = ['Submitted', 'Posted', 'Rejected'].includes(q.count) ? q.count : '';
      const rows = PurRef.sortRecords(counts.filter(c => !st || c.status === st), q, 'counted_at', 'count_ref');
      body.innerHTML = UI.table([
          ['Count', 'count_ref', (v, c) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.datetime(c.counted_at)}</div>`],
          ['Part ID / Name', 'part_number', (v, c) => `<b>${UI.esc(v)}</b><div class="cell-sub cell-clamp">${UI.esc(c.description)}</div>`],
          ['System', 'system_qty', 'num'], ['Counted', 'counted_qty', 'num'],
          ['Stock Difference', 'variance', (v, c) => `<span class="cell-nowrap ${+v < 0 ? 'text-danger' : ''}"><b>${+v > 0 ? '+' : ''}${UI.num(v)}</b> ${UI.esc(c.unit)}</span><div class="cell-sub">${UI.money(Math.abs(+c.variance_value))}</div>`],
          ['Status', 'status', 'badge'],
          ['Waiting for', 'status', (v) => PurUI.chip(v === 'Submitted' ? ['admin', 'Admin'] : [null, 'Completed'])],
          ['Counted by', 'counted_by_name']], rows,
          { title: 'Stock counts (' + rows.length + ')', showAllColumns: true, directActions: true, limit: 10, actions: (c) => PurUI.countActs(c, can) + UI.btn('view', 'View Count', 'outline-primary'),
            onAction: (a, c) => a === 'view' ? PurUI.openCount(c, can) : PurUI.countReview(c, a), rowClick: (c) => PurUI.openCount(c, can),
            empty: 'No stock count recorded yet.' });
      PurRef.recordLayout(ctx, box, {
        filters: [{ name: 'count', label: 'Count status', type: 'select', col: 12, options: [['Submitted', 'Waiting for review'], ['Posted','Posted'], ['Rejected','Rejected']] }],
        sortOptions: [['newest','Newest first'], ['oldest','Oldest first'], ['reference','Count number']],
        sort: ['oldest','reference'].includes(q.sort) ? q.sort : 'newest'
      });
      const once = UI.takeQuery(ctx, 'open');
      if (once.open) { const c = counts.find(x => String(x.id) === String(once.open)); if (c) PurUI.openCount(c, can); }
      return;
    }
    // Keep Inventory table widths independent from the Stock Counts table.
    ctx.el.classList.add('purchasing-inventory-parts-view');
    const selectedType = q.part_type || '';
    const rows = parts.filter(p => (!selectedType || p.part_type === selectedType)
      && (stockKey === 'all' || (stockKey === 'low' ? +p.active && +p.low_stock : stockKey === 'out' ? +p.active && +(p.available_qty ?? p.quantity_on_hand) <= 0 : stockKey === 'inactive' ? !+p.active : +p.active)))
      .sort((a,b) => {
        if (q.sort === 'stock_high') return (+b.quantity_on_hand || 0) - (+a.quantity_on_hand || 0);
        if (q.sort === 'stock_low') return (+a.quantity_on_hand || 0) - (+b.quantity_on_hand || 0);
        if (q.sort === 'name') return String(a.description || '').localeCompare(String(b.description || ''));
        return String(a.part_number || '').localeCompare(String(b.part_number || ''));
      });
    const openCount = new Set(pending.map(c => +c.part_id));
    body.innerHTML = UI.table([
        ['Part ID', 'part_number', (v, p) => `<span class="cell-nowrap">${UI.esc(v)}</span>${+p.active ? '' : ' <span class="badge-s">Inactive</span>'}`],
        ['Part Type', 'part_type', (v) => v ? UI.esc(v) : '<span class="text-muted">Not classified</span>'],
        ['Part Name', 'description', (v, p) => {
          const expiry = p.earliest_warranty_expiry;
          const today = new Date(), date = [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
          const near = new Date(today.getFullYear(),today.getMonth(),today.getDate()+30);
          const limit = [near.getFullYear(),String(near.getMonth()+1).padStart(2,'0'),String(near.getDate()).padStart(2,'0')].join('-');
          const alert = expiry ? (expiry < date ? 'Expired warranty batch' : expiry <= limit ? 'Warranty expiring soon' : '') : '';
          return `<b class="cell-clamp">${UI.esc(v)}</b>${p.brand ? `<div class="cell-sub">${UI.esc(p.brand)}</div>` : ''}`
            + (alert ? `<div class="cell-sub"><span class="badge-s ${expiry < date ? 'red' : 'amber'}" title="Earliest recorded warranty expiry: ${UI.esc(expiry)}">${alert}</span></div>` : '');
        }],
        ['On hand', 'quantity_on_hand', (v, p) => `<div class="purchasing-stock-cell"><span class="purchasing-stock-amount"><b>${UI.num(v)}</b> ${UI.esc(p.unit)}</span>${+p.low_stock || openCount.has(+p.id) ? `<span class="purchasing-stock-badges">${+p.low_stock ? '<span class="badge-s red">Low</span>' : ''}${openCount.has(+p.id) ? '<span class="badge-s amber" title="A stock count is waiting for review">Count pending</span>' : ''}</span>` : ''}</div>`],
        ['Reserved', 'reserved_qty', 'num'], ['Available', 'available_qty', 'num'],
        ['Reorder level', 'reorder_level', 'num'], ['Unit cost', 'unit_cost', 'money'], ['Stock value', 'stock_value', 'money']], rows,
        { title: ({ active: 'Active parts', low: 'Low stock', out: 'Out of stock', inactive: 'Inactive parts', all: 'All parts' }[stockKey]) + ' (' + rows.length + ')', showAllColumns: true, preserveTableWidth: true, directActions: true, limit: 10, groupBy: 'part_type', groupLabel: 'Part type', actions: (p) => k.partActs(p) + UI.btn('view', 'View Part', 'outline-primary'),
          onAction: (a, p) => a === 'view' ? PurUI.openPart(p, k) : k.partAct(a, p), rowClick: (p) => PurUI.openPart(p, k), empty: 'No part matches.' });
    PurRef.recordLayout(ctx, box, {
      filters: [{ name: 'part_type', label: 'Part Type', type: 'select', col: 12, options: types.map(type => [type, type]) }],
      sortOptions: [['reference','Part ID'], ['name','Part Name'], ['stock_high','Highest on-hand'], ['stock_low','Lowest on-hand']],
      sort: ['name','stock_high','stock_low'].includes(q.sort) ? q.sort : 'reference'
    });
    PurUI.openFromQuery(ctx, parts, (p) => PurUI.openPart(p, k));
  },
});

// ---------------------------------------------------------------- Stock Movements
App.page('stock_movements', {
  title: 'Stock Movements',
  subtitle: 'Review stock changes and their source transactions.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1', 'purchasing-table-stock-movements');
    const { d } = PurUI.prep(ctx), q = ctx.query, all = d.movements || [];
    const parts = [...new Set(all.map(m => m.part_number))].sort();
    const rows = PurRef.sortRecords(all.filter(m => (!q.type || m.movement_type === q.type) && (!q.part || m.part_number === q.part)
      && (!q.from || String(m.created_at).slice(0, 10) >= q.from) && (!q.to || String(m.created_at).slice(0, 10) <= q.to)), q, 'created_at', 'part_number');
    const sum = (t) => rows.filter(m => m.movement_type === t).reduce((a, m) => a + Math.abs(+m.quantity_delta), 0);
    const val = (t) => rows.filter(m => m.movement_type === t).reduce((a, m) => a + Math.abs(+m.quantity_delta) * +m.unit_cost, 0);
    // UI_REFERENCE_V1: movement-type tabs (?type=) with counts, filters with Reset, and a one-line total that follows the filters.
    const base = all.filter(m => (!q.part || m.part_number === q.part) && (!q.from || String(m.created_at).slice(0, 10) >= q.from) && (!q.to || String(m.created_at).slice(0, 10) <= q.to));
    const types = ['Stock In', 'Stock Out', 'Adjustment'];
    ctx.el.innerHTML = `<div class="purchasing-record-tabs-slot">${UI.statusTabs('stock_movements', q, 'type', [['', 'All', base.length], ['Stock In', 'Stock In', base.filter(m => m.movement_type === 'Stock In').length],
        ['Stock Out','Stock Out',base.filter(m => m.movement_type === 'Stock Out').length],
        ...(q.type === 'Adjustment' ? [['Adjustment','Adjustment',base.filter(m => m.movement_type === 'Adjustment').length]] : [])], types.includes(q.type) ? q.type : '')}</div>
      <div class="small text-muted mb-2">Shown: stock in <b>${UI.num(sum('Stock In'))}</b> units (${UI.money(val('Stock In'))}) · stock out <b>${UI.num(sum('Stock Out'))}</b> units (${UI.money(val('Stock Out'))})
        · ${UI.num(rows.filter(m => m.movement_type === 'Adjustment').length)} adjustment(s). Values use the unit cost recorded on each movement.</div>`;
    ctx.el.insertAdjacentHTML('afterbegin', PurRef.cards([
      {label:'Total Movements',value:base.length,icon:'bi-arrow-left-right'},
      {label:'Stock In',value:base.filter(m=>m.movement_type==='Stock In').length,icon:'bi-box-arrow-in-down'},
      {label:'Stock Out',value:base.filter(m=>m.movement_type==='Stock Out').length,icon:'bi-box-arrow-up'},
      {label:'Adjustments',value:base.filter(m=>m.movement_type==='Adjustment').length,icon:'bi-clipboard-check'}
    ]));
    const box = document.createElement('div'); ctx.el.append(box);
    const target = PurRef.recordBox(box,'Stock Movement Records','Stock in, stock out and adjustments',rows.length);
    const ref = (m) => m.reference_type === 'purchase_order' ? 'purchase_orders?open=' + m.reference_id : m.reference_type === 'part_request' ? 'parts_requests?open=' + m.reference_id
      : m.reference_type === 'stock_count' ? 'inventory?view=counts&open=' + m.reference_id : '';
    const refLabel = { purchase_order: ['View Purchase Order', ''], part_request: ['View Parts Request', ''], stock_count: ['View Stock Count', ''] };
    target.innerHTML = UI.table([
      ['Date and time', 'created_at', 'datetime'],
      ['Part', 'part_number', (v, m) => `<b>${UI.esc(v)}</b><div class="cell-sub cell-clamp">${UI.esc(m.description)}</div>`],
      ['Type', 'movement_type', 'badge'], ['Qty', 'quantity_delta', (v) => `<span class="cell-nowrap">${v > 0 ? '+' : ''}${UI.num(v)}</span>`],
      ['Reason', 'reason', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`], ['Truck', 'plate_number'], ['By', 'actor']], rows,
      { title: 'Movements (' + rows.length + ')', showAllColumns: true, directActions: true, limit: 10,
        actions: (m) => ref(m) && UI.canGo(ref(m)) ? UI.btn('ref', refLabel[m.reference_type][0], 'outline-primary') : '',
        onAction: (a, m) => UI.goTo(ref(m)), empty: 'No stock movement matches.' });
    PurRef.recordLayout(ctx, box, {
      filters: [{ name: 'part', label: 'Part', type: 'select', col: 12, options: parts.map(part => [part, part]) },
        { name: 'from', label: 'From date', type: 'date', col: 6 },
        { name: 'to', label: 'To date', type: 'date', col: 6 }],
      sortOptions: [['newest', 'Newest first'], ['oldest','Oldest first'], ['reference','Part ID']],
      sort: ['oldest','reference'].includes(q.sort) ? q.sort : 'newest'
    });
  },
});

// ---------------------------------------------------------------- Purchasing Reports (PURCHASING_ANALYTICS_V1, PURCHASING_REPORTS_V2)
// KPIs · Stock movement value (two-line chart; a point opens a floating period popover) · Most used parts (+ replenishment
// suggestions) · Orders & stock summary (six metrics, each with a traceable details drawer that reconciles to the figure).
// Data: Analytics -> Purchasing::analytics (SQL over recorded transactions; rules in Purchasing::partRules / flowRules).
// Nothing on this page writes.
const PurReport = {
  charts: [],
  sug(items, empty) {
    return items && items.length ? `<ul class="ws-sug">${items.map(x => `<li>${UI.esc(x.text)}${x.go && UI.canGo(x.go) ? ` <button type="button" class="btn btn-link btn-sm" data-go="${UI.esc(x.go)}">${UI.esc(x.label || 'Open')}</button>` : ''}</li>`).join('')}</ul>`
      : `<div class="ws-sug-empty">${UI.esc(empty)}</div>`;
  },
  ref(m) { return m.reference_type === 'purchase_order' ? 'purchase_orders?open=' + m.reference_id : m.reference_type === 'part_request' ? 'parts_requests?open=' + m.reference_id : ''; },
  /** Details drawer: basis text, source records, and the total that equals the summary figure. */
  drawer(title, basis, tableHtml, totalLabel, total) {
    UI.drawer(UI.esc(title), `<p class="small text-muted mb-2">${basis}</p>${tableHtml}
      <div class="mr-recon"><span>${UI.esc(totalLabel)}</span><b>${total}</b></div>`, { subtitle: 'How this figure is calculated' });
  },
};

App.page('purchasing_reports', {
  title: 'Purchasing Reports',
  subtitle: 'Stock, parts consumption and purchasing activity.',
  render(ctx) {
    ctx.el.classList.add('purchasing-live-v1');
    PurReport.charts.forEach(ch => { try { ch.destroy(); } catch { /* gone */ } }); PurReport.charts = [];
    const d = ctx.data, per = d.period || {}, b = d.buckets || [], flow = d.flow || null, det = d.detail || {};
    const unit = { day: 'day', week: 'week', month: 'month' }[d.granularity] || 'period';
    const mv = Object.fromEntries((d.movements || []).map(m => [m.movement_type, m]));
    const m = (t, k) => +(mv[t]?.[k] || 0);
    const sp = d.spend || {}, sn = d.stockNow || {}, oo = d.openOrders && !Array.isArray(d.openOrders) ? d.openOrders : {};
    const recs = d.recommendations || [], short = d.shortRequests || [], follow = d.followUp || [], counts = d.countsPending || [], ledger = d.ledger || [];
    const lowN = recs.filter(r => r.rule === 'reorder').length;
    const link = (go, label) => UI.canGo(go) ? ` <button type="button" class="btn btn-link btn-sm" data-go="${UI.esc(go)}">${UI.esc(label)}</button>` : '';
    const range = `from=${per.from}&to=${per.to}`;
    const tiles = [
      { label: 'Inventory value', value: UI.money(sn.value), note: `${UI.num(sn.units)} units in ${UI.num(sn.parts)} active parts (now)`, tone: 'gray', go: 'inventory' },
      { label: 'Low stock items', value: UI.num(lowN), note: 'at or below the reorder level (now)', tone: lowN ? 'red' : 'gray', go: 'inventory?stock=low' },
      { label: 'Parts released', value: UI.num(m('Stock Out', 'units')) + ' units', note: UI.money(m('Stock Out', 'value')) + ' issued to repairs in the period', tone: 'gray', go: 'stock_movements?type=Stock Out&' + range },
      { label: 'Pending orders', value: UI.num((+oo.pending || 0) + (+oo.receiving || 0)), note: `now · ${UI.num(+oo.pending || 0)} awaiting approval · ${UI.num(+oo.receiving || 0)} to receive`, tone: (+oo.pending || 0) + (+oo.receiving || 0) ? 'amber' : 'gray', go: 'purchase_orders?tab=' + (+oo.pending ? 'approval' : 'receive') },
    ];

    // ---- stock movement value chart (left) and Most used parts (right)
    const hasFlow = flow && (flow.in.some(Number) || flow.out.some(Number));
    const chartBody = !flow ? '<div class="mo-empty text-danger">The stock movements could not be loaded.</div>'
      : hasFlow ? `<div class="mr-chart pr-chart"><canvas id="prFlow" tabindex="0" aria-label="Stock in and stock out value by ${unit}. Use the left and right arrow keys to choose a ${unit} and Enter to open its details."></canvas></div>
          <div class="mr-note">Value = quantity × unit cost recorded on each movement (receipts from POs, releases to parts requests). Select a point to see that ${unit}'s transactions.</div>`
      : '<div class="mo-empty"><i class="bi bi-bar-chart"></i> No stock was received or issued in this period.</div>';
    const flowTips = [
      ...follow.map(o => ({ text: `${o.po_ref} (${o.supplier || ''}) was approved ${o.days} days ago and is not fully received: follow up the delivery.`, go: 'purchase_orders?open=' + o.id, label: 'Open PO' })),
      ...short.map(r => ({ text: `${r.request_ref} for ${r.plate_number} is still waiting for parts${+r.open_pos ? '; its purchase order is not fully delivered yet.' : ' and has no purchase order yet.'}`, go: 'parts_requests?open=' + r.id, label: 'Open request' })),
      ...counts.map(c => ({ text: `${c.count_ref} (${c.part_number}) is waiting for the Admin's review.`, go: 'inventory?view=counts&open=' + c.id, label: 'Open count' })),
      ...ledger.map(l => ({ text: `${l.part_number}: on hand does not match its recorded movements. Investigate before any count is posted.`, go: 'inventory?open=' + l.id, label: 'Part' })),
    ];
    const top = (d.topUsed || []).slice(0, 6);
    const rank = UI.wsRank(top.map(p => ({ label: p.part_number, sub: `${p.description} · on hand ${UI.num(p.quantity_on_hand)}`, value: +p.units, display: UI.num(p.units) + ' ' + (p.unit || ''), go: 'inventory?open=' + p.id })),
      'No part was released in this period.');

    // ---- Orders & stock summary: six figures, each with its details drawer
    const unrec = det.outstanding || [], shortLines = det.shortLines || [], sup = (d.bySupplier || [])[0];
    const sumCards = [
      ['approved', 'POs approved in the period', UI.money(sp.approved), `${UI.num(sp.approved_n)} PO(s) · period`],
      ['received', 'Received into stock', UI.money(d.received), 'period'],
      ['paid', 'Paid on those POs', UI.money(sp.paid), 'to date, POs approved in the period'],
      ['outstanding', 'Ordered, not yet received', UI.money(unrec.reduce((a, o) => a + +o.value, 0)), `now · ${UI.num(new Set(unrec.map(o => o.id)).size)} PO(s)`],
      ['short', 'Requests short of stock', UI.num(short.length), 'now'],
      ['supplier', 'Top supplier in the period', sup ? UI.esc(sup.supplier) : 'None', sup ? UI.money(sup.total) + ' approved' : 'period'],
    ];
    const summary = `<div class="pr-sum">${sumCards.map(([k, l, v, n]) => `<div class="pr-sum-card"><span>${UI.esc(l)}</span><b title="${UI.esc(String(v).replace(/<[^>]+>/g, ''))}">${v}</b><small>${UI.esc(n)}</small>
      <button type="button" class="btn btn-link btn-sm p-0" data-sum="${k}" aria-label="Details: ${UI.esc(l)}">Details</button></div>`).join('')}</div>`;

    ctx.el.innerHTML = `${UI.wsPeriod('purchasing_reports', per)}${UI.kpiTiles(tiles, 'ws-kpi4')}
      <div class="ws-grid2 ws-report-row">
        ${UI.wsPanel('Stock in vs stock out', 'bi-graph-up', chartBody, { cls: 'ws-l1', tipHtml: PurReport.sug(flowTips, 'No delivery, shortage or stock difference needs follow-up.') })}
        ${UI.wsPanel('Most used parts', 'bi-trophy', rank, { cls: 'ws-r1', tipHtml: PurReport.sug(d.partTips, 'No part is low on stock right now.'), foot: 'Units released to repairs in the period.' })}
      </div>
      ${UI.wsPanel('Orders & stock summary', 'bi-clipboard-data', summary, { go: 'purchase_orders?tab=all', goLabel: 'Open records',
        foot: 'Approvals, receipts and payments describe the same orders at different stages; they are not added together.' })}`;
    UI.bindTips(ctx.el); UI.bindPeriod(ctx.el);

    // ---- summary details drawers (each total equals the figure shown)
    const T = (cols, rows, empty) => UI.table(cols, rows, { plain: true, limit: 5, empty });
    const poCol = ['PO', 'po_ref', (v, r) => `<b>${UI.esc(v)}</b>`];
    ctx.el.querySelectorAll('[data-sum]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.sum, period = UI.date(per.from) + ' – ' + UI.date(per.to);
      if (k === 'approved') PurReport.drawer('POs approved in the period', `Purchase orders approved (status Approved, Partially Received, Received or Closed) with an approval date from ${period}. Value = approved PO total.`,
        T([poCol, ['Supplier', 'supplier'], ['Approved', 'decided_at', 'date'], ['Status', 'status', 'badge'], ['Approved value', 'total_amount', 'money']], det.approved || [], 'No PO was approved in this period.'),
        `Total of ${UI.num((det.approved || []).length)} PO(s)`, UI.money((det.approved || []).reduce((a, o) => a + +o.total_amount, 0)));
      if (k === 'received') { const rows = (flow ? flow.moves.flat() : []).filter(x => x.movement_type === 'Stock In');
        PurReport.drawer('Received into stock', `Stock In movements recorded from ${period}. Value = quantity received × unit cost recorded on the movement.`,
          T([['Movement', 'id', (v, r) => '#' + v + `<div class="cell-sub">${UI.datetime(r.created_at)}</div>`], ['PO', 'ref'], ['Part', 'part_number'], ['Qty', 'qty', (v, r) => UI.num(v) + ' ' + UI.esc(r.unit)], ['Unit cost', 'unit_cost', 'money'], ['Value', 'value', 'money']], rows, 'No stock was received in this period.'),
          `Total of ${UI.num(rows.length)} receipt(s)`, UI.money(rows.reduce((a, x) => a + +x.value, 0))); }
      if (k === 'paid') {
        const pays = det.payments;
        PurReport.drawer('Paid on those POs', `Amount paid to date on the POs approved from ${period} (payments recorded by Finance).`
            + (pays ? '' : ' Payment vouchers are visible to Finance, Admin and Audit; the paid amount per PO is shown here.'),
          (pays ? T([['Voucher', 'voucher_number'], ['PO', 'po_ref'], ['Paid on', 'released_on', 'date'], ['Method', 'payment_method'], ['Amount', 'amount', 'money']], pays, 'No payment recorded.') : '')
            + T([poCol, ['Supplier', 'supplier'], ['Payment status', 'payment_status', 'badge'], ['Paid to date', 'paid_amount', 'money']], det.paidPos || [], 'No payment recorded on these POs.'),
          'Total paid', UI.money((det.paidPos || []).reduce((a, o) => a + +o.paid_amount, 0)));
      }
      if (k === 'outstanding') PurReport.drawer('Ordered, not yet received', 'Current snapshot: approved or partially received POs, per line still to be delivered. Remaining value = outstanding quantity × PO unit price.',
        T([poCol, ['Part', 'part_number'], ['Ordered', 'quantity', 'num'], ['Received', 'received_qty', 'num'], ['Outstanding', 'outstanding', (v, r) => UI.num(v) + ' ' + UI.esc(r.unit)], ['Remaining value', 'value', 'money']], unrec, 'Every approved PO is fully received.'),
        `Total of ${UI.num(unrec.length)} line(s)`, UI.money(unrec.reduce((a, o) => a + +o.value, 0)));
      if (k === 'short') PurReport.drawer('Requests short of stock', 'Current snapshot: partially released or not-available requests with a line needing more than is on hand now. Shortage = still required − available.',
        T([['Request', 'request_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.esc(r.plate_number)}</div>`], ['Part', 'part_number'], ['Required', 'required', 'num'], ['Available', 'available', 'num'], ['Shortage', 'shortage', (v, r) => UI.num(v) + ' ' + UI.esc(r.unit)], ['Linked PO', 'linked_po', (v) => v ? UI.esc(v) : '<span class="text-muted">None</span>']], shortLines, 'No request is short of stock.'),
        'Requests', UI.num(new Set(shortLines.map(x => x.id)).size));
      if (k === 'supplier') PurReport.drawer('Top supplier in the period', `Supplier with the highest approved PO value (approval date from ${period}).` + (sup ? ` ${UI.esc(sup.supplier)}: its qualifying POs are listed.` : ''),
        T([poCol, ['Approved', 'decided_at', 'date'], ['Status', 'status', 'badge'], ['Approved value', 'total_amount', 'money']], det.topSupplier || [], 'No PO was approved in this period.'),
        `Total of ${UI.num((det.topSupplier || []).length)} PO(s)`, UI.money((det.topSupplier || []).reduce((a, o) => a + +o.total_amount, 0)));
    }));

    const pr = document.createElement('button'); pr.className = 'btn btn-sm btn-outline-secondary'; pr.innerHTML = '<i class="bi bi-printer"></i> Print';
    pr.onclick = () => UI.print(`<h2>Purchasing Reports</h2><div>${UI.date(per.from)} – ${UI.date(per.to)}</div>` + ctx.el.innerHTML);
    ctx.tools.append(pr);

    // ---- chart
    const cv = ctx.el.querySelector('#prFlow');
    if (!cv || typeof Chart === 'undefined') return;
    const colors = ['#2f7d57', '#d97706'];
    const chart = new Chart(cv, { type: 'line',
      data: { labels: b.map(x => x.short), datasets: [['Stock in (received)', flow.in], ['Stock out (issued)', flow.out]].map(([label, data], j) => ({ label, data, borderColor: colors[j], backgroundColor: colors[j],
        borderWidth: 2, pointRadius: b.length > 40 ? 2 : 3, pointHoverRadius: 6, tension: 0, fill: false })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => UI.compactMoney(v) }, title: { display: true, text: 'Value (PHP)' } }, x: { ticks: { autoSkip: true, maxRotation: 0 } } },
        plugins: { legend: { position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 18, boxHeight: 3, padding: 14, font: { size: 12 } } },
          tooltip: { callbacks: { title: (it) => b[it[0].dataIndex] ? b[it[0].dataIndex].label : '', label: (it) => `${it.dataset.label}: ${UI.money(it.raw)}` } } },
        onClick: (evt, els, ch) => { const hit = ch.getElementsAtEventForMode(evt, 'index', { intersect: false }, false); if (hit.length) openPoint(hit[0].index); } } });
    PurReport.charts.push(chart);
    const pointRect = (i) => () => { const r = cv.getBoundingClientRect(), ms = [0, 1].map(j => chart.getDatasetMeta(j)).filter(mm => !mm.hidden && mm.data[i]);
      const x = ms.length ? ms[0].data[i].x : chart.chartArea.left, y = ms.length ? Math.min(...ms.map(mm => mm.data[i].y)) : chart.chartArea.top;
      return { left: r.left + x, right: r.left + x, top: r.top + y - 6, bottom: r.top + y + 6 }; };
    const list = (rows, empty) => rows.length ? `<ul class="pr-moves">${rows.slice(0, 6).map(x => { const g = PurReport.ref(x), ok = g && UI.canGo(g);
        return `<li${ok ? ` class="clickable" data-go="${UI.esc(g)}" role="link" tabindex="0"` : ''}><span><b>${UI.esc(x.ref || '#' + x.id)}</b> · ${UI.esc(x.part_number)} × ${UI.num(x.qty)} ${UI.esc(x.unit)}</span><span>${UI.money(x.value)}</span></li>`; }).join('')}</ul>`
        + (rows.length > 6 ? `<div class="cell-sub">and ${rows.length - 6} more</div>` : '') : `<div class="ws-sug-empty">${UI.esc(empty)}</div>`;
    const openPoint = (i) => {
      const bk = b[i]; if (!bk) return;
      const moves = flow.moves[i] || [], ins = moves.filter(x => x.movement_type === 'Stock In'), outs = moves.filter(x => x.movement_type === 'Stock Out');
      const r2 = 'from=' + bk.from + '&to=' + bk.to;
      const links = [['stock_movements?' + r2, 'Open stock movements']].filter(([g]) => UI.canGo(g)).map(([g, l]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-go="${UI.esc(g)}">${l}</button>`).join('');
      UI.openPointPop(cv, pointRect(i), 'Stock movement details: ' + bk.label, `
        <div class="ws-pp-sec"><div class="ws-pp-h">Selected period</div><b>${UI.esc(bk.label)}</b> <span class="cell-sub">${UI.date(bk.from)}${bk.to !== bk.from ? ' – ' + UI.date(bk.to) : ''}</span></div>
        <div class="ws-pp-sec"><div class="ws-pp-h">Stock movement</div><ul class="ws-pp-kv"><li><i style="background:${colors[0]}"></i><span>Stock in value</span><b>${UI.money(flow.in[i])}</b></li>
          <li><i style="background:${colors[1]}"></i><span>Stock out value</span><b>${UI.money(flow.out[i])}</b></li></ul></div>
        <div class="ws-pp-sec"><div class="ws-pp-h">Received (POs)</div>${list(ins, 'No receipt in this period.')}</div>
        <div class="ws-pp-sec"><div class="ws-pp-h">Released (parts requests)</div>${list(outs, 'No release in this period.')}<div class="ws-pp-links">${links}</div></div>
        <div class="ws-pp-sec ws-pp-sug"><div class="ws-pp-h"><i class="bi bi-lightbulb" aria-hidden="true"></i> Suggested actions</div>${PurReport.sug((flow.pointTips || [])[i], 'No action is suggested for this period.')}</div>`);
      chart.setActiveElements([0, 1].map(j => ({ datasetIndex: j, index: i }))); chart.update('none');
    };
    let cur = -1;
    cv.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cur = cur < 0 ? (e.key === 'ArrowRight' ? 0 : b.length - 1) : Math.max(0, Math.min(b.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
        const act = [0, 1].map(j => ({ datasetIndex: j, index: cur })); chart.setActiveElements(act); chart.tooltip.setActiveElements(act, { x: 0, y: 0 }); chart.update('none'); }
      if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) { e.preventDefault(); openPoint(cur); }
    });
  },
});
