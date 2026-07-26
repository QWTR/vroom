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
    assertEquals(0.0, mapCameraScreenHeading(123.0, 123.0, "courseUp", true), 0.0001)
    assertEquals(123.0, mapCameraScreenHeading(123.0, 0.0, "northUp", true), 0.0001)
    assertEquals(20.0, mapCameraScreenHeading(10.0, 350.0, "free", false), 0.0001)
  }
}
