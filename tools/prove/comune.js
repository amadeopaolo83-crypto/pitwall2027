// Cose in comune alle prove: percorsi, cartella delle immagini, tessera finta della mappa e controlli.
//
// Percorsi relativi a questo file, cosi' le prove girano uguali in locale e su GitHub (Actions).
//   PROVE_OUT       cartella delle schermate (predefinita: cartella temporanea del sistema)
//   PITWALLNEW_DIR  copia di pitwallnew (solo lettura) per audit.js (predefinita: ../pitwallnew accanto al repository)

const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');

const REPO = path.join(__dirname, '..', '..');
const ROOT = path.join(REPO, 'public');
const SRC = path.join(REPO, 'src');
const OUT = process.env.PROVE_OUT || path.join(os.tmpdir(), 'pitcomm-prove');
fs.mkdirSync(OUT, { recursive: true });
const PITWALLNEW = process.env.PITWALLNEW_DIR || path.join(REPO, '..', 'pitwallnew');

// Tessera della mappa finta (PNG 256x256 tinta unita): le prove non vanno su internet.
function tessera() {
  const w = 256, h = 256;
  const riga = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x50)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => riga));
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const pezzo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(raw)), pezzo('IEND', Buffer.alloc(0))]);
}

// Errori della pagina che contano: si ignorano le risorse bloccate apposta (font, CDN).
function erroriVeri(errs) { return errs.filter((e) => !/ERR_FAILED|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e)); }

// Controlli: stampa OK/MALE e alla fine esce con 1 se qualcosa e' andato male.
function controlli(titolo) {
  let male = 0;
  const ok = (nome, cond, dettaglio) => {
    console.log((cond ? 'OK   ' : 'MALE ') + nome + (!cond && dettaglio !== undefined ? '  -> ' + JSON.stringify(dettaglio) : ''));
    if (!cond) male++;
  };
  const fine = () => { console.log(male ? `${titolo}: FALLITE ${male}` : `${titolo}: tutto bene`); process.exit(male ? 1 : 0); };
  return { ok, fine, get male() { return male; } };
}

module.exports = { REPO, ROOT, SRC, OUT, PITWALLNEW, tessera, erroriVeri, controlli };
