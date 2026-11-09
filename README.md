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
