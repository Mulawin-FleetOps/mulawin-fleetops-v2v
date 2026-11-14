/* Reusable record-workspace components for Vanilla JS pages.
 * Uses existing UI.statusStrip and UI.table while preserving backend permissions.
 * Presentation only: no changes to permissions, filtering rules, or API actions.
 */
'use strict';

const RecordComponents = Object.freeze({
  kpis(items) {
    return '<div class="record-workspace-kpis">' + UI.statusStrip(items) + '</div>';
  },

  tabs(items, active, attribute = 'data-record-tab') {
    return '<nav class="record-workspace-tabs" aria-label="Record views">'
      + items.map(item => {
        const selected = String(item.value) === String(active);
        return '<button type="button" class="record-workspace-tab' + (selected ? ' active' : '')
          + '" ' + attribute + '="' + UI.esc(item.value) + '" aria-pressed="' + selected + '">'
          + UI.esc(item.label) + '</button>';
      }).join('')
      + '</nav>';
  },

  categories(items, active, attribute = 'data-record-category') {
    return '<div class="record-workspace-categories" role="group" aria-label="Record categories">'
      + items.map(item => {
        const selected = String(item.value) === String(active);
        return '<button type="button" class="btn btn-sm '
          + (selected ? 'btn-primary' : 'btn-outline-secondary')
          + '" ' + attribute + '="' + UI.esc(item.value) + '" aria-pressed="' + selected + '">'
          + UI.esc(item.label) + '</button>';
      }).join('')
      + '</div>';
  },

  panel(tableHtml, categoryHtml = '') {
    return '<div class="record-workspace-panel">' + tableHtml + categoryHtml + '</div>';
  },

  // Moves existing table controls without cloning the input or its event listeners.
  mountPanel(root, {
    title = 'Records',
    categorySelector = '.record-workspace-categories',
    addSelector = '.record-workspace-add',
    filterSelector = '.record-workspace-filter-trigger',
    sortSelector = '.record-workspace-sort-trigger',
    panelsSelector = '.record-workspace-popovers',
  } = {}) {
    const panel = root.querySelector('.record-workspace-panel .panel');
    const toolbar = panel?.querySelector('.table-tools');
    if (!toolbar) return false;
    const heading = document.createElement('div');
    heading.className = 'record-workspace-heading';
    const left = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = title;
    left.append(h);
    const subtitle = document.createElement('p');
    subtitle.className = 'record-workspace-count';
    subtitle.textContent = '0 records';
    const count = toolbar.querySelector('[data-tcount]');
    if (count) subtitle.replaceChildren(count);
    left.append(subtitle);
    heading.append(left);
    const add = toolbar.querySelector(addSelector);
    if (add) heading.append(add);

    const searchRow = document.createElement('div');
    searchRow.className = 'record-workspace-search';
    const search = toolbar.querySelector('.table-search');
    const filter = toolbar.querySelector(filterSelector);
    const sort = toolbar.querySelector(sortSelector);
    const panels = toolbar.querySelector(panelsSelector);
    if (search) searchRow.append(search);
    if (filter) searchRow.append(filter);
    if (sort) searchRow.append(sort);
    if (panels) searchRow.append(panels);

    const categoryRow = document.createElement('div');
    categoryRow.className = 'record-workspace-category-row';
    const categories = root.querySelector(categorySelector);
    if (categories) categoryRow.append(categories);

    toolbar.replaceWith(heading, searchRow, categoryRow);
    return true;
  },

  // Reuse the Client Management layout for existing Finance/Billing tab
  // callbacks. Move the actual table nodes so action handlers are preserved.
  executiveTabs(root, tabs, active, title) {
    if (!tabs.length) return;
    let selected=active && tabs.some(tab=>tab[0]===active)?active:tabs[0][0];
    const show=key=>{
      selected=key;
      const tab=tabs.find(item=>item[0]===key)||tabs[0];
      root.innerHTML='';
      const rendered=tab[2](root);
      if(typeof rendered==='string')root.innerHTML=rendered;
      const oldPanel=[...root.querySelectorAll('.panel')].find(el=>el.querySelector('.table-tools'));
      if(!oldPanel){ // A chart-only tab retains its native chart and report renderers.
        UI.activate(root);
        return;
      }
      const extra=[...root.childNodes].filter(node=>node!==oldPanel);
      const contents=oldPanel.querySelector(':scope > .panel-body');
      const panel=document.createElement('section');
      panel.className='panel';
      const body=document.createElement('div');
      body.className='panel-body flush';
      if(contents)while(contents.firstChild)body.append(contents.firstChild);
      panel.append(body);
      const categories=this.categories(tabs.map(([value,label])=>({value,label})),selected,'data-executive-tab');
      const shell=document.createElement('div');
      shell.innerHTML=this.panel('',categories);
      const workspace=shell.querySelector('.record-workspace-panel');
      // Keep existing date-range filters, explanatory copy and charts.
      extra.forEach(node=>workspace.append(node));
      workspace.prepend(panel);
      root.replaceChildren(workspace);
      this.mountPanel(root,{title});
      root.querySelectorAll('[data-executive-tab]').forEach(button=>
        button.addEventListener('click',()=>show(button.dataset.executiveTab)));
      UI.activate(root);
      const tableBody=root.querySelector('[data-tbody]');
      if(tableBody)this.keepExecutiveEmptyTable(root,tableBody.dataset.tbody);
    };
    show(selected);
  },

  keepExecutiveEmptyTable(root,id) {
    const t=UI._tables[id],box=root.querySelector('[data-tbody="'+id+'"]');
    if(!t||!box||UI.tableRows(id).length)return;
    const cols=t.columns;
    box.innerHTML='<table class="data-table"><thead><tr>'
      +cols.map(([label,,format])=>'<th>'+UI.esc(UI.columnLabel(label,format))+'</th>').join('')
      +(t.hasActions?'<th class="actions-col">Action</th>':'')+'</tr></thead><tbody><tr><td colspan="'+(cols.length+(t.hasActions?1:0))+'">'
      +'<div class="table-empty" role="status">'+UI.esc(t.opts.empty||'No records available.')+'</div></td></tr></tbody></table>';
    const pager=root.querySelector('[data-tpager="'+id+'"]');
    if(pager)pager.innerHTML=UI.recordPager({total:0,page:1,pages:1,pageSize:t.limit});
  },

  // Accessible floating filter/sort panels. No Bootstrap modal or backdrop.
  bindDropdowns(root, handlers = {}, ids = {filter:'truck-filter-panel', sort:'truck-sort-panel'}) {
    const filter = root.querySelector('.record-workspace-filter-trigger');
    const sort = root.querySelector('.record-workspace-sort-trigger');
    const filterPanel = root.querySelector('#' + ids.filter);
    const sortPanel = root.querySelector('#' + ids.sort);
    const entries = [[filter, filterPanel], [sort, sortPanel]];
    const closeAll = () => entries.forEach(([button, panel]) => {
      if (!button || !panel) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });
    entries.forEach(([button, panel]) => {
      if (!button || !panel) return;
      button.addEventListener('click', () => {
        const opening = panel.hidden;
        closeAll();
        panel.hidden = !opening;
        button.setAttribute('aria-expanded', String(opening));
        if (opening) panel.querySelector('select,input')?.focus();
      });
    });
    const onPointer = event => {
      if (!root.isConnected) { document.removeEventListener('pointerdown', onPointer); return; }
      if (!event.target.closest('.record-workspace-search')) closeAll();
    };
    const onKey = event => {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (event.key === 'Escape') { closeAll(); (filter?.getAttribute('aria-expanded') === 'true' ? filter : sort)?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-record-filter-apply]')?.addEventListener('click', () => handlers.apply?.(filterPanel));
    root.querySelector('[data-record-filter-reset]')?.addEventListener('click', () => handlers.reset?.());
    root.querySelectorAll('[data-record-sort]').forEach(option => option.addEventListener('change', event => {
      if (!event.target.checked) return;
      handlers.sort?.(event.target.value);
      closeAll();
    }));
  },
});


