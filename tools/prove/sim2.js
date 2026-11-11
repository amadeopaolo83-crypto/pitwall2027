// Il box riconosce dalla velocita' i passaggi in corsia (passaggio / rifornimento / sosta / cambio?) con il GPS simulato e rumoroso.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim2'); const root = C.ROOT;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8774, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const stub = 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});';
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { let off = 0; const real = Date.now.bind(Date); Date.now = () => real() + off; window.__avanza = (s) => { off += s * 1000; }; });
  await pg.goto('http://localhost:8774/');
  await pg.addScriptTag({ path: path.join(root, 'js/pista.js') });
  const R = await pg.evaluate(async () => {
    role = 'box'; code = 'SIM'; socket = io(); boxPrimario = true;
    document.querySelectorAll('body > div').forEach((d) => { d.hidden = true; }); document.getElementById('boxView').hidden = false;
    const gps = Pista.esempio({ lat: 45.0, lng: 9.0 });
    gpsApplicaConfig(Object.assign({}, gps, { on: true, fermoS: 60 }), true);
    const pista = Pista.costruisci(gps);
    const piano = [{ giri: 1 }, { giri: 1, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 1, pit: { dove: 'rifornimento', sostaS: 1 } },
                   { giri: 1, pit: { dove: 'box', sostaS: 90 } }, { giri: 1, pit: { dove: 'box', sostaS: 20 } }, { giri: 2 }];
    const corsa = Pista.pianifica(pista, piano);
    const g = Pista.rumore(corsa, { seme: 3 });
    const T0 = 1.7e12; let inviati = 0;
    for (let t = 0; t < corsa.durata + 20; t += 1) {
      window.__avanza(1);
      const q = g(t); if (!q) continue;
      inviati++; gpsRicevi({ lat: q.lat, lng: q.lng, acc: q.acc, v: q.v, t: T0 + t * 1000 });
    }
    // controprova: un'auto a 170 km/h che passa sulla corsia (pista accanto) non deve contare
    const prima = gpsPitLog.length; let tt = corsa.durata + 40;
    const c = gps.corsia, ll = (x) => ({ lat: x.lat, lng: x.lng });
    for (let rip = 0; rip < 2; rip++) for (let i = 0; i < c.length - 1; i++) { window.__avanza(1); tt += 1; gpsRicevi(Object.assign(ll(c[i]), { acc: 4, v: 47, t: T0 + tt * 1000 })); }
    for (let i = 0; i < 8; i++) { window.__avanza(1); tt += 1; gpsRicevi({ lat: c[0].lat + 0.002, lng: c[0].lng, acc: 4, v: 47, t: T0 + tt * 1000 }); }
    const veloce = gpsPitLog.length - prima;
    return { veloce, log: gpsPitLog, verita: corsa.verita, durata: corsa.durata, inviati, riga: gpsRiga(), giri: 7 };
  });
  const log = R.log, ver = R.verita;
  const ing = ver.filter((e) => e.tipo === 'entrataLimite'), soste = ver.filter((e) => e.tipo === 'sosta');
  V.ok('nessun errore nella pagina', errs.length === 0, errs);
  V.ok('un solo episodio per ogni passaggio vero (' + ing.length + ') e nessuno in piu\' ', log.length === ing.length, log.map((x) => x.tipo));
  const attesi = ['rifornimento', 'passaggio', 'cambio?', 'sosta'];
  const dall = log.map((x) => x.tipo);
  V.ok('classifica: rifornimento, passaggio, cambio pilota?, sosta', JSON.stringify(dall) === JSON.stringify(attesi), dall);
  log.forEach((x, i) => {
    const s = soste[i];
    if (!s || !x) return;
    V.ok('pit ' + (i + 1) + ': sosta misurata ' + x.fermoS + ' s (vera ' + (s.durataS) + ' s)', s.durataS <= 1 ? x.fermoS < 5 : Math.abs(x.fermoS - s.durataS) <= 4, [x.fermoS, s.durataS]);
    V.ok('pit ' + (i + 1) + ': velocita\' in corsia vicina al limite (' + x.vmaxKmh + ' km/h)', x.vmaxKmh > 40 && x.vmaxKmh < 75, x.vmaxKmh);
  });
  V.ok('un\'auto veloce che passa sulla corsia (170 km/h) non viene contata', R.veloce === 0, R.veloce);
  V.ok('riga GPS mostra l\'ultimo pit', /ultimo pit/.test(R.riga), R.riga);
  V.fine(); await b.close(); srv.close();
});
