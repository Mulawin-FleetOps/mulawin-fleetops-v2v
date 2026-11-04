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
    const b = d.budgets.find(x => x.status === 'Active');
    const poDue = d.poPayables.reduce((a, o) => a + Math.max(0, +o.received_value - +o.paid_amount), 0);
    const apDue = d.payables.filter(p => p.status !== 'Paid').reduce((a, p) => a + +p.balance, 0);
    ctx.el.innerHTML = UI.cards([
      { label: 'PO payables (received, unpaid)', value: poDue, format: 'money', icon: 'bi-cart-check', color: 'amber' },
      { label: 'Other payables', value: apDue, format: 'money', icon: 'bi-receipt', color: 'amber' },
      { label: 'Expenses in period', value: d.expenses.reduce((a, e) => a + +e.amount, 0), format: 'money', icon: 'bi-wallet2', color: 'red' },
      { label: 'Cash out in period', value: d.disbursements.reduce((a, e) => a + +e.amount, 0), format: 'money', icon: 'bi-box-arrow-up-right', color: 'red' },
      { label: 'Budget available', value: b ? +b.available : 'No budget', format: b ? 'money' : '', icon: 'bi-piggy-bank', color: 'green', hint: b ? `Reserved ${UI.money(b.reserved_amount)} · spent ${UI.money(b.spent_amount)} of ${UI.money(b.amount)}` : 'Set a purchasing budget' },
    ]);
    const period = UI.filterModal(ctx, [{ name: 'from', label: 'From', type: 'date', col: 6 }, { name: 'to', label: 'To', type: 'date', col: 6 }], { hint: `Period: ${UI.date(d.period.from)} to ${UI.date(d.period.to)} (this month by default).` });
    const payPO = (o) => UI.formModalFiles('Pay ' + UI.esc(o.po_ref), [
      { name: 'amount', label: 'Amount', type: 'money', required: true, col: 6, value: Math.max(0, +o.received_value - +o.paid_amount).toFixed(2) },
      { name: 'supplier_invoice_no', label: 'Supplier invoice no.', required: true, col: 6, value: o.supplier_invoice_no },
      ...UI.payFields(d.methods),
      { name: 'or_doc', label: 'Official receipt / payment confirmation (required)', type: 'file', required: true, col: 12, attrs: 'accept="application/pdf,image/*"' }],
      'Finance.po_pay', { extra: { po_id: o.id }, submit: 'Record payment',
        intro: `Check the supplier invoice against the approved PO and the received items. PO total ${UI.money(o.total_amount)}; received ${UI.money(o.received_value)}; already paid ${UI.money(o.paid_amount)}. You can pay only what was received.` });
    const box = document.createElement('div'); ctx.el.append(box);
    UI.tabs(box, [
      ['po', `PO payables (${d.poPayables.length})`, () => UI.table([['PO', 'po_ref'], ['Supplier', 'supplier'], ['Approved by', 'approved_by_name'], ['Status', 'status', 'badge'], ['Total', 'total_amount', 'money'],
        ['Received value', 'received_value', 'money'], ['Paid', 'paid_amount', 'money'], ['Payment', 'payment_status', 'badge']], d.poPayables,
        { title: 'Approved purchase orders (Pending Payment)', actions: (o) => UI.btn('po', 'View PO', 'outline-secondary') + (act && +o.received_value > +o.paid_amount ? UI.btn('pay', 'Pay', 'primary') : ''),
          onAction: (a, o) => a === 'pay' ? payPO(o) : PurUI.printPO(o), empty: 'No purchase order is waiting for payment.' })],
      ['ap', 'Other payables', (body) => {
        const h = UI.table([['Ref', 'payable_ref'], ['Payee', 'payee'], ['Category', 'category'], ['Truck', 'plate_number'], ['Description', 'description'], ['Due', 'due_on', 'date'],
          ['Amount', 'amount', 'money'], ['Paid', 'paid_amount', 'money'], ['Balance', 'balance', 'money'], ['Status', 'status', 'badge']], d.payables,
          { title: 'Bills to pay (not from a purchase order)', actions: (p) => act && p.status !== 'Paid' ? UI.btn('pay', 'Pay', 'primary') : '',
            onAction: (a, p) => UI.formModalFiles('Pay ' + UI.esc(p.payable_ref), [{ name: 'amount', label: 'Amount', type: 'money', value: p.balance, required: true, col: 12 }, ...UI.payFields(d.methods),
              { name: 'or_doc', label: 'Receipt (optional)', type: 'file', col: 12 }], 'Finance.payable_pay', { extra: { payable_id: p.id } }),
            tools: act ? '<button class="btn btn-sm btn-primary" data-addap><i class="bi bi-plus"></i> Add payable</button>' : '' });
        setTimeout(() => body.querySelector('[data-addap]')?.addEventListener('click', () => UI.formModalFiles('Add payable', [
          { name: 'payee', label: 'Payee', required: true, col: 6 }, { name: 'supplier_id', label: 'Supplier (optional)', type: 'select', options: UI.opts(d.suppliers, s => s.name), col: 6 },
          { name: 'category', label: 'Category', type: 'select', options: UI.list(d.categories), required: true, col: 6 }, { name: 'vehicle_id', label: 'Truck (optional)', type: 'select', options: UI.opts(d.trucks, v => v.plate_number), col: 6 },
          { name: 'description', label: 'Description', required: true, col: 12 }, { name: 'amount', label: 'Amount', type: 'money', required: true, col: 6 }, { name: 'due_on', label: 'Due date', type: 'date', col: 6 },
          { name: 'bill', label: 'Bill / invoice file (optional)', type: 'file', col: 12 }], 'Finance.payable_add')), 0);
        return h;
      }],
      ['expenses', 'Expenses', (body) => {
        const h = period + UI.table([['Date', 'incurred_on', 'date'], ['Category', 'category'], ['Amount', 'amount', 'money'], ['Trip', 'trip_ref'], ['Truck', 'plate_number'], ['Payee', 'payee'], ['Reference', 'reference_number'],
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
        ['Payee', 'payee'], ['Method', 'payment_method'], ['Cheque', 'cheque_number'], ['Bank', 'bank_name'], ['Reference', 'reference_number'], ['Amount', 'amount', 'money'], ['By', 'recorded_by_name']], d.disbursements, { title: 'Cash released (payment vouchers)' })],
      ['budget', 'Purchasing budget', (body) => {
        const h = `<div class="small text-muted mb-2">Purchase orders are approved only when the active budget can cover them. The amount is <b>reserved</b> at approval and becomes <b>spent</b> when Finance pays.</div>`
          + UI.table([['Period', 'period_start', (v, r) => UI.date(v) + ' – ' + UI.date(r.period_end)], ['Budget', 'amount', 'money'], ['Reserved', 'reserved_amount', 'money'], ['Spent', 'spent_amount', 'money'], ['Available', 'available', 'money'], ['Status', 'status', 'badge'], ['Set by', 'set_by_name']], d.budgets,
            { title: 'Budgets', tools: act ? '<button class="btn btn-sm btn-primary" data-setb><i class="bi bi-plus"></i> Set new budget</button>' : '', empty: 'No budget yet.' });
        setTimeout(() => body.querySelector('[data-setb]')?.addEventListener('click', () => UI.formModal('Set purchasing budget', [
          { name: 'amount', label: 'Budget amount', type: 'money', required: true, col: 12 }, { name: 'period_start', label: 'From', type: 'date', value: UI.today(), required: true, col: 6 },
          { name: 'period_end', label: 'To', type: 'date', required: true, col: 6 }], 'Finance.budget_set', { intro: 'The current active budget is closed; reservations of approved POs stay with their budget.' })), 0);
        return h;
      }],
      ['cash', 'Cash flow', () => UI.blocks({ charts: [{ type: 'bar', format: 'money', title: 'Cash in (collections) vs cash out (disbursements), last 12 months', labels: d.cashflow.map(x => x.m),
        datasets: [{ label: 'Cash in (collections)', data: d.cashflow.map(x => +x.cash_in) }, { label: 'Cash out (disbursements)', data: d.cashflow.map(x => +x.cash_out) }] }],
        tables: [{ title: 'Monthly cash flow', columns: [['Month', 'm'], ['Cash in', 'cash_in', 'money'], ['Cash out', 'cash_out', 'money'], ['Net', 'net', 'money']], rows: d.cashflow.map(x => ({ ...x, net: +x.cash_in - +x.cash_out })) }] })],
    ], ctx.query.from ? 'expenses' : null);
  },
});
