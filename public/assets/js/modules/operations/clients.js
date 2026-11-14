/* assets/js/modules/operations/clients.js — CLIENT MASTERLIST
   PDF #12 Scenario A step 2: the Operations Head fills in the digital client information
   sheet (printable), attaches the client signature and the accreditation files; only a
   complete profile can be saved (Pending Rate). Billing sets the rate -> Active.
   Only Active clients can be selected for trips.
   Backend: backend/Modules/Operations/Clients.php */
'use strict';
const ClientUI = {
  infoFields(c = {}) {
    return [
      { name: 'company_name', label: 'Registered name', required: true, col: 8, value: c.company_name },
      { name: 'tin', label: 'TIN', col: 4, value: c.tin, placeholder: '000-000-000-000' },
      { name: 'trade_name', label: 'Trade / business name', col: 6, value: c.trade_name },
      { name: 'nature_of_business', label: 'Nature of business', col: 6, value: c.nature_of_business },
      { name: 'business_address', label: 'Business address', required: true, col: 12, value: c.business_address },
      { name: 'contact_person', label: 'Contact person', required: true, col: 4, value: c.contact_person },
      { name: 'contact_position', label: 'Position', col: 4, value: c.contact_position },
      { name: 'contact_number', label: 'Contact number', required: true, col: 4, value: c.contact_number },
      { name: 'email', label: 'Email', type: 'email', col: 6, value: c.email },
      { name: 'notes', label: 'Notes', col: 6, value: c.notes },
    ];
  },
  fileFields(required) {
    const f = (name, label, img) => ({ name, label, type: 'file', required, col: 6, attrs: `accept="${img ? 'image/*' : 'application/pdf,image/*'}"` });
    return [{ type: 'html', html: '<div class="drawer-h">Requirements (all are needed before saving)</div>' },
      f('signature', 'Client signature (image)', true), f('company_profile', 'Company profile'), f('sec_dti', 'SEC / DTI registration'),
      f('business_permit', 'Business permit'), f('bir_2303', 'Certificate of Registration (BIR Form 2303)')];
  },
  create() {
    const all = ClientUI.infoFields();
    const field = key => {
      const found = all.find(item => item.name === key);
      if (!found) throw new Error('Client field is missing: ' + key);
      return { ...found };
    };
    const company = [
      { ...field('company_name'), label: 'Registered Company Name', col: 12 },
      { ...field('trade_name'), col: 6 },
      { ...field('tin'), col: 6 },
      { ...field('business_address'), col: 12 },
    ];
    const contact = [
      { ...field('contact_person'), col: 6 },
      { ...field('contact_position'), col: 6 },
      { ...field('contact_number'), col: 6 },
      { ...field('email'), col: 6 },
    ];
    const extra = [
      { ...field('nature_of_business'), col: 12 },
      { ...field('notes'), type: 'textarea', rows: 2, col: 12 },
    ];
    const uploads = ClientUI.fileFields(true).filter(f => f.type === 'file');
    const docs = [
      { type: 'html', col: 12, html: '<p class="record-file-progress" data-upload-progress aria-live="polite">0 / 5 attached</p>' },
      ...uploads,
    ];
    const sections = [
      FormComponents.section('Company Information', 'bi-building', company),
      FormComponents.section('Contact Information', 'bi-person-lines-fill', contact),
      FormComponents.collapsible('Additional Information', 'Nature of business and notes', 'bi-card-text', extra),
      FormComponents.collapsible('Accreditation Requirements', '5 mandatory files before saving', 'bi-file-earmark-check', docs),
    ];
    const wrap = FormComponents.fileModal('Add Client', sections, 'Clients.create', {
      intro: 'Complete the client profile and attach all five accreditation requirements before saving.',
      submit: 'Save Client',
      extraFooter: '<button type="button" class="btn btn-outline-secondary btn-sm me-auto" id="ciBlank"><i class="bi bi-printer"></i> Print Blank Form</button>',
    });
    wrap.querySelector('#ciBlank').onclick = () => ClientUI.printSheet({});
  },
  printSheet(c, sigDoc) {
    const row = (l, v) => `<tr><th style="width:32%">${UI.esc(l)}</th><td>${UI.esc(v || '')}&nbsp;</td></tr>`;
    UI.printForm('CLIENT INFORMATION SHEET', `<table>${row('Registered name', c.company_name)}${row('Trade / business name', c.trade_name)}${row('TIN', c.tin)}
      ${row('Nature of business', c.nature_of_business)}${row('Business address', c.business_address)}${row('Contact person', c.contact_person)}${row('Position', c.contact_position)}
      ${row('Contact number', c.contact_number)}${row('Email', c.email)}${row('Payment terms (days)', c.payment_terms_days)}</table>
      <div class="pf-note">Accreditation requirements: <span class="chk"></span>Company profile &nbsp; <span class="chk"></span>SEC / DTI registration &nbsp; <span class="chk"></span>Business permit &nbsp; <span class="chk"></span>Certificate of Registration (BIR Form 2303)</div>
      <div class="pf-signs"><div class="pf-sign"><div class="pf-line">${sigDoc ? `<img src="${UI.docUrl(sigDoc)}" alt="signature">` : ''}</div><div class="pf-sl">Client authorized representative (signature over printed name)</div></div>
      ${UI.sign('Received by (Operations Head)')}</div>`, { number: c.client_code || '' });
  },
  /** Read-only Approved routes of the client (Checklist #20; data from the Routes module). */
  async routes(el, clientId) {
    const box = el.querySelector('[data-client-routes]'); if (!box) return;
    let r; try { r = await App.api('Routes.for_client', { client_id: clientId }); } catch (e) { box.innerHTML = '<div class="text-muted small">Approved routes are not available right now.</div>'; return; }
    const rate = (x) => x.rate_type === 'Flat' ? UI.money(x.rate_amount) : UI.money(x.rate_amount) + '/km' + (+x.minimum_charge > 0 ? ' (minimum ' + UI.money(x.minimum_charge) + ')' : '');
    const routes = r.routes || [];
    box.innerHTML = (routes.length
      ? '<div class="client-profile-routes">' + routes.map(x =>
          '<div class="client-profile-route"><div class="client-profile-route-main"><strong>'+UI.esc(x.origin_label)+' <i class="bi bi-arrow-right" aria-hidden="true"></i> '+UI.esc(x.destination_label)+'</strong>'
          +'<span><i class="bi bi-truck" aria-hidden="true"></i> '+UI.e(x.truck_type)+' <span aria-hidden="true">·</span> '+UI.num(x.distance_km,2)+' km</span></div>'
          +'<div class="client-profile-route-rate"><strong>'+rate(x)+'</strong><small>Since '+UI.date(x.effective_from)+'</small></div></div>'
        ).join('')+'</div>'
      : '<div class="client-profile-empty">No approved routes yet.</div>')
      + (r.can_open_routes ? '<a class="client-profile-route-link" href="#routes?client_id='+encodeURIComponent(clientId)+'">View all routes for this client <i class="bi bi-arrow-right" aria-hidden="true"></i></a>' : '');
    UI.activate(box);
  },
  async open(id, d) {
    let r; try { r = await App.api('Clients.details', { id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const c = r.client;
    const need = Object.keys(d.requiredDocs || {}).length;
    const sig = r.documents.find(x => x.category === 'Client Signature');
    const acts = [];
    if (d.can.edit) acts.push('<button class="btn btn-sm btn-outline-primary" data-a="edit"><i class="bi bi-pencil"></i> Edit information</button>',
      '<button class="btn btn-sm btn-outline-secondary" data-a="docs"><i class="bi bi-paperclip"></i> Upload requirements</button>');
    acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="print"><i class="bi bi-printer"></i> Print information sheet</button>');
    if (d.can.edit) acts.push(`<button class="btn btn-sm btn-outline-${c.status !== 'Active' ? 'success' : 'danger'}" data-a="active">${c.status !== 'Active' ? 'Activate' : 'Deactivate'}</button>`);
    const docs = (r.documents || []).map(doc => {
      const fileId = Number(doc.id);
      if (!Number.isSafeInteger(fileId) || fileId <= 0) return '';
      const mime = String(doc.mime_type || '');
      const fileName = UI.esc(doc.original_filename || 'Document');
      const kind = mime === 'application/pdf' ? 'bi-file-earmark-pdf' : mime.startsWith('image/') ? 'bi-file-earmark-image' : 'bi-file-earmark';
      return '<div class="client-profile-document">'
        +'<div class="client-profile-file-icon"><i class="bi '+kind+'" aria-hidden="true"></i></div>'
        +'<div class="client-profile-file-info"><strong>'+UI.e(doc.category)+'</strong><span title="'+fileName+'">'+fileName+'</span>'
        +'<small>'+UI.datetime(doc.created_at)+(doc.uploader?' · '+UI.e(doc.uploader):'')+'</small></div>'
        +'<div class="client-profile-file-actions"><button type="button" class="btn btn-sm btn-outline-primary" data-doc-preview="'+fileId+'" data-doc-mime="'+UI.esc(mime)+'" data-doc-name="'+fileName+'"><i class="bi bi-eye" aria-hidden="true"></i> View</button>'
        +'<a class="btn btn-sm btn-outline-secondary" href="'+UI.docUrl(fileId,false)+'" download><i class="bi bi-download" aria-hidden="true"></i> Download</a></div></div>';
    }).join('');
    const hasBilling = Number(r.billing?.invoices || 0) > 0 || Number(r.billing?.billed || 0) !== 0 || Number(r.billing?.paid || 0) !== 0;
    const hasTrips = Array.isArray(r.trips) && r.trips.length > 0;
    const info = [
      ['Registered name',UI.e(c.company_name)],['Trade name',UI.e(c.trade_name)],
      ['TIN',UI.e(c.tin)],['Nature of business',UI.e(c.nature_of_business)],
      ['Business address',UI.e(c.business_address)],
      ['Contact person',UI.e([c.contact_person,c.contact_position].filter(Boolean).join(', '))],
      ['Contact number',UI.e(c.contact_number)],['Email',UI.e(c.email)],
      ['Payment terms',c.payment_terms_days !== null && c.payment_terms_days !== undefined ? UI.esc(String(c.payment_terms_days))+' days' : 'Default']
    ];
    const infoMarkup = info.map(([label,value]) => '<div class="client-profile-info-item"><span>'+UI.esc(label)+'</span><strong>'+value+'</strong></div>').join('');
    const html = '<div class="client-profile-clean">'
      +'<div class="client-profile-top"><div class="client-profile-identity"><span class="client-profile-code">'+UI.e(c.client_code)+'</span>'+UI.badge(c.status)+'</div>'
      +'<h3>'+UI.e(c.company_name)+'</h3></div>'
      +(c.status==='Incomplete'?'<div class="alert alert-warning py-2 small">Missing requirements: '+r.missing.map(UI.esc).join(', ')+'. This client is not eligible for trips yet.</div>':'')
      +(c.status==='Pending Rate'?'<div class="alert alert-info py-2 small">Legacy client status: verify accreditation before activating.</div>':'')
      +'<div class="client-profile-actions">'+acts.join('')+'</div>'
      +'<section class="client-profile-section"><h4><i class="bi bi-building" aria-hidden="true"></i> Client information</h4><div class="client-profile-info-grid">'+infoMarkup+'</div></section>'
      +'<section class="client-profile-section"><h4><i class="bi bi-signpost-2" aria-hidden="true"></i> Approved routes</h4><div data-client-routes><div class="text-muted small">Loading approved routes…</div></div></section>'
      +'<section class="client-profile-section"><h4><i class="bi bi-shield-check" aria-hidden="true"></i> Accreditation</h4>'
      +'<div class="client-profile-accreditation"><span class="badge-s '+(r.missing.length?'amber':'green')+'">'+(need-r.missing.length)+' / '+need+' requirements complete</span>'
      +(r.missing.length?'<span class="client-profile-missing">Missing: '+r.missing.map(UI.esc).join(', ')+'</span>':'')+'</div>'
      +'<div class="client-profile-files">'+(docs || '<div class="client-profile-empty">No accreditation files uploaded.</div>')+'</div></section>'
      +(hasBilling?'<section class="client-profile-section"><h4><i class="bi bi-receipt" aria-hidden="true"></i> Billing summary</h4>'
        +'<div class="client-profile-info-grid">'+[
          ['Invoices',UI.num(r.billing.invoices)],['Billed',UI.money(r.billing.billed)],
          ['Paid',UI.money(r.billing.paid)],['Balance',UI.money(r.billing.billed-r.billing.paid)]
        ].map(([label,value])=>'<div class="client-profile-info-item"><span>'+label+'</span><strong>'+value+'</strong></div>').join('')+'</div></section>':'')
      +(hasTrips?'<section class="client-profile-section"><h4><i class="bi bi-truck" aria-hidden="true"></i> Recent trips</h4>'
        +UI.table([['Trip','trip_ref'],['Status','status','badge'],['Type','truck_type'],['Scheduled date and time','scheduled_at','datetime'],['Destination','delivery_point']],r.trips,{plain:true})+'</section>':'')
      +'</div>';
    const el = UI.drawer(UI.esc(c.company_name), html, { subtitle: 'Client profile' });
    el.classList.add('client-profile-drawer');
    ClientUI.routes(el, c.id);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'edit') {
        // Primary client details are immediately visible; secondary attributes
        // remain editable under a native disclosure. All fields use shared UI.fields.
        const source = ClientUI.infoFields(c);
        const field = (name, col=6) => {
          const original = source.find(item => item.name === name);
          if (!original) throw new Error('Client edit field missing: ' + name);
          return { ...original, col };
        };
        const primary = [
          field('company_name',12), field('business_address',12),
          field('contact_person',6), field('contact_number',6),
          field('email',12)
        ];
        const secondary = [
          field('tin',6), field('trade_name',6),
          field('nature_of_business',6), field('contact_position',6),
          field('notes',12)
        ];
        const body = '<div class="client-edit-compact">'
          + '<div class="client-edit-intro"><i class="bi bi-pencil-square" aria-hidden="true"></i>'
          + '<span>Update the key details below. Additional company information is available when needed.</span></div>'
          + '<div class="client-edit-main">'+UI.fields(primary)+'</div>'
          + '<details class="record-form-extra client-edit-more">'
          + '<summary><span class="record-form-extra-heading"><i class="bi bi-card-list" aria-hidden="true"></i>'
          + '<span><strong>Additional information</strong><small>TIN, trade name, business type, position and notes</small></span></span>'
          + '<i class="bi bi-chevron-down record-form-chevron" aria-hidden="true"></i></summary>'
          + '<div class="record-form-extra-content">'+UI.fields(secondary)+'</div></details>'
          + '</div>';
        UI.modal('Edit ' + UI.esc(c.company_name), body, async (payload) => {
          const result = await App.api('Clients.update', { id:c.id, ...payload });
          UI.result(result);
          ClientUI.open(c.id,d);
          App.route();
        }, {
          size:'modal-md',submit:'Save changes',
          onShow:(modal)=>modal.classList.add('client-edit-modal')
        });
      }
      if (a === 'docs') UI.formModalFiles('Upload requirements of ' + UI.esc(c.company_name), [...ClientUI.fileFields(false), { name: 'other', label: 'Other client documents (contract, ...)', type: 'file', multiple: true, col: 12 }],
        'Clients.documents', { extra: { id: c.id }, intro: r.missing.length ? 'Still missing: ' + r.missing.map(UI.esc).join(', ') : 'Upload renewed files if needed.', submit: 'Upload', after: () => { ClientUI.open(c.id, d); App.route(); } });
      if (a === 'print') ClientUI.printSheet(c, sig ? sig.id : null);
      if (a === 'active') UI.confirmAction((c.status !== 'Active' ? 'Activate ' : 'Deactivate ') + UI.esc(c.company_name), c.status !== 'Active' ? 'Activation requires complete accreditation and profile information.' : 'The client can no longer be chosen for new trips. Old trips and invoices are kept.',
        'Clients.set_active', { id: c.id, active: c.status !== 'Active' ? 1 : 0 }, { danger: c.status === 'Active' });
    });
  },
};

App.page('clients', {
  title: 'Clients',
  subtitle: 'Client profiles, accreditation and account status.',
  render(ctx) {
    const d=ctx.data,q=ctx.query;
    ClientUI.defaultTerms=d.defaultTerms;
    const clients=d.clients||[];
    const count=status=>clients.filter(c=>c.status===status).length;
    const quickStatuses=[['','All Current'],['Active','Active'],['Pending Rate','Pending Rate'],
      ['Incomplete','Incomplete'],['Inactive','Inactive']];
    const rows=clients.filter(c=>q.status ? c.status===q.status : c.status!=='Inactive');
    const statusOptions=[['','All statuses'],['Active','Active'],['Pending Rate','Pending Rate'],
      ['Incomplete','Incomplete'],['Inactive','Inactive']];
    const toolbar=`<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger"
      aria-controls="client-filter-panel" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter</button>
      <button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger"
      aria-controls="client-sort-panel" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>
      <div class="record-workspace-popovers">
        <div id="client-filter-panel" class="record-workspace-popover" hidden>
          <strong>Filter Clients</strong>
          <label>Client Status<select class="form-select form-select-sm" name="status">
            ${statusOptions.map(([v,label])=>'<option value="'+UI.esc(v)+'"'+(String(q.status||'')===v?' selected':'')+'>'+UI.esc(label)+'</option>').join('')}
          </select></label>
          <div class="record-workspace-popover-actions">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>
            <button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button>
          </div>
        </div>
        <div id="client-sort-panel" class="record-workspace-popover record-workspace-sort-panel" hidden>
          <strong>Sort Clients</strong>
          <label class="record-workspace-sort-option"><input type="radio" name="client_sort" value="default" data-record-sort checked> Default order</label>
          <label class="record-workspace-sort-option"><input type="radio" name="client_sort" value="name" data-record-sort> Client name</label>
          <label class="record-workspace-sort-option"><input type="radio" name="client_sort" value="code" data-record-sort> Client code</label>
          <label class="record-workspace-sort-option"><input type="radio" name="client_sort" value="status" data-record-sort> Status</label>
        </div>
      </div>`
      +(d.can.edit?'<button type="button" class="btn btn-sm btn-primary record-workspace-add"><i class="bi bi-plus-lg" aria-hidden="true"></i> Add Client</button>':'');
    const table=UI.table([
      ['Code','client_code'],
      ['Client','company_name',v=>'<b>'+UI.esc(v)+'</b>'],
      ['Contact','contact_person'],
      ['Phone','contact_number'],
      ['Status','status','badge'],
      ['Balance','balance','money'],
    ],rows,{
      tools:toolbar,
      actions:()=>UI.btn('view','View'),
      onAction:(action,c)=>ClientUI.open(c.id,d),
      rowClick:c=>ClientUI.open(c.id,d),
      empty:clients.length?'No clients match your search or filters.':'No clients registered yet. Add your first client to start managing profiles.',
    });
    ctx.el.innerHTML='<div class="fleet-clients-workspace">'
      +RecordComponents.kpis([
        {label:'Total Clients',value:clients.length},
        {label:'Active',value:count('Active'),color:'green'},
        {label:'Pending Rate',value:count('Pending Rate'),color:'blue'},
        {label:'Incomplete',value:count('Incomplete'),color:count('Incomplete')?'amber':''},
      ])
      +RecordComponents.panel(table,RecordComponents.categories(quickStatuses.map(([value,label])=>({value,label})),q.status||'','data-client-status'))
      +'</div>';
    UI.activate(ctx.el);
    RecordComponents.mountPanel(ctx.el,{
      title:'Client Records',
      categorySelector:'.record-workspace-categories',
      addSelector:'.record-workspace-add',
    });
    ctx.el.querySelector('.record-workspace-add')?.addEventListener('click',()=>ClientUI.create());
    ctx.el.querySelectorAll('[data-client-status]').forEach(button=>button.addEventListener('click',()=>{
      const next={...ctx.query},status=button.dataset.clientStatus;
      if(status)next.status=status;else delete next.status;
      App.go(ctx.page,next);
    }));
    const tbody=ctx.el.querySelector('[data-tbody]'),
      tableState=tbody?UI._tables[tbody.dataset.tbody]:null,
      original=tableState?tableState.rows.slice():[];
    RecordComponents.bindDropdowns(ctx.el,{
      apply(panel){
        const next={...ctx.query},status=panel.querySelector('[name="status"]').value;
        if(status)next.status=status;else delete next.status;
        App.go(ctx.page,next);
      },
      reset(){
        const next={...ctx.query};delete next.status;App.go(ctx.page,next);
      },
      sort(key){
        if(!tableState||!tbody)return;
        const field={name:'company_name',code:'client_code',status:'status'}[key];
        tableState.rows=key==='default'?original.slice():
          original.slice().sort((a,b)=>String(a[field]||'').localeCompare(String(b[field]||''),undefined,{numeric:true}));
        tableState.page=0;UI.drawTable(tbody.dataset.tbody);
      },
    },{filter:'client-filter-panel',sort:'client-sort-panel'});
  },
});
