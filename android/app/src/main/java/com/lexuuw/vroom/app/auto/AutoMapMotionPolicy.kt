package com.lexuuw.vroom.app.auto

import kotlin.math.abs
import kotlin.math.exp

/** Pure motion rules shared by the Android Auto marker and follow camera. */
object AutoMapMotionPolicy {
    fun poseFrameDelayMs(speedKmh: Double, userBrowsing: Boolean, routePreview: Boolean): Long {
        if (userBrowsing) return 16L
        val speed = if (speedKmh.isFinite()) speedKmh.coerceAtLeast(0.0) else 0.0
        if (speed >= 10.0) return 16L
        if (speed >= 1.0 || routePreview) return 33L
        return 66L
    }

    fun normalizeBearing(value: Double): Double =
        ((value % 360.0) + 360.0) % 360.0

    fun shortestBearingDelta(from: Double, to: Double): Double {
        var delta = normalizeBearing(to) - normalizeBearing(from)
        if (delta > 180.0) delta -= 360.0
        if (delta < -180.0) delta += 360.0
        return delta
    }

    fun smoothBearing(
        current: Double,
        target: Double,
        elapsedSeconds: Double,
        responseSeconds: Double,
        maxDegreesPerSecond: Double,
    ): Double {
        if (!current.isFinite()) return normalizeBearing(target)
        if (!target.isFinite()) return normalizeBearing(current)
        val dt = elapsedSeconds.coerceIn(0.0, 0.25)
        if (dt <= 0.0) return normalizeBearing(current)
        val response = responseSeconds.coerceAtLeast(0.05)
        val alpha = 1.0 - exp(-dt / response)
        val delta = shortestBearingDelta(current, target)
        val easedStep = delta * alpha
        val maxStep = maxDegreesPerSecond.coerceAtLeast(1.0) * dt
        return normalizeBearing(current + easedStep.coerceIn(-maxStep, maxStep))
    }

    fun navigationRouteIsStalled(
        distanceWithoutProgressM: Double,
        millisecondsWithoutProgress: Long,
        speedMs: Double,
    ): Boolean {
        if (!distanceWithoutProgressM.isFinite() || !speedMs.isFinite()) return false
        if (speedMs < 1.5) return false
        return distanceWithoutProgressM >= 7.0 && millisecondsWithoutProgress >= 2_200L
    }

    fun hasMeaningfulRouteProgress(previousArcM: Double, nextArcM: Double): Boolean {
        if (!previousArcM.isFinite() || !nextArcM.isFinite()) return true
        return nextArcM - previousArcM >= 0.65
    }

    fun bearingSettled(current: Double, target: Double, epsilonDegrees: Double = 0.05): Boolean =
        abs(shortestBearingDelta(current, target)) <= epsilonDegrees
}
