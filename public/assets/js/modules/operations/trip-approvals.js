/* Historical approval classification; legacy bookmarks now open read-only history. */
'use strict';
OpsHead.approvalLabel = category => ({pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected'}[category] || 'Decision not recorded');
OpsHead.approvalCategory = (t, events = []) => {
  if (t.intake_source !== 'Dispatcher') return null;
  if ((t.approved_by != null && t.approved_at) || events.some(e => e.event_type === 'trip details confirmed by Operations Head')) return 'approved';
  if (events.some(e => e.event_type === 'trip request rejected' && e.to_status === 'Rejected')) return 'rejected';
  return t.status === 'Pending Review' ? 'pending' : null;
};

// Compatibility entry points retain read access without restoring the retired decisions.
OpsHead.approvals = function() { if(this.is())App.go('trips',{tab:'history',legacy:'1'}); };
OpsHead.openApproval = async function(id) { if(this.is())return TripUI.open(id); };
