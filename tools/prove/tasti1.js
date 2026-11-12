// Box: schede nell'ordine Comm, Gara, Passo, Impostazioni, Timing; ogni tasto si illumina un secondo;
// turno pilota che conta solo in pista; cambio pilota a mano; stint massimo; avviso se l'auto si ferma.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8797, async () => {
  const V = C.controlli('tasti1');
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({on(){},off(){},emit(n,d){(window.__em=window.__em||[]).push([n,d]);},connected:true,onAny(){}});window.confirm=()=>true;window.alert=()=>{};window.prompt=()=>"";' }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8797/');
  await pg.evaluate(() => { role = 'box'; code = 'TASTI'; socket = io(); boxPrimario = true; document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; }); enterBoxView(); });

  // 1. schede
  const ordine = await pg.evaluate(() => [...document.querySelectorAll('#boxTabs .tab')].map((t) => t.textContent.trim()));
  V.ok('schede: Comm, Gara, Passo, Impostazioni, Timing', JSON.stringify(ordine) === JSON.stringify(['Comm', 'Gara', 'Passo', 'Impostazioni', 'Timing']), ordine);
  const comm = await pg.evaluate(() => { setBoxTab('comm'); return { flash: !!document.querySelector('#boxTab_comm #flashEditor'), tasti: document.querySelectorAll('#boxTab_comm .flash-row .btn.primary').length, garaNo: !document.querySelector('#boxTab_gara #flashEditor') }; });
  V.ok('Comm contiene i tasti dei messaggi al pilota (e non sono piu\' in Gara)', comm.flash && comm.tasti >= 1 && comm.garaNo, comm);
  const gara = await pg.evaluate(() => { setBoxTab('gara'); const ids = [...document.querySelectorAll('#boxTab_gara > .card')].map((c) => (c.querySelector('h3') || {}).textContent.trim().replace(/\s+/g, ' ')); return ids; });
  V.ok('Gara: cronologia, cruscotto, distacchi, turno pilota, carburante, rifornimento', /^Messaggi ricevuti/.test(gara[0]) && gara[1] === 'Cruscotto' && /^Distacchi/.test(gara[2]) && gara[3] === 'Turno pilota' && /^Carburante/.test(gara[4]) && gara[5] === 'Rifornimento' && gara.length === 6, gara);
  const timingIntatto = await pg.evaluate(() => ['timerPhaseLabel', 'timingSourceSeg', 'timingViewSeg', 'autoLayoutSeg', 'finishDriverInput'].every((i) => document.querySelector('#boxTab_timing #' + i)));
  V.ok('Timing: contenuto intatto', timingIntatto);
  const orig = await pg.evaluate(() => { setBoxTab('timing'); return localStorage.getItem('pc_box_tab'); });
  V.ok('si ricorda la scheda aperta', orig === 'timing', orig);

  // 2. assoluta/categoria dalla scheda Gara
  const vista = await pg.evaluate(() => { setBoxTab('gara'); document.getElementById('segViewCat2').click(); const a = timingView, c2 = document.getElementById('segViewCat2').classList.contains('active'), c1 = document.getElementById('segViewCat').classList.contains('active'); const em = window.__em.filter((x) => x[0] === 'timingViewUpdate').pop(); return { a, c2, c1, em }; });
  V.ok('Gara: Assoluta/Categoria cambia la vista auto (e lo manda al server)', vista.a === 'categoria' && vista.c2 && vista.c1 && vista.em && vista.em[1].view === 'categoria', vista);

  // 3. ogni tasto del box si illumina e poi torna normale
  const esito = await pg.evaluate(async () => {
    const tutti = [];
    for (const tab of ['comm', 'gara', 'passo', 'settings', 'timing']) {
      setBoxTab(tab);
      await new Promise((r) => setTimeout(r, 20));
      document.querySelectorAll('#boxTab_' + tab + ' button, #boxTab_' + tab + ' label.toggle').forEach((e) => { if (e.offsetParent !== null) tutti.push([tab, e]); });
    }
    const senzaLuce = [];
    for (const [tab, e] of tutti) {
      setBoxTab(tab);
      try{ e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }catch(err){}
      if(!e.classList.contains('premuto')) senzaLuce.push(tab + ':' + (e.id || e.textContent.trim().slice(0, 20)));
    }
    await new Promise((r) => setTimeout(r, 1150));
    const restano = tutti.filter(([, e]) => e.classList.contains('premuto')).length;
    return { n: tutti.length, senzaLuce, restano };
  });
  V.ok('tutti i ' + esito.n + ' tasti del box si illuminano al tocco', esito.senzaLuce.length === 0, esito.senzaLuce);
  V.ok('dopo un secondo tornano normali', esito.restano === 0, esito.restano);
  const schede = await pg.evaluate(() => { const t = document.getElementById('boxTabBtn_gara'); t.click(); return t.classList.contains('premuto'); });
  V.ok('le schede (tab) non lampeggiano: si vede gia\' quella attiva', schede === false);

  // 4. turno pilota: conta solo in pista
  const turno = await pg.evaluate(async () => {
    window.__em = [];
    gpsImpostaCambio(0, Date.now()); fuelSystem.onTrack = false; gpsTurnoUltimo = 0;
    const tick = async (ms) => { gpsTurnoUltimo = Date.now() - ms; gpsTurnoTick(); };
    await tick(1000); await tick(1000);
    const fermo = gpsCambio.pistaMs;
    fuelSystem.onTrack = true;
    await tick(1000); await tick(1000); await tick(1000);
    const inPista = gpsCambio.pistaMs;
    fuelSystem.onTrack = false; await tick(1000);
    const dopo = gpsCambio.pistaMs;
    gpsRender();
    return { fermo, inPista, dopo, testo: document.getElementById('turnoTesto').textContent };
  });
  V.ok('turno: fermo ai box non conta', turno.fermo === 0, turno);
  V.ok('turno: in pista conta (~3 s)', turno.inPista >= 2900 && turno.inPista <= 3600, turno.inPista);
  V.ok('turno: tornato ai box smette di contare', turno.dopo === turno.inPista, turno);
  V.ok('turno: il testo dice "fermo: ai box"', /fermo: ai box/.test(turno.testo), turno.testo);

  // 5. cambio pilota a mano
  const man = await pg.evaluate(() => {
    window.__em = [];
    gpsImpostaCambio(0, Date.now() - 600000); gpsCambio.pistaMs = 500000;
    const btn = [...document.querySelectorAll('#boxTab_gara button')].find((x) => /Cambio pilota adesso/.test(x.textContent));
    btn.click();
    const em = window.__em.filter((x) => x[0] === 'cambioRisposta')[0];
    return { n: gpsCambio.n, pista: gpsCambio.pistaMs, em };
  });
  V.ok('cambio a mano: nuovo turno da zero, contatore +1', man.n === 1 && man.pista === 0, man);
  V.ok('cambio a mano: lo sa il server e gli altri box (manuale)', man.em && man.em[1].si === true && man.em[1].manuale === true, man.em);

  // 6. stint massimo
  const st = await pg.evaluate(() => {
    const inp = document.getElementById('stintMaxInput');
    const esiste = !!inp && !!document.querySelector('#boxTab_settings #stintMaxInput');
    inp.value = '60'; gpsImpostaStintMax(inp);
    const salvato = localStorage.getItem('pc_stint_max');
    crAvvisi = []; Object.keys(crCondizione).forEach((k) => delete crCondizione[k]); Object.keys(crUltimoAvviso).forEach((k) => delete crUltimoAvviso[k]);
    fuelSystem.onTrack = true; gpsCambio.pistaMs = 56 * 60000; gpsTurnoUltimo = Date.now() - 1000; gpsTurnoTick();
    const a5 = crAvvisi.map((a) => a.testo);
    gpsCambio.pistaMs = 61 * 60000; gpsTurnoUltimo = Date.now() - 1000; gpsTurnoTick();
    const aMax = crAvvisi.map((a) => a.testo);
    gpsRender();
    return { esiste, salvato, a5, aMax, testo: document.getElementById('turnoTesto').textContent };
  });
  V.ok('Impostazioni: campo "stint massimo" presente e salvato', st.esiste && st.salvato === '60', st);
  V.ok('stint: avviso 5 minuti prima', st.a5.length === 1 && /restano 5 minuti/.test(st.a5[0]), st.a5);
  V.ok('stint: avviso al raggiungimento', st.aMax.some((t) => /Stint massimo raggiunto/.test(t)), st.aMax);
  V.ok('stint: il turno mostra "SUPERATO"', /SUPERATO/.test(st.testo), st.testo);

  // 7. auto ferma in corsia: la domanda suona, la scheda Gara lampeggia, resta visibile
  const dom = await pg.evaluate(() => {
    let bip = 0; const orig = window.playAlertBeep; window.playAlertBeep = () => { bip++; };
    gpsApplicaConfig({ on: true, box: { lat: 45, lng: 9 }, refuel: { lat: 45, lng: 9.01 } });
    gpsUltima = { lat: 45, lng: 9, acc: 3 }; gpsUltimaBuona = Date.now(); gpsCfg.fermoS = 5;
    gpsAncora = { lat: 45, lng: 9 }; gpsAncoraDa = Date.now() - 10000; gpsInCorsia = true; gpsChiede = false; gpsCambioFatto = false; boxPrimario = true;
    gpsControllaFermo();
    const r = { chiede: gpsChiede, bip, lampeggia: document.getElementById('boxTabBtn_gara').classList.contains('tab-avviso'), visibile: !document.getElementById('gpsDomanda').hidden, inTurno: !!document.querySelector('#turnoCard #gpsDomanda') };
    gpsRispostaCambio(false); gpsRender();
    r.dopo = document.getElementById('boxTabBtn_gara').classList.contains('tab-avviso');
    window.playAlertBeep = orig;
    return r;
  });
  V.ok('auto ferma in corsia: domanda aperta, bip, scheda Gara lampeggia, domanda nel riquadro Turno pilota', dom.chiede && dom.bip === 1 && dom.lampeggia && dom.visibile && dom.inTurno, dom);
  V.ok('dopo la risposta la scheda smette di lampeggiare', dom.dopo === false, dom);

  // 8. vista auto: distacco lungo con carattere piu' piccolo, corto invariato
  const gl = await pg.evaluate(() => { renderTiming({ position: 3, gapAhead: '+3.412', gapBehind: '-1:11.577' });
    const a = document.getElementById('timingGapAhead'), b = document.getElementById('timingGapBehind');
    return { corto: a.classList.contains('gap-lungo'), lungo: b.classList.contains('gap-lungo') }; });
  V.ok('auto: distacco lungo (-1:11.577) piu\' piccolo, quello corto (+3.412) come prima', gl.lungo === true && gl.corto === false, gl);

  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
