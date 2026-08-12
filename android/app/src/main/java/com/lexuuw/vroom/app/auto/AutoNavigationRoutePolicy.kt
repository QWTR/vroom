package com.lexuuw.vroom.app.auto

object AutoNavigationRoutePolicy {
    private const val MAX_ROUTE_LOCK_DISTANCE_M = 14.0
    private const val HEADING_DISTANCE_M = 3.0
    private const val HEADING_DELTA_DEG = 45.0
    private const val HARD_HEADING_DELTA_DEG = 60.0
    private const val HEADING_MIN_SPEED_MS = 2.0

    fun shouldKeepRouteLock(
        distanceFromRouteM: Double,
        headingDeltaDeg: Double,
        speedMs: Double,
    ): Boolean {
        if (!distanceFromRouteM.isFinite() || distanceFromRouteM > MAX_ROUTE_LOCK_DISTANCE_M) {
            return false
        }
        if (!headingDeltaDeg.isFinite() || speedMs < HEADING_MIN_SPEED_MS) return true
        if (headingDeltaDeg >= HARD_HEADING_DELTA_DEG && distanceFromRouteM >= 2.0) return false
        return headingDeltaDeg < HEADING_DELTA_DEG || distanceFromRouteM < HEADING_DISTANCE_M
    }
}
