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
  private const val MAX_UPDATE_DELAY_MS = 5_000L

  private val consumers = ConcurrentHashMap<String, (Location) -> Unit>()
  private var client: FusedLocationProviderClient? = null
  private var callback: LocationCallback? = null
  private var thread: HandlerThread? = null
  private var appContext: Context? = null
  private var latestLocation: Location? = null
  private var fixCount = 0L
  private var rejectedFixCount = 0L
  private var lastFixNanos = 0L
  private val immediateOwners = mutableSetOf<String>()
  private var providerStartedAt = 0L
  private var requestGeneration = 0L

  @Synchronized
  fun subscribe(context: Context, owner: String, immediateDelivery: Boolean = false, consumer: (Location) -> Unit) {
    appContext = context.applicationContext
    consumers[owner] = consumer
    if (immediateDelivery) setImmediateDelivery(owner, true)
    latest()?.let(consumer)
    if (callback == null) startProvider()
    Log.d(TAG, "subscribe owner=$owner consumers=${consumers.size} provider=${callback != null}")
  }

  @Synchronized
  fun unsubscribe(owner: String) {
    consumers.remove(owner)
    setImmediateDelivery(owner, false)
    if (consumers.isEmpty()) stopProvider()
    Log.d(TAG, "unsubscribe owner=$owner consumers=${consumers.size} provider=${callback != null}")
  }

  @Synchronized
  fun setImmediateDelivery(owner: String, visible: Boolean) {
    val wasImmediate = immediateOwners.isNotEmpty()
    if (visible) immediateOwners.add(owner) else immediateOwners.remove(owner)
    if (wasImmediate != immediateOwners.isNotEmpty()) callback?.let(::requestUpdates)
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
    "idleProfile" to false,
    "fixCount" to fixCount,
    "rejectedFixCount" to rejectedFixCount,
    "immediateDelivery" to immediateOwners.isNotEmpty(),
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
        if (callback !== this) return
        result.locations.sortedBy { location ->
          if (location.elapsedRealtimeNanos > 0L) location.elapsedRealtimeNanos else location.time * 1_000_000L
        }.forEach { publish(it, this) }
      }
    }
    callback = nextCallback
    providerStartedAt = SystemClock.elapsedRealtime()
    requestUpdates(nextCallback)
    client?.lastLocation?.addOnSuccessListener { location ->
      if (location != null && System.currentTimeMillis() - location.time <= 5_000L) publish(location, nextCallback)
    }
  }

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun requestUpdates(target: LocationCallback) {
    val context = appContext ?: return
    if (!hasLocationPermission(context)) return
    val generation = ++requestGeneration
    // The broker only exists while a drive or Android Auto session is active.
    // Downgrading to BALANCED after a short traffic stop made several OEMs keep
    // that low-power request throttled after the screen was locked. Keep the
    // automotive request accurate, but allow short batches so every intermediate
    // fix (and therefore every bend in the route) survives screen-off/Doze.
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MOVING_INTERVAL_MS)
      .setMinUpdateIntervalMillis(MOVING_MIN_INTERVAL_MS)
      .setMinUpdateDistanceMeters(2f)
      .setMaxUpdateAgeMillis(0L)
      .setMaxUpdateDelayMillis(if (immediateOwners.isNotEmpty()) 0L else MAX_UPDATE_DELAY_MS)
      .setGranularity(Granularity.GRANULARITY_FINE)
      .setWaitForAccurateLocation(false)
      .build()
    val provider = client ?: return
    provider.removeLocationUpdates(target).addOnCompleteListener {
      synchronized(this) {
        if (generation == requestGeneration && callback === target && consumers.isNotEmpty()) {
          provider.requestLocationUpdates(request, target, thread?.looper)
            .addOnFailureListener { Log.w(TAG, "provider request failed", it) }
        }
      }
    }
  }

  private fun publish(location: Location, source: LocationCallback) {
    val recipients = synchronized(this) {
      if (callback !== source) return
      val fixNanos = if (location.elapsedRealtimeNanos > 0L) location.elapsedRealtimeNanos else {
        SystemClock.elapsedRealtimeNanos() - (System.currentTimeMillis() - location.time).coerceAtLeast(0L) * 1_000_000L
      }
      if (fixNanos <= lastFixNanos) {
        rejectedFixCount += 1
        return
      }
      lastFixNanos = fixNanos
      latestLocation = location
      fixCount += 1
      consumers.values.toList()
    }
    // Consumers can stop/reconfigure tracking; never call them under the broker lock.
    recipients.forEach { consumer ->
      runCatching { consumer(location) }
        .onFailure { Log.w(TAG, "consumer failed", it) }
    }
  }

  @Synchronized
  private fun stopProvider() {
    requestGeneration += 1
    callback?.let { client?.removeLocationUpdates(it) }
    callback = null
    latestLocation = null
    lastFixNanos = 0L
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
