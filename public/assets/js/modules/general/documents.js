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
    // DOCUMENTS_VIEW_ONLY_V1: Upload from the related workflow, not this library.
    // CHECKLIST_DOCS_FILE_MANAGER_GROUPS_V1
    // Each folder is ONE authorized record (entity_type + entity_id).
    // File uploads stay linked to their original records; no database changes.
    const rows = d.documents.filter(x => (!q.category || x.category === q.category) && (!q.entity_type || x.entity_type === q.entity_type)
      && (!q.expiring || (x.days_left !== null && +x.days_left <= +d.alertDays)));
    const expiring = d.documents.filter(x => x.days_left !== null && +x.days_left <= +d.alertDays);

    const groups = new Map();
    rows.forEach(file => {
      const key = String(file.entity_type) + ':' + String(file.entity_id ?? '');
      if (!groups.has(key)) groups.set(key, {
        type: String(file.entity_type), id: file.entity_id,
        label: file.record_label || (file.entity_type === 'company' ? 'Company files' : 'Record #' + file.entity_id),
        files: [], newest: file.created_at || '', latestId: Number(file.id) || 0
      });
      const folder = groups.get(key);
      folder.files.push(file);
      if (String(file.created_at || '') > folder.newest) folder.newest = file.created_at;
      folder.latestId = Math.max(folder.latestId, Number(file.id) || 0);
    });
    const groupedByType = new Map();
    [...groups.values()].sort((a, b) => b.latestId - a.latestId).forEach(folder => {
      if (!groupedByType.has(folder.type)) groupedByType.set(folder.type, []);
      groupedByType.get(folder.type).push(folder);
    });
    const iconFor = type => ({
      trip: 'bi-truck', incident: 'bi-exclamation-triangle', maintenance: 'bi-tools',
      vehicle: 'bi-truck-front', personnel: 'bi-people', client: 'bi-building',
      purchase: 'bi-bag-check', fund: 'bi-wallet2', expense: 'bi-receipt',
      payable: 'bi-cash-stack', billing: 'bi-file-earmark-text', company: 'bi-buildings'
    }[type] || 'bi-folder2');

    const foldersHtml = [...groupedByType].map(([type, folders]) => `
      <section class="docfm-section" data-docfm-section>
        <div class="docfm-section-head"><i class="bi ${iconFor(type)}" aria-hidden="true"></i>
          <h3>${UI.esc(d.entityLabels[type] || type)}</h3><span>${folders.length} folder${folders.length === 1 ? '' : 's'}</span>
        </div>
        <div class="docfm-folders">${folders.map(folder => {
          const pictures = folder.files.filter(f => String(f.mime_type || '').startsWith('image/')).length;
          const searched = [folder.label, d.entityLabels[type] || type, ...folder.files.map(f => [f.original_filename, f.category, f.notes || ''].join(' '))].join(' ').toLocaleLowerCase();
          return `<button type="button" class="docfm-folder docfm-folder-title" data-docfm-folder
            data-docfm-key="${UI.esc(String(type) + ':' + String(folder.id ?? ''))}"
            data-docfm-search="${UI.esc(searched)}" aria-label="Open folder ${UI.esc(folder.label)}">
              <span class="docfm-folder-icon"><i class="bi bi-folder2" aria-hidden="true"></i></span>
              <span class="docfm-folder-name"><strong>${UI.esc(folder.label)}</strong>
                <small>${UI.esc(d.entityLabels[type] || type)}${folder.id ? ' · #' + UI.esc(folder.id) : ''}</small>
              </span>
              <span class="docfm-folder-meta">${folder.files.length} file${folder.files.length === 1 ? '' : 's'}${pictures ? ' · ' + pictures + ' photo' + (pictures === 1 ? '' : 's') : ''}</span>
              <i class="bi bi-box-arrow-up-right docfm-chevron" aria-hidden="true"></i>
            </button>`;
        }).join('')}</div>
      </section>`).join('');

    ctx.el.innerHTML = UI.cards([
      { label: 'Documents you can see', value: d.documents.length, icon: 'bi-folder2-open' },
      { label: `Expiring within ${d.alertDays} days or expired`, value: expiring.length, icon: 'bi-calendar-x', color: 'red' }
    ]) + UI.filterModal(ctx, [
      { name: 'entity_type', label: 'Record type', type: 'select', options: Object.entries(d.entityLabels), col: 6 },
      { name: 'category', label: 'Category', type: 'select', options: UI.list([...new Set(d.documents.map(x => x.category))].sort()), col: 6 },
      { name: 'expiring', label: 'Expiry', type: 'select', options: [['1', 'Expiring / expired only']], col: 6 }
    ]) + `<div class="docfm-toolbar">
      <div class="docfm-heading"><i class="bi bi-folder2-open" aria-hidden="true"></i><strong>Files by record</strong>
        <span>${groups.size} folder${groups.size === 1 ? '' : 's'} · ${rows.length} file${rows.length === 1 ? '' : 's'}</span></div>
      <label class="docfm-search-label"><i class="bi bi-search" aria-hidden="true"></i>
        <input type="search" class="form-control form-control-sm" data-docfm-search-input
          aria-label="Search folders and attachments" placeholder="Search folder or filename..."></label>
    </div>
    <div data-docfm-content>${foldersHtml || '<div class="text-muted p-3">No documents match the selected filters.</div>'}</div>
    <p class="text-muted small d-none" data-docfm-empty>No folders match your search.</p>`;

    // Local filename/folder search does not alter global filters or URL routing.
    const search = ctx.el.querySelector('[data-docfm-search-input]');
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      ctx.el.querySelectorAll('[data-docfm-folder]').forEach(folder => {
        const match = !query || folder.dataset.docfmSearch.includes(query);
        folder.hidden = !match;
        if (match) visible++;
      });
      ctx.el.querySelectorAll('[data-docfm-section]').forEach(section => {
        section.hidden = ![...section.querySelectorAll('[data-docfm-folder]')].some(folder => !folder.hidden);
      });
      ctx.el.querySelector('[data-docfm-empty]').classList.toggle('d-none', visible !== 0 || groups.size === 0);
    });
    // DOCFM_FOLDER_MODAL_V1 — open record folders in a modal.
    // Previews stay within the SAME modal, avoiding stacked Bootstrap modals.
    ctx.el.querySelector('[data-docfm-content]').addEventListener('click', event => {
      const button = event.target.closest('[data-docfm-folder]');
      if (!button) return;
      const folder = groups.get(button.dataset.docfmKey);
      if (!folder) return;
      const label = folder.label;
      const wrap = UI.modal(UI.esc(label), `<div class="docfm-modal-intro">
        <span><i class="bi bi-folder2-open" aria-hidden="true"></i> ${UI.esc(d.entityLabels[folder.type] || folder.type)}</span>
        <span>${folder.files.length} file${folder.files.length === 1 ? '' : 's'}</span>
      </div><div data-docfm-view>${UI.docs(folder.files)}</div>`, null, { size: 'modal-xl' });
      const view = wrap.querySelector('[data-docfm-view]');
      const initialHtml = view.innerHTML;
      const title = wrap.querySelector('.modal-title');
      view.addEventListener('click', e => {
        const file = e.target.closest('[data-doc-preview]');
        if (file) {
          // Intercept the global document preview; never open a nested modal.
          e.preventDefault();
          e.stopPropagation();
          const id = Number(file.dataset.docPreview);
          if (!Number.isSafeInteger(id) || id <= 0) return;
          const name = file.dataset.docName || 'Document';
          const mime = file.dataset.docMime || '';
          const inline = UI.docUrl(id);
          const content = mime.startsWith('image/')
            ? `<img src="${inline}" class="doc-full-image" alt="${UI.esc(name)}">`
            : mime === 'application/pdf'
              ? `<iframe src="${inline}" class="doc-pdf-frame" title="${UI.esc(name)}"></iframe>`
              : '<div class="p-3 text-muted">Preview unavailable. Download the file instead.</div>';
          title.textContent = name;
          view.innerHTML = `<div class="docfm-modal-nav">
            <button type="button" class="btn btn-outline-secondary btn-sm" data-docfm-back><i class="bi bi-arrow-left"></i> Back to files</button>
            <div class="d-flex flex-wrap gap-2">
              <a class="btn btn-outline-secondary btn-sm" href="${inline}" target="_blank" rel="noopener">Open in new tab</a>
              <a class="btn btn-primary btn-sm" href="${UI.docUrl(id, false)}" download>Download</a>
            </div>
          </div><div class="doc-full-frame">${content}</div>`;
        } else if (e.target.closest('[data-docfm-back]')) {
          e.preventDefault();
          title.textContent = label;
          view.innerHTML = initialHtml;
        }
      });
    });
    UI.activate(ctx.el);
  },
});
