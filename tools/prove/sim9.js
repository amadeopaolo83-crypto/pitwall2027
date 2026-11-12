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
  V.ok('giri lenti per tutti: banner giallo', /Giri lenti per tutti/.test(await testo()) && await pg.evaluate(() => !!document.querySelector('#strategiaBox .strat-sc')));
  await pg.evaluate((r) => strategiaRicevi(r), sosp);
  V.ok('gara ferma: banner rosso', await pg.evaluate(() => !!document.querySelector('#strategiaBox .strat-red')));
  await pg.screenshot({ path: C.OUT + '/strategia-sospesa.png' });
  // nomi con HTML: non si deve eseguire nulla (il testo del rivale e' del live timing)
  const sporco = JSON.parse(JSON.stringify(normale)); sporco.rivali[0].numero = '<img src=x onerror="window.__xss=1">'; sporco.rivali[0].soste[0] = { giro: 3, tipo: '<b onclick="window.__xss=1">x</b>', extraS: 50 };
  await pg.evaluate((r) => strategiaRicevi(r), sporco); await pg.waitForTimeout(200);
  V.ok('XSS: HTML nei campi del live timing resta testo', await pg.evaluate(() => !window.__xss && !document.querySelector('#strategiaBox img, #strategiaBox b[onclick]')));
  // scheda Gara: "NOI" mostra il giro e l'ultimo giro (dal passo)
  const noi = await pg.evaluate(() => {
    lastTiming = { position: 5, catName: 'A', catPosition: 3, catNumberAhead: '10', catNameAhead: 'X', catGapAhead: '+2.0', catNumberBehind: '18', catNameBehind: 'Y', catGapBehind: '-3.0' };
    passoRis = { numero: '77', mio: { giri: 12, ultimo: 101.234, best: 100.9, m: {} }, auto: {} };
    role = 'box'; crRenderCategoria(); crRenderCruscotto();
    return { riga: document.querySelector('#catPosto .cat-noi').innerText, cruscotto: $('crCruscotto').innerText };
  });
  V.ok('scheda Gara, riga NOI: giri e ultimo giro', /giri 12/.test(noi.riga) && /ultimo 1:41\.2/.test(noi.riga), noi.riga);
  V.ok('Cruscotto: prima riga NOI con giro e ultimo', /NOI: giri 12 · ultimo 1:41\.2/.test(noi.cruscotto), noi.cruscotto.slice(0, 120));
  // giri dalla PARTENZA: il riscaldamento (giri prima dello zero del timer di gara) non conta
  const gg = await pg.evaluate(() => {
    const ora = nowSync(), r = {};
    passoRis = { numero: '77', mio: { giri: 15, ultimo: 101.234, best: 100.9, m: {} }, auto: {} };
    const timer = (phase, trascorso, run) => ({ phase, startSeconds: 300, startRemaining: 0, startRunning: false, startUpdatedAt: ora, raceSeconds: 2400, raceRemaining: 2400 - trascorso, raceRunning: run, raceUpdatedAt: ora, speed: 1 });
    // 3 giri di riscaldamento registrati prima dello zero, poi 12 di gara
    passoLocale = { numero: '77', giri: [1, 2, 3].map((n) => ({ n, t: 100, ts: ora - 1500000 - (4 - n) * 100000, v: true, s: 0 })).concat(Array.from({ length: 12 }, (_, k) => ({ n: 4 + k, t: 100, ts: ora - 1200000 + k * 100000, v: true, s: 0 }))) };
    try{ localStorage.removeItem('pc_gara_inizio'); }catch(e){}
    lastTimerState = timer('race', 1500, true);
    r.race = crNoiTxt(); r.n = crGiriGara();
    lastTimerState = timer('start', 0, false);
    r.lancio = crNoiTxt();
    lastTimerState = timer('race', 1500, true); crGiriGara();               // ricorda l'inizio
    lastTimerState = timer('race', 1500, false);                            // gara in pausa: l'inizio non scivola avanti
    r.pausa = crGiriGara();
    lastTimerState = null; passoLocale = { numero: null, giri: [] };
    r.senzaTimer = crGiriGara();
    return r;
  });
  V.ok('NOI: i giri contano dalla partenza (15 del timing - 3 di riscaldamento = 12)', gg.n === 12 && /giri 12 · ultimo 1:41\.2/.test(gg.race), gg);
  V.ok('NOI: nel lancio "giri 0"', /giri 0 /.test(gg.lancio), gg.lancio);
  V.ok('NOI: gara in pausa, il conto non cambia', gg.pausa === 12, gg.pausa);
  V.ok('NOI: senza timer o senza storico resta il conto del live timing', gg.senzaTimer === 15, gg.senzaTimer);
  await pg.evaluate(() => { passoRis = null; crRenderCategoria(); crRenderCruscotto(); });
  V.ok('senza dati del passo: niente scritte false', await pg.evaluate(() => !/giro/.test(document.querySelector('#catPosto .cat-noi').innerText) && !/NOI:/.test($('crCruscotto').innerText)));
  await pg.evaluate(() => strategiaRicevi(null)); await pg.evaluate(() => strategiaRicevi({}));
  V.ok('dati vuoti o rotti: nessun errore', errs.length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
