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
import android.webkit.WebViewClient;
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
    static final String CANALE_AVVISI = "pitcomm_avvisi";
    private static final int RC_PERMESSI = 1;
    private static final int RC_POSIZIONE = 2;

    private SharedPreferences prefs;
    private WebView web;
    private LinearLayout schermataIndirizzo;
    private TextView messaggio;
    private EditText campoUrl;
    private boolean errorePagina = false;

    private String posizioneOrigine;
    private GeolocationPermissions.Callback posizioneRichiamo;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout radice = new FrameLayout(this);
        radice.setBackgroundColor(0xFF0B0D0F);
        web = creaWebView();
        schermataIndirizzo = creaSchermataIndirizzo();
        radice.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        radice.addView(schermataIndirizzo, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(radice);

        creaCanaleAvvisi();
        chiediPermessi();
        avviaServizio();
        chiediNessunRisparmioBatteria();

        String url = prefs.getString(KEY_URL, "");
        if (url.isEmpty()) mostraIndirizzo(null); else apri(url);
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
        s.setUserAgentString(s.getUserAgentString() + " PitCommAndroid/1.0");
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
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    posizioneOrigine = origin;
                    posizioneRichiamo = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, RC_POSIZIONE);
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
            String url = prefs.getString(KEY_URL, "");
            if (!url.isEmpty()) apri(url);
        });
        l.addView(riprova);
        return l;
    }

    private void mostraIndirizzo(String testo) {
        messaggio.setText(testo != null ? testo : "Scrivi l'indirizzo della web app di PitComm (quello di Render).");
        campoUrl.setText(prefs.getString(KEY_URL, ""));
        schermataIndirizzo.setVisibility(View.VISIBLE);
    }

    // ---------- permessi, servizio, batteria ----------

    private void chiediPermessi() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, RC_PERMESSI);
        }
    }

    @Override
    public void onRequestPermissionsResult(int codice, String[] permessi, int[] esiti) {
        super.onRequestPermissionsResult(codice, permessi, esiti);
        if (codice == RC_POSIZIONE && posizioneRichiamo != null) {
            boolean ok = esiti.length > 0 && esiti[0] == PackageManager.PERMISSION_GRANTED;
            posizioneRichiamo.invoke(posizioneOrigine, ok, false);
            posizioneRichiamo = null;
        }
    }

    private void avviaServizio() {
        startForegroundService(new Intent(this, KeepAliveService.class));
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
        NotificationChannel c = new NotificationChannel(CANALE_AVVISI, "Avvisi di gara", NotificationManager.IMPORTANCE_HIGH);
        c.enableVibration(true);
        c.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
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
        public String versione() { return "1.0"; }
    }
}
