# Revisione di PitComm / Pitwall2027 (10 novembre 2026)

Metodo: lettura di `src/` e `public/js/`, prove con simulazioni (browser Playwright + finti socket). Niente e' stato provato su telefoni veri.
"Verificato" = visto nel codice o riprodotto con una prova. "Da provare" = ipotesi.

## 1. Difetti trovati

| # | Gravita' | Cosa | Stato |
|---|---|---|---|
| 1 | Alta | **Nessuna autenticazione.** Il ruolo ("box"/"auto") lo dichiara il telefono e il codice squadra e' l'unica chiave (es. FLATSIX, facile da indovinare). Su 42 eventi socket solo 8 controllano il ruolo: chiunque conosca il codice puo' fermare o resettare il timer di gara (`timerDebugJump` con `reset` vale in tutte le stanze), cambiare impostazioni, cancellare la cronologia. Verificato. | **Corretto, facoltativo**: variabile `BOX_PIN` su Render. Senza, tutto come prima. |
| 2 | Media | **Orologio senza compensazione del ritardo.** Lo scarto dal server si calcolava una volta sola dal `serverNow` del join (anche 1 s di errore con rete debole, e il join aspetta il caricamento dell'archivio). Tutti i timer, e la fascia di lancio, ne dipendono. Verificato. | **Corretto**: misura andata-e-ritorno, tiene la risposta piu' veloce, si ripete ogni minuto. Prova: errore 0 con ritardi asimmetrici (prima ~500 ms). |
| 3 | Media | CORS `origin: "*"` (il commento nel codice dice di restringerlo). Verificato. | Aperto. Con il PIN conta meno. |
| 4 | Media | Le stanze non si eliminano mai dalla memoria; lo stato "dal vivo" (giri, classifica, messaggi) si perde a ogni riavvio di Render. Verificato nel codice. | Aperto. Vedi architettura. |
| 5 | Bassa | Il ruolo accetta qualunque stringa. Verificato. | Aperto: non l'ho ristretto perche' PitPonte e PitIspettore potrebbero entrare con altri ruoli (da controllare). |
| 6 | Bassa | Fascia di lancio: il giro di riferimento accettava punti con precisione fino a 30 m. | **Corretto**: solo punti sotto 15 m. |
| 7 | Bassa | Fascia di lancio su telefono in orizzontale: toccava il bordo basso e tagliava l'etichetta in alto. | **Corretto**: tempo a sinistra, fascia a destra. |
| 8 | Info | APK: nessuna gestione dei download (il salvataggio di file non parte). Verificato. | Scelto: nell'APK si sceglie solo il file circuito. |

## 2. Cosa ho cambiato in questo giro (solo Pitwall2027)
- `BOX_PIN` (facoltativo): chi entra come box deve dare il PIN (campo nella schermata iniziale, ricordato sul telefono). Gli eventi di comando (con o senza PIN) (timer, via/stop, messaggi a comparsa, giorno/notte, cronologia, ecc.) li accetta solo chi e' entrato come box. Restano aperti per l'auto: messaggi rapidi, via e arrivo automatici, ripristino dopo riavvio, GPS.
- Orologio: evento `ora` e sincronizzazione ogni minuto.
- Fascia di lancio: filtro di precisione e layout orizzontale.
- Prove nuove: `tools/prove/srvpin.js`, `pin.js`, `orologio.js`.

Per attivare il PIN: su Render → Environment → `BOX_PIN` (numeri, 4-8 cifre) e riavvio **non durante una gara**. Il box lo digita una volta. Se PitPonte o PitIspettore entrano come "box", vanno provati prima di attivarlo.

### Tappa 1 della revisione di Claude Code (stabilita' del server)
- **Timer dopo un riavvio di Render**: ora si salvano fase, tempo rimasto e se scorre (archivio, se configurato) e il telefono del box ne tiene una copia (`pc_timer`) che rimanda al server ripartito (`timerRestore`, una volta sola, solo dal box, solo se la copia ha qualcosa in corso e ha meno di 36 ore). Se il conto alla rovescia e' scaduto mentre il server era spento, la gara risulta partita nell'istante vero dello zero.
- **Via anticipato**: `raceTimerAutoStart` si accetta solo se il conto alla rovescia e' davvero a zero (tolleranza 3 s).
- **Comandi solo dal box**, sempre (non piu' solo con il PIN): timer, via/stop, carburante, pulsanti, messaggi a comparsa, giorno/notte. L'auto manda solo messaggi rapidi, via/arrivo automatici, ripristino gara e GPS.
- **Controllo dei dati** di ogni evento (carburante, pulsanti, colori, durate, percentuali); un dato strano si scarta. Ogni gestore e' protetto: un errore va nel registro e il server continua (anche `uncaughtException`).
- **Ripristino carburante dopo riavvio**: vale la copia piu' recente (ora di salvataggio) tra i box; i numeri fuori scala si riportano nei limiti invece di scartare tutto (scartare = serbatoio pieno). Pulsanti: vale la prima copia.
- **Vista auto (su richiesta)**: "◄ cambia" esce solo con doppio tocco entro 2 s (dopo il primo tocco la scritta diventa "ancora ◄").
- **Niente bandiere** (su richiesta): tolto il Finish dalla bandiera a scacchi di Aub, la bandiera dallo stato di Aub/ponte e la scritta "bandiera" sul box. Il Finish parte a zero del timer di gara.
- **BOX_PIN**: non attivato (uso personale, nessun rischio).
- **Testo dei pulsanti e dei messaggi** scritto con escape: niente codice dentro il box.
- **socket.io servito dal nostro server** (`/socket.io/socket.io.js`), con la CDN solo come riserva.
- Prove nuove: `riavvio.js` (24 controlli), `riavvio-client.js`, `xss.js`. Restano da fare i punti 8-15 della revisione e la tappa 2 (prove su GitHub).

## 3. Architettura: tre strade
- **A (consigliata, poco lavoro):** restare cosi', attivare `BOX_PIN`, configurare l'archivio (Upstash) anche su Pitwall2027, passare Render a un piano che non si addormenta. Costo: pochi euro al mese e mezz'ora.
- **B (media):** salvare ogni 30-60 s uno "snapshot" della gara (timer, carburante, giri, passo, ultimo stato in pista/box) nell'archivio, cosi' un riavvio di Render e' invisibile. Costo: uno o due giorni di lavoro e prove. Vale la pena prima della prossima 24 ore.
- **C (grossa, non consigliata ora):** riscrivere il server come servizio con database e login per utente. Per una squadra sola e' eccessivo.
- In piu', per tutte: far girare i test di `tools/prove/` in GitHub Actions a ogni modifica, cosi' non si rompe in silenzio la vista auto.

## 4. Layout e usabilita' (da fare con tuo ok, la vista auto non si tocca senza dirlo)
- Verificati senza difetti: schede del box a 360, 412, tablet e orizzontale (nessun overflow); vista auto identica a pitwallnew.
- Da provare con guanti e al sole: dimensione dei tocchi dei pulsanti piccoli della mappa; contrasto delle tre zone (box arancione, rifornimento verde, corsia azzurra) sul satellite; leggibilita' della fascia di lancio al sole.
- Idea: vista "solo tempo" in auto, con un unico numero grande (distacco davanti) come terza scelta del pilota.

## 5. Evoluzione, in ordine di valore
1. **Giornata di prove su telefoni veri** (GPS, permessi, risparmio batteria, notifiche, sirena, fascia di lancio). E' il rischio piu' grosso e nessuna simulazione lo sostituisce.
2. **Pit degli altri dal tempo sul giro** (giro lento rispetto al ritmo *di quella auto*, non del gruppo, per escludere safety e FCY) e **momento migliore per il nostro pit** (carburante, stint massimo, posizione al rientro). Serve la fonte dei dati: scraper di Claudio.
3. **Circuiti per pista**: un file per pista con traguardo e giro di riferimento; Cremona come primo.
4. **Fascia di lancio**: calibrare sullo scarto reale tra linea disegnata e trasponder dopo le prime prove.
5. Messaggi preimpostati per fase di gara e riepilogo a fine stint.

## 6. Perplessita' dichiarate
- Tutto provato solo in simulazione; GPS vero, rete vera e batterie no.
- Il PIN protegge dal "chiunque conosca il codice", non da un attacco serio: per questo e' pensato come cintura, non come blindatura.
- Una correzione di sicurezza va portata anche in `pitwallnew`, ma **solo dopo la gara**.
- Le immagini del satellite hanno uno scarto di qualche metro: la linea del traguardo va confermata in pista.
