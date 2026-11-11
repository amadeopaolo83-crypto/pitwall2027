// Lancio simulato: l'auto gira col ritmo del cursore, la gara parte al primo passaggio dopo lo zero; e l'app auto riceve la posizione dal simulatore.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim7'); const root = C.ROOT;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
const stub = `window.__em=[];window.io=()=>{const s={connected:true,on(n,f){if(n==='connect')setTimeout(f,0)},off(){},disconnect(){},emit(...a){window.__em.push(a);const k=a[a.length-1];if(a[0]==='join'&&typeof k==='function')k({ok:true,state:{gps:{on:true}}})}};return s};`;
srv.listen(8778, async () => {
  const b = await chromium.launch();
  // ---------- A: logica del lancio (tempo finto) ----------
  async function lancio(ritmo, zero) {
    const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
    await pg.addInitScript(() => { window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, auto: 14 }) }); });
    await pg.clock.install({ time: 1.7e12 });
    await pg.goto('http://localhost:8778/sim.html');
    await pg.click('#esempio'); await pg.fill('#giro', '0'); await pg.selectOption('#uscita', 'server'); await pg.evaluate((r) => { document.getElementById('ritmo').value = r; }, String(ritmo));
    await pg.fill('#piano', 'lancio ' + zero + '\n1'); await pg.uncheck('#timing'); await pg.click('#via');
    await pg.clock.runFor((zero + 130) * 1000);
    const log = await pg.textContent('#log'); const pos = await pg.evaluate(() => window.__em.filter((e) => e[0] === 'gpsPos').map((e) => e[1]));
    await pg.close();
    return { log, pos, errs };
  }
  const n = await lancio(1, 150);
  const cross = [...n.log.matchAll(/VERO: passaggio sul traguardo \(([+-]?[\d.]+) s dallo zero/g)].map((m) => Number(m[1]));
  V.ok('nel lancio l\'auto passa sulla linea piu\' volte (e il registro dice quanto prima/dopo lo zero)', cross.length >= 2 && cross.some((x) => x < 0), cross);
  const dopo = cross.find((x) => x >= 0);
  V.ok('la gara parte al primo passaggio dopo lo zero (+' + (dopo || 0).toFixed(1) + ' s)', dopo != null && new RegExp('partenza gara \\(primo passaggio dopo lo zero: 0:0\\d').test(n.log) || (dopo != null && /partenza gara/.test(n.log)), n.log.slice(-300));
  V.ok('i passaggi prima dello zero non fanno partire la gara', n.log.indexOf('partenza gara') > n.log.indexOf('passaggio sul traguardo (-'), n.log.slice(0, 400));
  V.ok('l\'auto si muove nel lancio (velocita\' fino a 100+ km/h)', Math.max(...n.pos.map((p) => p.v)) * 3.6 > 100, Math.max(...n.pos.map((p) => p.v)) * 3.6);
  const primo = cross[0];
  const l = await lancio(0.7, 150);
  const cross2 = [...l.log.matchAll(/VERO: passaggio sul traguardo \(([+-]?[\d.]+) s dallo zero/g)].map((m) => Number(m[1]));
  V.ok('con il ritmo al 70% il primo passaggio e\' piu\' tardi (' + cross2[0] + ' contro ' + primo + ' s dallo zero)', cross2.length >= 1 && cross2[0] > primo + 15, [primo, cross2[0]]);
  V.ok('nessun errore nella pagina (A)', n.errs.length === 0 && l.errs.length === 0, [n.errs, l.errs]);

  // ---------- B: l'app auto prende la posizione dal simulatore (stesso browser, BroadcastChannel) ----------
  const ctx = await b.newContext();
  const car = await ctx.newPage(), sim = await ctx.newPage(); const errs = [];
  car.on('pageerror', (e) => errs.push('auto:' + e.message)); sim.on('pageerror', (e) => errs.push('sim:' + e.message));
  for (const pg of [car, sim]) {
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
    await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
    await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  }
  await car.goto('http://localhost:8778/?sim=1');
  await car.evaluate(() => { role = 'auto'; code = 'SIM'; socket = io(); document.querySelectorAll('body > div').forEach((d) => { d.hidden = true; }); document.getElementById('autoView').hidden = false; gpsApplicaConfig({ on: true }, true); gpsAggiornaInvio(); });
  V.ok('?sim=1 accende il GPS simulato sull\'app auto', await car.evaluate(() => gpsSimAttivo() && gpsWatch !== null));
  await sim.goto('http://localhost:8778/sim.html');
  await sim.click('#esempio'); await sim.fill('#giro', '0'); await sim.uncheck('#timing'); await sim.fill('#piano', 'lancio 60\n1'); await sim.click('#via');
  await sim.waitForTimeout(6500);
  const em = await car.evaluate(() => window.__em.filter((e) => e[0] === 'gpsPos').map((e) => e[1]));
  const pt = await car.evaluate(() => (typeof laPrec !== 'undefined' && laPrec) ? { lat: laPrec.lat, lng: laPrec.lng } : null);
  V.ok('l\'app auto riceve i punti e li manda al server come gpsPos (' + em.length + ' in 6 s)', em.length >= 4 && em.every((p) => Math.abs(p.lat - 45.1) < 0.05 && Math.abs(p.lng - 10.03) < 0.05), em.slice(0, 2));
  V.ok('i punti arrivano anche alla fascia di lancio (laPrec)', !!pt, pt);
  V.ok('la velocita\' cresce (parte da ferma)', em.length >= 4 && em[em.length - 1].v > em[0].v, [em[0] && em[0].v, em.length && em[em.length - 1].v]);
  await sim.click('#stop');
  await car.goto('http://localhost:8778/?sim=0');
  V.ok('?sim=0 spegne il GPS simulato', await car.evaluate(() => !gpsSimAttivo()));
  V.ok('nessun errore nelle pagine (B)', errs.length === 0, errs);
  V.fine(); await b.close(); srv.close();
});
