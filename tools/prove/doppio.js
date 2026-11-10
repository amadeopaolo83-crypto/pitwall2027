// Doppio box sul server (finti socket che distinguono "dal telefono al server" e "dal server al telefono").
// Serve web-push (anche finto) in NODE_PATH. Esce con 1 se un controllo fallisce.
const EventEmitter = require('events');
const C = require('./comune');
const V = C.controlli('doppio');
process.env.DOPPIO_BOX = '1'; delete process.env.BOX_PIN;
const { registra } = require(C.SRC + '/sockets.js');
const doppio = require(C.SRC + '/doppiobox.js');
const stanze = new Map();                         // stanza -> Set(socket)
let contatore = 0;
const io = new EventEmitter();
io.to = (r) => ({ emit: (ev, d) => (stanze.get(r) || new Set()).forEach((s) => s.ricevi(ev, d)) });
const nuovo = (nome) => {
  const dentro = new EventEmitter(), any = [], mws = [];
  const s = { id: 'sock' + (++contatore), nome, data: {}, log: [], rooms: new Set() };
  s.ricevi = (ev, d) => s.log.push([ev, d]);
  s.on = dentro.on.bind(dentro); s.onAny = (f) => any.push(f); s.use = (f) => mws.push(f);
  s.join = (r) => { s.rooms.add(r); if (!stanze.has(r)) stanze.set(r, new Set()); stanze.get(r).add(s); };
  s.to = (r) => ({ emit: (ev, d) => (stanze.get(r) || new Set()).forEach((x) => { if (x !== s) x.ricevi(ev, d); }) });
  s.emit = (ev, d) => s.ricevi(ev, d);            // dal server verso questo telefono
  s.invia = (ev, ...a) => {                         // dal telefono al server
    for (const f of any) f(ev, ...a);
    for (const m of mws) { let passa = false; m([ev, ...a], () => { passa = true; }); if (!passa) return false; }
    return dentro.emit(ev, ...a);
  };
  s.stacca = () => { stanze.forEach((set) => set.delete(s)); dentro.emit('disconnect'); };
  s.vide = (ev) => s.log.filter((e) => e[0] === ev);
  s.ultimo = (ev) => { const l = s.vide(ev); return l.length ? l[l.length - 1][1] : undefined; };
  io.emit('connection', s);
  return s;
};
registra(io);
const entra = (s, code, role, boxId) => new Promise((r) => s.invia('join', { code, role, boxId }, r));
const ruolo = (s) => (s.ultimo('boxRuolo') || {}).ruolo;
const timerUpd = (code) => (stanze.get(code) || new Set()).size; // solo per leggere lo stato dopo
const { getRoomState } = require(C.SRC + '/rooms.js');

(async () => {
  const A = nuovo('A'), B = nuovo('B'), auto = nuovo('auto');
  let r = await entra(A, 'DBL', 'box', 'idA');
  V.ok('box da solo: primario, un box', r.boxRuolo.ruolo === 'primario' && r.boxRuolo.n === 1);
  r = await entra(B, 'DBL', 'box', 'idB'); await entra(auto, 'DBL', 'auto');
  V.ok('secondo box: secondario', r.boxRuolo.ruolo === 'secondario' && r.boxRuolo.n === 2, r.boxRuolo);
  V.ok('il primo e\' stato avvisato (2 box, ancora primario)', A.ultimo('boxRuolo') && A.ultimo('boxRuolo').n === 2 && A.ultimo('boxRuolo').ruolo === 'primario');
  const t = getRoomState('DBL').raceTimer;

  // comandi
  B.invia('timerStartSet', { seconds: 123 });
  V.ok('secondario: timer non si cambia', t.startSeconds !== 123);
  V.ok('secondario: riceve l\'avviso "solo primario"', B.vide('boxNegato').length === 1);
  A.invia('timerStartSet', { seconds: 123 });
  V.ok('primario: timer si cambia', t.startSeconds === 123);
  B.invia('raceStart'); V.ok('secondario: gara non parte', getRoomState('DBL').race.active === false);
  B.invia('gpsConfigUpdate', { on: true }); V.ok('secondario: GPS non si cambia', getRoomState('DBL').gps.on === false);
  let ack = null; B.invia('aubConnect', { driverId: 'x', url: '', user: '', pass: '' }, (a) => { ack = a; });
  V.ok('secondario: chi aspetta una risposta la riceve (ok:false)', ack && ack.ok === false && ack.error === 'secondario', ack);
  auto.invia('timerStartSet', { seconds: 1 }); V.ok('auto: ancora niente comandi', t.startSeconds === 123);

  // cio' che il secondario puo' fare
  B.invia('flashMessage', { text: 'URGENTE', color: '#ff0000', durationSeconds: 8 });
  V.ok('secondario: manda messaggi all\'auto', auto.vide('flashMessage').length === 1 && auto.ultimo('flashMessage').text === 'URGENTE');
  B.invia('fuelSystemUpdate', { tankCapacityLiters: 100, currentLiters: 77, onTrack: false });
  V.ok('secondario: registra il rifornimento, lo vede anche il primario', getRoomState('DBL').fuelSystem.currentLiters === 77 && A.ultimo('fuelSystemUpdate').currentLiters === 77);
  B.invia('quickButtonsUpdate', { buttons: [{ id: 1, label: 'x', color: '#000000' }] });
  V.ok('secondario: i pulsanti non si cambiano', getRoomState('DBL').quickButtons[0].label !== 'x');
  B.invia('timerRestore', { phase: 'start' });         // non e' bloccato: la validazione lo scarta da sola
  V.ok('secondario: il ripristino dopo un riavvio non e\' bloccato', B.vide('boxNegato').length === 5);   // i 5 comandi riservati di prima, non questo
  B.invia('quickButtonsUpdate', { buttons: [{ id: 1, label: 'rip', color: '#000000' }], ripristino: true });
  V.ok('secondario: i pulsanti con "ripristino" passano', B.vide('boxNegato').length === 5);

  // cambio pilota
  A.invia('cambioDomanda', { ancoraDa: Date.now() - 70000 });
  V.ok('cambio pilota: la domanda arriva anche al secondario', B.vide('cambioDomanda').length === 1);
  B.invia('cambioRisposta', { si: true, n: 1 });
  V.ok('cambio pilota: risposta dal secondario, la riceve il primario', A.ultimo('cambioRisposta') && A.ultimo('cambioRisposta').si === true && A.ultimo('cambioRisposta').cambioPilota.n === 1);
  A.invia('cambioRisposta', { si: true, n: 2 });
  V.ok('cambio pilota: una sola risposta vale (la seconda e\' ignorata)', B.vide('cambioRisposta').length === 0 && getRoomState('DBL').cambioPilota.n === 1);
  B.invia('cambioDomanda', { ancoraDa: 1 }); V.ok('cambio pilota: il secondario non apre la domanda', A.vide('cambioDomanda').length === 0);
  B.invia('cambioAzzera'); V.ok('cambio pilota: il secondario non azzera i cambi', getRoomState('DBL').cambioPilota.n === 1);

  // cedere la priorita'
  B.invia('boxCedi', { minuti: 15 }); V.ok('secondario non puo cedere', ruolo(A) === 'primario');
  A.invia('boxCedi', { minuti: 7 }); V.ok('tempo non previsto (7 min) rifiutato', ruolo(A) === 'primario');
  A.invia('boxCedi', { minuti: 15 });
  V.ok('cedi 15 min: A secondario, B primario', ruolo(A) === 'secondario' && ruolo(B) === 'primario');
  V.ok('cedi: chi ha ceduto sa quando torna', A.ultimo('boxRuolo').cessione && A.ultimo('boxRuolo').cessione.daMe === true && B.ultimo('boxRuolo').cessione.perMe === true);
  B.invia('timerStartSet', { seconds: 200 }); V.ok('cedi: ora comanda B', t.startSeconds === 200);
  A.invia('timerStartSet', { seconds: 300 }); V.ok('cedi: A non comanda piu\'', t.startSeconds === 200);
  A.invia('boxRiprendi'); V.ok('riprendi: A torna primario subito', ruolo(A) === 'primario' && ruolo(B) === 'secondario');
  A.invia('boxCedi', { minuti: 30 });
  const vero = Date.now; Date.now = () => vero() + 31 * 60000; doppio.restituisci('DBL'); Date.now = vero;
  V.ok('scade la cessione: torna ad A da sola', ruolo(A) === 'primario' && A.ultimo('boxRuolo').cessione === null);

  // prendere il comando
  B.invia('boxPrendi'); V.ok('prendi: B diventa primario, A secondario', ruolo(B) === 'primario' && ruolo(A) === 'secondario');

  // primario scollegato
  B.stacca();
  V.ok('primario scollegato da poco: A (da solo) comanda comunque', (A.invia('timerStartSet', { seconds: 250 }), t.startSeconds === 250));
  const B2 = nuovo('B2'); r = await entra(B2, 'DBL', 'box', 'idB');
  V.ok('B si ricollega entro 20 s con lo stesso numero: torna primario', r.boxRuolo.ruolo === 'primario' && ruolo(A) === 'secondario', r.boxRuolo);
  B2.stacca();
  Date.now = () => vero() + 25000; doppio.controlla('DBL'); Date.now = vero;
  V.ok('primario assente oltre 20 s: il comando passa ad A', ruolo(A) === 'primario');
  const B3 = nuovo('B3'); r = await entra(B3, 'DBL', 'box', 'idB');
  V.ok('B rientra tardi: secondario', r.boxRuolo.ruolo === 'secondario');

  // tre box
  const Cc = nuovo('C'); r = await entra(Cc, 'DBL', 'box', 'idC');
  V.ok('terzo box: secondario, tre collegati', r.boxRuolo.ruolo === 'secondario' && r.boxRuolo.n === 3);
  A.invia('boxCedi', { minuti: 60 });
  V.ok('con tre box la priorita\' va al piu\' anziano (B)', ruolo(B3) === 'primario' && ruolo(Cc) === 'secondario' && ruolo(A) === 'secondario');

  // spento (senza DOPPIO_BOX) tutto come prima
  process.env.DOPPIO_BOX = '0';
  const X = nuovo('X'), Y = nuovo('Y'); await entra(X, 'OFF', 'box', 'x1'); await entra(Y, 'OFF', 'box', 'y1');
  const t2 = getRoomState('OFF').raceTimer; Y.invia('timerStartSet', { seconds: 321 });
  V.ok('doppio box spento: il secondo box comanda come prima', t2.startSeconds === 321 && Y.vide('boxNegato').length === 0);
  V.ok('doppio box spento: nessun ruolo', Y.ultimo('boxRuolo') === undefined || Y.ultimo('boxRuolo').attivo === false);
  V.fine();
})();
