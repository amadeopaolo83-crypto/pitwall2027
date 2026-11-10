// Il telefono del box: salva una copia del timer che scorre e, se il server riparte da zero, la rimanda (una volta).
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'public');
const { getRoomState } = require(path.join(__dirname, '..', '..', 'src', 'rooms.js'));
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(8791, () => res(s)); });
  const b = await chromium.launch(); let male = 0;
  const prova = async (nome, { fresh, copia, ruolo }) => {
    const pg = await b.newPage({ viewport: { width: 400, height: 800 } });
    const st = JSON.parse(JSON.stringify(getRoomState('CLI' + nome)));
    st.fresh.timer = fresh;
    const corpo = `window.__em=[];window.__h={};window.io=()=>({on(ev,cb){ window.__h[ev]=cb; if(ev==='connect') setTimeout(cb,5); },off(){},connected:true,onAny(){},disconnect(){},
      emit(...a){window.__em.push(a.slice(0,2)); if(a[0]==='join'){ const ack=a[a.length-1]; setTimeout(()=>ack({ok:true,state:${JSON.stringify(st)},serverNow:Date.now()}),5);} else if(a[0]==='ora'){ a[1](Date.now()); } }});`;
    await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: corpo }));
    await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
    await pg.addInitScript(([c]) => { if (c) localStorage.setItem('pc_timer', JSON.stringify(c)); }, [copia]);
    await pg.goto('http://localhost:8791/');
    await pg.fill('#teamCode', 'CLI' + nome);
    await pg.evaluate((r) => joinAs(r), ruolo);
    await pg.waitForTimeout(600);
    const em = await pg.evaluate(() => window.__em.map((x) => x[0]));
    const salvato = await pg.evaluate(() => localStorage.getItem('pc_timer'));
    return { em, salvato, pg };
  };
  const ora = Date.now();
  const t = (extra) => ({ phase: 'race', startSeconds: 600, raceSeconds: 28800, startRemaining: 0, startRunning: false, startUpdatedAt: ora - 9000, raceRemaining: 28000, raceRunning: true, raceUpdatedAt: ora - 8000, finishTriggered: false, finishPosition: null, ...extra });
  const verifica = (nome, v) => { console.log((v ? 'OK   ' : 'MALE ') + nome); if (!v) male++; };
  let r = await prova('A', { fresh: true, copia: { code: 'CLIA', at: ora, t: t() }, ruolo: 'box' });
  verifica('server vuoto + copia in corso: il box manda timerRestore', r.em.includes('timerRestore'));
  verifica('server vuoto: la copia non viene sovrascritta dai valori di partenza', JSON.parse(r.salvato).t.phase === 'race');
  r = await prova('B', { fresh: false, copia: { code: 'CLIB', at: ora, t: t() }, ruolo: 'box' });
  verifica('server con timer vero: niente timerRestore', !r.em.includes('timerRestore'));
  verifica('server con timer vero: la copia si aggiorna (fase partenza dal server)', JSON.parse(r.salvato).t.phase === 'start');
  r = await prova('C', { fresh: true, copia: { code: 'CLIC', at: ora, t: t({ phase: 'start', startRunning: false, raceRunning: false }) }, ruolo: 'box' });
  verifica('copia ferma (nulla in corso): non si rimanda', !r.em.includes('timerRestore'));
  r = await prova('D', { fresh: true, copia: { code: 'ALTRO', at: ora, t: t() }, ruolo: 'box' });
  verifica('copia di un\'altra stanza: non si rimanda', !r.em.includes('timerRestore'));
  r = await prova('E', { fresh: true, copia: { code: 'CLIE', at: ora, t: t() }, ruolo: 'auto' });
  verifica('l\'auto non rimanda il timer', !r.em.includes('timerRestore'));
  await b.close(); srv.close(); console.log(male ? 'FALLITE ' + male : 'Tutto bene'); process.exit(male ? 1 : 0);
})();
