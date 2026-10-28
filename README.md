# Kässeli

[![Tests](https://github.com/chfelser-hash/kaesseli/actions/workflows/tests.yml/badge.svg)](https://github.com/chfelser-hash/kaesseli/actions/workflows/tests.yml)

Haushaltsbudget als Web-App – Nachfolger der Excel-Datei.
Läuft im Browser auf Windows und Android (installierbar als App), die Daten liegen auf der eigenen Synology NAS.

- **Erfassen** – Ausgaben in Sekunden eintragen: Betrag, Topf, Kategorie, Zahlungsmittel. Beträge dürfen gerechnet werden (`1500+120`). Sammelerfassung für ganze Kreditkartenabrechnungen (ein Betrag pro Zeile). Bekannte Notizen füllen Topf und Kategorie automatisch aus.
- **Übersicht** – Monitoring wie bisher: Budget vs. Ist pro Monat, Differenz und kumulierte Differenz, Saldo und Prognose pro Topf, Auswertung nach Kategorie, geplante Ausgaben.
- **Budget** – Jahresbudget bearbeiten (Einkommen, Töpfe, Posten, monatlich/jährlich/13×). «Neues Jahr» kopiert das Budget und übernimmt Salden als Übertrag.
- **Abrechnung** – Knopf «Jetzt abrechnen» speichert den Zeitpunkt der Monatsabrechnung (Datum + Uhrzeit). Die Ansicht «Abrechnung» zeigt alles seit der letzten Abrechnung oder frühere Zyklen; der Import übernimmt auf Wunsch nur Buchungen zwischen der vorherigen und der letzten Abrechnung (mit Uhrzeit, wo vorhanden).
- **Import** – CSV-Auszüge (PostFinance, Kreditkarte) einlesen, Spalten werden erkannt, Regeln ordnen wiederkehrende Händler automatisch zu, Duplikate werden erkannt.
- **Mehr** – Zahlungsmittel, Regeln, Benutzer, Sicherung.

Keine externen Abhängigkeiten: nur Node.js. Daten werden als JSON-Datei gespeichert, mit täglicher automatischer Sicherung (30 Tage).

> **Datenschutz:** Im Repo liegt kein einziger persönlicher Wert. Der Ordner `data/`, Excel- und CSV-Dateien sowie Import-/Sicherungsdateien sind per `.gitignore` ausgeschlossen. Bitte nichts davon manuell einchecken.

---

## 1. Lokal starten (Windows)

1. [Node.js](https://nodejs.org) (LTS, ab Version 20) installieren.
2. Repo herunterladen oder klonen.
3. `start.bat` doppelklicken – der Browser öffnet <http://localhost:8080>.
4. Beim ersten Aufruf ein Konto anlegen.

Alternativ im Terminal: `npm start` (Port ändern mit `set PORT=3000`).

Die Daten liegen danach im Ordner `data/` neben dem Programm.

## 2. Bisherige Excel-Daten übernehmen

```bash
npm run import-excel -- "C:\Pfad\zu\budget.xlsx"
```

Das Skript liest Budget, Monitoring, sporadische Ausgaben und Ferien des neusten Jahres (oder `--jahr 2026`) sowie die Ferienplanung des Folgejahres und prüft die Monatssummen gegen das Excel-Monitoring.
Es entsteht die Datei `budget-import-2026.json`. Diese in der App unter **Mehr → Sicherung einspielen** hochladen – lokal oder auf der NAS.

Hinweise zur Übernahme:
- Haushalt wird als Monatstotal übernommen (so wie es im Excel stand), neue Ausgaben dann einzeln.
- Posten mit Datum in der Zukunft (z.B. «programmiert» oder die Krankenkasse im Dezember) erscheinen als **geplant**.
- Kategorien der sporadischen Ausgaben werden anhand von Stichworten zugeordnet (Arzt, Geschenk, Energie …) und lassen sich nachträglich anpassen.
- Die Lohnzeilen heissen «Lohn 1» und «Lohn 2» – im Tab Budget umbenennen.
- Die Importdatei enthält persönliche Daten: nach dem Einspielen löschen.

## 3. Betrieb auf der Synology DS218+

Die DS218+ (Intel x86) unterstützt den **Container Manager** (DSM 7.2).

1. Im Paket-Zentrum **Container Manager** installieren.
2. In der File Station einen Ordner anlegen, z.B. `/docker/kaesseli`, und den Inhalt dieses Repos hineinkopieren (oder per SSH: `git clone https://github.com/chfelser-hash/kaesseli.git /volume1/docker/kaesseli`).
3. Container Manager → **Projekt** → **Erstellen**
   - Projektname: `kaesseli`
   - Pfad: `/docker/kaesseli`
   - Quelle: «Vorhandene docker-compose.yml verwenden»
   - Erstellen – das Image wird auf der NAS gebaut und gestartet.
4. Aufruf im Heimnetz: `http://<IP-der-NAS>:8080`, erstes Konto anlegen, dann unter **Mehr** die zweite Person hinzufügen.

Die Daten liegen in `/docker/kaesseli/data` und werden von Hyper Backup mitgesichert, wenn der Ordner `docker` im Backup-Job ist.

### Zugriff von unterwegs (HTTPS)

Für Android-Installation und Zugriff von ausserhalb wird HTTPS benötigt:

1. **Systemsteuerung → Externer Zugriff → DDNS**: z.B. `xyz.synology.me` einrichten.
2. **Systemsteuerung → Sicherheit → Zertifikat**: Let's-Encrypt-Zertifikat für `kaesseli.xyz.synology.me` (oder die DDNS-Adresse) erstellen.
3. **Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen**
   - Quelle: HTTPS, Hostname `kaesseli.xyz.synology.me`, Port 443
   - Ziel: HTTP, `localhost`, Port 8080
   - Unter «Benutzerdefinierter Header» → «Erstellen» → «WebSocket» (schadet nicht) und zusätzlich `X-Forwarded-Proto` = `$scheme`.
4. Im Router Port 443 auf die NAS weiterleiten (falls nicht schon geschehen).

Die App verlangt immer ein Login; nach 8 Fehlversuchen wird für 15 Minuten gesperrt. Sessions sind 90 Tage gültig.
Wer die App nur über HTTPS nutzt, kann in `docker-compose.yml` `COOKIE_SECURE=true` setzen.

### Update

Neue Version ins Verzeichnis kopieren bzw. `git pull`, dann im Container Manager das Projekt **stoppen → erstellen (Build)** → starten. Die Daten bleiben erhalten.

## 4. Als App installieren

- **Android (Chrome):** Seite öffnen → Menü ⋮ → «Zum Startbildschirm hinzufügen» / «App installieren».
- **Windows (Edge/Chrome):** In der Adressleiste auf das Installieren-Symbol klicken.

## 5. Neues Jahr vorbereiten

Tab **Budget → + Neues Jahr**: Vorlage wählen (z.B. Budget 2026 kopieren). Die App schlägt als Übertrag den prognostizierten Saldo Ende Jahr pro Topf vor (z.B. Ferienkonto) – anpassbar. Danach Beträge im neuen Jahr anpassen; Buchungen mit Datum im neuen Jahr (z.B. bereits geplante Ferien) werden automatisch dem neuen Jahr zugerechnet.

## 6. Monatsabrechnung – Ablauf

1. Tab **Erfassen** → **Abrechnung** → **Jetzt abrechnen** (Zeitpunkt ist vorausgefüllt, anpassbar).
2. Tab **Import**: Kreditkarte (Text einfügen) und Postkonto (CSV) einlesen. Voreinstellung «Nur bis zur letzten Abrechnung»: Buchungen ausserhalb des Zyklus sind abgewählt und markiert.
3. Tab **Erfassen** → **Abrechnung**: Der eben abgeschlossene Zyklus ist ausgewählt, inkl. Auswertung nach Zahlungsmittel.

Frühere Abrechnungszeitpunkte lassen sich unter **Mehr → Abrechnungen** nachtragen oder löschen. Der Excel-Import übernimmt die Zeitpunkte aus dem Monitoring.

## 7. Import von Kontoauszügen

- **PostFinance:** E-Finance → Konto → Bewegungen → Export «CSV».
- **Kreditkarte (Viseca One / Migros Cumulus):** Viseca One bietet keinen Export der aktuellen Transaktionen. Stattdessen auf <https://one.viseca.ch> → Transaktionen bis zum gewünschten Datum nach unten scrollen, die Liste markieren (oder Strg+A), kopieren (Strg+C) und in Kässeli unter **Import → Text einfügen …** einfügen. Datum, Händler und CHF-Betrag werden erkannt, Fremdwährungsbeträge, Kontostand und Limite übersprungen, Zahlungen an die Karte als Gutschrift erkannt (standardmässig ignoriert). Bereits übernommene Transaktionen werden beim nächsten Einfügen als Duplikat markiert – man kann also immer die ganze Liste einfügen.

Beim ersten Import einer neuen Bank die erkannten Spalten prüfen und **Als Profil speichern**. Beim nächsten Mal wird das Format automatisch erkannt. Zeilen wie Lohn, Miete oder Umbuchungen auf «— ignorieren —» setzen und mit **Regel** merken.

## Technisches

| | |
|---|---|
| Server | `server/` – Node.js ohne Abhängigkeiten, REST-API unter `/api` |
| Oberfläche | `public/` – HTML/CSS/JavaScript-Module, PWA mit Service Worker |
| Daten | `data/budget.json`, `data/users.json`, `data/backups/` |
| Konfiguration | `PORT` (8080), `DATA_DIR` (./data), `COOKIE_SECURE` |
| Tests | `npm test` (Logik + Server), `npm run test:e2e` (Browser, benötigt `playwright`) |

## Automatische Tests (GitHub Actions)

Bei jedem Push prüft GitHub die App automatisch (`.github/workflows/tests.yml`). Das Ergebnis zeigt das Abzeichen oben bzw. der Reiter **Actions** im Repo.

| Prüfung | Was getestet wird |
|---|---|
| Rechenlogik & Server (Node 22 und 24) | Budget- und Spar-Rechnung, Monitoring, Unterkategorien, Abrechnungszyklen, CSV/Viseca-Import; Server: Anmeldung, Schutz ohne Login, Sperre nach Fehlversuchen, Buchungen, Budget, Abrechnungen, Sicherung/Wiederherstellung, Neustart, frische Installation |
| Oberfläche im Browser | Alle Tabs ohne JavaScript-Fehler, Budget speichern, Ausgabe erfassen, Rückfrage beim Löschen, Dialoge, «Jetzt abrechnen», Kreditkarten-Text importieren inkl. Duplikaterkennung, Übersicht, Handy-Ansicht ohne seitliches Scrollen, Abmelden |
| Docker-Image | Image bauen und wie auf der DS218+ mit leerem Datenordner starten |

Alle Tests arbeiten mit erfundenen Daten und einem leeren, temporären Datenordner – persönliche Daten kommen nie ins Repo oder in die Tests.

Lokal: `npm test` sowie `npm run test:e2e` (vorher einmal `npm install --no-save playwright` und `npx playwright install chromium`).
