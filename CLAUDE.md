# Windsurf Spot Finder — Claude-Kontext

## Deployment / Git & GitHub Pages

**GitHub Repo:** https://github.com/3dclassen/windsurf-spot-finder  
**Live URL:** https://3dclassen.github.io/windsurf-spot-finder/

Das `.git`-Verzeichnis ist im Projektordner eingerichtet (erstmals verbunden am 2026-05-10).  
Push-Workflow für alle weiteren Sessions:

```powershell
git add -u                          # alle geänderten Dateien stagen
git add <neue-datei>                # neue Dateien explizit hinzufügen
git commit -m "Kurze Beschreibung"
git push                            # geht direkt, remote ist gesetzt
```

GitHub Pages deployed automatisch nach jedem Push auf `main` (~1–2 Min).

---

## Datenbank

Backend: **Firebase Firestore**  
Collection: `spots`  
Import-Tool: `import.html` (Login mit Admin-Google-Account erforderlich)

---

## Spot-Datenmodell

**Pflichtfelder:** `name`, `land`, `region`, `lat`, `lng`, `disziplinen[]`, `sport[]`, `windrichtungen[]`

`windrichtungen` ist ein Array von Objekten `{ mitte: <Grad>, range: <Grad> }`.  
`mitte` ist die Himmelsrichtung in Grad (meteorologisch: woher der Wind kommt). Beispiel: SO = 135°.

**Standard-Felder:** `level`, `tide`, `stroemung`, `beschreibung`, `bilder[]`, `video_url`, `link_url`

**England-Erweiterungen** (optional, werden in `spot.html` angezeigt):  
`windrichtungen_text`, `tide_einfluss`, `big_days`, `parken`, `quelle`, `nummer_im_buch`,  
`kite_hinweis`, `kite_warnung`, `sicherheitshinweis`, `tide_warnung`, `tide_details`,  
`flachwasser_details`, `wind_besonderheit`, `flussmündung_warnung`, `spot_details`, `hinweis`

**Disziplinen-Keys:** `welle_gross`, `welle_klein`, `flachwasser`  
**Sport-Keys:** `windsurf`, `kite`  
**Level-Keys:** `beginner`, `intermediate`, `expert`, `experts_only`

---

## Architektur / Dateistruktur

| Datei | Zweck |
|---|---|
| `index.html` | Haupt-App (Listenansicht + Kartenansicht) |
| `spot.html` | Spot-Detailseite |
| `admin.html` | Admin-Formular zum Anlegen/Bearbeiten von Spots |
| `import.html` | Bulk-Import-Tool (CSV + Rich-Format, Admin-Login) |
| `js/app.js` | Gesamte App-Logik (kein Framework, reines JS) |
| `js/firebase.js` | Firebase-Initialisierung + `getSpots()` |
| `js/geo.js` | GPS, Haversine-Distanz, formatDistance |
| `js/weather.js` | Open-Meteo Wind-Forecast |
| `css/style.css` | Dark Theme (CSS Custom Properties) |
| `sw.js` | Service Worker (PWA / Offline-Cache) |

---

## App-Logik (js/app.js) — Wichtige Konzepte

### State
- `allSpots` — alle Spots aus Firebase (auch im localStorage als `spots_v2` gecacht)
- `filters` — `{ disziplinen: Set, sport: Set, level: Set, text: '', land: '', region: '' }`
- `radius` — km-Radius; **Default `null`** (= alle Spots sichtbar, kein Pflichtfilter)
- `sortBy` — `null` (auto) | `'name'` | `'dist'`; wird in `filters_v4` gespeichert
- `mapView` — `false` = Listenansicht, `true` = Leaflet-Karte
- `userLoc` — GPS-Koordinaten oder `null`
- `manualWindDir` — manuell gewählte Windrichtung in Grad oder `null`
- `autoWind` — Wind-Objekt von Open-Meteo `{ direction, speed, label }`

### Filter & Matching
- `isSpotMatch(spot, windDir)` — prüft ob Windrichtung zum Spot passt (Wrap-around bei 0°/360°)
- `windDir` = meteorologische FROM-Richtung (wo der Wind herkommt), in Grad
- Spot-Matching und Windrichtungs-Buttons verwenden dieselbe Konvention — intern konsistent
- **Kompass-Pfeil zeigt wohin der Wind bläst** (`dir + 180°` Rotation) — intuitive Darstellung

### Render-Pipeline
1. `allSpots.map(...)` → berechnet `_dist`, `_show`, `_isMatch` pro Spot
2. `visible = withMeta.filter(s => s._show)` → nach allen optionalen Filtern
3. Sort: matches zuerst, dann nach `effectiveSort()` (dist/name)
4. `spotRow()` → kompakte Zeile mit Mini-Windrose SVG + Disziplin-Farbpunkt
5. Oder `updateMap()` → Leaflet CircleMarker (farbig nach Disziplin)

### Karten-Icons Farben
- 🔴 Rot `#e74c3c` = `welle_gross`
- 🟡 Gelb `#f39c12` = `welle_klein`
- 🟢 Grün `#2ecc71` = `flachwasser`
- Bei aktiven Filtern: nicht-matchende Spots auf 20% Opacity (nicht versteckt)

### Persistenz
- `localStorage['spots_v2']` — Spot-Cache (Offline-Fallback)
- `localStorage['filters_v4']` — gespeicherte Filtereinstellungen inkl. Land/Region/sortBy
- `sessionStorage['location_name']` — Ortsname vom Nominatim-API (pro Session gecacht)

### Standortname (Nominatim)
Nach GPS-Fix: `https://nominatim.openstreetmap.org/reverse?lat=...&lon=...&format=json`  
Zeigt "Wind bei [Ortsname]" im loc-bar. User-Agent Header: `WindsurfSpotFinder/1.0`.

---

## Import-Tool (import.html)

Enthält mehrere Import-Buttons (alle nach Admin-Login aktiv):
- 🇫🇷 Frankreich (CSV-Format, ~20 Spots)
- 🇩🇰 Dänemark (CSV-Format)
- 🇬🇧 England (Rich-Format, 18 Spots mit erweiterten Feldern)

England-Spots müssen über diesen Button in Firebase importiert werden — einmalig pro Datenbank.

---

## Was NICHT geändert wird (fixe Teile)

- Firebase-Datenbankstruktur
- `spot.html` — Detailseite (vollständig implementiert inkl. England-Felder)
- `admin.html` — Admin-Formular
- PWA / Service Worker (`sw.js`)
- Authentifizierung (kommt in einem späteren Sprint)
