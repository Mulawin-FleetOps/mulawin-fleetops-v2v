/* assets/js/modules/accounting/finance.js — FINANCE
   Purchase order payments, other payables, expenses, disbursements (payment vouchers),
   purchasing budget (available / reserved / spent) and cash flow.
   Trip fund releases are in Trip Funds. Backend: backend/Modules/Accounting/Finance.php */
'use strict';
App.page('finance', {
  title: 'Finance',
  subtitle: 'Payables, payments, expenses, purchasing budget and cash flow.',
  render(ctx) {
    const d = ctx.data, act = d.can.act;
    const head = UI.role('admin');
    const b = d.budgets.find(x => x.status === 'Active');
    const poDue = d.poPayables.reduce((a, o) => a + Math.max(0, +o.received_value - +o.paid_amount), 0);
    const apDue = d.payables.filter(p => p.status !== 'Paid').reduce((a, p) => a + +p.balance, 0);
    ctx.el.innerHTML = UI.cards([
      { label: 'PO payables (received, unpaid)', value: poDue, format: 'money', icon: 'bi-cart-check', color: 'amber' },
      { label: 'Other payables', value: apDue, format: 'money', icon: 'bi-receipt', color: 'amber' },
      { label: 'Expenses in period', value: d.expenses.reduce((a, e) => a + +e.amount, 0), format: 'money', icon: 'bi-wallet2', color: 'red' },
      { label: 'Cash out in period', value: d.disbursements.reduce((a, e) => a + +e.amount, 0), format: 'money', icon: 'bi-box-arrow-up-right', color: 'red' },
      ...(!head ? [{ label: 'Budget available', value: b ? +b.available : 'No budget', format: b ? 'money' : '', icon: 'bi-piggy-bank', color: 'green', hint: b ? `Reserved ${UI.money(b.reserved_amount)} · spent ${UI.money(b.spent_amount)} of ${UI.money(b.amount)}` : 'Set a purchasing budget' }] : []),
    ]);
    const paymentAlerts = [
      {label:'Purchase orders awaiting payment',count:d.poPayables.filter(o=>+o.received_value>+o.paid_amount).length,go:act?'finance?tab=po':null},
      {label:'Other unpaid payables',count:d.payables.filter(p=>p.status!=='Paid'&&+p.balance>0).length,go:act?'finance?tab=ap':null}
    ];
    // Head Management sees the attention panel only when there is something to review.
    if (!head || paymentAlerts.some(item=>item.count>0)) {
      ctx.el.insertAdjacentHTML('beforeend', UI.actionSummary(
        head ? paymentAlerts.filter(item=>item.count>0) : paymentAlerts,{title:'Payment follow-up'}));
    }
    const period = UI.filterModal(ctx, [{ name: 'from', label: 'Start date', type: 'date', col: 6 }, { name: 'to', label: 'End date', type: 'date', col: 6 }], { hint: `Period: ${UI.date(d.period.from)} to ${UI.date(d.period.to)} (this month by default).` });
    const payPO = (o) => UI.formModalFiles('Pay ' + UI.esc(o.po_ref), [
      { name: 'amount', label: 'Amount', type: 'money', required: true, col: 6, value: Math.max(0, +o.received_value - +o.paid_amount).toFixed(2) },
      { name: 'supplier_invoice_no', label: 'Supplier invoice number', required: true, col: 6, value: o.supplier_invoice_no },
      ...UI.payFields(d.methods),
      { name: 'or_doc', label: 'Official receipt / payment confirmation (required)', type: 'file', required: true, col: 12, attrs: 'accept="application/pdf,image/*"' }],
      'Finance.po_pay', { extra: { po_id: o.id }, submit: 'Record payment',
        intro: `Check the supplier invoice against the approved PO and the received items. PO total ${UI.money(o.total_amount)}; received ${UI.money(o.received_value)}; already paid ${UI.money(o.paid_amount)}. You can pay only what was received.` });
    const box = document.createElement('div');
    if (head) {
      ctx.el.classList.add('head-financial-overview');
      document.querySelector('#pageContent .page-title')?.replaceChildren(document.createTextNode('Financial Overview'));
      document.querySelector('#pageContent .page-subtitle')?.replaceChildren(document.createTextNode('Company-wide payables, expenses, payments and cash-flow monitoring.'));
      box.className = 'head-financial-records';
      box.innerHTML = '<div class="head-financial-heading"><h2>Financial Records</h2><p>Review payables, expenses, disbursements and cash flow. Transactions stay with Finance.</p></div>';
    }
    ctx.el.append(box);
    UI.tabs(box, [
      ['po', `PO payables (${d.poPayables.length})`, () => UI.table([['PO', 'po_ref'], ['Supplier', 'supplier'], ['Approved by', 'approved_by_name'], ['Status', 'status', 'badge'], ['Total', 'total_amount', 'money'],
        ['Received value', 'received_value', 'money'], ['Paid', 'paid_amount', 'money'], ['Payment', 'payment_status', 'badge']], d.poPayables,
        { title: 'Approved purchase orders (Pending Payment)', actions: (o) => UI.btn('details', 'View Details') + UI.btn('po', 'Print PO', 'outline-secondary') + (act && +o.received_value > +o.paid_amount ? UI.btn('pay', 'Pay', 'primary') : ''),
          onAction: (a, o) => a === 'pay' ? payPO(o) : a === 'details' ? PurUI.details(o.id) : PurUI.printPO(o), empty: 'No purchase order is waiting for payment.' })],
      ['ap', 'Other payables', (body) => {
        const h = UI.table([['Ref', 'payable_ref'], ['Payee', 'payee'], ['Category', 'category'], ['Truck', 'plate_number'], ['Description', 'description'], ['Due date', 'due_on', 'date'],
          ['Amount', 'amount', 'money'], ['Paid', 'paid_amount', 'money'], ['Balance', 'balance', 'money'], ['Status', 'status', 'badge']], d.payables,
          { title: 'Bills to pay (not from a purchase order)', actions: (p) => act && p.status !== 'Paid' ? UI.btn('pay', 'Pay', 'primary') : '',
            onAction: (a, p) => UI.formModalFiles('Pay ' + UI.esc(p.payable_ref), [{ name: 'amount', label: 'Amount', type: 'money', value: p.balance, required: true, col: 12 }, ...UI.payFields(d.methods),
              { name: 'or_doc', label: 'Receipt (optional)', type: 'file', col: 12 }], 'Finance.payable_pay', { extra: { payable_id: p.id } }),
            tools: act ? '<button class="btn btn-sm btn-primary" data-addap><i class="bi bi-plus"></i> Add payable</button>' : '' });
        setTimeout(() => body.querySelector('[data-addap]')?.addEventListener('click', () => UI.formModalFiles('Add payable', [
          { name: 'payee', label: 'Payee name', required: true, col: 12 },
          { name: 'category', label: 'Category', type: 'select', options: UI.list(d.categories), required: true, col: 6 }, { name: 'vehicle_id', label: 'Truck (optional)', type: 'select', options: UI.opts(d.trucks, v => v.plate_number), col: 6 },
          { name: 'description', label: 'Description', required: true, col: 12 }, { name: 'amount', label: 'Amount', type: 'money', required: true, col: 6 }, { name: 'due_on', label: 'Due date', type: 'date', col: 6 },
          { name: 'bill', label: 'Bill / invoice file (optional)', type: 'file', col: 12 }], 'Finance.payable_add')), 0);
        return h;
      }],
      ['expenses', 'Expenses', (body) => {
        const h = period + UI.table([['Date', 'incurred_on', 'date'], ['Category', 'category'], ['Amount', 'amount', 'money'], ['Trip', 'trip_ref'], ['Payee', 'payee'], ['Reference', 'reference_number'],
          ['Description', 'description'], ['Source', 'source']], d.expenses, { title: 'Operating expenses (fund releases, PO payments, repairs and manual entries)',
            tools: act ? '<button class="btn btn-sm btn-primary" data-addexp><i class="bi bi-plus"></i> Add expense</button>' : '' });
        setTimeout(() => body.querySelector('[data-addexp]')?.addEventListener('click', () => UI.formModalFiles('Add expense', [
          { name: 'category', label: 'Category', type: 'select', options: UI.list(d.categories), required: true, col: 6 }, { name: 'amount', label: 'Amount', type: 'money', required: true, col: 6 },
          { name: 'incurred_on', label: 'Date', type: 'date', value: UI.today(), required: true, col: 6 }, { name: 'vehicle_id', label: 'Truck (optional)', type: 'select', options: UI.opts(d.trucks, v => v.plate_number), col: 6 },
          { name: 'payee', label: 'Payee', col: 6 }, { name: 'reference_number', label: 'Reference / OR no.', col: 6 }, { name: 'description', label: 'Description', required: true, col: 12 },
          { name: 'receipt', label: 'Receipt (optional)', type: 'file', col: 12 }], 'Finance.expense_add', { intro: 'Fund releases, PO payments and repair costs are recorded automatically; add only other expenses here (fuel, office, utilities ...).' })), 0);
        return h;
      }],
      ['disb', 'Disbursements', () => period + UI.table([['Voucher', 'voucher_number'], ['Date', 'released_on', 'date'], ['For', 'source_type', (v) => ({ fund_request: 'Trip fund', purchase_order: 'Purchase order', payable: 'Payable' }[v] || v)],
        ['Payee', 'payee'], ['Method', 'payment_method'], ['Reference', 'reference_number'], ['Amount', 'amount', 'money']], d.disbursements, { title: 'Cash released (payment vouchers)',actions:()=>UI.btn('details','View Details'),onAction:(action,row)=>{const drawer=UI.drawer(UI.esc(row.voucher_number),UI.h('Transaction')+UI.kv([['Voucher',UI.e(row.voucher_number)],['Source',UI.e(row.source_type)],['Payee',UI.e(row.payee)],['Amount',UI.money(row.amount)],['Method',UI.e(row.payment_method)],['Reference',UI.e(row.reference_number)],['Release date',UI.date(row.released_on)]])+UI.h('Recorded Activity')+UI.kv([['Recorded at',UI.datetime(row.created_at)],['Recorded by',UI.e(row.recorded_by_name)]]),{subtitle:'Read-only disbursement'});UI.drawerSections(drawer,[['summary','Summary',['Transaction']],['activity','Recorded Activity',['Recorded Activity']]],{key:'disbursement-details'});} })],
      ['budget', 'Purchasing budget', (body) => {
        const h = `<div class="small text-muted mb-2">Purchase orders are approved only when the active budget can cover them. The amount is <b>reserved</b> at approval and becomes <b>spent</b> when Finance pays.</div>`
          + UI.table([['Period', 'period_start', (v, r) => UI.date(v) + ' – ' + UI.date(r.period_end)], ['Budget', 'amount', 'money'], ['Reserved', 'reserved_amount', 'money'], ['Spent', 'spent_amount', 'money'], ['Available', 'available', 'money'], ['Status', 'status', 'badge'], ['Set by', 'set_by_name']], d.budgets,
            { title: 'Budgets', tools: act ? '<button class="btn btn-sm btn-primary" data-setb><i class="bi bi-plus"></i> Set new budget</button>' : '', empty: 'No budget yet.' });
        setTimeout(() => body.querySelector('[data-setb]')?.addEventListener('click', () => UI.formModal('Set purchasing budget', [
          { name: 'amount', label: 'Budget amount', type: 'money', required: true, col: 12 }, { name: 'period_start', label: 'Start date', type: 'date', value: UI.today(), required: true, col: 6 },
          { name: 'period_end', label: 'End date', type: 'date', required: true, col: 6 }], 'Finance.budget_set', { intro: 'The current active budget is closed; reservations of approved POs stay with their budget.' })), 0);
        return h;
      }],
      ['cash', 'Cash flow', () => UI.blocks({ charts: [{ type: 'bar', format: 'money', title: 'Cash in (collections) vs cash out (disbursements), last 12 months', labels: d.cashflow.map(x => x.m),
        datasets: [{ label: 'Cash in (collections)', data: d.cashflow.map(x => +x.cash_in) }, { label: 'Cash out (disbursements)', data: d.cashflow.map(x => +x.cash_out) }] }],
        tables: [{ title: 'Monthly cash flow', columns: [['Month', 'm'], ['Cash in', 'cash_in', 'money'], ['Cash out', 'cash_out', 'money'], ['Net', 'net', 'money']], rows: d.cashflow.map(x => ({ ...x, net: +x.cash_in - +x.cash_out })) }] })],
    ], ctx.query.from ? 'expenses' : ctx.query.tab || null, {forceActive:!!ctx.query.tab||!!ctx.query.from});
  },
});
