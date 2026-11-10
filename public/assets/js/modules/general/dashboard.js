/* Mulawin FleetOps V2 — RPM role dashboards.
 * Presentation-only: uses the existing role-filtered Analytics.dashboard payload.
 * No synthetic numbers, new API methods, or permission changes.
 */
'use strict';

const RPMDashboard = {
  roles: {
    admin: { title: 'Head Management Dashboard', detail: 'Fleet, operations, finance and approvals', icon: 'bi-buildings', links: ['reports', 'trips', 'trucks', 'maintenance', 'billing', 'admin'] },
    operations_head: { title: 'Operations Head Dashboard', detail: 'Trip oversight, fleet availability and dispatch readiness', icon: 'bi-diagram-3', links: ['trips', 'trucks', 'crew', 'clients', 'routes', 'reports'] },
    car_carrier_dispatcher: { title: 'Car Carrier Dispatcher Dashboard', detail: 'Car Carrier trips, dispatch preparation and follow-ups', icon: 'bi-truck', links: ['trips', 'funds', 'trucks', 'crew'] },
    container_wingvan_dispatcher: { title: 'Container / Wing Van Dispatcher Dashboard', detail: 'Container and Wing Van trips, dispatch and checklists', icon: 'bi-truck-flatbed', links: ['trips', 'funds', 'trucks', 'crew'] },
    motorpool: { title: 'Motorpool Custodian Dashboard', detail: 'Truck condition, active repairs and mechanics', icon: 'bi-tools', links: ['maint_overview', 'maintenance', 'trucks', 'mechanics', 'maint_history'] },
    purchasing: { title: 'Purchasing Officer Dashboard', detail: 'Parts requests, stock and purchase orders', icon: 'bi-box-seam', links: ['purchasing_overview', 'parts_requests', 'purchase_orders', 'inventory'] },
    finance: { title: 'Finance Dashboard', detail: 'Fund releases, payables, budget and expenses', icon: 'bi-cash-stack', links: ['funds', 'finance', 'purchase_orders', 'reports'] },
    billing: { title: 'Billing & Collection Dashboard', detail: 'Billing preparation, receivables and collections', icon: 'bi-receipt', links: ['billing', 'trips', 'clients', 'routes', 'reports'] },
    audit: { title: 'Audit Dashboard', detail: 'Read-only records, trends and activity review', icon: 'bi-clipboard-data', links: ['reports', 'admin', 'trips', 'maintenance', 'billing', 'finance'] },
  },
  navLabels: {
    trips: 'View trips', trucks: 'Fleet records', crew: 'Personnel', clients: 'Client records',
    routes: 'Client routes', maintenance: 'Maintenance records', mechanics: 'Mechanics',
    maint_overview: 'Maintenance overview', maint_history: 'Maintenance history', purchasing_overview: 'Purchasing overview', parts_requests: 'Parts requests',
    purchase_orders: 'Purchase orders', inventory: 'Inventory', funds: 'Trip funds', billing: 'Billing & collection',
    finance: 'Finance records', reports: 'Reports', admin: 'Activity / administration',
  },
  navIcons: {
    trips: 'bi-signpost-split', trucks: 'bi-truck', crew: 'bi-people', clients: 'bi-buildings',
    routes: 'bi-geo-alt', maintenance: 'bi-wrench-adjustable', mechanics: 'bi-person-gear',
    maint_overview: 'bi-speedometer2', maint_history: 'bi-clock-history', purchasing_overview: 'bi-speedometer2', parts_requests: 'bi-box-arrow-up',
    purchase_orders: 'bi-cart-check', inventory: 'bi-box-seam', funds: 'bi-wallet2', billing: 'bi-receipt', finance: 'bi-cash-stack',
    reports: 'bi-bar-chart-line', admin: 'bi-person-gear',
  },
  icon(name, fallback = 'bi-graph-up') {
    return /^bi-[a-z0-9-]+$/.test(String(name || '')) ? name : fallback;
  },
  number(card) {
    return card.format === 'money' ? UI.money(card.value)
      : UI.esc(typeof card.value === 'number' ? UI.num(card.value, 2) : card.value);
  },
  tile(c) {
    const go = c.page && UI.canGo(c.page);
    return `<div class="rpm-kpi rpm-kpi-${['green', 'amber', 'red'].includes(c.color) ? c.color : 'normal'}${go ? ' rpm-kpi-link' : ''}"
      ${go ? `data-go="${UI.esc(c.page)}" role="link" tabindex="0"` : ''}>
      <span class="rpm-kpi-icon"><i class="bi ${this.icon(c.icon)}" aria-hidden="true"></i></span>
      <div class="rpm-kpi-body"><div class="rpm-kpi-label">${UI.esc(c.label)}</div>
      <div class="rpm-kpi-value">${this.number(c)}</div></div>
      ${go ? '<i class="bi bi-arrow-up-right rpm-kpi-corner" aria-hidden="true"></i>' : ''}
    </div>`;
  },
  cards(cards) {
    // Keep important facts visible; secondary metrics are one click away.
    const primary = (cards || []).slice(0, 6);
    const rest = (cards || []).slice(6);
    if (!primary.length) return '';
    return `<section class="rpm-compact-metrics" aria-label="Key metrics">
      <div class="rpm-kpi-grid">${primary.map(c => this.tile(c)).join('')}</div>
      ${rest.length ? `<details class="rpm-more-metrics"><summary>Show ${rest.length} more metrics</summary>
        <div class="rpm-kpi-grid">${rest.map(c => this.tile(c)).join('')}</div></details>` : ''}
    </section>`;
  },
  // A breakdown is shown only when there are genuinely comparable counts.
  breakdown(cards, role) {
    const lookup = new Map((cards || []).map(c => [c.label, c]));
    const get = k => lookup.has(k) ? Number(lookup.get(k).value) : NaN;
    let title, items;
    if (['admin', 'operations_head', 'car_carrier_dispatcher', 'container_wingvan_dispatcher', 'audit'].includes(role)) {
      const total = get('Total trucks'), available = get('Available trucks'), assigned = get('Assigned or on trip'), unavailable = get('Unavailable trucks');
      if (![total, available, assigned, unavailable].every(Number.isFinite) || total < 0 || Math.abs(total - available - assigned - unavailable) > 0.001) return '';
      title = 'Fleet availability';
      items = [['Available', available, '#208b46'], ['Assigned / on trip', assigned, '#68b67e'], ['Unavailable', unavailable, '#e2a443']];
    } else if (role === 'motorpool') {
      const total = get('Total trucks'), available = get('Available trucks');
      if (![total, available].every(Number.isFinite) || total < available || available < 0) return '';
      title = 'Fleet availability'; items = [['Available', available, '#208b46'], ['Other truck statuses', total - available, '#dba443']];
    } else if (role === 'purchasing') {
      const total = get('Parts in inventory'), low = get('Low-stock items');
      if (![total, low].every(Number.isFinite) || total < low || low < 0) return '';
      title = 'Inventory stock check'; items = [['Low-stock items', low, '#dfa53a'], ['Other active items', total - low, '#208b46']];
    } else return '';
    const sum = items.reduce((n, item) => n + item[1], 0);
    let progress = 0;
    const stops = items.map(([, n, color]) => {
      const start = progress; progress += sum ? n * 100 / sum : 0;
      return `${color} ${start.toFixed(3)}% ${progress.toFixed(3)}%`;
    }).join(', ');
    return `<section class="rpm-summary-panel"><h2 class="rpm-panel-title">${UI.esc(title)}</h2>
      <div class="rpm-breakdown"><div class="rpm-donut" role="img" aria-label="${UI.esc(items.map(([l, n]) => `${l}: ${n}`).join(', '))}"
        style="background:conic-gradient(${sum ? stops : '#e6eee8 0% 100%'})"><div class="rpm-donut-center"><b>${UI.esc(sum)}</b><small>${role === 'purchasing' ? 'Active parts' : 'Trucks'}</small></div></div>
      <div class="rpm-breakdown-legend">${items.map(([label, value, color]) => `<div><span class="rpm-swatch" style="background:${color}"></span><span>${UI.esc(label)}</span><strong>${UI.esc(value)}</strong></div>`).join('')}</div></div>
    </section>`;
  },
  alerts(alerts) {
    const list = (alerts || []).slice(0, 4);
    return `<section class="rpm-summary-panel rpm-alert-panel"><h2 class="rpm-panel-title">Needs attention <span class="rpm-alert-count">${(alerts || []).length}</span></h2>
      ${list.length ? `<ul class="rpm-alert-list">${list.map(a => {
        const go = a.page && UI.canGo(a.page);
        const level = ['danger', 'warning', 'success'].includes(a.level) ? a.level : 'info';
        return `<li class="rpm-alert-${level}"><span class="rpm-alert-mark"><i class="bi ${level === 'danger' ? 'bi-exclamation-circle' : level === 'success' ? 'bi-check-circle' : 'bi-info-circle'}" aria-hidden="true"></i></span>
          <span>${UI.esc(a.text)}</span>${go ? `<button type="button" data-go="${UI.esc(a.page)}" class="rpm-alert-link" aria-label="Open related module"><i class="bi bi-chevron-right"></i></button>` : ''}</li>`;
      }).join('')}</ul>${(alerts || []).length > 4 ? `<p class="rpm-alert-more">${(alerts || []).length - 4} more notices. See Notifications for details.</p>` : ''}`
        : '<p class="rpm-all-clear"><i class="bi bi-check-circle"></i> No pending dashboard alerts right now.</p>'}
    </section>`;
  },
  links(role) {
    const cfg = this.roles[role];
    return (cfg.links || []).filter(page => UI.canGo(page)).map(page =>
      `<button type="button" data-go="${page}" class="rpm-quick-link"><i class="bi ${this.navIcons[page] || 'bi-grid'}" aria-hidden="true"></i><span>${UI.esc(this.navLabels[page] || page)}</span><i class="bi bi-arrow-up-right rpm-quick-arrow" aria-hidden="true"></i></button>`
    ).join('');
  },
};

App.page('dashboard', {
  title: 'Dashboard',
  subtitle: 'Your current records and pending work.',
  render(ctx) {
    const d = ctx.data || {};
    const role = App.me?.user?.role || 'audit';
    const cfg = RPMDashboard.roles[role] || RPMDashboard.roles.audit;
    // The app shell already provides a page header: use it rather than duplicate it.
    const pageTitle = document.querySelector('.page-title');
    const pageSubtitle = document.querySelector('.page-subtitle');
    if (pageTitle) pageTitle.textContent = cfg.title;
    if (pageSubtitle) pageSubtitle.textContent = cfg.detail;
    const time = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short', hour12: true,
    }).format(new Date());
    const stamp = document.createElement('span');
    stamp.className = 'small text-muted align-self-center';
    stamp.textContent = 'Updated ' + time + ' PHT';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-outline-success';
    btn.innerHTML = '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh';
    btn.onclick = () => ctx.reload();
    ctx.tools.append(stamp, btn);

    const cards = d.cards || [], alerts = d.alerts || [], charts = d.charts || [], tables = d.tables || [];
    const breakdown = RPMDashboard.breakdown(cards, role);
    const summary = RPMDashboard.alerts(alerts);
    // One primary table, capped to five rows, avoids a wall of records on arrival.
    const primaryTable = tables.length ? UI.blockTable({ ...tables[0], limit: 5 }) : '';
    const otherTables = tables.slice(1);
    const moreTables = otherTables.length ? `<details class="rpm-more-records">
      <summary>Show ${otherTables.length} more record ${otherTables.length === 1 ? 'section' : 'sections'}</summary>
      <div class="rpm-dashboard-tables">${otherTables.map(t => UI.blockTable({ ...t, limit: 5 })).join('')}</div>
    </details>` : '';
    const moreCharts = charts.length ? `<details class="rpm-more-records">
      <summary>Show ${charts.length} chart${charts.length === 1 ? '' : 's'}</summary>
      <div class="chart-grid">${charts.slice(0, 2).map(UI.chartHtml).join('')}</div>
    </details>` : '';
    ctx.el.classList.add('rpm-dashboard', 'rpm-dashboard-compact');
    ctx.el.innerHTML = `<div class="rpm-dashboard-content">
      <div class="rpm-dashboard-kpis">${RPMDashboard.cards(cards)}</div>
      <div class="rpm-dashboard-overview${breakdown ? '' : ' rpm-no-breakdown'}">
        ${summary}${breakdown}
      </div>
      ${primaryTable ? `<section class="rpm-dashboard-records"><h2 class="rpm-area-title">Recent records</h2>
        <div class="rpm-dashboard-tables">${primaryTable}</div>${moreTables}</section>` : ''}
      ${moreCharts}
      <section class="rpm-dashboard-shortcuts"><h2 class="rpm-area-title">Quick access</h2>
        <div class="rpm-quick-grid">${RPMDashboard.links(role)}</div></section>
    </div>`;
    UI.activate(ctx.el);
  },
});
