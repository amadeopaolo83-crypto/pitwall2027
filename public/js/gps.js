// GPS e automatismi (spenti all'inizio, si accendono dal box).
//
// - L'auto (telefono Android) manda la sua posizione solo quando il GPS e' acceso. Sullo
//   schermo dell'auto non compare niente.
// - Il box imposta due zone con la propria posizione: BOX (raggio piccolo) e RIFORNIMENTO.
// - Auto nella zona box = "ai box"; nella zona rifornimento = "rifornimento" (anche questo
//   conta come ai box per il carburante); fuori = "in pista".
// - Una zona vale solo dopo GPS_ATTESA_MS di permanenza (per non reagire a un passaggio) e
//   i punti poco precisi si ignorano. Con segnale perso lo stato resta quello di prima.
// - La corsia box si registra una volta percorrendola (striscia di asfalto, con tolleranza in metri).
//   Fermi dentro la corsia piu' a lungo della soglia (secondi, impostabile) = il box chiede
//   "era un cambio pilota?". Conta la posizione ferma, non la zona box o rifornimento.
// - Tutto si puo' correggere a mano: i pulsanti "In pista" / "Ai box" valgono sempre, e il
//   GPS interviene solo quando la zona cambia davvero.

const GPS_ATTESA_MS = 10000;   // permanenza minima in una zona prima di cambiare stato
const GPS_ACC_MAX = 30;        // metri: oltre, il punto non si usa
const GPS_PERSO_MS = 20000;    // senza punti per tanto = segnale perso
const GPS_USCITA_EXTRA = 5;    // metri in piu' per uscire da una zona in cui si e' gia'

const GPS_FERMO_M = 6;         // metri: entro tanto dal punto di sosta si considera fermo
const GPS_MOTO_MS = 4;         // m/s: sopra questa velocita' l'auto e' in movimento = in pista (il consumo continua, anche in corsia)
const GPS_SUPISTA_MS = 1.5;    // m/s: sul tracciato disegnato e almeno cosi' veloce = in pista
const GPS_TRACCIATO_M = 10;    // entro tanti metri dal tracciato disegnato = sulla pista
const GPS_ATTESA_PISTA_MS = 3000; // per tornare "in pista" basta questo (si riparte, non serve aspettare)
const GPS_PASSO_REG_M = 3;     // registrazione corsia: un punto ogni tanti metri

let gpsCfg = { on: false, box: null, refuel: null, refuelPoly: null, rBox: 10, rRefuel: 25, corsia: null, larg: 8, fermoS: 60, traguardo: null, giroRif: null, lancioS: 240, tracciato: null, limiteKmh: 60, allineamento: null };
let gpsUltima = null;          // ultimo punto ricevuto { lat, lng, acc, t }
let gpsUltimaBuona = 0;        // quando e' arrivato l'ultimo punto preciso
let gpsStato = null;           // 'pista' | 'box' | 'rifornimento' (confermato)
let gpsStatoDa = 0;
let gpsCandidato = null, gpsCandidatoDa = 0;
let gpsWatch = null;           // auto: invio della posizione
let gpsInvioUltimo = 0;
let gpsCambio = Object.assign({ n: 0, da: null, pistaMs: 0 }, load('pc_gps_cambio', {})); // cambi pilota registrati, inizio turno e tempo passato IN PISTA nel turno
let gpsCambioFatto = false;    // alla domanda di questa sosta si e' gia' risposto
let gpsChiedeRipartita = 0;    // quando l'auto e' ripartita con la domanda ancora aperta (0 = no); resta aperta GPS_DOMANDA_APERTA_S
let gpsChiedeDurata = 0;       // quanto e' rimasta ferma, in secondi
const GPS_DOMANDA_APERTA_S = 180;
let gpsChiede = false;         // la domanda "era un cambio pilota?" e' sul box
let gpsAncora = null, gpsAncoraDa = 0; // dove e da quando l'auto e' ferma
let gpsScia = [];              // ultimi punti dell'auto (per la scia sulla mappa)
let gpsVel = null;             // velocita' dell'auto in m/s (se si conosce)
let gpsInCorsia = false;       // l'ultimo punto preciso e' dentro la corsia box

// Applica lo stato dal GPS: acceso di norma; si spegne solo se lo si e' spento a mano ('0').
function gpsApplica(){ try{ return localStorage.getItem('pc_gps_applica') !== '0'; }catch(e){ return true; } }

// Simulatore (public/sim.html): con ?sim=1 l'app auto prende la posizione dal simulatore (stesso browser) invece che dal GPS.
// ?sim=0 lo spegne. Sui telefoni veri non viene mai acceso.
try{
  const qs = new URLSearchParams(location.search).get('sim');
  if(qs === '1') localStorage.setItem('pc_sim_gps', '1'); else if(qs === '0') localStorage.removeItem('pc_sim_gps');
}catch(e){}
function gpsSimAttivo(){ try{ return localStorage.getItem('pc_sim_gps') === '1' && typeof BroadcastChannel !== 'undefined'; }catch(e){ return false; } }
function gpsOsserva(cb, err, opt){
  if(gpsSimAttivo()){
    const ch = new BroadcastChannel('pitcomm-sim-gps');
    ch.onmessage = (ev) => {
      const d = ev.data;
      if(d && Number.isFinite(d.lat) && Number.isFinite(d.lng)) cb({ coords: { latitude: d.lat, longitude: d.lng, accuracy: Number.isFinite(d.acc) ? d.acc : 4, speed: Number.isFinite(d.v) ? d.v : null }, timestamp: Date.now() });
    };
    return { sim: ch };
  }
  return navigator.geolocation.watchPosition(cb, err, opt);
}
function gpsFermaOsserva(id){
  if(id && id.sim){ try{ id.sim.close(); }catch(e){} return; }
  if(navigator.geolocation) navigator.geolocation.clearWatch(id);
}

function gpsDistanza(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- configurazione (condivisa dalla squadra) ----------

// Il box si tiene una copia delle zone: se il server riparte a meta' gara (Render) gliele rimanda.
function gpsSalvaCopia(){
  if(role !== 'box') return;
  const vuota = !gpsCfg.box && !gpsCfg.refuel && !gpsCfg.refuelPoly && !gpsCfg.corsia && !gpsCfg.traguardo && !gpsCfg.giroRif && !gpsCfg.tracciato;
  save('pc_gps_cfg', { code, cfg: vuota ? null : gpsCfg });
}

function gpsRipristinaSeServerVuoto(state){
  const fresh = state && state.fresh ? state.fresh : {};
  if(role !== 'box' || !fresh.gps) return false;
  const copia = load('pc_gps_cfg', null);
  if(!copia || copia.code !== code || !copia.cfg) return false;
  gpsInvia(copia.cfg);
  return true;
}

function gpsApplicaConfig(c, nonSalvare){
  if(!c || typeof c !== 'object') return;
  gpsCfg = { ...gpsCfg, ...c };
  if(!nonSalvare) gpsSalvaCopia();
  if(typeof mappaConfigCambiata === 'function') mappaConfigCambiata();
  if(!gpsCfg.on){ gpsStato = null; gpsCandidato = null; gpsCambioFatto = false; gpsChiede = false; gpsChiedeRipartita = 0; gpsAncora = null; gpsScia = []; }
  if(role === 'auto') gpsAggiornaInvio();
  gpsRender();
}

function gpsInvia(parte){
  if(socket && socket.connected) socket.emit('gpsConfigUpdate', parte);
}

function gpsAccendi(on){
  if(on){
    try{ localStorage.setItem('pc_gps_applica', '1'); }catch(e){}
  }
  gpsInvia({ on: !!on });
}

function gpsApplicaToggle(on){
  try{ localStorage.setItem('pc_gps_applica', on ? '1' : '0'); }catch(e){}
  gpsRender();
}

function gpsNumero(chiave, el, min, max){
  const v = Number(String(el.value).replace(',', '.'));
  if(!Number.isFinite(v) || v < min || v > max){ gpsRender(); return; }
  gpsInvia({ [chiave]: v });
}

// ---------- auto: invio della posizione ----------

function gpsAggiornaInvio(){
  const deveInviare = role === 'auto' && gpsCfg.on && (navigator.geolocation || gpsSimAttivo());
  if(deveInviare && gpsWatch === null){
    gpsWatch = gpsOsserva((pos) => {
      // fascia di lancio: usa tutti i punti, con l'istante del GPS portato sul tempo sincronizzato
      if(typeof lancioPunto === 'function'){
        try{ lancioPunto({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, v: pos.coords.speed, t: (pos.timestamp || Date.now()) + clockOffset }); }catch(e){}
      }
      const ora = Date.now();
      if(ora - gpsInvioUltimo < 1000) return;
      gpsInvioUltimo = ora;
      if(socket && socket.connected){
        socket.emit('gpsPos', { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, v: pos.coords.speed });
      }
    }, () => { /* nessun permesso o nessun segnale: si riprova da soli */ },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  } else if(!deveInviare && gpsWatch !== null){
    gpsFermaOsserva(gpsWatch);
    gpsWatch = null;
  }
}

// ---------- box: imposta le zone con la propria posizione ----------

let gpsMisuraInCorso = false;
function gpsImpostaZona(quale, btn){
  if(!navigator.geolocation || gpsMisuraInCorso) return;
  gpsMisuraInCorso = true;
  const testo = btn.textContent;
  btn.textContent = 'Misuro…';
  let migliore = null;
  const id = navigator.geolocation.watchPosition((pos) => {
    if(!migliore || pos.coords.accuracy < migliore.acc){
      migliore = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  setTimeout(() => {
    navigator.geolocation.clearWatch(id);
    gpsMisuraInCorso = false;
    btn.textContent = testo;
    const et = $('gpsMsg');
    if(!migliore){ if(et) et.textContent = 'Nessuna posizione: controlla il permesso e riprova all’aperto.'; return; }
    if(migliore.acc > 25){ if(et) et.textContent = 'Precisione scarsa (±' + Math.round(migliore.acc) + ' m): riprova all’aperto.'; return; }
    gpsInvia({ [quale]: { lat: migliore.lat, lng: migliore.lng } });
    if(et) et.textContent = (quale === 'box' ? 'Zona box' : 'Zona rifornimento') + ' impostata (±' + Math.round(migliore.acc) + ' m).';
  }, 7000);
}

// Registra la corsia box: si preme, si percorre la corsia (a piedi o con l'auto) tenendo il
// telefono con il GPS acceso, si preme di nuovo. Un punto ogni 3 metri, solo se preciso.
let gpsReg = null;
function gpsLunghezza(c){ let m = 0; for(let i = 1; i < c.length; i++) m += gpsDistanza(c[i - 1], c[i]); return m; }
function gpsRegistraCorsia(btn){
  const et = $('gpsMsg');
  if(gpsReg){
    navigator.geolocation.clearWatch(gpsReg.id);
    let pts = gpsReg.pts; gpsReg = null;
    btn.textContent = 'Registra corsia box';
    if(pts.length < 2){ if(et) et.textContent = 'Corsia non registrata: troppo pochi punti precisi. Riprova all\u2019aperto.'; return; }
    while(pts.length > 500){ pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1); }
    gpsInvia({ corsia: pts });
    if(et) et.textContent = 'Corsia registrata: ' + pts.length + ' punti, ' + Math.round(gpsLunghezza(pts)) + ' m.';
    return;
  }
  if(!navigator.geolocation) return;
  gpsReg = { pts: [], id: null };
  btn.textContent = 'Fine registrazione (0 punti)';
  if(et) et.textContent = 'Percorri la corsia box dall\u2019ingresso all\u2019uscita, poi premi di nuovo.';
  gpsReg.id = navigator.geolocation.watchPosition((pos) => {
    if(!gpsReg || pos.coords.accuracy > 15) return;
    const q = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const pts = gpsReg.pts;
    if(!pts.length || gpsDistanza(pts[pts.length - 1], q) >= GPS_PASSO_REG_M){
      pts.push(q);
      btn.textContent = 'Fine registrazione (' + pts.length + ' punti)';
    }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

let gpsCancellaPronto = false;
let gpsGiroPronto = false;
function gpsCancellaGiroRif(btn){
  if(!gpsCfg.giroRif) return;
  if(!gpsGiroPronto){ gpsGiroPronto = true; btn.textContent = 'Tocca ancora per cancellare'; setTimeout(() => { gpsGiroPronto = false; btn.textContent = 'Cancella giro di riferimento'; }, 4000); return; }
  gpsGiroPronto = false; btn.textContent = 'Cancella giro di riferimento';
  gpsInvia({ giroRif: null });
}

function gpsCancellaZone(btn){
  if(!gpsCancellaPronto){
    gpsCancellaPronto = true;
    btn.textContent = 'Sicuro?';
    setTimeout(() => { gpsCancellaPronto = false; btn.textContent = 'Cancella zone e corsia'; }, 3000);
    return;
  }
  gpsCancellaPronto = false;
  btn.textContent = 'Cancella zone e corsia';
  gpsInvia({ box: null, refuel: null, refuelPoly: null, corsia: null });
}

// ---------- box: riceve la posizione e decide ----------

// ---------- area (poligono) ----------

// Punti in metri attorno a un riferimento (proiezione locale: basta per aree di pochi centinaia di metri).
function gpsProietta(poly, rif){
  const k = Math.PI / 180, mLat = 111320, mLng = 111320 * Math.cos(rif.lat * k);
  return poly.map((q) => ({ x: (q.lng - rif.lng) * mLng, y: (q.lat - rif.lat) * mLat }));
}

// Il punto e' dentro l'area? (regola pari-dispari)
function gpsInPoligono(p, poly){
  if(!poly || poly.length < 3) return false;
  const q = gpsProietta(poly, p);
  let dentro = false;
  for(let i = 0, j = q.length - 1; i < q.length; j = i++){
    if((q[i].y > 0) !== (q[j].y > 0) && 0 < (q[j].x - q[i].x) * (0 - q[i].y) / (q[j].y - q[i].y) + q[i].x) dentro = !dentro;
  }
  return dentro;
}

// Distanza in metri dal bordo dell'area.
function gpsDistBordo(p, poly){
  if(!poly || poly.length < 2) return Infinity;
  const q = gpsProietta(poly, p);
  let min = Infinity;
  for(let i = 0; i < q.length; i++){
    const a = q[i], b = q[(i + 1) % q.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
    min = Math.min(min, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return min;
}

function gpsZonaDi(p){
  const dB = gpsCfg.box ? gpsDistanza(p, gpsCfg.box) : Infinity;
  // chi e' gia' in una zona ne esce solo un po' piu' in la', cosi' il bordo non fa lampeggiare lo stato
  const rB = gpsCfg.rBox + (gpsStato === 'box' ? GPS_USCITA_EXTRA : 0);
  if(dB <= rB) return 'box';
  let inRif = false;
  if(gpsCfg.refuelPoly){
    inRif = gpsInPoligono(p, gpsCfg.refuelPoly) || (gpsStato === 'rifornimento' && gpsDistBordo(p, gpsCfg.refuelPoly) <= GPS_USCITA_EXTRA);
  } else if(gpsCfg.refuel){
    inRif = gpsDistanza(p, gpsCfg.refuel) <= gpsCfg.rRefuel + (gpsStato === 'rifornimento' ? GPS_USCITA_EXTRA : 0);
  }
  if(inRif) return 'rifornimento';
  return 'pista';
}

// Distanza dal tracciato disegnato (linea chiusa), infinita se non c'e'.
function gpsDistTracciato(p){
  const c = gpsCfg.tracciato;
  if(!c || c.length < 3) return Infinity;
  const k = Math.PI / 180, mLat = 111320, mLng = 111320 * Math.cos(p.lat * k);
  const X = (q) => (q.lng - p.lng) * mLng, Y = (q) => (q.lat - p.lat) * mLat;
  let min = Infinity;
  for(let i = 0; i < c.length; i++){
    const a = c[i], b = c[(i + 1) % c.length];
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}

// Stato candidato: in movimento (o sul tracciato e non fermo) = in pista; da fermi vale la zona.
// Senza velocita' si ragiona come prima (solo zona).
function gpsCandidatoDi(p){
  const zona = gpsZonaDi(p);
  const v = Number.isFinite(gpsVel) ? gpsVel : null;
  if(v != null){
    if(v >= GPS_MOTO_MS) return 'pista';
    if(v >= GPS_SUPISTA_MS && gpsDistTracciato(p) <= GPS_TRACCIATO_M) return 'pista';
  }
  return zona;
}

function gpsRicevi(p){
  if(role !== 'box' || !gpsCfg.on || !p) return;
  const prec = !(p.acc != null && p.acc > GPS_ACC_MAX);
  if(prec){
    const prima = gpsUltima;
    gpsVel = Number.isFinite(p.v) ? p.v : (prima && p.t > prima.t ? gpsDistanza(prima, p) / ((p.t - prima.t) / 1000) : null);
    gpsScia.push({ lat: p.lat, lng: p.lng });
    if(gpsScia.length > 300) gpsScia.shift();
  }
  gpsUltima = p;
  if(typeof mappaAuto === 'function') mappaAuto(prec);
  if(!prec) return;
  if(!gpsCfg.box && !gpsCfg.refuel && !gpsCfg.refuelPoly) return; // senza zone non si decide niente
  gpsUltimaBuona = Date.now();
  const cand = gpsCandidatoDi(p);
  const ora = Date.now();
  if(cand !== gpsCandidato){ gpsCandidato = cand; gpsCandidatoDa = ora; }
  if(cand !== gpsStato && ora - gpsCandidatoDa >= (cand === 'pista' ? GPS_ATTESA_PISTA_MS : GPS_ATTESA_MS)){
    // il GPS "decide" (in pista / ai box / rifornimento) solo sul box primario; il secondario si limita a mostrarlo
    if(boxPrimario) gpsCambiaStato(cand); else { gpsStato = cand; gpsStatoDa = ora; }
  }
  gpsAggiornaFermo(p, cand);
  gpsPitAggiorna(p);
  gpsRender();
}

function gpsCambiaStato(nuovo){
  const prima = gpsStato;
  gpsStato = nuovo;
  gpsStatoDa = Date.now();
  if(nuovo === 'pista' && !gpsCambio.da){ gpsCambio.da = Date.now(); gpsCambio.pistaMs = 0; save('pc_gps_cambio', gpsCambio); }
  if(!gpsApplica()) return;
  if(typeof setOnTrack === 'function') setOnTrack(nuovo === 'pista');
  void prima;
}

// "Allinea ora": mette subito lo stato che dice il GPS, senza aspettare la permanenza.
function gpsAllineaOra(){
  if(!gpsUltima || (gpsUltima.acc != null && gpsUltima.acc > GPS_ACC_MAX)){ const e = $('gpsMsg'); if(e) e.textContent = 'Nessuna posizione precisa dall’auto.'; return; }
  const z = gpsZonaDi(gpsUltima);
  gpsCandidato = z; gpsCandidatoDa = Date.now();
  gpsCambiaStato(z);
  if(!gpsApplica() && typeof setOnTrack === 'function') setOnTrack(z === 'pista');
  gpsRender();
}

// ---------- passaggi in corsia box dalla velocita' (solo registro, non cambia gli stati) ----------
// In corsia box si va al limite (gpsCfg.limiteKmh). Un'auto vicina alla corsia ma veloce e' in pista:
// la corsia vale solo dopo qualche secondo a velocita' ridotta. All'uscita si classifica: passaggio
// (non si e' fermata), rifornimento, cambio pilota probabile (fermo ai box da almeno fermoS) o sosta.
const GPS_PIT_CONFERMA_S = 3;     // secondi a velocita' ridotta in corsia per confermare che e' corsia
const GPS_PIT_USCITA_S = 4;       // secondi fuori corsia per chiudere il passaggio
const GPS_PIT_FERMO_MS = 1;       // m/s: sotto e' fermo
const GPS_PIT_MIN_SOSTA_S = 5;    // sosta minima per dirla tale
let gpsPit = { ep: null };        // episodio in corso
let gpsPitLog = load('pc_gps_pit', []);

function gpsPitInCorsia(p){
  // box e rifornimento contano come corsia anche se disegnati staccati da essa
  if(gpsZonaDi(p) !== 'pista') return true;
  if(gpsCfg.corsia && gpsCfg.corsia.length > 1) return gpsDistCorsia(p) <= gpsCfg.larg;
  return false;
}

// Se box o rifornimento sono staccati dalla corsia l'auto ci va con una deviazione: si aspetta di piu' prima di dire che e' uscita.
function gpsPitUscitaS(){
  if(!gpsCfg.corsia || gpsCfg.corsia.length < 2) return GPS_PIT_USCITA_S;
  let max = 0;
  const cand = [gpsCfg.box];
  if(gpsCfg.refuelPoly && gpsCfg.refuelPoly.length) cand.push({ lat: gpsCfg.refuelPoly.reduce((a, q) => a + q.lat, 0) / gpsCfg.refuelPoly.length, lng: gpsCfg.refuelPoly.reduce((a, q) => a + q.lng, 0) / gpsCfg.refuelPoly.length });
  else cand.push(gpsCfg.refuel);
  cand.forEach((c) => { if(c) max = Math.max(max, gpsDistCorsia(c)); });
  return GPS_PIT_USCITA_S + Math.min(60, max / 3);
}

// st: lo stato dell'episodio (di norma quello del box; il lancio sull'auto ne usa uno suo, senza toccare il registro).
// Ritorna true se in questo punto si e' chiuso un passaggio in corsia riconosciuto.
function gpsPitAggiorna(p, st){
  st = st || gpsPit;
  if(!gpsCfg.on || !p) return false;
  let chiuso = false;
  const t = Number.isFinite(p.t) ? p.t : Date.now();
  const v = Number.isFinite(p.v) ? p.v : (gpsVel != null ? gpsVel : null);
  const lim = (gpsCfg.limiteKmh || 60) / 3.6;
  const dentro = gpsPitInCorsia(p);
  let e = st.ep;
  if(dentro){
    const cp = gpsCfg.corsia && gpsCfg.corsia.length > 1 ? gpsCorsiaPos(p) : null;
    if(!e) e = st.ep = { s0: cp ? cp.s : null, smax: 0, L: cp ? cp.L : 0, ing: t, ult: t, lento: 0, conf: false, vmax: 0, fermoS: 0, maxFermoS: 0, dove: null, inFermo: null, fuori: null, zone: {} };
    const dt = Math.max(0, Math.min(5, (t - e.ult) / 1000));
    e.ult = t; e.fuori = null;
    if(cp) e.smax = Math.max(e.smax, cp.s);
    if(v != null){
      if(v <= lim * 1.25) e.lento += dt;
      if(e.conf || e.lento >= GPS_PIT_CONFERMA_S){ e.conf = true; e.vmax = Math.max(e.vmax, v); }
      if(v <= GPS_PIT_FERMO_MS){
        e.fermoS += dt; e.inFermo = (e.inFermo || 0) + dt;
        const z = gpsZonaDi(p); e.zone[z] = (e.zone[z] || 0) + dt;
        if(e.inFermo > e.maxFermoS){ e.maxFermoS = e.inFermo; e.dove = Object.keys(e.zone).sort((a, b) => e.zone[b] - e.zone[a])[0]; }
      } else e.inFermo = null;
    }
  } else if(e){
    if(e.fuori == null) e.fuori = t;
    if((t - e.fuori) / 1000 >= gpsPitUscitaS()) chiuso = gpsPitChiudi(e, st);
  }
  return chiuso;
}

// Un episodio e' un passaggio vero in corsia box solo se: ha rallentato (non e' la pista accanto alla corsia), per lo piu' piano,
// e, con la corsia registrata, e' entrato dall'inizio e ne ha percorso la maggior parte.
function gpsPitQualifica(e){
  if(!e || !e.conf) return false;
  if(e.lento < 0.7 * (e.ult - e.ing) / 1000) return false;
  if(e.s0 != null && !(e.s0 <= Math.max(40, e.L * 0.15) && e.smax >= e.L * 0.6)) return false;
  return true;
}
// Lo stesso, mentre e' ancora in corso (per sapere subito che l'auto sta passando in corsia).
function gpsPitInCorso(st){ return !!(st && st.ep && gpsPitQualifica(st.ep)); }

function gpsPitChiudi(e, st){
  st = st || gpsPit;
  st.ep = null;
  if(!gpsPitQualifica(e)) return false;
  if(st !== gpsPit) return true;               // stato di un altro (il lancio sull'auto): niente registro
  const durata = Math.max(0, (e.ult - e.ing) / 1000);
  let tipo = 'passaggio';
  if(e.maxFermoS >= GPS_PIT_MIN_SOSTA_S){
    if(e.dove === 'rifornimento') tipo = 'rifornimento';
    else if(e.maxFermoS >= gpsCfg.fermoS) tipo = 'cambio?';
    else tipo = 'sosta';
  }
  const r = { t: e.ing, corsiaS: Math.round(durata * 10) / 10, fermoS: Math.round(e.maxFermoS * 10) / 10, dove: e.dove, tipo, vmaxKmh: Math.round(e.vmax * 36) / 10, s0: e.s0 == null ? null : Math.round(e.s0), sMax: Math.round(e.smax), L: Math.round(e.L) };
  gpsPitLog.push(r); if(gpsPitLog.length > 40) gpsPitLog.shift();
  save('pc_gps_pit', gpsPitLog);
  gpsRender();
  return true;
}

// ---------- cambio pilota: fermi dentro la corsia box oltre la soglia ----------

// Distanza in metri dal percorso registrato della corsia (infinita se non c'e').
function gpsDistCorsia(p){
  const c = gpsCfg.corsia;
  if(!c || c.length < 2) return Infinity;
  const k = Math.PI / 180, mLat = 111320, mLng = 111320 * Math.cos(p.lat * k);
  const X = (q) => (q.lng - p.lng) * mLng, Y = (q) => (q.lat - p.lat) * mLat;
  let min = Infinity;
  for(let i = 0; i < c.length - 1; i++){
    const ax = X(c[i]), ay = Y(c[i]), bx = X(c[i + 1]), by = Y(c[i + 1]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}

// Distanza dalla corsia e posizione lungo di essa (metri dall'ingresso), con la lunghezza totale.
function gpsCorsiaPos(p){
  const c = gpsCfg.corsia;
  if(!c || c.length < 2) return null;
  const k = Math.PI / 180, mLat = 111320, mLng = 111320 * Math.cos(p.lat * k);
  const X = (q) => (q.lng - p.lng) * mLng, Y = (q) => (q.lat - p.lat) * mLat;
  let min = Infinity, sMin = 0, acc = 0;
  for(let i = 0; i < c.length - 1; i++){
    const ax = X(c[i]), ay = Y(c[i]), bx = X(c[i + 1]), by = Y(c[i + 1]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if(d < min){ min = d; sMin = acc + t * l; }
    acc += l;
  }
  return { d: min, s: sMin, L: acc };
}

// Fermo = il telefono dell'auto resta entro pochi metri dallo stesso punto. Si ricomincia a
// contare appena si sposta. Se la corsia non e' registrata vale la zona box o rifornimento.
function gpsAggiornaFermo(p, zona){
  const ora = Date.now();
  const raggio = Math.max(GPS_FERMO_M, 2 * (p.acc || 0));
  // La domanda resta aperta dopo la ripartenza (per GPS_DOMANDA_APERTA_S secondi) finche' non si risponde:
  // con una sosta lunga poco piu' della soglia comparirebbe per pochi secondi e sfuggirebbe.
  if(gpsChiede && gpsChiedeRipartita && ora - gpsChiedeRipartita > GPS_DOMANDA_APERTA_S * 1000){
    gpsChiede = false; gpsCambioFatto = false; gpsChiedeRipartita = 0; gpsRender();
  }
  if(!gpsAncora || gpsDistanza(p, gpsAncora) > raggio){
    const eraAperta = gpsChiede, durata = gpsAncoraDa ? (ora - gpsAncoraDa) / 1000 : 0;
    gpsAncora = { lat: p.lat, lng: p.lng };
    gpsAncoraDa = ora;
    if(eraAperta){
      if(!gpsChiedeRipartita){ gpsChiedeRipartita = ora; gpsChiedeDurata = durata; gpsRender(); }
    } else {
      gpsChiede = false;
      gpsCambioFatto = false;
    }
  }
  gpsInCorsia = gpsCfg.corsia ? (gpsDistCorsia(p) <= gpsCfg.larg || zona === 'box') : zona !== 'pista';
  gpsControllaFermo();
}

// Superata la soglia non registra da solo: sul box compare la domanda "era un cambio pilota?".
function gpsControllaFermo(){
  if(!gpsCfg.on || !gpsAncora || !gpsInCorsia || gpsCambioFatto || gpsChiede) return;
  if(!boxPrimario) return; // la domanda la apre il box primario; il secondario la riceve dal server
  if(Date.now() - gpsUltimaBuona > GPS_PERSO_MS) return; // senza segnale non si decide
  if((Date.now() - gpsAncoraDa) / 1000 >= gpsCfg.fermoS){
    gpsChiede = true;
    if(socket && socket.connected) socket.emit('cambioDomanda', { ancoraDa: gpsAncoraDa });
    try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
    try{ if(typeof playAlertBeep === 'function') playAlertBeep(); }catch(e){}
    if(typeof notificaAndroid === 'function') notificaAndroid('PitComm', 'Auto ferma in corsia box: era un cambio pilota?');
    notificaLocale('PitComm: cambio pilota?', 'Auto ferma in corsia box: era un cambio pilota?', 'pitcomm-cambio');
    gpsRender();
  }
}

function gpsRispostaCambio(si){
  gpsChiede = false; gpsChiedeRipartita = 0;
  gpsCambioFatto = true; // una sola domanda per ogni sosta
  if(si) gpsRegistraCambio();
  // lo sa anche l'altro box: la domanda si chiude su tutti (risponde chi e' piu' vicino)
  if(socket && socket.connected) socket.emit('cambioRisposta', { si: !!si, n: gpsCambio.n });
  gpsRender();
}

// La domanda "era un cambio pilota?" aperta dal box primario arriva anche qui: si puo' rispondere da questo box.
function gpsDomandaRemota(d){
  if(role !== 'box' || !gpsCfg.on || gpsChiede) return;
  gpsChiede = true; gpsCambioFatto = false;
  if(d && Number.isFinite(d.ancoraDa)) gpsAncoraDa = d.ancoraDa;
  try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
  try{ if(typeof playAlertBeep === 'function') playAlertBeep(); }catch(e){}
  if(typeof notificaAndroid === 'function') notificaAndroid('PitComm', 'Auto ferma in corsia box: era un cambio pilota?');
    notificaLocale('PitComm: cambio pilota?', 'Auto ferma in corsia box: era un cambio pilota?', 'pitcomm-cambio');
  gpsRender();
}

// L'altro box ha risposto: la domanda sparisce anche qui e, se era un cambio, si aggiorna il turno.
// Nuovo turno: il tempo in pista riparte da zero.
function gpsImpostaCambio(n, da){
  gpsCambio = { n: n || 0, da: da || null, pistaMs: 0 };
  save('pc_gps_cambio', gpsCambio);
}

function gpsRispostaRemota(d){
  gpsChiede = false; gpsChiedeRipartita = 0; gpsCambioFatto = true;
  if(d && d.si && d.cambioPilota && d.cambioPilota.da) gpsImpostaCambio(d.cambioPilota.n, d.cambioPilota.da);
  gpsRender();
}

function gpsAzzeraRemoto(){
  gpsImpostaCambio(0, null);
  gpsRender();
}

function gpsRegistraCambio(){
  gpsCambioFatto = true;
  gpsImpostaCambio((gpsCambio.n || 0) + 1, Date.now());
  gpsRender();
}

// Cambio pilota segnato a mano (pulsante nella scheda Gara): vale sempre, anche senza domanda aperta
// e anche con il GPS spento; lo sanno anche gli altri box.
function gpsCambioManuale(btnEl){
  gpsChiede = false; gpsChiedeRipartita = 0;
  gpsRegistraCambio();
  if(socket && socket.connected) socket.emit('cambioRisposta', { si: true, n: gpsCambio.n, manuale: true });
  if(typeof flashConfirm === 'function') flashConfirm(btnEl);
}

function gpsAzzeraCambi(){
  if(!boxPrimario){ if(typeof boxNegato === 'function') boxNegato(); return; }
  if(socket && socket.connected) socket.emit('cambioAzzera');
  gpsImpostaCambio(0, null);
  gpsRender();
}

// ---------- schermo del box ----------

function gpsFmtGiro(s){ const d = Math.round(s * 10); const m = Math.floor(d / 600); const r = (d - m * 600) / 10; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }

function gpsMinSec(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function gpsRiga(){
  if(!gpsCfg.on) return '';
  const ora = Date.now();
  const nomi = { pista: 'in pista', box: 'ai box', rifornimento: 'rifornimento' };
  let t = 'GPS: ';
  if(!gpsCfg.box && !gpsCfg.refuel && !gpsCfg.refuelPoly) return t + 'imposta le zone';
  if(!gpsUltima || ora - gpsUltimaBuona > GPS_PERSO_MS){
    t += gpsUltima ? 'segnale perso da ' + gpsMinSec(ora - gpsUltimaBuona) : 'in attesa dell’auto';
    if(gpsStato) t += ' · ultimo: ' + nomi[gpsStato];
  } else {
    t += gpsStato ? nomi[gpsStato] + ' da ' + gpsMinSec(ora - gpsStatoDa) : 'sto controllando…';
    if(gpsUltima.acc != null) t += ' · ±' + Math.round(gpsUltima.acc) + ' m';
  }
  const up = gpsPitLog[gpsPitLog.length - 1];
  if(up) t += ' · ultimo pit: ' + up.tipo + (up.fermoS >= GPS_PIT_MIN_SOSTA_S ? ' ' + Math.round(up.fermoS) + ' s fermo' : '') + ', corsia ' + Math.round(up.corsiaS) + ' s';
  return t;
}

// Stint massimo del pilota (minuti, 0 = spento): impostazione di questo box.
function gpsStintMax(){ let v = 0; try{ v = Number(localStorage.getItem('pc_stint_max')) || 0; }catch(e){} return v > 0 ? v : 0; }

function gpsImpostaStintMax(el){
  const n = parseFloat(String(el.value).replace(',', '.'));
  try{ localStorage.setItem('pc_stint_max', String(isFinite(n) && n > 0 ? Math.round(n) : 0)); }catch(e){}
  gpsRender();
}

function gpsTurnoTesto(){
  const max = gpsStintMax();
  if(!gpsCambio.da) return 'Turno pilota: non ancora iniziato (parte quando l\u2019auto esce in pista)' + (max ? ' \u00b7 stint massimo ' + max + ' min' : '');
  const ms = gpsCambio.pistaMs || 0;
  let t = 'Turno pilota' + (gpsCambio.n ? ' ' + (gpsCambio.n + 1) : '') + ': ' + gpsMinSec(ms) + ' in pista' + (fuelSystem && fuelSystem.onTrack ? '' : ' (fermo: ai box)');
  if(max) t += ' \u00b7 massimo ' + max + ' min \u00b7 ' + (ms >= max * 60000 ? 'SUPERATO di ' + gpsMinSec(ms - max * 60000) : 'restano ' + gpsMinSec(max * 60000 - ms));
  return t;
}

// Domanda "era un cambio pilota?" aperta: fascia rossa in cima a OGNI scheda, titolo della finestra che lampeggia e bip ripetuto
// ogni 8 s finche' non si risponde (sul PC la finestra puo' essere dietro altre: il titolo si vede nella barra delle applicazioni).
let gpsAvvisoBip = 0, gpsTitoloOriginale = null;
function gpsAvvisoCambio(aperta){
  const av = $('cambioAvviso');
  if(av){
    av.hidden = !aperta;
    if(aperta && $('gpsDomandaTesto') && $('cambioAvvisoTesto')) $('cambioAvvisoTesto').textContent = $('gpsDomandaTesto').textContent;
  }
  if(aperta){
    if(gpsTitoloOriginale == null) gpsTitoloOriginale = document.title;
    document.title = (Math.floor(Date.now() / 1000) % 2 ? '\u26a0 CAMBIO PILOTA? ' : '\u25b6 ') + gpsTitoloOriginale;
    if(Date.now() - gpsAvvisoBip > 8000){ gpsAvvisoBip = Date.now(); try{ playAlertBeep(); }catch(e){} }
  } else if(gpsTitoloOriginale != null){ document.title = gpsTitoloOriginale; gpsTitoloOriginale = null; gpsAvvisoBip = 0; }
}

// Conta il tempo del turno solo mentre l'auto e' in pista (ai box e in corsia non si conta).
let gpsTurnoUltimo = 0, gpsTurnoSalvato = 0;
function gpsTurnoTick(){
  if(role !== 'box') return;
  const ora = Date.now(), dt = gpsTurnoUltimo ? Math.min(ora - gpsTurnoUltimo, 3000) : 0;
  gpsTurnoUltimo = ora;
  if(typeof fuelSystem === 'undefined' || !fuelSystem.onTrack) return;
  if(!gpsCambio.da){ gpsCambio.da = ora; gpsCambio.pistaMs = 0; }
  gpsCambio.pistaMs = (gpsCambio.pistaMs || 0) + dt;
  if(ora - gpsTurnoSalvato > 5000){ gpsTurnoSalvato = ora; save('pc_gps_cambio', gpsCambio); }
  const max = gpsStintMax();
  if(max && typeof crControlla === 'function'){
    const ms = gpsCambio.pistaMs, lim = max * 60000;
    crControlla('stint-max', ms >= lim, 'Stint massimo raggiunto: ' + gpsMinSec(ms) + ' in pista (massimo ' + max + ' min)');
    if(max > 10) crControlla('stint-5', ms >= lim - 5 * 60000 && ms < lim, 'Stint: restano 5 minuti (massimo ' + max + ' min)');
  }
}

function gpsRender(){
  if(role !== 'box') return;
  const tb = $('boxTabBtn_gara');
  const aperta = !!(gpsCfg.on && gpsChiede);
  if(tb) tb.classList.toggle('tab-avviso', aperta);
  gpsAvvisoCambio(aperta);
  if($('turnoTesto')) $('turnoTesto').textContent = gpsTurnoTesto();
  if($('stintMaxInput') && document.activeElement !== $('stintMaxInput')) $('stintMaxInput').value = gpsStintMax() || '';
  const dom = $('gpsDomanda');
  if(dom){
    dom.hidden = !(gpsCfg.on && gpsChiede);
    if(!dom.hidden && $('gpsDomandaTesto')) $('gpsDomandaTesto').textContent = gpsChiedeRipartita
      ? 'L\u2019auto e\u2019 ripartita dopo ' + gpsMinSec(gpsChiedeDurata * 1000) + ' ferma in corsia box: era un cambio pilota?'
      : 'Auto ferma da ' + gpsMinSec(Date.now() - gpsAncoraDa) + ' in corsia box: era un cambio pilota?';
  }
  const riga = $('gpsRiga');
  if(riga){ riga.textContent = gpsRiga(); riga.hidden = !gpsCfg.on; }
  if($('gpsOn')) $('gpsOn').checked = !!gpsCfg.on;
  if($('gpsMappaBtn')) $('gpsMappaBtn').hidden = false;
  if($('gpsApplica')) $('gpsApplica').checked = gpsApplica();
  const f = (id, v) => { const e = $(id); if(e && document.activeElement !== e) e.value = v; };
  f('gpsLancioS', gpsCfg.lancioS); f('gpsRBox', gpsCfg.rBox); f('gpsRRefuel', gpsCfg.rRefuel); f('gpsFermoS', gpsCfg.fermoS); f('gpsLarg', gpsCfg.larg);
  if($('gpsLancio')) $('gpsLancio').textContent = 'Fascia di lancio: traguardo ' + (gpsCfg.traguardo ? 'impostato (' + Math.round(gpsDistanza(gpsCfg.traguardo[0], gpsCfg.traguardo[1])) + ' m)' : 'non impostato') + ' \u00b7 giro di riferimento ' + (gpsCfg.giroRif ? gpsFmtGiro(gpsCfg.giroRif.t) : 'non registrato') + (gpsCfg.traguardo && gpsCfg.giroRif ? ' \u00b7 pronta' : ' \u00b7 non pronta');
  if($('gpsZone')) $('gpsZone').textContent = 'Zona box: ' + (gpsCfg.box ? 'impostata' : 'non impostata') + ' \u00b7 Rifornimento: ' + (gpsCfg.refuelPoly ? 'area (' + gpsCfg.refuelPoly.length + ' punti)' : gpsCfg.refuel ? 'cerchio' : 'non impostato') + ' \u00b7 Corsia box: ' + (gpsCfg.corsia ? 'registrata (' + Math.round(gpsLunghezza(gpsCfg.corsia)) + ' m)' : 'non registrata');
}

setInterval(() => {
  if(role !== 'box') return;
  try{ gpsTurnoTick(); }catch(e){}
  if(!gpsCfg.on){ gpsRender(); return; }
  gpsControllaFermo();
  gpsRender();
}, 1000);
