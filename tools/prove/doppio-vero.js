// Doppio box con il server VERO (node src/server.js, DOPPIO_BOX=1) e socket.io-client: 2 box + 1 auto.
// Controlla: comandi riservati negati al secondario (l'elenco SOLO_PRIMARIO si legge da sockets.js), cio' che il
// secondario puo' fare, cedi / riprendi / prendi, ricollegamento, primario perso per 20 s, e che un evento scartato
// dal filtro (socket.use) non lasci tracce (fresh.timer, salvataggio nell'archivio).
// Serve socket.io-client: npm install --no-save socket.io-client@4 (su GitHub lo installa prove.yml).
// Dura circa 30 s (l'attesa del primario perso e' di 20 s). Esce con 1 se un controllo fallisce.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const C = require('./comune');
const V = C.controlli('doppio-vero');
let io;
try { io = require('socket.io-client'); } catch (e) { console.log('MALE manca socket.io-client (npm install --no-save socket.io-client@4)'); process.exit(1); }

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const portaLibera = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

// L'elenco dei comandi riservati al primario, letto dal codice: se si aggiunge un comando, la prova lo prova.
const sorgente = fs.readFileSync(path.join(C.SRC, 'sockets.js'), 'utf8');
const SOLO_PRIMARIO = [...(/const SOLO_PRIMARIO = new Set\(\[([\s\S]*?)\]\)/.exec(sorgente) || [, ''])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

(async () => {
  const PORTA = await portaLibera();
  const DATI = fs.mkdtempSync(path.join(os.tmpdir(), 'pitcomm-doppio-'));
  const env = { ...process.env, PORT: String(PORTA), DOPPIO_BOX: '1', DATA_DIR: DATI, ARCHIVIO_RITARDO_MS: '100' };
  for (const k of ['BOX_PIN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RENDER_EXTERNAL_URL', 'SELF_URL', 'BRIDGE_URL', 'AUB_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete env[k];
  const srv = spawn(process.execPath, [path.join(C.SRC, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logSrv = '';
  srv.stdout.on('data', (d) => { logSrv += d; }); srv.stderr.on('data', (d) => { logSrv += d; });
  const fine = (codice) => { try { srv.kill(); } catch (e) { /* gia' fermo */ } fs.rmSync(DATI, { recursive: true, force: true }); if (codice) console.log('--- registro del server ---\n' + logSrv.slice(-3000)); };
  process.on('exit', () => { try { srv.kill(); } catch (e) { /* niente */ } });
  for (let i = 0; i < 100 && !/in ascolto/.test(logSrv); i++) await attendi(100);
  V.ok('server partito con DOPPIO_BOX=1', /in ascolto/.test(logSrv), logSrv.slice(-500));

  const URL = 'http://127.0.0.1:' + PORTA;
  const telefono = (nome) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.nome = nome; s.log = [];
    s.onAny((ev, d) => s.log.push([ev, d]));
    s.vide = (ev) => s.log.filter((e) => e[0] === ev);
    s.ultimo = (ev) => { const l = s.vide(ev); return l.length ? l[l.length - 1][1] : undefined; };
    s.svuota = () => { s.log.length = 0; };
    return s;
  };
  const collegato = (s) => new Promise((r, x) => { if (s.connected) return r(); s.once('connect', r); s.once('connect_error', x); });
  const chiedi = (s, ev, dati) => s.timeout(3000).emitWithAck(ev, dati).catch(() => ({ scaduto: true }));
  const entra = async (s, code, role, boxId) => { await collegato(s); return chiedi(s, 'join', { code, role, boxId }); };
  const ruolo = (s) => (s.ultimo('boxRuolo') || {}).ruolo;
  const statoStanza = async (code) => { const o = telefono('osservatore'); const r = await entra(o, code, 'auto'); o.close(); return r.state; };

  try {
    // ---------- ingresso ----------
    const A = telefono('A'), B = telefono('B'), auto = telefono('auto');
    const rA = await entra(A, 'DBV', 'box', 'telA');
    V.ok('primo box: primario', rA.ok && rA.boxRuolo && rA.boxRuolo.attivo && rA.boxRuolo.ruolo === 'primario', rA.boxRuolo);
    const rB = await entra(B, 'DBV', 'box', 'telB');
    V.ok('secondo box: secondario (2 box)', rB.boxRuolo && rB.boxRuolo.ruolo === 'secondario' && rB.boxRuolo.n === 2, rB.boxRuolo);
    const rAu = await entra(auto, 'DBV', 'auto');
    V.ok('auto entra senza ruolo di box', rAu.ok && rAu.boxRuolo === null, rAu.boxRuolo);
    await attendi(150);
    V.ok('il primario riceve "2 box, sei primario"', ruolo(A) === 'primario' && A.ultimo('boxRuolo').n === 2, A.ultimo('boxRuolo'));

    // ---------- comandi riservati: tutti negati al secondario ----------
    V.ok('elenco SOLO_PRIMARIO letto da sockets.js', SOLO_PRIMARIO.length >= 20, SOLO_PRIMARIO.length);
    const prima = await statoStanza('DBV');
    A.svuota(); B.svuota(); auto.svuota();
    for (const ev of SOLO_PRIMARIO) B.emit(ev, { seconds: 123, action: 'start', on: true, buttons: [{ id: 1, label: 'x', color: '#ff0000' }], dayMode: false, view: 'categoria', layout: 'tablet', valore: 1, mode: 'auto', source: 'manual' });
    await attendi(500);
    const negati = new Set(B.vide('boxNegato').map((e) => e[1].evento));
    const mancano = SOLO_PRIMARIO.filter((e) => !negati.has(e));
    V.ok(`secondario: tutti i ${SOLO_PRIMARIO.length} comandi riservati negati con "boxNegato"`, mancano.length === 0, mancano);
    const dopo = await statoStanza('DBV');
    const J = JSON.stringify;
    V.ok('secondario: timer, gara, GPS, pulsanti, giorno/notte, vista auto invariati',
      J(dopo.raceTimer) === J(prima.raceTimer) && J(dopo.race) === J(prima.race) && J(dopo.gps) === J(prima.gps) && J(dopo.quickButtons) === J(prima.quickButtons)
      && dopo.dayMode === prima.dayMode && dopo.timingView === prima.timingView && dopo.autoLayout === prima.autoLayout && dopo.sogliaGap === prima.sogliaGap,
      { timer: [prima.raceTimer.startSeconds, dopo.raceTimer.startSeconds], race: dopo.race, gps: dopo.gps.on, giorno: dopo.dayMode });
    V.ok('secondario: primario e auto non ricevono nessun aggiornamento', A.vide('timerUpdate').length === 0 && auto.vide('timerUpdate').length === 0 && auto.vide('dayModeUpdate').length === 0 && auto.vide('gpsConfigUpdate').length === 0,
      [A.log.map((e) => e[0]), auto.log.map((e) => e[0])]);
    const ackAub = await chiedi(B, 'aubConnect', { driverId: '7' });
    V.ok('secondario: chi aspetta una risposta riceve { ok:false, error:"secondario" }', ackAub.ok === false && ackAub.error === 'secondario', ackAub);

    // ---------- cio' che il secondario puo' fare ----------
    B.svuota();
    B.emit('flashMessage', { text: 'URGENTE', color: '#ff0000', durationSeconds: 5 });
    B.emit('fuelSystemUpdate', { tankCapacityLiters: 100, currentLiters: 77, consumptionRatePerHour: null, onTrack: false, sessionStartAt: null, sessionStartLiters: 0, salvatoAt: Date.now() });
    B.emit('quickButtonsUpdate', { buttons: [{ id: 1, label: 'Box', color: '#3fa9f5' }], ripristino: true });
    await attendi(300);
    V.ok('secondario: messaggio a schermo intero arriva all\'auto', auto.ultimo('flashMessage') && auto.ultimo('flashMessage').text === 'URGENTE', auto.ultimo('flashMessage'));
    V.ok('secondario: rifornimento registrato, lo vede il primario', A.ultimo('fuelSystemUpdate') && A.ultimo('fuelSystemUpdate').currentLiters === 77, A.ultimo('fuelSystemUpdate'));
    V.ok('secondario: ripristino dei pulsanti dopo un riavvio non negato', B.vide('boxNegato').length === 0, B.vide('boxNegato'));

    // ---------- primario e auto ----------
    B.svuota(); auto.svuota();
    A.emit('timerStartSet', { seconds: 321 });
    await attendi(200);
    V.ok('primario: imposta il timer, lo ricevono secondario e auto', B.ultimo('timerUpdate') && B.ultimo('timerUpdate').startSeconds === 321 && auto.ultimo('timerUpdate') && auto.ultimo('timerUpdate').startSeconds === 321);
    A.svuota(); auto.svuota();
    auto.emit('timerControl', { action: 'start' }); auto.emit('raceStart');
    await attendi(200);
    V.ok('auto: comandi del box scartati in silenzio', A.vide('timerUpdate').length === 0 && A.vide('raceStatus').length === 0 && auto.vide('boxNegato').length === 0);

    // ---------- cedi ----------
    A.svuota(); B.svuota();
    B.emit('boxCedi', { minuti: 15 }); A.emit('boxCedi', { minuti: 7 });
    await attendi(200);
    V.ok('cedi: il secondario non puo cedere, 7 minuti non e\' una scelta', A.vide('boxRuolo').length === 0 && B.vide('boxRuolo').length === 0);
    const t0 = Date.now();
    A.emit('boxCedi', { minuti: 15 });
    await attendi(200);
    const cA = A.ultimo('boxRuolo'), cB = B.ultimo('boxRuolo');
    V.ok('cedi 15 min: A secondario, B primario', cA && cA.ruolo === 'secondario' && cB && cB.ruolo === 'primario', [cA, cB]);
    V.ok('cedi 15 min: scadenza tra 15 minuti, A "da me", B "per me"', cA && cA.cessione && cA.cessione.daMe && cB.cessione.perMe && Math.abs(cA.cessione.finoA - (t0 + 15 * 60000)) < 3000, cA && cA.cessione);
    A.svuota(); B.svuota();
    B.emit('timerStartSet', { seconds: 111 }); A.emit('timerStartSet', { seconds: 222 });
    await attendi(200);
    V.ok('durante la cessione: B comanda, A negato', A.ultimo('timerUpdate') && A.ultimo('timerUpdate').startSeconds === 111 && A.vide('boxNegato').length === 1 && B.vide('boxNegato').length === 0, [A.ultimo('timerUpdate') && A.ultimo('timerUpdate').startSeconds, A.vide('boxNegato')]);

    // ---------- riprendi ----------
    A.svuota(); B.svuota();
    B.emit('boxRiprendi'); await attendi(200);
    V.ok('riprendi: chi non ha ceduto non riprende', B.vide('boxRuolo').length === 0 && ruolo(A) === undefined);
    A.emit('boxRiprendi'); await attendi(200);
    V.ok('riprendi: A torna primario, cessione chiusa', ruolo(A) === 'primario' && ruolo(B) === 'secondario' && A.ultimo('boxRuolo').cessione === null, [A.ultimo('boxRuolo'), B.ultimo('boxRuolo')]);

    // ---------- prendi ----------
    A.svuota(); B.svuota();
    B.emit('boxPrendi'); await attendi(200);
    V.ok('prendi: B primario, A secondario', ruolo(B) === 'primario' && ruolo(A) === 'secondario', [A.ultimo('boxRuolo'), B.ultimo('boxRuolo')]);
    A.svuota();
    A.emit('raceStart'); await attendi(200);
    V.ok('prendi: ora A e\' negato', A.vide('boxNegato').length === 1 && A.vide('raceStatus').length === 0);
    A.emit('boxPrendi'); await attendi(200);
    V.ok('prendi: A riprende il comando', ruolo(A) === 'primario' && ruolo(B) === 'secondario');

    // ---------- ricollegamento dello stesso telefono ----------
    A.close(); await attendi(300);
    const A2 = telefono('A2');
    const rA2 = await entra(A2, 'DBV', 'box', 'telA');
    V.ok('ricollegato con lo stesso boxId: resta primario', rA2.boxRuolo && rA2.boxRuolo.ruolo === 'primario', rA2.boxRuolo);

    // ---------- primario perso per 20 s ----------
    // Da solo un box comanda sempre: appena A si scollega B e' "primario" (n = 1). I 20 s decidono chi e'
    // primario quando A rientra: prima dei 20 s torna A, dopo resta B.
    B.svuota();
    A2.close();
    await attendi(3000);
    V.ok('A scollegato da 3 s: B da solo comanda (n = 1)', ruolo(B) === 'primario' && B.ultimo('boxRuolo').n === 1, B.ultimo('boxRuolo'));
    const A3 = telefono('A3');
    const rA3 = await entra(A3, 'DBV', 'box', 'telA');
    await attendi(200);
    V.ok('A rientra entro 20 s: torna primario, B secondario', rA3.boxRuolo && rA3.boxRuolo.ruolo === 'primario' && ruolo(B) === 'secondario', [rA3.boxRuolo, B.ultimo('boxRuolo')]);
    A3.close();
    await attendi(21500);
    const A4 = telefono('A4');
    const rA4 = await entra(A4, 'DBV', 'box', 'telA');
    await attendi(200);
    V.ok('A rientra dopo 21 s: B resta primario, A secondario', rA4.boxRuolo && rA4.boxRuolo.ruolo === 'secondario' && ruolo(B) === 'primario', [rA4.boxRuolo, B.ultimo('boxRuolo')]);

    // ---------- il filtro socket.use e onAny ----------
    // In socket.io gli ascoltatori onAny girano PRIMA dei middleware socket.use: un evento scartato dal filtro non
    // deve comunque spegnere fresh.timer (la copia del timer del box dopo un riavvio) ne' far salvare l'archivio.
    const P = telefono('P'), S = telefono('S'), au2 = telefono('au2');
    await entra(P, 'ORD', 'box', 'ordP'); await entra(S, 'ORD', 'box', 'ordS'); await entra(au2, 'ORD', 'auto');
    const f0 = await statoStanza('ORD');
    V.ok('stanza nuova: fresh.timer acceso', f0.fresh && f0.fresh.timer === true, f0.fresh);
    au2.emit('timerControl', { action: 'start' }); au2.emit('timerStartSet', { seconds: 50 });
    S.emit('timerControl', { action: 'start' }); S.emit('timerRaceSet', { seconds: 999 }); S.emit('dayModeUpdate', { dayMode: false });
    await attendi(600);
    const f1 = await statoStanza('ORD');
    V.ok('eventi scartati (auto e secondario): fresh.timer resta acceso', f1.fresh.timer === true, f1.fresh);
    V.ok('eventi scartati: nessun salvataggio nell\'archivio', !fs.existsSync(path.join(DATI, 'ORD.json')), fs.readdirSync(DATI));
    P.emit('timerStartSet', { seconds: 77 });
    await attendi(600);
    const f2 = await statoStanza('ORD');
    V.ok('evento accettato (primario): fresh.timer si spegne e l\'archivio salva', f2.fresh.timer === false && fs.existsSync(path.join(DATI, 'ORD.json')), [f2.fresh.timer, fs.readdirSync(DATI)]);

    for (const s of [B, auto, A4, P, S, au2]) s.close();
    V.ok('il server non ha registrato errori', !/\[socket |Error|uncaught/i.test(logSrv), logSrv.slice(-800));
  } catch (e) {
    V.ok('prova senza eccezioni', false, e.stack);
  }
  fine(V.male);
  V.fine();
})();
