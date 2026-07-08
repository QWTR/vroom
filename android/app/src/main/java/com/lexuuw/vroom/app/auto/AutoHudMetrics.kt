package com.lexuuw.vroom.app.auto

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
    fun s(value: Float): Float = value * uiScale
    fun ts(value: Float): Float = value * uiScale
    fun touchMin(): Float = max(s(48f), 44f)

    fun contentTop(): Float = safeTop + s(14f)
    fun contentBottom(): Float = safeBottom - s(14f)

    fun speedPanelRect(bottom: Float): RectF {
        val h = s(132f)
        val w = s(104f)
        return RectF(safeLeft + s(24f), bottom - h, safeLeft + s(24f) + w, bottom - s(4f))
    }

    fun searchBarRect(top: Float): RectF {
        val left = safeLeft + s(24f)
        val barTop = (top - s(18f)).coerceAtLeast(safeTop + s(8f))
        val minW = s(360f)
        val prefW = s(468f)
        val rightReserve = s(210f)
        val right = (left + prefW).coerceAtMost(safeRight - rightReserve).coerceAtLeast(left + minW)
        return RectF(left, barTop, right, barTop + s(54f))
    }

    fun navBarRect(top: Float): RectF {
        val h = s(92f)
        val rightMargin = s(154f)
        return RectF(safeLeft + s(24f), top, safeRight - rightMargin, top + h)
    }

    fun routePreviewPanelRect(top: Float, altCount: Int): RectF {
        val extraAlt = if (altCount > 1) s(54f) else 0f
        val panelW = min(s(392f), safeW * 0.45f).coerceAtLeast(s(280f))
        val right = safeLeft + s(24f) + panelW
        return RectF(safeLeft + s(24f), top + s(8f), right.coerceAtMost(safeRight - s(164f)), top + s(206f) + extraAlt)
    }

    fun rightControlWidth(): Float = max(s(112f), touchMin() * 2.1f)

    fun recenterRect(bottom: Float): RectF {
        val w = rightControlWidth()
        val h = max(s(54f), touchMin())
        val right = safeRight - s(26f)
        return RectF(right - w, bottom - s(150f), right, bottom - s(150f) + h)
    }

    fun reportRect(bottom: Float): RectF {
        val w = rightControlWidth()
        val h = max(s(84f), touchMin() * 1.6f)
        val right = safeRight - s(26f)
        return RectF(right - w, bottom - h, right, bottom)
    }

    fun liveBadgePosition(bottom: Float): Pair<Float, Float> {
        val w = s(112f)
        val left = safeRight - s(26f) - w
        return Pair(left, bottom - s(208f))
    }

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
        val rawLeft = (speedRect.right - safeLeft + margin).coerceAtLeast(s(24f).toDouble())
        val rawBottom = (safeBottom - speedRect.top + margin).coerceAtLeast(s(36f).toDouble())
        val rawRight = (safeRight - rightControlLeft + margin).coerceAtLeast(s(24f).toDouble())
        return AutoHudInsets(
            top = min(rawTop, maxTop),
            left = min(rawLeft, (safeW * 0.12).toDouble()),
            bottom = min(rawBottom, (safeH * 0.22).toDouble()),
            right = min(rawRight, (safeW * 0.12).toDouble()),
        )
    }

    companion object {
        private const val REF_W = 800f
        private const val REF_H = 480f

        fun fromVisibleArea(visible: Rect?, canvasW: Int, canvasH: Int): AutoHudMetrics {
            val safe = visible ?: Rect(0, 0, canvasW, canvasH)
            val safeW = (safe.right - safe.left).toFloat().coerceAtLeast(1f)
            val safeH = (safe.bottom - safe.top).toFloat().coerceAtLeast(1f)
            val scale = min(safeW / REF_W, safeH / REF_H).coerceIn(0.9f, 1.55f)
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
