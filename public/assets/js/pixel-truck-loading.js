/* Pixel truck journey — presentation-only wrapper around the shared page router.
   No fabricated progress percentages; backend completion controls arrival. */
(() => {
  'use strict';
  if (typeof App === 'undefined' || App._pixelTruckInstalled) return;
  App._pixelTruckInstalled = true;
  let token = 0;
  let showTimer = null;
  let closeTimer = null;
  let root = null;
  let entered = false;
  const pause = () => { clearTimeout(showTimer); clearTimeout(closeTimer); };
  const build = () => {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.id = 'fleet-truck-loading';
    root.className = 'fleet-truck-overlay';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Loading FleetOps page');
    root.innerHTML = `
      <div class="fleet-truck-card">
        <div class="fleet-truck-title">LOADING YOUR ROUTE<span class="fleet-truck-dots" aria-hidden="true">...</span></div>
        <div class="fleet-truck-scene" aria-hidden="true">
          <div class="fleet-truck-destination"><span class="fleet-truck-flag">⚑</span><span>DESTINATION</span></div>
          <div class="fleet-truck-vehicle">
            <svg viewBox="0 0 168 82" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" focusable="false">
              <path d="M5 18H107V59H5Z" fill="#f5f8e9" stroke="#154b34" stroke-width="4"/>
              <path d="M9 23H103V28H9Z" fill="#e3b548"/>
              <path d="M16 34H98V39H16Z" fill="#25734f" opacity=".45"/>
              <path d="M109 32H137L156 46V61H108Z" fill="#1c6d4b" stroke="#143e2f" stroke-width="4"/>
              <path d="M128 37H137L146 46H128Z" fill="#c6e8d7"/>
              <path d="M9 59H159V66H9Z" fill="#e3b548" stroke="#154b34" stroke-width="3"/>
              <path d="M111 54H151V58H111Z" fill="#f8e9ae"/>
              <rect x="8" y="13" width="103" height="6" fill="#154b34"/>
              <rect x="27" y="65" width="12" height="9" fill="#273b33"/>
              <rect x="75" y="65" width="12" height="9" fill="#273b33"/>
              <rect x="132" y="65" width="12" height="9" fill="#273b33"/>
              <g class="fleet-truck-wheels">
                <circle cx="33" cy="68" r="11" fill="#202e29"/><circle cx="33" cy="68" r="5" fill="#ddd"/>
                <circle cx="81" cy="68" r="11" fill="#202e29"/><circle cx="81" cy="68" r="5" fill="#ddd"/>
                <circle cx="138" cy="68" r="11" fill="#202e29"/><circle cx="138" cy="68" r="5" fill="#ddd"/>
              </g>
            </svg>
          </div>
          <div class="fleet-truck-road"><span></span></div>
        </div>
        <div class="fleet-truck-caption">Preparing your FleetOps data</div>
        <div class="fleet-truck-track" aria-hidden="true"><span></span></div>
        <div class="fleet-truck-note">Your truck is on the way...</div>
      </div>`;
    document.body.appendChild(root);
    return root;
  };
  const hide = () => {
    if (!root) return;
    root.classList.remove('is-visible', 'is-arrived');
    root.remove();
    root = null;
    entered = false;
  };
  const originalRoute = App.route;
  App.route = async function (...args) {
    const mine = ++token;
    pause();
    hide();
    // A short delay prevents a distracting modal on fast responses.
    showTimer = setTimeout(() => {
      if (mine !== token || !App.me) return;
      const panel = build();
      entered = true;
      requestAnimationFrame(() => { if (mine === token) panel.classList.add('is-visible'); });
    }, 240);
    try {
      return await originalRoute.apply(this, args);
    } finally {
      if (mine !== token) return;
      clearTimeout(showTimer);
      if (!entered) return;
      if (!root) return;
      root.classList.add('is-arrived');
      const note = root.querySelector('.fleet-truck-note');
      if (note) note.textContent = 'Destination reached';
      closeTimer = setTimeout(() => {
        if (mine === token) hide();
      }, 500);
    }
  };
  window.addEventListener('pagehide', () => { ++token; pause(); hide(); });
})();