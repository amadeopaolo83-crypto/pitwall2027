package it.pitwall.pitcomm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Servizio in primo piano: tiene viva l'app (e la CPU) a schermo spento, con una notifica
 * fissa "PitComm attivo". Senza questo Android la fermerebbe dopo poco.
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
        Notification n = new Notification.Builder(this, CANALE)
                .setContentTitle("PitComm attivo")
                .setContentText("Collegato alla gara")
                .setSmallIcon(R.drawable.ic_stat)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, n);
        }

        if (sveglia == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            sveglia = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pitcomm:attivo");
            sveglia.acquire();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (sveglia != null && sveglia.isHeld()) sveglia.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
