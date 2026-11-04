/* assets/js/modules/general/dashboard.js — Dashboard (every role)
   Shows the current state of the fleet and the work waiting for this role.
   Backend: backend/Modules/General/Analytics.php (dashboard) */
'use strict';
App.page('dashboard', {
  title: 'Dashboard',
  subtitle: 'Current state of the fleet and the work waiting for you.',
  render(ctx) {
    const d = ctx.data;
    const stamp = document.createElement('span');
    stamp.className = 'small text-muted align-self-center';
    stamp.textContent = 'Updated ' + new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-secondary'; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh'; btn.onclick = () => ctx.reload();
    ctx.tools.append(stamp, btn);
    if (!d.alerts.length) d.alerts.push({ text: 'Nothing is waiting for you right now.', level: 'success' });
    ctx.el.innerHTML = UI.blocks(d, { maxCharts: 2, key: 'dash' });
    UI.activate(ctx.el);
  },
});
