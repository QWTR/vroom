package com.lexuuw.vroom.app.auto

import android.app.Presentation
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import androidx.car.app.ScreenManager
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
import com.mapbox.maps.ScreenCoordinate
import kotlin.math.cos
import kotlin.math.sin

private const val MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"
private const val MAPBOX_NAV_STYLE = "mapbox://styles/mapbox/navigation-night-v1"
private const val DEFAULT_LAT = 52.2297
private const val DEFAULT_LNG = 21.0122
private const val EARTH_RADIUS_M = 6_371_000.0

class VroomMapSurfaceRenderer(private val carContext: CarContext) : DefaultLifecycleObserver {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var virtualDisplay: VirtualDisplay? = null
    private var presentation: Presentation? = null
    private var lifecycleOwner: SurfaceLifecycleOwner? = null
    private var mapView: MapView? = null
    private var overlay: VroomAutoOverlayView? = null
    private var visibleArea: Rect? = null
    private var latestPayload: VroomPayload? = null
    private var latestPayloadAt = 0L
    private var userBrowsing = false
    private var lastCameraLat = Double.NaN
    private var lastCameraLng = Double.NaN
    private var lastCameraZoom = 16.85
    private var lastCameraBearing = 0.0
    private var targetCameraLat = Double.NaN
    private var targetCameraLng = Double.NaN
    private var targetCameraZoom = 16.85
    private var targetCameraBearing = 0.0
    private var stableCameraSpeedKmh = 0.0
    private var stableCameraZoom = 16.85
    private var lastZoomUpdateAt = 0L
    private var cameraSmoothingRunning = false
    private var lastCameraSmoothAt = 0L

    private val cameraSmoothingStep = object : Runnable {
        override fun run() {
            val map = mapView?.getMapboxMap()
            if (map == null || !targetCameraLat.isFinite() || !targetCameraLng.isFinite()) {
                cameraSmoothingRunning = false
                return
            }
            val now = System.currentTimeMillis()
            val dt = (now - lastCameraSmoothAt).coerceIn(1L, 80L).toDouble()
            lastCameraSmoothAt = now
            val alpha = (1.0 - Math.exp(-dt / 170.0)).coerceIn(0.05, 0.28)

            val current = map.cameraState
            val fromLat = if (lastCameraLat.isFinite()) lastCameraLat else current.center.latitude()
            val fromLng = if (lastCameraLng.isFinite()) lastCameraLng else current.center.longitude()
            val fromZoom = if (lastCameraZoom.isFinite()) lastCameraZoom else current.zoom
            val fromBearing = if (lastCameraBearing.isFinite()) lastCameraBearing else current.bearing
            val curLat = lerp(fromLat, targetCameraLat, alpha.toFloat())
            val curLng = lerp(fromLng, targetCameraLng, alpha.toFloat())
            val curZoom = lerp(fromZoom, targetCameraZoom, alpha.toFloat())
            val curBearing = lerpAngle(fromBearing, targetCameraBearing, alpha.toFloat())

            map.setCamera(
                CameraOptions.Builder()
                    .center(Point.fromLngLat(curLng, curLat))
                    .zoom(curZoom)
                    .pitch(54.0)
                    .bearing(curBearing)
                    .padding(EdgeInsets(92.0, 18.0, 110.0, 18.0))
                    .build()
            )
            lastCameraLat = curLat
            lastCameraLng = curLng
            lastCameraZoom = curZoom
            lastCameraBearing = curBearing
            overlay?.postInvalidateOnAnimation()

            if (presentation != null) {
                mainHandler.postDelayed(this, 16L)
            } else {
                cameraSmoothingRunning = false
            }
        }
    }

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
        latestPayloadAt = System.currentTimeMillis()
        mainHandler.post { updateMap() }
    }

    fun onClick(x: Float, y: Float) {
        mainHandler.post {
            when (overlay?.hitAction(x, y)) {
                "search" -> carContext.getCarService(ScreenManager::class.java).push(VroomSearchScreen(carContext))
                "report" -> carContext.getCarService(ScreenManager::class.java).push(VroomReportScreen(carContext))
                "recenter" -> {
                    userBrowsing = false
                    updateMap(forceFollow = true)
                }
                else -> Unit
            }
        }
    }

    fun onScroll(distanceX: Float, distanceY: Float) {
        mainHandler.post {
            userBrowsing = true
            val map = mapView?.getMapboxMap() ?: return@post
            val center = map.cameraState.center
            val screen = map.pixelForCoordinate(center)
            val next = map.coordinateForPixel(
                ScreenCoordinate(screen.x - distanceX.toDouble(), screen.y - distanceY.toDouble())
            )
            map.setCamera(CameraOptions.Builder().center(next).build())
            overlay?.postInvalidateOnAnimation()
        }
    }

    fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        mainHandler.post {
            userBrowsing = true
            val map = mapView?.getMapboxMap() ?: return@post
            val zoom = (map.cameraState.zoom + kotlin.math.log(scaleFactor.toDouble(), 2.0)).coerceIn(4.0, 20.0)
            map.setCamera(CameraOptions.Builder().zoom(zoom).build())
            overlay?.postInvalidateOnAnimation()
        }
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

    private fun updateMap(forceFollow: Boolean = false) {
        val payload = latestPayload
        if (mapView?.getMapboxMap() == null) return
        val center = resolveCameraCenter(payload)
        val payloadSpeedKmh = payload?.let { payloadSpeedKmh(it) } ?: 0.0
        val targetZoom = stableDynamicZoom(payloadSpeedKmh, payload?.isNavigating == true)
        val targetBearing = if (payloadSpeedKmh >= 5.0) {
            payload?.heading ?: lastCameraBearing.takeIf { it.isFinite() } ?: 0.0
        } else {
            lastCameraBearing.takeIf { it.isFinite() } ?: payload?.heading ?: 0.0
        }

        if (!userBrowsing || forceFollow) {
            setCameraTarget(center.lat, center.lng, targetZoom, targetBearing)
        }

        overlay?.followMode = !userBrowsing || forceFollow
        overlay?.applyPayload(payload)
        overlay?.mapView = mapView
        overlay?.visibleArea = visibleArea
        overlay?.postInvalidateOnAnimation()
    }

    private fun setCameraTarget(lat: Double, lng: Double, zoom: Double, bearing: Double) {
        targetCameraLat = lat
        targetCameraLng = lng
        targetCameraZoom = zoom
        targetCameraBearing = bearing
        if (!cameraSmoothingRunning) {
            cameraSmoothingRunning = true
            lastCameraSmoothAt = System.currentTimeMillis()
            mainHandler.post(cameraSmoothingStep)
        }
    }

    private fun lerp(from: Double, to: Double, t: Float): Double = from + (to - from) * t

    private fun lerpAngle(from: Double, to: Double, t: Float): Double {
        val delta = ((to - from + 540.0) % 360.0) - 180.0
        return (from + delta * t + 360.0) % 360.0
    }

    private fun resolveCenter(payload: VroomPayload?): AutoRoutePoint {
        if (payload?.userLat != null && payload.userLng != null) {
            return AutoRoutePoint(payload.userLat, payload.userLng)
        }
        payload?.routePoints?.firstOrNull()?.let { return it }
        return AutoRoutePoint(DEFAULT_LAT, DEFAULT_LNG)
    }

    private fun resolveCameraCenter(payload: VroomPayload?): AutoRoutePoint {
        val base = resolveFollowBase(payload)
        val p = payload ?: return base
        val heading = p.heading ?: return base
        val speedKmh = payloadSpeedKmh(p)
        if (speedKmh < 5.0) return base
        val lookAheadMeters = dynamicLookAheadMeters(speedKmh, p.isNavigating)
        val ageSec = ((System.currentTimeMillis() - latestPayloadAt).coerceIn(0L, 2200L)).toDouble() / 1000.0
        val speedMps = (speedKmh / 3.6).coerceAtLeast(0.0)
        return pointAhead(base, heading, lookAheadMeters + speedMps * ageSec)
    }

    private fun resolveFollowBase(payload: VroomPayload?): AutoRoutePoint {
        return resolveCenter(payload)
    }

    private fun dynamicDriveZoom(speedKmh: Double, navigating: Boolean): Double {
        val speed = speedKmh.coerceIn(0.0, 140.0)
        val base = when {
            speed < 8.0 -> 17.85
            speed < 25.0 -> 17.65 - ((speed - 8.0) / 17.0) * 0.28
            speed < 55.0 -> 17.37 - ((speed - 25.0) / 30.0) * 0.42
            speed < 95.0 -> 16.95 - ((speed - 55.0) / 40.0) * 0.55
            else -> 16.40 - ((speed - 95.0) / 45.0) * 0.22
        }
        return (base + if (navigating) 0.08 else 0.0).coerceIn(16.05, 17.9)
    }

    private fun stableDynamicZoom(speedKmh: Double, navigating: Boolean): Double {
        val now = System.currentTimeMillis()
        val dt = if (lastZoomUpdateAt > 0L) (now - lastZoomUpdateAt).coerceIn(1L, 900L).toDouble() else 180.0
        lastZoomUpdateAt = now
        val speedAlpha = (1.0 - Math.exp(-dt / 1800.0)).coerceIn(0.02, 0.16)
        stableCameraSpeedKmh += (speedKmh.coerceIn(0.0, 160.0) - stableCameraSpeedKmh) * speedAlpha
        val desired = dynamicDriveZoom(stableCameraSpeedKmh, navigating)
        if (!stableCameraZoom.isFinite()) stableCameraZoom = desired
        val delta = desired - stableCameraZoom
        if (kotlin.math.abs(delta) < 0.045) return stableCameraZoom
        val maxStep = 0.22 * (dt / 1000.0)
        stableCameraZoom = (stableCameraZoom + delta.coerceIn(-maxStep, maxStep)).coerceIn(16.05, 17.9)
        return stableCameraZoom
    }

    private fun dynamicLookAheadMeters(speedKmh: Double, navigating: Boolean): Double {
        val speed = speedKmh.coerceIn(0.0, 140.0)
        val base = when {
            speed < 10.0 -> 16.0
            speed < 35.0 -> 16.0 + ((speed - 10.0) / 25.0) * 26.0
            speed < 75.0 -> 42.0 + ((speed - 35.0) / 40.0) * 34.0
            else -> 76.0 + ((speed - 75.0) / 65.0) * 34.0
        }
        return (base + if (navigating) 18.0 else 0.0).coerceIn(12.0, 128.0)
    }

    private fun pointAhead(point: AutoRoutePoint, heading: Double, meters: Double): AutoRoutePoint {
        val bearing = Math.toRadians(heading)
        val latRad = Math.toRadians(point.lat)
        val distanceRatio = meters / EARTH_RADIUS_M
        val nextLat = point.lat + Math.toDegrees(distanceRatio * cos(bearing))
        val lngFactor = cos(latRad).coerceAtLeast(0.15)
        val nextLng = point.lng + Math.toDegrees(distanceRatio * sin(bearing) / lngFactor)
        return AutoRoutePoint(nextLat, nextLng)
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
        mainHandler.removeCallbacks(cameraSmoothingStep)
        cameraSmoothingRunning = false
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
    private val overlayHandler = Handler(Looper.getMainLooper())
    private var payload: VroomPayload? = null
    var mapView: MapView? = null
    var visibleArea: Rect? = null
    var followMode: Boolean = true
    private val hitRects = linkedMapOf<String, RectF>()
    private var avatarBitmap: Bitmap? = null
    private var avatarUrlLoaded = ""
    private var avatarLoading = false
    private var displayedLat: Double? = null
    private var displayedLng: Double? = null
    private var displayedHeading = 0.0
    private var targetLat: Double? = null
    private var targetLng: Double? = null
    private var targetHeading = 0.0
    private var displayedSpeedKmh = 0.0
    private var targetSpeedKmh = 0.0
    private var stablePayloadSpeedKmh = 0.0
    private var lastPayloadSpeedAt = 0L
    private var smoothingRunning = false
    private var lastSmoothAt = 0L

    private data class RoadProjection(
        val lat: Double,
        val lng: Double,
        val arcM: Double,
        val segmentIndex: Int
    )

    private data class RoadStep(
        val lat: Double,
        val lng: Double,
        val targetBehind: Boolean,
        val lateralCorrectionAllowed: Boolean
    )

    private val routeShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(155, 0, 0, 0)
        style = Paint.Style.STROKE
        strokeWidth = 12f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(227, 56, 53)
        style = Paint.Style.STROKE
        strokeWidth = 6.5f
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

    fun applyPayload(next: VroomPayload?) {
        payload = next
        ensureAvatarLoaded(next?.mapState?.currentUserAvatarUrl.orEmpty())
        if (next?.userLat != null && next.userLng != null) {
            targetLat = next.userLat
            targetLng = next.userLng
            targetHeading = next.heading ?: targetHeading
            targetSpeedKmh = stablePayloadSpeed(payloadSpeedKmh(next))
            if (displayedLat == null || displayedLng == null) {
                displayedLat = targetLat
                displayedLng = targetLng
                displayedHeading = next.heading ?: displayedHeading
                displayedSpeedKmh = targetSpeedKmh
            }
        } else {
            targetLat = null
            targetLng = null
            targetSpeedKmh = stablePayloadSpeed(next?.let { payloadSpeedKmh(it) } ?: 0.0)
        }
        startSmoothing()
        postInvalidateOnAnimation()
    }

    fun hitAction(x: Float, y: Float): String? =
        hitRects.entries.firstOrNull { it.value.contains(x, y) }?.key

    private fun stablePayloadSpeed(rawSpeedKmh: Double): Double {
        val clean = rawSpeedKmh.takeIf { it.isFinite() && it >= 0.0 }?.coerceIn(0.0, 180.0) ?: 0.0
        val now = System.currentTimeMillis()
        if (lastPayloadSpeedAt <= 0L) {
            lastPayloadSpeedAt = now
            stablePayloadSpeedKmh = clean
            return stablePayloadSpeedKmh
        }
        val dtSec = ((now - lastPayloadSpeedAt).coerceIn(1L, 1_200L)).toDouble() / 1000.0
        lastPayloadSpeedAt = now
        if (clean < 1.0 && stablePayloadSpeedKmh < 5.0) {
            stablePayloadSpeedKmh = clean
            return stablePayloadSpeedKmh
        }
        val delta = clean - stablePayloadSpeedKmh
        val maxUp = (30.0 * dtSec).coerceAtLeast(1.2)
        val maxDown = (10.0 * dtSec).coerceAtLeast(0.7)
        stablePayloadSpeedKmh += if (clean < stablePayloadSpeedKmh * 0.55 && stablePayloadSpeedKmh > 18.0) {
            -maxDown * 0.35
        } else {
            delta.coerceIn(-maxDown, maxUp)
        }
        return stablePayloadSpeedKmh.coerceIn(0.0, 180.0)
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
        if (!snap.isNavigating && !snap.mapState.routePreview && !snap.mapState.isBuilding) return
        if (snap.mapState.nativeRoadMatch && !snap.isNavigating && !snap.mapState.routePreview) return
        val points = snap.routePoints
        if (points.size < 2) return
        val routePoints = visibleRoutePointsFromVehicle(snap, points)
        if (routePoints.size < 2) return
        val path = Path()
        routePoints.forEachIndexed { index, point ->
            val projected = project(point.lat, point.lng) ?: return@forEachIndexed
            if (index == 0) path.moveTo(projected.first, projected.second) else path.lineTo(projected.first, projected.second)
        }
        routePaint.color = if (snap.isNavigating) Color.rgb(227, 56, 53) else Color.argb(225, 227, 56, 53)
        canvas.drawPath(path, routeShadow)
        canvas.drawPath(path, routePaint)
    }

    private fun visibleRoutePointsFromVehicle(
        snap: VroomPayload,
        points: List<AutoRoutePoint>
    ): List<AutoRoutePoint> {
        val vehicleLat = displayedLat ?: snap.userLat ?: return points
        val vehicleLng = displayedLng ?: snap.userLng ?: return points
        val projection = projectOnRoad(vehicleLat, vehicleLng, points, 140.0) ?: return points
        val startIndex = projection.segmentIndex.coerceIn(0, points.size - 2)
        val trimmed = ArrayList<AutoRoutePoint>(points.size - startIndex + 1)
        trimmed.add(AutoRoutePoint(projection.lat, projection.lng))
        for (i in (startIndex + 1) until points.size) {
            trimmed.add(points[i])
        }
        return if (trimmed.size >= 2) trimmed else points
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
        val lat = displayedLat ?: snap.userLat ?: return
        val lng = displayedLng ?: snap.userLng ?: return
        val point = if (followMode) {
            val safe = visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
            Pair(canvas.width * 0.5f, safe.bottom - 88f)
        } else {
            project(lat, lng) ?: return
        }
        if (snap.mapState.locationMarkerStyle == "arrow") {
            drawArrowMarker(canvas, point.first, point.second, markerScreenHeading(displayedHeading))
            return
        }
        val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(75, 227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 34f, halo)
        val avatarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(8, 8, 10)
            style = Paint.Style.FILL
        }
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 4f
        }
        canvas.drawCircle(point.first, point.second, 22f, avatarPaint)
        avatarBitmap?.let {
            val clip = Path().apply { addCircle(point.first, point.second, 20f, Path.Direction.CW) }
            val save = canvas.save()
            canvas.clipPath(clip)
            canvas.drawBitmap(it, null, RectF(point.first - 20f, point.second - 20f, point.first + 20f, point.second + 20f), null)
            canvas.restoreToCount(save)
        }
        canvas.drawCircle(point.first, point.second, 22f, border)
        if (avatarBitmap == null) {
            textPaint.textSize = 15f
            textPaint.color = Color.WHITE
            canvas.drawText("VR", point.first, point.second + 5f, textPaint)
        }
    }

    private fun drawHud(canvas: Canvas, snap: VroomPayload?) {
        hitRects.clear()
        val safe = visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
        val top = safe.top + 14f
        val bottom = safe.bottom - 14f

        val search = RectF(24f, top, canvas.width - 24f, top + 58f)
        hitRects["search"] = search
        panelPaint.color = Color.argb(232, 10, 10, 12)
        strokePaint.color = Color.argb(190, 227, 56, 53)
        canvas.drawRoundRect(search, 29f, 29f, panelPaint)
        canvas.drawRoundRect(search, 29f, 29f, strokePaint)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 22f
        smallText.color = Color.argb(210, 255, 255, 255)
        canvas.drawText(snap?.destinationName?.takeIf { it.isNotBlank() } ?: "Wyszukaj adres lub miejsce...", search.left + 62f, search.centerY() + 8f, smallText)
        drawSearchIcon(canvas, search.left + 32f, search.centerY())

        val speedRect = RectF(24f, bottom - 136f, 128f, bottom - 4f)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(speedRect, 18f, 18f, panelPaint)
        textPaint.textSize = 46f
        textPaint.color = Color.WHITE
        canvas.drawText(Math.round(displayedSpeedKmh.coerceAtLeast(0.0)).toString(), speedRect.centerX(), speedRect.top + 88f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 16f
        smallText.color = Color.rgb(160, 160, 166)
        canvas.drawText("km/h", speedRect.centerX(), speedRect.top + 116f, smallText)
        snap?.mapState?.speedLimitKmh?.let {
            val limit = RectF(speedRect.left + 24f, speedRect.top + 9f, speedRect.right - 24f, speedRect.top + 45f)
            val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            canvas.drawOval(limit, white)
            textPaint.textSize = 17f
            textPaint.color = Color.rgb(20, 20, 20)
            canvas.drawText(it.toInt().toString(), limit.centerX(), limit.centerY() + 6f, textPaint)
        }

        drawLiveBadge(canvas, canvas.width - 132f, bottom - 208f)
        val recenterRect = RectF(canvas.width - 138f, bottom - 152f, canvas.width - 26f, bottom - 96f)
        hitRects["recenter"] = recenterRect
        drawRoundIconButton(canvas, recenterRect, "◎", Color.rgb(230, 230, 236))
        val reportRect = RectF(canvas.width - 138f, bottom - 84f, canvas.width - 26f, bottom)
        hitRects["report"] = reportRect
        drawReportButton(canvas, reportRect.left, reportRect.top)
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
        val rect = RectF(left, top, left + 112f, top + 84f)
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

    private fun drawRoundIconButton(canvas: Canvas, rect: RectF, label: String, color: Int) {
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 18f, 18f, panelPaint)
        strokePaint.color = Color.argb(130, 255, 255, 255)
        canvas.drawRoundRect(rect, 18f, 18f, strokePaint)
        textPaint.textSize = 34f
        textPaint.color = color
        canvas.drawText(label, rect.centerX(), rect.centerY() + 12f, textPaint)
    }

    private fun markerScreenHeading(heading: Double): Double {
        val bearing = mapView?.getMapboxMap()?.cameraState?.bearing ?: 0.0
        return ((heading - bearing) % 360.0 + 360.0) % 360.0
    }

    private fun drawArrowMarker(canvas: Canvas, x: Float, y: Float, heading: Double) {
        val outerHalo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(72, 227, 56, 53)
            style = Paint.Style.FILL
        }
        val innerHalo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(48, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2.5f
        }
        canvas.drawCircle(x, y, 31f, outerHalo)
        canvas.drawCircle(x, y, 22f, innerHalo)

        val save = canvas.save()
        canvas.rotate(heading.toFloat(), x, y)
        val path = Path().apply {
            moveTo(x, y - 27f)
            cubicTo(x + 6f, y - 13f, x + 13f, y + 3f, x + 18f, y + 18f)
            cubicTo(x + 10f, y + 14f, x + 5f, y + 10f, x, y + 6f)
            cubicTo(x - 5f, y + 10f, x - 10f, y + 14f, x - 18f, y + 18f)
            cubicTo(x - 13f, y + 3f, x - 6f, y - 13f, x, y - 27f)
            close()
        }
        val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(95, 0, 0, 0)
            style = Paint.Style.FILL
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3.2f
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
        }
        val shine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(88, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
            strokeCap = Paint.Cap.ROUND
        }
        canvas.save()
        canvas.translate(0f, 3f)
        canvas.drawPath(path, shadow)
        canvas.restore()
        canvas.drawPath(path, fill)
        canvas.drawPath(path, stroke)
        canvas.drawLine(x, y - 16f, x, y + 3f, shine)
        canvas.restoreToCount(save)
    }

    private fun project(lat: Double, lng: Double): Pair<Float, Float>? {
        val map = mapView?.getMapboxMap() ?: return null
        val screen = map.pixelForCoordinate(Point.fromLngLat(lng, lat))
        return Pair(screen.x.toFloat(), screen.y.toFloat())
    }

    private fun inside(point: Pair<Float, Float>, canvas: Canvas): Boolean =
        point.first >= -90f && point.second >= -90f && point.first <= canvas.width + 90f && point.second <= canvas.height + 90f

    private fun startSmoothing() {
        if (smoothingRunning) return
        smoothingRunning = true
        lastSmoothAt = System.currentTimeMillis()
        overlayHandler.post(smoothingStep)
    }

    private val smoothingStep = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            val dt = (now - lastSmoothAt).coerceIn(1L, 80L).toDouble()
            lastSmoothAt = now
            val dtSec = dt / 1000.0
            val speedDelta = targetSpeedKmh - displayedSpeedKmh
            val speedLimit = when {
                targetSpeedKmh <= 1.0 && displayedSpeedKmh < 8.0 -> 60.0
                speedDelta >= 0.0 -> 42.0
                else -> 24.0
            } * dtSec
            displayedSpeedKmh = (displayedSpeedKmh + speedDelta.coerceIn(-speedLimit, speedLimit)).coerceIn(0.0, 180.0)

            val nextLat = targetLat
            val nextLng = targetLng
            if (nextLat != null && nextLng != null) {
                val currentLat = displayedLat ?: nextLat
                val currentLng = displayedLng ?: nextLng
                val roadPoints = payload?.let { routeFollowPoints(it) }
                val travelM = (displayedSpeedKmh / 3.6) * dtSec
                val roadStep = if (displayedSpeedKmh >= 2.0 && roadPoints != null) {
                    stepAlongRoad(currentLat, currentLng, nextLat, nextLng, roadPoints, travelM)
                } else {
                    null
                }
                val predicted = roadStep?.let { Pair(it.lat, it.lng) }
                    ?: if (displayedSpeedKmh >= 2.0) {
                        advancePoint(currentLat, currentLng, displayedHeading, travelM)
                    } else {
                        Pair(currentLat, currentLng)
                    }
                val errorMeters = distanceMeters(predicted.first, predicted.second, nextLat, nextLng)
                val correctionAlpha = if (roadStep != null) {
                    when {
                        roadStep.targetBehind -> 0.0
                        !roadStep.lateralCorrectionAllowed -> 0.0
                        errorMeters > 95.0 -> 0.9
                        errorMeters > 42.0 -> 0.045
                        displayedSpeedKmh < 2.0 -> 0.06
                        else -> 0.0
                    }
                } else {
                    when {
                        errorMeters > 95.0 -> 0.9
                        errorMeters > 34.0 -> 0.12
                        displayedSpeedKmh < 2.0 -> 0.08
                        errorMeters > 12.0 -> 0.045
                        else -> 0.018
                    }
                }
                displayedLat = predicted.first + (nextLat - predicted.first) * correctionAlpha
                displayedLng = predicted.second + (nextLng - predicted.second) * correctionAlpha
                val headingDelta = ((targetHeading - displayedHeading + 540.0) % 360.0) - 180.0
                val headingAlpha = (1.0 - Math.exp(-dt / 260.0)).coerceIn(0.035, 0.18)
                displayedHeading = (displayedHeading + headingDelta * headingAlpha + 360.0) % 360.0
            }

            postInvalidateOnAnimation()

            if (payload != null || kotlin.math.abs(displayedSpeedKmh - targetSpeedKmh) > 0.2) {
                overlayHandler.postDelayed(this, 16L)
            } else {
                smoothingRunning = false
            }
        }
    }

    private fun routeFollowPoints(snap: VroomPayload): List<AutoRoutePoint>? {
        if ((snap.isNavigating || snap.mapState.routePreview) && snap.routePoints.size >= 2) return snap.routePoints
        val arcPoints = snap.mapState.autoArcWindow?.points
        if (arcPoints != null && arcPoints.size >= 2) return arcPoints
        return snap.routePoints.takeIf { it.size >= 2 }
    }

    private fun stepAlongRoad(
        currentLat: Double,
        currentLng: Double,
        targetLat: Double,
        targetLng: Double,
        points: List<AutoRoutePoint>,
        travelM: Double
    ): RoadStep? {
        if (points.size < 2) return null
        val current = projectOnRoad(currentLat, currentLng, points, 130.0) ?: return null
        val target = projectOnRoad(targetLat, targetLng, points, 130.0) ?: return null
        val gapM = target.arcM - current.arcM
        val targetBehind = gapM < -3.5
        val nextArc = when {
            gapM >= 0.0 -> {
                val catchupM = when {
                    gapM > 34.0 -> (gapM * 0.010).coerceAtMost(0.36)
                    gapM > 9.0 -> (gapM * 0.006).coerceAtMost(0.14)
                    else -> 0.0
                }
                (current.arcM + travelM + catchupM).coerceAtMost(target.arcM + 1.5)
            }
            gapM > -42.0 -> current.arcM
            else -> target.arcM
        }
        val point = pointAtRoadArc(points, nextArc) ?: return null
        return RoadStep(
            lat = point.lat,
            lng = point.lng,
            targetBehind = targetBehind,
            lateralCorrectionAllowed = gapM >= -1.0
        )
    }

    private fun projectOnRoad(
        lat: Double,
        lng: Double,
        points: List<AutoRoutePoint>,
        maxDistanceM: Double
    ): RoadProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestDistance = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val latScale = cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
            val ax = a.lng * latScale
            val ay = a.lat
            val bx = b.lng * latScale
            val by = b.lat
            val px = lng * latScale
            val py = lat
            val vx = bx - ax
            val vy = by - ay
            val len2 = vx * vx + vy * vy
            val t = if (len2 > 0.0) (((px - ax) * vx + (py - ay) * vy) / len2).coerceIn(0.0, 1.0) else 0.0
            val projLat = a.lat + (b.lat - a.lat) * t
            val projLng = a.lng + (b.lng - a.lng) * t
            val distM = distanceMeters(lat, lng, projLat, projLng)
            if (distM < bestDistance) {
                bestDistance = distM
                best = RoadProjection(
                    lat = projLat,
                    lng = projLng,
                    arcM = cumM + segM * t,
                    segmentIndex = i
                )
            }
            cumM += segM
        }
        return best?.takeIf { bestDistance <= maxDistanceM }
    }

    private fun pointAtRoadArc(points: List<AutoRoutePoint>, arcM: Double): AutoRoutePoint? {
        if (points.size < 2) return null
        var remaining = arcM.coerceAtLeast(0.0)
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            if (remaining <= segM) {
                val t = (remaining / segM).coerceIn(0.0, 1.0)
                return AutoRoutePoint(
                    lat = a.lat + (b.lat - a.lat) * t,
                    lng = a.lng + (b.lng - a.lng) * t
                )
            }
            remaining -= segM
        }
        return points.lastOrNull()
    }

    private fun advancePoint(lat: Double, lng: Double, heading: Double, meters: Double): Pair<Double, Double> {
        if (meters <= 0.0) return Pair(lat, lng)
        val bearing = Math.toRadians(heading)
        val latRad = Math.toRadians(lat)
        val ratio = meters / EARTH_RADIUS_M
        val nextLat = lat + Math.toDegrees(ratio * cos(bearing))
        val nextLng = lng + Math.toDegrees(ratio * sin(bearing) / cos(latRad).coerceAtLeast(0.15))
        return Pair(nextLat, nextLng)
    }

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return EARTH_RADIUS_M * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }

    private fun ensureAvatarLoaded(url: String) {
        val clean = url.trim()
        if (clean.isBlank()) return
        if (clean == avatarUrlLoaded && avatarBitmap != null) return
        if (avatarLoading) return
        avatarLoading = true
        Thread {
            val bitmap = runCatching {
                val conn = java.net.URL(clean).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 2500
                conn.readTimeout = 2500
                conn.inputStream.use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
            if (bitmap != null) {
                avatarBitmap = bitmap
                avatarUrlLoaded = clean
                postInvalidate()
            }
            avatarLoading = false
        }.start()
    }
}

private fun payloadSpeedKmh(payload: VroomPayload): Double {
    val raw = payload.speed?.let { it * 3.6 }?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    val map = payload.mapState.speedKmh.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    return when {
        map >= 2.0 -> map
        raw >= 2.0 -> raw
        else -> 0.0
    }
}
