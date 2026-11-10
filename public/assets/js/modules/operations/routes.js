/* assets/js/modules/operations/routes.js — CLIENT ROUTES (Checklist #20)
   Approved routes per client and truck type, with versioned contractual rates.
   Provisional flow: Operations Head requests -> Billing enters the rate -> Admin approves / rejects.
   A rate revision of an Approved route keeps the old rate in use until the Admin approves the new one.
   Only Approved routes will be selectable in planning (not connected to Trip Management yet).
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

  request(d) {
    const fields = [
      { type: 'html', col: 12, html: `<section class="rpm-route-garage" aria-label="Fixed company initial point">
        <div class="rpm-route-garage-icon"><i class="bi bi-house-door" aria-hidden="true"></i></div>
        <div class="rpm-route-garage-copy"><div class="rpm-route-garage-top"><strong>Company garage</strong><span><i class="bi bi-lock" aria-hidden="true"></i> Fixed initial point</span></div>
        <div>R.P. Mulawin Trucking Service</div><small>Purok 2, 86-A, Luyos, Tanauan City, Batangas</small></div>
      </section>` },
      { name: 'client_id', label: 'Client', type: 'select', required: true, col: 8, options: UI.opts(d.clients, c => c.company_name + (c.status !== 'Active' ? ` (${c.status})` : '')), value: d.filterClient || '' },
      { name: 'truck_type', label: 'Truck type', type: 'select', required: true, col: 4, options: UI.list(d.truckTypes) },
      { name: 'origin', label: 'Pickup point', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. TANAUAN, BATANGAS' },
      { name: 'destination', label: 'Delivery point', required: true, col: 6, attrs: 'maxlength="200"', placeholder: 'e.g. MALVAR, BATANGAS' },
      { type: 'html', col: 12, html: `<section class="rpm-route-map-shell">
        <div class="rpm-route-map-heading"><div><i class="bi bi-map" aria-hidden="true"></i> Route preview</div><span>Follow the roads in travel order</span></div>
        <div class="rpm-route-steps" aria-label="Driving sequence"><span class="rpm-step-garage"><b>1</b> Garage</span><i class="bi bi-chevron-right" aria-hidden="true"></i><span class="rpm-step-pickup"><b>2</b> Pickup</span><i class="bi bi-chevron-right" aria-hidden="true"></i><span class="rpm-step-delivery"><b>3</b> Destination</span></div>
        <div data-routemapbox></div>
        <div class="rpm-route-legend"><span><i class="rpm-route-line-key garage-road"></i> Garage → Pickup</span><span><i class="rpm-route-line-key delivery-road"></i> Pickup → Delivery</span><span class="rpm-route-legend-note"><i class="bi bi-info-circle" aria-hidden="true"></i> Garage location approximate</span></div>
      </section>` },
      { type: 'hidden', name: 'origin_lat' }, { type: 'hidden', name: 'origin_lng' }, { type: 'hidden', name: 'destination_lat' }, { type: 'hidden', name: 'destination_lng' },
      // Route option, km, distance info and override reason: shared widget (assets/js/map.js), same as Trip Management.
      ...UI.distanceFieldDefs().filter(f => f.name === 'route_option'),
      { name: 'distance_km', label: 'Pickup → delivery distance (km)', type: 'number', step: '0.01', min: '0.01', required: true, col: 4, attrs: `max="${+d.maxDistance}"`,
        help: d.routing ? 'Filled in from the road distance when both points are pinned. You may change it (a reason is required).' : 'Type the km (automatic road distance is not set up on the server).' },
      ...UI.distanceFieldDefs().filter(f => f.name !== 'route_option'),
      { type: 'html', col: 12, html: `<div class="rpm-route-distances" aria-label="Distance summary">
        <div><span>Garage → Pickup</span><strong data-garage-km>Not available</strong></div>
        <div><span>Pickup → Delivery (billable)</span><strong data-client-km>Enter distance</strong></div>
        <div><span>Total operational distance</span><strong data-total-km>Not available</strong></div>
      </div><p class="rpm-route-distance-note" data-garage-note>Garage distance is optional operational information. The client's billable route remains pickup to delivery.</p>` },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="500"' },
    ];
    UI.modal('Request a new route', '<p class="rpm-route-intro">Select a client and truck type, then pin pickup and delivery points. The company garage is fixed. The client route covers pickup to delivery only; return trips are separate.</p>'
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
      const r = await App.api('Routes.request', f); UI.result(r); App.route();
    }, { submit: 'Send request', size: 'rpm-route-dialog', onShow: (wrap, form) => RouteUI.wireDistance(wrap, form), extraFooter: '<small class="rpm-route-footer-note">Next: Billing rate → Admin approval</small>' });
  },

  /** Map, route option, automatic km and manual override of the Request route form (Checklist #5; shared widget in map.js). */
  wireDistance(wrap, form) {
    // The two road geometries are independent: the existing distance widget
    // continues to own the billable Pickup → Delivery segment (blue), while
    // this screen draws Garage → Pickup (teal) as an operational overlay.
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
      const locations = [[L.latLng([14.126449, 121.070384]), '1', 'Garage'],
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
    // A local, reference-only garage pin: coordinates are provisional until the
    // actual yard entrance has been verified. Never submit these to the route API.
    const garage = [14.126449, 121.070384];
    if (w.map && typeof L !== 'undefined') {
      L.circleMarker(garage, { radius: 8, color: '#34526a', fillColor: '#34526a', fillOpacity: 0.95, weight: 2, interactive: true })
        .addTo(w.map).bindTooltip('Stop 1: R.P. Mulawin garage (approximate; entrance not verified)');
      updateStopLabels();
    }
    const billable = form.querySelector('[name="distance_km"]');
    const clientKm = form.querySelector('[data-client-km]');
    const garageKm = form.querySelector('[data-garage-km]');
    const totalKm = form.querySelector('[data-total-km]');
    const garageNote = form.querySelector('[data-garage-note]');
    let operationalKm = null, lastPickup = '';
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
      const key = pickup ? pickup.lat.toFixed(6) + ',' + pickup.lng.toFixed(6) : '';
      if (key === lastPickup) return;
      lastPickup = key;
      const seq = ++requestSeq;
      if (garageLine) { garageLine.remove(); garageLine = null; }
      clearMarkers(garageArrows);
      garageRoad = null;
      operationalKm = null;
      garageKm.textContent = pickup ? 'Checking…' : 'Pin pickup first';
      garageNote.textContent = 'Garage location on the map is approximate. Verify the garage entrance before using operational distance estimates.';
      updateDistances();
      if (!pickup || !UI.Map.serviceReady()) {
        garageKm.textContent = UI.Map.serviceReady() ? 'Pin pickup first' : 'Routing unavailable';
        return;
      }
      try {
        const r = await UI.Map.route(L.latLng(garage), pickup, form.querySelector('[name="route_option"]')?.value || UI.Map.cfg().defaultRouteOption);
        if (seq !== requestSeq) return;
        if (r.available && Number.isFinite(+r.distance_km) && r.geometry) {
          const points = UI.Map.decode(r.geometry);
          if (points.length < 2) throw new Error('Missing garage road geometry');
          operationalKm = +r.distance_km;
          garageRoad = points;
          garageLine = L.polyline(garageRoad, {
            color: '#187d85', weight: 5, opacity: 0.95, lineJoin: 'round',
          }).addTo(w.map).bindTooltip('Garage → Pickup · ' + operationalKm.toFixed(2) + ' km (approximate garage)');
          garageKm.textContent = operationalKm.toFixed(2) + ' km (estimate)';
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
    form.querySelector('[name="route_option"]')?.addEventListener('change', () => {
      lastPickup = '';
      clientRoad = null;
      clearMarkers(clientArrows);
      updateGarageDistance();
    });
    wrap.addEventListener('shown.bs.modal', () => {
      w.map?.invalidateSize();
      updateGarageDistance();
    });
  },

  rate(route, d) {
    const revision = route.status === 'Approved';
    const fields = [
      { name: 'rate_amount', label: 'Rate (PHP)', type: 'money', required: true, col: 6 },
      { name: 'notes', label: 'Notes (optional)', col: 12, attrs: 'maxlength="300"' },
    ];
    const intro = `<p class="modal-intro"><b>${UI.esc(route.route_ref)}</b> · ${UI.esc(route.client)} · ${UI.esc(RouteUI.name(route))} · ${UI.esc(route.truck_type)} · ${UI.num(route.distance_km, 2)} km</p>`
      + (revision ? `<div class="alert alert-info py-2 small">Current approved rate: <b>${RouteUI.rateText(route.rate_type, route.rate_amount, route.minimum_charge)}</b>. It stays in use until the Admin approves this revision.</div>` : '');
    UI.modal((revision ? 'Revise rate of ' : 'Enter rate of ') + UI.esc(route.route_ref), intro + UI.fields(fields), async (f) => {
      const r = await App.api('Routes.rate_enter', { route_id: route.id, ...f, rate_type: 'Flat' }); UI.result(r); UI.closeDrawer(); App.route();
    }, { submit: 'Send for approval', size: '' });
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
      if (+x.pending_entered_by === +me) acts.push('<span class="small text-muted align-self-center">You entered this rate, so another approver must decide it.</span>');
      else acts.push('<button class="btn btn-sm btn-success" data-a="approve"><i class="bi bi-check-lg"></i> Approve rate</button>', '<button class="btn btn-sm btn-outline-danger" data-a="reject"><i class="bi bi-x-lg"></i> Reject rate</button>');
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
      ${UI.h('Rate history')}${UI.table([['Version', 'version_no'], ['Rate', 'rate_amount', (v, t) => RouteUI.rateText(t.rate_type, t.rate_amount, t.minimum_charge)], ['Status', 'status', 'badge'],
        ['Entered by', 'entered_by_name'], ['Decided by', 'decided_by_name'], ['Effective start date and time', 'effective_from', 'datetime'], ['Effective end date and time', 'effective_to', 'datetime'], ['Remarks', 'decision_notes']], r.rates, { plain: true, empty: 'No rate entered yet.' })}
      ${UI.h('History')}${UI.table([['Action date and time', 'created_at', 'datetime'], ['Action', 'event_type'], ['Performed by', 'actor'], ['Status', 'to_status', 'badge'], ['Details', 'notes']], r.events, { plain: true })}`;
    const el = UI.drawer(UI.esc(x.route_ref), html.replace(UI.h('Current approved rate'), (x.origin_lat && x.destination_lat ? '<div class="route-map mb-3" data-routedetailmap style="height:240px"></div>' : '') + UI.h('Current approved rate')), { subtitle: 'Client route' });
    const mbox = el.querySelector('[data-routedetailmap]');
    if (mbox) setTimeout(() => UI.routeMap(mbox, null, { a: [+x.origin_lat, +x.origin_lng], b: [+x.destination_lat, +x.destination_lng],
      aLabel: 'Origin: ' + x.origin_label, bLabel: 'Destination: ' + x.destination_label, geometry: x.route_geometry || '' }), 350);
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

App.page('routes', {
  title: 'Client Routes',
  subtitle: 'Approved routes per client and truck type, with their contractual rates. Only Approved routes can be used for planning.',
  render(ctx) {
    const d = ctx.data, me = d.me;
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
      if (d.can.approve && r.pending_rate_id && +r.pending_entered_by !== +me) b += UI.btn('decide', 'Review rate', 'primary');
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
