/* assets/js/modules/accounting/billing.js — BILLING AND COLLECTION
   Ongoing Trips (billing drafts, view only) -> For Billing (verify documents, add charges,
   finalize) -> Invoices (printable Service Invoice, PDF #13) -> payments with the
   acknowledgement receipt -> Paid. Receivables by client with aging and printable SOA.
   Backend: backend/Modules/Accounting/Billing.php */
'use strict';
const BillUI = {
  async pricingReport(after=0){
    try{const report=await App.api('Billing.pricing_report',{after_id:after});const el=UI.drawer('Historical Pricing Impact',
      '<p>Preview only. Original invoices and payment allocations are preserved. Missing historical inputs require evidence; no prices are invented.</p>'+UI.table([['Billing','billing_id'],['Status','status'],['Existing','existing','money'],['Proposed','proposed',(v)=>v===null?'Unreconciled':UI.money(v)],['Missing inputs','missing',v=>UI.esc(v.join('; '))],['Action','correction']],report.rows,{showAllColumns:true,actions:r=>r.can_apply&&UI.role('admin')?UI.btn('apply','Review recalculation'):'' ,onAction:(a,r)=>UI.formModal('Recalculate verified open billing',[{name:'reason',label:'Reason',required:true,type:'textarea'}],'Billing.pricing_recalculate',{extra:{billing_id:r.billing_id,fingerprint:r.fingerprint},intro:'Existing '+UI.money(r.existing)+'; proposed '+UI.money(r.proposed)+'. This changes only this unpaid unissued record.',after:()=>this.pricingReport(after)})})+(report.next_after_id?'<button data-next-pricing class="btn btn-outline-secondary">Next records</button>':''));el.querySelector('[data-next-pricing]')?.addEventListener('click',()=>this.pricingReport(report.next_after_id));}catch(e){UI.toast(e.message,'error');}
  },
  data: null,
  /* BILLING_ADJUSTMENT_APPROVAL_V1: Billing requests charges / per-trip rate adjustments; Admin approves.
     Only approved lines are in the total (r.charges). Requests and their history are r.requests. */
  sign: (v) => (+v < 0 ? '− ' : '') + UI.money(Math.abs(+v)),
  reqText(x) {
    if (x.request_type === 'New') return `${UI.esc(x.kind)}: ${UI.esc(x.description)} <b>${BillUI.sign(x.amount)}</b>`;
    if (x.request_type === 'Removal') return `Remove ${UI.esc(x.kind.toLowerCase())}: ${UI.esc(x.old_description ?? x.description)} <b>${BillUI.sign(x.old_amount ?? x.amount)}</b>`;
    return `Change ${UI.esc(x.kind.toLowerCase())}: ${UI.esc(x.old_description)} ${BillUI.sign(x.old_amount)} → ${UI.esc(x.description)} <b>${BillUI.sign(x.amount)}</b>`;
  },
  decide(x, decision, after) {
    const approve = decision === 'approve';
    UI.confirmAction(approve ? 'Approve billing request' : 'Reject billing request',
      `${UI.esc(x.trip_ref || '')} ${BillUI.reqText(x)}${x.reason ? `<br><span class="small text-muted">Reason: ${UI.esc(x.reason)}</span>` : ''}<br><span class="small">${approve ? 'Once approved it counts in the billing total.' : 'The billing total stays as it is.'}</span>`,
      'Billing.charge_decide', { charge_id: x.id, decision },
      { danger: !approve, submit: approve ? 'Approve' : 'Reject', fields: [approve ? { name: 'notes', label: 'Notes (optional)', col: 12 } : { name: 'reason', label: 'Reason for rejecting', required: true, col: 12 }], after });
  },
  amountFields(kind, x) {
    const adj = kind === 'Rate Adjustment';
    return [{ name: 'description', label: 'Description (shown on the invoice)', required: true, col: 8, value: x ? x.description : '' },
      { name: 'amount', label: 'Amount (PHP)', type: 'money', required: true, col: 4, value: x ? Math.abs(+x.amount).toFixed(2) : '' },
      { name: 'direction', label: 'Rate adjustment', type: 'select', options: [['Increase', 'Increase (add to the total)'], ['Decrease', 'Decrease / discount (less from the total)']], value: x && +x.amount < 0 ? 'Decrease' : 'Increase', placeholder: false, col: 6, attrs: adj ? '' : 'disabled' }];
  },
  async open(id) {
    let r; try { r = await App.api('Billing.details', { billing_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const b = r.billing, t = r.trip, c = r.client, act = BillUI.data.can.act;
    const docOk = (cat) => r.documents.some(x => x.category === cat);
    const acts = [], decide = BillUI.data.can.decide, me = BillUI.data.can.me;
    const pending = r.requests.filter(x => x.status === 'Pending Approval');
    const busy = new Set(pending.filter(x => x.replaces_id).map(x => String(x.replaces_id)));
    const pendingDelta = pending.reduce((a, x) => a + (x.request_type === 'New' ? +x.amount : x.request_type === 'Change' ? +x.amount - +x.old_amount : -x.old_amount), 0);
    if (act && b.status === 'For Billing') {
      acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="charge"><i class="bi bi-plus"></i> Request charge / adjustment</button>');
      acts.push(!b.docs_verified_at ? '<button class="btn btn-sm btn-primary" data-a="verify"><i class="bi bi-shield-check"></i> Verify documents</button>'
        : pending.length ? `<button class="btn btn-sm btn-primary" disabled title="Waiting for Admin approval"><i class="bi bi-receipt"></i> Finalize invoice</button>`
        : '<button class="btn btn-sm btn-primary" data-a="finalize"><i class="bi bi-receipt"></i> Finalize invoice</button>');
    }
    if (['Invoiced', 'Partially Paid', 'Paid'].includes(b.status)) acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="print"><i class="bi bi-printer"></i> Print invoice</button>');
    if (act && ['Invoiced', 'Partially Paid'].includes(b.status)) acts.push('<button class="btn btn-sm btn-success" data-a="pay"><i class="bi bi-cash-stack"></i> Record payment</button>');
    const html = `<div class="mb-2">${UI.badge(b.status)} ${b.invoice_number ? `<b>${UI.esc(b.invoice_number)}</b>` : ''}</div>
      ${b.status === 'Ongoing' ? '<div class="alert alert-info py-2 small">Billing draft made at dispatch. View only while the trip is ongoing; it moves to For Billing when the trip is completed.</div>' : ''}
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}${b.status === 'For Billing' && !b.docs_verified_at ? '<div class="why">Finalizing is allowed after the supporting documents are verified.</div>' : ''}${b.status === 'For Billing' && pending.length ? `<div class="why">${pending.length} request(s) are waiting for Admin approval. The invoice can be finalized after the Admin decides.</div>` : ''}</div>` : ''}
      ${r.pricing?UI.kv([['Fixed route rate',r.pricing.fixed===null?'Unavailable':UI.money(r.pricing.fixed)],['Fuel charge',r.pricing.fuel===null?'Pending Fuel Calculation':UI.money(r.pricing.fuel)],['Dispatch pricing',r.pricing.missing.length?UI.esc(r.pricing.missing.join('; ')):'Frozen at '+UI.esc(r.pricing.at)]]):''}${UI.h('Billing breakdown')}<table class="breakdown w-100">
        ${!r.pricing?`<tr><td>Trip ${UI.esc(t.trip_ref)}: ${UI.num(b.distance_km, 2)} km x ${UI.money(b.rate_per_km)} per km</td><td class="num">${UI.money(+b.distance_km * +b.rate_per_km)}</td></tr>`:'<tr><td>Fixed route plus fuel (fuel pending if unresolved)</td><td class="num">'+UI.money(b.base_amount)+'</td></tr>'}
        ${+b.minimum_charge > 0 ? `<tr><td class="text-muted">Minimum charge ${UI.money(b.minimum_charge)} → base amount</td><td class="num">${UI.money(b.base_amount)}</td></tr>` : ''}
        ${r.charges.map(x => `<tr><td>${UI.esc(x.description)} <span class="text-muted small">(${UI.esc(x.kind)}${x.decided_by_name ? ', approved by ' + UI.esc(x.decided_by_name) : ''})</span>${act && b.status === 'For Billing' ? (busy.has(String(x.id)) ? ' <span class="badge-s amber">change pending</span>' : ` <button class="btn btn-link btn-sm p-0" data-chg="${x.id}">change</button> <button class="btn btn-link btn-sm p-0 text-danger" data-rmc="${x.id}">remove</button>`) : ''}</td><td class="num">${BillUI.sign(x.amount)}</td></tr>`).join('')}
        <tr class="total"><td>${r.pricing&&r.pricing.fuel===null?'Provisional amount (fuel pending)':'Total amount (approved)'}</td><td class="num">${UI.money(b.total_amount)}</td></tr>
        ${pending.length ? `<tr><td class="text-muted small">Waiting for Admin approval (not in the total): ${pending.length} request(s)</td><td class="num text-muted small">${pendingDelta < 0 ? '− ' : '+ '}${UI.money(Math.abs(pendingDelta))}</td></tr>` : ''}
        ${+b.amount_paid ? `<tr><td>Paid</td><td class="num">${UI.money(b.amount_paid)}</td></tr><tr class="total"><td>Balance</td><td class="num">${UI.money(b.balance)}</td></tr>` : ''}</table>
      ${r.requests.length ? UI.h('Charge and adjustment requests') + '<div data-reqbox>' + UI.table([['Request', 'id', (v, x) => BillUI.reqText(x) + (x.reason ? `<div class="small text-muted">${UI.esc(x.reason)}</div>` : '')],
        ['Requested by', 'added_by_name', (v, x) => UI.esc(v) + '<div class="small text-muted">' + UI.datetime(x.created_at) + '</div>'], ['Status', 'status', 'badge'],
        ['Decision', 'decided_by_name', (v, x) => x.status === 'Pending Approval' ? '—' : UI.esc(v || '') + (x.decision_notes ? `<div class="small text-muted">${UI.esc(x.decision_notes)}</div>` : '')],
        ['', 'id', (v, x) => x.status !== 'Pending Approval' || b.status !== 'For Billing' ? '' : (decide && +x.added_by !== me ? `<button class="btn btn-sm btn-success" data-dec="approve" data-req="${v}">Approve</button> <button class="btn btn-sm btn-outline-danger" data-dec="reject" data-req="${v}">Reject</button>` : '')
          + (decide && +x.added_by === me ? '<span class="small text-muted">Another Admin decides</span>' : '') + (act && +x.added_by === me ? `<button class="btn btn-sm btn-outline-secondary" data-wd="${v}">Withdraw</button>` : '')]], r.requests, { plain: true }) + '</div>' : ''}
      ${UI.h('Supporting documents')}${UI.documentChecklist(r.documents,['Waybill','Delivery Receipt','Acknowledgement Receipt'].map(category=>({category,required:true,for:'billing document verification'})))}<ul class="req-list mb-2"><li class="${b.docs_verified_at ? 'ok' : 'no'}"><i class="bi ${b.docs_verified_at ? 'bi-check-circle-fill' : 'bi-hourglass'}"></i> ${b.docs_verified_at ? 'Verified by ' + UI.esc(b.verified_by_name) + ' · ' + UI.datetime(b.docs_verified_at) : 'Not verified yet'}</li></ul>${UI.docs(r.documents)}
      ${UI.h('Trip details')}${UI.kv([['Route', UI.esc(t.pickup_point) + ' → ' + UI.esc(t.delivery_point)], ['Truck / driver', UI.esc([t.plate_number, t.driver_name].filter(Boolean).join(' · '))],
        ['Dispatched', UI.datetime(t.dispatched_at)], ['Completed', UI.datetime(t.completed_at)], ['Waybill no.', UI.e(t.waybill_number)], t.units_delivered ? ['Units delivered', UI.e(t.units_delivered)] : null])}
      ${UI.h('Client profile')}${UI.kv([['Client', `<b>${UI.esc(c.company_name)}</b>`], ['TIN', UI.e(c.tin)], ['Address', UI.e(c.business_address)], ['Contact', UI.esc([c.contact_person, c.contact_number, c.email].filter(Boolean).join(' · ') || '—')],
        ['Payment terms', c.payment_terms_days !== null ? c.payment_terms_days + ' days' : 'default']])}
      ${b.invoice_number ? UI.h('Invoice') + UI.kv([['Invoice no.', UI.esc(b.invoice_number)], ['Invoice date', UI.date(b.invoice_date)], ['Due date', UI.date(b.due_date)], ['Finalized by', UI.e(b.finalized_by_name)]]) : ''}
      ${r.collections.length ? UI.h('Payments') + UI.table([['Payment date', 'payment_date', 'date'], ['Amount', 'amount', 'money'], ['Method', 'payment_method'], ['Reference', 'reference'], ['AR no.', 'ar_number'], ['Recorded by', 'recorded_by_name'],
        ['', 'id', (v) => `<button class="btn btn-sm btn-outline-secondary" data-ar="${v}"><i class="bi bi-printer"></i> Receipt</button>`]], r.collections, { plain: true }) : ''}`;
    const el = UI.drawer('Billing · ' + UI.esc(t.trip_ref), html, { subtitle: UI.esc(c.company_name) });
    UI.drawerSections(el,[['summary','Summary',['Trip details','Client profile','Invoice']],['charges','Transaction Breakdown',['Billing breakdown','Charge and adjustment requests']],['payments','Payments',['Payments']],['documents','Supporting Documents',['Supporting documents']]],{key:'billing-details'});
    el.querySelectorAll('[data-ar]').forEach(x => x.onclick = () => BillUI.printAR(r.collections.find(co => String(co.id) === x.dataset.ar), b, c));
    const reopen = () => { BillUI.open(id); App.route(); };
    const line = (cid) => r.charges.find(c => String(c.id) === String(cid));
    el.querySelectorAll('[data-rmc]').forEach(x => x.onclick = () => UI.confirmAction('Request removal', `Ask the Admin to remove <b>${UI.esc(line(x.dataset.rmc).description)} ${BillUI.sign(line(x.dataset.rmc).amount)}</b>? The line stays in the total until the Admin approves.`, 'Billing.charge_remove', { charge_id: x.dataset.rmc },
      { danger: true, submit: 'Send removal request', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }], after: reopen }));
    el.querySelectorAll('[data-chg]').forEach(x => x.onclick = () => { const c = line(x.dataset.chg);
      UI.formModal('Request change: ' + UI.esc(c.kind.toLowerCase()), [...BillUI.amountFields(c.kind, c), { name: 'reason', label: 'Reason for the change', required: true, col: 12 }], 'Billing.charge_change',
        { extra: { charge_id: c.id }, intro: `Current approved amount ${BillUI.sign(c.amount)} stays in the total until the Admin approves the change.`, after: reopen }); });
    // Delegated: the requests table can re-render (paging), so handlers are not bound to the buttons.
    el.querySelector('[data-reqbox]')?.addEventListener('click', (e) => {
      const wd = e.target.closest('[data-wd]'), dec = e.target.closest('[data-dec]');
      if (wd) UI.confirmAction('Withdraw request', 'Withdraw this pending request? Nothing in the billing total changes.', 'Billing.charge_withdraw', { charge_id: wd.dataset.wd }, { submit: 'Withdraw', after: reopen });
      if (dec) BillUI.decide({ ...r.requests.find(q => String(q.id) === dec.dataset.req), trip_ref: t.trip_ref }, dec.dataset.dec, reopen);
    });
    el.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
      const a = x.dataset.a;
      if (a === 'charge') UI.formModal('Request charge or rate adjustment', [{ name: 'kind', label: 'Type', type: 'select', options: ['Additional Charge', 'Rate Adjustment'], value: 'Additional Charge', placeholder: false, required: true, col: 6 },
          { type: 'html', col: 6, html: '<div class="form-help mt-4">Rate adjustment = special per-trip peso amount (plus or minus). The client rate is not changed.</div>' },
          ...BillUI.amountFields('Additional Charge'), { name: 'reason', label: 'Reason (required for rate adjustments)', col: 12 }],
        'Billing.charge_add', { extra: { billing_id: id }, intro: 'The Admin must approve it before it counts in the billing total.', after: reopen,
          onShow: (w, form) => { const k = form.querySelector('[name=kind]'), dir = form.querySelector('[name=direction]'), why = form.querySelector('[name=reason]');
            const sync = () => { const adj = k.value === 'Rate Adjustment'; dir.disabled = !adj; why.required = adj; }; k.onchange = sync; sync(); } });
      if (a === 'verify') UI.confirmAction('Verify documents', 'Confirm that the waybill, the delivery receipt and the acknowledgement receipt match this trip and the billing information.', 'Billing.verify', { billing_id: id }, { submit: 'Verify documents', after: () => { BillUI.open(id); App.route(); } });
      if (a === 'finalize') UI.formModal('Finalize invoice', [{ name: 'invoice_date', label: 'Invoice date', type: 'date', value: UI.today(), required: true, col: 6 },
          { name: 'invoice_number', label: 'Invoice number (optional)', col: 6, help: 'Leave blank for automatic numbering, or enter the pre-printed invoice number.' }],
        'Billing.finalize', { extra: { billing_id: id }, intro: `Total ${UI.money(b.total_amount)}. Due date = invoice date + client payment terms.`, after: () => { BillUI.open(id); App.route(); } });
      if (a === 'print') BillUI.printInvoice(r);
      if (a === 'pay') UI.formModalFiles('Record payment for ' + UI.esc(b.invoice_number), [
          { name: 'amount', label: 'Amount received', type: 'money', value: b.balance, required: true, col: 6 }, { name: 'ar_number', label: 'Acknowledgement receipt no.', required: true, col: 6 },
          ...UI.payFields(BillUI.data.methods, 'payment_date', 'Payment date'),
          { name: 'ack_receipt', label: 'Acknowledgement receipt (required)', type: 'file', required: true, col: 12, attrs: 'accept="application/pdf,image/*"' }],
        'Billing.collect', { extra: { billing_id: id }, submit: 'Confirm payment', intro: `Balance: ${UI.money(b.balance)}. The system refuses the payment until the receipt and the payment details are complete.`, after: () => { BillUI.open(id); App.route(); } });
    });
  },
  printInvoice(r) {
    const b = r.billing, t = r.trip, c = r.client, vat = +r.vatRate;
    const total = +b.total_amount, vatable = vat > 0 ? total / (1 + vat / 100) : 0, vatAmt = vat > 0 ? total - vatable : 0;
    const lines = [[`Trucking service ${t.trip_ref} (${t.truck_type}): ${t.pickup_point} to ${t.delivery_point}; truck ${t.plate_number || ''}; waybill ${t.waybill_number || ''}`, r.pricing?'1':UI.num(b.distance_km, 2) + ' km', r.pricing?UI.money(r.pricing.fixed):UI.money(b.rate_per_km), r.pricing?UI.money(r.pricing.fixed):UI.money(b.base_amount)],
      ...(r.pricing?[['Fuel charge (dispatch snapshot)','1',UI.money(r.pricing.fuel),UI.money(r.pricing.fuel)]]:[]),
      ...r.charges.map(x => [x.description, '1', UI.money(x.amount), UI.money(x.amount)])];
    UI.printForm('SERVICE INVOICE', `<div class="d-flex justify-content-between"><div><span class="chk">${''}</span>CASH SALES &nbsp; <span class="chk">✓</span>CHARGE SALES</div><div><b>Date:</b> ${UI.date(b.invoice_date)} &nbsp; <b>Due:</b> ${UI.date(b.due_date)}</div></div>
      <table><tr><th colspan="2">SERVICE TO:</th></tr><tr><td style="width:24%">Registered Name</td><td>${UI.esc(c.company_name)}</td></tr><tr><td>TIN</td><td>${UI.esc(c.tin || '')}</td></tr><tr><td>Business Address</td><td>${UI.esc(c.business_address || '')}</td></tr></table>
      <table><thead><tr><th>Item Description / Nature of Service</th><th class="num">Quantity</th><th class="num">Unit Cost / Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines.map(l => `<tr><td>${UI.esc(l[0])}</td><td class="num">${l[1]}</td><td class="num">${l[2]}</td><td class="num">${l[3]}</td></tr>`).join('')}${UI.pfBlank(4, lines.length, 10)}</tbody></table>
      <div class="d-flex gap-3"><table style="width:48%"><tr><td>VATable Sales</td><td class="num">${UI.money(vatable)}</td></tr><tr><td>VAT (${vat}%)</td><td class="num">${UI.money(vatAmt)}</td></tr>
        <tr><td>Zero-Rated Sales</td><td class="num">${UI.money(0)}</td></tr><tr><td>VAT-Exempt Sales</td><td class="num">${UI.money(vat > 0 ? 0 : total)}</td></tr></table>
      <table style="width:52%"><tr><td>Total Sales (VAT inclusive)</td><td class="num">${UI.money(total)}</td></tr><tr><td>Less: VAT</td><td class="num">${UI.money(vatAmt)}</td></tr>
        <tr><td>Amount: Net of VAT</td><td class="num">${UI.money(total - vatAmt)}</td></tr><tr><td>Add: VAT</td><td class="num">${UI.money(vatAmt)}</td></tr>
        <tr><th>TOTAL AMOUNT DUE</th><th class="num">${UI.money(total)}</th></tr></table></div>
      <div class="pf-signs">${UI.sign('Received the amount of / Received by (client)')}${UI.sign('Authorized representative', b.finalized_by_name || '', b.finalized_by, 'billing', b.id)}</div>`, { number: b.invoice_number });
  },
  /** Amount in words for receipts, e.g. 13875.5 -> "THIRTEEN THOUSAND EIGHT HUNDRED SEVENTY-FIVE PESOS AND 50/100". */
  words(amount) {
    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
    const under1000 = (n) => { let w = ''; if (n >= 100) { w = ones[Math.floor(n / 100)] + ' HUNDRED'; n %= 100; if (n) w += ' '; }
      if (n >= 20) w += tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : ''); else if (n) w += ones[n]; return w; };
    const cents = Math.round(+amount * 100); let pesos = Math.floor(cents / 100); const c = cents % 100;
    if (!pesos) return 'ZERO PESOS' + (c ? ` AND ${String(c).padStart(2, '0')}/100` : ' ONLY');
    const parts = []; [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND'], [1, '']].forEach(([v, n]) => { const q = Math.floor(pesos / v); if (q) { parts.push(under1000(q) + (n ? ' ' + n : '')); pesos %= v; } });
    return parts.join(' ') + ' PESOS' + (c ? ` AND ${String(c).padStart(2, '0')}/100` : ' ONLY');
  },
  /** Acknowledgement Receipt for a client payment (layout of the company's AR form, PDF #13). */
  printAR(co, b, c) {
    if (!co) return;
    const cash = /cash/i.test(co.payment_method || ''), cheque = /cheque|check/i.test(co.payment_method || '');
    const full = +b.amount_paid >= +b.total_amount - 0.005;
    UI.printForm('ACKNOWLEDGEMENT RECEIPT', `<div class="pf-ar">
      <div class="pf-ar-side"><table><thead><tr><th colspan="2">In settlement of the following</th></tr><tr><th>Particulars</th><th class="num">Amount</th></tr></thead>
        <tbody><tr><td>Invoice ${UI.esc(b.invoice_number)}</td><td class="num">${UI.money(co.amount)}</td></tr>${'<tr><td>&nbsp;</td><td></td></tr>'.repeat(5)}
        <tr><th>TOTAL</th><th class="num">${UI.money(co.amount)}</th></tr></tbody></table>
        <table><tr><th colspan="2">FORM OF PAYMENT</th></tr><tr><td><span class="chk">${cash ? '✓' : ''}</span>Cash</td><td><span class="chk">${cheque ? '✓' : ''}</span>Check</td></tr>
        ${!cash && !cheque ? `<tr><td colspan="2"><span class="chk">✓</span>${UI.esc(co.payment_method)}</td></tr>` : ''}</table></div>
      <div class="pf-ar-main">
        <div class="pf-ar-date"><b>Date:</b> <span class="pf-fill">${UI.date(co.payment_date)}</span></div>
        <p>Received from <span class="pf-fill w-60">${UI.esc(c.company_name)}</span></p>
        <p>with TIN <span class="pf-fill">${UI.esc(c.tin || '')}</span> and address at <span class="pf-fill w-40">${UI.esc(c.business_address || '')}</span></p>
        <p>engaged in the business style of <span class="pf-fill w-40">${UI.esc(c.company_name)}</span> the sum of</p>
        <p><span class="pf-fill w-100">${UI.esc(BillUI.words(co.amount))}</span></p>
        <p>pesos (₱ <span class="pf-fill">${UI.money(co.amount).replace('₱', '')}</span>) in ${full ? '<s>partial</s> / <b>full</b>' : '<b>partial</b> / <s>full</s>'} payment for <span class="pf-fill w-40">trucking service, invoice ${UI.esc(b.invoice_number)}</span></p>
        <p class="small">${co.reference ? 'Reference: ' + UI.esc(co.reference) + '. ' : ''}${co.cheque_number ? 'Cheque no. ' + UI.esc(co.cheque_number) + (co.bank_name ? ' (' + UI.esc(co.bank_name) + ')' : '') + '. ' : ''}AR no. ${UI.esc(co.ar_number || '')}</p>
        <div class="pf-signs">${UI.sign('Cashier / Authorized Representative', co.recorded_by_name || '', co.recorded_by, 'collection', co.id)}</div>
        <div class="pf-note">"THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES"</div>
      </div></div>`, { number: co.ar_number || '' });
  },
  async printSOA(clientId) {
    const r = await App.api('Billing.soa', { client_id: clientId });
    const total = r.invoices.reduce((a, x) => a + +x.balance, 0);
    UI.printForm('STATEMENT OF ACCOUNT', `<div class="pf-grid"><div><b>CLIENT:</b> ${UI.esc(r.client.company_name)}</div><div><b>AS OF:</b> ${UI.date(UI.today())}</div><div style="grid-column:1/3"><b>ADDRESS:</b> ${UI.esc(r.client.business_address || '')}</div></div>
      <table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Trip / waybill</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Balance</th><th class="num">Days overdue</th></tr></thead>
      <tbody>${r.invoices.map(x => `<tr><td>${UI.esc(x.invoice_number)}</td><td>${UI.date(x.invoice_date)}</td><td>${UI.date(x.due_date)}</td><td>${UI.esc(x.trip_ref)} / ${UI.esc(x.waybill_number || '')}</td>
        <td class="num">${UI.money(x.total_amount)}</td><td class="num">${UI.money(x.amount_paid)}</td><td class="num">${UI.money(x.balance)}</td><td class="num">${+x.days_overdue > 0 ? x.days_overdue : ''}</td></tr>`).join('')}
      <tr><th colspan="6">TOTAL BALANCE</th><th class="num">${UI.money(total)}</th><th></th></tr></tbody></table>
      <div class="pf-signs">${UI.sign('Prepared by (Billing and Collection)', App.me.user.full_name, App.me.user.id)}${UI.sign('Received by (client)')}</div>`);
  },
};

App.page('billing', {
  title: 'Billing & Collection',
  subtitle: 'Billing drafts from dispatched trips, invoices for completed trips, client payments and receivables.',
  render(ctx) {
    if(UI.role('admin')||UI.role('billing')||UI.role('audit'))UI.tool(ctx,'Pricing Impact',()=>BillUI.pricingReport(),'bi-clock-history','outline-secondary');
    const d = BillUI.data = ctx.data;
    const head = UI.role('admin');
    const by = (s) => d.billings.filter(b => s.includes(b.status));
    const unpaid = by(['Invoiced', 'Partially Paid']);
    const adjBanner = d.adjustments.length && d.can.decide ? `<div class="alert alert-warning py-2 small d-flex justify-content-between align-items-center">${d.adjustments.length} billing charge / adjustment request(s) are waiting for Admin approval.</div>` : '';
    ctx.el.innerHTML = adjBanner + (d.pendingRates ? `<div class="alert alert-warning py-2 small d-flex justify-content-between align-items-center">${d.pendingRates} new client(s) are waiting for a billing rate.<a class="btn btn-sm btn-light" href="#clients?status=Pending%20Rate">Open clients</a></div>` : '') + UI.cards([
      ...(!head ? [{ label: 'Ongoing trips (drafts)', value: by(['Ongoing']).length, icon: 'bi-hourglass', color: 'gray' }] : []),
      { label: 'For billing', value: by(['For Billing']).length, icon: 'bi-receipt', color: 'amber' },
      { label: 'Unpaid invoices', value: unpaid.length, icon: 'bi-file-earmark-text', color: 'blue' },
      { label: 'Outstanding balance', value: unpaid.reduce((a, b) => a + +b.balance, 0), format: 'money', icon: 'bi-hourglass-split', color: 'red' },
      { label: 'Overdue', value: unpaid.filter(b => +b.days_overdue > 0).reduce((a, b) => a + +b.balance, 0), format: 'money', icon: 'bi-exclamation-octagon', color: 'red' },
    ]);
    const open = { actions: () => UI.btn('view', 'Open'), onAction: (a, b) => BillUI.open(b.id) };
    const box = document.createElement('div');
    if (head) {
      ctx.el.classList.add('head-billing-overview');
      box.className = 'head-financial-records';
      box.innerHTML = '<div class="head-financial-heading"><h2>Billing & Collection Records</h2><p>Monitor billing drafts, approvals, outstanding invoices and collections.</p></div>';
    }
    ctx.el.append(box);
    UI.tabs(box, [
      ['ongoing', `Ongoing trips (${by(['Ongoing']).length})`, () => UI.table([['Trip', 'trip_ref'], ['Client', 'client'], ['Truck', 'plate_number'], ['Route', 'delivery_point'], ['Dispatched', 'dispatched_at', 'datetime'],
        ['Draft amount', 'total_amount', 'money']], by(['Ongoing']), { ...open, title: 'Billing drafts (view only while the trip is ongoing)' })],
      ['for', `For billing (${by(['For Billing']).length})`, () => UI.table([['Trip', 'trip_ref'], ['Client', 'client'], ['Completed', 'completed_at', 'datetime'], ['Waybill', 'waybill_number'],
        ['Documents', 'waybill_docs', (v, b) => { const okd = +b.waybill_docs && +b.dr_docs && +b.ar_docs; return `<span class="badge-s ${okd ? 'green' : 'red'}">${okd ? 'Complete' : 'Missing'}</span>`; }],
        ['Verified', 'docs_verified_at', (v) => v ? '<span class="badge-s green">Yes</span>' : '<span class="badge-s amber">No</span>'],
        ['Approvals', 'pending_adjustments', (v) => +v ? `<span class="badge-s amber">${v} pending</span>` : '—'], ['Amount', 'total_amount', 'money']], by(['For Billing']), { ...open, title: 'Completed trips to verify and invoice' })],
      ['approvals', `Approvals (${d.adjustments.length})`, () => UI.table([['Trip', 'trip_ref'], ['Client', 'client'], ['Request', 'id', (v, x) => BillUI.reqText(x)], ['Reason', 'reason'],
        ['Requested by', 'added_by_name'], ['Requested', 'created_at', 'datetime'], ['Current total', 'total_amount', 'money']], d.adjustments,
        { title: 'Charge and rate adjustment requests waiting for Admin approval', actions: (x) => (d.can.decide && +x.added_by !== d.can.me ? UI.btn('approve', 'Approve', 'success') + ' ' + UI.btn('reject', 'Reject', 'outline-danger') + ' ' : '') + UI.btn('view', 'Open', 'outline-secondary'),
          onAction: (a, x) => a === 'view' ? BillUI.open(x.billing_id) : BillUI.decide(x, a, () => App.route()) })],
      ['invoices', `Unpaid invoices (${unpaid.length})`, () => UI.table([['Invoice', 'invoice_number'], ['Client', 'client'], ['Trip', 'trip_ref'], ['Invoice date', 'invoice_date', 'date'], ['Due date', 'due_date', 'date'],
        ['Amount', 'total_amount', 'money'], ['Paid', 'amount_paid', 'money'], ['Balance', 'balance', 'money'], ['Overdue', 'days_overdue', (v) => +v > 0 ? `<span class="badge-s red">${v} days</span>` : '—'], ['Status', 'status', 'badge']], unpaid, { ...open, title: 'Invoices waiting for payment' })],
      ['paid', 'Paid', () => UI.table([['Invoice', 'invoice_number'], ['Client', 'client'], ['Trip', 'trip_ref'], ['Invoice date', 'invoice_date', 'date'], ['Amount', 'total_amount', 'money']], by(['Paid']), { ...open, title: 'Paid invoices' })],
      ['collections', 'Collections', () => UI.table([['Payment date', 'payment_date', 'date'], ['Invoice', 'invoice_number'], ['Client', 'client'], ['Amount', 'amount', 'money'], ['Method', 'payment_method'], ['Reference', 'reference'], ['AR no.', 'ar_number']], d.collections, { title: 'Payments received' })],
      ['ar', 'Receivables by client', () => UI.table([['Client', 'client'], ['Invoices', 'invoices', 'num'], ['Balance', 'balance', 'money'], ['Not yet due', 'not_due', 'money'], ['1-30 days', 'd1_30', 'money'], ['31-60 days', 'd31_60', 'money'], ['Over 60 days', 'd60', 'money']],
        d.receivables, { title: 'Outstanding balances and aging', actions: () => UI.btn('soa', 'Print SOA', 'outline-secondary'), onAction: (a, x) => BillUI.printSOA(x.id) })],
    ], d.can.decide && d.adjustments.length ? 'approvals' : d.can.act && by(['For Billing']).length ? 'for' : null);
  },
});
