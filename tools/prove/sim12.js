// Simulatore, "gruppo compatto" (casella accesa di norma in sim.html): la nostra auto (n. 1) resta nel mezzo del gruppo,
// gli altri hanno un ritmo vicino al nostro e si fermano spesso come noi. Senza la casella il finto ponte resta com'era.
const C = require('./comune'); const V = C.controlli('sim12');
process.env.SIM_PONTE = '1';
const Pista = require(C.ROOT + '/js/pista.js'), fs = require('fs'), path = require('path');
const gps = JSON.parse(fs.readFileSync(path.join(C.REPO, 'tools/sim/varano-sim.json'), 'utf8')).gps;
const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
const piano = [{ giri: 5, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 5, pit: { dove: 'corsia', sostaS: 70 } }, { giri: 5, pit: { dove: 'box', sostaS: 90 } }, { giri: 2 }];
const corsa = Pista.pianifica(pista, piano, Object.assign({}, opz, { ritmi: [{ daGiro: 3, giri: 4, fattore: 1.03 }, { daGiro: 8, giri: 4, fattore: 0.97 }], rallentamenti: [{ daGiro: 10, giri: 2, fattore: 0.55 }], pause: [{ giro: 7, durataS: 120 }] }));
const sp = require(C.SRC + '/simponte.js');
const html = fs.readFileSync(path.join(C.ROOT, 'sim.html'), 'utf8');
V.ok('sim.html: la nostra auto e\' la n. 1 e "gruppo compatto" e\' acceso', /id="numero" value="1"/.test(html) && /id="centro" checked/.test(html));
V.ok('sim.html: scenario predefinito con ritmi dolci (103% e 97%)', /ritmo 3 4 103/.test(html) && /ritmo 8 4 97/.test(html));
const P = 1.7, d = (x) => x + P;
const corpo = (centro, seme) => ({ evento: 'C' + seme + centro, numero: '1', giroS: 100, passaggi: corsa.passaggi.map(d), finestre: corsa.finestre.map((w) => ({ da: d(w.da), a: d(w.a), fattore: w.fattore })), pause: corsa.pauseT.map((q) => ({ da: d(q.da), durata: q.durata })), tGara: 0, seme, nAuto: 14, centro, partenza: P });
const misura = (centro, seme) => {
  const r = sp.avvia(corpo(centro, seme)); const s = sp._stati.get(('C' + seme + centro).toUpperCase());
  const pos = []; for (let t = 30; t <= corsa.durata; t += 5) pos.push(s ? sp.classificaAl(s, t).find((x) => x.numero === '1').pos : 0);
  return { ok: r.ok, mezzo: pos.filter((p) => p >= 3 && p <= 11).length / pos.length, primo: pos.filter((p) => p === 1).length / pos.length, rivali: s ? s.auto.slice(1) : [] };
};
for (const seme of [1, 2, 3]) {
  const m = misura(true, seme);
  V.ok('seme ' + seme + ': nel mezzo (3°-11°) per almeno il 60% della gara, primi per meno del 20%', m.ok && m.mezzo >= 0.6 && m.primo < 0.2, { mezzo: Math.round(m.mezzo * 100) + '%', primo: Math.round(m.primo * 100) + '%' });
}
const m1 = misura(true, 1);
const passi = m1.rivali.map((a) => { const g = a.giri.slice(1, 4); return g.reduce((x, y) => x + y, 0) / g.length; });
V.ok('ritmi degli altri vicini al nostro (98-102 s) e meta\' piu\' veloci, meta\' piu\' lenti', passi.every((x) => x > 97.5 && x < 102.5) && passi.filter((x) => x < 100).length >= 5 && passi.filter((x) => x > 100).length >= 5, passi.map((x) => x.toFixed(1)));
V.ok('soste degli altri come le nostre (2-4 a testa, nessuna lunga)', m1.rivali.every((a) => a.soste.length >= 2 && a.soste.length <= 4 && a.soste.every((x) => x.tipo !== 'lungo')), m1.rivali.map((a) => a.soste.length));
V.ok('i numeri degli altri non sono mai 1', m1.rivali.every((a) => a.numero !== '1'));
// senza la casella: come prima (le prove della strategia, sim8 e sim9, usano questo)
const vecchio = misura(false, 1);
V.ok('senza "gruppo compatto" il finto ponte resta com\'era (ritmi 95-106%, partenza da fermo)', vecchio.ok && vecchio.rivali.some((a) => a.giri[0] > 100), vecchio.rivali.map((a) => Math.round(a.giri[0])));
V.fine();
