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

    fun speedClusterRect(bottom: Float): RectF {
        val h = s(if (compact) 82f else 94f)
        val w = s(if (compact) 176f else 214f)
        val left = safeLeft + s(if (compact) 16f else 24f)
        return RectF(left, bottom - h, left + w, bottom)
    }

    fun speedPanelRect(bottom: Float): RectF = speedClusterRect(bottom)
    fun speedLimitCenterX(rect: RectF): Float = rect.left + s(if (compact) 43f else 50f)
    fun speedLimitCenterY(rect: RectF): Float = rect.centerY()
    fun speedValueCenterX(rect: RectF): Float = rect.left + s(if (compact) 127f else 153f)
    fun speedValueBaseline(rect: RectF): Float = rect.top + s(if (compact) 52f else 60f)
    fun speedUnitBaseline(rect: RectF): Float = rect.bottom - s(if (compact) 9f else 11f)

    fun navigationCockpitRect(top: Float): RectF {
        val margin = s(if (compact) 14f else 22f)
        val maxW = s(if (compact) 380f else 470f)
        val preferred = safeW * if (compact) 0.48f else 0.43f
        val minW = s(if (compact) 278f else 340f)
        val availableW = (safeW - margin * 2f).coerceAtLeast(1f)
        val lower = minW.coerceAtMost(availableW)
        val upper = maxW.coerceAtMost(availableW).coerceAtLeast(lower)
        val width = preferred.coerceIn(lower, upper)
        val height = s(if (compact) 164f else 188f)
        val left = safeLeft + margin
        return RectF(left, top, left + width, (top + height).coerceAtMost(safeBottom - margin))
    }

    fun navigationAlertRect(navigationRect: RectF): RectF {
        val gap = s(8f)
        val height = s(if (compact) 48f else 54f)
        return RectF(
            navigationRect.left,
            navigationRect.bottom + gap,
            navigationRect.right,
            (navigationRect.bottom + gap + height).coerceAtMost(safeBottom - s(12f)),
        )
    }

    fun cockpitRecenterRect(bottom: Float): RectF {
        val size = max(touchMin(), s(if (compact) 52f else 58f))
        val right = safeRight - s(if (compact) 16f else 24f)
        return RectF(right - size, bottom - size, right, bottom)
    }

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
        return cockpitRecenterRect(bottom)
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
        leftPanelRight: Float? = null,
    ): AutoHudInsets {
        val margin = s(12f).toDouble()
        val rawTop = when (mode) {
            AutoHudLayoutMode.SEARCH, AutoHudLayoutMode.REPORT, AutoHudLayoutMode.LOADING ->
                (safeH * 0.28).toDouble().coerceAtLeast(s(160f).toDouble())
            AutoHudLayoutMode.NAVIGATING -> s(24f).toDouble()
            else -> (topPanelBottom - safeTop + margin).coerceAtLeast(s(72f).toDouble())
        }
        val maxTop = when (mode) {
            AutoHudLayoutMode.NAVIGATING -> safeH * 0.48
            else -> safeH * 0.18
        }.toDouble()
        val defaultLeft = (speedRect.right - safeLeft + margin)
            .coerceAtLeast(s(if (compact) 18f else 24f).toDouble())
        val rawLeft = when {
            mode == AutoHudLayoutMode.ROUTE_PREVIEW ->
                (safeW * if (compact) 0.48 else 0.46).toDouble()
            mode == AutoHudLayoutMode.NAVIGATING && leftPanelRight != null ->
                max(defaultLeft, leftPanelRight - safeLeft + margin)
            else -> defaultLeft
        }
        val rawBottom = (safeBottom - speedRect.top + margin).coerceAtLeast(s(36f).toDouble())
        val rawRight = (safeRight - rightControlLeft + margin).coerceAtLeast(s(if (compact) 18f else 24f).toDouble())
        val leftLimit = when (mode) {
            AutoHudLayoutMode.ROUTE_PREVIEW -> 0.50
            AutoHudLayoutMode.NAVIGATING -> if (compact) 0.32 else 0.34
            else -> if (compact) 0.20 else 0.18
        }
        val rightLimit = when (mode) {
            AutoHudLayoutMode.ROUTE_PREVIEW -> 0.18
            else -> if (compact) 0.20 else 0.18
        }
        val bottomLimit = if (compact) 0.24 else 0.22
        return AutoHudInsets(
            top = min(rawTop, maxTop),
            left = min(rawLeft, (safeW * leftLimit).toDouble()),
            bottom = min(rawBottom, (safeH * bottomLimit).toDouble()),
            right = min(rawRight, (safeW * rightLimit).toDouble()),
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
