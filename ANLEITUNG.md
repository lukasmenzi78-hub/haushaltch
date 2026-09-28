# HaushaltCH – Einrichtung und Bedienung

Eine Monarch-Money-Alternative für die Schweiz: Konten in CHF, EUR und USD, Flex-Budget,
deutsche Kategorien, Sparziele mit Prognose, Nettovermögen und eigene Berichte.
Läuft als installierbare App auf Windows, iPhone und Android – die Daten liegen in **einer
JSON-Datei in eurem OneDrive**. Keine Bankanbindung, kein fremder Server.

---

## Teil 0 – Schnell ausprobieren (kein Terminal nötig)

**Der einfachste Weg: `HaushaltCH-Einzeldatei.html` doppelklicken.**

Diese eine Datei enthält die komplette App inklusive aller Bibliotheken. Sie öffnet sich
im Standardbrowser und funktioniert sofort – auch ohne Internet:

1. Datei auf den Desktop legen und doppelklicken (öffnet sich in Edge oder Chrome).
2. Auf **„Beispieldaten laden“** klicken – ein erfundener Musterhaushalt mit zehn Monaten
   Buchungen zeigt Übersicht, Budget, Sparziele und Vermögen im Betrieb.
3. Danach unter **Import** die eigenen Excel-Dateien hineinziehen. Die Beispieldaten
   lassen sich mit einem Klick wieder entfernen.

Die Daten bleiben in diesem Browser auf diesem Rechner – ein Neustart verliert nichts.
Nicht enthalten sind OneDrive-Sync (braucht die Registrierung aus Teil 2) und die
Installation als App auf Handy und Tablet (braucht die Adresse aus Teil 1).

> Die Einzeldatei ist eine Momentaufnahme zum Testen. Weiterentwickelt und veröffentlicht
> wird der Ordner `app/`.

### Wenn du stattdessen den Ordner `app/` testen willst

Ein Doppelklick auf `index.html` funktioniert dort **nicht**: die App besteht aus
ES-Modulen, und die blockiert jeder Browser beim Öffnen direkt von der Festplatte.
Dafür braucht es einen lokalen Server – ein Befehl im entpackten Ordner `app`:

```bash
python3 -m http.server 8000      # oder unter Windows:  py -m http.server 8000
npx --yes serve -l 8000          # falls Node installiert ist
```

Danach `http://localhost:8000` im Browser öffnen.

**Windows Schritt für Schritt:** im Explorer in den Ordner `app` wechseln, in die
Adressleiste `powershell` tippen und Enter drücken – damit öffnet sich PowerShell genau
in diesem Ordner. Dort `py -m http.server 8000` eingeben. Fehlt Python, installiert
`winget install Python.Python.3.12` es in etwa einer Minute. Zum Beenden Strg + C.

---

## Teil 1 – Veröffentlichen (einmalig, ca. 10 Minuten)

Die App besteht nur aus statischen Dateien. Sie braucht eine Adresse im Internet, damit
Windows, iPhone und Android sie installieren können und damit die Microsoft-Anmeldung
funktioniert (`file://` reicht dafür nicht).

> **Für Lukas ist dieser Teil bereits erledigt.** Die App läuft unter
> **https://lukasmenzi78-hub.github.io/haushaltch/** aus dem Repository
> `lukasmenzi78-hub/haushaltch` (Branch `main`, Ordner `/ (root)`).
> Um eine neue Version zu veröffentlichen: die geänderten Dateien im Repository
> ersetzen – GitHub baut die Seite danach in ein bis zwei Minuten neu.

### Variante A – GitHub Pages (gratis, empfohlen)

1. Auf [github.com](https://github.com) anmelden und ein **öffentliches** Repository anlegen,
   z. B. `haushaltch`.
2. Den gesamten Inhalt des Ordners `app/` (also `index.html`, `js/`, `css/`, `vendor/`,
   `icons/`, `manifest.webmanifest`, `sw.js`) ins Repository hochladen –
   per Drag & Drop unter *Add file → Upload files* genügt.
3. **Settings → Pages → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`,
   speichern.
4. Nach ein bis zwei Minuten ist die App erreichbar unter
   `https://<dein-benutzername>.github.io/haushaltch/`.

> **Wichtig zur Vertraulichkeit:** Im Gratis-Tarif lässt sich GitHub Pages nur aus einem
> **öffentlichen** Repository betreiben – aus einem privaten Repository funktioniert Pages
> gar nicht, und die Sichtbarkeit des Repositories macht die veröffentlichte Seite ohnehin
> nie privat. Öffentlich ist hier also der **Programmcode** und die Adresse der App.
>
> Deine **Finanzdaten** sind davon nicht betroffen: Sie werden nie ins Repository
> hochgeladen. Sie liegen ausschliesslich in deinem OneDrive und lokal im Browser.
> Wer auch den Code nicht öffentlich haben möchte, nimmt Variante B.

### Variante B – Azure Static Web Apps (gratis, mit Zugriffsschutz)

1. Im [Azure-Portal](https://portal.azure.com) → *Static Web Apps* → **Erstellen**,
   Plan „Free“.
2. Als Quelle „Andere“ wählen und den Ordner `app/` mit der Azure-CLI hochladen:
   `swa deploy ./app --env production`
3. Die App liegt danach unter `https://<name>.azurestaticapps.net`.

### Variante C – ohne Veröffentlichung

Der lokale Server aus Teil 0 genügt zum Ausprobieren auf dem eigenen Rechner.
Für die Installation auf Handy und Tablet sowie für die OneDrive-Anmeldung braucht
es aber eine öffentliche Adresse.

---

## Teil 2 – OneDrive-Sync einrichten (einmalig, ca. 10 Minuten)

Damit die App direkt in dein OneDrive schreiben darf, braucht sie eine eigene
Anwendungs-ID. Die ist gratis und in wenigen Schritten angelegt.

> **Voraussetzung bei einem privaten Microsoft-Konto** (z. B. `@bluewin.ch`, `@outlook.com`):
> Microsoft erlaubt App-Registrierungen nur noch innerhalb eines Verzeichnisses. Ein
> privates Konto hat von sich aus keines – das Portal sperrt dann den Knopf *Neue
> Registrierung* mit dem Hinweis, Anwendungen ausserhalb eines Verzeichnisses seien
> veraltet.
>
> Abhilfe: einmalig ein **kostenloses Azure-Konto** unter
> [azure.microsoft.com/free](https://azure.microsoft.com/free) anlegen – „zur persönlichen
> Verwendung", Telefonnummer per SMS bestätigen, Identitätsprüfung per Karte (Microsoft
> bucht einen Kleinstbetrag und erstattet ihn sofort; es entsteht kein Abo und keine
> automatische Belastung). Dabei entsteht automatisch ein Verzeichnis
> („Default Directory"), und danach funktionieren die folgenden Schritte.
>
> Ein Geschäftskonto (Microsoft 365 über die Firma) bringt das Verzeichnis bereits mit –
> dort entfällt dieser Schritt, sofern die IT App-Registrierungen zulässt.

1. [entra.microsoft.com](https://entra.microsoft.com) öffnen und mit deinem
   Microsoft-Konto anmelden. (Alternativ
   [portal.azure.com](https://portal.azure.com) → *App-Registrierungen*.)
2. **Identität → Anwendungen → App-Registrierungen → Neue Registrierung**.
3. Ausfüllen:
   - **Name:** `HaushaltCH`
   - **Unterstützte Kontotypen:** *Konten in einem beliebigen Organisationsverzeichnis
     und persönliche Microsoft-Konten*
   - **Umleitungs-URI:** Plattform **Einzelseitenanwendung (SPA)** wählen und
     genau die Adresse eintragen, unter der die App läuft, inklusive `/index.html`,
     z. B. `https://deinname.github.io/haushaltch/index.html`
     (die App zeigt dir den exakten Wert unter *Einstellungen → OneDrive-Sync*).
4. **Registrieren** klicken und die **Anwendungs-ID (Client)** kopieren.
5. Links **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph →
   Delegierte Berechtigungen** und diese drei hinzufügen:
   `User.Read`, `Files.ReadWrite`, `Files.ReadWrite.All`.
6. In der App: **Einstellungen → OneDrive-Sync**, Client-ID einfügen,
   Dateipfad bei `HaushaltCH/haushalt.json` belassen und auf
   **Mit Microsoft anmelden** klicken.

Beim ersten Speichern legt die App die Datei selbst an.

### Gemeinsame Nutzung mit Lea

1. In OneDrive den Ordner `HaushaltCH` für Leas Microsoft-Konto freigeben –
   mit **Bearbeitungsrecht**.
2. Lea öffnet dieselbe Adresse, trägt **dieselbe Client-ID** ein und meldet sich mit
   **ihrem eigenen** Konto an.
3. Sie klickt auf **Gemeinsame Datei wählen** und nimmt `haushalt.json` aus der Liste.

Ab dann arbeiten beide auf demselben Stand. Die App gleicht beim Start, beim Wechsel
zurück ins Fenster und alle 90 Sekunden ab; Änderungen werden nach ein paar Sekunden
hochgeladen. Ändert ihr gleichzeitig etwas, werden die Daten **datensatzweise**
zusammengeführt – der jüngere Stand pro Buchung, Konto oder Budget gewinnt. Es gibt
keine „wer zuletzt speichert, überschreibt alles“-Situation.

---

## Teil 3 – Installieren auf den Geräten

Eure Adresse: **https://lukasmenzi78-hub.github.io/haushaltch/**

| Gerät | Schritte |
|---|---|
| **Windows** | Adresse in Edge oder Chrome öffnen → in der Adressleiste auf das Installations-Symbol klicken (oder Menü → *Apps → Diese Website als App installieren*). Danach liegt HaushaltCH als eigenes Fenster in Startmenü und Taskleiste. |
| **iPhone / iPad** | Adresse in **Safari** öffnen → Teilen-Symbol → *Zum Home-Bildschirm*. (Nur Safari kann das; Chrome auf iOS nicht.) |
| **Android** | Adresse in Chrome öffnen → Menü → *App installieren* bzw. *Zum Startbildschirm hinzufügen*. |

Nach der Installation läuft die App auch offline. Anmeldung und Sync laufen automatisch,
sobald wieder Verbindung besteht.

---

## Teil 4 – Erste Schritte

1. **Import** öffnen und die Excel-Dateien der Banken hineinziehen. Erkannt werden:
   - UBS Privatkonto (die aus dem PDF extrahierten Arbeitsmappen)
   - UBS Kreditkarte, Coop Supercard / Viseca, PostFinance (13-spaltiges Format)
   - PostFinance-CSV sowie beliebige andere CSV/Excel-Dateien über die Spaltenzuordnung
2. Im Assistenten kontrollieren: Konto, Person je Karte, Saldo. Bei Kartenauszügen ohne
   Saldo den aktuellen Kontostand eintragen – sonst stimmt das Nettovermögen nicht.
3. **Dieselbe Datei zweimal importieren schadet nicht.** Die App vergleicht jede Zeile
   mit dem Bestand und zeigt im Assistenten, wie viele Zeilen neu sind und wie viele
   schon vorhanden. Duplikate sind in der Vorschau markiert und werden nicht übernommen.
   Auch überlappende Monatsauszüge funktionieren: aus Jan–Mai und Apr–Aug landen die 74
   doppelten Zeilen nur einmal in der App.
4. Nach dem Import **„Überträge zwischen Konten erkennen“** anklicken. Damit werden
   Zahlungen von Konto zu Karte als Umbuchung markiert und nicht doppelt als Ausgabe
   gezählt.
5. **Buchungen → „Nur nicht zugeordnet“** durchgehen. Zu häufigen Empfängern eine Regel
   erstellen (im Buchungsdialog auf *Regel erstellen*) – ab dann läuft es automatisch.
6. **Budget:** Einkommen und Fixkosten eintragen oder **„Aus Ø 3 Monate“** nutzen.
   Der flexible Topf ergibt sich dann von selbst.
7. **Budget → Wiederkehrend** öffnen und die erkannten Serien übernehmen. Danach zeigt
   **Prognose**, wie sich die Konten entwickeln.
8. **Vermögen:** Immobilie, Hypothek, Säule 3a und Depot als Positionen erfassen –
   damit wird das Nettovermögen vollständig.
9. **Sparziele** anlegen; die Prognose zeigt, wann das Ziel bei der aktuellen Rate
   erreicht ist und welche Rate für den Wunschtermin nötig wäre.

---

## Prognose: reicht das Geld bis zum Lohn?

Unter **Budget → Prognose** rechnet die App die Kontostände voraus – aus den
wiederkehrenden Zahlungen und dem durchschnittlichen Alltagsverbrauch.

- Zeitraum 30 Tage bis 1 Jahr.
- **Mindestpolster** eintragen: unterschreitet die Kurve diesen Betrag, warnt die App mit
  Datum und nennt den grössten Posten davor.
- **Alltagsausgaben** lassen sich ausblenden, dann zeigt die Kurve nur die fixen Posten.
  Der Tagesschnitt kommt aus den letzten drei Monaten und klammert die geführten Serien
  aus, damit nichts doppelt zählt.
- **± Was wäre wenn:** einen einmaligen Posten annehmen (Ferien anzahlen, Bonus,
  neue Waschmaschine) und sehen, was er mit der Liquidität macht. Diese Annahmen gelten
  nur für die aktuelle Sitzung und werden nicht gespeichert.
- Darunter die Liste der anstehenden Posten mit dem Kontostand am jeweiligen Tagesende.

---

## Wiederkehrend: Fixkosten, Abos und Lohn

**Budget → Wiederkehrend** erkennt Serien aus deinen Buchungen: gleicher Empfänger,
regelmässiger Abstand, stabiler Betrag. Jeder Vorschlag zeigt den erkannten Rhythmus und
eine Sicherheit in Prozent; einzeln oder alle auf einmal übernehmen.

Übernommene Serien zeigen pro Zeile:

| Spalte | Bedeutung |
|---|---|
| **Rhythmus** | wöchentlich bis jährlich, aus den Abständen abgeleitet |
| **pro Monat** | auf den Monat umgerechnet – so vergleichbar wie eine Miete |
| **Nächste Fälligkeit** | wann die nächste Zahlung erwartet wird |
| **Status** | bezahlt (mit Datum), fällig in X Tagen, oder überfällig |

„Bezahlt“ erkennt die App daran, dass im Zeitfenster um die Fälligkeit eine passende
Buchung steht. Überfälliges verschwindet nicht: es erscheint in der Prognose am ersten
Tag. Oben stehen die fixe Monatslast, die wiederkehrenden Einkünfte und was in den
nächsten 30 Tagen fällig wird.

Serien lassen sich auch von Hand anlegen – etwa für eine Rechnung, die noch nie
im Konto erschienen ist.

---

## Buchungen aufteilen

Ein Beleg, mehrere Kategorien: im Buchungsdialog auf **„Buchung aufteilen“**. Die App
legt zwei Teile an, weitere lassen sich hinzufügen. Unter den Zeilen steht laufend, wie
viel noch offen ist; **„Rest auf den letzten Teil“** gleicht auf den Rappen aus. Was nicht
aufgeteilt wird, bleibt auf der Kategorie der Buchung – es geht also nie Geld verloren.

Aufgeteilte Buchungen sind in der Liste mit „2 Teile“ markiert und fliessen anteilig in
Budget, Berichte und Auswertungen ein.

---

## Anlagen: ETFs, Aktien und andere Wertschriften

Die Ansicht **Anlagen** führt einzelne Positionen statt nur eines Depotsaldos.

### Positionen erfassen

- **IBKR-Auszug importieren:** In der Client Portal unter *Performance & Reports →
  Statements* ein **Activity Statement** als CSV herunterladen (oder eine Flex Query mit
  den Abschnitten *Open Positions*, *Dividends*, *Withholding Tax*). Datei ins
  Import-Fenster ziehen – die App erkennt sie automatisch, legt das Depot an und
  übernimmt Positionen, Einstandskurse und Dividenden inklusive Quellensteuer.
  Beim zweiten Import werden vorhandene Positionen **aktualisiert**, nicht verdoppelt;
  auf Wunsch gelten fehlende Positionen als verkauft.
- **Startdatei:** `IBKR-Positionen.json` enthält deine aktuellen Positionen. Einmal ins
  Import-Fenster ziehen, dann ist das Depot sofort gefüllt.
- **Von Hand:** „+ Position“ für alles ausserhalb von IBKR – Säule-3a-Fonds, ein
  Bankdepot, Krypto.

### Tageskurse

Ein Gratis-Schlüssel bei einem Kursanbieter genügt, einzurichten unter
**Einstellungen → Kurse**:

1. Bei [twelvedata.com](https://twelvedata.com/pricing) (800 Abfragen pro Tag) oder
   [finnhub.io](https://finnhub.io/register) kostenlos registrieren.
2. Den Schlüssel in die App kopieren und auf **Speichern und prüfen** klicken – die App
   holt testweise einen Kurs.
3. Ab dann aktualisiert „⟳ Kurse aktualisieren“ alle Positionen; höchstens einmal
   alle sechs Stunden, damit das Gratiskontingent reicht.

Der Schlüssel bleibt auf dem jeweiligen Gerät und wird **nicht** über OneDrive geteilt –
Lea trägt auf ihrem Gerät einen eigenen ein (oder denselben).

US-Titel laufen mit dem normalen Kürzel (`VT`, `SCHD`, `AMZN`). Für die SIX braucht
Twelve Data einen Zusatz: `NESN:SIX`, `UHR:SIX`, `CHSPI:SIX`. Das Kürzel lässt sich je
Position anpassen. Ohne Schlüssel funktioniert alles weiter – die Kurse werden dann von
Hand gepflegt, und die App zeigt an, von wann sie stammen.

### Was die Ansicht zeigt

| Bereich | Inhalt |
|---|---|
| **Kopfzeile** | Depotwert, Gewinn/Verlust gegenüber Einstand, Tagesveränderung |
| **Aufteilung** | Ring nach Anlageart, Region, Währung oder Einzelposition |
| **Verlauf** | Depotwert über die Zeit, zerlegt in Einzahlungen und Marktbewegung |
| **Positionen** | Anzahl, Kurs, Einstand, Wert, G/V absolut und in Prozent, Anteil am Depot |
| **Dividenden** | Pro Jahr brutto, Quellensteuer und netto; CSV-Export fürs Wertschriftenverzeichnis |

Der Verlauf baut sich ab dem ersten Kursabruf auf: die App hält bei jeder Aktualisierung
den Depotstand fest. Rückwirkende Kurse gibt es nicht – Monate ohne Stand bleiben in der
Kurve leer statt bei null.

**Zum Gewinn in CHF:** Er rechnet mit dem heutigen Wechselkurs, weil der Auszug den
Einstand nur in Positionswährung liefert. Wer den Einstand in CHF kennt, trägt ihn in der
Position ein – dann weist die App den Währungseffekt getrennt vom Kursgewinn aus.

Das Depot fliesst automatisch ins **Nettovermögen** ein: der Kontosaldo ergibt sich aus
den Positionen plus Barbestand, es braucht keinen manuell gepflegten Wert mehr.

---

## Wie das Flex-Budget rechnet

Jede Kategorie hat einen Typ:

| Typ | Bedeutung |
|---|---|
| **Einkommen** | Zufluss – bildet die Basis |
| **Fixkosten** | jeden Monat etwa gleich (Miete, Krankenkasse, Abos) |
| **Unregelmässig** | selten, dafür gross (Steuern, Ferien, Autoversicherung) – wird über den Jahresbetrag monatlich zurückgestellt |
| **Sparen & Vorsorge** | Säule 3a, Depot, Sparziele |
| **Flexibel** | der Alltag: Lebensmittel, Restaurant, Kleidung … |
| **Übertrag** | Geld wechselt nur das Konto – zählt nicht als Ausgabe |

> **Flexibler Topf = Einkommen − Fixkosten − Rückstellungen − Sparen**

Der Balken vergleicht die bisherigen flexiblen Ausgaben mit dem Betrag, der bis zum
heutigen Tag im Monat üblich wäre. Grün heisst: im Plan. Zusätzlich zeigt die App,
wie viel pro verbleibendem Tag noch möglich ist.

---

## Währungen

Basiswährung ist CHF. Konten in EUR und USD werden für Auswertungen umgerechnet, in der
Kontoansicht aber in ihrer eigenen Währung gezeigt. Kartenbuchungen in Fremdwährung
behalten Originalbetrag und Kurs aus der Bankdatei. Die Kurse kommen von den
EZB-Referenzkursen (frankfurter.app, kein Schlüssel nötig) und lassen sich unter
*Einstellungen → Währungen* auch von Hand setzen.

---

## Datensicherheit

- Die Daten liegen ausschliesslich in eurem OneDrive und lokal im Browser-Speicher der
  Geräte. Es gibt keinen Server, der mithört.
- Die Anmeldung läuft direkt mit Microsoft (OAuth 2.0 mit PKCE, kein Passwort in der App).
- Unter *Import → Sicherung herunterladen* bzw. *Einstellungen → Daten* gibt es jederzeit
  eine vollständige JSON-Sicherung. Eine solche Datei kann man einfach wieder in das
  Importfenster ziehen – sie wird zusammengeführt, nicht überschrieben.

---

## Was die App bewusst nicht kann

- **Keine automatische Bankanbindung.** Schweizer Banken bieten dafür keine offene
  Schnittstelle für Privatpersonen; der Weg führt über die Excel-/CSV-Exporte.
- **Keine Realtime-Kurse.** Die Gratis-Tarife der Kursanbieter liefern Schlusskurse bzw.
  leicht verzögerte Kurse – für die Vermögensübersicht genügt das, für Handelsentscheide nicht.
- **Keine Steuererklärung.** Die Berichte lassen sich aber als CSV exportieren.

---

## Aufbau des Ordners

```
app/
  index.html              Einstiegspunkt
  manifest.webmanifest    PWA-Manifest (Installation)
  sw.js                   Service Worker (Offline-Betrieb)
  css/app.css             Design-Tokens, Layout, Hell/Dunkel
  vendor/                 SheetJS (Excel) und MSAL (Microsoft-Anmeldung), lokal eingebunden
  icons/                  App-Symbole
  js/core/                Datenmodell, Speicher, Parser, Regeln, Budget, Ziele, Berichte, Sync
  js/ui/                  Ansichten und Diagramme
```

Alles ist reines JavaScript ohne Build-Schritt: Datei ändern, hochladen, fertig.
