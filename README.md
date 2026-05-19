# Digitales Bullet Journal — PWA

Ein vollständiges digitales Bullet Journal als **Progressive Web App**.
Hierarchische Kalenderansichten (Jahr → Monat → Woche → Tag), vernetzte
Sammlungen, verschlüsselter Export, wiederkehrende Aufgaben, Volltextsuche,
Backlinks und `.ics`-Kalenderimport — komplett **offline-fähig** und ohne
Server.

Gebaut mit reinem HTML, CSS und JavaScript. Kein Framework, kein Build-Schritt.
Einzige externe Abhängigkeit ist CryptoJS (vom CDN) für die AES-256-
Verschlüsselung des Exports.

---

## Funktionen im Überblick

- **Vier Kalenderebenen** — Jahres-Heatmap, Monatsmatrix, Wochenraster mit
  Drag & Drop und eine ausführliche Tagesansicht.
- **Rapid Logging** — acht Symbole (Aufgabe, Notiz, Event, Erledigt,
  Priorität, Recherche, Idee, Telefonat).
- **Sammlungen** — Projekte, Personen, Wissensbasis und frei definierbare
  eigene Sammlungen mit benutzerdefinierten Feldern.
- **Backlinks** — `[[Projekt]]` und `@Person` in Notizen erzeugen automatisch
  Querverweise zwischen Tagen, Projekten und Wissens-Einträgen.
- **Aufgaben-Manager** — zentrale Übersicht mit Filtern, Sortierung,
  Paginierung (50 pro Seite) und Bulk-Erledigen.
- **Wiederkehrende Aufgaben** — täglich, wöchentlich oder monatlich.
- **Volltextsuche** — über Tage, Wissen und externe Termine, mit Zeitraum-
  und Projekt-/Personen-Filtern.
- **`.ics`-Import** — externe Kalendertermine lokal einlesen und mit Aufgaben
  verknüpfen.
- **Export & Import** — unverschlüsselt als `.json` oder AES-256-verschlüsselt
  als `.bujo`; drei Import-Modi (Überschreiben, Zusammenführen, Neue IDs).
- **Auto-Backup** — nach jeder zehnten Änderung und beim Schließen der App.
- **Smartphone-optimiert** — Wisch-Gesten, haptisches Feedback, Bottom-Nav,
  Schnellnotiz-Button, „Zum Home-Bildschirm hinzufügen".
- **Hell & Dunkel** — folgt der Systemvorgabe oder manuell umschaltbar.

---

## Lokal starten

Die App muss über einen Webserver laufen (Service Worker und IndexedDB
funktionieren nicht über `file://`). Im Projektordner genügt einer dieser
Befehle:

```bash
npx http-server -p 8080
# oder
python3 -m http.server 8080
```

Danach `http://localhost:8080` im Browser öffnen. Beim ersten Start wird
automatisch ein Demo-Datensatz angelegt.

---

## Auf GitHub Pages veröffentlichen

Die App ist vollständig **GitHub-Pages-kompatibel**, weil sämtliche Pfade
**relativ** sind (`./script.js`, `./sw.js`, `./icons/...` usw.). Sie
funktioniert daher unverändert sowohl unter `benutzername.github.io` als auch
in einem Unterverzeichnis wie `benutzername.github.io/mein-repo/`.

1. Dateien in ein GitHub-Repository pushen (alle Dateien im Wurzelverzeichnis
   oder im Ordner `docs/`).
2. Im Repository unter **Settings → Pages** als Quelle den passenden Branch
   und Ordner wählen.
3. Die veröffentlichte URL aufrufen — fertig.

**Warum relative Pfade?** GitHub Pages serviert Projektseiten unter einem
Unterpfad. Ein absoluter Pfad wie `/sw.js` würde dort ins Leere zeigen. Der
Service Worker leitet sein Basisverzeichnis zur Laufzeit aus
`self.location.pathname` ab und wird mit `register('./sw.js', { scope: './' })`
registriert — dadurch ist kein hartcodierter Repository-Name nötig.

---

## Auf dem Smartphone installieren

- **Android (Chrome):** Menü → „App installieren" bzw. „Zum Startbildschirm
  hinzufügen". Alternativ erscheint in der App ein Installations-Button.
- **iOS (Safari):** Teilen-Symbol → „Zum Home-Bildschirm". Die App startet
  danach im Vollbild und funktioniert offline.

---

## Tastaturkürzel

| Taste   | Funktion                          |
|---------|-----------------------------------|
| `n`     | Schnellnotiz öffnen               |
| `t`     | Neue Aufgabe                      |
| `d`     | Zum heutigen Tag springen         |
| `j`     | Einen Tag zurück                  |
| `k`     | Einen Tag vor                     |
| `s`     | Suche öffnen                      |
| `?`     | Hilfe / Kürzelübersicht           |
| `Esc`   | Dialog oder Overlay schließen     |

In der Tagesansicht lässt sich außerdem nach links/rechts wischen, um den
Tag zu wechseln.

---

## Datenschutz

Alle Journal-Daten bleiben **ausschließlich lokal** auf dem Gerät, gespeichert
in der IndexedDB des Browsers.

- Keine Cloud, kein Server, keine Benutzerkonten.
- Kein Tracking, keine Analytics, keine Cookies.
- Der `.ics`-Import wird rein lokal verarbeitet — es wird keine externe
  Kalender-Schnittstelle kontaktiert.
- Backups lassen sich auf Wunsch AES-256-verschlüsselt exportieren.
- Einzige externe Ressource ist die CryptoJS-Bibliothek vom CDN, die nur für
  die Verschlüsselung geladen wird. Die App funktioniert auch ohne sie —
  dann steht lediglich der verschlüsselte Export nicht zur Verfügung.

Ein vollständiges Zurücksetzen ist jederzeit über **Einstellungen →
Zurücksetzen** möglich.

---

## Projektstruktur

```
index.html        App-Grundgerüst und DOM-Struktur
style.css         Gesamtes Styling (Themes, Layout, Druckansicht)
script.js         Komplette App-Logik in logischen Modulen
manifest.json     PWA-Manifest (Icons, Shortcuts, Share Target)
sw.js             Service Worker (Offline-Cache)
offline.html      Fallback-Seite ohne Verbindung
icons/            App-Icons in allen erforderlichen Größen
```

Die `script.js` ist bewusst eine einzige Datei, intern aber klar in Module
gegliedert (CONFIG, utils, db, demo, calendar, heatmap, backlinks, recurring,
search, icsParser, extCal, exportImp, mobile, keyboard, ui, app), jeweils
durch Kommentar-Banner getrennt.

---

## Browser-Unterstützung

Aktuelle Versionen von Chrome, Firefox, Edge und Safari (Desktop und Mobil).
Erforderlich sind IndexedDB, Service Worker und ES2017+. Im privaten Modus
einiger Browser ist IndexedDB eingeschränkt — die App weist in dem Fall
darauf hin.
