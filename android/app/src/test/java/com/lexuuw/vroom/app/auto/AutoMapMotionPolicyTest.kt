package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoMapMotionPolicyTest {
    @Test fun `pose loop adapts to motion and interaction`() {
        assertEquals(66L, AutoMapMotionPolicy.poseFrameDelayMs(0.0, false, false))
        assertEquals(33L, AutoMapMotionPolicy.poseFrameDelayMs(5.0, false, false))
        assertEquals(16L, AutoMapMotionPolicy.poseFrameDelayMs(40.0, false, false))
        assertEquals(16L, AutoMapMotionPolicy.poseFrameDelayMs(0.0, true, false))
        assertEquals(33L, AutoMapMotionPolicy.poseFrameDelayMs(0.0, false, true))
    }

    @Test fun `camera crosses north using the shortest turn`() {
        val next = AutoMapMotionPolicy.smoothBearing(
            current = 359.0,
            target = 1.0,
            elapsedSeconds = 0.1,
            responseSeconds = 0.3,
            maxDegreesPerSecond = 120.0,
        )
        assertTrue(next > 359.0 || next < 1.0)
        assertTrue(kotlin.math.abs(AutoMapMotionPolicy.shortestBearingDelta(next, 1.0)) < 2.0)
    }

    @Test fun `camera turn is rate limited instead of jumping`() {
        val next = AutoMapMotionPolicy.smoothBearing(
            current = 0.0,
            target = 180.0,
            elapsedSeconds = 0.1,
            responseSeconds = 0.25,
            maxDegreesPerSecond = 90.0,
        )
        assertEquals(9.0, AutoMapMotionPolicy.shortestBearingDelta(0.0, next), 0.001)
    }

    @Test fun `moving gps without route progress releases route lock`() {
        assertTrue(AutoMapMotionPolicy.navigationRouteIsStalled(8.0, 2_500L, 5.0))
        assertFalse(AutoMapMotionPolicy.navigationRouteIsStalled(8.0, 1_000L, 5.0))
        assertFalse(AutoMapMotionPolicy.navigationRouteIsStalled(8.0, 5_000L, 0.5))
    }

    @Test fun `small arc noise is not route progress`() {
        assertFalse(AutoMapMotionPolicy.hasMeaningfulRouteProgress(100.0, 100.4))
        assertTrue(AutoMapMotionPolicy.hasMeaningfulRouteProgress(100.0, 101.0))
    }
}
