package __PACKAGE__.auto

import android.app.Presentation
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
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
private const val MAPBOX_STYLE = "mapbox://styles/mapbox/dark-v11"
private const val MAPBOX_STYLE_SAT = "mapbox://styles/mapbox/satellite-v9"
private const val MAPBOX_STYLE_HYBRID = "mapbox://styles/mapbox/satellite-streets-v12"
private const val NAV_LOOKAHEAD_METERS = 80.0
private const val DEFAULT_CENTER_LAT = 52.2297
private const val DEFAULT_CENTER_LNG = 21.0122

class VroomMapSurfaceRenderer(private val context: Context) : SurfaceCallback {
  companion object {
    private const val TAG = "VroomMapSurfaceRenderer"
  }

  private val handler = Handler(Looper.getMainLooper())
  private var virtualDisplay: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var overlayView: VroomMapOverlayView? = null
  private var visibleArea: Rect? = null
  private var currentStyleUri: String? = null
  private var lastCameraCenter: AutoNavPoint? = null
  private var lifecycleOwner: SurfaceLifecycleOwner? = null

  private val redraw = object : Runnable {
    override fun run() {
      runCatching { updateMap() }
        .onFailure { Log.e(TAG, "Map redraw failed", it) }
      handler.postDelayed(this, 2500L)
    }
  }

  override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
    val canReuseSurface = mapView != null && presentation != null && virtualDisplay != null
    if (!canReuseSurface) {
      releaseSurface()
      runCatching { createMapPresentation(surfaceContainer) }
        .onFailure {
          Log.e(TAG, "createMapPresentation failed", it)
          runCatching { createFallbackPresentation(surfaceContainer) }
        }
    } else {
      runCatching { updateMap() }
        .onFailure { Log.e(TAG, "updateMap on reused surface failed", it) }
    }
    handler.removeCallbacks(redraw)
    handler.post(redraw)
  }

  override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
    releaseSurface()
  }

  override fun onVisibleAreaChanged(visibleArea: Rect) {
    this.visibleArea = Rect(visibleArea)
  }

  override fun onStableAreaChanged(stableArea: Rect) {
    this.visibleArea = Rect(stableArea)
  }

  private fun createMapPresentation(surfaceContainer: SurfaceContainer) {
    val surface = surfaceContainer.surface ?: return
    if (!surface.isValid || surfaceContainer.width <= 0 || surfaceContainer.height <= 0) return

    MapboxOptions.accessToken = MAPBOX_ACCESS_TOKEN

    val displayManager = context.getSystemService(DisplayManager::class.java)
    virtualDisplay = displayManager.createVirtualDisplay(
      "VROOM_ANDROID_AUTO_MAP",
      surfaceContainer.width,
      surfaceContainer.height,
      surfaceContainer.dpi.coerceAtLeast(160),
      surface,
      0,
    )

    val display = virtualDisplay?.display ?: return
    val nextPresentation = Presentation(context, display)
    val root = FrameLayout(nextPresentation.context)
    val owner = SurfaceLifecycleOwner().apply {
      onCreate()
      onStart()
      onResume()
    }
    attachViewTreeLifecycleOwner(root, owner)
    val nextMapView = MapView(
      nextPresentation.context,
      MapInitOptions(context = nextPresentation.context, textureView = true),
    )
    runCatching { nextMapView.getMapboxMap().loadStyleUri(MAPBOX_STYLE) }

    val mapParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    root.addView(nextMapView, mapParams)

    val nextOverlay = VroomMapOverlayView(nextPresentation.context, context as? CarContext).apply {
      mapView = nextMapView
      isClickable = false
      isFocusable = false
      setWillNotDraw(false)
    }
    root.addView(nextOverlay, mapParams)

    nextPresentation.setContentView(root)
    nextPresentation.show()

    mapView = nextMapView
    overlayView = nextOverlay
    presentation = nextPresentation
    lifecycleOwner = owner
    runCatching { updateMap() }
  }

  private fun createFallbackPresentation(surfaceContainer: SurfaceContainer) {
    val surface = surfaceContainer.surface ?: return
    if (!surface.isValid || surfaceContainer.width <= 0 || surfaceContainer.height <= 0) return
    val canvas = runCatching { surface.lockCanvas(null) }.getOrNull() ?: return
    try {
      canvas.drawColor(Color.rgb(11, 15, 23))
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 34f
      }
      canvas.drawText("VROOM", 40f, 80f, paint)
    } finally {
      runCatching { surface.unlockCanvasAndPost(canvas) }
    }
  }

  private fun releaseSurface() {
    handler.removeCallbacks(redraw)
    lifecycleOwner?.onDestroy()
    lifecycleOwner = null
    runCatching { presentation?.dismiss() }
    presentation = null
    mapView = null
    overlayView = null
    runCatching { virtualDisplay?.release() }
    virtualDisplay = null
  }

  private fun attachViewTreeLifecycleOwner(view: View, owner: LifecycleOwner) {
    runCatching {
      val clazz = Class.forName("androidx.lifecycle.ViewTreeLifecycleOwner")
      val method = clazz.getMethod("set", View::class.java, LifecycleOwner::class.java)
      method.invoke(null, view, owner)
    }.onFailure {
      Log.w(TAG, "ViewTreeLifecycleOwner not available on compile/runtime classpath")
    }
  }

  private fun updateMap() {
    AutoNavStore.refreshFromBackendIfNeeded(context)
    val snapshot = AutoNavStore.snapshot(context)
    val map = mapView?.getMapboxMap()
    val center = snapshot.cameraCenter()
      ?: lastCameraCenter
      ?: AutoNavPoint(DEFAULT_CENTER_LAT, DEFAULT_CENTER_LNG)
    val styleUri = resolveStyle(snapshot.mapStyle)

    if (map != null) {
      if (currentStyleUri != styleUri) {
        currentStyleUri = styleUri
        map.loadStyleUri(styleUri) { overlayView?.invalidate() }
      }
      lastCameraCenter = center
      map.setCamera(
        CameraOptions.Builder()
          .center(Point.fromLngLat(center.lng, center.lat))
          .zoom(snapshot.cameraZoom())
          .bearing(if (snapshot.isNavigating || snapshot.isDriving) snapshot.heading else 0.0)
          .pitch(if (snapshot.isNavigating || snapshot.isDriving) 62.0 else 0.0)
          .padding(EdgeInsets(90.0, 40.0, 210.0, 40.0))
          .build(),
      )
    }
    overlayView?.snapshot = snapshot
    overlayView?.mapView = mapView
    overlayView?.visibleArea = visibleArea
    overlayView?.postInvalidateOnAnimation()

  }

  private fun resolveStyle(raw: String): String {
    val style = raw.trim()
    if (style.isBlank()) return MAPBOX_STYLE
    val lower = style.lowercase()
    return when {
      "satellite-streets" in lower || ("satellite" in lower && "streets" in lower) -> MAPBOX_STYLE_HYBRID
      "satellite" in lower -> MAPBOX_STYLE_SAT
      else -> MAPBOX_STYLE
    }
  }

  private fun AutoNavSnapshot.currentPointOrRouteStart(): AutoNavPoint? =
    when {
      currentLat != 0.0 || currentLng != 0.0 -> AutoNavPoint(currentLat, currentLng)
      route.isNotEmpty() -> route.first()
      destinationLat != 0.0 || destinationLng != 0.0 -> AutoNavPoint(destinationLat, destinationLng)
      else -> null
    }

  private fun AutoNavSnapshot.cameraCenter(): AutoNavPoint? {
    val base = currentPointOrRouteStart() ?: return null
    if (!isNavigating && !isDriving) return base
    val headingRad = Math.toRadians(heading)
    val dLat = (NAV_LOOKAHEAD_METERS * cos(headingRad)) / 6_371_000.0
    val dLng = (NAV_LOOKAHEAD_METERS * sin(headingRad)) /
      (6_371_000.0 * cos(Math.toRadians(base.lat)).coerceAtLeast(0.01))
    return AutoNavPoint(
      lat = base.lat + (dLat * 180.0 / Math.PI),
      lng = base.lng + (dLng * 180.0 / Math.PI),
    )
  }

  private fun AutoNavSnapshot.cameraZoom(): Double {
    val speed = speedKmh.coerceAtLeast(0.0)
    return when {
      isNavigating || isDriving -> 18.5 - (speed.coerceAtMost(140.0) / 140.0) * 2.5
      route.size > 1 -> 14.5
      else -> 15.0
    }
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

private class VroomMapOverlayView(
  context: Context,
  private val carContext: CarContext?,
) : View(context) {
  var snapshot: AutoNavSnapshot? = null
  var mapView: MapView? = null
  var visibleArea: Rect? = null
  private var avatarBitmap: Bitmap? = null
  private var avatarUrlLoaded: String = ""
  private var avatarLoading = false
  private val quickActions = linkedMapOf<String, RectF>()
  private var activeQuickAction: String? = null

  private val routeShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(145, 0, 0, 0)
    style = Paint.Style.STROKE
    strokeWidth = 16f
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val userPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(34, 197, 94)
    style = Paint.Style.FILL
  }
  private val warningPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(255, 146, 43)
    style = Paint.Style.FILL
  }
  private val destinationPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(227, 56, 53)
    style = Paint.Style.FILL
  }
  private val startPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(77, 233, 38)
    style = Paint.Style.FILL
  }
  private val fuelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(0, 191, 255)
    style = Paint.Style.FILL
  }
  private val cameraPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.STROKE
    strokeWidth = 4f
  }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textSize = 24f
    textAlign = Paint.Align.CENTER
    setShadowLayer(4f, 0f, 1f, Color.BLACK)
  }
  private val smallTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textSize = 18f
    textAlign = Paint.Align.CENTER
    setShadowLayer(4f, 0f, 1f, Color.BLACK)
  }
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    strokeWidth = 4f
  }
  private val labelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(235, 10, 10, 10)
    style = Paint.Style.FILL
  }
  private val chipFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(224, 20, 20, 22)
    style = Paint.Style.FILL
  }
  private val chipStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(140, 255, 255, 255)
    style = Paint.Style.STROKE
    strokeWidth = 2f
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val currentSnapshot = snapshot ?: return
    ensureAvatarLoaded(currentSnapshot.currentUserAvatarUrl)
    if (currentSnapshot.isBuilding) {
      if (currentSnapshot.builderRoute.size > 1) {
        drawRoute(canvas, currentSnapshot.builderRoute, Color.rgb(227, 56, 53), 6f, true)
      } else {
        drawRoute(canvas, currentSnapshot.builderPins.map { AutoNavPoint(it.lat, it.lng) }, Color.rgb(255, 146, 43), 4f, false, dashed = true)
      }
      drawBuilderPins(canvas, currentSnapshot.builderPins)
    } else if (!currentSnapshot.arrived) {
      drawRoute(
        canvas,
        currentSnapshot.route,
        if (currentSnapshot.isNavigating) Color.argb(221, 227, 56, 53) else Color.rgb(0, 191, 255),
        6f,
        currentSnapshot.isNavigating,
      )
    }
    drawStart(canvas, currentSnapshot)
    if (currentSnapshot.showFuelStations) drawMarkers(canvas, currentSnapshot.fuelStations, fuelPaint, MarkerKind.FUEL)
    if (currentSnapshot.showSpeedCameras) drawMarkers(canvas, currentSnapshot.speedCameras, cameraPaint, MarkerKind.CAMERA)
    if (currentSnapshot.showUsers) drawMarkers(canvas, currentSnapshot.users, userPaint, MarkerKind.USER)
    if (currentSnapshot.showWarnings) drawMarkers(canvas, currentSnapshot.warnings, warningPaint, MarkerKind.WARNING)
    drawDestination(canvas, currentSnapshot)
    drawCar(canvas, currentSnapshot)
    drawQuickReportButtons(canvas, currentSnapshot)
    drawSpeedHud(canvas, currentSnapshot)
    drawDrivingModeHud(canvas, currentSnapshot)
  }

  /**
   * This view sits above [MapView]. When [onTouchEvent] returns false, Android does not deliver
   * the gesture to sibling views — override [dispatchTouchEvent] and forward misses to the map.
   */
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val map = mapView
    return if (map != null) {
      if (forwardTouch(event)) true else map.dispatchTouchEvent(event)
    } else {
      super.dispatchTouchEvent(event)
    }
  }

  fun forwardTouch(event: MotionEvent): Boolean {
    val x = event.x
    val y = event.y
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val hit = quickActions.entries.firstOrNull { it.value.contains(x, y) }?.key
        activeQuickAction = hit
        return hit != null
      }
      MotionEvent.ACTION_MOVE -> return activeQuickAction != null
      MotionEvent.ACTION_UP -> {
        val active = activeQuickAction
        activeQuickAction = null
        if (active != null && quickActions[active]?.contains(x, y) == true) {
          handleOverlayAction(active)
          performClick()
          return true
        }
        return false
      }
      MotionEvent.ACTION_CANCEL -> {
        activeQuickAction = null
        return false
      }
    }
    return false
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  private fun drawQuickReportButtons(canvas: Canvas, snapshot: AutoNavSnapshot) {
    quickActions.clear()
    if (snapshot.isBuilding) return
    val top = (visibleArea?.top ?: 0) + 14f
    val leftCol = 14f
    val searchRect = RectF(96f, top, width - 16f, top + 56f)
    drawSearchBar(canvas, searchRect)
    quickActions["open_search"] = searchRect

    val buttonSize = 52f
    val gap = 58f
    var row = top
    drawSideButton(canvas, "open_menu", RectF(leftCol, row, leftCol + buttonSize, row + buttonSize), Color.rgb(220, 228, 236))
    row += gap
    drawSideButton(canvas, "open_settings", RectF(leftCol, row, leftCol + buttonSize, row + buttonSize), Color.rgb(0, 191, 255))
    row += gap
    drawSideButton(canvas, "recenter", RectF(leftCol, row, leftCol + buttonSize, row + buttonSize), Color.rgb(227, 56, 53))
    row += gap
    drawSideButton(canvas, "open_report", RectF(leftCol, row, leftCol + buttonSize, row + buttonSize), Color.rgb(232, 154, 54))
  }

  private fun drawSearchBar(canvas: Canvas, rect: RectF) {
    chipFillPaint.color = Color.argb(232, 12, 12, 14)
    chipStrokePaint.strokeWidth = 2f
    chipStrokePaint.color = Color.argb(200, 0, 191, 255)
    canvas.drawRoundRect(rect, 28f, 28f, chipFillPaint)
    canvas.drawRoundRect(rect, 28f, 28f, chipStrokePaint)

    drawMapPinIcon(canvas, rect.left + 31f, rect.centerY(), 15f)
    smallTextPaint.textSize = 25f
    smallTextPaint.color = Color.rgb(0, 191, 255)
    smallTextPaint.textAlign = Paint.Align.LEFT
    smallTextPaint.clearShadowLayer()
    canvas.drawText("Szukaj", rect.left + 68f, rect.centerY() + 9f, smallTextPaint)
    smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
    smallTextPaint.textSize = 18f
    smallTextPaint.textAlign = Paint.Align.CENTER
    smallTextPaint.color = Color.WHITE
  }

  private fun drawSideButton(canvas: Canvas, action: String, rect: RectF, color: Int) {
    chipFillPaint.color = Color.argb(228, 16, 16, 18)
    chipStrokePaint.strokeWidth = 2f
    chipStrokePaint.color = Color.argb(140, 0, 191, 255)
    canvas.drawRoundRect(rect, rect.width() / 2f, rect.height() / 2f, chipFillPaint)
    canvas.drawRoundRect(rect, rect.width() / 2f, rect.height() / 2f, chipStrokePaint)

    when (action) {
      "open_menu" -> drawMenuIcon(canvas, rect.centerX(), rect.centerY(), color)
      "open_settings" -> drawGearIcon(canvas, rect.centerX(), rect.centerY(), color)
      "open_report" -> drawReportIcon(canvas, rect.centerX(), rect.centerY(), color)
      "recenter" -> drawCompassIcon(canvas, rect.centerX(), rect.centerY(), color)
    }
    quickActions[action] = rect
  }

  private fun drawMapPinIcon(canvas: Canvas, cx: Float, cy: Float, radius: Float) {
    iconPaint.style = Paint.Style.FILL
    iconPaint.color = Color.rgb(0, 191, 255)
    canvas.drawCircle(cx, cy - 3f, radius, iconPaint)
    iconPaint.color = Color.rgb(227, 56, 53)
    val pin = Path().apply {
      moveTo(cx, cy + 21f)
      lineTo(cx - 11f, cy + 3f)
      lineTo(cx + 11f, cy + 3f)
      close()
    }
    canvas.drawPath(pin, iconPaint)
    iconPaint.color = Color.WHITE
    canvas.drawCircle(cx, cy - 3f, radius * 0.42f, iconPaint)
  }

  private fun drawMenuIcon(canvas: Canvas, cx: Float, cy: Float, color: Int) {
    iconPaint.color = color
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = 3.2f
    iconPaint.strokeCap = Paint.Cap.ROUND
    val w = 16f
    val half = w / 2f
    val y1 = cy - 9f
    val y2 = cy
    val y3 = cy + 9f
    canvas.drawLine(cx - half, y1, cx + half, y1, iconPaint)
    canvas.drawLine(cx - half, y2, cx + half, y2, iconPaint)
    canvas.drawLine(cx - half, y3, cx + half, y3, iconPaint)
    iconPaint.style = Paint.Style.FILL
  }

  private fun drawGearIcon(canvas: Canvas, cx: Float, cy: Float, color: Int) {
    iconPaint.color = color
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = 3.4f
    canvas.drawCircle(cx, cy, 9.5f, iconPaint)
    for (i in 0 until 8) {
      val angle = Math.toRadians((i * 45).toDouble())
      val sx = cx + (cos(angle) * 14.0).toFloat()
      val sy = cy + (sin(angle) * 14.0).toFloat()
      val ex = cx + (cos(angle) * 18.0).toFloat()
      val ey = cy + (sin(angle) * 18.0).toFloat()
      canvas.drawLine(sx, sy, ex, ey, iconPaint)
    }
    iconPaint.style = Paint.Style.FILL
    canvas.drawCircle(cx, cy, 3.8f, iconPaint)
  }

  private fun drawReportIcon(canvas: Canvas, cx: Float, cy: Float, color: Int) {
    iconPaint.color = color
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = 4f
    val triangle = Path().apply {
      moveTo(cx, cy - 17f)
      lineTo(cx - 17f, cy + 15f)
      lineTo(cx + 17f, cy + 15f)
      close()
    }
    canvas.drawPath(triangle, iconPaint)
    iconPaint.style = Paint.Style.FILL
    canvas.drawRoundRect(RectF(cx - 2f, cy - 6f, cx + 2f, cy + 7f), 2f, 2f, iconPaint)
    canvas.drawCircle(cx, cy + 13f, 2.2f, iconPaint)
  }

  private fun drawCompassIcon(canvas: Canvas, cx: Float, cy: Float, color: Int) {
    iconPaint.color = color
    iconPaint.style = Paint.Style.FILL
    val arrow = Path().apply {
      moveTo(cx, cy - 18f)
      lineTo(cx - 10f, cy + 16f)
      lineTo(cx, cy + 9f)
      lineTo(cx + 10f, cy + 16f)
      close()
    }
    canvas.drawPath(arrow, iconPaint)
  }

  private fun handleOverlayAction(action: String) {
    when (action) {
      "open_search" -> openScreen { VroomSearchTextScreen(it) }
      "open_menu" -> openScreen { VroomMenuScreen(it) }
      "open_report" -> openScreen { VroomReportScreen(it) }
      "open_settings" -> openScreen { VroomMapSettingsScreen(it) }
      "recenter" -> recenterMap()
      else -> AutoNavStore.requestReport(carContext ?: context, action)
    }
  }

  private fun openScreen(factory: (CarContext) -> androidx.car.app.Screen) {
    val car = carContext ?: return
    runCatching {
      car.getCarService(ScreenManager::class.java).push(factory(car))
    }
  }

  private fun recenterMap() {
    val snap = snapshot ?: return
    val lat = snap.currentLat.takeIf { it != 0.0 } ?: return
    val lng = snap.currentLng.takeIf { it != 0.0 } ?: return
    val zoom = when {
      snap.isNavigating || snap.isDriving -> 16.8
      snap.route.size > 1 -> 14.2
      else -> 15.0
    }
    mapView?.getMapboxMap()?.setCamera(
      CameraOptions.Builder()
        .center(Point.fromLngLat(lng, lat))
        .zoom(zoom)
        .build(),
    )
  }

  private fun drawRoute(
    canvas: Canvas,
    route: List<AutoNavPoint>,
    color: Int,
    width: Float,
    glow: Boolean,
    dashed: Boolean = false,
  ) {
    if (route.size < 2) return
    val path = Path()
    var hasPoint = false
    route.forEach { point ->
      val screen = project(point) ?: return@forEach
      if (!hasPoint) {
        path.moveTo(screen.first, screen.second)
        hasPoint = true
      } else {
        path.lineTo(screen.first, screen.second)
      }
    }
    if (!hasPoint) return
    routePaint.color = color
    routePaint.strokeWidth = width
    routePaint.pathEffect = if (dashed) DashPathEffect(floatArrayOf(18f, 10f), 0f) else null
    routeShadowPaint.pathEffect = routePaint.pathEffect
    canvas.drawPath(path, routeShadowPaint)
    canvas.drawPath(path, routePaint)
    if (glow) {
      routePaint.color = Color.argb(28, 255, 255, 255)
      routePaint.strokeWidth = 12f
      routePaint.pathEffect = null
      canvas.drawPath(path, routePaint)
    }
    routePaint.pathEffect = null
    routeShadowPaint.pathEffect = null
  }

  private fun drawMarkers(
    canvas: Canvas,
    markers: List<AutoMapMarker>,
    paint: Paint,
    kind: MarkerKind,
  ) {
    markers.take(70).forEach { marker ->
      val screen = project(AutoNavPoint(marker.lat, marker.lng)) ?: return@forEach
      when (kind) {
        MarkerKind.USER -> drawUserMarker(canvas, screen.first, screen.second, marker)
        MarkerKind.WARNING -> drawWarningMarker(canvas, screen.first, screen.second, marker)
        MarkerKind.CAMERA -> drawSpeedCameraMarker(canvas, screen.first, screen.second, marker)
        MarkerKind.FUEL -> drawFuelMarker(canvas, screen.first, screen.second, marker)
      }
    }
  }

  private fun drawUserMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    val markerColor = when {
      marker.isPremium -> Color.rgb(255, 215, 0)
      marker.isFriend -> Color.rgb(77, 233, 38)
      else -> Color.rgb(0, 191, 255)
    }
    labelBgPaint.color = Color.argb(82, Color.red(markerColor), Color.green(markerColor), Color.blue(markerColor))
    canvas.drawCircle(x, y, 24f, labelBgPaint)
    userPaint.color = markerColor
    canvas.drawCircle(x, y, if (marker.isPremium) 15f else 13f, userPaint)
    val border = Paint(strokePaint).apply {
      this.color = Color.argb(210, 255, 255, 255)
      strokeWidth = 3f
    }
    canvas.drawCircle(x, y, if (marker.isPremium) 15f else 13f, border)
  }

  private fun drawWarningMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    val color = warningColor(marker.type)
    warningPaint.color = color
    val rect = RectF(x - 23f, y - 23f, x + 23f, y + 23f)
    labelBgPaint.color = Color.argb(232, 255, 255, 255)
    canvas.drawRoundRect(rect, 16f, 16f, labelBgPaint)
    labelBgPaint.color = Color.argb(32, Color.red(color), Color.green(color), Color.blue(color))
    canvas.drawCircle(x, y, 19f, labelBgPaint)
    canvas.drawCircle(x, y, 14f, warningPaint)
    canvas.drawText("!", x, y + 9f, textPaint)
    if (marker.count > 0) drawSmallBadge(canvas, x + 19f, y - 19f, "+${marker.count}", color)
  }

  private fun drawSpeedCameraMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    if (marker.type == "bump") {
      val rect = RectF(x - 28f, y - 22f, x + 28f, y + 22f)
      cameraPaint.color = Color.argb(232, 250, 250, 250)
      canvas.drawRoundRect(rect, 14f, 14f, cameraPaint)
      smallTextPaint.color = Color.rgb(77, 233, 38)
      smallTextPaint.clearShadowLayer()
      canvas.drawText("PROG", x, y + 6f, smallTextPaint)
      smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
      smallTextPaint.color = Color.WHITE
      return
    }

    cameraPaint.color = Color.argb(238, 255, 255, 255)
    canvas.drawCircle(x, y, 24f, cameraPaint)
    val border = Paint(strokePaint).apply {
      color = Color.rgb(204, 0, 0)
      strokeWidth = 4f
    }
    canvas.drawCircle(x, y, 24f, border)
    smallTextPaint.color = Color.rgb(17, 17, 17)
    smallTextPaint.clearShadowLayer()
    canvas.drawText(marker.value.ifBlank { "CAM" }, x, y + 7f, smallTextPaint)
    smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
    smallTextPaint.color = Color.WHITE
  }

  private fun drawFuelMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    val rect = RectF(x - 25f, y - 42f, x + 25f, y + 9f)
    labelBgPaint.color = Color.argb(238, 250, 250, 250)
    canvas.drawRoundRect(rect, 15f, 15f, labelBgPaint)
    iconPaint.color = Color.rgb(0, 144, 214)
    iconPaint.style = Paint.Style.FILL
    canvas.drawRoundRect(RectF(x - 10f, y - 29f, x + 5f, y - 8f), 3f, 3f, iconPaint)
    canvas.drawRect(x - 6f, y - 4f, x + 9f, y + 1f, iconPaint)
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = 3f
    canvas.drawLine(x + 6f, y - 25f, x + 14f, y - 16f, iconPaint)
    canvas.drawLine(x + 14f, y - 16f, x + 14f, y - 4f, iconPaint)
    if (marker.value.isNotBlank()) {
      smallTextPaint.color = Color.rgb(0, 104, 156)
      smallTextPaint.clearShadowLayer()
      canvas.drawText(marker.value, x, y + 24f, smallTextPaint)
      smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
    }
    smallTextPaint.color = Color.WHITE
  }

  private fun drawBuilderPins(canvas: Canvas, pins: List<AutoMapMarker>) {
    pins.forEach { pin ->
      val screen = project(AutoNavPoint(pin.lat, pin.lng)) ?: return@forEach
      val color = when (pin.type) {
        "start" -> Color.rgb(77, 233, 38)
        "end" -> Color.rgb(227, 56, 53)
        else -> Color.rgb(255, 146, 43)
      }
      val rect = RectF(screen.first - 20f, screen.second - 42f, screen.first + 20f, screen.second - 2f)
      labelBgPaint.color = Color.argb(70, Color.red(color), Color.green(color), Color.blue(color))
      canvas.drawRoundRect(rect, 8f, 8f, labelBgPaint)
      strokePaint.color = color
      canvas.drawRoundRect(rect, 8f, 8f, strokePaint)
      strokePaint.color = Color.WHITE
      smallTextPaint.color = color
      canvas.drawText(pin.value, screen.first, screen.second - 16f, smallTextPaint)
      smallTextPaint.color = Color.WHITE
    }
  }

  private fun drawStart(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (snapshot.startLat == 0.0 && snapshot.startLng == 0.0) return
    if (snapshot.isNavigating || snapshot.isBuilding) return
    val screen = project(AutoNavPoint(snapshot.startLat, snapshot.startLng)) ?: return
    canvas.drawCircle(screen.first, screen.second, 17f, startPaint)
    canvas.drawCircle(screen.first, screen.second, 17f, strokePaint)
  }

  private fun drawDestination(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (snapshot.destinationLat == 0.0 && snapshot.destinationLng == 0.0) return
    val screen = project(AutoNavPoint(snapshot.destinationLat, snapshot.destinationLng)) ?: return
    canvas.drawCircle(screen.first, screen.second, 18f, destinationPaint)
    canvas.drawCircle(screen.first, screen.second, 18f, strokePaint)
  }

  private fun drawCar(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (snapshot.currentLat == 0.0 && snapshot.currentLng == 0.0) return
    val screen = project(AutoNavPoint(snapshot.currentLat, snapshot.currentLng)) ?: return
    if (!snapshot.useArrowMarker) {
      drawDriverAvatar(canvas, screen.first, screen.second, radius = 28f, drawBorder = false)
      return
    }

    val angle = Math.toRadians(snapshot.heading)
    val path = Path()
    val tipX = screen.first + (sin(angle) * 25.0).toFloat()
    val tipY = screen.second - (cos(angle) * 25.0).toFloat()
    val leftX = screen.first + (sin(angle + 2.45) * 17.0).toFloat()
    val leftY = screen.second - (cos(angle + 2.45) * 17.0).toFloat()
    val rightX = screen.first + (sin(angle - 2.45) * 17.0).toFloat()
    val rightY = screen.second - (cos(angle - 2.45) * 17.0).toFloat()
    path.moveTo(tipX, tipY)
    path.lineTo(leftX, leftY)
    path.lineTo(rightX, rightY)
    path.close()

    val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(95, 48, 132, 255)
      style = Paint.Style.FILL
    }
    val carPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(69, 168, 255)
      style = Paint.Style.FILL
    }
    canvas.drawCircle(screen.first, screen.second, 34f, halo)
    canvas.drawPath(path, carPaint)
    canvas.drawPath(path, strokePaint)
    drawDriverAvatar(canvas, screen.first, screen.second, radius = 16f, drawBorder = false)
  }

  private fun drawSpeedHud(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (!snapshot.isDriving && !snapshot.isNavigating) return
    val rect = RectF(width - 130f, height - 132f, width - 18f, height - 24f)
    labelBgPaint.color = Color.argb(238, 16, 18, 22)
    canvas.drawRoundRect(rect, 24f, 24f, labelBgPaint)
    textPaint.color = Color.WHITE
    textPaint.textSize = 34f
    canvas.drawText(snapshot.speedKmh.toInt().toString(), rect.centerX(), rect.top + 43f, textPaint)
    smallTextPaint.color = Color.argb(160, 255, 255, 255)
    canvas.drawText("KM/H", rect.centerX(), rect.top + 68f, smallTextPaint)
    snapshot.speedLimitKmh?.let {
      val limitRect = RectF(rect.centerX() - 34f, rect.bottom - 32f, rect.centerX() + 34f, rect.bottom - 8f)
      chipFillPaint.color = Color.argb(238, 255, 255, 255)
      canvas.drawRoundRect(limitRect, 12f, 12f, chipFillPaint)
      smallTextPaint.color = Color.rgb(209, 31, 45)
      smallTextPaint.clearShadowLayer()
      canvas.drawText(it.toString(), limitRect.centerX(), limitRect.centerY() + 7f, smallTextPaint)
      smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
    }
    textPaint.textSize = 24f
    smallTextPaint.color = Color.WHITE
  }

  private fun drawDrivingModeHud(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (!snapshot.isDriving && !snapshot.isNavigating) return
    val left = 16f
    val bottom = height - 24f
    val rect = RectF(left, bottom - 112f, left + 300f, bottom)
    labelBgPaint.color = Color.argb(224, 15, 17, 21)
    canvas.drawRoundRect(rect, 24f, 24f, labelBgPaint)

    smallTextPaint.textAlign = Paint.Align.LEFT
    smallTextPaint.color = Color.argb(230, 255, 255, 255)
    canvas.drawText(if (snapshot.isNavigating) "Nawigacja" else "Tryb jazdy", rect.left + 18f, rect.top + 31f, smallTextPaint)
    drawHudChip(canvas, rect.left + 18f, rect.top + 49f, "Ostrz. ${snapshot.warnings.size}", Color.rgb(232, 154, 54))
    drawHudChip(canvas, rect.left + 116f, rect.top + 49f, "Kam. ${snapshot.speedCameras.size}", Color.rgb(234, 234, 234))
    drawHudChip(canvas, rect.left + 205f, rect.top + 49f, "Fuel ${snapshot.fuelStations.size}", Color.rgb(0, 191, 255))
    smallTextPaint.textAlign = Paint.Align.CENTER
    smallTextPaint.color = Color.WHITE
  }

  private fun drawHudChip(canvas: Canvas, left: Float, top: Float, label: String, color: Int) {
    val chipWidth = (smallTextPaint.measureText(label) + 24f).coerceAtLeast(74f)
    val rect = RectF(left, top, left + chipWidth, top + 32f)
    chipFillPaint.color = Color.argb(42, Color.red(color), Color.green(color), Color.blue(color))
    canvas.drawRoundRect(rect, 16f, 16f, chipFillPaint)
    smallTextPaint.color = color
    smallTextPaint.clearShadowLayer()
    canvas.drawText(label, rect.left + 12f, rect.centerY() + 7f, smallTextPaint)
    smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
  }

  private fun project(point: AutoNavPoint): Pair<Float, Float>? {
    val map = mapView?.getMapboxMap() ?: return null
    val screen = map.pixelForCoordinate(Point.fromLngLat(point.lng, point.lat))
    return Pair(screen.x.toFloat(), screen.y.toFloat())
  }

  private fun drawLabel(canvas: Canvas, x: Float, y: Float, text: String, color: Int) {
    if (text.isBlank()) return
    val width = (smallTextPaint.measureText(text) + 18f).coerceAtLeast(34f)
    val rect = RectF(x - width / 2f, y - 18f, x + width / 2f, y + 8f)
    labelBgPaint.color = Color.argb(238, 10, 10, 10)
    canvas.drawRoundRect(rect, 7f, 7f, labelBgPaint)
    strokePaint.color = color
    canvas.drawRoundRect(rect, 7f, 7f, strokePaint)
    strokePaint.color = Color.WHITE
    canvas.drawText(text, x, y + 1f, smallTextPaint)
  }

  private fun drawDriverAvatar(
    canvas: Canvas,
    cx: Float,
    cy: Float,
    radius: Float = 12f,
    drawBorder: Boolean = false,
  ) {
    val avatar = avatarBitmap
    if (avatar == null) {
      labelBgPaint.color = Color.rgb(46, 106, 255)
      canvas.drawCircle(cx, cy, radius, labelBgPaint)
      iconPaint.color = Color.WHITE
      iconPaint.style = Paint.Style.FILL
      canvas.drawCircle(cx, cy - radius * 0.2f, radius * 0.28f, iconPaint)
      canvas.drawRoundRect(
        RectF(cx - radius * 0.44f, cy + radius * 0.12f, cx + radius * 0.44f, cy + radius * 0.58f),
        radius * 0.24f,
        radius * 0.24f,
        iconPaint,
      )
      return
    }
    val dst = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
    val clip = Path().apply { addCircle(cx, cy, radius, Path.Direction.CW) }
    val count = canvas.save()
    canvas.clipPath(clip)
    canvas.drawBitmap(avatar, null, dst, null)
    canvas.restoreToCount(count)
    if (drawBorder) canvas.drawCircle(cx, cy, radius, strokePaint)
  }

  private fun drawSmallBadge(canvas: Canvas, cx: Float, cy: Float, text: String, color: Int) {
    val width = (smallTextPaint.measureText(text) + 15f).coerceAtLeast(26f)
    val rect = RectF(cx - width / 2f, cy - 13f, cx + width / 2f, cy + 13f)
    chipFillPaint.color = color
    canvas.drawRoundRect(rect, 13f, 13f, chipFillPaint)
    smallTextPaint.color = Color.WHITE
    canvas.drawText(text, cx, cy + 6f, smallTextPaint)
  }

  private fun ensureAvatarLoaded(url: String) {
    val trimmed = url.trim()
    if (trimmed.isBlank()) return
    if (trimmed == avatarUrlLoaded && avatarBitmap != null) return
    if (avatarLoading) return
    avatarLoading = true
    Thread {
      val bmp = runCatching {
        val conn = java.net.URL(trimmed).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 2500
        conn.readTimeout = 2500
        conn.inputStream.use { BitmapFactory.decodeStream(it) }
      }.getOrNull()
      if (bmp != null) {
        avatarBitmap = bmp
        avatarUrlLoaded = trimmed
        postInvalidate()
      }
      avatarLoading = false
    }.start()
  }

  private fun warningColor(type: String): Int =
    when (type) {
      "traffic" -> Color.rgb(255, 107, 107)
      "weather" -> Color.rgb(255, 212, 59)
      "accident" -> Color.rgb(255, 146, 43)
      "car_breakdown" -> Color.rgb(116, 143, 252)
      "speed_control" -> Color.rgb(5, 53, 247)
      "Animal" -> Color.rgb(77, 233, 38)
      else -> Color.WHITE
    }

  private enum class MarkerKind {
    USER,
    WARNING,
    CAMERA,
    FUEL,
  }
}
