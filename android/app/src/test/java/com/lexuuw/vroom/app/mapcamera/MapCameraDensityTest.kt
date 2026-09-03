package com.lexuuw.vroom.app.mapcamera

import org.junit.Assert.assertEquals
import org.junit.Test

class MapCameraDensityTest {
  @Test fun convertsDpToPhysicalPixelsAcrossCommonDensities() {
    assertEquals(120.0, mapCameraDpToPx(120.0, 1.0), 0.0001)
    assertEquals(240.0, mapCameraDpToPx(120.0, 2.0), 0.0001)
    assertEquals(360.0, mapCameraDpToPx(120.0, 3.0), 0.0001)
  }

  @Test fun clampsInvalidNegativePadding() {
    assertEquals(0.0, mapCameraDpToPx(-20.0, 3.0), 0.0001)
  }

  @Test fun rasterizesArrowAtLogicalSizeTimesDensity() {
    assertEquals(74, mapCameraArrowPixelSize(74, 1f))
    assertEquals(148, mapCameraArrowPixelSize(74, 2f))
    assertEquals(222, mapCameraArrowPixelSize(74, 3f))
  }

  @Test fun headingUsesShortestPathAcrossNorth() {
    assertEquals(2.0, mapCameraShortestHeadingDelta(359.0, 1.0), 0.0001)
    assertEquals(-2.0, mapCameraShortestHeadingDelta(1.0, 359.0), 0.0001)
  }

  @Test fun derivesScreenHeadingForEveryCameraMode() {
    assertEquals(0.0, mapCameraScreenHeading(123.0, 123.0), 0.0001)
    assertEquals(123.0, mapCameraScreenHeading(123.0, 0.0), 0.0001)
    assertEquals(20.0, mapCameraScreenHeading(10.0, 350.0), 0.0001)
    assertEquals(330.0, mapCameraScreenHeading(90.0, 120.0), 0.0001)
  }

  @Test fun cameraCenterFilterKeepsMovingErrorWithinThreeQuartersMeter() {
    val targetLat = 51.0
    val targetLng = 19.0
    val filtered = mapCameraAdvanceCenter(
      currentLat = targetLat - 0.0001,
      currentLng = targetLng,
      targetLat = targetLat,
      targetLng = targetLng,
      targetHeading = 0.0,
      speedMps = 13.9,
      dtMs = 16.67,
    )
    val errorM = mapCameraDistanceMeters(filtered.latitude, filtered.longitude, targetLat, targetLng)
    assert(errorM <= 0.7501)
  }

  @Test fun cameraCenterFilterKeepsStoppedErrorWithinQuarterMeter() {
    val targetLat = 51.0
    val targetLng = 19.0
    val filtered = mapCameraAdvanceCenter(
      currentLat = targetLat - 0.0001,
      currentLng = targetLng,
      targetLat = targetLat,
      targetLng = targetLng,
      targetHeading = 0.0,
      speedMps = 0.0,
      dtMs = 16.67,
    )
    val errorM = mapCameraDistanceMeters(filtered.latitude, filtered.longitude, targetLat, targetLng)
    assert(errorM <= 0.2501)
  }

  @Test fun bearingFilterCrossesNorthByTheShortestArcAndIgnoresMicroNoise() {
    val acrossNorth = mapCameraAdvanceBearing(359.0, 1.0, 16.67)
    assert(mapCameraShortestHeadingDelta(359.0, acrossNorth) > 0.0)
    assert(mapCameraShortestHeadingDelta(359.0, acrossNorth) < 2.0)
    assertEquals(42.0, mapCameraAdvanceBearing(42.0, 42.2, 16.67), 0.0001)
  }
}
