package com.lexuuw.vroom.app.bg

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.lexuuw.vroom.app.MainActivity
import com.lexuuw.vroom.app.R
import org.json.JSONArray
import org.json.JSONObject

class VroomBgTrackingService : Service() {
  private lateinit var fusedLocationClient: FusedLocationProviderClient
  private var trackingMode: String = MODE_FREE_DRIVE
  private var tripSessionId: String? = null
  private var locationCallback: LocationCallback? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START_TRACKING -> {
        trackingMode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FREE_DRIVE
        tripSessionId = intent.getStringExtra(EXTRA_TRIP_SESSION_ID)?.takeIf { it.isNotBlank() }
        startForeground(NOTIFICATION_ID, buildNotification(true))
        startNativeLocationUpdates(trackingMode, tripSessionId)
        return START_STICKY
      }
      ACTION_STOP -> {
        val reason = intent.getStringExtra(EXTRA_REASON) ?: "notification"
        stopTracking(reason, notifyReact = reason != "app")
        return START_NOT_STICKY
      }
      ACTION_STOP_NOTIFICATION -> {
        if (!readState(applicationContext).optBoolean("active", false)) {
          stopSelfSafely()
        }
        return START_NOT_STICKY
      }
    }

    val state = readState(applicationContext)
    val active = state.optBoolean("active", false)
    trackingMode = state.optString("mode", MODE_FREE_DRIVE)
    tripSessionId = state.optString("tripSessionId", "").takeIf { it.isNotBlank() }
    startForeground(NOTIFICATION_ID, buildNotification(active))
    if (active) startNativeLocationUpdates(trackingMode, tripSessionId)
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val state = readState(applicationContext)
    if (state.optBoolean("active", false)) {
      trackingMode = state.optString("mode", trackingMode)
      tripSessionId = state.optString("tripSessionId", "").takeIf { it.isNotBlank() }
      startForeground(NOTIFICATION_ID, buildNotification(true))
      startNativeLocationUpdates(trackingMode, tripSessionId)
    } else {
      stopSelfSafely()
    }
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    stopNativeLocationUpdates()
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

  private fun buildNotification(isTracking: Boolean): Notification {
    ensureChannel()
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
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
      putExtra(EXTRA_REASON, "notification")
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
      .setContentTitle("Wiroom - aktywna jazda")
      .setContentText(if (isTracking) "GPS dziala w tle. Uzyj Zakończ, aby zatrzymac." else "Praca w tle jest gotowa.")
      .setSmallIcon(R.drawable.ic_bg_tracking_stat)
      .setColor(Color.parseColor("#e33835"))
      .setColorized(true)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(R.drawable.ic_bg_tracking_stat, "Zakończ", stopPending)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    return builder.build()
  }

  private fun startNativeLocationUpdates(mode: String, sessionId: String?) {
    if (!hasLocationPermission()) {
      stopTracking("permission", notifyReact = true)
      return
    }

    acquireWakeLock()
    tripSessionId = sessionId
    val now = System.currentTimeMillis()
    val previous = readState(applicationContext)
    val startedAt = if (previous.optBoolean("active", false)) {
      previous.optLong("startedAt", now).takeIf { it > 0 } ?: now
    } else {
      now
    }
    val state = JSONObject()
      .put("active", true)
      .put("mode", mode)
      .put("tripSessionId", sessionId ?: previous.optString("tripSessionId", ""))
      .put("startedAt", startedAt)
      .put("endedBy", JSONObject.NULL)
      .put("lastFix", previous.opt("lastFix") ?: JSONObject.NULL)
      .put("updatedAt", now)
    writeState(applicationContext, state)

    if (locationCallback != null) return

    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
      .setMinUpdateIntervalMillis(500L)
      .setMinUpdateDistanceMeters(2f)
      .setWaitForAccurateLocation(false)
      .build()

    val callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.forEach { location ->
          persistLocation(applicationContext, location, trackingMode)
          accumulateNativeStats(applicationContext, location)
          BgTrackingModule.emitLocation(location, trackingMode)
        }
      }
    }
    locationCallback = callback

    try {
      fusedLocationClient.requestLocationUpdates(request, callback, mainLooper)
    } catch (_: SecurityException) {
      stopTracking("permission", notifyReact = true)
    }
  }

  private fun stopNativeLocationUpdates() {
    locationCallback?.let {
      fusedLocationClient.removeLocationUpdates(it)
    }
    locationCallback = null
    releaseWakeLock()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "VROOM:ActiveDriveLocation",
    ).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: RuntimeException) {
      // already released
    }
    wakeLock = null
  }

  private fun stopTracking(reason: String, notifyReact: Boolean) {
    stopNativeLocationUpdates()
    val now = System.currentTimeMillis()
    val previous = readState(applicationContext)
    val state = JSONObject()
      .put("active", false)
      .put("mode", previous.optString("mode", trackingMode))
      .put("tripSessionId", previous.optString("tripSessionId", ""))
      .put("startedAt", previous.optLong("startedAt", 0))
      .put("lastFix", previous.opt("lastFix") ?: JSONObject.NULL)
      .put("endedBy", reason)
      .put("updatedAt", now)
    writeState(applicationContext, state)
    if (notifyReact) BgTrackingModule.notifyStopRequested(applicationContext, reason)
    stopSelfSafely()
  }

  private fun hasLocationPermission(): Boolean {
    val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    return fine || coarse
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    var channel = mgr.getNotificationChannel(CHANNEL_ID)
    if (channel == null) {
      channel = NotificationChannel(
        CHANNEL_ID,
        "Jazda Wiroom",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Aktywne sledzenie GPS podczas jazdy"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
      }
      mgr.createNotificationChannel(channel)
    }
  }

  companion object {
    const val ACTION_STOP = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_STOP"
    const val ACTION_STOP_NOTIFICATION = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_STOP_NOTIFICATION"
    const val ACTION_START_TRACKING = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_START_TRACKING"
    const val EXTRA_MODE = "mode"
    const val EXTRA_REASON = "reason"
    const val EXTRA_TRIP_SESSION_ID = "tripSessionId"
    const val MODE_FREE_DRIVE = "freeDrive"
    private const val CHANNEL_ID = "wiroom_active_drive_tracking_v2"
    private const val NOTIFICATION_ID = 481_756
    private const val PREFS = "vroom_bg_tracking"
    private const val KEY_STATE = "drive_state"
    private const val KEY_BUFFER = "location_buffer"
    private const val KEY_NATIVE_STATS = "native_stats"
    private const val KEY_NATIVE_STATS_LAST_FIX = "native_stats_last_fix"
    private const val MAX_BUFFERED_FIXES = 240
    private const val MAX_STATS_ROUTE_POINTS = 1500
    private const val MAX_STATS_SPEED_SAMPLES = 400
    private const val MAX_ACCURACY_M = 65.0
    private const val MIN_SEGMENT_KM = 0.003
    private const val MAX_SEGMENT_KM = 2.0
    private const val MAX_FIX_GAP_MS = 420_000L
    private const val MIN_SPEED_KMH = 3.0
    private const val MAX_SPEED_KMH = 200.0

    fun start(context: Context) {
      val intent = Intent(context, VroomBgTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun startTracking(context: Context, mode: String, tripSessionId: String? = null) {
      val intent = Intent(context, VroomBgTrackingService::class.java).apply {
        action = ACTION_START_TRACKING
        putExtra(EXTRA_MODE, if (mode == "navigation") "navigation" else MODE_FREE_DRIVE)
        if (!tripSessionId.isNullOrBlank()) putExtra(EXTRA_TRIP_SESSION_ID, tripSessionId)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      stopTracking(context, "app")
    }

    fun stopTracking(context: Context, reason: String) {
      val intent = Intent(context, VroomBgTrackingService::class.java).apply {
        action = ACTION_STOP
        putExtra(EXTRA_REASON, reason)
      }
      context.startService(intent)
    }

    fun stopNotificationIfIdle(context: Context) {
      val intent = Intent(context, VroomBgTrackingService::class.java).apply {
        action = ACTION_STOP_NOTIFICATION
      }
      context.startService(intent)
    }

    fun readState(context: Context): JSONObject {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATE, null)
      return try {
        if (raw.isNullOrBlank()) JSONObject().put("active", false) else JSONObject(raw)
      } catch (_: Exception) {
        JSONObject().put("active", false)
      }
    }

    fun writeState(context: Context, state: JSONObject) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_STATE, state.toString())
        .apply()
    }

    fun consumeBufferedLocations(context: Context): JSONArray {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_BUFFER, null)
      prefs.edit().remove(KEY_BUFFER).apply()
      return try {
        if (raw.isNullOrBlank()) JSONArray() else JSONArray(raw)
      } catch (_: Exception) {
        JSONArray()
      }
    }

    fun consumeNativeStats(context: Context): JSONObject {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_NATIVE_STATS, null)
      prefs.edit().remove(KEY_NATIVE_STATS).apply()
      return try {
        if (raw.isNullOrBlank()) emptyNativeStats() else JSONObject(raw)
      } catch (_: Exception) {
        emptyNativeStats()
      }
    }

    fun readNativeStats(context: Context): JSONObject {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_NATIVE_STATS, null)
      return try {
        if (raw.isNullOrBlank()) emptyNativeStats() else JSONObject(raw)
      } catch (_: Exception) {
        emptyNativeStats()
      }
    }

    fun persistLocation(context: Context, location: Location, mode: String) {
      val fix = JSONObject()
        .put("latitude", location.latitude)
        .put("longitude", location.longitude)
        .put("speed", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
        .put("heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
        .put("accuracy", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
        .put("timestamp", if (location.time > 0) location.time else System.currentTimeMillis())
        .put("mode", mode)

      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val buffer = try {
        JSONArray(prefs.getString(KEY_BUFFER, "[]") ?: "[]")
      } catch (_: Exception) {
        JSONArray()
      }
      buffer.put(fix)
      while (buffer.length() > MAX_BUFFERED_FIXES) {
        buffer.remove(0)
      }

      val previous = readState(context)
      val state = JSONObject()
        .put("active", true)
        .put("mode", mode)
        .put("tripSessionId", previous.optString("tripSessionId", ""))
        .put("startedAt", previous.optLong("startedAt", System.currentTimeMillis()))
        .put("lastFix", fix)
        .put("endedBy", JSONObject.NULL)
        .put("updatedAt", System.currentTimeMillis())

      prefs.edit()
        .putString(KEY_BUFFER, buffer.toString())
        .putString(KEY_STATE, state.toString())
        .apply()
    }

    fun accumulateNativeStats(context: Context, location: Location) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val now = if (location.time > 0) location.time else System.currentTimeMillis()
      val lat = location.latitude
      val lon = location.longitude
      val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL
      val speedKmh = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null

      val stats = try {
        JSONObject(prefs.getString(KEY_NATIVE_STATS, null) ?: "{}")
      } catch (_: Exception) {
        JSONObject()
      }
      if (!stats.has("distanceKm")) stats.put("distanceKm", 0.0)
      if (!stats.has("routePoints")) stats.put("routePoints", JSONArray())
      if (!stats.has("speedSamples")) stats.put("speedSamples", JSONArray())
      if (!stats.has("maxSpeedKmh")) stats.put("maxSpeedKmh", 0.0)
      val state = readState(context)
      val sessionId = state.optString("tripSessionId", "")
      if (sessionId.isNotBlank()) stats.put("tripSessionId", sessionId)

      if (speedKmh != null && speedKmh in 1.0..MAX_SPEED_KMH) {
        val samples = stats.optJSONArray("speedSamples") ?: JSONArray()
        samples.put(speedKmh)
        while (samples.length() > MAX_STATS_SPEED_SAMPLES) samples.remove(0)
        stats.put("speedSamples", samples)
        stats.put("maxSpeedKmh", maxOf(stats.optDouble("maxSpeedKmh", 0.0), speedKmh))
      }

      val last = try {
        JSONObject(prefs.getString(KEY_NATIVE_STATS_LAST_FIX, null) ?: "{}")
      } catch (_: Exception) {
        JSONObject()
      }
      val lastLat = last.optDouble("latitude", Double.NaN)
      val lastLon = last.optDouble("longitude", Double.NaN)
      val lastTime = last.optLong("time", 0L)
      val lastAcc = last.optDouble("accuracy", Double.NaN)
      val currentAcc = if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN
      val hasLast = lastTime > 0L && lastLat.isFinite() && lastLon.isFinite()
      val accurateEnough =
        (!currentAcc.isFinite() || currentAcc <= MAX_ACCURACY_M) &&
          (!lastAcc.isFinite() || lastAcc <= MAX_ACCURACY_M)

      if (hasLast && accurateEnough) {
        val dt = now - lastTime
        val segmentKm = haversineKm(lastLat, lastLon, lat, lon)
        val speedOk = speedKmh == null || speedKmh >= MIN_SPEED_KMH
        if (
          dt > 0L &&
          dt <= MAX_FIX_GAP_MS &&
          segmentKm >= MIN_SEGMENT_KM &&
          segmentKm <= MAX_SEGMENT_KM &&
          speedOk
        ) {
          stats.put("distanceKm", stats.optDouble("distanceKm", 0.0) + segmentKm)
          val route = stats.optJSONArray("routePoints") ?: JSONArray()
          if (route.length() == 0) {
            route.put(JSONObject().put("latitude", lastLat).put("longitude", lastLon))
          }
          route.put(JSONObject().put("latitude", lat).put("longitude", lon))
          while (route.length() > MAX_STATS_ROUTE_POINTS) route.remove(0)
          stats.put("routePoints", route)
        }
      }

      val lastFix = JSONObject()
        .put("latitude", lat)
        .put("longitude", lon)
        .put("time", now)
        .put("accuracy", accuracy)

      prefs.edit()
        .putString(KEY_NATIVE_STATS, stats.toString())
        .putString(KEY_NATIVE_STATS_LAST_FIX, lastFix.toString())
        .apply()
    }

    private fun emptyNativeStats(): JSONObject =
      JSONObject()
        .put("distanceKm", 0.0)
        .put("routePoints", JSONArray())
        .put("speedSamples", JSONArray())
        .put("maxSpeedKmh", 0.0)
        .put("tripSessionId", JSONObject.NULL)

    private fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val earthKm = 6371.0
      val dLat = Math.toRadians(lat2 - lat1)
      val dLon = Math.toRadians(lon2 - lon1)
      val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
        kotlin.math.cos(Math.toRadians(lat1)) * kotlin.math.cos(Math.toRadians(lat2)) *
        kotlin.math.sin(dLon / 2) * kotlin.math.sin(dLon / 2)
      val c = 2 * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
      return earthKm * c
    }
  }
}
