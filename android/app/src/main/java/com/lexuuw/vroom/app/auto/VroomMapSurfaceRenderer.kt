package com.lexuuw.vroom.app.auto

import android.app.Presentation
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.car.app.CarContext
import androidx.car.app.SurfaceContainer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapView
import kotlin.math.cos
import kotlin.math.sin

private const val MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"
private const val MAPBOX_NAV_STYLE = "mapbox://styles/mapbox/navigation-night-v1"
private const val DEFAULT_LAT = 52.2297
private const val DEFAULT_LNG = 21.0122

class VroomMapSurfaceRenderer(private val carContext: CarContext) : DefaultLifecycleObserver {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var virtualDisplay: VirtualDisplay? = null
    private var presentation: Presentation? = null
    private var lifecycleOwner: SurfaceLifecycleOwner? = null
    private var mapView: MapView? = null
    private var overlay: VroomAutoOverlayView? = null
    private var visibleArea: Rect? = null
    private var latestPayload: VroomPayload? = null

    fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        mainHandler.post {
            if (presentation == null || mapView == null) {
                releaseSurface()
                createMapPresentation(surfaceContainer)
            }
            updateMap()
        }
    }

    fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        mainHandler.post { releaseSurface() }
    }

    fun onVisibleAreaChanged(visibleArea: Rect) {
        this.visibleArea = Rect(visibleArea)
        overlay?.visibleArea = this.visibleArea
        overlay?.invalidate()
    }

    fun onStableAreaChanged(stableArea: Rect) {
        this.visibleArea = Rect(stableArea)
        overlay?.visibleArea = this.visibleArea
        overlay?.invalidate()
    }

    fun updateMapWithPayload(payload: VroomPayload) {
        latestPayload = payload
        mainHandler.post { updateMap() }
    }

    private fun createMapPresentation(surfaceContainer: SurfaceContainer) {
        val surface = surfaceContainer.surface ?: return
        if (!surface.isValid || surfaceContainer.width <= 0 || surfaceContainer.height <= 0) return

        MapboxOptions.accessToken = MAPBOX_ACCESS_TOKEN

        val displayManager = carContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        virtualDisplay = displayManager.createVirtualDisplay(
            "VROOM_ANDROID_AUTO_MAP",
            surfaceContainer.width,
            surfaceContainer.height,
            surfaceContainer.dpi.coerceAtLeast(160),
            surface,
            0
        )

        val display = virtualDisplay?.display ?: return
        val nextPresentation = Presentation(carContext, display)
        val root = FrameLayout(nextPresentation.context)
        val owner = SurfaceLifecycleOwner().apply {
            onCreate()
            onStart()
            onResume()
        }
        attachLifecycleOwner(root, owner)

        val nextMapView = MapView(
            nextPresentation.context,
            MapInitOptions(context = nextPresentation.context, textureView = true)
        )
        nextMapView.getMapboxMap().loadStyleUri(MAPBOX_NAV_STYLE)
        nextMapView.onStart()

        val params = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.addView(nextMapView, params)

        val nextOverlay = VroomAutoOverlayView(nextPresentation.context).apply {
            mapView = nextMapView
            visibleArea = this@VroomMapSurfaceRenderer.visibleArea
        }
        root.addView(nextOverlay, params)

        nextPresentation.setContentView(root)
        nextPresentation.show()

        lifecycleOwner = owner
        presentation = nextPresentation
        mapView = nextMapView
        overlay = nextOverlay
    }

    private fun updateMap() {
        val payload = latestPayload
        val map = mapView?.getMapboxMap() ?: return
        val center = resolveCenter(payload)
        val driving = true

        map.setCamera(
            CameraOptions.Builder()
                .center(Point.fromLngLat(center.lng, center.lat))
                .zoom(if (payload?.isNavigating == true) 17.35 else 16.85)
                .pitch(if (driving) 58.0 else 0.0)
                .bearing(if (driving) payload?.heading ?: 0.0 else 0.0)
                .padding(EdgeInsets(70.0, 18.0, 150.0, 18.0))
                .build()
        )

        overlay?.payload = payload
        overlay?.mapView = mapView
        overlay?.visibleArea = visibleArea
        overlay?.postInvalidateOnAnimation()
    }

    private fun resolveCenter(payload: VroomPayload?): AutoRoutePoint {
        if (payload?.userLat != null && payload.userLng != null) {
            return AutoRoutePoint(payload.userLat, payload.userLng)
        }
        payload?.routePoints?.firstOrNull()?.let { return it }
        return AutoRoutePoint(DEFAULT_LAT, DEFAULT_LNG)
    }

    private fun attachLifecycleOwner(view: View, owner: LifecycleOwner) {
        runCatching {
            val clazz = Class.forName("androidx.lifecycle.ViewTreeLifecycleOwner")
            val method = clazz.getMethod("set", View::class.java, LifecycleOwner::class.java)
            method.invoke(null, view, owner)
        }.onFailure {
            Log.w("VroomMapSurfaceRenderer", "ViewTreeLifecycleOwner unavailable")
        }
    }

    private fun releaseSurface() {
        lifecycleOwner?.onDestroy()
        lifecycleOwner = null
        runCatching { mapView?.onStop() }
        runCatching { mapView?.onDestroy() }
        mapView = null
        overlay = null
        runCatching { presentation?.dismiss() }
        presentation = null
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
    }

    override fun onDestroy(owner: LifecycleOwner) {
        releaseSurface()
    }
}

private class SurfaceLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)

    init {
        registry.currentState = Lifecycle.State.INITIALIZED
    }

    override val lifecycle: Lifecycle
        get() = registry

    fun onCreate() {
        registry.currentState = Lifecycle.State.CREATED
    }

    fun onStart() {
        registry.currentState = Lifecycle.State.STARTED
    }

    fun onResume() {
        registry.currentState = Lifecycle.State.RESUMED
    }

    fun onDestroy() {
        registry.currentState = Lifecycle.State.DESTROYED
    }
}

private class VroomAutoOverlayView(context: Context) : View(context) {
    var payload: VroomPayload? = null
    var mapView: MapView? = null
    var visibleArea: Rect? = null

    private val routeShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(180, 0, 0, 0)
        style = Paint.Style.STROKE
        strokeWidth = 18f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(227, 56, 53)
        style = Paint.Style.STROKE
        strokeWidth = 10f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val panelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(232, 8, 8, 10)
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(227, 56, 53)
        style = Paint.Style.STROKE
        strokeWidth = 2.4f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 22f
        isFakeBoldText = true
    }
    private val smallText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 17f
        textAlign = Paint.Align.LEFT
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val snap = payload
        if (snap != null) {
            drawRoute(canvas, snap)
            snap.users.take(36).forEach { drawUser(canvas, it) }
            snap.warnings.take(42).forEach { drawWarning(canvas, it) }
            drawDestination(canvas, snap)
            drawCar(canvas, snap)
        }
        drawHud(canvas, snap)
    }

    private fun drawRoute(canvas: Canvas, snap: VroomPayload) {
        val points = snap.routePoints
        if (points.size < 2) return
        val path = Path()
        points.forEachIndexed { index, point ->
            val projected = project(point.lat, point.lng) ?: return@forEachIndexed
            if (index == 0) path.moveTo(projected.first, projected.second) else path.lineTo(projected.first, projected.second)
        }
        routePaint.color = if (snap.isNavigating) Color.rgb(227, 56, 53) else Color.rgb(0, 191, 255)
        canvas.drawPath(path, routeShadow)
        canvas.drawPath(path, routePaint)
    }

    private fun drawUser(canvas: Canvas, marker: UserMarker) {
        val point = project(marker.lat, marker.lng) ?: return
        if (!inside(point, canvas)) return
        val color = if (marker.type == "friend") Color.rgb(77, 233, 38) else Color.rgb(0, 191, 255)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = Color.argb(235, 8, 8, 10)
            style = Paint.Style.FILL
        }
        val accent = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        val badge = RectF(point.first - 34f, point.second - 64f, point.first + 34f, point.second - 6f)
        canvas.drawRoundRect(badge, 12f, 12f, fill)
        canvas.drawRoundRect(badge, 12f, 12f, accent)
        textPaint.textSize = 18f
        textPaint.color = Color.WHITE
        canvas.drawText(if (marker.isPremium) "VR+" else "VR", badge.centerX(), badge.top + 30f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 13f
        smallText.color = color
        canvas.drawText(marker.label.take(9).uppercase(), badge.centerX(), badge.bottom - 10f, smallText)
        val pin = Path().apply {
            moveTo(point.first - 10f, point.second - 8f)
            lineTo(point.first + 10f, point.second - 8f)
            lineTo(point.first, point.second + 7f)
            close()
        }
        val pinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        canvas.drawPath(pin, pinPaint)
    }

    private fun drawWarning(canvas: Canvas, marker: WarningMarker) {
        val point = project(marker.lat, marker.lng) ?: return
        if (!inside(point, canvas)) return
        val color = when (marker.type) {
            "traffic" -> Color.rgb(255, 107, 107)
            "weather" -> Color.rgb(255, 212, 59)
            "accident" -> Color.rgb(255, 146, 43)
            "speed_control" -> Color.rgb(5, 53, 247)
            else -> Color.rgb(232, 154, 54)
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        val tri = Path().apply {
            moveTo(point.first, point.second - 22f)
            lineTo(point.first - 22f, point.second + 18f)
            lineTo(point.first + 22f, point.second + 18f)
            close()
        }
        canvas.drawPath(tri, fill)
        textPaint.color = Color.WHITE
        textPaint.textSize = 24f
        canvas.drawText("!", point.first, point.second + 10f, textPaint)
    }

    private fun drawDestination(canvas: Canvas, snap: VroomPayload) {
        val lat = snap.mapState.destinationLat ?: return
        val lng = snap.mapState.destinationLng ?: return
        val point = project(lat, lng) ?: return
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 19f, fill)
        fill.color = Color.WHITE
        canvas.drawCircle(point.first, point.second, 7f, fill)
    }

    private fun drawCar(canvas: Canvas, snap: VroomPayload) {
        val lat = snap.userLat ?: return
        val lng = snap.userLng ?: return
        val point = project(lat, lng) ?: return
        val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(75, 227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 34f, halo)
        val avatar = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(8, 8, 10)
            style = Paint.Style.FILL
        }
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 4f
        }
        canvas.drawCircle(point.first, point.second, 22f, avatar)
        canvas.drawCircle(point.first, point.second, 22f, border)
        textPaint.textSize = 15f
        textPaint.color = Color.WHITE
        canvas.drawText("VR", point.first, point.second + 5f, textPaint)
    }

    private fun drawHud(canvas: Canvas, snap: VroomPayload?) {
        val safe = visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
        val top = safe.top + 14f
        val bottom = safe.bottom - 14f

        val search = RectF(24f, top, canvas.width - 24f, top + 58f)
        panelPaint.color = Color.argb(232, 10, 10, 12)
        strokePaint.color = Color.argb(190, 227, 56, 53)
        canvas.drawRoundRect(search, 29f, 29f, panelPaint)
        canvas.drawRoundRect(search, 29f, 29f, strokePaint)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 22f
        smallText.color = Color.argb(210, 255, 255, 255)
        canvas.drawText(snap?.destinationName?.takeIf { it.isNotBlank() } ?: "Wyszukaj adres lub miejsce...", search.left + 62f, search.centerY() + 8f, smallText)
        drawSearchIcon(canvas, search.left + 32f, search.centerY())

        val speedRect = RectF(24f, bottom - 122f, 126f, bottom)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(speedRect, 18f, 18f, panelPaint)
        textPaint.textSize = 42f
        textPaint.color = Color.WHITE
        canvas.drawText(((snap?.mapState?.speedKmh ?: 0.0).toInt()).toString(), speedRect.centerX(), speedRect.top + 66f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 16f
        smallText.color = Color.rgb(160, 160, 166)
        canvas.drawText("km/h", speedRect.centerX(), speedRect.top + 91f, smallText)
        snap?.mapState?.speedLimitKmh?.let {
            val limit = RectF(speedRect.left + 23f, speedRect.top + 10f, speedRect.right - 23f, speedRect.top + 46f)
            val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            canvas.drawOval(limit, white)
            textPaint.textSize = 18f
            textPaint.color = Color.rgb(20, 20, 20)
            canvas.drawText(it.toInt().toString(), limit.centerX(), limit.centerY() + 7f, textPaint)
        }

        drawLiveBadge(canvas, canvas.width - 132f, bottom - 158f)
        drawReportButton(canvas, canvas.width - 138f, bottom - 96f)
    }

    private fun drawSearchIcon(canvas: Canvas, cx: Float, cy: Float) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 4f
        }
        canvas.drawCircle(cx - 5f, cy - 4f, 11f, paint)
        canvas.drawLine(cx + 4f, cy + 6f, cx + 17f, cy + 19f, paint)
    }

    private fun drawLiveBadge(canvas: Canvas, left: Float, top: Float) {
        val rect = RectF(left, top, left + 112f, top + 42f)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 21f, 21f, panelPaint)
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(77, 233, 38)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(rect.left + 24f, rect.centerY(), 8f, dot)
        textPaint.textSize = 18f
        textPaint.color = Color.rgb(77, 233, 38)
        canvas.drawText("LIVE", rect.left + 70f, rect.centerY() + 7f, textPaint)
    }

    private fun drawReportButton(canvas: Canvas, left: Float, top: Float) {
        val rect = RectF(left, top, left + 112f, top + 76f)
        val red = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(rect, 18f, 18f, red)
        textPaint.textSize = 18f
        textPaint.color = Color.WHITE
        canvas.drawText("ZGLOS", rect.centerX(), rect.bottom - 18f, textPaint)
        val tri = Path().apply {
            moveTo(rect.centerX(), rect.top + 16f)
            lineTo(rect.centerX() - 20f, rect.top + 48f)
            lineTo(rect.centerX() + 20f, rect.top + 48f)
            close()
        }
        val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        canvas.drawPath(tri, white)
        textPaint.color = Color.rgb(227, 56, 53)
        textPaint.textSize = 22f
        canvas.drawText("!", rect.centerX(), rect.top + 43f, textPaint)
    }

    private fun project(lat: Double, lng: Double): Pair<Float, Float>? {
        val map = mapView?.getMapboxMap() ?: return null
        val screen = map.pixelForCoordinate(Point.fromLngLat(lng, lat))
        return Pair(screen.x.toFloat(), screen.y.toFloat())
    }

    private fun inside(point: Pair<Float, Float>, canvas: Canvas): Boolean =
        point.first >= -90f && point.second >= -90f && point.first <= canvas.width + 90f && point.second <= canvas.height + 90f
}
