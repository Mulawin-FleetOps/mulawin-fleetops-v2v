/* assets/js/modules/general/documents.js — DOCUMENTS
   One place to find every uploaded file you are allowed to see (trip documents, OR/CR,
   insurance, client accreditation, receipts, photos ...), with expiry reminders.
   Most files are attached on their own screens (trip completion, client profile, repair);
   here you can also upload company files and truck / driver / client documents.
   Backend: backend/Modules/General/Documents.php */
'use strict';
App.page('documents', {
  title: 'Documents',
  subtitle: 'Search, view and download the files linked to trips, trucks, clients and transactions.',
  render(ctx) {
    const d = ctx.data, q = ctx.query;
    if (d.uploadTypes.length) {
      const b = document.createElement('button'); b.className = 'btn btn-sm btn-primary'; b.innerHTML = '<i class="bi bi-upload"></i> Upload';
      b.onclick = () => {
        const wrap = UI.modal('Upload documents', UI.fields([
          { name: 'entity_type', label: 'Belongs to', type: 'select', required: true, col: 6, options: d.uploadTypes.map(t => [t, d.entityLabels[t]]) },
          { name: 'entity_id', label: 'Record', type: 'select', col: 6, options: [] },
          { name: 'category', label: 'Category', type: 'select', options: UI.list(d.categories), required: true, col: 6 },
          { name: 'expires_on', label: 'Expiry date (for reminders)', type: 'date', col: 6 },
          { name: 'notes', label: 'Description', col: 12 },
          { name: 'files', label: 'Files (PDF, JPG, PNG; up to 20 at a time)', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="application/pdf,image/*"' }]),
          async (x, form) => {
            if (x.entity_type !== 'company' && !x.entity_id) throw new Error('Choose the record.');
            const fd = new FormData(); ['entity_type', 'entity_id', 'category', 'expires_on', 'notes'].forEach(k => fd.append(k, x[k] || ''));
            if (x.entity_type === 'company') fd.set('entity_id', '');
            [...form.querySelector('[name=files]').files].forEach(f => fd.append('files[]', f));
            UI.result(await App.upload(fd)); App.route();
          }, { submit: 'Upload' });
        const type = wrap.querySelector('[name=entity_type]'), rec = wrap.querySelector('[name=entity_id]');
        const fill = () => { const list = d.records[type.value] || []; rec.innerHTML = type.value === 'company' ? '<option value="">(not linked)</option>' : '<option value="">Choose…</option>' + list.map(r => `<option value="${r.id}">${UI.esc(r.label)}</option>`).join(''); rec.disabled = type.value === 'company'; };
        type.onchange = fill; fill();
      };
      ctx.tools.append(b);
    }
    const rows = d.documents.filter(x => (!q.category || x.category === q.category) && (!q.entity_type || x.entity_type === q.entity_type)
      && (!q.expiring || (x.days_left !== null && +x.days_left <= +d.alertDays)));
    const expiring = d.documents.filter(x => x.days_left !== null && +x.days_left <= +d.alertDays);
    ctx.el.innerHTML = UI.cards([
      { label: 'Documents you can see', value: d.documents.length, icon: 'bi-folder2-open' },
      { label: `Expiring within ${d.alertDays} days or expired`, value: expiring.length, icon: 'bi-calendar-x', color: 'red' },
    ]) + UI.filterModal(ctx, [
      { name: 'entity_type', label: 'Belongs to', type: 'select', options: Object.entries(d.entityLabels), col: 6 },
      { name: 'category', label: 'Category', type: 'select', options: UI.list([...new Set(d.documents.map(x => x.category))].sort()), col: 6 },
      { name: 'expiring', label: 'Expiry', type: 'select', options: [['1', 'Expiring / expired only']], col: 6 }])
      + UI.table([['File', 'original_filename', (v, r) => `<a href="${UI.docUrl(r.id)}" target="_blank" rel="noopener">${UI.esc(v)}</a>`], ['Category', 'category'],
        ['Belongs to', 'entity_type', (v) => UI.esc(d.entityLabels[v] || v)], ['Record', 'record_label'], ['Expiry', 'expires_on', (v, r) => v ? UI.date(v) + ' ' + UI.days(r.days_left) : '—'],
        ['Description', 'notes'], ['Uploaded by', 'uploader'], ['Date', 'created_at', 'date']], rows,
        { title: 'Documents', actions: () => UI.btn('dl', 'Download', 'outline-secondary'), onAction: (a, r) => { window.location = UI.docUrl(r.id, false); } });
    UI.activate(ctx.el);
  },
});
