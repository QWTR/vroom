package com.lexuuw.vroom.app.auto

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object AutoDriveSimulator {
    private const val SIM_SPEED_MS = 13.89
    private const val TICK_MS = 50L
    private const val TRIP_SYNC_MS = 1_500L

    private val handler = Handler(Looper.getMainLooper())
    private var tickRunnable: Runnable? = null
    private var routePoints: List<Pair<Double, Double>> = emptyList()
    private var segmentIndex = 0
    private var segmentProgress = 0.0
    @Volatile private var running = false
    private var lastTripSyncAt = 0L

    fun isRunning(): Boolean = running

    fun start(context: CarContext) {
        stop()
        val payload = VroomCarManager.latestPayload() ?: return
        routePoints = payload.routePoints.map { it.lat to it.lng }
        if (routePoints.size < 2) return

        running = true
        lastTripSyncAt = 0L
        AutoLocationTracker.pauseForSimulation()
        VroomCarManager.setSimulationMode(true)
        NativeRoadMatcher.reset()

        segmentIndex = 0
        segmentProgress = 0.0
        val first = routePoints.first()
        VroomCarManager.updateNativePose(
            lat = first.first,
            lng = first.second,
            speedMs = SIM_SPEED_MS,
            heading = bearingDeg(first.first, first.second, routePoints[1].first, routePoints[1].second),
            accuracyMeters = 3f,
            fromSimulation = true,
        )

        tickRunnable = object : Runnable {
            override fun run() {
                if (!running) return
                advance(context)
                handler.postDelayed(this, TICK_MS)
            }
        }
        handler.postDelayed(tickRunnable!!, TICK_MS)
    }

    fun stop() {
        running = false
        tickRunnable?.let { handler.removeCallbacks(it) }
        tickRunnable = null
        routePoints = emptyList()
        segmentIndex = 0
        segmentProgress = 0.0
        lastTripSyncAt = 0L
        VroomCarManager.setSimulationMode(false)
        AutoLocationTracker.resumeFromSimulation()
    }

    private fun advance(context: CarContext) {
        if (routePoints.size < 2) {
            stop()
            return
        }
        if (segmentIndex >= routePoints.size - 1) {
            val last = routePoints.last()
            VroomCarManager.updateNativePose(last.first, last.second, 0.0, 0.0, 3f, fromSimulation = true)
            AutoNavigationCoordinator.syncTripFromLatest(context)
            stop()
            return
        }

        val from = routePoints[segmentIndex]
        val to = routePoints[segmentIndex + 1]
        val segM = distanceMeters(from.first, from.second, to.first, to.second).coerceAtLeast(0.5)
        val stepM = SIM_SPEED_MS * (TICK_MS / 1000.0)
        segmentProgress += stepM / segM
        while (segmentProgress >= 1.0 && segmentIndex < routePoints.size - 2) {
            segmentProgress -= 1.0
            segmentIndex++
        }
        if (segmentIndex >= routePoints.size - 1) {
            val last = routePoints.last()
            VroomCarManager.updateNativePose(last.first, last.second, 0.0, 0.0, 3f, fromSimulation = true)
            AutoNavigationCoordinator.syncTripFromLatest(context)
            stop()
            return
        }

        val a = routePoints[segmentIndex]
        val b = routePoints[segmentIndex + 1]
        val t = segmentProgress.coerceIn(0.0, 1.0)
        val lat = a.first + (b.first - a.first) * t
        val lng = a.second + (b.second - a.second) * t
        val heading = bearingDeg(a.first, a.second, b.first, b.second)
        VroomCarManager.updateNativePose(lat, lng, SIM_SPEED_MS, heading, 3f, fromSimulation = true)

        val now = System.currentTimeMillis()
        if (now - lastTripSyncAt >= TRIP_SYNC_MS) {
            lastTripSyncAt = now
            AutoNavigationCoordinator.syncTripFromLatest(context)
        }
    }

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val earthRadiusM = 6_371_000.0
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = sin(dLat / 2.0) * sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * sin(dLng / 2.0) * sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return earthRadiusM * 2.0 * atan2(sqrt(clamped), sqrt(1.0 - clamped))
    }

    private fun bearingDeg(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = sin(dLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return ((Math.toDegrees(atan2(y, x)) % 360.0) + 360.0) % 360.0
    }
}
