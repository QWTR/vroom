package __PACKAGE__.auto

import android.graphics.Rect
import android.graphics.RectF
import kotlin.math.max
import kotlin.math.min

enum class AutoHudLayoutMode {
    FREE_DRIVE,
    NAVIGATING,
    ROUTE_PREVIEW,
    SEARCH,
    REPORT,
    LOADING,
}

data class AutoHudInsets(
    val top: Double,
    val left: Double,
    val bottom: Double,
    val right: Double,
) {
    fun nearlyEquals(other: AutoHudInsets, epsilon: Double = 14.0): Boolean =
        kotlin.math.abs(top - other.top) < epsilon &&
            kotlin.math.abs(left - other.left) < epsilon &&
            kotlin.math.abs(bottom - other.bottom) < epsilon &&
            kotlin.math.abs(right - other.right) < epsilon
}

class AutoHudMetrics private constructor(
    val uiScale: Float,
    val safeLeft: Float,
    val safeTop: Float,
    val safeRight: Float,
    val safeBottom: Float,
    val safeW: Float,
    val safeH: Float,
) {
    val compact: Boolean = safeW < 820f || safeW / safeH < 1.55f

    fun s(value: Float): Float = value * uiScale
    fun ts(value: Float): Float = value * uiScale
    fun touchMin(): Float = max(s(48f), 44f)

    fun contentTop(): Float = safeTop + s(if (compact) 10f else 14f)
    fun contentBottom(): Float = safeBottom - s(if (compact) 10f else 14f)

    fun speedPanelRect(bottom: Float): RectF {
        val h = s(if (compact) 112f else 132f)
        val w = s(if (compact) 88f else 104f)
        val left = safeLeft + s(if (compact) 16f else 24f)
        return RectF(left, bottom - h, left + w, bottom - s(4f))
    }

    fun speedValueBaseline(rect: RectF): Float = rect.top + s(if (compact) 76f else 88f)
    fun speedUnitBaseline(rect: RectF): Float = rect.top + s(if (compact) 101f else 116f)
    fun speedLimitCenterY(rect: RectF): Float = rect.top + s(if (compact) 27f else 30f)

    fun searchBarRect(top: Float): RectF {
        val left = safeLeft + s(if (compact) 18f else 24f)
        val barTop = (top - s(18f)).coerceAtLeast(safeTop + s(8f))
        val minW = min(s(360f), safeW * 0.56f)
        val prefW = min(s(468f), safeW * if (compact) 0.58f else 0.62f)
        val rightReserve = s(if (compact) 150f else 210f)
        val right = (left + prefW).coerceAtMost(safeRight - rightReserve).coerceAtLeast(left + minW)
        return RectF(left, barTop, right, barTop + s(54f))
    }

    fun navBarRect(top: Float): RectF {
        val h = s(if (compact) 76f else 92f)
        val side = s(if (compact) 14f else 24f)
        val rightMargin = s(if (compact) 88f else 154f)
        return RectF(safeLeft + side, top, safeRight - rightMargin, top + h)
    }

    fun routePreviewPanelRect(top: Float, altCount: Int): RectF {
        val extraAlt = if (altCount > 1) s(54f) else 0f
        val panelW = min(s(392f), safeW * 0.45f).coerceAtLeast(s(280f))
        val right = safeLeft + s(24f) + panelW
        return RectF(safeLeft + s(24f), top + s(8f), right.coerceAtMost(safeRight - s(164f)), top + s(206f) + extraAlt)
    }

    fun rightControlWidth(): Float = max(s(if (compact) 94f else 112f), touchMin() * if (compact) 1.75f else 2.1f)

    fun recenterRect(bottom: Float): RectF {
        val w = rightControlWidth()
        val h = max(s(if (compact) 50f else 54f), touchMin())
        val right = safeRight - s(if (compact) 18f else 26f)
        val topOffset = if (compact) 132f else 150f
        return RectF(right - w, bottom - s(topOffset), right, bottom - s(topOffset) + h)
    }

    fun reportRect(bottom: Float): RectF {
        val w = rightControlWidth()
        val h = max(s(if (compact) 74f else 84f), touchMin() * if (compact) 1.42f else 1.6f)
        val right = safeRight - s(if (compact) 18f else 26f)
        return RectF(right - w, bottom - h, right, bottom)
    }

    fun liveBadgePosition(bottom: Float): Pair<Float, Float> {
        val w = liveBadgeWidth()
        val left = safeRight - s(if (compact) 18f else 26f) - w
        return Pair(left, bottom - s(if (compact) 184f else 208f))
    }

    fun liveBadgeWidth(): Float = s(if (compact) 96f else 112f)

    fun searchOverlayPanel(top: Float, bottom: Float, wantsResults: Boolean): RectF {
        val margin = s(18f)
        val desiredH = if (wantsResults) safeH * 0.58f else safeH * 0.62f
        return RectF(
            safeLeft + margin,
            top + s(4f),
            safeRight - margin,
            (top + s(4f) + desiredH).coerceAtMost(bottom - s(18f)),
        )
    }

    fun reportOverlayPanel(top: Float, bottom: Float): RectF {
        val panelW = min(s(318f), safeW * 0.42f).coerceAtLeast(s(240f))
        val right = safeRight - s(22f)
        return RectF(right - panelW, top + s(70f), right, (top + s(318f)).coerceAtMost(bottom - s(18f)))
    }

    fun loadingOverlayRect(canvasW: Float, canvasH: Float): RectF {
        val w = min(s(320f), safeW * 0.55f)
        val h = s(88f)
        val cx = canvasW * 0.5f
        val cy = canvasH * 0.5f
        return RectF(cx - w / 2f, cy - h / 2f, cx + w / 2f, cy + h / 2f)
    }

    fun toastRect(canvasW: Float): RectF {
        val w = min(s(380f), safeW * 0.72f)
        val h = s(48f)
        val cx = canvasW * 0.5f
        val topY = safeTop + s(88f)
        return RectF(cx - w / 2f, topY, cx + w / 2f, topY + h)
    }

    fun dropPromptRect(): RectF {
        val w = min(s(360f), safeW * 0.42f).coerceAtLeast(s(200f))
        return RectF(
            (safeRight - w).coerceAtLeast(safeLeft + s(150f)),
            safeTop + s(84f),
            safeRight - s(26f),
            safeTop + s(150f),
        )
    }

    fun computeInsets(
        mode: AutoHudLayoutMode,
        topPanelBottom: Float,
        speedRect: RectF,
        rightControlLeft: Float,
    ): AutoHudInsets {
        val margin = s(12f).toDouble()
        val rawTop = when (mode) {
            AutoHudLayoutMode.SEARCH, AutoHudLayoutMode.REPORT, AutoHudLayoutMode.LOADING ->
                (safeH * 0.28).toDouble().coerceAtLeast(s(160f).toDouble())
            AutoHudLayoutMode.NAVIGATING ->
                (topPanelBottom - safeTop + margin + s(145f)).coerceAtLeast(s(205f).toDouble())
            else -> (topPanelBottom - safeTop + margin).coerceAtLeast(s(72f).toDouble())
        }
        val maxTop = when (mode) {
            AutoHudLayoutMode.NAVIGATING -> safeH * 0.48
            else -> safeH * 0.18
        }.toDouble()
        val rawLeft = (speedRect.right - safeLeft + margin).coerceAtLeast(s(if (compact) 18f else 24f).toDouble())
        val rawBottom = (safeBottom - speedRect.top + margin).coerceAtLeast(s(36f).toDouble())
        val rawRight = (safeRight - rightControlLeft + margin).coerceAtLeast(s(if (compact) 18f else 24f).toDouble())
        val sideLimit = if (compact) 0.18 else 0.16
        val bottomLimit = if (compact) 0.24 else 0.22
        return AutoHudInsets(
            top = min(rawTop, maxTop),
            left = min(rawLeft, (safeW * sideLimit).toDouble()),
            bottom = min(rawBottom, (safeH * bottomLimit).toDouble()),
            right = min(rawRight, (safeW * sideLimit).toDouble()),
        )
    }

    companion object {
        private const val REF_W = 800f
        private const val REF_H = 480f

        fun fromVisibleArea(visible: Rect?, canvasW: Int, canvasH: Int): AutoHudMetrics {
            val safe = visible ?: Rect(0, 0, canvasW, canvasH)
            val safeW = (safe.right - safe.left).toFloat().coerceAtLeast(1f)
            val safeH = (safe.bottom - safe.top).toFloat().coerceAtLeast(1f)
            val scale = min(safeW / REF_W, safeH / REF_H).coerceIn(0.76f, 1.55f)
            return AutoHudMetrics(
                uiScale = scale,
                safeLeft = safe.left.toFloat(),
                safeTop = safe.top.toFloat(),
                safeRight = safe.right.toFloat(),
                safeBottom = safe.bottom.toFloat(),
                safeW = safeW,
                safeH = safeH,
            )
        }
    }
}
