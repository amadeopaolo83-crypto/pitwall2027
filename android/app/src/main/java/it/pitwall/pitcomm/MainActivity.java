package it.pitwall.pitcomm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebViewClient;
import android.webkit.WebViewRenderProcess;
import android.webkit.WebViewRenderProcessClient;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * PitComm Android: apre la web app di PitComm (l'indirizzo si sceglie al primo avvio e si
 * puo' cambiare), tiene lo schermo acceso, resta attiva a schermo spento grazie a un
 * servizio in primo piano e manda notifiche vere al box.
 */
public class MainActivity extends Activity {

    static final String PREFS = "pitcomm";
    static final String KEY_URL = "url";
    // Indirizzo predefinito: al primo avvio si apre da solo, senza scriverlo.
    static final String URL_PREDEFINITO = "https://pitwall2027.onrender.com";
    static final String CANALE_AVVISI = "pitcomm_sirena";
    private static final int RC_PERMESSI = 1;
    private static final int RC_POSIZIONE = 2;

    private SharedPreferences prefs;
    private FrameLayout radice;
    private WebView web;
    // Pagina bloccata o caduta: quante volte di fila, per non ricaricare all'infinito.
    private final long[] cadute = new long[4];
    private int nCadute = 0;
    private long bloccataDa = 0;
    private boolean permessiInCorso = false;
    private LinearLayout schermataIndirizzo;
    private TextView messaggio;
    private EditText campoUrl;
    private boolean errorePagina = false;

    private static final int RC_FILE = 3;
    private android.webkit.ValueCallback<Uri[]> scelteFile;

    private String posizioneOrigine;
    private GeolocationPermissions.Callback posizioneRichiamo;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        radice = new FrameLayout(this);
        radice.setBackgroundColor(0xFF0B0D0F);
        web = creaWebView();
        schermataIndirizzo = creaSchermataIndirizzo();
        radice.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        radice.addView(schermataIndirizzo, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(radice);

        creaCanaleAvvisi();
        avviaServizio();
        // Tutti i permessi subito all'avvio (notifiche e posizione), non in pista; poi la batteria.
        if (!chiediPermessi()) chiediNessunRisparmioBatteria();

        apri(prefs.getString(KEY_URL, URL_PREDEFINITO));
    }

    // ---------- pagina ----------

    private WebView creaWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(0xFF0B0D0F);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // la sirena deve poter suonare da sola
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " PitCommAndroid/1.2");
        w.addJavascriptInterface(new Ponte(), "PitCommAndroid");
        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    errorePagina = true;
                    mostraIndirizzo("Non riesco a collegarmi: " + e.getDescription());
                }
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (!errorePagina) schermataIndirizzo.setVisibility(View.GONE);
            }

            // Il motore della pagina e' caduto (memoria, errore) o lo abbiamo fermato perche'
            // bloccato: senza questo l'app si chiuderebbe. Si crea una pagina nuova e si ricarica;
            // la web app si ricollega da sola alla stanza (codice e ruolo sono salvati).
            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                if (v != web) return true;
                ricreaPagina();
                return true;
            }
        });
        // Pagina bloccata (non risponde) da piu' di 10 s: si ferma il suo processo, e
        // onRenderProcessGone qui sopra la ricrea. Solo Android 10+.
        if (Build.VERSION.SDK_INT >= 29) {
            w.setWebViewRenderProcessClient(new WebViewRenderProcessClient() {
                @Override
                public void onRenderProcessUnresponsive(WebView v, WebViewRenderProcess r) {
                    long ora = System.currentTimeMillis();
                    if (bloccataDa == 0) bloccataDa = ora;
                    else if (ora - bloccataDa > 10000 && r != null) { bloccataDa = 0; r.terminate(); }
                }

                @Override
                public void onRenderProcessResponsive(WebView v, WebViewRenderProcess r) {
                    bloccataDa = 0;
                }
            });
        }
        w.setWebChromeClient(new WebChromeClient() {
            // Scelta di un file (la foto finale): apre il selettore di immagini del telefono.
            @Override
            public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (scelteFile != null) scelteFile.onReceiveValue(null);
                scelteFile = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Scegli la foto"), RC_FILE);
                } catch (Exception e) {
                    scelteFile = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (KeepAliveService.posizioneConcessa(MainActivity.this)) {
                    callback.invoke(origin, true, false);
                } else {
                    posizioneOrigine = origin;
                    posizioneRichiamo = callback;
                    // se la richiesta dell'avvio e' ancora aperta si aspetta la sua risposta
                    if (!permessiInCorso) {
                        permessiInCorso = true;
                        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, RC_POSIZIONE);
                    }
                }
            }
        });
        return w;
    }

    private void apri(String url) {
        errorePagina = false;
        schermataIndirizzo.setVisibility(View.GONE);
        web.loadUrl(url);
    }

    private void ricreaPagina() {
        long ora = System.currentTimeMillis();
        cadute[nCadute % cadute.length] = ora;
        nCadute++;
        String url = prefs.getString(KEY_URL, URL_PREDEFINITO);
        try {
            if (web != null) {
                radice.removeView(web);
                web.destroy();
            }
        } catch (Exception e) { /* gia' distrutta */ }
        web = creaWebView();
        radice.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Quattro cadute in due minuti: si smette di ricaricare da soli e si mostra il motivo.
        boolean troppe = nCadute >= cadute.length && ora - cadute[nCadute % cadute.length] < 120000;
        if (troppe) {
            errorePagina = true;
            mostraIndirizzo("La pagina si e' bloccata piu' volte. Premi Riprova (o riavvia il telefono).");
        } else {
            new Handler(Looper.getMainLooper()).postDelayed(() -> apri(url), 500);
        }
    }

    // ---------- scelta dell'indirizzo ----------

    private LinearLayout creaSchermataIndirizzo() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(0xFF0B0D0F);
        int p = (int) (24 * getResources().getDisplayMetrics().density);
        l.setPadding(p, p, p, p);

        TextView titolo = new TextView(this);
        titolo.setText("PitComm");
        titolo.setTextColor(0xFFF5C518);
        titolo.setTextSize(28);
        titolo.setGravity(Gravity.CENTER);
        l.addView(titolo);

        messaggio = new TextView(this);
        messaggio.setTextColor(0xFFE9EDEF);
        messaggio.setTextSize(15);
        messaggio.setGravity(Gravity.CENTER);
        messaggio.setPadding(0, p / 2, 0, p / 2);
        l.addView(messaggio);

        campoUrl = new EditText(this);
        campoUrl.setHint("https://….onrender.com");
        campoUrl.setHintTextColor(0xFF7A838A);
        campoUrl.setTextColor(0xFFE9EDEF);
        campoUrl.setSingleLine(true);
        campoUrl.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_URI);
        l.addView(campoUrl, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button apri = new Button(this);
        apri.setText("Apri");
        apri.setOnClickListener(v -> {
            String url = campoUrl.getText().toString().trim();
            if (url.isEmpty()) return;
            if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
            prefs.edit().putString(KEY_URL, url).apply();
            apri(url);
        });
        l.addView(apri);

        Button riprova = new Button(this);
        riprova.setText("Riprova");
        riprova.setOnClickListener(v -> {
            apri(prefs.getString(KEY_URL, URL_PREDEFINITO));
        });
        l.addView(riprova);
        return l;
    }

    private void mostraIndirizzo(String testo) {
        messaggio.setText(testo != null ? testo : "Scrivi l'indirizzo della web app di PitComm (quello di Render).");
        campoUrl.setText(prefs.getString(KEY_URL, URL_PREDEFINITO));
        schermataIndirizzo.setVisibility(View.VISIBLE);
    }

    // ---------- permessi, servizio, batteria ----------

    /** Chiede insieme notifiche e posizione, se mancano. Vero se ha aperto la richiesta. */
    private boolean chiediPermessi() {
        java.util.ArrayList<String> mancano = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            mancano.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!KeepAliveService.posizioneConcessa(this)) {
            mancano.add(Manifest.permission.ACCESS_FINE_LOCATION);
            mancano.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (mancano.isEmpty()) return false;
        permessiInCorso = true;
        requestPermissions(mancano.toArray(new String[0]), RC_PERMESSI);
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int codice, String[] permessi, int[] esiti) {
        super.onRequestPermissionsResult(codice, permessi, esiti);
        permessiInCorso = false;
        boolean posizione = KeepAliveService.posizioneConcessa(this);
        // La pagina aspettava la posizione: si risponde con lo stato vero del permesso.
        if (posizioneRichiamo != null) {
            posizioneRichiamo.invoke(posizioneOrigine, posizione, false);
            posizioneRichiamo = null;
        }
        // Posizione appena concessa: il servizio si riavvia per diventare anche di tipo "location".
        if (posizione) avviaServizio();
        if (codice == RC_PERMESSI) chiediNessunRisparmioBatteria();
    }

    @Override
    protected void onActivityResult(int codice, int esito, Intent dati) {
        super.onActivityResult(codice, esito, dati);
        if (codice == RC_FILE && scelteFile != null) {
            Uri[] r = null;
            if (esito == RESULT_OK && dati != null && dati.getData() != null) r = new Uri[]{dati.getData()};
            scelteFile.onReceiveValue(r);
            scelteFile = null;
        }
    }

    private void avviaServizio() {
        try {
            startForegroundService(new Intent(this, KeepAliveService.class));
        } catch (Exception e) { /* avvio rifiutato dal sistema: l'app funziona lo stesso in primo piano */ }
    }

    // Senza questo Android puo' fermare l'app a schermo spento per risparmiare batteria.
    private void chiediNessunRisparmioBatteria() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (!pm.isIgnoringBatteryOptimizations(getPackageName()) && !prefs.getBoolean("batteria_chiesta", false)) {
                prefs.edit().putBoolean("batteria_chiesta", true).apply();
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                startActivity(i);
            }
        } catch (Exception e) { /* se non si puo', si va avanti lo stesso */ }
    }

    private void creaCanaleAvvisi() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel c = new NotificationChannel(CANALE_AVVISI, "Avvisi di gara (sirena)", NotificationManager.IMPORTANCE_HIGH);
        c.enableVibration(true);
        c.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
        // La sirena e' il suono delle notifiche: segue il volume "sveglia" del telefono.
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        c.setSound(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.sirena), aa);
        nm.createNotificationChannel(c);
    }

    // ---------- tasto indietro ----------

    @Override
    public void onBackPressed() {
        if (schermataIndirizzo.getVisibility() == View.VISIBLE) {
            moveTaskToBack(true);
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle("PitComm")
                    .setItems(new String[]{"Cambia indirizzo", "Riduci a icona", "Annulla"}, (d, which) -> {
                        if (which == 0) mostraIndirizzo(null);
                        else if (which == 1) moveTaskToBack(true);
                    })
                    .show();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    // La pagina NON viene messa in pausa quando l'app va in secondo piano: cosi' continua
    // a ricevere i messaggi e a far suonare gli avvisi. Il servizio in primo piano tiene
    // viva l'app.
    @Override
    protected void onDestroy() {
        if (isFinishing()) stopService(new Intent(this, KeepAliveService.class));
        super.onDestroy();
    }

    // ---------- cio' che la web app puo' chiedere all'app ----------

    private class Ponte {
        /** Notifica vera con suono e vibrazione (funziona anche a schermo spento). */
        @JavascriptInterface
        public void notifica(String titolo, String testo) {
            Intent apri = new Intent(MainActivity.this, MainActivity.class);
            apri.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, apri, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new Notification.Builder(MainActivity.this, CANALE_AVVISI)
                    .setContentTitle(titolo)
                    .setContentText(testo)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            getSystemService(NotificationManager.class).notify((int) (System.currentTimeMillis() % 100000), n);
        }

        @JavascriptInterface
        public void vibra() {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 400, 200, 400, 200, 400}, -1));
        }

        @JavascriptInterface
        public String versione() { return "1.2"; }

        /** Stato dei permessi del telefono, per mostrarlo nella pagina: JSON. */
        @JavascriptInterface
        public String stato() {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                JSONObject j = new JSONObject();
                j.put("versione", "1.2");
                j.put("notifiche", getSystemService(NotificationManager.class).areNotificationsEnabled());
                j.put("posizione", KeepAliveService.posizioneConcessa(MainActivity.this));
                j.put("posizionePrecisa", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED);
                j.put("batteriaLibera", pm.isIgnoringBatteryOptimizations(getPackageName()));
                j.put("ripartenzePagina", nCadute);
                return j.toString();
            } catch (Exception e) {
                return "{}";
            }
        }
    }
}
