/* assets/js/modules/accounting/funds.js — TRIP FUNDS
   Dispatcher submits (or revises) the fund request; Operations Head approves or rejects;
   Finance releases (Confirm Release) and later records the liquidation.
   Printable REQUEST FOR CASH FUND form (PDF #13).
   Backend: backend/Modules/Accounting/Funds.php */
'use strict';
const FundUI = {
  async print(id) {
    let r; try { r = await App.api('Funds.details', { fund_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const f = r.fund;
    UI.printForm('REQUEST FOR CASH FUND', `<div class="pf-grid"><div><b>DEPARTMENT:</b> Operations (${UI.esc(UI.label(f.dispatcher_role))})</div><div><b>DATE:</b> ${UI.date(f.created_at)}</div>
      <div><b>NAME:</b> ${UI.esc(f.requested_by_name)}</div><div><b>TRIP:</b> ${UI.esc(f.trip_ref)} · ${UI.esc(f.plate_number || '')}</div>
      <div style="grid-column:1/3"><b>PURPOSE:</b> Trip allowance: ${UI.esc(f.client)}, ${UI.esc(f.pickup_point)} to ${UI.esc(f.delivery_point)} (${UI.datetime(f.scheduled_at)})${f.driver_name ? ', driver ' + UI.esc(f.driver_name) : ''}</div>
      <div style="grid-column:1/3"><b>AMOUNT REQUESTED:</b> ${UI.money(f.amount)}</div></div>
      <table><thead><tr><th>Expense category</th><th class="num">Amount</th></tr></thead><tbody>${f.lines.map(l => `<tr><td>${UI.esc(l.category_name)}${+l.is_preset ? '' : ' (added)'}</td><td class="num">${UI.money(l.amount)}</td></tr>`).join('')}
      <tr><th>TOTAL</th><th class="num">${UI.money(f.amount)}</th></tr></tbody></table>
      <div class="pf-note">NOTE: SUBJECT FOR LIQUIDATION</div><div><b>REMARKS:</b></div><div class="pf-box" style="min-height:34px">${UI.esc(f.notes || '')}</div>
      <div class="pf-signs">${UI.sign('Requested by', f.requested_by_name, f.requested_by)}${UI.sign('Approved by (Operations Head)', f.approved_by_name || '', f.approved_by)}</div>
      <div class="drawer-h mt-3">FOR ACCOUNTING USE</div>
      <div><b>ACCOUNTING REMARKS:</b></div><div class="pf-box" style="min-height:34px">${f.voucher_number ? 'Released ' + UI.date(f.released_on) + ' via ' + UI.esc(f.payment_method) + ', voucher ' + UI.esc(f.voucher_number) + (f.reference_number ? ', ref ' + UI.esc(f.reference_number) : '') + (f.cheque_number ? ', cheque ' + UI.esc(f.cheque_number) : '') : ''}
${f.liquidation_status === 'Liquidated' ? 'Liquidated: spent ' + UI.money(f.liquidated_amount) + ', returned ' + UI.money(f.returned_amount) : ''}</div>
      <div class="pf-signs">${UI.sign('Checked by (Finance)', f.released_by_name || '', f.released_by)}${UI.sign('Approved by')}</div>`, { number: f.fund_ref });
  },
};

App.page('funds', {
  title: 'Trip Funds',
  subtitle: 'Trip allowance requests: dispatcher submits, Operations Head approves, Finance releases.',
  render(ctx) {
    const d = ctx.data;
    if (d.can.submit) {
      const b = document.createElement('button'); b.className = 'btn btn-sm btn-primary'; b.innerHTML = '<i class="bi bi-plus-lg"></i> New fund request';
      b.onclick = () => {
        if (!d.eligibleTrips.length) return UI.toast('No pre-assigned trip needs a fund request right now.', 'warn');
        UI.modal('New fund request', UI.fields([{ name: 'trip_id', label: 'Trip', type: 'select', required: true, col: 12, options: d.eligibleTrips.map(t => [t.id, `${t.trip_ref} · ${t.plate_number || ''} · ${t.pickup_point} → ${t.delivery_point}`]) }]),
          async (x) => { UI.fundForm({ title: 'Fund request', categories: d.categories, action: 'Funds.submit', payload: { trip_id: x.trip_id }, intro: 'Choose the applicable expenses. The system takes the preset amounts and computes the total.' }); },
          { size: '', submit: 'Next' });
      };
      ctx.tools.append(b);
    }
    const n = (s) => d.funds.filter(f => f.status === s).length;
    const toLiq = d.funds.filter(f => f.status === 'Released' && f.liquidation_status === 'Not Liquidated' && ['Completed', 'Cancelled'].includes(f.trip_status));
    ctx.el.innerHTML = UI.cards([
      { label: 'Pending approval', value: n('Pending Approval'), icon: 'bi-hourglass-split', color: 'amber' },
      { label: 'Ready for release', value: n('Ready for Release'), icon: 'bi-cash-coin', color: 'blue' },
      { label: 'Rejected (to revise)', value: n('Rejected'), icon: 'bi-arrow-counterclockwise', color: 'red' },
      { label: 'Released', value: n('Released'), icon: 'bi-check-circle', color: 'green' },
      { label: 'To liquidate', value: toLiq.length, icon: 'bi-receipt', color: 'gray' },
    ]);
    const cols = [['Fund', 'fund_ref'], ['Trip', 'trip_ref'], ['Client', 'client'], ['Truck', 'plate_number'], ['Breakdown', 'breakdown'], ['Amount', 'amount', 'money'],
      ['Status', 'status', 'badge'], ['Requested by', 'requested_by_name'], ['Date', 'created_at', 'date']];
    const actions = (f) => {
      let h = UI.btn('print', 'Print form', 'outline-secondary') + UI.btn('trip', 'Trip');
      if (d.can.approve && f.status === 'Pending Approval') h += UI.btn('approve', 'Approve', 'success') + UI.btn('reject', 'Reject', 'outline-danger');
      if (d.can.release && f.status === 'Ready for Release') h += UI.btn('release', 'Confirm Release', 'primary');
      if (d.can.release && f.status === 'Released' && f.liquidation_status === 'Not Liquidated' && ['Completed', 'Cancelled'].includes(f.trip_status)) h += UI.btn('liquidate', 'Liquidate', 'outline-primary');
      if (d.can.submit && f.status === 'Rejected' && !['Completed', 'Cancelled', 'Rejected'].includes(f.trip_status)) h += UI.btn('revise', 'Revise', 'primary');
      return h;
    };
    const onAction = async (a, f) => {
      if (a === 'print') FundUI.print(f.id);
      if (a === 'trip') { App.go('trips'); setTimeout(() => TripUI.open(f.trip_id), 600); }
      if (a === 'approve') UI.confirmAction('Approve ' + UI.esc(f.fund_ref), `Approve ${UI.money(f.amount)} for ${UI.esc(f.trip_ref)}? It goes to Finance for release.<br><span class="small text-muted">${UI.esc(f.breakdown)}</span>`, 'Funds.decide', { fund_id: f.id, decision: 'approve' }, { submit: 'Approve' });
      if (a === 'reject') UI.confirmAction('Reject ' + UI.esc(f.fund_ref), 'The dispatcher revises and resubmits it.', 'Funds.decide', { fund_id: f.id, decision: 'reject' }, { danger: true, submit: 'Reject', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }] });
      if (a === 'release') UI.formModal('Confirm release of ' + UI.esc(f.fund_ref), UI.payFields(d.methods), 'Funds.release', { extra: { fund_id: f.id }, submit: 'Confirm Release',
        intro: `Release <b>${UI.money(f.amount)}</b> for ${UI.esc(f.trip_ref)} (${UI.esc(f.breakdown)}). Allowed even before the pre-dispatch checklist.` });
      if (a === 'liquidate') UI.formModalFiles('Liquidation of ' + UI.esc(f.fund_ref), [
        { name: 'liquidated_amount', label: 'Actual amount spent', type: 'money', required: true, col: 6, value: f.amount },
        { name: 'liquidation_notes', label: 'Notes', col: 6 }, { name: 'receipts', label: 'Receipts (optional)', type: 'file', multiple: true, col: 12 }],
        'Funds.liquidate', { extra: { fund_id: f.id }, intro: `Released: ${UI.money(f.amount)}. Returned cash = released minus spent.` });
      if (a === 'revise') { const r = await App.api('Trips.details', { trip_id: f.trip_id }); const old = r.funds.find(x => x.id == f.id);
        UI.fundForm({ title: 'Revise ' + f.fund_ref, categories: d.categories, action: 'Funds.submit', payload: { trip_id: f.trip_id }, selected: old.lines.filter(l => +l.is_preset).map(l => l.category_name),
          extra: old.lines.filter(l => !+l.is_preset).map(l => ({ name: l.category_name, amount: l.amount })), intro: 'Rejected because: ' + UI.esc(f.rejected_reason || '') }); }
    };
    const box = document.createElement('div'); ctx.el.append(box);
    const def = UI.role('operations_head') ? 'pending' : UI.role('finance') ? 'release' : null;
    UI.tabs(box, [
      ['pending', `Pending approval (${n('Pending Approval')})`, () => UI.table(cols, d.funds.filter(f => f.status === 'Pending Approval'), { actions, onAction, empty: 'Nothing waiting for approval.' })],
      ['release', `Ready for release (${n('Ready for Release')})`, () => UI.table(cols, d.funds.filter(f => f.status === 'Ready for Release'), { actions, onAction, empty: 'Nothing to release.' })],
      ['liquidate', `To liquidate (${toLiq.length})`, () => UI.table([...cols, ['Released', 'released_at', 'date'], ['Voucher', 'voucher_number']], toLiq, { actions, onAction, empty: 'Nothing to liquidate.' })],
      ['all', 'All requests', () => UI.table([...cols, ['Liquidation', 'liquidation_status', 'badge'], ['Voucher', 'voucher_number']], d.funds, { title: 'All fund requests', actions, onAction })],
    ], def);
  },
});
