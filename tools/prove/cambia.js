// "◄ cambia" sull'auto: serve il doppio tocco entro 2 s.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'public');
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(8792, () => res(s)); });
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 800 } });
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},off(){},emit(){},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8792/');
  await pg.evaluate(() => { window.__reset = 0; window.resetRole = () => { window.__reset++; }; document.getElementById('autoView').hidden = false; document.getElementById('landing').hidden = true; });
  const clic = () => pg.evaluate(() => document.getElementById('changeRoleBtn').click());
  const n = () => pg.evaluate(() => window.__reset), txt = () => pg.evaluate(() => document.getElementById('changeRoleBtn').textContent);
  let male = 0; const v = (nome, c) => { console.log((c ? 'OK   ' : 'MALE ') + nome); if (!c) male++; };
  await clic(); v('un tocco: non esce', (await n()) === 0); v('un tocco: la scritta avvisa', /ancora/.test(await txt()));
  await pg.waitForTimeout(2300); v('dopo 2 s la scritta torna', /cambia/.test(await txt())); await clic(); v('un tocco dopo la pausa: non esce', (await n()) === 0);
  await clic(); v('doppio tocco: esce', (await n()) === 1);
  await b.close(); srv.close(); process.exit(male ? 1 : 0);
})();
