// Involucro Android: controlli sui sorgenti, cosi' una modifica non toglie per sbaglio le protezioni.
// Non sostituisce la compilazione (la fa .github/workflows/android.yml) ne' le prove su un telefono vero.
const fs = require('fs'), path = require('path');
const C = require('./comune');
const V = C.controlli('apk');
const A = path.join(C.REPO, 'android', 'app', 'src', 'main');
const man = fs.readFileSync(path.join(A, 'AndroidManifest.xml'), 'utf8');
const srv = fs.readFileSync(path.join(A, 'java/it/pitwall/pitcomm/KeepAliveService.java'), 'utf8');
const act = fs.readFileSync(path.join(A, 'java/it/pitwall/pitcomm/MainActivity.java'), 'utf8');
const corpo = (testo, firma) => { const i = testo.indexOf(firma); if (i < 0) return ''; let d = 0, j = testo.indexOf('{', i); const k = j; for (; j < testo.length; j++) { if (testo[j] === '{') d++; else if (testo[j] === '}' && --d === 0) break; } return testo.slice(k, j + 1); };

// Manifest
for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'FOREGROUND_SERVICE_SPECIAL_USE', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS']) {
  V.ok('manifest: permesso ' + p, man.includes(`android.permission.${p}"`));
}
const tipi = (/android:foregroundServiceType="([^"]+)"/.exec(man) || [])[1] || '';
V.ok('manifest: servizio di tipo location e specialUse', tipi.split('|').includes('location') && tipi.split('|').includes('specialUse'), tipi);

// Servizio
const avvia = corpo(srv, 'private void avviaInPrimoPiano');
V.ok('servizio: tipo location solo con il permesso di posizione', /posizione\)\s*tipo \|= ServiceInfo\.FOREGROUND_SERVICE_TYPE_LOCATION/.test(avvia), avvia.slice(0, 200));
V.ok('servizio: Android 10-13 con tipo location o nessuno', /SDK_INT >= 29[\s\S]*FOREGROUND_SERVICE_TYPE_LOCATION : 0/.test(avvia));
const start = corpo(srv, 'public int onStartCommand');
V.ok('servizio: se il tipo location e\' rifiutato riparte senza', /catch \(Exception e\)[\s\S]*avviaInPrimoPiano\(n, false\)/.test(start));
V.ok('servizio: wake lock e START_STICKY', /PARTIAL_WAKE_LOCK/.test(start) && /return START_STICKY/.test(start));

// Attivita'
const crea = corpo(act, 'protected void onCreate');
V.ok('avvio: permessi chiesti subito (notifiche e posizione)', /chiediPermessi\(\)/.test(crea) && /POST_NOTIFICATIONS/.test(corpo(act, 'private boolean chiediPermessi')) && /ACCESS_FINE_LOCATION/.test(corpo(act, 'private boolean chiediPermessi')));
V.ok('avvio: servizio avviato', /avviaServizio\(\)/.test(crea));
const esito = corpo(act, 'public void onRequestPermissionsResult');
V.ok('permessi: con la posizione il servizio si riavvia (tipo location)', /if \(posizione\) avviaServizio\(\)/.test(esito));
V.ok('permessi: la pagina in attesa riceve la risposta', /posizioneRichiamo\.invoke/.test(esito));
V.ok('permessi: poi si chiede la batteria', /chiediNessunRisparmioBatteria\(\)/.test(esito));
V.ok('pagina caduta: onRenderProcessGone la ricrea', /onRenderProcessGone[\s\S]{0,200}ricreaPagina\(\)/.test(act));
V.ok('pagina bloccata: processo fermato dopo 10 s (Android 10+)', /onRenderProcessUnresponsive[\s\S]{0,300}10000[\s\S]{0,60}terminate\(\)/.test(act));
const ricrea = corpo(act, 'private void ricreaPagina');
V.ok('pagina ricreata: vecchia distrutta, nuova aggiunta e ricaricata', /web\.destroy\(\)/.test(ricrea) && /web = creaWebView\(\)/.test(ricrea) && /apri\(url\)/.test(ricrea));
V.ok('pagina ricreata: niente ricariche infinite', /troppe/.test(ricrea) && /mostraIndirizzo/.test(ricrea));
V.ok('ponte JS: notifica, vibra, versione, stato', ['notifica', 'vibra', 'versione', 'stato'].every((m) => new RegExp('public \\w+ ' + m + '\\(').test(act)));
V.ok('pagina non messa in pausa in secondo piano', !/web\.onPause\(\)|pauseTimers\(\)/.test(act));
V.fine();
