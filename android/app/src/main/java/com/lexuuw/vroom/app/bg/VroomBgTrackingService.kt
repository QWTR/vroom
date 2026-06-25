package com.lexuuw.vroom.app.bg

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
import com.lexuuw.vroom.app.MainActivity
import com.lexuuw.vroom.app.R

/**
 * Własny foreground service VROOM — powiadomienie „Praca w tle”.
 * Nie polegamy wyłącznie na expo-location (start FG z tła bywa blokowany).
 */
class VroomBgTrackingService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        BgTrackingModule.notifyStopRequested(applicationContext)
        stopSelfSafely()
        return START_NOT_STICKY
      }
    }
    val notification = buildNotification()
    startForeground(NOTIFICATION_ID, notification)
    return START_STICKY
  }

  override fun onDestroy() {
    stopForegroundSafely()
    super.onDestroy()
  }

  private fun stopSelfSafely() {
    stopForegroundSafely()
    stopSelf()
  }

  private fun stopForegroundSafely() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun buildNotification(): Notification {
    ensureChannel()
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      this.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      0
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag,
    )

    val immutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }
    val stopIntent = Intent(this, VroomBgTrackingService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPending = PendingIntent.getService(
      this,
      1,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag,
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    builder
      .setContentTitle("VROOM — statystyki jazdy")
      .setContentText("Zliczanie km w tle · użyj Zakończ aby wyłączyć")
      .setSmallIcon(R.drawable.ic_bg_tracking_stat)
      .setColor(Color.parseColor("#e33835"))
      .setColorized(true)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(
        Notification.Action.Builder(null, "Zakończ", stopPending).build(),
      )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    return builder.build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    var channel = mgr.getNotificationChannel(CHANNEL_ID)
    if (channel == null) {
      channel = NotificationChannel(
        CHANNEL_ID,
        "Statystyki jazdy VROOM",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "Powiadomienie podczas zliczania km w tle"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
      }
      mgr.createNotificationChannel(channel)
    }
  }

  companion object {
    const val ACTION_STOP = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_STOP"
    private const val CHANNEL_ID = "vroom_bg_tracking"
    private const val NOTIFICATION_ID = 481_756

    fun start(context: Context) {
      val intent = Intent(context, VroomBgTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, VroomBgTrackingService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }
}
