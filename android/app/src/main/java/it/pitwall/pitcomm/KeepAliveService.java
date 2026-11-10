package it.pitwall.pitcomm;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Servizio in primo piano: tiene viva l'app (e la CPU) a schermo spento, con una notifica
 * fissa "PitComm attivo". Senza questo Android la fermerebbe dopo poco.
 * Se la posizione e' concessa e' anche di tipo "location" (GPS dell'auto a schermo spento);
 * MainActivity lo riavvia quando il permesso arriva, per aggiungere il tipo.
 */
public class KeepAliveService extends Service {

    private static final String CANALE = "pitcomm_attivo";
    private PowerManager.WakeLock sveglia;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CANALE, "PitComm attivo", NotificationManager.IMPORTANCE_LOW));

        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        // Con il permesso di posizione il servizio e' anche di tipo "location": cosi' Android non
        // ferma il GPS dell'auto se lo schermo si spegne o si passa a un'altra app.
        boolean posizione = posizioneConcessa(this);
        Notification n = new Notification.Builder(this, CANALE)
                .setContentTitle("PitComm attivo")
                .setContentText(posizione ? "Collegato alla gara · GPS disponibile" : "Collegato alla gara")
                .setSmallIcon(R.drawable.ic_stat)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

        try {
            avviaInPrimoPiano(n, posizione);
        } catch (Exception e) {
            // Per esempio il permesso e' stato tolto o il sistema rifiuta il tipo "location":
            // si resta almeno con il servizio normale, che tiene vivi rete e notifiche.
            try {
                avviaInPrimoPiano(n, false);
            } catch (Exception e2) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (sveglia == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            sveglia = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pitcomm:attivo");
            sveglia.acquire();
        }
        return START_STICKY;
    }

    static boolean posizioneConcessa(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void avviaInPrimoPiano(Notification n, boolean posizione) {
        if (Build.VERSION.SDK_INT >= 34) {
            int tipo = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            if (posizione) tipo |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            startForeground(1, n, tipo);
        } else if (Build.VERSION.SDK_INT >= 29) {
            // 0 = nessun tipo particolare (Android 10-13 non conosce "specialUse")
            startForeground(1, n, posizione ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        } else {
            startForeground(1, n);
        }
    }

    @Override
    public void onDestroy() {
        if (sveglia != null && sveglia.isHeld()) sveglia.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
