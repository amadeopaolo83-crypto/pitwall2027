// Libreria delle piste (solo box): si salva la pista attuale con un nome e la si ricarica tra una gara e l'altra.
// I dati veri stanno sul server (e nel suo archivio, se c'e'); il box tiene anche una copia sul telefono (`pc_piste`)
// e, se il server riparte senza archivio, gliela rimanda (flag `fresh.piste`).
// Ogni azione che toglie qualcosa chiede un secondo tocco; la pista attuale prima di essere sostituita si copia
// da sola in "(copia automatica)" (lo fa il server).

let pisteElenco = [];      // [{ nome, at, el }] piu' recenti prima
let pistaAttiva = null;    // nome dell'ultima pista caricata o salvata
const pisteConferma = {};  // azione -> true se il primo tocco e' gia' stato fatto

function pisteMsg(t){ const e = $('pisteMsg'); if(e) e.textContent = t || ''; }

function pisteApplica(elenco, attiva){
  pisteElenco = Array.isArray(elenco) ? elenco : [];
  pistaAttiva = typeof attiva === 'string' ? attiva : null;
  pisteRender();
  pisteAggiornaCopia();
}

function pisteRender(){
  if(role !== 'box') return;
  const sel = $('pisteSel');
  if(sel){
    const prima = sel.value;
    sel.innerHTML = '';
    if(!pisteElenco.length){ const o = document.createElement('option'); o.value = ''; o.textContent = '(nessuna pista salvata)'; sel.appendChild(o); }
    pisteElenco.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.nome;
      o.textContent = p.nome + ' · ' + p.el + (p.el === 1 ? ' elemento' : ' elementi');
      sel.appendChild(o);
    });
    if(prima && pisteElenco.some((p) => p.nome === prima)) sel.value = prima;
    else if(pistaAttiva && pisteElenco.some((p) => p.nome === pistaAttiva)) sel.value = pistaAttiva;
  }
  const a = $('pisteAttiva');
  if(a) a.textContent = 'Pista caricata: ' + (pistaAttiva || 'nessuna');
  const n = $('pisteNome');
  if(n && document.activeElement !== n && !n.value && pistaAttiva) n.placeholder = pistaAttiva;
}

// Doppio tocco: il primo cambia la scritta del tasto, il secondo esegue. Ritorna true al secondo tocco.
function pisteDoppioTocco(chiave, btn, scritta){
  if(pisteConferma[chiave]){ pisteConferma[chiave] = false; if(btn && btn.dataset.testo) btn.textContent = btn.dataset.testo; return true; }
  pisteConferma[chiave] = true;
  if(btn){
    if(!btn.dataset.testo) btn.dataset.testo = btn.textContent;
    btn.textContent = scritta;
    setTimeout(() => { pisteConferma[chiave] = false; if(btn.dataset.testo) btn.textContent = btn.dataset.testo; }, 4000);
  }
  return false;
}

function pisteEmetti(evento, dati, dopo){
  if(!socket || !socket.connected){ pisteMsg('Non collegato al server.'); return; }
  socket.emit(evento, dati, (r) => { if(typeof dopo === 'function') dopo(r || {}); });
}

function pisteSalva(btn){
  const campo = $('pisteNome');
  const nome = ((campo && campo.value) || pistaAttiva || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if(!nome){ pisteMsg('Scrivi un nome per la pista.'); return; }
  const esiste = pisteElenco.some((p) => p.nome === nome);
  if(esiste && !pisteDoppioTocco('salva', btn, 'Sovrascrivo "' + nome.slice(0, 14) + '"?')) return;
  pisteEmetti('pistaSalva', { nome }, (r) => {
    if(r.ok){ pisteMsg((r.nuova ? 'Pista salvata: ' : 'Pista aggiornata: ') + r.nome + '.'); if(campo) campo.value = ''; }
    else pisteMsg(r.error === 'vuota' ? 'Niente da salvare: disegna prima almeno una zona, la corsia o il traguardo.'
      : r.error === 'piene' ? 'Libreria piena (20 piste): elimina una pista.'
      : r.error === 'nome' ? 'Nome non valido.' : 'Non salvata (solo il box puo’).');
  });
}

function pisteCarica(btn){
  const nome = ($('pisteSel') || {}).value;
  if(!nome){ pisteMsg('Scegli una pista.'); return; }
  if(!pisteDoppioTocco('carica', btn, 'Carico "' + nome.slice(0, 14) + '"?')) return;
  pisteEmetti('pistaCarica', { nome }, (r) => {
    pisteMsg(r.ok ? 'Caricata: ' + r.nome + '. Controlla sulla mappa; la precedente e’ in "(copia automatica)".' : 'Pista non trovata.');
  });
}

function pisteNuova(btn){
  if(!pisteDoppioTocco('nuova', btn, 'Parto da zero?')) return;
  pisteEmetti('pistaNuova', {}, (r) => {
    pisteMsg(r.ok ? 'Pista vuota. La precedente e’ in "(copia automatica)". Disegna box, rifornimento, corsia e traguardo.' : 'Non eseguito.');
  });
}

function pisteElimina(btn){
  const nome = ($('pisteSel') || {}).value;
  if(!nome){ pisteMsg('Scegli una pista.'); return; }
  if(!pisteDoppioTocco('elimina', btn, 'Elimino "' + nome.slice(0, 14) + '"?')) return;
  pisteEmetti('pistaElimina', { nome }, (r) => { pisteMsg(r.ok ? 'Eliminata: ' + nome + '.' : 'Non eliminata.'); });
}

// ---------- copia sul telefono del box ----------

function pisteAggiornaCopia(){
  if(role !== 'box' || !socket || !socket.connected) return;
  socket.emit('pisteChiedi', (r) => {
    if(!r || !r.lib) return;
    try{ save('pc_piste', { code, lib: r.lib }); }catch(e){}
  });
}

// Chiamata a ogni join: se il server e' ripartito senza archivio, rimanda la copia del box (una volta sola).
// La copia si legge PRIMA di aggiornarla con quella del server (che in quel caso e' vuota).
function pisteRipristinaSeServerVuoto(state){
  if(role !== 'box') return false;
  const fresh = state && state.fresh ? state.fresh : {};
  const copia = load('pc_piste', null);
  const valida = !!(fresh.piste && copia && copia.code === code && copia.lib && Object.keys(copia.lib).length);
  if(valida && socket && socket.connected){
    socket.emit('pisteRipristino', { lib: copia.lib });   // il server risponde con pisteUpdate: li' si aggiorna anche la copia
    pisteElenco = Object.keys(copia.lib).map((n) => ({ nome: n, at: (copia.lib[n] || {}).at || 0, el: 0 }));
    pistaAttiva = null; pisteRender();
    return true;
  }
  pisteApplica(state && state.piste, state && state.pistaAttiva);
  return false;
}
