package com.lexuuw.vroom.app.auto

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.car.app.CarContext
import androidx.car.app.SurfaceContainer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

class VroomMapSurfaceRenderer(private val carContext: CarContext) : DefaultLifecycleObserver {

    private var surface: Surface? = null
    private var surfaceWidth = 0
    private var surfaceHeight = 0
    private var visibleArea: Rect? = null
    private var latestPayload: VroomPayload? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        surface = surfaceContainer.surface
        surfaceWidth = surfaceContainer.width
        surfaceHeight = surfaceContainer.height
        draw()
    }

    fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        surface = null
    }

    fun onVisibleAreaChanged(visibleArea: Rect) {
        this.visibleArea = Rect(visibleArea)
        draw()
    }

    fun onStableAreaChanged(stableArea: Rect) {
        this.visibleArea = Rect(stableArea)
        draw()
    }

    fun updateMapWithPayload(payload: VroomPayload) {
        latestPayload = payload
        mainHandler.post { draw() }
    }

    private fun draw() {
        val target = surface ?: return
        if (!target.isValid || surfaceWidth <= 0 || surfaceHeight <= 0) return
        val canvas = runCatching { target.lockCanvas(null) }.getOrNull() ?: return
        try {
            render(canvas, latestPayload)
        } catch (e: Exception) {
            Log.e("VroomMapSurfaceRenderer", "Canvas render failed", e)
            canvas.drawColor(Color.rgb(8, 10, 14))
        } finally {
            runCatching { target.unlockCanvasAndPost(canvas) }
        }
    }

    private fun render(canvas: Canvas, payload: VroomPayload?) {
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        val safe = visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
        val center = resolveCenter(payload)
        val zoomMeters = if (payload?.isNavigating == true) 1150.0 else 1700.0

        drawBaseMap(canvas, w, h)
        drawRoadGrid(canvas, center, zoomMeters, w, h)

        if (payload != null) {
            drawRoute(canvas, payload.routePoints, center, zoomMeters, w, h, payload.isNavigating)
            payload.users.take(32).forEach { drawUser(canvas, project(it.lat, it.lng, center, zoomMeters, w, h), it) }
            payload.warnings.take(40).forEach { drawWarning(canvas, project(it.lat, it.lng, center, zoomMeters, w, h), it) }
            payload.mapState.destinationLat?.let { lat ->
                payload.mapState.destinationLng?.let { lng ->
                    drawDestination(canvas, project(lat, lng, center, zoomMeters, w, h))
                }
            }
            drawCar(canvas, project(payload.userLat ?: center.lat, payload.userLng ?: center.lng, center, zoomMeters, w, h), payload.heading ?: 0.0)
        }

        drawTopControls(canvas, safe, payload)
        drawBottomHud(canvas, safe, payload)
    }

    private fun drawBaseMap(canvas: Canvas, w: Float, h: Float) {
        canvas.drawColor(Color.rgb(4, 7, 12))
        val wash = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(9, 18, 28)
            style = Paint.Style.FILL
        }
        canvas.drawRect(0f, 0f, w, h, wash)

        val zone = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(70, 0, 191, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        for (i in 0..4) {
            val pad = 70f + i * 95f
            canvas.drawRoundRect(RectF(pad, pad * 0.55f, w - pad, h - pad * 0.35f), 42f, 42f, zone)
        }
    }

    private fun drawRoadGrid(canvas: Canvas, center: AutoRoutePoint, zoomMeters: Double, w: Float, h: Float) {
        val road = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(33, 43, 56)
            style = Paint.Style.STROKE
            strokeWidth = 14f
            strokeCap = Paint.Cap.ROUND
        }
        val roadHi = Paint(road).apply {
            color = Color.rgb(58, 72, 91)
            strokeWidth = 4f
        }

        for (i in -3..3) {
            val x = w / 2f + i * 140f
            val path = Path().apply {
                moveTo(x - 90f, -40f)
                cubicTo(x + 70f, h * 0.28f, x - 110f, h * 0.62f, x + 60f, h + 60f)
            }
            canvas.drawPath(path, road)
            canvas.drawPath(path, roadHi)
        }
        for (i in -2..3) {
            val y = h / 2f + i * 128f
            val path = Path().apply {
                moveTo(-60f, y + 40f)
                cubicTo(w * 0.28f, y - 75f, w * 0.62f, y + 90f, w + 80f, y - 20f)
            }
            canvas.drawPath(path, road)
            canvas.drawPath(path, roadHi)
        }

        val pulse = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(42, 0, 191, 255)
            style = Paint.Style.FILL
        }
        val here = project(center.lat, center.lng, center, zoomMeters, w, h)
        canvas.drawCircle(here.first, here.second, 190f, pulse)
    }

    private fun drawRoute(
        canvas: Canvas,
        points: List<AutoRoutePoint>,
        center: AutoRoutePoint,
        zoomMeters: Double,
        w: Float,
        h: Float,
        navigating: Boolean
    ) {
        if (points.size < 2) return
        val path = Path()
        points.forEachIndexed { index, point ->
            val projected = project(point.lat, point.lng, center, zoomMeters, w, h)
            if (index == 0) path.moveTo(projected.first, projected.second) else path.lineTo(projected.first, projected.second)
        }
        val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(190, 0, 0, 0)
            style = Paint.Style.STROKE
            strokeWidth = 21f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val route = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (navigating) Color.rgb(227, 56, 53) else Color.rgb(0, 191, 255)
            style = Paint.Style.STROKE
            strokeWidth = 11f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        canvas.drawPath(path, shadow)
        canvas.drawPath(path, route)
    }

    private fun drawUser(canvas: Canvas, point: Pair<Float, Float>, user: UserMarker) {
        if (!isOnCanvas(point, canvas)) return
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (user.type == "friend") Color.rgb(77, 233, 38) else Color.rgb(0, 191, 255)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawCircle(point.first, point.second, if (user.isPremium) 16f else 13f, fill)
        canvas.drawCircle(point.first, point.second, if (user.isPremium) 16f else 13f, stroke)
        drawLabel(canvas, point.first, point.second - 25f, user.label.take(14), Color.rgb(0, 191, 255))
    }

    private fun drawWarning(canvas: Canvas, point: Pair<Float, Float>, warning: WarningMarker) {
        if (!isOnCanvas(point, canvas)) return
        val color = when (warning.type) {
            "traffic" -> Color.rgb(255, 107, 107)
            "weather" -> Color.rgb(255, 212, 59)
            "accident" -> Color.rgb(255, 146, 43)
            "speed_control" -> Color.rgb(5, 53, 247)
            else -> Color.rgb(232, 154, 54)
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        val path = Path().apply {
            moveTo(point.first, point.second - 20f)
            lineTo(point.first - 20f, point.second + 18f)
            lineTo(point.first + 20f, point.second + 18f)
            close()
        }
        canvas.drawPath(path, paint)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 23f
            isFakeBoldText = true
        }
        canvas.drawText("!", point.first, point.second + 11f, text)
        if (warning.count > 0) drawLabel(canvas, point.first + 22f, point.second - 18f, "+${warning.count}", color)
    }

    private fun drawDestination(canvas: Canvas, point: Pair<Float, Float>) {
        if (!isOnCanvas(point, canvas)) return
        val red = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 20f, red)
        red.color = Color.WHITE
        canvas.drawCircle(point.first, point.second, 8f, red)
        drawLabel(canvas, point.first, point.second - 32f, "Cel", Color.rgb(227, 56, 53))
    }

    private fun drawCar(canvas: Canvas, point: Pair<Float, Float>, heading: Double) {
        val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(86, 0, 191, 255)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 42f, halo)
        val angle = Math.toRadians(heading)
        val path = Path().apply {
            moveTo(point.first + (sin(angle) * 29.0).toFloat(), point.second - (cos(angle) * 29.0).toFloat())
            lineTo(point.first + (sin(angle + 2.45) * 19.0).toFloat(), point.second - (cos(angle + 2.45) * 19.0).toFloat())
            lineTo(point.first + (sin(angle - 2.45) * 19.0).toFloat(), point.second - (cos(angle - 2.45) * 19.0).toFloat())
            close()
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(69, 168, 255)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawPath(path, fill)
        canvas.drawPath(path, stroke)
    }

    private fun drawTopControls(canvas: Canvas, safe: Rect, payload: VroomPayload?) {
        val top = max(16f, safe.top + 12f)
        val left = 18f
        drawPill(canvas, RectF(left, top, left + 78f, top + 54f), "VR", Color.rgb(227, 56, 53))
        drawPill(canvas, RectF(left + 92f, top, canvas.width - 190f, top + 54f), payload?.destinationName ?: "Free drive", Color.rgb(0, 191, 255))
        drawPill(canvas, RectF(canvas.width - 174f, top, canvas.width - 96f, top + 54f), "Menu", Color.rgb(220, 228, 236))
        drawPill(canvas, RectF(canvas.width - 84f, top, canvas.width - 14f, top + 54f), "!", Color.rgb(232, 154, 54))
    }

    private fun drawBottomHud(canvas: Canvas, safe: Rect, payload: VroomPayload?) {
        val bottom = canvas.height - max(16f, (canvas.height - safe.bottom).toFloat() + 16f)
        val left = 18f
        val speedBox = RectF(canvas.width - 118f, bottom - 104f, canvas.width - 18f, bottom)
        val speedPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(232, 8, 10, 14)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(speedBox, 22f, 22f, speedPaint)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 38f
            isFakeBoldText = true
        }
        canvas.drawText(((payload?.mapState?.speedKmh ?: 0.0).toInt()).toString(), speedBox.centerX(), speedBox.top + 51f, text)
        text.textSize = 14f
        text.color = Color.rgb(0, 191, 255)
        canvas.drawText("KM/H", speedBox.centerX(), speedBox.top + 72f, text)
        payload?.mapState?.speedLimitKmh?.let {
            text.textSize = 17f
            text.color = Color.rgb(227, 56, 53)
            canvas.drawText(it.toInt().toString(), speedBox.centerX(), speedBox.bottom - 12f, text)
        }

        val panelRight = speedBox.left - 14f
        val panel = RectF(left, bottom - 104f, panelRight, bottom)
        val panelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(232, 8, 10, 14)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(panel, 22f, 22f, panelPaint)
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(0, 191, 255)
            textAlign = Paint.Align.LEFT
            textSize = 18f
            isFakeBoldText = true
        }
        canvas.drawText(if (payload?.isNavigating == true) "NAWIGACJA" else "TRYB JAZDY", panel.left + 18f, panel.top + 31f, label)
        label.color = Color.WHITE
        label.textSize = 24f
        label.isFakeBoldText = false
        val instruction = payload?.instruction?.takeIf { it.isNotBlank() }
            ?: if (payload?.isNavigating == true) "Jedz do celu" else "Free drive aktywny"
        canvas.drawText(instruction.take(38), panel.left + 18f, panel.top + 66f, label)
        label.textSize = 16f
        label.color = Color.rgb(180, 190, 204)
        val info = listOfNotNull(
            payload?.turnDistanceMeters?.let { formatMeters(it) },
            payload?.remainingDistanceMeters?.let { formatMeters(it) },
            payload?.remainingDurationSec?.let { "${it / 60} min" }
        ).joinToString("  |  ")
        canvas.drawText(if (info.isBlank()) "Uzytkownicy ${payload?.users?.size ?: 0}  |  Zgloszenia ${payload?.warnings?.size ?: 0}" else info, panel.left + 18f, panel.bottom - 16f, label)
    }

    private fun drawPill(canvas: Canvas, rect: RectF, label: String, accent: Int) {
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(232, 12, 13, 18)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accent
            style = Paint.Style.STROKE
            strokeWidth = 2.2f
        }
        canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, fill)
        canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, stroke)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = if (rect.width() < 90f) 20f else 22f
            isFakeBoldText = true
        }
        canvas.drawText(label.take(22), rect.centerX(), rect.centerY() + 8f, text)
    }

    private fun drawLabel(canvas: Canvas, x: Float, y: Float, label: String, accent: Int) {
        if (label.isBlank()) return
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 17f
        }
        val width = (text.measureText(label) + 18f).coerceAtLeast(36f)
        val rect = RectF(x - width / 2f, y - 18f, x + width / 2f, y + 8f)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(232, 7, 8, 12)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accent
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(rect, 8f, 8f, fill)
        canvas.drawRoundRect(rect, 8f, 8f, stroke)
        canvas.drawText(label, x, y + 1f, text)
    }

    private fun resolveCenter(payload: VroomPayload?): AutoRoutePoint {
        if (payload?.userLat != null && payload.userLng != null) return AutoRoutePoint(payload.userLat, payload.userLng)
        payload?.routePoints?.firstOrNull()?.let { return it }
        return AutoRoutePoint(52.2297, 21.0122)
    }

    private fun project(
        lat: Double,
        lng: Double,
        center: AutoRoutePoint,
        zoomMeters: Double,
        w: Float,
        h: Float
    ): Pair<Float, Float> {
        val metersPerDegLat = 111_320.0
        val metersPerDegLng = metersPerDegLat * cos(Math.toRadians(center.lat)).coerceAtLeast(0.15)
        val dx = (lng - center.lng) * metersPerDegLng
        val dy = (lat - center.lat) * metersPerDegLat
        val scale = (minOf(w, h).toDouble() * 0.72) / zoomMeters
        return Pair((w / 2f + dx * scale).toFloat(), (h / 2f - dy * scale).toFloat())
    }

    private fun isOnCanvas(point: Pair<Float, Float>, canvas: Canvas): Boolean =
        point.first >= -80f && point.second >= -80f && point.first <= canvas.width + 80f && point.second <= canvas.height + 80f

    private fun formatMeters(meters: Int): String =
        if (meters >= 1000) "${"%.1f".format(meters / 1000f)} km" else "$meters m"

    override fun onDestroy(owner: LifecycleOwner) {
        surface = null
    }
}
