package __PACKAGE__.auto

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import android.util.Log
import __PACKAGE__.MainActivity
import __PACKAGE__.R

class AutoLocationForegroundService : Service() {
    private val owners = linkedSetOf<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            Log.w(TAG, "Pomijam automatyczny restart usługi bez akcji")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        when (intent.action) {
            ACTION_RELEASE -> {
                intent.getStringExtra(EXTRA_OWNER)?.let(owners::remove)
                if (owners.isEmpty()) {
                    AutoLocationTracker.stop()
                    stopForegroundSafely()
                    stopSelf()
                    return START_NOT_STICKY
                }
            }
            ACTION_START -> intent.getStringExtra(EXTRA_OWNER)?.let(owners::add)
            else -> {
                Log.w(TAG, "Pomijam nieznaną akcję usługi: ${intent.action}")
                stopSelf(startId)
                return START_NOT_STICKY
            }
        }

        try {
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (error: RuntimeException) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || error !is ForegroundServiceStartNotAllowedException) {
                throw error
            }
            Log.w(TAG, "System nie zezwolił na uruchomienie lokalizacji z tła", error)
            owners.clear()
            AutoLocationTracker.stop()
            stopSelf(startId)
            return START_NOT_STICKY
        }
        AutoLocationTracker.start(applicationContext)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        owners.clear()
        AutoLocationTracker.stop()
        stopForegroundSafely()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        ensureChannel()
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("VROOM — Android Auto")
            .setContentText("Nawigacja korzysta z dokładnej lokalizacji")
            .setSmallIcon(R.drawable.ic_bg_tracking_stat)
            .setColor(Color.parseColor("#e33835"))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Nawigacja Android Auto",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Aktywna lokalizacja podczas korzystania z Android Auto"
                setShowBadge(false)
            },
        )
    }

    private fun stopForegroundSafely() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    companion object {
        private const val TAG = "VroomAutoLocation"
        private const val ACTION_START = "__PACKAGE__.action.AUTO_LOCATION_START"
        private const val ACTION_RELEASE = "__PACKAGE__.action.AUTO_LOCATION_RELEASE"
        private const val EXTRA_OWNER = "owner"
        private const val CHANNEL_ID = "vroom_android_auto_location"
        private const val NOTIFICATION_ID = 481_757

        fun acquire(context: Context, owner: String) {
            val appContext = context.applicationContext
            val intent = Intent(appContext, AutoLocationForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_OWNER, owner)
            }
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    appContext.startForegroundService(intent)
                } else {
                    appContext.startService(intent)
                }
            }.onFailure { error ->
                Log.e(TAG, "Nie udało się uruchomić usługi lokalizacji Android Auto", error)
                AutoLocationTracker.start(appContext)
            }
        }

        fun release(context: Context, owner: String) {
            val appContext = context.applicationContext
            val intent = Intent(appContext, AutoLocationForegroundService::class.java).apply {
                action = ACTION_RELEASE
                putExtra(EXTRA_OWNER, owner)
            }
            runCatching { appContext.startService(intent) }
                .onFailure {
                    Log.w(TAG, "Nie udało się zwolnić usługi lokalizacji Android Auto", it)
                    AutoLocationTracker.stop()
                }
        }
    }
}
