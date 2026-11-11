// Pista simulata: dal file del circuito (tracciato, corsia box, box, rifornimento, limite) costruisce un'auto
// virtuale che gira, entra in corsia al limite, si ferma dove si decide e riparte. Dà la posizione vera in ogni
// istante e, con `rumore`, quella che misurerebbe un telefono (errore lento, errore veloce, precisione, velocita'
// da effetto Doppler, qualche punto perso). Registra anche la VERITA' (quando e' entrata in corsia, dove si e'
// fermata, quando e' uscita): serve a controllare se il box capisce giusto.
//
// Non usa il browser ne' il server: gira uguale in Node (prove) e nella pagina sim.html.
//
//   const pista = Pista.costruisci(gps);                     // gps = campi "gps" del file circuito
//   const corsa = Pista.pianifica(pista, [{ giri: 2, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 1 }]);
//   corsa.durata, corsa.verita, corsa.vero(t) -> { lat, lng, v, rotta }
//   const gps = Pista.rumore(corsa, { seme: 7 });            // gps(t) -> { lat, lng, acc, v } o null se il punto manca

(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.Pista = fabbrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const K = 111320; // metri per grado di latitudine

  // ---------- numeri casuali ripetibili ----------
  function casuale(seme) {
    let a = (seme >>> 0) || 1;
    const uni = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => { let u = 0; while (u === 0) u = uni(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uni()); };
    return { uni, gauss };
  }

  // ---------- coordinate: metri attorno a un'origine ----------
  function proiettore(o) {
    const c = Math.cos(o.lat * Math.PI / 180);
    return {
      xy: (q) => ({ x: (q.lng - o.lng) * K * c, y: (q.lat - o.lat) * K }),
      ll: (p) => ({ lat: o.lat + p.y / K, lng: o.lng + p.x / (K * c) }),
    };
  }

  // Curva chiusa liscia (Catmull-Rom) che passa per i punti, ricampionata ogni `passo` metri.
  function lisciaChiusa(pts, passo) {
    const n = pts.length, fitti = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const lun = Math.hypot(p2.x - p1.x, p2.y - p1.y), k = Math.max(4, Math.ceil(lun / 1.5));
      for (let j = 0; j < k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        fitti.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    return ricampiona(fitti.concat([fitti[0]]), passo).slice(0, -1);
  }

  // Ricampiona una linea aperta a passo costante (il primo e l'ultimo punto restano).
  function ricampiona(pts, passo) {
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let resto = passo;
    for (let i = 1; i < pts.length; i++) {
      let a = pts[i - 1];
      const b = pts[i];
      let seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg >= resto) {
        const f = resto / seg;
        a = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        out.push({ x: a.x, y: a.y });
        seg -= resto; resto = passo;
      }
      resto -= seg;
    }
    const u = pts[pts.length - 1], l = out[out.length - 1];
    if (Math.hypot(u.x - l.x, u.y - l.y) > passo * 0.3) out.push({ x: u.x, y: u.y });
    return out;
  }

  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  function piuVicino(punti, p) { let mi = 0, md = Infinity; for (let i = 0; i < punti.length; i++) { const d = dist(punti[i], p); if (d < md) { md = d; mi = i; } } return { i: mi, d: md }; }
  const centroide = (pts) => ({ x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length });

  // ---------- la pista ----------
  // gps: { tracciato, corsia, box, refuelPoly | refuel, limiteKmh, traguardo }
  function costruisci(gps, opz) {
    const o = Object.assign({ passo: 4 }, opz || {});
    if (!gps || !Array.isArray(gps.tracciato) || gps.tracciato.length < 8) throw new Error('serve il tracciato (almeno 8 punti)');
    const origine = { lat: gps.tracciato[0].lat, lng: gps.tracciato[0].lng };
    const pr = proiettore(origine);
    const T = lisciaChiusa(gps.tracciato.map(pr.xy), o.passo);
    const n = T.length;
    const perimetro = n * o.passo;
    // l'inizio del giro e' il traguardo (centro della linea), se c'e'; altrimenti il primo punto
    let inizio = 0;
    if (Array.isArray(gps.traguardo) && gps.traguardo.length === 2) inizio = piuVicino(T, centroide(gps.traguardo.map(pr.xy))).i;
    const pista = { origine, pr, T, n, passo: o.passo, perimetro, inizio, limiteMs: (gps.limiteKmh || 60) / 3.6, gps };
    if (Array.isArray(gps.corsia) && gps.corsia.length >= 2) {
      pista.corsia = ricampiona(gps.corsia.map(pr.xy), 2);
      pista.ingresso = piuVicino(T, pista.corsia[0]).i;
      pista.uscita = piuVicino(T, pista.corsia[pista.corsia.length - 1]).i;
    }
    pista.centroBox = gps.box ? pr.xy(gps.box) : null;
    pista.centroRif = Array.isArray(gps.refuelPoly) && gps.refuelPoly.length >= 3 ? centroide(gps.refuelPoly.map(pr.xy)) : (gps.refuel ? pr.xy(gps.refuel) : null);
    return pista;
  }

  // ---------- il percorso: elenco di nodi con velocita' massima ----------
  // piano: [{ giri, pit?: { dove: 'rifornimento' | 'box', sostaS } }]
  //   giri = quanti giri completi di pista prima del pit (puo' essere 0 e frazioni non servono: si finisce all'ingresso)
  //   senza `pit` l'ultimo tratto e' solo "giri" giri e si ferma li' (si continua a girare, poi basta)
  function pianifica(pista, piano, opz) {
    const o = Object.assign({ vMax: 55, aLat: 9, aAcc: 5.5, aFren: 11, vPartenza: 30, offset: null }, opz || {});
    const nodi = []; // { x, y, tetto, sosta?, evento? }
    const verita = [];   // costruita dopo, con i tempi
    const pushT = (p, tetto, extra) => nodi.push(Object.assign({ x: p.x, y: p.y, tetto }, extra || {}));
    let i = pista.inizio;
    const T = pista.T, n = pista.n;
    const aggiungiPista = (da, nodiAvanti) => { for (let k = 0; k < nodiAvanti; k++) pushT(T[(da + k) % n], o.vMax); return (da + nodiAvanti) % n; };

    (piano || []).forEach((st) => {
      const avanti = (idx) => ((idx - i) % n + n) % n;
      if (st.pit && pista.corsia) {
        // fino all'ingresso della corsia (dopo "giri" giri completi)
        const tratto = (st.giri || 0) * n + avanti(pista.ingresso);
        i = aggiungiPista(i, tratto);
        pushT(T[pista.ingresso], o.vMax, { evento: 'ingressoCorsia' });
        // raccordo pista -> inizio corsia (retta), poi la corsia
        const c0 = pista.corsia[0];
        const rac = ricampiona([T[pista.ingresso], c0], 2);
        rac.slice(1, -1).forEach((p) => pushT(p, pista.limiteMs * 1.4));
        const bersaglio = st.pit.dove === 'box' ? pista.centroBox : pista.centroRif;
        const kSosta = bersaglio ? piuVicino(pista.corsia, bersaglio).i : -1;
        pista.corsia.forEach((p, k) => {
          const extra = {};
          if (k === 0) extra.evento = 'entrataLimite';
          if (k === kSosta) { extra.sosta = Math.max(1, st.pit.sostaS || 30); extra.dove = st.pit.dove; }
          pushT(p, pista.limiteMs, extra);
        });
        const cF = pista.corsia[pista.corsia.length - 1];
        const rac2 = ricampiona([cF, T[pista.uscita]], 2);
        rac2.slice(1, -1).forEach((p) => pushT(p, pista.limiteMs * 1.4));
        pushT(T[pista.uscita], o.vMax, { evento: 'uscitaCorsia' });
        i = (pista.uscita + 1) % n;
      } else {
        i = aggiungiPista(i, Math.max(1, Math.round((st.giri || 1) * n)));
      }
    });
    if (nodi.length < 2) throw new Error('piano vuoto');

    // lunghezze e curvatura
    const N = nodi.length, ds = new Array(N).fill(0), S = new Array(N).fill(0);
    for (let k = 1; k < N; k++) { ds[k] = Math.max(0.01, dist(nodi[k - 1], nodi[k])); S[k] = S[k - 1] + ds[k]; }
    const vcurva = new Array(N).fill(o.vMax);
    const W = 3;
    for (let k = W; k < N - W; k++) {
      const a = nodi[k - W], b = nodi[k], c = nodi[k + W];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ac = Math.hypot(c.x - a.x, c.y - a.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      const kappa = ab * bc * ac > 1e-6 ? 2 * area2 / (ab * bc * ac) : 0;      // 1/raggio
      if (kappa > 1e-4) vcurva[k] = Math.min(o.vMax, Math.sqrt(o.aLat / kappa));
    }
    const v = nodi.map((p, k) => Math.min(p.tetto, vcurva[k]));
    v[0] = Math.min(v[0], o.vPartenza);
    v.forEach((x, k) => { if (nodi[k].sosta) v[k] = 0; });
    v[N - 1] = Math.min(v[N - 1], o.vMax);
    for (let k = N - 2; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] * v[k + 1] + 2 * o.aFren * ds[k + 1]));   // frenata
    for (let k = 1; k < N; k++) v[k] = Math.min(v[k], Math.sqrt(v[k - 1] * v[k - 1] + 2 * o.aAcc * ds[k]));                // accelerazione
    // tempi di arrivo a ogni nodo (accelerazione costante tra due nodi) e soste
    const tempo = new Array(N).fill(0), partenza = new Array(N).fill(0); // partenza[k]: quando riparte dal nodo k
    for (let k = 1; k < N; k++) {
      const somma = v[k - 1] + v[k];
      const dt = somma > 1e-6 ? 2 * ds[k] / somma : 1;
      tempo[k] = partenza[k - 1] + dt;
      partenza[k] = tempo[k] + (nodi[k].sosta || 0);
    }
    const durata = partenza[N - 1];
    nodi.forEach((p, k) => {
      if (p.evento === 'ingressoCorsia') verita.push({ t: tempo[k], tipo: 'ingressoCorsia' });
      if (p.evento === 'entrataLimite') verita.push({ t: tempo[k], tipo: 'entrataLimite' });
      if (p.sosta) verita.push({ t: tempo[k], tipo: 'sosta', dove: p.dove, durataS: p.sosta, fine: partenza[k] });
      if (p.evento === 'uscitaCorsia') verita.push({ t: tempo[k], tipo: 'uscitaCorsia' });
    });
    verita.sort((a, b) => a.t - b.t);

    const off = o.offset || { dx: 0, dy: 0 };
    // posizione vera all'istante t (secondi dalla partenza)
    function vero(t) {
      if (t <= 0) return Object.assign(pista.pr.ll({ x: nodi[0].x + off.dx, y: nodi[0].y + off.dy }), { v: 0, rotta: 0, k: 0 });
      if (t >= durata) { const q = nodi[N - 1]; return Object.assign(pista.pr.ll({ x: q.x + off.dx, y: q.y + off.dy }), { v: 0, rotta: 0, k: N - 1 }); }
      // ricerca binaria dell'ultimo nodo con partenza <= t
      let lo = 0, hi = N - 1;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; if (partenza[m] <= t) lo = m; else hi = m; }
      const k = lo;
      if (t >= tempo[k + 1]) {                                   // arrivata al nodo k+1 e ci sta ferma (sosta)
        return Object.assign(pista.pr.ll({ x: nodi[k + 1].x + off.dx, y: nodi[k + 1].y + off.dy }), { v: 0, rotta: 0, k: k + 1 });
      }
      const a = nodi[k], b = nodi[k + 1], t0 = partenza[k], dt = tempo[k + 1] - t0;
      const tau = Math.max(0, Math.min(dt, t - t0));
      const acc = dt > 0 ? (v[k + 1] - v[k]) / dt : 0;
      const sPerc = v[k] * tau + 0.5 * acc * tau * tau, f = Math.max(0, Math.min(1, sPerc / ds[k + 1]));
      const p = { x: a.x + (b.x - a.x) * f + off.dx, y: a.y + (b.y - a.y) * f + off.dy };
      return Object.assign(pista.pr.ll(p), { v: Math.max(0, v[k] + acc * tau), rotta: Math.atan2(b.x - a.x, b.y - a.y), k });
    }
    return { pista, nodi, v, tempo, partenza, durata, verita, vero, lunghezza: S[N - 1] };
  }

  // ---------- il telefono: errore del GPS ----------
  // opz: seme, sigmaLento (m, deriva lenta), tauLento (s), sigmaVeloce (m), accDichiarata (m), sigmaVel (m/s),
  //      perdita (probabilita' di punto mancante), zonaPeggiore: [{ da, a, acc }] intervalli di tempo con precisione peggiore
  function rumore(corsa, opz) {
    const o = Object.assign({ seme: 1, sigmaLento: 1.2, tauLento: 25, sigmaVeloce: 0.8, accDichiarata: 4, sigmaVel: 0.25, perdita: 0.01, zonaPeggiore: [] }, opz || {});
    const r = casuale(o.seme);
    let ex = 0, ey = 0, tUlt = null;
    const pr = corsa.pista.pr;
    return function (t) {
      const dt = tUlt == null ? 1 : Math.max(0.05, t - tUlt);
      tUlt = t;
      const phi = Math.exp(-dt / o.tauLento), q = o.sigmaLento * Math.sqrt(1 - phi * phi);
      ex = phi * ex + q * r.gauss(); ey = phi * ey + q * r.gauss();
      if (r.uni() < o.perdita) return null;
      const w = corsa.vero(t);
      const peggio = o.zonaPeggiore.find((z) => t >= z.da && t <= z.a);
      const molt = peggio ? peggio.acc / o.accDichiarata : 1;
      const p = pr.xy(w);
      const m = pr.ll({ x: p.x + ex * molt + r.gauss() * o.sigmaVeloce * molt, y: p.y + ey * molt + r.gauss() * o.sigmaVeloce * molt });
      const v = w.v < 0.05 ? Math.abs(r.gauss()) * 0.08 : Math.max(0, w.v + r.gauss() * o.sigmaVel);
      return { lat: m.lat, lng: m.lng, acc: Math.round((o.accDichiarata * molt + r.uni() * 2) * 10) / 10, v: Math.round(v * 100) / 100 };
    };
  }

  // Un circuito di esempio: due rettilinei con due tornanti, un'ansa sul retro e la corsia box lungo il rettilineo
  // principale. Coordinate vicine a Cremona; non e' una pista vera.
  function esempio(centro) {
    const c = centro || { lat: 45.1, lng: 10.03 };
    const pr = proiettore(c);
    const pts = [];
    const L = 520, R = 130, passi = 14;
    for (let i = 0; i <= 6; i++) pts.push({ x: -L / 2 + L * i / 6, y: -R });                       // rettilineo principale (verso est)
    for (let i = 1; i < passi; i++) { const a = -Math.PI / 2 + Math.PI * i / passi; pts.push({ x: L / 2 + R * Math.cos(a), y: R * Math.sin(a) }); }   // tornante est
    for (let i = 0; i <= 6; i++) pts.push({ x: L / 2 - L * i / 6, y: R + (i === 2 ? 30 : i === 3 ? -25 : i === 4 ? 20 : 0) });   // rettilineo di ritorno con un'ansa
    for (let i = 1; i < passi; i++) { const a = Math.PI / 2 + Math.PI * i / passi; pts.push({ x: -L / 2 + R * Math.cos(a), y: R * Math.sin(a) }); }   // tornante ovest
    const ll = (p) => pr.ll(p);
    const tracciato = pts.map(ll);
    const corsia = [{ x: -230, y: -R + 28 }, { x: -120, y: -R + 28 }, { x: 0, y: -R + 28 }, { x: 120, y: -R + 28 }, { x: 230, y: -R + 28 }].map(ll);
    return {
      tracciato,
      traguardo: [{ x: 0, y: -R - 14 }, { x: 0, y: -R + 14 }].map(ll),
      box: ll({ x: -55, y: -R + 28 }),
      refuelPoly: [{ x: 50, y: -R + 22 }, { x: 95, y: -R + 22 }, { x: 95, y: -R + 36 }, { x: 50, y: -R + 36 }].map(ll),
      corsia,
      rBox: 10, rRefuel: 25, larg: 8, fermoS: 60, limiteKmh: 60,
    };
  }

  return { costruisci, pianifica, rumore, esempio, casuale, proiettore, lisciaChiusa, ricampiona };
});
