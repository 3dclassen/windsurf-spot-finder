import { getSpots } from './firebase.js';
import { getLocation, haversine, formatDistance } from './geo.js';

// ── Konstanten ───────────────────────────────────────────────────

const WIND_DIRS = [
  { label: 'N',  deg: 0   },
  { label: 'NO', deg: 45  },
  { label: 'O',  deg: 90  },
  { label: 'SO', deg: 135 },
  { label: 'S',  deg: 180 },
  { label: 'SW', deg: 225 },
  { label: 'W',  deg: 270 },
  { label: 'NW', deg: 315 },
];

const DISZIPLIN_LABELS = {
  welle_gross:  'Welle groß',
  welle_klein:  'Welle klein',
  flachwasser:  'Flachwasser',
};

const LEVEL_LABELS = {
  beginner:     'Beginner',
  intermediate: 'Intermediate',
  expert:       'Expert',
  experts_only: 'Experts only',
};

const CACHE_KEY = 'spots_v2';

// ── State ────────────────────────────────────────────────────────

let allSpots     = [];
let userLoc      = null;
let filters      = { wind: null, disziplinen: new Set(), sport: new Set(), text: '' };
let mapView      = false;
let leafletMap   = null;
let mapMarkers   = [];

// ── DOM refs ─────────────────────────────────────────────────────

const locBar       = document.getElementById('loc-bar');
const locText      = document.getElementById('loc-text');
const resultsList  = document.getElementById('results-list');
const resultCount  = document.getElementById('result-count');
const resultsWrap  = document.getElementById('results-wrap');
const mapContainer = document.getElementById('map-container');
const mapToggle    = document.getElementById('map-toggle');
const searchInput  = document.getElementById('search-input');
const searchClear  = document.getElementById('search-clear');
const windGroup    = document.getElementById('wind-group');
const diszGroup    = document.getElementById('disz-group');
const sportGroup   = document.getElementById('sport-group');
const adminLink    = document.getElementById('admin-link');

// ── Init ─────────────────────────────────────────────────────────

async function init() {
  buildWindButtons();
  buildDiszButtons();
  buildSportButtons();

  // Admin-Link einblenden wenn Session vorhanden
  try {
    const { auth, onAuthStateChanged, getUserRole } = await import('./firebase.js');
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      const role = await getUserRole(user.uid);
      if (role === 'admin' || role === 'editor') {
        adminLink.classList.remove('hidden');
      }
    });
  } catch (_) { /* Auth optional */ }

  // Cache laden → sofort rendern
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      allSpots = JSON.parse(cached);
      render();
    } catch (_) { /* ignore corrupt cache */ }
  }

  // Firebase laden → Cache aktualisieren
  setLocState('loading', 'Spots werden geladen…');
  try {
    allSpots = await getSpots();
    localStorage.setItem(CACHE_KEY, JSON.stringify(allSpots));
    setLocState('', `${allSpots.length} Spots geladen`);
    render();
  } catch (err) {
    console.error('Firebase Fehler:', err);
    if (allSpots.length === 0) {
      setLocState('err', 'Daten nicht erreichbar');
    }
  }

  // GPS
  requestGPS();
}

async function requestGPS() {
  setLocState('loading', 'Standort wird ermittelt…');
  try {
    userLoc = await getLocation();
    setLocState('ok', `${userLoc.lat.toFixed(4)}°N, ${userLoc.lng.toFixed(4)}°E`);
    render();
  } catch (_) {
    setLocState('err', 'Kein GPS — Distanz nicht verfügbar');
  }
}

// ── Filter UI aufbauen ───────────────────────────────────────────

function buildWindButtons() {
  windGroup.innerHTML = WIND_DIRS.map(d => `
    <button class="toggle" data-deg="${d.deg}" data-group="wind">${d.label}</button>
  `).join('');

  windGroup.addEventListener('click', e => {
    const btn = e.target.closest('[data-deg]');
    if (!btn) return;
    const deg = Number(btn.dataset.deg);
    if (filters.wind === deg) {
      filters.wind = null;
      btn.classList.remove('on');
    } else {
      filters.wind = deg;
      windGroup.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    }
    render();
  });
}

function buildDiszButtons() {
  const opts = [
    { key: 'welle_gross', label: 'Welle groß' },
    { key: 'welle_klein', label: 'Welle klein' },
    { key: 'flachwasser', label: 'Flachwasser' },
  ];
  diszGroup.innerHTML = opts.map(o => `
    <button class="toggle" data-key="${o.key}" data-group="disz">${o.label}</button>
  `).join('');

  diszGroup.addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (filters.disziplinen.has(key)) {
      filters.disziplinen.delete(key);
      btn.classList.remove('on');
    } else {
      filters.disziplinen.add(key);
      btn.classList.add('on');
    }
    render();
  });
}

function buildSportButtons() {
  const opts = [
    { key: 'windsurf', label: 'Windsurf' },
    { key: 'kite',     label: 'Kite'     },
  ];
  sportGroup.innerHTML = opts.map(o => `
    <button class="toggle" data-key="${o.key}" data-group="sport">${o.label}</button>
  `).join('');

  sportGroup.addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (filters.sport.has(key)) {
      filters.sport.delete(key);
      btn.classList.remove('on');
    } else {
      filters.sport.add(key);
      btn.classList.add('on');
    }
    render();
  });
}

// ── Suche ────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  filters.text = searchInput.value.toLowerCase().trim();
  searchClear.classList.toggle('visible', filters.text.length > 0);
  render();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  filters.text = '';
  searchClear.classList.remove('visible');
  searchInput.focus();
  render();
});

// ── Filter-Logik ─────────────────────────────────────────────────

function windMatches(spot) {
  if (filters.wind === null) return true;
  return spot.windrichtungen?.some(w => {
    let diff = Math.abs(filters.wind - w.mitte) % 360;
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

function textMatches(spot) {
  if (!filters.text) return true;
  const haystack = `${spot.name} ${spot.region ?? ''} ${spot.land ?? ''}`.toLowerCase();
  return haystack.includes(filters.text);
}

// ── Karte ────────────────────────────────────────────────────────

mapToggle.addEventListener('click', () => {
  mapView = !mapView;
  mapToggle.classList.toggle('on', mapView);
  mapToggle.title = mapView ? 'Listenansicht' : 'Kartenansicht';
  resultsWrap.classList.toggle('hidden', mapView);
  mapContainer.classList.toggle('hidden', !mapView);
  if (mapView) {
    initMap();
    render();
  }
});

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('map-container', { zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 18
  }).addTo(leafletMap);
}

function updateMap(spots) {
  if (!leafletMap) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  spots.forEach(spot => {
    if (!spot.lat || !spot.lng) return;
    const distText = spot._dist !== null ? `<br><span style="color:#4f8ef7">${formatDistance(spot._dist)}</span>` : '';
    const marker = L.circleMarker([spot.lat, spot.lng], {
      radius: 8,
      fillColor: '#4f8ef7',
      color: '#1a1d27',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
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
        </div>
      `, { className: 'map-popup' });
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.15));
  }
  setTimeout(() => leafletMap.invalidateSize(), 50);
}

// ── Render ───────────────────────────────────────────────────────

function render() {
  const filtered = allSpots
    .filter(windMatches)
    .filter(diszMatches)
    .filter(sportMatches)
    .filter(textMatches)
    .map(s => ({
      ...s,
      _dist: userLoc ? haversine(userLoc.lat, userLoc.lng, s.lat, s.lng) : null
    }))
    .sort((a, b) => (a._dist ?? Infinity) - (b._dist ?? Infinity));

  resultCount.textContent = `${filtered.length} Spot${filtered.length !== 1 ? 's' : ''}`;

  if (mapView) {
    updateMap(filtered);
    return;
  }

  if (filtered.length === 0) {
    resultsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌬️</div>
        <div class="empty-title">Keine Spots gefunden</div>
        <div class="text-muted text-sm">Andere Filter probieren oder Windrichtung entfernen</div>
      </div>`;
    return;
  }

  resultsList.innerHTML = filtered.map(spot => spotCard(spot)).join('');
}

function spotCard(spot) {
  const distHtml = spot._dist !== null
    ? `<div class="spot-dist">${formatDistance(spot._dist)}</div>`
    : '';

  const diszBadges = (spot.disziplinen ?? [])
    .map(d => `<span class="badge badge-disz">${DISZIPLIN_LABELS[d] ?? d}</span>`)
    .join('');

  const sportBadges = (spot.sport ?? [])
    .map(s => `<span class="badge badge-sport">${s}</span>`)
    .join('');

  const levelBadge = spot.level
    ? `<span class="badge badge-level ${spot.level}">${LEVEL_LABELS[spot.level] ?? spot.level}</span>`
    : '';

  const region = [spot.land, spot.region].filter(Boolean).join(' · ');

  return `
    <a href="spot.html?id=${spot.id}" class="spot-card">
      <div class="spot-card-top">
        <div class="spot-name">${escHtml(spot.name)}</div>
        ${distHtml}
      </div>
      <div class="spot-region">${escHtml(region)}</div>
      <div class="badges">${diszBadges}${sportBadges}${levelBadge}</div>
    </a>`;
}

// ── Location bar ─────────────────────────────────────────────────

function setLocState(state, text) {
  locBar.className = 'loc-bar' + (state ? ' ' + state : '');
  locText.textContent = text;
}

// ── Helpers ──────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Start ────────────────────────────────────────────────────────

init();
