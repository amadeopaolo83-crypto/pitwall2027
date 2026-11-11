// Mappa del box (Leaflet, immagini satellitari Esri o mappa OpenStreetMap, nessuna chiave).
//
// - "Auto": dove si trova l'auto in gara (punto, scia, velocita'), con le zone disegnate.
// - "Box" / "Rifornim." / "Corsia": si disegnano le zone toccando la mappa (o aggiungendo il punto in
//   cui ci si trova con il telefono). Si trascinano i punti per correggerli, poi Salva.
//
// - "Traguardo": la linea virtuale (due estremi da trascinare) usata dalla fascia di lancio.
// - "Sposta": porta in blocco tutte le zone (box, rifornimento, corsia, traguardo) di qualche metro se
//   l'immagine satellitare e' leggermente sfalsata rispetto al GPS.
// - "Tracciato": la linea della pista (giro chiuso): si toccano i punti lungo il circuito sul satellite, oppure si
//   registra girando con il telefono. Serve al simulatore (public/sim.html) e a chi vuole vedere la pista.
// - "Calibra": allinea le zone disegnate sul satellite al GPS vero. Ci si mette in un punto riconoscibile dal
//   satellite, si tocca la mappa dove si e' e si misura il GPS per 20 s. Servono 3 punti lontani almeno 300 m
//   (il cerchio e' rosso finche' si e' troppo vicini): lo spostamento medio si applica a tutte le zone.
// - "Circuito": salva tutto in un file (da preparare dal PC) e lo ricarica in un'altra stanza.
//   Il giro di riferimento registrato dall'auto compare in azzurro.
//
// La libreria si scarica solo alla prima apertura. Serve solo al box: sull'auto non compare niente.

const MP_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const MP_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const mp = {
  aperta: false, mappa: null, pronta: null,
  modo: 'auto',          // 'auto' | 'box' | 'rifornimento' | 'corsia' | 'traguardo' | 'tracciato' | 'calibra' | 'sposta' | 'circuito'
  off: { dx: 0, dy: 0 }, passo: 2, // sposta tutto: metri verso est e verso nord, passo dei pulsanti
  segui: true,
  sat: true,
  zone: null,            // gruppo con le zone salvate
  lavoro: null,          // gruppo con il disegno in modifica
  auto: null,            // { marker, cerchio, scia }
  mio: null,             // { lat, lng, acc } del telefono del box
  mioMarker: null, mioWatch: null,
  ed: null,              // { pts: [], box: {lat,lng}|null } disegno in modifica
  reg: false,            // registrazione camminando (corsia, tracciato)
  cal: null,             // calibrazione: { punti:[{gps,tap,dx,dy}], mis, gps, tap, media, tick }
  errTile: 0, okTile: 0,
  tSat: null, tOsm: null,
};

function mpCarica(){
  if(mp.pronta) return mp.pronta;
  mp.pronta = new Promise((ok, no) => {
    if(window.L && window.L.map) return ok();
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css?v=1';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'vendor/leaflet/leaflet.js?v=1';
    js.onload = () => ok();
    js.onerror = () => { mp.pronta = null; no(new Error('libreria non caricata')); };
    document.head.appendChild(js);
  });
  return mp.pronta;
}

function mappaApri(modo){
  if(role !== 'box') return;
  const el = $('mappaGps');
  if(!el) return;
  el.hidden = false;
  mp.aperta = true;
  document.body.classList.add('mp-aperta');
  try{ history.pushState({ mappa: 1 }, ''); }catch(e){}
  $('mpInfo').textContent = 'Carico la mappa…';
  mpCarica().then(() => {
    if(!mp.mappa) mpCrea();
    mp.mappa.invalidateSize();
    mpVaiA(modo || 'auto');
    mpAvviaMioGps();
    mpVistaIniziale();
  }).catch(() => { $('mpInfo').textContent = 'Mappa non disponibile: serve internet.'; });
}

function mappaChiudi(daIndietro){
  const el = $('mappaGps');
  if(!el || !mp.aperta) return;
  el.hidden = true;
  mp.aperta = false;
  document.body.classList.remove('mp-aperta');
  mpFermaMioGps();
  mpCalFerma();
  mp.reg = false;
  mp.ed = null;
  if(!daIndietro){ try{ if(history.state && history.state.mappa) history.back(); }catch(e){} }
}
window.addEventListener('popstate', () => { if(mp.aperta) mappaChiudi(true); });

function mpCrea(){
  mp.mappa = L.map('mpCanvas', { zoomControl: true, maxZoom: 21, minZoom: 2, tap: true }).setView([45.0, 9.0], 5);
  mp.mappa.attributionControl.setPrefix(false);
  const opz = (att) => ({ maxZoom: 21, maxNativeZoom: 19, attribution: att });
  mp.tSat = L.tileLayer(MP_SAT, opz('Immagini: Esri, Maxar, Earthstar Geographics'));
  mp.tOsm = L.tileLayer(MP_OSM, opz('© OpenStreetMap'));
  [mp.tSat, mp.tOsm].forEach((t) => {
    t.on('tileload', () => { mp.okTile++; });
    t.on('tileerror', () => {
      mp.errTile++;
      if(mp.errTile >= 6 && !mp.okTile && mp.aperta) $('mpInfo').textContent = 'Le immagini della mappa non arrivano: serve internet.';
    });
  });
  try{ mp.sat = localStorage.getItem('pc_mappa_sat') !== '0'; }catch(e){}
  (mp.sat ? mp.tSat : mp.tOsm).addTo(mp.mappa);
  mpAggiornaSfondoBtn();
  mp.zone = L.layerGroup().addTo(mp.mappa);
  mp.lavoro = L.layerGroup().addTo(mp.mappa);
  mp.mappa.on('click', (e) => mpClick(e.latlng));
  mp.mappa.on('dragstart', () => { if(mp.modo === 'auto' && mp.segui){ mp.segui = false; mpPannello(); } });
  mpDisegnaZone();
}

function mappaCambiaSfondo(){
  if(!mp.mappa) return;
  mp.sat = !mp.sat;
  try{ localStorage.setItem('pc_mappa_sat', mp.sat ? '1' : '0'); }catch(e){}
  mp.mappa.removeLayer(mp.sat ? mp.tOsm : mp.tSat);
  (mp.sat ? mp.tSat : mp.tOsm).addTo(mp.mappa);
  mpAggiornaSfondoBtn();
}
function mpAggiornaSfondoBtn(){ const b = $('mpSfondo'); if(b) b.textContent = mp.sat ? 'Mappa' : 'Satellite'; }

// ---------- il telefono del box: punto blu (serve per "aggiungi il mio punto") ----------

function mpAvviaMioGps(){
  if(mp.mioWatch !== null || !navigator.geolocation) return;
  mp.mioWatch = navigator.geolocation.watchPosition((pos) => {
    mp.mio = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    if(mp.mappa){
      if(!mp.mioMarker){
        mp.mioMarker = L.circleMarker([mp.mio.lat, mp.mio.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2f8cff', fillOpacity: 1, interactive: false }).addTo(mp.mappa);
      } else mp.mioMarker.setLatLng([mp.mio.lat, mp.mio.lng]);
    }
    if(mp.reg && mp.ed && pos.coords.accuracy <= 15){
      const q = { lat: mp.mio.lat, lng: mp.mio.lng }, u = mp.ed.pts[mp.ed.pts.length - 1];
      if(!u || gpsDistanza(u, q) >= (mp.modo === 'tracciato' ? MP_PASSO_TRACCIATO_M : GPS_PASSO_REG_M)){ mp.ed.pts.push(q); mpDisegnaLavoro(); mpPannello(); }
    }
    if(mp.cal && mp.cal.mis && pos.coords.accuracy <= MP_CAL_ACC_M) mp.cal.mis.campioni.push({ lat: mp.mio.lat, lng: mp.mio.lng, acc: pos.coords.accuracy });
    if(mp.modo === 'calibra'){ mpCalCerchi(); mpPannello(); }
    mpInfoAggiorna();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function mpFermaMioGps(){
  if(mp.mioWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(mp.mioWatch);
  mp.mioWatch = null;
  if(mp.mioMarker && mp.mappa){ mp.mappa.removeLayer(mp.mioMarker); }
  mp.mioMarker = null;
}

function mappaCentraSuDiMe(){
  if(mp.mio && mp.mappa) mp.mappa.setView([mp.mio.lat, mp.mio.lng], Math.max(mp.mappa.getZoom(), 18));
  else $('mpInfo').textContent = 'Non ho ancora la posizione di questo telefono.';
}

// ---------- vista iniziale ----------

function mpVistaIniziale(){
  const pts = [];
  if(gpsUltima) pts.push([gpsUltima.lat, gpsUltima.lng]);
  if(gpsCfg.box) pts.push([gpsCfg.box.lat, gpsCfg.box.lng]);
  if(gpsCfg.refuelPoly) gpsCfg.refuelPoly.forEach((q) => pts.push([q.lat, q.lng])); else if(gpsCfg.refuel) pts.push([gpsCfg.refuel.lat, gpsCfg.refuel.lng]);
  if(gpsCfg.corsia) gpsCfg.corsia.forEach((q) => pts.push([q.lat, q.lng]));
  if(gpsCfg.traguardo) gpsCfg.traguardo.forEach((q) => pts.push([q.lat, q.lng]));
  if(pts.length > 1) mp.mappa.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 19 });
  else if(pts.length === 1) mp.mappa.setView(pts[0], 18);
  else if(mp.mio) mp.mappa.setView([mp.mio.lat, mp.mio.lng], 18);
  else if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition((p) => { if(mp.aperta && mp.mappa && !gpsUltima) mp.mappa.setView([p.coords.latitude, p.coords.longitude], 17); }, () => {}, { timeout: 8000 });
  }
}

// ---------- zone salvate ----------

const MP_PASSO_TRACCIATO_M = 15;   // registrando il tracciato girando: un punto ogni tanti metri
const MP_COL = { box: '#ff8a00', rif: '#2ecc71', cor: '#35d0ff', tra: '#ff4fd8', gir: '#6aa7ff', trk: '#f2f2f2', cal: '#b388ff' };

function mpEtichetta(layer, testo){
  layer.bindTooltip(testo, { permanent: true, direction: 'center', className: 'mp-et' });
}

// Metri -> gradi attorno a un punto.
function mpSposta(q, dx, dy){
  return { lat: q.lat + dy / 111320, lng: q.lng + dx / (111320 * Math.cos(q.lat * Math.PI / 180)) };
}
// Lo spostamento in blocco in corso: quello di "Sposta" o la media della calibrazione (anteprima).
function mpOffAttivo(){
  if(mp.modo === 'sposta' && (mp.off.dx || mp.off.dy)) return mp.off;
  if(mp.modo === 'calibra' && mp.cal && mp.cal.media) return mp.cal.media;
  return null;
}
// Le zone come sarebbero dopo lo spostamento in blocco (se non si sta spostando, quelle vere).
function mpCfgVista(){
  const o = mpOffAttivo();
  if(!o) return gpsCfg;
  const m = (q) => (q ? mpSposta(q, o.dx, o.dy) : q);
  return { ...gpsCfg, box: m(gpsCfg.box), refuel: m(gpsCfg.refuel), refuelPoly: gpsCfg.refuelPoly ? gpsCfg.refuelPoly.map(m) : null,
    corsia: gpsCfg.corsia ? gpsCfg.corsia.map(m) : null, traguardo: gpsCfg.traguardo ? gpsCfg.traguardo.map(m) : null,
    tracciato: gpsCfg.tracciato ? gpsCfg.tracciato.map(m) : null };
}

function mpDisegnaZone(){
  if(!mp.mappa) return;
  mp.zone.clearLayers();
  const ed = mp.ed ? mp.modo : null;
  const C = mpCfgVista();
  // giro di riferimento (registrato dall'auto con il GPS): serve a controllare che le zone coincidano
  const rifG = gpsCfg.giroRif;
  if(rifG && rifG.p) L.polyline(rifG.p.map((q) => [q[0], q[1]]), { color: MP_COL.gir, weight: 2, opacity: .8, dashArray: '2 5', interactive: false }).addTo(mp.zone);
  if(C.tracciato && ed !== 'tracciato'){
    const ll = C.tracciato.map((q) => [q.lat, q.lng]); ll.push(ll[0]);
    L.polyline(ll, { color: MP_COL.trk, weight: 2, opacity: .85, dashArray: '8 5', interactive: false }).addTo(mp.zone);
  }
  if(C.box && ed !== 'box'){
    const c = L.circle([C.box.lat, C.box.lng], { radius: gpsCfg.rBox, color: MP_COL.box, weight: 2, fillOpacity: .2, interactive: false }).addTo(mp.zone);
    mpEtichetta(c, 'BOX');
  }
  if(ed !== 'rifornimento'){
    if(C.refuelPoly){
      const p = L.polygon(C.refuelPoly.map((q) => [q.lat, q.lng]), { color: MP_COL.rif, weight: 2, fillOpacity: .22, interactive: false }).addTo(mp.zone);
      mpEtichetta(p, 'RIFORNIMENTO');
    } else if(C.refuel){
      const c = L.circle([C.refuel.lat, C.refuel.lng], { radius: gpsCfg.rRefuel, color: MP_COL.rif, weight: 2, dashArray: '6 4', fillOpacity: .15, interactive: false }).addTo(mp.zone);
      mpEtichetta(c, 'RIFORNIMENTO');
    }
  }
  if(C.corsia && ed !== 'corsia'){
    L.polyline(C.corsia.map((q) => [q.lat, q.lng]), { color: MP_COL.cor, weight: 4, opacity: .9, interactive: false }).addTo(mp.zone);
  }
  if(C.traguardo && ed !== 'traguardo'){
    const l = L.polyline(C.traguardo.map((q) => [q.lat, q.lng]), { color: MP_COL.tra, weight: 5, opacity: .95, interactive: false }).addTo(mp.zone);
    mpEtichetta(l, 'TRAGUARDO');
  }
}

function mappaConfigCambiata(){
  if(!mp.mappa) return;
  mpDisegnaZone();
  if(mp.aperta) mpPannello();
}

// ---------- modi e disegno ----------

function mpVaiA(modo){
  mp.modo = modo;
  mp.reg = false;
  mp.ed = null;
  if(modo === 'box') mp.ed = { pts: [], box: gpsCfg.box ? { ...gpsCfg.box } : null };
  if(modo === 'rifornimento') mp.ed = { pts: gpsCfg.refuelPoly ? gpsCfg.refuelPoly.map((q) => ({ ...q })) : [], box: null };
  if(modo === 'corsia') mp.ed = { pts: gpsCfg.corsia ? gpsCfg.corsia.map((q) => ({ ...q })) : [], box: null };
  if(modo === 'traguardo') mp.ed = { pts: gpsCfg.traguardo ? gpsCfg.traguardo.map((q) => ({ ...q })) : [], box: null };
  if(modo === 'tracciato') mp.ed = { pts: gpsCfg.tracciato ? gpsCfg.tracciato.map((q) => ({ ...q })) : [], box: null };
  mpCalFerma();
  if(modo === 'calibra'){ mp.cal = { punti: [], mis: null, gps: null, tap: null, media: null, tick: null, msg: '' }; mpAvviaMioGps(); }
  if(modo === 'sposta') mp.off = { dx: 0, dy: 0 };
  document.querySelectorAll('#mpModi .tab').forEach((b) => b.classList.toggle('on', b.dataset.modo === modo));
  mpDisegnaZone();
  mpDisegnaLavoro();
  mpPannello();
  const nomiModo = { box: 'Zona box', rifornimento: 'Area di rifornimento', corsia: 'Corsia box', traguardo: 'Traguardo virtuale', tracciato: 'Tracciato della pista', calibra: 'Calibra con il GPS', sposta: 'Sposta tutto', circuito: 'Circuito' };
  if(modo !== 'auto') $('mpInfo').textContent = 'Modifica: ' + nomiModo[modo];
  mpInfoAggiorna();
}

function mpPuntoIcona(){ return L.divIcon({ className: 'mp-pt', html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 13] }); }

function mpDisegnaLavoro(){
  if(!mp.mappa) return;
  mp.lavoro.clearLayers();
  mp.linea = null;
  if(mp.modo === 'calibra'){ mpCalDisegna(); return; }
  if(!mp.ed) return;
  const ed = mp.ed;
  if(mp.modo === 'box'){
    if(ed.box){
      L.circle([ed.box.lat, ed.box.lng], { radius: gpsCfg.rBox, color: MP_COL.box, weight: 2, fillOpacity: .25, interactive: false }).addTo(mp.lavoro);
      const m = L.marker([ed.box.lat, ed.box.lng], { icon: mpPuntoIcona(), draggable: true }).addTo(mp.lavoro);
      m.on('drag', (e) => { ed.box = { lat: e.latlng.lat, lng: e.latlng.lng }; });
      m.on('dragend', () => mpDisegnaLavoro());
    }
    return;
  }
  const ll = ed.pts.map((q) => [q.lat, q.lng]);
  if(mp.modo === 'rifornimento' && ll.length >= 2){
    (ll.length >= 3 ? L.polygon(ll, { color: MP_COL.rif, weight: 2, fillOpacity: .25, interactive: false })
                    : L.polyline(ll, { color: MP_COL.rif, weight: 2, interactive: false })).addTo(mp.lavoro);
  }
  if(mp.modo === 'corsia' && ll.length >= 2) L.polyline(ll, { color: MP_COL.cor, weight: 4, interactive: false }).addTo(mp.lavoro);
  if(mp.modo === 'traguardo' && ll.length >= 2) L.polyline(ll, { color: MP_COL.tra, weight: 5, interactive: false }).addTo(mp.lavoro);
  if(mp.modo === 'tracciato' && ll.length >= 2) L.polyline(ll.length >= 3 ? ll.concat([ll[0]]) : ll, { color: MP_COL.trk, weight: 3, interactive: false }).addTo(mp.lavoro);
  ed.pts.forEach((q, i) => {
    const m = L.marker([q.lat, q.lng], { icon: mpPuntoIcona(), draggable: true }).addTo(mp.lavoro);
    m.on('drag', (e) => { q.lat = e.latlng.lat; q.lng = e.latlng.lng; mpRidisegnaLinea(); });
    m.on('dragend', () => mpPannello());
  });
}

// Durante il trascinamento si ridisegna solo la linea, non i punti (altrimenti si perde il dito).
function mpRidisegnaLinea(){
  if(!mp.ed) return;
  if(mp.linea) mp.lavoro.removeLayer(mp.linea);
  const ll = mp.ed.pts.map((q) => [q.lat, q.lng]);
  if(ll.length < 2){ mp.linea = null; return; }
  const col = mp.modo === 'corsia' ? MP_COL.cor : mp.modo === 'traguardo' ? MP_COL.tra : mp.modo === 'tracciato' ? MP_COL.trk : MP_COL.rif;
  if(mp.modo === 'tracciato' && ll.length >= 3) ll.push(ll[0]);
  mp.linea = (mp.modo === 'rifornimento' && ll.length >= 3 ? L.polygon(ll, { color: col, weight: 2, fillOpacity: .25, interactive: false })
                                                           : L.polyline(ll, { color: col, weight: mp.modo === 'corsia' ? 4 : mp.modo === 'traguardo' ? 5 : 2, interactive: false })).addTo(mp.lavoro);
}

function mpClick(ll){
  if(mp.modo === 'calibra' && mp.cal){ mp.cal.tap = { lat: ll.lat, lng: ll.lng }; mpDisegnaLavoro(); mpPannello(); return; }
  if(!mp.ed || mp.modo === 'auto') return;
  if(mp.modo === 'box') mp.ed.box = { lat: ll.lat, lng: ll.lng };
  else if(mp.modo === 'traguardo'){
    if(mp.ed.pts.length >= 2){ $('mpInfo').textContent = 'Il traguardo ha due estremi: trascinali per spostarli, oppure Svuota.'; return; }
    mp.ed.pts.push({ lat: ll.lat, lng: ll.lng });
  } else mp.ed.pts.push({ lat: ll.lat, lng: ll.lng });
  mpDisegnaLavoro();
  mpPannello();
}

function mpAggiungiMio(){
  if(!mp.ed || !mp.mio){ $('mpInfo').textContent = 'Non ho ancora la posizione di questo telefono.'; return; }
  if(mp.mio.acc > 25){ $('mpInfo').textContent = 'Precisione scarsa (±' + Math.round(mp.mio.acc) + ' m): aspetta qualche secondo.'; return; }
  if(mp.modo === 'box') mp.ed.box = { lat: mp.mio.lat, lng: mp.mio.lng };
  else if(mp.modo === 'traguardo' && mp.ed.pts.length >= 2){ $('mpInfo').textContent = 'Il traguardo ha gia\u2019 due estremi.'; return; }
  else mp.ed.pts.push({ lat: mp.mio.lat, lng: mp.mio.lng });
  mpDisegnaLavoro();
  mpPannello();
}

function mpAnnullaUltimo(){ if(mp.ed && mp.ed.pts.length){ mp.ed.pts.pop(); mpDisegnaLavoro(); mpPannello(); } }
function mpSvuota(){ if(mp.ed){ mp.ed.pts = []; mp.ed.box = null; mp.reg = false; mpDisegnaLavoro(); mpPannello(); } }
function mpRegistraCamminando(){ mp.reg = !mp.reg; mpPannello(); }
function mpSegui(){ mp.segui = !mp.segui; if(mp.segui) mpCentraAuto(true); mpPannello(); }

function mpSalva(){
  if(!mp.ed) return;
  const ed = mp.ed;
  if(mp.modo === 'box'){
    if(!ed.box) return;
    gpsInvia({ box: ed.box });
  } else if(mp.modo === 'rifornimento'){
    if(ed.pts.length < 3) return;
    gpsInvia({ refuelPoly: ed.pts.map((q) => ({ lat: q.lat, lng: q.lng })) });
  } else if(mp.modo === 'corsia'){
    if(ed.pts.length < 2) return;
    gpsInvia({ corsia: ed.pts.map((q) => ({ lat: q.lat, lng: q.lng })) });
  } else if(mp.modo === 'tracciato'){
    if(ed.pts.length < 8){ $('mpInfo').textContent = 'Servono almeno 8 punti lungo la pista (ora ' + ed.pts.length + ').'; return; }
    if(ed.pts.length > 500){ $('mpInfo').textContent = 'Troppi punti (massimo 500): togline qualcuno.'; return; }
    gpsInvia({ tracciato: ed.pts.map((q) => ({ lat: q.lat, lng: q.lng })) });
  } else if(mp.modo === 'traguardo'){
    if(ed.pts.length !== 2) return;
    const m = gpsDistanza(ed.pts[0], ed.pts[1]);
    if(m < 3 || m > 400){ $('mpInfo').textContent = 'Il traguardo deve essere lungo da 3 a 400 metri (ora ' + Math.round(m) + ' m).'; return; }
    gpsInvia({ traguardo: ed.pts.map((q) => ({ lat: q.lat, lng: q.lng })) });
  }
  $('mpInfo').textContent = 'Salvato.';
  mpVaiA('auto');
}

function mpEsciSenzaSalvare(){ mpVaiA('auto'); }

function mpRimuoviZona(){
  if(mp.modo === 'box') gpsInvia({ box: null });
  else if(mp.modo === 'rifornimento') gpsInvia({ refuelPoly: null, refuel: null });
  else if(mp.modo === 'corsia') gpsInvia({ corsia: null });
  else if(mp.modo === 'traguardo') gpsInvia({ traguardo: null });
  else if(mp.modo === 'tracciato') gpsInvia({ tracciato: null });
  mpVaiA('auto');
}

function mpRaggio(el){
  const v = Number(String(el.value).replace(',', '.'));
  if(!Number.isFinite(v) || v < 3 || v > 200) return;
  gpsInvia({ rBox: v });
  gpsCfg.rBox = v; mpDisegnaLavoro();
}

// ---------- sposta tutto ----------

function mpMuovi(sx, sy, azzera){
  if(azzera){ mp.off = { dx: 0, dy: 0 }; } else { mp.off.dx = Math.round((mp.off.dx + sx * mp.passo) * 10) / 10; mp.off.dy = Math.round((mp.off.dy + sy * mp.passo) * 10) / 10; }
  mpDisegnaZone(); mpPannello();
}
function mpPasso(){ const v = [0.5, 2, 10]; mp.passo = v[(v.indexOf(mp.passo) + 1) % v.length]; mpPannello(); }
function mpApplicaSposta(extra){
  const { dx, dy } = mp.off;
  if(!dx && !dy) return;
  const m = (q) => mpSposta(q, dx, dy);
  const parte = {};
  if(gpsCfg.box) parte.box = m(gpsCfg.box);
  if(gpsCfg.refuel) parte.refuel = m(gpsCfg.refuel);
  if(gpsCfg.refuelPoly) parte.refuelPoly = gpsCfg.refuelPoly.map(m);
  if(gpsCfg.corsia) parte.corsia = gpsCfg.corsia.map(m);
  if(gpsCfg.traguardo) parte.traguardo = gpsCfg.traguardo.map(m);
  if(gpsCfg.tracciato) parte.tracciato = gpsCfg.tracciato.map(m);
  if(extra) Object.assign(parte, extra);
  gpsInvia(parte);
  mp.off = { dx: 0, dy: 0 };
  $('mpInfo').textContent = 'Zone spostate.';
  mpVaiA('auto');
}

// ---------- circuito: file da preparare dal PC ----------

const MP_CIRCUITO_CAMPI = ['box', 'refuel', 'refuelPoly', 'rBox', 'rRefuel', 'corsia', 'larg', 'fermoS', 'traguardo', 'giroRif', 'lancioS', 'tracciato', 'limiteKmh', 'allineamento'];

function mpCircuitoJson(){
  const gps = {};
  MP_CIRCUITO_CAMPI.forEach((k) => { if(gpsCfg[k] !== undefined) gps[k] = gpsCfg[k]; });
  return JSON.stringify({ tipo: 'pitcomm-circuito', versione: 1, creato: new Date().toISOString(), gps });
}
function mpCircuitoSalva(){
  const nome = 'circuito-' + String(code || 'squadra').replace(/[^A-Za-z0-9_-]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  try{
    const url = URL.createObjectURL(new Blob([mpCircuitoJson()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('mpInfo').textContent = 'File ' + nome + ' pronto (se non parte il download usa "Copia come testo").';
  }catch(e){ mpCircuitoCopia(); }
}
function mpCircuitoCopia(){
  const t = mpCircuitoJson();
  const area = $('mpTesto');
  if(area){ area.value = t; }
  const fallback = () => { if(area){ area.focus(); area.select(); } $('mpInfo').textContent = 'Testo del circuito qui sotto: selezionalo e copialo.'; };
  try{ navigator.clipboard.writeText(t).then(() => { $('mpInfo').textContent = 'Circuito copiato.'; }, fallback); }catch(e){ fallback(); }
}
function mpCircuitoCarica(testo){
  const et = $('mpInfo');
  let d;
  try{ d = JSON.parse(testo); }catch(e){ et.textContent = 'Il file non e\u2019 un circuito valido.'; return false; }
  if(!d || d.tipo !== 'pitcomm-circuito' || !d.gps || typeof d.gps !== 'object'){ et.textContent = 'Il file non e\u2019 un circuito di PitComm.'; return false; }
  const parte = {};
  MP_CIRCUITO_CAMPI.forEach((k) => { if(d.gps[k] !== undefined) parte[k] = d.gps[k]; });
  const voci = ['box', 'refuelPoly', 'corsia', 'traguardo', 'giroRif', 'tracciato'].filter((k) => parte[k]).length;
  if(!Object.keys(parte).length){ et.textContent = 'Il circuito e\u2019 vuoto.'; return false; }
  gpsInvia(parte);
  et.textContent = 'Circuito caricato (' + voci + ' elementi). Controlla sulla mappa e correggi con Sposta.';
  mpVaiA('auto');
  mpVistaIniziale();
  return true;
}
function mpCircuitoCaricaTesto(){ const a = $('mpTesto'); if(a && a.value.trim()) mpCircuitoCarica(a.value); }
function mpCircuitoDaFile(inp){
  const f = inp.files && inp.files[0];
  inp.value = '';
  if(!f) return;
  if(f.size > 2e6){ $('mpInfo').textContent = 'File troppo grande per essere un circuito.'; return; }
  const r = new FileReader();
  r.onload = () => mpCircuitoCarica(String(r.result || ''));
  r.readAsText(f);
}

// ---------- calibra: allinea le zone disegnate sul satellite al GPS vero ----------
// Ci si mette in un punto che si riconosce dal satellite, si tocca la mappa dove si e' e si misura il GPS per 20 s.
// Lo scarto tra GPS (vero) e tocco (satellite) e' lo spostamento da dare alle zone. Con piu' punti lontani si fa
// la media e si vede quanto i punti concordano. Si corregge solo lo spostamento (niente rotazione): a 100 m di
// distanza un tocco sbagliato di 3 m sembrerebbe una rotazione e peggiorerebbe le zone lontane.

const MP_CAL_SEC = 20;          // secondi di media del GPS per ogni punto
const MP_CAL_DIST_M = 300;      // distanza minima tra due punti (il cerchio e' rosso finche' si e' piu' vicini)
const MP_CAL_ACC_M = 25;        // i punti GPS meno precisi non entrano nella media
const MP_CAL_MIN_CAMPIONI = 8;
const MP_CAL_SCARTO_MAX = 4;    // metri: oltre, i punti non concordano

// Spostamento in metri (est, nord) da dare al disegno per portarlo sulla posizione vera.
function mpCalcolaOffset(tap, gps){
  return { dx: (gps.lng - tap.lng) * 111320 * Math.cos(tap.lat * Math.PI / 180), dy: (gps.lat - tap.lat) * 111320 };
}

// Media di piu' punti e scarto: quanto il punto peggiore si allontana dalla media (metri).
function mpCalMedia(punti){
  if(!punti.length) return null;
  const dx = punti.reduce((a, q) => a + q.dx, 0) / punti.length, dy = punti.reduce((a, q) => a + q.dy, 0) / punti.length;
  punti.forEach((q) => { q.res = Math.hypot(q.dx - dx, q.dy - dy); });
  return { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, n: punti.length, scarto: punti.length > 1 ? Math.max(...punti.map((q) => q.res)) : null };
}

// Posizione media (pesata sulla precisione) dei punti GPS raccolti, e quanto si sono sparpagliati.
function mpCalMediaGps(campioni){
  let sw = 0, la = 0, ln = 0, ac = 0;
  campioni.forEach((c) => { const w = 1 / Math.max(c.acc, 2) ** 2; sw += w; la += c.lat * w; ln += c.lng * w; ac += c.acc; });
  const m = { lat: la / sw, lng: ln / sw, acc: ac / campioni.length, n: campioni.length };
  const q = campioni.reduce((a, c) => a + gpsDistanza(m, c) ** 2, 0);
  m.spread = Math.sqrt(q / campioni.length);
  return m;
}

function mpCalFerma(){
  if(mp.cal && mp.cal.tick) clearInterval(mp.cal.tick);
  mp.cal = null;
}

function mpCalVicino(){
  if(!mp.cal || !mp.mio || !mp.cal.punti.length) return Infinity;
  return Math.min(...mp.cal.punti.map((q) => gpsDistanza(mp.mio, q.gps)));
}

// Cerchi di 300 m attorno ai punti gia' misurati: rossi se il telefono e' dentro (troppo vicino), verdi se fuori.
function mpCalCerchi(){
  if(!mp.cal || !mp.cal.cerchi) return;
  const troppo = mpCalVicino() < MP_CAL_DIST_M;
  mp.cal.cerchi.forEach((c) => c.setStyle({ color: troppo ? '#ff3b30' : '#34c759', fillColor: troppo ? '#ff3b30' : '#34c759' }));
}

function mpCalDisegna(){
  if(!mp.cal || !mp.mappa) return;
  mp.cal.cerchi = [];
  mp.cal.punti.forEach((q, i) => {
    const c = L.circle([q.gps.lat, q.gps.lng], { radius: MP_CAL_DIST_M, weight: 2, fillOpacity: .08, interactive: false }).addTo(mp.lavoro);
    mp.cal.cerchi.push(c);
    L.circleMarker([q.gps.lat, q.gps.lng], { radius: 6, color: '#fff', weight: 2, fillColor: MP_COL.cal, fillOpacity: 1, interactive: false }).bindTooltip(String(i + 1), { permanent: true, direction: 'top', className: 'mp-et' }).addTo(mp.lavoro);
  });
  if(mp.cal.tap){
    const m = L.marker([mp.cal.tap.lat, mp.cal.tap.lng], { icon: mpPuntoIcona(), draggable: true }).addTo(mp.lavoro);
    m.on('dragend', (e) => { mp.cal.tap = { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }; mpPannello(); });
  }
  if(mp.cal.gps) L.circle([mp.cal.gps.lat, mp.cal.gps.lng], { radius: Math.max(2, mp.cal.gps.spread), color: '#2f8cff', weight: 2, fillOpacity: .2, interactive: false }).addTo(mp.lavoro);
  mpCalCerchi();
}

function mpCalMisura(){
  const c = mp.cal;
  if(!c || c.mis) return;
  if(!mp.mio){ c.msg = 'Non ho ancora la posizione di questo telefono.'; mpPannello(); return; }
  if(mpCalVicino() < MP_CAL_DIST_M){ c.msg = 'Sei troppo vicino a un punto gia’ misurato: allontanati finche’ il cerchio diventa verde.'; mpPannello(); return; }
  c.mis = { t0: Date.now(), campioni: [] }; c.gps = null; c.msg = '';
  c.tick = setInterval(mpCalTick, 500);
  mpPannello();
}
function mpCalTick(){
  const c = mp.cal;
  if(!c || !c.mis){ if(c && c.tick) clearInterval(c.tick); return; }
  if(Date.now() - c.mis.t0 >= MP_CAL_SEC * 1000) mpCalFineMisura();
  else mpPannello();
}
function mpCalFineMisura(){
  const c = mp.cal;
  clearInterval(c.tick); c.tick = null;
  const camp = c.mis.campioni; c.mis = null;
  if(camp.length < MP_CAL_MIN_CAMPIONI){ c.msg = 'Troppo pochi punti precisi (' + camp.length + '): riprova all’aperto, fermo.'; mpPannello(); return; }
  c.gps = mpCalMediaGps(camp);
  c.msg = c.tap ? '' : 'Ora tocca sulla mappa il punto in cui ti trovi.';
  mpDisegnaLavoro(); mpPannello();
}
function mpCalAnnulla(){
  const c = mp.cal; if(!c) return;
  if(c.tick) clearInterval(c.tick); c.tick = null; c.mis = null; c.gps = null; c.tap = null; c.msg = '';
  mpDisegnaLavoro(); mpPannello();
}
function mpCalConferma(){
  const c = mp.cal;
  if(!c || !c.gps || !c.tap) return;
  const o = mpCalcolaOffset(c.tap, c.gps);
  c.punti.push({ gps: c.gps, tap: c.tap, dx: o.dx, dy: o.dy });
  c.gps = null; c.tap = null; c.msg = '';
  c.media = mpCalMedia(c.punti);
  mpDisegnaZone(); mpDisegnaLavoro(); mpPannello();
}
function mpCalTogli(i){
  const c = mp.cal; if(!c) return;
  c.punti.splice(i, 1);
  c.media = mpCalMedia(c.punti);
  mpDisegnaZone(); mpDisegnaLavoro(); mpPannello();
}
function mpCalSvuota(){
  const c = mp.cal; if(!c) return;
  c.punti = []; c.media = null; c.gps = null; c.tap = null; c.msg = '';
  mpDisegnaZone(); mpDisegnaLavoro(); mpPannello();
}
function mpCalApplica(){
  const c = mp.cal;
  if(!c || !c.media) return;
  const al = { dx: c.media.dx, dy: c.media.dy, n: c.media.n, scarto: c.media.scarto, at: Date.now() };
  mp.off = { dx: c.media.dx, dy: c.media.dy };
  mpCalFerma();
  mpApplicaSposta({ allineamento: al });
}

function mpLimite(el){
  const v = Number(String(el.value).replace(',', '.'));
  if(!Number.isFinite(v) || v < 20 || v > 150) return;
  gpsInvia({ limiteKmh: v });
  gpsCfg.limiteKmh = v;
}

// ---------- pannello in basso ----------

function mpBtn(testo, onclick, classe){
  return '<button class="btn small ' + (classe || '') + '" onclick="' + onclick + '">' + testo + '</button>';
}

function mpPannello(){
  const p = $('mpPannello');
  if(!p) return;
  let h = '';
  const ed = mp.ed;
  if(mp.modo === 'auto'){
    h += '<div class="mp-righe">';
    h += mpBtn('Segui l’auto: ' + (mp.segui ? 'sì' : 'no'), 'mpSegui()');
    h += mpBtn('Centra su di me', 'mappaCentraSuDiMe()');
    if(!gpsCfg.on) h += mpBtn('Accendi il GPS', 'gpsAccendi(true)', 'primary');
    h += '</div>';
    h += '<div class="mp-aiuto">Per disegnare le zone scegli Box, Rifornim., Corsia o Traguardo in alto.' + (gpsCfg.giroRif ? ' Giro di riferimento: ' + gpsFmtGiro(gpsCfg.giroRif.t) + ' (linea azzurra).' : '') + '</div>';
  } else if(mp.modo === 'box'){
    h += '<div class="mp-aiuto">Tocca la mappa dove vuoi il centro della zona box, o trascina il punto. Raggio:</div>';
    h += '<div class="mp-righe"><input type="number" class="mp-num" min="3" max="200" step="1" value="' + gpsCfg.rBox + '" onchange="mpRaggio(this)"><span class="mono" style="font-size:12px">metri</span>';
    h += mpBtn('Metti il mio punto', 'mpAggiungiMio()');
    h += '</div><div class="mp-righe">' + mpBtn('Salva', 'mpSalva()', ed && ed.box ? 'primary' : 'mp-off') + mpBtn('Togli la zona', 'mpRimuoviZona()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'rifornimento'){
    const n = ed ? ed.pts.length : 0;
    h += '<div class="mp-aiuto">Tocca gli angoli dell’area di rifornimento, girando intorno (almeno 3). Trascina i punti per correggerli. Punti: ' + n + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Aggiungi il mio punto', 'mpAggiungiMio()') + mpBtn('Annulla ultimo', 'mpAnnullaUltimo()') + mpBtn('Svuota', 'mpSvuota()') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Salva area', 'mpSalva()', n >= 3 ? 'primary' : 'mp-off') + mpBtn('Togli l’area', 'mpRimuoviZona()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'traguardo'){
    const n = ed ? ed.pts.length : 0;
    h += '<div class="mp-aiuto">Tocca i due estremi della linea, da un lato all’altro della pista, davanti al traguardo vero. Poi trascinali per sistemarli. Estremi: ' + n + '/2' + (n === 2 ? ' · ' + Math.round(gpsDistanza(ed.pts[0], ed.pts[1])) + ' m' : '') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Metti il mio punto', 'mpAggiungiMio()') + mpBtn('Annulla ultimo', 'mpAnnullaUltimo()') + mpBtn('Svuota', 'mpSvuota()') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Salva traguardo', 'mpSalva()', n === 2 ? 'primary' : 'mp-off') + mpBtn('Togli il traguardo', 'mpRimuoviZona()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'sposta'){
    const dx = mp.off.dx, dy = mp.off.dy;
    const txt = (!dx && !dy) ? 'nessuno spostamento' : [dx ? Math.abs(dx).toFixed(1).replace('.', ',') + ' m verso ' + (dx > 0 ? 'est' : 'ovest') : '', dy ? Math.abs(dy).toFixed(1).replace('.', ',') + ' m verso ' + (dy > 0 ? 'nord' : 'sud') : ''].filter(Boolean).join(' e ');
    h += '<div class="mp-aiuto">Se le zone non coincidono con l’asfalto (il satellite puo’ essere sfalsato di qualche metro), spostale tutte insieme. La linea azzurra tratteggiata e’ il giro registrato dal GPS dell’auto. Spostamento: ' + txt + '</div>';
    h += '<div class="mp-righe mp-freccie">' + mpBtn('&#9650; Nord', 'mpMuovi(0, 1)') + mpBtn('&#9660; Sud', 'mpMuovi(0, -1)') + mpBtn('&#9664; Ovest', 'mpMuovi(-1, 0)') + mpBtn('Est &#9654;', 'mpMuovi(1, 0)') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Passo: ' + String(mp.passo).replace('.', ',') + ' m', 'mpPasso()') + mpBtn('Azzera', 'mpMuovi(0, 0, true)') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Applica a tutte le zone', 'mpApplicaSposta()', (dx || dy) ? 'primary' : 'mp-off') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'circuito'){
    h += '<div class="mp-aiuto">Il circuito e’ un file con zona box, rifornimento, corsia, traguardo e giro di riferimento. Lo prepari dal PC e lo carichi in qualunque stanza: il GPS non si accende da solo.</div>';
    // nell'APK si sceglie solo il circuito (il salvataggio di file li' non parte): il file si prepara da PC
    if(window.PitCommAndroid) h += '<div class="mp-righe">' + mpBtn('Scegli il circuito (file)', "$('mpFile').click()", 'primary') + '</div>';
    else h += '<div class="mp-righe">' + mpBtn('Salva circuito (file)', 'mpCircuitoSalva()', 'primary') + mpBtn('Copia come testo', 'mpCircuitoCopia()') + mpBtn('Carica da file', "$('mpFile').click()") + '</div>';
    h += '<textarea id="mpTesto" class="mp-testo" rows="3" placeholder="oppure incolla qui il testo del circuito" spellcheck="false"></textarea>';
    h += '<div class="mp-righe">' + mpBtn('Carica da testo', 'mpCircuitoCaricaTesto()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'tracciato'){
    const n = ed ? ed.pts.length : 0;
    h += '<div class="mp-aiuto">Tocca i punti lungo la pista, nel verso di marcia, partendo dal traguardo: pi\u00f9 fitti nelle curve. Il giro si chiude da solo (linea tratteggiata). Serve a vedere la pista e al simulatore. Punti: ' + n + (n > 2 ? ' · giro ' + Math.round(gpsLunghezza(ed.pts) + gpsDistanza(ed.pts[0], ed.pts[n - 1])) + ' m' : '') + '</div>';
    h += '<div class="mp-righe">' + mpBtn(mp.reg ? 'Fine registrazione' : 'Registra girando', 'mpRegistraCamminando()', mp.reg ? 'primary' : '') + mpBtn('Aggiungi il mio punto', 'mpAggiungiMio()') + mpBtn('Annulla ultimo', 'mpAnnullaUltimo()') + mpBtn('Svuota', 'mpSvuota()') + '</div>';
    h += '<div class="mp-righe">' + mpBtn('Salva tracciato', 'mpSalva()', n >= 8 ? 'primary' : 'mp-off') + mpBtn('Togli il tracciato', 'mpRimuoviZona()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'calibra' && mp.cal){
    const c = mp.cal, vic = mpCalVicino(), troppo = vic < MP_CAL_DIST_M;
    const fmt = (x) => Math.abs(x).toFixed(1).replace('.', ',');
    const dir = (dx, dy) => [Math.abs(dx) >= 0.05 ? fmt(dx) + ' m ' + (dx > 0 ? 'est' : 'ovest') : '', Math.abs(dy) >= 0.05 ? fmt(dy) + ' m ' + (dy > 0 ? 'nord' : 'sud') : ''].filter(Boolean).join(' e ') || '0 m';
    h += '<div class="mp-aiuto">Mettiti in un punto che si riconosce dal satellite (linea del traguardo, angolo di un muretto), tocca sulla mappa dove sei e premi Misura (' + MP_CAL_SEC + ' s, fermo). Poi allontanati finche’ il cerchio diventa verde e ripeti: meglio 3 punti.</div>';
    h += '<div class="mp-aiuto mp-cal-stato ' + (c.punti.length && troppo ? 'rosso' : c.punti.length ? 'verde' : '') + '">' + (mp.mio ? 'Il tuo GPS: ±' + Math.round(mp.mio.acc) + ' m' : 'Aspetto il GPS di questo telefono…')
       + (c.punti.length && Number.isFinite(vic) ? ' · dal punto piu’ vicino: ' + Math.round(vic) + ' m ' + (troppo ? '(troppo vicino)' : '(ok)') : '') + '</div>';
    if(c.mis){
      const el = Math.min(MP_CAL_SEC, Math.round((Date.now() - c.mis.t0) / 1000));
      h += '<div class="mp-aiuto">Misuro… ' + el + '/' + MP_CAL_SEC + ' s · punti buoni: ' + c.mis.campioni.length + '</div>';
      h += '<div class="mp-righe">' + mpBtn('Annulla misura', 'mpCalAnnulla()') + '</div>';
    } else {
      if(c.gps) h += '<div class="mp-aiuto">Misurato: ±' + c.gps.spread.toFixed(1).replace('.', ',') + ' m su ' + c.gps.n + ' punti. ' + (c.tap ? 'Punto toccato: puoi trascinarlo per sistemarlo.' : 'Ora tocca la mappa dove ti trovi.') + '</div>';
      if(c.msg) h += '<div class="mp-aiuto">' + c.msg + '</div>';
      h += '<div class="mp-righe">' + mpBtn('Misura qui (' + MP_CAL_SEC + ' s)', 'mpCalMisura()', mp.mio && !troppo ? 'primary' : 'mp-off') + mpBtn('Conferma il punto', 'mpCalConferma()', c.gps && c.tap ? 'primary' : 'mp-off') + (c.gps || c.tap ? mpBtn('Annulla', 'mpCalAnnulla()') : '') + '</div>';
    }
    c.punti.forEach((q, i) => {
      h += '<div class="mp-righe mp-cal-riga"><span class="mono">' + (i + 1) + ') ' + dir(q.dx, q.dy) + (c.punti.length > 1 ? ' · scarto ' + q.res.toFixed(1).replace('.', ',') + ' m' : '') + '</span>' + mpBtn('Togli', 'mpCalTogli(' + i + ')') + '</div>';
    });
    if(c.media){
      const male = c.media.scarto != null && c.media.scarto > MP_CAL_SCARTO_MAX;
      h += '<div class="mp-aiuto ' + (male ? 'mp-cal-male' : '') + '">Spostamento medio: <b>' + dir(c.media.dx, c.media.dy) + '</b> (' + c.media.n + (c.media.n === 1 ? ' punto' : ' punti') + (c.media.scarto != null ? ', scarto ±' + c.media.scarto.toFixed(1).replace('.', ',') + ' m' : '') + ')'
         + (male ? ' — i punti non concordano: togli o rifai quello con lo scarto piu’ alto.' : (c.media.n < 3 ? ' — meglio con 3 punti.' : '')) + ' Le zone qui sopra sono mostrate gia’ spostate.</div>';
    }
    h += '<div class="mp-righe">' + mpBtn('Applica a tutte le zone', 'mpCalApplica()', c.media ? 'primary' : 'mp-off') + mpBtn('Ricomincia', 'mpCalSvuota()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  } else if(mp.modo === 'corsia'){
    const n = ed ? ed.pts.length : 0;
    h += '<div class="mp-aiuto">Tocca i punti lungo la corsia box, dall’ingresso all’uscita (almeno 2), oppure registrala camminando. Punti: ' + n + (n > 1 ? ' · ' + Math.round(gpsLunghezza(ed.pts)) + ' m' : '') + '</div>';
    h += '<div class="mp-righe">' + mpBtn(mp.reg ? 'Fine registrazione' : 'Registra camminando', 'mpRegistraCamminando()', mp.reg ? 'primary' : '') + mpBtn('Annulla ultimo', 'mpAnnullaUltimo()') + mpBtn('Svuota', 'mpSvuota()') + '</div>';
    h += '<div class="mp-righe"><span class="mono" style="font-size:12px">Limite in corsia</span><input type="number" class="mp-num" min="20" max="150" step="1" value="' + (gpsCfg.limiteKmh || 60) + '" onchange="mpLimite(this)"><span class="mono" style="font-size:12px">km/h</span></div>';
    h += '<div class="mp-righe">' + mpBtn('Salva corsia', 'mpSalva()', n >= 2 ? 'primary' : 'mp-off') + mpBtn('Togli la corsia', 'mpRimuoviZona()') + mpBtn('Esci', 'mpEsciSenzaSalvare()') + '</div>';
  }
  p.innerHTML = h;
}

// ---------- l'auto sulla mappa ----------

function mpAutoIcona(){ return L.divIcon({ className: 'mp-auto', html: '<i></i>', iconSize: [28, 28], iconAnchor: [14, 14] }); }

// Chiamata a ogni posizione dell'auto (da gps.js). `precisa` = il punto e' affidabile.
function mappaAuto(precisa){
  if(!mp.aperta || !mp.mappa || !gpsUltima) return;
  const ll = [gpsUltima.lat, gpsUltima.lng];
  if(!mp.auto){
    mp.auto = {
      scia: L.polyline([], { color: '#f5c518', weight: 3, opacity: .85, interactive: false }).addTo(mp.mappa),
      cerchio: L.circle(ll, { radius: 5, color: '#f5c518', weight: 1, fillOpacity: .12, interactive: false }).addTo(mp.mappa),
      marker: L.marker(ll, { icon: mpAutoIcona(), interactive: false, zIndexOffset: 1000 }).addTo(mp.mappa),
    };
    mp.segui = true; mpCentraAuto(true);
  }
  mp.auto.marker.setLatLng(ll);
  mp.auto.cerchio.setLatLng(ll).setRadius(Math.max(3, gpsUltima.acc || 5));
  mp.auto.marker.getElement() && mp.auto.marker.getElement().classList.toggle('mp-sfocata', !precisa);
  mp.auto.scia.setLatLngs(gpsScia.map((q) => [q.lat, q.lng]));
  if(mp.segui && mp.modo === 'auto') mpCentraAuto(false);
  mpInfoAggiorna();
}

function mpCentraAuto(forza){
  if(!mp.auto || !gpsUltima) return;
  const ll = L.latLng(gpsUltima.lat, gpsUltima.lng);
  if(forza){ mp.mappa.setView(ll, Math.max(mp.mappa.getZoom(), 16)); return; }
  if(!mp.mappa.getBounds().pad(-0.3).contains(ll)) mp.mappa.panTo(ll, { animate: true, duration: .5 });
}

function mpInfoAggiorna(){
  const e = $('mpInfo');
  if(!e || !mp.aperta) return;
  if(mp.ed && mp.modo !== 'auto'){ return; }
  const nomi = { pista: 'in pista', box: 'ai box', rifornimento: 'rifornimento' };
  let t;
  if(!gpsCfg.on) t = 'GPS spento: l’auto non manda la posizione.';
  else if(!gpsUltima) t = 'In attesa della posizione dell’auto… (telefono auto aperto, GPS permesso)';
  else {
    const eta = Math.max(0, Math.round((Date.now() - gpsUltimaBuona) / 1000));
    t = 'Auto' + (gpsStato ? ': ' + nomi[gpsStato] : '');
    if(gpsVel != null) t += ' · ' + Math.round(gpsVel * 3.6) + ' km/h';
    if(gpsUltima.acc != null) t += ' · ±' + Math.round(gpsUltima.acc) + ' m';
    t += eta > 4 ? ' · ultimo dato ' + eta + ' s fa' : '';
  }
  e.textContent = t;
}

setInterval(() => { if(mp.aperta) mpInfoAggiorna(); }, 1000);
