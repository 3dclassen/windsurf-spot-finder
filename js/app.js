import { getSpots }                              from './firebase.js';
import { getLocation, haversine, formatDistance } from './geo.js';
import { getWindForecast, getWindAtTimeSync, degToLabel } from './weather.js';

// ── Konstanten ───────────────────────────────────────────────────

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
  { label: '20 km', value: 20 },
  { label: '50 km', value: 50 },
  { label: '100 km', value: 100 },
  { label: 'Alle', value: null },
];

const CACHE_KEY      = 'spots_v2';
const FILTER_SAVE_KEY = 'filters_v3';

// ── State ────────────────────────────────────────────────────────

let allSpots     = [];
let userLoc      = null;
let windForecast = null;
let autoWind     = null;   // { direction, speed, label } — von Open-Meteo
let manualWindDir = null;  // Zahl wenn manuell überschrieben, sonst null
let selectedTime = 'now'; // 'now' | '+3h' | 'tomorrow-am' | 'tomorrow-pm'
let radius       = 100;   // km; null = alle
let filters      = { disziplinen: new Set(), sport: new Set(), level: new Set(), text: '' };
let filtersOpen  = false;
let mapView      = false;
let leafletMap   = null;
let mapMarkers   = [];

// ── DOM refs ─────────────────────────────────────────────────────

const locBar         = document.getElementById('loc-bar');
const locText        = document.getElementById('loc-text');
const resultsList    = document.getElementById('results-list');
const resultCount    = document.getElementById('result-count');
const resultsWrap    = document.getElementById('results-wrap');
const mapContainer   = document.getElementById('map-container');
const mapToggle      = document.getElementById('map-toggle');
const adminLink      = document.getElementById('admin-link');
const searchInput    = document.getElementById('search-input');
const searchClear    = document.getElementById('search-clear');
const windLoading    = document.getElementById('wind-loading');
const windDisplay    = document.getElementById('wind-display');
const windManualDiv  = document.getElementById('wind-manual');
const windOverride   = document.getElementById('wind-override');
const windEditBtn    = document.getElementById('wind-edit-btn');
const windAutoBtn    = document.getElementById('wind-auto-btn');
const windLabelText  = document.getElementById('wind-label-text');
const windSpeedText  = document.getElementById('wind-speed-text');
const windManualGrp  = document.getElementById('wind-manual-group');
const windOverLabel  = document.getElementById('wind-override-label');
const windOverComp   = document.getElementById('wind-override-compass');
const windCompassEl  = document.getElementById('wind-compass-svg');
const timeSelector   = document.getElementById('time-selector');
const radiusGroup    = document.getElementById('radius-group');
const filterBtn      = document.getElementById('filter-btn');
const filterCount    = document.getElementById('filter-count');
const filterPanel    = document.getElementById('filter-panel');
const diszGroup      = document.getElementById('disz-group');
const sportGroup     = document.getElementById('sport-group');
const levelGroup     = document.getElementById('level-group');

// ── Init ─────────────────────────────────────────────────────────

async function init() {
  loadSavedFilters();
  buildRadiusButtons();
  buildAdditionalFilters();
  buildManualWindButtons();
  wireTimeSelector();
  wireFilterPanel();
  wireSearch();
  wireMapToggle();

  // Admin-Link einblenden
  try {
    const { auth, onAuthStateChanged, getUserRole } = await import('./firebase.js');
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      const role = await getUserRole(user.uid);
      if (role === 'admin' || role === 'editor') adminLink.classList.remove('hidden');
    });
  } catch (_) {}

  // Cache sofort rendern
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try { allSpots = JSON.parse(cached); render(); } catch (_) {}
  }

  // Spots von Firebase (parallel zu GPS)
  getSpots().then(spots => {
    allSpots = spots;
    localStorage.setItem(CACHE_KEY, JSON.stringify(spots));
    render();
  }).catch(err => {
    console.error('Firebase:', err);
    if (allSpots.length === 0) setLocState('err', 'Spots nicht erreichbar');
  });

  // GPS (startet danach Winddaten)
  requestGPS();
}

// ── GPS ──────────────────────────────────────────────────────────

async function requestGPS() {
  setLocState('loading', 'Standort wird ermittelt…');
  try {
    userLoc = await getLocation();
    setLocState('ok', `${userLoc.lat.toFixed(3)}°, ${userLoc.lng.toFixed(3)}°`);
    render();
    loadWindData();
  } catch (_) {
    setLocState('err', 'Kein GPS — Distanz nicht verfügbar');
    disableRadius();
    showWindState('manual');
  }
}

// ── Winddaten laden ──────────────────────────────────────────────

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

// ── Wind-Anzeige: States ─────────────────────────────────────────
// 'loading' | 'auto' | 'manual' | 'override'

function showWindState(state) {
  windLoading.classList.toggle('hidden', state !== 'loading');
  windDisplay.classList.toggle('hidden', state !== 'auto');
  windManualDiv.classList.toggle('hidden', state !== 'manual');
  windOverride.classList.toggle('hidden', state !== 'override');
  timeSelector.classList.toggle('hidden', state !== 'auto'); // Zeitauswahl nur bei Auto
}

// ── Manuelle Windrichtungs-Buttons ────────────────────────────────

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
    if (windForecast) {
      updateAutoWind();
      showWindState('auto');
    } else {
      showWindState('manual');
    }
    render();
  });
}

// ── Zeitauswahl ───────────────────────────────────────────────────

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

// ── Radius-Buttons ────────────────────────────────────────────────

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

// ── Zusatzfilter (eingeklappt) ────────────────────────────────────

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

  updateFilterBtnLabel();
}

function updateFilterBtnLabel() {
  const n = filters.disziplinen.size + filters.sport.size + filters.level.size + (filters.text ? 1 : 0);
  filterBtn.textContent = 'Filter';
  filterCount.textContent = n;
  filterCount.classList.toggle('hidden', n === 0);
}

// ── Suche ────────────────────────────────────────────────────────

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

// ── Karte ────────────────────────────────────────────────────────

function wireMapToggle() {
  mapToggle.addEventListener('click', () => {
    mapView = !mapView;
    mapToggle.classList.toggle('on', mapView);
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

function updateMap(spots) {
  if (!leafletMap) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  spots.forEach(spot => {
    if (!spot.lat || !spot.lng) return;
    const isMatch  = spot._isMatch;
    const color    = isMatch ? '#2ecc8f' : '#4f8ef7';
    const opacity  = isMatch ? 0.9 : 0.45;
    const distText = spot._dist != null ? `<br><span style="color:#4f8ef7">${formatDistance(spot._dist)}</span>` : '';

    const marker = L.circleMarker([spot.lat, spot.lng], {
      radius: 8, fillColor: color, color: '#1a1d27',
      weight: 2, opacity: 1, fillOpacity: opacity,
    }).addTo(leafletMap)
      .bindPopup(`
        <div style="font-family:system-ui;min-width:140px">
          <strong style="font-size:.95rem">${escHtml(spot.name)}</strong>
          <div style="color:#888;font-size:.8rem;margin:.2rem 0">${escHtml(spot.region ?? spot.land ?? '')}</div>
          ${distText}
          <a href="spot.html?id=${spot.id}"
             style="display:inline-block;margin-top:.5rem;color:#4f8ef7;font-size:.82rem;font-weight:600">
            Details →
          </a>
        </div>`, { className: 'map-popup' });
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.15));
  }
  setTimeout(() => leafletMap.invalidateSize(), 50);
}

// ── Filter-Logik ─────────────────────────────────────────────────

function getActiveWindDir() {
  if (manualWindDir !== null) return manualWindDir;
  return autoWind?.direction ?? null;
}

// C2 — Match-Algorithmus inkl. Wrap-around bei 0°/360°
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
  return `${spot.name} ${spot.region ?? ''} ${spot.land ?? ''}`.toLowerCase().includes(filters.text);
}

// ── Render ───────────────────────────────────────────────────────

function render() {
  const windDir = getActiveWindDir();
  const hasWind = windDir !== null;

  // Metadaten berechnen
  const withMeta = allSpots.map(s => {
    const dist = userLoc ? haversine(userLoc.lat, userLoc.lng, s.lat, s.lng) : null;
    const withinRadius   = radius === null || dist === null || dist <= radius;
    const passesOptional = diszMatches(s) && sportMatches(s) && levelMatches(s) && textMatches(s);
    return { ...s, _dist: dist, _show: withinRadius && passesOptional, _isMatch: isSpotMatch(s, windDir) };
  });

  const visible = withMeta.filter(s => s._show);

  // Sortierung: passende Spots zuerst, dann nach Distanz
  visible.sort((a, b) => {
    if (a._isMatch !== b._isMatch) return a._isMatch ? -1 : 1;
    return (a._dist ?? Infinity) - (b._dist ?? Infinity);
  });

  const matchCount = visible.filter(s => s._isMatch).length;

  resultCount.textContent = hasWind
    ? `${matchCount} passend · ${visible.length - matchCount} weitere`
    : `${visible.length} Spot${visible.length !== 1 ? 's' : ''}`;

  if (mapView) { updateMap(visible); return; }

  if (visible.length === 0) {
    resultsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌬️</div>
        <div class="empty-title">Keine Spots gefunden</div>
        <div class="text-muted text-sm">Radius erhöhen oder Filter anpassen</div>
      </div>`;
    return;
  }

  resultsList.innerHTML = visible.map(s => spotCard(s, hasWind)).join('');
}

function spotCard(spot, showMatchIndicator) {
  const distHtml = spot._dist != null
    ? `<div class="spot-dist">${formatDistance(spot._dist)}</div>`
    : '';

  const matchDot = showMatchIndicator
    ? `<div class="match-dot${spot._isMatch ? '' : ' no-match'}"></div>`
    : '';

  const diszBadges = (spot.disziplinen ?? [])
    .map(d => `<span class="badge badge-disz">${DISZIPLIN_LABELS[d] ?? d}</span>`).join('');
  const sportBadges = (spot.sport ?? [])
    .map(s => `<span class="badge badge-sport">${s}</span>`).join('');
  const levelBadge = spot.level
    ? `<span class="badge badge-level ${spot.level}">${LEVEL_LABELS[spot.level] ?? spot.level}</span>`
    : '';

  const region = [spot.land, spot.region].filter(Boolean).join(' · ');

  return `
    <a href="spot.html?id=${spot.id}" class="spot-card${showMatchIndicator && !spot._isMatch ? ' no-match' : ''}">
      <div class="spot-card-top">
        <div style="display:flex;align-items:center;gap:.45rem;flex:1;min-width:0">
          ${matchDot}
          <div class="spot-name">${escHtml(spot.name)}</div>
        </div>
        ${distHtml}
      </div>
      <div class="spot-region">${escHtml(region)}</div>
      <div class="badges">${diszBadges}${sportBadges}${levelBadge}</div>
    </a>`;
}

// ── Filter-Persistenz (B3) ────────────────────────────────────────

function saveFilters() {
  localStorage.setItem(FILTER_SAVE_KEY, JSON.stringify({
    radius,
    disziplinen: [...filters.disziplinen],
    sport:       [...filters.sport],
    level:       [...filters.level],
  }));
}

function loadSavedFilters() {
  try {
    const obj = JSON.parse(localStorage.getItem(FILTER_SAVE_KEY) ?? 'null');
    if (!obj) return;
    if (obj.radius !== undefined)   radius = obj.radius;
    if (obj.disziplinen?.length)    filters.disziplinen = new Set(obj.disziplinen);
    if (obj.sport?.length)          filters.sport       = new Set(obj.sport);
    if (obj.level?.length)          filters.level       = new Set(obj.level);
  } catch (_) {}
}

// ── Kompass-SVG ───────────────────────────────────────────────────
// Pfeilspitze zeigt WHERE der Wind herkommt (meteorologische Konvention)

function compassSvg(dir) {
  return `<svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="46" fill="none" stroke="#2e3350" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="3"  fill="#2e3350"/>
    <text x="50" y="13"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">N</text>
    <text x="88" y="54"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">O</text>
    <text x="50" y="94"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">S</text>
    <text x="13" y="54"  text-anchor="middle" fill="#7b82a0" font-size="9" font-family="system-ui,sans-serif">W</text>
    <g transform="rotate(${dir} 50 50)">
      <line x1="50" y1="20" x2="50" y2="62" stroke="#4f8ef7" stroke-width="3.5" stroke-linecap="round"/>
      <polygon points="50,14 43,28 57,28" fill="#4f8ef7"/>
    </g>
  </svg>`;
}

// ── Location bar ─────────────────────────────────────────────────

function setLocState(state, text) {
  locBar.className = 'loc-bar' + (state ? ' ' + state : '');
  locText.textContent = text;
}

// ── Helpers ──────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ────────────────────────────────────────────────────────

init();
