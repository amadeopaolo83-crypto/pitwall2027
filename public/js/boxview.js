// Vista box: pannello di controllo. Pulsanti rapidi, messaggi a schermo intero
// e cronologia di quello che arriva dall'auto.

// Schede del box: Comm / Gara / Passo / Impostazioni / Timing. Si ricorda l'ultima aperta.
const BOX_TABS = ['comm', 'gara', 'passo', 'settings', 'timing'];
function setBoxTab(name){
  BOX_TABS.forEach(n => {
    const pane = $('boxTab_' + n), btn = $('boxTabBtn_' + n);
    if(pane) pane.hidden = n !== name;
    if(btn) btn.classList.toggle('on', n === name);
  });
  try{ localStorage.setItem('pc_box_tab', name); }catch(e){}
}

function enterBoxView(){
  $('boxView').hidden = false;
  let tab = 'gara';
  try{ tab = localStorage.getItem('pc_box_tab') || 'gara'; }catch(e){}
  setBoxTab(BOX_TABS.includes(tab) ? tab : 'gara');
  $('boxCodePill').textContent = code;
  // Numero di gara, indirizzo, utente e chiave si ricordano su questo dispositivo
  // (la chiave resta finche' non si preme "Dimentica la chiave"). Il posto piu' sicuro
  // resta comunque Render (variabili d'ambiente del server).
  if($('aubDriverId') && !$('aubDriverId').value) $('aubDriverId').value = localStorage.getItem('pc_aub_driver') || '';
  if($('aubUrl')) $('aubUrl').value = localStorage.getItem('pc_aub_url') || '';
  if($('aubUser')) $('aubUser').value = localStorage.getItem('pc_aub_user') || '';
  if($('aubPass')){ try{ $('aubPass').value = localStorage.getItem('pc_aub_pass') || ''; }catch(e){} }
  setTimingSource(localStorage.getItem('pc_timing_source') || 'server');
  renderQbEditor();
  renderFlashEditor();
  renderFuelSystemUI();
  renderAlarmCard();
  applyBoxAwake();
  setupPushNotifications();
}

function sendDayMode(){ socket.emit('dayModeUpdate', { dayMode: !$('dayModeToggle').checked }); }

function flashConfirm(btnEl){
  if(!btnEl) return;
  const originalText = btnEl.textContent;
  btnEl.classList.add('sent-confirm');
  btnEl.textContent = 'Inviato ✓';
  setTimeout(() => {
    btnEl.classList.remove('sent-confirm');
    btnEl.textContent = originalText;
  }, 1200);
}

function renderQbEditor(){
  const el = $('qbEditor');
  if(!el) return;
  el.innerHTML = '';
  quickButtons.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'qb-row';
    row.innerHTML = `
      <input type="text" value="${esc(b.label)}" oninput="quickButtons[${i}].label=this.value">
      <input type="color" value="${coloreOk(b.color, '#3fa9f5')}" oninput="quickButtons[${i}].color=this.value">`;
    el.appendChild(row);
  });
}

function saveQuickButtons(){
  save('pc_qb', quickButtons);
  socket.emit('quickButtonsUpdate', { buttons: quickButtons });
}

function renderFlashEditor(){
  const el = $('flashEditor');
  if(!el) return;
  el.innerHTML = '';
  flashPresets.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'flash-row';
    row.innerHTML = `
      <input type="text" value="${esc(p.text)}" oninput="flashPresets[${i}].text=this.value;flashSalva()">
      <input type="color" value="${coloreOk(p.color, '#2FB6C4')}" oninput="flashPresets[${i}].color=this.value;flashSalva()">
      <input type="number" value="${Number(p.duration) || 6}" min="2" max="60" oninput="flashPresets[${i}].duration=+this.value;flashSalva()" title="secondi">
      <button class="btn small primary" onclick="sendFlashPreset(${i}, this)">Invia</button>
      <button class="btn small" onclick="eliminaFlashPreset(${i}, this)" title="Elimina" aria-label="Elimina messaggio">\u2715</button>`;
    el.appendChild(row);
  });
}

// Il box salva sul telefono e, poco dopo l'ultima modifica, anche sul server (cosi'
// i messaggi restano alla squadra e arrivano agli altri box).
let flashSalvaTimer = null;
function flashSalva(){
  save('pc_flash', flashPresets);
  clearTimeout(flashSalvaTimer);
  flashSalvaTimer = setTimeout(() => { if(socket) socket.emit('flashPresetsUpdate', { presets: flashPresets }); }, 800);
}

function addFlashPreset(){
  flashPresets.push({text:'NUOVO MESSAGGIO', color:'#2FB6C4', duration:6});
  flashSalva();
  renderFlashEditor();
}

// Elimina un messaggio: serve un secondo tocco entro 3 secondi per evitare errori.
// Ne resta sempre almeno uno.
let flashEliminaPronto = null;
function eliminaFlashPreset(i, btnEl){
  if(flashPresets.length <= 1){
    btnEl.textContent = 'Ne serve almeno 1';
    setTimeout(() => { btnEl.textContent = '\u2715'; }, 1500);
    return;
  }
  if(flashEliminaPronto !== i){
    flashEliminaPronto = i;
    btnEl.textContent = 'Sicuro?';
    btnEl.classList.add('sent-confirm');
    setTimeout(() => {
      if(flashEliminaPronto === i){ flashEliminaPronto = null; btnEl.textContent = '\u2715'; btnEl.classList.remove('sent-confirm'); }
    }, 3000);
    return;
  }
  flashEliminaPronto = null;
  flashPresets.splice(i, 1);
  flashSalva();
  renderFlashEditor();
}

function sendFlashPreset(i, btnEl){
  flashSalva();
  const p = flashPresets[i];
  socket.emit('flashMessage', { text: p.text, color: p.color, durationSeconds: p.duration });
  flashConfirm(btnEl);
}

// ---------- cronologia dei messaggi dall'auto ----------
// Il server conserva i messaggi della stanza e li manda al box quando si ricollega;
// il box ne tiene una copia sul telefono, cosi' resta anche ricaricando la pagina.
// Un messaggio ha un identificativo: arrivando due volte (dal vivo e poi dalla
// cronologia) compare una volta sola, e solo quello dal vivo suona e vibra.

const HISTORY_MAX = 100;

function loadHistoryLocal(){
  const h = load('pc_history', null);
  return h && h.code === code && Array.isArray(h.items) ? h.items : [];
}

function saveHistoryLocal(items){ save('pc_history', { code: code, items: items }); }

function formatLogTime(at){
  const d = new Date(at);
  const ora = d.toLocaleTimeString('it-IT');
  return d.toDateString() === new Date().toDateString()
    ? ora
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + ora;
}

function renderHistory(items){
  const log = $('log');
  if(!log) return;
  log.innerHTML = '';
  items.forEach(m => {
    const div = document.createElement('div');
    div.className = 'log-item';
    const testo = document.createElement('span');
    testo.textContent = m.label;          // testo semplice: niente HTML dal messaggio
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = formatLogTime(m.at);
    div.appendChild(testo);
    div.appendChild(t);
    log.prepend(div);
  });
}

/** Aggiunge i messaggi nuovi alla cronologia; `dalVivo` fa suonare e vibrare. */
function mergeHistory(nuovi, dalVivo){
  const attuali = loadHistoryLocal();
  const noti = new Set(attuali.map(m => m.id));
  const aggiunti = [];
  (nuovi || []).forEach(m => {
    if(!m) return;
    const id = m.id || (m.at + ':' + m.label);
    if(noti.has(id)) return;
    noti.add(id);
    aggiunti.push({ id: id, label: String(m.label == null ? '' : m.label), at: Number(m.at) || Date.now() });
  });
  if(!aggiunti.length){ renderHistory(attuali); return false; }
  const tutti = attuali.concat(aggiunti).sort((a, b) => a.at - b.at).slice(-HISTORY_MAX);
  saveHistoryLocal(tutti);
  renderHistory(tutti);
  if(dalVivo) avvisaMessaggio(aggiunti.length ? aggiunti[aggiunti.length - 1].label : '');
  return true;
}

function addLog(m){ mergeHistory([m], true); }

function clearHistoryLocal(){
  saveHistoryLocal([]);
  renderHistory([]);
}

function clearLog(){
  clearHistoryLocal();
  if(socket && socket.connected) socket.emit('historyClear');
}

// ---------- avviso, sirena e schermo acceso ----------

// Un messaggio dal vivo: vibrazione SOS e sirena (o un bip, se la sirena e' spenta).
function avvisaMessaggio(testo){
  if(role !== 'box') return; // la sirena e' solo del box
  if(navigator.vibrate) navigator.vibrate(SOS_VIBRATION);
  if(loadSirenSettings().on) playSiren(); else playAlertBeep();
  notificaAndroid('PitComm \u00b7 messaggio dall\u2019auto', testo || 'Nuovo messaggio');
}

function renderAlarmCard(){
  if($('provaNotificaRiga')) $('provaNotificaRiga').hidden = !window.PitCommAndroid;
  const s = loadSirenSettings();
  if($('sirenToggle')) $('sirenToggle').checked = s.on;
  if($('sirenVolume')) $('sirenVolume').value = Math.round(s.volume * 100);
  if($('awakeToggle')) $('awakeToggle').checked = localStorage.getItem('pc_box_awake') === '1';
}

function setSirenOn(on){
  const s = loadSirenSettings();
  s.on = !!on;
  saveSirenSettings(s);
}

function setSirenVolume(v){
  const s = loadSirenSettings();
  s.volume = Math.min(1, Math.max(0.2, Number(v) / 100));
  saveSirenSettings(s);
}

// Il tocco sul pulsante serve anche a sbloccare l'audio del browser.
function testSiren(){
  if(navigator.vibrate) navigator.vibrate(SOS_VIBRATION);
  playSiren();
}

// Solo nell'app Android: prova la notifica con la sirena (come a schermo spento).
function testNotificaAndroid(){ notificaAndroid('PitComm', 'Prova della sirena delle notifiche', true); }

// Schermo sempre acceso sul box: la pagina resta in primo piano e la connessione non
// cade, cosi' la sirena suona sempre. Si perde se la pagina va in secondo piano e si
// riprende al ritorno. Consuma batteria.
let boxWakeLock = null;

function setAwakeStatus(testo){
  if($('awakeStatus')) $('awakeStatus').textContent = testo;
}

async function applyBoxAwake(){
  const on = localStorage.getItem('pc_box_awake') === '1';
  if(!on){
    try{ if(boxWakeLock) await boxWakeLock.release(); }catch(e){}
    boxWakeLock = null;
    setAwakeStatus('Spento: lo schermo si spegne come al solito.');
    return;
  }
  if(!navigator.wakeLock){
    setAwakeStatus('Questo telefono non lo permette.');
    return;
  }
  try{
    boxWakeLock = await navigator.wakeLock.request('screen');
    boxWakeLock.addEventListener('release', () => { boxWakeLock = null; });
    setAwakeStatus("Attivo: lo schermo resta acceso finch\u00e9 l'app \u00e8 aperta in primo piano.");
  }catch(e){
    setAwakeStatus('Non riesco ad attivarlo adesso: riprova toccando di nuovo.');
  }
}

function setBoxAwake(on){
  localStorage.setItem('pc_box_awake', on ? '1' : '0');
  applyBoxAwake();
}

document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && role === 'box' && localStorage.getItem('pc_box_awake') === '1' && !boxWakeLock) applyBoxAwake();
});

// Conferma visiva: ogni pulsante del box (non le schede) si illumina per un secondo quando lo si preme.
// Solo la vista box: quella dell'auto non cambia.
document.addEventListener('click', (e) => {
  try{
    const el = e.target && e.target.closest ? e.target.closest('#boxView button, #boxView label.toggle') : null;
    if(!el || el.classList.contains('tab') || el.disabled) return;
    el.classList.add('premuto');
    clearTimeout(el._premutoT);
    el._premutoT = setTimeout(() => el.classList.remove('premuto'), 1000);
  }catch(err){}
}, true);
