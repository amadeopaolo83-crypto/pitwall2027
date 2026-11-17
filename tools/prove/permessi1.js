// Tasto "Attiva le notifiche" in fondo alle Impostazioni (browser e app Android). Esce con 1 se un controllo fallisce.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8799, async () => {
  const V = C.controlli('permessi1');
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.H={};window.io=()=>({on(n,f){window.H[n]=f;},off(){},emit(n,d){(window.__em=window.__em||[]).push([n,d]);},connected:true,onAny(){}});window.confirm=()=>true;window.alert=()=>{};' }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8799/');
  await pg.evaluate(() => { role = 'box'; code = 'PE'; socket = io(); boxPrimario = true; document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; }); registerListeners(); enterBoxView(); setBoxTab('settings'); });
  const riempi = () => pg.evaluate(() => { gapGiri = [{ n: 1, a: 10, b: 12, na: '5', nb: '7' }, { n: 2, a: 9, b: 13, na: '5', nb: '7' }]; crSalvaGap(); crRenderGapCard(); });
  const stato = () => pg.evaluate(() => ({ testo: document.getElementById('permessiStato').textContent, aiuto: document.getElementById('permessiAiuto').textContent }));
  // browser senza permesso: stato "non ancora attivate"
  await pg.evaluate(() => { window.Notification = { permission: 'default', requestPermission: async () => { window.__chiesto = true; Notification.permission = 'granted'; return 'granted'; } }; permessiRender(); });
  let s = await stato();
  V.ok('browser: stato "non ancora attivate"', /non ancora/.test(s.testo), s);
  await pg.evaluate(() => attivaNotificheTelefono()); await pg.waitForTimeout(200);
  V.ok('browser: il tasto chiede il permesso e poi lo stato e\' "attive"', (await pg.evaluate(() => window.__chiesto)) === true && /attive$/.test((await stato()).testo), await stato());
  await pg.evaluate(() => { window.Notification.permission = 'denied'; permessiRender(); attivaNotificheTelefono(); }); await pg.waitForTimeout(100);
  s = await stato();
  V.ok('browser: bloccate -> spiega come riattivarle', /NON attive/.test(s.testo) && /lucchetto/.test(s.aiuto), s);
  // app Android: il tasto chiama il telefono
  await pg.evaluate(() => { window.__chiamato = 0; window.PitCommAndroid = { stato: () => JSON.stringify({ notifiche: false }), attivaNotifiche: () => { window.__chiamato++; } }; permessiRender(); attivaNotificheTelefono(); });
  s = await stato();
  V.ok('Android: notifiche spente -> avviso e il tasto chiama attivaNotifiche', /NON attive/.test(s.testo) && (await pg.evaluate(() => window.__chiamato)) === 1, s);
  V.ok('la scheda e\' in fondo alle Impostazioni', await pg.evaluate(() => { const c = document.querySelectorAll('#boxTab_settings > .card'); return c[c.length - 1].id === 'permessiCard'; }));
  V.ok('nessun errore di pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
