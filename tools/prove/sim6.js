// Stato "in pista / ai box / rifornimento" automatico dal GPS simulato (movimento e tracciato), consumo carburante che segue.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune'); const V = C.controlli('sim6'); const root = C.ROOT;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
const FILE = JSON.parse(fs.readFileSync(path.join(root, '..', 'tools/sim/varano.json'), 'utf8')).gps;
srv.listen(8777, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const stub = 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});';
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { let off = 0; const real = Date.now.bind(Date); Date.now = () => real() + off; window.__avanza = (s) => { off += s * 1000; }; });
  await pg.goto('http://localhost:8777/');
  await pg.addScriptTag({ path: path.join(root, 'js/pista.js') });
  const R = await pg.evaluate(async (gps) => {
    role = 'box'; code = 'SIM'; socket = io(); boxPrimario = true;
    document.querySelectorAll('body > div').forEach((d) => { d.hidden = true; }); document.getElementById('boxView').hidden = false;
    localStorage.removeItem('pc_gps_applica');           // di norma: applica gia' acceso
    gpsApplicaConfig(Object.assign({}, gps, { on: true, fermoS: 60 }), true);
    const pista = Pista.costruisci(gps), opz = Pista.calibra(pista, 100);
    const corsa = Pista.pianifica(pista, [{ giri: 1 }, { giri: 1, pit: { dove: 'rifornimento', sostaS: 30 } }, { giri: 1, pit: { dove: 'corsia', sostaS: 70 } }, { giri: 1, pit: { dove: 'box', sostaS: 90 } }, { giri: 1, pit: { dove: 'rifornimento', sostaS: 1 } }, { giri: 1 }], opz);
    const g = Pista.rumore(corsa, { seme: 9 });
    const T0 = 1.7e12, serie = [];
    for (let t = 0; t < corsa.durata + 25; t += 1) {
      window.__avanza(1);
      const q = g(t); const w = corsa.vero(t);
      if (q) gpsRicevi({ lat: q.lat, lng: q.lng, acc: q.acc, v: q.v, t: T0 + t * 1000 });
      serie.push({ t, stato: gpsStato, on: !!fuelSystem.onTrack, v: w.v, chiede: !!gpsChiede });
    }
    return { serie, verita: corsa.verita, durata: corsa.durata };
  }, FILE);
  const S = R.serie, soste = R.verita.filter((e) => e.tipo === 'sosta');
  V.ok('nessun errore nella pagina', errs.length === 0, errs);
  const inMoto = S.filter((x) => x.t > 25 && x.v > 5 && x.t < R.durata);
  const sbagliati = inMoto.filter((x) => x.stato !== 'pista');
  V.ok('con l\'auto in movimento (anche in corsia) lo stato e\' "in pista" (' + sbagliati.length + ' errati su ' + inMoto.length + ')', sbagliati.length <= inMoto.length * 0.02, sbagliati.slice(0, 5));
  V.ok('con l\'auto in movimento il consumo continua (in pista = acceso)', inMoto.filter((x) => !x.on).length <= inMoto.length * 0.02);
  const rif = soste.find((s) => s.dove === 'rifornimento' && s.durataS === 30), cors = soste.find((s) => s.dove === 'corsia'), box = soste.find((s) => s.dove === 'box'), breve = soste.find((s) => s.durataS === 1);
  const stato = (t) => S.find((x) => x.t === Math.round(t));
  const dopo = (s, d) => stato(s.t + d);
  V.ok('rifornimento 30 s: dopo ~20 s e\' "rifornimento" e il consumo e\' fermo', dopo(rif, 22).stato === 'rifornimento' && dopo(rif, 22).on === false, [dopo(rif, 22)]);
  V.ok('dopo il rifornimento torna "in pista" entro 8 s dalla ripartenza', stato(rif.fine + 8).stato === 'pista' && stato(rif.fine + 8).on, [stato(rif.fine + 8)]);
  V.ok('box 90 s: dopo ~20 s e\' "box"', dopo(box, 22).stato === 'box' && dopo(box, 22).on === false, [dopo(box, 22)]);
  V.ok('dopo il box torna "in pista"', stato(box.fine + 8).stato === 'pista', [stato(box.fine + 8)]);
  V.ok('sosta di 1 s: non diventa "rifornimento"', S.filter((x) => x.t >= breve.t - 5 && x.t <= breve.fine + 8).every((x) => x.stato === 'pista'));
  const inCorsia = S.filter((x) => x.t >= cors.t + 5 && x.t <= cors.fine - 2);
  V.ok('fermo 70 s in corsia fuori dalle zone: resta "in pista"', inCorsia.every((x) => x.stato === 'pista'), inCorsia.map((x) => x.stato).slice(0, 3));
  V.ok('...e dopo 60 s compare la domanda "era un cambio pilota?"', stato(cors.t + 68).chiede === true && stato(cors.t + 40).chiede === false, [stato(cors.t + 40).chiede, stato(cors.t + 68).chiede]);
  V.ok('sosta di 70 s (poco oltre la soglia): la domanda resta aperta anche dopo la ripartenza', stato(cors.fine + 8).chiede === true && stato(cors.fine + 20).chiede === true, [stato(cors.fine + 8).chiede, stato(cors.fine + 20).chiede]);
  V.fine(); await b.close(); srv.close();
});
