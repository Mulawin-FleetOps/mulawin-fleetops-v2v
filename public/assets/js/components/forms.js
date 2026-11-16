/* Reusable grouped record forms for Mulawin FleetOps.
   Keep UI.field/UI.formData and UI.modal validation, confirmation and discard guards. */
'use strict';

const FormComponents = Object.freeze({
  section(title, icon, fields, options = {}) {
    const heading = '<div class="record-form-section-title"><i class="bi ' + UI.esc(icon) + '" aria-hidden="true"></i><h3>' + UI.esc(title) + '</h3></div>';
    const content = '<div class="record-form-section-fields">' + UI.fields(fields) + '</div>';
    return '<section class="record-form-section">' + heading + content + '</section>';
  },

  collapsible(title, description, icon, fields, open = false) {
    const key = 'record-form-extra-' + Math.random().toString(36).slice(2, 8);
    return '<details class="record-form-extra"' + (open ? ' open' : '') + '>'
      + '<summary aria-controls="' + key + '"><span class="record-form-extra-heading">'
      + '<i class="bi ' + UI.esc(icon) + '" aria-hidden="true"></i><span><strong>' + UI.esc(title)
      + '</strong><small>' + UI.esc(description) + '</small></span></span>'
      + '<i class="bi bi-chevron-down record-form-chevron" aria-hidden="true"></i></summary>'
      + '<div id="' + key + '" class="record-form-extra-content">' + UI.fields(fields) + '</div>'
      + '</details>';
  },

  cargoGroups(fields, truckType, options = {}) {
    // Shared Add/Edit Trip cargo layout. Show only general fields and the
    // relevant truck category. Keep other existing values in hidden inputs so
    // editing unrelated details never silently clears historical data.
    const groups = [
      ['General Shipment Information','Booking, consignee and delivery instructions','bi-clipboard-check',
        ['booking_reference','consignee','delivery_details']],
      ['Car Carrier Details','Cargo units','bi-car-front',['units_planned']],
      ['Container Details','Container and seal identification','bi-box-seam',
        ['container_number','container_size','seal_number']],
      ['Wing Van / Other Shipment Details','Shipment reference','bi-truck',
        ['shipment_number']]
    ];
    const preferred=truckType==='Car Carrier'?1:truckType==='Container'?2:3;
    if(options.compact){
      // Review & Create already provides a per-trip disclosure. Avoid nested
      // accordions: display the shared relevant inputs in one compact grid.
      const visibleNames=[...groups[0][3],...groups[preferred][3]];
      const visible=visibleNames.map(name=>fields.find(field=>field.name===name)).filter(Boolean);
      const hidden=fields.filter(field=>!visibleNames.includes(field.name));
      const typeTitle=truckType==='Car Carrier'?'Car Carrier':truckType==='Container'?'Container':'Wing Van';
      return '<section class="trip-cargo-groups trip-cargo-groups-compact" aria-label="Cargo and Shipment Details">'
        +'<div class="trip-cargo-compact-heading"><i class="bi bi-box-seam" aria-hidden="true"></i>'
        +'<strong>Cargo &amp; Shipment Details</strong><span>'+UI.esc(typeTitle)+'</span></div>'
        +'<div class="trip-cargo-compact-fields">'+UI.fields(visible)+'</div>'
        +hidden.map(field=>'<input type="hidden" name="'+UI.esc(field.name)+'" value="'+UI.esc(field.value??'')+'">').join('')
        +'</section>';
    }
    return '<section class="trip-cargo-groups'+(options.compact?' trip-cargo-groups-compact':'')+'" aria-label="Cargo and Shipment Details">'
      +'<div class="record-form-section-title"><i class="bi bi-box-seam" aria-hidden="true"></i>'
      +'<h3>Cargo &amp; Shipment Details</h3></div>'
      +'<p class="form-help">Only the shipment fields relevant to this truck type are shown.</p>'
      +groups.map(([title,description,icon,names],index)=>{
        if(index!==0&&index!==preferred)return '';
        const selected=names.map(name=>fields.find(field=>field.name===name)).filter(Boolean);
        if(!selected.length)return '';
        const existing=selected.some(field=>field.value!==null&&field.value!==undefined&&String(field.value).trim()!=='');
        return FormComponents.collapsible(title,description,icon,selected,
          !options.compact&&(index===0||existing||index===preferred));
      }).join('')
      +fields.filter(field=>!groups[0][3].includes(field.name)&&
          !groups[preferred][3].includes(field.name))
        .map(field=>'<input type="hidden" name="'+UI.esc(field.name)+'" value="'+UI.esc(field.value??'')+'">').join('')
      +'</section>';
  },

  // Upload requirements use the existing multipart API and modal guards.
  fileModal(title, groups, action, opts = {}) {
    const html = '<div class="record-form record-form-compact record-form-files">'
      + (opts.intro ? '<div class="record-form-hint">' + UI.esc(opts.intro) + '</div>' : '')
      + groups.join('') + '</div>';
    const wrap = UI.modal(title, html, async (data, form) => {
      const payload = opts.transform ? opts.transform(data, form, wrap) : data;
      const result = await App.apiForm(action, { ...(opts.extra || {}), ...payload }, form);
      UI.result(result);
      if (opts.after) opts.after(result);
      else App.route();
    }, { ...opts, size: 'modal-lg record-form-dialog record-form-dialog-compact',
      submit: opts.submit || 'Save' });

    const form = wrap.querySelector('form');
    const detail = wrap.querySelector('.record-form-files details');
    const files = [...wrap.querySelectorAll('.record-form-files input[type="file"][required]')];
    const progress = wrap.querySelector('[data-upload-progress]');
    const updateProgress = () => {
      if (!progress) return;
      const attached = files.filter(input => input.files?.length).length;
      progress.textContent = attached + ' / ' + files.length + ' attached';
    };
    files.forEach(input => input.addEventListener('change', updateProgress));
    updateProgress();
    // Closed <details> fields are not visible to the shared modal validator.
    // Expand before validation so required documents cannot be skipped.
    form.addEventListener('submit', event => {
      const missing = files.find(input => !input.files?.length);
      if (!missing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      detail.open = true;
      const error = wrap.querySelector('.form-error');
      if (error) {
        const label = form.querySelector('label[for="' + missing.id + '"]');
        error.textContent = 'Attach the required document: ' + (label?.textContent || missing.name).trim().replace(/\\s*\\*$/, '');
        error.style.display = 'block';
      }
      missing.classList.add('is-invalid');
      missing.focus();
    }, true);
    return wrap;
  },

  // All fields retain their original names and values. The action stays the
  // established authenticated endpoint, with the same save/confirmation flow.
  modal(title, groups, action, opts = {}) {
    const html = '<div class="record-form' + (opts.compact ? ' record-form-compact' : '') + '">'
      + (opts.intro ? '<div class="record-form-hint">' + UI.esc(opts.intro) + '</div>' : '')
      + groups.join('')
      + '</div>';
    return UI.modal(title, html, async data => {
      const payload = opts.transform ? opts.transform(data) : data;
      const result = await App.api(action, { ...(opts.extra || {}), ...payload });
      UI.result(result);
      if (opts.after) opts.after(result);
      else App.route();
    }, { ...opts, size: 'modal-lg record-form-dialog' + (opts.compact ? ' record-form-dialog-compact' : '') + (opts.compactSize === 'small' ? ' record-form-dialog-small' : ''), submit: opts.submit || 'Save Truck' });
  },
});
