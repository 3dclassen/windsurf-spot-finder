# Windsurf Spot Finder — Product Requirements Document
**Version:** 2.1  
**Stand:** April 2026  
**Autor:** Daniel Classen  
**Status:** v2 produktiv — läuft auf GitHub Pages

---

## 1. Vision & Ziel

Eine persönliche, wind- und bedingungsbasierte Spot-Datenbank für Windsurfer und Kiter. Die App sagt dir in unter 10 Sekunden, welcher Spot heute passt — basierend auf Windrichtung, Disziplin und deinem Standort.

---

## 2. Kontext & Ausgangslage

Die bestehende App (v1) unter `https://3dclassen.github.io/windsurf-spot-finder/` hat eine grundlegende Filterfunktion (Land, Region, Disziplin, Windrichtung), Google Sheets-Anbindung und Offline-Fallback. Die Probleme: fragile Datenbankanbindung, schlechte UX, kein Standort, keine Distanzanzeige, kein Admin-Bereich zum Eintragen neuer Spots.

---

## 3. Primärer Use Case

> "Ich bin in Kapstadt. Morgen kommt Nordwestwind. Welche Spots in meiner Nähe passen — und für Welle groß, klein oder Flachwasser?"

Der User öffnet die App, sieht seinen Standort, wählt Windrichtung und Disziplin, und bekommt sofort eine nach Distanz sortierte Liste passender Spots.

---

## 4. Zielgruppe

- **Primär:** Daniel (persönliche Nutzung)
- **Mittelfristig:** Windsurf- und Kite-Bekannte aus dem eigenen Netzwerk
- **Langfristig:** Offen für Community-Nutzung — aber kein Ziel für v2

---

## 5. Datenmodell

Jeder Spot hat folgende Felder:

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `id` | string | ja | Auto-generiert (Firebase) |
| `name` | string | ja | Name des Spots |
| `land` | string | ja | z.B. "Südafrika", "Spanien" |
| `region` | string | nein | z.B. "Kapstadt", "Tarifa" |
| `lat` | number | ja | Breitengrad |
| `lng` | number | ja | Längengrad |
| `disziplinen` | array | ja | `["welle_gross", "welle_klein", "flachwasser"]` — Mehrfachauswahl |
| `sport` | array | ja | `["windsurf", "kite"]` — Mehrfachauswahl |
| `windrichtungen` | array | ja | Siehe Abschnitt 5.1 |
| `tide` | string | nein | `"high"`, `"low"`, `"egal"` |
| `stroemung` | string | nein | `"stark"`, `"keine"` |
| `level` | string | ja | `"beginner"`, `"intermediate"`, `"expert"`, `"experts_only"` |
| `beschreibung` | string | nein | Freitext |
| `bilder` | array | nein | URLs zu Fotos (Firebase Storage oder extern) |
| `video_url` | string | nein | URL zu einem Video (YouTube, Vimeo, etc.) |
| `link_url` | string | nein | Externer Link zum Spot (Website, Windfinder, etc.) |
| `erstellt_am` | timestamp | ja | Auto |
| `erstellt_von` | string | ja | Firebase User ID |

### 5.1 Windrichtungen — Datenmodell

Windrichtungen sind **keine einfachen Werte**, sondern Bereiche. Ein Spot kann eine oder mehrere funktionierende Windrichtungen haben, jeweils mit einer Unschärfe von ±10–20°.

Datenstruktur pro Windrichtung:

```json
"windrichtungen": [
  { "mitte": 315, "range": 20 },
  { "mitte": 180, "range": 15 }
]
```

Das bedeutet: Spot funktioniert bei NW (315°) ±20° und bei S (180°) ±15°.

Bei der Suche wird geprüft: Liegt die gesuchte Windrichtung innerhalb von `mitte ± range` einer der Einträge?

Standardrichtungen zur Auswahl im UI:

| Kürzel | Grad |
|--------|------|
| N | 0° |
| NO | 45° |
| O | 90° |
| SO | 135° |
| S | 180° |
| SW | 225° |
| W | 270° |
| NW | 315° |

---

## 6. Features

### 6.1 Priorität 1 — v2 Kern ✅ FERTIG

**Spot-Suche** ✅
- Filter: Windrichtung (Buttons N/NO/O/SO/S/SW/W/NW), Disziplin, Sport (Windsurf/Kite)
- Freitextsuche nach Spotname oder Region (Live-Suche während Tippen)
- Ergebnisliste sortiert nach Distanz zum aktuellen Standort
- Jeder Spot zeigt: Name, Region, Distanz, Disziplin-Badges, Level

**Standort** ✅
- GPS-Standort des Users wird beim Öffnen ermittelt
- Distanzberechnung zu jedem Spot (Haversine-Formel)
- Fallback: Distanz wird nicht angezeigt wenn kein GPS (kein manueller Fallback nötig)

**Spot-Detailseite** ✅
- Alle Felder anzeigen
- Bildergalerie (ein oder mehrere Fotos via URL)
- Video eingebettet (YouTube/Vimeo iFrame) wenn vorhanden
- Externer Link-Button wenn vorhanden
- Google Maps Link mit Pin
- Windrose: SVG-Darstellung der funktionierenden Windrichtungen (dunkel, blau)

**Datenbank** ✅
- Firebase Firestore als Backend (Spark Plan — kostenlos)
- Spots werden einmalig geladen und lokal gecacht (Offline-Fähigkeit)
- 61 Spots importiert: Südafrika (16), Frankreich (28), Dänemark (17)

### 6.2 Priorität 2 — Admin-Bereich ✅ FERTIG

**Spot eintragen / bearbeiten** ✅
- Formular mit allen Feldern aus Abschnitt 5
- Windrichtungen: grafische Auswahl (8 Buttons + Range-Slider ±5°–45°)
- Foto-URLs: Liste von URLs, + hinzufügen / × entfernen
- Bilder werden über GitHub Repo gehostet (kein Firebase Storage nötig → kein Billing-Risiko)
- Nur für freigegebene User (Admin-Rolle)
- Firebase Authentication (Google Login)

**Rollen & Rechte** ✅
- `viewer`: Alle sehen, nichts ändern (Standard)
- `editor`: Spots eintragen und eigene bearbeiten
- `admin`: Alles, inkl. User verwalten

### 6.3 Priorität 3 — Nice to Have (teilweise fertig)

**Kartenansicht** ✅
- Toggle-Button 🗺️ in der Hauptansicht
- Leaflet.js + CartoDB Dark Tiles (kostenlos, kein API-Key)
- Alle gefilterten Spots als blaue Punkte
- Popup mit Name, Region, Distanz und "Details →" Link
- Karte aktualisiert sich live wenn Filter geändert werden

**Foto-Upload** ✅ (via URL, kein Firebase Storage)
- Fotos werden ins GitHub Repo geladen (`img/` Ordner)
- URL-Format: `https://3dclassen.github.io/windsurf-spot-finder/img/dateiname.jpg`
- Im Admin-Formular: beliebig viele URLs eintragen

**Noch offen:**
- [ ] Filterkombinationen speichern (localStorage)
- [ ] Teilen-Funktion (direkter Link zu einem Spot — URL mit `?id=`)
- [ ] PWA (Manifest + Service Worker für Offline & Homescreen-Icon)

### 6.4 Winddaten-Integration — Architektur-Vorbereitungen (Bonus / v3)

**Ziel:** Die App zeigt direkt bei jedem Spot die aktuelle Windvorhersage — und kann automatisch filtern: "Zeig mir alle Spots die heute und morgen passen."

**Datenquellen die in Frage kommen:**

| Quelle | Kosten | Qualität | API |
|--------|--------|----------|-----|
| Open-Meteo | kostenlos | gut | REST, keine Auth |
| Windy API | kostenlos (limitiert) | sehr gut | REST |
| Windguru | kein offizielles API | — | Scraping (fragil) |
| yr.no (Norwegisch) | kostenlos | gut | REST |

**Empfehlung:** Open-Meteo als erste Integration — kostenlos, keine API-Key nötig, liefert stündliche Windgeschwindigkeit und Richtung für jeden Lat/Lng-Punkt.

**Architektur-Vorbereitung (jetzt schon einplanen):**

Damit Winddaten später sauber integrierbar sind, legen wir von Anfang an fest:

1. Jeder Spot hat `lat` und `lng` — damit kann Open-Meteo direkt abgefragt werden
2. Die Windrichtungs-Datenstruktur (`mitte` + `range`) ist kompatibel mit automatischem Abgleich: "Liegt der heutige Wind innerhalb der Range dieses Spots?"
3. Ein separates `weather.js` Modul wird von Anfang an angelegt (zunächst leer), damit die Integration später kein Umbau erfordert
4. Die Suchergebnisse haben einen vorbereiteten Slot für Winddaten-Badges

**Automatischer Match (v3 Feature):**
```
Open-Meteo liefert: Windrichtung 310°, 18 kn
Spot "Sunset Beach": windrichtungen: [{ mitte: 315, range: 20 }]
→ 310° liegt in 315° ±20° → MATCH → Spot wird grün markiert
```

---

## 7. Technische Architektur

```
Frontend:          GitHub Pages (statische HTML/CSS/JS App)
Datenbank:         Firebase Firestore (Spark Plan, kostenlos)
Authentication:    Firebase Auth (Google Login für Admin)
Foto-Hosting:      GitHub Repo (img/ Ordner) — kein Firebase Storage
Karte:             Leaflet.js + CartoDB Dark Tiles (kostenlos)
Hosting:           github.com/3dclassen/windsurf-spot-finder
Live:              https://3dclassen.github.io/windsurf-spot-finder/
```

**Warum Firebase?**
- Bereits beim Cycle Tracker erfolgreich eingesetzt
- Kostenfrei im Spark Plan bis zu großzügigen Limits (siehe Abschnitt 8)
- Echtzeit-Sync, Offline-Fähigkeit, einfache Auth

---

## 8. Firebase Setup

### 8.1 Was braucht Firebase?

Für die App werden folgende Firebase-Dienste benötigt — alle im kostenlosen Spark Plan:

1. **Firestore Database** ✅ — Spot-Daten speichern
2. **Firebase Authentication** ✅ — Admin-Login (Google)
3. ~~Firebase Storage~~ — **nicht benötigt**, Fotos kommen aus GitHub Repo

### 8.2 Firebase einrichten — Schritt für Schritt

1. `console.firebase.google.com` öffnen
2. Neues Projekt erstellen: `windsurf-spot-finder`
3. Google Analytics: optional (kann deaktiviert werden)
4. Im Projekt: **Firestore Database** → "Create database" → Modus: **Production**
5. Standort: `europe-west3` (Frankfurt) empfohlen
6. **Authentication** → "Get started" → Google als Provider aktivieren
7. Im Projekt: **Projekteinstellungen** → "Web App hinzufügen" → Name: `windsurf-web`
8. Firebase gibt dir einen Config-Block — den brauchst du im Frontend:

```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

### 8.3 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Spots: jeder kann lesen, nur Admins schreiben
    match /spots/{spotId} {
      allow read: if true;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role
        in ['editor', 'admin'];
    }

    // Users: nur eigene Daten lesen, Admin schreibt Rollen
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
  }
}
```

### 8.4 Firebase Kosten (Spark Plan — kostenlos)

| Dienst | Kostenloses Limit | Reicht für... |
|--------|------------------|---------------|
| Firestore Reads | 50.000 / Tag | ~500 App-Öffnungen/Tag |
| Firestore Writes | 20.000 / Tag | Massig Spot-Einträge |
| Firestore Storage | 1 GB | Tausende Spots |
| Auth | Unbegrenzt | — |
| Storage | 5 GB | Viele Fotos |

**Fazit:** Für persönliche und Netzwerk-Nutzung bleibt die App dauerhaft kostenlos.

---

## 9. Projektstruktur (GitHub Repository)

```
windsurf-spot-finder/
├── index.html          ← Haupt-App (Suche, Filter, Karte)
├── spot.html           ← Spot-Detailseite (Windrose, Galerie, Video)
├── admin.html          ← Admin-Formular (geschützt, Google Login)
├── import.html         ← Einmalig-Tool: Daten → Firestore (nicht löschen!)
├── css/
│   └── style.css       ← Dunkles Theme, alle Komponenten
├── js/
│   ├── app.js          ← Hauptlogik, Suche, Filter, Karte (Leaflet)
│   ├── firebase.js     ← Firebase SDK + alle DB/Auth-Funktionen
│   ├── geo.js          ← GPS + Haversine-Distanzberechnung
│   ├── weather.js      ← Winddaten-Modul (leer — Vorbereitung v3)
│   └── admin.js        ← Admin-Formular-Logik inkl. Foto-URLs
├── img/                ← Spot-Fotos (manuell hochladen)
│   └── .gitkeep
├── icon-192.png        ← PWA App-Icon
├── icon-512.png        ← PWA App-Icon
├── manifest.json       ← PWA Manifest (noch nicht aktiv)
└── sw.js               ← Service Worker (noch nicht aktiv)
```

---

## 10. Was explizit NICHT in v2 kommt

- Social Features (Bewertungen, Kommentare)
- Live-Winddaten (Windguru-Integration)
- Native App (iOS/Android) — PWA reicht
- Mehrsprachigkeit
- Community-Upload ohne Admin-Freigabe

---

## 11. Offene Fragen & nächste Schritte

**Erledigt:**
- [x] Firebase Projekt anlegen
- [x] Firebase Config eingebunden
- [x] Spots importiert (61 Spots: Südafrika, Frankreich, Dänemark)
- [x] Windrichtungs-Range: Buttons + Slider umgesetzt
- [x] Foto-Lösung: GitHub Repo statt Firebase Storage

**Offen — kleine Features:**
- [ ] `img/` Ordner im GitHub Repo anlegen + erste Spot-Fotos hochladen
- [ ] Filterkombinationen speichern (localStorage) — 1–2h Aufwand
- [ ] Teilen-Funktion: direkter Link zu einem Spot (`spot.html?id=…` bereits funktioniert, nur Button fehlt)
- [ ] PWA aktivieren: `manifest.json` und `sw.js` einbinden → App auf Homescreen installierbar

**Offen — größere Features (v3):**
- [ ] Winddaten-Integration via Open-Meteo (kostenlos, kein API-Key)
  - `weather.js` ist vorbereitet, Datenstruktur ist kompatibel
  - Zeigt bei jedem Spot: aktueller Wind + ob Spot heute passt
- [ ] Weitere Länder/Spots eintragen (admin.html)

---

## 12. Entwicklungs-Workflow

**Änderungen machen:**
1. Datei lokal in VS Code bearbeiten (mit Claude)
2. Speichern
3. Auf GitHub hochladen: Repository → "Add file" → "Upload files" → Commit
4. GitHub Pages aktualisiert sich automatisch in 1–2 Minuten

**Für spätere Entwicklung empfohlen:** Git lokal einrichten und direkt per `git push` deployen — spart den manuellen Upload-Schritt.

---

## 13. Entwicklungsstand — April 2026

### Was läuft produktiv

| Feature | Datei | Status |
|---------|-------|--------|
| Spot-Suche + Filter | `index.html` + `js/app.js` | ✅ |
| GPS + Distanzberechnung | `js/geo.js` | ✅ |
| Kartenansicht (Leaflet) | `index.html` + `js/app.js` | ✅ |
| Spot-Detailseite | `spot.html` | ✅ |
| Windrose (SVG) | `spot.html` | ✅ |
| Firebase Firestore | `js/firebase.js` | ✅ |
| Offline-Cache | `js/app.js` (localStorage) | ✅ |
| Admin-Formular | `admin.html` + `js/admin.js` | ✅ |
| Google Login (Auth) | `js/firebase.js` | ✅ |
| Rollen (viewer/editor/admin) | Firestore `users` Collection | ✅ |
| Foto-URLs | `admin.js` | ✅ |
| 61 Spots (ZA/FR/DK) | Firestore `spots` Collection | ✅ |

### Technische Entscheidungen die getroffen wurden

- **Kein Firebase Storage** — Fotos via GitHub Repo URLs, kein Billing-Risiko
- **Kein Build-Tool** — reines HTML/CSS/JS mit ES Modules, läuft direkt auf GitHub Pages
- **Firebase SDK v10** via CDN — kein npm, kein Webpack
- **CartoDB Dark Tiles** für Karte — passt zum Dark Theme, komplett kostenlos
- **localStorage Cache** — App zeigt sofort Daten, auch wenn Firebase kurz langsam ist

### Wo weitermachen

Nächste sinnvolle Schritte in Reihenfolge:
1. **Fotos** — `img/` Ordner anlegen, erste Fotos für Kapstadt-Spots hochladen
2. **PWA** — `manifest.json` und `sw.js` aktivieren (2h) → App auf Handy-Homescreen
3. **Teilen-Button** — auf `spot.html` (1h)
4. **Winddaten** — `weather.js` befüllen mit Open-Meteo API (4–6h)
