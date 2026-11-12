// Finto ponte per il simulatore (solo con la variabile SIM_PONTE=1; spento di norma).
//
// Fa da "live timing" finto: la nostra auto e' quella del simulatore (public/sim.html: i passaggi sul traguardo
// arrivano da li), gli altri sono piloti virtuali con ritmo proprio, soste, safety car e pause (bandiera rossa).
// Da fuori produce la stessa classifica del ponte vero (vedi ponte.js): solo tempi, in secondi.
//
// Uso: nel box, "Nostro" con indirizzo https://pitcomm.sim/NOME e il numero della nostra auto
// (ponte.js lo risponde qui dentro, senza rete). Il simulatore manda la corsa con POST /sim/ponte/avvia.

const attivo = () => process.env.SIM_PONTE === "1";
const HOST = "pitcomm.sim";

const stati = new Map(); // nome evento -> { cfg, rivali, avvioMs }

// numeri casuali ripetibili (stessa idea di Pista.casuale)
function casuale(seme) {
  let s = (Math.abs(Math.floor(seme)) % 2147483646) + 1;
  const uni = () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
  const gauss = () => { let u = 0; while (u < 1e-9) u = uni(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uni()); };
  return { uni, gauss };
}

const eNum = (x, min, max) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

// I giri degli altri: tempi di passaggio sul traguardo, uno dopo l'altro, fino a "fino" secondi.
function generaRivale(i, cfg, fino) {
  const r = casuale(cfg.seme * 131 + i * 17 + 3);
  // Gruppo compatto (cfg.centro, scelto nel simulatore): la nostra auto sta nel mezzo. Meta' degli altri un po' piu' veloce e
  // meta' un po' piu' lenta (ritmi da -2% a +2%, vicini fra loro), poco rumore sul giro, partenza lanciata con meta' davanti e
  // meta' dietro di noi, soste con la stessa frequenza delle nostre: i distacchi cambiano di poco, giro per giro.
  const c = cfg.centro ? cfg.centro : null, mezzo = c ? (c.passo.length - 1) / 2 : 0;
  const base = cfg.fissi ? cfg.giroS : c ? cfg.giroS * (1 + 0.02 * (c.passo[i] - mezzo) / (mezzo || 1)) : cfg.giroS * (0.95 + 0.11 * r.uni());   // ritmo proprio
  // Prova colori (cfg.fissi): gli altri girano al nostro ritmo nominale, senza soste, a 10 s l'uno dall'altro, meta' davanti e meta' dietro.
  // Il rivale davanti e quello dietro non cambiano mai: i distacchi si muovono solo con i nostri cambi di ritmo (righe "ritmo").
  const fissi = !!cfg.fissi;
  const rumore = fissi ? 0.0015 : c ? 0.003 : 0.008, primoGiro = (c || fissi) ? 1 : 1.06;
  const stint = () => c ? 5 + Math.floor(r.uni() * 3) : 7 + Math.floor(r.uni() * 4);   // giri tra due soste
  const perdita = c ? 12 + r.uni() * 10 : 24 + r.uni() * 22;  // secondi persi in una sosta normale (corsia e uscita)
  const guasto = i === 4;                                     // uno si ferma a lungo una volta
  let prossimaSosta = fissi ? 1e9 : c ? 5 + Math.floor(r.uni() * 3) : 6 + Math.floor(r.uni() * 5), giro = 0;
  const meta = Math.floor(((cfg.nAuto || 14) - 1) / 2);
  const scarto = fissi ? (i < meta ? -(meta - i) : (i - meta + 1)) * 10 : 0;        // secondi dietro (+) o davanti (-) a noi al primo passaggio
  let t = fissi ? cfg.partenza : c ? Math.max(0, cfg.partenza + (c.griglia[i] - mezzo) * 0.5) : i * 0.4;   // schieramento: pochi decimi tra uno e l'altro
  const passaggi = [], giri = [], soste = [];
  while (t < fino && giro < 400) {
    giro++;
    let durata = base * (1 + rumore * r.gauss()) * (giro === 1 ? primoGiro : 1);
    if (fissi && giro === 1) durata += scarto;
    const inizio = t;
    const sc = cfg.finestre.find((w) => inizio >= w.da && inizio < w.a);
    if (sc) durata /= sc.fattore;
    let sosta = 0;
    if (giro >= prossimaSosta) {
      // tipo di sosta: rifornimento breve, cambio pilota (piu' lungo) o rifornimento lungo (fino a ~3 minuti)
      const q = r.uni();
      const tipo = q < 0.55 ? "rifornimento" : (q < 0.85 || c) ? "cambio" : "lungo";   // gruppo compatto: niente soste lunghe
      const fermo = tipo === "rifornimento" ? 25 + r.uni() * 20 : tipo === "cambio" ? 60 + r.uni() * 40 : 120 + r.uni() * 60;
      sosta = (sc ? 0.55 : 1) * perdita * (0.9 + 0.2 * r.uni()) + fermo;
      if (guasto && !soste.length) sosta += 110;
      prossimaSosta = giro + stint();
      soste.push({ giro, tipo, fermoS: Math.round(fermo * 10) / 10, extraS: Math.round(sosta * 10) / 10, sottoSafety: !!sc });
    }
    let fine = inizio + durata + sosta;
    cfg.pause.forEach((p) => { if (p.da > inizio && p.da < fine) fine += p.durata; });   // bandiera rossa: fermi tutti
    cfg.pause.forEach((p) => { if (inizio >= p.da && inizio < p.da + p.durata) fine += p.da + p.durata - inizio; });
    t = fine; passaggi.push(t); giri.push(t - inizio);
  }
  return { numero: String(10 + i * 7 + (i % 3)), nome: "Equipaggio " + (i + 1), classe: i % 2 ? "B" : "A", passaggi, giri, soste };
}

function avvia(corpo) {
  if (!corpo || typeof corpo !== "object") return { ok: false, error: "corpo non valido" };
  const evento = String(corpo.evento || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,30}$/.test(evento)) return { ok: false, error: "evento non valido" };
  const numero = String(corpo.numero == null ? "77" : corpo.numero).trim();
  if (!/^[A-Za-z0-9]{1,6}$/.test(numero)) return { ok: false, error: "numero non valido" };
  if (!eNum(corpo.giroS, 20, 900)) return { ok: false, error: "giro non valido" };
  if (!Array.isArray(corpo.passaggi) || corpo.passaggi.length > 600 || !corpo.passaggi.every((x) => eNum(x, 0, 1e6))) return { ok: false, error: "passaggi non validi" };
  const lista = (v, campi) => (Array.isArray(v) && v.length <= 50 && v.every((o) => o && campi.every(([k, mn, mx]) => eNum(o[k], mn, mx)))) ? v : null;
  const finestre = corpo.finestre == null ? [] : lista(corpo.finestre, [["da", 0, 1e6], ["a", 0, 1e6], ["fattore", 0.1, 1]]);
  const pause = corpo.pause == null ? [] : lista(corpo.pause, [["da", 0, 1e6], ["durata", 1, 7200]]);
  if (!finestre || !pause) return { ok: false, error: "safety o pause non valide" };
  if (!eNum(corpo.tGara, -7200, 1e6)) return { ok: false, error: "tempo di gara non valido" };
  const nAuto = eNum(corpo.nAuto, 2, 40) ? Math.floor(corpo.nAuto) : 14;
  // gruppo compatto: due ordini casuali ripetibili (ritmo e posto in griglia) per gli altri; la nostra partenza (secondi dallo zero)
  let centro = null;
  if (corpo.centro === true) {
    const r = casuale((eNum(corpo.seme, 0, 1e9) ? Math.floor(corpo.seme) : 1) * 7919 + 11), n = nAuto - 1;
    const mescola = () => { const a = Array.from({ length: n }, (_, k) => k); for (let k = n - 1; k > 0; k--) { const j = Math.floor(r.uni() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
    centro = { passo: mescola(), griglia: mescola() };
  }
  const cfg = { centro, fissi: corpo.fissi === true, nAuto, partenza: eNum(corpo.partenza, 0, 600) ? corpo.partenza : 0, numero, giroS: corpo.giroS, passaggi: corpo.passaggi.slice(), finestre: finestre.map((w) => ({ da: w.da, a: w.a, fattore: w.fattore })), pause: pause.map((p) => ({ da: p.da, durata: p.durata })), seme: eNum(corpo.seme, 0, 1e9) ? Math.floor(corpo.seme) : 1 };
  const ultimo = cfg.passaggi.length ? cfg.passaggi[cfg.passaggi.length - 1] : 0;
  const fino = Math.max(600, ultimo + 240);
  const rivali = [];
  for (let i = 0; i < nAuto - 1; i++) {
    const rv = generaRivale(i, cfg, fino);
    if (rv.numero === numero) rv.numero = String(Number(rv.numero) + 1);
    rivali.push(rv);
  }
  const noi = { numero, nome: "Noi", classe: "A", soste: [], passaggi: cfg.passaggi, giri: cfg.passaggi.map((t, k) => t - (k ? cfg.passaggi[k - 1] : 0)) };
  stati.set(evento, { cfg, auto: [noi].concat(rivali), avvioMs: Date.now() - corpo.tGara * 1000 });
  return { ok: true, auto: nAuto, rivaliGiri: rivali.map((r) => r.passaggi.length) };
}

function salta(corpo) {
  const evento = String((corpo && corpo.evento) || "").trim().toUpperCase();
  const s = stati.get(evento);
  if (!s) return { ok: false, error: "evento sconosciuto" };
  if (!corpo || !eNum(corpo.tGara, -7200, 1e6)) return { ok: false, error: "tempo di gara non valido" };
  s.avvioMs = Date.now() - corpo.tGara * 1000;
  return { ok: true };
}

// La classifica all'istante t (secondi di gara; negativo = lancio, tutti fermi sulla griglia).
function classificaAl(s, t) {
  const righe = s.auto.map((a) => {
    let n = 0;
    while (n < a.passaggi.length && a.passaggi[n] <= t) n++;
    const ultimo = n ? a.giri[n - 1] : null;
    return {
      numero: a.numero, nome: a.nome, classe: a.classe, giri: n,
      tempoTotale: n ? a.passaggi[n - 1] : null,
      ultimoGiro: ultimo, migliorGiro: n ? Math.min.apply(null, a.giri.slice(0, n)) : null,
    };
  });
  righe.sort((x, y) => (y.giri - x.giri) || ((x.tempoTotale == null ? 1e9 : x.tempoTotale) - (y.tempoTotale == null ? 1e9 : y.tempoTotale)) || (x.numero < y.numero ? -1 : 1));
  const primo = righe[0];
  righe.forEach((r, k) => {
    r.pos = k + 1;
    r.giriRitardo = primo.giri - r.giri;
    const davanti = righe[k - 1];
    r.intervallo = !davanti ? 0 : (davanti.giri === r.giri && r.tempoTotale != null && davanti.tempoTotale != null) ? Math.round((r.tempoTotale - davanti.tempoTotale) * 1000) / 1000 : null;
    if (r.tempoTotale != null) r.tempoTotale = Math.round(r.tempoTotale * 1000) / 1000;
    if (r.ultimoGiro != null) r.ultimoGiro = Math.round(r.ultimoGiro * 1000) / 1000;
    if (r.migliorGiro != null) r.migliorGiro = Math.round(r.migliorGiro * 1000) / 1000;
  });
  return righe;
}

function classifica(nome) {
  const s = stati.get(String(nome || "").trim().toUpperCase());
  if (!s) return { ok: false, code: "non_pubblicato", messaggio: "il simulatore non e' ancora partito" };
  const t = (Date.now() - s.avvioMs) / 1000;
  return {
    ok: true, fornitore: "simulatore", evento: { id: nome, nome: "Simulatore " + nome },
    sessione: { tipo: "gara", nome: "Gara simulata", categoria: "", bandiera: null },
    piloti: classificaAl(s, t),
  };
}

// Risposte HTTP: POST /sim/ponte/avvia, POST /sim/ponte/salta, GET /sim/ponte/classifica?evento=NOME. Ritorna true se ha gestito.
function gestisci(req, res) {
  const url = req.url || "";
  if (!url.startsWith("/sim/ponte/")) return false;
  const json = (codice, o) => { res.writeHead(codice, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); return true; };
  if (!attivo()) return json(404, { ok: false, error: "simulatore spento (SIM_PONTE)" });
  const percorso = url.split("?")[0];
  if (req.method === "GET" && percorso === "/sim/ponte/classifica") {
    const q = new URL(url, "http://x").searchParams;
    return json(200, classifica(q.get("evento")));
  }
  if (req.method === "POST" && (percorso === "/sim/ponte/avvia" || percorso === "/sim/ponte/salta")) {
    let dati = "", troppo = false;
    req.on("data", (c) => { dati += c; if (dati.length > 300000) { troppo = true; req.destroy(); } });
    req.on("end", () => {
      if (troppo) return;
      let corpo = null;
      try { corpo = JSON.parse(dati); } catch (e) { return json(400, { ok: false, error: "json non valido" }); }
      return json(200, percorso.endsWith("avvia") ? avvia(corpo) : salta(corpo));
    });
    return true;
  }
  return json(404, { ok: false });
}

module.exports = { attivo, HOST, avvia, salta, classifica, classificaAl, gestisci, _stati: stati };
