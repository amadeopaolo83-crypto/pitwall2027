// Strategia degli altri, ricavata dai soli tempi del live timing (niente bandiere, settori, gomme, piloti).
//
// Da ogni aggiornamento della classifica si registrano i giri completati di ogni auto (numero giro, tempo del giro, tempo totale).
// - Ritmo proprio di ogni auto: mediana degli ultimi giri "normali" (il primo giro, lento per la partenza, non conta).
// - Giro lento = oltre il 25% (e almeno 15 s) piu' del suo ritmo. Se nello stesso momento rallenta meta' del gruppo, e' una
//   neutralizzazione (safety car / bandiera rossa): quei giri non sono soste. Giri lenti consecutivi = una sola sosta.
// - Sosta: tempo perso rispetto al ritmo. Poco = rifornimento, di piu' = cambio pilota probabile, tantissimo = sosta lunga.
//   E' una stima dai tempi: non si vede cosa succede ai box. Una sosta fatta sotto safety non si vede (il giro e' gia' lento per tutti).
// - Stint = giri tra due soste; la prossima sosta si stima dal loro valore medio (o da quello del gruppo se non ne ha ancora fatte).
// - Suggerimento per il nostro pit: per ogni giro dei prossimi, posizione prevista dopo la sosta, tenendo conto delle soste
//   attese degli altri (giro di sosta stimato + tempo perso).
// Tutto in memoria, per stanza: dopo un riavvio si ricomincia dai giri nuovi.

const SOGLIA_LENTO = 1.25;       // giro lento: > 25% oltre il ritmo...
const MIN_EXTRA_S = 15;          // ...e almeno 15 s
const FINO_RIFORNIMENTO_S = 92;  // tempo perso: sotto = rifornimento, poi cambio probabile
const FINO_CAMBIO_S = 145;       // sopra = sosta lunga
const PERDITA_DEFAULT_S = 80;    // se non abbiamo ancora fatto soste
const FRAZ_NEUTRALIZZAZIONE = 0.5;
const GIRI_MAX = 400;

const stanze = new Map();

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mediana = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function stanza(code) {
  let s = stanze.get(code);
  if (!s) { s = { auto: new Map() }; stanze.set(code, s); }
  return s;
}
function azzera(code) { stanze.delete(code); }
function ultima(code) { const s = stanze.get(code); return s && s.cache ? s.cache : null; }

function tt(g) { return g.tEff != null ? g.tEff : g.t; }

// ritmo proprio: mediana degli ultimi 8 giri non lenti (dal secondo giro)
function ritmo(auto, finoA) {
  const v = [];
  for (let i = auto.giri.length - 1; i >= 0 && v.length < 8; i--) {
    const g = auto.giri[i];
    if (g.n < 2 || (finoA != null && g.n > finoA)) continue;
    if (g.lento) continue;
    v.push(tt(g));
  }
  return v.length >= 3 ? mediana(v) : null;
}

function registraGiri(auto, p, ora) {
  const giri = num(p.giri);
  if (giri == null) return;
  if (giri > auto.n) {
    const t = num(p.ultimoGiro), tot = num(p.tempoTotale);
    if (t != null && t > 5 && giri <= GIRI_MAX) auto.giri.push({ n: giri, t, tTot: tot != null ? tot : null, at: ora, lento: false });
    auto.n = giri;
  }
}

// Segna quali giri sono lenti rispetto al ritmo che l'auto aveva PRIMA di quel giro.
function segnaLenti(auto) {
  for (let i = 0; i < auto.giri.length; i++) {
    const g = auto.giri[i];
    g.lento = false;
    if (g.n < 2) continue;
    const base = ritmoPrima(auto, i);
    g.base = base;
    if (base != null && tt(g) > base * SOGLIA_LENTO && tt(g) - base > MIN_EXTRA_S) g.lento = true;
  }
}
function ritmoPrima(auto, i) {
  const v = [];
  for (let k = i - 1; k >= 0 && v.length < 8; k--) {
    const g = auto.giri[k];
    if (g.n < 2 || g.lento) continue;
    v.push(tt(g));
  }
  return v.length >= 3 ? mediana(v) : null;
}

// Neutralizzazioni: tratti di tempo in cui almeno meta' delle auto ha un giro lento in corso.
function neutralizzazioni(auto) {
  const tutte = [...auto.values()].filter((a) => a.giri.length >= 4);
  const tempi = [];
  tutte.forEach((a) => a.giri.forEach((g) => { if (g.tTot != null) tempi.push(g.tTot); }));
  if (!tutte.length || !tempi.length) return [];
  const t0 = Math.min.apply(null, tempi), t1 = Math.max.apply(null, tempi);
  const out = []; let aperto = null;
  const ptr = tutte.map(() => 0);
  for (let x = t0; x <= t1 + 5; x += 5) {
    let coperte = 0; const rapporti = [];
    tutte.forEach((a, k) => {
      const gs = a.giri;
      while (ptr[k] < gs.length && !(gs[ptr[k]].tTot != null && x <= gs[ptr[k]].tTot)) ptr[k]++;
      const g = gs[ptr[k]];
      if (!g || g.tTot - g.t > x || g.base == null) return;
      coperte++;
      if (tt(g) > g.base * 1.3) rapporti.push(tt(g) / g.base);
    });
    // neutralizzazione: meta' del gruppo rallenta E tutti nello stesso modo (soste ravvicinate hanno tempi persi molto diversi tra loro)
    let simili = 0; const med = mediana(rapporti);
    if (med) rapporti.forEach((q) => { if (Math.abs(q - med) <= 0.15 * med) simili++; });
    const dentro = coperte >= 4 && rapporti.length / coperte >= FRAZ_NEUTRALIZZAZIONE && simili >= 0.7 * rapporti.length;
    if (dentro && !aperto) aperto = { da: x, a: x };
    else if (dentro) aperto.a = x;
    else if (aperto) { out.push(aperto); aperto = null; }
  }
  if (aperto) out.push(aperto);
  return out.filter((w) => w.a - w.da >= 10);
}

function tipoSosta(extra) { return extra < FINO_RIFORNIMENTO_S ? "rifornimento" : extra < FINO_CAMBIO_S ? "cambio" : "lungo"; }

// Soste di un'auto: gruppi di giri lenti consecutivi che non cadono in una neutralizzazione.
function sosteDi(a, neut) {
  const soste = []; let cur = null;
  a.giri.forEach((g) => {
    // un giro che si sovrappone alla neutralizzazione (anche solo per qualche secondo: ha preso il rallentamento) non e' una sosta
    const dentro = g.tTot != null && neut.some((w) => Math.min(g.tTot, w.a + 2) - Math.max(g.tTot - g.t, w.da - 2) >= 5);
    if (g.lento && !dentro && g.base != null) {
      const extra = tt(g) - g.base;
      if (cur && g.n === cur.ultimo + 1) { cur.extraS += extra; cur.ultimo = g.n; }
      else { cur = { giro: g.n, tTot: g.tTot, extraS: extra, ultimo: g.n }; soste.push(cur); }
    } else cur = null;
  });
  return soste.map((s) => ({ giro: s.giro, tTot: s.tTot, extraS: r1(s.extraS), tipo: tipoSosta(s.extraS) }));
}

// Lunghezze degli stint conclusi (giri tra una sosta e la successiva; il primo parte dal via).
function stintConclusi(soste) {
  const lun = [];
  let prec = 0;
  soste.forEach((s) => { lun.push(s.giro - prec); prec = s.giro; });
  return lun;
}
// Stint "tipico" dell'auto: dal secondo stint in poi (il primo dipende da quanto carburante si parte e spesso e' diverso).
function stintMedio(soste) {
  const lun = stintConclusi(soste);
  if (lun.length >= 2) return media(lun.slice(1));
  return lun.length ? lun[0] : null;
}

// Pause: intervalli in cui NESSUNA auto passa sul traguardo (con tante auto in pista non succede mai in gara normale).
// Il tempo di pausa dentro un giro non e' del giro: si toglie, cosi' un giro con la bandiera rossa non sembra una sosta.
function pauseDelGruppo(auto) {
  const tutte = [...auto.values()].filter((a) => a.giri.length >= 3);
  if (tutte.length < 6) return [];
  const passaggi = [];
  tutte.forEach((a) => a.giri.forEach((g) => { if (g.tTot != null) passaggi.push(g.tTot); }));
  passaggi.sort((x, y) => x - y);
  const rg = new Map(tutte.map((a) => [a, ritmoGrezzo(a)]));
  const tip = mediana([...rg.values()].filter((x) => x != null));
  if (!tip || passaggi.length < 12) return [];
  const soglia = Math.max(40, 0.45 * tip), out = [];
  for (let i = 1; i < passaggi.length; i++) {
    const da = passaggi[i - 1], a2 = passaggi[i], buco = a2 - da;
    if (buco <= soglia) continue;
    // vera pausa: quasi tutte le auto hanno il giro che attraversa il buco allungato di quasi quanto il buco (all'inizio, con le auto in gruppo, il buco c'e' ma i giri sono normali)
    let n = 0, lunghi = 0; const eccessi = [];
    tutte.forEach((x) => {
      const g = x.giri.find((q) => q.tTot != null && q.tTot - q.t <= da && q.tTot >= a2 - 0.5);
      const b0 = rg.get(x);
      if (!g || b0 == null) return;
      n++; eccessi.push(g.t - b0);
      if (g.t - b0 >= 0.6 * buco) lunghi++;
    });
    if (n >= 6 && lunghi >= 0.7 * n) out.push({ da, a: a2, d: mediana(eccessi) });
  }
  return out;
}
function ritmoGrezzo(a) { const v = a.giri.filter((g) => g.n >= 2).map((g) => g.t); return v.length >= 3 ? mediana(v) : null; }

function riassumi(st, numeroNostro, ora) {
  const auto = st.auto;
  // Pausa (bandiera rossa): nessuno passa per tanto tempo e i giri che la attraversano sono allungati della pausa.
  // Non e' una sosta: si toglie la durata della pausa dai giri che la contengono. Un buco che cade in una safety (auto in gruppo, stessa firma) non e' una pausa.
  auto.forEach((a) => a.giri.forEach((g) => { g.tEff = g.t; }));
  auto.forEach((a) => segnaLenti(a));
  const neutGrezze = neutralizzazioni(auto);
  const pause = pauseDelGruppo(auto).filter((w) => !neutGrezze.some((n) => Math.min(n.a, w.a) - Math.max(n.da, w.da) > 0.3 * (w.a - w.da)));
  auto.forEach((a) => a.giri.forEach((g) => {
    g.tEff = g.t;
    if (g.tTot != null) pause.forEach((w) => { if (g.tTot - g.t <= w.da + 0.5 && g.tTot >= w.a - 0.5) g.tEff -= Math.min(w.d, g.t); });
  }));
  auto.forEach((a) => segnaLenti(a));
  const neut = neutralizzazioni(auto);
  const lista = [...auto.values()].filter((a) => a.n > 0);
  const maxT = Math.max.apply(null, lista.map((a) => (a.giri.length && a.giri[a.giri.length - 1].tTot) || 0).concat([0]));
  const lastN = lista.length ? Math.max.apply(null, lista.map((a) => a.n)) : 0;
  let safety = neut.length > 0 && maxT > 0 && neut[neut.length - 1].a >= maxT - 15;
  // sospensione: nessuno passa da molto (con tante auto in pista c'e' sempre qualcuno che passa)
  const tipici = lista.map((a) => ritmo(a)).filter((x) => x != null);
  const giroTip = mediana(tipici);
  const ultimoVisto = Math.max.apply(null, lista.map((a) => (a.giri.length ? a.giri[a.giri.length - 1].at : 0)).concat([0]));
  // Non basta il silenzio sul traguardo: con poche auto ancora in gruppo nessuno passa per quasi un giro intero, a ogni giro.
  // Serve anche che almeno meta' delle auto sia in ritardo sul proprio ritmo (oltre il giro tipico + 10%, almeno 10 s).
  const conRitmo = lista.filter((a) => a.n >= 3 && ritmo(a) && a.giri.length);
  const fermeInRitardo = conRitmo.filter((a) => { const b = ritmo(a); return (ora - a.giri[a.giri.length - 1].at) / 1000 > b + Math.max(10, 0.1 * b); }).length;
  const sospensione = !!(giroTip && ultimoVisto && lista.length >= 6 && (ora - ultimoVisto) / 1000 > Math.max(30, 0.4 * giroTip) && lastN >= 3
    && conRitmo.length >= 3 && fermeInRitardo >= FRAZ_NEUTRALIZZAZIONE * conRitmo.length);

  // in diretta: meta' del gruppo non passa da piu' di 1,35 giri tipici = rallentamento in corso (i giri lenti si vedono solo a fine giro)
  const inRitardo = lista.filter((a) => { const b = ritmo(a), u = a.giri[a.giri.length - 1]; return b && u && a.n >= 3 && (ora - u.at) / 1000 > 1.35 * b; }).length;
  if (lista.length >= 6 && inRitardo >= FRAZ_NEUTRALIZZAZIONE * lista.filter((a) => a.n >= 3).length && lastN >= 3) safety = true;

  const sosteTutte = [];
  const righe = lista.map((a) => {
    const soste = sosteDi(a, neut);
    soste.forEach((s) => sosteTutte.push(s));
    const base = ritmo(a);
    const ult = a.giri.length ? a.giri[a.giri.length - 1] : null;
    const overdue = !!(base && ult && (ora - ult.at) / 1000 > 1.5 * base && !sospensione && !safety);
    return { a, soste, base, ult, overdue };
  });
  // valori del gruppo (per chi non ha ancora fatto soste)
  const stintSecondi = [], stintPrimi = [];
  righe.forEach((r) => { const l = stintConclusi(r.soste); if (l.length) stintPrimi.push(l[0]); l.slice(1).forEach((x) => stintSecondi.push(x)); });
  const stintGruppo = mediana(stintSecondi) != null && stintSecondi.length >= 3 ? mediana(stintSecondi) : null;   // stint "tipico" del gruppo
  const primoGruppo = stintPrimi.length >= 3 ? mediana(stintPrimi) : null;                                        // quando si ferma di solito la prima volta
  const extraGruppo = mediana(sosteTutte.map((s) => s.extraS));
  const out = righe.map((r) => {
    const lun = stintConclusi(r.soste);
    const proprio = lun.length >= 2 ? stintMedio(r.soste) : null;          // dati propri affidabili solo dopo 2 soste
    const sm = r.soste.length ? stintMedio(r.soste) : null;
    const ultima = r.soste.length ? r.soste[r.soste.length - 1].giro : null;
    const ref = proprio != null ? proprio : (r.soste.length ? (stintGruppo != null ? stintGruppo : sm) : primoGruppo);
    let prossima = null;
    if (ref != null) prossima = Math.round((ultima || 0) + ref);
    if (prossima != null && prossima <= r.a.n) prossima = r.a.n + 1;       // in ritardo sulla stima: a breve
    const pos = num(r.a.pos);
    return {
      numero: r.a.numero, nome: r.a.nome, classe: r.a.classe, pos, giri: r.a.n,
      ritmoS: r1(r.base), soste: r.soste, stintMedio: sm != null ? r1(sm) : null,
      ultimaSosta: ultima, prossima, stimaDaGruppo: proprio == null && ref != null, aiBox: r.overdue,
      extraMedio: r.soste.length ? r1(media(r.soste.map((s) => s.extraS))) : null,
      tTot: r.ult ? r.ult.tTot : null,
    };
  }).sort((x, y) => (x.pos == null ? 1e9 : x.pos) - (y.pos == null ? 1e9 : y.pos));

  const nostra = out.find((r) => r.numero === numeroNostro) || null;
  const rivali = out.filter((r) => r.numero !== numeroNostro);
  let sugg = null;
  if (nostra && nostra.ritmoS && nostra.tTot != null) sugg = suggerimento(nostra, rivali, extraGruppo, safety);
  return {
    giro: lastN, safety, sospensione, neutralizzazioni: neut.length,
    nostra: nostra && { numero: nostra.numero, pos: nostra.pos, giri: nostra.giri, ritmoS: nostra.ritmoS, soste: nostra.soste, stintMedio: nostra.stintMedio, prossima: nostra.prossima, ultimaSosta: nostra.ultimaSosta },
    rivali: rivali.map((r) => ({ numero: r.numero, nome: r.nome, classe: r.classe, pos: r.pos, giri: r.giri, ritmoS: r.ritmoS, soste: r.soste, stintMedio: r.stintMedio, ultimaSosta: r.ultimaSosta, prossima: r.prossima, stimaDaGruppo: r.stimaDaGruppo, aiBox: r.aiBox, dopoNoi: nostra && r.pos != null && nostra.pos != null ? r.pos > nostra.pos : null })),
    sugg,
  };
}

// Posizione prevista dopo la nostra sosta, per ognuno dei prossimi giri.
function suggerimento(nostra, rivali, extraGruppo, safety) {
  const L = nostra.extraMedio != null ? nostra.extraMedio : (extraGruppo != null ? extraGruppo : PERDITA_DEFAULT_S);
  const perditaSafety = safety ? L * 0.55 : L;
  const n = nostra.giri;
  const tabella = [];
  for (let d = 0; d <= 7; d++) {
    const m = n + d + 1;                                     // giro in cui finisce la nostra sosta
    const Tn = nostra.tTot + (m - n) * nostra.ritmoS + (d === 0 ? perditaSafety : L);
    let pos = 1;
    rivali.forEach((r) => {
      if (r.ritmoS == null || r.tTot == null) return;
      let T = r.tTot + (m - r.giri) * r.ritmoS;
      const loss = r.extraMedio != null ? r.extraMedio : (extraGruppo != null ? extraGruppo : PERDITA_DEFAULT_S);
      if (r.prossima != null && r.prossima > r.giri && r.prossima <= m) T += loss;   // la sua sosta cade prima
      if (T < Tn) pos++;
    });
    tabella.push({ giro: m - 1, pos });                      // "giro" = il giro in cui si entra ai box
  }
  let migliore = tabella[0];
  tabella.forEach((t) => { if (t.pos < migliore.pos) migliore = t; });
  return { perditaS: r1(L), perditaStimata: nostra.extraMedio == null, tabella, migliore, safety, adesso: tabella[0].pos };
}

/** Registra un aggiornamento della classifica e ritorna il riassunto (stesso formato per tutti i telefoni). */
function registra(code, piloti, numeroNostro, ora) {
  const t = ora == null ? Date.now() : ora;
  const st = stanza(code);
  const nostro = String(numeroNostro == null ? "" : numeroNostro).trim();
  let nuovo = false;
  (piloti || []).forEach((p) => {
    if (!p) return;
    const numero = String(p.numero == null ? "" : p.numero).trim();
    if (!numero) return;
    let a = st.auto.get(numero);
    if (!a) { a = { numero, nome: String(p.nome || "").trim(), classe: String(p.classe || "").trim(), n: 0, pos: null, giri: [] }; st.auto.set(numero, a); }
    a.pos = num(p.pos);
    const n0 = a.n;
    registraGiri(a, p, t);
    if (a.n !== n0) nuovo = true;
  });
  // il calcolo completo costa (24 ore, 60 auto): si rifa quando arriva un giro nuovo o ogni 5 s per le cose a tempo (safety, sospensione)
  if (st.cache && !nuovo && nostro === st.cacheNostro && t - st.cacheT < 5000) return Object.assign({}, st.cache, { agg: t });
  const r = riassumi(st, nostro, t);
  r.agg = t;
  st.cache = r; st.cacheT = t; st.cacheNostro = nostro;
  return r;
}

module.exports = { registra, azzera, ultima, _test: { riassumi, sosteDi, neutralizzazioni, tipoSosta, stanza, SOGLIA_LENTO } };
