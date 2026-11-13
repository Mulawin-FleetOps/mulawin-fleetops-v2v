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
