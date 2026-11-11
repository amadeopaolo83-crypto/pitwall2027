// Fascia di lancio (solo sull'auto, solo prima dello zero della partenza lanciata).
//
// Durante il riscaldamento le auto girano liberamente; la gara parte quando il conto alla
// rovescia arriva a zero e il giro che conta e' quello in cui si passa la linea DOPO lo zero.
// Passare un secondo prima = giro perso. Qui l'auto, con il solo GPS, stima quando passera'
// sul traguardo virtuale e dice al pilota se rallentare o accelerare per passarlo appena dopo
// lo zero (obiettivo +1 s: bene da 0 a +2 s). E' un consiglio, non un obbligo.
//
// Come stima:
// - il traguardo virtuale e' una linea di due punti (disegnata sulla mappa);
// - ogni passaggio sulla linea (con interpolazione tra due punti GPS) chiude un giro;
//   un giro pulito (senza box, corsia o soste) diventa il "giro di riferimento": punti + secondi;
// - in ogni punto si cerca dove si e' sul giro di riferimento e si ricava il ritmo attuale
//   (r = tempo vero / tempo del riferimento sugli ultimi secondi);
// - il tempo al prossimo passaggio utile = (durata - punto del riferimento) * r, poi un giro
//   intero ogni durata * r; si sceglie il passaggio che richiede la correzione relativa minore.
// La fascia compare solo se GPS acceso, traguardo e giro di riferimento esistono, la partenza
// sta contando e mancano al massimo lancioS secondi. In tutti gli altri casi la vista auto
// resta quella di sempre.

const LA_OBIETTIVO_S = 1.0;      // si vuole passare a +1 s dallo zero
const LA_TOLLERANZA_S = 1.0;     // verde se l'arrivo e' tra 0 e +2 s
const LA_FONDO_SCALA_S = 10;     // la fascia piena vale +-10 s
const LA_GIRO_MIN_S = 20, LA_GIRO_MAX_S = 1200;
const LA_ACC_GIRO_M = 15;        // nel giro di riferimento entrano solo punti piu' precisi di cosi'
const LA_BUCO_MAX_S = 6;         // tra due punti buoni: oltre, il giro non vale come riferimento
const LA_FERMO_MAX_S = 6;        // fermo (v < 2 m/s) piu' di cosi': giro non pulito
const LA_FINESTRA_RITMO_S = 30;  // sugli ultimi secondi si misura il ritmo
const LA_FUORI_M = 60;           // piu' lontano di cosi' dal giro di riferimento: fuori traiettoria
const LA_SENZA_GPS_MS = 6000;

let laGiro = null;        // giro in corso { t0, pts:[[lat,lng,s]], pulito, fermoS, ultimoS }
let laPrec = null;        // ultimo punto preciso { lat, lng, t, v }
let laCroc = null;        // istante dell'ultimo passaggio sulla linea
let laVerso = 0;          // verso di attraversamento accettato (+1 / -1)
let laLocale = null;      // giro pulito piu' recente fatto in questa sessione { t, p }
let laPrepMemo = null;    // riferimento preparato { src, ..., xy }
let laIdx = -1;           // posizione sul giro di riferimento (indice del segmento)
let laStorico = [];       // [{ t, tg }] per il ritmo
let laR = 1;              // ritmo: 1 = come il riferimento, 1.1 = 10% piu' lento
let laRis = null;         // ultimo risultato { e, d, aLinea, fuori, ... }
let laUltimoPunto = 0;    // quando e' arrivato l'ultimo punto buono (Date.now)
let laInviato = 0;
let laPitSt = { ep: null };   // passaggio in corsia box visto dall'auto (stessa logica del registro pit del box, ma a parte)

// ---------- geometria in metri attorno al punto di riferimento ----------

function laMetri(p, rif){
  const k = Math.PI / 180;
  return { x: (p.lng - rif.lng) * 111320 * Math.cos(rif.lat * k), y: (p.lat - rif.lat) * 111320 };
}

// Attraversamento del segmento A->B con la linea. Ritorna { f, verso } (f = frazione lungo A->B)
// oppure null.
function laIncrocio(A, B, linea){
  const rif = { lat: (linea[0].lat + linea[1].lat) / 2, lng: (linea[0].lng + linea[1].lng) / 2 };
  const a = laMetri(A, rif), b = laMetri(B, rif), l1 = laMetri(linea[0], rif), l2 = laMetri(linea[1], rif);
  const rx = b.x - a.x, ry = b.y - a.y, sx = l2.x - l1.x, sy = l2.y - l1.y;
  const den = rx * sy - ry * sx;
  if(Math.abs(den) < 1e-9) return null;
  const qx = l1.x - a.x, qy = l1.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if(t < 0 || t > 1 || u < -0.02 || u > 1.02) return null;
  return { f: t, verso: den > 0 ? 1 : -1 };
}

function laRiferimentoAttivo(){
  if(laLocale) return laLocale;
  const g = gpsCfg.giroRif;
  return g && g.p && g.p.length >= 10 ? g : null;
}

// Punti del riferimento in metri (calcolati una volta per riferimento).
function laPrepara(rifG){
  if(laPrepMemo && laPrepMemo.src === rifG) return laPrepMemo;
  const o = { lat: rifG.p[0][0], lng: rifG.p[0][1] };
  const xy = rifG.p.map((q) => laMetri({ lat: q[0], lng: q[1] }, o));
  laPrepMemo = { src: rifG, o, xy, ts: rifG.p.map((q) => q[2]) };
  laIdx = -1; laStorico = [];
  return laPrepMemo;
}

// Dove si e' sul riferimento: { tg (secondi dalla linea), dist (m) } oppure null.
function laProietta(prep, p){
  const q = laMetri(p, prep.o), xy = prep.xy, ts = prep.ts, n = xy.length;
  const cerca = (da, a) => {
    let best = null;
    for(let i = Math.max(0, da); i < Math.min(n - 1, a); i++){
      const dx = xy[i + 1].x - xy[i].x, dy = xy[i + 1].y - xy[i].y, l2 = dx * dx + dy * dy;
      const f = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - xy[i].x) * dx + (q.y - xy[i].y) * dy) / l2)) : 0;
      const d = Math.hypot(xy[i].x + f * dx - q.x, xy[i].y + f * dy - q.y);
      if(!best || d < best.d) best = { d, i, tg: ts[i] + f * (ts[i + 1] - ts[i]) };
    }
    return best;
  };
  let r = laIdx >= 0 ? cerca(laIdx - 3, laIdx + 30) : null;
  if(!r || r.d > LA_FUORI_M) r = cerca(0, n - 1);
  if(!r) return null;
  laIdx = r.i;
  return { tg: r.tg, dist: r.d };
}

// ---------- ingresso: un punto GPS dell'auto ----------

function lancioPunto(p){
  if(role !== 'auto' || !gpsCfg.on){ laGiro = null; laPrec = null; laCroc = null; laRis = null; laPitSt = { ep: null }; return; }
  if(!p || (p.acc != null && p.acc > GPS_ACC_MAX)) return;
  laUltimoPunto = Date.now();
  // Giro non valido come riferimento se in questo giro c'e' stato un passaggio in corsia box (entrata dall'inizio, percorsa, piano; o fermo ai box).
  // Non basta passare vicino alla corsia ne' avere la pista accanto: conta il comportamento, non la velocita' assoluta.
  try{ if(gpsPitAggiorna(p, laPitSt) || gpsPitInCorso(laPitSt)){ if(laGiro) laGiro.pulito = false; } }catch(e){}
  const linea = gpsCfg.traguardo;
  if(linea && laPrec && p.t > laPrec.t && gpsDistanza(laPrec, p) < 200){
    const inc = laIncrocio(laPrec, p, linea);
    if(inc){
      if(!laVerso) laVerso = inc.verso;
      if(inc.verso === laVerso){
        const tc = laPrec.t + inc.f * (p.t - laPrec.t);
        const px = { lat: laPrec.lat + inc.f * (p.lat - laPrec.lat), lng: laPrec.lng + inc.f * (p.lng - laPrec.lng) };
        laPassaggio(tc, px);
      }
    }
  }
  if(laGiro) laAggiungi(p);
  laPrec = { lat: p.lat, lng: p.lng, t: p.t, v: p.v };
  laCalcola(p);
  try{ lancioAggiorna(); }catch(e){}
}

function laAggiungi(p){
  const s = (p.t - laGiro.t0) / 1000;
  if(s <= laGiro.ultimoS) return;
  if(p.acc != null && p.acc > LA_ACC_GIRO_M) return;   // punto poco preciso: salta (il buco poi squalifica il giro se lungo)
  if(s - laGiro.ultimoS < 0.8) return;
  if(s - laGiro.ultimoS > LA_BUCO_MAX_S) laGiro.pulito = false;
  if(Number.isFinite(p.v) && p.v < 2){
    laGiro.fermoS += s - laGiro.ultimoS;
    if(laGiro.fermoS > LA_FERMO_MAX_S) laGiro.pulito = false;
  } else laGiro.fermoS = 0;
  // box o rifornimento: la sosta ai box non e' un giro di riferimento. Conta solo andando piano: i box possono stare
  // a pochi metri dal rettilineo e passarci accanto a velocita' di pista non e' una sosta (senza velocita' si resta prudenti).
  const pianoBox = !Number.isFinite(p.v) || p.v <= (gpsCfg.limiteKmh || 60) / 3.6 * 1.25;
  if(pianoBox && laInZonaBox(p)) laGiro.pulito = false;
  laGiro.pts.push([Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, Math.round(s * 100) / 100]);
  laGiro.ultimoS = s;
}

function laInZonaBox(p){
  if(gpsCfg.box && gpsDistanza(p, gpsCfg.box) <= gpsCfg.rBox + 5) return true;
  if(gpsCfg.refuelPoly && (gpsInPoligono(p, gpsCfg.refuelPoly) || gpsDistBordo(p, gpsCfg.refuelPoly) <= 5)) return true;
  if(!gpsCfg.refuelPoly && gpsCfg.refuel && gpsDistanza(p, gpsCfg.refuel) <= gpsCfg.rRefuel + 5) return true;
  return false;
}

// Passaggio sulla linea all'istante tc (ms, tempo sincronizzato) nel punto px.
function laPassaggio(tc, px){
  if(laGiro){
    const T = (tc - laGiro.t0) / 1000;
    const pts = laGiro.pts;
    if(laGiro.pulito && T >= LA_GIRO_MIN_S && T <= LA_GIRO_MAX_S && pts.length >= Math.max(10, T / 3) && pts.length <= 880 &&
       T - laGiro.ultimoS <= LA_BUCO_MAX_S){
      const giro = { t: Math.round(T * 100) / 100, p: [[laGiro.inizio.lat, laGiro.inizio.lng, 0], ...pts, [Math.round(px.lat * 1e6) / 1e6, Math.round(px.lng * 1e6) / 1e6, Math.round(T * 100) / 100]] };
      laLocale = giro;
      const salvato = gpsCfg.giroRif;
      if(socket && socket.connected && (!salvato || giro.t < salvato.t - 0.3) && Date.now() - laInviato > 20000){
        laInviato = Date.now();
        socket.emit('gpsGiroRif', giro);
      }
    }
  }
  laGiro = { t0: tc, inizio: { lat: Math.round(px.lat * 1e6) / 1e6, lng: Math.round(px.lng * 1e6) / 1e6 }, pts: [], pulito: !gpsPitInCorso(laPitSt), fermoS: 0, ultimoS: 0 };
  laCroc = tc;
  laIdx = -1;
  laStorico = [];
}

// ---------- calcolo della fascia ----------

function laRestante(){
  const t = typeof lastTimerState !== 'undefined' ? lastTimerState : null;
  if(!t || t.phase !== 'start' || !t.startRunning) return null;
  return currentRemainingClient(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
}

function laCalcola(p){
  const rifG = laRiferimentoAttivo();
  const rem = laRestante();
  if(!rifG || !gpsCfg.traguardo || rem == null || rem <= 0){ laRis = null; return; }
  const prep = laPrepara(rifG);
  const pr = laProietta(prep, p);
  if(!pr){ laRis = null; return; }
  if(pr.dist > LA_FUORI_M){ laRis = { fuori: true }; return; }
  const Tg = rifG.t;
  // ritmo sugli ultimi secondi (se si e' passati dalla linea almeno una volta)
  laStorico.push({ t: p.t, tg: pr.tg });
  while(laStorico.length > 1 && p.t - laStorico[0].t > LA_FINESTRA_RITMO_S * 1000) laStorico.shift();
  const a = laStorico[0];
  if(laCroc != null && a && p.t - a.t >= 5000 && pr.tg - a.tg >= 3) laR = Math.max(0.6, Math.min(1.6, ((p.t - a.t) / 1000) / (pr.tg - a.tg)));
  const ritardo = (nowSync() - p.t) / 1000;                 // il punto ha qualche istante
  const eta1 = Math.max(0, (Tg - pr.tg) * laR - ritardo);
  const giro = Tg * laR;
  const Z = rem + LA_OBIETTIVO_S;                           // secondi da adesso al passaggio ideale
  let migliore = null;
  for(let k = 0; k < 40; k++){
    const A = eta1 + k * giro;
    if(A > Z + giro) break;
    const rel = Math.abs(A - Z) / Math.max(A, 1);
    if(!migliore || rel < migliore.rel) migliore = { A, rel, k: k + 1 };
  }
  if(!migliore){ laRis = null; return; }
  const e = migliore.A - Z;                                 // <0 arriva troppo presto, >0 troppo tardi
  laRis = { fuori: false, e, d: e + LA_OBIETTIVO_S, aLinea: migliore.A, eta1, k: migliore.k, r: laR, rel: migliore.rel };
}

// ---------- vista auto ----------

function lancioAttivo(){
  if(role !== 'auto' || !gpsCfg.on || !gpsCfg.traguardo || !laRiferimentoAttivo()) return false;
  const rem = laRestante();
  return rem != null && rem > 0 && rem <= (gpsCfg.lancioS || 240);
}

function laFmtS(x){ return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + ' s'; }
function laFmtT(s){ s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function lancioAggiorna(){
  const vista = $('autoView'), box = $('lancioGuida');
  if(!vista || !box) return;
  const attivo = lancioAttivo();
  vista.classList.toggle('lancio', attivo);
  box.hidden = !attivo;
  if(!attivo) return;
  const senzaGps = Date.now() - laUltimoPunto > LA_SENZA_GPS_MS;
  const r = laRis;
  const msg = senzaGps ? 'Posizione GPS non disponibile' : (!r ? 'Calcolo in corso…' : (r.fuori ? 'Fuori dal giro di riferimento' : ''));
  box.classList.toggle('senza', !!msg);
  $('lancioMsg').textContent = msg;
  if(msg) return;
  const e = r.e, ok = Math.abs(e) <= LA_TOLLERANZA_S;
  const p = Math.min(Math.abs(e) / LA_FONDO_SCALA_S, 1) * 100;
  const fl = $('lancioFl'), fr = $('lancioFr');
  fl.style.width = e < 0 ? p + '%' : '0%';
  fr.style.width = e > 0 ? p + '%' : '0%';
  fl.classList.toggle('good', ok); fr.classList.toggle('good', ok);
  const cmd = $('lancioCmd');
  const fuori = Math.abs(e) > 0.2 * Math.max(r.aLinea, 1);
  cmd.className = 'cmd ' + (ok ? 'ok' : e < 0 ? 'slow' : 'fast');
  cmd.textContent = ok ? 'Giro perfetto' : (e < 0 ? 'Rallenta' : 'Accelera');
  $('lancioVal').textContent = ok ? '' : (e < 0 ? '−' : '+') + Math.abs(e).toFixed(1) + ' s' + (fuori ? ' · fuori portata' : '');
  $('lancioLinea').textContent = laFmtT(r.aLinea);
  $('lancioArr').textContent = laFmtS(r.d);
}

setInterval(() => { try{ lancioAggiorna(); }catch(e){} }, 500);
