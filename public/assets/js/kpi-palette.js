/* FINAL_SEMANTIC_KPI_PALETTE_V3
   Apply the same meaning-based palette to role-specific KPI markup after each
   page render. Shared-renderer KPI colors already come from core.js.
   This is presentation only and observes child nodes, not style mutations. */
(() => {
  'use strict';
  const cards = [
    '.head-kpi', '.rpm-kpi', '.ds-summary-card', '.oh-metric',
    '.ax-kpi', '.mp-action-stage', '.pr-sum-card', '.ws-kpi-card',
    '.stat-card'
  ].join(',');
  const labels = [
    '.head-fleet-kpi-value > span', '.head-kpi-label', '.rpm-kpi-label',
    '.ds-card-copy > span', '.oh-metric-label', '.ax-kpi-label',
    '.mp-action-stage-content > b', '.pr-sum-label',
    '.ws-kpi-label', '.stat-label', '.metric-label', '.kpi-label'
  ].join(',');
  const rules = [
    [/overdue|incident|cancel|critical|failed|rejected|unavailable|out of stock|shortage|past due/, 'red'],
    [/draft|inactive|archived|not timed in|not on duty/, 'gray'],
    [/for verification|verification|verify/, 'purple'],
    [/under maintenance|under repair|under inspection|inspection|low stock|follow.up|pending|approval|awaiting|waiting|to do|reported|needs attention|for review/, 'amber'],
    [/on trip|ongoing|in progress|active trip|dispatch|route|delivery|to bill|requests|trips|new issue|to receive/, 'blue'],
    [/finance|revenue|receivable|outstanding|billing|invoice|collection|payment|budget|expense|cost|amount|money|fund/, 'purple'],
    [/complete|available|collected|paid|delivered|received|released|resolved|on duty|timed in|success/, 'green'],
    [/driver|helper|mechanic|personnel|employee|staff|user/, 'blue'],
    [/stock|inventory|parts|purchase|order|warehouse/, 'blue']
  ];
  const detect = label => {
    const lower = String(label || '').toLowerCase();
    return rules.find(([pattern]) => pattern.test(lower))?.[1] || '';
  };
  const apply = root => {
    const host = root?.id === 'pageContent' ? root : document.getElementById('pageContent');
    if (!host) return;
    host.querySelectorAll(cards).forEach(card => {
      const label = card.querySelector(labels)?.textContent?.trim();
      const tone = detect(label);
      if (!tone) return;
      for (const c of ['green','blue','amber','red','purple','gray'])
        card.classList.toggle('kpi-semantic-' + c, c === tone);
    });
  };
  const mount = () => {
    const host = document.getElementById('pageContent');
    if (!host) return;
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; apply(host); });
    };
    apply(host);
    new MutationObserver(refresh).observe(host, {childList:true,subtree:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
