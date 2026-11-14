/* assets/js/modules/operations/routes.js — CLIENT ROUTES (Checklist #20)
   Approved routes per client and truck type, with versioned contractual rates.
   Provisional flow: Operations Head requests -> Billing enters the rate -> Admin approves / rejects.
   A rate revision of an Approved route keeps the old rate in use until the Admin approves the new one.
   Approved route selection is integrated with planning; final acceptance and billing policies are separate.
   Backend: backend/Modules/Operations/Routes.php */
'use strict';
const RouteUI = {
  /**
   * Same steps, in the same order, as Routes::normalize() on the server: upper case -> every
   * run of non-letters/non-digits becomes one space -> every run of whitespace becomes one space -> trim.
   * Used only for the "similar route" warning; the database unique key is the real duplicate check.
   */
  norm: (v) => String(v ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim(),
  rateText(type, amount, min) {
    if (!type) return '—';
    return type === 'Flat' ? UI.money(amount) : `${UI.money(amount)}/km${+min > 0 ? ` (minimum ${UI.money(min)})` : ''}`;
  },
  name: (r) => `${r.origin_label} → ${r.destination_label}`,
  waiting: (r) => ['Pending Rate', 'Pending Approval'].includes(r.status) || (r.status === 'Approved' && r.pending_rate_id),

  request(d, options = {}) {
    const fields = [
      { type: 'html', col: 12, html: `<section class="rpm-route-garage" aria-label="Fixed company initial point">
        <div class="rpm-route-garage-icon"><i class="bi bi-house-door" aria-hidden="true"></i></div>
        <div class="rpm-route-garage-copy"><div class="rpm-route-garage-top"><span class="rpm-garage-eyebrow">COMPANY GARAGE</span><span class="rpm-garage-fixed"><i class="bi bi-lock" aria-hidden="true"></i> One garage for all trips</span></div>
        <strong class="rpm-garage-name">R.P. Mulawin Trucking Service</strong><small><i class="bi bi-geo-alt" aria-hidden="true"></i> Purok 2, 86-A, Luyos, Tanauan City, Batangas</small></div>
      </section>` },
      { name: 'client_id', label: 'Client', type: 'select', required: true, col: 8, options: UI.opts(d.clients, c => c.company_name + (c.status !== 'Active' ? ` (${c.status})` : '')), value: d.filterClient || '' },
      { name: 'truck_type', label: 'Truck type', type: 'select', required: true, col: 4, options: UI.list(d.truckTypes), value:d.filterType||'' },
      { name: 'origin', label: 'Pickup point', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. TANAUAN, BATANGAS' },
      { name: 'destination', label: 'Delivery point', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. MALVAR, BATANGAS' },
      { type: 'html', col: 12, html: `<section class="rpm-route-map-shell">
        <div class="rpm-route-map-heading"><div><i class="bi bi-map" aria-hidden="true"></i> Route preview</div><span>Live road route · Garage → Pickup → Destination</span></div>
        <div class="rpm-route-steps" aria-label="Driving sequence"><span class="rpm-step-garage"><b>1</b> Garage</span><i class="bi bi-chevron-right" aria-hidden="true"></i><span class="rpm-step-pickup"><b>2</b> Pickup</span><i class="bi bi-chevron-right" aria-hidden="true"></i><span class="rpm-step-delivery"><b>3</b> Destination</span></div>
        <div data-routemapbox></div>
        <div class="rpm-route-legend"><span><i class="rpm-route-line-key garage-road"></i> Garage → Pickup</span><span><i class="rpm-route-line-key delivery-road"></i> Pickup → Delivery</span><span class="rpm-route-legend-note" data-garage-verification><i class="bi bi-info-circle" aria-hidden="true"></i> Garage verification required</span></div>
      </section>` },
      { type: 'hidden', name: 'origin_lat' }, { type: 'hidden', name: 'origin_lng' }, { type: 'hidden', name: 'destination_lat' }, { type: 'hidden', name: 'destination_lng' },
      ...UI.distanceFieldDefs().filter(f => f.name === 'route_option'),
      { name: 'distance_km', label: 'Pickup → delivery distance (km)', type: 'number', step: '0.01', min: '0.01', required: true, col: 4, attrs: `max="${+d.maxDistance}"`,
        help: d.routing ? 'Filled in from the road distance when both points are pinned. You may change it (a reason is required).' : 'Type the km (automatic road distance is not set up on the server).' },
      ...UI.distanceFieldDefs().filter(f => f.name !== 'route_option'),
      { type: 'html', col: 12, html: `<div class="rpm-route-distances" aria-label="Distance summary">
        <div><span>Empty-truck travel · Garage → Pickup</span><strong data-garage-km>Not available</strong></div>
        <div><span>Loaded delivery · Pickup → Destination (billable)</span><strong data-client-km>Enter distance</strong></div>
        <div><span>Estimated total journey</span><strong data-total-km>Not available</strong></div>
      </div><p class="rpm-route-distance-note" data-garage-note>Garage distance requires a verified garage entrance. The billable route remains pickup to delivery.</p>` },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="500"' },
    ];
    UI.modal('Request a new route', '<p class="rpm-route-intro"><i class="bi bi-info-circle" aria-hidden="true"></i> Choose a client and truck, then pin the pickup and delivery addresses. Garage-to-pickup estimates require the verified company garage.</p>'
      + UI.fields(fields), async (f, form) => {
      // Send the route option only when the road distance was computed; otherwise the km is saved as Manual.
      if (form._distance) form._distance.clean(f);
      // Soft warning: same client and truck type, and one place name contains the other (e.g. "TANAUAN" and "TANAUAN CITY").
      const o = RouteUI.norm(f.origin), t = RouteUI.norm(f.destination);
      const close = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
      const similar = d.routes.filter(r => String(r.client_id) === String(f.client_id) && r.truck_type === f.truck_type
        && ['Pending Rate', 'Pending Approval', 'Approved'].includes(r.status) && close(RouteUI.norm(r.origin_label), o) && close(RouteUI.norm(r.destination_label), t));
      if (similar.length && form.dataset.ack !== o + '|' + t) {
        form.dataset.ack = o + '|' + t;
        throw new Error('Similar route already exists: ' + similar.map(r => `${r.route_ref} ${RouteUI.name(r)} (${r.status})`).join('; ') + '. Check it first. Click "Send request" again to continue anyway.');
      }
      const r = await App.api('Routes.request', f); UI.result(r); if(options.after)await options.after(r);else App.route();
    }, { submit: 'Send request', size: 'rpm-route-dialog', onShow: (wrap, form) => RouteUI.wireDistance(wrap, form,d.garage), extraFooter: '<small class="rpm-route-footer-note">Next: Billing rate → Admin approval</small>' });
  },

  /** Map, route option, automatic km and manual override of the Request route form (Checklist #5; shared widget in map.js). */
  wireDistance(wrap, form,garageSetting=null) {
    // The two road geometries are independent: the existing distance widget
    // continues to own the billable Pickup → Delivery segment (blue), while
    // this screen draws Garage → Pickup (teal) as an operational overlay.
    // Use only the same verified effective garage record supplied by Routes.read.
    // Never infer a financial route from a hard-coded approximate map marker.
    let configuredGarage = null;
    try { if (garageSetting?.value_json) configuredGarage=JSON.parse(garageSetting.value_json); } catch { /* No verified usable coordinates. */ }
    const validGarage=configuredGarage&&Number.isFinite(Number(configuredGarage.lat))&&Number.isFinite(Number(configuredGarage.lng))
      &&Number(configuredGarage.lat)>=4&&Number(configuredGarage.lat)<=21.5
      &&Number(configuredGarage.lng)>=116&&Number(configuredGarage.lng)<=127.5;
    const garage=validGarage?[Number(configuredGarage.lat),Number(configuredGarage.lng)]:null;
    let garageLine = null, garageRoad = null, clientRoad = null;
    let garageArrows = [], clientArrows = [], stopLabels = [];
    let updateGarageDistance = () => {};
    // Draw direction arrows in travel order, not just a road polyline.
    // This is important when the garage-to-pickup road passes close to the
    // destination: a road without arrows can look like a reversed trip.
    const clearMarkers = (markers) => { markers.forEach(m => m.remove()); markers.length = 0; };
    const drawArrows = (points, color, out) => {
      clearMarkers(out);
      if (!w?.map || !Array.isArray(points) || points.length < 2) return;
      const lengths = [0];
      for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + L.latLng(points[i - 1]).distanceTo(L.latLng(points[i])));
      }
      const total = lengths[lengths.length - 1];
      if (total < 100) return;
      for (const fraction of [0.52]) {
        const distance = total * fraction;
        let j = lengths.findIndex(v => v >= distance);
        if (j < 1) j = 1;
        const a = L.latLng(points[j - 1]), b = L.latLng(points[j]);
        const segment = lengths[j] - lengths[j - 1];
        const t = segment ? (distance - lengths[j - 1]) / segment : 0;
        const point = L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
        const east = (b.lng - a.lng) * Math.cos(point.lat * Math.PI / 180);
        const north = b.lat - a.lat;
        const degrees = Math.atan2(north, east) * 180 / Math.PI;
        const icon = L.divIcon({
          className: 'rpm-route-arrow-icon',
          html: '<span style="--route-arrow-color:' + color + ';transform:rotate(' + (-degrees) + 'deg)" aria-hidden="true">➤</span>',
          iconSize: [20, 20], iconAnchor: [10, 10],
        });
        out.push(L.marker(point, { icon, interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(w.map));
      }
    };
    const updateStopLabels = () => {
      clearMarkers(stopLabels);
      if (!w?.map) return;
      const points = w.map.picker?.points();
      const locations = [[garage?L.latLng(garage):null, '1', 'Garage'],
        [points?.pickup, '2', 'Pickup'], [points?.delivery, '3', 'Destination']];
      for (const [pos, n, title] of locations) {
        if (!pos) continue;
        const icon = L.divIcon({ className: 'rpm-route-stop-label rpm-stop-' + n,
          html: '<span><b>' + n + '</b> ' + title + '</span>',
          iconSize: [110, 26], iconAnchor: [-12, 15] });
        stopLabels.push(L.marker(pos, { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(w.map));
      }
    };
    let w;
    const fitFullRoute = () => {
      if (!w?.map || !garageRoad?.length || !clientRoad?.length) return;
      const bounds = L.latLngBounds(garageRoad.concat(clientRoad));
      if (bounds.isValid()) w.map.fitBounds(bounds.pad(0.12), { maxZoom: 14 });
    };
    w = UI.distanceWidget(form, {
      mapBox: form.querySelector('[data-routemapbox]'),
      fields: { pickup: { addr: 'origin', lat: 'origin_lat', lng: 'origin_lng' }, delivery: { addr: 'destination', lat: 'destination_lat', lng: 'destination_lng' } },
      labels: { pickup: 'Pickup', delivery: 'Destination' },
      scrollWheelZoom: true,
      hideStraightLine: true,
      hideSearchBar: true,
      searchResultsTarget: (kind) => form.querySelector('[data-pin-results="' + kind + '"]'),
      onSearchSelect: (kind) => {
        form.querySelector('[data-pin-results="' + kind + '"]')?.classList.add('d-none');
        form.querySelector('.rpm-route-map-shell')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
      // Clear stale geometry as soon as the user moves either pin.
      onPointsChange: () => {
        clientRoad = null;
        clearMarkers(clientArrows);
        updateStopLabels();
        updateGarageDistance();
      },
      onRoadRoute: (points) => {
        clientRoad = points;
        drawArrows(points, '#0b5cad', clientArrows);
        fitFullRoute();
      },
      footNote: UI.Map.serviceReady() ? 'Teal: garage to pickup. Blue: pickup to delivery. Scroll or pinch to zoom.' : 'Road routing is unavailable; use verified manual km.',
    });
    // Address inputs stay editable. The adjacent pin action chooses which map pin
    // to place, and optionally searches the entered address. Search results must
    // be selected by the user; never silently choose an approximate first match.
    for (const [kind, fieldName, title] of [
      ['pickup', 'origin', 'Pickup'], ['delivery', 'destination', 'Destination'],
    ]) {
      const address = form.querySelector('[name="' + fieldName + '"]');
      if (!address) continue;
      const controls = document.createElement('div');
      controls.className = 'rpm-address-pin-control';
      address.parentNode.insertBefore(controls, address);
      controls.appendChild(address);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rpm-address-pin-btn';
      button.dataset.point = kind;
      button.setAttribute('aria-label', 'Locate ' + title.toLowerCase() + ' address on the map');
      button.title = 'Locate address or select the ' + title.toLowerCase() + ' pin on the map';
      button.innerHTML = '<i class="bi bi-geo-alt" aria-hidden="true"></i><span>Pin</span>';
      controls.appendChild(button);
      const status = document.createElement('div');
      status.className = 'rpm-address-pin-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      controls.after(status);
      const results = document.createElement('div');
      results.className = 'rpm-address-search-results';
      results.dataset.pinResults = kind;
      status.after(results);
      const showStatus = (message) => { status.textContent = message; };
      button.addEventListener('click', () => {
        if (!w.map?.picker) { showStatus('Map unavailable. Enter the address manually.'); return; }
        w.map.picker.selectPoint(kind, address.value);
        const searching = address.value.trim() && UI.Map.serviceReady();
        showStatus(searching
          ? 'Choose the correct search result below, or click the map to place this pin.'
          : 'Click the map to place the ' + title.toLowerCase() + ' pin.');
        // Show matching locations below the corresponding address field.
        // Only scroll to the map when the user needs to place the point manually.
        if (!searching) form.querySelector('.rpm-route-map-shell')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      address.addEventListener('input', (event) => {
        // Only a person editing the address should invalidate its old position.
        // Programmatic suggestions from the map already manage their pin.
        if (event.isTrusted && w.map?.picker?.points()?.[kind]) {
          w.map.picker.clearPoint(kind);
          showStatus('Address changed. Press Pin to select the updated location.');
        }
      });
    }
    const verification=form.querySelector('[data-garage-verification]');
    if (verification) verification.innerHTML=garage
      ?'<i class="bi bi-check-circle" aria-hidden="true"></i> Verified garage configuration'
      :'<i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Garage entrance not verified';
    if (garage && w.map && typeof L !== 'undefined') {
      L.circleMarker(garage, { radius: 8, color: '#34526a', fillColor: '#34526a', fillOpacity: 0.95, weight: 2, interactive: true })
        .addTo(w.map).bindTooltip('Stop 1: verified company garage');
      updateStopLabels();
    }
    const billable = form.querySelector('[name="distance_km"]');
    const clientKm = form.querySelector('[data-client-km]');
    const garageKm = form.querySelector('[data-garage-km]');
    const totalKm = form.querySelector('[data-total-km]');
    const garageNote = form.querySelector('[data-garage-note]');
    let operationalKm = null, lastPickup = '', lastOption = '';
    const updateDistances = () => {
      const value = billable && billable.value !== '' && +billable.value > 0 ? +billable.value : null;
      clientKm.textContent = value === null ? 'Enter distance' : value.toFixed(2) + ' km';
      totalKm.textContent = value !== null && operationalKm !== null ? (value + operationalKm).toFixed(2) + ' km' : 'Not available';
    };
    billable?.addEventListener('input', updateDistances);
    updateDistances();
    let requestSeq = 0;
    updateGarageDistance = async () => {
      if (!w.map || !w.map.picker) return;
      const pickup = w.map.picker.points().pickup;
      const option = form.querySelector('[name="route_option"]')?.value || UI.Map.cfg().defaultRouteOption;
      const key = pickup ? pickup.lat.toFixed(6) + ',' + pickup.lng.toFixed(6) : '';
      if (key === lastPickup && option === lastOption) return;
      lastPickup = key;
      lastOption = option;
      const seq = ++requestSeq;
      if (garageLine) { garageLine.remove(); garageLine = null; }
      clearMarkers(garageArrows);
      garageRoad = null;
      operationalKm = null;
      garageKm.textContent = !garage?'Garage not verified':pickup?'Checking…':'Pin pickup first';
      garageNote.textContent = garage?'Using the verified company garage. Financial amounts are calculated by the backend.':'Garage entrance is not verified. Head Management must save verified coordinates in Fuel & Operating Costs before garage-to-pickup distance or fuel charges can be calculated.';
      updateDistances();
      if (!garage) return;
      if (!pickup || !UI.Map.serviceReady()) {
        garageKm.textContent = UI.Map.serviceReady() ? 'Pin pickup first' : 'Routing unavailable';
        return;
      }
      try {
        const r = await UI.Map.route(L.latLng(garage), pickup, option);
        if (seq !== requestSeq) return;
        if (r.available && Number.isFinite(+r.distance_km) && r.geometry) {
          const points = UI.Map.decode(r.geometry);
          if (points.length < 2) throw new Error('Missing garage road geometry');
          operationalKm = +r.distance_km;
          garageRoad = points;
          garageLine = L.polyline(garageRoad, {
            color: '#187d85', weight: 5, opacity: 0.95, lineJoin: 'round',
          }).addTo(w.map).bindTooltip('Garage → Pickup · ' + operationalKm.toFixed(2) + ' km (verified garage)');
          garageKm.textContent = operationalKm.toFixed(2) + ' km (verified garage)';
          drawArrows(garageRoad, '#187d85', garageArrows);
          fitFullRoute();
        } else garageKm.textContent = 'Route unavailable';
      } catch (e) {
        if (seq === requestSeq) garageKm.textContent = 'Route unavailable';
      }
      updateDistances();
    };
    // The picker change callback covers clicks and dragged markers. Do not
    // request on every map mouseup: that wastes routing quota while panning.
    // The shared widget recalculates the billable leg on this same option
    // change; this listener independently refreshes the empty-truck leg.
    form.querySelector('[name="route_option"]')?.addEventListener('change', () => {
      clientRoad = null;
      clearMarkers(clientArrows);
      updateGarageDistance();
    });
    wrap.addEventListener('shown.bs.modal', () => {
      w.map?.invalidateSize();
      updateGarageDistance();
    });
  },

  async rate(route, d) {
    let pricing;try{pricing=await App.api('Routes.pricing_estimate',{route_id:route.id});}catch(e){UI.toast(e.message,'error');return;}
    const revision = route.status === 'Approved';
    // Pricing records are deliberately not seeded. Explain the exact missing
    // source instead of implying that the saved road route has been lost.
    const missing=(Array.isArray(pricing.missing)?pricing.missing:[])
      .filter(item=>item!=='Verified fixed route rate at dispatch');
    const labels={
      garage:'Verified garage location is not configured',
      diesel:'Effective diesel price is not configured',
      efficiency:'Fuel efficiency for '+route.truck_type+' is not configured',
      'Verified garage-to-pickup road distance':'Garage-to-pickup road distance is not verified',
      'Verified pickup-to-delivery road distance':'Pickup-to-delivery road distance is not verified',
      'Garage road routing unavailable':'Garage-to-pickup road routing is unavailable',
      'Delivery road routing unavailable':'Pickup-to-delivery road routing is unavailable',
      'Pricing migration 13 is required':'Pricing migration 13 is not installed'
    };
    const pricingWarning=pricing.fuel===null
      ?'<div class="alert alert-warning py-2 small" role="status"><strong><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>Fuel estimate is not ready</strong>'
        +'<p class="mb-1 mt-1">The saved route distance is kept. Complete or verify these inputs to calculate the fuel charge:</p>'
        +(missing.length?'<ul class="mb-1 ps-3">'+[...new Set(missing)].map(item=>'<li>'+UI.esc(labels[item]||item)+'</li>').join('')+'</ul>'
          :'<p class="mb-1">Pricing information is incomplete.</p>')
        +'<span>Check <b>Financial Oversight → Fuel &amp; Operating Costs</b> for the diesel price, '+UI.esc(route.truck_type)+' efficiency and verified garage. If those records already exist, verify the effective dates and road-routing service.</span></div>'
      :'';
    const fields = [
      { name: 'rate_amount', label: 'Fixed Client Route Rate (PHP)', type: 'money', required: true, col: 6 },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="300"' },
    ];
    const available = (v, decimals=2) => v===null || v===undefined ? 'Unavailable' : UI.num(v,decimals);
    const fact = (label, value) => '<div class="fleet-rate-fact"><span>'+label+'</span><strong>'+value+'</strong></div>';
    const summary = '<div class="fleet-rate-editor">'
      + '<div class="fleet-rate-route"><div class="fleet-rate-eyebrow"><i class="bi bi-signpost-split"></i> ROUTE DETAILS</div>'
      + '<strong>'+UI.esc(route.client)+'</strong>'
      + '<div class="fleet-rate-route-path"><span>'+UI.esc(RouteUI.name(route))+'</span><i class="bi bi-arrow-right"></i><span>'+UI.esc(route.destination_label || route.destination || 'Destination')+'</span></div>'
      + '<div class="fleet-rate-route-meta"><span><i class="bi bi-truck"></i> '+UI.esc(route.truck_type)+'</span><span><i class="bi bi-geo-alt"></i> '+available(pricing.delivery_km)+' km delivery</span></div></div>'
      + (revision ? '<div class="alert alert-info py-2 small">Current approved rate: <b>'+RouteUI.rateText(route.rate_type,route.rate_amount,route.minimum_charge)+'</b>. It remains active until this revision is approved.</div>' : '')
      + pricingWarning
      + '<div class="fleet-rate-section-title"><i class="bi bi-fuel-pump"></i> Operational fuel estimate</div>'
      + '<div class="fleet-rate-facts">'
      + fact('Garage to pickup',available(pricing.garage_km)+' km')
      + fact('Pickup to delivery',available(pricing.delivery_km)+' km')
      + fact('Diesel price',pricing.diesel_value?UI.money(pricing.diesel_value.value)+' / L':'Unavailable')
      + fact('Truck efficiency',pricing.efficiency_value?UI.num(pricing.efficiency_value.value,4)+' km/L':'Unavailable')
      + fact('Estimated consumption',available(pricing.liters,4)+' L')
      + '</div>'
      + '<div class="fleet-rate-highlight"><div><span>Estimated fuel cost</span><small>Operating estimate, not the fixed client rate</small></div><strong>'+ (pricing.fuel===null?'Unavailable':UI.money(pricing.fuel)) +'</strong></div>'
      + '<div class="fleet-rate-section-title"><i class="bi bi-currency-exchange"></i> Client contract rate</div>'
      + UI.fields(fields)
      + '<div class="fleet-rate-total"><span>Estimated total billing <small>For review only</small></span><strong data-pricing-total>Enter fixed rate</strong></div>'
      + '</div>';
    UI.modal((revision ? 'Revise rate of ' : 'Enter rate of ') + UI.esc(route.route_ref), summary, async (f) => {
      const result = await App.api('Routes.rate_enter', { route_id: route.id, ...f, rate_type: 'Flat' });
      UI.result(result); UI.closeDrawer(); App.route();
    }, { submit: 'Send for approval', size: 'modal-lg', onShow:(wrap,form)=>{
      wrap.classList.add('fleet-rate-modal');
      const input=form.querySelector('[name=rate_amount]');
      let sequence=0;
      input?.addEventListener('change',async()=>{
        const current=++sequence;
        try{
          const estimate=await App.api('Routes.pricing_estimate',{route_id:route.id,rate_amount:input.value});
          if(current===sequence)form.querySelector('[data-pricing-total]').textContent=estimate.estimate_total===undefined?'Fuel estimate unavailable':UI.money(estimate.estimate_total)+' (estimate)';
        }catch(e){if(current===sequence)form.querySelector('[data-pricing-total]').textContent=e.message;}
      });
    } });
  },

  decide(route, decision) {
    const text = `<b>${UI.esc(route.route_ref)}</b> · ${UI.esc(route.client)} · ${UI.esc(RouteUI.name(route))} · ${UI.esc(route.truck_type)}<br>
      Proposed rate (version ${UI.esc(route.pending_version)}): <b>${RouteUI.rateText(route.pending_rate_type, route.pending_rate_amount, route.pending_minimum_charge)}</b>, entered by ${UI.e(route.pending_entered_by_name)}.
      ${route.status === 'Approved' ? `<br>Current rate: ${RouteUI.rateText(route.rate_type, route.rate_amount, route.minimum_charge)}.` : ''}
      <br><span class="small text-muted">${decision === 'approve'
        ? (route.status === 'Approved' ? 'The current rate will be replaced. Its record is kept in the history.' : 'The route can then be used for planning.')
        : (route.status === 'Approved' ? 'Only this revision is rejected. The route stays Approved with its current rate.' : 'The route request is closed. A new request is needed to use this route.')}</span>`;
    UI.confirmAction(decision === 'approve' ? 'Approve rate' : 'Reject rate', text, 'Routes.decide', { rate_id: route.pending_rate_id, decision }, {
      submit: decision === 'approve' ? 'Approve' : 'Reject', danger: decision === 'reject',
      fields: [decision === 'approve' ? { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="300"' } : { name: 'reason', label: 'Reason for rejection', required: true, col: 12, attrs: 'maxlength="300"' }],
    });
  },

  async open(id, d) {
    let r; try { r = await App.api('Routes.details', { route_id: id }); } catch (e) { return UI.toast(e.message, 'error'); }
    const x = r.route, me = d.me, can = d.can;
    const acts = [];
    if (can.rate && (x.status === 'Pending Rate' || (x.status === 'Approved' && !x.pending_rate_id)))
      acts.push(`<button class="btn btn-sm btn-primary" data-a="rate"><i class="bi bi-cash"></i> ${x.status === 'Approved' ? 'Revise rate' : 'Enter rate'}</button>`);
    if (can.approve && x.pending_rate_id) {
      acts.push('<button class="btn btn-sm btn-success" data-a="approve"><i class="bi bi-check-lg"></i> Approve rate</button>', '<button class="btn btn-sm btn-outline-danger" data-a="reject"><i class="bi bi-x-lg"></i> Reject rate</button>');
    }
    if (can.withdraw && ['Pending Rate', 'Pending Approval'].includes(x.status) && +x.requested_by === +me) acts.push('<button class="btn btn-sm btn-outline-secondary" data-a="withdraw">Withdraw request</button>');
    if (can.deactivate && x.status === 'Approved') acts.push('<button class="btn btn-sm btn-outline-danger" data-a="deactivate">Deactivate route</button>');
    const html = `<div class="mb-2">${UI.badge(x.status)} ${x.pending_rate_id && x.status === 'Approved' ? UI.badge('Pending Approval') + ' <span class="small text-muted">rate revision</span>' : ''}</div>
      ${acts.length ? `<div class="drawer-actions">${acts.join('')}</div>` : ''}
      ${UI.h('Route')}${UI.kv([['Client', `<b>${UI.esc(x.client)}</b>`], ['Origin', UI.e(x.origin_label)], ['Destination', UI.e(x.destination_label)], ['Truck type', UI.e(x.truck_type)],
        ['Distance', UI.num(x.distance_km, 2) + ' km · ' + UI.esc(x.distance_source)],
        x.distance_computed_km ? ['Computed road distance', UI.num(x.distance_computed_km, 2) + ' km · ' + UI.esc((d.routeOptions || {})[x.route_option] || x.route_option || '') + ' · ' + UI.esc(x.distance_provider || '') + ' · ' + UI.datetime(x.distance_computed_at)] : null,
        x.distance_override_reason ? ['Reason the km was changed', UI.esc(x.distance_override_reason)] : null, ['Notes', UI.e(x.notes)], ['Requested by', UI.esc(x.requested_by_name) + ' · ' + UI.datetime(x.requested_at)],
        x.closed_reason ? ['Closed', UI.esc(x.closed_reason) + (x.closed_by_name ? ' · ' + UI.esc(x.closed_by_name) : '') + (x.closed_at ? ' · ' + UI.datetime(x.closed_at) : '')] : null])}
      ${UI.h('Current approved rate')}${x.rate_id ? UI.kv([['Rate', `<b>${RouteUI.rateText(x.rate_type, x.rate_amount, x.minimum_charge)}</b>`], ['Version', UI.e(x.rate_version)], ['Effective since', UI.datetime(x.effective_from)]]) : '<div class="text-muted small">No approved rate yet.</div>'}
      ${x.pending_rate_id ? UI.h('Waiting for approval') + UI.kv([['Proposed rate', `<b>${RouteUI.rateText(x.pending_rate_type, x.pending_rate_amount, x.pending_minimum_charge)}</b>`], ['Version', UI.e(x.pending_version)], ['Entered by', UI.esc(x.pending_entered_by_name) + ' · ' + UI.datetime(x.pending_entered_at)]]) : ''}
      ${UI.h('Rate history')}<div class="fleet-route-history-scroll">${UI.table([['Version', 'version_no'], ['Rate', 'rate_amount', (v, t) => RouteUI.rateText(t.rate_type, t.rate_amount, t.minimum_charge)], ['Status', 'status', 'badge'],
        ['Entered by', 'entered_by_name'], ['Decided by', 'decided_by_name'], ['Effective start date and time', 'effective_from', 'datetime'], ['Effective end date and time', 'effective_to', 'datetime'], ['Remarks', 'decision_notes']], r.rates, { plain: true, empty: 'No rate entered yet.' })}</div>
      ${UI.h('History')}<div class="fleet-route-history-scroll">${UI.table([['Action date and time', 'created_at', 'datetime'], ['Action', 'event_type'], ['Performed by', 'actor'], ['Status', 'to_status', 'badge'], ['Details', 'notes']], r.events, { plain: true })}</div>`;
    const el = UI.drawer(UI.esc(x.route_ref), html.replace(UI.h('Current approved rate'), (x.origin_lat && x.destination_lat ? '<div class="route-map mb-3" data-routedetailmap style="height:240px"></div>' : '') + UI.h('Current approved rate')), { subtitle: 'Client route' });
    const mbox = el.querySelector('[data-routedetailmap]');
    if (mbox) setTimeout(async () => {
      const opts={ a: [+x.origin_lat, +x.origin_lng], b: [+x.destination_lat, +x.destination_lng],
        aLabel: 'Origin: ' + x.origin_label, bLabel: 'Destination: ' + x.destination_label,
        geometry: x.route_geometry || '' };
      // Existing routes have only the saved pickup-to-delivery geometry. Fetch
      // the current verified garage leg separately; no historical row is changed.
      try {
        const estimate=await App.api('Routes.pricing_estimate',{route_id:x.id});
        if(estimate.garage_preview?.garage)opts.garagePreview=estimate.garage_preview;
        else if(mbox.isConnected){
          const absent=(estimate.missing||[]).includes('garage');
          const reason=absent
            ?'No verified company garage record is effective for today. The earlier approximate garage marker was not saved as an authoritative location.'
            :(estimate.missing||[]).includes('Garage road routing unavailable')
              ?'The garage is configured, but the routing service could not verify the road to this pickup. Check the road-routing service and the garage entrance pin.'
              :'Garage-to-pickup road geometry is not available. The saved pickup-to-delivery map is unchanged.';
          mbox.insertAdjacentHTML('afterend','<div class="alert alert-warning small mt-2 mb-3" role="status">'
            +'<div><strong>Garage-to-pickup map not ready</strong></div>'
            +'<p class="mb-2">'+UI.esc(reason)+'</p>'
            +(absent&&UI.canGo('fuel-adjustment')
              ?'<button type="button" class="btn btn-sm btn-outline-primary" data-verify-garage-route>Open Company Garage settings</button>':'')
            +'</div>');
          mbox.parentElement.querySelector('[data-verify-garage-route]')?.addEventListener('click',()=>{
            UI.closeDrawer();
            UI.goTo('fuel-adjustment');
          });
        }
      }catch{ /* The original saved road geometry remains visible. */ }
      if(mbox.isConnected)UI.routeMap(mbox,null,opts);
    },350);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'rate') RouteUI.rate(x, d);
      if (a === 'approve' || a === 'reject') RouteUI.decide(x, a);
      if (a === 'withdraw') UI.confirmAction('Withdraw ' + UI.esc(x.route_ref), 'The request will be closed. Its history is kept.', 'Routes.withdraw', { route_id: x.id },
        { submit: 'Withdraw', danger: true, fields: [{ name: 'reason', label: 'Reason', required: true, col: 12, attrs: 'maxlength="300"' }] });
      if (a === 'deactivate') UI.confirmAction('Deactivate ' + UI.esc(x.route_ref), 'The route can no longer be selected. Its rates and history are kept.', 'Routes.deactivate', { route_id: x.id },
        { submit: 'Deactivate', danger: true, fields: [{ name: 'reason', label: 'Reason', required: true, col: 12, attrs: 'maxlength="300"' }] });
    });
  },
};


/* Executive route workspace is presentation-only: retains the existing
 * authorized Rate, Review, Approve, Reject and View workflows. */
/* Head Management routes use the SAME table workspace as Client Management.
 * Only the existing rate-authorized actions remain; no duplicate table toolbar. */
const HeadRouteWorkspace = {
  categories: [
    {value:'waiting',label:'Waiting',empty:'Nothing is waiting for a rate or approval.',accept:r=>RouteUI.waiting(r)},
    {value:'approved',label:'Approved',empty:'No approved routes yet.',accept:r=>r.status==='Approved'},
    {value:'closed',label:'Rejected / Withdrawn / Inactive',empty:'No closed routes.',accept:r=>['Rejected','Withdrawn','Inactive'].includes(r.status)}
  ],
  render(ctx,d) {
    const all=d.routes||[];
    const count=fn=>all.filter(fn).length;
    const initial=count(RouteUI.waiting)?'waiting':'approved';
    const ids={filter:'head-route-client-filter',sort:'head-route-record-sort'};
    const clients=[...new Map([
      ...all.map(r=>[String(r.client_id),r.client]),
      ...(d.clients||[]).map(r=>[String(r.id),r.company_name])
    ])].sort((a,b)=>String(a[1]||'').localeCompare(String(b[1]||'')));
    const types=[...new Set(all.map(r=>r.truck_type).filter(Boolean))].sort();
    const option=(value,label)=>'<option value="'+UI.esc(value)+'">'+UI.esc(label)+'</option>';
    const cols=[
      ['Route / Pickup','route_ref',(v,r)=>'<b>'+UI.esc(v||'—')+'</b><div class="cell-sub">'+UI.esc(r.origin_label||'—')+'</div>'],
      ['Client','client'],['Destination','destination_label'],
      ['Truck Type','truck_type'],
      ['Contract Rate','rate_amount',(v,r)=>RouteUI.rateText(r.rate_type,r.rate_amount,r.minimum_charge)],
      ['Status','status','badge']
    ];
    const actions=r=>{
      let buttons=UI.btn('view','View','outline-primary');
      if(d.can.rate&&r.status==='Pending Rate')buttons+=UI.btn('rate','Enter rate','primary');
      if(d.can.approve&&r.pending_rate_id)buttons+=UI.btn('decide','Review rate','primary');
      return buttons;
    };
    const action=(name,row)=>name==='rate'?RouteUI.rate(row,d):RouteUI.open(row.id,d);
    const toolbar='<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-filter-trigger" aria-controls="'+ids.filter+'" aria-expanded="false"><i class="bi bi-funnel" aria-hidden="true"></i> Filter</button>'
      +'<button type="button" class="btn btn-sm btn-outline-secondary record-workspace-sort-trigger" aria-controls="'+ids.sort+'" aria-expanded="false"><i class="bi bi-arrow-down-up" aria-hidden="true"></i> Sort</button>'
      +'<div class="record-workspace-popovers">'
      +'<div class="record-workspace-popover" id="'+ids.filter+'" hidden><strong>Filter routes</strong>'
      +'<label>Client<select class="form-select form-select-sm" data-head-route-client>'+option('','All clients')
      +clients.map(([id,name])=>option(id,name)).join('')+'</select></label>'
      +'<label>Truck type<select class="form-select form-select-sm" data-head-route-type>'+option('','All truck types')
      +types.map(type=>option(type,type)).join('')+'</select></label>'
      +'<div class="record-workspace-popover-actions">'
      +'<button type="button" class="btn btn-sm btn-outline-secondary" data-record-filter-reset>Clear</button>'
      +'<button type="button" class="btn btn-sm btn-primary" data-record-filter-apply>Apply</button></div></div>'
      +'<div class="record-workspace-popover record-workspace-sort-panel" id="'+ids.sort+'" hidden><strong>Sort routes</strong>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="head_route_sort" value="default" data-record-sort checked> Default order</label>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="head_route_sort" value="asc" data-record-sort> Route A–Z</label>'
      +'<label class="record-workspace-sort-option"><input type="radio" name="head_route_sort" value="desc" data-record-sort> Route Z–A</label>'
      +'</div></div>'
      +'<button type="button" class="btn btn-sm btn-outline-success record-workspace-export"><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>';
    const state={tab:initial,client:'',type:'',sort:'default'};
    ctx.el.innerHTML='<div class="head-route-workspace">'
      +RecordComponents.kpis([
        {label:'Approved routes',value:count(r=>r.status==='Approved'),color:'green',icon:'bi-check-circle'},
        {label:'Waiting for rate',value:count(r=>r.status==='Pending Rate'),color:'blue',icon:'bi-calendar-check'},
        {label:'Waiting for approval',value:count(r=>r.pending_rate_id),color:'amber',icon:'bi-clipboard-check',note:'new routes and rate revisions'},
        {label:'Closed / Inactive routes',value:count(r=>['Rejected','Withdrawn','Inactive'].includes(r.status)),color:'red',icon:'bi-archive'}
      ])
      +'<div data-head-route-workspace></div></div>';
    const target=ctx.el.querySelector('[data-head-route-workspace]');
    let tableId=null;
    const renderTable=()=>{
      const category=this.categories.find(item=>item.value===state.tab)||this.categories[0];
      const rows=all.filter(row=>category.accept(row)
        &&(!state.client||String(row.client_id)===state.client)
        &&(!state.type||row.truck_type===state.type));
      const table=UI.table(cols,rows,{
        tools:toolbar,showAllColumns:true,viewSwitch:false,
        actions,onAction:action,rowClick:r=>RouteUI.open(r.id,d),
        empty:category.empty
      });
      target.innerHTML=RecordComponents.panel(table,RecordComponents.categories(
        this.categories.map(({value,label})=>({value,label})),state.tab,'data-head-route-category'));
      UI.activate(target);
      RecordComponents.mountPanel(target,{title:'Route & Contract Records',addSelector:'.record-workspace-export'});
      const body=target.querySelector('[data-tbody]');
      tableId=body?.dataset.tbody||null;
      // Keep normal table columns and a disabled pager when a category is empty.
      // Native table search redraws the table; keep its empty state consistent too.
      const finish=()=>{if(tableId&&typeof HeadOversight!=='undefined')HeadOversight.finishTable(target);};
      finish();
      target.querySelector('[data-tsearch]')?.addEventListener('input',finish);
      const applySort=()=>{
        const t=tableId?UI._tables[tableId]:null;
        if(!t)return;
        if(state.sort==='default')return;
        t.rows.sort((a,b)=>(state.sort==='asc'?1:-1)
          *String(a.route_ref??'').localeCompare(String(b.route_ref??''),undefined,{numeric:true}));
        t.page=0;UI.drawTable(tableId);
      };
      applySort();
      target.querySelectorAll('[data-head-route-category]').forEach(button=>
        button.addEventListener('click',()=>{
          if(state.tab===button.dataset.headRouteCategory)return;
          state.tab=button.dataset.headRouteCategory;
          renderTable();
        }));
      const filter=target.querySelector('.record-workspace-filter-trigger');
      RecordComponents.bindDropdowns(target,{
        apply(panel){
          state.client=panel.querySelector('[data-head-route-client]').value;
          state.type=panel.querySelector('[data-head-route-type]').value;
          renderTable();
        },
        reset(){state.client='';state.type='';renderTable();},
        sort(value){state.sort=value;renderTable();}
      },ids);
      target.querySelector('[data-head-route-client]').value=state.client;
      target.querySelector('[data-head-route-type]').value=state.type;
      target.querySelectorAll('[data-record-sort]').forEach(input=>input.checked=input.value===state.sort);
      target.querySelector('.record-workspace-export')?.addEventListener('click',()=>{
        const t=tableId?UI._tables[tableId]:null;
        const visible=t?UI.tableRows(tableId):rows;
        const headers=['Route','Client','Pickup','Destination','Truck Type','Rate','Status'];
        const data=visible.map(r=>[r.route_ref,r.client,r.origin_label,r.destination_label,
          r.truck_type,RouteUI.rateText(r.rate_type,r.rate_amount,r.minimum_charge),r.status]);
        const quote=v=>'"'+String(v??'').replace(/"/g,'""')
          .replace(/^[\s\uFEFF]*[=+\-@\t\r]/,match=>"'"+match)+'"';
        const csv='\uFEFF'+[headers,...data].map(line=>line.map(quote).join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;
        a.download='mulawin_route_contract_rates_'+new Date().toISOString().slice(0,10)+'.csv';
        document.body.append(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      });
    };
    renderTable();
  }
};

App.page('routes', {
  title: 'Client Routes',
  subtitle: 'Approved routes per client and truck type, with their contractual rates. Only Approved routes can be used for planning.',
  render(ctx) {
    const d = ctx.data, me = d.me;
    if (App.me?.user?.role === 'admin') { HeadRouteWorkspace.render(ctx,d); return; }
    if (d.can.request) UI.tool(ctx, 'Request route', () => RouteUI.request(d), 'bi-plus-lg', 'primary');
    const rows = d.routes || [];
    const count = (fn) => rows.filter(fn).length;
    const clientOpts = [...new Map([...rows.map(r => [String(r.client_id), r.client]), ...(d.clients || []).map(c => [String(c.id), c.company_name])]).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    ctx.el.innerHTML = UI.cards([
      { label: 'Approved routes', value: count(r => r.status === 'Approved'), color: 'green' },
      { label: 'Waiting for rate', value: count(r => r.status === 'Pending Rate'), color: 'blue' },
      { label: 'Waiting for approval', value: count(r => r.pending_rate_id), color: 'amber', hint: 'new routes and rate revisions' },
    ]) + UI.filterModal(ctx, [{ name: 'client_id', label: 'Client', type: 'select', options: clientOpts, col: 12 }], { hint: 'Showing routes of all clients.' });
    // Short list (main details only); everything else is in the details window.
    const cols = [['Route', 'route_ref'], ['Client', 'client'], ['Origin → destination', 'origin_label', (v, r) => UI.esc(RouteUI.name(r))], ['Truck type', 'truck_type'],
      ['Km', 'distance_km', 'num'], ['Rate', 'rate_amount', (v, r) => RouteUI.rateText(r.rate_type, r.rate_amount, r.minimum_charge)], ['Status', 'status', 'badge']];
    const actions = (r) => {
      let b = UI.btn('view', 'View');
      if (d.can.rate && r.status === 'Pending Rate') b += UI.btn('rate', 'Enter rate', 'primary');
      if (d.can.approve && r.pending_rate_id ) b += UI.btn('decide', 'Review rate', 'primary');
      return b;
    };
    const onAction = (a, r) => { if (a === 'rate') RouteUI.rate(r, d); else RouteUI.open(r.id, d); };
    const list = (fn, empty) => UI.table(cols, rows.filter(fn), { actions, onAction, empty, rowClick: (r) => RouteUI.open(r.id, d) });
    UI.tabs(ctx.el, [
      ['waiting', `Waiting <span class="badge bg-secondary">${count(RouteUI.waiting)}</span>`, () => list(RouteUI.waiting, 'Nothing is waiting for a rate or approval.')],
      ['approved', 'Approved', () => list(r => r.status === 'Approved', 'No approved route yet.')],
      ['closed', 'Rejected / Withdrawn / Inactive', () => list(r => ['Rejected', 'Withdrawn', 'Inactive'].includes(r.status), 'No closed route.')],
    ], count(RouteUI.waiting) ? 'waiting' : 'approved');
    UI.activate(ctx.el);
  },
});
