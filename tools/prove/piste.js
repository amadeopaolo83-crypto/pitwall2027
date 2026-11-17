// Libreria delle piste sul server (finti socket): salva, carica, nuova, elimina, copia automatica, archivio, ripristino.
// Serve web-push (anche finto) in NODE_PATH. Esce con 1 se un controllo fallisce.
const EventEmitter = require('events');
const C = require('./comune');
const V = C.controlli('piste');
delete process.env.BOX_PIN; delete process.env.DOPPIO_BOX;
const { registra } = require(C.SRC + '/sockets.js');
const archivio = require(C.SRC + '/archivio.js');
const { getRoomState } = require(C.SRC + '/rooms.js');
const stanze = new Map(); let contatore = 0;
const io = new EventEmitter();
io.to = (r) => ({ emit: (ev, d) => (stanze.get(r) || new Set()).forEach((s) => s.ricevi(ev, d)) });
const nuovo = () => {
  const dentro = new EventEmitter(), any = [], mws = [];
  const s = { id: 'sock' + (++contatore), data: {}, log: [], rooms: new Set() };
  s.ricevi = (ev, d) => s.log.push([ev, d]);
  s.on = dentro.on.bind(dentro); s.onAny = (f) => any.push(f); s.use = (f) => mws.push(f);
  s.join = (r) => { if (!stanze.has(r)) stanze.set(r, new Set()); stanze.get(r).add(s); };
  s.to = () => ({ emit() {} });
  s.emit = (ev, d) => s.ricevi(ev, d);
  s.invia = (ev, ...a) => { for (const f of any) f(ev, ...a); for (const m of mws) { let ok = false; m([ev, ...a], () => { ok = true; }); if (!ok) return false; } return dentro.emit(ev, ...a); };
  s.ultimo = (ev) => { const l = s.log.filter((e) => e[0] === ev); return l.length ? l[l.length - 1][1] : undefined; };
  io.emit('connection', s); return s;
};
registra(io);
const entra = (s, code, role) => new Promise((r) => s.invia('join', { code, role }, r));
const chiedi = (s, ev, d) => new Promise((r) => { const ris = s.invia(ev, ...(d === undefined ? [] : [d]), (x) => r(x)); if (ris === false) r(undefined); });
const P = (lat, lng) => ({ lat, lng });
const tracciato = Array.from({ length: 12 }, (_, i) => P(46.0 + 0.0005 * Math.cos(i / 12 * 6.283), 7.0 + 0.0007 * Math.sin(i / 12 * 6.283)));

(async () => {
  const box = nuovo(), auto = nuovo();
  const rj = await entra(box, 'PST', 'box'); const ra = await entra(auto, 'PST', 'auto');
  const S = getRoomState('PST');
  V.ok('stanza nuova: nessuna pista, fresh.piste', Array.isArray(rj.state.piste) && rj.state.piste.length === 0 && rj.state.fresh.piste === true);

  // pista A: zone, corsia, traguardo, tracciato
  box.invia('gpsConfigUpdate', { box: P(46.0, 7.0), refuel: P(46.0002, 7.0002), rBox: 12, corsia: [P(46.0, 7.0), P(46.0003, 7.0003), P(46.0006, 7.0006)], traguardo: [P(46.001, 7.001), P(46.001, 7.0012)], tracciato, limiteKmh: 50, on: true });
  let r = await chiedi(box, 'pistaSalva', { nome: '  Magny   Cours ' });
  V.ok('salva: ok e nome ripulito', r.ok && r.nome === 'Magny Cours' && r.nuova === true, r);
  V.ok('elenco aggiornato e pista attiva', S.piste.length === 1 && S.piste[0].nome === 'Magny Cours' && S.piste[0].el >= 5 && S.pistaAttiva === 'Magny Cours', S.piste);
  V.ok('tutti ricevono pisteUpdate', auto.ultimo('pisteUpdate') && auto.ultimo('pisteUpdate').elenco.length === 1 && box.ultimo('pisteUpdate').attiva === 'Magny Cours');
  V.ok('salvare non spegne il GPS', S.gps.on === true);

  // sicurezza: l'auto non puo', nomi strani, vuota
  r = await chiedi(auto, 'pistaSalva', { nome: 'Hack' }); V.ok('auto non salva (scartato)', r === undefined && !S.pisteLib.Hack);
  auto.invia('pistaNuova', {}); V.ok('auto non azzera la pista', !!S.gps.box);
  r = await chiedi(box, 'pistaSalva', { nome: '   ' }); V.ok('nome vuoto rifiutato', r.ok === false && r.error === 'nome', r);
  r = await chiedi(box, 'pistaSalva', { nome: '(copia automatica)' }); V.ok('nome riservato rifiutato', r.ok === false, r);
  r = await chiedi(box, 'pistaSalva', { nome: 'x'.repeat(100) }); V.ok('nome lungo accorciato a 40', r.ok && r.nome.length === 40, r.nome && r.nome.length);
  await chiedi(box, 'pistaElimina', { nome: 'x'.repeat(40) });

  // nuova pista
  r = await chiedi(box, 'pistaNuova', {});
  V.ok('nuova: tutto vuoto, GPS resta acceso', r.ok && !S.gps.box && !S.gps.refuel && !S.gps.corsia && !S.gps.traguardo && !S.gps.tracciato && !S.gps.giroRif && S.gps.on === true && S.gps.rBox === 10 && S.gps.limiteKmh === 60, S.gps);
  V.ok('nuova: copia automatica della pista di prima', S.pisteLib['(copia automatica)'] && S.pisteLib['(copia automatica)'].dati.box.lat === 46.0, Object.keys(S.pisteLib));
  V.ok('nuova: nessuna pista attiva, tutti avvisati del GPS vuoto', S.pistaAttiva === null && auto.ultimo('gpsConfigUpdate').box === null);
  r = await chiedi(box, 'pistaSalva', { nome: 'Vuota' }); V.ok('pista vuota non si salva', r.ok === false && r.error === 'vuota', r);

  // pista B diversa, poi ricarico A
  box.invia('gpsConfigUpdate', { box: P(45.5, 9.0), rBox: 8, traguardo: [P(45.501, 9.001), P(45.501, 9.0013)] });
  r = await chiedi(box, 'pistaSalva', { nome: 'Monza' }); V.ok('seconda pista salvata', r.ok && S.piste.length >= 2);
  r = await chiedi(box, 'pistaCarica', { nome: 'Magny Cours' });
  V.ok('carica A: zone, corsia, traguardo, tracciato, raggi e limite tornano', r.ok && S.gps.box.lat === 46.0 && S.gps.rBox === 12 && S.gps.corsia.length === 3 && S.gps.traguardo && S.gps.tracciato.length === 12 && S.gps.limiteKmh === 50 && S.gps.refuel.lat === 46.0002, S.gps);
  V.ok('carica A: niente di B rimasto (monza non ha corsia ne tracciato: ora li ha A; verifico B->A senza residui)', S.gps.box.lng === 7.0);
  r = await chiedi(box, 'pistaCarica', { nome: 'Monza' });
  V.ok('carica B su A: corsia, tracciato e refuel di A spariscono', r.ok && S.gps.box.lat === 45.5 && S.gps.corsia === null && S.gps.tracciato === null && S.gps.refuel === null && S.gps.rBox === 8 && S.gps.limiteKmh === 60, S.gps);
  V.ok('carica: la pista di prima e\' in copia automatica (era A)', S.pisteLib['(copia automatica)'].dati.corsia && S.pistaAttiva === 'Monza');
  r = await chiedi(box, 'pistaCarica', { nome: '(copia automatica)' });
  V.ok('si puo\' tornare alla copia automatica (e non la sovrascrive con se stessa)', r.ok && S.gps.corsia && S.gps.corsia.length === 3 && S.pistaAttiva === null);
  r = await chiedi(box, 'pistaCarica', { nome: 'Inesistente' }); V.ok('pista che non c\'e\': rifiutata', r.ok === false, r);
  r = await chiedi(box, 'pistaCarica', { nome: '__proto__' }); V.ok('__proto__ rifiutato', r.ok === false, r);

  // dati veri: solo al box
  const lib = await chiedi(box, 'pisteChiedi'); const libA = await chiedi(auto, 'pisteChiedi');
  V.ok('pisteChiedi: il box riceve i dati, l\'auto no', lib && lib.lib['Magny Cours'] && libA === undefined);
  V.ok('lo stato che va all\'auto non contiene i dati delle piste', !JSON.stringify(ra.state).includes('"dati"') && !JSON.stringify(ra.state).includes('pisteLib') && Array.isArray(ra.state.piste) && ra.state.piste.every((p) => Object.keys(p).join() === 'nome,at,el'), Object.keys(ra.state).filter((k) => /piste/i.test(k)));

  // eliminazione
  r = await chiedi(box, 'pistaElimina', { nome: 'Monza' }); V.ok('elimina', r.ok && !S.pisteLib.Monza && !S.piste.some((p) => p.nome === 'Monza'));
  r = await chiedi(box, 'pistaElimina', { nome: 'Monza' }); V.ok('eliminare due volte: rifiutato', r.ok === false);

  // archivio: salva e rimette
  const foto = JSON.parse(JSON.stringify(archivio.istantanea(S)));
  V.ok('istantanea contiene le piste', foto.piste && foto.piste['Magny Cours'] && foto.piste['Magny Cours'].dati.box);
  const S2 = getRoomState('ARC'); archivio.applica(S2, foto);
  V.ok('applica: piste e elenco rimessi, fresh spento', S2.pisteLib['Magny Cours'].dati.corsia.length === 3 && S2.piste.length === S.piste.length && S2.fresh.piste === false, S2.piste);
  const S3 = getRoomState('ARC2'); archivio.applica(S3, { piste: { 'Rotta': { at: 1, dati: { box: { lat: 999, lng: 0 } } }, 'Ok': { at: 2, dati: { box: P(1, 1), rBox: 9999 } }, '': { dati: { box: P(1, 1) } }, 'Strana': 5 } });
  V.ok('applica: scarta le piste con dati non validi e ripulisce i valori', !S3.pisteLib.Rotta && !S3.pisteLib[''] && !S3.pisteLib.Strana && S3.pisteLib.Ok && S3.pisteLib.Ok.dati.rBox === 10, Object.keys(S3.pisteLib));

  // riavvio senza archivio: il box rimanda la sua copia, una volta sola
  const box2 = nuovo(); const r2 = await entra(box2, 'RIV', 'box'); const S4 = getRoomState('RIV');
  V.ok('stanza nuova: fresh.piste', r2.state.fresh.piste === true);
  box2.invia('pisteRipristino', { lib: lib.lib });
  V.ok('ripristino: la libreria torna e l\'elenco e\' aggiornato', S4.pisteLib['Magny Cours'] && S4.piste.length >= 1 && S4.fresh.piste === false, S4.piste);
  const prima = Object.keys(S4.pisteLib).length;
  box2.invia('pisteRipristino', { lib: { 'Altra': { at: 1, dati: { box: P(2, 2) } } } });
  V.ok('ripristino: una volta sola', Object.keys(S4.pisteLib).length === prima);
  const aut2 = nuovo(); await entra(aut2, 'RIV2', 'auto'); aut2.invia('pisteRipristino', { lib: lib.lib });
  V.ok('ripristino dall\'auto ignorato', Object.keys(getRoomState('RIV2').pisteLib).length === 0);

  // limite 20
  const box3 = nuovo(); await entra(box3, 'LIM', 'box'); box3.invia('gpsConfigUpdate', { box: P(10, 10) });
  let okN = 0; for (let i = 0; i < 25; i++) { const x = await chiedi(box3, 'pistaSalva', { nome: 'P' + i }); if (x.ok) okN++; }
  V.ok('al massimo 20 piste (e si puo\' sempre aggiornarne una)', okN === 20 && (await chiedi(box3, 'pistaSalva', { nome: 'P0' })).ok === true, okN);
  V.fine();
})();
