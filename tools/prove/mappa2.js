const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/pitwall2027/public';
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8777, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const tile = fs.readFileSync('/tmp/demo/tile.png');
  await pg.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: tile }));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { navigator.geolocation.watchPosition = () => 5; navigator.geolocation.clearWatch = () => {}; navigator.geolocation.getCurrentPosition = () => {}; });
  await pg.goto('http://localhost:8777/');
  await pg.evaluate(() => { role = 'box'; code = 'FLATSIX'; socket = io(); document.querySelectorAll('body > div').forEach((d) => { if (d.id !== 'mappaGps') d.hidden = true; }); document.getElementById('boxView').hidden = false;
    gpsApplicaConfig({ on: true, box: { lat: 45.0, lng: 9.0 }, refuelPoly: [{ lat: 45.0002, lng: 9 }, { lat: 45.0002, lng: 9.0003 }, { lat: 45.0004, lng: 9.0003 }], corsia: [{ lat: 45.0, lng: 9.0 }, { lat: 45.0007, lng: 9.0 }],
      giroRif: { t: 60, p: Array.from({ length: 30 }, (_, i) => [45 + i * 2e-5, 9.0004 + Math.sin(i / 5) * 1e-5, i * 2]) } }, true); });
  await pg.evaluate(() => mappaApri('traguardo'));
  await pg.waitForFunction(() => window.L && typeof mp !== 'undefined' && mp.mappa);
  await pg.waitForTimeout(600);
  const box = await (await pg.$('#mpCanvas')).boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const R = {};
  await pg.mouse.click(cx - 70, cy); await pg.waitForTimeout(80); await pg.mouse.click(cx + 70, cy); await pg.waitForTimeout(80);
  R.estremi = await pg.evaluate(() => mp.ed.pts.length);
  await pg.mouse.click(cx, cy + 60); await pg.waitForTimeout(80);
  R.terzoIgnorato = await pg.evaluate(() => mp.ed.pts.length);
  R.lungh = await pg.evaluate(() => Math.round(gpsDistanza(mp.ed.pts[0], mp.ed.pts[1])));
  await pg.screenshot({ path: '/tmp/demo/mappa-traguardo.png' });
  await pg.evaluate(() => mpSalva());
  const t1 = await pg.evaluate(() => window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1]);
  R.salvato = t1.traguardo ? t1.traguardo.length : null;
  await pg.evaluate((c) => gpsApplicaConfig(c, true), { traguardo: t1.traguardo });
  // sposta tutto: 4 m a est e 2 m a nord
  await pg.evaluate(() => mpVaiA('sposta'));
  await pg.evaluate(() => { mp.passo = 2; mpMuovi(1, 0); mpMuovi(1, 0); mpMuovi(0, 1); });
  R.off = await pg.evaluate(() => mp.off);
  const prima = await pg.evaluate(() => JSON.parse(JSON.stringify({ box: gpsCfg.box, tr: gpsCfg.traguardo, cor: gpsCfg.corsia, poly: gpsCfg.refuelPoly })));
  await pg.screenshot({ path: '/tmp/demo/mappa-sposta.png' });
  await pg.evaluate(() => mpApplicaSposta());
  const sp = await pg.evaluate(() => window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1]);
  const m = (a, b) => Math.round(Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180)) * 10) / 10;
  R.spostamentoBox = m(prima.box, sp.box); R.spostamentoTraguardo = m(prima.tr[0], sp.traguardo[0]); R.spostamentoCorsia = m(prima.cor[1], sp.corsia[1]); R.spostamentoPoly = m(prima.poly[2], sp.refuelPoly[2]);
  R.nonToccaGiro = sp.giroRif === undefined;
  // circuito: esporta e ricarica
  await pg.evaluate((c) => gpsApplicaConfig(c, true), sp);
  const json = await pg.evaluate(() => mpCircuitoJson());
  const d = JSON.parse(json); R.file = { tipo: d.tipo, campi: Object.keys(d.gps).sort().join(','), giroPunti: d.gps.giroRif.p.length, senzaOn: d.gps.on === undefined };
  await pg.evaluate(() => { window.__em.length = 0; });
  R.caricaValido = await pg.evaluate((j) => mpCircuitoCarica(j), json);
  R.inviati = await pg.evaluate(() => Object.keys(window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1]).sort().join(','));
  R.caricaSbagliato = await pg.evaluate(() => mpCircuitoCarica('{"x":1}'));
  R.caricaRotto = await pg.evaluate(() => mpCircuitoCarica('non json'));
  await pg.evaluate(() => mappaApri('circuito')); await pg.evaluate(() => mpVaiA('circuito')); await pg.waitForTimeout(200);
  await pg.screenshot({ path: '/tmp/demo/mappa-circuito.png' });
  await pg.evaluate(() => mpVaiA('auto')); await pg.waitForTimeout(200);
  await pg.screenshot({ path: '/tmp/demo/mappa-auto2.png' });
  console.log(JSON.stringify(R)); console.log('errs', errs);
  await b.close(); srv.close();
});
