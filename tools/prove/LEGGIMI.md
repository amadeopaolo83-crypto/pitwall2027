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
- `doppio-vero.js`: doppio box con il server vero (`node src/server.js`, `DOPPIO_BOX=1`) e `socket.io-client`, 2 box + 1 auto:
  comandi `SOLO_PRIMARIO` negati al secondario (elenco letto da `sockets.js`), cedi / riprendi / prendi, ricollegamento,
  primario perso per 20 s, eventi scartati senza tracce (`fresh.timer`, archivio). Serve
  `npm install --no-save socket.io-client@4`; dura circa 30 s.
- `sim1.js`: pista simulata (`public/js/pista.js`): giro, limite in corsia, soste dove devono essere, rumore GPS, sfasamento satellite.
- `sim2.js`: il box riconosce dalla velocita' i passaggi in corsia (passaggio / rifornimento / sosta / cambio?) con GPS simulato; un'auto veloce sulla corsia non conta.
- `sim3.js`: pagina `sim.html` (auto simulata): entra come auto, manda `gpsPos` ogni secondo, rispetta lo scenario, si ferma.

- `sim4.js`: come `sim2` sul circuito di Varano com'e' disegnato (box e rifornimento staccati dalla corsia).
- `sim5.js`: finto ponte (`src/simponte.js`, solo con `SIM_PONTE=1`): classifica, safety car, pause, HTTP, collegamento con `ponte.js`.
- `sim8.js`: strategia degli altri (`src/strategia.js`): soste, tipo, giri lenti per tutti, gara ferma, prossima sosta, suggerimento del pit, confrontati con la verita' del finto ponte.
- `sim9.js`: scheda "Strategia degli altri" nel box (dati veri del replay, banner, tabella, nessun HTML iniettato).
- `sim10.js`: giro di riferimento del lancio su Varano (corsia innestata sulla pista, rumore GPS): si forma al secondo passaggio; un giro con sosta in corsia no.

## Simulatore sul PC (senza telefono)
1. Apri `/sim.html` del sito (o `tools/sim/circuito-esempio.json` come circuito) in una scheda; in un'altra il box con lo stesso codice squadra.
2. Nel box: Mappa → Circuito → carica lo stesso file, GPS acceso.
3. Nel simulatore: scenario (`attesa secondi` = lancio con l'auto ferma, poi un turno per riga: `giri [rifornimento|box secondi]`), giro in secondi (tarato sul circuito), Avvia. Va a tempo reale (x1); ⏭ Salta porta 60 s prima del prossimo pit.
Provato solo con finti socket: il giro completo con il server vero va ancora fatto.

### Timing finto (SIM_PONTE=1)
Su Render (Pitwall2027, solo la copia di prova) aggiungi la variabile `SIM_PONTE=1`. Nel simulatore lascia "timing finto" acceso: al via manda
la corsa al server. Nel box: Distacchi → Nostro → indirizzo `https://pitcomm.sim/CODICE-SQUADRA` e numero 77 (o quello messo nel simulatore).
Scenario: `sc dal-giro quanti-giri [velocita'%]` = giri lenti per tutti (tutti rallentano, anche la nostra auto), `pausa dopo-giri secondi` = gara ferma (tutti fermi sul traguardo).
Gli altri sono piloti virtuali: stesso formato del ponte vero, solo tempi.
