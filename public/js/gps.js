// GPS e automatismi (spenti all'inizio, si accendono dal box).
//
// - L'auto (telefono Android) manda la sua posizione solo quando il GPS e' acceso. Sullo
//   schermo dell'auto non compare niente.
// - Il box imposta due zone con la propria posizione: BOX (raggio piccolo) e RIFORNIMENTO.
// - Auto nella zona box = "ai box"; nella zona rifornimento = "rifornimento" (anche questo
//   conta come ai box per il carburante); fuori = "in pista".
// - Una zona vale solo dopo GPS_ATTESA_MS di permanenza (per non reagire a un passaggio) e
//   i punti poco precisi si ignorano. Con segnale perso lo stato resta quello di prima.
// - Fermi nella zona rifornimento piu' a lungo della soglia (secondi, impostabile) = cambio pilota.
// - Tutto si puo' correggere a mano: i pulsanti "In pista" / "Ai box" valgono sempre, e il
//   GPS interviene solo quando la zona cambia davvero.

const GPS_ATTESA_MS = 10000;   // permanenza minima in una zona prima di cambiare stato
const GPS_ACC_MAX = 30;        // metri: oltre, il punto non si usa
const GPS_PERSO_MS = 20000;    // senza punti per tanto = segnale perso
const GPS_USCITA_EXTRA = 5;    // metri in piu' per uscire da una zona in cui si e' gia'

let gpsCfg = { on: false, box: null, refuel: null, rBox: 10, rRefuel: 25, fermoS: 60 };
let gpsUltima = null;          // ultimo punto ricevuto { lat, lng, acc, t }
let gpsUltimaBuona = 0;        // quando e' arrivato l'ultimo punto preciso
let gpsStato = null;           // 'pista' | 'box' | 'rifornimento' (confermato)
let gpsStatoDa = 0;
let gpsCandidato = null, gpsCandidatoDa = 0;
let gpsWatch = null;           // auto: invio della posizione
let gpsInvioUltimo = 0;
let gpsCambio = load('pc_gps_cambio', { n: 0, da: null }); // cambi pilota registrati e inizio turno
let gpsCambioFatto = false;    // alla domanda di questa sosta si e' gia' risposto
let gpsChiede = false;         // la domanda "era un cambio pilota?" e' sul box

function gpsApplica(){ try{ return localStorage.getItem('pc_gps_applica') === '1'; }catch(e){ return false; } }

function gpsDistanza(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- configurazione (condivisa dalla squadra) ----------

function gpsApplicaConfig(c){
  if(!c || typeof c !== 'object') return;
  gpsCfg = { ...gpsCfg, ...c };
  if(!gpsCfg.on){ gpsStato = null; gpsCandidato = null; gpsCambioFatto = false; gpsChiede = false; }
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
  const deveInviare = role === 'auto' && gpsCfg.on && navigator.geolocation;
  if(deveInviare && gpsWatch === null){
    gpsWatch = navigator.geolocation.watchPosition((pos) => {
      const ora = Date.now();
      if(ora - gpsInvioUltimo < 1000) return;
      gpsInvioUltimo = ora;
      if(socket && socket.connected){
        socket.emit('gpsPos', { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
      }
    }, () => { /* nessun permesso o nessun segnale: si riprova da soli */ },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  } else if(!deveInviare && gpsWatch !== null){
    navigator.geolocation.clearWatch(gpsWatch);
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

let gpsCancellaPronto = false;
function gpsCancellaZone(btn){
  if(!gpsCancellaPronto){
    gpsCancellaPronto = true;
    btn.textContent = 'Sicuro?';
    setTimeout(() => { gpsCancellaPronto = false; btn.textContent = 'Cancella le zone'; }, 3000);
    return;
  }
  gpsCancellaPronto = false;
  btn.textContent = 'Cancella le zone';
  gpsInvia({ box: null, refuel: null });
}

// ---------- box: riceve la posizione e decide ----------

function gpsZonaDi(p){
  const dB = gpsCfg.box ? gpsDistanza(p, gpsCfg.box) : Infinity;
  const dR = gpsCfg.refuel ? gpsDistanza(p, gpsCfg.refuel) : Infinity;
  // chi e' gia' in una zona ne esce solo un po' piu' in la', cosi' il bordo non fa lampeggiare lo stato
  const rB = gpsCfg.rBox + (gpsStato === 'box' ? GPS_USCITA_EXTRA : 0);
  const rR = gpsCfg.rRefuel + (gpsStato === 'rifornimento' ? GPS_USCITA_EXTRA : 0);
  if(dB <= rB) return 'box';
  if(dR <= rR) return 'rifornimento';
  return 'pista';
}

function gpsRicevi(p){
  if(role !== 'box' || !gpsCfg.on || !p) return;
  gpsUltima = p;
  if(p.acc != null && p.acc > GPS_ACC_MAX) return;
  if(!gpsCfg.box && !gpsCfg.refuel) return; // senza zone non si decide niente
  gpsUltimaBuona = Date.now();
  const cand = gpsZonaDi(p);
  const ora = Date.now();
  if(cand !== gpsCandidato){ gpsCandidato = cand; gpsCandidatoDa = ora; }
  if(cand !== gpsStato && ora - gpsCandidatoDa >= GPS_ATTESA_MS) gpsCambiaStato(cand);
  gpsControllaFermo();
  gpsRender();
}

function gpsCambiaStato(nuovo){
  const prima = gpsStato;
  gpsStato = nuovo;
  gpsStatoDa = Date.now();
  gpsCambioFatto = false;
  gpsChiede = false;
  if(nuovo === 'pista' && !gpsCambio.da){ gpsCambio.da = Date.now(); save('pc_gps_cambio', gpsCambio); }
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

// ---------- cambio pilota: fermi nella zona rifornimento oltre la soglia ----------

// Superata la soglia non registra da solo: sul box compare la domanda "era un cambio pilota?".
function gpsControllaFermo(){
  if(gpsStato !== 'rifornimento' || gpsCambioFatto || gpsChiede) return;
  if((Date.now() - gpsStatoDa) / 1000 >= gpsCfg.fermoS){
    gpsChiede = true;
    try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
  }
}

function gpsRispostaCambio(si){
  gpsChiede = false;
  gpsCambioFatto = true; // una sola domanda per ogni sosta
  if(si) gpsRegistraCambio();
  gpsRender();
}

function gpsRegistraCambio(){
  gpsCambioFatto = true;
  gpsCambio = { n: (gpsCambio.n || 0) + 1, da: Date.now() };
  save('pc_gps_cambio', gpsCambio);
  gpsRender();
}

function gpsAzzeraCambi(){
  gpsCambio = { n: 0, da: null };
  save('pc_gps_cambio', gpsCambio);
  gpsRender();
}

// ---------- schermo del box ----------

function gpsMinSec(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function gpsRiga(){
  if(!gpsCfg.on) return '';
  const ora = Date.now();
  const nomi = { pista: 'in pista', box: 'ai box', rifornimento: 'rifornimento' };
  let t = 'GPS: ';
  if(!gpsCfg.box && !gpsCfg.refuel) return t + 'imposta le zone';
  if(!gpsUltima || ora - gpsUltimaBuona > GPS_PERSO_MS){
    t += gpsUltima ? 'segnale perso da ' + gpsMinSec(ora - gpsUltimaBuona) : 'in attesa dell’auto';
    if(gpsStato) t += ' · ultimo: ' + nomi[gpsStato];
  } else {
    t += gpsStato ? nomi[gpsStato] + ' da ' + gpsMinSec(ora - gpsStatoDa) : 'sto controllando…';
    if(gpsUltima.acc != null) t += ' · ±' + Math.round(gpsUltima.acc) + ' m';
  }
  if(gpsCambio.da) t += ' · turno pilota ' + gpsMinSec(ora - gpsCambio.da) + (gpsCambio.n ? ' (cambi: ' + gpsCambio.n + ')' : '');
  return t;
}

function gpsRender(){
  if(role !== 'box') return;
  const dom = $('gpsDomanda');
  if(dom){
    dom.hidden = !(gpsCfg.on && gpsChiede && gpsStato === 'rifornimento');
    if(!dom.hidden && $('gpsDomandaTesto')) $('gpsDomandaTesto').textContent = 'Fermi da ' + gpsMinSec(Date.now() - gpsStatoDa) + ' al rifornimento: era un cambio pilota?';
  }
  const riga = $('gpsRiga');
  if(riga){ riga.textContent = gpsRiga(); riga.hidden = !gpsCfg.on; }
  if($('gpsOn')) $('gpsOn').checked = !!gpsCfg.on;
  if($('gpsApplica')) $('gpsApplica').checked = gpsApplica();
  const f = (id, v) => { const e = $(id); if(e && document.activeElement !== e) e.value = v; };
  f('gpsRBox', gpsCfg.rBox); f('gpsRRefuel', gpsCfg.rRefuel); f('gpsFermoS', gpsCfg.fermoS);
  if($('gpsZone')) $('gpsZone').textContent = 'Zona box: ' + (gpsCfg.box ? 'impostata' : 'non impostata') + ' · Zona rifornimento: ' + (gpsCfg.refuel ? 'impostata' : 'non impostata');
}

setInterval(() => {
  if(role !== 'box' || !gpsCfg.on) return;
  gpsControllaFermo();
  gpsRender();
}, 1000);
