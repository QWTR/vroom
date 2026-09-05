package com.lexuuw.vroom.app.cb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ContextCompat

class VroomCbForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "VROOM CB", NotificationManager.IMPORTANCE_LOW).apply { description = "Aktywna rozmowa VROOM CB"; setSound(null, null) })
    val pending = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val icon = resources.getIdentifier("ic_bg_tracking_stat", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    val notification = builder.setSmallIcon(icon).setContentTitle("VROOM CB jest aktywne").setContentText("Wykrywanie mowy działa w tle.").setContentIntent(pending).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(NOTIFICATION_ID, notification)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
  companion object {
    private const val CHANNEL_ID = "vroom_cb_active"
    private const val NOTIFICATION_ID = 7312
    fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, VroomCbForegroundService::class.java))
    fun stop(context: Context) { context.stopService(Intent(context, VroomCbForegroundService::class.java)) }
  }
}
