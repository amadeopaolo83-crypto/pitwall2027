// Etichette dei pulsanti e dei messaggi con codice HTML: non devono eseguire nulla e devono restare testo.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'public');
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(8790, () => res(s)); });
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 800 } });
  const corpo = 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});';
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: corpo }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  const male = '"><img src=x onerror="window.__xss=1"><b>';
  await pg.addInitScript((m) => { localStorage.setItem('pc_qb', JSON.stringify([{ id: 1, label: m, color: 'x" onfocus="window.__xss=2' }, { id: 2, label: 'B', color: '#f5a623' }, { id: 3, label: 'C', color: '#7ed321' }, { id: 4, label: 'D', color: '#bd10e0' }]));
    localStorage.setItem('pc_flash', JSON.stringify([{ text: m, color: 'y" onfocus="window.__xss=3', duration: 6 }])); }, male);
  await pg.goto('http://localhost:8790/');
  await pg.evaluate(() => { role = 'box'; });
  await pg.evaluate(() => { quickButtons = JSON.parse(localStorage.getItem('pc_qb')); flashPresets = JSON.parse(localStorage.getItem('pc_flash')); renderQbEditor(); renderFlashEditor(); });
  await pg.waitForTimeout(500);
  const r = await pg.evaluate((m) => ({ xss: window.__xss || null, imgs: document.querySelectorAll('#qbEditor img, #flashEditor img').length,
    valoreQb: document.querySelector('#qbEditor input[type=text]').value === m, valoreFlash: document.querySelector('#flashEditor input[type=text]').value === m,
    coloreQb: document.querySelector('#qbEditor input[type=color]').value, coloreFlash: document.querySelector('#flashEditor input[type=color]').value }), male);
  console.log(JSON.stringify(r));
  const bene = r.xss === null && r.imgs === 0 && r.valoreQb && r.valoreFlash;
  console.log(bene ? 'OK   nessun codice eseguito, testo conservato' : 'MALE'); await b.close(); srv.close(); process.exit(bene ? 0 : 1);
})();
