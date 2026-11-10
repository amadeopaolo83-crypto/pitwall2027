// Doppio box: quando in una stanza ci sono due o piu' box collegati, uno e' il PRIMARIO (comanda timer, gara,
// impostazioni, GPS) e gli altri sono SECONDARI (vedono tutto e possono mandare messaggi all'auto, registrare
// rifornimenti e confermare il cambio pilota). Il primo che entra e' primario.
//   - il primario puo' cedere la priorita' per 15/30/60/120 minuti: poi torna da solo a lui (se e' collegato);
//   - un secondario puo' prendere il comando quando vuole;
//   - se il primario resta scollegato per 20 s il comando passa al box collegato piu' anziano.
// Si accende con la variabile DOPPIO_BOX=1 (su Render). Spento, o con un solo box, non cambia niente:
// tutti i box comandano come sempre. Lo stato e' solo in memoria: dopo un riavvio il primo che rientra e' primario.
// Ogni telefono ha un suo `boxId` (salvato sul telefono): un box che si ricollega e' lo stesso box.

const ATTESA_PERSO_MS = 20 * 1000;
const MINUTI_OK = [15, 30, 60, 120];
const gruppi = new Map(); // codice -> { box: Map(boxId -> { id, sockets:Set, dal, offlineDal }), primario, cessione, timerCessione }

const attivo = () => /^(1|true|si|on)$/i.test(String(process.env.DOPPIO_BOX || ""));

function gruppo(code) {
  if (!gruppi.has(code)) gruppi.set(code, { box: new Map(), primario: null, cessione: null, timerCessione: null });
  return gruppi.get(code);
}
const collegato = (b) => !!b && b.sockets.size > 0;
const collegati = (g) => [...g.box.values()].filter(collegato);

function stato(code, boxId) {
  const g = gruppi.get(code);
  if (!attivo() || !g) return { attivo: false, ruolo: "primario", n: 1, cessione: null };
  const n = collegati(g).length;
  return {
    attivo: true,
    n,
    ruolo: puoComandare(code, boxId) ? "primario" : "secondario",
    cessione: g.cessione ? { finoA: g.cessione.finoA, daMe: g.cessione.da === boxId, perMe: g.cessione.a === boxId } : null,
  };
}

// Dice a ogni box del gruppo qual e' il suo ruolo adesso.
function avvisa(code) {
  const g = gruppi.get(code);
  if (!g) return;
  for (const b of g.box.values()) for (const s of b.sockets) { try { s.emit("boxRuolo", stato(code, b.id)); } catch (e) { /* un socket caduto non ferma gli altri */ } }
}

function puoComandare(code, boxId) {
  if (!attivo()) return true;
  const g = gruppi.get(code);
  if (!g) return true;
  const c = collegati(g);
  if (c.length <= 1) return true;       // da solo comanda sempre
  return g.primario === boxId;
}

function entra(code, socket, boxId) {
  const g = gruppo(code);
  let b = g.box.get(boxId);
  if (!b) { b = { id: boxId, sockets: new Set(), dal: Date.now(), offlineDal: null }; g.box.set(boxId, b); }
  b.sockets.add(socket);
  b.offlineDal = null;
  if (!g.primario || !collegato(g.box.get(g.primario))) {
    // nessun primario, o il primario e' sparito: se questo box e' l'unico collegato prende il comando
    if (!g.primario || collegati(g).length <= 1) g.primario = boxId;
  }
  avvisa(code);
}

function esci(code, socket) {
  const g = gruppi.get(code);
  if (!g) return;
  for (const b of g.box.values()) {
    if (b.sockets.delete(socket) && !collegato(b)) {
      b.offlineDal = Date.now();
      if (g.primario === b.id) { const t = setTimeout(() => controlla(code), ATTESA_PERSO_MS + 50); if (t.unref) t.unref(); }
      avvisa(code);
    }
  }
}

// Il primario e' scollegato da piu' di 20 s e c'e' un altro box: il comando passa al piu' anziano.
function controlla(code) {
  const g = gruppi.get(code);
  if (!g) return;
  const p = g.box.get(g.primario);
  if (collegato(p)) return;
  if (p && p.offlineDal && Date.now() - p.offlineDal < ATTESA_PERSO_MS) return;
  const altri = collegati(g).sort((a, b) => a.dal - b.dal);
  if (!altri.length) return;
  g.primario = altri[0].id;
  annullaCessione(g);
  avvisa(code);
}

function annullaCessione(g) {
  if (g.timerCessione) clearTimeout(g.timerCessione);
  g.timerCessione = null; g.cessione = null;
}

// Il primario cede la priorita' per un po': il box collegato piu' anziano diventa primario, poi si torna indietro.
function cedi(code, boxId, minuti) {
  const g = gruppi.get(code);
  if (!attivo() || !g || g.primario !== boxId || !MINUTI_OK.includes(minuti)) return false;
  const altri = collegati(g).filter((b) => b.id !== boxId).sort((a, b) => a.dal - b.dal);
  if (!altri.length) return false;
  annullaCessione(g);
  g.cessione = { da: boxId, a: altri[0].id, finoA: Date.now() + minuti * 60000 };
  g.primario = altri[0].id;
  g.timerCessione = setTimeout(() => restituisci(code), minuti * 60000 + 50);
  if (g.timerCessione.unref) g.timerCessione.unref();
  avvisa(code);
  return true;
}

// Scade la cessione: la priorita' torna a chi l'aveva ceduta, se e' collegato; altrimenti resta dov'e'.
function restituisci(code) {
  const g = gruppi.get(code);
  if (!g || !g.cessione) return;
  const da = g.box.get(g.cessione.da);
  if (collegato(da)) g.primario = da.id;
  annullaCessione(g);
  avvisa(code);
}

// Chi ha ceduto la riprende subito.
function riprendi(code, boxId) {
  const g = gruppi.get(code);
  if (!attivo() || !g || !g.cessione || g.cessione.da !== boxId) return false;
  g.primario = boxId;
  annullaCessione(g);
  avvisa(code);
  return true;
}

// Un secondario prende il comando (il primario di prima diventa secondario).
function prendi(code, boxId) {
  const g = gruppi.get(code);
  if (!attivo() || !g || !collegato(g.box.get(boxId))) return false;
  g.primario = boxId;
  annullaCessione(g);
  avvisa(code);
  return true;
}

module.exports = { attivo, entra, esci, puoComandare, stato, cedi, riprendi, prendi, controlla, restituisci, _gruppi: gruppi };
