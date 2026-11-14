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


/* HEAD EXECUTIVE TABLE WORKSPACE
 * A view-only layout adapter, limited to the admin's Finance/Billing pages.
 * Keeps the existing UI.table state, action buttons, paging and API handlers.
 * Client Management retains its own established RecordComponents.mountPanel().
 */
const mountHeadWorkspace = (root) => {
  if (!UI.role('admin') || !['finance','billing'].includes(App.current?.page)) return;
  const panels = [...(root.matches?.('.panel') ? [root] : []), ...root.querySelectorAll('.panel')];
  panels.forEach(panel => {
    if (panel.dataset.headWorkspaceMounted || panel.closest('.app-drawer,.modal,.head-monitor-panel')) return;
    const toolbar = panel.querySelector('.table-tools');
    const box = panel.querySelector('[data-tbody]');
    if (!toolbar || !box || !panel.contains(toolbar)) return;
    const id = box.dataset.tbody, state = UI._tables[id];
    if (!state || state.opts.plain) return;
    panel.dataset.headWorkspaceMounted = '1';
    panel.classList.add('record-workspace-panel','head-finance-table');
    const titleNode = panel.querySelector('.panel-head .panel-title');
    const title = titleNode?.textContent?.trim() || state.opts.title || 'Records';
    const heading = document.createElement('div');
    heading.className = 'record-workspace-heading';
    const label = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = title;
    label.append(h);
    const count = toolbar.querySelector('[data-tcount]');
    const subtitle = document.createElement('p');
    subtitle.className = 'record-workspace-count';
    if (count) subtitle.append(count);
    label.append(subtitle);
    heading.append(label);
    // Preserve real buttons such as Add payable / Add expense / Set budget.
    const toolbarRight = toolbar.querySelector('.table-tools-right');
    if (toolbarRight) {
      [...toolbarRight.children].filter(el => el !== count).forEach(el => heading.append(el));
    }
    const row = document.createElement('div');
    row.className = 'record-workspace-search';
    const search = toolbar.querySelector('.table-search');
    if (search) row.append(search);
    const fields = state.columns.filter(col => ['status','payment_status','category','source_type','truck_type'].includes(col[1]));
    const field = fields[0]?.[1];
    const original = state.rows.slice();
    let selected = '', sort = 'default';
    const menuId = 'headwork-' + id;
    const sortId = menuId + '-sort';
    const makeButton = (cls, icon, name, target) => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'btn btn-sm btn-outline-secondary ' + cls;
      b.setAttribute('aria-controls',target); b.setAttribute('aria-expanded','false');
      b.innerHTML = '<i class="bi '+icon+'" aria-hidden="true"></i> '+name;
      return b;
    };
    const filterBtn = field ? makeButton('record-workspace-filter-trigger','bi-funnel','Filter',menuId) : null;
    const sortBtn = makeButton('record-workspace-sort-trigger','bi-arrow-down-up','Sort',sortId);
    if (filterBtn) row.append(filterBtn);
    row.append(sortBtn);
    const menus = document.createElement('div');
    menus.className='record-workspace-popovers';
    const values = field ? [...new Set(original.map(r=>String(r[field] ?? '')).filter(Boolean))].sort() : [];
    const options = values.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('');
    menus.innerHTML = (field ? '<div class="record-workspace-popover" id="'+menuId+'" hidden><strong>Filter '+UI.esc(title)+'</strong>'
      +'<label>'+UI.esc(field.replaceAll('_',' '))+'<select class="form-select form-select-sm" data-head-work-status>'
      +'<option value="">All</option>'+options+'</select></label>'
      +'<div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
      +'<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>' : '')
      +'<div class="record-workspace-popover record-workspace-sort-panel" id="'+sortId+'" hidden><strong>Sort records</strong>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="default" data-record-sort checked> Default</label>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="asc" data-record-sort> A–Z</label>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="'+sortId+'" value="desc" data-record-sort> Z–A</label></div>';
    row.append(menus);
    const categories = document.createElement('div');
    categories.className='record-workspace-category-row';
    if (field && values.length > 0 && values.length <= 5) {
      categories.append(...[['','All'],...values.map(v=>[v,v])].map(([value,name]) => {
        const b=document.createElement('button');b.type='button';b.className='btn btn-sm '+(value?'btn-outline-secondary':'btn-primary');
        b.textContent=name;b.dataset.headWorkCategory=value;b.setAttribute('aria-pressed',String(!value));
        return b;
      }));
      categories.addEventListener('click',event=>{
        const button=event.target.closest('[data-head-work-category]');
        if(!button)return;
        selected=button.dataset.headWorkCategory;
        const select=menus.querySelector('[data-head-work-status]');
        if(select)select.value=selected;
        apply();
      });
    }
    const apply=()=>{
      let rows=original.filter(r=>!selected||String(r[field]??'')===selected);
      if(sort!=='default'){
        const key=state.columns[0][1];
        rows.sort((a,b)=>(sort==='asc'?1:-1)*String(a[key]??'').localeCompare(String(b[key]??''),undefined,{numeric:true}));
      }
      state.rows=rows;state.page=0;UI.drawTable(id);
      categories.querySelectorAll('[data-head-work-category]').forEach(b=>{
        const on=b.dataset.headWorkCategory===selected;
        b.classList.toggle('btn-primary',on);b.classList.toggle('btn-outline-secondary',!on);
        b.setAttribute('aria-pressed',String(on));
      });
    };
    const pageHeader=panel.querySelector(':scope > .panel-head');
    // Move existing header actions rather than deleting them.
    if(pageHeader){
      [...pageHeader.querySelectorAll('.panel-tools > *')].forEach(node=>heading.append(node));
      pageHeader.remove();
    }
    toolbar.replaceWith(heading,row,categories);
    RecordComponents.bindDropdowns(panel,{
      apply(filterPanel){ selected=filterPanel.querySelector('[data-head-work-status]').value;apply();filterBtn?.click(); },
      reset(){ selected='';const select=menus.querySelector('[data-head-work-status]');if(select)select.value='';apply();filterBtn?.click(); },
      sort(value){sort=value;apply();}
    },{filter:menuId,sort:sortId});
  });
};
// Integrate only explicitly scoped executive finance/billing tables as they mount.
(() => {
  const activate=UI.activate;
  UI.activate=(root)=>{
    activate(root);
    mountHeadWorkspace(root);
  };
})();
