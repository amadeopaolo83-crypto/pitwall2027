// Scheda "Strategia degli altri" nel box: riceve strategiaUpdate (dati veri del replay del finto ponte), mostra soste, safety, tabella del pit; nessun HTML iniettato dai nomi.
process.env.SIM_PONTE = '1';
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim9');
const Pista = require(C.ROOT + '/js/pista.js');
const gps = JSON.parse(fs.readFileSync(path.join(C.ROOT, '..', 'tools/sim/varano.json'), 'utf8')).gps;
const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
const corsa = Pista.pianifica(pista, [{ giri: 5, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 5, pit: { dove: 'corsia', sostaS: 70 } }, { giri: 5, pit: { dove: 'box', sostaS: 90 } }, { giri: 2 }], Object.assign({}, opz, { rallentamenti: [{ daGiro: 10, giri: 2, fattore: 0.55 }], pause: [{ giro: 7, durataS: 120 }] }));
const sp = require(C.SRC + '/simponte.js'), strat = require(C.SRC + '/strategia.js');
sp.avvia({ evento: 'S9', numero: '77', giroS: 100, passaggi: corsa.passaggi, finestre: corsa.finestre, pause: corsa.pauseT, tGara: 0, seme: 5, nAuto: 14 });
const s = sp._stati.get('S9');
let normale = null, safety = null, sosp = null;
for (let t = 1; t <= corsa.durata + 60; t += 2.5) {
  const r = strat.registra('S9', sp.classificaAl(s, t), '77', 1.7e12 + t * 1000);
  if (!sosp && r.sospensione) sosp = JSON.parse(JSON.stringify(r));
  if (!safety && r.safety && !r.sospensione) safety = JSON.parse(JSON.stringify(r));
  if (t > 1800 && !r.safety && !r.sospensione && !normale) normale = JSON.parse(JSON.stringify(r));
}
V.ok('dati di prova: normale, safety e sospensione tutti presenti', !!(normale && safety && sosp), [!!normale, !!safety, !!sosp]);

const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
srv.listen(8799, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 900 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const io = 'window.__h={};window.io=()=>({on(n,f){window.__h[n]=f},off(){},emit(...a){},connected:true,onAny(){}});';
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: io }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8799/');
  await pg.evaluate(() => { role = 'box'; code = 'S9'; socket = io(); });
  await pg.evaluate(() => { document.querySelectorAll('.box-tab').forEach((t) => t.hidden = true); $('boxTab_passo').hidden = false; document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; }); });
  const testo = () => pg.evaluate(() => $('strategiaBox').innerText);
  V.ok('prima dei dati: messaggio di attesa, nessun errore', /live timing/i.test(await testo()));
  V.ok('connection.js ascolta strategiaUpdate', fs.readFileSync(C.ROOT + '/js/connection.js', 'utf8').includes("'strategiaUpdate'"));
  await pg.evaluate((r) => strategiaRicevi(r), normale);
  const t1 = await testo();
  const nSoste = normale.rivali.reduce((a, x) => a + x.soste.length, 0);
  V.ok('tabella: una riga per ogni rivale (' + normale.rivali.length + ')', (await pg.evaluate(() => document.querySelectorAll('#strategiaBox .strat-t tbody tr').length)) === normale.rivali.length);
  V.ok('mostra il nostro pit (perdita e giro consigliato)', /Il nostro pit/.test(t1) && new RegExp('giro\\s*' + normale.sugg.migliore.giro).test(t1), t1.slice(0, 200));
  V.ok('8 caselle di giri con la posizione prevista', (await pg.evaluate(() => document.querySelectorAll('#strategiaBox .strat-tab span').length)) === normale.sugg.tabella.length);
  V.ok('le soste dei rivali compaiono (' + nSoste + ' in totale, tipo scritto in italiano)', /rifornimento|cambio pilota\?|sosta lunga/.test(t1) && nSoste > 5);
  await pg.locator('#strategiaBox').scrollIntoViewIfNeeded(); await pg.screenshot({ path: C.OUT + '/strategia-normale.png' });
  await pg.evaluate((r) => strategiaRicevi(r), safety);
  V.ok('safety: banner giallo', /Safety car/.test(await testo()) && await pg.evaluate(() => !!document.querySelector('#strategiaBox .strat-sc')));
  await pg.evaluate((r) => strategiaRicevi(r), sosp);
  V.ok('sospensione: banner rosso', await pg.evaluate(() => !!document.querySelector('#strategiaBox .strat-red')));
  await pg.screenshot({ path: C.OUT + '/strategia-sospesa.png' });
  // nomi con HTML: non si deve eseguire nulla (il testo del rivale e' del live timing)
  const sporco = JSON.parse(JSON.stringify(normale)); sporco.rivali[0].numero = '<img src=x onerror="window.__xss=1">'; sporco.rivali[0].soste[0] = { giro: 3, tipo: '<b onclick="window.__xss=1">x</b>', extraS: 50 };
  await pg.evaluate((r) => strategiaRicevi(r), sporco); await pg.waitForTimeout(200);
  V.ok('XSS: HTML nei campi del live timing resta testo', await pg.evaluate(() => !window.__xss && !document.querySelector('#strategiaBox img, #strategiaBox b[onclick]')));
  await pg.evaluate(() => strategiaRicevi(null)); await pg.evaluate(() => strategiaRicevi({}));
  V.ok('dati vuoti o rotti: nessun errore', errs.length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
