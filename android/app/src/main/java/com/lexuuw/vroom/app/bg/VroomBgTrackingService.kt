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
import android.util.Log
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
  private var locationCallback: LocationCallback? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var idleSinceMs = 0L

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
    startForeground(NOTIFICATION_ID, buildNotification(active))
    if (active) startNativeLocationUpdates(trackingMode, tripSessionId)
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
      Log.d(logTag, "startTracking blocked: no location permission mode=$mode")
      stopTracking("permission", notifyReact = true)
      return
    }

    acquireWakeLock()
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
    Log.d(logTag, "startTracking mode=$mode session=$sessionId callbackActive=${locationCallback != null}")

    if (locationCallback != null) {
      Log.d(logTag, "startTracking reuse existing callback; seeding lastKnown mode=$mode")
      seedLastKnownLocation(mode)
      return
    }

    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
      .setMinUpdateIntervalMillis(500L)
      .setMinUpdateDistanceMeters(2f)
      .setWaitForAccurateLocation(false)
      .build()

    val callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.forEach { location ->
          Log.d(
            logTag,
            "liveFix mode=$trackingMode lat=${location.latitude} lng=${location.longitude} " +
              "acc=${location.accuracy} speed=${location.speed} time=${location.time}"
          )
          persistLocation(applicationContext, location, trackingMode, "live", false)
          accumulateNativeStats(applicationContext, location)
          BgTrackingModule.emitLocation(location, trackingMode, "live", false)
          if (observeIdle(location)) {
            stopTracking("idle", notifyReact = false)
            return
          }
        }
      }
    }
    locationCallback = callback

    try {
      fusedLocationClient.requestLocationUpdates(request, callback, mainLooper)
      Log.d(logTag, "requestLocationUpdates ok mode=$mode")
      seedLastKnownLocation(mode)
    } catch (_: SecurityException) {
      Log.d(logTag, "requestLocationUpdates blocked: permission mode=$mode")
      stopTracking("permission", notifyReact = true)
    }
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
            "seedLastKnown accepted mode=$mode lat=${location.latitude} lng=${location.longitude} " +
              "acc=${location.accuracy} speed=${location.speed} time=${location.time}"
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

  /** A real, reliable standstill ends the trip after ten minutes. GPS silence
   * never enters this path, so tunnels and temporary signal loss stay active. */
  private fun observeIdle(location: Location): Boolean {
    val speedKmh = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null
    val reliable = isReliableLocation(applicationContext, location)
    val stopped = reliable && speedKmh != null && speedKmh < 3.0
    if (!stopped) {
      idleSinceMs = 0L
      return false
    }
    val now = if (location.time > 0L) location.time else System.currentTimeMillis()
    if (idleSinceMs == 0L) {
      idleSinceMs = now
      return false
    }
    return now - idleSinceMs >= 10 * 60_000L
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
    private const val CHANNEL_ID = "wiroom_active_drive_tracking_v2"
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
    private const val MAX_BUFFERED_FIXES = 240
    private const val MAX_STATS_ROUTE_POINTS = 1500
    private const val MAX_STATS_SPEED_SAMPLES = 400
    private const val MAX_ACCURACY_M = 120.0
    private const val MIN_SEGMENT_KM = 0.002
    private const val MAX_SEGMENT_KM = 12.0
    private const val MAX_FIX_GAP_MS = 420_000L
    private const val MIN_SPEED_KMH = 2.0
    // vmax bez limitu — tylko dolny próg próbki
    private const val NATIVE_CHECKPOINT_KM = 0.2
    private const val NATIVE_CHECKPOINT_FORCE_MIN_KM = 0.05
    private const val NATIVE_CHECKPOINT_FORCE_MS = 30_000L
    private val nativeCheckpointLock = Any()
    @Volatile private var nativeCheckpointInFlight = false

    fun start(context: Context) {
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

    private fun readNativeStatsSnapshot(context: Context): JSONObject {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_NATIVE_STATS, null)
      return try {
        if (raw.isNullOrBlank()) emptyNativeStats() else JSONObject(raw)
      } catch (_: Exception) {
        emptyNativeStats()
      }
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
      val speedKmh = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null

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

      var acceptedMovement = false
      if (hasLast && accurateEnough) {
        val dt = now - lastTime
        val segmentKm = haversineKm(lastLat, lastLon, lat, lon)
        val speedOk = speedKmh == null || speedKmh >= minSpeed
        if (dt > 0L && dt <= MAX_FIX_GAP_MS && segmentKm >= MIN_SEGMENT_KM && speedOk) {
          if (segmentKm <= maxSegment) {
            acceptedMovement = true
            stats.put("distanceKm", stats.optDouble("distanceKm", 0.0) + segmentKm)
            val route = stats.optJSONArray("routePoints") ?: JSONArray()
            if (route.length() == 0) {
              route.put(JSONObject().put("latitude", lastLat).put("longitude", lastLon))
            }
            route.put(JSONObject().put("latitude", lat).put("longitude", lon))
            while (route.length() > MAX_STATS_ROUTE_POINTS) route.remove(0)
            stats.put("routePoints", route)
          } else {
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

      if (acceptedMovement && speedKmh != null && speedKmh >= 1.0) {
        val samples = stats.optJSONArray("speedSamples") ?: JSONArray()
        samples.put(speedKmh)
        while (samples.length() > MAX_STATS_SPEED_SAMPLES) samples.remove(0)
        stats.put("speedSamples", samples)
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

    private fun emptyNativeStats(): JSONObject =
      JSONObject()
        .put("distanceKm", 0.0)
        .put("routePoints", JSONArray())
        .put("speedSamples", JSONArray())
        .put("maxSpeedKmh", 0.0)
        .put("lastServerCheckpointKm", 0.0)
        .put("lastCheckpointAttemptAt", 0L)
        .put("tripSessionId", JSONObject.NULL)

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
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_NATIVE_STATS, updatedStats.toString())
        .apply()

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
