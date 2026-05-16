import { getSpots }                              from './firebase.js';
import { getLocation, haversine, formatDistance } from './geo.js';
import { getWindForecast, getWindAtTimeSync, degToLabel } from './weather.js';

// ── Konstanten ───────────────────────────────────────────────────────────────

const WIND_DIRS = [
  { label: 'N',  deg: 0   }, { label: 'NO', deg: 45  },
  { label: 'O',  deg: 90  }, { label: 'SO', deg: 135 },
  { label: 'S',  deg: 180 }, { label: 'SW', deg: 225 },
  { label: 'W',  deg: 270 }, { label: 'NW', deg: 315 },
];

const DISZIPLIN_LABELS = {
  welle_gross: 'Welle groß', welle_klein: 'Welle klein', flachwasser: 'Flachwasser',
};
const LEVEL_LABELS = {
  beginner: 'Beginner', intermediate: 'Intermediate',
  expert: 'Expert', experts_only: 'Experts only',
};
const RADIUS_OPTIONS = [
  { label: '20 km', value: 20  },
  { label: '50 km', value: 50  },
  { label: '100 km', value: 100 },
  { label: 'Alle',  value: null },
];

const CACHE_KEY       = 'spots_v2';
const FILTER_SAVE_KEY = 'filters_v4';

// ── State ─────────────────────────────────────────────────────────────────────

let allSpots      = [];
let userLoc       = null;
let windForecast  = null;
let autoWind      = null;
let manualWindDir = null;
let selectedTime  = 'now';
let radius        = null;   // null = alle (kein Pflichtfilter)
let filters       = { disziplinen: new Set(), sport: new Set(), level: new Set(), text: '', land: '', region: '' };
let filtersOpen   = false;
let mapView       = false;
let sortBy        = null;   // null=auto | 'name' | 'dist'
let leafletMap    = null;
let mapMarkers    = [];
let mapFitted     = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const locBar        = document.getElementById('loc-bar');
const locText       = document.getElementById('loc-text');
const resultsList   = document.getElementById('results-list');
const resultCount   = document.getElementById('result-count');
const resultsWrap   = document.getElementById('results-wrap');
const mapContainer  = document.getElementById('map-container');
const mapToggle     = document.getElementById('map-toggle');
const adminLink     = document.getElementById('admin-link');
const searchInput   = document.getElementById('search-input');
const searchClear   = document.getElementById('search-clear');
const windLoading   = document.getElementById('wind-loading');
const windDisplay   = document.getElementById('wind-display');
const windManualDiv = document.getElementById('wind-manual');
const windOverride  = document.getElementById('wind-override');
const windEditBtn   = document.getElementById('wind-edit-btn');
const windAutoBtn   = document.getElementById('wind-auto-btn');
const windLabelText = document.getElementById('wind-label-text');
const windSpeedText = document.getElementById('wind-speed-text');
const windManualGrp = document.getElementById('wind-manual-group');
const windOverLabel = document.getElementById('wind-override-label');
const windOverComp  = document.getElementById('wind-override-compass');
const windCompassEl = document.getElementById('wind-compass-svg');
const timeSelector  = document.getElementById('time-selector');
const radiusGroup   = document.getElementById('radius-group');
const filterBtn     = document.getElementById('filter-btn');
const filterCount   = document.getElementById('filter-count');
const filterPanel   = document.getElementById('filter-panel');
const diszGroup     = document.getElementById('disz-group');
const sportGroup    = document.getElementById('sport-group');
const levelGroup    = document.getElementById('level-group');
const filterLand    = document.getElementById('filter-land');
const filterRegion  = document.getElementById('filter-region');
const filterReset   = document.getElementById('filter-reset');
const sortToggle    = document.getElementById('sort-toggle');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  loadSavedFilters();
  buildRadiusButtons();
  buildAdditionalFilters();
  buildManualWindButtons();
  wireTimeSelector();
  wireFilterPanel();
  wireSearch();
  wireMapToggle();
  wireFilterReset();
  wireSortToggle();

  try {
    const { auth, onAuthStateChanged, getUserRole } = await import('./firebase.js');
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      const role = await getUserRole(user.uid);
      if (role === 'admin' || role === 'editor') adminLink.classList.remove('hidden');
    });
  } catch (_) {}

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      allSpots = JSON.parse(cached);
      buildLandDropdown(allSpots);
      render();
    } catch (_) {}
  }

  getSpots().then(spots => {
    allSpots = spots;
    localStorage.setItem(CACHE_KEY, JSON.stringify(spots));
    buildLandDropdown(spots);
    render();
  }).catch(err => {
    console.error('Firebase:', err);
    if (allSpots.length === 0) setLocState('err', 'Spots nicht erreichbar');
  });

  requestGPS();
}

// ── GPS ───────────────────────────────────────────────────────────────────────

async function requestGPS() {
  setLocState('loading', 'Standort wird ermittelt…');
  try {
    userLoc = await getLocation();
    setLocState('ok', `${userLoc.lat.toFixed(3)}°, ${userLoc.lng.toFixed(3)}°`);
    fetchLocationName(userLoc.lat, userLoc.lng);
    render();
    loadWindData();
  } catch (_) {
    setLocState('err', 'Kein GPS — Distanz nicht verfügbar');
    disableRadius();
    showWindState('manual');
  }
}

// ── Standortname via Nominatim (Task 6) ──────────────────────────────────────

async function fetchLocationName(lat, lng) {
  const KEY = 'location_name';
  const cached = sessionStorage.getItem(KEY);
  if (cached) { locText.textContent = cached; return; }
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'WindsurfSpotFinder/1.0' } }
    );
    const data = await res.json();
    const place = data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.county ?? null;
    const label = place ? `Wind bei ${place}` : `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
    sessionStorage.setItem(KEY, label);
    locText.textContent = label;
  } catch (_) {}
}

// ── Winddaten laden ───────────────────────────────────────────────────────────

async function loadWindData() {
  if (!userLoc) return;
  showWindState('loading');
  try {
    windForecast = await getWindForecast(userLoc.lat, userLoc.lng);
    if (manualWindDir !== null) {
      showWindState('override');
    } else {
      updateAutoWind();
      showWindState('auto');
    }
    render();
  } catch (err) {
    console.error('Wind:', err);
    showWindState('manual');
  }
}

function updateAutoWind() {
  if (!windForecast) { autoWind = null; return; }
  const entry = getWindAtTimeSync(windForecast, getTargetDate());
  autoWind = entry ?? null;
  if (autoWind) {
    windLabelText.textContent = `${autoWind.label} — ${autoWind.direction}°`;
    windSpeedText.textContent = `${autoWind.speed} kn`;
    windCompassEl.innerHTML   = compassSvg(autoWind.direction);
  }
}

function getTargetDate() {
  const now = new Date();
  switch (selectedTime) {
    case '+3h':         return new Date(now.getTime() + 3 * 3600000);
    case 'tomorrow-am': { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9,  0, 0, 0); return d; }
    case 'tomorrow-pm': { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d; }
    default: return now;
  }
}

// ── Wind-Anzeige States ───────────────────────────────────────────────────────

function showWindState(state) {
  windLoading.classList.toggle('hidden', state !== 'loading');
  windDisplay.classList.toggle('hidden', state !== 'auto');
  windManualDiv.classList.toggle('hidden', state !== 'manual');
  windOverride.classList.toggle('hidden', state !== 'override');
  timeSelector.classList.toggle('hidden', state !== 'auto');
}

// ── Manuelle Windrichtungs-Buttons ────────────────────────────────────────────

function buildManualWindButtons() {
  windManualGrp.innerHTML = WIND_DIRS.map(d =>
    `<button class="toggle" data-manual-deg="${d.deg}">${d.label}</button>`
  ).join('');

  windManualGrp.addEventListener('click', e => {
    const btn = e.target.closest('[data-manual-deg]');
    if (!btn) return;
    const deg = Number(btn.dataset.manualDeg);
    windManualGrp.querySelectorAll('.toggle').forEach(b => b.classList.toggle('on', b === btn));
    manualWindDir = deg;
    windOverLabel.textContent = `${degToLabel(deg)} — ${deg}°`;
    windOverComp.innerHTML = compassSvg(deg);
    showWindState('override');
    render();
  });

  windEditBtn?.addEventListener('click', () => showWindState('manual'));

  windAutoBtn?.addEventListener('click', () => {
    manualWindDir = null;
    windManualGrp.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
    if (windForecast) { updateAutoWind(); showWindState('auto'); }
    else              { showWindState('manual'); }
    render();
  });
}

// ── Zeitauswahl ───────────────────────────────────────────────────────────────

function wireTimeSelector() {
  timeSelector.addEventListener('click', e => {
    const btn = e.target.closest('[data-time]');
    if (!btn) return;
    selectedTime = btn.dataset.time;
    timeSelector.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('on', b === btn));
    if (manualWindDir === null) updateAutoWind();
    render();
  });
}

// ── Radius-Buttons ────────────────────────────────────────────────────────────

function buildRadiusButtons() {
  radiusGroup.innerHTML = RADIUS_OPTIONS.map(o =>
    `<button class="toggle${o.value === radius ? ' on' : ''}" data-radius="${o.value ?? 'null'}">${o.label}</button>`
  ).join('');

  radiusGroup.addEventListener('click', e => {
    const btn = e.target.closest('[data-radius]');
    if (!btn || btn.disabled) return;
    radius = btn.dataset.radius === 'null' ? null : Number(btn.dataset.radius);
    radiusGroup.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    saveFilters();
    render();
  });
}

function disableRadius() {
  radius = null;
  radiusGroup.querySelectorAll('.toggle').forEach(b => {
    b.disabled = true;
    b.style.opacity = '.35';
    b.classList.remove('on');
  });
  const allBtn = radiusGroup.querySelector('[data-radius="null"]');
  if (allBtn) { allBtn.classList.add('on'); allBtn.style.opacity = '1'; }
}

// ── Filter Panel ──────────────────────────────────────────────────────────────

function wireFilterPanel() {
  filterBtn.addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    filterPanel.classList.toggle('hidden', !filtersOpen);
  });
}

function buildAdditionalFilters() {
  const diszOpts = [
    { key: 'welle_gross', label: 'Welle groß' },
    { key: 'welle_klein', label: 'Welle klein' },
    { key: 'flachwasser', label: 'Flachwasser' },
  ];
  const sportOpts = [
    { key: 'windsurf', label: 'Windsurf' },
    { key: 'kite',     label: 'Kite'     },
  ];
  const levelOpts = [
    { key: 'beginner',     label: 'Beginner'     },
    { key: 'intermediate', label: 'Intermediate' },
    { key: 'expert',       label: 'Expert'       },
    { key: 'experts_only', label: 'Experts only' },
  ];

  function buildGroup(el, opts, setRef, dataAttr) {
    el.innerHTML = opts.map(o =>
      `<button class="toggle${setRef.has(o.key) ? ' on' : ''}" data-${dataAttr}="${o.key}">${o.label}</button>`
    ).join('');
    el.addEventListener('click', e => {
      const btn = e.target.closest(`[data-${dataAttr}]`);
      if (!btn) return;
      const key = btn.dataset[dataAttr];
      if (setRef.has(key)) { setRef.delete(key); btn.classList.remove('on'); }
      else                  { setRef.add(key);    btn.classList.add('on');    }
      saveFilters(); updateFilterBtnLabel(); render();
    });
  }

  buildGroup(diszGroup,  diszOpts,  filters.disziplinen, 'disz');
  buildGroup(sportGroup, sportOpts, filters.sport,       'sport');
  buildGroup(levelGroup, levelOpts, filters.level,       'level');

  wireLandRegionFilter();
  updateFilterBtnLabel();
}

// Task 3 — Land/Region Dropdowns ──────────────────────────────────────────────

function buildLandDropdown(spots) {
  if (!filterLand) return;
  const lands = [...new Set(spots.map(s => s.land).filter(Boolean))].sort();
  filterLand.innerHTML = `<option value="">Alle Länder</option>` +
    lands.map(l => `<option value="${escHtml(l)}"${filters.land === l ? ' selected' : ''}>${escHtml(l)}</option>`).join('');
  if (filters.land) updateRegionDropdown(spots, filters.land);
}

function updateRegionDropdown(spots, land) {
  if (!filterRegion) return;
  const regions = land
    ? [...new Set(spots.filter(s => s.land === land).map(s => s.region).filter(Boolean))].sort()
    : [];
  filterRegion.innerHTML = `<option value="">Alle Regionen</option>` +
    regions.map(r => `<option value="${escHtml(r)}"${filters.region === r ? ' selected' : ''}>${escHtml(r)}</option>`).join('');
}

function wireLandRegionFilter() {
  if (!filterLand || !filterRegion) return;
  filterLand.addEventListener('change', () => {
    filters.land   = filterLand.value;
    filters.region = '';
    filterRegion.value = '';
    updateRegionDropdown(allSpots, filters.land);
    saveFilters(); updateFilterBtnLabel(); render();
  });
  filterRegion.addEventListener('change', () => {
    filters.region = filterRegion.value;
    saveFilters(); updateFilterBtnLabel(); render();
  });
}

function wireFilterReset() {
  if (!filterReset) return;
  filterReset.addEventListener('click', () => {
    filters.disziplinen.clear();
    filters.sport.clear();
    filters.level.clear();
    filters.text   = '';
    filters.land   = '';
    filters.region = '';
    diszGroup.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
    sportGroup.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
    levelGroup.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
    if (filterLand)   filterLand.value   = '';
    if (filterRegion) filterRegion.value = '';
    searchInput.value = '';
    searchClear.classList.remove('visible');
    saveFilters(); updateFilterBtnLabel(); render();
  });
}

// ── Sortierung (Task 4) ───────────────────────────────────────────────────────

function wireSortToggle() {
  if (!sortToggle) return;
  sortToggle.addEventListener('click', () => {
    sortBy = effectiveSort() === 'dist' ? 'name' : 'dist';
    saveFilters();
    updateSortBtn();
    render();
  });
}

function effectiveSort() {
  return sortBy ?? (userLoc ? 'dist' : 'name');
}

function updateSortBtn() {
  if (!sortToggle) return;
  const eff = effectiveSort();
  sortToggle.textContent = eff === 'dist' ? '↕ Distanz' : '↕ Name';
  sortToggle.title = eff === 'dist' ? 'Klicken: nach Name sortieren' : 'Klicken: nach Distanz sortieren';
}

// ── Suche ─────────────────────────────────────────────────────────────────────

function wireSearch() {
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.text = searchInput.value.toLowerCase().trim();
      searchClear.classList.toggle('visible', filters.text.length > 0);
      updateFilterBtnLabel();
      render();
    }, 300);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    filters.text = '';
    searchClear.classList.remove('visible');
    searchInput.focus();
    updateFilterBtnLabel();
    render();
  });
}

// ── Karte ─────────────────────────────────────────────────────────────────────

function wireMapToggle() {
  mapToggle.addEventListener('click', () => {
    mapView = !mapView;
    mapFitted = false;
    mapToggle.classList.toggle('on', mapView);
    mapToggle.innerHTML = mapView ? '📋' : '🗺️';
    mapToggle.title = mapView ? 'Listenansicht' : 'Kartenansicht';
    resultsWrap.classList.toggle('hidden', mapView);
    mapContainer.classList.toggle('hidden', !mapView);
    if (mapView) { initMap(); render(); }
  });
}

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('map-container', { zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 18,
  }).addTo(leafletMap);
}

// Task 5 — Farbige Karten-Icons ───────────────────────────────────────────────

function diszColorByKey(key) {
  if (key === 'welle_gross') return '#e74c3c';
  if (key === 'welle_klein') return '#f39c12';
  return '#2ecc71';
}

function diszColor(spot) {
  const d = spot.disziplinen ?? [];
  if (d.includes('welle_gross')) return '#e74c3c';
  if (d.includes('welle_klein')) return '#f39c12';
  return '#2ecc71';
}

function updateMap(spots) {
  if (!leafletMap) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  const windDir = getActiveWindDir();
  const anyOptional = filters.disziplinen.size > 0 || filters.sport.size > 0 ||
    filters.level.size > 0 || !!filters.text || !!filters.land || !!filters.region ||
    radius !== null;

  const fittingMarkers = [];

  spots.forEach(spot => {
    if (!spot.lat || !spot.lng) return;
    const dimmed   = anyOptional && !spot._show;
    const opacity  = dimmed ? 0.2 : 0.85;
    const color    = diszColor(spot);
    const isMatch  = spot._isMatch;

    const distText = spot._dist != null
      ? `<div style="color:#4f8ef7;font-size:.8rem;margin:.15rem 0">${formatDistance(spot._dist)}</div>` : '';

    const matchLine = windDir !== null
      ? `<div style="color:${isMatch ? '#2ecc71' : '#888'};font-size:.75rem;margin:.2rem 0">${isMatch ? '✓ Wind passt' : '✗ Wind passt nicht'}</div>` : '';

    const diszBadges = (spot.disziplinen ?? []).map(d =>
      `<span style="background:${diszColorByKey(d)};color:#fff;padding:1px 6px;border-radius:4px;font-size:.72rem;margin-right:2px">${DISZIPLIN_LABELS[d] ?? d}</span>`
    ).join('');

    const sportBadges = (spot.sport ?? []).map(s =>
      `<span style="background:#2e3350;color:#a0aec0;padding:1px 6px;border-radius:4px;font-size:.72rem;margin-right:2px">${s === 'windsurf' ? '🏄 Windsurf' : '🪁 Kite'}</span>`
    ).join('');

    const levelBadge = spot.level
      ? `<span style="background:#2e3350;color:#a0aec0;padding:1px 6px;border-radius:4px;font-size:.72rem">${LEVEL_LABELS[spot.level] ?? spot.level}</span>` : '';

    const windroseSvg = spot.windrichtungen?.length
      ? `<div style="margin:.35rem 0">${windroseMini(spot.windrichtungen, 56)}</div>` : '';

    const marker = L.circleMarker([spot.lat, spot.lng], {
      radius: 8, fillColor: color, color: '#1a1d27',
      weight: 2, opacity: 1, fillOpacity: opacity,
    }).addTo(leafletMap)
      .bindPopup(`
        <div style="font-family:system-ui;min-width:160px;max-width:220px">
          <strong style="font-size:.93rem">${escHtml(spot.name)}</strong>
          <div style="color:#888;font-size:.78rem;margin:.2rem 0">${escHtml([spot.region, spot.land].filter(Boolean).join(' · '))}</div>
          ${distText}${matchLine}
          <hr style="border:none;border-top:1px solid #2e3350;margin:.35rem 0">
          ${windroseSvg}
          ${diszBadges ? `<div style="margin:.25rem 0">${diszBadges}</div>` : ''}
          ${sportBadges ? `<div style="margin:.25rem 0">${sportBadges}</div>` : ''}
          ${levelBadge  ? `<div style="margin:.25rem 0">${levelBadge}</div>`  : ''}
          <a href="spot.html?id=${spot.id}"
             style="display:inline-block;margin-top:.35rem;color:#4f8ef7;font-size:.82rem;font-weight:600">
            → Details
          </a>
        </div>`, { className: 'map-popup' });

    mapMarkers.push(marker);
    if (spot._show) fittingMarkers.push(marker);
  });

  if (!mapFitted && mapMarkers.length > 0) {
    const toFit = fittingMarkers.length > 0 ? fittingMarkers : mapMarkers;
    leafletMap.fitBounds(L.featureGroup(toFit).getBounds().pad(0.15));
    mapFitted = true;
  }

  setTimeout(() => leafletMap.invalidateSize(), 50);
}

// ── Filter-Logik ──────────────────────────────────────────────────────────────

function getActiveWindDir() {
  if (manualWindDir !== null) return manualWindDir;
  return autoWind?.direction ?? null;
}

function isSpotMatch(spot, windDir) {
  if (windDir === null) return true;
  return spot.windrichtungen?.some(w => {
    let diff = Math.abs(windDir - w.mitte) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff <= w.range;
  }) ?? false;
}

function diszMatches(spot) {
  if (filters.disziplinen.size === 0) return true;
  return [...filters.disziplinen].some(d => spot.disziplinen?.includes(d));
}
function sportMatches(spot) {
  if (filters.sport.size === 0) return true;
  return [...filters.sport].some(s => spot.sport?.includes(s));
}
function levelMatches(spot) {
  if (filters.level.size === 0) return true;
  return filters.level.has(spot.level);
}
function textMatches(spot) {
  if (!filters.text) return true;
  return `${spot.name} ${spot.region ?? ''} ${spot.land ?? ''} ${spot.beschreibung ?? ''}`.toLowerCase().includes(filters.text);
}
function landMatches(spot) {
  if (!filters.land) return true;
  return spot.land === filters.land;
}
function regionMatches(spot) {
  if (!filters.region) return true;
  return spot.region === filters.region;
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const windDir = getActiveWindDir();
  const hasWind = windDir !== null;

  const withMeta = allSpots.map(s => {
    const dist = userLoc ? haversine(userLoc.lat, userLoc.lng, s.lat, s.lng) : null;
    const withinRadius   = radius === null || dist === null || dist <= radius;
    const passesOptional = diszMatches(s) && sportMatches(s) && levelMatches(s) &&
                           textMatches(s) && landMatches(s) && regionMatches(s);
    return { ...s, _dist: dist, _show: withinRadius && passesOptional, _isMatch: isSpotMatch(s, windDir) };
  });

  if (mapView) {
    updateMap(withMeta);
    return;
  }

  const visible = withMeta.filter(s => s._show);

  const eff = effectiveSort();
  visible.sort((a, b) => {
    if (hasWind && a._isMatch !== b._isMatch) return a._isMatch ? -1 : 1;
    if (eff === 'dist') return (a._dist ?? Infinity) - (b._dist ?? Infinity);
    return (a.name ?? '').localeCompare(b.name ?? '', 'de');
  });

  updateSortBtn();

  const matchCount = hasWind ? visible.filter(s => s._isMatch).length : visible.length;
  resultCount.textContent = hasWind
    ? `${matchCount} passend · ${visible.length - matchCount} weitere`
    : `${visible.length} Spot${visible.length !== 1 ? 's' : ''}`;

  if (visible.length === 0) {
    resultsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌬️</div>
        <div class="empty-title">Keine Spots gefunden</div>
        <div class="text-muted text-sm">Radius erhöhen oder Filter anpassen</div>
      </div>`;
    return;
  }

  resultsList.innerHTML = visible.map(s => spotRow(s, hasWind)).join('');
}

// ── Spot Row — kompakte Listenansicht (Task 4) ────────────────────────────────

function spotRow(spot, showMatchIndicator) {
  const distHtml = spot._dist != null
    ? `<span class="spot-dist-sm">${formatDistance(spot._dist)}</span>` : '';

  const diszDot = (() => {
    const d = spot.disziplinen ?? [];
    if (d.includes('welle_gross')) return `<span class="disz-dot" style="background:#e74c3c" title="Welle groß"></span>`;
    if (d.includes('welle_klein')) return `<span class="disz-dot" style="background:#f39c12" title="Welle klein"></span>`;
    if (d.includes('flachwasser')) return `<span class="disz-dot" style="background:#2ecc71" title="Flachwasser"></span>`;
    return '';
  })();

  const matchDot = showMatchIndicator
    ? `<span class="match-dot${spot._isMatch ? '' : ' no-match'}"></span>` : '';

  const region    = [spot.land, spot.region].filter(Boolean).join(' · ');
  const windrose  = spot.windrichtungen?.length ? windroseMini(spot.windrichtungen, 38) : '';

  return `
    <a href="spot.html?id=${spot.id}" class="spot-row${showMatchIndicator && !spot._isMatch ? ' no-match' : ''}">
      <div class="spot-row-left">
        <div class="spot-row-name">${matchDot}${escHtml(spot.name)}</div>
        <div class="spot-region-sm">${escHtml(region)}</div>
      </div>
      <div class="spot-row-right">
        ${windrose}
        ${diszDot}
        ${distHtml}
      </div>
    </a>`;
}

// ── Mini-Windrose SVG ─────────────────────────────────────────────────────────

function windroseMini(windrichtungen, sz = 38) {
  const cx = sz / 2, cy = sz / 2, r = sz / 2 - 2;
  let arcs = '';
  for (const w of windrichtungen) {
    const from  = ((w.mitte - w.range - 90) * Math.PI) / 180;
    const to    = ((w.mitte + w.range - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to),   y2 = cy + r * Math.sin(to);
    const large = w.range * 2 > 180 ? 1 : 0;
    arcs += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="#4f8ef7" fill-opacity="0.75"/>`;
  }
  return `<svg viewBox="0 0 ${sz} ${sz}" width="${sz}" height="${sz}" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2e3350" stroke-width="1"/>
    ${arcs}
  </svg>`;
}

// ── Filter-Persistenz ─────────────────────────────────────────────────────────

function saveFilters() {
  localStorage.setItem(FILTER_SAVE_KEY, JSON.stringify({
    radius,
    disziplinen: [...filters.disziplinen],
    sport:       [...filters.sport],
    level:       [...filters.level],
    land:        filters.land,
    region:      filters.region,
    sortBy,
  }));
}

function loadSavedFilters() {
  try {
    const obj = JSON.parse(localStorage.getItem(FILTER_SAVE_KEY) ?? 'null');
    if (!obj) return;
    if (obj.radius !== undefined)  radius = obj.radius;
    if (obj.disziplinen?.length)   filters.disziplinen = new Set(obj.disziplinen);
    if (obj.sport?.length)         filters.sport       = new Set(obj.sport);
    if (obj.level?.length)         filters.level       = new Set(obj.level);
    if (obj.land)                  filters.land        = obj.land;
    if (obj.region)                filters.region      = obj.region;
    if (obj.sortBy)                sortBy              = obj.sortBy;
  } catch (_) {}
}

// ── Filter-Badge ──────────────────────────────────────────────────────────────

function updateFilterBtnLabel() {
  const n = filters.disziplinen.size + filters.sport.size + filters.level.size +
    (filters.text ? 1 : 0) + (filters.land ? 1 : 0) + (filters.region ? 1 : 0);
  filterCount.textContent = n;
  filterCount.classList.toggle('hidden', n === 0);
}

// ── Kompass-SVG ───────────────────────────────────────────────────────────────

function compassSvg(dir) {
  return `<svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="46" fill="none" stroke="#2e3350" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="3"  fill="#2e3350"/>
    <text x="50" y="13"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">N</text>
    <text x="88" y="54"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">O</text>
    <text x="50" y="94"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">S</text>
    <text x="13" y="54"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">W</text>
    <g transform="rotate(${dir + 180} 50 50)">
      <line x1="50" y1="20" x2="50" y2="62" stroke="#4f8ef7" stroke-width="3.5" stroke-linecap="round"/>
      <polygon points="50,14 43,28 57,28" fill="#4f8ef7"/>
    </g>
  </svg>`;
}

// ── Location bar ──────────────────────────────────────────────────────────────

function setLocState(state, text) {
  locBar.className = 'loc-bar' + (state ? ' ' + state : '');
  locText.textContent = text;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
