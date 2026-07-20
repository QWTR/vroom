package com.lexuuw.vroom.app.auto

import kotlin.math.max

/** Pure limits used by the Android Auto road pose tracker. */
object AutoRoadPosePolicy {
    fun maximumForwardAdvanceMeters(
        speedKmh: Double,
        fixElapsedSeconds: Double,
        measuredDistanceMeters: Double,
    ): Double {
        val elapsed = fixElapsedSeconds.coerceIn(0.0, 15.0)
        val speedAdvance = (speedKmh.coerceIn(0.0, 180.0) / 3.6) * elapsed
        val measuredAdvance = measuredDistanceMeters.coerceIn(0.0, 600.0)
        return (max(speedAdvance * 1.65, measuredAdvance * 1.35) + 12.0)
            .coerceIn(12.0, 700.0)
    }

    fun shouldHardResync(lagMeters: Double, speedKmh: Double): Boolean {
        if (lagMeters >= 42.0) return true
        val speedMs = (speedKmh.coerceAtLeast(12.0) / 3.6)
        val lagSeconds = lagMeters.coerceAtLeast(0.0) / speedMs
        return lagMeters >= 18.0 && lagSeconds >= 3.0
    }

    fun headingPenalty(angleDeltaDegrees: Double): Double {
        val delta = angleDeltaDegrees.coerceIn(0.0, 180.0)
        return when {
            delta <= 28.0 -> 0.0
            delta <= 65.0 -> (delta - 28.0) * 0.30
            delta <= 110.0 -> 11.1 + (delta - 65.0) * 0.75
            else -> 44.85 + (delta - 110.0) * 1.15
        }
    }
}
