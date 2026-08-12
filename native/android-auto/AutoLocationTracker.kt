package __PACKAGE__.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import __PACKAGE__.bg.VroomLocationBroker

object AutoLocationTracker {
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var started = false
    @Volatile private var pausedForSimulation = false
    @Volatile private var latestLat = Double.NaN
    @Volatile private var latestLng = Double.NaN
    @Volatile private var latestSpeedMs = 0.0
    @Volatile private var latestHeading = 0.0
    @Volatile private var latestElapsedMs = 0L
    @Volatile private var latestAccuracyM = Double.NaN

    data class Pose(
        val lat: Double,
        val lng: Double,
        val speedMs: Double,
        val heading: Double,
        val ageMs: Long
    )

    fun pauseForSimulation() {
        pausedForSimulation = true
    }

    fun resumeFromSimulation() {
        pausedForSimulation = false
    }

    @SuppressLint("MissingPermission")
    fun start(context: Context) {
        if (started) return
        val appContext = context.applicationContext
        if (!hasFineLocationPermission(appContext)) return

        NativeRoadMatcher.reset()
        started = true
        VroomLocationBroker.subscribe(appContext, BROKER_OWNER) { location ->
            handleLocation(appContext, location)
        }
    }

    fun stop() {
        VroomLocationBroker.unsubscribe(BROKER_OWNER)
        started = false
        latestLat = Double.NaN
        latestLng = Double.NaN
        latestSpeedMs = 0.0
        latestHeading = 0.0
        latestElapsedMs = 0L
        latestAccuracyM = Double.NaN
        NativeRoadMatcher.reset()
    }

    fun lastKnownPose(maxAgeMs: Long = 5_000L): Pose? {
        if (!validCoordinate(latestLat, latestLng)) return null
        val ageMs = if (latestElapsedMs > 0L) SystemClock.elapsedRealtime() - latestElapsedMs else Long.MAX_VALUE
        if (ageMs > maxAgeMs) return null
        return Pose(latestLat, latestLng, latestSpeedMs, latestHeading, ageMs)
    }

    fun hasFineLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun handleLocation(context: Context, location: Location) {
        if (pausedForSimulation || AutoDriveSimulator.isRunning()) return
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
        val sampleElapsedMs = sampleElapsedNanos / 1_000_000L
        if (!AutoLocationPolicy.acceptsJump(
                previousLat = latestLat,
                previousLng = latestLng,
                previousAccuracyM = latestAccuracyM,
                previousElapsedMs = latestElapsedMs,
                lat = lat,
                lng = lng,
                accuracyM = accuracy.toDouble(),
                elapsedMs = sampleElapsedMs,
                speedMs = speedMs,
            )
        ) return
        val heading = location.bearing.toDouble()
            .takeIf { location.hasBearing() && it.isFinite() && speedMs >= 0.8 }
            ?.let(::normalizeHeading)
            ?: latestHeading

        latestLat = lat
        latestLng = lng
        latestSpeedMs = speedMs
        latestHeading = heading
        latestElapsedMs = sampleElapsedMs
        latestAccuracyM = accuracy.toDouble()

        NativeRoadMatcher.ingest(location, speedMs * 3.6)
        val roadPose = NativeRoadMatcher.snapToRoad(
            lat,
            lng,
            AutoLocationPolicy.maxRoadSnapDistance(accuracy.toDouble(), speedMs)
        )
        val displayLat = roadPose?.lat ?: lat
        val displayLng = roadPose?.lng ?: lng
        val displayHeading = roadPose?.heading ?: heading

        AutoNavStore.onNativeLocationUpdate(
            context = context,
            rawLat = lat,
            rawLng = lng,
            displayLat = displayLat,
            displayLng = displayLng,
            accuracyM = accuracy.toDouble(),
            speedMs = speedMs,
            headingDeg = displayHeading,
            snapSource = if (roadPose != null) "native_osrm" else "raw",
            snapAgeMs = 0L,
        )
        AutoNavStore.refreshFromBackendIfNeeded(context)

        mainHandler.post {
            VroomCarManager.updateNativePose(
                // Route progress and off-route detection must use the measured GPS fix.
                // Feeding the road-matched pose here can pin navigation to a stale road
                // after the driver takes a different turn.
                lat = lat,
                lng = lng,
                speedMs = speedMs,
                heading = heading,
                accuracyMeters = accuracy
            )
        }
    }

    private fun normalizeHeading(value: Double): Double =
        value.takeIf { it.isFinite() }
            ?.let { (it % 360.0 + 360.0) % 360.0 }
            ?: 0.0

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() &&
            lat in -90.0..90.0 && lng in -180.0..180.0 &&
            !(kotlin.math.abs(lat) < 1e-6 && kotlin.math.abs(lng) < 1e-6)

    private const val BROKER_OWNER = "android_auto"
}
