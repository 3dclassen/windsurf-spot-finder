import { auth, onAuthStateChanged, getUserRole, getSpot, addSpot, updateSpot, loginWithGoogle, logout } from './firebase.js';

// ── Konstanten ───────────────────────────────────────────────────

const WIND_DIRS = [
  { label: 'N',  deg: 0   }, { label: 'NO', deg: 45  },
  { label: 'O',  deg: 90  }, { label: 'SO', deg: 135 },
  { label: 'S',  deg: 180 }, { label: 'SW', deg: 225 },
  { label: 'W',  deg: 270 }, { label: 'NW', deg: 315 },
];

// ── State ────────────────────────────────────────────────────────

let currentUser = null;
let userRole    = 'viewer';
let editSpotId  = null;
let windrichtungen = [];  // { mitte, range }[]
let selectedWindDeg = null;

// ── DOM refs ─────────────────────────────────────────────────────

const authScreen  = document.getElementById('auth-screen');
const formScreen  = document.getElementById('form-screen');
const loginBtn    = document.getElementById('login-btn');
const logoutBtn   = document.getElementById('logout-btn');
const userInfo    = document.getElementById('user-info');
const uidBox      = document.getElementById('uid-box');
const noAccess    = document.getElementById('no-access');
const submitBtn   = document.getElementById('submit-btn');
const formTitle   = document.getElementById('form-title');
const windDirGrid = document.getElementById('wind-dir-grid');
const windAdded   = document.getElementById('wind-added');
const rangeInput  = document.getElementById('range-input');
const rangeVal    = document.getElementById('range-val');
const addWindBtn  = document.getElementById('add-wind-btn');
const toast       = document.getElementById('toast');

// ── Auth flow ─────────────────────────────────────────────────────

loginBtn?.addEventListener('click', async () => {
  try {
    await loginWithGoogle();
  } catch (e) {
    showToast('Login fehlgeschlagen: ' + e.message, 'err');
  }
});

logoutBtn?.addEventListener('click', async () => {
  await logout();
  location.reload();
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    showScreen('auth');
    return;
  }

  userInfo.textContent = user.displayName ?? user.email ?? '';
  uidBox.textContent   = user.uid;
  userRole = await getUserRole(user.uid);

  if (userRole !== 'editor' && userRole !== 'admin') {
    showScreen('no-access');
    return;
  }

  showScreen('form');
  await initForm();
});

function showScreen(which) {
  authScreen.style.display = which === 'auth'      ? 'flex' : 'none';
  noAccess.style.display   = which === 'no-access' ? 'flex' : 'none';
  formScreen.style.display = which === 'form'      ? 'flex' : 'none';
}

// ── Form init ────────────────────────────────────────────────────

async function initForm() {
  buildWindDirButtons();

  editSpotId = new URLSearchParams(location.search).get('id');
  if (editSpotId) {
    formTitle.textContent = 'Spot bearbeiten';
    submitBtn.textContent = 'Änderungen speichern';
    const spot = await getSpot(editSpotId);
    if (spot) fillForm(spot);
  } else {
    formTitle.textContent = 'Neuer Spot';
    submitBtn.textContent = 'Spot anlegen';
  }
}

function fillForm(spot) {
  setVal('f-name',         spot.name        ?? '');
  setVal('f-land',         spot.land        ?? '');
  setVal('f-region',       spot.region      ?? '');
  setVal('f-lat',          spot.lat         ?? '');
  setVal('f-lng',          spot.lng         ?? '');
  setVal('f-level',        spot.level       ?? 'intermediate');
  setVal('f-tide',         spot.tide        ?? 'egal');
  setVal('f-stroemung',    spot.stroemung   ?? 'keine');
  setVal('f-beschreibung', spot.beschreibung ?? '');
  setVal('f-video-url',    spot.video_url   ?? '');
  setVal('f-link-url',     spot.link_url    ?? '');

  // Disziplinen
  for (const cb of document.querySelectorAll('[name="disziplin"]')) {
    cb.checked = spot.disziplinen?.includes(cb.value) ?? false;
  }

  // Sport
  for (const cb of document.querySelectorAll('[name="sport"]')) {
    cb.checked = spot.sport?.includes(cb.value) ?? false;
  }

  // Windrichtungen
  windrichtungen = spot.windrichtungen ? [...spot.windrichtungen] : [];
  renderWindChips();
}

// ── Wind direction picker ─────────────────────────────────────────

function buildWindDirButtons() {
  windDirGrid.innerHTML = WIND_DIRS.map(d => `
    <button type="button" class="toggle" data-deg="${d.deg}">${d.label}</button>
  `).join('');

  windDirGrid.addEventListener('click', e => {
    const btn = e.target.closest('[data-deg]');
    if (!btn) return;
    const deg = Number(btn.dataset.deg);
    if (selectedWindDeg === deg) {
      selectedWindDeg = null;
      btn.classList.remove('on');
    } else {
      selectedWindDeg = deg;
      windDirGrid.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    }
  });
}

rangeInput?.addEventListener('input', () => {
  rangeVal.textContent = `±${rangeInput.value}°`;
});

addWindBtn?.addEventListener('click', () => {
  if (selectedWindDeg === null) {
    showToast('Bitte zuerst eine Windrichtung auswählen', 'err');
    return;
  }
  const range = Number(rangeInput.value);
  // Duplikat prüfen
  if (windrichtungen.some(w => w.mitte === selectedWindDeg)) {
    showToast('Diese Richtung ist bereits eingetragen', 'err');
    return;
  }
  windrichtungen.push({ mitte: selectedWindDeg, range });
  renderWindChips();

  // Reset
  selectedWindDeg = null;
  windDirGrid.querySelectorAll('.toggle').forEach(b => b.classList.remove('on'));
});

function renderWindChips() {
  windAdded.innerHTML = windrichtungen.map((w, i) => {
    const label = WIND_DIRS.find(d => d.deg === w.mitte)?.label ?? `${w.mitte}°`;
    return `
      <div class="wind-chip">
        ${label} (${w.mitte}°) ±${w.range}°
        <button type="button" data-idx="${i}" title="Entfernen">✕</button>
      </div>`;
  }).join('');

  windAdded.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      windrichtungen.splice(Number(btn.dataset.idx), 1);
      renderWindChips();
    });
  });
}

// ── Form submit ──────────────────────────────────────────────────

document.getElementById('spot-form')?.addEventListener('submit', async e => {
  e.preventDefault();

  if (windrichtungen.length === 0) {
    showToast('Mindestens eine Windrichtung eintragen', 'err');
    return;
  }

  const disziplinen = [...document.querySelectorAll('[name="disziplin"]:checked')].map(c => c.value);
  const sport       = [...document.querySelectorAll('[name="sport"]:checked')].map(c => c.value);

  if (disziplinen.length === 0) {
    showToast('Bitte mindestens eine Disziplin wählen', 'err');
    return;
  }
  if (sport.length === 0) {
    showToast('Bitte mindestens einen Sport wählen', 'err');
    return;
  }

  const data = {
    name:         getVal('f-name').trim(),
    land:         getVal('f-land').trim(),
    region:       getVal('f-region').trim(),
    lat:          Number(getVal('f-lat')),
    lng:          Number(getVal('f-lng')),
    level:        getVal('f-level'),
    tide:         getVal('f-tide'),
    stroemung:    getVal('f-stroemung'),
    beschreibung: getVal('f-beschreibung').trim(),
    video_url:    getVal('f-video-url').trim(),
    link_url:     getVal('f-link-url').trim(),
    disziplinen,
    sport,
    windrichtungen,
    bilder: [],
  };

  if (!data.name || !data.land || isNaN(data.lat) || isNaN(data.lng)) {
    showToast('Name, Land und Koordinaten sind Pflichtfelder', 'err');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Speichern…';

  try {
    if (editSpotId) {
      await updateSpot(editSpotId, data);
      showToast('Spot aktualisiert', 'ok');
      setTimeout(() => location.href = `spot.html?id=${editSpotId}`, 1200);
    } else {
      const ref = await addSpot(data);
      showToast('Spot angelegt', 'ok');
      setTimeout(() => location.href = `spot.html?id=${ref.id}`, 1200);
    }
  } catch (err) {
    console.error(err);
    showToast('Fehler beim Speichern: ' + err.message, 'err');
    submitBtn.disabled = false;
    submitBtn.textContent = editSpotId ? 'Änderungen speichern' : 'Spot anlegen';
  }
});

// ── Helpers ──────────────────────────────────────────────────────

function getVal(id) { return document.getElementById(id)?.value ?? ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => toast.className = 'toast', 2800);
}
