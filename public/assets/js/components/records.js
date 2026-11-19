/* Reusable record-workspace components for Vanilla JS pages.
 * Uses existing UI.statusStrip and UI.table while preserving backend permissions.
 * Presentation only: no changes to permissions, filtering rules, or API actions.
 */
'use strict';

const RecordComponents = Object.freeze({
  // Shared client-grouped trip table: presentation only; original rows/actions remain.
  clientTripSort(rows,key='client') {
    return rows.map((row,i)=>({row,i})).sort((a,b)=>
      String(a.row[key]||'Unspecified client').localeCompare(String(b.row[key]||'Unspecified client'),undefined,{numeric:true,sensitivity:'base'})||a.i-b.i).map(x=>x.row);
  },
  tripGroupControls() {
    return '<div class="record-client-group-switch" role="group" aria-label="Trip display">'
      +'<button type="button" class="active" aria-pressed="true" data-trip-group-mode="grouped"><i class="bi bi-collection" aria-hidden="true"></i> Grouped</button>'
      +'<button type="button" aria-pressed="false" data-trip-group-mode="all">All Trips</button></div>';
  },
  bindTripGroupControls(root,change) {
    root.querySelectorAll('[data-trip-group-mode]').forEach(button=>button.addEventListener('click',()=>{
      const grouped=button.dataset.tripGroupMode==='grouped';
      root.querySelectorAll('[data-trip-group-mode]').forEach(other=>{
        const selected=other===button;
        other.classList.toggle('active',selected);
        other.setAttribute('aria-pressed',String(selected));
      });
      change(grouped);
    }));
  },
  decorateTripGroups(box,shown,all,key='client',collapsed=new Set(),searching=false,options={}) {
    const body=box?.querySelector('tbody');
    if(!body||!shown.length)return;
    const rows=[...body.querySelectorAll(':scope > tr[data-ri], :scope > tr[data-client-trip-row]')];
    if(rows.length!==shown.length)return;
    const counts=new Map();
    all.forEach(t=>{
      const name=String(t[key]||options.fallback||'Unspecified client').trim()||options.fallback||'Unspecified client';
      counts.set(name,(counts.get(name)||0)+1);
    });
    const columns=box.querySelectorAll('thead th').length||5;
    let prior=null;
    shown.forEach((trip,i)=>{
      const name=String(trip[key]||options.fallback||'Unspecified client').trim()||options.fallback||'Unspecified client';
      const row=rows[i];
      row.dataset.clientTripRow='1';
      row.dataset.tripClientName=name;
      row.hidden=!searching&&collapsed.has(name);
      if(name===prior)return;
      const group=document.createElement('tr');
      group.className='record-client-group-header';
      const cell=document.createElement('td');
      cell.colSpan=columns;
      const button=document.createElement('button');
      button.type='button';
      button.className='record-client-group-toggle';
      button.dataset.tripClientGroup=name;
      button.setAttribute('aria-expanded',String(!row.hidden));
      button.setAttribute('aria-label',(row.hidden?'Expand ':'Collapse ')+name+' '+(options.label||'trip')+' records');
      const label=document.createElement('strong');
      label.textContent=name;
      const count=document.createElement('span');
      const n=counts.get(name)||1;
      const noun=options.label||'trip';
      count.textContent=n+' '+noun+(n===1?'':'s');
      const icon=document.createElement('i');
      icon.className='bi bi-chevron-down';
      icon.setAttribute('aria-hidden','true');
      button.append(icon,label,count);
      cell.append(button);
      group.append(cell);
      row.before(group);
      prior=name;
    });
  },
  mountTripGrouping(root,id,key='client',options={}) {
    const state=UI._tables[id],box=root.querySelector('[data-tbody="'+id+'"]');
    const row=root.querySelector('.record-workspace-category-row');
    if(!state||!box||!row)return null;
    if(options.showSwitch!==false)row.insertAdjacentHTML('beforeend',this.tripGroupControls());
    let grouped=true,flat=state.rows.slice();
    const collapsed=new Set();
    const decorate=()=>{
      if(!grouped)return;
      const all=UI.tableRows(id);
      const shown=all.slice(state.page*state.limit,(state.page+1)*state.limit);
      this.decorateTripGroups(box,shown,all,key,collapsed,!!root.querySelector('[data-tsearch]')?.value.trim(),options);
    };
    const observer=new MutationObserver(()=>{
      if(!root.isConnected){observer.disconnect();return;}
      decorate();
    });
    observer.observe(box,{childList:true});
    box.addEventListener('click',event=>{
      const button=event.target.closest('[data-trip-client-group]');
      if(!button)return;
      const name=button.dataset.tripClientGroup;
      if(collapsed.has(name))collapsed.delete(name);else collapsed.add(name);
      box.querySelectorAll('[data-trip-client-group]').forEach(b=>{
        if(b.dataset.tripClientGroup===name)b.setAttribute('aria-expanded',String(!collapsed.has(name)));
      });
      box.querySelectorAll('[data-client-trip-row]').forEach(tr=>{
        if(tr.dataset.tripClientName===name)tr.hidden=collapsed.has(name);
      });
    });
    const controller={
      isGrouped:()=>grouped,
      setRows(rows){
        flat=rows.slice();
        state.rows=grouped?RecordComponents.clientTripSort(flat,key):flat.slice();
        state.page=0;
        UI.drawTable(id);
      }
    };
    if(options.showSwitch!==false)this.bindTripGroupControls(row,value=>{
      grouped=value;
      collapsed.clear();
      state.rows=grouped?this.clientTripSort(flat,key):flat.slice();
      state.page=0;
      UI.drawTable(id);
    });
    controller.setRows(flat);
    return controller;
  },

  kpis(items) {
    return '<div class="record-workspace-kpis">' + UI.statusStrip(items) + '</div>';
  },

  tabs(items, active, attribute = 'data-record-tab') {
    return '<nav class="record-workspace-tabs" aria-label="Record views">'
      + items.map(item => {
        const selected = String(item.value) === String(active);
        return '<button type="button" class="record-workspace-tab' + (selected ? ' active' : '')
          + '" ' + attribute + '="' + UI.esc(item.value) + '" aria-pressed="' + selected + '">'
          + UI.esc(UI.tabLabel(item.label)) + '</button>';
      }).join('')
      + '</nav>';
  },

  categories(items, active, attribute = 'data-record-category', options = {}) {
    // Keep large category groups compact. Preserve every original category
    // button and data attribute so existing selection/permission handlers work.
    const renderButton = item => {
      const selected = String(item.value) === String(active);
      return '<button type="button" class="btn btn-sm '
        + (selected ? 'btn-primary' : 'btn-outline-secondary')
        + '" ' + attribute + '="' + UI.esc(item.value) + '" aria-pressed="' + selected + '">'
        + UI.esc(UI.tabLabel(item.label)) + '</button>';
    };
    const primary=items.length>3 && !options.showAll ? items.slice(0,3) : items;
    const extra=items.length>3 && !options.showAll ? items.slice(3) : [];
    const activeExtra=extra.find(item=>String(item.value)===String(active));
    return '<div class="record-workspace-categories" role="group" aria-label="Record categories">'
      +primary.map(renderButton).join('')
      +(extra.length
        ? '<details class="record-category-more"><summary class="btn btn-sm '
          +(activeExtra?'btn-primary':'btn-outline-secondary')
          +'" aria-label="More record categories"><i class="bi bi-three-dots" aria-hidden="true"></i> '
          +(activeExtra?UI.esc(UI.tabLabel(activeExtra.label)):'More')
          +'<i class="bi bi-chevron-down" aria-hidden="true"></i></summary>'
          +'<div class="record-category-more-options">'+extra.map(renderButton).join('')+'</div></details>'
        :'')
      +'</div>';
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

  // Move the existing view tabs inside the records card without cloning buttons or handlers.
  // Call after mountPanel, before attaching view handlers.
  mountViewTabs(root) {
    const panel = root.querySelector('.record-workspace-panel');
    const tabs = root.querySelector('.record-workspace-tabs');
    if (!panel || !tabs) return false;
    let row = panel.querySelector('.record-workspace-category-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'record-workspace-category-row';
      const table = panel.querySelector('.table-wrap, .oh-dispatch-table-wrap, .table-responsive, .data-table');
      if (table) table.before(row);
      else panel.append(row);
    }
    row.classList.add('record-workspace-view-tabs');
    row.append(tabs);
    return true;
  },

  // Reuse the Client Management layout for existing Finance/Billing tab
  // callbacks. Move the actual table nodes so action handlers are preserved.
  executiveTabs(root, tabs, active, title, options = {}) {
    if (!tabs.length) return;
    let selected=active && tabs.some(tab=>tab[0]===active)?active:tabs[0][0];
    const show=key=>{
      selected=key;
      const tab=tabs.find(item=>item[0]===key)||tabs[0];
      root.innerHTML='';
      const rendered=tab[2](root);
      if(typeof rendered==='string')root.innerHTML=rendered;
      const oldPanel=[...root.querySelectorAll('.panel')].find(el=>el.querySelector('.table-tools'));
      if(!oldPanel){
        // Chart/report-only tabs preserve their existing charts and actions.
        UI.activate(root);
        return;
      }
      const extras=[...root.childNodes].filter(node=>node!==oldPanel);
      const contents=oldPanel.querySelector(':scope > .panel-body');
      const panel=document.createElement('section');
      panel.className='panel';
      const body=document.createElement('div');
      body.className='panel-body flush';
      if(contents)while(contents.firstChild)body.append(contents.firstChild);
      panel.append(body);
      const actions=[...panel.querySelectorAll('.table-tools-right > button, .table-tools-right > .btn')];
      const categories=this.categories(tabs.map(([value,label])=>({value,label})),selected,'data-executive-tab',{showAll:options.showAllTabs===true});
      const shell=document.createElement('div');
      shell.innerHTML=this.panel('',categories);
      const workspace=shell.querySelector('.record-workspace-panel');
      extras.forEach(node=>workspace.append(node));
      workspace.prepend(panel);
      root.replaceChildren(workspace);
      this.mountPanel(root,{title});
      const heading=root.querySelector('.record-workspace-heading');
      actions.forEach(button=>heading?.append(button));
      root.querySelectorAll('[data-executive-tab]').forEach(button=>
        button.addEventListener('click',()=>show(button.dataset.executiveTab)));
      UI.activate(root);
      const tableBody=root.querySelector('[data-tbody]');
      if(!tableBody)return;
      const id=tableBody.dataset.tbody,t=UI._tables[id];
      if(!t)return;
      const original=t.rows.slice();
      const keys=['status','payment_status','category','source_type'];
      const status=keys.find(key=>t.allColumns.some(col=>col[1]===key));
      const values=status?[...new Set(original.map(row=>String(row[status]??'')).filter(Boolean))].sort():[];
      const serial='executive-'+id,filterId=serial+'-filter',sortId=serial+'-sort';
      const searchRow=root.querySelector('.record-workspace-search');
      const clients=options.clientFilter
        ? [...new Set(original.map(row=>String(row.client??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
        : [];
      let chosen='',chosenClient='',direction='default';
      const filterButton=document.createElement('button');
      filterButton.type='button';filterButton.className='btn btn-sm btn-outline-secondary record-workspace-filter-trigger';
      filterButton.setAttribute('aria-controls',filterId);
      filterButton.setAttribute('aria-expanded','false');
      filterButton.innerHTML='<i class="bi bi-funnel" aria-hidden="true"></i> Filter';
      const sortButton=document.createElement('button');
      sortButton.type='button';sortButton.className='btn btn-sm btn-outline-secondary record-workspace-sort-trigger';
      sortButton.setAttribute('aria-controls',sortId);sortButton.setAttribute('aria-expanded','false');
      sortButton.innerHTML='<i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort';
      const popovers=document.createElement('div');
      popovers.className='record-workspace-popovers';
      popovers.innerHTML='<div id="'+filterId+'" class="record-workspace-popover" hidden>'
        +'<strong>Filter records</strong>'
        +(options.clientFilter?'<label>Client<select class="form-select form-select-sm" data-executive-client>'
          +'<option value="">All clients</option>'
          +clients.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('')+'</select></label>':'')
        +(status?'<label>'+UI.esc(status.replace(/_/g,' '))
          +'<select class="form-select form-select-sm" data-executive-filter>'
          +'<option value="">All statuses</option>'
          +values.map(v=>'<option value="'+UI.esc(v)+'">'+UI.esc(v)+'</option>').join('')+'</select></label>'
          :!options.clientFilter?'<p class="small text-muted">No additional status filters for this table.</p>':'')
        +'<div class="record-workspace-popover-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button><button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
        +'<div id="'+sortId+'" class="record-workspace-popover record-workspace-sort-panel" hidden>'
        +'<strong>Sort records</strong>'
        +'<label class="record-workspace-sort-option"><input type="radio" data-record-sort name="'+sortId+'" value="default" checked> Default</label>'
        +'<label class="record-workspace-sort-option"><input type="radio" data-record-sort name="'+sortId+'" value="asc"> First column A–Z</label>'
        +'<label class="record-workspace-sort-option"><input type="radio" data-record-sort name="'+sortId+'" value="desc"> First column Z–A</label></div>';
      if(status||options.clientFilter)searchRow.append(filterButton);
      searchRow.append(sortButton,popovers);
      const apply=()=>{
        const next=original.filter(row=>(!chosen||String(row[status]??'')===chosen)
          &&(!chosenClient||String(row.client??'').trim()===chosenClient));
        if(direction!=='default'){
          const col=t.allColumns[0]?.[1];
          next.sort((a,b)=>(direction==='asc'?1:-1)
            *String(a[col]??'').localeCompare(String(b[col]??''),undefined,{numeric:true}));
        }
        t.rows=next;t.page=0;UI.drawTable(id);
        this.keepExecutiveEmptyTable(root,id);
      };
      this.bindDropdowns(root,{
        apply:menu=>{
          chosen=menu.querySelector('[data-executive-filter]')?.value||'';
          chosenClient=menu.querySelector('[data-executive-client]')?.value||'';
          apply();filterButton.click();
        },
        reset:()=>{
          chosen='';chosenClient='';
          const select=root.querySelector('[data-executive-filter]');if(select)select.value='';
          const client=root.querySelector('[data-executive-client]');if(client)client.value='';
          apply();filterButton.click();
        },
        sort:value=>{direction=value;apply();}
      },{filter:filterId,sort:sortId});
      root.querySelector('[data-tsearch]')?.addEventListener('input',()=>{
        this.keepExecutiveEmptyTable(root,id);
      });
      this.keepExecutiveEmptyTable(root,id);
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
  // Apply the same Operations record hierarchy to Motorpool's existing
  // server-authorized tables. Move live DOM nodes: never clone search inputs,
  // tabs, row actions, or filter controls (which would lose their listeners).
  maintenanceWorkspace(root, options = {}) {
    const box = root.querySelector(options.box || '.mp-reference-table');
    if (!box || box.dataset.operationsWorkspace === '1') return;
    const list = box.querySelector('.ref-list, .panel');
    const toolbar = list?.querySelector('.ref-toolbar, .table-tools');
    const search = toolbar?.querySelector('.table-search');
    if (!list || !search) return;
    box.dataset.operationsWorkspace = '1';
    box.classList.add('record-workspace-panel', 'maintenance-operations-records');
    const heading = box.querySelector('.mp-records-heading');
    if (heading) {
      heading.classList.add('record-workspace-heading');
      const oldTitle = heading.querySelector('strong');
      if (oldTitle) {
        const h = document.createElement('h2');
        h.textContent = oldTitle.textContent;
        oldTitle.replaceWith(h);
      }
      heading.querySelector('small')?.classList.add('record-workspace-count');
    }
    const actions = [...(options.actions || [])].filter(Boolean);
    if (options.includeTools !== false && options.tools)
      actions.push(...options.tools.querySelectorAll(':scope > button'));
    if (heading) actions.forEach(button => heading.append(button));
    const row = document.createElement('div');
    row.className = 'record-workspace-search';
    row.append(search);
    const reset = toolbar.querySelector('.ref-reset, [data-treset]');
    if (reset) row.append(reset);
    const groups = toolbar.querySelector('[data-group-controls]');
    if (groups) row.append(groups);
    const liveCount = toolbar.querySelector('[data-tcount]');
    const subtitle = heading?.querySelector('.record-workspace-count');
    if (liveCount && subtitle) {
      subtitle.textContent = '';
      subtitle.append(liveCount);
    } else if (liveCount) row.append(liveCount);
    // Retain any original table-specific action buttons and their listeners.
    [...toolbar.children].filter(el => el.matches('button')).forEach(button => row.append(button));
    // Existing Motorpool date/truck filters remain URL-backed and authoritative.
    const oldFilter = root.querySelector('.ui-filter-toolbar, .ws-filters, .filter-summary');
    if (oldFilter && !box.contains(oldFilter)) {
      const host = oldFilter.closest('.ui-filter-toolbar') || oldFilter;
      row.append(host);
    }
    const id = list.querySelector('[data-tbody]')?.dataset.tbody;
    const state = id ? UI._tables[id] : null;
    if (state) {
      const baseline = state.rows.slice();
      const field = ['status', 'display_status', 'availability', 'movement_type']
        .find(name => baseline.some(item => item[name] != null));
      const statuses = field
        ? [...new Set(baseline.map(item => String(item[field] ?? '')).filter(Boolean))].sort()
        : [];
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'btn btn-sm btn-outline-secondary record-workspace-filter-trigger';
      filterBtn.textContent = 'Filter';
      filterBtn.setAttribute('aria-expanded', 'false');
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn btn-sm btn-outline-secondary record-workspace-sort-trigger';
      sortBtn.textContent = 'Sort';
      sortBtn.setAttribute('aria-expanded', 'false');
      const pop = document.createElement('div');
      pop.className = 'record-workspace-popovers';
      const filterId = 'maintenance-filter-' + id, sortId = 'maintenance-sort-' + id;
      pop.innerHTML = '<div id="' + filterId + '" class="record-workspace-popover" hidden>'
        + '<strong>Filter records</strong><label>Status<select class="form-select form-select-sm" data-maint-status>'
        + '<option value="">All statuses</option>'
        + statuses.map(s => '<option value="' + UI.esc(s) + '">' + UI.esc(s) + '</option>').join('')
        + '</select></label><div class="record-workspace-popover-actions">'
        + '<button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
        + '<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
        + '<div id="' + sortId + '" class="record-workspace-popover record-workspace-sort-panel" hidden>'
        + '<strong>Sort records</strong>'
        + '<label class="record-workspace-sort-option"><input type="radio" name="' + sortId + '" data-record-sort value="default" checked> Default</label>'
        + '<label class="record-workspace-sort-option"><input type="radio" name="' + sortId + '" data-record-sort value="asc"> Reference A–Z</label>'
        + '<label class="record-workspace-sort-option"><input type="radio" name="' + sortId + '" data-record-sort value="desc"> Reference Z–A</label></div>';
      let selected = '', direction = 'default';
      const apply = () => {
        const rows = baseline.filter(item => !selected || String(item[field] ?? '') === selected);
        if (direction !== 'default') {
          const key = state.allColumns[0]?.[1];
          if (key) rows.sort((a, b) => (direction === 'asc' ? 1 : -1)
            * String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, {numeric:true}));
        }
        state.rows = rows;
        state.page = 0;
        UI.drawTable(id);
      };
      if (statuses.length) row.append(filterBtn);
      row.append(sortBtn, pop);
      toolbar.replaceWith(row);
      this.bindDropdowns(box, {
        apply: panel => {
          selected = panel.querySelector('[data-maint-status]')?.value || '';
          apply();
          filterBtn.click();
        },
        reset: () => {
          selected = '';
          const select = box.querySelector('[data-maint-status]');
          if (select) select.value = '';
          apply();
          filterBtn.click();
        },
        sort: value => { direction = value; apply(); }
      }, {filter:filterId, sort:sortId});
    }
    if (!state) toolbar.replaceWith(row);
    const tabCandidates = root.querySelectorAll('.line-tabs.ws-status-tabs, .record-workspace-tabs');
    const tabs = options.tabs || tabCandidates[tabCandidates.length - 1];
    if (tabs && !box.contains(tabs)) {
      const category = document.createElement('div');
      category.className = 'record-workspace-category-row record-workspace-view-tabs';
      tabs.parentNode.insertBefore(category, tabs);
      category.append(tabs);
      row.insertAdjacentElement('afterend', category);
    }
  },
});
