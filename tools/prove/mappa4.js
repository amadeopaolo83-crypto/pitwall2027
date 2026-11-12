// Mappa del box, corsia box: un punto disegnato sopra il tracciato (o a meno di 5 m) si sposta da solo di lato a 5 m
// (dalla parte toccata; se e' proprio sulla linea, dalla parte della zona box). Piu' lontano non si tocca.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('mappa4');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(C.ROOT, p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8795, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: C.tessera() }));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { navigator.geolocation.watchPosition = () => 5; navigator.geolocation.clearWatch = () => {}; });
  await pg.goto('http://localhost:8795/');
  // tracciato: rettilineo est-ovest a lat 45 (e il resto di un anello), box 20 m a nord del rettilineo
  const r = await pg.evaluate(async () => {
    role = 'box'; code = 'X'; socket = io(); document.getElementById('boxView').hidden = false;
    const m = 1 / 111320, ml = 1 / (111320 * Math.cos(45 * Math.PI / 180));
    const P = (x, y) => ({ lat: 45 + y * m, lng: 9 + x * ml });
    gpsApplicaConfig({ on: true, tracciato: [P(-300, 0), P(300, 0), P(300, -200), P(-300, -200)], box: P(0, 20) }, true);
    mappaApri('corsia');
    await new Promise((ok) => { const t = setInterval(() => { if (window.L && mp.mappa) { clearInterval(t); ok(); } }, 50); });
    const nord = (q) => Math.round((q.lat - 45) / m * 10) / 10, est = (q) => Math.round((q.lng - 9) / ml * 10) / 10;
    const out = {};
    mpClick({ lat: 45, lng: 9 + -100 * ml });                 out.sopra = [est(mp.ed.pts[0]), nord(mp.ed.pts[0])]; out.msg = document.getElementById('mpInfo').textContent;
    mpClick(P(0, -2));                                          out.sud2 = nord(mp.ed.pts[1]);
    mpClick(P(100, 12));                                        out.lontano = nord(mp.ed.pts[2]);
    mpClick(P(200, 4.99));                                      out.quasi = nord(mp.ed.pts[3]);
    // trascinato sopra la pista: torna a 5 m
    const q = mp.ed.pts[2]; q.lat = 45; mpCorsiaStacca(q); out.trascinato = nord(q);
    mpSalva(); const inv = window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1].corsia; out.salvati = inv.map(nord);
    // nel modo tracciato non si sposta niente
    mpVaiA('tracciato'); mpClick({ lat: 45, lng: 9 }); out.tracciato = nord(mp.ed.pts[mp.ed.pts.length - 1]);
    // senza tracciato non si sposta niente
    gpsCfg.tracciato = null; mpVaiA('corsia'); mp.ed.pts = []; mpClick({ lat: 45, lng: 9 }); out.senzaTracciato = nord(mp.ed.pts[0]);
    return out;
  });
  V.ok('punto sopra il tracciato: spostato a 5 m dalla parte del box', Math.abs(r.sopra[1] - 5) < 0.2 && Math.abs(r.sopra[0] + 100) < 0.2, r.sopra);
  V.ok('il box lo dice ("Punto spostato a 5 m dal tracciato")', /spostato a 5 m/.test(r.msg), r.msg);
  V.ok('punto a 2 m dall\'altra parte: spostato a 5 m da quella parte', Math.abs(r.sud2 + 5) < 0.2, r.sud2);
  V.ok('punto a 12 m: non si tocca', Math.abs(r.lontano - 12) < 0.2, r.lontano);
  V.ok('punto a 4,99 m: portato a 5 m', Math.abs(r.quasi - 5) < 0.2, r.quasi);
  V.ok('punto trascinato sopra la pista: torna a 5 m', Math.abs(r.trascinato - 5) < 0.2, r.trascinato);
  V.ok('corsia salvata: nessun punto sopra la pista', r.salvati.every((y) => Math.abs(y) >= 4.9), r.salvati);
  V.ok('disegnando il tracciato i punti non si spostano', r.tracciato === 0, r.tracciato);
  V.ok('senza tracciato disegnato i punti della corsia non si spostano', r.senzaTracciato === 0, r.senzaTracciato);
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
