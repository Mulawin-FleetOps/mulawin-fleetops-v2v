/* assets/js/map.js — MAPS (Leaflet + OpenStreetMap tiles; Checklist #5)
   Moved out of core.js. Loaded right after core.js on every page.

   - Map tiles: OpenStreetMap (MAP_TILE_URL in .env), attribution always visible.
   - Address search, map-point address and ROAD DISTANCE go through OUR server
     (Maps.geocode / Maps.reverse / Maps.route -> backend/Core/Routing.php -> openrouteservice).
     The browser never sees the openrouteservice API key.
   - Manual entry always works: when the map service is not set up or does not answer,
     addresses and km are typed as before.

   Public helpers (same names as before, so Trip Management keeps working unchanged):
     UI.Map                                   tiles, search, reverse, route, polyline decoding
     UI.mapPicker(box, form, initial, opts)   two-point picker (pickup / destination)
     UI.routeMap(box, t, opts)                read-only map (trip details, route details)
     UI.distanceFieldDefs(opts) / UI.distanceWidget(form, opts)
                                              road km + route option + manual override (+ approved route
                                              choice) shared by Client Routes and Trip Management */
'use strict';
UI.Map = {
  cfg() { return (App.me && App.me.map) || {}; },
  /** True when road distance and address search are set up on the server (ORS_API_KEY present). */
  serviceReady() { return !!this.cfg().routing; },
  attribution() {
    return `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${UI.esc(this.cfg().tileAttribution || '© OpenStreetMap contributors')}</a>`;
  },
  /** Adds the OpenStreetMap tile layer; returns false (and shows a notice) when the map cannot be used. */
  tiles(map, notice) {
    const url = this.cfg().tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const layer = L.tileLayer(url, { maxZoom: 19, minZoom: 4, attribution: this.attribution() }).addTo(map);
    let errors = 0, loaded = 0;
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => { errors++; if (errors === 4 && loaded === 0) notice('Map tiles could not load (no internet or the tile server is busy). You can still type the addresses and the km.'); });
    return true;
  },
  cache(kind, q) { try { const v = sessionStorage.getItem('geo:' + kind + ':' + q); return v ? JSON.parse(v) : null; } catch { return null; } },
  save(kind, q, v) { try { sessionStorage.setItem('geo:' + kind + ':' + q, JSON.stringify(v)); } catch { } },
  /** Address search (Philippines) through our server. Results are cached for the session (and on the server). */
  async search(q) {
    q = q.trim(); if (q.length < 3) return [];
    const hit = this.cache('f', q.toLowerCase()); if (hit) return hit;
    const r = await App.api('Maps.geocode', { q });
    const out = (r.results || []).map(x => ({ name: x.name, lat: +x.lat, lng: +x.lng }));
    this.save('f', q.toLowerCase(), out); return out;
  },
  /** Address of a map point through our server ('' when unknown or unavailable). */
  async reverse(lat, lng) {
    const k = lat.toFixed(4) + ',' + lng.toFixed(4); const hit = this.cache('r', k); if (hit !== null) return hit;
    const r = await App.api('Maps.reverse', { lat: lat.toFixed(6), lng: lng.toFixed(6) });
    const name = r.address || '';
    if (name) this.save('r', k, name);
    return name;
  },
  /** Road route between two Leaflet points: {available, distance_km, duration_min, geometry, warning, message, ...}. */
  route(a, b, option) {
    return App.api('Maps.route', { from_lat: a.lat.toFixed(6), from_lng: a.lng.toFixed(6), to_lat: b.lat.toFixed(6), to_lng: b.lng.toFixed(6), option });
  },
  /** Decodes an encoded polyline (precision 5, as returned by openrouteservice) into [[lat, lng], ...]. */
  decode(str) {
    const out = []; let i = 0, lat = 0, lng = 0;
    str = String(str || '');
    while (i < str.length) {
      for (const which of [0, 1]) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= str.length);
        const d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (which === 0) lat += d; else lng += d;
      }
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  },
  icon: (k) => L.divIcon({ className: 'pin-icon ' + k, html: '<i class="bi bi-geo-alt-fill"></i>', iconSize: [30, 30], iconAnchor: [15, 29] }),
};

/**
 * Location picker: search an address or click the map to pin the two points; pins can be dragged.
 * The address fields stay editable (manual entry always works).
 * Default fields (Trip Management): pickup_point / pickup_lat / pickup_lng and delivery_point / delivery_lat / delivery_lng.
 * opts.fields  = { pickup: {addr, lat, lng}, delivery: {addr, lat, lng} }  other field names (e.g. Client Routes)
 * opts.labels  = { pickup: 'Origin', delivery: 'Destination' }
 * opts.footNote = text at the bottom right
 * opts.onChange(points, picker) = called when a pin is set or moved; points = {pickup, delivery} (Leaflet LatLng or null)
 * Returns the Leaflet map; map.picker = { showRoute([[lat,lng],...]), clearRoute(), points() }.
 */
UI.mapPicker = (box, form, initial = {}, opts = {}) => {
  const F = Object.assign({ pickup: { addr: 'pickup_point', lat: 'pickup_lat', lng: 'pickup_lng' }, delivery: { addr: 'delivery_point', lat: 'delivery_lat', lng: 'delivery_lng' } }, opts.fields || {});
  const LBL = Object.assign({ pickup: 'Pickup', delivery: 'Destination' }, opts.labels || {});
  const field = (n) => form.querySelector(`[name="${n}"]`);
  const searchReady = UI.Map.serviceReady();
  box.innerHTML = `<div class="loc-picker">
      <div class="loc-toolbar">
        <div class="seg" role="group" aria-label="Which point to set">
          <button type="button" class="seg-btn active" data-pin="pickup"><span class="pin-dot pickup"></span> ${UI.esc(LBL.pickup)}</button>
          <button type="button" class="seg-btn" data-pin="delivery"><span class="pin-dot delivery"></span> ${UI.esc(LBL.delivery)}</button>
        </div>
        <div class="loc-search ${opts.hideSearchBar ? 'd-none' : ''}"><i class="bi bi-search"></i><input type="search" class="form-control" placeholder="Search a place or address in the Philippines" aria-label="Search a place" data-locq>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-locgo>Search</button></div>
      </div>
      <div class="loc-results d-none" data-locres></div>
      <div class="loc-notice d-none" data-locnote></div>
      <div class="map-canvas" data-mapcanvas></div>
      <div class="loc-foot"><span data-mapinfo>Choose ${UI.esc(LBL.pickup)} or ${UI.esc(LBL.delivery)}, then search or click the map.</span><span class="text-muted">${UI.esc(opts.footNote || 'Straight-line distance is a guide only. Type the billable km.')}</span></div>
    </div>`;
  const note = (msg) => { const n = box.querySelector('[data-locnote]'); n.textContent = msg; n.classList.toggle('d-none', !msg); };
  if (typeof L === 'undefined') { note('The map library did not load. Type the addresses and the km.'); box.querySelector('[data-mapcanvas]').remove(); return null; }
  const map = L.map(box.querySelector('[data-mapcanvas]'), { scrollWheelZoom: opts.scrollWheelZoom === true, doubleClickZoom: true, touchZoom: true, boxZoom: true }).setView([14.08, 121.15], 9);
  UI.Map.tiles(map, note);
  if (!searchReady) {
    box.querySelectorAll('[data-locq],[data-locgo]').forEach(x => x.disabled = true);
    note('Address search is not set up on the server. Click the map to pin the points, and type the addresses.');
  }
  const pins = {}; let active = 'pickup'; let line = null; let routeLine = null;
  const info = box.querySelector('[data-mapinfo]');
  const label = (k) => LBL[k].toLowerCase();
  const addrField = (k) => field(F[k].addr);
  const points = () => ({ pickup: pins.pickup ? pins.pickup.getLatLng() : null, delivery: pins.delivery ? pins.delivery.getLatLng() : null });
  const picker = {
    points,
    /** Activate a point from an external address field without changing the other pin. */
    selectPoint(kind, address = '') {
      if (kind !== 'pickup' && kind !== 'delivery') return;
      setActive(kind);
      if (address.trim() && searchReady) {
        const target = opts.searchResultsTarget?.(kind);
        if (target) target.appendChild(res);
        q.value = address.trim();
        runSearch();
      } else if (address.trim() && !searchReady) {
        note('Address search is unavailable. Click the map to place the ' + label(kind) + ' pin.');
      }
    },
    /** Clear outdated coordinates if the address is manually edited. */
    clearPoint(kind) {
      if (!pins[kind]) return;
      pins[kind].remove();
      delete pins[kind];
      update();
    },
    showRoute(latlngs) {
      if (routeLine) routeLine.remove();
      if (line) { line.remove(); line = null; }
      routeLine = L.polyline(latlngs, { color: '#0b5cad', weight: 4, opacity: 0.85 }).addTo(map);
      map.attributionControl.addAttribution('Route: ' + UI.esc(UI.Map.cfg().routeAttribution || 'openrouteservice'));
      map.fitBounds(routeLine.getBounds().pad(0.15));
    },
    clearRoute() { if (routeLine) { routeLine.remove(); routeLine = null; } update(true); },
    /** Places both pins from code (approved route), without address lookup and without onChange. */
    setPoints(a, b) {
      place('pickup', L.latLng(a[0], a[1]), '', false, true);
      place('delivery', L.latLng(b[0], b[1]), '', false, true);
      map.fitBounds(L.latLngBounds([pins.pickup.getLatLng(), pins.delivery.getLatLng()]).pad(0.3));
    },
  };
  map.picker = picker;
  function update(silent) {
    ['pickup', 'delivery'].forEach(k => { const p = pins[k]?.getLatLng(); if (field(F[k].lat)) { field(F[k].lat).value = p ? p.lat.toFixed(7) : ''; field(F[k].lng).value = p ? p.lng.toFixed(7) : ''; } });
    if (line) { line.remove(); line = null; }
    if (routeLine) { routeLine.remove(); routeLine = null; }
    if (pins.pickup && pins.delivery) {
      const a = pins.pickup.getLatLng(), b = pins.delivery.getLatLng();
      if (!opts.hideStraightLine) line = L.polyline([a, b], { color: '#1f2328', weight: 2, dashArray: '6 6' }).addTo(map);
      info.textContent = opts.hideStraightLine
        ? 'Pickup and delivery pinned · road route requires the routing service. Straight lines are not driving routes.'
        : `Both points set · straight-line distance ${(a.distanceTo(b) / 1000).toFixed(1)} km`;
    }
    if (!silent && opts.onChange) opts.onChange(points(), picker);
  }
  /** Fills the address field from the map point; never overwrites what the user typed without asking. */
  const suggest = async (k, latlng, name) => {
    const f = addrField(k); if (!f) return;
    let addr = name;
    if (!addr && searchReady) { try { addr = await UI.Map.reverse(latlng.lat, latlng.lng); } catch { addr = ''; } }
    if (!addr) return;
    if (!f.value.trim()) { f.value = addr; f.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (f.value.trim() === addr) return;
    const tip = document.createElement('div'); tip.className = 'loc-suggest';
    tip.innerHTML = `<span>Map address for the ${UI.esc(label(k))}: <b></b></span><button type="button" class="btn btn-sm btn-link p-0">Use it</button>`;
    tip.querySelector('b').textContent = addr;
    tip.querySelector('button').onclick = () => { f.value = addr; f.dispatchEvent(new Event('input', { bubbles: true })); tip.remove(); };
    const host = f.closest('.rpm-address-pin-control')?.parentElement || f.parentElement;
    host.querySelectorAll('.loc-suggest').forEach(x => x.remove()); host.append(tip);
  };
  const place = (k, latlng, name = '', fly = false, silent = false) => {
    if (pins[k]) pins[k].setLatLng(latlng);
    else {
      pins[k] = L.marker(latlng, { draggable: true, icon: UI.Map.icon(k), keyboard: true, title: LBL[k] }).addTo(map).bindTooltip(LBL[k]);
      pins[k].on('dragend', () => { update(); suggest(k, pins[k].getLatLng()); });
    }
    if (fly) map.setView(latlng, Math.max(map.getZoom(), 14));
    update(silent); if (!silent) suggest(k, L.latLng(latlng), name);
  };
  const setActive = (k) => { active = k; box.querySelectorAll('[data-pin]').forEach(b => b.classList.toggle('active', b.dataset.pin === k)); info.textContent = `Click the map or search to set the ${label(k)}.`; };
  box.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => setActive(b.dataset.pin));
  map.on('click', (e) => { place(active, e.latlng); if (active === 'pickup' && !pins.delivery) setActive('delivery'); });
  // address search (button or Enter only: no search-as-you-type, to protect the daily quota)
  const q = box.querySelector('[data-locq]'), res = box.querySelector('[data-locres]');
  let searchSeq = 0;
  const runSearch = async () => {
    if (!searchReady) return;
    const kind = active, seq = ++searchSeq;
    if (q.value.trim().length < 3) { res.innerHTML = '<div class="loc-res-msg">Type at least 3 letters.</div>'; res.classList.remove('d-none'); return; }
    res.innerHTML = '<div class="loc-res-msg"><span class="spinner-border spinner-border-sm"></span> Searching…</div>'; res.classList.remove('d-none');
    try {
      const list = await UI.Map.search(q.value);
      if (seq !== searchSeq) return;
      res.innerHTML = list.length ? list.map((r, i) => `<button type="button" class="loc-res" data-ri="${i}"><i class="bi bi-geo-alt"></i> <span></span></button>`).join('') : '<div class="loc-res-msg">No place found. Try another name, or type the address in the field below.</div>';
      res.querySelectorAll('[data-ri]').forEach(b => { const r = list[+b.dataset.ri]; b.querySelector('span').textContent = r.name;
        b.onclick = () => {
          place(kind, L.latLng(r.lat, r.lng), r.name, true);
          res.classList.add('d-none'); q.value = '';
          if (kind === 'pickup' && !pins.delivery) setActive('delivery');
          opts.onSearchSelect?.(kind);
        }; });
    } catch (e) {
      if (seq !== searchSeq) return;
      res.innerHTML = `<div class="loc-res-msg text-danger">${UI.esc(e.message)} You can still pin the location manually on the map.</div>`;
    }
  };
  box.querySelector('[data-locgo]').onclick = runSearch;
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  // saved points (edit / review): placed silently (no address lookup, no route call)
  const ini = (k) => initial[F[k].lat] ? L.latLng(+initial[F[k].lat], +initial[F[k].lng]) : null;
  if (ini('pickup')) place('pickup', ini('pickup'), initial[F.pickup.addr] || '', false, true);
  if (ini('delivery')) place('delivery', ini('delivery'), initial[F.delivery.addr] || '', false, true);
  if (pins.pickup && pins.delivery) map.fitBounds(L.latLngBounds([pins.pickup.getLatLng(), pins.delivery.getLatLng()]).pad(0.3));
  else if (pins.pickup) map.setView(pins.pickup.getLatLng(), 13);
  if (pins.pickup && !pins.delivery) setActive('delivery');
  setTimeout(() => map.invalidateSize(), 250);
  return map;
};

/**
 * Read-only map.
 *   Trip details (unchanged):   UI.routeMap(box, trip)  -> uses pickup_* / delivery_* fields, dashed straight line
 *   Other records:              UI.routeMap(box, null, { a: [lat, lng], b: [lat, lng], aLabel, bLabel, geometry })
 *                               geometry = encoded road line (drawn instead of the straight line)
 */
UI.routeMap = (box, t, opts = null) => {
  const o = opts || (t && t.pickup_lat && t.delivery_lat ? { a: [+t.pickup_lat, +t.pickup_lng], b: [+t.delivery_lat, +t.delivery_lng], aLabel: 'Pickup: ' + t.pickup_point, bLabel: 'Destination: ' + t.delivery_point } : null);
  if (typeof L === 'undefined' || !o || !o.a || !o.b) { box.innerHTML = ''; box.classList.add('d-none'); return; }
  const map = L.map(box, { scrollWheelZoom: false });
  UI.Map.tiles(map, (msg) => { box.insertAdjacentHTML('beforebegin', `<div class="loc-notice">${UI.esc(msg)}</div>`); });
  L.marker(o.a, { icon: UI.Map.icon('pickup') }).addTo(map).bindTooltip(o.aLabel || 'Origin');
  L.marker(o.b, { icon: UI.Map.icon('delivery') }).addTo(map).bindTooltip(o.bLabel || 'Destination');
  let bounds = L.latLngBounds([o.a, o.b]);
  if (o.geometry) {
    const pts = UI.Map.decode(o.geometry);
    if (pts.length > 1) {
      const pl = L.polyline(pts, { color: '#0b5cad', weight: 4, opacity: 0.85 }).addTo(map);
      bounds = bounds.extend(pl.getBounds());
      map.attributionControl.addAttribution('Route: ' + UI.esc(UI.Map.cfg().routeAttribution || 'openrouteservice'));
    }
  } else {
    L.polyline([o.a, o.b], { color: '#1f2328', weight: 2, dashArray: '6 6' }).addTo(map);
  }
  map.fitBounds(bounds.pad(0.2)); setTimeout(() => map.invalidateSize(), 300);
};

/**
 * Form fields of the distance widget (put them next to the km field named distance_km).
 * opts.withRoutePick = true adds "Approved client route" (Trip Management).
 */
UI.distanceFieldDefs = (opts = {}) => {
  const cfg = UI.Map.cfg();
  return [
    ...(opts.withRoutePick ? [{ name: 'client_route_id', label: 'Approved client route (optional)', type: 'select', col: 12, options: [], value: opts.routeId || '',
      placeholder: 'None: pin the points on the map', help: 'Approved routes of the chosen client and truck type. Billing still uses the client rate per km.' }] : []),
    ...(cfg.routing ? [{ name: 'route_option', label: 'Route option', type: 'select', col: opts.optionCol || 8, placeholder: false,
      value: opts.option || cfg.defaultRouteOption || 'recommended', options: Object.entries(cfg.routeOptions || {}),
      help: 'Used for the road distance. The company still has to confirm the toll-road policy.' }] : []),
    { type: 'html', name: 'km_info', col: 12, html: '<div class="small" data-kminfo></div>' },
    { name: 'distance_override_reason', label: 'Reason for changing the computed km', required: true, col: 12, value: opts.reason || '', attrs: 'maxlength="300"' },
  ];
};

/**
 * Road distance widget (Checklist #5): map pins -> road km from OUR server (Maps.route), route
 * option, "use the computed km", required reason when the km is changed, 15% warning, manual km
 * when the service is not available, and (trips) the choice of an approved client route.
 * The server decides again on save; this only helps the person fill in the form.
 *
 * opts.mapBox    element for the map           opts.fields / opts.labels / opts.footNote  -> UI.mapPicker
 * opts.initial   saved record (edit / review): its pins, km, source, reference km, line, route
 * opts.routePick { clientField | clientId, truckField | truckType } (when client_route_id is in the form)
 * Returns { clean(data), state }; also stored as form._distance.
 */
UI.distanceWidget = (form, opts = {}) => {
  const cfg = UI.Map.cfg(), ratio = +cfg.overrideWarningRatio || 0.15, ini = opts.initial || {};
  const q = (sel) => form.querySelector(sel);
  const km = q('[name=distance_km]'), opt = q('[name=route_option]'), info = q('[data-kminfo]'), pick = q('[name=client_route_id]');
  const reasonEl = q('[name=distance_override_reason]'), reasonBox = reasonEl ? reasonEl.closest('[class*="col-"]') : null;
  const st = { computed: null, kind: null, seq: 0, route: null };
  const noService = '<span class="text-muted">Automatic road distance is not set up on the server. Type the km.</span>';
  const ref = () => st.kind === 'route' ? 'approved route distance' : 'computed road distance';
  const checkOverride = () => {
    const show = st.computed !== null && km && km.value !== '' && Math.abs(+km.value - st.computed) >= 0.005;
    if (reasonBox) reasonBox.classList.toggle('d-none', !show);
    const warn = info && info.querySelector('[data-kmwarn]');
    if (warn) warn.textContent = show && Math.abs(+km.value - st.computed) > ratio * st.computed
      ? `Warning: the km differs from the ${ref()} by more than ${Math.round(ratio * 100)}%.` : '';
  };
  const say = (html) => { if (info) info.innerHTML = html; checkOverride(); };
  const useBtn = (label) => ` <button type="button" class="btn btn-link btn-sm p-0 ms-2" data-usekm>${label}</button><div class="text-warning" data-kmwarn></div>`;
  const wireUse = () => { const b = info && info.querySelector('[data-usekm]'); if (b) b.onclick = () => { km.value = st.computed.toFixed(2); km.dispatchEvent(new Event('input', { bubbles: true })); checkOverride(); }; };
  if (reasonBox) reasonBox.classList.add('d-none');
  if (km) km.addEventListener('input', checkOverride);

  let picker = null;
  const leaveRouteMode = () => {
    if (st.kind !== 'route') return;
    st.kind = null; st.route = null; st.computed = null;
    if (pick) pick.value = '';
    if (opt) opt.disabled = false;
  };
  const compute = async (points) => {
    leaveRouteMode();
    st.computed = null; st.kind = null;
    const seq = ++st.seq;
    if (!cfg.routing) { say(noService); return; }
    if (!points.pickup || !points.delivery) { say('<span class="text-muted">Pin both points to get the road distance.</span>'); return; }
    say('<span class="text-muted"><span class="spinner-border spinner-border-sm"></span> Computing the road distance…</span>');
    let r;
    try { r = await UI.Map.route(points.pickup, points.delivery, opt ? opt.value : cfg.defaultRouteOption); }
    catch (e) { r = { available: false, message: e.message }; }
    if (seq !== st.seq) return;   // an older answer: ignore
    if (!r.available) { say(`<span class="text-danger">${UI.esc(r.message || 'Road distance is not available.')}</span> <span class="text-muted">Type the km.</span>`); return; }
    st.computed = +r.distance_km; st.kind = 'map';
    km.value = st.computed.toFixed(2); km.dispatchEvent(new Event('input', { bubbles: true }));
    if (r.geometry && picker) {
      const roadPoints = UI.Map.decode(r.geometry);
      picker.showRoute(roadPoints);
      if (opts.onRoadRoute) opts.onRoadRoute(roadPoints);
    }
    say(`Road distance: <b>${UI.num(r.distance_km, 2)} km</b> · about ${UI.num(r.duration_min, 0)} min · ${UI.esc(r.option_label)}
      <span class="text-muted">(straight line ${UI.num(r.straight_km, 1)} km)</span>
      ${r.warning ? `<div class="text-warning">${UI.esc(r.warning)}</div>` : ''}${useBtn('Use the computed km')}`);
    wireUse();
  };
  const map = opts.mapBox ? UI.mapPicker(opts.mapBox, form, ini, { fields: opts.fields, labels: opts.labels, scrollWheelZoom: opts.scrollWheelZoom, hideStraightLine: opts.hideStraightLine,
    hideSearchBar: opts.hideSearchBar, searchResultsTarget: opts.searchResultsTarget, onSearchSelect: opts.onSearchSelect, onChange: (pts) => {
    if (opts.onPointsChange) opts.onPointsChange(pts);
    compute(pts);
  },
    footNote: opts.footNote || (cfg.routing ? 'Road distance by openrouteservice (estimate). Check it before saving.' : 'Type the km.') }) : null;
  picker = map ? map.picker : null;
  if (opt) opt.addEventListener('change', () => { if (picker && st.kind !== 'route') compute(picker.points()); });

  // ----- saved record (review / edit) -----
  if (ini.distance_computed_km != null && ini.distance_source && ini.distance_source !== 'Manual') {
    st.computed = +ini.distance_computed_km; st.kind = ini.client_route_id ? 'route' : 'map';
    if (st.kind === 'route' && opt) opt.disabled = true;
    if (ini.route_geometry && picker) setTimeout(() => picker.showRoute(UI.Map.decode(ini.route_geometry)), 300);
    say(`Saved ${st.kind === 'route' ? 'approved route' : 'road'} distance: <b>${UI.num(ini.distance_computed_km, 2)} km</b> · ${UI.esc(ini.distance_source)}
      ${ini.route_option && (cfg.routeOptions || {})[ini.route_option] ? ' · ' + UI.esc(cfg.routeOptions[ini.route_option]) : ''}${useBtn(st.kind === 'route' ? 'Use the route km' : 'Use the computed km')}`);
    wireUse();
  } else if (ini.pickup_lat && ini.delivery_lat) {
    say(cfg.routing ? '<span class="text-muted">The saved km was typed (Manual). Move a pin or change the route option to compute the road distance.</span>' : noService);
  } else if (!cfg.routing) say(noService);

  // ----- approved client route (Trip Management) -----
  if (pick) {
    const rp = opts.routePick || {};
    const clientId = () => rp.clientId || (rp.clientField && q(`[name=${rp.clientField}]`) ? q(`[name=${rp.clientField}]`).value : '');
    const truckType = () => rp.truckType || (rp.truckField && q(`[name=${rp.truckField}]`) ? q(`[name=${rp.truckField}]`).value : '');
    const savedId = ini.client_route_id ? String(ini.client_route_id) : '';
    const fill = (routes, msg) => {
      const keep = pick.value || savedId;
      pick.innerHTML = `<option value="">${UI.esc(msg)}</option>` + routes.map(r => `<option value="${r.id}">${UI.esc(r.route_ref + ' · ' + r.origin_label + ' → ' + r.destination_label + ' · ' + UI.num(r.distance_km, 2) + ' km')}</option>`).join('')
        + (savedId && !routes.some(r => String(r.id) === savedId) ? `<option value="${UI.esc(savedId)}">${UI.esc((ini.client_route_ref || 'Saved route') + ' (saved; no longer offered for new trips)')}</option>` : '');
      pick.value = [...pick.options].some(o => o.value === keep) ? keep : '';
      if (keep && pick.value === '' && st.kind === 'route') { leaveRouteMode(); say(''); }
    };
    let loadSeq = 0;
    const load = async () => {
      const c = clientId(), t = truckType(), seq = ++loadSeq;
      if (!c || !t) { fill([], 'Choose the client and truck type first'); pick.disabled = !savedId; return; }
      pick.disabled = false;
      try { const r = await App.api('Routes.selectable', { client_id: c, truck_type: t }); if (seq === loadSeq) { st.routes = r.routes || []; fill(st.routes, st.routes.length ? 'None: pin the points on the map' : 'No approved route for this client and truck type'); } }
      catch (e) { if (seq === loadSeq) fill([], 'Approved routes are not available right now'); }
    };
    pick.addEventListener('change', async () => {
      if (!pick.value) { leaveRouteMode(); st.kind = null; st.computed = null; if (opt) opt.disabled = false; if (picker) compute(picker.points()); else say(''); return; }
      if (pick.value === savedId && ini.client_route_id) { st.kind = 'route'; st.computed = +ini.distance_computed_km; if (opt) opt.disabled = true; checkOverride(); return; }
      let r;
      try { r = (await App.api('Routes.selectable', { client_id: clientId(), truck_type: truckType(), route_id: pick.value })).routes[0]; } catch (e) { r = null; }
      if (!r) { pick.value = ''; say('<span class="text-danger">That route can no longer be used. Choose another one or pin the points.</span>'); return; }
      st.seq++; st.kind = 'route'; st.route = r; st.computed = +r.distance_km;
      if (opt) { if (r.route_option) opt.value = r.route_option; opt.disabled = true; }
      const setText = (n, v) => { const f = q(`[name=${n}]`); if (f && v) { f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); } };
      setText((opts.fields && opts.fields.pickup && opts.fields.pickup.addr) || 'pickup_point', r.origin_label);
      setText((opts.fields && opts.fields.delivery && opts.fields.delivery.addr) || 'delivery_point', r.destination_label);
      if (picker && r.origin_lat && r.destination_lat) {
        picker.setPoints([+r.origin_lat, +r.origin_lng], [+r.destination_lat, +r.destination_lng]);
        if (r.route_geometry) picker.showRoute(UI.Map.decode(r.route_geometry));
      }
      km.value = st.computed.toFixed(2); km.dispatchEvent(new Event('input', { bubbles: true }));
      say(`Approved route <b>${UI.esc(r.route_ref)}</b>: <b>${UI.num(r.distance_km, 2)} km</b>${r.route_option && (cfg.routeOptions || {})[r.route_option] ? ' · ' + UI.esc(cfg.routeOptions[r.route_option]) : ''}
        <span class="text-muted">(billing still uses the client rate per km)</span>${useBtn('Use the route km')}`);
      wireUse();
    });
    [rp.clientField, rp.truckField].filter(Boolean).forEach(n => { const f = q(`[name=${n}]`); if (f) f.addEventListener('change', load); });
    load();
  }

  const widget = {
    state: st,
    map,
    /** Removes what the server must not receive (it decides again anyway). */
    clean(d) {
      if (st.kind === 'route') delete d.route_option;
      if (st.computed === null) { delete d.route_option; delete d.distance_override_reason; }
      else if (Math.abs(+d.distance_km - st.computed) < 0.005) delete d.distance_override_reason;
      return d;
    },
    /** Short text for summaries: where the km comes from. */
    sourceText() {
      if (st.computed === null) return 'typed';
      const changed = km && km.value !== '' && Math.abs(+km.value - st.computed) >= 0.005;
      return (st.kind === 'route' ? 'approved route' : 'road distance') + (changed ? ', changed by hand' : '');
    },
  };
  form._distance = widget;
  return widget;
};

