/* Regression guard: Resume Trip belongs to the assigned Dispatcher for ANY
   future Minor incident cleared by Motorpool, never to Ops Head or Motorpool.
   Source-contract test (not a browser or DB end-to-end test). */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const dispatcher=fs.readFileSync('public/assets/js/modules/operations/dispatcher.js','utf8');
const tripsUI=fs.readFileSync('public/assets/js/modules/operations/trips.js','utf8');
const opsHead=fs.readFileSync('public/assets/js/modules/operations/ops-head.js','utf8');
const backend=fs.readFileSync('backend/Modules/Operations/Trips.php','utf8');
const clearance=fs.readFileSync('backend/Modules/Maintenance/Maintenance.php','utf8');
const checks=[
 ['Dispatcher table routes direct Resume Trip to the existing Trips.resume action',
    dispatcher.includes("return ['Resume Trip','resume']") &&
    dispatcher.includes("b.dataset.dsAction==='resume'") &&
    dispatcher.includes("'Trips.resume',{trip_id:id}")],
 ['Resume action remains in Next Step when Motorpool cleared the hold',
    dispatcher.includes("next.append(currentAction)") &&
    dispatcher.includes("currentAction.dataset.tact==='resume'") &&
    dispatcher.includes("if(button===currentAction && currentAction.dataset.tact==='resume')return")],
 ['Completion action stays in Operations > Completion & Arrival and has a separate quick shortcut',
    dispatcher.includes("completionSection.append(completeButton)") &&
    dispatcher.includes("next.append(quickComplete)") &&
    dispatcher.includes("quickComplete.onclick=()=>completionAction?completionAction.click():TripUI.complete(t)") &&
    dispatcher.includes("if(['complete','arrival'].includes(button.dataset.tact) && panels.operations.contains(button))return") &&
    tripsUI.includes("acts.push(btn('complete', 'Complete trip'")],
 ['Completion fallback opens original required-documents form for the responsible Dispatcher',
    dispatcher.includes("if(!completionAction)completeButton.onclick=()=>TripUI.complete(t)") &&
    dispatcher.includes("const canComplete=isResponsibleDispatcher&&['Dispatched','In Transit'].includes(t.status)") &&
    dispatcher.includes("Only the responsible Dispatcher can complete this trip.")],
 ['Original completion and arrival action handlers survive compact drawer reconstruction',
    dispatcher.includes("if(preservedActions)preservedActions.remove()") &&
    dispatcher.includes("pendingActions.append(preservedActions)") &&
    dispatcher.includes("body.append(pendingActions)")],
 ['Dispatcher sees Start Arrival Checklist both in Next Step and Completion & Arrival',
    dispatcher.includes("quickArrival.textContent='Start Arrival Checklist'") &&
    dispatcher.includes("next.append(quickArrival)") &&
    dispatcher.includes("completionSection.prepend(arrival)") &&
    dispatcher.includes("arrival.onclick=()=>TripUI.checklist(t,'Arrival',inspection||null)")],
 ['Completed delivery still requires arrival inspection before vehicle release',
    backend.includes("FleetState::awaitingArrival($p, $id)") &&
    backend.includes("FleetState::release($p, $id)")],
 ['Dispatcher checks ownership before offering direct Resume Trip',
    dispatcher.includes("Number(t.responsible_dispatcher_id)===Number(App.me?.user?.id)")],
 ['Generic trip details offer Resume only on a Motorpool-cleared hold',
    tripsUI.includes("t.status === 'On Hold - Incident Reported'") &&
    tripsUI.includes("t.incident_status === 'Repaired - Cleared to Continue'") &&
    tripsUI.includes("acts.push(btn('resume'")],
 ['Ops Head explicitly refers to responsible Dispatcher without taking over action',
    opsHead.includes("The responsible Dispatcher must select Resume Trip")],
 ['Server independently checks responsible Dispatcher, active hold, recorded clearance and correct truck/attempt',
    backend.includes("private static function resume(") &&
    backend.includes("self::mustBeTripDispatcher($u, $t);") &&
    backend.includes("self::mustBeStatus($t, ['On Hold - Incident Reported'], 'resume the trip');") &&
    backend.includes("$inc['clearance'] === 'Fit to Continue'") &&
    backend.includes("$inc['attempt_number']") &&
    backend.includes("$inc['vehicle_id']")],
 ['Motorpool clearance notifies the trip Dispatcher without automatically resuming',
    clearance.includes("Notify::tripRoles($p, $t, [$t['dispatcher_role']], 'Cleared to continue'") &&
    clearance.includes("status='Repaired - Cleared to Continue'")],
 ['Server continuation remains original trip In Transit, not a second attempt',
    backend.includes("self::setStatus($p, $u['id'], $t, 'In Transit', 'trip resumed after minor repair'") &&
    backend.includes("Continuation of the original trip (not a second attempt).")]
];
for(const [name,passed] of checks){assert.ok(passed,name);process.stdout.write('PASS: '+name+'\n');}
process.stdout.write('PASS: Cleared-incident resume UI/server contract\n');
