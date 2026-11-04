/* assets/js/modules/general/notifications.js — NOTIFICATION HISTORY
   Every notification of the signed-in user: Unread, Read, Resolved, Archived.
   Notifications of tasks that are done are resolved automatically; the user can also
   resolve or archive them by hand. Nothing is deleted.
   Backend: backend/Modules/Administration/Admin.php (notificationsPage, notificationsRead) */
'use strict';
App.page('notifications', {
  title: 'Notifications',
  subtitle: 'Tasks and updates sent to you. Resolved notifications stay here as history.',
  render(ctx) {
    const d = ctx.data, c = d.counts || {};
    UI.tool(ctx, 'Mark all as read', async () => { const r = await App.api('Admin.notifications_read', {}); UI.result(r); App.applyBell(r); App.route(); }, 'bi-check2-all', 'outline-secondary');
    ctx.el.innerHTML = UI.statusStrip(d.states.map(s => ({ label: s, value: +c[s] || 0, color: s === 'Unread' && +c[s] ? 'amber' : '' })))
      + UI.filterModal(ctx, [{ name: 'state', label: 'State', type: 'select', options: UI.list(d.states), col: 12 }], { hint: 'Showing unread, read and resolved notifications.' })
      + UI.table([
        ['', 'state', (v) => `<span class="notif-dot ${v === 'Unread' ? 'on' : ''}"></span>`],
        ['Notification', 'message', (v, n) => `<b>${UI.esc(n.category)}</b><div>${UI.esc(v)}</div>`],
        ['Received', 'created_at', 'datetime'], ['State', 'state', 'badge'],
        ['Resolved', 'resolved_at', (v, n) => v ? UI.datetime(v) + `<div class="cell-sub">${+n.auto_resolved ? 'task done' : 'by you'}</div>` : '—']], d.items,
        { empty: 'No notifications.',
          actions: (n) => (n.page ? UI.btn('go', 'Open', 'outline-primary') : '') + (['Unread', 'Read'].includes(n.state) ? UI.btn('resolve', 'Resolve', 'outline-success') : '') + (n.state !== 'Archived' ? UI.btn('archive', 'Archive', 'outline-secondary') : ''),
          onAction: async (a, n) => {
            if (a === 'go') { await App.notificationState(n.id, 'Read'); return App.go(n.page); }
            const r = await App.notificationState(n.id, a === 'resolve' ? 'Resolved' : 'Archived'); if (r) { UI.result(r); App.route(); }
          } });
  },
});
