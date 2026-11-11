// Simulatore auto: usa Pista (pista.js) e manda 'gpsPos' al server come farebbe il telefono dell'auto.
// Nessun dato falso entra nel resto dell'app: il box vede una normale auto con il GPS.
(function () {
  const $ = (id) => document.getElementById(id);
  let gps = null, pista = null, corsa = null, rum = null, socket = null, timer = null, t0 = 0, ultVerita = 0, attesa = 0, salto = 0, partito = false;

  function scrivi(s) { const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; }
  function fmt(s) { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  function leggiPiano() {
    const out = []; attesa = 0;
    $('piano').value.split('\n').map((r) => r.trim()).filter(Boolean).forEach((r) => {
      const p = r.split(/\s+/);
      if (p[0] === 'attesa') { attesa = Math.max(0, Math.min(3600, parseFloat(p[1]) || 0)); return; }
      const giri = parseInt(p[0], 10);
      if (!(giri >= 1 && giri <= 50)) throw new Error('Riga non valida: "' + r + '" (inizia con il numero di giri)');
      const st = { giri };
      if (p[1]) {
        if (p[1] !== 'rifornimento' && p[1] !== 'box') throw new Error('Riga "' + r + '": dopo i giri scrivi rifornimento o box');
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

  function ferma(msg) {
    if (timer) clearInterval(timer); timer = null;
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    $('stato').textContent = msg || 'fermo';
  }

  $('salta').onclick = () => {
    if (!corsa || !timer) return;
    const t = (Date.now() - t0) / 1000 + salto - attesa;
    if (t < -1) { salto += -t; scrivi('(salto: fine del lancio)'); return; }
    const prossimo = corsa.verita.find((e) => e.tipo === 'entrataLimite' && e.t - 60 > t);
    if (!prossimo) { scrivi('(nessun altro pit da raggiungere)'); return; }
    salto += (prossimo.t - 60) - t; scrivi('(salto al prossimo pit: ' + fmt(prossimo.t - 60) + ')');
  };
  $('stop').onclick = () => ferma('fermato');
  $('via').onclick = () => {
    if (!pista) { $('stato').textContent = 'Scegli prima un circuito'; return; }
    let piano; try { piano = leggiPiano(); } catch (e) { $('stato').textContent = e.message; return; }
    ferma();
    const off = { dx: parseFloat($('dx').value) || 0, dy: parseFloat($('dy').value) || 0 };
    const giroS = parseFloat($('giro').value) || 0;
    const opz = giroS > 0 ? Pista.calibra(pista, giroS) : {};
    corsa = Pista.pianifica(pista, piano, Object.assign(opz, { offset: off }));
    salto = 0; partito = false;
    rum = $('rumore').checked ? Pista.rumore(corsa, { seme: parseInt($('seme').value, 10) || 1 }) : null;
    $('log').textContent = '';
    scrivi('Scenario: lancio ' + fmt(attesa) + ' + gara ' + fmt(corsa.durata) + ' (totale ' + fmt(attesa + corsa.durata) + '), ' + corsa.verita.filter((e) => e.tipo === 'sosta').length + ' soste' + (giroS > 0 ? ', giro ' + giroS + ' s' : ''));
    const code = $('codice').value.trim().toUpperCase();
    const url = $('srv').value.trim();
    socket = url ? io(url) : io();
    socket.on('connect', () => socket.emit('join', { code, role: 'auto' }, (res) => {
      if (!res || !res.ok) { scrivi('Entrata rifiutata: ' + (res && res.error)); ferma('errore'); return; }
      scrivi('Auto entrata nella squadra ' + code + (res.state && res.state.gps && res.state.gps.on ? '' : ' (GPS spento sul box: il server scarta le posizioni)'));
      t0 = Date.now(); ultVerita = 0; timer = setInterval(tick, 1000); tick();
    }));
    socket.on('connect_error', (e) => scrivi('Errore di collegamento: ' + (e && e.message)));
  };

  function tick() {
    const tr = (Date.now() - t0) / 1000 + salto;      // tempo dall'avvio del simulatore
    const t = tr - attesa;                              // tempo di gara (negativo durante il lancio)
    if (!partito && t >= 0) { partito = true; scrivi('00:00 VERO: partenza gara'); }
    if (t > corsa.durata + 20) { ferma('finito'); scrivi('Fine scenario'); return; }
    const w = corsa.vero(Math.max(0, t));
    corsa.verita.forEach((e, i) => { if (i >= ultVerita && e.t <= t) { ultVerita = i + 1; scrivi(fmt(e.t) + ' VERO: ' + e.tipo + (e.dove ? ' ' + e.dove : '') + (e.durataS ? ' ' + e.durataS + ' s' : '')); } });
    const q = rum ? rum(Math.max(0, t)) : { lat: w.lat, lng: w.lng, acc: 3, v: w.v };
    if (q && socket && socket.connected) socket.emit('gpsPos', { lat: q.lat, lng: q.lng, acc: q.acc, v: q.v });
    $('stato').textContent = (t < 0 ? 'lancio -' + fmt(-t) : 'gara ' + fmt(t)) + ' · ' + Math.round(w.v * 3.6) + ' km/h' + (q ? '' : ' · punto perso');
    disegna(pista.pr.xy(w));
  }
})();
