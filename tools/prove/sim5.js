// Finto ponte del simulatore: classifica coerente, safety car e pause, collegamento con ponte.js (HTTP vero + computeTiming).
const C = require('./comune'); const V = C.controlli('sim5');
process.env.SIM_PONTE = '1';
const Pista = require(C.ROOT + '/js/pista.js');
const fs = require('fs'), path = require('path'), http = require('http');
const gps = JSON.parse(fs.readFileSync(path.join(C.ROOT, '..', 'tools/sim/varano.json'), 'utf8')).gps;
const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
const corsa = Pista.pianifica(pista, [{ giri: 5, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 5, pit: { dove: 'box', sostaS: 90 } }, { giri: 5, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 3 }], Object.assign({}, opz, { rallentamenti: [{ daGiro: 12, giri: 2, fattore: 0.5 }], pause: [{ giro: 9, durataS: 120 }] }));
V.ok('il simulatore ha passaggi, una finestra di safety e una pausa', corsa.passaggi.length > 18 && corsa.finestre.length === 1 && corsa.pauseT.length === 1, [corsa.passaggi.length, corsa.finestre, corsa.pauseT]);

const sp = require(C.SRC + '/simponte.js');
const richiesta = { evento: 'prova', numero: '77', giroS: 100, passaggi: corsa.passaggi, finestre: corsa.finestre, pause: corsa.pauseT, tGara: -300, seme: 5, nAuto: 14 };
const r = sp.avvia(richiesta);
V.ok('avvia: ok con 14 auto', r.ok && r.auto === 14, r);
V.ok('avvia: rifiuta dati sbagliati', !sp.avvia(Object.assign({}, richiesta, { giroS: 5 })).ok && !sp.avvia(Object.assign({}, richiesta, { passaggi: 'x' })).ok && !sp.avvia(Object.assign({}, richiesta, { evento: '../x' })).ok && !sp.avvia(null).ok);
const s = sp._stati.get('PROVA');
const al = (t) => sp.classificaAl(s, t);
let g = al(-10);
V.ok('prima del via: 14 auto, nessun giro, posizioni 1..14', g.length === 14 && g.every((x) => x.giri === 0) && g.map((x) => x.pos).join() === [1,2,3,4,5,6,7,8,9,10,11,12,13,14].join());
g = al(1000);
const pos = g.map((x) => x.pos), nostra = g.find((x) => x.numero === '77');
V.ok('dopo 1000 s: ordine per giri poi tempo, posizioni consecutive', pos.every((p, k) => p === k + 1) && g.every((x, k) => k === 0 || x.giri < g[k - 1].giri || (x.giri === g[k - 1].giri && x.tempoTotale >= g[k - 1].tempoTotale)));
V.ok('i nostri giri = i passaggi del simulatore', nostra.giri === corsa.passaggi.filter((x) => x <= 1000).length, [nostra.giri]);
V.ok('intervallo in secondi con lo stesso giro, vuoto se doppiati; il primo e\' 0', g[0].intervallo === 0 && g.every((x, k) => k === 0 || (x.giri === g[k - 1].giri ? typeof x.intervallo === 'number' && x.intervallo >= 0 : x.intervallo === null)));
// ritmo degli altri: giro tipico vicino a 100 s, con qualche sosta (giro lungo)
const gir = s.auto.slice(1).flatMap((a) => a.giri.slice(1)); gir.sort((x, y) => x - y);
const med = gir[Math.floor(gir.length / 2)];
V.ok('ritmo degli altri: mediana tra 94 e 106 s (' + med.toFixed(1) + ')', med > 94 && med < 106);
V.ok('ci sono giri di sosta (piu\' lenti di 25 s del normale)', gir.filter((x) => x > med + 25).length >= 12, gir.filter((x) => x > med + 25).length);
// safety car: nella finestra tutti rallentano (i giri che iniziano li' durano di piu')
const w = corsa.finestre[0];
const dentro = [], fuori = [];
s.auto.slice(1).forEach((a) => a.passaggi.forEach((t, k) => { const ini = t - a.giri[k]; (ini >= w.da && ini < w.a ? dentro : fuori).push(a.giri[k]); }));
const md = (v) => v.sort((x, y) => x - y)[Math.floor(v.length / 2)];
V.ok('safety car: i giri nella finestra durano il doppio (' + md(dentro).toFixed(0) + ' s contro ' + md(fuori).toFixed(0) + ' s)', dentro.length >= 10 && md(dentro) > md(fuori) * 1.6, [dentro.length]);
// pausa: nessuno passa sul traguardo durante la bandiera rossa
const p = corsa.pauseT[0]; let passati = 0;
s.auto.forEach((a) => a.passaggi.forEach((t) => { if (t > p.da + 0.5 && t < p.da + p.durata - 0.5) passati++; }));
V.ok('pausa di ' + p.durata + ' s: nessun passaggio sul traguardo (' + passati + ')', passati === 0, passati);
// la nostra auto e' sempre classificata e il calcolo dei distacchi di ponte.js funziona
const ponte = require(C.SRC + '/ponte.js');
const ct = ponte._test.computeTiming({ tipo: 'gara' }, g, '77');
V.ok('computeTiming trova la nostra auto e da i distacchi', ct.trovata && ct.timing.position === nostra.pos && (ct.timing.gapAhead || ct.timing.position === 1) && ct.timing.catName === 'A', ct.timing);
// salta: porta il tempo di gara dove si vuole
sp.salta({ evento: 'PROVA', tGara: 1500 });
const t1 = (Date.now() - s.avvioMs) / 1000;
V.ok('salta: il tempo di gara diventa quello indicato', Math.abs(t1 - 1500) < 1, t1);

// HTTP vero: spento senza SIM_PONTE, acceso con
const srv = http.createServer((q, rs) => { if (!sp.gestisci(q, rs)) { rs.writeHead(404); rs.end(); } });
srv.listen(8776, async () => {
  const base = 'http://localhost:8776';
  let x = await fetch(base + '/sim/ponte/avvia', { method: 'POST', body: JSON.stringify(richiesta) }); let j = await x.json();
  V.ok('HTTP avvia', x.status === 200 && j.ok, j);
  x = await fetch(base + '/sim/ponte/classifica?evento=PROVA'); j = await x.json();
  V.ok('HTTP classifica: forma del ponte (ok, sessione, piloti)', j.ok && j.sessione.tipo === 'gara' && j.piloti.length === 14 && j.piloti[0].numero, j.piloti && j.piloti[0]);
  x = await fetch(base + '/sim/ponte/classifica?evento=NONESISTE'); j = await x.json();
  V.ok('evento sconosciuto: non_pubblicato', j.ok === false && j.code === 'non_pubblicato', j);
  x = await fetch(base + '/sim/ponte/avvia', { method: 'POST', body: '{rotto' }); V.ok('JSON rotto: 400', x.status === 400, x.status);
  process.env.SIM_PONTE = '0';
  x = await fetch(base + '/sim/ponte/classifica?evento=PROVA'); V.ok('con SIM_PONTE spento risponde 404', x.status === 404, x.status);
  process.env.SIM_PONTE = '1';
  // ponte.js: l'indirizzo https://pitcomm.sim/NOME si risponde dentro, senza BRIDGE_URL
  const inviati = []; ponte.init({ to: () => ({ emit: (ev, d) => inviati.push([ev, d]) }) });
  const st = ponte.start('ZZ9', 'https://pitcomm.sim/PROVA', '77');
  V.ok('ponte.start accetta l\'indirizzo del simulatore anche senza BRIDGE_URL', st.ok, st);
  await new Promise((rs) => setTimeout(rs, 400));
  const stanza = require(C.SRC + '/rooms.js').getRoomState('ZZ9');
  V.ok('il box riceve posizione e distacchi dal finto ponte (stato "in ascolto")', stanza.ponte.status === 'in ascolto' && Number.isFinite(stanza.timing && stanza.timing.position) && inviati.some((e) => e[0] === 'timingUpdate'), [stanza.ponte.status, stanza.timing]);
  ponte.stop('ZZ9');
  process.env.SIM_PONTE = '0';
  const st2 = ponte.start('ZZ9', 'https://pitcomm.sim/PROVA', '77');
  V.ok('con SIM_PONTE spento l\'indirizzo del simulatore non funziona (nessun BRIDGE_URL)', !st2.ok, st2);
  V.fine(); srv.close(); process.exit(0);
});
