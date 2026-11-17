// Box: scheda "Piste" in Impostazioni (finto socket): elenco, doppio tocco, salva/carica/nuova/elimina, copia sul telefono,
// ripristino dopo un riavvio del server. Esce con 1 se un controllo fallisce.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const C = require('./comune');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(C.ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(8798, async () => {
  const V = C.controlli('piste1');
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  // il finto socket risponde alle richieste con RISP[evento]
  await pg.route('**/socket.io/socket.io.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RISP={};window.io=()=>({on(){},off(){},emit(n,d,cb){(window.__em=window.__em||[]).push([n,d]);const f=typeof d==="function"?d:cb;if(typeof f==="function"&&window.RISP[n])f(window.RISP[n]);},connected:true,onAny(){}});window.confirm=()=>true;window.alert=()=>{};window.prompt=()=>"";' }));
  await pg.route(/fonts\.(googleapis|gstatic)|cdn\.socket\.io/, (r) => r.abort());
  await pg.goto('http://localhost:8798/');
  await pg.evaluate(() => { role = 'box'; code = 'PISTA'; socket = io(); boxPrimario = true; document.querySelectorAll('body > div').forEach((d) => { d.hidden = d.id !== 'boxView'; }); enterBoxView(); setBoxTab('settings'); });
  const em = () => pg.evaluate(() => (window.__em || []).slice());
  const svuota = () => pg.evaluate(() => { window.__em = []; });

  // scheda presente in Impostazioni, prima del GPS
  const pos = await pg.evaluate(() => { const c = [...document.querySelectorAll('#boxTab_settings > .card')].map((x) => x.id || (x.querySelector('h3') || {}).textContent); return { c, i: c.indexOf('pisteCard'), g: c.indexOf('gpsCard') }; });
  V.ok('scheda Piste in Impostazioni, sopra "GPS e automatismi"', pos.i >= 0 && pos.g > pos.i, pos);

  // elenco dal server
  await pg.evaluate(() => { window.RISP.pisteChiedi = { lib: { 'Magny Cours': { at: 2, dati: { box: { lat: 46, lng: 7 } } } }, attiva: 'Magny Cours' }; pisteApplica([{ nome: 'Magny Cours', at: 2, el: 5 }, { nome: 'Monza', at: 1, el: 1 }], 'Magny Cours'); });
  const el = await pg.evaluate(() => ({ opz: [...document.querySelectorAll('#pisteSel option')].map((o) => o.textContent), att: document.getElementById('pisteAttiva').textContent, copia: JSON.parse(localStorage.getItem('pc_piste') || 'null') }));
  V.ok('menu con le piste e quanti elementi hanno', el.opz.length === 2 && /Magny Cours · 5 elementi/.test(el.opz[0]) && /Monza · 1 elemento$/.test(el.opz[1]), el.opz);
  V.ok('scritta "Pista caricata: Magny Cours"', /Magny Cours/.test(el.att), el.att);
  V.ok('copia sul telefono con i dati veri', el.copia && el.copia.code === 'PISTA' && el.copia.lib['Magny Cours'] && el.copia.lib['Magny Cours'].dati.box.lat === 46, el.copia);

  // carica: serve il secondo tocco
  await pg.evaluate(() => { document.getElementById('pisteSel').value = 'Monza'; });
  await svuota();
  const caricaBtn = '#pisteCard button:has-text("Carica questa pista")';
  await pg.click(caricaBtn);
  V.ok('carica: al primo tocco non parte niente e chiede conferma', (await em()).filter((e) => e[0] === 'pistaCarica').length === 0 && /Carico "Monza"\?/.test(await pg.textContent('#pisteCard .gps-griglia button.primary')));
  await pg.evaluate(() => { window.RISP.pistaCarica = { ok: true, nome: 'Monza' }; });
  await pg.click('#pisteCard .gps-griglia button.primary');
  const e2 = (await em()).filter((e) => e[0] === 'pistaCarica');
  V.ok('carica: al secondo tocco manda pistaCarica con il nome', e2.length === 1 && e2[0][1].nome === 'Monza', e2);
  V.ok('carica: il tasto torna normale e il messaggio lo dice', /Carica questa pista/.test(await pg.textContent('#pisteCard .gps-griglia button.primary')) && /Caricata: Monza/.test(await pg.textContent('#pisteMsg')));

  // la conferma scade se non si tocca di nuovo
  await pg.evaluate(() => { document.querySelector('#pisteCard .gps-griglia button.primary').click(); });
  await pg.waitForTimeout(4200);
  V.ok('conferma scaduta: il tasto torna normale', /Carica questa pista/.test(await pg.textContent('#pisteCard .gps-griglia button.primary')));

  // salva: nome obbligatorio; nome nuovo senza conferma; nome esistente con conferma
  await svuota();
  await pg.evaluate(() => { window.RISP.pistaSalva = { ok: true, nome: 'Spa', nuova: true }; document.getElementById('pisteNome').value = ''; document.getElementById('pisteAttiva').textContent; });
  await pg.evaluate(() => { pistaAttiva = null; });
  await pg.click('#pisteCard button:has-text("Salva la pista attuale")');
  V.ok('salva senza nome: chiede un nome e non manda niente', /Scrivi un nome/.test(await pg.textContent('#pisteMsg')) && (await em()).filter((e) => e[0] === 'pistaSalva').length === 0);
  await pg.fill('#pisteNome', 'Spa');
  await pg.click('#pisteCard button:has-text("Salva la pista attuale")');
  const s1 = (await em()).filter((e) => e[0] === 'pistaSalva');
  V.ok('salva con nome nuovo: parte subito', s1.length === 1 && s1[0][1].nome === 'Spa' && /Pista salvata: Spa/.test(await pg.textContent('#pisteMsg')), s1);
  V.ok('salva: il campo nome si svuota', (await pg.inputValue('#pisteNome')) === '');
  await svuota();
  await pg.fill('#pisteNome', 'Monza');
  await pg.click('#pisteCard button:has-text("Salva la pista attuale")');
  V.ok('salva su nome esistente: chiede conferma prima di sovrascrivere', (await em()).filter((e) => e[0] === 'pistaSalva').length === 0);
  await pg.evaluate(() => { window.RISP.pistaSalva = { ok: true, nome: 'Monza', nuova: false }; });
  await pg.click('#pisteCard button:has-text("Sovrascrivo")');
  const s2 = (await em()).filter((e) => e[0] === 'pistaSalva');
  V.ok('salva su nome esistente: al secondo tocco parte', s2.length === 1 && s2[0][1].nome === 'Monza' && /aggiornata: Monza/.test(await pg.textContent('#pisteMsg')), s2);
  await pg.evaluate(() => { window.RISP.pistaSalva = { ok: false, error: 'vuota' }; });
  await pg.fill('#pisteNome', 'Niente');
  await pg.click('#pisteCard button:has-text("Salva la pista attuale")');
  V.ok('salva con GPS vuoto: spiega perche\' non salva', /Niente da salvare/.test(await pg.textContent('#pisteMsg')));

  // nuova pista e elimina (doppio tocco)
  await svuota();
  await pg.click('#pisteCard button:has-text("Nuova pista")');
  V.ok('nuova: al primo tocco non parte', (await em()).filter((e) => e[0] === 'pistaNuova').length === 0);
  await pg.evaluate(() => { window.RISP.pistaNuova = { ok: true }; });
  await pg.click('#pisteCard button:has-text("Parto da zero")');
  V.ok('nuova: al secondo tocco parte e avvisa della copia automatica', (await em()).filter((e) => e[0] === 'pistaNuova').length === 1 && /copia automatica/.test(await pg.textContent('#pisteMsg')));
  await pg.evaluate(() => { document.getElementById('pisteSel').value = 'Monza'; window.RISP.pistaElimina = { ok: true }; });
  await pg.click('#pisteCard button:has-text("Elimina questa pista")');
  V.ok('elimina: al primo tocco non parte', (await em()).filter((e) => e[0] === 'pistaElimina').length === 0);
  await pg.click('#pisteCard button:has-text("Elimino")');
  const d = (await em()).filter((e) => e[0] === 'pistaElimina');
  V.ok('elimina: al secondo tocco parte con il nome', d.length === 1 && d[0][1].nome === 'Monza', d);

  // aggiornamento dal server (pisteUpdate) e libreria vuota
  await pg.evaluate(() => pisteApplica([], null));
  const vuota = await pg.evaluate(() => ({ o: [...document.querySelectorAll('#pisteSel option')].map((x) => x.textContent), a: document.getElementById('pisteAttiva').textContent }));
  V.ok('libreria vuota: lo dice e nessuna pista caricata', vuota.o.length === 1 && /nessuna pista salvata/.test(vuota.o[0]) && /nessuna/.test(vuota.a), vuota);
  const senzaSel = await pg.evaluate(() => { document.getElementById('pisteSel').value = ''; return 1; });
  await svuota(); await pg.click(caricaBtn);
  V.ok('carica senza scelta: "Scegli una pista", niente parte', /Scegli una pista/.test(await pg.textContent('#pisteMsg')) && (await em()).length === 0);

  // ripristino dopo riavvio del server: solo se fresh.piste e copia dello stesso codice
  await pg.evaluate(() => { window.RISP.pisteChiedi = { lib: {}, attiva: null }; save('pc_piste', { code: 'PISTA', lib: { 'Magny Cours': { at: 2, dati: { box: { lat: 46, lng: 7 } } } } }); });
  await svuota();
  const r1 = await pg.evaluate(() => pisteRipristinaSeServerVuoto({ piste: [], pistaAttiva: null, fresh: { piste: true } }));
  const rip = (await em()).filter((e) => e[0] === 'pisteRipristino');
  V.ok('server ripartito (e vuoto): il box rimanda la sua libreria', r1 === true && rip.length === 1 && rip[0][1].lib['Magny Cours'], rip);
  V.ok('server ripartito: la copia del telefono non viene svuotata da quella vuota del server', await pg.evaluate(() => !!(load('pc_piste', null).lib['Magny Cours'])));
  await svuota();
  const r2 = await pg.evaluate(() => pisteRipristinaSeServerVuoto({ piste: [{ nome: 'Magny Cours', at: 2, el: 1 }], pistaAttiva: null, fresh: { piste: false } }));
  V.ok('server con le sue piste: non rimanda niente', r2 === false && (await em()).filter((e) => e[0] === 'pisteRipristino').length === 0);
  await pg.evaluate(() => { save('pc_piste', { code: 'ALTRA', lib: { X: { at: 1, dati: { box: { lat: 1, lng: 1 } } } } }); });
  await svuota();
  const r3 = await pg.evaluate(() => pisteRipristinaSeServerVuoto({ piste: [], fresh: { piste: true } }));
  V.ok('copia di un\'altra squadra: non si usa', r3 === false && (await em()).filter((e) => e[0] === 'pisteRipristino').length === 0, [r3, await em()]);

  // l'auto non vede la scheda e non fa chiamate
  V.ok('nessun errore nella pagina', C.erroriVeri(errs).length === 0, errs);
  await b.close(); srv.close(); V.fine();
});
