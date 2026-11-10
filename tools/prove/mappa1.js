const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const root = C.ROOT;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8776, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const tile = C.tessera();
  await pg.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: tile }));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { window.__w = { cb: null }; navigator.geolocation.watchPosition = (cb) => { window.__w.cb = cb; return 5; }; navigator.geolocation.clearWatch = () => {}; navigator.geolocation.getCurrentPosition = (cb) => cb({ coords: { latitude: 45.0, longitude: 9.0, accuracy: 5 } }); });
  await pg.goto('http://localhost:8776/');
  await pg.evaluate(() => { role = 'box'; code = 'FLATSIX'; socket = io(); document.querySelectorAll('body > div').forEach((d) => { if (d.id !== 'mappaGps') d.hidden = true; }); document.getElementById('boxView').hidden = false;
    gpsApplicaConfig({ on: true, box: { lat: 45.0, lng: 9.0 }, corsia: [{ lat: 45.0, lng: 9.0 }, { lat: 45.0007, lng: 9.0 }] }); });
  await pg.evaluate(() => mappaApri('rifornimento'));
  await pg.waitForFunction(() => window.L && typeof mp !== 'undefined' && mp.mappa);
  await pg.waitForTimeout(600);
  // posizione del telefono del box (per "aggiungi il mio punto")
  await pg.evaluate(() => window.__w.cb({ coords: { latitude: 45.0003, longitude: 9.0001, accuracy: 4 } }));
  // 4 angoli toccando la mappa
  const box = await (await pg.$('#mpCanvas')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-60, -40], [60, -40], [60, 40], [-60, 40]]) { await pg.mouse.click(cx + dx, cy + dy); await pg.waitForTimeout(80); }
  const n = await pg.evaluate(() => mp.ed.pts.length);
  await pg.screenshot({ path: C.OUT + '/mappa-edit.png' });
  await pg.evaluate(() => mpAnnullaUltimo()); const n2 = await pg.evaluate(() => mp.ed.pts.length);
  await pg.evaluate(() => mpAggiungiMio()); const n3 = await pg.evaluate(() => mp.ed.pts.length);
  await pg.evaluate(() => mpSalva());
  const inviato = await pg.evaluate(() => window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1]);
  const V = C.controlli('mappa1');
  V.ok('4 punti toccati, annulla, mio punto', n === 4 && n2 === 3 && n3 === 4, [n, n2, n3]);
  V.ok('area inviata con 4 punti', (inviato.refuelPoly || []).length === 4, inviato);
  console.log('punti toccati', n, '| dopo annulla', n2, '| dopo mio punto', n3, '| inviati', (inviato.refuelPoly || []).length, '| modo ora', await pg.evaluate(() => mp.modo));
  // il server risponde con la nuova config
  await pg.evaluate((c) => gpsApplicaConfig(c), { refuelPoly: inviato.refuelPoly });
  // zona: dentro / fuori / isteresi
  const z = await pg.evaluate(() => {
    const poly = gpsCfg.refuelPoly; const c = { lat: poly.reduce((a, q) => a + q.lat, 0) / poly.length, lng: poly.reduce((a, q) => a + q.lng, 0) / poly.length };
    const out = {}; out.centro = gpsZonaDi(c); out.lontano = gpsZonaDi({ lat: c.lat + 0.001, lng: c.lng });
    out.pipCentro = gpsInPoligono(c, poly); out.distBordoCentro = Math.round(gpsDistBordo(c, poly));
    return out; });
  console.log('zone', JSON.stringify(z));
  V.ok('zone: centro rifornimento, lontano pista', z.centro === 'rifornimento' && z.lontano === 'pista' && z.pipCentro === true, z);
  // auto sulla mappa
  await pg.evaluate(() => { mpVaiA('auto'); const t = Date.now(); for (let i = 0; i < 5; i++) gpsRicevi({ lat: 45.0003 + i * 0.00002, lng: 9.0001, acc: 4, v: 12.5, t: t + i * 1000 }); });
  await pg.waitForTimeout(700);
  const au = await pg.evaluate(() => ({ marker: !!mp.auto, scia: mp.auto.scia.getLatLngs().length, info: document.getElementById('mpInfo').textContent, segui: mp.segui }));
  console.log('auto', JSON.stringify(au));
  V.ok('auto sulla mappa con scia e velocita', au.marker && au.scia === 5 && /45 km\/h/.test(au.info), au);
  await pg.screenshot({ path: C.OUT + '/mappa-auto.png' });
  await pg.evaluate(() => mpVaiA('corsia')); await pg.waitForTimeout(300);
  await pg.screenshot({ path: C.OUT + '/mappa-corsia.png' });
  await pg.evaluate(() => mappaChiudi()); const chiusa = await pg.evaluate(() => document.getElementById('mappaGps').hidden); console.log('chiusa', chiusa, 'errs', errs);
  V.ok('mappa chiusa', chiusa === true);
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
