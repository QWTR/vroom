package expo.modules.location.services

import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.IBinder

class LocationTaskService : Service() {
  private val ACTION_STOP = "expo.modules.location.action.STOP_TRACKING"
  private val VROOM_END_ACTION = "com.lexuuw.vroom.app.action.BG_TRACKING_END"
  private var mChannelId: String? = null
  private var mKillService = false
  private lateinit var mParentContext: Context
  private var mLastServiceOptions: Bundle? = null
  private val mServiceId = sServiceId++
  private val mBinder: IBinder = ServiceBinder()

  inner class ServiceBinder : Binder() {
    val service: LocationTaskService
      get() = this@LocationTaskService
  }

  override fun onBind(intent: Intent): IBinder {
    return mBinder
  }

  @TargetApi(26)
  override fun onStartCommand(intent: Intent, flags: Int, startId: Int): Int {
    when (intent.action) {
      ACTION_STOP -> {
        notifyVroomEndTracking()
        stop()
        return START_NOT_STICKY
      }
    }
    val extras = intent.extras
    if (extras != null) {
      mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")
      mKillService = extras.getBoolean("killService", false)
    }
    return START_REDELIVER_INTENT
  }

  fun setParentContext(context: Context) {
    mParentContext = context
  }

  fun stop() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent) {
    if (mKillService) {
      super.onTaskRemoved(rootIntent)
      stop()
    }
  }

  fun startForeground(serviceOptions: Bundle) {
    mLastServiceOptions = Bundle(serviceOptions)
    val notification = buildServiceNotification(serviceOptions)
    startForeground(mServiceId, notification)
  }

  private fun notifyVroomEndTracking() {
    try {
      val endIntent = Intent(VROOM_END_ACTION)
      endIntent.setPackage(mParentContext.packageName)
      sendBroadcast(endIntent)
    } catch (_: Exception) {
    }
  }

  @TargetApi(26)
  private fun buildServiceNotification(serviceOptions: Bundle): Notification {
    prepareChannel(mChannelId)
    val builder = Notification.Builder(this, mChannelId)
    val title = serviceOptions.getString("notificationTitle")
    val body = serviceOptions.getString("notificationBody")
    val color = colorStringToInteger(serviceOptions.getString("notificationColor"))

    title?.let { builder.setContentTitle(it) }
    body?.let { builder.setContentText(it) }
    color?.let {
      builder.setColorized(true).setColor(color)
    } ?: run {
      builder.setColorized(false)
    }

    mParentContext.packageManager.getLaunchIntentForPackage(mParentContext.packageName)?.let {
      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val contentIntent = PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag)
      builder.setContentIntent(contentIntent)
    }

    val immutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val stopIntent = Intent(this, LocationTaskService::class.java).apply { action = ACTION_STOP }
    val stopPendingIntent = PendingIntent.getService(
      this,
      mServiceId + 1000,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag
    )
    builder.addAction(
      Notification.Action.Builder(
        null,
        "Zakończ",
        stopPendingIntent
      ).build()
    )

    builder.setCategory(Notification.CATEGORY_SERVICE)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setAutoCancel(false)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    return builder.build()
  }

  @TargetApi(26)
  private fun prepareChannel(id: String?) {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    val appName = applicationInfo.loadLabel(packageManager).toString()
    var channel = notificationManager.getNotificationChannel(id)
    if (channel == null) {
      channel = NotificationChannel(id, appName, NotificationManager.IMPORTANCE_DEFAULT)
      channel.description = "Statystyki jazdy VROOM w tle"
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      channel.setShowBadge(false)
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun colorStringToInteger(color: String?): Int? {
    return try {
      Color.parseColor(color)
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    private var sServiceId = 481756
  }
}
