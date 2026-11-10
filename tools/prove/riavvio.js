// Riavvio del server a gara in corso: il timer deve tornare com'era (dall'archivio o dalla copia del box),
// e gli eventi strani non devono far cadere il server. Uso: node tools/prove/riavvio.js
// (cerca il modulo web-push in NODE_PATH; se manca ne serve uno finto). Esce con codice 1 se un controllo fallisce.
const { spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const AQUI = __dirname, SRC = path.join(AQUI, '..', '..', 'src');

if (process.argv[2] === 'fase') {
  const [, , , fase, spostaS] = process.argv;
  const T0 = Number(process.env.T0);
  const adesso = T0 + Number(spostaS) * 1000;
  Date.now = () => adesso + (Date.now.extra || 0);       // orologio fermo e spostato: prova ripetibile
  const EventEmitter = require('events');
  const { registra } = require(path.join(SRC, 'sockets.js'));
  const archivio = require(path.join(SRC, 'archivio.js'));
  const emitted = [];
  const mk = () => { const s = new EventEmitter(); s.data = {}; s.join = () => {}; const any = []; s.onAny = (f) => any.push(f); const mws = []; s.use = (f) => mws.push(f);
    const orig = s.emit.bind(s);
    s.emit = (ev, ...a) => { for (const f of any) f(ev, ...a); for (const m of mws) { let ok = false; m([ev, ...a], () => { ok = true; }); if (!ok) return false; } return orig(ev, ...a); };
    return s; };
  const io = new EventEmitter(); io.to = () => ({ emit: (ev, d) => emitted.push([ev, d]) }); io.in = io.to;
  registra(io);
  const join = (s, code, role) => new Promise((r) => s.emit('join', { code, role }, r));
  const esiti = {};
  const ok = (nome, v) => { esiti[nome] = !!v; console.log((v ? 'OK   ' : 'MALE ') + nome); };
  (async () => {
    const box = mk(), auto = mk(); io.emit('connection', box); io.emit('connection', auto);
    if (fase === '1') {
      await join(box, 'RIAV', 'box'); await join(auto, 'RIAV', 'auto');
      box.emit('timerStartSet', { seconds: 600 }); box.emit('timerStartControl', { action: 'start' });
      await archivio.svuota();
      box.emit('timerStartControl', { action: 'start' });
      await new Promise((r) => setTimeout(r, 50)); await archivio.svuota();
      ok('fase 1: archivio scritto', fs.readdirSync(process.env.DATA_DIR).some((f) => f.startsWith('RIAV')));
      // seconda stanza, per la copia del box (senza archivio la stanza si chiama TEST? no: stanza normale, archivio spento dopo)
    } else if (fase === '2') {            // dopo il riavvio, a conto alla rovescia ancora aperto (spostato di 100 s)
      const g = await join(box, 'RIAV', 'box');
      const t = g.state.raceTimer;
      ok('archivio: fase ancora "partenza" e in corso', t.phase === 'start' && t.startRunning);
      ok('archivio: restano 500 s circa', Math.abs((t.startRemaining - (Date.now() - t.startUpdatedAt) / 1000) - 500) < 2);
      ok('archivio: fresh.timer chiuso', g.state.fresh.timer === false);
      ok('archivio: durata di partenza 600', t.startSeconds === 600);
    } else if (fase === '3') {            // il conto alla rovescia e' scaduto mentre il server era spento (spostato di 700 s)
      const g = await join(box, 'RIAV', 'box');
      const t = g.state.raceTimer;
      ok('scaduto: gara partita', t.phase === 'race' && t.raceRunning);
      const trascorso = t.raceSeconds - (t.raceRemaining - (Date.now() - t.raceUpdatedAt) / 1000);
      ok('scaduto: il via risale al vero zero (100 s fa)', Math.abs(trascorso - 100) < 2);
    } else if (fase === '4') {            // senza archivio: il box rimanda la sua copia
      // stanza nuova: nessun archivio per questo codice
      const g = await join(box, 'COPIA', 'box'); await join(auto, 'COPIA', 'auto');
      ok('copia: il server e\' vuoto (fresh.timer)', g.state.fresh.timer === true && g.state.raceTimer.phase === 'start');
      const adesso0 = Date.now();
      const copia = { phase: 'race', startSeconds: 600, raceSeconds: 86400, startRemaining: 0, startRunning: false, startUpdatedAt: adesso0 - 5000,
        raceRemaining: 86000, raceRunning: true, raceUpdatedAt: adesso0 - 30000, finishTriggered: false, finishPosition: null };
      auto.emit('timerRestore', copia);
      ok('copia: dall\'auto non vale', g.state.raceTimer.phase === 'start');
      box.emit('timerRestore', { phase: 'race', raceRemaining: 'zzz' });
      ok('copia: forma sbagliata scartata', g.state.raceTimer.phase === 'start');
      box.emit('timerRestore', { ...copia, raceUpdatedAt: adesso0 - 40 * 3600 * 1000 });
      ok('copia: troppo vecchia scartata', g.state.raceTimer.phase === 'start');
      box.emit('timerRestore', copia);
      ok('copia: rimessa dal box', g.state.raceTimer.phase === 'race' && g.state.raceTimer.raceRunning && g.state.raceTimer.raceRemaining === 86000);
      box.emit('timerRestore', { ...copia, raceRemaining: 100 });
      ok('copia: la seconda non pesta la prima', g.state.raceTimer.raceRemaining === 86000);
      ok('copia: tutti avvisati', emitted.some((e) => e[0] === 'timerUpdate' && e[1].phase === 'race'));
    } else if (fase === '5') {            // validazione e crash
      const g = await join(box, 'VALID', 'box'); await join(auto, 'VALID', 'auto');
      const st = g.state; emitted.length = 0;
      let caduto = false;
      try {
        for (const ev of ['quickMessage', 'flashMessage', 'fuelSystemUpdate', 'fuelUpdate', 'autonomyUpdate', 'dayModeUpdate', 'quickButtonsUpdate', 'timerStartSet', 'timerRaceSet', 'finishTrigger', 'timerRestore', 'raceTimerAutoStart', 'gpsPos', 'timingUpdate'])
          for (const p of [undefined, null, 5, 'x', {}, [] , { percent: 'a' }]) { box.emit(ev, p); auto.emit(ev, p); }
      } catch (e) { caduto = true; console.error(e); }
      ok('payload mancanti o strani non fanno cadere il server', !caduto);
      ok('fuelSystem "spazzatura" scartato', (box.emit('fuelSystemUpdate', 'spazzatura'), st.fuelSystem.tankCapacityLiters === 100));
      box.emit('fuelSystemUpdate', { tankCapacityLiters: 80, currentLiters: 40, onTrack: false });
      ok('fuelSystem valido accettato', st.fuelSystem.tankCapacityLiters === 80 && st.fuelSystem.currentLiters === 40);
      box.emit('fuelSystemUpdate', { tankCapacityLiters: 90, currentLiters: 90, ripristino: true, copiaAt: 1 });
      ok('ripristino carburante a server non vuoto scartato', st.fuelSystem.tankCapacityLiters === 80);
      box.emit('fuelSystemUpdate', { tankCapacityLiters: 80, currentLiters: -3, consumptionRatePerHour: -1, onTrack: true, sessionStartAt: Date.now() - 1000, sessionStartLiters: 60 });
      ok('carburante con numeri fuori scala: riportato nei limiti, non scartato', st.fuelSystem.currentLiters === 0 && st.fuelSystem.onTrack === true && st.fuelSystem.consumptionRatePerHour === null);
      const dur0 = st.raceTimer.raceSeconds;
      box.emit('timerRaceSet', { seconds: 'ciao' }); box.emit('timerRaceSet', { seconds: -5 }); box.emit('timerRaceSet', { seconds: 1e12 });
      ok("durata gara non valida scartata (" + st.raceTimer.raceSeconds + ")", st.raceTimer.raceSeconds === dur0);
      box.emit('quickButtonsUpdate', { buttons: [{ id: 1, label: '<img src=x onerror=alert(1)>', color: 'rosso' }] });
      ok('pulsanti: colore non valido sostituito', st.quickButtons[0].color === '#3fa9f5' && st.quickButtons[0].label.includes('<img'));
      auto.emit('fuelUpdate', { percent: 1 }); auto.emit('timerStartSet', { seconds: 1 }); auto.emit('quickButtonsUpdate', { buttons: [{ id: 1, label: 'x', color: '#000000' }] });
      ok('l\'auto non comanda carburante, timer e pulsanti', st.fuel.percent !== 1 && st.raceTimer.startSeconds !== 1 && st.quickButtons[0].label !== 'x');
      auto.emit('quickMessage', { buttonId: 1, label: 'BOX BOX' });
      ok('l\'auto manda i messaggi rapidi', emitted.some((e) => e[0] === 'quickMessageReceived'));
      // via anticipato
      box.emit('timerDebugJump', { preset: 'reset' });
      box.emit('timerStartSet', { seconds: 600 }); box.emit('timerStartControl', { action: 'start' });
      auto.emit('raceTimerAutoStart'); box.emit('raceTimerAutoStart');
      ok('via anticipato (mancano 600 s) rifiutato', st.raceTimer.phase === 'start');
      Date.now.extra = 599000; auto.emit('raceTimerAutoStart');
      ok('via a zero accettato', st.raceTimer.phase === 'race');
    }
    if (fase === '6') {                    // server vuoto, due box con copie diverse: vince la piu' recente, anche se arriva dopo
      const g = await join(box, 'BENZ', 'box'); const box2 = mk(); io.emit('connection', box2); await join(box2, 'BENZ', 'box');
      const st = g.state; const ora0 = Date.now();
      ok('benzina: server vuoto, serbatoio pieno di partenza', st.fresh.fuel === true && st.fuelSystem.currentLiters === 100);
      const fs1 = (litri, at) => ({ tankCapacityLiters: 100, currentLiters: litri, consumptionRatePerHour: 60, onTrack: true, sessionStartAt: at - 600000, sessionStartLiters: litri + 10, ripristino: true, copiaAt: at });
      box.emit('fuelSystemUpdate', fs1(50, ora0 - 60000));
      ok('benzina: prima copia accettata', st.fuelSystem.currentLiters === 50);
      box2.emit('fuelSystemUpdate', fs1(40, ora0 - 5000));
      ok('benzina: copia piu\' recente arrivata dopo vince', st.fuelSystem.currentLiters === 40);
      box.emit('fuelSystemUpdate', fs1(70, ora0 - 90000));
      ok('benzina: copia piu\' vecchia non pesta', st.fuelSystem.currentLiters === 40);
      box.emit('fuelSystemUpdate', { tankCapacityLiters: 100, currentLiters: 30, onTrack: true, sessionStartAt: ora0, sessionStartLiters: 35 });
      box2.emit('fuelSystemUpdate', fs1(90, ora0 + 1));
      ok('benzina: dopo un aggiornamento vero le copie non contano piu\'', st.fuelSystem.currentLiters === 30);
    }
    await archivio.svuota();
    fs.writeFileSync(process.env.ESITI, JSON.stringify(esiti));
    process.exit(0);
  })();
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riav-'));
  const T0 = Date.now(); let male = 0;
  const lancia = (fase, sposta, dati) => {
    const esiti = path.join(dir, 'esiti' + fase + '.json');
    const r = spawnSync(process.execPath, [__filename, 'fase', fase, String(sposta)], { env: { ...process.env, DATA_DIR: dir + '/dati', T0: String(T0), ESITI: esiti }, encoding: 'utf8' });
    process.stdout.write(r.stdout); if (r.stderr.trim()) process.stdout.write(r.stderr);
    if (r.status !== 0) { console.log('MALE la fase ' + fase + ' e\' finita male'); male++; return; }
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(esiti, 'utf8')))) if (!v) male++;
  };
  console.log('--- fase 1: gara con il conto alla rovescia acceso'); lancia('1', 0);
  console.log('--- fase 2: riavvio dopo 100 s'); lancia('2', 100);
  console.log('--- fase 3: riavvio dopo 700 s (via passato da spento)'); lancia('3', 700);
  console.log('--- fase 4: copia del box'); lancia('4', 0);
  console.log('--- fase 5: validazione'); lancia('5', 0);
  console.log('--- fase 6: benzina, copie dei box'); lancia('6', 0);
  console.log(male ? '\nPROVE FALLITE: ' + male : '\nTutto bene');
  process.exit(male ? 1 : 0);
}
