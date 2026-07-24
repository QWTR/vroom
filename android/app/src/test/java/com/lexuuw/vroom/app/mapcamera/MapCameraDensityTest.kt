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
}
