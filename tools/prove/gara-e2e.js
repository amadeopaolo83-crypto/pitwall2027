// Gara completa end-to-end, a tempo reale: server vero (SIM_PONTE=1), un box, il simulatore (/sim.html) e l'app auto
// (/?sim=1) nello stesso browser (BroadcastChannel). Timer 5:00 + 40:00 e simulatore avviati insieme, lancio 300 s,
// poi la gara dello scenario predefinito del simulatore (soste, giri lenti per tutti, pausa).
// Registra lo stato delle tre pagine ogni 2 s e alla fine fa i controlli sui dati registrati. Schermate in PROVE_OUT/gara-e2e.
// Dura circa 45 minuti: NON e' in tutte.js. Uso: node tools/prove/gara-e2e.js
//   GARA_CORTA=1  versione breve (lancio 150 s, timer 2:30 + 15:00, 2 soste) per mettere a punto la prova (~12 min)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), net = require('net');
const C = require('./comune');
const V = C.controlli('gara-e2e');
const OUT = path.join(C.OUT, 'gara-e2e'); fs.mkdirSync(OUT, { recursive: true });
const CORTA = process.env.GARA_CORTA === '1';
const LANCIO = CORTA ? 150 : 300, GARA_MIN = CORTA ? 15 : 40, STINT_MAX = CORTA ? 11 : 15;
const SCENARIO_CORTO = 'lancio 150\n3 corsia 70\n2 box 90\n1\nsc 2 1 55\npausa 4 60';
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const portaLibera = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const ora = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ora(), ...a);

(async () => {
  const PORTA = await portaLibera();
  const env = { ...process.env, PORT: String(PORTA), SIM_PONTE: '1' };
  for (const k of ['BOX_PIN', 'DOPPIO_BOX', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DATA_DIR', 'RENDER_EXTERNAL_URL', 'SELF_URL', 'BRIDGE_URL', 'AUB_URL']) delete env[k];
  const srv = spawn(process.execPath, [path.join(C.SRC, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logSrv = ''; srv.stdout.on('data', (d) => { logSrv += d; }); srv.stderr.on('data', (d) => { logSrv += d; });
  process.on('exit', () => { try { srv.kill(); } catch (e) { /* gia' fermo */ } });
  for (let i = 0; i < 100 && !/in ascolto/.test(logSrv); i++) await attendi(100);
  V.ok('server partito con SIM_PONTE=1', /in ascolto/.test(logSrv), logSrv);
  const URL = 'http://127.0.0.1:' + PORTA;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const tessera = C.tessera();
  await ctx.route(/arcgisonline|openstreetmap/, (r) => r.fulfill({ contentType: 'image/png', body: tessera }));
  await ctx.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  // suoni del box: si contano (l'audio vero in un browser senza schermo non si sente)
  await ctx.addInitScript(() => {
    window.__suoni = [];
    const avvolgi = () => {
      ['playAlertBeep', 'playSiren'].forEach((n) => {
        const f = window[n]; if (typeof f !== 'function' || f.__avvolta) return;
        const g = function () { window.__suoni.push([n, Date.now()]); return f.apply(this, arguments); }; g.__avvolta = true; window[n] = g;
      });
    };
    document.addEventListener('DOMContentLoaded', avvolgi); window.addEventListener('load', avvolgi);
  });
  const errori = { box: [], sim: [], auto: [] };
  const pagina = async (nome, w, h) => { const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: h }); p.on('pageerror', (e) => errori[nome].push(e.message)); return p; };
  const foto = async (p, nome) => { try { await p.screenshot({ path: path.join(OUT, nome + '.png') }); } catch (e) { /* niente */ } };
  const fotoBox = async (nome, tab) => { if (tab) await box.evaluate((t) => setBoxTab(t), tab); await attendi(150); await foto(box, nome); };

  // tasti del box: si illuminano per un secondo
  const luci = [];
  const tocca = async (p, sel, nome) => {
    await p.click(sel);
    const subito = await p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.classList.contains('premuto'); }, sel);
    await attendi(1250);
    const dopo = await p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.classList.contains('premuto'); }, sel);
    luci.push({ nome, subito, dopo });
  };

  // ---------- BOX ----------
  const box = await pagina('box', 412, 915);
  await box.goto(URL + '/');
  await box.fill('#teamCode', 'PROVA');
  await box.click('#btnBox');
  await box.waitForFunction(() => !document.getElementById('boxView').hidden, null, { timeout: 15000 });
  log('box entrato');
  // impostazioni: serbatoio 100 L, consumo 60 L/h, stint massimo, GPS acceso, circuito caricato dalla mappa
  await box.evaluate(() => setBoxTab('settings'));
  await box.fill('#tankCapacityInput', '100'); await tocca(box, 'button[onclick="setTankCapacity()"]', 'Imposta capienza');
  await box.fill('#knownRateLph', '60'); await tocca(box, 'button[onclick="setKnownRate()"]', 'Imposta consumo');
  await box.fill('#stintMaxInput', String(STINT_MAX)); await box.press('#stintMaxInput', 'Enter'); await box.evaluate(() => document.getElementById('stintMaxInput').blur());
  await box.click('#gpsCard label.toggle:has(#gpsOn)');
  await box.waitForFunction(() => gpsCfg.on === true, null, { timeout: 5000 });
  await box.evaluate(() => mappaApri('circuito'));
  await box.waitForFunction(() => window.L && typeof mp !== 'undefined' && mp.mappa, null, { timeout: 10000 });
  await box.setInputFiles('#mpFile', path.join(C.REPO, 'tools', 'sim', 'varano-sim.json'));
  await box.waitForFunction(() => gpsCfg.traguardo && gpsCfg.corsia && gpsCfg.box, null, { timeout: 5000 });
  await foto(box, '01-box-circuito-caricato');
  await box.evaluate(() => mappaChiudi());
  // timing: Nostro, indirizzo del finto ponte, numero 1 (quello predefinito del simulatore)
  await box.evaluate(() => setBoxTab('timing'));
  await tocca(box, '#segPonte', 'Distacchi: Nostro');
  await box.fill('#ponteUrl', 'https://pitcomm.sim/PROVA'); await box.fill('#ponteNumber', '1');
  await tocca(box, '#timingPontePane button.primary', 'Collega (ponte)');
  // timer: partenza e gara
  await box.fill('#timerStartM', String(Math.floor(LANCIO / 60))); await box.fill('#timerStartS', String(LANCIO % 60));
  await tocca(box, 'button[onclick="timerStartSet()"]', 'Imposta durata partenza');
  await box.fill('#timerRaceH', '0'); await box.fill('#timerRaceM', String(GARA_MIN)); await box.fill('#timerRaceS', '0');
  await tocca(box, 'button[onclick="timerRaceSet()"]', 'Imposta durata gara');
  await box.waitForFunction((s) => lastTimerState && lastTimerState.startSeconds === s, LANCIO, { timeout: 5000 });
  await fotoBox('02-box-timing-pronto');
  // il box e l'auto stanno nello stesso browser: si toglie il ruolo salvato, se no l'auto rientrerebbe come box
  await box.evaluate(() => localStorage.removeItem('pc_role'));

  // ---------- AUTO ----------
  const auto = await pagina('auto', 844, 390);
  await auto.goto(URL + '/?sim=1');
  await auto.fill('#teamCode', 'PROVA');
  await auto.click('#btnAuto');
  await auto.waitForFunction(() => !document.getElementById('autoView').hidden, null, { timeout: 15000 });
  await auto.evaluate(() => {
    window.__timing = [];
    const orig = renderTiming;
    window.renderTiming = function (t) {
      const r = orig.apply(this, arguments);
      try {
        const cat = timingView === 'categoria' && !!t.catName;
        const cls = (id) => { const e = document.getElementById(id); return e.classList.contains('g-up') ? 'verde' : e.classList.contains('g-down') ? 'giallo' : 'bianco'; };
        window.__timing.push({ at: Date.now(), vista: timingView, cat, aTxt: cat ? t.catGapAhead : t.gapAhead, bTxt: cat ? t.catGapBehind : t.gapBehind,
          aNum: cat ? t.catNumberAhead : t.numberAhead, bNum: cat ? t.catNumberBehind : t.numberBehind,
          aS: passoSecDaGap(cat ? t.catGapAhead : t.gapAhead), bS: passoSecDaGap(cat ? t.catGapBehind : t.gapBehind),
          aCol: cls('timingGapAhead'), bCol: cls('timingGapBehind'), soglia: sogliaGap, sub: document.getElementById('timingPosSub').textContent });
      } catch (e) { /* niente */ }
      return r;
    };
    socket.off('timingUpdate'); socket.on('timingUpdate', (x) => window.renderTiming(x));
  });
  log('auto entrata');
  await box.evaluate(() => localStorage.setItem('pc_role', 'box'));

  // ---------- SIMULATORE ----------
  const sim = await pagina('sim', 900, 1000);
  await sim.goto(URL + '/sim.html');
  await sim.setInputFiles('#file', path.join(C.REPO, 'tools', 'sim', 'varano-sim.json'));
  await sim.fill('#codice', 'PROVA');
  if (CORTA) await sim.fill('#piano', SCENARIO_CORTO);
  const piano = await sim.inputValue('#piano');
  log('scenario:\n' + piano);
  await foto(sim, '03-sim-pronto');

  // ---------- VIA: simulatore e timer insieme ----------
  await box.evaluate(() => setBoxTab('timing'));
  const t0 = Date.now();
  await Promise.all([sim.click('#via'), box.click('button.timer-manual[onclick="timerControl(\'start\')"]')]);
  log('via');
  await box.evaluate(() => setBoxTab('gara'));

  // ---------- registrazione ----------
  const campioni = [], eventi = [];
  const ev = (nome, extra) => { eventi.push({ t: Date.now() - t0, nome, ...extra }); log('EVENTO ' + nome + (extra ? ' ' + JSON.stringify(extra) : '')); };
  let simLogVisto = 0, fine = false, faseFoto = {};
  const una = async (chiave, fn) => { if (faseFoto[chiave]) return; faseFoto[chiave] = true; await fn(); };
  let azioni = { cat: false, ass: false, domandaVista: 0, ripartita: 0, cambioFatto: false, giroRifFoto: false };
  const sec = () => (Date.now() - t0) / 1000;

  while (!fine && sec() < LANCIO + GARA_MIN * 60 + 300) {
    await attendi(2000);
    const s = {};
    s.t = Date.now() - t0;
    s.box = await box.evaluate(() => ({
      onTrack: !!fuelSystem.onTrack, litri: (typeof computeLiveLiters === 'function') ? computeLiveLiters() : fuelSystem.currentLiters,
      stato: document.getElementById('trackStatusLabel').textContent, gpsStato, gpsRiga: document.getElementById('gpsRiga').textContent,
      turno: document.getElementById('turnoTesto').textContent, pistaMs: gpsCambio.pistaMs || 0, cambi: gpsCambio.n || 0,
      domanda: !document.getElementById('gpsDomanda').hidden, domandaTesto: document.getElementById('gpsDomandaTesto').textContent,
      tabAvviso: document.getElementById('boxTabBtn_gara').classList.contains('tab-avviso'),
      cruscotto: document.getElementById('crCruscotto').innerText, avvisi: crAvvisi.map((a) => a.testo),
      suoni: window.__suoni.length, giroRif: gpsCfg.giroRif ? gpsCfg.giroRif.t : null, lancioRiga: document.getElementById('gpsLancio').textContent,
      fase: lastTimerState && lastTimerState.phase, ponte: document.getElementById('ponteStatusLabel').textContent,
      strat: strategiaRis ? { safety: !!strategiaRis.safety, ferma: !!strategiaRis.sospensione, soste: (strategiaRis.rivali || []).reduce((a, r) => a + (r.soste ? r.soste.length : 0), 0),
        nostre: strategiaRis.nostra && strategiaRis.nostra.soste ? strategiaRis.nostra.soste.map((x) => x.giro + ' ' + x.tipo) : [], sugg: !!(strategiaRis.sugg && strategiaRis.sugg.tabella), neut: strategiaRis.neutralizzazioni || 0 } : null,
      stratTesto: (document.getElementById('strategiaBox') || {}).innerText || '', pitLog: gpsPitLog.map((x) => x.tipo + ' ' + Math.round(x.fermoS)),
    }));
    s.auto = await auto.evaluate(() => ({
      fascia: !document.getElementById('lancioGuida').hidden, lancioCmd: document.getElementById('lancioCmd').textContent, lancioMsg: document.getElementById('lancioMsg').textContent,
      clock: document.getElementById('raceClockDisplay').textContent, banner: !document.getElementById('timerStartBanner').hidden,
      pos: document.getElementById('timingPos').textContent, sub: document.getElementById('timingPosSub').textContent, vista: timingView,
      la: laRis && !laRis.fuori ? { e: laRis.e, aLinea: laRis.aLinea } : null,
      a: document.getElementById('timingGapAhead').textContent, b: document.getElementById('timingGapBehind').textContent, giroRifLocale: laLocale ? laLocale.t : null,
      aCol: document.getElementById('timingGapAhead').className, bCol: document.getElementById('timingGapBehind').className,
    }));
    s.sim = await sim.evaluate(() => ({ stato: document.getElementById('stato').textContent, log: document.getElementById('log').textContent }));
    const righe = s.sim.log.split('\n').filter(Boolean);
    for (; simLogVisto < righe.length; simLogVisto++) ev('sim', { riga: righe[simLogVisto] });
    delete s.sim.log;
    campioni.push(s);
    const tg = sec() - LANCIO;   // tempo di gara (circa)

    // il "pilota" del simulatore segue la fascia di lancio con il cursore del ritmo, come farebbe una persona
    if (s.auto.fascia && s.auto.la && s.auto.la.aLinea > 3) {
      const r = await sim.evaluate(() => parseFloat(document.getElementById('ritmo').value) || 1);
      const nuovo = Math.max(0.6, Math.min(1.15, r * s.auto.la.aLinea / (s.auto.la.aLinea - s.auto.la.e)));
      if (Math.abs(nuovo - r) > 0.005) await sim.evaluate((v) => { const el = document.getElementById('ritmo'); el.value = String(v); el.dispatchEvent(new Event('input')); }, Math.round(nuovo * 100) / 100);
      s.ritmo = nuovo;
    }
    // schermate e azioni nei momenti chiave
    if (s.auto.fascia) await una('fascia', async () => { ev('fascia di lancio visibile'); await foto(auto, '04-auto-fascia-lancio'); });
    if (s.box.giroRif) await una('giroRif', async () => { ev('giro di riferimento sul box', { t: s.box.giroRif }); await fotoBox('05-box-giro-riferimento', 'settings'); await box.evaluate(() => setBoxTab('gara')); });
    if (s.box.fase === 'race') await una('via', async () => { ev('timer: gara partita'); await foto(auto, '06-auto-gara-partita'); });
    if (s.box.cruscotto.includes('NOI:')) await una('noi', async () => { ev('riga NOI', { testo: s.box.cruscotto.split('\n')[0] }); await fotoBox('07-box-gara-noi'); });
    const colori = s.auto.aCol + ' ' + s.auto.bCol;
    if (/g-up/.test(colori) && /g-down/.test(colori)) await una('colori', async () => { ev('colori verde e giallo visti'); await foto(auto, '08-auto-colori'); });
    if (!azioni.cat && tg > (CORTA ? 200 : 600)) {
      azioni.cat = true; await box.evaluate(() => setBoxTab('gara')); await tocca(box, '#segViewCat2', 'Gara: Categoria'); ev('box: Categoria dalla scheda Gara');
      await attendi(3500); await foto(auto, '09-auto-categoria'); await fotoBox('10-box-gara-categoria');
    }
    if (!azioni.ass && tg > (CORTA ? 380 : 1500)) {
      azioni.ass = true; await tocca(box, '#segViewAss2', 'Gara: Assoluta'); ev('box: Assoluta dalla scheda Gara');
      await attendi(3500); await foto(auto, '11-auto-assoluta');
    }
    if (s.box.strat && (s.box.strat.safety || s.box.strat.neut > 0)) await una('sc', async () => { ev('strategia: giri lenti per tutti'); await fotoBox('12-box-strategia-sc', 'passo'); await box.evaluate(() => setBoxTab('gara')); });
    if (s.box.strat && s.box.strat.ferma) await una('ferma', async () => { ev('strategia: gara ferma'); await fotoBox('13-box-strategia-ferma', 'passo'); await box.evaluate(() => setBoxTab('gara')); });
    if (s.box.strat && s.box.strat.soste > 0) await una('soste', async () => { ev('strategia: prima sosta degli altri'); });
    if (s.box.avvisi.some((a) => /restano 5 minuti/.test(a))) await una('stint5', async () => { ev('avviso stint: 5 minuti', { suoni: s.box.suoni }); await fotoBox('14-box-avviso-stint-5'); });
    if (s.box.avvisi.some((a) => /Stint massimo raggiunto/.test(a))) await una('stintMax', async () => { ev('avviso stint massimo', { suoni: s.box.suoni }); await fotoBox('15-box-stint-massimo'); });
    // cambio pilota
    if (s.box.domanda && !azioni.domandaVista) {
      azioni.domandaVista = s.t; ev('domanda cambio pilota', { testo: s.box.domandaTesto, tabAvviso: s.box.tabAvviso, suoni: s.box.suoni });
      await fotoBox('16-box-domanda-cambio');
    }
    if (azioni.domandaVista && !azioni.ripartita && /ripartita/.test(s.box.domandaTesto)) {
      azioni.ripartita = s.t; ev('auto ripartita, domanda ancora aperta', { testo: s.box.domandaTesto });
    }
    if (azioni.ripartita && !azioni.cambioFatto && s.t - azioni.ripartita > 20000) {
      azioni.cambioFatto = true;
      ev('prima del cambio', { domanda: s.box.domanda, turno: s.box.turno, pistaMs: s.box.pistaMs });
      await fotoBox('17-box-domanda-dopo-ripartenza');
      await tocca(box, '#turnoCard button.primary[onclick^="gpsCambioManuale"]', 'Cambio pilota adesso');
      const dopo = await box.evaluate(() => ({ turno: document.getElementById('turnoTesto').textContent, pistaMs: gpsCambio.pistaMs || 0, n: gpsCambio.n, domanda: !document.getElementById('gpsDomanda').hidden }));
      ev('dopo "Cambio pilota adesso"', dopo);
      await fotoBox('18-box-dopo-cambio');
    }
    if (/Fine scenario|finito/.test(s.sim.stato) || righe.some((r) => /Fine scenario/.test(r))) { fine = true; ev('fine scenario'); }
  }
  await fotoBox('19-box-fine-gara'); await fotoBox('20-box-passo-fine', 'passo'); await foto(auto, '21-auto-fine'); await foto(sim, '22-sim-fine');
  const timing = await auto.evaluate(() => window.__timing);
  fs.writeFileSync(path.join(OUT, 'dati.json'), JSON.stringify({ piano, campioni, eventi, timing, luci, errori }, null, 1));
  log('dati salvati in ' + path.join(OUT, 'dati.json'));

  // ================= CONTROLLI =================
  const tutti = (f) => campioni.filter(f);
  const primo = (f) => campioni.find(f);
  const simRighe = eventi.filter((e) => e.nome === 'sim');
  const quando = (re) => { const e = simRighe.find((x) => re.test(x.riga)); return e ? e.t : null; };

  // lancio
  V.ok('lancio: fascia di lancio comparsa sull\'auto', !!primo((c) => c.auto.fascia), campioni.filter((c) => c.t < LANCIO * 1000).slice(-3).map((c) => c.auto));
  const fasciaOk = tutti((c) => c.auto.fascia && !c.auto.lancioMsg);
  V.ok('lancio: la fascia da\' un consiglio (Rallenta/Accelera/Giro perfetto)', fasciaOk.length > 0, [...new Set(tutti((c) => c.auto.fascia).map((c) => c.auto.lancioCmd + '|' + c.auto.lancioMsg))].slice(0, 6));
  const gr = primo((c) => c.box.giroRif);
  V.ok('lancio: giro di riferimento registrato (box) prima dello zero', !!gr && gr.t < LANCIO * 1000, gr && { t: gr.t / 1000, giro: gr.box.giroRif });
  V.ok('lancio: niente fascia dopo lo zero', tutti((c) => c.t > (LANCIO + 5) * 1000 && c.auto.fascia).length === 0);
  // timer e passaggi pista / box
  V.ok('timer: dalla partenza alla gara', !!primo((c) => c.box.fase === 'race'), campioni.slice(-1)[0].box.fase);
  const statiVisti = [...new Set(campioni.map((c) => c.box.gpsStato))];
  V.ok('GPS: in pista e ai box / rifornimento riconosciuti', statiVisti.includes('pista') && (statiVisti.includes('box') || statiVisti.includes('rifornimento')), statiVisti);
  const cambiStato = []; campioni.forEach((c, i) => { if (i && c.box.onTrack !== campioni[i - 1].box.onTrack) cambiStato.push((c.t / 1000 | 0) + 's ' + (c.box.onTrack ? 'in pista' : 'ai box') + ' (' + c.box.gpsStato + ')'); });
  const soste = simRighe.filter((e) => /VERO: sosta/.test(e.riga));
  V.ok('in pista / ai box automatici a ogni sosta con box o rifornimento', soste.filter((e) => /rifornimento|box/.test(e.riga)).every((e) => campioni.some((c) => !c.box.onTrack && Math.abs(c.t - e.t) < 120000)), { soste: soste.map((e) => (e.t / 1000 | 0) + ' ' + e.riga), cambi: cambiStato });
  // carburante
  const pista = campioni.filter((c, i) => i && c.box.onTrack && campioni[i - 1].box.onTrack);
  const calaInPista = pista.filter((c, i) => i && pista[i - 1].t === c.t - 2000 || true).length > 10;
  const L0 = campioni[0].box.litri, L1 = campioni[campioni.length - 1].box.litri;
  let fermoCala = 0; campioni.forEach((c, i) => { if (i && !c.box.onTrack && !campioni[i - 1].box.onTrack && c.box.litri < campioni[i - 1].box.litri - 0.05) fermoCala++; });
  V.ok('carburante: cala in pista (60 L/h) e continua dopo le soste', calaInPista && L1 < L0 - 10, { L0, L1 });
  V.ok('carburante: fermo ai box non cala', fermoCala === 0, fermoCala);
  // turno pilota
  let turnoAiBox = 0; campioni.forEach((c, i) => { if (i && !c.box.onTrack && !campioni[i - 1].box.onTrack && c.box.cambi === campioni[i - 1].box.cambi && c.box.pistaMs > campioni[i - 1].box.pistaMs + 1500) turnoAiBox++; });
  V.ok('turno pilota: non conta con l\'auto ai box', turnoAiBox === 0 && campioni.some((c) => !c.box.onTrack && c.t > LANCIO * 1000), turnoAiBox);
  const e5 = eventi.find((e) => e.nome === 'avviso stint: 5 minuti'), eMax = eventi.find((e) => e.nome === 'avviso stint massimo');
  V.ok(`stint massimo ${STINT_MAX} min: avviso 5 minuti prima`, !!e5, campioni.slice(-1)[0].box.avvisi);
  V.ok(`stint massimo ${STINT_MAX} min: avviso al raggiungimento`, !!eMax, campioni.slice(-1)[0].box.avvisi);
  const pistaA = (ev) => { if (!ev) return null; const c = campioni.find((x) => x.t >= ev.t - 2500); return c ? Math.round(c.box.pistaMs / 1000) : null; };
  V.ok('stint: avvisi al tempo in pista giusto (+-15 s)', e5 && eMax && Math.abs(pistaA(e5) - (STINT_MAX - 5) * 60) <= 15 && Math.abs(pistaA(eMax) - STINT_MAX * 60) <= 15, { a5: pistaA(e5), aMax: pistaA(eMax) });
  // cambio pilota
  const dom = eventi.find((e) => e.nome === 'domanda cambio pilota');
  const corsia = simRighe.find((e) => /VERO: sosta corsia/.test(e.riga));
  V.ok('sosta in corsia ~1 min: compare la domanda "era un cambio pilota?"', !!dom && !!corsia && dom.t > corsia.t && dom.t - corsia.t < 75000, { corsia: corsia && corsia.t / 1000, domanda: dom && dom.t / 1000 });
  V.ok('domanda: la scheda Gara lampeggia', !!dom && dom.tabAvviso === true);
  const suonoDom = dom && campioni.find((c) => c.t >= dom.t - 2500);
  V.ok('domanda: il box suona', !!dom && campioni.some((c, i) => i && c.t >= dom.t - 3000 && c.t <= dom.t + 3000 && c.box.suoni > campioni[i - 1].box.suoni), suonoDom && suonoDom.box.suoni);
  V.ok('domanda: resta aperta dopo la ripartenza', !!eventi.find((e) => e.nome === 'auto ripartita, domanda ancora aperta') && (eventi.find((e) => e.nome === 'prima del cambio') || {}).domanda === true);
  const dc = eventi.find((e) => e.nome === 'dopo "Cambio pilota adesso"');
  V.ok('"Cambio pilota adesso": turno azzerato, domanda chiusa', !!dc && dc.pistaMs < 3000 && dc.n >= 1 && dc.domanda === false, dc);
  // riga NOI
  const noi = primo((c) => /NOI: giro \d+ · ultimo \d/i.test(c.box.cruscotto));   // in maiuscolo per il CSS
  V.ok('scheda Gara: riga NOI con giro e ultimo giro', !!noi, noi ? noi.box.cruscotto.split('\n').find((r) => /NOI/.test(r)) : campioni.slice(-1)[0].box.cruscotto.slice(0, 200));
  // strategia
  V.ok('strategia: soste degli altri riconosciute', campioni.some((c) => c.box.strat && c.box.strat.soste > 0), campioni.slice(-1)[0].box.strat);
  const tSc = quando(/giri lenti|VERO: sc|safety/i), tPausa = quando(/pausa|ferma/i);
  V.ok('strategia: "giri lenti per tutti" riconosciuti', !!eventi.find((e) => e.nome === 'strategia: giri lenti per tutti'), { simSc: tSc });
  V.ok('strategia: "gara ferma" riconosciuta', !!eventi.find((e) => e.nome === 'strategia: gara ferma'), { simPausa: tPausa });
  const pausaVera = simRighe.find((e) => /VERO: sosta pausa/.test(e.riga));
  const fermaPrima = tutti((c) => c.box.strat && c.box.strat.ferma && pausaVera && c.t < pausaVera.t - 5000);
  V.ok('strategia: nessuna "gara ferma" prima della pausa vera', !!pausaVera && fermaPrima.length === 0, fermaPrima.slice(0, 5).map((c) => ((c.t / 1000 - LANCIO) | 0) + ' s di gara'));
  // Assoluta / Categoria dal box
  const tCat = (eventi.find((e) => e.nome === 'box: Categoria dalla scheda Gara') || {}).t, tAss = (eventi.find((e) => e.nome === 'box: Assoluta dalla scheda Gara') || {}).t;
  const dopoCat = campioni.find((c) => tCat && c.t > tCat + 3000), dopoAss = campioni.find((c) => tAss && c.t > tAss + 3000);
  V.ok('Gara → Categoria: l\'auto passa alla categoria', !!dopoCat && dopoCat.auto.vista === 'categoria' && /ass\./.test(dopoCat.auto.sub), dopoCat && dopoCat.auto);
  V.ok('Gara → Assoluta: l\'auto torna all\'assoluta', !!dopoAss && dopoAss.auto.vista === 'assoluta' && !/ass\./.test(dopoAss.auto.sub), dopoAss && dopoAss.auto);
  // colori dei distacchi, ricalcolati dalla regola: stesso rivale e cambio oltre la soglia = verde/giallo; rivale nuovo = bianco
  const reg = { a: { key: null, ref: null, dir: null }, b: { key: null, ref: null, dir: null } };
  const sbagli = [], conteggio = { assoluta: { verde: 0, giallo: 0, nuovo: 0 }, categoria: { verde: 0, giallo: 0, nuovo: 0 } };
  for (const r of timing) {
    for (const lato of ['a', 'b']) {
      const st = reg[lato], key = r.vista + '|' + (r[lato + 'Num'] || ''), sv = r[lato + 'S'];
      let nuovo = false;
      if (sv == null) { if (st.key !== key) { st.key = null; st.ref = null; st.dir = null; nuovo = true; } }
      else if (st.key !== key) { st.key = key; st.ref = sv; st.dir = null; nuovo = true; }
      else if (Math.abs(sv - st.ref) > r.soglia) { st.dir = sv < st.ref ? 'shrink' : 'grow'; st.ref = sv; }
      const buono = (lato === 'a') === (st.dir === 'shrink');
      const atteso = !st.dir ? 'bianco' : buono ? 'verde' : 'giallo';
      const col = r[lato + 'Col'];
      if (col !== atteso) sbagli.push({ t: ((r.at - t0) / 1000) | 0, lato, key, txt: r[lato + 'Txt'], atteso, col });
      if (nuovo) { conteggio[r.vista].nuovo++; if (col !== 'bianco') sbagli.push({ t: ((r.at - t0) / 1000) | 0, lato, key, nuovoRivale: true, col }); }
      if (col !== 'bianco') conteggio[r.vista][col]++;
    }
  }
  V.ok('colori: sempre come la regola (stesso rivale oltre la soglia = colore, rivale nuovo = bianco)', sbagli.length === 0, sbagli.slice(0, 8));
  // quali colori compaiono dipende dalla gara (se con lo stesso rivale ci sono solo peggioramenti, il verde non e' dovuto):
  // la regola qui sopra dice che sono giusti; qui si chiede che entrambi si vedano nella gara e che ogni vista ne mostri.
  V.ok('colori: verde e giallo visti nella gara', conteggio.assoluta.verde + conteggio.categoria.verde > 0 && conteggio.assoluta.giallo + conteggio.categoria.giallo > 0, conteggio);
  V.ok('colori: Assoluta e Categoria mostrano colori', conteggio.assoluta.verde + conteggio.assoluta.giallo > 0 && conteggio.categoria.verde + conteggio.categoria.giallo > 0, conteggio);
  V.ok('colori: rivali che cambiano ripartono da bianco (casi visti)', conteggio.assoluta.nuovo + conteggio.categoria.nuovo > 4, conteggio);
  // gruppo compatto (predefinito nel simulatore): la nostra auto resta nel mezzo, i distacchi cambiano di poco
  const posGara = campioni.filter((c) => c.t > (LANCIO + 120) * 1000 && c.auto.vista === 'assoluta' && /^\d+$/.test(c.auto.pos)).map((c) => Number(c.auto.pos));
  const nelMezzo = posGara.filter((p) => p >= 3 && p <= 11).length;
  V.ok('gruppo compatto: la nostra auto (n. 1) sta tra il 3° e l\'11° posto per almeno il 60% della gara', posGara.length > 20 && nelMezzo >= 0.6 * posGara.length, { letture: posGara.length, nelMezzo, posti: [...new Set(posGara)].sort((a, b) => a - b) });
  const delta = [];
  const ultimoA = {};   // ultimo valore numerico per vista e rivale (tra due valori c'e' spesso un "1 giro" momentaneo)
  for (const r of timing) { const k = r.vista + '|' + r.aNum; if (r.aS == null) continue; if (ultimoA[k] != null && ultimoA[k] !== r.aS) delta.push(Math.abs(r.aS - ultimoA[k])); ultimoA[k] = r.aS; }
  delta.sort((x, y) => x - y);
  console.log('Distacco da chi sta davanti, stesso rivale: ' + delta.length + ' cambi, mediana ' + (delta.length ? delta[delta.length >> 1].toFixed(2) : '-') + ' s, sotto 2 s: ' + delta.filter((x) => x < 2).length);
  // tasti del box
  V.ok('ogni tasto del box si illumina per 1 secondo', luci.length > 0 && luci.every((l) => l.subito && !l.dopo), luci);
  // errori
  V.ok('nessun errore nelle pagine', Object.values(errori).every((e) => e.length === 0), errori);
  V.ok('nessun errore nel server', !/\[socket |Error|uncaught/i.test(logSrv), logSrv.slice(-1500));
  console.log('Cambi in pista / ai box:', cambiStato.join(' | '));
  console.log('Soste registrate dal box (corsia):', JSON.stringify(campioni.slice(-1)[0].box.pitLog));
  await browser.close(); srv.kill();
  V.fine();
})().catch((e) => { console.log('MALE eccezione: ' + (e && e.stack)); process.exit(1); });

