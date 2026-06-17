package com.lexuuw.vroom.app.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlin.math.cos
import kotlin.math.sin

private const val AUTO_EARTH_RADIUS_M = 6_371_000.0

object AutoLocationTracker {
    @Volatile private var started = false
    private val handler = Handler(Looper.getMainLooper())
    private var listener: LocationListener? = null
    private var locationManager: LocationManager? = null
    private var smoothLat = Double.NaN
    private var smoothLng = Double.NaN
    private var smoothHeading = 0.0
    private var smoothSpeedKmh = 0.0
    private var stableTargetSpeedKmh = 0.0
    private var smoothRoadArcM = Double.NaN
    private var smoothRoadVersion = -1
    private var lastRawLat = Double.NaN
    private var lastRawLng = Double.NaN
    private var lastRawAt = 0L
    private var lastAcceptedAt = 0L
    private var lastEmitAt = 0L
    private var lastAccuracy = 25f
    private var emitterRunning = false

    private val emitStep = object : Runnable {
        override fun run() {
            if (!started || !smoothLat.isFinite() || !smoothLng.isFinite()) {
                emitterRunning = false
                return
            }
            val now = System.currentTimeMillis()
            val dtSec = ((now - lastEmitAt).coerceIn(1L, 220L)).toDouble() / 1000.0
            lastEmitAt = now
            if (smoothSpeedKmh >= 2.0) {
                val roadStep = NativeRoadMatcher.stepAlongRoad(
                    smoothLat,
                    smoothLng,
                    (smoothSpeedKmh / 3.6) * dtSec
                )
                if (roadStep != null) {
                    smoothLat = roadStep.lat
                    smoothLng = roadStep.lng
                    smoothHeading = lerpHeading(smoothHeading, roadStep.heading, 0.22)
                    smoothRoadArcM = roadStep.arcM
                    smoothRoadVersion = roadStep.roadVersion
                } else {
                    val advanced = pointAhead(smoothLat, smoothLng, smoothHeading, (smoothSpeedKmh / 3.6) * dtSec)
                    smoothLat = advanced.first
                    smoothLng = advanced.second
                }
            }
            VroomCarManager.updateNativePose(
                lat = smoothLat,
                lng = smoothLng,
                speedMs = smoothSpeedKmh / 3.6,
                heading = smoothHeading,
                accuracyMeters = lastAccuracy
            )
            handler.postDelayed(this, 120L)
        }
    }

    @SuppressLint("MissingPermission")
    fun start(context: Context) {
        if (started) return
        val appContext = context.applicationContext
        if (!hasLocationPermission(appContext)) return
        val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        started = true
        locationManager = manager
        ensureEmitter()

        val updateListener = LocationListener { location ->
            handleLocation(location)
        }
        listener = updateListener

        runCatching { manager.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let(::handleLocation) }
        runCatching { manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let(::handleLocation) }
        runCatching {
            manager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                250L,
                0f,
                updateListener,
                Looper.getMainLooper()
            )
        }
        runCatching {
            manager.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                1_200L,
                2f,
                updateListener,
                Looper.getMainLooper()
            )
        }
    }

    fun stop() {
        val manager = locationManager
        val currentListener = listener
        if (manager != null && currentListener != null) {
            runCatching { manager.removeUpdates(currentListener) }
        }
        listener = null
        locationManager = null
        started = false
        smoothLat = Double.NaN
        smoothLng = Double.NaN
        smoothHeading = 0.0
        smoothSpeedKmh = 0.0
        stableTargetSpeedKmh = 0.0
        smoothRoadArcM = Double.NaN
        smoothRoadVersion = -1
        lastRawLat = Double.NaN
        lastRawLng = Double.NaN
        lastRawAt = 0L
        lastAcceptedAt = 0L
        lastEmitAt = 0L
        NativeRoadMatcher.reset()
        handler.removeCallbacks(emitStep)
        emitterRunning = false
    }

    private fun hasLocationPermission(context: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    private fun handleLocation(location: Location) {
        val lat = location.latitude
        val lng = location.longitude
        if (!lat.isFinite() || !lng.isFinite()) return
        val accuracy = if (location.hasAccuracy()) location.accuracy else 25f
        if (accuracy > 80f) return
        lastAccuracy = accuracy

        val now = System.currentTimeMillis()
        if (!smoothLat.isFinite() || !smoothLng.isFinite() || lastAcceptedAt <= 0L) {
            val initialRoadPose = NativeRoadMatcher.snapToRoad(lat, lng, 80.0)
            smoothLat = initialRoadPose?.lat ?: lat
            smoothLng = initialRoadPose?.lng ?: lng
            smoothHeading = cleanHeading(location.bearing.toDouble(), smoothHeading)
            if (initialRoadPose != null) {
                smoothHeading = initialRoadPose.heading
                smoothRoadArcM = initialRoadPose.arcM
                smoothRoadVersion = initialRoadPose.roadVersion
            }
            smoothSpeedKmh = cleanSpeedKmh(location)
            stableTargetSpeedKmh = smoothSpeedKmh
            lastRawLat = lat
            lastRawLng = lng
            lastRawAt = now
            lastAcceptedAt = now
            lastEmitAt = now
            ensureEmitter()
            return
        }

        val previousRawLat = if (lastRawLat.isFinite()) lastRawLat else smoothLat
        val previousRawLng = if (lastRawLng.isFinite()) lastRawLng else smoothLng
        val previousRawAt = if (lastRawAt > 0L) lastRawAt else lastAcceptedAt
        val dtSec = ((now - previousRawAt).coerceAtLeast(1L)).toDouble() / 1000.0
        val moveMeters = distanceMeters(previousRawLat, previousRawLng, lat, lng)
        val moveKmh = if (dtSec > 0.0) (moveMeters / dtSec) * 3.6 else 0.0
        if (moveMeters > 70.0 && moveKmh > 190.0) return

        val rawSpeedKmh = cleanSpeedKmh(location)
        val accuracyStationaryRadius = accuracy.toDouble().coerceIn(4.0, 28.0) * 0.45
        val stationary = moveMeters < accuracyStationaryRadius && moveKmh < 7.0
        val targetSpeedKmh = when {
            rawSpeedKmh >= 4.0 -> rawSpeedKmh
            stationary -> 0.0
            rawSpeedKmh >= 3.0 -> rawSpeedKmh
            moveKmh >= 4.0 -> moveKmh
            else -> 0.0
        }.coerceIn(0.0, 180.0)
        val cleanTargetSpeedKmh = stabilizeTargetSpeed(targetSpeedKmh, dtSec, stationary)
        NativeRoadMatcher.ingest(location, cleanTargetSpeedKmh)

        val rawRoadPose = if (cleanTargetSpeedKmh >= 5.0) {
            NativeRoadMatcher.snapToRoad(lat, lng, if (cleanTargetSpeedKmh >= 45.0) 90.0 else 70.0)
        } else {
            null
        }
        val roadPose = rawRoadPose?.takeUnless {
            smoothRoadVersion == it.roadVersion &&
                smoothRoadArcM.isFinite() &&
                cleanTargetSpeedKmh >= 8.0 &&
                it.arcM < smoothRoadArcM - 5.0
        }
        val blockedBackwardRoadPose = rawRoadPose != null && roadPose == null
        val observedLat = when {
            roadPose != null -> roadPose.lat
            blockedBackwardRoadPose -> smoothLat
            else -> lat
        }
        val observedLng = when {
            roadPose != null -> roadPose.lng
            blockedBackwardRoadPose -> smoothLng
            else -> lng
        }
        val correctionDistance = distanceMeters(smoothLat, smoothLng, observedLat, observedLng)
        val roadTurnDelta = roadPose?.let { headingDeltaAbs(smoothHeading, it.heading) } ?: 0.0
        val positionAlpha = when {
            correctionDistance > 90.0 -> 0.82
            roadPose != null && roadTurnDelta > 32.0 -> 0.34
            roadPose != null && roadTurnDelta > 16.0 -> 0.26
            cleanTargetSpeedKmh < 2.0 -> 0.28
            correctionDistance > 24.0 -> 0.24
            roadPose != null -> 0.16
            cleanTargetSpeedKmh < 25.0 -> 0.18
            else -> 0.12
        }
        smoothLat += (observedLat - smoothLat) * positionAlpha
        smoothLng += (observedLng - smoothLng) * positionAlpha
        smoothSpeedKmh = when {
            cleanTargetSpeedKmh <= 0.5 && smoothSpeedKmh < 8.0 -> smoothSpeedKmh * 0.72
            cleanTargetSpeedKmh > smoothSpeedKmh -> smoothSpeedKmh + (cleanTargetSpeedKmh - smoothSpeedKmh) * 0.22
            else -> smoothSpeedKmh + (cleanTargetSpeedKmh - smoothSpeedKmh) * 0.10
        }.coerceIn(0.0, 180.0)
        if (smoothSpeedKmh >= 3.0) {
            val nextHeading = cleanHeading(
                roadPose?.heading
                    ?: if (location.hasBearing()) location.bearing.toDouble() else bearingDegrees(smoothLat, smoothLng, observedLat, observedLng),
                smoothHeading
            )
            smoothHeading = lerpHeading(
                smoothHeading,
                nextHeading,
                when {
                    roadPose != null && roadTurnDelta > 24.0 -> 0.42
                    roadPose != null -> 0.30
                    smoothSpeedKmh >= 35.0 -> 0.26
                    else -> 0.18
                }
            )
        }
        if (roadPose != null) {
            smoothRoadArcM = if (smoothRoadVersion == roadPose.roadVersion && smoothRoadArcM.isFinite()) {
                kotlin.math.max(smoothRoadArcM, roadPose.arcM)
            } else {
                roadPose.arcM
            }
            smoothRoadVersion = roadPose.roadVersion
        }
        lastRawLat = lat
        lastRawLng = lng
        lastRawAt = now
        lastAcceptedAt = now
        ensureEmitter()
    }

    private fun ensureEmitter() {
        if (emitterRunning) return
        emitterRunning = true
        lastEmitAt = System.currentTimeMillis()
        handler.post(emitStep)
    }

    private fun cleanSpeedKmh(location: Location): Double =
        if (location.hasSpeed()) (location.speed.toDouble() * 3.6).coerceIn(0.0, 180.0) else 0.0

    private fun stabilizeTargetSpeed(targetKmh: Double, dtSec: Double, stationary: Boolean): Double {
        if (!stableTargetSpeedKmh.isFinite()) stableTargetSpeedKmh = 0.0
        if (stationary && targetKmh < 2.0) {
            stableTargetSpeedKmh = when {
                stableTargetSpeedKmh < 6.0 -> stableTargetSpeedKmh * 0.72
                else -> stableTargetSpeedKmh - (18.0 * dtSec).coerceAtMost(stableTargetSpeedKmh)
            }
            return stableTargetSpeedKmh.coerceIn(0.0, 180.0)
        }
        val delta = targetKmh - stableTargetSpeedKmh
        val maxUp = (28.0 * dtSec).coerceAtLeast(1.5)
        val maxDown = (12.0 * dtSec).coerceAtLeast(0.8)
        if (targetKmh < stableTargetSpeedKmh * 0.55 && stableTargetSpeedKmh > 18.0) {
            stableTargetSpeedKmh -= maxDown * 0.45
        } else {
            stableTargetSpeedKmh += delta.coerceIn(-maxDown, maxUp)
        }
        return stableTargetSpeedKmh.coerceIn(0.0, 180.0)
    }

    private fun cleanHeading(value: Double, fallback: Double): Double =
        if (value.isFinite() && value >= 0.0) (value % 360.0 + 360.0) % 360.0 else fallback

    private fun lerpHeading(from: Double, to: Double, alpha: Double): Double {
        val delta = ((to - from + 540.0) % 360.0) - 180.0
        return (from + delta * alpha + 360.0) % 360.0
    }

    private fun headingDeltaAbs(from: Double, to: Double): Double =
        kotlin.math.abs(((to - from + 540.0) % 360.0) - 180.0)

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return AUTO_EARTH_RADIUS_M * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }

    private fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = sin(dLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
    }

    private fun pointAhead(lat: Double, lng: Double, heading: Double, meters: Double): Pair<Double, Double> {
        if (meters <= 0.0) return Pair(lat, lng)
        val bearing = Math.toRadians(heading)
        val latRad = Math.toRadians(lat)
        val ratio = meters / AUTO_EARTH_RADIUS_M
        val nextLat = lat + Math.toDegrees(ratio * cos(bearing))
        val nextLng = lng + Math.toDegrees(ratio * sin(bearing) / cos(latRad).coerceAtLeast(0.15))
        return Pair(nextLat, nextLng)
    }
}
