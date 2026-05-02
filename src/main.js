import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

/* Runtime configuration */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const VEST_URL = (import.meta.env.VITE_VEST_BASE_URL || '').trim().replace(/\/+$/, '');
const GEOCODE_URL = API_BASE_URL ? `${API_BASE_URL}/geocode` : '';
const GENERATE_AND_SCORE_URL = API_BASE_URL ? `${API_BASE_URL}/routes/generate-and-score` : '';

async function signalVest(type) {
  // type: 'turn' | 'hazard' | 'reststop' | 'arrived'
  if (!VEST_URL) return;
  try {
    await fetch(`${VEST_URL}/${type}`, { mode: 'no-cors' });
  } catch(e) {
    // Vest not connected - fail silently so app keeps working.
  }
}

    /* ── State ── */
    let currentDestination = '';
    let currentPolyline = null;
    let currentPois = [];
    let currentRoute = null;
    let currentRoutes = [];
    let currentRouteResponse = null;
    let selectedRoutePreference = 'shortest';
    let leafletMap = null;
    let navTimers = [];

    const ROUTE_PREFERENCE_META = {
      shortest: { label: 'Shortest Walk', description: 'Fastest arrival time' },
      easiest: { label: 'Easiest Terrain', description: 'Smoother route conditions' },
      restful: { label: 'Frequent Rest Stops', description: 'More nearby resting options' },
    };

    const POI_CONFIG = {
      cracked_sidewalk:   { bg: '#F59E0B', emoji: '⚠️', label: 'Cracked sidewalk — switch to the other side of the street' },
      unmarked_crosswalk: { bg: '#EF4444', emoji: '🛑', label: 'Unmarked crosswalk — stop and look both ways slowly before crossing' },
      bench:              { bg: '#10B981', emoji: '🪑', label: 'Bench — rest stop available here' },
      stone_wall:         { bg: '#10B981', emoji: '🧱', label: 'Stone wall — you can lean here for a rest' },
      obstacle:           { bg: '#F59E0B', emoji: '⚠️', label: 'Reported route obstacle' },
      crossing_issue:     { bg: '#EF4444', emoji: '🛑', label: 'Reported crossing issue' },
      rest_stop:          { bg: '#10B981', emoji: '🪑', label: 'Rest stop' },
    };

    /* ── Screen routing ── */
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      window.scrollTo(0, 0);
    }

    /* ── Screen 1 logic ── */
    const startInput = document.getElementById('startInput');
    const destInput  = document.getElementById('destInput');
    const startBtn   = document.getElementById('startBtn');
    let lastFocused  = 'dest'; // which input was last focused
    let acTimer      = null;

    startInput.addEventListener('focus', () => { lastFocused = 'start'; });
    destInput.addEventListener('focus',  () => { lastFocused = 'dest'; });
    startInput.addEventListener('input', () => { updateReadyState(); triggerAc('start'); });
    destInput.addEventListener('input',  () => { updateReadyState(); triggerAc('dest'); });
    startInput.addEventListener('blur',  () => setTimeout(() => closeAc('start'), 200));
    destInput.addEventListener('blur',   () => setTimeout(() => closeAc('dest'),  200));
    [startInput, destInput].forEach(input => {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && startBtn.classList.contains('active') && !startBtn.disabled) {
          startNav();
        }
      });
    });

    function updateReadyState() {
      const ready = !!startInput.value.trim() && !!destInput.value.trim();
      startBtn.classList.toggle('active', ready);
    }

    function setApiError(message) {
      const errorEl = document.getElementById('apiError');
      if (!message) {
        errorEl.hidden = true;
        errorEl.textContent = '';
        return;
      }
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    /* Nominatim autocomplete */
    function triggerAc(field) {
      clearTimeout(acTimer);
      const input = field === 'start' ? startInput : destInput;
      const q = input.value.trim();
      if (q.length < 3) { closeAc(field); return; }
      acTimer = setTimeout(() => fetchAc(q, field), 320);
    }
    async function fetchAc(q, field) {
      if (!GEOCODE_URL) { closeAc(field); return; }
      try {
        const res = await fetchWithTimeout(GEOCODE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        }, 8000);
        if (!res.ok) throw new Error(await readBackendError(res));
        const data = await res.json();
        renderAc(data.matches || [], field);
      } catch(e) { closeAc(field); }
    }
    function formatAcLabel(it) {
      const displayName = String(it.display_name || '').trim();
      if (!displayName) return 'Unnamed result';
      return displayName.split(',').slice(0, 3).join(',').trim();
    }
    function renderAc(items, field) {
      const drop = document.getElementById(`ac-${field}`);
      if (!items.length) { drop.classList.remove('open'); return; }
      drop.innerHTML = items.map(it => {
        const label = formatAcLabel(it);
        const safeLabel = escapeHtml(label);
        return `<div class="ac-item" tabindex="-1"
          data-name="${safeLabel}"
          data-lat="${it.lat}" data-lon="${it.lon}">${safeLabel}</div>`;
      }).join('');
      drop.querySelectorAll('.ac-item').forEach(el => {
        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('click', () => pickAc(
          field, el.dataset.name,
          parseFloat(el.dataset.lat), parseFloat(el.dataset.lon)
        ));
      });
      drop.classList.add('open');
    }
    function pickAc(field, name, lat, lon) {
      const input = field === 'start' ? startInput : destInput;
      input.value = name;
      closeAc(field);
      updateReadyState();
    }
    function closeAc(field) {
      document.getElementById(`ac-${field}`).classList.remove('open');
    }

    function selectLoc(card) {
      const input = lastFocused === 'start' ? startInput : destInput;
      input.value = card.dataset.name;
      updateReadyState();
      /* highlight the card briefly */
      document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      setTimeout(() => card.classList.remove('active'), 800);
    }

    function selectPref(btn) {
      document.querySelectorAll('.route-pref-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      selectedRoutePreference = btn.dataset.pref || 'shortest';
    }

    async function fetchWithTimeout(url, options = {}, ms = 8000) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), ms);
      try {
        const res = await fetch(url, { ...options, signal: abort.signal });
        clearTimeout(timer);
        return res;
      } catch(e) { clearTimeout(timer); throw e; }
    }

    async function fetchScoredRoute(originText, destinationText) {
      const payload = {
        origin: { address: originText },
        destination: { address: destinationText },
        mode: 'pedestrian',
        route_preference: selectedRoutePreference,
        alternatives: 3,
      };

      if (!GENERATE_AND_SCORE_URL) {
        throw new Error('Missing VITE_API_BASE_URL. Set it to your HTTPS routing backend URL.');
      }

      console.log('generate-and-score request:', payload);
      const res = await fetchWithTimeout(GENERATE_AND_SCORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 30000);
      console.log('generate-and-score status:', res.status);

      if (!res.ok) {
        throw new Error(await readBackendError(res));
      }

      const data = await res.json();
      console.log('generate-and-score response:', data);
      return data;
    }

    async function readBackendError(res) {
      try {
        const data = await res.json();
        const message = data?.error?.message || data?.detail || data?.message;
        if (message) return `Backend ${res.status}: ${message}`;
      } catch(e) {
        // Fall through to a status-only error.
      }
      return `Backend ${res.status}: ${res.statusText || 'route request failed'}`;
    }

    function getReturnedRoutes(data) {
      const routes = data?.routes || [];
      if (!routes.length) throw new Error('No routes were returned for those addresses.');
      return routes;
    }

    function getRouteLatLngs(route) {
      const coords = route?.geojson?.coordinates || route?.decoded_shape || [];
      return coords.map(point => [point[1], point[0]]).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    }

    function getFeaturePoint(feature) {
      const location = feature?.location;
      if (Number.isFinite(location?.lat) && Number.isFinite(location?.lon)) {
        return { lat: location.lat, lng: location.lon };
      }
      const coords = feature?.geojson?.coordinates;
      const lng = feature?.geometry?.x ?? coords?.[0];
      const lat = feature?.geometry?.y ?? coords?.[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    }

    function getRoutePois(route) {
      const raw = route?.score?.raw_arcgis || {};
      const obstacles = (raw.pois || []).map(feature => {
        const point = getFeaturePoint(feature);
        if (!point) return null;
        const attrs = feature.attributes || {};
        const category = String(attrs.obstacle_category || '').toLowerCase();
        const type = category.includes('cross') ? 'crossing_issue' : 'obstacle';
        const detail = [attrs.obstacle_category, attrs.obstacle_type, attrs.severity].filter(Boolean).join(' · ');
        return { ...point, type, label: detail || POI_CONFIG[type].label };
      }).filter(Boolean);

      const restStops = (raw.rest_stops || []).map(feature => {
        const point = getFeaturePoint(feature);
        if (!point) return null;
        const restType = feature.rest_type || feature.type || 'Rest stop';
        const restQuality = feature.rest_quality_raw || (
          Number.isFinite(feature.rest_quality_score) ? `Quality ${feature.rest_quality_score}` : ''
        );
        const label = [restType, restQuality].filter(Boolean).join(' · ') || POI_CONFIG.rest_stop.label;
        return { ...point, type: 'rest_stop', label };
      }).filter(Boolean);

      return [...obstacles, ...restStops];
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    function shortPlace(value) {
      const text = String(value || '').trim();
      if (!text) return 'your destination';
      return text.split(',').slice(0, 2).join(',').trim();
    }

    function formatDistance(meters) {
      if (!Number.isFinite(meters)) return 'Unknown';
      const miles = meters / 1609.344;
      return miles >= 0.1 ? `${miles.toFixed(2)} mi` : `${Math.round(meters)} m`;
    }

    function formatDuration(seconds) {
      if (!Number.isFinite(seconds)) return 'Unknown';
      return `${Math.max(1, Math.round(seconds / 60))} min`;
    }

    function formatMetric(value, suffix = '') {
      return value === null || value === undefined ? 'N/A' : `${value}${suffix}`;
    }

    function getRestStopNote(status) {
      if (!status) return '';
      if (status.configured && status.queried && status.available) return '';
      return status.reason || 'Rest stop source reported limited availability.';
    }

    function setCurrentRoute(route) {
      currentRoute = route;
      currentPolyline = getRouteLatLngs(route);
      currentPois = getRoutePois(route);
      if (!currentPolyline.length) {
        throw new Error('The route did not include displayable geometry.');
      }
    }

    function renderRouteSummary(data, routes) {
      const summary = document.getElementById('routeSummary');
      const originName = data?.origin?.display_name || data?.origin?.address || startInput.value.trim();
      const destinationName = data?.destination?.display_name || data?.destination?.address || destInput.value.trim();
      const preferenceMeta = ROUTE_PREFERENCE_META[selectedRoutePreference] || ROUTE_PREFERENCE_META.shortest;
      const restStopNote = getRestStopNote(routes[0]?.score?.rest_stop_source_status);

      document.getElementById('routeDestLabel').textContent = `To ${shortPlace(destinationName)}`;
      document.querySelectorAll('#screen-routes > .route-card').forEach(card => { card.hidden = true; });

      summary.innerHTML = `
        <div class="route-meta">
          <div class="route-meta-row">
            <div class="route-meta-label">From</div>
            <div class="route-meta-value">${escapeHtml(shortPlace(originName))}</div>
          </div>
          <div class="route-meta-row">
            <div class="route-meta-label">To</div>
            <div class="route-meta-value">${escapeHtml(shortPlace(destinationName))}</div>
          </div>
        </div>

        <div class="route-note">Compared ${escapeHtml(routes.length)} route option${routes.length === 1 ? '' : 's'} using ${escapeHtml(preferenceMeta.label)}.</div>
        ${routes.map((route, index) => {
          const score = route.score || {};
          const metrics = score.metrics || {};
          const pointCount = route.geojson?.coordinates?.length || route.decoded_shape?.length || metrics.route_point_count || 0;
          const title = index === 0 ? `Recommended for ${preferenceMeta.label}` : `Alternative ${index + 1}`;
          const subtitle = index === 0 ? preferenceMeta.description : (route.route_id || `Route ${index + 1}`);
          return `
            <button class="route-card recommended-route-card" onclick="chooseRoute(${index})" aria-label="Open ${escapeHtml(title)} on map">
              <div class="card-top">
                <div class="card-left">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                    <circle cx="20" cy="20" r="18" stroke="#1E5EFF" stroke-width="2.5"/>
                    <path d="M12 21 L18 27 L29 13" stroke="#1E5EFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <div class="card-title">
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(subtitle)}</p>
                  </div>
                </div>
                <div class="time-badge">${escapeHtml(formatDuration(route.duration_s))}</div>
              </div>
              <div class="route-metrics-grid">
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(formatDistance(route.distance_m))}</div><div class="route-metric-label">Distance</div></div>
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(formatMetric(score.overall_score))}</div><div class="route-metric-label">Overall score</div></div>
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(formatMetric(metrics.obstacle_count))}</div><div class="route-metric-label">Obstacles</div></div>
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(formatMetric(metrics.crossing_issue_count))}</div><div class="route-metric-label">Crossing issues</div></div>
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(formatMetric(metrics.rest_stop_count))}</div><div class="route-metric-label">Rest stops</div></div>
                <div class="route-metric"><div class="route-metric-value">${escapeHtml(pointCount)}</div><div class="route-metric-label">Route points</div></div>
              </div>
              ${score.explanation ? `<div class="route-explanation">${escapeHtml(score.explanation)}</div>` : ''}
            </button>
          `;
        }).join('')}
        ${restStopNote ? `<div class="route-note">Rest stop data: ${escapeHtml(restStopNote)}</div>` : ''}
      `;
      summary.classList.remove('hidden');
    }

    async function startNav() {
      const start = startInput.value.trim();
      const dest  = destInput.value.trim();
      if (!start || !dest) return;

      setApiError('');
      startBtn.textContent = 'Finding route...';
      startBtn.disabled = true;

      try {
        currentRouteResponse = await fetchScoredRoute(start, dest);
        currentRoutes = getReturnedRoutes(currentRouteResponse);
        setCurrentRoute(currentRoutes[0]);
        currentDestination = currentRouteResponse.destination?.display_name || dest;

        renderRouteSummary(currentRouteResponse, currentRoutes);
        showScreen('screen-routes');
      } catch(e) {
        console.error('generate-and-score failed:', e);
        const corsHint = ' If this appears only in the browser, the hosted backend likely needs CORS enabled for this local origin.';
        setApiError(`${e.message || 'Route request failed.'}${e instanceof TypeError ? corsHint : ''}`);
      } finally {
        startBtn.textContent = 'Start Navigation';
        startBtn.disabled = false;
      }
    }

    function chooseRoute(index) {
      const route = currentRoutes[index];
      if (!route) return;
      setCurrentRoute(route);
      goToNav();
    }

    /* ── Screen 3: Leaflet map ── */
    function goToNav() {
      if (!currentPolyline?.length) {
        setApiError('No route geometry is available yet. Enter addresses and generate a route first.');
        showScreen('screen-start');
        return;
      }

      document.getElementById('streetName').textContent = currentRoute?.route_id || 'Recommended route';
      document.getElementById('timeVal').textContent = formatDuration(currentRoute?.duration_s);
      document.getElementById('distanceText').textContent = formatDistance(currentRoute?.distance_m);
      document.getElementById('sidewalkInstruction').textContent = 'Follow selected route';
      document.getElementById('instructionText').textContent = 'Continue ahead';

      showScreen('screen-nav');
      setTimeout(() => initMap(currentPolyline, currentPois), 50);
    }

    function initMap(coords, pois) {
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }

      leafletMap = L.map('leaflet-map', { zoomControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(leafletMap);

      const poly = L.polyline(coords, {
        color: '#1E5EFF', weight: 6, opacity: 0.9, lineJoin: 'round',
      }).addTo(leafletMap);

      // Start marker (blue)
      L.circleMarker(coords[0], {
        radius: 9, fillColor: '#1E5EFF', color: 'white', weight: 3, fillOpacity: 1,
      }).addTo(leafletMap);

      // End marker (green)
      L.circleMarker(coords[coords.length - 1], {
        radius: 9, fillColor: '#10B981', color: 'white', weight: 3, fillOpacity: 1,
      }).addTo(leafletMap);

      // Points of interest
      (pois || []).forEach(poi => {
        const cfg = POI_CONFIG[poi.type] || { bg: '#6B7280', emoji: '📍', label: poi.type };
        const label = poi.label || cfg.label;
        const icon = L.divIcon({
          html: `<div style="background:${cfg.bg};width:36px;height:36px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;">${cfg.emoji}</div>`,
          iconSize: [36, 36], iconAnchor: [18, 18], className: '',
        });
        const isHazard   = ['cracked_sidewalk','unmarked_crosswalk','obstacle','crossing_issue'].includes(poi.type);
        const isRestStop = ['bench','stone_wall','rest_stop'].includes(poi.type);
        L.marker([poi.lat, poi.lng], { icon })
          .bindPopup(`<div style="font-size:14px;max-width:200px;">${escapeHtml(label)}</div>`, { maxWidth: 220 })
          .on('popupopen', () => signalVest(isHazard ? 'hazard' : isRestStop ? 'reststop' : 'turn'))
          .addTo(leafletMap);
      });

      leafletMap.fitBounds(poly.getBounds(), { padding: [40, 40] });
    }

    function goToCelebration() {
      navTimers.forEach(clearTimeout);
      document.getElementById('celDestName').textContent = currentDestination || 'your destination';
      document.getElementById('celMinutes').textContent = currentRoute?.duration_s ? Math.max(1, Math.round(currentRoute.duration_s / 60)) : '--';
      document.getElementById('celMiles').textContent = currentRoute?.distance_m ? (currentRoute.distance_m / 1609.344).toFixed(2) : '--';
      signalVest('arrived');
      spawnConfetti();
      showScreen('screen-celebration');
    }

    let muted = false;
    function toggleMute() {
      muted = !muted;
      document.getElementById('volIcon').innerHTML = muted
        ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
        : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
    }

    const groundingExercises = [
      'Feel both feet on the ground. Wiggle your toes. Take another deep breath.',
      'Take another deep breath in and smell the air around you. What do you notice? Take a final deep breath.',
      'Slowly scan your head from left to right. Take in your surroundings. What do you notice? Take another deep breath.',
      'If you are near a building or a tree, pause and put a hand on it. What is the texture? Take a deep breath.',
      'Look around and think of three things you can see right now. Name them out loud, or quietly to yourself. Take a deep breath.',
      'Calm your body and mind and listen. What are three sounds you hear? Name them out loud, or quietly to yourself. Take a deep breath.',
      'Give yourself a hug. Squeeze as tightly as is comfortable for you. Take a deep breath.',
      'Shake your hands out quickly for 5 seconds. Find stillness. Take a deep breath.',
    ];
    let groundingIndex = 0;

    function showGroundingExercise(index) {
      groundingIndex = index;
      document.getElementById('groundingCounter').textContent = `Exercise ${index + 1} of ${groundingExercises.length}`;
      document.getElementById('groundingPrompt').textContent = groundingExercises[index];
    }

    function openGrounding() {
      showGroundingExercise(Math.floor(Math.random() * groundingExercises.length));
      document.getElementById('groundingModal').classList.remove('hidden');
    }

    function nextGrounding() {
      if (breathing) toggleBreath();
      showGroundingExercise((groundingIndex + 1) % groundingExercises.length);
    }

    function closeGrounding() {
      document.getElementById('groundingModal').classList.add('hidden');
      if (breathing) toggleBreath();
    }
    let breathing = false;
    function toggleBreath() {
      breathing = !breathing;
      document.getElementById('breathOuter').classList.toggle('playing', breathing);
      document.getElementById('playBtn').innerHTML = breathing
        ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause'
        : '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Breathing Exercise';
    }

    /* ── Screen 4 logic ── */
    function spawnConfetti() {
      document.querySelectorAll('.confetti-piece').forEach(e => e.remove());
      const colors = ['#1E5EFF','#FFC700','#10B981','#F59E0B','#EF4444','#8B5CF6'];
      for (let i = 0; i < 60; i++) {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        const size = 8 + Math.random() * 8;
        el.style.cssText = `left:${Math.random()*100}%;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random()*colors.length)]};border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${2+Math.random()*2}s;animation-delay:${Math.random()}s;`;
        document.body.appendChild(el);
      }
    }

    /* ── Expose handlers used by existing inline markup ── */
    Object.assign(window, {
      showScreen,
      selectLoc,
      selectPref,
      chooseRoute,
      startNav,
      goToNav,
      toggleMute,
      goToCelebration,
      openGrounding,
      nextGrounding,
      closeGrounding,
      toggleBreath,
    });
