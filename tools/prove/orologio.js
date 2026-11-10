const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/pitwall2027/public';
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8778, async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},emit(){},connected:true,onAny(){}});' }));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},emit(){},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.goto('http://localhost:8778/');
  const R = await pg.evaluate(async () => {
    const SCARTO = 5000;   // il server e' avanti di 5 s
    // risposte con ritardi diversi sull'andata e sul ritorno (ms): la prima molto asimmetrica
    const piani = [[100, 1100], [600, 50], [40, 40], [300, 200], [700, 700], [60, 60]];
    let i = 0;
    socket = { connected: true, emit(ev, cb){ const [su, giu] = piani[i++ % piani.length]; setTimeout(() => { const tS = Date.now() + SCARTO; setTimeout(() => cb(tS), giu); }, su); } };
    clockOffset = 0; orologioMigliore = null; orologioVolte = 0;
    sincronizzaOrologio(6);
    await new Promise((r) => setTimeout(r, 2800));
    const grezzo = 5000 + (1100 - 100) / 2;   // errore della vecchia stima (solo andata): metà dell'asimmetria
    return { offset: Math.round(clockOffset), errore: Math.round(clockOffset - SCARTO), rttMigliore: orologioMigliore.rtt, errorePrimoCampione: Math.round(grezzo - SCARTO) };
  });
  console.log(JSON.stringify(R), errs);
  await b.close(); srv.close();
});
