// Mappa del box (Leaflet, immagini satellitari Esri o mappa OpenStreetMap, nessuna chiave).
//
// - "Auto": dove si trova l'auto in gara (punto, scia, velocita'), con le zone disegnate.
// - "Box" / "Rifornim." / "Corsia": si disegnano le zone toccando la mappa (o aggiungendo il punto in
//   cui ci si trova con il telefono). Si trascinano i punti per correggerli, poi Salva.
//
// La libreria si scarica solo alla prima apertura. Serve solo al box: sull'auto non compare niente.

const MP_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const MP_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const mp = {
  aperta: false, mappa: null, pronta: null,
  modo: 'auto',          // 'auto' | 'box' | 'rifornimento' | 'corsia'
  segui: true,
  sat: true,
  zone: null,            // gruppo con le zone salvate
  lavoro: null,          // gruppo con il disegno in modifica
  auto: null,            // { marker, cerchio, scia }
  mio: null,             // { lat, lng, acc } del telefono del box
  mioMarker: null, mioWatch: null,
  ed: null,              // { pts: [], box: {lat,lng}|null } disegno in modifica
  reg: false,            // registrazione camminando (corsia)
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
      if(!u || gpsDistanza(u, q) >= GPS_PASSO_REG_M){ mp.ed.pts.push(q); mpDisegnaLavoro(); mpPannello(); }
    }
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
  if(pts.length > 1) mp.mappa.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 19 });
  else if(pts.length === 1) mp.mappa.setView(pts[0], 18);
  else if(mp.mio) mp.mappa.setView([mp.mio.lat, mp.mio.lng], 18);
  else if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition((p) => { if(mp.aperta && mp.mappa && !gpsUltima) mp.mappa.setView([p.coords.latitude, p.coords.longitude], 17); }, () => {}, { timeout: 8000 });
  }
}

// ---------- zone salvate ----------

const MP_COL = { box: '#ff8a00', rif: '#2ecc71', cor: '#35d0ff' };

function mpEtichetta(layer, testo){
  layer.bindTooltip(testo, { permanent: true, direction: 'center', className: 'mp-et' });
}

function mpDisegnaZone(){
  if(!mp.mappa) return;
  mp.zone.clearLayers();
  const ed = mp.ed ? mp.modo : null;
  if(gpsCfg.box && ed !== 'box'){
    const c = L.circle([gpsCfg.box.lat, gpsCfg.box.lng], { radius: gpsCfg.rBox, color: MP_COL.box, weight: 2, fillOpacity: .2, interactive: false }).addTo(mp.zone);
    mpEtichetta(c, 'BOX');
  }
  if(ed !== 'rifornimento'){
    if(gpsCfg.refuelPoly){
      const p = L.polygon(gpsCfg.refuelPoly.map((q) => [q.lat, q.lng]), { color: MP_COL.rif, weight: 2, fillOpacity: .22, interactive: false }).addTo(mp.zone);
      mpEtichetta(p, 'RIFORNIMENTO');
    } else if(gpsCfg.refuel){
      const c = L.circle([gpsCfg.refuel.lat, gpsCfg.refuel.lng], { radius: gpsCfg.rRefuel, color: MP_COL.rif, weight: 2, dashArray: '6 4', fillOpacity: .15, interactive: false }).addTo(mp.zone);
      mpEtichetta(c, 'RIFORNIMENTO');
    }
  }
  if(gpsCfg.corsia && ed !== 'corsia'){
    L.polyline(gpsCfg.corsia.map((q) => [q.lat, q.lng]), { color: MP_COL.cor, weight: 4, opacity: .9, interactive: false }).addTo(mp.zone);
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
  document.querySelectorAll('#mpModi .tab').forEach((b) => b.classList.toggle('on', b.dataset.modo === modo));
  mpDisegnaZone();
  mpDisegnaLavoro();
  mpPannello();
  const nomiModo = { box: 'Zona box', rifornimento: 'Area di rifornimento', corsia: 'Corsia box' };
  if(modo !== 'auto') $('mpInfo').textContent = 'Modifica: ' + nomiModo[modo];
  mpInfoAggiorna();
}

function mpPuntoIcona(){ return L.divIcon({ className: 'mp-pt', html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 13] }); }

function mpDisegnaLavoro(){
  if(!mp.mappa) return;
  mp.lavoro.clearLayers();
  mp.linea = null;
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
  const col = mp.modo === 'corsia' ? MP_COL.cor : MP_COL.rif;
  mp.linea = (mp.modo === 'rifornimento' && ll.length >= 3 ? L.polygon(ll, { color: col, weight: 2, fillOpacity: .25, interactive: false })
                                                           : L.polyline(ll, { color: col, weight: mp.modo === 'corsia' ? 4 : 2, interactive: false })).addTo(mp.lavoro);
}

function mpClick(ll){
  if(!mp.ed || mp.modo === 'auto') return;
  if(mp.modo === 'box') mp.ed.box = { lat: ll.lat, lng: ll.lng };
  else mp.ed.pts.push({ lat: ll.lat, lng: ll.lng });
  mpDisegnaLavoro();
  mpPannello();
}

function mpAggiungiMio(){
  if(!mp.ed || !mp.mio){ $('mpInfo').textContent = 'Non ho ancora la posizione di questo telefono.'; return; }
  if(mp.mio.acc > 25){ $('mpInfo').textContent = 'Precisione scarsa (±' + Math.round(mp.mio.acc) + ' m): aspetta qualche secondo.'; return; }
  if(mp.modo === 'box') mp.ed.box = { lat: mp.mio.lat, lng: mp.mio.lng };
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
  }
  $('mpInfo').textContent = 'Salvato.';
  mpVaiA('auto');
}

function mpEsciSenzaSalvare(){ mpVaiA('auto'); }

function mpRimuoviZona(){
  if(mp.modo === 'box') gpsInvia({ box: null });
  else if(mp.modo === 'rifornimento') gpsInvia({ refuelPoly: null, refuel: null });
  else if(mp.modo === 'corsia') gpsInvia({ corsia: null });
  mpVaiA('auto');
}

function mpRaggio(el){
  const v = Number(String(el.value).replace(',', '.'));
  if(!Number.isFinite(v) || v < 3 || v > 200) return;
  gpsInvia({ rBox: v });
  gpsCfg.rBox = v; mpDisegnaLavoro();
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
    h += '<div class="mp-aiuto">Per disegnare le zone scegli Box, Rifornim. o Corsia in alto.</div>';
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
  } else if(mp.modo === 'corsia'){
    const n = ed ? ed.pts.length : 0;
    h += '<div class="mp-aiuto">Tocca i punti lungo la corsia box, dall’ingresso all’uscita (almeno 2), oppure registrala camminando. Punti: ' + n + (n > 1 ? ' · ' + Math.round(gpsLunghezza(ed.pts)) + ' m' : '') + '</div>';
    h += '<div class="mp-righe">' + mpBtn(mp.reg ? 'Fine registrazione' : 'Registra camminando', 'mpRegistraCamminando()', mp.reg ? 'primary' : '') + mpBtn('Annulla ultimo', 'mpAnnullaUltimo()') + mpBtn('Svuota', 'mpSvuota()') + '</div>';
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
