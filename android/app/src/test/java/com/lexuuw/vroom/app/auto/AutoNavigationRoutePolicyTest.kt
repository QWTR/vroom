package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoNavigationRoutePolicyTest {
    @Test
    fun `releases route lock after taking another road`() {
        assertFalse(
            AutoNavigationRoutePolicy.shouldKeepRouteLock(
                distanceFromRouteM = 18.0,
                headingDeltaDeg = 15.0,
                speedMs = 8.0,
            ),
        )
        assertFalse(
            AutoNavigationRoutePolicy.shouldKeepRouteLock(
                distanceFromRouteM = 4.0,
                headingDeltaDeg = 70.0,
                speedMs = 8.0,
            ),
        )
    }

    @Test
    fun `keeps route lock for normal gps noise`() {
        assertTrue(
            AutoNavigationRoutePolicy.shouldKeepRouteLock(
                distanceFromRouteM = 8.0,
                headingDeltaDeg = 12.0,
                speedMs = 8.0,
            ),
        )
        assertTrue(
            AutoNavigationRoutePolicy.shouldKeepRouteLock(
                distanceFromRouteM = 4.0,
                headingDeltaDeg = 100.0,
                speedMs = 0.5,
            ),
        )
    }
}
