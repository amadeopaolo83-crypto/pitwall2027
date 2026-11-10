const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/pitwall2027/public';
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8774, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { let off = 0; const real = Date.now.bind(Date); Date.now = () => real() + off; window.__avanza = (s) => { off += s * 1000; };
    window.__w = { cb: null }; navigator.geolocation.watchPosition = (cb) => { window.__w.cb = cb; return 9; }; navigator.geolocation.clearWatch = () => { window.__w.cb = null; }; });
  await pg.goto('http://localhost:8774/');
  const R = await pg.evaluate(async () => {
    const out = {}; const A = window.__avanza;
    role = 'auto'; code = 'FLATSIX'; socket = io();
    document.querySelectorAll('body > div').forEach((d) => { d.hidden = true; }); document.getElementById('autoView').hidden = false;
    // pista: cerchio di 200 m, centro 45/9, si parte sul punto est e si gira in senso antiorario
    const RAG = 200, k = 111320, kl = k * Math.cos(45 * Math.PI / 180);
    const punto = (ang, rr = RAG) => ({ lat: 45 + rr * Math.sin(ang) / k, lng: 9 + rr * Math.cos(ang) / kl });
    const linea = [punto(0, 180), punto(0, 220)];
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    // stato dell'auto
    const auto = { ang: -0.15, v: 20 };            // m/s sul cerchio
    const tempoGiro = () => 2 * Math.PI * RAG / auto.v;
    const campiona = (rumore = 1.5) => {
      A(1);
      auto.ang += auto.v / RAG;                    // 1 s
      const p = punto(auto.ang);
      window.__w.cb({ coords: { latitude: p.lat + rnd() * 2 * rumore / k, longitude: p.lng + rnd() * 2 * rumore / kl, accuracy: 4, speed: auto.v }, timestamp: Date.now() });
    };
    gpsApplicaConfig({ on: true, traguardo: linea, lancioS: 240 }, true);
    const emessi = () => window.__em.filter((e) => e[0] === 'gpsGiroRif');
    // timer di partenza: lo zero cade tra 330 s (3,3 giri di 62,8 s... si guarda piu' sotto)
    const timer = (rem) => applyTimerState({ phase: 'start', startSeconds: 1800, startRemaining: rem, startUpdatedAt: nowSync(), startRunning: true, raceSeconds: 86400, raceRemaining: 86400, raceUpdatedAt: nowSync(), raceRunning: false, speed: 1, finishMode: 'manual', finishBackground: 'photo' });
    timer(400);
    // 1) senza giro di riferimento la vista auto non cambia
    for (let i = 0; i < 20; i++) campiona();
    out.senzaRif = [document.getElementById('autoView').classList.contains('lancio'), document.getElementById('lancioGuida').hidden];
    // 2) due giri pieni: il primo parte dal passaggio sulla linea, il secondo lo chiude -> riferimento
    for (let i = 0; i < 140; i++) campiona();
    const g = emessi();
    out.giriEmessi = g.length; out.rif = g[0] ? { t: g[0][1].t, n: g[0][1].p.length } : null;
    out.localeT = laLocale ? laLocale.t : null; out.giroVero = Math.round(tempoGiro() * 100) / 100;
    // 3) la fascia: si fissa lo zero a un numero di giri esatto dal prossimo passaggio e si verifica la stima
    //    prossimo passaggio sulla linea tra: si cerca con un conto a parte
    const tPross = () => { const a = ((auto.ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return ((2 * Math.PI - a) % (2 * Math.PI)) / (auto.v / RAG); };
    const tp = tPross(); out.prossimoPassaggio = Math.round(tp * 10) / 10;
    // zero tra: tp + 2 giri - 1 s  => il passaggio ideale (+1 s) e' il terzo
    const zeroTra = tp + 2 * tempoGiro() - 0.0;
    timer(zeroTra); // lo zero coincide con il terzo passaggio: d previsto = 0
    const serie = [];
    for (let i = 0; i < 60; i++) {
      campiona();
      if (i % 10 === 9) serie.push({ i, e: laRis && !laRis.fuori ? +laRis.e.toFixed(2) : null, d: laRis && !laRis.fuori ? +laRis.d.toFixed(2) : null, k: laRis ? laRis.k : null, r: +laR.toFixed(3), cmd: document.getElementById('lancioCmd').textContent, val: document.getElementById('lancioVal').textContent });
    }
    out.serieNormale = serie.map((x) => [x.i, x.e, x.d, x.k, x.r, x.cmd, x.val].join(" | "));
    out.vista = [document.getElementById('autoView').classList.contains('lancio'), document.getElementById('lancioGuida').hidden];
    // 4) il pilota rallenta del 10%: il ritmo si adegua e la stima cambia
    auto.v = 18;
    const serie2 = [];
    for (let i = 0; i < 30; i++) { campiona(); if (i % 10 === 9) serie2.push({ i, r: +laR.toFixed(3), e: laRis && !laRis.fuori ? +laRis.e.toFixed(2) : null, cmd: document.getElementById('lancioCmd').textContent }); }
    out.serieLento = serie2.map((x) => [x.i, x.r, x.e, x.cmd].join(" | "));
    return out;
  });
  console.log(JSON.stringify(R, null, 1)); console.log('errs', errs);
  await pg.screenshot({ path: '/tmp/demo/lancio-app.png' });
  await b.close(); srv.close();
});
