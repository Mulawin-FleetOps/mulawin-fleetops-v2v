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
     UI.routeMap(box, t, opts)                read-only map (trip details, route details) */
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
        <div class="loc-search"><i class="bi bi-search"></i><input type="search" class="form-control" placeholder="Search a place or address in the Philippines" aria-label="Search a place" data-locq>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-locgo>Search</button></div>
      </div>
      <div class="loc-results d-none" data-locres></div>
      <div class="loc-notice d-none" data-locnote></div>
      <div class="map-canvas" data-mapcanvas></div>
      <div class="loc-foot"><span data-mapinfo>Choose ${UI.esc(LBL.pickup)} or ${UI.esc(LBL.delivery)}, then search or click the map.</span><span class="text-muted">${UI.esc(opts.footNote || 'Straight-line distance is a guide only. Type the billable km.')}</span></div>
    </div>`;
  const note = (msg) => { const n = box.querySelector('[data-locnote]'); n.textContent = msg; n.classList.toggle('d-none', !msg); };
  if (typeof L === 'undefined') { note('The map library did not load. Type the addresses and the km.'); box.querySelector('[data-mapcanvas]').remove(); return null; }
  const map = L.map(box.querySelector('[data-mapcanvas]'), { scrollWheelZoom: false }).setView([14.08, 121.15], 9);
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
    showRoute(latlngs) {
      if (routeLine) routeLine.remove();
      if (line) { line.remove(); line = null; }
      routeLine = L.polyline(latlngs, { color: '#0b5cad', weight: 4, opacity: 0.85 }).addTo(map);
      map.attributionControl.addAttribution('Route: ' + UI.esc(UI.Map.cfg().routeAttribution || 'openrouteservice'));
      map.fitBounds(routeLine.getBounds().pad(0.15));
    },
    clearRoute() { if (routeLine) { routeLine.remove(); routeLine = null; } update(true); },
  };
  map.picker = picker;
  function update(silent) {
    ['pickup', 'delivery'].forEach(k => { const p = pins[k]?.getLatLng(); if (field(F[k].lat)) { field(F[k].lat).value = p ? p.lat.toFixed(7) : ''; field(F[k].lng).value = p ? p.lng.toFixed(7) : ''; } });
    if (line) { line.remove(); line = null; }
    if (routeLine) { routeLine.remove(); routeLine = null; }
    if (pins.pickup && pins.delivery) {
      const a = pins.pickup.getLatLng(), b = pins.delivery.getLatLng();
      line = L.polyline([a, b], { color: '#1f2328', weight: 2, dashArray: '6 6' }).addTo(map);
      info.textContent = `Both points set · straight-line distance ${(a.distanceTo(b) / 1000).toFixed(1)} km`;
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
    f.parentElement.querySelectorAll('.loc-suggest').forEach(x => x.remove()); f.parentElement.append(tip);
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
  const runSearch = async () => {
    if (!searchReady) return;
    if (q.value.trim().length < 3) { res.innerHTML = '<div class="loc-res-msg">Type at least 3 letters.</div>'; res.classList.remove('d-none'); return; }
    res.innerHTML = '<div class="loc-res-msg"><span class="spinner-border spinner-border-sm"></span> Searching…</div>'; res.classList.remove('d-none');
    try {
      const list = await UI.Map.search(q.value);
      res.innerHTML = list.length ? list.map((r, i) => `<button type="button" class="loc-res" data-ri="${i}"><i class="bi bi-geo-alt"></i> <span></span></button>`).join('') : '<div class="loc-res-msg">No place found. Try another name, or type the address in the field below.</div>';
      res.querySelectorAll('[data-ri]').forEach(b => { const r = list[+b.dataset.ri]; b.querySelector('span').textContent = r.name;
        b.onclick = () => { place(active, L.latLng(r.lat, r.lng), r.name, true); res.classList.add('d-none'); q.value = ''; if (active === 'pickup' && !pins.delivery) setActive('delivery'); }; });
    } catch (e) { res.innerHTML = `<div class="loc-res-msg text-danger">${UI.esc(e.message)} Type the address in the field below.</div>`; }
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
