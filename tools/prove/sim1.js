// Pista simulata (public/js/pista.js): giro realistico, limite in corsia, soste dove devono essere, rumore GPS, ripetibilita'.
const C = require('./comune');
const V = C.controlli('sim1');
const Pista = require(C.ROOT + '/js/pista.js');
const gps = Pista.esempio();
const pista = Pista.costruisci(gps);
V.ok('pista: giro lungo tra 1,4 e 2,4 km', pista.perimetro > 1400 && pista.perimetro < 2400, Math.round(pista.perimetro));
const giri = Pista.pianifica(pista, [{ giri: 3 }]);
const tg = giri.durata / 3;
V.ok('giro senza soste: tra 40 e 90 s', tg > 40 && tg < 90, Math.round(tg * 10) / 10);
let vmax = 0; for (let t = 0; t < giri.durata; t += 0.2) vmax = Math.max(vmax, giri.vero(t).v);
V.ok('velocita\' massima sensata (tra 120 e 200 km/h)', vmax * 3.6 > 120 && vmax * 3.6 <= 200.5, Math.round(vmax * 3.6));
let vmin = 1e9; for (let t = 5; t < giri.durata - 5; t += 0.2) vmin = Math.min(vmin, giri.vero(t).v);
V.ok('nelle curve rallenta (minimo sotto i 100 km/h)', vmin * 3.6 < 100, Math.round(vmin * 3.6));

const piano = [{ giri: 2, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 1, pit: { dove: 'box', sostaS: 75 } }, { giri: 1 }];
const corsa = Pista.pianifica(pista, piano);
const ver = corsa.verita;
const conta = (t) => ver.filter((e) => e.tipo === t).length;
V.ok('verita\': 2 ingressi, 2 soste, 2 uscite', conta('ingressoCorsia') === 2 && conta('sosta') === 2 && conta('uscitaCorsia') === 2, ver.map((e) => e.tipo));
const soste = ver.filter((e) => e.tipo === 'sosta');
V.ok('verita\': prima rifornimento 30 s, poi box 75 s', soste[0].dove === 'rifornimento' && soste[0].durataS === 30 && soste[1].dove === 'box' && soste[1].durataS === 75);
V.ok('verita\': ordine ingresso < sosta < uscita', ver.every((e, i, a) => i === 0 || e.t >= a[i - 1].t));

// in corsia mai oltre il limite
const lim = gps.limiteKmh / 3.6; let oltre = 0, inCorsia = 0;
const ing = ver.filter((e) => e.tipo === 'entrataLimite'), usc = ver.filter((e) => e.tipo === 'uscitaCorsia');
ing.forEach((e, j) => { for (let t = e.t; t < usc[j].t; t += 0.1) { inCorsia++; if (corsa.vero(t).v > lim + 0.3) oltre++; } });
V.ok('in corsia non supera il limite (' + gps.limiteKmh + ' km/h)', inCorsia > 100 && oltre === 0, { inCorsia, oltre });
// e sta davvero al limite per un tratto
let alLimite = 0; ing.forEach((e, j) => { for (let t = e.t; t < usc[j].t; t += 0.1) if (corsa.vero(t).v > lim - 1.5) alLimite++; });
V.ok('in corsia resta al limite per diversi secondi', alLimite > 80, alLimite);

// soste: ferma, nel posto giusto
const pr = pista.pr, m = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const v0 = corsa.vero(soste[0].t + 5), v1 = corsa.vero(soste[1].t + 5);
V.ok('rifornimento: ferma dentro l\'area di rifornimento', v0.v === 0 && m(pr.xy(v0), pista.centroRif) < 12, m(pr.xy(v0), pista.centroRif));
V.ok('cambio pilota: ferma nella zona box', v1.v === 0 && m(pr.xy(v1), pista.centroBox) < gps.rBox, m(pr.xy(v1), pista.centroBox));
V.ok('la sosta dura quanto previsto', Math.abs((soste[1].fine - soste[1].t) - 75) < 0.01);
let salto = 0; for (let t = 0; t < corsa.durata; t += 0.1) { const a = pr.xy(corsa.vero(t)), b = pr.xy(corsa.vero(t + 0.1)); salto = Math.max(salto, m(a, b)); }
V.ok('il moto e\' continuo (nessun salto oltre 6 m in 0,1 s)', salto < 6, Math.round(salto * 10) / 10);

// rumore del telefono
const g = Pista.rumore(corsa, { seme: 11 });
let n = 0, e2 = 0, persi = 0, emax = 0, fermiVel = [];
for (let t = 0; t < corsa.durata; t += 1) {
  const q = g(t); if (!q) { persi++; continue; }
  const w = corsa.vero(t), errM = m(pr.xy(q), pr.xy(w)); n++; e2 += errM * errM; emax = Math.max(emax, errM);
  if (w.v === 0) fermiVel.push(q.v);
}
const rms = Math.sqrt(e2 / n);
V.ok('rumore: errore tipico tra 1 e 3 m (RMS ' + rms.toFixed(1) + ' m), mai oltre 10 m', rms > 1 && rms < 3 && emax < 10, [rms, emax]);
V.ok('rumore: qualche punto manca (non troppi)', persi >= 0 && persi < corsa.durata * 0.05, persi);
V.ok('rumore: da fermo la velocita\' misurata e\' quasi zero', fermiVel.length > 50 && Math.max(...fermiVel) < 0.5, Math.max(...fermiVel));
const g2 = Pista.rumore(corsa, { seme: 11 }), g3 = Pista.rumore(corsa, { seme: 12 });
let uguale = true, diverso = false; for (let t = 0; t < 40; t++) { const a = g2(t), b = Pista.rumore(corsa, { seme: 11 }); void b; }
const A = Pista.rumore(corsa, { seme: 5 }), B = Pista.rumore(corsa, { seme: 5 }), D = Pista.rumore(corsa, { seme: 6 });
for (let t = 0; t < 60; t++) { const a = A(t), b = B(t), d = D(t); if (JSON.stringify(a) !== JSON.stringify(b)) uguale = false; if (JSON.stringify(a) !== JSON.stringify(d)) diverso = true; }
void g3;
V.ok('rumore: stesso seme = stessi punti, semi diversi = punti diversi', uguale && diverso);

// sfasamento tra satellite e GPS vero
const sf = Pista.pianifica(pista, [{ giri: 1 }], { offset: { dx: 6, dy: -2 } }), p0 = Pista.pianifica(pista, [{ giri: 1 }]);
const dd = m(pr.xy(sf.vero(20)), pr.xy(p0.vero(20)));
V.ok('sfasamento: la posizione vera e\' spostata di ' + Math.hypot(6, 2).toFixed(1) + ' m', Math.abs(dd - Math.hypot(6, 2)) < 0.1, dd);
V.fine();
