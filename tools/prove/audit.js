const { chromium } = require('playwright'); const C = require('./comune'); const http = require('http'), fs = require('fs'), path = require('path');
const mk = (root, port) => new Promise((res) => { const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }); srv.listen(port, () => res(srv)); });
(async () => {
  // Serve una copia di pitwallnew (solo lettura): PITWALLNEW_DIR, oppure ../pitwallnew accanto al repository.
  if (!fs.existsSync(require('path').join(C.PITWALLNEW, 'public', 'index.html'))) { console.log('MALE manca pitwallnew in ' + C.PITWALLNEW + ' (imposta PITWALLNEW_DIR)'); process.exit(1); }
  const s1 = await mk(C.ROOT, 8771), s2 = await mk(require('path').join(C.PITWALLNEW, 'public'), 8772);
  const b = await chromium.launch();
  const prep = async (pg, url, ruolo, w, h) => {
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},off(){},emit(){},connected:true,onAny(){}});' }));
    await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},off(){},emit(){},connected:true,onAny(){}});' }));
    await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await pg.goto(url);
    await pg.evaluate((ruolo) => {
      role = ruolo; code = 'T'; socket = io();
      document.querySelectorAll('body > div').forEach((d) => { if (d.id !== (ruolo === 'auto' ? 'autoView' : 'boxView')) d.hidden = true; });
      if (ruolo === 'auto'){ document.getElementById('autoView').hidden = false; document.body.classList.add('is-auto'); applyAutoLayout('telefono'); timingView = 'categoria'; }
      else { document.getElementById('boxView').hidden = false; }
      const t = { position: 4, catName: 'CAT A', catPosition: 2, numberAhead: '56', nameAhead: 'ROSSI', numberBehind: '4', nameBehind: 'BIANCHI', gapAhead: '-12.4', gapBehind: '+5.8', catNumberAhead: '56', catNameAhead: 'ROSSI', catNumberBehind: '4', catNameBehind: 'BIANCHI', catGapAhead: '-12.4', catGapBehind: '+5.8' };
      renderTiming(t); renderFuel(62);
    }, ruolo);
    await pg.waitForTimeout(300);
  };
  // 1) vista auto identica
  const res = {};
  for (const [nome, w, h] of [['tel', 390, 800], ['orizz', 844, 390], ['tablet', 1024, 768]]) {
    const a = await b.newPage({ viewport: { width: w, height: h } }), c = await b.newPage({ viewport: { width: w, height: h } });
    await prep(a, 'http://localhost:8771/', 'auto'); await prep(c, 'http://localhost:8772/', 'auto');
    const [x, y] = [await a.screenshot(), await c.screenshot()];
    res['auto-' + nome] = Buffer.compare(x, y) === 0 ? 'IDENTICA' : 'DIVERSA';
    await a.close(); await c.close();
  }
  // 1b) schermata finale dell'auto (stanza FLATSIX): uguale a pitwallnew
  for (const [nome, w, h] of [['tel', 390, 800], ['orizz', 844, 390]]) {
    const a = await b.newPage({ viewport: { width: w, height: h } }), c = await b.newPage({ viewport: { width: w, height: h } });
    await prep(a, 'http://localhost:8771/', 'auto'); await prep(c, 'http://localhost:8772/', 'auto');
    for (const pg of [a, c]) { await pg.evaluate(() => { code = 'FLATSIX'; if (typeof applyFinishPhoto === 'function') applyFinishPhoto(null); renderFinishScreen({ phase: 'finished', finishBackground: 'photo', finishPosition: 3, finishDriverName: 'ROSSI' }); }); await pg.waitForTimeout(700); }
    res['finale-' + nome] = Buffer.compare(await a.screenshot(), await c.screenshot()) === 0 ? 'IDENTICA' : 'DIVERSA';
    await a.close(); await c.close();
  }
  // 2) box: overflow orizzontale e elementi fuori schermo
  for (const [nome, w, h] of [['tel', 360, 740], ['tel2', 390, 800], ['tablet', 1024, 768]]) {
    for (const tab of ['gara', 'timing', 'passo', 'settings']) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await prep(p, 'http://localhost:8771/', 'box');
      const r = await p.evaluate((tab) => {
        setBoxTab(tab);
        gpsApplicaConfig({ on: true, box: { lat: 1, lng: 1 }, refuel: { lat: 1, lng: 1 } }); gpsStato = 'rifornimento'; gpsStatoDa = Date.now() - 70000; gpsChiede = true; gpsUltima = { acc: 3 }; gpsUltimaBuona = Date.now(); gpsRender();
        const W = document.documentElement.clientWidth; const bad = [];
        document.querySelectorAll('#boxView *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && e.offsetParent !== null && (r.right > W + 1 || r.left < -1)) bad.push((e.id || e.className || e.tagName).toString().slice(0, 40) + ':' + Math.round(r.right)); });
        return { scrollW: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) };
      }, tab);
      res[`box-${nome}-${tab}`] = r.scrollW > r.W + 1 || r.bad.length ? JSON.stringify(r) : 'ok';
      await p.close();
    }
  }
  console.log(JSON.stringify(res, null, 1));
  const V = C.controlli('audit');
  for (const [k, v] of Object.entries(res)) V.ok(k, k.startsWith('box-') ? v === 'ok' : v === 'IDENTICA', v);
  await b.close(); s1.close(); s2.close(); V.fine();
})();
