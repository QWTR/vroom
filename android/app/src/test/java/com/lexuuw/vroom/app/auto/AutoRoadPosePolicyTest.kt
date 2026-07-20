package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoRoadPosePolicyTest {
    @Test fun `slow payload updates do not cap a real five second gps jump`() {
        val allowed = AutoRoadPosePolicy.maximumForwardAdvanceMeters(
            speedKmh = 100.0,
            fixElapsedSeconds = 5.0,
            measuredDistanceMeters = 139.0,
        )
        assertTrue(allowed >= 180.0)
    }

    @Test fun `large or multi second lag triggers hard resync`() {
        assertTrue(AutoRoadPosePolicy.shouldHardResync(45.0, 90.0))
        assertTrue(AutoRoadPosePolicy.shouldHardResync(20.0, 20.0))
        assertFalse(AutoRoadPosePolicy.shouldHardResync(8.0, 90.0))
    }

    @Test fun `opposite segment is strongly penalized`() {
        assertTrue(AutoRoadPosePolicy.headingPenalty(150.0) > AutoRoadPosePolicy.headingPenalty(20.0) + 50.0)
    }
}
