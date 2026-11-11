// Giro di riferimento del lancio sul circuito di Varano (corsia che si innesta sulla pista, rumore GPS):
// si forma dopo due passaggi; un giro in cui si passa in corsia (sosta ai box) NON diventa riferimento.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim10');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(C.ROOT, p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
const stub = 'window.io=()=>({connected:true,on(){},off(){},emit(){}})';
srv.listen(8783, async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.goto('http://localhost:8783/'); await pg.addScriptTag({ path: C.ROOT + '/js/pista.js' });
  const gps = JSON.parse(fs.readFileSync(path.join(C.ROOT, '..', 'tools/sim/varano.json'), 'utf8')).gps;
  const r = await pg.evaluate((gps) => {
    role = 'auto'; code = 'X'; socket = io(); gpsApplicaConfig(Object.assign({}, gps, { giroRif: null, on: true }), true);
    const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100), T0 = 1.7e12;
    // A: lancio, solo pista
    const g = Pista.guida(pista, opz, { dx: 0, dy: 0 }), rum = Pista.rumorePunto(pista, { seme: 1 }); const A = { rif: [] };
    for (let s = 1; s <= 330; s++) { g.passo(1, 1); const q = rum(g.stato(), s); if (!q) continue; lancioPunto({ lat: q.lat, lng: q.lng, acc: q.acc, v: q.v, t: T0 + s * 1000 }); if (laLocale && !A.rif.length) A.rif.push(s); }
    A.t = laLocale && laLocale.t;
    // B: due giri, il primo con sosta in corsia: il giro con la corsia non e' un riferimento
    laLocale = null; laGiro = null; laPrec = null; laCroc = null; laVerso = 0;
    const corsa = Pista.pianifica(pista, [{ giri: 1, pit: { dove: 'corsia', sostaS: 30 } }, { giri: 3 }], opz), rum2 = Pista.rumore(corsa, { seme: 2 });
    const B = { dopo: [] }; let visto = null;
    for (let t = 1; t <= corsa.durata; t++) { const q = rum2(t); if (!q) continue; lancioPunto({ lat: q.lat, lng: q.lng, acc: q.acc, v: q.v, t: T0 + 5e6 + t * 1000 }); if (laLocale !== visto) { visto = laLocale; B.dopo.push([t, laLocale && laLocale.t]); } }
    B.passaggi = corsa.passaggi.map((x) => Math.round(x));
    return { A, B };
  }, gps);
  V.ok('lancio su Varano: il giro di riferimento si forma al secondo passaggio (' + (r.A.rif[0] || '-') + ' s, giro ' + r.A.t + ' s)', r.A.rif.length === 1 && r.A.rif[0] < 230 && Math.abs(r.A.t - 100) < 3, r.A);
  const primoPit = r.B.passaggi[0];
  V.ok('un giro con sosta in corsia non diventa riferimento: i riferimenti nascono dopo i giri puliti', r.B.dopo.filter((x) => x[1] != null).every((x) => x[0] > primoPit + 100) && r.B.dopo.some((x) => x[1] != null), r.B);
  V.ok('nessun errore nella pagina', errs.length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
