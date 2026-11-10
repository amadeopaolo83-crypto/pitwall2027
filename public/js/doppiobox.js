// Doppio box (vedi src/doppiobox.js): se due o piu' box sono collegati uno e' PRIMARIO (comanda) e gli altri
// SECONDARI (messaggi all'auto, rifornimento, cambio pilota). Da solo un box comanda sempre. Qui: l'identita' del
// telefono, la barra "PRIMARIO / SECONDARIO" con cedi priorita' e prendi il comando, e l'avviso quando un
// secondario prova un comando riservato.

let boxPrimario = true;                       // vero se questo box comanda
let boxRuoloInfo = { attivo: false, ruolo: 'primario', n: 1, cessione: null };
let boxCessioneTick = null;
let boxPrendiTimer = null;
let boxMenuCedi = false;
let boxToastTimer = null;

// Ogni telefono ha un suo numero, cosi' un box che si ricollega e' lo stesso box.
function boxIdLocale(){
  try{
    let id = localStorage.getItem('pc_boxid');
    if(!id){ id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('pc_boxid', id); }
    return id;
  }catch(e){ return null; }
}

function applyBoxRuolo(r){
  if(!r || typeof r !== 'object') return;
  const prima = boxPrimario;
  boxRuoloInfo = r;
  boxPrimario = !r.attivo || r.ruolo === 'primario';
  document.body.classList.toggle('box-secondario', !!r.attivo && !boxPrimario);
  if(r.attivo && prima !== boxPrimario && r.n >= 2) boxToast(boxPrimario ? 'Ora comandi tu: sei PRIMARIO' : 'Ora sei SECONDARIO');
  boxMenuCedi = false;
  boxRenderBarra();
}

function boxToast(testo){
  let t = document.getElementById('boxToast');
  if(!t){ t = document.createElement('div'); t.id = 'boxToast'; t.className = 'box-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = testo; t.hidden = false;
  clearTimeout(boxToastTimer);
  boxToastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function boxNegato(){
  boxToast('Solo il box PRIMARIO puo’ farlo. Per comandare: «Prendi il comando».');
}

function boxResto(finoA){
  const s = Math.max(0, Math.round((finoA - nowSync()) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function boxEl(tag, testo, classe, onclick){
  const e = document.createElement(tag);
  if(testo != null) e.textContent = testo;
  if(classe) e.className = classe;
  if(onclick) e.addEventListener('click', onclick);
  return e;
}

function boxRenderBarra(){
  const b = document.getElementById('boxRuoloBar');
  if(!b) return;
  const r = boxRuoloInfo;
  const visibile = r.attivo && (r.n >= 2 || r.cessione);
  clearInterval(boxCessioneTick); boxCessioneTick = null;
  b.hidden = !visibile;
  b.textContent = '';
  b.className = 'box-ruolo ' + (boxPrimario ? 'primario' : 'secondario');
  if(!visibile) return;
  const riga = boxEl('div', null, 'br-riga');
  const ces = r.cessione;
  if(boxPrimario){
    riga.appendChild(boxEl('b', 'PRIMARIO'));
    if(ces && ces.perMe){
      const t = boxEl('span', null, 'br-testo'); riga.appendChild(t);
      const agg = () => { t.textContent = ' · priorita’ ceduta a te: torna all’altro box tra ' + boxResto(ces.finoA); };
      agg(); boxCessioneTick = setInterval(agg, 1000);
    } else {
      riga.appendChild(boxEl('span', ' · ' + r.n + ' box collegati', 'br-testo'));
      if(r.n >= 2) riga.appendChild(boxEl('button', 'Cedi priorità', 'btn small', () => { boxMenuCedi = !boxMenuCedi; boxRenderBarra(); }));
    }
    b.appendChild(riga);
    if(boxMenuCedi && !(ces && ces.perMe)){
      const m = boxEl('div', null, 'br-riga br-menu');
      m.appendChild(boxEl('span', 'Cedi per:', 'br-testo'));
      [15, 30, 60, 120].forEach((min) => m.appendChild(boxEl('button', min + ' min', 'btn small', () => { boxMenuCedi = false; socket.emit('boxCedi', { minuti: min }); })));
      m.appendChild(boxEl('button', 'Annulla', 'btn small', () => { boxMenuCedi = false; boxRenderBarra(); }));
      b.appendChild(m);
    }
  } else {
    riga.appendChild(boxEl('b', 'SECONDARIO'));
    if(ces && ces.daMe){
      const t = boxEl('span', null, 'br-testo'); riga.appendChild(t);
      const agg = () => { t.textContent = ' · hai ceduto la priorità: torna a te tra ' + boxResto(ces.finoA); };
      agg(); boxCessioneTick = setInterval(agg, 1000);
      riga.appendChild(boxEl('button', 'Riprendi', 'btn small primary', () => socket.emit('boxRiprendi')));
    } else {
      riga.appendChild(boxEl('span', ' · messaggi, rifornimento e cambio pilota', 'br-testo'));
      const bt = boxEl('button', 'Prendi il comando', 'btn small', () => boxPrendi(bt));
      riga.appendChild(bt);
    }
    b.appendChild(riga);
  }
}

// Doppio tocco (entro 2 s): un tocco sbagliato non deve togliere il comando all'altro box.
function boxPrendi(btn){
  if(boxPrendiTimer){
    clearTimeout(boxPrendiTimer); boxPrendiTimer = null;
    socket.emit('boxPrendi');
    return;
  }
  const testo = btn.textContent;
  btn.textContent = 'Tocca ancora';
  boxPrendiTimer = setTimeout(() => { boxPrendiTimer = null; btn.textContent = testo; }, 2000);
}
