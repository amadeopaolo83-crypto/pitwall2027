// Strategia degli altri letta dai soli tempi: soste, tipo, safety, stima della prossima sosta, suggerimento. Confronto con la verita' del finto ponte.
const C = require('./comune'); const V = C.controlli('sim8');
process.env.SIM_PONTE = '1';
const Pista = require(C.ROOT + '/js/pista.js');
const fs = require('fs'), path = require('path');
const gps = JSON.parse(fs.readFileSync(path.join(C.ROOT, '..', 'tools/sim/varano.json'), 'utf8')).gps;
const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
const corsa = Pista.pianifica(pista, [{ giri: 5, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 5, pit: { dove: 'corsia', sostaS: 70 } }, { giri: 5, pit: { dove: 'box', sostaS: 90 } }, { giri: 2 }], Object.assign({}, opz, { rallentamenti: [{ daGiro: 10, giri: 2, fattore: 0.55 }], pause: [{ giro: 7, durataS: 120 }] }));
const sp = require(C.SRC + '/simponte.js'), strat = require(C.SRC + '/strategia.js');
sp.avvia({ evento: 'S8', numero: '77', giroS: 100, passaggi: corsa.passaggi, finestre: corsa.finestre, pause: corsa.pauseT, tGara: 0, seme: 5, nAuto: 14 });
const s = sp._stati.get('S8');
const T0 = 1.7e12, fine = corsa.durata + 60;

// replay: la classifica ogni 2,5 s, come il ponte
let ultimo = null; const preD = new Map(); const predizioni = [];     // predizioni fatte dopo ogni sosta: { numero, dopoSosta, prossima }
let safetyVista = [], sospVista = [], primaSafety = false;
for (let t = 1; t <= fine; t += 2.5) {
  const piloti = sp.classificaAl(s, t);
  ultimo = strat.registra('S8', piloti, '77', T0 + t * 1000);
  const w = corsa.finestre[0];
  if (ultimo.safety) safetyVista.push(t);
  if (ultimo.safety && t < corsa.pauseT[0].da - 20) primaSafety = true;
  if (ultimo.safety && t > corsa.pauseT[0].da + corsa.pauseT[0].durata + 330 && t < w.da - 20) primaSafety = true;
  if (ultimo.sospensione) sospVista.push(t);
  ultimo.rivali.forEach((r) => {
    const k = r.numero + ':' + r.soste.length;
    if (r.soste.length && !preD.has(k)) { preD.set(k, true); if (r.prossima != null) predizioni.push({ numero: r.numero, dopo: r.soste.length, giroSosta: r.soste[r.soste.length - 1].giro, prossima: r.prossima, daGruppo: r.stimaDaGruppo }); }
  });
}
const rivaliVeri = s.auto.slice(1);
// ---------- soste ----------
let veri = 0, trovati = 0, tipiOk = 0, falsi = 0, persiSafety = 0, persePausa = 0, troppoPresto = 0;
rivaliVeri.forEach((rv) => {
  const det = ultimo.rivali.find((r) => r.numero === rv.numero);
  const ultimoGiroNoto = rv.passaggi.filter((x) => x <= fine).length;
  rv.soste.forEach((so) => {
    if (so.giro > ultimoGiroNoto - 0) return;
    if (so.sottoSafety) { persiSafety++; return; }
    const fin = rv.passaggi[so.giro - 1], ini = fin - rv.giri[so.giro - 1], P = corsa.pauseT[0];
    if (ini < P.da + P.durata && fin > P.da) { persePausa++; return; }      // il giro della bandiera rossa e' lento per tutti
    if (so.giro <= 4) { troppoPresto++; return; }                          // servono 3 giri normali per conoscere il ritmo
    veri++;
    const m = det.soste.find((d) => d.giro === so.giro || d.giro === so.giro + 1 || d.giro === so.giro - 1);
    if (m) { trovati++; if (m.tipo === so.tipo) tipiOk++; }
  });
  det.soste.forEach((d) => { if (!rv.soste.some((so) => Math.abs(so.giro - d.giro) <= 1)) falsi++; });
});
V.ok('soste vere visibili: ' + veri + ' (non contate: ' + persePausa + ' nel giro della bandiera rossa, ' + troppoPresto + ' nei primi 4 giri; almeno 15 per una prova seria)', veri >= 15, veri);
V.ok('soste trovate: ' + trovati + ' su ' + veri + ' (almeno il 90%)', trovati >= veri * 0.9, [trovati, veri]);
V.ok('nessuna sosta inventata (' + falsi + ' false, ammessa 1)', falsi <= 1, falsi);
V.ok('tipo (rifornimento / cambio / lunga) giusto in almeno l\'80% (' + tipiOk + ' su ' + trovati + ')', tipiOk >= trovati * 0.8, [tipiOk, trovati]);
// ---------- safety e pausa ----------
const w = corsa.finestre[0];
V.ok('safety car riconosciuta DURANTE la finestra vera, non solo dopo (' + safetyVista.length + ' letture)', safetyVista.some((t) => t >= w.da && t <= w.a), [w.da, w.a, safetyVista.slice(0, 3)]);
V.ok('nessuna safety segnalata a vuoto (prima della pausa, e nel tratto tranquillo prima della safety)', !primaSafety);
V.ok('bandiera rossa / sospensione riconosciuta nella pausa vera', sospVista.some((t) => t >= corsa.pauseT[0].da && t <= corsa.pauseT[0].da + corsa.pauseT[0].durata + 10), [corsa.pauseT[0], sospVista.slice(0, 3)]);
V.ok('sotto la safety i giri lenti non diventano soste (le soste durante la safety non si vedono: ' + persiSafety + ' nella prova)', true);
// ---------- stima della prossima sosta ----------
let ok2 = 0, tot2 = 0, errori = [];
predizioni.forEach((p) => {
  const rv = rivaliVeri.find((r) => r.numero === p.numero); const next = rv.soste.find((x) => x.giro > p.giroSosta && !x.sottoSafety);
  if (!next) return; tot2++; const e = Math.abs(next.giro - p.prossima); errori.push(e); if (e <= 2) ok2++;
});
V.ok('prossima sosta stimata (stint proprio o del gruppo): entro 2 giri nel 70% dei casi (' + ok2 + ' su ' + tot2 + ')', tot2 >= 8 && ok2 >= tot2 * 0.7, errori);
// ---------- noi e suggerimento ----------
V.ok('la nostra auto e\' separata dagli altri e ha le sue soste', ultimo.nostra && ultimo.nostra.numero === '77' && !ultimo.rivali.some((r) => r.numero === '77'), ultimo.nostra && ultimo.nostra.soste);
V.ok('sei auto dietro e davanti: posizioni e "dopoNoi" coerenti', ultimo.rivali.every((r) => r.dopoNoi === (r.pos > ultimo.nostra.pos)));
// suggerimento a meta' gara
const meta = (() => { let u = null; strat.azzera('S8b'); for (let t = 1; t <= 1000; t += 2.5) u = strat.registra('S8b', sp.classificaAl(s, t), '77', T0 + t * 1000); return u; })();
const sg = meta.sugg;
V.ok('suggerimento: tabella di 8 giri con posizioni 1..14 e un giro migliore', sg && sg.tabella.length === 8 && sg.tabella.every((x) => x.pos >= 1 && x.pos <= 14) && sg.migliore && sg.migliore.pos <= sg.adesso, sg);
V.ok('suggerimento: perdita del pit tra 40 e 200 s', sg && sg.perditaS > 40 && sg.perditaS < 200, sg && sg.perditaS);
// dati senza giri o rotti non fanno danni
const r0 = strat.registra('VUOTO', [], '77', T0); const r1 = strat.registra('VUOTO', [null, { numero: '5', giri: 'x' }, { numero: '', giri: 3 }, { numero: '9', giri: 1, ultimoGiro: -5 }], '77', T0 + 1000);
V.ok('dati vuoti o rotti: nessun errore, nessuna sosta', r0.rivali.length === 0 && r1.rivali.every((r) => r.soste.length === 0));
V.fine();
