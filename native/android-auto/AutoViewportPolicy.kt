package __PACKAGE__.auto

import kotlin.math.max

data class AutoViewportBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    val width: Int get() = (right - left).coerceAtLeast(1)
    val height: Int get() = (bottom - top).coerceAtLeast(1)
}

data class AutoViewportSpec(
    val anchorRatio: Double,
    val zoom: Double,
    val pitch: Double,
    val topPadding: Double,
    val leftPadding: Double,
    val bottomPadding: Double,
    val rightPadding: Double,
)

/**
 * Keeps the car low on the display and leaves the largest useful part of the
 * surface in front of it. All values are derived from the area reported by the
 * host, so the result also works in split-screen and portrait car displays.
 */
object AutoViewportPolicy {
    fun resolve(
        surfaceWidth: Int,
        surfaceHeight: Int,
        visibleArea: AutoViewportBounds?,
        stableArea: AutoViewportBounds?,
        speedKmh: Double,
        navigating: Boolean,
        hudInsets: AutoHudInsets?,
    ): AutoViewportSpec {
        val surface = AutoViewportBounds(0, 0, surfaceWidth.coerceAtLeast(1), surfaceHeight.coerceAtLeast(1))
        val visible = sanitize(visibleArea, surface) ?: sanitize(stableArea, surface) ?: surface
        val speed = speedKmh.coerceIn(0.0, 140.0)
        val progress = (speed / 100.0).coerceIn(0.0, 1.0)
        val anchor = if (navigating) 0.73 + 0.03 * progress else 0.70 + 0.03 * progress
        val pitch = if (navigating) 52.0 + 8.0 * progress else 48.0 + 7.0 * progress
        val zoom = driveZoom(speed, navigating)

        val hostLeft = visible.left.toDouble()
        val hostRight = (surface.right - visible.right).toDouble()
        val hostTop = visible.top.toDouble()
        val hostBottom = (surface.bottom - visible.bottom).toDouble()
        val edge = max(12.0, minOf(visible.width, visible.height) * 0.025)

        val leftHudLimit = if (navigating) visible.width * 0.32 else visible.width * 0.18
        val left = hostLeft + max(edge, hudInsets?.left?.coerceAtMost(leftHudLimit) ?: edge)
        val right = hostRight + max(edge, hudInsets?.right?.coerceAtMost(visible.width * 0.18) ?: edge)
        val bottom = hostBottom + edge
        val targetY = visible.top + visible.height * anchor
        val topForTarget = 2.0 * targetY - (surface.height - bottom)
        val top = max(hostTop + edge, topForTarget)
            .coerceAtMost(targetY - 24.0)

        return AutoViewportSpec(
            anchorRatio = anchor,
            zoom = zoom,
            pitch = pitch,
            topPadding = top,
            leftPadding = left,
            bottomPadding = bottom,
            rightPadding = right,
        )
    }

    fun projectedAnchorY(spec: AutoViewportSpec, surfaceHeight: Int): Double =
        (spec.topPadding + surfaceHeight - spec.bottomPadding) / 2.0

    private fun driveZoom(speedKmh: Double, navigating: Boolean): Double {
        val speed = speedKmh.coerceIn(0.0, 140.0)
        val base = when {
            speed < 10.0 -> 17.80
            speed < 40.0 -> 17.80 - ((speed - 10.0) / 30.0) * 0.60
            speed < 80.0 -> 17.20 - ((speed - 40.0) / 40.0) * 0.70
            speed < 120.0 -> 16.50 - ((speed - 80.0) / 40.0) * 0.55
            else -> 15.95 - ((speed - 120.0) / 20.0) * 0.15
        }
        return (base + if (navigating) 0.05 else 0.0).coerceIn(16.35, 17.85)
    }

    private fun sanitize(value: AutoViewportBounds?, surface: AutoViewportBounds): AutoViewportBounds? {
        value ?: return null
        val left = value.left.coerceIn(surface.left, surface.right - 1)
        val top = value.top.coerceIn(surface.top, surface.bottom - 1)
        val right = value.right.coerceIn(left + 1, surface.right)
        val bottom = value.bottom.coerceIn(top + 1, surface.bottom)
        return AutoViewportBounds(left, top, right, bottom)
    }
}
