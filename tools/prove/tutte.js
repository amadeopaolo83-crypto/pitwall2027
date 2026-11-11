// Esegue tutte le prove una dopo l'altra e dice quali passano. Esce con 1 se almeno una fallisce.
// Uso: node tools/prove/tutte.js            (tutte)
//      node tools/prove/tutte.js gps3 audit (solo quelle indicate)
// Servono: le dipendenze del server (npm install), Playwright con Chromium e, per audit.js,
// una copia di pitwallnew (vedi comune.js). Su GitHub le prepara .github/workflows/prove.yml.

const { spawnSync } = require('child_process');
const path = require('path');

const TUTTE = [
  // server, con finti socket
  'srvtest2', 'srvpin', 'riavvio', 'doppio',
  // server vero (node src/server.js) con socket.io-client
  'doppio-vero',
  // pagina nel browser (Playwright), con finto socket
  'orologio', 'pin', 'riavvio-client', 'doppio-client', 'xss', 'cambia', 'gps3', 'lancio1', 'mappa1', 'mappa2', 'mappa3', 'sim1', 'sim2', 'sim3', 'tocchi',
  // involucro Android: controlli sui sorgenti (la compilazione la fa android.yml)
  'apk',
  // vista auto identica a pitwallnew
  'audit',
];

const scelte = process.argv.slice(2);
const daFare = scelte.length ? TUTTE.filter((n) => scelte.includes(n)) : TUTTE;
const esiti = [];
for (const nome of daFare) {
  console.log('\n===== ' + nome);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, nome + '.js')], { stdio: 'inherit', timeout: 240000 });
  const ok = r.status === 0;
  esiti.push([nome, ok, Math.round((Date.now() - t0) / 1000)]);
}
console.log('\n===== RIEPILOGO');
for (const [nome, ok, s] of esiti) console.log((ok ? 'OK   ' : 'MALE ') + nome.padEnd(16) + s + ' s');
const male = esiti.filter((e) => !e[1]).length;
console.log(male ? `FALLITE ${male} su ${esiti.length}` : `Tutte bene (${esiti.length})`);
process.exit(male ? 1 : 0);
