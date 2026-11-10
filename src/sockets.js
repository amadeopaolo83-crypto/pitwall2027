// Gli eventi socket.io: tutto quello che box e auto si dicono.
//
// Ogni "team" e' una stanza identificata dal codice inserito nell'app: chi
// conosce il codice entra, e ogni messaggio raggiunge solo quella stanza.

const { getRoomState, fotoFinale, posizioneFinale, eProva } = require("./rooms");
const archivio = require("./archivio");
const doppio = require("./doppiobox");
const { notifyBoxDevices, togliDispositivo } = require("./push");
const aub = require("./aub");
const aubtimer = require("./aubtimer");
const ponte = require("./ponte");
const passo = require("./passo");
const crypto = require("crypto");

// Gli eventi di comando (timer, gara, messaggi, impostazioni) li accetta solo chi e' entrato come "box";
// l'auto manda solo i suoi (messaggi rapidi, via/arrivo automatici, ripristino dopo riavvio, GPS).
// PIN del box (facoltativo): se sul server c'e' la variabile BOX_PIN, chi entra come "box" deve darlo.
// Senza BOX_PIN il ruolo resta quello dichiarato dal telefono.
const SOLO_BOX = new Set([
  "timerStartSet", "timerStartControl", "timerControl", "timerRaceSet", "timerRaceControl", "timerSource",
  "timerTestSpeed", "timerDebugJump", "finishConfigUpdate", "raceStart", "raceStop", "historyClear",
  "flashMessage", "dayModeUpdate", "passoAzzera", "aubDisconnect", "ponteDisconnect", "timerRestore",
  "fuelSystemUpdate", "fuelUpdate", "autonomyUpdate", "quickButtonsUpdate", "flashPresetsUpdate",
  "boxCedi", "boxRiprendi", "boxPrendi", "cambioDomanda", "cambioRisposta", "cambioAzzera",
]);

// Doppio box (vedi doppiobox.js): con due o piu' box collegati questi comandi li accetta solo il primario.
// Restano aperti al secondario: messaggi all'auto (flashMessage), carburante e rifornimento, risposta al cambio
// pilota, ripristino dopo un riavvio (le voci con `ripristino` e timerRestore).
const SOLO_PRIMARIO = new Set([
  "timerStartSet", "timerStartControl", "timerControl", "timerRaceSet", "timerRaceControl", "timerSource", "timerTestSpeed",
  "timerDebugJump", "finishConfigUpdate", "finishPhotoUpdate", "finishTrigger", "raceStart", "raceStop", "historyClear",
  "dayModeUpdate", "flashPresetsUpdate", "quickButtonsUpdate", "timingViewUpdate", "autoLayoutUpdate", "sogliaGapUpdate",
  "gpsConfigUpdate", "passoAzzera", "aubConnect", "aubDisconnect", "ponteConnect", "ponteDisconnect", "cambioDomanda", "cambioAzzera",
]);
const pinAttivo = () => String(process.env.BOX_PIN || "");
function pinGiusto(dato) {
  const vero = Buffer.from(pinAttivo()), prova = Buffer.from(String(dato == null ? "" : dato));
  return vero.length === prova.length && crypto.timingSafeEqual(vero, prova);
}
const keepalive = require("./keepalive");

// Tempo rimanente "vero" in questo istante, dato l'ultimo valore salvato
// (baseRemaining), il momento in cui e' stato salvato (updatedAt), se il
// timer sta scorrendo e a che velocita' (1 = normale, usato per i test).
function currentRemaining(baseRemaining, updatedAt, running, speed) {
  if (!running) return baseRemaining;
  const elapsedSeconds = ((Date.now() - updatedAt) / 1000) * (speed || 1);
  return Math.max(0, baseRemaining - elapsedSeconds);
}

// Controlli sulla forma dei dati che arrivano dai telefoni: un valore sbagliato si scarta, non rompe il server.
const eNum = (x, min = -Infinity, max = Infinity) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const testo = (x, max) => String(x == null ? "" : x).slice(0, max);
const COLORE = /^#[0-9a-fA-F]{6}$/;
const LITRI_MAX = 1000;

// Carburante: la forma deve essere giusta, ma i numeri fuori scala si riportano nei limiti invece di scartare
// tutto (scartare vorrebbe dire tornare al serbatoio pieno).
function fuelSystemValido(f) {
  if (!f || typeof f !== "object") return null;
  const lim = (x, min, max, def) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def);
  if (typeof f.tankCapacityLiters !== "number" || !Number.isFinite(f.tankCapacityLiters) || f.tankCapacityLiters < 1) return null;
  const cap = Math.min(f.tankCapacityLiters, LITRI_MAX);
  if (typeof f.currentLiters !== "number" || !Number.isFinite(f.currentLiters)) return null;
  const cons = lim(f.consumptionRatePerHour, 0, 1000, null);
  return {
    tankCapacityLiters: cap, currentLiters: lim(f.currentLiters, 0, LITRI_MAX, cap),
    consumptionRatePerHour: cons ? cons : null,
    onTrack: !!f.onTrack, sessionStartAt: lim(f.sessionStartAt, 0, 1e14, null),
    sessionStartLiters: lim(f.sessionStartLiters, 0, LITRI_MAX, 0),
  };
}

function bottoniValidi(b) {
  if (!Array.isArray(b) || b.length < 1 || b.length > 8) return null;
  const out = [];
  for (const x of b) {
    if (!x || typeof x !== "object" || !eNum(x.id, 0, 1e6)) return null;
    out.push({ id: x.id, label: testo(x.label, 60), color: COLORE.test(x.color) ? x.color : "#3fa9f5" });
  }
  return out;
}

// Un errore dentro un evento non deve fermare il server: si scrive nel registro e si va avanti.
function protetto(nome, fn) {
  return (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === "function") r.catch((e) => console.error(`[socket ${nome}]`, e && e.message));
    } catch (e) {
      console.error(`[socket ${nome}]`, e && e.message);
    }
  };
}

function registra(io) {
  // Allo scadere del tempo massimo la gara si chiude da sola e lo dice a tutti.
  const fineAutomatica = (code) => {
    const state = getRoomState(code);
    state.race = { active: false, startedAt: null, endedBy: "timeout" };
    io.to(code).emit("raceStatus", state.race);
  };

  io.on("connection", (socket) => {
    let joinedCode = null;
    let joinedRole = null; // "box" | "auto"
    let joinedBoxId = null; // identita' di questo telefono come box (doppio box)

    // Ogni gestore e' protetto: dati mancanti o strani non fanno cadere il processo.
    const _on = socket.on.bind(socket);
    socket.on = (nome, fn) => { _on(nome, protetto(nome, fn)); return socket; };

    // Le impostazioni che vanno salvate fuori dal server quando cambiano (archivio.js).
    const TIMER_EVENTI = new Set(["timerStartSet", "timerStartControl", "timerControl", "timerRaceSet", "timerRaceControl", "raceTimerAutoStart", "finishTrigger", "timerDebugJump", "timerSource"]);
    const SALVA = new Set([
      "fuelSystemUpdate", "autonomyUpdate", "dayModeUpdate", "quickButtonsUpdate", "flashPresetsUpdate",
      "timingViewUpdate", "autoLayoutUpdate", "sogliaGapUpdate", "timerStartSet", "timerRaceSet", "finishConfigUpdate",
      "aubConnect", "ponteConnect", "gpsConfigUpdate", "gpsGiroRif",
      "timerStartControl", "timerControl", "timerRaceControl", "raceTimerAutoStart", "finishTrigger", "timerDebugJump", "timerRestore",
    ]);
    const registraEvento = (evento) => {
      if (!joinedCode) return;
      if (TIMER_EVENTI.has(evento)) getRoomState(joinedCode).fresh.timer = false;   // il timer e' stato toccato: la copia dei telefoni non serve piu'
      if (SALVA.has(evento)) archivio.segna(joinedCode);
    };
    // In socket.io gli ascoltatori onAny girano PRIMA dei filtri socket.use: per questo la registrazione sta
    // dentro il filtro qui sotto, dopo i controlli, e un evento scartato (auto, secondario) non lascia tracce.
    // onAny resta solo per chi non ha socket.use (finti socket di alcune prove).
    if (typeof socket.use !== "function") socket.onAny(registraEvento);

    // Gli eventi di comando passano solo se chi li manda e' entrato come box.
    if (typeof socket.use === "function") {
      socket.use(([evento, ...resto], next) => {
        if (SOLO_BOX.has(evento) && joinedRole !== "box") return; // scartato in silenzio
        // Doppio box: un secondario non fa i comandi riservati (salvo i ripristini dopo un riavvio).
        if (joinedRole === "box" && SOLO_PRIMARIO.has(evento) && !doppio.puoComandare(joinedCode, joinedBoxId)) {
          const dati = resto[0];
          const ripristino = dati && typeof dati === "object" && dati.ripristino === true;
          if (!(ripristino && (evento === "quickButtonsUpdate" || evento === "aubConnect" || evento === "ponteConnect"))) {
            socket.emit("boxNegato", { evento });
            const ack = resto[resto.length - 1];
            if (typeof ack === "function") { try { ack({ ok: false, error: "secondario" }); } catch (e) { /* niente */ } }
            return;
          }
        }
        registraEvento(evento);
        next();
      });
    }

    // Orologio: il telefono misura il tempo di andata e ritorno e ne ricava lo scarto dal server.
    socket.on("ora", (ack) => { if (typeof ack === "function") ack(Date.now()); });

    socket.on("join", async ({ code, role, pin, boxId } = {}, ack) => {
      if (!code || !role) return ack && ack({ ok: false, error: "codice o ruolo mancante" });
      if (role === "box" && pinAttivo() && !pinGiusto(pin)) return ack && ack({ ok: false, error: "pin" });
      const codice = String(code).trim().toUpperCase();
      // Prima le impostazioni salvate (se la stanza non e' gia' in memoria), poi lo stato.
      try { await archivio.prepara(codice); } catch (e) { /* si parte con i valori di partenza */ }
      if (joinedCode && joinedRole === "box") doppio.esci(joinedCode, socket);   // entra di nuovo con un altro codice o ruolo
      joinedCode = codice;
      joinedRole = role;
      socket.join(joinedCode);
      socket.data.role = role;
      joinedBoxId = role === "box" ? (typeof boxId === "string" && boxId && boxId.length <= 64 ? boxId : socket.id) : null;
      if (role === "box") doppio.entra(joinedCode, socket, joinedBoxId);

      const state = getRoomState(joinedCode);
      // serverNow: l'orologio del telefono puo' essere sbagliato o su un'altra
      // ora; i timer si calcolano sul tempo del server, non su quello del
      // dispositivo, cosi' restano giusti e uguali su tutti i telefoni.
      ack && ack({ ok: true, state, serverNow: Date.now(), boxRuolo: role === "box" ? doppio.stato(joinedCode, joinedBoxId) : null });
    });

    // BOX -> server: registra la sottoscrizione push di questo dispositivo
    socket.on("registerPush", ({ subscription }) => {
      if (!joinedCode || !subscription || joinedRole !== "box") return;
      const state = getRoomState(joinedCode);
      const exists = state.pushSubscriptions.some((s) => s.endpoint === subscription.endpoint);
      if (!exists) state.pushSubscriptions.push(subscription);
    });

    // Questo telefono non e' piu' un box: niente piu' notifiche dei messaggi.
    socket.on("unregisterPush", ({ endpoint } = {}) => {
      if (typeof endpoint === "string") togliDispositivo(endpoint);
    });

    // AUTO -> BOX: pressione di uno dei 4 pulsanti rapidi
    socket.on("quickMessage", ({ buttonId, label } = {}) => {
      if (!joinedCode || !eNum(buttonId, 0, 1e6)) return;
      const state = getRoomState(joinedCode);
      // Ogni messaggio ha un identificativo unico, cosi' chi lo riceve due volte
      // (dal vivo e poi dalla cronologia) lo mostra una volta sola.
      const msg = {
        id: Date.now().toString(36) + "-" + (++state.msgSeq),
        buttonId,
        label: String(label == null ? "" : label).slice(0, 200),
        at: Date.now(),
      };
      state.messages.push(msg);
      if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);
      io.to(joinedCode).emit("quickMessageReceived", msg);
      notifyBoxDevices(joinedCode, msg.label);
    });

    // BOX: chiede i messaggi ricevuti (per esempio quando la pagina torna visibile).
    socket.on("historyRequest", (ack) => {
      if (!joinedCode || typeof ack !== "function") return;
      ack({ messages: getRoomState(joinedCode).messages });
    });

    // BOX: cancella la cronologia per tutti i telefoni della squadra.
    socket.on("historyClear", () => {
      if (!joinedCode) return;
      getRoomState(joinedCode).messages = [];
      io.to(joinedCode).emit("historyCleared");
    });

    // BOX -> AUTO: messaggio a comparsa (testo, colore, durata) + lettura vocale
    socket.on("flashMessage", ({ text, color, durationSeconds } = {}) => {
      if (!joinedCode || typeof text !== "string") return;
      const state = getRoomState(joinedCode);
      state.lastFlash = {
        text: text.slice(0, 200),
        color: COLORE.test(color) ? color : "#2FB6C4",
        durationSeconds: eNum(durationSeconds, 1, 120) ? durationSeconds : 6,
        at: Date.now(),
      };
      io.to(joinedCode).emit("flashMessage", state.lastFlash);
    });

    // BOX -> tutti i box: sincronizza capienza, litri, consumo, stato in pista/ai box
    socket.on("fuelSystemUpdate", (dati) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      const fuelSystem = fuelSystemValido(dati);
      if (!fuelSystem) return;
      // Dopo un riavvio ogni box rimanda la sua copia: vale la piu' recente (l'ora in cui e' stata salvata).
      // Un aggiornamento vero (non di ripristino) chiude la questione.
      if (dati.ripristino) {
        const quando = eNum(dati.copiaAt, 0, 1e14) ? dati.copiaAt : 0;
        const ammesso = state.fresh.fuel || (state.fuelRipristinoAt != null && quando > state.fuelRipristinoAt);
        if (!ammesso) return;
        state.fuelRipristinoAt = quando;
      } else {
        state.fuelRipristinoAt = null;
      }
      state.fuelSystem = fuelSystem;
      state.fresh.fuel = false;
      io.to(joinedCode).emit("fuelSystemUpdate", state.fuelSystem);
    });

    // BOX -> AUTO: aggiornamento consumo carburante (percentuale 0-100)
    socket.on("fuelUpdate", ({ percent } = {}) => {
      if (!joinedCode || !eNum(percent, 0, 100)) return;
      const state = getRoomState(joinedCode);
      state.fuel = { percent, updatedAt: Date.now() };
      io.to(joinedCode).emit("fuelUpdate", state.fuel);
    });

    // BOX -> AUTO: tempo di autonomia stimato (per previsione sosta)
    socket.on("autonomyUpdate", ({ minutes } = {}) => {
      if (!joinedCode || !eNum(minutes, 0, 100000)) return;
      const state = getRoomState(joinedCode);
      state.autonomyMinutes = minutes;
      io.to(joinedCode).emit("autonomyUpdate", { minutes });
    });

    // BOX -> AUTO: modalità giorno/notte
    socket.on("dayModeUpdate", ({ dayMode } = {}) => {
      if (!joinedCode || typeof dayMode !== "boolean") return;
      const state = getRoomState(joinedCode);
      state.dayMode = dayMode;
      io.to(joinedCode).emit("dayModeUpdate", { dayMode });
    });

    // BOX -> tutti i box: i messaggi a comparsa preparati (testo, colore, durata)
    socket.on("flashPresetsUpdate", ({ presets } = {}) => {
      if (!joinedCode || !Array.isArray(presets) || presets.length > 40) return;
      const pulite = presets.map((p) => ({
        text: String((p && p.text) || "").slice(0, 200),
        color: /^#[0-9a-fA-F]{6}$/.test(p && p.color) ? p.color : "#2FB6C4",
        duration: Math.max(2, Math.min(60, Number(p && p.duration) || 6)),
      }));
      getRoomState(joinedCode).flashPresets = pulite;
      socket.to(joinedCode).emit("flashPresetsUpdate", { presets: pulite });
    });

    // BOX -> AUTO: configurazione dei 4 pulsanti rapidi (testo + colore)
    socket.on("quickButtonsUpdate", ({ buttons: grezzi, ripristino } = {}) => {
      if (!joinedCode) return;
      const buttons = bottoniValidi(grezzi);
      if (!buttons) return;
      const state = getRoomState(joinedCode);
      if (ripristino && !state.fresh.buttons) return;
      state.quickButtons = buttons;
      state.fresh.buttons = false;
      io.to(joinedCode).emit("quickButtonsUpdate", { buttons });
    });

    // BOX: avvio gara. Da qui il server si tiene sveglio (keep-alive) finche'
    // non arriva "fine gara" o scade il tempo massimo.
    socket.on("raceStart", () => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.fresh.race = false;
      if (state.race.active) return;
      state.race = { active: true, startedAt: Date.now() };
      keepalive.start(joinedCode, state.race.startedAt, fineAutomatica);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // BOX: fine gara. Il server puo' tornare a spegnersi da solo se inattivo.
    socket.on("raceStop", () => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.fresh.race = false;
      state.race = { active: false, startedAt: null };
      keepalive.stop(joinedCode);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // Dopo un riavvio del server un telefono che si ricordava una gara in corso
    // la rimette in piedi, con l'ora di partenza originale (e quindi lo stesso
    // limite massimo). Vale una volta sola, solo se il server e' ripartito da zero.
    socket.on("raceRestore", ({ startedAt } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      if (!state.fresh.race) return;
      state.fresh.race = false;
      const inizio = Number(startedAt);
      if (!inizio || Date.now() - inizio > keepalive.DURATA_MAX_MS) return;
      state.race = { active: true, startedAt: inizio };
      keepalive.start(joinedCode, inizio, fineAutomatica);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // BOX -> AUTO: cosa mostrare sull'auto, classifica assoluta o di categoria
    socket.on("timingViewUpdate", ({ view } = {}) => {
      if (!joinedCode || (view !== "assoluta" && view !== "categoria")) return;
      getRoomState(joinedCode).timingView = view;
      io.to(joinedCode).emit("timingViewUpdate", { view });
    });

    // BOX -> AUTO: aspetto della schermata auto, "telefono" (predefinito) o "tablet"
    socket.on("autoLayoutUpdate", ({ layout } = {}) => {
      if (!joinedCode || (layout !== "telefono" && layout !== "tablet")) return;
      const state = getRoomState(joinedCode);
      state.autoLayout = layout;
      state.fresh.layout = false;
      io.to(joinedCode).emit("autoLayoutUpdate", { layout });
    });

    // BOX -> AUTO: di quanto deve cambiare un distacco prima che cambi colore
    socket.on("sogliaGapUpdate", ({ valore } = {}) => {
      const v = Number(valore);
      if (!joinedCode || ![0.1, 0.25, 0.5, 1].includes(v)) return;
      const state = getRoomState(joinedCode);
      state.sogliaGap = v;
      state.fresh.soglia = false;
      io.to(joinedCode).emit("sogliaGapUpdate", { valore: v });
    });

    // GPS: il box imposta l'interruttore, le zone e i raggi (si possono mandare anche solo alcuni
    // campi); lo stato nuovo arriva a tutti. Il telefono dell'auto manda la posizione solo se acceso.
    socket.on("gpsConfigUpdate", (dati) => {
      if (!joinedCode || joinedRole !== "box" || !dati || typeof dati !== "object") return;
      const state = getRoomState(joinedCode);
      state.gps = archivio.pulisciGps(state.gps, dati);
      state.fresh.gps = false;
      io.to(joinedCode).emit("gpsConfigUpdate", state.gps);
    });

    // AUTO -> tutti: giro di riferimento registrato dall'auto passando sul traguardo virtuale
    // (solo con il GPS acceso, al massimo uno ogni 20 secondi).
    let ultimoGiroRif = 0;
    socket.on("gpsGiroRif", (dati) => {
      if (!joinedCode || joinedRole !== "auto" || !dati || typeof dati !== "object") return;
      const state = getRoomState(joinedCode);
      if (!state.gps.on || !state.gps.traguardo) return;
      const ora = Date.now();
      if (ora - ultimoGiroRif < 20000) return;
      const prima = state.gps.giroRif;
      state.gps = archivio.pulisciGps(state.gps, { giroRif: dati });
      if (state.gps.giroRif === prima) return; // forma non valida: scartato
      ultimoGiroRif = ora;
      state.fresh.gps = false;
      io.to(joinedCode).emit("gpsConfigUpdate", state.gps);
    });

    // AUTO -> BOX: posizione dell'auto (al massimo una al secondo; solo con il GPS acceso).
    let ultimaPosizione = 0;
    socket.on("gpsPos", (p) => {
      if (!joinedCode || joinedRole !== "auto" || !p || typeof p !== "object") return;
      const state = getRoomState(joinedCode);
      if (!state.gps.on) return;
      const lat = Number(p.lat), lng = Number(p.lng), acc = Number(p.acc), v = Number(p.v);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const ora = Date.now();
      if (ora - ultimaPosizione < 800) return;
      ultimaPosizione = ora;
      io.to(joinedCode).emit("gpsPos", { lat, lng, acc: Number.isFinite(acc) ? acc : null, v: Number.isFinite(v) && v >= 0 && v < 200 ? v : null, t: ora });
    });

    // Passo gara: riepilogo e storico dei giri della nostra vettura (chi si collega o si
    // ricollega li chiede), copia ripristinata dal box e azzeramento.
    socket.on("passoRequest", (ack) => {
      if (!joinedCode || typeof ack !== "function") return;
      ack({ ok: true, riepilogo: passo.riepilogo(joinedCode), storico: passo.storico(joinedCode) });
    });
    socket.on("passoRestore", (dati, ack) => {
      if (!joinedCode) return;
      const r = passo.ripristina(joinedCode, dati);
      if (typeof ack === "function") ack(r);
    });
    socket.on("passoAzzera", () => {
      if (!joinedCode) return;
      passo.azzera(joinedCode);
    });

    // BOX -> AUTO: distacchi dal live timing (posizione, distacco davanti, distacco dietro)
    socket.on("timingUpdate", ({ position, gapAhead, gapBehind, nameAhead, nameBehind }) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.timing = { position, gapAhead, gapBehind, nameAhead, nameBehind, updatedAt: Date.now() };
      io.to(joinedCode).emit("timingUpdate", state.timing);
    });

    // BOX -> server: aggancia la classifica AUB al numero di gara della vettura.
    // url/user/pass sono facoltativi: se non arrivano si usano le variabili
    // d'ambiente del server, che e' il posto giusto dove tenerli.
    // Una sola sorgente di distacchi e passo per stanza: AUB diretto oppure il ponte.
    // Due letture insieme con numeri diversi si sovrascriverebbero a vicenda (i distacchi
    // e il passo salterebbero da una vettura all'altra e lo storico ripartirebbe da zero).
    // Chi preme "Collega" sostituisce la lettura in corso; chi la sta solo ripristinando
    // dopo un riavvio (`ripristino`) non ne scavalca una gia' attiva.
    const fermaPonte = () => {
      ponte.stop(joinedCode);
      ponte.setStatus(joinedCode, { connected: false, status: "spento", error: null, session: null, flag: null });
    };
    socket.on("aubConnect", ({ driverId, url, user, pass, ripristino }, ack) => {
      if (!joinedCode) return ack && ack({ ok: false, error: "non sei in una stanza" });
      if (joinedRole !== "box") return ack && ack({ ok: false, error: "solo il box avvia la lettura" });
      const numero = String(driverId || "").trim();
      if (!numero) return ack && ack({ ok: false, error: "numero di gara mancante" });
      if (ripristino && (aub.attivo(joinedCode) || ponte.attivo(joinedCode))) return ack && ack({ ok: true, ignorato: true });
      if (ponte.attivo(joinedCode)) fermaPonte();
      const credenziali = (url || user || pass)
        ? { url: (url || "").trim(), user: (user || "").trim(), pass: pass || "" }
        : null;
      aub.start(joinedCode, numero, credenziali);
      const stanza = getRoomState(joinedCode);
      stanza.fresh.aub = false;
      // Si ricordano gli indirizzi (mai la password) per ritrovarli nei campi.
      stanza.collegamenti.aub = { driverId: numero, url: credenziali ? credenziali.url : "", user: credenziali ? credenziali.user : "" };
      ack && ack({ ok: true });
    });

    socket.on("aubDisconnect", () => {
      if (!joinedCode) return;
      getRoomState(joinedCode).fresh.aub = false;
      aub.stop(joinedCode);
      aub.setStatus(joinedCode, {
        connected: false,
        driverId: null,
        status: "spento",
        error: null,
      });
    });

    // BOX -> server: legge i distacchi dal nostro ponte, che traduce i vari siti di
    // live timing. Servono l'indirizzo della pagina dell'evento e il numero della vettura.
    socket.on("ponteConnect", ({ url, number, ripristino } = {}, ack) => {
      if (!joinedCode) return ack && ack({ ok: false, error: "non sei in una stanza" });
      if (joinedRole !== "box") return ack && ack({ ok: false, error: "solo il box avvia la lettura" });
      if (ripristino && (aub.attivo(joinedCode) || ponte.attivo(joinedCode))) return ack && ack({ ok: true, ignorato: true });
      if (aub.attivo(joinedCode)) {
        aub.stop(joinedCode);
        aub.setStatus(joinedCode, { connected: false, driverId: null, status: "spento", error: null });
      }
      const res = ponte.start(joinedCode, url, number);
      if (res.ok) {
        const stanza = getRoomState(joinedCode);
        stanza.fresh.ponte = false;
        stanza.collegamenti.ponte = { url: String(url || "").trim().slice(0, 300), number: String(number || "").trim().slice(0, 20) };
      }
      ack && ack(res);
    });

    socket.on("ponteDisconnect", () => {
      if (!joinedCode) return;
      getRoomState(joinedCode).fresh.ponte = false;
      ponte.stop(joinedCode);
      ponte.setStatus(joinedCode, { connected: false, status: "spento", error: null, session: null, flag: null });
    });

    // ----- ORIGINE DEI TIMER: manuale oppure automatico (fasi di gara di Aub) -----
    // In automatico partenza e gara arrivano dagli orari di Aub (vedi aubtimer.js) e i
    // comandi manuali sono fermi; "Azzera" riporta al manuale.
    socket.on("timerSource", ({ source } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.fresh.timerSrc = false;
      if (source === "aub") aubtimer.attiva(joinedCode);
      else if (source === "manual") aubtimer.disattiva(joinedCode);
    });
    // Vero se i timer sono in automatico: i comandi manuali allora non fanno nulla.
    const inAutomatico = () => getRoomState(joinedCode).raceTimer.source === "aub";

    // ----- TIMER DI PARTENZA (countdown verso il via) -----

    // BOX -> tutti: imposta la durata del countdown di partenza (solo da fermo)
    // La partenza puo' essere 0: in quel caso "Avvia" fa partire subito solo il
    // timer di gara (vedi timerControl).
    socket.on("timerStartSet", ({ seconds } = {}) => {
      if (!joinedCode || !eNum(seconds, 0, 7 * 86400) || inAutomatico()) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.startRunning) return;
      t.startSeconds = seconds;
      t.startRemaining = seconds;
      t.startUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: start / pausa / azzera del timer di partenza
    socket.on("timerStartControl", ({ action } = {}) => {
      if (!joinedCode || inAutomatico()) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.phase !== "start") return;
      if (action === "start") {
        t.startRunning = true;
        t.startUpdatedAt = Date.now();
      } else if (action === "pause") {
        t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
        t.startRunning = false;
        t.startUpdatedAt = Date.now();
      } else if (action === "stop") {
        t.startRunning = false;
        t.startRemaining = t.startSeconds;
        t.startUpdatedAt = Date.now();
      }
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // ----- COMANDI GENERALI: avvia / pausa / azzera valgono per tutta la sequenza -----
    // Partenza > 0: parte il conto alla rovescia, a zero parte da solo quello
    // di gara. Partenza a 0: "Avvia" fa partire subito solo il timer di gara.
    socket.on("timerControl", ({ action } = {}) => {
      if (!joinedCode) return;
      // In automatico solo "Azzera" fa qualcosa: toglie l'automatico e azzera.
      if (inAutomatico()) {
        if (action !== "stop") return;
        aubtimer.disattiva(joinedCode);
      }
      const t = getRoomState(joinedCode).raceTimer;
      const now = Date.now();
      if (action === "start") {
        if (t.phase === "start") {
          if (t.startRunning) return; // gia' in corso: non succede nulla
          const startRem = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
          if (startRem <= 0) {
            t.phase = "race";
            t.startRunning = false;
            t.startRemaining = 0;
            t.raceRunning = true;
            t.raceUpdatedAt = now;
          } else {
            t.startRunning = true;
            t.startUpdatedAt = now;
          }
        } else if (t.phase === "race") {
          if (t.raceRunning || t.raceRemaining <= 0) return; // gia' in corso: non succede nulla
          t.raceRunning = true;
          t.raceUpdatedAt = now;
        } else return;
      } else if (action === "pause") {
        if (t.phase === "start" && t.startRunning) {
          t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
          t.startRunning = false;
          t.startUpdatedAt = now;
        } else if (t.phase === "race" && t.raceRunning) {
          t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
          t.raceRunning = false;
          t.raceUpdatedAt = now;
        } else return;
      } else if (action === "stop") {
        // Azzera: tutto torna ai valori impostati (non li cancella).
        t.phase = "start";
        t.startRunning = false; t.startRemaining = t.startSeconds; t.startUpdatedAt = now;
        t.raceRunning = false; t.raceRemaining = t.raceSeconds; t.raceUpdatedAt = now;
        t.finishTriggered = false; t.finishPosition = null;
      } else return;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // ----- TIMER DI GARA (countdown della durata di gara) -----

    // BOX -> tutti: imposta/modifica la durata di gara (tipicamente da fermo o
    // in pausa, per esempio dopo una bandiera rossa che accorcia la gara)
    socket.on("timerRaceSet", ({ seconds } = {}) => {
      if (!joinedCode || !eNum(seconds, 1, 7 * 86400) || inAutomatico()) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.raceRunning) return;
      t.raceSeconds = seconds;
      t.raceRemaining = seconds;
      t.raceUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: start / pausa / azzera del timer di gara
    socket.on("timerRaceControl", ({ action } = {}) => {
      if (!joinedCode || inAutomatico()) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.phase !== "race") return;
      if (action === "start") {
        t.raceRunning = true;
        t.raceUpdatedAt = Date.now();
      } else if (action === "pause") {
        t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
        t.raceRunning = false;
        t.raceUpdatedAt = Date.now();
      } else if (action === "stop") {
        t.raceRunning = false;
        t.raceRemaining = t.raceSeconds;
        t.raceUpdatedAt = Date.now();
      }
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // Qualsiasi client (box o auto) segnala che il countdown di partenza e'
    // arrivato a zero sul proprio orologio locale: il server applica la
    // transizione partenza -> gara una volta sola (le segnalazioni ripetute
    // da altri dispositivi nello stesso istante vengono ignorate).
    socket.on("raceTimerAutoStart", () => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
      // In automatico il via lo decidono gli orari di Aub: si riallinea in questo istante.
      if (t.source === "aub") return aubtimer.sincronizza(joinedCode);
      if (t.phase !== "start") return;
      // Il via si accetta solo se il conto alla rovescia e' davvero (quasi) a zero: un telefono sbagliato non lo anticipa.
      if (!t.startRunning || currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed) > 3) return;
      t.phase = "race";
      t.startRunning = false;
      t.startRemaining = 0;
      t.raceRunning = true;
      t.raceUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: modalita' test, velocita' accelerata dei timer (solo stanze TEST+numero)
    socket.on("timerTestSpeed", ({ speed } = {}) => {
      if (!joinedCode || !eProva(joinedCode) || !eNum(speed, 0.1, 1000) || inAutomatico()) return;
      const t = getRoomState(joinedCode).raceTimer;
      // congela i tempi correnti prima di cambiare velocita', per continuita'
      t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
      t.startUpdatedAt = Date.now();
      t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
      t.raceUpdatedAt = Date.now();
      t.speed = speed;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: scorciatoie per saltare subito a un punto del flusso da testare
    // (solo stanze TEST+numero; il "reset" vale ovunque)
    socket.on("timerDebugJump", ({ preset } = {}) => {
      if (!joinedCode) return;
      // Fuori dalle stanze TEST resta solo il "Reset completo" (usato anche per chiudere il Finish).
      if (!eProva(joinedCode) && preset !== "reset") return;
      // In automatico resta solo il "Reset completo" (usato anche per chiudere il Finish).
      if (inAutomatico() && preset !== "reset") return;
      const t = getRoomState(joinedCode).raceTimer;
      const now = Date.now();
      switch (preset) {
        case "start-30s":
          t.phase = "start"; t.startRemaining = 30; t.startRunning = true; t.startUpdatedAt = now;
          t.finishTriggered = false;
          break;
        case "start-near-zero":
          t.phase = "start"; t.startRemaining = 3; t.startRunning = true; t.startUpdatedAt = now;
          t.finishTriggered = false;
          break;
        case "race-last-hour":
          t.phase = "race"; t.raceRemaining = 3600; t.raceRunning = true; t.raceUpdatedAt = now;
          t.finishTriggered = false;
          break;
        case "race-last-15min":
          t.phase = "race"; t.raceRemaining = 900; t.raceRunning = true; t.raceUpdatedAt = now;
          t.finishTriggered = false;
          break;
        case "race-near-finish":
          t.phase = "race"; t.raceRemaining = 4; t.raceRunning = true; t.raceUpdatedAt = now;
          t.finishTriggered = false;
          break;
        case "reset":
          t.phase = "start";
          t.startRemaining = t.startSeconds; t.startRunning = false; t.startUpdatedAt = now;
          t.raceRemaining = t.raceSeconds; t.raceRunning = false; t.raceUpdatedAt = now;
          t.finishTriggered = false; t.finishPosition = null; t.finishDriverName = "";
          // Un "reset completo" deve anche togliere la velocita' accelerata di
          // test: altrimenti resta a x60/x300 e il prossimo conto alla
          // rovescia scorre piu' in fretta di quanto i minuti/secondi dicano.
          t.speed = 1;
          break;
        default:
          return;
      }
      io.to(joinedCode).emit("timerUpdate", t);
      // In automatico, chiuso il Finish i timer tornano subito agli orari di Aub.
      if (t.source === "aub") aubtimer.sincronizza(joinedCode);
    });

    // ----- FINISH -----

    // BOX -> tutti: foto della schermata finale (JPEG gia' ridimensionato dal telefono, come
    // "data:image/jpeg;base64,..."), oppure null per tornare a quella predefinita.
    socket.on("finishPhotoUpdate", ({ data } = {}) => {
      if (!joinedCode || joinedRole !== "box") return;
      const state = getRoomState(joinedCode);
      if (data === null) {
        fotoFinale.delete(joinedCode);
        state.finishPhotoAt = null;
        state.fresh.foto = false;
        archivio.scriviFoto(joinedCode, null).catch((e) => console.error("foto finale: " + (e.message || e)));
        return io.to(joinedCode).emit("finishPhotoChanged", { at: null });
      }
      const m = typeof data === "string" && data.length <= 900000 ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data) : null;
      if (!m) return;
      const buf = Buffer.from(m[1], "base64");
      if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return; // non e' un JPEG
      const at = Date.now();
      fotoFinale.set(joinedCode, { buf, at });
      state.finishPhotoAt = at;
      state.fresh.foto = false;
      archivio.scriviFoto(joinedCode, data).catch((e) => console.error("foto finale: " + (e.message || e)));
      io.to(joinedCode).emit("finishPhotoChanged", { at });
    });

    // BOX -> tutti: configura modalita' (manuale/auto), sfondo e nome pilota
    // senza far comparire subito la schermata (preparazione in anticipo)
    socket.on("finishConfigUpdate", ({ mode, background, driverName } = {}) => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (mode) t.finishMode = mode;
      if (background) t.finishBackground = background;
      if (driverName !== undefined) t.finishDriverName = driverName;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> server: dopo un riavvio il timer che scorreva lo rimette il telefono del box (solo se
    // il server e' ripartito da zero e nessuno lo ha ancora toccato; vale la prima copia che arriva).
    socket.on("timerRestore", (d) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      if (!state.fresh.timer) return;
      if (!archivio.ripristinaTimer(state.raceTimer, d)) return;
      state.fresh.timer = false;
      io.to(joinedCode).emit("timerUpdate", state.raceTimer);
    });

    // BOX (o in automatico a fine timer gara) -> tutti: mostra il Finish
    socket.on("finishTrigger", ({ position, driverName } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      const t = state.raceTimer;
      t.phase = "finished";
      t.finishTriggered = true;
      t.finishPosition = eNum(position, 0, 999) ? position : posizioneFinale(state.timing);
      if (typeof driverName === "string" && driverName) t.finishDriverName = driverName.slice(0, 80);
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // ----- DOPPIO BOX -----
    socket.on("boxCedi", ({ minuti } = {}) => { if (joinedCode) doppio.cedi(joinedCode, joinedBoxId, Number(minuti)); });
    socket.on("boxRiprendi", () => { if (joinedCode) doppio.riprendi(joinedCode, joinedBoxId); });
    socket.on("boxPrendi", () => { if (joinedCode) doppio.prendi(joinedCode, joinedBoxId); });

    // Cambio pilota: la domanda "era un cambio pilota?" la apre il primario (il GPS lo segue lui), ma
    // risponde chi e' piu' vicino: il primo che risponde la chiude su tutti i box.
    socket.on("cambioDomanda", ({ ancoraDa } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.cambioDomanda = { at: Date.now() };
      socket.to(joinedCode).emit("cambioDomanda", { ancoraDa: eNum(ancoraDa, 0, 1e14) ? ancoraDa : Date.now() });
    });
    socket.on("cambioRisposta", ({ si, n } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      const d = state.cambioDomanda;
      if (!d || Date.now() - d.at > 30 * 60000) return;      // nessuna domanda aperta (o gia' chiusa da un altro box)
      state.cambioDomanda = null;
      if (si === true) state.cambioPilota = { n: eNum(n, 1, 999) ? n : ((state.cambioPilota && state.cambioPilota.n) || 0) + 1, da: Date.now() };
      socket.to(joinedCode).emit("cambioRisposta", { si: si === true, cambioPilota: state.cambioPilota });
    });
    socket.on("cambioAzzera", () => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.cambioPilota = { n: 0, da: null };
      socket.to(joinedCode).emit("cambioAzzera", {});
    });

    socket.on("disconnect", () => {
      if (joinedCode && joinedRole === "box") doppio.esci(joinedCode, socket);
      // nessuna pulizia particolare: lo stato della stanza resta per i reconnect.
      // Anche il collegamento alla classifica resta aperto: serve alla squadra,
      // non al singolo telefono che si e' spento.
    });
  });
}

module.exports = { registra };
