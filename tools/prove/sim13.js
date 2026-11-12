// Prova colori: (1) il nostro primo giro non e' il passaggio di 2,5 s dopo il via (falsava il miglior giro e rendeva "non valido"
// ogni giro: passo e colori restavano fermi); (2) scenario "rivali fissi": davanti e dietro sempre gli stessi, i colori sull'auto
// cambiano a ogni cambio di ritmo (verde = distacco che migliora, giallo = che peggiora).
const C = require('./comune'); const V = C.controlli('sim13');
process.env.SIM_PONTE = '1';
const Pista = require(C.ROOT + '/js/pista.js'), fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const gps = JSON.parse(fs.readFileSync(path.join(C.REPO, 'tools/sim/varano-sim.json'), 'utf8')).gps;
const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
const sp = require(C.SRC + '/simponte.js'), { computeTiming } = require(C.SRC + '/ponte.js'), passo = require(C.SRC + '/passo.js');
const html = fs.readFileSync(path.join(C.ROOT, 'sim.html'), 'utf8');
V.ok('sim.html: pulsante "Scenario prova colori" e casella "rivali fissi"', /id="provaColori"/.test(html) && /id="fissi"/.test(html));
const P = 1.7, d = (x) => x + P;
const corpo = (nome, corsa, extra) => Object.assign({ evento: nome, numero: '1', giroS: 100, passaggi: corsa.passaggi.map(d), finestre: corsa.finestre.map((w) => ({ da: d(w.da), a: d(w.a), fattore: w.fattore })), pause: corsa.pauseT.map((q) => ({ da: d(q.da), durata: q.durata })), tGara: 0, seme: 1, nAuto: 14, partenza: P }, extra);

// (0) come nel video della prova: l'auto parte sulla linea e il primo passaggio e' 2,48 s dopo lo zero (non e' un giro)
{
  const R = 2.48, partenzaLinea = Pista.pianifica(pista, [{ giri: 8 }], opz);
  const pass = [0].concat(partenzaLinea.passaggi).map((x) => x + R);
  sp.avvia({ evento: 'LINEA', numero: '1', giroS: 100, passaggi: pass, finestre: [], pause: [], tGara: 0, seme: 1, nAuto: 14, partenza: R, centro: true });
  const sL = sp._stati.get('LINEA'), noiL = sL.auto[0];
  V.ok('primo passaggio sulla linea (+2,48 s) non e\' un giro: giro 1 ~100 s, nessun giro sotto i 90 s', noiL.giri[0] > 90 && noiL.giri.every((x) => x > 90), noiL.giri.map((x) => x.toFixed(1)));
  const cl = sp.classificaAl(sL, 450), n = cl.find((x) => x.numero === '1');
  V.ok('dopo 4 giri siamo a 4 giri come gli altri (non "1 giro" avanti a tutti) e il miglior giro e\' ~100 s', n.giri === 4 && n.giriRitardo === 0 && cl.filter((x) => x.giri === 4).length >= 10 && n.migliorGiro > 90, { giri: n.giri, giriRitardo: n.giriRitardo, altri4: cl.filter((x) => x.giri === 4).length, best: n.migliorGiro });
  const t = computeTiming({ tipo: 'gara' }, cl, '1').timing;
  V.ok('i distacchi con chi sta davanti/dietro sono numeri (i colori si possono calcolare), non "1 giro"', /^[+-]\d/.test(t.gapAhead || '+0') && /^[+-]?\d/.test(t.gapBehind || '0') && !/giro/.test((t.gapAhead || '') + (t.gapBehind || '')), { a: t.gapAhead, b: t.gapBehind });
}

// (1) miglior giro nel passo
const base = Pista.pianifica(pista, [{ giri: 6 }], opz);
sp.avvia(corpo('NORM', base, { centro: true }));
const sN = sp._stati.get('NORM');
for (let t = 10; t <= 640; t += 2.5) passo.registra('SIM13', sp.classificaAl(sN, t), '1', Date.now() + t * 1000);
const mio = passo.riepilogo('SIM13').mio;
V.ok('passo: miglior giro ~100 s e giri validi presenti', mio.best > 90 && mio.best < 105 && mio.m && mio.m['10'] && mio.m['10'].avg != null, { best: mio.best, m: mio.m && mio.m['10'] });
// anche un primo giro assurdo del live timing non deve diventare il miglior giro
passo.azzera('SIM13b');
passo.registra('SIM13b', [{ numero: '1', giri: 1, ultimoGiro: 2.482, migliorGiro: null, pos: 1 }], '1', 1000);
for (let n = 2; n <= 9; n++) passo.registra('SIM13b', [{ numero: '1', giri: n, ultimoGiro: 100 + (n % 3) * 0.3, migliorGiro: null, pos: 1 }], '1', 1000 + (n - 1) * 100000);
const m2 = passo.riepilogo('SIM13b').mio;
V.ok('passo.js: il giro 1 non fa il "miglior giro" e i giri dopo restano validi', m2.best === 100 && m2.m && m2.m['10'] && m2.m['10'].avg != null, { best: m2.best, m: m2.m && m2.m['10'] });

// un giro assurdo anche a meta' gara (doppio passaggio sulla linea) non cambia miglior giro ne' validita' dei giri dopo
passo.azzera('SIM13c');
for (let n = 1; n <= 8; n++) passo.registra('SIM13c', [{ numero: '1', giri: n, ultimoGiro: n === 1 ? 140 : 100 + (n % 3) * 0.3, pos: 1 }], '1', 1000 + n * 100000);
passo.registra('SIM13c', [{ numero: '1', giri: 9, ultimoGiro: 2.482, pos: 1 }], '1', 1000 + 9 * 100000);
for (let n = 10; n <= 13; n++) passo.registra('SIM13c', [{ numero: '1', giri: n, ultimoGiro: 100.4, pos: 1 }], '1', 1000 + n * 100000);
const m3 = passo.riepilogo('SIM13c').mio;
V.ok('passo.js: un giro di 2,482 s a meta\' gara viene ignorato (miglior giro ~100, i giri dopo restano validi)', m3.best > 99 && m3.best < 101 && m3.m && m3.m['10'] && m3.m['10'].n >= 8, { best: m3.best, m: m3.m && m3.m['10'] });

// (2) prova colori con rivali fissi
const piano = [{ giri: 20 }];
const colori = Pista.pianifica(pista, piano, Object.assign({}, opz, { ritmi: [{ daGiro: 3, giri: 3, fattore: 1.02 }, { daGiro: 7, giri: 3, fattore: 0.98 }, { daGiro: 11, giri: 3, fattore: 1.02 }, { daGiro: 15, giri: 3, fattore: 0.98 }] }));
sp.avvia(corpo('COL', colori, { fissi: true }));
const sC = sp._stati.get('COL'), seq = [];
for (let t = 10; t <= colori.durata; t += 5) { const c = computeTiming({ tipo: 'gara' }, sp.classificaAl(sC, t), '1'); if (c.trovata) seq.push([t, c.timing]); }
const fissi = seq.filter(([t]) => t > 250);
V.ok('rivali fissi: dopo i primi giri davanti e dietro sono sempre gli stessi', new Set(fissi.map(([, x]) => x.numberAhead)).size === 1 && new Set(fissi.map(([, x]) => x.numberBehind)).size === 1, [...new Set(fissi.map(([, x]) => x.numberAhead + '/' + x.numberBehind))]);
const root = C.ROOT;
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(root, p), (e, dd) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); r.end(dd); }); });
srv.listen(8786, async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},off(){},emit(){}})' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.goto('http://localhost:' + 8786 + '/');
  const out = await pg.evaluate((seq) => {
    role = 'auto'; timingView = 'assoluta'; const r = [];
    for (const [t, T] of seq) { renderTiming(T); const c = (id) => { const e = document.getElementById(id); return e.classList.contains('g-up') ? 'verde' : e.classList.contains('g-down') ? 'giallo' : 'bianco'; }; r.push({ t, a: c('timingGapAhead'), b: c('timingGapBehind'), sa: passoSecDaGap(T.gapAhead), sb: passoSecDaGap(T.gapBehind) }); }
    return r;
  }, seq);
  const dopo = out.filter((x) => x.t > 300 && x.sa != null && x.sb != null);
  const col = dopo.filter((x) => x.a !== 'bianco').length / dopo.length;
  V.ok('colori sull\'auto: dopo il primo cambio di ritmo il riquadro e\' colorato per quasi tutta la gara (>= 85%)', col >= 0.85, Math.round(col * 100) + '%');
  const ins = (lato) => new Set(out.map((x) => x[lato]));
  V.ok('colori: verde e giallo compaiono davanti e dietro', ['a', 'b'].every((l) => ins(l).has('verde') && ins(l).has('giallo')), { a: [...ins('a')], b: [...ins('b')] });
  // direzione: quando il distacco davanti cala di oltre 0,5 s rispetto a 25 s prima deve essere verde; quando cresce, giallo
  let giuste = 0, totale = 0;
  for (let k = 5; k < dopo.length; k++) { const x = dopo[k], y = dopo[k - 5]; const dd = x.sa - y.sa; if (Math.abs(dd) > 1) { totale++; if ((dd < 0 && x.a === 'verde') || (dd > 0 && x.a === 'giallo')) giuste++; } }
  V.ok('colori: verde se il distacco davanti si riduce, giallo se aumenta (' + giuste + ' su ' + totale + ')', totale >= 20 && giuste / totale >= 0.9, { giuste, totale });
  V.ok('nessun errore nella pagina', errs.length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
