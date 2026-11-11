// Colore dei distacchi sull'auto: con lo stesso avversario il colore sopravvive ai "1 giro" momentanei di ogni giro;
// verde se il distacco davanti si riduce, giallo se aumenta; con un avversario nuovo si riparte da bianco.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim11');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(C.ROOT, p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8784, async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},off(){},emit(){}})' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.goto('http://localhost:8784/');
  const r = await pg.evaluate(() => {
    role = 'auto'; applySogliaGap(0.1); const o = {};
    const base = { position: 14, numberAhead: '94', nameAhead: 'X', gapAhead: '+2.0', numberBehind: null, gapBehind: null };
    const cl = () => $('timingGapAhead').className.replace('gap', '').trim() || 'bianco';
    renderTiming(base); o.inizio = cl();
    renderTiming(Object.assign({}, base, { gapAhead: '1 giro' })); o.unGiro = cl();
    renderTiming(Object.assign({}, base, { gapAhead: '+7.0' })); o.dopoUnGiro = cl();               // peggiora: giallo, anche passando da "1 giro"
    renderTiming(Object.assign({}, base, { gapAhead: '1 giro' })); o.tieneGiallo = cl();
    renderTiming(Object.assign({}, base, { gapAhead: '+3.0' })); o.migliora = cl();                  // si riduce: verde
    renderTiming(Object.assign({}, base, { gapAhead: '+3.0', numberAhead: '89' })); o.altroRivale = cl();  // avversario nuovo: bianco
    renderTiming(Object.assign({}, base, { gapAhead: '', numberAhead: '10' })); o.altroEVuoto = cl();
    return o;
  });
  V.ok('inizio bianco', r.inizio === 'bianco', r);
  V.ok('"1 giro" momentaneo: resta bianco ma non si perde il riferimento', r.unGiro === 'bianco', r);
  V.ok('dopo "1 giro" il distacco aumenta: giallo', r.dopoUnGiro === 'g-down', r);
  V.ok('nuovo "1 giro" con lo stesso avversario: il giallo resta', r.tieneGiallo === 'g-down', r);
  V.ok('il distacco si riduce: verde', r.migliora === 'g-up', r);
  V.ok('avversario nuovo: si riparte da bianco', r.altroRivale === 'bianco' && r.altroEVuoto === 'bianco', r);
  V.ok('nessun errore', errs.length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
