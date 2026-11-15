# Prüfskripte

Die App braucht keinen Build. Dieser Ordner enthält nur Werkzeuge, mit denen sich der
Import gegen echte Kontoauszüge prüfen lässt. **Die Auszüge selbst gehören nie ins
Repository** – es ist öffentlich. Leg sie in einen Ordner `samples/` (steht in
`.gitignore`) oder irgendwo ausserhalb.

```bash
npm install                              # einmalig, holt playwright-core
node dev/probe-all.mjs samples           # Format, Anzahl, Zeitraum je Datei (ohne Browser)
node dev/categorize.mjs samples          # Anteil automatisch eingeordneter Buchungen
node dev/ibkr-check.mjs samples          # IBKR: Gelesenes gegen die Summen im Auszug
PW_CHROMIUM=/pfad/zu/chrome node dev/test-import.mjs samples   # End-zu-End über die Oberfläche
```

`test-import.mjs` startet die App in einem frischen Browserprofil, importiert jede Datei
über den Assistenten, prüft Verknüpfungen, Überträge und Depots und importiert dann
alles ein zweites Mal – dabei darf nichts hinzukommen. Kein Skript gibt Beträge oder
Buchungstexte aus, nur Stückzahlen und Differenzen.

Nach jeder Änderung am Code: `VERSION` in `sw.js` hochzählen, sonst laden die Geräte
die alte Fassung aus dem Zwischenspeicher weiter.
