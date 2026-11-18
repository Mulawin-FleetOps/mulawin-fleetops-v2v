/* SEMANTIC_KPI_PALETTE_V4
   Role-independent, semantic solid icon colors on every rendered KPI.
   #pageContent is recreated on route changes, so observe the stable #app root.
   Inline important icon colors intentionally win over legacy !important selectors.
   Presentation only; never changes records, workflows, or buttons. */
(() => {
  'use strict';
  const colors = Object.freeze({
    green:'#158354', blue:'#1769B5', amber:'#DC8B06',
    red:'#CB4042', purple:'#7545AC', gray:'#64748B'
  });
  const cards = [
    '.kpi-tile','.metric-icon-card','.head-kpi','.rpm-kpi',
    '.ds-summary-card','.oh-metric','.ax-kpi','.mp-action-stage',
    '.pr-sum-card','.ws-kpi-card','.stat-card'
  ].join(',');
  const iconSelectors = [
    '.kpi-icon','.metric-icon','.head-kpi-icon','.rpm-kpi-icon',
    '.ds-card-icon','.oh-metric-icon','.ax-kpi-icon',
    '.mp-action-stage-icon','.pr-sum-icon','.ws-kpi-icon','.stat-icon'
  ].join(',');
  const labelSelectors = [
    '.kpi-label','.metric-label','.head-fleet-kpi-value > span',
    '.head-kpi-label','.head-kpi > div > span','.rpm-kpi-label','.ds-card-copy > span',
    '.oh-metric-label','.ax-kpi-label','.ax-kpi > span','.mp-action-stage-content > b',
    '.pr-sum-label','.ws-kpi-label','.stat-label'
  ].join(',');
  // First match takes precedence. A zero count does not change status meaning.
  const rules = [
    [/overdue|incident|cancel|delay|problem|critical|failed|rejected|unavailable|out of stock|shortage|past due|blocked|exception/, 'red'],
    [/draft|inactive|archived|not timed in|not on duty/, 'gray'],
    [/for verification|verification|verify|to verify/, 'purple'],
    [/under maintenance|under repair|repair in progress|scheduled|preparing|reschedul|low stock|follow.up|pending|approval|awaiting|waiting|needs attention|for review/, 'amber'],
    [/inspection|inspect|record findings|on trip|in transit|ongoing|in progress|dispatch|route|to bill|new parts|new requests|to receive/, 'blue'],
    [/finance|revenue|receivable|outstanding|billing|invoice|collection|payment|budget|expense|cost|amount|money|fund/, 'purple'],
    [/completed|complete|available|collected|paid|delivered|received|released|resolved|on duty|timed in|success/, 'green'],
    [/reported|new issue|new problem/, 'gray'],
    [/driver|helper|mechanic|personnel|employee|staff|user/, 'blue'],
    [/stock|inventory|parts|purchase|order|warehouse|request/, 'blue']
  ];
  const semantic = label => {
    const text = String(label || '').toLowerCase();
    return rules.find(([pattern]) => pattern.test(text))?.[1] || '';
  };
  const classColor = card => {
    const match = [...card.classList].find(v =>
      /^(?:kpi-semantic-|kpi-color-|rpm-kpi-color-)(green|blue|amber|red|purple|gray)$/.test(v));
    return match ? match.match(/(green|blue|amber|red|purple|gray)$/)?.[1] : '';
  };
  const apply = () => {
    const host = document.getElementById('pageContent');
    if (!host) return;
    host.querySelectorAll(cards).forEach(card => {
      const icon = card.querySelector(iconSelectors);
      if (!icon) return;
      const label = card.querySelector(labelSelectors)?.textContent?.trim() || '';
      const requested = card.getAttribute('data-kpi-color');
      // Read the actual KPI status before legacy visual tone classes. Explicit
      // data-kpi-color remains the sole per-card override when supplied.
      const tone = (requested && colors[requested]) ? requested
        : semantic(label) || classColor(card) || 'blue';
      const hex = colors[tone];
      // Only KPI icon chip surfaces change, never KPI card borders or actions.
      if (icon.style.getPropertyValue('background-color') !== hex ||
          icon.style.getPropertyPriority('background-color') !== 'important') {
        icon.style.setProperty('background-color',hex,'important');
      }
      if (icon.style.getPropertyValue('color') !== '#fff' ||
          icon.style.getPropertyPriority('color') !== 'important') {
        icon.style.setProperty('color','#fff','important');
      }
      if (icon.style.getPropertyValue('border-radius') !== '11px' ||
          icon.style.getPropertyPriority('border-radius') !== 'important') {
        icon.style.setProperty('border-radius','11px','important');
      }
      icon.querySelectorAll('i,.bi,svg').forEach(glyph => {
        if (glyph.style.getPropertyValue('color') !== '#fff') {
          glyph.style.setProperty('color','#fff','important');
        }
      });
    });
  };
  const mount = () => {
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; apply(); });
    };
    // #app remains mounted even when the individual #pageContent is replaced.
    const host = document.getElementById('app') || document.body;
    new MutationObserver(refresh).observe(host,{childList:true,subtree:true});
    apply();
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
