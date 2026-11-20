/* MAINTENANCE_CLEANUP_41_43_V1: no priority/ETA controls; preserve safety repair plan. */
/* assets/js/modules/maintenance/maintenance.js — CORRECTIVE MAINTENANCE
   Unexpected truck problems: report -> assign mechanic (Under Inspection) -> findings and
   diagnosis (Under Repair) -> corrective action + evidence (Completed) -> verify and return the
   truck to service. Trip incidents arrive here automatically and are assessed Minor / Major.
   Backend: backend/Modules/Maintenance/Maintenance.php */
'use strict';
const MaintUI = {
  data: null,
  STAGES: ['Reported', 'Under Inspection', 'Under Repair', 'Completed', 'Returned to service'],
  /** Filters of the Open records list (Overview cards link here). Same rules as the backend overview counts. */
  VIEWS: {
    reported: ['New reports', (j) => j.status === 'Reported'],
    in_progress: ['Under inspection or repair', (j) => ['Under Inspection', 'Under Repair'].includes(j.status)],
    inspection: ['Under inspection', (j) => j.status === 'Under Inspection'],
    repair: ['Under repair', (j) => j.status === 'Under Repair'],
    verify: ['Awaiting verification', (j) => j.status === 'Completed' && !j.verified_at],
  },
  stageOf(j) {
    if (j.status === 'Cancelled') return [0, true];
    if (j.verified_at) return [5, false];
    return [Math.max(0, MaintUI.STAGES.indexOf(j.status)), false];
  },
  /** Plain-language next step shown on the record. */
  nextStep(j) {
    if (j.status === 'Cancelled') return 'Cancelled.';
    if (j.verified_at) return j.source === 'Incident' && j.severity === 'Minor' && j.incident_status !== 'Resolved' && j.incident_status !== 'Repaired - Cleared to Continue'
      ? 'Repair verified. The trip stays On Hold until Motorpool records the vehicle clearance.'
      : (j.repair_performed ? 'Repair verified. The truck is back in service.' : 'Inspection only: no repair was needed. The truck is back in service.');
    if (j.status === 'Reported') return j.source === 'Incident' ? 'Assess the incident (Minor or Major) based on the dispatcher report; mechanic assignment comes later.' : 'Assign an available mechanic to start the inspection.';
    if (j.status === 'Under Inspection') return j.mechanic_id ? 'Record the inspection findings and the diagnosis.' : 'Incident assessed. Assign a mechanic when inspection or repair can begin; for Minor incidents with no repair needed, use inspection-only clearance.';
    if (j.status === 'Under Repair') return 'Record the corrective action, the completion date and the evidence.';
    return 'Check the truck, then verify it to return it to service.';
  },
  ACTIVE: ['Reported', 'Under Inspection', 'Under Repair'],
  /** JOB_HELPER_MECHANICS_V1 — assisting mechanics of one repair: active ones (removable) and past ones (history). */
  helperList(helpers, canEdit) {
    const now = (helpers || []).filter(h => !h.released_at), past = (helpers || []).filter(h => h.released_at);
    return (now.length ? now.map(h => `<div class="d-flex align-items-center gap-2 flex-wrap"><span>${UI.esc(h.full_name)} · ${UI.esc(h.mechanic_code)}</span><span class="cell-sub">since ${UI.datetime(h.assigned_at)} · ${UI.esc(h.assigned_by_name)}</span>
        ${canEdit ? `<button type="button" class="btn btn-sm btn-outline-danger icon-act ms-auto" data-rmh="${+h.mechanic_id}" data-name="${UI.esc(h.full_name)}" title="Remove ${UI.esc(h.full_name)}" aria-label="Remove ${UI.esc(h.full_name)}"><i class="bi bi-person-dash"></i></button>` : ''}</div>`).join('') : '<span class="text-muted">None</span>')
      + (past.length ? `<details class="mt-1"><summary class="small text-muted">${past.length} earlier assisting assignment(s)</summary>${past.map(h => `<div class="cell-sub">${UI.esc(h.full_name)}: ${UI.datetime(h.assigned_at)} – ${UI.datetime(h.released_at)}${h.release_reason ? ' · ' + UI.esc(h.release_reason) : ''}${h.released_by_name ? ' · ' + UI.esc(h.released_by_name) : ''}</div>`).join('')}</details>` : '');
  },
  /** Searchable multi-select of Available mechanics (not the lead, not already assisting). One request, all-or-nothing. */
  addHelpers(j, helpers, after) {
    const taken = new Set([+j.mechanic_id, ...(helpers || []).filter(h => !h.released_at).map(h => +h.mechanic_id)]);
    const list = (MaintUI.data.mechanics || []).filter(m => m.availability === 'Available' && !taken.has(+m.id));
    const wrap = UI.modal('Add mechanics to ' + UI.esc(j.job_ref), `<p class="modal-intro">Lead mechanic: <b>${UI.esc(j.mechanic || '')}</b>. Choose the mechanics who will assist. Only timed-in, Available mechanics are listed; each can work on one repair at a time.</p>
      ${list.length ? `<input type="search" class="form-control form-control-sm mb-2" placeholder="Search name, code or specialization" aria-label="Search mechanics" data-msearch>
      <div class="mech-pick" role="group" aria-label="Available mechanics">${list.map(m => `<label class="mech-pick-row" data-text="${UI.esc((m.full_name + ' ' + m.mechanic_code + ' ' + (m.specialization || '')).toLowerCase())}">
        <input type="checkbox" class="form-check-input" value="${+m.id}"> <span><b>${UI.esc(m.full_name)}</b> · ${UI.esc(m.mechanic_code)}${m.specialization ? `<span class="cell-sub"> · ${UI.esc(m.specialization)}</span>` : ''}</span></label>`).join('')}</div>
      <div class="small text-muted mt-1" data-mcount>0 selected</div>` : '<div class="alert alert-warning mb-0">No other mechanic is Available. Time In a mechanic on the Mechanic Attendance page first.</div>'}`,
      list.length ? async (x, form) => {
        const ids = [...form.querySelectorAll('.mech-pick input:checked')].map(c => c.value);
        if (!ids.length) throw new Error('Choose at least one mechanic.');
        const res = await App.api('Maintenance.helpers_add', { job_id: j.id, mechanic_ids: ids }); UI.result(res); after();
      } : null, { size: '', submit: 'Add mechanics', confirmBeforeSubmit: false });
    const s = wrap.querySelector('[data-msearch]');
    if (s) {
      s.oninput = () => wrap.querySelectorAll('.mech-pick-row').forEach(r => { r.hidden = !r.dataset.text.includes(s.value.trim().toLowerCase()); });
      wrap.querySelector('.mech-pick').onchange = () => { wrap.querySelector('[data-mcount]').textContent = wrap.querySelectorAll('.mech-pick input:checked').length + ' selected'; };
    }
  },
  /** One-click lead selection, without the browser's long native dropdown. */
  assignMechanic(j, after) {
    const choices = (MaintUI.data?.mechanics || [])
      .filter(m => m.availability === 'Available' && +m.id !== +j.mechanic_id);
    const changing = Boolean(j.mechanic_id);
    const html = `<p class="modal-intro">Select one available mechanic below. Mechanics with active repair assignments are not eligible.</p>
      <label class="form-label" for="mp-assign-search">Search mechanics</label>
      <input id="mp-assign-search" class="form-control mb-2" type="search"
        placeholder="Search name, mechanic ID or specialization…" autocomplete="off" data-mechanic-search>
      <div class="mp-mechanic-checklist" role="radiogroup" aria-label="Available mechanics">
        ${choices.length ? choices.map(m => `<label class="mp-mechanic-checklist-item" data-mechanic-text="${UI.esc([m.full_name,m.mechanic_code,m.specialization].join(' ').toLowerCase())}">
            <input type="radio" name="mechanic_id" value="${+m.id}" required>
            <span class="mp-mechanic-checklist-copy">
              <strong>${UI.esc(m.full_name)}</strong>
              <small>${UI.esc(m.mechanic_code)}${m.specialization ? ' · ' + UI.esc(m.specialization) : ''}</small>
            </span>
          </label>`).join('') : '<p class="text-muted small mb-0">No available mechanics. Time In a mechanic first.</p>'}
        <p class="text-muted small mb-0" data-mechanic-empty hidden>No mechanics match your search.</p>
      </div>
      <p class="small text-muted mt-2" data-mechanic-selection>None selected</p>
      ${changing ? '<label class="form-label mt-2" for="mp-mechanic-reason">Reason for the change *</label><textarea id="mp-mechanic-reason" class="form-control" name="reason" rows="2" required></textarea>' : ''}`;
    const dialog = UI.modal((changing ? 'Change mechanic for ' : 'Assign mechanic to ') + UI.esc(j.job_ref),
      html, async (_values, form) => {
        const checked = form.querySelector('input[name="mechanic_id"]:checked');
        if (!checked) throw new Error('Choose one mechanic.');
        const payload = { job_id:j.id, mechanic_id:+checked.value };
        if (changing) {
          payload.reason = form.querySelector('[name="reason"]').value.trim();
          if (!payload.reason) throw new Error('Enter the reason for changing mechanics.');
        }
        const response = await App.api('Maintenance.assign_mechanic', payload);
        UI.result(response);
        if (after) after(response); else App.route();
      }, { size:'modal-lg', submit:changing ? 'Change mechanic' : 'Assign mechanic', confirmBeforeSubmit:false });
    const input = dialog.querySelector('[data-mechanic-search]');
    const count = dialog.querySelector('[data-mechanic-selection]');
    const rows = [...dialog.querySelectorAll('.mp-mechanic-checklist-item')];
    const empty = dialog.querySelector('[data-mechanic-empty]');
    const update = () => {
      const term = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      rows.forEach(row => {
        row.hidden = !row.dataset.mechanicText.includes(term);
        if (!row.hidden) visible++;
      });
      empty.hidden = !choices.length || visible > 0;
      const selected = dialog.querySelector('input[name="mechanic_id"]:checked');
      count.textContent = selected ? 'Selected: ' + (selected.closest('label')?.querySelector('strong')?.textContent || 'Mechanic') : 'None selected';
    };
    input.addEventListener('input', update);
    dialog.querySelectorAll('input[name="mechanic_id"]').forEach(radio => radio.addEventListener('change',update));
    update();
  },
  mechanicOptions(currentId) {
    return (MaintUI.data.mechanics || []).filter(m => m.availability === 'Available' || +m.id === +currentId)
      .map(m => [m.id, `${m.full_name} · ${m.mechanic_code}${m.specialization ? ' · ' + m.specialization : ''}`]);
  },
  /** Garage intake only. Mechanic team, component diagnosis, and parts belong in the repair workflow. */
  report(vehicleId) {
    const d = MaintUI.data || {};
    const trucks = (d.trucks || []).filter(v => ['Available', 'Assigned'].includes(v.status) && !v.open_job && !v.on_road);
    const fields = UI.fields([
      { type:'html', col:12, html:`<label class="form-label" for="motorpool-truck-search">Affected truck *</label>
        <div class="mp-truck-search-field">
          <input id="motorpool-truck-search" type="search" class="form-control" data-report-truck-search placeholder="Select a truck or search plate / truck number…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="motorpool-truck-results" required>
          <input type="hidden" name="vehicle_id" value="">
          <div id="motorpool-truck-results" class="mp-truck-results" data-truck-results role="listbox" aria-label="Matching trucks" hidden></div>
        </div>
        <div class="form-help" data-truck-search-count aria-live="polite">Click to choose from 3 suggested trucks, or search by plate / truck number.</div>` },
      { name:'findings', label:'Inspection findings', type:'textarea', required:true, col:12,
        placeholder:'Record the actual condition and findings for this garage report.' },
      { name:'diagnosis', label:'Diagnosis', type:'textarea', required:true, col:12,
        placeholder:'State the cause or suspected cause of the problem.' },
      { name:'photos', label:'Photos of the reported problem', type:'file', multiple:true, required:true, col:12,
        attrs:'accept="image/png,image/jpeg"', help:'Attach evidence of the truck condition. Photos are required.' }
    ]);
    const body = `<p class="modal-intro">Record the inspection findings and diagnosis in one form. The date is recorded automatically and the truck is taken out of service. Next, assign the lead and assisting mechanics together in one form.</p>
      <div class="purchasing-receive-section">Truck problem report</div>${fields}`;
    const wrap = UI.modal('Report a truck problem', body, async (values, form) => {
      if (!values.vehicle_id) throw new Error('Choose a valid affected truck from the suggestions.');
      const res = await App.apiForm('Maintenance.report', values, form);
      UI.result(res);
      // Show the newly created repair and its next action instead of returning to an unfiltered list.
      if (res.job_id) App.go('maintenance', {open:res.job_id}); else App.route();
    }, { submit:'Submit problem report', size:'modal-lg', onShow:(dialog,form)=>{
      const search=form.querySelector('[data-report-truck-search]');
      const select=form.querySelector('[name="vehicle_id"]');
      const count=form.querySelector('[data-truck-search-count]');
      const results=form.querySelector('[data-truck-results]');
      const truckOptions=trucks.map(v=>({
        id:String(v.id),
        label:v.plate_number+(v.truck_number?' · #'+v.truck_number:'')+' · '+v.truck_type+' ('+v.status+')',
        haystack:(v.plate_number+' '+(v.truck_number||'')+' '+v.truck_type).toLowerCase()
      }));
      let matches=[],active=-1;
      const close=()=>{
        results.hidden=true;results.replaceChildren();active=-1;
        search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');
      };
      const choose=v=>{
        search.value=v.label;select.value=v.id;
        count.textContent='Selected: '+v.label;close();
      };
      const highlight=()=>{
        results.querySelectorAll('[data-truck-id]').forEach((button,i)=>{
          button.classList.toggle('active',i===active);
          button.setAttribute('aria-selected',i===active?'true':'false');
        });
        if(active>=0)search.setAttribute('aria-activedescendant','motorpool-truck-option-'+active);
      };
      const update=()=>{
        const term=search.value.trim().toLowerCase();
        const chosen=truckOptions.find(v=>v.id===select.value);
        if(chosen&&search.value===chosen.label){close();return;}
        select.value='';
        // First focus or click: preview three eligible trucks without requiring typing.
        // Typed searches show up to six matches in the fixed-height overlay.
        const found=term ? truckOptions.filter(v=>v.haystack.includes(term)) : truckOptions;
        matches=found.slice(0,term ? 6 : 3);active=-1;
        if(!matches.length){close();count.textContent=term?'No matching trucks found.':'No available trucks to select.';return;}
        results.innerHTML=matches.map((v,i)=>`<button type="button" class="mp-truck-option" id="motorpool-truck-option-${i}" role="option" aria-selected="false" data-truck-id="${UI.esc(v.id)}">${UI.esc(v.label)}</button>`).join('');
        results.hidden=false;search.setAttribute('aria-expanded','true');
        count.textContent=term
          ? (found.length>6?'Showing 6 of '+found.length+' matches. Type more to narrow results.':'Select a matching truck.')
          : 'Showing '+matches.length+' suggested truck'+(matches.length===1?'':'s')+'. Type to search all eligible trucks.';
      };
      results.addEventListener('mousedown',e=>{if(e.target.closest('[data-truck-id]'))e.preventDefault();});
      results.addEventListener('click',e=>{
        const button=e.target.closest('[data-truck-id]');
        const found=button&&matches.find(v=>v.id===button.dataset.truckId);
        if(found)choose(found);
      });
      search.addEventListener('focus',update);
      search.addEventListener('click',update);
      search.addEventListener('input',update);
      search.addEventListener('keydown',e=>{
        if(e.key==='Escape'){close();return;}
        if(results.hidden||!matches.length)return;
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();active=e.key==='ArrowDown'?(active+1)%matches.length:(active<=0?matches.length-1:active-1);highlight();
        }else if(e.key==='Enter'&&active>=0){e.preventDefault();choose(matches[active]);}
      });
      search.addEventListener('blur',()=>{if(!results.contains(document.activeElement))close();});
      const current=truckOptions.find(v=>v.id===String(vehicleId||''));
      if(current)choose(current);else close();
    }});
    return wrap;
  },
  /** Motorpool Parts Request: existing Purchasing backend, clear line-item editing and safe truck/repair linking. */
  async finalizeForm(j, r, after) {
    const d = MaintUI.data || {};
    if (!d.motorpoolCatalogReady) return UI.toast('Motorpool catalog migration is not installed.', 'warning');
    const choices = (d.mechanics || []).filter(m => m.availability === 'Available' || +m.id === +j.mechanic_id);
    const active = (r.helpers || []).filter(h => !h.released_at).map(h => +h.mechanic_id);
    const assigned = [...new Set([...(j.mechanic_id ? [+j.mechanic_id] : []), ...active])];
    const comps = (d.components || []).filter(c => !(r.excludedComponents || []).includes(+c.id));
    let catalog = [];
    try { catalog = (await App.api('Purchasing.request_catalog')).parts || []; } catch (_) {}
    const allMechs = (d.mechanics || []).filter(m => m.availability === 'Available' || assigned.includes(+m.id));
    const teamOptions = allMechs.map(m => `<label class="mp-final-team-choice" data-team-text="${UI.esc([m.full_name,m.mechanic_code,m.specialization].join(' ').toLocaleLowerCase())}">
      <input type="checkbox" data-team-mechanic value="${+m.id}" ${assigned.includes(+m.id) ? 'checked' : ''}>
      <span><strong>${UI.esc(m.full_name)}</strong><small>${UI.esc(m.mechanic_code)}${m.specialization ? ' · '+UI.esc(m.specialization) : ''}</small><em class="mp-final-team-recommended" data-team-match hidden></em></span>
    </label>`).join('');
    const summary = j.source === 'Incident' ? `<div class="alert alert-light border small"><b>Incident-related repair:</b> Original Dispatcher incident details stay read-only in Repair Details. Classification: ${UI.esc(j.severity || 'Not assessed')}.</div>` : '';
    const html = `<div class="small text-muted mb-3">Choose the affected components first. Recommended mechanics will appear in the checklist below.</div>
      ${summary}
      <div class="purchasing-receive-section">Truck and reported problem</div>
      <div class="border rounded p-3 mb-3"><b>${UI.esc(j.plate_number)}</b> · ${UI.esc(j.truck_type)}<div class="small mt-1">${UI.esc(j.problem)}</div></div>
      <details class="mp-final-optional-section mb-2" open>
      <summary>Affected components (choose first) <span data-component-summary>0 selected</span></summary>
      <div class="mp-final-optional-content">
      <div class="mp-final-component-tabs" role="tablist" aria-label="Component category">
        <button type="button" class="mp-final-component-tab active" role="tab" aria-selected="true" data-comp-tab="tractor_head">Tractor Head</button>
        <button type="button" class="mp-final-component-tab" role="tab" aria-selected="false" data-comp-tab="trailer">Trailer</button>
        <button type="button" class="mp-final-component-tab" role="tab" aria-selected="false" data-comp-tab="others">Others</button>
      </div>
      <div class="mp-final-components-pane" data-comp-pane="tractor_head">
        ${comps.filter(c=>c.section_key==='tractor_head').map(c=>`<label class="mp-final-component-choice"><input type="checkbox" data-component="${+c.id}" data-suggestions="${UI.esc(c.suggested_skills || '')}" ${(r.selectedComponents || []).includes(+c.id)?'checked':''}><span>${UI.esc(c.label)}</span></label>`).join('') || '<p class="text-muted small">No Tractor Head components recorded.</p>'}
      </div>
      <div class="mp-final-components-pane" data-comp-pane="trailer" hidden>
        ${comps.filter(c=>c.section_key==='trailer').map(c=>`<label class="mp-final-component-choice"><input type="checkbox" data-component="${+c.id}" data-suggestions="${UI.esc(c.suggested_skills || '')}" ${(r.selectedComponents || []).includes(+c.id)?'checked':''}><span>${UI.esc(c.label)}</span></label>`).join('') || '<p class="text-muted small">No Trailer components recorded.</p>'}
      </div>
      <div class="mp-final-components-pane" data-comp-pane="others" hidden>
        ${comps.filter(c=>!['tractor_head','trailer'].includes(c.section_key)).map(c=>`<label class="mp-final-component-choice"><input type="checkbox" data-component="${+c.id}" data-suggestions="${UI.esc(c.suggested_skills || '')}" ${(r.selectedComponents || []).includes(+c.id)?'checked':''}><span>${UI.esc(c.label)}</span></label>`).join('')}
        <label class="form-label mt-2" for="mp-final-other-component">Component not listed? Describe it here (optional)</label>
        <textarea id="mp-final-other-component" class="form-control" maxlength="250" rows="2" data-other-components placeholder="Name the additional affected component(s) and location."></textarea>
        <p class="small text-muted mt-1">Custom descriptions are saved in repair activity; only catalog checkboxes have verified skill mappings.</p>
      </div>
      <div class="small mb-2" data-specialization-suggest>Choose components to see suggested skills.</div>
      </div></details>
      <div class="purchasing-receive-section">Assign mechanics</div>
      <p class="small text-muted mt-2 mb-2" data-team-suggestion>Choose affected components above to see recommended mechanics based on verified specializations.</p>
      <label class="form-label mt-2" for="mp-final-team-search">Select mechanics *</label>
      <div class="mp-final-team-picker">
        <input id="mp-final-team-search" type="search" class="form-control" data-team-search
          placeholder="Search mechanic name, ID, or specialization…" autocomplete="off">
        <label class="mp-final-team-filter"><input type="checkbox" data-team-recommended-only> Recommended only</label>
        <div class="mp-final-team-list" data-team-list>
          ${teamOptions || '<p class="small text-muted p-2">No available mechanics to assign.</p>'}
          <p class="small text-muted p-2" data-team-empty hidden>No mechanics match your search.</p>
        </div>
        <div class="mp-final-team-foot"><span data-team-count>0 mechanics selected</span><button type="button" class="btn btn-link btn-sm" data-team-clear>Clear selection</button></div>
      </div>
      <div class="mp-final-skill-warning mt-2" data-final-skill-warning role="status" aria-live="polite" tabindex="-1" hidden></div>
      <div class="purchasing-receive-section">Parts requirement</div>
      <label class="form-label mt-2">Confirm parts requirement *</label><select class="form-select mb-2" data-final-parts><option value="">Select confirmed requirement...</option><option value="No Parts Needed">No Parts Needed</option><option value="Parts Required">Parts Required</option></select>
      <div class="small text-muted mb-2">Existing linked parts requests remain valid. If parts are required, select them here or use a linked request later before repair completion.</div>
      <div class="mp-final-parts" data-parts-input hidden>
        <div class="mp-final-parts-list" data-final-lines></div>
        <button type="button" class="btn btn-outline-primary btn-sm mp-final-add-part" data-final-add-part><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Part</button>
      </div>`;
    const dialog = UI.modal((j.source === 'On-Premise' && j.status === 'Reported' ? 'Assign Mechanic Team · ' : 'Finalize RA · ') + UI.esc(j.job_ref),html,async (_values,form)=>{
      const mechanics = [...form.querySelectorAll('[data-team-mechanic]:checked')].map(x=>+x.value);
      // Preserve the primary-reference database model without exposing lead/assistant steps.
      const lead = mechanics.includes(+j.mechanic_id) ? +j.mechanic_id : mechanics[0];
      const helpers = mechanics.filter(id => id !== lead);
      const components = [...form.querySelectorAll('[data-component]:checked')].map(x=>+x.dataset.component);
      const other_components = form.querySelector('[data-other-components]').value.trim();
      const parts_requirement = form.querySelector('[data-final-parts]').value;
      const parts_lines = [...form.querySelectorAll('[data-final-part-row]')].map(el=>({part_id:+el.querySelector('[data-part-id]').value,quantity:+el.querySelector('[data-part-qty]').value}));
      if (!lead) throw new Error('Select at least one mechanic.');
      if (other_components.length > 250) throw new Error('Other component description is too long.');
      if (mechanics.length > 11) throw new Error('You can assign at most 11 mechanics to one repair.');
      // Explain missing skill coverage beside the assistant checklist before
      // submitting; retain the authoritative server-side validation.
      const requiredSkills=[...new Set([...form.querySelectorAll('[data-component]:checked')]
        .flatMap(input=>(input.dataset.suggestions||'').split(',').map(skill=>skill.trim()).filter(Boolean)))];
      const chosenTeam=mechanics;
      const confirmedSkills=new Set((d.mechanicSkills||[])
        .filter(item=>chosenTeam.includes(+item.mechanic_id)).map(item=>item.name));
      const missingSkills=requiredSkills.filter(skill=>!confirmedSkills.has(skill));
      if (missingSkills.length) {
        const warning=form.querySelector('[data-final-skill-warning]');
        form.querySelector('.mp-final-optional-section')?.setAttribute('open', '');
        warning.hidden=false;
        warning.focus({preventScroll:true});
        warning.scrollIntoView({block:'center',behavior:'smooth'});
        throw new Error('Selected mechanics lack: '+missingSkills.join(', ')+'. Select a qualified mechanic from the checklist.');
      }
      if (!['No Parts Needed','Parts Required'].includes(parts_requirement)) throw new Error('Confirm whether replacement parts are required.');
      if (parts_lines.some(x=>!x.part_id||!Number.isInteger(x.quantity)||x.quantity<1)) throw new Error('Choose a part and valid quantity.');
      if (new Set(parts_lines.map(x=>x.part_id)).size!==parts_lines.length) throw new Error('Combine duplicate parts into one request.');
      if (parts_requirement !== 'Parts Required' && parts_lines.length) throw new Error('Select Parts Required before adding parts.');
      const response = await App.api('Maintenance.finalize_assignment',{job_id:j.id,mechanic_id:lead,assistant_mechanic_ids:helpers,component_ids:components,other_components,parts_requirement,parts_lines});
      UI.result(response); if(after) after(); else App.route();
    },{submit:j.source === 'On-Premise' && j.status === 'Reported' ? 'Assign Mechanic Team' : 'Finalize RA',size:'modal-xl'});

    const teamSearch=dialog.querySelector('[data-team-search]');
    const teamRows=[...dialog.querySelectorAll('.mp-final-team-choice')];
    const teamEmpty=dialog.querySelector('[data-team-empty]');
    const teamCount=dialog.querySelector('[data-team-count]');
    const teamList=dialog.querySelector('[data-team-list]');
    const recommendedOnly=dialog.querySelector('[data-team-recommended-only]');
    const teamSuggestion=dialog.querySelector('[data-team-suggestion]');
    // Use verified mechanic_skills from backend. Legacy specialization text is display-only.
    const mechanicSkills=new Map();
    (d.mechanicSkills||[]).forEach(item=>{
      const id=+item.mechanic_id;
      if(!mechanicSkills.has(id))mechanicSkills.set(id,new Set());
      mechanicSkills.get(id).add(item.name);
    });
    const selectedTeam=()=>[...dialog.querySelectorAll('[data-team-mechanic]:checked')].map(x=>+x.value);
    const filterTeam=()=>{
      const term=teamSearch.value.trim().toLocaleLowerCase();
      let shown=0;
      teamRows.forEach(row=>{
        const selected=row.querySelector('[data-team-mechanic]').checked;
        const recommended=row.dataset.recommended==='true';
        row.hidden=!row.dataset.teamText.includes(term) || (recommendedOnly.checked&&!recommended&&!selected);
        if(!row.hidden)shown++;
      });
      teamEmpty.hidden=shown>0;
      teamEmpty.textContent=recommendedOnly.checked ? 'No matching recommended mechanics. Turn off Recommended only to see all.' : 'No mechanics match your search.';
    };
    const refreshRecommendations=(needed, selectedTeamIds)=>{
      const covered=new Set((d.mechanicSkills||[]).filter(item=>selectedTeamIds.includes(+item.mechanic_id)).map(item=>item.name));
      const uncovered=needed.filter(skill=>!covered.has(skill));
      let totalRecommended=0;
      teamRows.forEach(row=>{
        const id=+row.querySelector('[data-team-mechanic]').value;
        const matching=needed.filter(skill=>(mechanicSkills.get(id)||new Set()).has(skill));
        const helps=uncovered.filter(skill=>(mechanicSkills.get(id)||new Set()).has(skill));
        const recommended=matching.length>0;
        row.dataset.recommended=String(recommended);
        row.dataset.recommendScore=String(helps.length*100+matching.length);
        row.classList.toggle('mp-team-recommended',recommended);
        const match=row.querySelector('[data-team-match]');
        match.textContent=matching.length ? 'Recommended · '+matching.join(', ') : '';
        match.hidden=!recommended;
        if(recommended)totalRecommended++;
      });
      teamRows.sort((a,b)=>{
        const selectedA=a.querySelector('[data-team-mechanic]').checked?1:0;
        const selectedB=b.querySelector('[data-team-mechanic]').checked?1:0;
        return selectedB-selectedA || (+b.dataset.recommendScore)-(+a.dataset.recommendScore)
          || a.dataset.teamText.localeCompare(b.dataset.teamText);
      }).forEach(row=>teamList.insertBefore(row,teamEmpty));
      teamSuggestion.textContent=needed.length
        ? 'Needed specialization'+(needed.length===1?'':'s')+': '+needed.join(', ')+'. '+totalRecommended+
          ' verified matching mechanic'+(totalRecommended===1?'':'s')+' marked Recommended.'
        : 'Choose affected components above to see recommended mechanics based on verified specializations.';
      filterTeam();
    };
    const update=()=>{
      const picked=[...dialog.querySelectorAll('[data-component]:checked')];
      const custom=dialog.querySelector('[data-other-components]').value.trim();
      dialog.querySelector('[data-component-summary]').textContent=picked.length+' component(s) selected'+(custom?' · Other component described':'');
      const names=[...new Set(picked.flatMap(x=>(x.dataset.suggestions||'').split(',').map(y=>y.trim()).filter(Boolean)))];
      dialog.querySelector('[data-specialization-suggest]').textContent=names.length
        ? 'Required skills: '+names.join(' · ') : 'No special skills mapped to selected components.';
      const team=selectedTeam();
      teamCount.textContent=team.length+' mechanic'+(team.length===1?'':'s')+' selected';
      const covered=new Set((d.mechanicSkills||[]).filter(item=>team.includes(+item.mechanic_id)).map(item=>item.name));
      const missing=names.filter(skill=>!covered.has(skill));
      const warning=dialog.querySelector('[data-final-skill-warning]');
      warning.textContent=missing.length?'Selected team needs: '+missing.join(', ')+'. Choose a qualified mechanic.':'';
      warning.hidden=!missing.length;
      refreshRecommendations(names, team);
      dialog.querySelector('[data-parts-input]').hidden=dialog.querySelector('[data-final-parts]').value!=='Parts Required';
    };
    teamSearch.addEventListener('input',filterTeam);
    recommendedOnly.addEventListener('change',filterTeam);
    dialog.querySelector('[data-team-clear]').addEventListener('click',()=>{
      dialog.querySelectorAll('[data-team-mechanic]').forEach(input=>{input.checked=false;});
      update();
    });
    dialog.querySelectorAll('[data-comp-tab]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.compTab;
      dialog.querySelectorAll('[data-comp-tab]').forEach(tab=>{
        const on=tab===button;tab.classList.toggle('active',on);tab.setAttribute('aria-selected',on?'true':'false');
      });
      dialog.querySelectorAll('[data-comp-pane]').forEach(pane=>pane.hidden=pane.dataset.compPane!==key);
    }));
    dialog.querySelector('[data-other-components]').addEventListener('input',update);
    dialog.querySelectorAll('[data-component],[data-team-mechanic],[data-final-parts]').forEach(x=>x.addEventListener('change',update));
    update();
    const partsHolder = dialog.querySelector('[data-final-lines]');
    const addPartButton = dialog.querySelector('[data-final-add-part]');
    // Rebuild the options on each change so an already chosen part cannot appear
    // in another row. Keep part IDs as the saved values; show only part names.
    const refreshPartChoices = () => {
      const selects = [...partsHolder.querySelectorAll('[data-part-id]')];
      const selected = selects.map(el => el.value).filter(Boolean);
      selects.forEach(select => {
        const own = select.value;
        const takenElsewhere = new Set(selected.filter(id => id !== own));
        select.innerHTML = '<option value="">Choose part</option>' + catalog
          .filter(part => String(part.id) === own || !takenElsewhere.has(String(part.id)))
          .map(part => `<option value="${+part.id}">${UI.esc(part.description)}</option>`).join('');
        select.value = own;
      });
      addPartButton.disabled = catalog.length > 0 && selects.length >= catalog.length;
      addPartButton.title = addPartButton.disabled ? 'All available parts already have a row.' : '';
    };
    addPartButton.onclick=()=>{
      if(!catalog.length)return UI.toast('Parts catalog is unavailable. Use the existing Parts Requests screen.', 'warning');
      const used = new Set([...partsHolder.querySelectorAll('[data-part-id]')].map(el => el.value).filter(Boolean));
      if (partsHolder.querySelectorAll('[data-part-id]').length >= catalog.length)
        return UI.toast('All available parts already have a row.', 'warning');
      const line=document.createElement('div');line.className='mp-final-part-row';
      line.setAttribute('data-final-part-row','');
      line.innerHTML=`<div class="mp-final-part-name"><label class="form-label">Part Name</label><select class="form-select" data-part-id aria-label="Select part"><option value="">Choose part</option></select></div><div class="mp-final-part-qty"><label class="form-label">Qty</label><input class="form-control" type="number" min="1" step="1" value="1" data-part-qty aria-label="Part quantity"></div><button type="button" class="btn btn-outline-danger btn-sm mp-final-part-remove">Remove</button>`;
      line.querySelector('[data-part-id]').addEventListener('change', event => {
        const selectedPart = event.target.value;
        if (selectedPart && [...partsHolder.querySelectorAll('[data-part-id]')]
          .some(other => other !== event.target && other.value === selectedPart)) {
          event.target.value = '';
          UI.toast('This part is already selected. Change its quantity instead.', 'warning');
        }
        refreshPartChoices();
      });
      line.querySelector('button').onclick=()=>{line.remove();refreshPartChoices();};
      partsHolder.appendChild(line);
      refreshPartChoices();
    };
    update();
  },
  async requestParts(vehicleId, jobId) {
    // Repair-originated requests always retain their original truck and repair.
    const lockedRepair = vehicleId != null && vehicleId !== '' && jobId != null && jobId !== '';
    const d = MaintUI.data || {};
    let parts;
    try { parts = (await App.api('Purchasing.request_catalog')).parts || []; }
    catch (e) { return UI.toast(e.message, 'error'); }
    const trucks = Array.isArray(d.trucks) ? d.trucks : [];
    const openJobs = (Array.isArray(d.jobs) ? d.jobs : []).filter(j => ['Under Inspection', 'Under Repair'].includes(j.status));
    if (lockedRepair && !openJobs.some(j => String(j.id) === String(jobId) && String(j.vehicle_id) === String(vehicleId)))
      return UI.toast('The selected repair is no longer available for a parts request. Refresh the repair record.', 'error');
    const partOptions = parts.map(p =>
      `<option value="${+p.id}">${UI.esc(p.part_number)} · ${UI.esc(p.description)} (${UI.esc(p.availability)})</option>`).join('');
    const item = () => `<div class="mp-parts-line" data-part-row>
      <div class="mp-parts-line-fields"><div><label class="form-label">Part</label><select class="form-select" data-part>
        <option value="">Select a part…</option>${partOptions}</select></div>
        <div><label class="form-label">Quantity</label><input class="form-control" type="number" min="1" max="100000" step="1" placeholder="Qty" data-qty></div></div>
      <button type="button" class="btn btn-outline-danger btn-sm mp-parts-remove" data-remove-part title="Remove item" aria-label="Remove item"><i class="bi bi-trash"></i></button></div>`;
    const content = `<p class="modal-intro"><i class="bi bi-box-seam me-2" aria-hidden="true"></i>Request items for an active repair. Purchasing checks stock and handles release; quantities and status will appear in Parts Requests.</p>
      ${UI.fields([
        { name: 'vehicle_id', label: 'Truck', type: 'select', required: true, col: 6, value: vehicleId,
          options: trucks.map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]) },
        { name: 'maintenance_job_id', label: lockedRepair ? 'For repair record' : 'For repair record (optional)', type: 'select', col: 6, value: jobId,
          options: openJobs.map(j => [j.id, j.job_ref + ' · ' + j.plate_number + ' · ' + (j.problem || '').slice(0, 30)]),
          help: lockedRepair ? 'Automatically linked to this repair. Truck and repair record cannot be changed.' : 'Only inspection/repair records for the selected truck are available.' },
        { name: 'purpose', label: 'Reason for request', type: 'textarea', col: 12, required: true,
          placeholder: 'Describe why these parts are needed.' }
      ])}
      <section class="mp-parts-items"><div class="mp-parts-items-head"><div><strong>Parts needed</strong><div class="small text-muted">Choose a part and enter its requested quantity.</div></div>
        <button type="button" class="btn btn-outline-primary btn-sm" data-add-part><i class="bi bi-plus-lg me-1"></i>Add item</button></div>
        <div data-part-list>${item()}</div><div class="small text-muted mt-2" data-part-count>1 item row</div></section>`;
    const wrap = UI.modal('Request parts', content, async (values, form, dialog) => {
      const lines = [...dialog.querySelectorAll('[data-part-row]')].map(r => ({
        part_id: r.querySelector('[data-part]').value, quantity: r.querySelector('[data-qty]').value
      })).filter(x => x.part_id || x.quantity);
      if (!lines.length || lines.some(x => !x.part_id || !/^\d+$/.test(String(x.quantity)) || +x.quantity < 1 || +x.quantity > 100000))
        throw new Error('Select at least one part with a whole-number quantity from 1 to 100000.');
      if (new Set(lines.map(x => String(x.part_id))).size !== lines.length)
        throw new Error('Duplicate parts are not allowed. Combine quantities into one item.');
      // Disabled selects may be excluded from form serialization; force original linkage.
      if (lockedRepair) {
        values.vehicle_id = vehicleId;
        values.maintenance_job_id = jobId;
      }
      const job = openJobs.find(j => String(j.id) === String(values.maintenance_job_id));
      if (job && String(job.vehicle_id) !== String(values.vehicle_id))
        throw new Error('The chosen repair belongs to a different truck.');
      const res = await App.api('Purchasing.request_create', { ...values, lines });
      UI.result(res); App.route();
    }, { submit: 'Send to Purchasing', size: 'modal-lg',
      onShow: (dialog, form) => {
        dialog.classList.add('mp-parts-request-modal');
        const truckSelect = form.querySelector('[name="vehicle_id"]');
        const jobSelect = form.querySelector('[name="maintenance_job_id"]');
        const allJobs = [...jobSelect.options].map(o => ({ value:o.value, label:o.textContent }));
        const refreshJobs = () => {
          const desired = jobSelect.value || String(jobId || '');
          jobSelect.innerHTML = '<option value="">No linked repair</option>';
          allJobs.filter(o => o.value && openJobs.some(j => String(j.id) === o.value && String(j.vehicle_id) === String(truckSelect.value)))
            .forEach(o => jobSelect.add(new Option(o.label, o.value)));
          if ([...jobSelect.options].some(o => o.value === desired)) jobSelect.value = desired;
        };
        if (lockedRepair) truckSelect.value = String(vehicleId);
        truckSelect.addEventListener('change', refreshJobs);
        refreshJobs();
        if (lockedRepair) {
          jobSelect.value = String(jobId);
          truckSelect.disabled = true;
          jobSelect.disabled = true;
          truckSelect.classList.add('mp-locked-reference');
          jobSelect.classList.add('mp-locked-reference');
          truckSelect.setAttribute('aria-label', 'Truck (fixed for selected repair)');
          jobSelect.setAttribute('aria-label', 'Repair record (fixed for selected repair)');
          truckSelect.title = 'This truck is linked to the selected repair record.';
          jobSelect.title = 'This repair record is fixed for this parts request.';
        }
        const list = dialog.querySelector('[data-part-list]'), count = dialog.querySelector('[data-part-count]');
        const sync = () => {
          const rows = [...list.querySelectorAll('[data-part-row]')];
          count.textContent = rows.length + ' item row' + (rows.length === 1 ? '' : 's');
          rows.forEach(r => { r.querySelector('[data-remove-part]').disabled = rows.length === 1; });
        };
        dialog.querySelector('[data-add-part]').addEventListener('click', () => {
          list.insertAdjacentHTML('beforeend', item()); sync();
        });
        list.addEventListener('click', event => {
          const btn = event.target.closest('[data-remove-part]');
          if (!btn || list.querySelectorAll('[data-part-row]').length <= 1) return;
          btn.closest('[data-part-row]').remove(); sync();
        });
        if (!parts.length) dialog.querySelector('[data-part-list]').insertAdjacentHTML('beforebegin',
          '<div class="alert alert-warning">No parts in the Purchasing catalog yet. Add parts through an authorized Purchasing account.</div>');
        sync();
      } });
    return wrap;
  },
  /** Read-only Motorpool request details: render the actual lines directly in the
   * modal (UI.table's deferred table mount is not initialized in this context).
   * Never expose Purchasing costs, linked POs, or supplier information here. */
  async openRequest(rq) {
    const seq = App.navSeq;
    let r; try { r = await App.api('Purchasing.request_details', { request_id: rq.id }); }
    catch (e) { return UI.toast(e.message, 'error'); }
    if (seq !== App.navSeq) return;
    const request = r.request || {};
    const lines = Array.isArray(r.lines) ? r.lines : [];
    const total = field => lines.reduce((sum, line) => sum + (+line[field] || 0), 0);
    const requested = total('quantity'), released = total('released_qty'), reserved = total('reserved_qty');
    const remaining = Math.max(0, requested - released);
    const progress = requested ? Math.min(100, Math.round(released / requested * 100)) : 0;
    const next = typeof MpParts !== 'undefined' ? MpParts.nextStep({ ...rq, status: request.status }) : '';
    const table = lines.length
      ? `<div class="table-wrap mp-request-details-table"><table class="data-table">
          <thead><tr><th>Part ID / Item</th><th class="text-end">Requested</th><th class="text-end">Reserved</th><th class="text-end">Released</th><th class="text-end">Remaining</th><th>Availability</th></tr></thead>
          <tbody>${lines.map(line => {
            const qty = +line.quantity || 0, out = Math.max(0, qty - (+line.released_qty || 0));
            const desc = [line.part_type, line.description, line.brand].filter(Boolean).join(' · ');
            return `<tr>
              <td><strong>${UI.esc(line.part_number || '—')}</strong><div class="cell-sub">${UI.esc(desc || 'No description')}</div></td>
              <td class="text-end">${UI.num(qty)} ${UI.esc(line.unit || '')}</td>
              <td class="text-end">${UI.num(line.reserved_qty || 0)}</td>
              <td class="text-end">${UI.num(line.released_qty || 0)}</td>
              <td class="text-end">${UI.num(out)}</td>
              <td>${UI.badge(line.availability || 'Not available')}</td>
            </tr>`;
          }).join('')}</tbody></table></div>`
      : '<p class="text-muted small mb-0">No parts were recorded for this request.</p>';
    const html = `<div class="mp-request-details">
        <div class="mp-request-details-overview">
          <div><span class="mp-request-detail-label">Truck</span><strong>${UI.esc(request.plate_number || '—')}${request.truck_number ? ' · #'+UI.esc(request.truck_number) : ''}</strong></div>
          <div><span class="mp-request-detail-label">Linked repair</span><strong>${UI.esc(request.job_ref || 'Not linked')}</strong></div>
          <div><span class="mp-request-detail-label">Status</span>${UI.badge(request.status || 'Unknown')}</div>
          <div><span class="mp-request-detail-label">Requested on</span><strong>${request.created_at ? UI.datetime(request.created_at) : '—'}</strong></div>
        </div>
        <div class="mp-request-progress">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <strong>Release progress</strong><span>${UI.num(released)} of ${UI.num(requested)} units released</span>
          </div>
          <div class="mp-request-progress-track" role="progressbar" aria-label="Parts released" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
          <div class="mp-request-progress-counts">
            <span>Reserved: <b>${UI.num(reserved)}</b></span>
            <span>Still needed: <b>${UI.num(remaining)}</b></span>
          </div>
        </div>
        ${UI.h('Requested parts')}${table}
        ${UI.h('Request information')}
        ${UI.kv([['Purpose', UI.e(request.purpose)], ['Requested by', UI.e(request.requested_by_name)],
          ['Processed by', UI.e(request.processed_by_name)],
          ['Processed on', request.processed_at ? UI.datetime(request.processed_at) : 'Not processed yet'],
          ['Notes', UI.e(request.notes)]])}
        ${next ? `<div class="mp-request-next"><strong>Next step</strong><p class="mb-0">${UI.esc(next)}</p></div>` : ''}
      </div>`;
    UI.modal('Parts request ' + UI.esc(request.request_ref || rq.request_ref || ''), html, null, { submit:'', size:'modal-xl' });
  },
  /** Opens the repair record; autoAct = key of a drawer action to start at once (row shortcut, same form and checks). */
  async open(id, autoAct) {
    const d = MaintUI.data;
    const seq = App.navSeq;
    let r; try { r = await App.api('Maintenance.details', { job_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    if (seq !== App.navSeq) return;   // WS_NAV_STATE_V1: the user moved on while loading
    const j = r.job, i = r.incident;
    // Once the repair has been completed or cancelled its detail view is
    // immutable. Verification remains a separate action in the dedicated queue.
    const act = d.can.act && !['Completed','Cancelled'].includes(j.status) && !j.verified_at;
    if (i && j.incident_status === undefined) j.incident_status = i.status; // stage text needs the incident state
    const [stage, warn] = MaintUI.stageOf(j);
    const acts = [];
    if (act) {
      if (j.source === 'Incident' && j.status === 'Reported') acts.push(['assess', 'Assess incident', 'primary', 'bi-clipboard-pulse']);
      if (j.source !== 'Incident' && j.status === 'Reported') acts.push(j.findings && j.diagnosis
        ? ['finalize', 'Assign Mechanic Team', 'primary', 'bi-people']
        : ['mech', 'Assign mechanic', 'primary', 'bi-person-gear']);
      if (j.status === 'Under Inspection') acts.push(j.mechanic_id ? ['inspect', 'Record findings', 'primary', 'bi-search'] : ['mech', 'Assign mechanic', 'primary', 'bi-person-plus']);
      if (j.status === 'Under Repair') acts.push(d.motorpoolCatalogReady && !j.assignment_finalized_at ? ['finalize', 'Finalize RA', 'primary', 'bi-lock'] : (+r.pending_parts_units > 0 ? ['parts-pending', 'Waiting for parts (' + r.pending_parts_units + ')', 'outline-secondary disabled', 'bi-hourglass-split'] : ['complete', 'Complete repair', 'primary', 'bi-check2-circle']));
      if (j.status === 'Completed' && !j.verified_at) acts.push(['verify', 'Verify & return to service', 'primary', 'bi-shield-check']);
      // INCIDENT_CLEARANCE_V1: Motorpool's Fit / Not Fit to Continue decision for a Minor trip incident.
      if (i && i.severity === 'Minor' && !['Repaired - Cleared to Continue', 'Resolved'].includes(i.status)) acts.push(['clearance', 'Vehicle clearance', j.verified_at ? 'primary' : 'outline-primary', 'bi-sign-stop']);
      // JOB_HELPER_MECHANICS_V1: assisting mechanics once a lead is assigned. Shown (disabled, with the reason) instead of
      // hidden when the database update is missing, so the custodian can see why it cannot be used.
      if (j.mechanic_id && MaintUI.ACTIVE.includes(j.status) && !d.motorpoolCatalogReady) acts.push(r.helpersReady ? ['helpers', 'Add mechanics', 'outline-primary', 'bi-people']
        : ['helpers-off', 'Add mechanics (needs database update 12)', 'outline-secondary disabled', 'bi-people']);
      if (['Under Inspection', 'Under Repair'].includes(j.status)) {
        if (j.mechanic_id && !d.motorpoolCatalogReady) acts.push(['mech', 'Change lead mechanic', 'outline-secondary', 'bi-arrow-left-right']);
        if (!d.motorpoolCatalogReady || j.assignment_finalized_at) acts.push(['parts', 'Request parts', 'outline-secondary', 'bi-box-seam']);
      }
    }
    const partsCost = r.parts.reduce((a, p) => a + (+p.released_qty) * (+p.unit_cost || 0), 0), other = r.costs.reduce((a, c) => a + +c.amount, 0);
    const truckLine = `<b>${UI.esc(j.plate_number)}</b>${j.truck_number ? ' · #' + UI.esc(j.truck_number) : ''} · ${UI.esc(j.truck_type)} · ${UI.badge(j.truck_status)}`;
    const progress = UI.workflow(MaintUI.STAGES.map((label,index)=>{
      const status=index===4?'Completed':label,event=(r.events||[]).find(e=>e.to_status===status);
      const at=index===4?j.verified_at:event?.created_at;
      const recorded=index===4?!!j.verified_at:!!event;
      return {label,at,state:j.status==='Cancelled'&&!recorded?'exception':index<4&&j.status===label&&!j.verified_at?'current':recorded?'complete':'pending'};
    }),{status:j.verified_at?'Returned to service':j.status,label:'Recorded corrective repair progress'});
    const readiness=UI.readiness([
      {label:'Inspection findings and diagnosis',state:j.findings&&j.diagnosis?'complete':'unknown'},
      {label:'Corrective repair recorded',state:j.repair_performed&&j.completed_on?'complete':'unknown'},
      {label:'Return-to-service verification',state:j.verified_at?'complete':'unknown',detail:j.verified_at?'Recorded verification':'The existing verification action remains required before return to service.'}
    ],{title:'Return-to-service record'});
    // Separate the single recommended workflow action from optional supporting tasks.
    // Vehicle clearance stays available for eligible Minor incidents but does not
    // compete visually with inspection, completion, or verification.
    const mainAction = acts.find(([a]) => ['assess', 'mech', 'inspect', 'finalize', 'complete', 'verify'].includes(a) && (a !== 'mech' || !j.mechanic_id))
      || acts.find(([a]) => a === 'clearance');
    const supportActions = acts.filter(a => a !== mainAction);
    const actionButton = ([a, l, c, ic]) => `<button type="button" class="btn btn-sm btn-${c}" data-a="${a}">${ic ? `<i class="bi ${ic}" aria-hidden="true"></i> ` : ''}${UI.esc(l)}</button>`;
    // Repair-specific status history: compact readable cards, without changing
    // chronological event order or hiding same-status audit events.
    const statusHistory = (r.events || []).length
      ? `<ol class="mp-repair-status-timeline" aria-label="Repair status history">
          ${r.events.map((event, idx) => {
            const from = event.from_status || 'Not recorded';
            const to = event.to_status || event.event_type || 'Recorded activity';
            const changed = !!event.to_status && event.from_status !== event.to_status;
            const note = event.details || event.notes || event.note || '';
            const actor = event.actor || 'Actor not recorded';
            return `<li class="mp-repair-history-event">
              <div class="mp-repair-history-marker" aria-hidden="true"><span></span></div>
              <div class="mp-repair-history-card">
                <div class="mp-repair-history-top">
                  <span class="mp-repair-history-status">${UI.esc(to)}</span>
                  <span class="mp-repair-history-time">${event.created_at ? UI.datetime(event.created_at) : 'Time not recorded'}</span>
                </div>
                ${changed ? `<div class="mp-repair-history-change">${UI.esc(from)} <span aria-hidden="true">→</span> ${UI.esc(event.to_status)}</div>` : ''}
                ${note ? `<p class="mp-repair-history-note">${UI.esc(note)}</p>` : ''}
                <div class="mp-repair-history-meta">
                  <span><i class="bi bi-person" aria-hidden="true"></i> ${UI.esc(actor)}</span>
                  ${event.mechanic ? `<span><i class="bi bi-wrench" aria-hidden="true"></i> Mechanic: ${UI.esc(event.mechanic)}</span>` : ''}
                  ${event.reference ? `<span>${UI.esc(event.reference)}</span>` : ''}
                </div>
              </div>
            </li>`;
          }).join('')}
        </ol>`
      : '<div class="mp-repair-history-empty">No status events have been recorded for this repair.</div>';
    const html = `<div class="mp-repair-overview-summary">
        <div class="mp-repair-overview-top"><span class="small text-muted">Current status</span>${UI.badge(j.verified_at ? 'Returned to service' : j.status)}</div>
        <div class="mp-repair-next"><strong>Next step</strong><span>${UI.esc(MaintUI.nextStep(j))}</span></div>
        ${mainAction ? `<div class="mp-repair-main-action"><span class="small text-muted">Recommended action</span>${actionButton(mainAction)}</div>` : ''}
      </div>
      ${supportActions.length ? `<div class="mp-repair-support-actions"><strong>Other actions</strong><div class="mp-repair-support-buttons">${supportActions.map(actionButton).join('')}</div></div>` : ''}
      ${UI.h('Problem')}${UI.kv([['Truck', truckLine], ['Source', j.source === 'Incident' ? 'Trip incident' + (j.trip_ref ? ' · ' + UI.esc(j.trip_ref) : '') : (r.arrival ? 'Arrival checklist · ' + UI.esc(j.trip_ref || '') + ' · ' + UI.esc(r.arrival.actor) + ' · ' + UI.datetime(r.arrival.completed_at)
          : r.preDispatch ? 'Pre-dispatch checklist · ' + UI.esc(j.trip_ref || '') + ' · ' + UI.esc(r.preDispatch.actor) + ' · ' + UI.datetime(r.preDispatch.completed_at)
          : j.trip_ref ? 'Checklist-linked truck problem · ' + UI.esc(j.trip_ref) : 'Reported at the garage')],
        r.arrival && r.arrival.damage_notes ? ['Damage / missing (arrival)', UI.esc(r.arrival.damage_notes)] : null,
        r.preDispatch ? ['Pre-dispatch NOT OK items', (r.preDispatchFindings || []).length
          ? UI.esc(r.preDispatchFindings.join('; ')) : 'No recorded NOT OK findings'] : null,
        ['Problem', UI.e(j.problem)], ['Date reported', UI.date(j.reported_on) + (j.reported_by_name ? ' · ' + UI.esc(j.reported_by_name) : '')],
        ])}
      ${UI.h('Mechanics and repair')}${progress}${readiness}${UI.kv([['Lead mechanic', j.mechanic ? `${UI.esc(j.mechanic)} · ${UI.esc(j.mechanic_code)}${j.mechanic_contact ? ' · ' + UI.esc(j.mechanic_contact) : ''}` : 'Not assigned'],
        ['Assisting mechanics', r.helpersReady ? MaintUI.helperList(r.helpers, Boolean(act) && MaintUI.ACTIVE.includes(j.status))
          : '<span class="text-muted">Not available until database update 2026-11-12_12 is applied.</span>'],
        ['Inspection findings', UI.e(j.findings)], ['Diagnosis', UI.e(j.diagnosis)],
        ['Corrective action', j.status === 'Completed' && !j.repair_performed ? '<span class="text-muted">Inspection only — no repair performed</span>' : UI.e(j.repair_performed)], ['Repair completion date', j.completed_on ? UI.date(j.completed_on) + ' · ' + UI.e(j.completed_by_name) : '—'],
        ['Verification', j.verified_at ? `Passed · ${UI.e(j.verified_by_name)} · ${UI.datetime(j.verified_at)}<div class="small text-muted">${UI.e(j.verification_notes)}</div>` : (j.status === 'Completed' ? '<span class="badge-s amber">Waiting for verification</span>' : '—')],
        ['Remarks', UI.e(j.remarks)]])}
      ${i ? UI.h('Trip incident', act ? `<button class="btn btn-link btn-sm p-0" data-a="printinc"><i class="bi bi-printer"></i> Incident report form</button>` : '') + UI.kv([['Reference', UI.esc(i.incident_ref) + ' ' + UI.badge(i.status)], ['Type', UI.e(i.incident_type)],
        ['Incident date and time / location', UI.datetime(i.incident_at) + ' · ' + UI.esc(i.location)], ['Original details', UI.e(i.details)], ['Additional information', (r.incidentClarifications || []).length ? (r.incidentClarifications || []).map(c=>'<div class="border-bottom py-1"><small class="text-muted">'+UI.esc(c.actor)+' · '+UI.datetime(c.created_at)+'</small><div>'+UI.esc(c.details)+'</div></div>').join('') : '<span class="text-muted">None submitted</span>'], ['Persons involved', UI.e(i.persons_involved)], ['Reported by', UI.e(i.reported_by_name)], ['Recommendation', UI.e(i.recommendation)],
        ['Damage classification', i.severity ? UI.esc(i.severity) + (i.assessed_by_name ? ' · ' + UI.esc(i.assessed_by_name) + ' · ' + UI.datetime(i.assessed_at) : '') : '<span class="text-muted">Not assessed yet</span>'],
        ['Vehicle clearance', i.clearance ? `${UI.badge(i.clearance)} · ${UI.e(i.cleared_by_name)} · ${UI.datetime(i.cleared_at)}<div class="small text-muted">${UI.e(i.clearance_findings)}</div>` : '<span class="text-muted">Not recorded</span>'],
        ['Trip resumed', i.resumed_at ? UI.e(i.resumed_by_name) + ' · ' + UI.datetime(i.resumed_at) : '—']]) : ''}
      ${UI.h('Parts and costs')}
      <div class="mp-repair-parts-costs">
        <div class="mp-repair-cost-summary">
          <div><small>Parts cost</small><strong>${UI.money(partsCost)}</strong></div>
          <div><small>Labor & other costs</small><strong>${UI.money(other)}</strong></div>
          <div class="mp-repair-cost-total"><small>Total maintenance cost</small><strong>${UI.money(partsCost + other)}</strong></div>
        </div>
        <div class="mp-repair-cost-section">
          <div class="mp-repair-cost-section-head"><strong>Requested parts</strong>
            ${act && UI.canGo('mp_parts_requests') ? `<button type="button" class="btn btn-sm btn-outline-primary" data-partspage="${+j.vehicle_id}">Open Parts Requests</button>` : ''}
          </div>
          ${+r.pending_parts_units > 0 ? `<div class="mp-repair-cost-notice" role="status"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><span>${UI.num(r.pending_parts_units)} requested unit(s) still need Purchasing release before repair completion.</span></div>` : ''}
          ${r.parts.length ? `<div class="mp-repair-parts-list">${r.parts.map(p=>`
            <div class="mp-repair-part-entry">
              <div class="mp-repair-part-main"><strong>${UI.esc(p.description || p.part_number || 'Part')}</strong>
                <small>${UI.esc(p.part_number || '—')}${p.part_type ? ' · '+UI.esc(p.part_type) : ''} · Request ${UI.esc(p.request_ref || '—')}</small>
              </div>
              <div class="mp-repair-part-counts">
                <span>Requested <b>${UI.num(p.quantity || 0)}</b></span>
                <span>Released <b>${UI.num(p.released_qty || 0)}</b></span>
                <span>Still needed <b>${UI.num(Math.max(0,(+p.quantity || 0)-(+p.released_qty || 0)))}</b></span>
              </div>
              <div class="mp-repair-part-price"><span>Released value</span><b>${UI.money((+p.released_qty || 0)*(+p.unit_cost || 0))}</b></div>
            </div>`).join('')}</div>`
            : '<div class="mp-repair-cost-empty"><i class="bi bi-box-seam" aria-hidden="true"></i><strong>No parts requested</strong><span>Parts requested for this repair will appear here, including their release progress.</span></div>'}
        </div>
        <div class="mp-repair-cost-section">
          <div class="mp-repair-cost-section-head"><strong>Labor & outside costs</strong></div>
          ${r.costs.length ? `<div class="mp-repair-other-costs">${r.costs.map(c=>`
            <div class="mp-repair-other-entry">
              <div><strong>${UI.esc(c.cost_type || 'Other cost')}</strong>
                <small>${UI.esc(c.description || c.provider || 'Recorded expense')}${c.incurred_on ? ' · '+UI.date(c.incurred_on) : ''}</small>
                ${c.description && c.provider ? `<small>Provider: ${UI.esc(c.provider)}</small>` : ''}
              </div><b>${UI.money(c.amount || 0)}</b>
            </div>`).join('')}</div>`
            : '<div class="mp-repair-cost-empty"><i class="bi bi-receipt" aria-hidden="true"></i><strong>No labor or outside costs recorded</strong><span>Recorded repair expenses will appear here.</span></div>'}
        </div>
      </div>
      ${UI.h('Photos and documents')}${UI.docs(r.documents)}
      ${UI.h('Status history')}${statusHistory}
      ${UI.h('Maintenance history of this truck')}${UI.table([['Record', 'job_ref'], ['Source', 'source'], ['Problem', 'problem'], ['Mechanic', 'mechanic'], ['Status', 'status', 'badge'], ['Date reported', 'reported_on', 'date'], ['Completed', 'completed_on', 'date']], r.history, { plain: true })}`;
    const el = UI.drawer(UI.esc(j.job_ref) + ' · ' + UI.esc(j.plate_number), html, { subtitle: 'Corrective maintenance · ' + UI.esc(j.verified_at ? 'Returned to service' : j.status) });
    UI.drawerSections(el,[['overview','Overview',['Problem','Trip incident']],['repair','Inspection & Repairs',['Mechanics and repair']],['parts','Parts & Costs',['Parts and costs']],['docs','Documents',['Photos and documents']],['history','Status History',['Status history','Maintenance history of this truck']]],{key:'maintenance-details'});
    el.querySelector('[data-partspage]')?.addEventListener('click', (e) => { UI.closeDrawer(); App.go('mp_parts_requests', { vehicle_id: e.currentTarget.dataset.partspage }); });
    const reopen = () => { MaintUI.open(j.id); App.route(); };
    el.querySelectorAll('[data-rmh]').forEach(b => b.onclick = () => UI.confirmAction('Remove ' + UI.esc(b.dataset.name) + ' from ' + UI.esc(j.job_ref),
      'The mechanic becomes available for other repairs. The assignment stays in the record history.', 'Maintenance.helper_remove', { job_id: j.id, mechanic_id: b.dataset.rmh },
      { danger: true, submit: 'Remove mechanic', fields: [{ name: 'reason', label: 'Reason', required: true, col: 12 }], after: reopen }));
    const autoBtn = autoAct && el.querySelector(`[data-a="${autoAct}"]`);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'finalize') return MaintUI.finalizeForm(j, r, reopen);
      if (a === 'helpers') return MaintUI.addHelpers(j, r.helpers, reopen);
      const mech = MaintUI.mechanicOptions(j.mechanic_id);
      if (a === 'assess') UI.formModal('Incident assessment · ' + UI.esc(i.incident_ref), [
          { name: 'severity', label: 'Damage classification', type: 'select', required: true, col: 12,
            options: [['Minor', 'Minor'], ['Major', 'Major']] },
          { name: 'recommendation', label: 'Assessment and recommendation', type: 'textarea', required: true, col: 12,
            placeholder: 'Describe the assessment and recommended next action.' }],
        'Maintenance.assess', { extra: { job_id: j.id },
          intro: `<section class="mp-incident-assessment" aria-label="Original Dispatcher incident report">
            <div class="mp-incident-assessment-heading"><strong>Dispatcher incident report</strong><span>Read-only</span></div>
            <div class="mp-incident-report-grid">
              <div class="mp-incident-report-field"><small>Problem</small><strong>${UI.esc(i.problem)}</strong></div>
              <div class="mp-incident-report-field"><small>Location</small><strong>${UI.esc(i.location)}</strong></div>
              <div class="mp-incident-report-field"><small>Reported</small><strong>${UI.datetime(i.incident_at)}</strong></div>
              <div class="mp-incident-report-field mp-incident-report-wide"><small>Original details</small><div>${UI.e(i.details)}</div></div>
            </div>
            ${(r.incidentClarifications || []).length ? `<details class="mp-incident-updates"><summary>Dispatcher updates (${r.incidentClarifications.length})</summary>${r.incidentClarifications.map(c => `<div class="mp-incident-update"><small>${UI.esc(c.actor)} · ${UI.datetime(c.created_at)}</small><div>${UI.esc(c.details)}</div></div>`).join('')}</details>` : ''}
            <p class="mp-incident-assessment-guidance">Assess from the Dispatcher report; no garage mechanic or physical inspection is required at this stage. <b>Minor</b> keeps the trip On Hold pending safe vehicle clearance. <b>Major</b> marks the truck Not Fit to Continue and moves the trip to For Reschedule.</p>
          </section>`,
          after: reopen });
      if (a === 'mech') return MaintUI.assignMechanic(j, reopen);
      if (a === 'inspect') UI.formModalFiles('Inspection findings for ' + UI.esc(j.job_ref), [
          { name: 'findings', label: 'Inspection findings', type: 'textarea', required: true, col: 12, placeholder: 'What the mechanic found when checking the truck' },
          { name: 'diagnosis', label: 'Diagnosis', type: 'textarea', required: true, col: 12, placeholder: 'Cause of the problem and what must be repaired or replaced' },
          { name: 'photos', label: 'More photos (optional)', type: 'file', multiple: true, col: 6, attrs: 'accept="image/png,image/jpeg"' }],
        'Maintenance.inspect', { extra: { job_id: j.id }, submit: 'Save and start repair', after: reopen });
      if (a === 'complete' && +r.pending_parts_units > 0) return UI.toast('Purchasing must release the requested parts first (' + r.pending_parts_units + ' units pending).', 'error');
      if (a === 'complete') UI.formModalFiles('Complete repair ' + UI.esc(j.job_ref), [
          { name: 'repair_performed', label: 'Corrective action performed', type: 'textarea', required: true, col: 12 },
          { name: 'evidence', label: 'Evidence of the repair (photos or documents, required)', type: 'file', multiple: true, required: true, col: 12, attrs: 'accept="application/pdf,image/png,image/jpeg"' }],
        'Maintenance.complete', { extra: { job_id: j.id }, submit: 'Complete repair', intro: 'Add parts and labor costs before completing. The mechanic becomes available again. The truck stays out of service until you verify it.', after: reopen });
      if (a === 'clearance') UI.formModalFiles('Vehicle clearance · ' + UI.esc(i.incident_ref), [
          { name: 'decision', label: 'Decision', type: 'select', required: true, col: 12, placeholder: false, options: [['Fit to Continue', 'Fit to Continue: the truck may continue this trip'], ['Not Fit to Continue', 'Not Fit to Continue: the trip stays On Hold']] },
          { name: 'findings', label: 'Findings (what was checked and the truck\'s actual condition)', type: 'textarea', required: true, col: 12 },
          { name: 'inspection_only', label: 'Inspection only: no repair was needed (Fit to Continue; no parts, costs or labor recorded)', type: 'checkbox', col: 12 },
          { name: 'evidence', label: 'Supporting evidence (optional)', type: 'file', multiple: true, col: 12, attrs: 'accept="application/pdf,image/png,image/jpeg"' }],
        'Maintenance.clearance', { extra: { job_id: j.id }, submit: 'Record clearance', after: reopen,
          intro: `Damage classification: <b>${UI.esc(i.severity)}</b>. Fit to Continue needs the on-site repair record completed and verified (${UI.esc(j.job_ref)}); the dispatcher then resumes the trip. Not Fit to Continue keeps the trip On Hold.` });
      if (a === 'verify') return MaintUI.verifyForm(j, reopen);
      if (a === 'parts') { UI.closeDrawer(); MaintUI.requestParts(j.vehicle_id, j.id); }
      if (a === 'printinc') TripUI.printIncident({ ...i }, { trip_ref: j.trip_ref, plate_number: j.plate_number });
    });
    if (autoBtn) autoBtn.click();
  },
  verifyForm(j, after) {
    if (j.status !== 'Completed' || j.verified_at) return UI.toast('This repair is not awaiting verification.', 'error');
        const wrap = UI.formModal('Verify & return to service · ' + UI.esc(j.plate_number), [
          { name: 'result', label: 'Operational check result', type: 'select', required: true, col: 12, placeholder: false, options: [['Passed', 'Passed: the truck is safe and operational'], ['Failed', 'Failed: the problem is not fixed']] },
          { name: 'verification_notes', label: 'What was checked (road test, engine, brakes, lights…)', type: 'textarea', required: true, col: 12 },
          { name: 'mechanic_id', label: 'Mechanic to continue the repair (if failed)', type: 'select', col: 12, options: MaintUI.mechanicOptions(j.mechanic_id), value: j.mechanic_id, placeholder: 'Same mechanic' },
          { name: 'reassignment_reason', label: 'Reason for replacing the finalized lead (if changed)', col: 12 }],
          'Maintenance.verify', { extra: { job_id: j.id }, size: '', submit: 'Save verification', after,
            intro: 'Passed returns the truck to service (Available, or Assigned if a trip is waiting). Failed sends the record back to Under Repair.' });
        const res = wrap.querySelector('[name=result]'), mc = wrap.querySelector('[name=mechanic_id]').closest('[class*=col-]');
        const reason = wrap.querySelector('[name=reassignment_reason]').closest('[class*=col-]');
        const t = () => { mc.style.display = res.value === 'Failed' ? '' : 'none'; reason.style.display = res.value === 'Failed' && +wrap.querySelector('[name=mechanic_id]').value !== +j.mechanic_id ? '' : 'none'; };
        res.onchange = t; wrap.querySelector('[name=mechanic_id]').onchange = t; t();
  },
  /** WS_DESIGN_V1: the one next workflow step offered directly on a Repair Management row (Motorpool only). */
  rowStep(j) {
    if (!MaintUI.data?.can?.act || j.status === 'Cancelled' || j.verified_at) return null;
    if (j.status === 'Reported') return j.source === 'Incident' ? ['assess', 'Assess incident', 'bi-clipboard-pulse'] : (j.findings && j.diagnosis ? ['finalize', 'Assign Mechanic Team', 'bi-people'] : ['mech', 'Assign mechanic', 'bi-person-plus']);
    if (j.status === 'Under Inspection') return j.mechanic_id ? ['inspect', 'Record findings', 'bi-search'] : ['mech', 'Assign mechanic', 'bi-person-plus'];
    if (j.status === 'Under Repair') return MaintUI.data?.motorpoolCatalogReady && !j.assignment_finalized_at ? ['finalize', 'Finalize RA', 'bi-lock'] : (+j.pending_parts_units > 0 ? ['parts-pending', 'Waiting for parts (' + j.pending_parts_units + ')', 'bi-hourglass-split'] : ['complete', 'Complete repair', 'bi-check2-circle']);
    if (j.status === 'Completed') return null; // Details are read-only after completion.
    return null;
  },
};


/* Head Management: read-only monitoring UI; Motorpool retains all repair actions. */
const HeadMaintenanceUI = {
  categories: [
    {id:'open',label:'Open records',empty:'No open maintenance records.'},
    {id:'completed',label:'Completed repairs',empty:'No completed repairs recorded.'},
    {id:'all',label:'All records',empty:'No maintenance records available.'}
  ],
  columns: [
    ['Record / Truck','job_ref',(value,row)=>'<b>'+UI.esc(value||'—')+'</b><div class="cell-sub">'+UI.esc(row.plate_number||'—')+'</div>'],
    ['Problem','problem',value=>UI.esc(value||'—')],
    ['Mechanic','mechanic',value=>UI.esc(value||'Not assigned')],
    ['Status','display_status','badge'],
    ['Reported','reported_on','date'],
    ['Completed','completed_on','date']
  ],
  exportRows(rows) {
    const cols=[['Record','job_ref'],['Truck','plate_number'],['Type','truck_type'],
      ['Problem','problem'],['Mechanic','mechanic'],['Status','display_status'],
      ['Reported','reported_on'],['Completed','completed_on']];
    const quote=value=>'"'+String(value??'').replace(/"/g,'""').replace(/^[\s\uFEFF]*[=+\-@\t\r]/,match=>"'"+match)+'"';
    const csv='\uFEFF'+[cols.map(([label])=>quote(label)).join(','),
      ...rows.map(row=>cols.map(([,key])=>quote(row[key])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;
    link.download='mulawin_maintenance_monitoring_'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  render(ctx,data,jobs) {
    const open=jobs.filter(job=>job.status!=='Cancelled'&&!job.verified_at);
    const completed=jobs.filter(job=>Boolean(job.verified_at));
    const dataByCategory={open,completed,all:jobs};
    const metrics=[
      ['Reported',open.filter(job=>job.status==='Reported').length,'bi-file-earmark-text','blue','open','New issues to assess'],
      ['Under inspection',open.filter(job=>job.status==='Under Inspection').length,'bi-search','green','open','Findings to record'],
      ['Under repair',open.filter(job=>job.status==='Under Repair').length,'bi-tools','amber','open','Corrective work in progress'],
      ['Awaiting verification',open.filter(job=>job.status==='Completed').length,'bi-calendar-check','purple','open','Awaiting service check']
    ];
    ctx.el.innerHTML='<section class="head-maintenance-workspace">'
      +'<div class="head-trip-kpis">'+metrics.map(([label,value,icon,tone,tab,note])=>
        '<button type="button" class="head-kpi head-fleet-kpi '+tone+'" data-head-maintenance-kpi="'+tab+'">'
        +'<span class="head-kpi-icon"><i class="bi '+icon+'" aria-hidden="true"></i></span>'
        +'<span class="head-fleet-kpi-value"><span>'+UI.esc(label)+'</span><strong>'+value+'</strong><small class="head-kpi-note">'+UI.esc(note)+'</small></span></button>').join('')+'</div>'
      +'<div data-head-maintenance-workspace></div></section>';
    const root=ctx.el.querySelector('[data-head-maintenance-workspace]');
    const state={category:'open',status:'',sort:'default'};
    const renderCategory=()=>{
      const category=this.categories.find(c=>c.id===state.category)||this.categories[0];
      const rows=dataByCategory[category.id];
      const statuses=[...new Set(rows.map(job=>job.display_status).filter(Boolean))].sort();
      const filterId='head-maintenance-filter',sortId='head-maintenance-sort';
      const toolbar='<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="'+filterId+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter</button>'
        +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" aria-controls="'+sortId+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
        +'<div class="record-workspace-popovers">'
        +'<div class="record-workspace-popover" id="'+filterId+'" hidden><strong>Filter maintenance records</strong>'
        +'<label>Status<select class="form-select form-select-sm" data-head-maintenance-status>'
        +'<option value="">All statuses</option>'+statuses.map(status=>'<option value="'+UI.esc(status)+'">'+UI.esc(status)+'</option>').join('')
        +'</select></label><div class="record-workspace-popover-actions">'
        +'<button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
        +'<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
        +'<div class="record-workspace-popover record-workspace-sort-panel" id="'+sortId+'" hidden>'
        +'<strong>Sort maintenance records</strong>'
        +'<label class="record-workspace-sort-option"><input type="radio" name="head_maintenance_sort" value="default" data-record-sort checked> Default order</label>'
        +'<label class="record-workspace-sort-option"><input type="radio" name="head_maintenance_sort" value="asc" data-record-sort> Record A–Z</label>'
        +'<label class="record-workspace-sort-option"><input type="radio" name="head_maintenance_sort" value="desc" data-record-sort> Record Z–A</label>'
        +'</div></div>'
        +'<button type="button" class="btn btn-sm btn-outline-success record-workspace-add" data-head-maintenance-export><i class="bi bi-download" aria-hidden="true"></i> Export</button>';
      const table=UI.table(this.columns,rows,{
        tools:toolbar,showAllColumns:true,viewSwitch:false,empty:category.empty,
        actions:()=>UI.btn('view','View details','outline-primary'),
        onAction:(_,job)=>MaintUI.open(job.id),
        rowClick:job=>MaintUI.open(job.id)
      });
      root.innerHTML=RecordComponents.panel(table,RecordComponents.categories(
        this.categories.map(item=>({value:item.id,label:item.label})),category.id,'data-head-maintenance-category'));
      UI.activate(root);
      RecordComponents.mountPanel(root,{title:'Maintenance Records',addSelector:'.record-workspace-add'});
      const tbody=root.querySelector('[data-tbody]'),id=tbody?.dataset.tbody;
      const tableState=id?UI._tables[id]:null;
      if(!tableState)return;
      const statusSelect=root.querySelector('[data-head-maintenance-status]');
      const search=root.querySelector('[data-tsearch]');
      const original=rows.slice();
      let visible=rows.slice();
      statusSelect.value=state.status;
      const selectedSort=root.querySelector('[data-record-sort][value="'+state.sort+'"]');
      if(selectedSort)selectedSort.checked=true;
      const draw=()=>{
        const term=(search?.value||'').trim().toLocaleLowerCase();
        visible=original.filter(job=>(!state.status||job.display_status===state.status)
          &&(!term||['job_ref','plate_number','truck_type','problem','mechanic','display_status','reported_on','completed_on']
            .some(key=>String(job[key]??'').toLocaleLowerCase().includes(term))));
        if(state.sort!=='default')visible.sort((a,b)=>(state.sort==='asc'?1:-1)
          *String(a.job_ref??'').localeCompare(String(b.job_ref??''),undefined,{numeric:true}));
        tableState.rows=visible;
        tableState.filter='';
        tableState.page=0;
        UI.drawTable(id);
        // Only the Head Management view needs headers and pager for an empty table.
        if(typeof HeadOversight!=='undefined')HeadOversight.finishTable(root);
      };
      search?.addEventListener('input',draw);
      RecordComponents.bindDropdowns(root,{
        apply:panel=>{
          state.status=panel.querySelector('[data-head-maintenance-status]').value;
          draw();
          root.querySelector('.record-workspace-filter-trigger')?.click();
        },
        reset:()=>{
          state.status='';
          statusSelect.value='';
          draw();
          root.querySelector('.record-workspace-filter-trigger')?.click();
        },
        sort:value=>{state.sort=value;draw();}
      },{filter:filterId,sort:sortId});
      root.querySelectorAll('[data-head-maintenance-category]').forEach(button=>button.addEventListener('click',()=>{
        if(state.category===button.dataset.headMaintenanceCategory)return;
        state.category=button.dataset.headMaintenanceCategory;
        state.status='';
        state.sort='default';
        renderCategory();
      }));
      root.querySelector('[data-head-maintenance-export]')?.addEventListener('click',()=>this.exportRows(visible));
      draw();
    };
    ctx.el.querySelectorAll('[data-head-maintenance-kpi]').forEach(button=>button.addEventListener('click',()=>{
      state.category=button.dataset.headMaintenanceKpi;
      state.status='';
      state.sort='default';
      renderCategory();
    }));
    renderCategory();
    if(Object.keys(data._errors||{}).length)
      UI.toast('Some maintenance records could not be loaded. Check server logs.','error');
  }
};

App.page('maintenance', {
  title: 'Repair Management',
  subtitle: 'Track repairs, assign mechanics, and verify completed work.',
  render(ctx) {
    const d = MaintUI.data = ctx.data;
    if (App.me?.user?.role === 'admin') {
      const jobs=(d.jobs||[]).map(j=>({...j,display_status:j.verified_at?'Returned to service':j.status==='Completed'?'Awaiting verification':j.status}));
      HeadMaintenanceUI.render(ctx,d,jobs);
      return;
    }
    // MOTORPOOL_WORKSPACE_PHASE1: the former "Parts requests" tab is now its own page. Old links / remembered tab go there.
    try {
      if (d.can.act && sessionStorage.getItem('tab:maintenance') === 'parts') {
        sessionStorage.removeItem('tab:maintenance');
        if (UI.canGo('mp_parts_requests')) return App.go('mp_parts_requests');
      }
    } catch { /* storage unavailable: stay on Repair Management */ }
    // Garage problems may be reported here or from the Motorpool Dashboard; no trip is required.
    const q = ctx.query;
    const jobs = d.jobs.map(j => ({ ...j, display_status: j.verified_at ? 'Returned to service' : (j.status === 'Completed' ? 'Awaiting verification' : j.status) }));
    // STAGE_A_MOTORPOOL_UI: filters (truck, source, mechanic, stage). Field names = URL keys, so a filter survives a reload and can be linked.
    const view = MaintUI.VIEWS[q.view];
    // MOTORPOOL_REPORTS_V2: ?from= / ?to= (date reported) so report drill-downs open exactly the period's repairs.
    const match = (j) => (!q.vehicle_id || String(j.vehicle_id) === String(q.vehicle_id)) && (!q.source || j.source === q.source)
      && (!q.mechanic_id || String(j.mechanic_id) === String(q.mechanic_id))
      && (!q.from || String(j.reported_on).slice(0, 10) >= q.from) && (!q.to || String(j.reported_on).slice(0, 10) <= q.to)
      && (q.cancelled !== '0' || j.status !== 'Cancelled');   // ?cancelled=0: same population as the report counts
    const shownJobs = jobs.filter(match);
    const open = shownJobs.filter(j => !['Cancelled'].includes(j.status) && !j.verified_at);
    const by = (s) => open.filter(j => j.status === s);
    const reported = by('Reported'), inspection = by('Under Inspection'), repair = by('Under Repair'), verify = by('Completed');
    const done = shownJobs.filter(j => j.verified_at);
    const trucks = (d.trucks || []).map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]);
    const mechs = (d.mechanics || []).map(m => [m.id, m.full_name + ' · ' + m.mechanic_code]);
    // UI_REFERENCE_V1: the stage is chosen with status tabs (?view=); the filter modal keeps truck, mechanic and source.
    const filters = [
      { name: 'vehicle_id', label: 'Truck', type: 'select', col: 6, options: trucks },
      { name: 'mechanic_id', label: 'Mechanic', type: 'select', col: 6, options: mechs },
      { name: 'source', label: 'Source', type: 'select', col: 12, options: [['On-Premise', 'Garage report / arrival checklist'], ['Incident', 'Trip incident']] },
      { name: 'from', label: 'Reported from', type: 'date', col: 6 }, { name: 'to', label: 'Reported to', type: 'date', col: 6 },
    ];
    const active = ['vehicle_id', 'mechanic_id', 'source', 'from', 'to', 'cancelled'].filter(k => q[k]);
    // MOTORPOOL_COMPACT_TABS_V6: Three primary tabs; preserve deep-link stages as contextual tabs only.
    const TABS = [['', 'Active', reported.length + inspection.length + repair.length],
      ['verify', 'For Verification', verify.length], ['done', 'Completed', done.length]];
    const EXTRA = { reported: ['Reported', reported.length], inspection: ['Inspection', inspection.length],
      repair: ['Under Repair', repair.length], in_progress: ['Inspection or repair', inspection.length + repair.length],
      all: ['All', shownJobs.length] };
    if (Object.prototype.hasOwnProperty.call(EXTRA, q.view)) TABS.push([q.view, ...EXTRA[q.view]]);
    const tab = TABS.some(t => t[0] === (q.view || '')) ? (q.view || '') : '';
    const stageTiles = [
      ['Reported', reported.length, 'bi-exclamation-circle', 'maintenance?view=reported', 'New issue to assess', 'gray'],
      ['Inspection', inspection.length, 'bi-search', 'maintenance?view=inspection', 'Record findings', 'blue'],
      ['Under Repair', repair.length, 'bi-wrench-adjustable', 'maintenance?view=repair', 'Complete corrective work', 'amber'],
      ['Verify', verify.length, 'bi-shield-check', 'maintenance?view=verify', 'Return to service check', 'purple']
    ];
    // Stage shortcuts stay clickable without duplicating the page's full KPI-card row.
    const stageSummary = `<div class="mp-action-stages mp-reference-stages mb-3" role="group" aria-label="Repair stage shortcuts">${stageTiles.map(([name, count, icon, go, hint]) =>
      `<button type="button" class="mp-action-stage" data-go="${UI.esc(go)}" title="${UI.esc(hint)}">
        <span class="mp-action-stage-icon"><i class="bi ${icon}" aria-hidden="true"></i></span>
        <span class="mp-action-stage-content"><b>${UI.esc(name)}</b><small>${UI.esc(hint)}</small></span>
        <strong class="mp-action-stage-count">${UI.num(count)}</strong></button>`).join('')}</div>`;
    ctx.el.innerHTML = '<div class="mp-wireframe-marker" hidden></div>' + stageSummary
      + `<section class="panel mb-3 mp-wireframe-flow"><div class="panel-body py-2 px-3">
       <div class="d-flex flex-wrap align-items-center justify-content-between gap-3">
         <div class="d-flex flex-wrap align-items-center gap-2 small">
           <strong class="me-1"><i class="bi bi-tools me-1" aria-hidden="true"></i>Repair process</strong>
           <span>Report</span><i class="bi bi-chevron-right text-muted" aria-hidden="true"></i>
           <span>Inspect &amp; repair</span><i class="bi bi-chevron-right text-muted" aria-hidden="true"></i>
           <span>Verify</span>
         </div>
         <div class="d-flex flex-column align-items-end gap-2 ms-auto">
           <span class="text-muted small">Select a record to view details and its next action.</span>
           ${d.can.act ? '<button type="button" class="btn btn-sm btn-primary" data-qa="report"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i> Report truck problem</button>' : ''}
         </div>
       </div></div></section>`
       + UI.statusTabs('maintenance', q, 'view', TABS, tab)
       + UI.filterModal(ctx, filters, { hint: 'All trucks, mechanics and sources.' });
    const waited = (j) => { const days = Math.max(0, Math.floor((Date.now() - new Date(String(j.reported_on) + 'T00:00:00').getTime()) / 86400000));
      return days === 0 ? '<span class="text-muted">today</span>' : `<span class="${days >= 7 ? 'text-danger fw-semibold' : ''}">${days} day${days === 1 ? '' : 's'}</span>`; };
    const cols = [['Record', 'job_ref', (v, j) => `<b>${UI.esc(v)}</b><div class="cell-sub">${j.source === 'Incident' ? 'Incident ' + UI.esc(j.incident_ref || '') : (j.trip_ref ? 'Checklist / garage ' + UI.esc(j.trip_ref) : 'Garage report')}</div>`],
      ['Truck', 'plate_number', (v, j) => `${UI.esc(v)}<div class="cell-sub">${UI.esc(j.truck_type)}</div>`],
      ['Problem', 'problem', (v) => `<span class="cell-clip">${UI.esc(v)}</span>`],
      ['Mechanic', 'mechanic', (v, j) => { const n = (d.helpers || []).filter(h => +h.job_id === +j.id).length; return v ? UI.esc(v) + (n ? ` <span class="badge-s blue" title="${n} assisting mechanic(s)">+${n}</span>` : '') : '<span class="text-muted">Not assigned</span>'; }],
      ['Status', 'display_status', 'badge'], ['Date reported', 'reported_on', 'date']];
    // Open records: "Waiting" (days since reported) instead of the date column; all six columns stay visible.
    const openCols = [...cols.slice(0, 5), ['Waiting', 'reported_on', (v, j) => waited(j)]];
    // WS_DESIGN_V1: direct row actions: the next workflow step, Request parts while the repair is active, and Open.
    const opt = { directActions: true, showAllColumns: true, limit: 10, groupBy: 'display_status', groupLabel: 'Repair status',
      actions: (j) => { const st = MaintUI.rowStep(j);
        return (tab === 'verify' && j.status === 'Completed' && !j.verified_at && d.can.act
            ? UI.btn('verify', 'Verify', 'primary') : '')
          + (st ? st[0] === 'parts-pending' ? `<span class="badge-s amber" title="Complete Purchasing release before finishing repair">${UI.esc(st[1])}</span>` : `<button type="button" class="btn btn-sm btn-outline-primary mp-repair-step-btn" data-act="step:${UI.esc(st[0])}">${UI.esc(st[1])}</button>` : '')
          + (d.can.act && !d.motorpoolCatalogReady && d.helpersReady && j.mechanic_id && MaintUI.ACTIVE.includes(j.status) ? UI.btn('helpers', 'Add mechanics', 'outline-secondary') : '')
          + (d.can.act && ['Under Inspection', 'Under Repair'].includes(j.status) && (!d.motorpoolCatalogReady || j.assignment_finalized_at) ? UI.btn('parts', 'Request parts', 'outline-secondary') : '')
          + UI.btn('view', 'Details', 'outline-primary'); },
      onAction: (a, j) => a === 'verify' ? MaintUI.verifyForm(j, () => App.route())
        : a === 'parts' ? MaintUI.requestParts(j.vehicle_id, j.id)
        : MaintUI.open(j.id, a === 'helpers' ? 'helpers' : a.startsWith('step:') ? a.slice(5) : undefined),
      rowClick: (j) => MaintUI.open(j.id) };
    const box = document.createElement('div'); ctx.el.append(box);
    const label = TABS.find(t => t[0] === tab)[1];
    box.classList.add('mp-reference-table', 'mp-ops-table', 'mp-repair-records-table');
    box.insertAdjacentHTML('afterbegin', `<div class="mp-records-heading"><div><strong>Repair Records</strong><small>${UI.num(shownJobs.length)} matching record${shownJobs.length === 1 ? '' : 's'}</small></div><small>Truck maintenance and verification</small></div>`);
    const tableBody = document.createElement('div'); box.append(tableBody);
    if (tab === 'done') tableBody.innerHTML = UI.table([...cols.slice(0, 4), ['Completion date', 'completed_on', 'date'], ['Returned to service', 'verified_at', 'datetime']], done, { ...opt, title: label + ' (' + done.length + ')', empty: 'No completed repairs yet.' });
    else if (tab === 'all') tableBody.innerHTML = UI.table(cols, shownJobs, { ...opt, title: label + ' (' + shownJobs.length + ')', empty: 'No record matches these filters.' });
    else { const rows = view ? open.filter(view[1]) : open.filter(j => j.status !== 'Completed');
      tableBody.innerHTML = UI.table(openCols, rows, { ...opt, title: label + ' (' + rows.length + ')', empty: active.length || view ? 'No open record matches.' : 'No truck has an open repair. Report a problem when a truck needs inspection or repair.' }); }
    if (typeof RecordComponents !== 'undefined') RecordComponents.maintenanceWorkspace(ctx.el, {box:'.mp-repair-records-table',actions:[ctx.el.querySelector('[data-qa="report"]')]});
    ctx.el.querySelector('[data-qa="report"]')?.addEventListener('click', () => MaintUI.report());
    const once = UI.takeQuery(ctx, 'report', 'open');
    if (once.report) MaintUI.report(once.report === 'new' ? undefined : once.report);
    if (once.open) MaintUI.open(once.open);
  },
});

/* MOTORPOOL_WORKSPACE_PHASE1 — Parts Requests (Motorpool Custodian).
   Data: Purchasing::read('mp_parts_requests') — the department's requests, status counts, and what the
   Request parts form needs (trucks, open repairs). No costs, stock counts, budget, supplier or purchase-order data.
   Actions (existing, server-checked): Purchasing.request_create (form), Purchasing.request_details (Details),
   Purchasing.request_cancel (only while Requested). Releasing stock stays with the Purchasing Officer.
   URL filter: ?status=<key> with key = open | requested | partially_released | not_available | released | cancelled,
   ?vehicle_id=<truck id>. Every card, link and the filter modal use these same keys. */
const MpParts = {
  /** URL key -> database status. 'open' = still waiting for parts. */
  STATUS: { requested: 'Requested', partially_released: 'Partially Released', not_available: 'Not Available', released: 'Released', cancelled: 'Cancelled' },
  OPEN: ['Requested', 'Partially Released', 'Not Available'],
  match(r, key) {
    if (!key) return true;
    return key === 'open' ? MpParts.OPEN.includes(r.status) : r.status === MpParts.STATUS[key];
  },
  nextStep(r) {
    // MOTORPOOL_UI_V2: order state for open requests (from Purchasing records; no supplier or cost shown).
    if (MpParts.OPEN.includes(r.status) && r.last_received_at && (!r.last_released_at || r.last_received_at > r.last_released_at))
      return 'Some linked PO parts were physically received on ' + UI.date(r.last_received_at) + '. Waiting for Purchasing release.';
    if (MpParts.OPEN.includes(r.status) && +r.on_order) return 'Ordered by Purchasing. Waiting for delivery.';
    return {
      'Requested': 'Waiting for the Purchasing Officer to check the stock and release.',
      'Partially Released': 'Part of the items were released; the rest waits for stock.',
      'Not Available': 'No stock. Follow up with the Purchasing Officer.',
      'Released': 'All items released.',
      'Cancelled': 'Cancelled; it will not be processed.',
    }[r.status] || '';
  },
};

App.page('mp_parts_requests', {
  title: 'Parts Requests',
  subtitle: 'View parts request records, statuses, and release history. New requests are created from repair actions.',
  render(ctx) {
    const d = MaintUI.data = ctx.data, q = ctx.query, can = d.can || {};
    const trucks = Array.isArray(d.trucks) ? d.trucks : [];
    const rows = (Array.isArray(d.requests) ? d.requests : []).map(r => ({ ...r,
      progress: `${UI.num(+r.released_units)} of ${UI.num(+r.requested_units)} released`, next: MpParts.nextStep(r) }));
    // UI_REFERENCE_V1: status tabs (?status=) + truck filter; no KPI row on the list page (the tabs carry the counts).
    // Keys: '' / 'open' = still waiting for parts, 'all', or one MpParts.STATUS key.
    const key = q.status === 'all' || MpParts.STATUS[q.status] ? q.status : 'open';
    const truck = q.vehicle_id ? String(q.vehicle_id) : '';
    // MOTORPOOL_REPORTS_V2: ?from= / ?to= (request date) for drill-downs from Maintenance Reports.
    const byTruck = rows.filter(r => (!truck || String(r.vehicle_id) === truck)
      && (!q.from || String(r.created_at).slice(0, 10) >= q.from) && (!q.to || String(r.created_at).slice(0, 10) <= q.to));
    const inTab = (k) => byTruck.filter(r => k === 'all' || MpParts.match(r, k));
    const shown = inTab(key);
    const mainTabs = [['open', 'Open'], ['released', 'Released'], ['all', 'All']];
    // Keep deep links for Requested / Partially Released / Not Available / Cancelled accessible.
    if (!mainTabs.some(([k]) => k === key)) mainTabs.splice(1, 0, [key, MpParts.STATUS[key]]);
    const TABS = mainTabs.map(([k, l]) => [k, l, inTab(k).length]);
    const truckOptions = trucks.map(v => [v.id, v.plate_number + (v.truck_number ? ' #' + v.truck_number : '')]);
    const waiting = byTruck.filter(r => MpParts.OPEN.includes(r.status));
    const pendingQty = waiting.reduce((sum, r) => sum + Math.max(0, (+r.requested_units || 0) - (+r.released_units || 0)), 0);
    const partSummary = `<div class="mp-action-stages mp-parts-summary mp-reference-stages mb-3">
      <button type="button" class="mp-action-stage" data-go="mp_parts_requests?status=open"><span class="mp-action-stage-icon"><i class="bi bi-hourglass-split"></i></span><span class="mp-action-stage-content"><b>Open requests</b><small>Waiting on Purchasing</small></span><strong class="mp-action-stage-count">${waiting.length}</strong></button>
      <div class="mp-action-stage"><span class="mp-action-stage-icon"><i class="bi bi-box-seam"></i></span><span class="mp-action-stage-content"><b>Units still needed</b><small>Requested minus released</small></span><strong class="mp-action-stage-count">${UI.num(pendingQty)}</strong></div>
      <button type="button" class="mp-action-stage" data-go="mp_parts_requests?status=released"><span class="mp-action-stage-icon"><i class="bi bi-check-circle"></i></span><span class="mp-action-stage-content"><b>Released requests</b><small>Items provided by Purchasing</small></span><strong class="mp-action-stage-count">${inTab('released').length}</strong></button>
      </div>`;
    ctx.el.innerHTML = '<div class="mp-wireframe-marker" hidden></div>' + partSummary + UI.statusTabs('mp_parts_requests', { ...q, status: key }, 'status', TABS, key)
      + UI.filterModal(ctx, [{ name: 'vehicle_id', label: 'Truck', type: 'select', col: 12, options: truckOptions },
        { name: 'from', label: 'Requested from', type: 'date', col: 6 }, { name: 'to', label: 'Requested to', type: 'date', col: 6 }], { hint: 'All trucks and dates.' });

    const cols = [
      ['Request', 'request_ref', (v, r) => `<b>${UI.esc(v)}</b><div class="cell-sub">${UI.date(r.created_at)}</div>`],
      ['Truck / repair', 'plate_number', (v, r) => `${UI.esc(v)}${r.job_ref ? `<div class="cell-sub">${UI.esc(r.job_ref)}</div>` : ''}`],
      ['Items', 'items', (v) => `<span class="cell-clip">${UI.esc(v || '')}</span>`],
      ['Progress', 'progress'],
      ['Reserved', 'reserved_units', (v) => UI.num(v || 0)],
      ['Last released', 'last_released_at', (v) => v ? UI.datetime(v) : '<span class="text-muted">Not yet</span>'],
      ['Status', 'status', 'badge'],
      ['Next step', 'next', (v) => `<span class="cell-clamp">${UI.esc(v)}</span>`],
    ];
    const cancel = (r) => UI.confirmAction('Cancel ' + UI.esc(r.request_ref), 'The request will not be processed by Purchasing.',
      'Purchasing.request_cancel', { request_id: r.id }, { danger: true, submit: 'Cancel request' });
    const opt = { directActions: true, showAllColumns: true, limit: 10, groupBy: 'status', groupLabel: 'Request status',
      actions: (r) => (r.status === 'Requested' && can.act ? UI.ibtn('cancel', 'Cancel request', 'bi-x-lg', 'outline-danger') : '') + UI.btn('view', 'Details', 'outline-primary'),
      onAction: (a, r) => (a === 'cancel' ? cancel(r) : MaintUI.openRequest(r)),
      rowClick: (r) => MaintUI.openRequest(r),
    };
    const box = document.createElement('div');
    ctx.el.append(box);
    box.classList.add('mp-reference-table', 'mp-ops-table', 'mp-parts-records-table');
    box.innerHTML = `<div class="mp-records-heading"><div><strong>Parts Request Records</strong><small>${UI.num(shown.length)} matching request${shown.length === 1 ? '' : 's'}</small></div><small>Requested items and release progress</small></div>` + UI.table(cols, shown, { ...opt, title: TABS.find(t => t[0] === key)[1] + ' (' + shown.length + ')',
      empty: rows.length ? 'No parts request in this list.' : 'No parts requests yet. Use Request parts on a repair record.' });
    if (typeof RecordComponents !== 'undefined') RecordComponents.maintenanceWorkspace(ctx.el, {box:'.mp-parts-records-table'});
    const once = UI.takeQuery(ctx, 'open');
    if (once.open) {
      const r = rows.find(x => String(x.id) === String(once.open));
      if (r) MaintUI.openRequest(r);
    }
  },
});

/* MAINTENANCE_OVERVIEW_PHASE1_V1 — Maintenance Overview (landing page for the Motorpool Custodian).
   Read-only: every number and row comes from Maintenance::read('maintenance_overview').
   Actions reuse the existing screens: Report a truck problem (MaintUI.report), Repair Management
   (#maintenance, with ?view= filters and ?open=<id>), Parts requests (Repair Management > Parts requests; Parts Requests page for Admin / Audit). */
const MaintOverview = {
  ACTIONS: {
    assess: 'Assess the incident (Minor or Major)',
    assign: 'Assign a mechanic',
    verify: 'Verify and return to service',
    parts_follow_up: 'Parts not available: follow up with Purchasing',
  },
  statusOf(r) {
    if (r.kind === 'parts') return r.status;
    return r.status === 'Completed' ? 'Awaiting verification' : r.status;
  },
  truck(r) { return `<b>${UI.esc(r.plate_number)}</b>${r.truck_number ? ` <span class="text-muted">#${UI.esc(r.truck_number)}</span>` : ''}`; },
  attentionItem(r, can) {
    const ref = r.kind === 'parts' ? [r.request_ref, r.job_ref].filter(Boolean).join(' · ') : r.job_ref;
    const tag = r.source === 'Incident' && r.kind === 'job' ? `<span class="mo-tag">Trip incident${r.incident_ref ? ' ' + UI.esc(r.incident_ref) : ''}</span>` : '';
    const viewBtn = r.job_id
      ? `<button type="button" class="btn btn-sm btn-outline-primary" data-open-job="${+r.job_id}">View repair</button>`
      : (can.parts ? `<button type="button" class="btn btn-sm btn-outline-primary" data-go="${can.requestParts ? 'mp_parts_requests?status=not_available' : 'parts_requests'}">View request</button>` : '');
    // MOTORPOOL_UI_V2: the button names the next step; it opens the record where that action is done.
    const step = { assess: 'Assess', assign: 'Assign mechanic', verify: 'Verify' }[r.next_action];
    const actBtn = r.job_id && step ? `<button type="button" class="btn btn-sm btn-primary" data-open-job="${+r.job_id}">${step}</button>` : viewBtn;
    return `<li class="mo-item">
      <div class="mo-item-main">
        <div class="mo-item-top">${MaintOverview.truck(r)} <span class="mo-ref">${UI.esc(ref)}</span> ${tag}</div>
        <div class="mo-item-issue" title="${UI.esc(r.issue)}">${UI.esc(r.issue)}</div>
        <div class="mo-item-next"><i class="bi bi-arrow-right-circle"></i> ${UI.esc(MaintOverview.ACTIONS[r.next_action] || 'Open the record')}
          <span class="mo-since">· waiting since ${UI.datetime(r.since)}</span></div>
      </div>
      <div class="mo-item-side">${UI.badge(MaintOverview.statusOf(r))}${actBtn}</div></li>`;
  },
  activityItem(e) {
    const what = [e.job_ref || e.request_ref, e.plate_number].filter(Boolean).map(UI.esc).join(' · ');
    const extra = e.kind === 'parts_released' || e.kind === 'parts_requested' ? (e.units ? `${UI.num(+e.units)} unit(s)` : '') : (e.mechanic ? 'Mechanic: ' + UI.esc(e.mechanic) : '');
    const open = e.job_id ? ` data-open-job="${+e.job_id}" role="button" tabindex="0"` : '';
    return `<li class="mo-act${e.job_id ? ' clickable' : ''}"${open}>
      <div class="mo-act-label">${UI.esc(e.label)}</div>
      <div class="mo-act-what">${what}${extra ? ' · ' + extra : ''}</div>
      ${e.details && e.kind === 'job' ? `<div class="mo-act-details">${UI.esc(e.details)}</div>` : ''}
      <div class="mo-act-when">${UI.datetime(e.at)} · ${UI.esc(e.actor || 'System')}</div></li>`;
  },
};

App.page('maintenance_overview', {
  title: 'Maintenance Overview',
  subtitle: 'Monitor repairs, mechanics and trucks in service.',
  render(ctx) {
    const d = MaintUI.data = ctx.data, can = d.can || {};
    const s = Array.isArray(d.summary) ? null : d.summary;   // a failed read section comes back as []

    const n = (k) => s ? +s[k] || 0 : '—';
    // MOTORPOOL_UI_V2 Dashboard: Fleet status · To do now · Long-running repairs · Mechanics · Parts requests · This month.
    const crew = d.crew && !Array.isArray(d.crew) ? d.crew : null;
    const fs = d.fleetStatus && !Array.isArray(d.fleetStatus) ? d.fleetStatus : null;
    const m = d.month && !Array.isArray(d.month) ? d.month : null;
    const failed = d._errors || {};
    const fv = (k) => fs ? fs[k] : '—';
    // MOTORPOOL_UI_V2: Admin KPI cards (head-kpi). Each card opens the matching truck list or repair view.
    const tiles = [
      ['Available', fv('available'), 'bi-check-circle', 'blue', 'trucks?status=Available', 'Ready for dispatch'],
      ['On Trip', fv('on_trip'), 'bi-signpost-split', 'purple', 'trucks?status=On Trip', 'Currently on a trip'],
      ['Under Maintenance', fv('under_maintenance'), 'bi-wrench-adjustable', 'red', 'trucks?status=Under Maintenance', 'Inspection or repair'],
      ['For Verification', n('for_verification'), 'bi-clipboard-check', 'green', 'maintenance?view=verify', 'Return-to-service check'],
    ];
    const kpis = '<div class="head-trip-kpis head-fleet-kpis">' + tiles.map(([label, value, icon, tone, go, note]) =>
      `<button type="button" class="head-kpi head-fleet-kpi ${tone}"${UI.canGo(go) ? ` data-go="${UI.esc(go)}"` : ' disabled'} aria-label="View ${UI.esc(label)}">`
      + `<span class="head-kpi-icon"><i class="bi ${icon}" aria-hidden="true"></i></span>`
      + `<span class="head-fleet-kpi-value"><span>${UI.esc(label)}</span><strong>${UI.esc(String(value))}</strong><small class="head-kpi-note">${UI.esc(note)}</small></span></button>`).join('')
      + '</div>' + (fs && fs.assigned ? `<p class="small text-muted mt-1 mb-2">${UI.num(fs.assigned)} more truck(s) are reserved for an upcoming trip.</p>` : '');
    const att = Array.isArray(d.attention) ? d.attention : [];
    const lim = (d.limits && d.limits.attention) || 25;
    // Record queues get independent pages, not nested scrollbars.
    // Preserve server list limits and the existing click-to-open handlers.
    const queueSize = 4;
    const queuePager = (entries, kind, className) => {
      if (!entries.length) return '';
      // Match Purchasing: short queues display as plain lists, no pointless 1/1 pager.
      if (entries.length <= queueSize) return `<ul class="${className}">${entries.join('')}</ul>`;
      const pages = Math.max(1, Math.ceil(entries.length / queueSize));
      return `<div class="mp-dashboard-paged" data-mp-dashboard-paged="${kind}">
        <ul class="${className} mp-dashboard-page-list">${entries.map((html, index) =>
          html.replace('<li ', `<li data-mp-page-index="${index}" `)).join('')}</ul>
        <div class="mp-dashboard-page-footer no-print">
          <span data-mp-page-range>Showing 1–${Math.min(queueSize,entries.length)} of ${entries.length}</span>
          <span class="mp-dashboard-page-controls">
            <button type="button" data-mp-page-prev disabled>Previous</button>
            <span data-mp-page-label>Page 1 of ${pages}</span>
            <button type="button" data-mp-page-next ${pages === 1 ? 'disabled' : ''}>Next</button>
          </span>
        </div>
      </div>`;
    };
    const todoBody = failed.attention ? '<div class="mo-empty text-danger">The list could not be loaded. Reload the page.</div>'
      : att.length ? queuePager(att.slice(0, lim).map(r => MaintOverview.attentionItem(r, can)), 'attention', 'mo-list')
        + (att.length > lim ? `<div class="mo-more">Showing the ${lim} records waiting the longest. <a href="#maintenance">Open Repairs</a> for the rest.</div>` : '')
      : '<div class="mo-empty"><i class="bi bi-check2-circle"></i> Nothing needs your action right now.</div>';
    const stale = Array.isArray(d.stale) ? d.stale : [];
    const staleBody = stale.length ? queuePager(stale.map(t => `<li class="clickable" data-open-job="${+t.job_id}" role="button" tabindex="0">
        <div><b>${UI.esc(t.plate_number)}</b> <span class="text-muted">${UI.esc(t.job_ref)}</span><div class="cell-sub">${UI.esc(t.mechanic || 'No mechanic yet')}</div></div>
        <div class="text-end"><span class="${+t.days >= 7 ? 'text-danger fw-semibold' : ''}">${UI.num(+t.days)} days</span><div>${UI.badge(t.status)}</div></div></li>`), 'long-running', 'ws-trucks')
      : '<div class="mo-empty"><i class="bi bi-check2-circle"></i> No repair has been open for 3 days or more.</div>';
    const crewBody = !crew ? '' : crew.active ? UI.wsList([
        UI.wsEntry('mechanic_attendance?duty=in', '<b>Available</b>', 'Timed in, no current repair', `<span class="badge-s green">${UI.num(crew.available)}</span>`),
        UI.wsEntry('mechanics?availability=Assigned', '<b>On a repair</b>', 'Assigned to an open repair', `<span class="badge-s blue">${UI.num(crew.assigned)}</span>`),
        UI.wsEntry('mechanic_attendance', '<b>Not timed in</b>', 'Time In first before assigning', `<span class="badge-s ${crew.unavailable ? 'amber' : 'gray'}">${UI.num(crew.unavailable)}</span>`)], '')
      : '<div class="mo-empty">No active mechanics. Add them in Mechanics.</div>';
    const partsBody = can.parts && s ? UI.wsList([
        UI.wsEntry('mp_parts_requests?status=open', '<b>Waiting for release</b>', 'Sent to Purchasing', `<span class="badge-s amber">${UI.num(n('parts_requested'))}</span>`),
        UI.wsEntry('mp_parts_requests?status=open', '<b>Partially released</b>', 'Some items still missing', `<span class="badge-s blue">${UI.num(n('parts_partially_released'))}</span>`),
        UI.wsEntry('mp_parts_requests?status=not_available', '<b>Not available</b>', 'Purchasing must order them', `<span class="badge-s ${att.some(r => r.kind === 'parts') ? 'red' : 'gray'}">${UI.num(att.filter(r => r.kind === 'parts').length)}</span>`)], '') : '';
    const monthBody = m ? UI.kv([['Repairs completed', UI.num(m.completed)], ['Average repair time', m.avg_days === null ? '—' : UI.esc(String(m.avg_days)) + ' days'],
        ['Maintenance cost', UI.money(m.cost) + ' <span class="cell-sub">parts used + labor/services</span>']]) : '<div class="mo-empty">Not available.</div>';

    ctx.el.innerHTML = `<div class="maint-overview mp-ws mp-wireframe-dashboard">
      ${kpis}
      ${UI.quickBar([
        can.act ? { label: 'Report truck problem', icon: 'bi-plus-lg', act: 'report', primary: true } : null,
        { label: 'Open repairs', icon: 'bi-wrench-adjustable', go: 'maintenance' },
        can.parts ? { label: 'Parts requests', icon: 'bi-box-seam', go: 'mp_parts_requests' } : null,
        { label: 'Mechanic attendance', icon: 'bi-clock-history', go: 'mechanic_attendance' }
      ])}
      <div class="mp-wireframe-layout mp-content-columns">
        <div class="mp-content-column">
          ${UI.wsPanel('To do now', 'bi-flag', todoBody, { cls: 'mo-attention ws-l1', count: failed.attention ? undefined : att.length, go: 'maintenance' })}
          ${UI.wsPanel('Long-running repairs (3+ days)', 'bi-hourglass-split', staleBody, { cls: 'ws-l2', count: stale.length, go: 'maintenance' })}
          ${UI.wsPanel('This month', 'bi-calendar3', monthBody, { cls: 'ws-r2' })}
        </div>
        <div class="mp-content-column">
          ${crew ? UI.wsPanel('Mechanics on duty', 'bi-person-gear', crewBody, { cls: 'ws-r1', go: 'mechanic_attendance', foot: `${crew.on_duty} of ${crew.active} active mechanics are timed in.` }) : ''}
          ${partsBody ? UI.wsPanel('Parts requests', 'bi-box-seam', partsBody, { cls: 'ws-r2', go: 'mp_parts_requests' }) : ''}
        </div>
      </div></div>`;

    ctx.el.querySelectorAll('[data-mp-dashboard-paged]').forEach(pager => {
      const entries = [...pager.querySelectorAll(':scope > .mp-dashboard-page-list > [data-mp-page-index]')];
      const pages = Math.max(1, Math.ceil(entries.length / queueSize));
      let page = 1;
      const prev = pager.querySelector('[data-mp-page-prev]');
      const next = pager.querySelector('[data-mp-page-next]');
      const draw = () => {
        entries.forEach((entry,index) => {
          entry.hidden = index < (page - 1) * queueSize || index >= page * queueSize;
        });
        pager.querySelector('[data-mp-page-range]').textContent =
          'Showing ' + ((page - 1) * queueSize + 1) + '–' + Math.min(page * queueSize,entries.length) + ' of ' + entries.length;
        pager.querySelector('[data-mp-page-label]').textContent = 'Page ' + page + ' of ' + pages;
        prev.disabled = page === 1;
        next.disabled = page === pages;
      };
      prev.addEventListener('click', () => { if (page > 1) { page--; draw(); } });
      next.addEventListener('click', () => { if (page < pages) { page++; draw(); } });
      draw();
    });
    const root = ctx.el.querySelector('.maint-overview');
    UI.bindGo(root.querySelector('.head-trip-kpis'));   // MOTORPOOL_UI_V2: KPI cards open their filtered lists
    root.querySelector('[data-qa="report"]')?.addEventListener('click', () => MaintUI.report());
    root.querySelectorAll('[data-open-job]').forEach(x => {
      const go = () => App.go('maintenance', { open: x.dataset.openJob });
      x.addEventListener('click', go);
      if (x.tagName !== 'BUTTON') x.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  },
});

/* MOTORPOOL_REPORTS_V2 — Maintenance Reports & Analytics (Motorpool workspace "Reports").
   Data: Analytics::maintenanceReport (read-only SQL; metric definitions and suggestion rules are documented there).
   Row 1: Completed repairs · Ongoing repairs (now) · Trucks serviced · Maintenance cost (opens the traceable breakdown)
   Row 2: Maintenance Activity Timeline — multi-line chart; legend toggles series; a point opens a floating period popover
          (activity details + rule-based suggested actions + drill-downs). Keyboard: Left/Right choose a period, Enter opens.
   Row 3: Maintenance Expense Breakdown (donut + entries) · Repair Frequency by Truck (most / least repaired).
   Nothing on this page writes or creates records. */
const MaintReport = {
  charts: [],
  SERIES: [
    ['reported', 'Reported repairs', '#d97706', []], ['under_repair', 'Under repair', '#2563eb', []], ['completed', 'Completed repairs', '#16a34a', []],
    ['awaiting', 'Awaiting verification', '#9333ea', [6, 4]], ['parts', 'Parts requests', '#64748b', [2, 3]],
  ],
  COST_COLORS: ['#2f7d57', '#d99a1e', '#2563eb', '#9333ea', '#64748b', '#0891b2'],
  sugList(items, empty) {
    return items && items.length ? `<ul class="ws-sug">${items.map(x => `<li>${UI.esc(x.text)}${x.go && UI.canGo(x.go) ? ` <button type="button" class="btn btn-link btn-sm" data-go="${UI.esc(x.go)}">${UI.esc(x.label || 'Open')}</button>` : ''}</li>`).join('')}</ul>`
      : `<div class="ws-sug-empty">${UI.esc(empty)}</div>`;
  },
  /** Drawer with every entry behind the Maintenance Cost total (same date and inclusion rules). */
  openCost(d) {
    const c = d.cost || {}, e = d.entries || {}, per = d.period || {};
    const jobLink = (v, r) => r.job_id ? `<b>${UI.esc(v)}</b>` : UI.e(v);
    UI.drawer('Maintenance cost', `${UI.kv([['Period', UI.date(per.from) + ' – ' + UI.date(per.to)], ['Parts used', UI.money(c.parts) + ` <span class="cell-sub">${UI.num(c.parts_n)} release(s)</span>`],
        ...(c.types || []).map(t => [t.type, UI.money(t.total) + ` <span class="cell-sub">${UI.num(t.n)} entr${t.n === 1 ? 'y' : 'ies'}</span>`]), ['Total', `<b>${UI.money(c.total)}</b>`]])}
      <p class="small text-muted mt-2">Parts used = parts released to repairs, at the unit cost recorded on each release (release date). Other costs = labor and services recorded on repairs (date incurred). Purchase orders and payments are not included, so nothing is counted twice.</p>
      ${UI.h('Parts used (' + UI.num((e.parts || []).length) + ')')}${UI.table([['Released', 'at', 'datetime'], ['Repair', 'job_ref', jobLink], ['Truck', 'plate_number'], ['Request', 'request_ref'], ['Part', 'part_number'], ['Qty', 'qty', 'num'], ['Value', 'value', 'money']], e.parts || [], { plain: true, limit: 10, empty: 'No parts were released in this period.' })}
      ${UI.h('Labor and services (' + UI.num((e.costs || []).length) + ')')}${UI.table([['Date', 'at', 'date'], ['Repair', 'job_ref', jobLink], ['Truck', 'plate_number'], ['Type', 'cost_type'], ['Description', 'description'], ['Amount', 'amount', 'money']], e.costs || [], { plain: true, limit: 10, empty: 'No labor or service cost was recorded in this period.' })}`,
      { subtitle: 'Recorded entries behind the total' });
  },
};

App.page('maintenance_reports', {
  title: 'Maintenance Reports',
  subtitle: 'Repairs, maintenance activity and maintenance spending.',
  render(ctx) {
    MaintReport.charts.forEach(ch => { try { ch.destroy(); } catch { /* already gone */ } }); MaintReport.charts = [];
    const d = ctx.data, per = d.period || {}, b = d.buckets || [];
    const k = d.kpis && !Array.isArray(d.kpis) ? d.kpis : null, c = d.cost && !Array.isArray(d.cost) ? d.cost : null;
    const tl = d.timeline && !Array.isArray(d.timeline) ? d.timeline : null, sug = d.suggestions || {};
    const freq = Array.isArray(d.frequency) ? d.frequency : [];
    const unit = { day: 'day', week: 'week', month: 'month' }[per.granularity] || 'period';
    const tiles = [
      { label: 'Completed repairs', value: k ? UI.num(k.completed) : '—', note: 'completed in the period', icon: 'bi-check-circle', tone: 'gray', go: 'maint_history' },
      { label: 'Ongoing repairs', value: k ? UI.num(k.ongoing) : '—', note: k ? `now · ${UI.num(k.awaiting_verification)} awaiting verification` : 'now', icon: 'bi-tools', tone: 'gray', go: 'maintenance' },
      { label: 'Trucks serviced', value: k ? UI.num(k.trucks_serviced) : '—', note: 'trucks with a completed repair', icon: 'bi-truck-front', tone: 'gray', go: 'maint_history' },
      { label: 'Maintenance cost', value: c ? UI.money(c.total) : '—', note: 'parts used + recorded repair costs', icon: 'bi-cash-stack', tone: 'gray' },
    ];
    const series = MaintReport.SERIES.filter(([key]) => tl && Array.isArray(tl[key]));
    const notes = [];
    if (tl) (tl.omitted || []).forEach(o => notes.push(`${o.series} not shown: ${o.reason}`));
    const basis = tl ? `Reported by date reported, completed by completion date, parts requests by request date; under repair and awaiting verification show the status at the end of each ${unit}, from the recorded status history.` : '';
    const timelineBody = tl ? `<div class="mr-chart" role="group" aria-label="Maintenance activity by ${unit}"><canvas id="mrTimeline" tabindex="0"
        aria-label="Maintenance activity timeline. Use the left and right arrow keys to choose a ${unit} and Enter to open its details."></canvas></div>
        <div class="mr-note">${UI.esc(basis)} Select a point to see that ${unit}'s details.${notes.length ? '<br>' + notes.map(UI.esc).join('<br>') : ''}</div>`
      : '<div class="mo-empty text-danger">The activity timeline could not be loaded.</div>';

    // Expense breakdown: parts used + each recorded cost type. The total equals the KPI (same query results).
    const cats = c ? [{ label: 'Parts used', value: +c.parts, n: c.parts_n }, ...(c.types || []).map(t => ({ label: t.type === 'Outside Service' ? 'Outside services' : t.type, value: +t.total, n: t.n }))] : [];
    const costBody = c ? `<div class="mr-cost"><div class="mr-donut">${c.total > 0 ? '<canvas id="mrCost" aria-label="Maintenance expense breakdown"></canvas>' : ''}
        <div class="mr-donut-total"><span>Total</span><b>${UI.money(c.total)}</b></div></div>
        <ul class="mr-legend">${cats.map((x, i) => `<li><i style="background:${MaintReport.COST_COLORS[i % MaintReport.COST_COLORS.length]}"></i><span>${UI.esc(x.label)}</span>
          <b>${UI.money(x.value)}</b><small>${c.total > 0 ? Math.round(x.value / c.total * 100) + '%' : '—'}</small></li>`).join('')}
          ${(c.types || []).length ? '' : '<li class="mr-legend-note">No labor or outside-service cost was recorded on repairs in this period.</li>'}</ul></div>`
      : '<div class="mo-empty text-danger">The expense breakdown could not be loaded.</div>';

    // Repair frequency: repair jobs reported in the period (cancelled excluded) for every active truck.
    const most = freq.filter(t => +t.repairs > 0).slice(0, 5);
    const least = freq.slice().sort((x, y) => (+x.repairs - +y.repairs) || String(x.plate_number).localeCompare(y.plate_number)).slice(0, 5);
    const row = (t) => { const go = 'maintenance?view=all&cancelled=0&vehicle_id=' + t.id + '&from=' + per.from + '&to=' + per.to, ok = UI.canGo(go);
      return `<li class="mr-truck${ok ? ' clickable' : ''}"${ok ? ` data-go="${UI.esc(go)}" role="link" tabindex="0"` : ''}><span><b>${UI.esc(t.plate_number)}</b>${t.truck_number ? ` <span class="text-muted">#${UI.esc(t.truck_number)}</span>` : ''}<small>${UI.esc(t.truck_type || '')}</small></span>
        <span class="badge-s ${+t.repairs ? 'blue' : 'gray'}">${UI.num(t.repairs)} repair${+t.repairs === 1 ? '' : 's'}</span></li>`; };
    const freqBody = `<div class="mr-freq"><div><h3>Most repaired</h3>${most.length ? `<ul>${most.map(row).join('')}</ul>` : '<div class="ws-sug-empty">No repair was reported in this period.</div>'}</div>
      <div><h3>Least repaired</h3>${least.length ? `<ul>${least.map(row).join('')}</ul>` : '<div class="ws-sug-empty">No active truck.</div>'}</div></div>`;

    ctx.el.innerHTML = `${UI.wsPeriod('maintenance_reports', per)}${UI.kpiTiles(tiles, 'ws-kpi4')}
      ${UI.wsPanel('Maintenance Activity Timeline', 'bi-graph-up', timelineBody, { cls: 'mr-timeline', tipHtml: MaintReport.sugList(sug.timeline, 'No action is suggested from the recorded maintenance activity.') })}
      <div class="ws-grid2 ws-report-row mt-3">
        ${UI.wsPanel('Maintenance Expense Breakdown', 'bi-pie-chart', costBody, { cls: 'ws-l1', foot: `<button type="button" class="btn btn-link btn-sm p-0" data-cost-open>View recorded entries</button> · parts at release date, other costs at the date incurred` })}
        ${UI.wsPanel('Repair Frequency by Truck', 'bi-truck', freqBody, { cls: 'ws-r1', tipHtml: MaintReport.sugList(sug.trucks, 'Repair counts per truck are shown as recorded; no rule applies.'),
          foot: `Repair jobs reported in the period for ${UI.num(freq.length)} active trucks (cancelled excluded). Not a reliability measure: truck usage is not recorded here.` })}
      </div>`;
    UI.bindTips(ctx.el); UI.bindPeriod(ctx.el);

    // Maintenance Cost KPI opens the same traceable breakdown.
    const costTile = [...ctx.el.querySelectorAll('.kpi-tile')][3];
    if (costTile && c) { costTile.classList.add('clickable'); costTile.setAttribute('role', 'button'); costTile.tabIndex = 0; costTile.setAttribute('aria-label', 'Maintenance cost ' + UI.money(c.total) + ': open the recorded entries');
      const open = () => MaintReport.openCost(d); costTile.onclick = open; costTile.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; }
    ctx.el.querySelector('[data-cost-open]')?.addEventListener('click', () => MaintReport.openCost(d));

    if (typeof Chart === 'undefined') return;
    // ---- timeline chart
    const cv = ctx.el.querySelector('#mrTimeline');
    if (cv && tl) {
      const chart = new Chart(cv, { type: 'line',
        data: { labels: b.map(x => x.short), datasets: series.map(([key, label, color, dash]) => ({ label, data: tl[key], borderColor: color, backgroundColor: color,
          borderDash: dash, borderWidth: 2, pointRadius: b.length > 40 ? 2 : 3, pointHoverRadius: 6, tension: 0, fill: false })) },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Count' } }, x: { ticks: { autoSkip: true, maxRotation: 0 } } },
          plugins: { legend: { position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 18, boxHeight: 3, padding: 14, font: { size: 12 } } },
            tooltip: { callbacks: { title: (it) => b[it[0].dataIndex] ? b[it[0].dataIndex].label : '' } } },
          onClick: (evt, els, ch) => { const hit = ch.getElementsAtEventForMode(evt, 'index', { intersect: false }, false); if (hit.length) openPoint(hit[0].index); } } });
      MaintReport.charts.push(chart);
      const pointRect = (i) => () => {
        const r = cv.getBoundingClientRect(), metas = chart.data.datasets.map((_, j) => chart.getDatasetMeta(j)).filter(m => !m.hidden && m.data[i]);
        const x = metas.length ? metas[0].data[i].x : chart.chartArea.left, y = metas.length ? Math.min(...metas.map(m => m.data[i].y)) : chart.chartArea.top;
        return { left: r.left + x, right: r.left + x, top: r.top + y - 6, bottom: r.top + y + 6 };
      };
      const openPoint = (i) => {
        const bk = b[i]; if (!bk) return;
        const range = 'from=' + bk.from + '&to=' + bk.to;
        const rows = series.map(([key, label, color]) => `<li><i style="background:${color}"></i><span>${UI.esc(label)}${key === 'under_repair' || key === 'awaiting' ? ' <small>(end of ' + unit + ')</small>' : ''}</span><b>${UI.num(tl[key][i])}</b></li>`).join('');
        const links = [['maintenance?view=all&cancelled=0&' + range, 'Open related repairs'], ['mp_parts_requests?status=all&' + range, 'Open related parts requests']]
          .filter(([g]) => UI.canGo(g)).map(([g, l]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-go="${UI.esc(g)}">${l}</button>`).join('');
        UI.openPointPop(cv, pointRect(i), 'Activity details: ' + bk.label, `
          <div class="ws-pp-sec"><div class="ws-pp-h">Selected period</div><b>${UI.esc(bk.label)}</b> <span class="cell-sub">${UI.date(bk.from)}${bk.to !== bk.from ? ' – ' + UI.date(bk.to) : ''}</span></div>
          <div class="ws-pp-sec"><div class="ws-pp-h">Maintenance activity</div><ul class="ws-pp-kv">${rows}</ul><div class="ws-pp-links">${links}</div></div>
          <div class="ws-pp-sec ws-pp-sug"><div class="ws-pp-h"><i class="bi bi-lightbulb" aria-hidden="true"></i> Suggested actions</div>${MaintReport.sugList((sug.points || [])[i], 'No action is suggested for this period.')}</div>`);
        chart.setActiveElements(series.map((_, j) => ({ datasetIndex: j, index: i }))); chart.update('none');
      };
      // keyboard: Left / Right move the highlighted period, Enter / Space opens it
      let cur = -1;
      cv.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cur = cur < 0 ? (e.key === 'ArrowRight' ? 0 : b.length - 1) : Math.max(0, Math.min(b.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
          const act = series.map((_, j) => ({ datasetIndex: j, index: cur })); chart.setActiveElements(act); chart.tooltip.setActiveElements(act, { x: 0, y: 0 }); chart.update('none'); }
        if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) { e.preventDefault(); openPoint(cur); }
      });
    }
    // ---- expense donut
    const dc = ctx.el.querySelector('#mrCost');
    if (dc && c && c.total > 0) MaintReport.charts.push(new Chart(dc, { type: 'doughnut',
      data: { labels: cats.map(x => x.label), datasets: [{ data: cats.map(x => x.value), backgroundColor: cats.map((_, i) => MaintReport.COST_COLORS[i % MaintReport.COST_COLORS.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (it) => `${it.label}: ${UI.money(it.raw)} (${Math.round(it.raw / c.total * 100)}%)` } } } } }));
  },
});
