package com.lexuuw.vroom.app.bg

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.util.concurrent.ConcurrentHashMap

/**
 * Jeden dostawca Fused Location dla jazdy w aplikacji, usługi tła i Android Auto.
 * Konsumenci otrzymują te same fixy, więc dołączenie ekranu samochodowego nie
 * uruchamia kolejnego GPS.
 */
object VroomLocationBroker {
  private const val TAG = "VroomLocationBroker"
  private const val MOVING_INTERVAL_MS = 1_000L
  private const val MOVING_MIN_INTERVAL_MS = 500L
  private const val IDLE_INTERVAL_MS = 3_000L
  private const val IDLE_MIN_INTERVAL_MS = 1_500L
  private const val IDLE_AFTER_MS = 15_000L

  private val consumers = ConcurrentHashMap<String, (Location) -> Unit>()
  private var client: FusedLocationProviderClient? = null
  private var callback: LocationCallback? = null
  private var thread: HandlerThread? = null
  private var appContext: Context? = null
  private var idleProfile = false
  private var lastMovingAt = 0L
  private var latestLocation: Location? = null
  private var fixCount = 0L
  private var providerStartedAt = 0L

  @Synchronized
  fun subscribe(context: Context, owner: String, consumer: (Location) -> Unit) {
    appContext = context.applicationContext
    consumers[owner] = consumer
    latestLocation?.let(consumer)
    if (callback == null) startProvider()
    Log.d(TAG, "subscribe owner=$owner consumers=${consumers.size} provider=${callback != null}")
  }

  @Synchronized
  fun unsubscribe(owner: String) {
    consumers.remove(owner)
    if (consumers.isEmpty()) stopProvider()
    Log.d(TAG, "unsubscribe owner=$owner consumers=${consumers.size} provider=${callback != null}")
  }

  fun latest(maxAgeMs: Long = 5_000L): Location? {
    val location = latestLocation ?: return null
    val ageMs = if (location.elapsedRealtimeNanos > 0L) {
      (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos)
        .coerceAtLeast(0L) / 1_000_000L
    } else {
      System.currentTimeMillis() - location.time
    }
    return location.takeIf { ageMs <= maxAgeMs }
  }

  fun diagnostics(): Map<String, Any> = mapOf(
    "consumerCount" to consumers.size,
    "providerActive" to (callback != null),
    "idleProfile" to idleProfile,
    "fixCount" to fixCount,
    "providerUptimeMs" to if (providerStartedAt > 0L) {
      SystemClock.elapsedRealtime() - providerStartedAt
    } else {
      0L
    },
  )

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun startProvider() {
    val context = appContext ?: return
    if (!hasLocationPermission(context)) return
    if (client == null) client = LocationServices.getFusedLocationProviderClient(context)
    if (thread == null) {
      thread = HandlerThread("VroomLocationBroker").apply { start() }
    }
    val nextCallback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.forEach(::publish)
      }
    }
    callback = nextCallback
    providerStartedAt = SystemClock.elapsedRealtime()
    lastMovingAt = providerStartedAt
    requestUpdates(nextCallback)
    client?.lastLocation?.addOnSuccessListener { it?.let(::publish) }
  }

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun requestUpdates(target: LocationCallback) {
    val context = appContext ?: return
    if (!hasLocationPermission(context)) return
    client?.removeLocationUpdates(target)
    val request = if (idleProfile) {
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, IDLE_INTERVAL_MS)
        .setMinUpdateIntervalMillis(IDLE_MIN_INTERVAL_MS)
        .setMinUpdateDistanceMeters(5f)
        .setGranularity(Granularity.GRANULARITY_FINE)
        .setWaitForAccurateLocation(false)
        .build()
    } else {
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MOVING_INTERVAL_MS)
        .setMinUpdateIntervalMillis(MOVING_MIN_INTERVAL_MS)
        .setMinUpdateDistanceMeters(2f)
        .setGranularity(Granularity.GRANULARITY_FINE)
        .setWaitForAccurateLocation(false)
        .build()
    }
    client?.requestLocationUpdates(request, target, thread?.looper)
      ?.addOnFailureListener { Log.w(TAG, "provider request failed", it) }
  }

  private fun publish(location: Location) {
    latestLocation = location
    fixCount += 1
    val now = SystemClock.elapsedRealtime()
    val moving = location.hasSpeed() && location.speed >= 0.7f
    if (moving) lastMovingAt = now
    val shouldIdle = !moving && now - lastMovingAt >= IDLE_AFTER_MS
    if (shouldIdle != idleProfile) {
      idleProfile = shouldIdle
      callback?.let(::requestUpdates)
      Log.d(TAG, "profile=${if (idleProfile) "idle" else "moving"}")
    }
    consumers.values.forEach { consumer ->
      runCatching { consumer(location) }
        .onFailure { Log.w(TAG, "consumer failed", it) }
    }
  }

  @Synchronized
  private fun stopProvider() {
    callback?.let { client?.removeLocationUpdates(it) }
    callback = null
    latestLocation = null
    idleProfile = false
    providerStartedAt = 0L
    thread?.quitSafely()
    thread = null
  }

  private fun hasLocationPermission(context: Context): Boolean {
    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
    return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
  }
}
