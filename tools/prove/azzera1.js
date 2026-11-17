// "Azzera lo storico dei giri" azzera anche il distacco giro per giro (lista, copia sul telefono, scheda), anche quando
// l'azzeramento arriva da un altro telefono (passoAzzerato). Esce con 1 se un controllo fallisce.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8799, async () => {
  const V = C.controlli('azzera1');
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.H={};window.io=()=>({on(n,f){window.H[n]=f;},off(){},emit(n,d){(window.__em=window.__em||[]).push([n,d]);},connected:true,onAny(){}});window.confirm=()=>true;window.alert=()=>{};' }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8799/');
  await pg.evaluate(() => { role = 'box'; code = 'AZ'; socket = io(); boxPrimario = true; document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; }); registerListeners(); enterBoxView(); setBoxTab('passo'); });
  const riempi = () => pg.evaluate(() => { gapGiri = [{ n: 1, a: 10, b: 12, na: '5', nb: '7' }, { n: 2, a: 9, b: 13, na: '5', nb: '7' }]; crSalvaGap(); crRenderGapCard(); });
  const stato = () => pg.evaluate(() => ({ n: gapGiri.length, copia: localStorage.getItem('pc_gapgiri'), testo: document.getElementById('passoGapGiri').textContent }));
  await riempi();
  let s = await stato();
  V.ok('prima: due giri annotati, copia e scheda con i distacchi', s.n === 2 && s.copia && /#5/.test(s.testo), s);
  await pg.evaluate(() => passoAzzera());
  s = await stato();
  V.ok('Azzera storico: lista vuota, copia tolta, scheda "in attesa dei giri"', s.n === 0 && !s.copia && /in attesa dei giri/.test(s.testo), s);
  V.ok('Azzera storico: avvisa il server', (await pg.evaluate(() => window.__em)).some((e) => e[0] === 'passoAzzera'));
  await riempi();
  await pg.evaluate(() => window.H.passoAzzerato());
  s = await stato();
  V.ok('azzeramento da un altro telefono: azzera anche il distacco giro per giro', s.n === 0 && !s.copia && /in attesa dei giri/.test(s.testo), s);
  V.ok('nessun errore di pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
