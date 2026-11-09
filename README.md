# Pitwall2027

Copia di prova di PitComm (server + web app) con in più l'app Android (APK).

- **`src/`, `public/`, `package.json`**: la web app e il server, copiati da `pitwallnew`. Su Render gira come **servizio separato**, così il servizio delle gare (`pitwallnew`) non si tocca.
- **`android/`** (in arrivo): involucro Android che apre questo servizio, con schermo sempre acceso, notifiche e allarmi a schermo spento e, poi, le zone GPS box / rifornimento.
- **`README-webapp.md`**: la guida completa della web app (variabili d'ambiente, uso, ecc.).

Quando la versione di prova funziona, si passa a questa: basta cambiare il repository su Render (o l'indirizzo dell'APK).

## App Android (cartella `android/`)

Involucro Android di PitComm: apre la web app (indirizzo scelto al primo avvio, cambiabile dal tasto indietro),
tiene lo schermo acceso, resta attivo a schermo spento (servizio in primo piano + wake lock),
chiede di escludere il risparmio batteria e manda notifiche vere (`window.PitCommAndroid.notifica`).
Si compila su GitHub: **Actions → "Android APK"** (parte da sola a ogni modifica in `android/`, oppure "Run workflow").
L'APK finisce in **Releases → apk-latest** (e tra gli artefatti dell'esecuzione). Firma fissa nel repo, quindi gli aggiornamenti si installano sopra la versione vecchia.

## GPS e automatismi (spenti all'inizio)

Si accendono dal box: **Impostazioni → GPS e automatismi**.
- Il telefono dell'auto (Android) manda la posizione solo con il GPS acceso; sullo schermo dell'auto non compare nulla.
- Il box imposta le due zone stando nel punto (**Zona BOX = qui**, **Zona RIFORNIMENTO = qui**) e i raggi in metri (10 e 25 di partenza).
- Auto nella zona box = ai box; nella zona rifornimento = rifornimento (per il carburante conta come ai box); fuori = in pista.
  Serve restare circa 10 secondi nella zona; punti con precisione peggiore di 30 m si ignorano; senza segnale resta l'ultimo stato.
- Solo il telefono con **"Questo telefono applica lo stato"** acceso cambia in pista / ai box (si accende da solo su chi accende il GPS).
- A mano si corregge sempre: **In pista** / **Ai box** valgono sempre; il GPS interviene solo quando la zona cambia. **Allinea ora al GPS** forza lo stato che dice il GPS.
- **Soglia di tempo fermo** (secondi, impostabile): fermi al rifornimento oltre la soglia, il box chiede "era un cambio pilota?". Sì = si registra il cambio e riparte il "turno pilota". Una sola domanda per sosta.
- Server: eventi `gpsConfigUpdate` (solo box) e `gpsPos` (solo auto, al massimo 1/s, solo a GPS acceso); le zone si salvano con le altre impostazioni.
