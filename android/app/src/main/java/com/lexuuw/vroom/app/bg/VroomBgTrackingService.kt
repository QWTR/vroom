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
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.lexuuw.vroom.app.MainActivity
import com.lexuuw.vroom.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class VroomBgTrackingService : Service() {
  private val logTag = "VroomBgTracking"
  private lateinit var fusedLocationClient: FusedLocationProviderClient
  private var trackingMode: String = MODE_FREE_DRIVE
  private var tripSessionId: String? = null
  private var apiUrl: String? = null
  private var authToken: String? = null
  private var brokerSubscribed = false

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
        apiUrl = intent.getStringExtra(EXTRA_API_URL)?.takeIf { it.isNotBlank() }
        authToken = intent.getStringExtra(EXTRA_AUTH_TOKEN)?.takeIf { it.isNotBlank() }
        saveCheckpointAuth(applicationContext, apiUrl, authToken)
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
    val auth = readCheckpointAuth(applicationContext)
    apiUrl = auth.first
    authToken = auth.second
    if (!active) {
      // The background-work preference is not a drive. Do not leave a sticky
      // foreground service alive until an actual trip starts.
      stopSelfSafely()
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, buildNotification(true))
    startNativeLocationUpdates(trackingMode, tripSessionId)
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val state = readState(applicationContext)
    if (state.optBoolean("active", false)) {
      // Swipe z recents = intencjonalne, pelne zamkniecie aplikacji. Nawigacja NIE
      // ma przetrwac pelnego zamkniecia — degradujemy natywny tryb navigation ->
      // freeDrive, aby jazda (km, pozycja) liczyla sie dalej, a nawigacja byla
      // wylaczona po ponownym otwarciu (cold-start odczyta mode=freeDrive).
      val storedMode = state.optString("mode", trackingMode)
      trackingMode = if (storedMode == "navigation") MODE_FREE_DRIVE else storedMode
      tripSessionId = state.optString("tripSessionId", "").takeIf { it.isNotBlank() }
      writeState(applicationContext, JSONObject()
        .put("active", true)
        .put("mode", trackingMode)
        .put("tripSessionId", tripSessionId ?: state.optString("tripSessionId", ""))
        .put("startedAt", state.optLong("startedAt", System.currentTimeMillis()))
        .put("lastFix", state.opt("lastFix") ?: JSONObject.NULL)
        .put("endedBy", JSONObject.NULL)
        .put("updatedAt", System.currentTimeMillis()))
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
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
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

    return builder.build()
  }

  private fun startNativeLocationUpdates(mode: String, sessionId: String?) {
    if (!hasLocationPermission()) {
      Log.d(logTag, "startTracking blocked: no location permission mode=$mode")
      stopTracking("permission", notifyReact = true)
      return
    }

    tripSessionId = sessionId
    val now = System.currentTimeMillis()
    val previous = readState(applicationContext)
    val previousSessionId = previous.optString("tripSessionId", "")
    val isNewSession = !sessionId.isNullOrBlank() && sessionId != previousSessionId
    if (isNewSession) {
      resetNativeSessionStats(applicationContext)
    }
    val startedAt = if (previous.optBoolean("active", false) && !isNewSession) {
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
    Log.d(logTag, "startTracking mode=$mode session=$sessionId brokerActive=$brokerSubscribed")

    if (brokerSubscribed) {
      Log.d(logTag, "startTracking reuse shared provider; seeding lastKnown mode=$mode")
      seedLastKnownLocation(mode)
      return
    }

    brokerSubscribed = true
    VroomLocationBroker.subscribe(applicationContext, BROKER_OWNER) { location ->
      persistLocation(applicationContext, location, trackingMode, "live", false)
      accumulateNativeStats(applicationContext, location)
      BgTrackingModule.emitLocation(location, trackingMode, "live", false)
    }
    Log.d(logTag, "shared provider subscribed mode=$mode")
    seedLastKnownLocation(mode)
  }

  private fun seedLastKnownLocation(mode: String) {
    if (!hasLocationPermission()) {
      Log.d(logTag, "seedLastKnown skipped: no permission mode=$mode")
      return
    }
    try {
      fusedLocationClient.lastLocation
        .addOnSuccessListener { location ->
          if (location == null) {
            Log.d(logTag, "seedLastKnown empty mode=$mode")
            return@addOnSuccessListener
          }
          if (!isReliableLocation(applicationContext, location)) {
            Log.d(
              logTag,
              "seedLastKnown rejected mode=$mode acc=${location.accuracy} time=${location.time}"
            )
            return@addOnSuccessListener
          }
          Log.d(
            logTag,
            "seedLastKnown accepted mode=$mode acc=${location.accuracy} " +
              "speed=${location.speed} time=${location.time}"
          )
          persistLocation(applicationContext, location, mode, "lastKnown", true)
          accumulateNativeStats(applicationContext, location)
          BgTrackingModule.emitLocation(location, mode, "lastKnown", true)
        }
    } catch (_: SecurityException) {
      Log.d(logTag, "seedLastKnown blocked: permission mode=$mode")
      stopTracking("permission", notifyReact = true)
    }
  }

  private fun stopNativeLocationUpdates() {
    if (brokerSubscribed) {
      VroomLocationBroker.unsubscribe(BROKER_OWNER)
    }
    brokerSubscribed = false
  }

  private fun stopTracking(reason: String, notifyReact: Boolean) {
    sealNativeStats(applicationContext)
    flushNativeCheckpointBlocking(applicationContext, force = true)
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
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Aktywne sledzenie GPS podczas jazdy"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
      }
      mgr.createNotificationChannel(channel)
    }
  }

  companion object {
    private const val BROKER_OWNER = "background_drive"
    private const val logTagStatic = "VroomBgTracking"
    const val ACTION_STOP = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_STOP"
    const val ACTION_STOP_NOTIFICATION = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_STOP_NOTIFICATION"
    const val ACTION_START_TRACKING = "com.lexuuw.vroom.app.action.VROOM_BG_SERVICE_START_TRACKING"
    const val EXTRA_MODE = "mode"
    const val EXTRA_REASON = "reason"
    const val EXTRA_TRIP_SESSION_ID = "tripSessionId"
    const val EXTRA_API_URL = "apiUrl"
    const val EXTRA_AUTH_TOKEN = "authToken"
    const val MODE_FREE_DRIVE = "freeDrive"
    private const val CHANNEL_ID = "wiroom_active_drive_tracking_v3"
    private const val NOTIFICATION_ID = 481_756
    private const val PREFS = "vroom_bg_tracking"
    private const val KEY_STATE = "drive_state"
    private const val KEY_BUFFER = "location_buffer"
    private const val KEY_NATIVE_STATS = "native_stats"
    private const val KEY_NATIVE_STATS_LAST_FIX = "native_stats_last_fix"
    private const val KEY_NATIVE_CHECKPOINT_API_URL = "native_checkpoint_api_url"
    private const val KEY_NATIVE_CHECKPOINT_AUTH_TOKEN = "native_checkpoint_auth_token"
    private const val KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM = "native_last_server_checkpoint_km"
    private const val AUTO_NAV_PREFS = "vroom_auto_nav"
    private const val KEY_AUTO_DISTANCE_OWNER = "auto_distance_owner"
    private const val KEY_AUTO_DISTANCE_OWNER_AT = "auto_distance_owner_at"
    private const val KEY_AUTO_DISTANCE_OWNER_GENERATION = "auto_distance_owner_generation"
    private const val KEY_LAST_AUTO_DISTANCE_OWNER = "last_auto_distance_owner"
    private const val KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION = "last_auto_distance_owner_generation"
    private const val AUTO_DISTANCE_OWNER_STALE_MS = 2 * 60_000L
    private const val MAX_BUFFERED_FIXES = 120
    private const val MAX_STATS_ROUTE_POINTS = 5_000
    private const val MAX_STATS_SPEED_SAMPLES = 240
    private const val ROUTE_POINT_SPACING_KM = 0.008
    private const val MAX_ACCURACY_M = 120.0
    private const val MIN_SEGMENT_KM = 0.002
    private const val MAX_SEGMENT_KM = 12.0
    private const val MAX_FIX_GAP_MS = 420_000L
    private const val MAX_PLAUSIBLE_GAP_KMH = 220.0
    private const val MAX_PLAUSIBLE_GAP_KM = 60.0
    private const val MIN_SPEED_KMH = 2.0
    private const val MOVING_CONFIRM_KMH = 5.0
    private const val STOPPED_CONFIRM_KMH = 3.0
    private const val STOP_CONFIRM_MS = 5_000L
    private const val STATIONARY_ROUTE_HEARTBEAT_MS = 30_000L
    // vmax bez limitu — tylko dolny próg próbki
    private const val NATIVE_CHECKPOINT_KM = 0.2
    private const val NATIVE_CHECKPOINT_FORCE_MIN_KM = 0.05
    private const val NATIVE_CHECKPOINT_FORCE_MS = 30_000L
    private val nativeCheckpointLock = Any()
    @Volatile private var nativeCheckpointInFlight = false

    fun start(context: Context) {
      if (!readState(context).optBoolean("active", false)) return
      val intent = Intent(context, VroomBgTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun startTracking(
      context: Context,
      mode: String,
      tripSessionId: String? = null,
      apiUrl: String? = null,
      authToken: String? = null,
    ) {
      saveCheckpointAuth(context, apiUrl, authToken)
      val intent = Intent(context, VroomBgTrackingService::class.java).apply {
        action = ACTION_START_TRACKING
        putExtra(EXTRA_MODE, if (mode == "navigation") "navigation" else MODE_FREE_DRIVE)
        if (!tripSessionId.isNullOrBlank()) putExtra(EXTRA_TRIP_SESSION_ID, tripSessionId)
        if (!apiUrl.isNullOrBlank()) putExtra(EXTRA_API_URL, apiUrl)
        if (!authToken.isNullOrBlank()) putExtra(EXTRA_AUTH_TOKEN, authToken)
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

    fun saveCheckpointAuth(context: Context, apiUrl: String?, authToken: String?) {
      val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (!apiUrl.isNullOrBlank()) edit.putString(KEY_NATIVE_CHECKPOINT_API_URL, apiUrl)
      if (!authToken.isNullOrBlank()) edit.putString(KEY_NATIVE_CHECKPOINT_AUTH_TOKEN, authToken)
      edit.apply()
    }

    fun readCheckpointAuth(context: Context): Pair<String?, String?> {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return Pair(
        prefs.getString(KEY_NATIVE_CHECKPOINT_API_URL, null)?.takeIf { it.isNotBlank() },
        prefs.getString(KEY_NATIVE_CHECKPOINT_AUTH_TOKEN, null)?.takeIf { it.isNotBlank() },
      )
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
      // This is called only after the final activity was accepted by the
      // server. Until then stats and checkpoint credentials stay durable.
      prefs.edit()
        .remove(KEY_NATIVE_STATS)
        .remove(KEY_NATIVE_STATS_LAST_FIX)
        .remove(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM)
        .remove(KEY_LAST_AUTO_DISTANCE_OWNER)
        .remove(KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION)
        .remove(KEY_NATIVE_CHECKPOINT_API_URL)
        .remove(KEY_NATIVE_CHECKPOINT_AUTH_TOKEN)
        .apply()
      return try {
        if (raw.isNullOrBlank()) emptyNativeStats() else JSONObject(raw)
      } catch (_: Exception) {
        emptyNativeStats()
      }
    }

    private fun resetNativeSessionStats(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(KEY_NATIVE_STATS)
        .remove(KEY_NATIVE_STATS_LAST_FIX)
        .remove(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM)
        .remove(KEY_LAST_AUTO_DISTANCE_OWNER)
        .remove(KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION)
        .apply()
    }

    fun readNativeStats(context: Context): JSONObject {
      val stats = readNativeStatsSnapshot(context)
      // Foreground recovery reads are also an offline-retry opportunity. This
      // matters when connectivity returns after the vehicle has stopped.
      maybeFlushNativeCheckpoint(context, stats, force = false)
      return stats
    }

    fun readNativeProgress(context: Context): JSONObject {
      val stats = readNativeStatsSnapshot(context)
      maybeFlushNativeCheckpoint(context, stats, force = false)
      return JSONObject()
        .put("distanceKm", stats.optDouble("distanceKm", 0.0))
        .put("tripSessionId", stats.optString("tripSessionId", ""))
        .put("maxSpeedKmh", stats.optDouble("maxSpeedKmh", 0.0))
        .put("lastServerCheckpointKm", stats.optDouble("lastServerCheckpointKm", 0.0))
        .put("elapsedSec", stats.optDouble("elapsedSec", 0.0))
        .put("movingSec", stats.optDouble("movingSec", 0.0))
        .put("stoppedSec", stats.optDouble("stoppedSec", 0.0))
        .put("motionState", stats.optString("motionState", "unknown"))
        .put("lastFixAt", stats.optLong("lastFixAt", 0L))
    }

    private fun readNativeStatsSnapshot(context: Context): JSONObject {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_NATIVE_STATS, null)
      val stats = try {
        if (raw.isNullOrBlank()) emptyNativeStats() else JSONObject(raw)
      } catch (_: Exception) {
        emptyNativeStats()
      }
      val now = System.currentTimeMillis()
      if (!readState(context).optBoolean("active", false)) return stats
      val startedAt = stats.optLong("startedAt", 0L)
      val lastFixAt = stats.optLong("lastFixAt", 0L)
      if (startedAt > 0L) stats.put("elapsedSec", ((now - startedAt).coerceAtLeast(0L) / 1000.0))
      if (lastFixAt > 0L && now > lastFixAt) {
        val key = if (stats.optString("motionState", "unknown") == "stopped") "stoppedSec" else "movingSec"
        stats.put(key, stats.optDouble(key, 0.0) + (now - lastFixAt) / 1000.0)
      }
      return stats
    }

    @Synchronized
    private fun sealNativeStats(context: Context) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val stats = readNativeStatsSnapshot(context)
      val now = System.currentTimeMillis()
      stats.put("lastFixAt", now)
      prefs.edit().putString(KEY_NATIVE_STATS, stats.toString()).commit()
    }

    private fun shouldBypassStrictLocationFilters(context: Context, location: Location): Boolean {
      val debuggable = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
      val mocked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2 && location.isFromMockProvider
      return debuggable || mocked
    }

    private fun effectiveMaxAccuracyM(context: Context, location: Location): Double =
      if (shouldBypassStrictLocationFilters(context, location)) 200.0 else MAX_ACCURACY_M

    private fun effectiveMinSpeedKmh(context: Context, location: Location): Double =
      if (shouldBypassStrictLocationFilters(context, location)) 0.0 else MIN_SPEED_KMH

    private fun effectiveMaxSegmentKm(context: Context, location: Location): Double =
      if (shouldBypassStrictLocationFilters(context, location)) 25.0 else MAX_SEGMENT_KM

    private fun isReliableLocation(context: Context, location: Location): Boolean {
      if (shouldBypassStrictLocationFilters(context, location)) return true
      return !location.hasAccuracy() || location.accuracy.toDouble() <= MAX_ACCURACY_M
    }

    fun persistLocation(context: Context, location: Location, mode: String, source: String = "live", isSeed: Boolean = false) {
      val fix = JSONObject()
        .put("latitude", location.latitude)
        .put("longitude", location.longitude)
        .put("speed", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
        .put("heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
        .put("accuracy", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
        .put("timestamp", if (location.time > 0) location.time else System.currentTimeMillis())
        .put("mode", mode)
        .put("source", source)
        .put("receivedAt", System.currentTimeMillis())
        .put("elapsedRealtimeNanos", location.elapsedRealtimeNanos.toDouble())
        .put("isSeed", isSeed)

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
      val lastReliableFix = if (isReliableLocation(context, location)) {
        fix
      } else {
        previous.opt("lastFix") ?: JSONObject.NULL
      }
      val state = JSONObject()
        .put("active", true)
        .put("mode", mode)
        .put("tripSessionId", previous.optString("tripSessionId", ""))
        .put("startedAt", previous.optLong("startedAt", System.currentTimeMillis()))
        .put("lastFix", lastReliableFix)
        .put("endedBy", JSONObject.NULL)
        .put("updatedAt", System.currentTimeMillis())

      prefs.edit()
        .putString(KEY_BUFFER, buffer.toString())
        .putString(KEY_STATE, state.toString())
        .apply()
    }

    @Synchronized
    fun accumulateNativeStats(context: Context, location: Location) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val autoPrefs = context.getSharedPreferences(AUTO_NAV_PREFS, Context.MODE_PRIVATE)
      val ownerAt = autoPrefs.getLong(KEY_AUTO_DISTANCE_OWNER_AT, 0L)
      val ownerGeneration = autoPrefs.getLong(KEY_AUTO_DISTANCE_OWNER_GENERATION, 0L)
      val autoOwnsDistance = autoPrefs.getBoolean(KEY_AUTO_DISTANCE_OWNER, false) &&
        ownerAt > 0L && System.currentTimeMillis() - ownerAt <= AUTO_DISTANCE_OWNER_STALE_MS
      val previouslyOwnedByAuto = prefs.getBoolean(KEY_LAST_AUTO_DISTANCE_OWNER, false)
      val ownershipBoundaryChanged = prefs.getLong(KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION, -1L) != ownerGeneration
      if (autoOwnsDistance || previouslyOwnedByAuto || ownershipBoundaryChanged) {
        // Preserve only the boundary fix. While AA owns distance this service
        // must not add the same physical segment, and the first fix after AA
        // must not bridge back across the entire AA drive.
        persistNativeStatsLastFix(prefs, location)
        prefs.edit()
          .putBoolean(KEY_LAST_AUTO_DISTANCE_OWNER, autoOwnsDistance)
          .putLong(KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION, ownerGeneration)
          .apply()
        return
      }
      val now = if (location.time > 0) location.time else System.currentTimeMillis()
      val lat = location.latitude
      val lon = location.longitude
      val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL
      val speedKmh = if (location.hasSpeed() && location.speed > 0f) {
        location.speed.toDouble() * 3.6
      } else {
        // Android often reports hasSpeed=true with 0 while moving — treat as unknown
        // so haversine segments are not dropped (matches JS TripStats).
        null
      }

      val stats = try {
        JSONObject(prefs.getString(KEY_NATIVE_STATS, null) ?: "{}")
      } catch (_: Exception) {
        JSONObject()
      }
      if (!stats.has("distanceKm")) {
        stats.put("distanceKm", prefs.getFloat(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM, 0f).toDouble())
      }
      if (!stats.has("routePoints")) stats.put("routePoints", JSONArray())
      if (!stats.has("speedSamples")) stats.put("speedSamples", JSONArray())
      if (!stats.has("maxSpeedKmh")) stats.put("maxSpeedKmh", 0.0)
      if (!stats.has("lastServerCheckpointKm")) {
        stats.put("lastServerCheckpointKm", prefs.getFloat(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM, 0f).toDouble())
      }
      val state = readState(context)
      val sessionId = state.optString("tripSessionId", "")
      if (sessionId.isNotBlank()) stats.put("tripSessionId", sessionId)
      if (!stats.has("startedAt")) stats.put("startedAt", state.optLong("startedAt", now))
      if (!stats.has("elapsedSec")) stats.put("elapsedSec", 0.0)
      if (!stats.has("movingSec")) stats.put("movingSec", 0.0)
      if (!stats.has("stoppedSec")) stats.put("stoppedSec", 0.0)
      if (!stats.has("motionState")) stats.put("motionState", "unknown")
      if (!stats.has("gapCount")) stats.put("gapCount", 0)
      if (!stats.has("maxGapSec")) stats.put("maxGapSec", 0.0)
      if (!stats.has("acceptedFixes")) stats.put("acceptedFixes", 0)
      if (!stats.has("rejectedFixes")) stats.put("rejectedFixes", 0)

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
      val maxAccuracy = effectiveMaxAccuracyM(context, location)
      val minSpeed = effectiveMinSpeedKmh(context, location)
      val maxSegment = effectiveMaxSegmentKm(context, location)
      val accurateEnough =
        (!currentAcc.isFinite() || currentAcc <= maxAccuracy) &&
          (!lastAcc.isFinite() || lastAcc <= maxAccuracy)

      val dtMs = if (hasLast) now - lastTime else 0L
      val dtSec = dtMs.coerceAtLeast(0L) / 1000.0
      val segmentKmForMotion = if (hasLast) haversineKm(lastLat, lastLon, lat, lon) else 0.0
      val derivedKmh = if (dtSec > 0) segmentKmForMotion * 3600.0 / dtSec else 0.0
      val accuracyEnvelopeKm = maxOf(
        0.015,
        ((if (currentAcc.isFinite()) currentAcc else 0.0) + (if (lastAcc.isFinite()) lastAcc else 0.0)) * 1.2 / 1000.0,
      )
      val previousMotion = stats.optString("motionState", "unknown")
      val movingEvidence = accurateEnough && (
        (speedKmh != null && speedKmh >= MOVING_CONFIRM_KMH) ||
          (derivedKmh >= MOVING_CONFIRM_KMH && segmentKmForMotion > accuracyEnvelopeKm)
        )
      val stoppedEvidence = accurateEnough && segmentKmForMotion <= accuracyEnvelopeKm &&
        (speedKmh == null || speedKmh < STOPPED_CONFIRM_KMH)
      var motion = previousMotion
      var candidateAt = stats.optLong("stationaryCandidateAt", 0L)
      var stopStartedAt = 0L
      if (!hasLast && stats.optDouble("movingSec", 0.0) + stats.optDouble("stoppedSec", 0.0) <= 0.0) {
        val initialSec = (now - stats.optLong("startedAt", now)).coerceAtLeast(0L) / 1000.0
        stats.put("movingSec", initialSec)
      }
      if (movingEvidence) {
        if (previousMotion == "stopped" && dtSec > 0) {
          stats.put("movingSec", stats.optDouble("movingSec", 0.0) + dtSec)
        } else if (candidateAt > 0L) {
          stats.put("movingSec", stats.optDouble("movingSec", 0.0) + (now - candidateAt).coerceAtLeast(0L) / 1000.0)
        } else if (dtSec > 0) {
          stats.put("movingSec", stats.optDouble("movingSec", 0.0) + dtSec)
        }
        candidateAt = 0L
        motion = "moving"
      } else if (stoppedEvidence) {
        if (previousMotion == "stopped") {
          if (dtSec > 0) stats.put("stoppedSec", stats.optDouble("stoppedSec", 0.0) + dtSec)
        } else {
          if (candidateAt <= 0L) candidateAt = if (lastTime > 0L) lastTime else now
          if (now - candidateAt >= STOP_CONFIRM_MS) {
            stats.put("stoppedSec", stats.optDouble("stoppedSec", 0.0) + (now - candidateAt) / 1000.0)
            stopStartedAt = candidateAt
            motion = "stopped"
            candidateAt = 0L
          }
        }
      } else if (dtSec > 0) {
        if (previousMotion == "stopped") stats.put("stoppedSec", stats.optDouble("stoppedSec", 0.0) + dtSec)
        else stats.put("movingSec", stats.optDouble("movingSec", 0.0) + dtSec)
      }
      stats.put("stationaryCandidateAt", candidateAt)
      stats.put("motionState", motion)
      stats.put("lastFixAt", now)
      stats.put("elapsedSec", ((now - stats.optLong("startedAt", now)).coerceAtLeast(0L) / 1000.0))
      if (dtSec > 10.0) {
        stats.put("gapCount", stats.optInt("gapCount", 0) + 1)
        stats.put("maxGapSec", maxOf(stats.optDouble("maxGapSec", 0.0), dtSec))
      }

      var acceptedMovement = false
      if (hasLast && accurateEnough) {
        val dt = now - lastTime
        val segmentKm = haversineKm(lastLat, lastLon, lat, lon)
        val speedOk = !stoppedEvidence && (speedKmh == null || speedKmh >= minSpeed || derivedKmh >= MOVING_CONFIRM_KMH)
        val longGapPlausible = dt > MAX_FIX_GAP_MS && derivedKmh in MOVING_CONFIRM_KMH..MAX_PLAUSIBLE_GAP_KMH &&
          segmentKm <= MAX_PLAUSIBLE_GAP_KM && accurateEnough
        val segmentLimitOk = if (dt <= MAX_FIX_GAP_MS) segmentKm <= maxSegment else longGapPlausible
        if (dt > 0L && segmentKm >= MIN_SEGMENT_KM && speedOk && segmentLimitOk) {
          if (segmentKm <= maxSegment || longGapPlausible) {
            acceptedMovement = true
            stats.put("acceptedFixes", stats.optInt("acceptedFixes", 0) + 1)
            stats.put("distanceKm", stats.optDouble("distanceKm", 0.0) + segmentKm)
            val route = stats.optJSONArray("routePoints") ?: JSONArray()
            if (route.length() == 0) {
              route.put(routePointJson(last, "native", previousMotion, if (dtSec > 10.0) "gap" else "accepted"))
            }
            val lastRoute = route.optJSONObject(route.length() - 1)
            val routeMovedKm = if (lastRoute != null) {
              haversineKm(
                lastRoute.optDouble("latitude", lat),
                lastRoute.optDouble("longitude", lon),
                lat,
                lon,
              )
            } else {
              Double.POSITIVE_INFINITY
            }
            if (routeMovedKm >= ROUTE_POINT_SPACING_KM || previousMotion == "stopped") {
              route.put(routePointJson(location, "native", motion, if (dtSec > 10.0) "gap" else "accepted"))
            }
            stats.put(
              "routePoints",
              if (route.length() > MAX_STATS_ROUTE_POINTS) compactJsonArray(route) else route,
            )
          } else {
            stats.put("rejectedFixes", stats.optInt("rejectedFixes", 0) + 1)
            // GPS gap / mock jump — preserve post-gap point as a new segment anchor.
            persistNativeStatsLastFix(prefs, location)
            prefs.edit()
              .putString(KEY_NATIVE_STATS, stats.toString())
              .apply()
            maybeFlushNativeCheckpoint(context, stats, force = false)
            return
          }
        }
      }

      if (!acceptedMovement && motion == "stopped") {
        val route = stats.optJSONArray("routePoints") ?: JSONArray()
        if (previousMotion != "stopped" && stopStartedAt > 0L) {
          route.put(routePointJson(location, "native", "stopped", "accepted").put("recordedAt", stopStartedAt))
        }
        val lastRoute = route.optJSONObject(route.length() - 1)
        val lastRouteAt = lastRoute?.optLong("recordedAt", 0L) ?: 0L
        if (lastRouteAt <= 0L || now - lastRouteAt >= STATIONARY_ROUTE_HEARTBEAT_MS || previousMotion != "stopped") {
          route.put(routePointJson(location, "native", "stopped", "accepted"))
          stats.put("routePoints", if (route.length() > MAX_STATS_ROUTE_POINTS) compactJsonArray(route) else route)
        }
      } else if (!acceptedMovement && previousMotion == "stopped" && motion == "moving") {
        val route = stats.optJSONArray("routePoints") ?: JSONArray()
        route.put(routePointJson(location, "native", "moving", "reanchor"))
        stats.put("routePoints", if (route.length() > MAX_STATS_ROUTE_POINTS) compactJsonArray(route) else route)
      }

      if (acceptedMovement && speedKmh != null && speedKmh >= 1.0) {
        val samples = stats.optJSONArray("speedSamples") ?: JSONArray()
        samples.put(speedKmh)
        stats.put(
          "speedSamples",
          if (samples.length() > MAX_STATS_SPEED_SAMPLES) compactJsonArray(samples) else samples,
        )
        stats.put("maxSpeedKmh", maxOf(stats.optDouble("maxSpeedKmh", 0.0), speedKmh))
      }

      prefs.edit()
        .putString(KEY_NATIVE_STATS, stats.toString())
        .putString(KEY_NATIVE_STATS_LAST_FIX, statsFixJson(location).toString())
        .putBoolean(KEY_LAST_AUTO_DISTANCE_OWNER, false)
        .putLong(KEY_LAST_AUTO_DISTANCE_OWNER_GENERATION, ownerGeneration)
        .apply()

      maybeFlushNativeCheckpoint(context, stats, force = false)
    }

    private fun persistNativeStatsLastFix(
      prefs: android.content.SharedPreferences,
      location: Location,
    ) {
      prefs.edit().putString(KEY_NATIVE_STATS_LAST_FIX, statsFixJson(location).toString()).apply()
    }

    private fun statsFixJson(location: Location): JSONObject = JSONObject()
      .put("latitude", location.latitude)
      .put("longitude", location.longitude)
      .put("time", if (location.time > 0) location.time else System.currentTimeMillis())
      .put("accuracy", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
      .put("speedKmh", if (location.hasSpeed() && location.speed >= 0f) location.speed.toDouble() * 3.6 else JSONObject.NULL)
      .put("altitudeM", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
      .put("headingDeg", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)

    private fun routePointJson(location: Location, source: String, motionState: String = "unknown", segmentStatus: String = "accepted"): JSONObject = JSONObject()
      .put("latitude", location.latitude)
      .put("longitude", location.longitude)
      .put("recordedAt", if (location.time > 0) location.time else System.currentTimeMillis())
      .put("speedKmh", if (location.hasSpeed() && location.speed >= 0f) location.speed.toDouble() * 3.6 else JSONObject.NULL)
      .put("altitudeM", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
      .put("accuracyM", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
      .put("headingDeg", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
      .put("source", source)
      .put("accepted", true)
      .put("motionState", motionState)
      .put("segmentStatus", segmentStatus)

    private fun routePointJson(fix: JSONObject, source: String, motionState: String = "unknown", segmentStatus: String = "accepted"): JSONObject = JSONObject()
      .put("latitude", fix.optDouble("latitude"))
      .put("longitude", fix.optDouble("longitude"))
      .put("recordedAt", fix.optLong("time", System.currentTimeMillis()))
      .put("speedKmh", fix.opt("speedKmh") ?: JSONObject.NULL)
      .put("altitudeM", fix.opt("altitudeM") ?: JSONObject.NULL)
      .put("accuracyM", fix.opt("accuracy") ?: JSONObject.NULL)
      .put("headingDeg", fix.opt("headingDeg") ?: JSONObject.NULL)
      .put("source", source)
      .put("accepted", true)
      .put("motionState", motionState)
      .put("segmentStatus", segmentStatus)

    private fun emptyNativeStats(): JSONObject =
      JSONObject()
        .put("distanceKm", 0.0)
        .put("routePoints", JSONArray())
        .put("speedSamples", JSONArray())
        .put("maxSpeedKmh", 0.0)
        .put("lastServerCheckpointKm", 0.0)
        .put("lastCheckpointAttemptAt", 0L)
        .put("tripSessionId", JSONObject.NULL)
        .put("elapsedSec", 0.0)
        .put("movingSec", 0.0)
        .put("stoppedSec", 0.0)
        .put("motionState", "unknown")
        .put("lastFixAt", 0L)
        .put("gapCount", 0)
        .put("maxGapSec", 0.0)
        .put("acceptedFixes", 0)
        .put("rejectedFixes", 0)

    fun flushNativeCheckpointBlocking(context: Context, force: Boolean = false) {
      val stats = readNativeStatsSnapshot(context)
      val distance = stats.optDouble("distanceKm", 0.0)
      if (!distance.isFinite() || distance < 0.05) return
      if (!tryStartNativeCheckpoint()) return
      val worker = thread(start = true) {
        try {
          postNativeCheckpoint(context, stats, force)
        } finally {
          finishNativeCheckpoint()
        }
      }
      try {
        worker.join(4_500L)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }

    @Synchronized
    private fun maybeFlushNativeCheckpoint(context: Context, stats: JSONObject, force: Boolean) {
      val distance = stats.optDouble("distanceKm", 0.0)
      if (!distance.isFinite() || distance < 0.05) return
      val lastServer = stats.optDouble("lastServerCheckpointKm", 0.0).takeIf { it.isFinite() } ?: 0.0
      val lastAttempt = stats.optLong("lastCheckpointAttemptAt", 0L)
      val delta = distance - lastServer
      val now = System.currentTimeMillis()
      val dueByDistance = delta >= NATIVE_CHECKPOINT_KM
      val dueByForce = delta >= NATIVE_CHECKPOINT_FORCE_MIN_KM && now - lastAttempt >= NATIVE_CHECKPOINT_FORCE_MS
      if (!force && !dueByDistance && !dueByForce) return
      if (!tryStartNativeCheckpoint()) return

      val updatedStats = JSONObject(stats.toString()).put("lastCheckpointAttemptAt", now)
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val durableStats = try {
        JSONObject(prefs.getString(KEY_NATIVE_STATS, null) ?: "{}")
      } catch (_: Exception) {
        JSONObject()
      }
      durableStats.put("lastCheckpointAttemptAt", now)
      prefs.edit().putString(KEY_NATIVE_STATS, durableStats.toString()).apply()

      thread(start = true) {
        try {
          postNativeCheckpoint(context, updatedStats, force)
        } finally {
          finishNativeCheckpoint()
        }
      }
    }

    private fun tryStartNativeCheckpoint(): Boolean = synchronized(nativeCheckpointLock) {
      if (nativeCheckpointInFlight) return@synchronized false
      nativeCheckpointInFlight = true
      true
    }

    private fun finishNativeCheckpoint() {
      synchronized(nativeCheckpointLock) {
        nativeCheckpointInFlight = false
      }
    }

    private fun postNativeCheckpoint(context: Context, statsSnapshot: JSONObject, force: Boolean): Boolean {
      val distance = statsSnapshot.optDouble("distanceKm", 0.0)
      if (!distance.isFinite() || distance < 0.05) return false
      val state = readState(context)
      val sessionId = statsSnapshot.optString("tripSessionId", "")
        .ifBlank { state.optString("tripSessionId", "") }
      if (sessionId.isBlank()) return false

      val (rawApiUrl, token) = readCheckpointAuth(context)
      if (rawApiUrl.isNullOrBlank() || token.isNullOrBlank()) return false
      val endpoint = rawApiUrl.trim().removeSuffix("/") + "/api/activity/session/checkpoint"
      val mode = state.optString("mode", MODE_FREE_DRIVE)
      val source = if (mode == "navigation") "navigation" else "driving"
      val maxSpeed = statsSnapshot.optDouble("maxSpeedKmh", 0.0).takeIf { it.isFinite() } ?: 0.0
      val avgSpeed = averageSpeed(statsSnapshot.optJSONArray("speedSamples") ?: JSONArray())

      return try {
        val body = JSONObject()
          .put("tripSessionId", sessionId)
          .put("distanceTotal", roundKm(distance))
          .put("maxSpeed", roundSpeed(maxSpeed))
          .put("avgSpeed", roundSpeed(avgSpeed))
          .put("source", source)
          .put("visibleInHistory", false)
          .toString()

        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = if (force) 3000 else 5000
          readTimeout = if (force) 3000 else 5000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Authorization", "Bearer $token")
        }
        connection.outputStream.use { stream ->
          stream.write(body.toByteArray(Charsets.UTF_8))
        }
        val code = connection.responseCode
        val responseText = if (code in 200..299) {
          connection.inputStream.bufferedReader().use { it.readText() }
        } else {
          connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
        }
        connection.disconnect()
        if (code !in 200..299) {
          Log.d(logTagStatic, "native checkpoint failed code=$code body=${responseText.take(160)}")
          return false
        }

        val responseJson = try { JSONObject(responseText) } catch (_: Exception) { JSONObject() }
        val checkpointKm = responseJson.optDouble("checkpointDistanceKm", distance)
          .takeIf { it.isFinite() } ?: distance
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val latest = try {
          JSONObject(prefs.getString(KEY_NATIVE_STATS, null) ?: "{}")
        } catch (_: Exception) {
          JSONObject()
        }
        latest.put("lastServerCheckpointKm", maxOf(latest.optDouble("lastServerCheckpointKm", 0.0), checkpointKm))
        latest.put("lastCheckpointAttemptAt", System.currentTimeMillis())
        if (sessionId.isNotBlank()) latest.put("tripSessionId", sessionId)
        prefs.edit()
          .putString(KEY_NATIVE_STATS, latest.toString())
          .putFloat(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM, checkpointKm.toFloat())
          .apply()
        true
      } catch (e: Exception) {
        Log.d(logTagStatic, "native checkpoint error: ${e.message}")
        false
      }
    }

    private fun averageSpeed(samples: JSONArray): Double {
      if (samples.length() == 0) return 0.0
      var sum = 0.0
      var count = 0
      for (i in 0 until samples.length()) {
        val value = samples.optDouble(i, Double.NaN)
        if (value.isFinite() && value >= 1.0) {
          sum += value
          count += 1
        }
      }
      return if (count > 0) sum / count else 0.0
    }

    private fun compactJsonArray(source: JSONArray): JSONArray {
      val out = JSONArray()
      var index = 0
      while (index < source.length()) {
        out.put(source.opt(index))
        index += 2
      }
      val last = source.opt(source.length() - 1)
      if (last != null && last !== JSONObject.NULL && out.opt(out.length() - 1) !== last) {
        out.put(last)
      }
      return out
    }

    private fun roundKm(value: Double): Double = kotlin.math.round(value * 1000.0) / 1000.0

    private fun roundSpeed(value: Double): Double = kotlin.math.round(value * 10.0) / 10.0

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
