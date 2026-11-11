// Box: ogni cosa che si tocca deve essere almeno 52x52 px (con i guanti), su telefono, tablet e in
// orizzontale, di giorno e di notte, e nessuna scheda deve uscire dallo schermo in larghezza.
// La vista auto qui non si guarda: la controlla audit.js (identica a pitwallnew).
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const MIN = 52;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8793, async () => {
  const V = C.controlli('tocchi');
  const b = await chromium.launch();
  for (const [nome, w, h] of [['tel360', 360, 740], ['tel390', 390, 800], ['orizz', 844, 390], ['tablet', 1024, 768]]) {
    for (const notte of [false, true]) {
      const pg = await b.newPage({ viewport: { width: w, height: h } });
      const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},off(){},emit(){},connected:true,onAny(){}});' }));
      await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
      await pg.goto('http://localhost:8793/');
      const r = await pg.evaluate(async (notte) => {
        role = 'box'; code = 'FLATSIX'; socket = io();
        document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; });
        document.body.classList.toggle('night', notte);
        enterBoxView();
        gpsApplicaConfig({ on: true, box: { lat: 1, lng: 1 }, refuel: { lat: 1, lng: 1 } }); gpsChiede = true; gpsUltima = { acc: 3 }; gpsUltimaBuona = Date.now(); gpsRender();
        const piccoli = [], fuori = []; let tot = 0; const W = document.documentElement.clientWidth;
        for (const tab of ['comm', 'gara', 'timing', 'passo', 'settings']) {
          setBoxTab(tab);
          await new Promise((ok) => setTimeout(ok, 50));
          document.querySelectorAll('#boxView button, #boxView input, #boxView select, #boxView textarea, #boxView [onclick]').forEach((e) => {
            if (e.type === 'hidden' || e.type === 'file') return;
            const vis = e.type === 'checkbox' ? e.parentElement : e;
            if (!vis || vis.offsetParent === null) return;
            const q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
            tot++;
            const card = vis.closest('.card');
            if (card) { const c = card.getBoundingClientRect(), cs = getComputedStyle(card); if (q.right > c.right - parseFloat(cs.paddingRight) + 1 || q.left < c.left + parseFloat(cs.paddingLeft) - 1) fuori.push(tab + ':' + (e.id || e.textContent.trim().slice(0, 16) || e.type) + ' fuori dal riquadro'); }
            if (q.height < 52 - 0.5 || q.width < 52 - 0.5) piccoli.push(tab + ':' + (e.id || e.textContent.trim().slice(0, 16) || e.type) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
          });
          if (document.documentElement.scrollWidth > W + 1) fuori.push(tab + ':' + document.documentElement.scrollWidth);
        }
        return { tot, piccoli, fuori };
      }, notte);
      const et = nome + (notte ? '-notte' : '-giorno');
      V.ok(et + `: tutti i ${r.tot} tocchi >= ${MIN} px`, r.piccoli.length === 0, r.piccoli.slice(0, 12).join(' ; ') + (r.piccoli.length > 12 ? ` ... (${r.piccoli.length})` : ''));
      V.ok(et + ': niente esce dallo schermo o dal suo riquadro', r.fuori.length === 0, r.fuori);
      V.ok(et + ': nessun errore', C.erroriVeri(errs).length === 0, errs);
      if (!notte) await pg.screenshot({ path: path.join(C.OUT, 'tocchi-' + nome + '.png'), fullPage: true });
      await pg.close();
    }
  }
  await b.close(); srv.close(); V.fine();
});
