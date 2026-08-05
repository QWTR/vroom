package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertTrue
import org.junit.Test

class AutoViewportPolicyTest {
    @Test
    fun `free drive marker stays between 70 and 73 percent`() {
        listOf(0.0, 50.0, 100.0, 140.0).forEach { speed ->
            val spec = AutoViewportPolicy.resolve(800, 480, null, null, speed, false, null)
            val ratio = AutoViewportPolicy.projectedAnchorY(spec, 480) / 480.0
            assertTrue("speed=$speed ratio=$ratio", ratio in 0.699..0.731)
        }
    }

    @Test
    fun `navigation marker stays between 73 and 76 percent`() {
        listOf(0.0, 50.0, 100.0, 140.0).forEach { speed ->
            val spec = AutoViewportPolicy.resolve(1280, 720, null, null, speed, true, null)
            val ratio = AutoViewportPolicy.projectedAnchorY(spec, 720) / 720.0
            assertTrue("speed=$speed ratio=$ratio", ratio in 0.729..0.761)
        }
    }

    @Test
    fun `anchor is calculated inside host visible area`() {
        val visible = AutoViewportBounds(140, 80, 1180, 680)
        val spec = AutoViewportPolicy.resolve(1280, 720, visible, null, 90.0, true, null)
        val y = AutoViewportPolicy.projectedAnchorY(spec, 720)
        val visibleRatio = (y - visible.top) / visible.height
        assertTrue("ratio=$visibleRatio", visibleRatio in 0.72..0.77)
        assertTrue(spec.leftPadding >= visible.left)
        assertTrue(spec.rightPadding >= 100.0)
    }

    @Test
    fun `zoom moves out as speed grows`() {
        val slow = AutoViewportPolicy.resolve(800, 480, null, null, 5.0, false, null)
        val fast = AutoViewportPolicy.resolve(800, 480, null, null, 120.0, false, null)
        assertTrue(fast.zoom < slow.zoom)
        assertTrue(fast.pitch > slow.pitch)
        assertTrue(fast.zoom >= 16.35)
    }

    @Test
    fun `portrait and ultrawide keep navigation anchor in safe range`() {
        listOf(480 to 800, 1920 to 720).forEach { (width, height) ->
            val spec = AutoViewportPolicy.resolve(width, height, null, null, 110.0, true, null)
            val ratio = AutoViewportPolicy.projectedAnchorY(spec, height) / height
            assertTrue("${width}x$height ratio=$ratio", ratio in 0.729..0.761)
        }
    }

    @Test
    fun `navigation hud reserves left side without moving vehicle too high`() {
        val insets = AutoHudInsets(top = 24.0, left = 430.0, bottom = 110.0, right = 170.0)
        val spec = AutoViewportPolicy.resolve(1280, 720, null, null, 80.0, true, insets)
        val anchor = AutoViewportPolicy.projectedAnchorY(spec, 720) / 720.0

        assertTrue(spec.leftPadding >= 1280 * 0.25)
        assertTrue(anchor in 0.73..0.76)
    }
}
