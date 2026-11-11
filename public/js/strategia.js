// Strategia degli altri, letta dai soli tempi del live timing (il server la calcola in src/strategia.js e la manda a tutti).
// Qui solo la scheda del box: soste e stint dei rivali, safety / sospensione, e il momento migliore per il nostro pit.
let strategiaRis = null;

function strategiaRicevi(r){
  if(!r || typeof r !== 'object') return;
  strategiaRis = r;
  strategiaRender();
}

function strategiaTipo(t){
  return t === 'rifornimento' ? 'rifornimento' : t === 'cambio' ? 'cambio pilota?' : t === 'lungo' ? 'sosta lunga' : esc(t || '');
}
function strategiaMin(s){
  const n = Number(s); if(!isFinite(n)) return '—';
  return Math.round(n) + ' s';
}

function strategiaRender(){
  const box = $('strategiaBox');
  if(!box) return;
  const r = strategiaRis;
  if(!r || !Array.isArray(r.rivali) || !r.rivali.length){
    box.innerHTML = '<span style="color:var(--muted)">Serve il live timing (Distacchi → Nostro) e qualche giro: le soste si riconoscono dai giri lenti.</span>';
    return;
  }
  let h = '';
  if(r.sospensione) h += '<div class="strat-ban strat-red">Gara sospesa (bandiera rossa)</div>';
  else if(r.safety) h += '<div class="strat-ban strat-sc">Safety car / giri lenti per tutti: le soste adesso non si leggono</div>';

  const s = r.sugg;
  if(s && Array.isArray(s.tabella) && s.tabella.length){
    const m = s.migliore || s.tabella[0];
    h += '<div class="strat-sugg"><b>Il nostro pit</b>: si perdono circa ' + strategiaMin(s.perditaS) + (s.perditaStimata ? ' (stima: non ne abbiamo ancora fatti)' : '') +
      '.<br>Se entriamo al giro <b>' + esc(m.giro) + '</b> usciamo ' + esc(m.pos) + 'º (adesso ' + esc(s.adesso) + 'º).</div>';
    h += '<div class="strat-tab">' + s.tabella.map((t) =>
      '<span class="' + (t.giro === m.giro ? 'best' : '') + '">G' + esc(t.giro) + '<br><b>' + esc(t.pos) + 'º</b></span>').join('') + '</div>';
  }

  const n = r.nostra;
  if(n && n.soste && n.soste.length) h += '<div class="strat-riga">Noi: ' + n.soste.map((x) => 'G' + esc(x.giro) + ' ' + strategiaTipo(x.tipo)).join(' · ') + '</div>';

  const righe = r.rivali.slice().sort((a, b) => (a.pos == null ? 999 : a.pos) - (b.pos == null ? 999 : b.pos)).map((x) => {
    const ultima = x.soste && x.soste.length ? x.soste[x.soste.length - 1] : null;
    const stato = x.aiBox ? '<b class="strat-box">ai box?</b>' : '';
    return '<tr' + (x.aiBox ? ' class="ora"' : '') + '><td>' + esc(x.pos == null ? '' : x.pos) + '</td><td>#' + esc(x.numero) + '</td>' +
      '<td>' + esc(x.soste ? x.soste.length : 0) + '</td>' +
      '<td>' + (ultima ? 'G' + esc(ultima.giro) + ' ' + strategiaTipo(ultima.tipo) : '—') + '</td>' +
      '<td>' + (x.stintMedio ? esc(Math.round(x.stintMedio)) + ' g' : '—') + '</td>' +
      '<td>' + (x.prossima ? 'G' + esc(x.prossima) + (x.stimaDaGruppo ? '*' : '') : '—') + ' ' + stato + '</td></tr>';
  }).join('');
  h += '<table class="strat-t"><thead><tr><th>P</th><th>N.</th><th>Soste</th><th>Ultima</th><th>Stint</th><th>Prossima</th></tr></thead><tbody>' + righe + '</tbody></table>';
  h += '<div class="strat-nota">Dai soli tempi: una sosta si vede come giro lento. “Cambio pilota?” e’ una supposizione dalla durata. * = stima dal gruppo (non ha ancora fatto soste).</div>';
  box.innerHTML = h;
}
