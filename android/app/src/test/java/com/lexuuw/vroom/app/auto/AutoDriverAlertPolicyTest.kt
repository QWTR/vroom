package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoDriverAlertPolicyTest {
    @Test fun `camera threshold grows at road speed`() {
        assertEquals(600.0, AutoDriverAlertPolicy.thresholdMeters("speed_camera", 45.0), 0.01)
        assertEquals(1_000.0, AutoDriverAlertPolicy.thresholdMeters("speed_camera", 90.0), 0.01)
    }

    @Test fun `alert ahead is selected and alert behind is rejected`() {
        assertNotNull(AutoDriverAlertPolicy.select(payload(warningLat = 52.005, heading = 0.0)))
        assertNull(AutoDriverAlertPolicy.select(payload(warningLat = 51.995, heading = 0.0)))
    }

    @Test fun `cooldown opens only after configured interval`() {
        assertEquals(false, AutoDriverAlertPolicy.isCooldownReady(10_000L, 20_000L, 90_000L))
        assertEquals(true, AutoDriverAlertPolicy.isCooldownReady(10_000L, 100_000L, 90_000L))
    }

    @Test fun `critical incident wins over a nearer camera`() {
        val base = payload(warningLat = 52.004, heading = 0.0)
        val withCamera = base.copy(
            speedCameras = listOf(AutoPoiMarker("camera", 52.001, 21.0, "Radar", "fixed", "")),
        )
        val selected = AutoDriverAlertPolicy.select(withCamera)
        assertEquals("warning", selected?.id)
        assertEquals("camera", AutoDriverAlertPolicy.selectVoiceEnforcement(withCamera)?.id)
    }

    @Test fun `voice is limited to fixed and section enforcement`() {
        assertTrue(AutoDriverAlertPolicy.shouldSpeak(candidate("fixed", "camera")))
        assertTrue(AutoDriverAlertPolicy.shouldSpeak(candidate("section", "camera")))
        assertEquals("Fotoradar", AutoDriverAlertPolicy.voiceTitle(candidate("fixed", "camera")))
        assertEquals("Odcinkowy pomiar prędkości", AutoDriverAlertPolicy.voiceTitle(candidate("section", "camera")))
        assertFalse(AutoDriverAlertPolicy.shouldSpeak(candidate("mobile", "camera")))
        assertFalse(AutoDriverAlertPolicy.shouldSpeak(candidate("accident", "warning")))
        assertFalse(AutoDriverAlertPolicy.shouldSpeak(candidate("speed_camera", "warning")))
    }

    private fun candidate(type: String, source: String) = AutoDriverAlertCandidate(
        id = "$source:$type",
        type = type,
        title = type,
        lat = 52.0,
        lng = 21.0,
        distanceMeters = 300.0,
        priority = 1,
        source = source,
    )

    private fun payload(warningLat: Double, heading: Double) = VroomPayload(
        isNavigating = false,
        userLat = 52.0,
        userLng = 21.0,
        speed = 12.0,
        heading = heading,
        destinationName = null,
        instruction = null,
        maneuver = null,
        maneuverModifier = null,
        maneuverExit = null,
        followingInstruction = null,
        followingManeuver = null,
        followingManeuverModifier = null,
        followingManeuverExit = null,
        followingTurnDistanceMeters = null,
        upcomingSteps = emptyList(),
        remainingDistanceMeters = null,
        remainingDurationSec = null,
        turnDistanceMeters = null,
        mapState = MapState(null, null, "dark", false, true, false, false, false, false, false, false, false, false, 0, 0, 43.0, 50.0, "arrow", "", null, null, emptyList(), null, null, 0.0, null),
        users = emptyList(),
        warnings = listOf(WarningMarker("warning", warningLat, 21.0, "Wypadek", "accident")),
        speedCameras = emptyList(),
        fuelStations = emptyList(),
        partnerPois = emptyList(),
        routePoints = emptyList(),
    )
}
