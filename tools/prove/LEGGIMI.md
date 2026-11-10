# Prove usate finora (da adattare)

Script di collaudo scritti con Playwright (browser) e con finti socket (server). Sono un punto di partenza: i percorsi
assoluti (`/home/claude/...`, `/tmp/demo/...`) vanno adattati, e servono un'immagine `tile.png` finta per le tessere della mappa
e, per `srvtest2.js`, un finto modulo `web-push`.

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
