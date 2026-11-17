// Genera le schermate d'esempio del manuale (docs/manuale/img/*.png) con dati finti ma realistici.
// Uso: NODE_PATH=... node tools/manuale/schermate.js [cartella-uscita]
// Non serve il server: la pagina vera gira con un finto socket e le funzioni dell'app ricevono lo stesso tipo di dati del server.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..'), ROOT = path.join(REPO, 'public');
const OUT = process.argv[2] || path.join(REPO, 'docs', 'manuale', 'img');
fs.mkdirSync(OUT, { recursive: true });
const C = require('../prove/comune');

// ---- campo gara finto, calcolato con il vero modulo del passo e della strategia ----
const passo = require(path.join(REPO, 'src', 'passo.js')), strategia = require(path.join(REPO, 'src', 'strategia.js'));
const CODE = 'DEMO';
const auto = [ // numero, classe, ritmo base (s), giri alla sosta
  { n: '9', c: 'GTE', b: 100.6, sosta: [14, 29] }, { n: '7', c: 'GT', b: 101.2, sosta: [13, 28] }, { n: '1', c: 'GT', b: 101.9, sosta: [14, 29] },
  { n: '22', c: 'GT', b: 102.7, sosta: [15, 30] }, { n: '88', c: 'TCR', b: 105.2, sosta: [16, 31] }, { n: '31', c: 'TCR', b: 105.9, sosta: [15, 30] },
];
const NOI = '1', t0 = Date.now() - 41 * 60000;
const tot = auto.map(() => 0), best = auto.map(() => 999);
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let ultimeRighe = null;
const NG = 24;
for (let giro = 1; giro <= NG; giro++) {
  const tl = auto.map((a) => +(a.b + (rnd() - 0.5) * 0.8 + (giro === 1 ? 6 : 0) + (a.sosta.includes(giro) ? 46 : 0)).toFixed(3));
  tl.forEach((t, i) => { tot[i] += t; if (giro > 1 && t < best[i] && t > 20) best[i] = t; });
  const ordine = auto.map((a, i) => i).sort((x, y) => tot[x] - tot[y]);
  const righe = auto.map((a, i) => ({ numero: a.n, classe: a.c, giri: giro, ultimoGiro: tl[i], migliorGiro: giro > 1 ? +best[i].toFixed(3) : null, pos: ordine.indexOf(i) + 1 }));
  ultimeRighe = { ordine, righe };
  const ts = t0 + tot[2] * 1000;
  passo.registra(CODE, righe, NOI, ts);
  try { strategia.registra(CODE, righe, NOI, ts); } catch (e) { /* facoltativo */ }
}
const riep = passo.riepilogo(CODE), st = passo.storico(CODE); riep.nuovi = st.giri;
const strat = strategia.ultima(CODE);
// distacchi dalla classifica finta (stessi numeri della tabella del passo)
const iN = auto.findIndex((a) => a.n === NOI), ordF = ultimeRighe.ordine, pN = ordF.indexOf(iN);
const dav = auto[ordF[pN - 1]], dietro = auto[ordF[pN + 1]];
const gap = (x, y) => (Math.abs(tot[x] - tot[y])).toFixed(1);
const iD = ordF[pN - 1], iT = ordF[pN + 1];
const timing = { position: pN + 1, catName: 'GT', catPosition: 2, numberAhead: auto[iD].n, nameAhead: 'TEAM ' + auto[iD].n, numberBehind: auto[iT].n, nameBehind: 'TEAM ' + auto[iT].n, gapAhead: '-' + gap(iN, iD), gapBehind: '+' + gap(iN, iT),
  catNumberAhead: '7', catNameAhead: 'TEAM ROSSI', catNumberBehind: '22', catNameBehind: 'TEAM BIANCHI', catGapAhead: '-' + gap(iN, auto.findIndex((a) => a.n === '7')), catGapBehind: '+' + gap(iN, auto.findIndex((a) => a.n === '22')) };

const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });

const STUB = 'window.H={};window.__em=[];window.io=()=>({on(n,f){window.H[n]=f;},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});';
const circ = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'sim', 'varano.json'), 'utf8')).gps;

srv.listen(8765, async () => {
  const b = await chromium.launch();
  const nuova = async (w, h, ruolo, extra) => {
    const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await pg.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: C.tessera() }));
    await pg.addInitScript(() => { navigator.geolocation.watchPosition = (cb) => { window.__w = cb; return 5; }; navigator.geolocation.clearWatch = () => {}; navigator.geolocation.getCurrentPosition = (cb) => cb({ coords: { latitude: 45.1, longitude: 9.2, accuracy: 4 } }); });
    await pg.goto('http://localhost:8765/');
    if (ruolo) await pg.evaluate(([ruolo, CODE]) => { role = ruolo; code = CODE; socket = io(); registerListeners(); document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== (ruolo === 'auto' ? 'autoView' : 'boxView'); }); if (ruolo === 'auto') { document.body.classList.add('is-auto'); applyAutoLayout('telefono'); } }, [ruolo, CODE]);
    return pg;
  };
  const dati = { riep, strat, circ };
  const timer = (fase, extra) => Object.assign({ phase: fase, startSeconds: 900, startRemaining: 900, startRunning: false, startUpdatedAt: Date.now(), raceSeconds: 21600, raceRemaining: 19140, raceRunning: true, raceUpdatedAt: Date.now(), speed: 1, finishMode: 'manual', finishBackground: 'photo', finishTriggered: false, finishPosition: null, finishDriverName: '', source: 'manual', aubInfo: '', aubError: '' }, extra || {});
  const gpsCfg = Object.assign({}, circ, { on: true });

  // ---------- ACCESSO ----------
  let pg = await nuova(390, 800); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, '01-accesso.png') }); await pg.close();

  // ---------- AUTO ----------
  const autoPg = async (w, h, fn, nome, notte) => {
    const p = await nuova(w, h, 'auto');
    await p.evaluate(([timing, timer, notte]) => { document.body.classList.toggle('night', !!notte); timingView = 'categoria'; renderTiming(timing); renderFuel(62); applyTimerState(timer); }, [timing, timer('race'), notte]);
    if (fn) await p.evaluate(fn);
    await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, nome + '.png') }); await p.close();
  };
  const aut = () => { window.H.autonomyUpdate({ minutes: 74 }); };
  await autoPg(844, 390, aut, '02-auto-giorno');
  await autoPg(844, 390, aut, '03-auto-notte', true);
  await autoPg(390, 800, aut, '04-auto-verticale');
  await autoPg(844, 390, () => { applyTimerState({ phase: 'start', startSeconds: 900, startRemaining: 600, startRunning: true, startUpdatedAt: Date.now(), raceSeconds: 21600, raceRemaining: 21600, raceRunning: false, raceUpdatedAt: Date.now(), speed: 1, finishMode: 'manual', finishBackground: 'photo', finishTriggered: false, source: 'manual' }); }, '05-auto-partenza');
  await autoPg(844, 390, () => { showFlash({ text: 'BOX BOX', color: '#e5322d', durationSeconds: 60 }); speechSynthesis.cancel(); }, '06-auto-messaggio');
  { const p = await nuova(844, 390, 'auto'); await p.evaluate(([t]) => { code = 'FLATSIX'; applyFinishPhoto(null); renderFinishScreen(Object.assign({}, t, { phase: 'finished', finishBackground: 'photo', finishPosition: 2, finishDriverName: 'Mario Rossi' })); }, [timer('finished')]); await p.waitForTimeout(800); await p.screenshot({ path: path.join(OUT, '07-auto-arrivo.png') }); await p.close(); }

  // ---------- BOX ----------
  const bx = await nuova(390, 800, 'box');
  await bx.evaluate(([timing, timer, dati, gpsCfg]) => {
    boxPrimario = true; enterBoxView();
    applyTimerState(timer); renderTiming(timing); renderFuel(62);
    fuelSystem = Object.assign({}, fuelSystem, { tankCapacityLiters: 100, currentLiters: 62, consumptionRatePerHour: 54, onTrack: true, sessionStartAt: Date.now() - 41 * 60000, sessionStartLiters: 100 }); renderFuelSystemUI && renderFuelSystemUI();
    const m = (min, label) => ({ id: 'm' + min, label, at: Date.now() - min * 60000 });
    mergeHistory([m(14, 'Box'), m(9, 'Ripeti'), m(4, 'Rifornimento'), m(1, 'Pilota')], false);
    gpsApplicaConfig(gpsCfg, true);
    passoRicevi(Object.assign({}, dati.riep, { numero: '1' })); ponteStatoUltimo = { connected: true }; timingRicevutoAt = Date.now(); gpsCambio.da = Date.now() - 45 * 60000; gpsCambio.pistaMs = 41 * 60000; gpsCambio.n = 2; window.H.autonomyUpdate({ minutes: 74 }); crRenderCruscotto(); crRenderCategoria();
    if (typeof strategiaRicevi === 'function' && dati.strat) strategiaRicevi(dati.strat);
    pisteApplica([{ nome: 'Varano', at: Date.now() - 86400000, el: 6 }, { nome: 'Magny-Cours', at: Date.now() - 6 * 86400000, el: 6 }, { nome: 'Le Mans (da rifare)', at: Date.now() - 20 * 86400000, el: 3 }], 'Varano');
    renderPonteStatus({ connected: true, status: 'in ascolto', provider: 'Live timing', eventName: '24 Ore di prova', driverNumber: '1', session: 'Gara', updatedAt: Date.now() });
  }, [timing, timer('race'), dati, gpsCfg]);
  const tab = async (t, nome, sel) => {
    await bx.evaluate((t) => setBoxTab(t), t); await bx.waitForTimeout(350);
    if (sel) { const el = bx.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(OUT, nome + '.png') }); }
    else { await bx.evaluate(() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }); await bx.waitForTimeout(150); await bx.screenshot({ path: path.join(OUT, nome + '.png') }); }
  };
  await tab('comm', '10-box-comm');
  await tab('gara', '11-box-gara');
  await tab('gara', '12-box-gara-cruscotto', '.card:has(h3:text-is("Cruscotto"))');
  await tab('gara', '13-box-gara-distacchi', '#catCard');
  await tab('gara', '14-box-gara-turno', '.card:has(h3:text-is("Turno pilota"))');
  await tab('gara', '15-box-gara-carburante', '.card:has(h3:text-is("Carburante & autonomia"))');
  await tab('passo', '16-box-passo');
  await tab('settings', '20-box-impostazioni');
  await tab('settings', '21-box-piste', '.card:has(h3:text-is("Piste (libreria)"))');
  await tab('settings', '22-box-gps', '#gpsCard');
  await tab('settings', '23-box-allarmi', '.card:has(h3:text-is("Allarmi di gara"))');
  await tab('settings', '24-box-notifiche', '#permessiCard');
  await tab('timing', '25-box-timing');
  await tab('timing', '26-box-timer', '.card:has(h3:text-is("Timer gara"))');
  await bx.close();

  // ---------- MAPPA ----------
  const mp = await nuova(390, 800, 'box');
  await mp.evaluate(([gpsCfg]) => { boxPrimario = true; enterBoxView(); gpsApplicaConfig(gpsCfg, true); }, [gpsCfg]);
  await mp.evaluate(() => mappaApri('tracciato'));
  await mp.waitForFunction(() => window.L && typeof mp !== 'undefined' && mp.mappa, null, { timeout: 8000 }).catch(() => {});
  await mp.waitForTimeout(900);
  for (const [modo, nome] of [['tracciato', '30-mappa-tracciato'], ['box', '31-mappa-box'], ['rifornimento', '32-mappa-rifornimento'], ['corsia', '33-mappa-corsia'], ['traguardo', '34-mappa-traguardo'], ['calibra', '35-mappa-calibra'], ['sposta', '36-mappa-sposta'], ['circuito', '37-mappa-circuito']]) {
    await mp.evaluate((m) => mpVaiA(m), modo); await mp.waitForTimeout(700);
    await mp.screenshot({ path: path.join(OUT, nome + '.png') });
  }
  await mp.close();
  await b.close(); srv.close();
  console.log('schermate in', OUT, fs.readdirSync(OUT).length);
});
