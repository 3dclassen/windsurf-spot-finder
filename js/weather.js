// ── Open-Meteo Wind API ───────────────────────────────────────────
// Kein API-Key nötig. Cache 1h in localStorage.

const CACHE_PREFIX = 'weather_v1_';
const CACHE_TTL    = 3600000; // 1h in ms

const WIND_LABELS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export function degToLabel(deg) {
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return WIND_LABELS[index];
}

// Vollständige Stunden-Vorhersage für 3 Tage
// Gibt Array von { time, direction, speed, label } zurück
export async function getWindForecast(lat, lng) {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(2)}_${lng.toFixed(2)}`;
  const cached   = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    } catch (_) { /* corrupt cache → neu laden */ }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=windspeed_10m,winddirection_10m` +
    `&wind_speed_unit=kn&forecast_days=3&timezone=auto`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const json = await resp.json();

  const data = json.hourly.time.map((time, i) => ({
    time,
    direction: Math.round(json.hourly.winddirection_10m[i]),
    speed:     Math.round(json.hourly.windspeed_10m[i]),
    label:     degToLabel(json.hourly.winddirection_10m[i]),
  }));

  localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
  return data;
}

// Nächsten Forecast-Eintrag zum gegebenen Zeitpunkt finden (sync, kein Fetch)
export function getWindAtTimeSync(forecast, targetDate) {
  if (!forecast?.length) return null;
  // "2024-04-11T09:00" → als lokale Zeit parsen
  const target = targetDate.getTime();
  return forecast.reduce((best, entry) => {
    const et = new Date(entry.time.replace('T', ' ')).getTime();
    const bt = new Date(best.time.replace('T', ' ')).getTime();
    return Math.abs(et - target) < Math.abs(bt - target) ? entry : best;
  });
}
