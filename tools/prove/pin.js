const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/pitwall2027/public';
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8779, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__join=[];window.io=()=>{const h={};return {connected:true,disconnect(){},on(ev,cb){ if(ev==='connect') setTimeout(cb,5); },off(){},onAny(){},
    emit(ev,d,cb){ if(ev==='join'){ window.__join.push(d); if(d.pin!=='4821') return cb({ok:false,error:'pin'}); return cb({ok:true,state:window.__stato,serverNow:Date.now()}); } if(ev==='ora'&&typeof d==='function') d(Date.now()); } }};` }));
  await pg.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await pg.goto('http://localhost:8779/');
  const R = {};
  R.campoNascosto = await pg.evaluate(() => document.getElementById('boxPin').hidden);
  await pg.fill('#teamCode', 'FLATSIX');
  await pg.evaluate(() => joinAs('box')); await pg.waitForTimeout(200);
  R.dopoRifiuto = await pg.evaluate(() => ({ campoVisibile: !document.getElementById('boxPin').hidden, msg: document.getElementById('landingStatus').textContent, btn: !document.getElementById('btnBox').disabled }));
  await pg.screenshot({ path: '/tmp/demo/pin.png' });
  await pg.fill('#boxPin', '4821');
  R.inviato = await pg.evaluate(() => { joinAs('box'); return null; });
  await pg.waitForTimeout(200);
  R.joinInviati = await pg.evaluate(() => window.__join.map((j) => j.role + ':' + (j.pin || '-')));
  R.pinSalvato = await pg.evaluate(() => localStorage.getItem('pc_pin'));
  R.autoSenzaPin = await pg.evaluate(() => { window.__join.length = 0; joinAs('auto'); return null; });
  await pg.waitForTimeout(100);
  R.autoJoin = await pg.evaluate(() => window.__join.map((j) => j.role + ':' + (j.pin || '-')));
  console.log(JSON.stringify(R), errs);
  await b.close(); srv.close();
});
