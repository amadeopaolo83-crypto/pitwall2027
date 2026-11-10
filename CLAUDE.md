# PitComm / Pitwall2027: istruzioni per Claude Code

Chi lavora con te: coordina gare endurance di 24 ore. **Risposte brevi, in italiano.** Il progetto e' la sua app per far parlare
box e auto (PWA + server Node + involucro Android). Questo repository (`Pitwall2027`) e' la copia di prova; quello che si usa in gara e'
`pitwallnew` (Render: pitwallnew.onrender.com). Qui: pitwall2027.onrender.com. Si lavora direttamente su `main`.

## Regole fisse (non negoziabili)
- Mai incollare chiavi o segreti in chat o nel codice: solo variabili d'ambiente su Render.
- **Solo aggiungere**, non togliere funzioni o schermate, salvo richiesta esplicita.
- Non pubblicare ne' riavviare nulla durante una gara. Se non e' chiaro se c'e' una gara in corso, chiedere.
- La **vista auto** deve restare identica, salvo richiesta esplicita (controllo con `tools/prove/audit.js`).
- Si possono usare **solo i tempi** del live timing: niente bandiere, settori, gomme, identita' del pilota.
- Verificare davvero: provare con simulazioni, non dichiarare "fatto" senza averlo eseguito.
- Dire onestamente i limiti: cosa e' provato solo in simulazione e cosa serve provare su telefoni veri.

## Struttura
- `src/server.js` avvio; `sockets.js` tutti gli eventi socket.io; `rooms.js` stato per stanza (codice squadra) e flag `fresh`;
  `archivio.js` salvataggio impostazioni (Upstash o cartella) e `pulisciGps`; `static.js` file statici e `/foto-finale/CODICE`;
  `passo.js`, `aub*.js`, `ponte.js`, `push.js`, `keepalive.js`: passo gara, live timing, ponte, notifiche, sveglia.
- `public/js/`: `core.js` (orologio sincronizzato `nowSync`, `load/save`), `connection.js` (join, ripristino dopo riavvio del server),
  `autoview.js` e `boxview.js` (le due viste), `timer.js`, `timing.js`, `passo.js`, `fuel.js`, `cruscotto.js`, `race.js`,
  `gps.js` (zone, corsia, tempo fermo), `lancio.js` (traguardo, giro di riferimento, fascia di lancio), `mappa.js` (Leaflet: zone, traguardo, sposta, circuito).
- `public/vendor/leaflet`: Leaflet incluso (npm e CDN non raggiungibili da alcuni ambienti).
- `android/`: involucro WebView, servizio in primo piano, notifiche con sirena. Build con GitHub Actions
  (`.github/workflows/android.yml`) → release `apk-latest`.
- `tools/prove/`: script di collaudo (vedi `LEGGIMI.md`).

## Cose da sapere
- Ogni telefono calcola il suo timer da `remaining/updatedAt`: il server non fa tick. Il tempo e' quello del server (`serverNow`).
- Dopo un riavvio di Render senza archivio lo stato si perde: il box ripropone le sue copie locali (flag `fresh` in `connection.js`).
- GPS: l'auto manda `gpsPos` (max 1/s) solo se `gps.on`; il box decide pista/box/rifornimento con permanenza di 10 s e isteresi di 5 m.
  Fascia di lancio: calcolata sull'auto, vedi il commento in testa a `lancio.js`.
- Tessere mappa: Esri World Imagery e OpenStreetMap, senza chiavi; serve internet. Le zone sono nel sistema WGS84 del satellite:
  possono essere sfalsate di qualche metro (da qui "Sposta").
- Test del server in locale: `npm install` puo' non funzionare dietro proxy; si usano finti socket (`tools/prove/srvtest2.js`).
- Messaggi di commit in italiano, brevi; finire con le righe di attribuzione richieste dall'ambiente.

## Da fare / aperto
- Vedi `docs/REVISIONE.md` (difetti, architettura, evoluzione). `BOX_PIN` e' facoltativo: senza, il server si comporta come prima.
- Prove su telefoni veri (GPS, notifiche, sirena, permessi, risparmio batteria).
- Scraper del live timing di Claudio (materiale in arrivo).
- Stima dei pit degli altri (giro lento rispetto al proprio ritmo, escludendo safety) e suggerimento del momento migliore per il nostro pit.
- Circuiti salvati per pista (file `.json` dal modo Circuito della mappa).
