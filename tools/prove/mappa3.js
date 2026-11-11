// Mappa: modo Tracciato (linea della pista), limite in corsia, Calibra (allineamento al GPS con piu' punti),
// e i nuovi campi nel file del circuito. Playwright con finto socket e finto GPS.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const V = C.controlli('mappa3');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8795, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const tile = C.tessera();
  await pg.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: tile }));
  const io = 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});';
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: io }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.addInitScript(() => {
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 1; };
    navigator.geolocation.clearWatch = () => {}; navigator.geolocation.getCurrentPosition = () => {};
    window.__geo = (lat, lng, acc) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: acc, speed: null }, timestamp: Date.now() });
  });
  await pg.goto('http://localhost:8795/');
  await pg.evaluate(() => { role = 'box'; code = 'MAPPA3'; socket = io(); document.querySelectorAll('body > div').forEach((d) => { if (d.id !== 'mappaGps') d.hidden = true; });
    gpsApplicaConfig({ on: true, box: { lat: 45.0, lng: 9.0 }, refuelPoly: [{ lat: 45.0002, lng: 9 }, { lat: 45.0002, lng: 9.0003 }, { lat: 45.0004, lng: 9.0003 }],
      corsia: [{ lat: 45.0, lng: 9.0 }, { lat: 45.0007, lng: 9.0002 }], traguardo: [{ lat: 45.0, lng: 9.001 }, { lat: 45.0, lng: 9.0012 }] }, true); });
  await pg.evaluate(() => mappaApri('tracciato'));
  await pg.waitForFunction(() => window.L && typeof mp !== 'undefined' && mp.mappa);
  await pg.waitForTimeout(500);
  const ultimoInviato = () => pg.evaluate(() => { const l = window.__em.filter((e) => e[0] === 'gpsConfigUpdate'); return l.length ? l[l.length - 1][1] : null; });
  const metri = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));

  // ---------- tracciato ----------
  await pg.evaluate(() => { for (let i = 0; i < 6; i++) mpClick({ lat: 45.001 + Math.sin(i) * 1e-4, lng: 9 + i * 1e-4 }); });
  await pg.evaluate(() => { window.__em.length = 0; mpSalva(); });
  V.ok('tracciato: con 6 punti non si salva (ne servono 8)', (await ultimoInviato()) === null);
  await pg.evaluate(() => { for (let i = 0; i < 6; i++) mpClick({ lat: 45.0012 + Math.cos(i) * 1e-4, lng: 9.0006 - i * 1e-4 }); });
  const n = await pg.evaluate(() => mp.ed.pts.length);
  await pg.evaluate(() => { mpSalva(); });
  const t = await ultimoInviato();
  V.ok('tracciato: 12 punti salvati', n === 12 && t && Array.isArray(t.tracciato) && t.tracciato.length === 12, t && t.tracciato && t.tracciato.length);
  await pg.evaluate((tr) => gpsApplicaConfig({ tracciato: tr }, true), t.tracciato);
  await pg.evaluate(() => mpVaiA('tracciato')); await pg.waitForTimeout(200);
  await pg.screenshot({ path: C.OUT + '/mappa-tracciato.png' });
  V.ok('tracciato: si ricarica in modifica', await pg.evaluate(() => mp.ed.pts.length === 12));
  await pg.evaluate(() => mpVaiA('auto'));

  // limite in corsia
  await pg.evaluate(() => mpVaiA('corsia'));
  await pg.evaluate(() => { window.__em.length = 0; const i = document.createElement('input'); i.value = '70'; mpLimite(i); });
  V.ok('limite corsia: 70 km/h inviato', (await ultimoInviato() || {}).limiteKmh === 70);
  await pg.evaluate(() => { window.__em.length = 0; const i = document.createElement('input'); i.value = '10'; mpLimite(i); });
  V.ok('limite corsia: 10 km/h (fuori scala) ignorato', (await ultimoInviato()) === null);
  await pg.evaluate(() => mpVaiA('auto'));

  // sposta: porta con se' anche il tracciato
  await pg.evaluate(() => mpVaiA('sposta')); await pg.evaluate(() => { mp.passo = 2; mpMuovi(1, 0); mpMuovi(1, 0); mpMuovi(0, 1); });
  const prima = await pg.evaluate(() => JSON.parse(JSON.stringify(gpsCfg.tracciato)));
  await pg.evaluate(() => { window.__em.length = 0; mpApplicaSposta(); });
  const sp = await ultimoInviato();
  V.ok('sposta: anche il tracciato si sposta (4 m est, 2 m nord)', sp.tracciato && Math.abs(metri(prima[3], sp.tracciato[3]) - Math.hypot(4, 2)) < 0.1, sp.tracciato && metri(prima[3], sp.tracciato[3]));
  await pg.evaluate((c) => gpsApplicaConfig(c, true), sp);

  // circuito: nei file ci sono tracciato, limite e allineamento
  const d = JSON.parse(await pg.evaluate(() => mpCircuitoJson()));
  V.ok('file circuito: ha tracciato e limite', Array.isArray(d.gps.tracciato) && d.gps.tracciato.length === 12 && d.gps.limiteKmh === 70, Object.keys(d.gps));
  await pg.evaluate(() => { window.__em.length = 0; });
  await pg.evaluate((j) => mpCircuitoCarica(j), JSON.stringify(d));
  const car = await ultimoInviato();
  V.ok('file circuito: ricaricato con tracciato e limite', car && car.tracciato.length === 12 && car.limiteKmh === 70);

  // ---------- calibra ----------
  const P = { lat: 45.0, lng: 9.0 };
  await pg.evaluate(() => mappaApri('calibra')); await pg.evaluate(() => mpVaiA('calibra')); await pg.waitForTimeout(300);
  await pg.evaluate(() => mpAvviaMioGps());
  const misura = async (lat, lng, acc, n = 14) => {              // un punto: n campioni del GPS e poi i 20 s passati
    await pg.evaluate(([a, o, c, k]) => { for (let i = 0; i < k; i++) window.__geo(a + (i % 3 - 1) * 4e-6, o + (i % 2 - 0.5) * 4e-6, c); }, [lat, lng, acc, n]);
    await pg.evaluate(() => { mpCalMisura(); if (mp.cal.mis) { mp.cal.mis.campioni = []; } });
    await pg.evaluate(([a, o, c, k]) => { for (let i = 0; i < k; i++) window.__geo(a + (i % 3 - 1) * 4e-6, o + (i % 2 - 0.5) * 4e-6, c); }, [lat, lng, acc, n]);
    await pg.evaluate(() => { if (mp.cal.mis) { mp.cal.mis.t0 -= 21000; mpCalTick(); } });
  };
  await pg.evaluate(() => window.__geo(45.0, 9.0, 5));
  // punto 1: il GPS dice (lat0, lng0); la persona tocca 3,0 m a ovest e 1,0 m a sud (il disegno e' sfalsato di +3 est, +1 nord)
  const toccoA = (gps, dxE, dyN) => ({ lat: gps.lat - dyN / 111320, lng: gps.lng - dxE / (111320 * Math.cos(gps.lat * Math.PI / 180)) });
  const punti = [[{ lat: 45.0, lng: 9.0 }, 3.0, 1.0], [{ lat: 45.0, lng: 9.0045 }, 3.4, 0.8], [{ lat: 45.0042, lng: 9.0022 }, 2.8, 1.3]];
  const R = [];
  for (let i = 0; i < 3; i++) {
    const [g, dxE, dyN] = punti[i];
    await misura(g.lat, g.lng, 5);
    const gm = await pg.evaluate(() => mp.cal.gps);
    R.push(gm);
    const tap = toccoA(g, dxE, dyN);
    await pg.evaluate((q) => mpClick(q), tap);
    await pg.evaluate(() => mpCalConferma());
    if (i === 0) {
      // subito dopo il primo punto, nello stesso posto: troppo vicino
      const c0 = await pg.evaluate(() => { mp.cal.cerchi && 0; return { rosso: mp.cal.cerchi[0].options.color, vic: Math.round(mpCalVicino()) }; });
      V.ok('calibra: nello stesso posto il cerchio e\' rosso', c0.rosso === '#ff3b30' && c0.vic < 10, c0);
      const rifiuto = await pg.evaluate(() => { mpCalMisura(); return { mis: !!mp.cal.mis, msg: mp.cal.msg }; });
      V.ok('calibra: non si misura troppo vicino al punto 1', rifiuto.mis === false && /troppo vicino/.test(rifiuto.msg), rifiuto);
      await pg.screenshot({ path: C.OUT + '/mappa-calibra1.png' });
    }
    if (i < 2) {
      const next = punti[i + 1][0];
      await pg.evaluate(([a, o]) => window.__geo(a, o, 5), [next.lat, next.lng]);
      const col = await pg.evaluate(() => mp.cal.cerchi.map((c) => c.options.color));
      V.ok('calibra: lontano il cerchio diventa verde (punto ' + (i + 1) + ')', col.every((x) => x === '#34c759'), col);
    }
  }
  const m = await pg.evaluate(() => mp.cal.media);
  const att = { dx: (3.0 + 3.4 + 2.8) / 3, dy: (1.0 + 0.8 + 1.3) / 3 };
  V.ok('calibra: spostamento medio giusto con 3 punti', Math.abs(m.dx - att.dx) < 0.3 && Math.abs(m.dy - att.dy) < 0.3 && m.n === 3, [m, att]);
  V.ok('calibra: scarto piccolo (punti concordi)', m.scarto != null && m.scarto < 1, m.scarto);
  await pg.screenshot({ path: C.OUT + '/mappa-calibra3.png' });
  const testo = await pg.evaluate(() => document.getElementById('mpPannello').textContent);
  V.ok('calibra: il pannello mostra lo spostamento e i 3 punti', /Spostamento medio/.test(testo) && /3 punti/.test(testo) && /1\)/.test(testo) && /3\)/.test(testo), testo.slice(0, 300));
  // un punto sbagliato di 10 m: scarto alto e avviso
  await pg.evaluate(() => window.__geo(45.0, 9.0, 5));
  await pg.evaluate(() => { mp.cal.punti.push({ gps: { lat: 45.01, lng: 9.01 }, tap: {}, dx: 3 + 10, dy: 1.0 }); mp.cal.media = mpCalMedia(mp.cal.punti); mpPannello(); });
  const t2 = await pg.evaluate(() => ({ s: mp.cal.media.scarto, txt: document.getElementById('mpPannello').textContent }));
  V.ok('calibra: un punto sbagliato di 10 m da\' avviso "non concordano"', t2.s > 4 && /non concordano/.test(t2.txt), t2.s);
  await pg.evaluate(() => mpCalTogli(3));
  V.ok('calibra: togliendolo torna tutto a posto', (await pg.evaluate(() => mp.cal.media.n)) === 3);
  // applica
  const prima2 = await pg.evaluate(() => JSON.parse(JSON.stringify({ box: gpsCfg.box, tr: gpsCfg.traguardo, tk: gpsCfg.tracciato, poly: gpsCfg.refuelPoly })));
  await pg.evaluate(() => { window.__em.length = 0; mpCalApplica(); });
  const ap = await ultimoInviato();
  V.ok('calibra: applica sposta box, rifornimento, traguardo e tracciato', ap && Math.abs(metri(prima2.box, ap.box) - Math.hypot(m.dx, m.dy)) < 0.2 && Math.abs(metri(prima2.tr[0], ap.traguardo[0]) - Math.hypot(m.dx, m.dy)) < 0.2
    && Math.abs(metri(prima2.tk[5], ap.tracciato[5]) - Math.hypot(m.dx, m.dy)) < 0.2 && Math.abs(metri(prima2.poly[1], ap.refuelPoly[1]) - Math.hypot(m.dx, m.dy)) < 0.2, ap && Math.round(metri(prima2.box, ap.box) * 10) / 10);
  V.ok('calibra: si salva anche l\'allineamento (3 punti)', ap.allineamento && ap.allineamento.n === 3 && Math.abs(ap.allineamento.dx - m.dx) < 0.11, ap.allineamento);
  V.ok('calibra: non tocca il giro di riferimento', ap.giroRif === undefined);
  // pochi punti GPS
  await pg.evaluate(() => mpVaiA('calibra'));
  await pg.evaluate(() => { for (let i = 0; i < 3; i++) window.__geo(45.5, 9.5, 5); mpCalMisura(); mp.cal.mis.t0 -= 21000; mpCalTick(); });
  const poc = await pg.evaluate(() => ({ gps: mp.cal.gps, msg: mp.cal.msg }));
  V.ok('calibra: con pochi punti GPS precisi chiede di riprovare', poc.gps === null && /pochi punti/.test(poc.msg), poc);
  // GPS poco preciso scartato
  await pg.evaluate(() => { mpCalAnnulla(); mpCalMisura(); for (let i = 0; i < 20; i++) window.__geo(45.5, 9.5, 60); mp.cal.mis.t0 -= 21000; mpCalTick(); });
  V.ok('calibra: i punti con precisione scarsa (60 m) non contano', (await pg.evaluate(() => mp.cal.gps)) === null);
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
