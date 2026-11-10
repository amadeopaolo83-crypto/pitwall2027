// Doppio box sul telefono del box: barra PRIMARIO/SECONDARIO, doppio tocco per prendere il comando, cedi priorita',
// avviso se un secondario tocca un comando riservato, e GPS / cambio pilota condivisi. Playwright con finto socket.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const { getRoomState } = require(C.SRC + '/rooms.js');
const V = C.controlli('doppio-client');
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(C.ROOT, p), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(8794, () => res(s)); });
  const b = await chromium.launch();
  const apri = async (ruoloIniziale, w = 390) => {
    const pg = await b.newPage({ viewport: { width: w, height: 800 } }); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    const st = JSON.parse(JSON.stringify(getRoomState('DBLC')));
    const corpo = `window.__em=[];window.__h={};window.__ruolo=${JSON.stringify(ruoloIniziale)};window.io=()=>({on(ev,cb){window.__h[ev]=cb; if(ev==='connect') setTimeout(cb,5);},off(){},connected:true,onAny(){},disconnect(){},
      emit(...a){window.__em.push(a.slice(0,2)); if(a[0]==='join'){ const ack=a[a.length-1]; setTimeout(()=>ack({ok:true,state:${JSON.stringify(st)},serverNow:Date.now(),boxRuolo:window.__ruolo}),5);} else if(a[0]==='ora'){ a[1](Date.now()); } }});`;
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: corpo }));
    await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
    await pg.goto('http://localhost:8794/');
    await pg.fill('#teamCode', 'DBLC');
    await pg.evaluate(() => joinAs('box'));
    await pg.waitForTimeout(500);
    return { pg, errs };
  };
  const em = (pg, ev) => pg.evaluate((e) => window.__em.filter((x) => x[0] === e).map((x) => x[1]), ev);
  const barra = (pg) => pg.evaluate(() => { const b = document.getElementById('boxRuoloBar'); return { vis: !b.hidden && b.offsetHeight > 0, testo: b.textContent, bott: [...b.querySelectorAll('button')].map((x) => x.textContent) }; });
  const clicca = (pg, testo) => pg.evaluate((t) => { const x = [...document.querySelectorAll('#boxRuoloBar button')].find((y) => y.textContent.includes(t)); if (x) x.click(); return !!x; }, testo);
  const ruolo = (pg, r) => pg.evaluate((x) => window.__h.boxRuolo(x), r);

  // --- secondario
  let { pg, errs } = await apri({ attivo: true, ruolo: 'secondario', n: 2, cessione: null });
  let r = await barra(pg);
  V.ok('secondario: barra visibile con "SECONDARIO" e "Prendi il comando"', r.vis && /SECONDARIO/.test(r.testo) && r.bott.includes('Prendi il comando'), r);
  const join = await em(pg, 'join');
  V.ok('il join manda un numero del telefono (boxId)', join[0] && typeof join[0].boxId === 'string' && join[0].boxId.length >= 6, join);
  await clicca(pg, 'Prendi il comando');
  V.ok('un tocco solo: non prende il comando, chiede di toccare ancora', (await em(pg, 'boxPrendi')).length === 0 && /ancora/.test((await barra(pg)).bott.join()));
  await clicca(pg, 'ancora');
  V.ok('doppio tocco: prende il comando', (await em(pg, 'boxPrendi')).length === 1);
  await pg.evaluate(() => window.__h.boxNegato());
  const toast = await pg.evaluate(() => { const t = document.getElementById('boxToast'); return t && !t.hidden ? t.textContent : null; });
  V.ok('comando riservato: compare l\'avviso', toast && /PRIMARIO/.test(toast), toast);

  // --- GPS e cambio pilota da secondario
  const gps = (pg2) => pg2.evaluate(() => { role = 'box'; socket = io(); socket.connected = true; gpsCfg.on = true; gpsAncora = { lat: 45, lng: 9 }; gpsAncoraDa = Date.now() - 120000; gpsInCorsia = true; gpsUltimaBuona = Date.now(); gpsCfg.fermoS = 60; gpsChiede = false; gpsCambioFatto = false; window.__em = []; gpsControllaFermo(); return { chiede: gpsChiede, emessi: window.__em.map((x) => x[0]) }; });
  const g1 = await gps(pg);
  V.ok('secondario: non apre la domanda di cambio pilota', g1.chiede === false && !g1.emessi.includes('cambioDomanda'), g1);
  await pg.evaluate(() => window.__h.cambioDomanda({ ancoraDa: Date.now() - 80000 }));
  const dom = await pg.evaluate(() => { const d = document.getElementById('gpsDomanda'); return { chiede: gpsChiede, vis: d && !d.hidden }; });
  V.ok('secondario: la domanda arriva dal server e si vede', dom.chiede === true && dom.vis, dom);
  await pg.evaluate(() => gpsRispostaCambio(true));
  const ris = await pg.evaluate(() => ({ chiede: gpsChiede, n: gpsCambio.n, em: window.__em.filter((x) => x[0] === 'cambioRisposta').map((x) => x[1]) }));
  V.ok('secondario: risponde "si" e lo dice al server', ris.chiede === false && ris.n >= 1 && ris.em.length === 1 && ris.em[0].si === true, ris);
  await pg.evaluate(() => { gpsChiede = true; gpsCambioFatto = false; window.__h.cambioRisposta({ si: true, cambioPilota: { n: 7, da: Date.now() } }); });
  const ris2 = await pg.evaluate(() => ({ chiede: gpsChiede, n: gpsCambio.n }));
  V.ok('risposta arrivata dall\'altro box: la domanda sparisce e il turno si aggiorna', ris2.chiede === false && ris2.n === 7, ris2);
  await pg.evaluate(() => { gpsAzzeraCambi(); });
  V.ok('secondario: "azzera cambi" non vale', await pg.evaluate(() => gpsCambio.n === 7));
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await pg.close();

  // --- primario con due box: cedi priorita'
  ({ pg, errs } = await apri({ attivo: true, ruolo: 'primario', n: 2, cessione: null }));
  r = await barra(pg);
  V.ok('primario: barra con "PRIMARIO" e "Cedi priorità"', r.vis && /PRIMARIO/.test(r.testo) && r.bott.includes('Cedi priorità'), r);
  await clicca(pg, 'Cedi priorit');
  r = await barra(pg); V.ok('menu: 15 30 60 120 minuti', ['15 min', '30 min', '60 min', '120 min'].every((x) => r.bott.includes(x)), r);
  await clicca(pg, '60 min');
  V.ok('scelto 60: manda boxCedi con 60', JSON.stringify(await em(pg, 'boxCedi')) === JSON.stringify([{ minuti: 60 }]));
  const g2 = await gps(pg);
  V.ok('primario: apre la domanda di cambio pilota e la manda al server', g2.chiede === true && g2.emessi.includes('cambioDomanda'), g2);
  // dopo la cessione
  await ruolo(pg, { attivo: true, ruolo: 'secondario', n: 2, cessione: { finoA: Date.now() + 59 * 60000, daMe: true, perMe: false } });
  r = await barra(pg); V.ok('ceduto: "Riprendi" e conto alla rovescia', /SECONDARIO/.test(r.testo) && r.bott.includes('Riprendi') && /5\d:\d\d/.test(r.testo), r);
  await clicca(pg, 'Riprendi'); V.ok('"Riprendi" manda boxRiprendi', (await em(pg, 'boxRiprendi')).length === 1);
  await ruolo(pg, { attivo: true, ruolo: 'primario', n: 2, cessione: { finoA: Date.now() + 10 * 60000, daMe: false, perMe: true } });
  r = await barra(pg); V.ok('ricevuto: "priorità ceduta a te" con tempo', /PRIMARIO/.test(r.testo) && /ceduta a te/.test(r.testo) && /\d\d?:\d\d/.test(r.testo), r);
  // un solo box
  await ruolo(pg, { attivo: true, ruolo: 'primario', n: 1, cessione: null });
  r = await barra(pg); V.ok('un solo box: la barra non si vede', !r.vis, r);
  await ruolo(pg, { attivo: false, ruolo: 'primario', n: 1, cessione: null });
  V.ok('funzione spenta: la barra non si vede', !(await barra(pg)).vis);
  // layout con la barra aperta su telefono stretto
  await ruolo(pg, { attivo: true, ruolo: 'secondario', n: 2, cessione: null });
  const over = await pg.evaluate(() => ({ sx: document.documentElement.scrollWidth > window.innerWidth, minAlt: Math.min(...[...document.querySelectorAll('#boxRuoloBar button')].map((x) => x.getBoundingClientRect().height)) }));
  V.ok('barra a 390 px: niente scorrimento orizzontale, tasti da 52 px', !over.sx && over.minAlt >= 51.5, over);
  await pg.setViewportSize({ width: 360, height: 740 });
  V.ok('barra a 360 px: niente scorrimento orizzontale', !(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
})();
