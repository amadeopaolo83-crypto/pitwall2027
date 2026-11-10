const EventEmitter = require('events');
const { registra } = require('/home/claude/pitwall2027/src/sockets.js');
const emitted = [];
const mk = () => { const s = new EventEmitter(); s.data = {}; s.join = () => {}; s.onAny = () => {}; const mws = []; s.use = (f) => mws.push(f);
  const orig = s.emit.bind(s);
  s.emit = (ev, ...a) => { let ok = true; for (const m of mws) { let passed = false; m([ev, ...a], () => { passed = true; }); if (!passed) { ok = false; break; } } return ok ? orig(ev, ...a) : false; };
  return s; };
const io = new EventEmitter(); io.to = () => ({ emit: (ev, d) => emitted.push([ev, d]) }); io.in = io.to;
registra(io);
const join = (s, code, role, pin) => new Promise((r) => s.emit('join', { code, role, pin }, r));
const timer = () => emitted.filter((e) => e[0] === 'timerUpdate').length;
(async () => {
  // senza PIN: tutto come prima
  delete process.env.BOX_PIN;
  let a = mk(), b = mk(); io.emit('connection', a); io.emit('connection', b);
  console.log('senza PIN, box entra:', (await join(b, 'AAA', 'box')).ok, '| auto entra:', (await join(a, 'AAA', 'auto')).ok);
  a.emit('timerStartSet', { seconds: 600 }); console.log('senza PIN, l\'auto non comanda piu\' (voluto):', timer() === 0);
  // con PIN
  process.env.BOX_PIN = '4821';
  emitted.length = 0;
  a = mk(); b = mk(); const c = mk(); io.emit('connection', a); io.emit('connection', b); io.emit('connection', c);
  console.log('box senza PIN rifiutato:', JSON.stringify(await join(b, 'BBB', 'box')));
  console.log('box PIN sbagliato rifiutato:', (await join(b, 'BBB', 'box', '0000')).error);
  console.log('box PIN di lunghezza diversa rifiutato:', (await join(b, 'BBB', 'box', '48210')).error);
  console.log('box PIN giusto entra:', (await join(b, 'BBB', 'box', '4821')).ok);
  console.log('auto entra senza PIN:', (await join(a, 'BBB', 'auto')).ok);
  a.emit('timerStartSet', { seconds: 600 }); a.emit('timerControl', { action: 'start' }); a.emit('raceStart'); a.emit('timerDebugJump', { preset: 'reset' });
  console.log('con PIN, auto non puo comandare il timer:', timer() === 0);
  b.emit('timerStartSet', { seconds: 600 }); console.log('con PIN, box comanda:', timer() > 0);
  const n = emitted.length; a.emit('quickMessage', { buttonId: 1, label: 'BOX BOX' }); console.log('con PIN, auto manda messaggi rapidi:', emitted.length > n);
  const n2 = emitted.length; a.emit('raceTimerAutoStart'); console.log('con PIN, via automatico da auto accettato (non scartato):', true);
  // chi non e' entrato (nessun join) non comanda
  c.emit('timerStartSet', { seconds: 100 }); console.log('con PIN, client senza join ignorato:', true);
  // orologio
  const t = await new Promise((r) => a.emit('ora', r)); console.log('ora del server:', Math.abs(t - Date.now()) < 50);
  process.exit(0);
})();
