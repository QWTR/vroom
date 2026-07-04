package com.lexuuw.vroom.app.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

object AutoLocationTracker {
    @Volatile private var started = false
    private var fusedClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    @Volatile private var latestLat = Double.NaN
    @Volatile private var latestLng = Double.NaN
    @Volatile private var latestSpeedMs = 0.0
    @Volatile private var latestHeading = 0.0

    data class Pose(
        val lat: Double,
        val lng: Double,
        val speedMs: Double,
        val heading: Double
    )

    @SuppressLint("MissingPermission")
    fun start(context: Context) {
        if (started) return
        val appContext = context.applicationContext
        if (!hasFineLocationPermission(appContext)) return

        val client = LocationServices.getFusedLocationProviderClient(appContext)
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { location -> handleLocation(appContext, location) }
            }
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 200L)
            .setMinUpdateIntervalMillis(100L)
            .setMinUpdateDistanceMeters(0f)
            .setGranularity(Granularity.GRANULARITY_FINE)
            .setWaitForAccurateLocation(false)
            .setMaxUpdateDelayMillis(0L)
            .build()

        NativeRoadMatcher.reset()
        started = true
        fusedClient = client
        locationCallback = callback

        client.lastLocation.addOnSuccessListener { location ->
            if (location != null) handleLocation(appContext, location)
        }
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
            .addOnFailureListener { stop() }
    }

    fun stop() {
        val client = fusedClient
        val callback = locationCallback
        if (client != null && callback != null) {
            runCatching { client.removeLocationUpdates(callback) }
        }
        locationCallback = null
        fusedClient = null
        started = false
        latestLat = Double.NaN
        latestLng = Double.NaN
        latestSpeedMs = 0.0
        latestHeading = 0.0
        NativeRoadMatcher.reset()
    }

    fun lastKnownPose(): Pose? {
        if (!validCoordinate(latestLat, latestLng)) return null
        return Pose(latestLat, latestLng, latestSpeedMs, latestHeading)
    }

    private fun hasFineLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun handleLocation(context: Context, location: Location) {
        val nowElapsedNanos = SystemClock.elapsedRealtimeNanos()
        val sampleElapsedNanos = location.elapsedRealtimeNanos.takeIf { it > 0L } ?: nowElapsedNanos
        val ageMs = (nowElapsedNanos - sampleElapsedNanos).coerceAtLeast(0L) / 1_000_000L
        if (ageMs > 1_500L) return

        val lat = location.latitude
        val lng = location.longitude
        if (!validCoordinate(lat, lng)) return
        val accuracy = if (location.hasAccuracy()) location.accuracy else Float.POSITIVE_INFINITY
        if (!accuracy.isFinite() || accuracy > 65f) return

        val speedMs = location.speed.toDouble()
            .takeIf { location.hasSpeed() && it.isFinite() && it >= 0.0 }
            ?.coerceIn(0.0, 70.0)
            ?: 0.0
        val heading = location.bearing.toDouble()
            .takeIf { location.hasBearing() && it.isFinite() && speedMs >= 0.8 }
            ?.let(::normalizeHeading)
            ?: latestHeading

        latestLat = lat
        latestLng = lng
        latestSpeedMs = speedMs
        latestHeading = heading

        AutoNavStore.onNativeLocationUpdate(context, lat, lng, speedMs, heading)
        AutoNavStore.refreshFromBackendIfNeeded(context)
        NativeRoadMatcher.ingest(location, speedMs * 3.6)
        val roadPose = NativeRoadMatcher.snapToRoad(
            lat,
            lng,
            if (speedMs >= 12.5) 95.0 else 75.0
        )

        VroomCarManager.updateNativePose(
            lat = roadPose?.lat ?: lat,
            lng = roadPose?.lng ?: lng,
            speedMs = speedMs,
            heading = roadPose?.heading ?: heading,
            accuracyMeters = accuracy
        )
    }

    private fun normalizeHeading(value: Double): Double =
        value.takeIf { it.isFinite() }
            ?.let { (it % 360.0 + 360.0) % 360.0 }
            ?: 0.0

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() &&
            lat in -90.0..90.0 && lng in -180.0..180.0 &&
            !(kotlin.math.abs(lat) < 1e-6 && kotlin.math.abs(lng) < 1e-6)
}
