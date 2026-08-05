package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoLocationPolicyTest {
    @Test
    fun `rejects a sudden gps jump`() {
        assertFalse(
            AutoLocationPolicy.acceptsJump(
                previousLat = 52.2297,
                previousLng = 21.0122,
                previousAccuracyM = 8.0,
                previousElapsedMs = 10_000L,
                lat = 52.2337,
                lng = 21.0192,
                accuracyM = 8.0,
                elapsedMs = 11_000L,
                speedMs = 12.0,
            ),
        )
    }

    @Test
    fun `accepts normal movement and reacquisition after a long gap`() {
        assertTrue(
            AutoLocationPolicy.acceptsJump(
                52.2297, 21.0122, 8.0, 10_000L,
                52.22985, 21.01235, 8.0, 11_000L, 15.0,
            ),
        )
        assertTrue(
            AutoLocationPolicy.acceptsJump(
                52.2297, 21.0122, 8.0, 10_000L,
                52.2400, 21.0300, 8.0, 30_000L, 0.0,
            ),
        )
    }

    @Test
    fun `road snapping stays close enough to avoid parallel streets`() {
        assertTrue(AutoLocationPolicy.maxRoadSnapDistance(5.0, 3.0) <= 10.0)
        assertTrue(AutoLocationPolicy.maxRoadSnapDistance(30.0, 5.0) <= 26.0)
        assertTrue(AutoLocationPolicy.maxRoadSnapDistance(30.0, 25.0) <= 34.0)
    }
}
