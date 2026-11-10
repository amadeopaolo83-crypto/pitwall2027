# Prove automatiche

Script di collaudo con Playwright (browser) e con finti socket (server). Ognuno stampa `OK`/`MALE` per ogni controllo ed
esce con codice 1 se qualcosa non va. Girano da soli su GitHub a ogni modifica di `main` (Actions → **Prove**,
`.github/workflows/prove.yml`); le schermate finiscono tra gli artefatti dell'esecuzione.

In locale:
- `npm install` (serve anche `web-push`), Playwright con Chromium;
- per `audit.js` una copia di `pitwallnew` (solo lettura) in `../pitwallnew` accanto al repository, oppure `PITWALLNEW_DIR=...`;
- `node tools/prove/tutte.js` (tutte) oppure `node tools/prove/tutte.js gps3 audit` (solo alcune).
Le schermate vanno nella cartella temporanea (`pitcomm-prove`) o in `PROVE_OUT`. Percorsi e tessera finta della mappa: `comune.js`.

- `gps3.js`: corsia box, tempo fermo, domanda cambio pilota, foto finale, notifica messaggio.
- `lancio1.js`: pista circolare simulata, giro di riferimento, fascia di lancio, cambio di ritmo.
- `mappa1.js`, `mappa2.js`: area di rifornimento, traguardo, sposta tutto, circuito da file.
- `audit.js`: vista auto e schermata finale identiche a pitwallnew, nessun overflow nelle schede del box.
- `srvtest2.js`: eventi del server (foto, corsia, area, traguardo, giro di riferimento).
- `srvpin.js`: PIN del box e comandi riservati al box (server, con finto socket).
- `pin.js`: campo PIN nella schermata iniziale.
- `orologio.js`: sincronizzazione dell'orologio con ritardi di rete asimmetrici.
- `riavvio.js`: riavvio del server con timer in corso (archivio, copia del box, via scaduto da spento) e validazione degli eventi; esce con codice 1 se un controllo fallisce. Serve `web-push` (anche finto) in NODE_PATH.
- `riavvio-client.js`: il telefono del box salva e rimanda la copia del timer (Playwright, finto socket).
- `xss.js`: nomi dei pulsanti e dei messaggi con codice HTML non devono eseguire nulla.
- `tocchi.js`: nel box ogni cosa da toccare e' almeno 52x52 px e niente esce dallo schermo o dal suo riquadro (telefono, orizzontale, tablet; giorno e notte).
- `apk.js`: controlli sui sorgenti Android (servizio di tipo location, permessi all'avvio, pagina ricreata se cade o si blocca). Non sostituisce la compilazione (`android.yml`) ne' i telefoni veri.
- `cambia.js`: "◄ cambia" sull'auto esce solo con il doppio tocco.
- `tutte.js`: le esegue tutte e fa il riepilogo.
- `doppio.js`: doppio box sul server (ruoli, comandi riservati, cedi priorita', scadenza, scollegamento, cambio pilota condiviso).
- `doppio-client.js`: barra PRIMARIO/SECONDARIO, doppio tocco, cedi priorita', GPS e cambio pilota sul telefono.
