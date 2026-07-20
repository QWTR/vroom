package com.lexuuw.vroom.app.auto

import android.app.Notification
import android.content.Context
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.notification.CarNotificationManager
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.lexuuw.vroom.app.R

/** Keeps turn-by-turn information available in the Android Auto rail outside VROOM. */
object AutoTurnNotificationManager {
    private const val CHANNEL_ID = "vroom_navigation"
    private const val NOTIFICATION_ID = 7_201

    fun update(context: Context, cue: String, turnMeters: Double, destinationName: String) {
        runCatching {
            val manager = CarNotificationManager.from(context)
            if (!manager.areNotificationsEnabled()) return@runCatching
            manager.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
                    .setName("Nawigacja VROOM")
                    .setDescription("Wskazówki zakręt po zakręcie")
                    .build(),
            )
            val distance = if (turnMeters >= 1_000.0) {
                String.format(java.util.Locale("pl", "PL"), "%.1f km", turnMeters / 1_000.0)
            } else {
                "${turnMeters.toInt().coerceAtLeast(1)} m"
            }
            val extender = CarAppExtender.Builder()
                .setContentTitle("$distance • $cue")
                .setContentText("Cel: $destinationName")
                .setSmallIcon(R.drawable.notification_icon)
                .setImportance(NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .build()
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle("$distance • $cue")
                .setContentText("Cel: $destinationName")
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_NAVIGATION)
                .extend(extender)
            manager.notify(NOTIFICATION_ID, notification)
        }
    }

    fun cancel(context: Context?) {
        context ?: return
        runCatching { CarNotificationManager.from(context).cancel(NOTIFICATION_ID) }
    }
}
