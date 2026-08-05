package com.lexuuw.vroom.app.auto

import kotlin.math.cos

object AutoLocationPolicy {
    fun acceptsJump(
        previousLat: Double,
        previousLng: Double,
        previousAccuracyM: Double,
        previousElapsedMs: Long,
        lat: Double,
        lng: Double,
        accuracyM: Double,
        elapsedMs: Long,
        speedMs: Double,
    ): Boolean {
        if (!validCoordinate(previousLat, previousLng) || previousElapsedMs <= 0L) return true
        val elapsedSeconds = (elapsedMs - previousElapsedMs).toDouble() / 1_000.0
        if (elapsedSeconds !in 0.0..15.0) return true

        val distanceM = distanceMeters(previousLat, previousLng, lat, lng)
        val accuracyAllowance = previousAccuracyM.coerceIn(0.0, 65.0) +
            accuracyM.coerceIn(0.0, 65.0)
        val motionAllowance = speedMs.coerceIn(0.0, 55.0) * elapsedSeconds * 1.8
        val allowedDistanceM = (35.0 + accuracyAllowance + motionAllowance).coerceAtLeast(55.0)
        return distanceM <= allowedDistanceM
    }

    fun maxRoadSnapDistance(accuracyM: Double, speedMs: Double): Double {
        val accuracyBased = (accuracyM.coerceIn(3.0, 40.0) * 1.45).coerceAtLeast(9.0)
        val cap = if (speedMs >= 12.5) 34.0 else 26.0
        return accuracyBased.coerceAtMost(cap)
    }

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() &&
            lat in -90.0..90.0 && lng in -180.0..180.0

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val earthRadiusM = 6_371_000.0
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return earthRadiusM * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }
}
