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

## Datenbank

Backend: **Firebase Firestore**  
Collection: `spots`  
Import-Tool: `import.html` (Login mit Admin-Google-Account erforderlich)

## Spot-Datenmodell

Pflichtfelder: `name`, `land`, `region`, `lat`, `lng`, `disziplinen[]`, `sport[]`, `windrichtungen[]`  
Standard-Felder: `level`, `tide`, `stroemung`, `beschreibung`, `bilder[]`, `video_url`, `link_url`  
England-Erweiterungen (optional, werden in spot.html angezeigt):  
`windrichtungen_text`, `tide_einfluss`, `big_days`, `parken`, `quelle`, `nummer_im_buch`,  
`kite_hinweis`, `kite_warnung`, `sicherheitshinweis`, `tide_warnung`, `tide_details`,  
`flachwasser_details`, `wind_besonderheit`, `flussmündung_warnung`, `spot_details`, `hinweis`
