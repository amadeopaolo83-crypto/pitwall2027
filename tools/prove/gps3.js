const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/pitwall2027/public';
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8773, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__em=[];window.io=()=>({on(){},off(){},emit(...a){window.__em.push(a)},connected:true,onAny(){}});' }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.addInitScript(() => { let off = 0; const real = Date.now.bind(Date); Date.now = () => real() + off; window.__avanza = (s) => { off += s * 1000; };
    window.__w = { cb: null }; navigator.geolocation.watchPosition = (cb) => { window.__w.cb = cb; return 9; }; navigator.geolocation.clearWatch = () => { window.__w.cb = null; };
    window.__notif = []; window.PitCommAndroid = { notifica: (t, x) => window.__notif.push([t, x]) }; });
  await pg.goto('http://localhost:8773/');
  const R = await pg.evaluate(async () => {
    const out = {}; const A = window.__avanza;
    role = 'box'; code = 'FLATSIX'; socket = io();
    document.querySelectorAll('body > div').forEach((d) => { d.hidden = true; }); document.getElementById('boxView').hidden = false;
    localStorage.setItem('pc_gps_applica', '1');
    // 1) registrazione corsia: si cammina da 45 a 45.0006 (circa 67 m), punti ogni ~1 m
    const btn = document.querySelector('[onclick^="gpsRegistraCorsia"]');
    gpsRegistraCorsia(btn);
    for (let i = 0; i <= 67; i++) window.__w.cb({ coords: { latitude: 45 + i * 0.00000898, longitude: 9, accuracy: 4 } });
    window.__w.cb({ coords: { latitude: 45.0007, longitude: 9, accuracy: 60 } }); // impreciso: scartato
    out.regTesto = btn.textContent;
    gpsRegistraCorsia(btn);
    const inviata = window.__em.filter((e) => e[0] === 'gpsConfigUpdate').pop()[1];
    out.regPunti = inviata.corsia.length; out.regLungh = Math.round(gpsLunghezza(inviata.corsia));
    gpsApplicaConfig({ on: true, box: { lat: 45, lng: 9 }, refuel: { lat: 45.0003, lng: 9 }, rBox: 10, rRefuel: 25, corsia: inviata.corsia, larg: 8, fermoS: 60 });
    const pos = (lat, lng, acc = 5) => gpsRicevi({ lat, lng, acc, t: Date.now() });
    const passo = (lat, lng, sec, acc, jit = 0) => { for (let i = 0; i < sec; i++) { A(1); pos(lat + (Math.random() - .5) * jit, lng, acc); } };
    out.distCorsia = [Math.round(gpsDistCorsia({ lat: 45.0003, lng: 9 })), Math.round(gpsDistCorsia({ lat: 45.0003, lng: 9.0003 }))];
    // 2) fermo in corsia, fuori da box e rifornimento, con piccolo rumore GPS (+-1,5 m)
    passo(45.00055, 9, 40, 5, 0.000027);   out.dopo40s = [gpsChiede, gpsStato];
    passo(45.00055, 9, 25, 5, 0.000027);   out.dopo65s = [gpsChiede, !$('gpsDomanda').hidden, gpsStato, $('gpsDomandaTesto').textContent];
    out.notifApp = window.__notif.length;   // pagina in primo piano: nessuna notifica nativa
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    gpsChiede = false; gpsCambioFatto = false; gpsAncoraDa = Date.now() - 70000; gpsControllaFermo();
    out.notifNascosta = window.__notif.length; Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    // 3) si muove di 12 m: la domanda sparisce e si ricomincia
    pos(45.00055 + 0.0001, 9);             out.mossa = [gpsChiede, $('gpsDomanda').hidden];
    // 4) fermo ma fuori dalla corsia (23 m di lato): niente domanda
    passo(45.0003, 9.0003, 80, 5);         out.fuoriCorsia = [gpsChiede, gpsInCorsia];
    // 5) fermo in corsia ma senza segnale buono (80 m di errore): niente
    passo(45.00055, 9, 80, 80);            out.puntiImprecisi = gpsChiede;
    // 6) risposta
    passo(45.00055, 9, 70, 5);             out.richiesta = gpsChiede;
    gpsRispostaCambio(true);               out.cambi = gpsCambio.n;
    passo(45.00055, 9, 90, 5);             out.unaVolta = gpsChiede;
    // 7) foto finale
    code = 'flatsix'; applyFinishPhoto(null); out.fotoFlatsix = document.getElementById('finishPhotoImg').getAttribute('src');
    code = 'ALTRA'; applyFinishPhoto(null); out.fotoAltra = document.getElementById('finishPhotoImg').getAttribute('src');
    applyFinishPhoto(12345); out.fotoCaricata = document.getElementById('finishPhotoImg').getAttribute('src');
    // 8) avviso messaggio con testo
    window.__notif.length = 0; Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    avvisaMessaggio('Pit tra 2 giri'); out.msgNotif = window.__notif[0];
    return out;
  });
  console.log(JSON.stringify(R)); console.log('errs', errs);
  await b.close(); srv.close();
});
