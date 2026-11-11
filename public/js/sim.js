// Simulatore auto: usa Pista (pista.js). Fasi: attesa o lancio (auto che gira con ritmo regolabile) -> gara (percorso pianificato).
// Uscita della posizione: all'app auto aperta nello stesso browser (/?sim=1, via BroadcastChannel) oppure direttamente al server.
// Timing finto: se il server ha SIM_PONTE=1 la corsa va al finto ponte (src/simponte.js).
(function () {
  const $ = (id) => document.getElementById(id);
  let gps = null, pista = null, corsa = null, guida = null, rumF = null, rumC = null, socket = null, timer = null;
  let tr0 = 0, salto = 0, trUlt = 0, fase = 'fermo', zeroS = 0, modoLancio = false, raceT0 = 0, ultVerita = 0, partito = false, nCross = 0;
  let avvisato = false, rall = [], pau = [], sink = 'app', canale = null, codiceOra = '';

  function scrivi(s) { const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; }
  function fmt(s) { const sg = s < 0 ? '-' : ''; s = Math.abs(s); const m = Math.floor(s / 60); return sg + m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  function leggiPiano() {
    const out = []; zeroS = 0; modoLancio = false; rall = []; pau = [];
    $('piano').value.split('\n').map((r) => r.trim()).filter(Boolean).forEach((r) => {
      const p = r.split(/\s+/);
      if (p[0] === 'attesa' || p[0] === 'lancio') {   // attesa N = auto ferma; lancio N = auto che gira (ritmo con la barra) fino allo zero
        zeroS = Math.max(0, Math.min(3600, parseFloat(p[1]) || 0)); modoLancio = p[0] === 'lancio'; return;
      }
      if (p[0] === 'sc') {            // safety car: sc <dal giro> <per quanti giri> [velocita' %]
        const da = parseInt(p[1], 10), gg = parseInt(p[2], 10), pc = parseFloat(p[3]) || 55;
        if (!(da >= 1 && gg >= 1 && pc >= 20 && pc <= 95)) throw new Error('Riga "' + r + '": sc dal-giro quanti-giri [velocità %]');
        rall.push({ daGiro: da, giri: gg, fattore: pc / 100 }); return;
      }
      if (p[0] === 'pausa') {         // bandiera rossa: pausa <dopo quanti giri> <secondi>
        const gi = parseInt(p[1], 10), se = parseFloat(p[2]);
        if (!(gi >= 1 && se >= 10 && se <= 1800)) throw new Error('Riga "' + r + '": pausa dopo-giri secondi (10-1800)');
        pau.push({ giro: gi, durataS: se }); return;
      }
      const giri = parseInt(p[0], 10);
      if (!(giri >= 1 && giri <= 50)) throw new Error('Riga non valida: "' + r + '" (inizia con il numero di giri)');
      const st = { giri };
      if (p[1]) {
        if (!['rifornimento', 'box', 'corsia'].includes(p[1])) throw new Error('Riga "' + r + '": dopo i giri scrivi rifornimento, box o corsia');
        st.pit = { dove: p[1], sostaS: Math.max(1, parseFloat(p[2]) || 30) };
      }
      out.push(st);
    });
    if (!out.length) throw new Error('Scenario vuoto');
    return out;
  }

  function caricaCircuito(g, nome) {
    const mancano = ['tracciato', 'corsia'].filter((k) => !g[k] || g[k].length < 2);
    if (mancano.length) { $('circ').innerHTML = '<b>Manca: ' + mancano.join(', ') + '</b> (disegna il tracciato e registra la corsia nella mappa del box).'; return; }
    gps = g; pista = Pista.costruisci(g);
    $('circ').innerHTML = '<small>' + (nome || 'circuito') + ': giro di ' + Math.round(pista.perimetro) + ' m, limite corsia ' + (g.limiteKmh || 60) + ' km/h, corsia ' + Math.round(pista.corsia.length * 2) + ' m</small>';
    disegna(null);
  }

  $('esempio').onclick = () => caricaCircuito(Pista.esempio(), 'esempio');
  $('file').onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const d = JSON.parse(r.result); if (d.tipo !== 'pitcomm-circuito' || !d.gps) throw new Error('non e’ un circuito di PitComm'); caricaCircuito(d.gps, f.name); } catch (e) { $('circ').textContent = 'File non valido: ' + e.message; } };
    r.readAsText(f);
  };
  $('ritmo').oninput = () => { $('ritmoVal').textContent = Math.round($('ritmo').value * 100) + '%'; };

  function disegna(auto) {
    const cv = $('mappa'), c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
    if (!pista) return;
    const xs = pista.T.map((p) => p.x), ys = pista.T.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((cv.width - 40) / (x1 - x0 || 1), (cv.height - 40) / (y1 - y0 || 1));
    const X = (p) => 20 + (p.x - x0) * k, Y = (p) => cv.height - 20 - (p.y - y0) * k;
    c.lineWidth = 3; c.strokeStyle = '#3d4d63'; c.beginPath(); pista.T.forEach((p, i) => (i ? c.lineTo(X(p), Y(p)) : c.moveTo(X(p), Y(p)))); c.closePath(); c.stroke();
    c.lineWidth = 3; c.strokeStyle = '#d9a441'; c.beginPath(); pista.corsia.forEach((p, i) => (i ? c.lineTo(X(p), Y(p)) : c.moveTo(X(p), Y(p)))); c.stroke();
    const pt = (p, col, r) => { if (!p) return; c.fillStyle = col; c.beginPath(); c.arc(X(p), Y(p), r, 0, 7); c.fill(); };
    pt(pista.centroBox, '#5aa9ff', 5); pt(pista.centroRif, '#4ed07a', 5);
    if (auto) pt(auto, '#ff5b5b', 7);
  }

  function base() { return $('srv').value.trim().replace(/\/+$/, ''); }
  function posta(percorso, corpo) {
    return fetch(base() + percorso, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then((r) => r.json());
  }
  const tGaraOra = (tr) => tr - zeroS;     // tempo dal via (negativo nel lancio): lo zero e' alla fine del lancio

  // Timing finto: all'inizio la griglia (nessun giro); al via la corsa vera, con i passaggi spostati del ritardo di partenza.
  function inviaTiming(tr, conCorsa) {
    if (!$('timing').checked) return Promise.resolve();
    const ritardo = conCorsa ? raceT0 - zeroS : 0, d = (x) => x + ritardo;
    const corpo = {
      evento: codiceOra, numero: $('numero').value.trim() || '77', giroS: parseFloat($('giro').value) || 100,
      passaggi: conCorsa ? corsa.passaggi.map(d) : [], finestre: conCorsa ? corsa.finestre.map((w) => ({ da: d(w.da), a: d(w.a), fattore: w.fattore })) : [],
      pause: conCorsa ? corsa.pauseT.map((q) => ({ da: d(q.da), durata: q.durata })) : [], tGara: tGaraOra(tr), seme: parseInt($('seme').value, 10) || 1, nAuto: 14,
    };
    return posta('/sim/ponte/avvia', corpo).then((j) => {
      if (j && j.ok) { if (!avvisato) { avvisato = true; scrivi('Timing finto acceso: ' + j.auto + ' auto, nostro n. ' + corpo.numero + '. Nel box: Distacchi → Nostro → https://pitcomm.sim/' + codiceOra + ' e numero ' + corpo.numero); } }
      else scrivi('Timing finto NON acceso: ' + ((j && j.error) || 'risposta non valida') + (j && j.error ? '' : ' (sul server serve SIM_PONTE=1)'));
    }).catch(() => scrivi('Timing finto NON acceso: server non raggiungibile'));
  }

  function ferma(msg) {
    if (timer) clearInterval(timer); timer = null; fase = 'fermo';
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    if (canale) { try { canale.close(); } catch (e) {} canale = null; }
    $('stato').textContent = msg || 'fermo';
  }
  $('stop').onclick = () => ferma('fermato');

  $('via').onclick = () => {
    if (!pista) { $('stato').textContent = 'Scegli prima un circuito'; return; }
    let piano; try { piano = leggiPiano(); } catch (e) { $('stato').textContent = e.message; return; }
    ferma();
    const off = { dx: parseFloat($('dx').value) || 0, dy: parseFloat($('dy').value) || 0 };
    const giroS = parseFloat($('giro').value) || 0;
    const opz = giroS > 0 ? Pista.calibra(pista, giroS) : {};
    corsa = Pista.pianifica(pista, piano, Object.assign({}, opz, { offset: off, rallentamenti: rall, pause: pau }));
    guida = modoLancio ? Pista.guida(pista, opz, off) : null;
    const seme = parseInt($('seme').value, 10) || 1;
    rumF = $('rumore').checked ? Pista.rumorePunto(pista, { seme }) : null;
    rumC = $('rumore').checked ? Pista.rumore(corsa, { seme }) : null;
    sink = $('uscita').value; codiceOra = $('codice').value.trim().toUpperCase();
    avvisato = false; salto = 0; trUlt = 0; raceT0 = 0; ultVerita = 0; partito = false; nCross = 0;
    fase = zeroS > 0 ? (modoLancio ? 'lancio' : 'attesa') : 'gara';
    $('log').textContent = '';
    scrivi('Scenario: ' + (zeroS ? (modoLancio ? 'lancio ' : 'attesa ') + fmt(zeroS) + ' + ' : '') + 'gara ' + fmt(corsa.durata) + ' (totale ' + fmt(zeroS + corsa.durata) + '), ' + corsa.verita.filter((e) => e.tipo === 'sosta').length + ' soste' + (giroS > 0 ? ', giro ' + giroS + ' s' : ''));
    const partiPoi = () => {
      tr0 = Date.now(); timer = setInterval(tick, 1000); tick();
      if (fase !== 'gara') inviaTiming(0, false);      // griglia prima del via; se si parte subito c'e' solo la corsa (nel primo tick)
    };
    if (sink === 'app') {
      canale = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pitcomm-sim-gps') : null;
      scrivi(canale ? 'Posizione verso l’app auto (aprila con ?sim=1, stesso browser, GPS acceso sul box).' : 'Questo browser non ha BroadcastChannel: scegli "direttamente al server".');
      partiPoi();
    } else {
      const url = base();
      socket = url ? io(url) : io();
      socket.on('connect', () => socket.emit('join', { code: codiceOra, role: 'auto' }, (res) => {
        if (!res || !res.ok) { scrivi('Entrata rifiutata: ' + (res && res.error)); ferma('errore'); return; }
        scrivi('Auto entrata nella squadra ' + codiceOra + (res.state && res.state.gps && res.state.gps.on ? '' : ' (GPS spento sul box: il server scarta le posizioni)'));
        if (!timer) partiPoi();
      }));
      socket.on('connect_error', (e) => scrivi('Errore di collegamento: ' + (e && e.message)));
    }
  };

  function emetti(q) {
    if (!q) return;
    if (sink === 'app') { if (canale) canale.postMessage({ lat: q.lat, lng: q.lng, acc: q.acc, v: q.v }); }
    else if (socket && socket.connected) socket.emit('gpsPos', { lat: q.lat, lng: q.lng, acc: q.acc, v: q.v });
  }

  function tick() {
    const tr = (Date.now() - tr0) / 1000 + salto;
    let w = null, t = 0;
    if (fase === 'attesa') {
      w = corsa.vero(0);
      if (tr >= zeroS) { fase = 'gara'; raceT0 = tr; }
    } else if (fase === 'lancio') {
      const ritmo = parseFloat($('ritmo').value) || 1;
      guida.passo(Math.max(0, tr - trUlt), ritmo);
      w = guida.stato();
      while (nCross < guida.passaggi.length) {          // passaggi sulla linea nel lancio
        const tc = guida.passaggi[nCross++];
        const dopo = tc - zeroS;
        scrivi(fmt(tc - zeroS) + ' VERO: passaggio sul traguardo (' + (dopo >= 0 ? '+' : '') + dopo.toFixed(1) + ' s dallo zero)' + (dopo < 0 ? ' · giro perso se in gara' : ''));
        if (dopo >= 0 && fase === 'lancio') { fase = 'gara'; raceT0 = tc; }
      }
    }
    trUlt = tr;
    if (fase === 'gara') {
      t = tr - raceT0;
      if (!partito) { partito = true; scrivi('00:00 VERO: partenza gara (primo passaggio dopo lo zero: ' + fmt(raceT0 - zeroS) + ' dal via)'); inviaTiming(tr, true); }
      if (t > corsa.durata + 20) { ferma('finito'); scrivi('Fine scenario'); return; }
      w = corsa.vero(Math.max(0, t));
      corsa.verita.forEach((e, i) => { if (i >= ultVerita && e.t <= t) { ultVerita = i + 1; scrivi(fmt(e.t) + ' VERO: ' + e.tipo + (e.dove ? ' ' + e.dove : '') + (e.durataS ? ' ' + e.durataS + ' s' : '')); } });
    }
    const q = rumF ? (fase === 'gara' ? rumC(Math.max(0, t)) : rumF(w, tr)) : { lat: w.lat, lng: w.lng, acc: 3, v: w.v };
    emetti(q);
    const ver = fase === 'gara' ? 'gara ' + fmt(t) : (fase === 'lancio' ? 'lancio, zero tra ' + fmt(zeroS - tr) : 'attesa, zero tra ' + fmt(zeroS - tr));
    $('stato').textContent = ver + ' · ' + Math.round(w.v * 3.6) + ' km/h' + (q ? '' : ' · punto perso');
    disegna(pista.pr.xy(w));
  }

  $('salta').onclick = () => {
    if (!timer || !corsa) return;
    const tr = (Date.now() - tr0) / 1000 + salto;
    if (fase === 'gara') {
      const t = tr - raceT0;
      const prossimo = corsa.verita.find((e) => e.tipo === 'entrataLimite' && e.t - 60 > t);
      if (!prossimo) { scrivi('(nessun altro pit da raggiungere)'); return; }
      salto += (prossimo.t - 60) - t; scrivi('(salto al prossimo pit: ' + fmt(prossimo.t - 60) + ')');
      if ($('timing').checked) posta('/sim/ponte/salta', { evento: codiceOra, tGara: tGaraOra(tr + (prossimo.t - 60) - t) }).catch(() => {});
    } else if (zeroS - tr > 25) {
      salto += zeroS - 25 - tr; scrivi('(salto: mancano 25 s allo zero)');
      if ($('timing').checked) posta('/sim/ponte/salta', { evento: codiceOra, tGara: tGaraOra(tr + zeroS - 25 - tr) }).catch(() => {});
    }
  };
})();
