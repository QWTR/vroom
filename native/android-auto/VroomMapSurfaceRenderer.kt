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
import com.mapbox.maps.ScreenCoordinate
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
    overlayView?.visibleArea = this.visibleArea
    overlayView?.invalidate()
  }

  override fun onStableAreaChanged(stableArea: Rect) {
    this.visibleArea = Rect(stableArea)
    overlayView?.visibleArea = this.visibleArea
    overlayView?.invalidate()
  }

  /**
   * Android Auto does not route touch into the [Presentation] window. The host calls these
   * [SurfaceCallback] methods (typically after the user taps [Action.PAN] on the map action strip).
   */
  override fun onClick(x: Float, y: Float) {
    handler.post {
      runCatching { overlayView?.handleCarHostSurfaceTap(x, y) }
        .onFailure { Log.e(TAG, "onClick", it) }
    }
  }

  override fun onScroll(distanceX: Float, distanceY: Float) {
    handler.post {
      runCatching { panMapByPixelDelta(distanceX, distanceY) }
        .onFailure { Log.e(TAG, "onScroll", it) }
    }
  }

  override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
    handler.post {
      runCatching { zoomMapByScaleFactor(scaleFactor) }
        .onFailure { Log.e(TAG, "onScale", it) }
    }
  }

  private fun panMapByPixelDelta(distanceX: Float, distanceY: Float) {
    val mv = mapView ?: return
    val map = mv.getMapboxMap()
    val center = map.cameraState.center
    val screen = map.pixelForCoordinate(center)
    val target = map.coordinateForPixel(
      ScreenCoordinate(screen.x - distanceX.toDouble(), screen.y - distanceY.toDouble()),
    )
    map.setCamera(CameraOptions.Builder().center(target).build())
  }

  private fun zoomMapByScaleFactor(scaleFactor: Float) {
    val mv = mapView ?: return
    val map = mv.getMapboxMap()
    val z = map.cameraState.zoom
    val delta = kotlin.math.log(scaleFactor.toDouble(), 2.0).toFloat()
    val newZoom = (z + delta).toDouble().coerceIn(4.0, 20.0)
    map.setCamera(CameraOptions.Builder().zoom(newZoom).build())
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

  // ── Canvas overlay panel system ──────────────────────────────────────────
  private enum class OverlayPanel { NONE, MENU, WARNINGS, REPORT, SETTINGS }
  private var currentPanel = OverlayPanel.NONE
  private val panelHitRects = linkedMapOf<String, RectF>()

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
    if (currentPanel != OverlayPanel.NONE) drawPanelOverlay(canvas, currentSnapshot, currentPanel)
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

  fun handleCarHostSurfaceTap(x: Float, y: Float) {
    if (currentPanel != OverlayPanel.NONE) {
      panelHitRects.entries.firstOrNull { it.value.contains(x, y) }?.key?.let { handlePanelAction(it) }
      postInvalidateOnAnimation()
      return
    }
    val snap = snapshot ?: return
    if (width <= 0 || height <= 0) return
    if (quickActions.isEmpty()) rebuildQuickActionHitRects(snap)
    val hit = quickActions.entries.firstOrNull { it.value.contains(x, y) }?.key ?: return
    handleOverlayAction(hit)
    postInvalidateOnAnimation()
  }

  /**
   * Hit-rects for AA surface taps; mirrors [drawQuickReportButtons] geometry (keep in sync).
   */
  private fun rebuildQuickActionHitRects(snapshot: AutoNavSnapshot) {
    quickActions.clear()
    if (snapshot.isBuilding) return
    val top = (visibleArea?.top ?: 0) + 14f
    val leftCol = 14f
    val buttonSize = 52f
    val gap = 58f
    quickActions["open_search"] = RectF(96f, top, width - 16f, top + 56f)
    var row = top
    quickActions["open_menu"] = RectF(leftCol, row, leftCol + buttonSize, row + buttonSize)
    row += gap
    quickActions["open_settings"] = RectF(leftCol, row, leftCol + buttonSize, row + buttonSize)
    row += gap
    quickActions["recenter"] = RectF(leftCol, row, leftCol + buttonSize, row + buttonSize)
    row += gap
    quickActions["open_report"] = RectF(leftCol, row, leftCol + buttonSize, row + buttonSize)
  }

  fun forwardTouch(event: MotionEvent): Boolean {
    if (currentPanel != OverlayPanel.NONE) {
      if (event.actionMasked == MotionEvent.ACTION_UP) {
        panelHitRects.entries.firstOrNull { it.value.contains(event.x, event.y) }
          ?.key?.let { handlePanelAction(it) }
      }
      return true
    }

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
    rebuildQuickActionHitRects(snapshot)
    if (snapshot.isBuilding) return
    val top = (visibleArea?.top ?: 0) + 14f
    val leftCol = 14f
    val searchRect = RectF(96f, top, width - 16f, top + 56f)
    drawSearchBar(canvas, searchRect)

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
      "open_menu" -> openCanvasPanel(OverlayPanel.MENU)
      "open_report" -> openCanvasPanel(OverlayPanel.REPORT)
      "open_settings" -> openCanvasPanel(OverlayPanel.SETTINGS)
      "recenter" -> recenterMap()
      else -> AutoNavStore.requestReport(carContext ?: context, action)
    }
  }

  private fun openCanvasPanel(panel: OverlayPanel) {
    currentPanel = panel
    panelHitRects.clear()
    quickActions.clear()
    postInvalidateOnAnimation()
  }

  private fun openScreen(factory: (CarContext) -> androidx.car.app.Screen) {
    val car = carContext ?: return
    runCatching {
      car.getCarService(ScreenManager::class.java).push(factory(car))
    }
  }

  private fun handlePanelAction(action: String) {
    val car = carContext
    when {
      action == "close_panel" -> closeCanvasPanel()
      currentPanel == OverlayPanel.MENU -> when (action) {
        "menu_search" -> { closeCanvasPanel(); if (car != null) runCatching { car.getCarService(ScreenManager::class.java).push(VroomSearchTextScreen(car)) } }
        "menu_warnings" -> openCanvasPanel(OverlayPanel.WARNINGS)
        "menu_report" -> openCanvasPanel(OverlayPanel.REPORT)
        "menu_settings" -> openCanvasPanel(OverlayPanel.SETTINGS)
        "menu_cameras", "menu_fuel" -> closeCanvasPanel()
      }
      currentPanel == OverlayPanel.WARNINGS && action.startsWith("confirm_warning_") -> {
        val id = action.removePrefix("confirm_warning_")
        if (car != null) Thread { runCatching { AutoNavStore.confirmWarning(car, id) } }.start()
        postInvalidateOnAnimation()
      }
      currentPanel == OverlayPanel.REPORT -> {
        val type = when (action) {
          "report_accident" -> "accident"
          "report_traffic" -> "traffic"
          "report_speed" -> "speed_control"
          "report_weather" -> "weather"
          "report_breakdown" -> "car_breakdown"
          "report_animal" -> "Animal"
          else -> null
        }
        if (type != null && car != null) { closeCanvasPanel(); Thread { runCatching { AutoNavStore.submitReportFromCurrentLocation(car, type) } }.start() }
      }
      currentPanel == OverlayPanel.SETTINGS -> {
        val key = when (action) {
          "toggle_users" -> "show_users"; "toggle_warnings" -> "show_warnings"
          "toggle_cameras" -> "show_cameras"; "toggle_fuel" -> "show_fuel"
          "toggle_voice" -> "voice_alerts"; "toggle_speed" -> "speed_alerts"
          else -> null
        }
        if (key != null && car != null) { val cur = AutoNavStore.getMapOption(car, key, true); AutoNavStore.setMapOption(car, key, !cur); postInvalidateOnAnimation() }
      }
    }
  }

  private fun closeCanvasPanel() { currentPanel = OverlayPanel.NONE; panelHitRects.clear(); postInvalidateOnAnimation() }

  private fun drawPanelOverlay(canvas: Canvas, snap: AutoNavSnapshot, panel: OverlayPanel) {
    val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(175, 0, 0, 0); style = Paint.Style.FILL }
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
    panelHitRects.clear()
    when (panel) {
      OverlayPanel.MENU -> drawMenuPanel(canvas, snap)
      OverlayPanel.WARNINGS -> drawWarningsPanel(canvas, snap)
      OverlayPanel.REPORT -> drawReportPanel(canvas, snap)
      OverlayPanel.SETTINGS -> drawSettingsPanel(canvas, snap)
      OverlayPanel.NONE -> {}
    }
  }

  private fun panelSep(canvas: Canvas, x1: Float, y: Float, x2: Float) {
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(60, 0, 191, 255); strokeWidth = 1f; style = Paint.Style.STROKE }
    canvas.drawLine(x1, y, x2, y, p)
  }

  private fun panelCloseButton(canvas: Canvas, right: Float, top: Float): RectF {
    val rect = RectF(right - 52f, top + 10f, right - 10f, top + 50f)
    panelHitRects["close_panel"] = rect
    chipFillPaint.color = Color.argb(90, 220, 50, 50)
    canvas.drawRoundRect(rect, 9f, 9f, chipFillPaint)
    textPaint.textSize = 20f; textPaint.color = Color.WHITE
    canvas.drawText("✕", rect.centerX(), rect.centerY() + 7f, textPaint)
    textPaint.textSize = 24f
    return rect
  }

  private fun drawMenuPanel(canvas: Canvas, snap: AutoNavSnapshot) {
    val CYAN = Color.rgb(0, 191, 255)
    val panelW = width.toFloat().coerceAtMost(370f)
    val ph = height.toFloat()
    labelBgPaint.color = Color.argb(253, 7, 8, 12)
    canvas.drawRect(0f, 0f, panelW, ph, labelBgPaint)
    val borderP = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(200, 0, 191, 255); strokeWidth = 3f; style = Paint.Style.STROKE }
    canvas.drawLine(panelW, 0f, panelW, ph, borderP)
    labelBgPaint.color = Color.argb(255, 10, 12, 18)
    canvas.drawRect(0f, 0f, panelW, 62f, labelBgPaint)
    panelSep(canvas, 0f, 62f, panelW)
    panelCloseButton(canvas, panelW, 0f)
    smallTextPaint.textSize = 22f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = CYAN; smallTextPaint.clearShadowLayer()
    canvas.drawText("VROOM", 20f, 40f, smallTextPaint)
    smallTextPaint.textSize = 13f; smallTextPaint.color = Color.argb(130, 200, 200, 200)
    canvas.drawText("Menu", 20f, 56f, smallTextPaint); smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
    data class MenuItem(val id: String, val title: String, val sub: String, val accent: Int)
    val items = listOf(
      MenuItem("menu_search", "Szukaj celu", "Adres, firma, punkt", CYAN),
      MenuItem("menu_warnings", "Ostrzeżenia  (${snap.warnings.size})", "Aktywne na mapie", Color.rgb(232, 154, 54)),
      MenuItem("menu_report", "Dodaj zgłoszenie", "Korek, wypadek, policja...", Color.rgb(227, 56, 53)),
      MenuItem("menu_cameras", "Fotoradary  (${snap.speedCameras.size})", "W okolicy", Color.rgb(200, 200, 200)),
      MenuItem("menu_fuel", "Stacje paliw  (${snap.fuelStations.size})", "Dostępne stacje", Color.rgb(34, 197, 94)),
      MenuItem("menu_settings", "Ustawienia", "Mapa i alerty", CYAN),
    )
    val rowH = ((ph - 62f) / items.size).coerceAtMost(82f)
    items.forEachIndexed { i, item ->
      val rowTop = 62f + i * rowH
      panelHitRects[item.id] = RectF(0f, rowTop, panelW, rowTop + rowH)
      val sp = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = item.accent; style = Paint.Style.FILL }
      canvas.drawRoundRect(RectF(0f, rowTop + 12f, 4f, rowTop + rowH - 12f), 2f, 2f, sp)
      smallTextPaint.textSize = 19f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = Color.WHITE; smallTextPaint.clearShadowLayer()
      canvas.drawText(item.title, 18f, rowTop + rowH * 0.42f + 7f, smallTextPaint)
      smallTextPaint.textSize = 13f; smallTextPaint.color = Color.argb(145, 190, 190, 190)
      canvas.drawText(item.sub, 18f, rowTop + rowH * 0.72f + 5f, smallTextPaint); smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
      smallTextPaint.textSize = 22f; smallTextPaint.textAlign = Paint.Align.RIGHT; smallTextPaint.color = Color.argb(100, 0, 191, 255)
      canvas.drawText("›", panelW - 16f, rowTop + rowH / 2f + 8f, smallTextPaint)
      panelSep(canvas, 12f, rowTop + rowH, panelW - 12f)
    }
    smallTextPaint.textSize = 18f; smallTextPaint.textAlign = Paint.Align.CENTER; smallTextPaint.color = Color.WHITE
  }

  private fun drawWarningsPanel(canvas: Canvas, snap: AutoNavSnapshot) {
    val CYAN = Color.rgb(0, 191, 255); val ORANGE = Color.rgb(232, 154, 54)
    val rowH = 68f; val headerH = 62f
    val count = snap.warnings.size.coerceAtMost(6)
    val panelH = (headerH + count * rowH + 12f).coerceAtLeast(140f).coerceAtMost(height - 32f)
    val panelTop = height - panelH - 12f; val panelL = 12f; val panelR = width - 12f
    labelBgPaint.color = Color.argb(253, 7, 8, 12)
    canvas.drawRoundRect(RectF(panelL, panelTop, panelR, height - 12f), 20f, 20f, labelBgPaint)
    chipStrokePaint.color = Color.argb(160, 232, 154, 54); chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(RectF(panelL, panelTop, panelR, height - 12f), 20f, 20f, chipStrokePaint)
    panelCloseButton(canvas, panelR, panelTop)
    panelSep(canvas, panelL + 18f, panelTop + headerH, panelR - 18f)
    textPaint.textSize = 22f; textPaint.color = ORANGE
    canvas.drawText("Ostrzeżenia (${snap.warnings.size})", (panelL + panelR) / 2f, panelTop + 38f, textPaint)
    if (snap.warnings.isEmpty()) {
      smallTextPaint.textSize = 17f; smallTextPaint.color = Color.argb(160, 200, 200, 200)
      canvas.drawText("Brak aktywnych ostrzeżeń", (panelL + panelR) / 2f, panelTop + headerH + 40f, smallTextPaint)
    } else {
      snap.warnings.take(6).forEachIndexed { i, w ->
        val rowTop = panelTop + headerH + i * rowH
        val rowRect = RectF(panelL + 6f, rowTop, panelR - 6f, rowTop + rowH)
        val title = when (w.type) { "traffic" -> "Korek"; "weather" -> "Zła pogoda"; "accident" -> "Wypadek"; "car_breakdown" -> "Awaria"; "speed_control" -> "Kontrola"; "Animal" -> "Zwierzę"; else -> "Ostrzeżenie" }
        smallTextPaint.textSize = 17f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = ORANGE; smallTextPaint.clearShadowLayer()
        canvas.drawText(title, rowRect.left + 14f, rowTop + 26f, smallTextPaint)
        smallTextPaint.textSize = 13f; smallTextPaint.color = Color.argb(150, 200, 200, 200)
        canvas.drawText(w.label.ifBlank { w.value }.take(35), rowRect.left + 14f, rowTop + 46f, smallTextPaint); smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
        val confId = "confirm_warning_${w.id}"
        val confRect = RectF(rowRect.right - 108f, rowTop + 12f, rowRect.right - 8f, rowTop + rowH - 12f)
        panelHitRects[confId] = confRect
        chipFillPaint.color = Color.argb(55, 0, 191, 255); canvas.drawRoundRect(confRect, 10f, 10f, chipFillPaint)
        chipStrokePaint.color = Color.argb(150, 0, 191, 255); canvas.drawRoundRect(confRect, 10f, 10f, chipStrokePaint)
        smallTextPaint.textSize = 14f; smallTextPaint.textAlign = Paint.Align.CENTER; smallTextPaint.color = CYAN
        canvas.drawText("Potwierdź", confRect.centerX(), confRect.centerY() + 6f, smallTextPaint)
        panelSep(canvas, rowRect.left + 14f, rowTop + rowH, rowRect.right - 14f)
      }
    }
    textPaint.textSize = 24f; smallTextPaint.textSize = 18f; smallTextPaint.textAlign = Paint.Align.CENTER; smallTextPaint.color = Color.WHITE
  }

  private fun drawReportPanel(canvas: Canvas, @Suppress("UNUSED_PARAMETER") snap: AutoNavSnapshot) {
    val rowH = 62f; val headerH = 58f
    val panelW = (width * 0.62f).coerceAtLeast(280f)
    val panelH = headerH + 6 * rowH + 12f
    val pl = (width - panelW) / 2f; val pt = (height - panelH) / 2f; val pr = pl + panelW
    labelBgPaint.color = Color.argb(253, 7, 8, 12)
    canvas.drawRoundRect(RectF(pl, pt, pr, pt + panelH), 20f, 20f, labelBgPaint)
    chipStrokePaint.color = Color.argb(160, 227, 56, 53); chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(RectF(pl, pt, pr, pt + panelH), 20f, 20f, chipStrokePaint)
    panelCloseButton(canvas, pr, pt); panelSep(canvas, pl + 18f, pt + headerH, pr - 18f)
    textPaint.textSize = 21f; textPaint.color = Color.rgb(227, 56, 53)
    canvas.drawText("Dodaj zgłoszenie", (pl + pr) / 2f, pt + 36f, textPaint)
    data class RT(val id: String, val label: String, val color: Int)
    val types = listOf(RT("report_accident","Wypadek",Color.rgb(227,56,53)), RT("report_traffic","Korek / utrudnienia",Color.rgb(232,154,54)), RT("report_speed","Policja / kontrola",Color.rgb(0,191,255)), RT("report_weather","Zła pogoda",Color.rgb(100,160,255)), RT("report_breakdown","Awaria auta",Color.rgb(190,190,190)), RT("report_animal","Zwierzę na drodze",Color.rgb(34,197,94)))
    types.forEachIndexed { i, rt ->
      val rowTop = pt + headerH + i * rowH
      val rr = RectF(pl + 10f, rowTop + 4f, pr - 10f, rowTop + rowH - 4f)
      panelHitRects[rt.id] = rr
      chipFillPaint.color = Color.argb(35, Color.red(rt.color), Color.green(rt.color), Color.blue(rt.color))
      canvas.drawRoundRect(rr, 12f, 12f, chipFillPaint)
      val sp = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = rt.color; style = Paint.Style.FILL }
      canvas.drawRoundRect(RectF(rr.left, rr.top + 10f, rr.left + 5f, rr.bottom - 10f), 3f, 3f, sp)
      smallTextPaint.textSize = 19f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = Color.WHITE; smallTextPaint.clearShadowLayer()
      canvas.drawText(rt.label, rr.left + 18f, rr.centerY() + 7f, smallTextPaint); smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
      panelSep(canvas, rr.left + 8f, rowTop + rowH, rr.right - 8f)
    }
    textPaint.textSize = 24f; smallTextPaint.textSize = 18f; smallTextPaint.textAlign = Paint.Align.CENTER; smallTextPaint.color = Color.WHITE
  }

  private fun drawSettingsPanel(canvas: Canvas, snap: AutoNavSnapshot) {
    val CYAN = Color.rgb(0, 191, 255)
    val rowH = 57f; val headerH = 62f
    val panelH = headerH + 6 * rowH + 10f
    val panelTop = (height - panelH - 12f).coerceAtLeast(8f); val pl = 12f; val pr = width - 12f
    labelBgPaint.color = Color.argb(253, 7, 8, 12)
    canvas.drawRoundRect(RectF(pl, panelTop, pr, height - 12f), 20f, 20f, labelBgPaint)
    chipStrokePaint.color = Color.argb(160, 0, 191, 255); chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(RectF(pl, panelTop, pr, height - 12f), 20f, 20f, chipStrokePaint)
    panelCloseButton(canvas, pr, panelTop); panelSep(canvas, pl + 18f, panelTop + headerH, pr - 18f)
    textPaint.textSize = 22f; textPaint.color = CYAN
    canvas.drawText("Ustawienia mapy", (pl + pr) / 2f, panelTop + 38f, textPaint)
    val car = carContext
    fun opt(key: String, def: Boolean) = car?.let { AutoNavStore.getMapOption(it, key, def) } ?: def
    val settings = listOf(Triple("toggle_users","Użytkownicy live",opt("show_users",snap.showUsers)), Triple("toggle_warnings","Ostrzeżenia",opt("show_warnings",snap.showWarnings)), Triple("toggle_cameras","Fotoradary",opt("show_cameras",snap.showSpeedCameras)), Triple("toggle_fuel","Stacje paliw",opt("show_fuel",snap.showFuelStations)), Triple("toggle_voice","Alerty głosowe",opt("voice_alerts",snap.voiceAlerts)), Triple("toggle_speed","Limit prędkości",opt("speed_alerts",snap.speedAlerts)))
    settings.forEachIndexed { i, (id, label, enabled) ->
      val rowTop = panelTop + headerH + i * rowH
      panelHitRects[id] = RectF(pl + 6f, rowTop, pr - 6f, rowTop + rowH)
      smallTextPaint.textSize = 18f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = Color.WHITE; smallTextPaint.clearShadowLayer()
      canvas.drawText(label, pl + 22f, rowTop + rowH / 2f + 7f, smallTextPaint); smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
      val toggleR = pr - 20f; val toggleL = toggleR - 68f; val cy = rowTop + rowH / 2f
      val tRect = RectF(toggleL, cy - 13f, toggleR, cy + 13f)
      if (enabled) {
        val on = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = CYAN; style = Paint.Style.FILL }; canvas.drawRoundRect(tRect, 13f, 13f, on)
        val th = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }; canvas.drawCircle(toggleR - 15f, cy, 10f, th)
        smallTextPaint.textSize = 11f; smallTextPaint.textAlign = Paint.Align.LEFT; smallTextPaint.color = Color.argb(200, 7, 8, 12); canvas.drawText("ON", toggleL + 9f, cy + 4f, smallTextPaint)
      } else {
        val off = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(110, 90, 90, 90); style = Paint.Style.FILL }; canvas.drawRoundRect(tRect, 13f, 13f, off)
        val th = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(190, 190, 190, 190); style = Paint.Style.FILL }; canvas.drawCircle(toggleL + 15f, cy, 10f, th)
        smallTextPaint.textSize = 11f; smallTextPaint.textAlign = Paint.Align.RIGHT; smallTextPaint.color = Color.argb(180, 200, 200, 200); canvas.drawText("OFF", toggleR - 9f, cy + 4f, smallTextPaint)
      }
      panelSep(canvas, pl + 20f, rowTop + rowH, pr - 20f)
    }
    textPaint.textSize = 24f; smallTextPaint.textSize = 18f; smallTextPaint.textAlign = Paint.Align.CENTER; smallTextPaint.color = Color.WHITE
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
    val speedStr = snapshot.speedKmh.toInt().toString()
    val boxW = 96f
    val boxH = 96f
    val right = width - 16f
    val bottom = height - 16f
    val rect = RectF(right - boxW, bottom - boxH, right, bottom)

    labelBgPaint.color = Color.argb(230, 11, 12, 16)
    canvas.drawRoundRect(rect, 20f, 20f, labelBgPaint)
    chipStrokePaint.color = Color.argb(100, 0, 191, 255)
    chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(rect, 20f, 20f, chipStrokePaint)

    textPaint.textSize = 36f
    textPaint.color = Color.WHITE
    canvas.drawText(speedStr, rect.centerX(), rect.top + 48f, textPaint)

    smallTextPaint.textSize = 14f
    smallTextPaint.color = Color.argb(160, 0, 191, 255)
    smallTextPaint.textAlign = Paint.Align.CENTER
    canvas.drawText("KM/H", rect.centerX(), rect.top + 66f, smallTextPaint)

    snapshot.speedLimitKmh?.let { limit ->
      val lr = RectF(rect.left + 6f, rect.bottom - 28f, rect.right - 6f, rect.bottom - 6f)
      chipFillPaint.color = Color.argb(235, 255, 255, 255)
      canvas.drawRoundRect(lr, 10f, 10f, chipFillPaint)
      smallTextPaint.textSize = 14f
      smallTextPaint.color = Color.rgb(200, 30, 40)
      smallTextPaint.clearShadowLayer()
      canvas.drawText(limit.toString(), lr.centerX(), lr.centerY() + 6f, smallTextPaint)
      smallTextPaint.setShadowLayer(4f, 0f, 1f, Color.BLACK)
    }

    textPaint.textSize = 24f
    smallTextPaint.textSize = 18f
    smallTextPaint.color = Color.WHITE
  }

  private fun drawDrivingModeHud(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (!snapshot.isDriving && !snapshot.isNavigating) return

    val margin = 16f
    val panelBottom = height - margin
    val panelRight = width - 128f
    val panelLeft = margin

    if (snapshot.isNavigating) {
      drawNavPanel(canvas, snapshot, panelLeft, panelBottom, panelRight)
    } else {
      drawDrivingPanel(canvas, snapshot, panelLeft, panelBottom, panelRight)
    }
  }

  private fun drawNavPanel(
    canvas: Canvas,
    snapshot: AutoNavSnapshot,
    left: Float,
    bottom: Float,
    right: Float,
  ) {
    val CYAN = Color.rgb(0, 191, 255)
    val RED  = Color.rgb(227, 56, 53)
    val panelH = 138f
    val rect = RectF(left, bottom - panelH, right, bottom)

    labelBgPaint.color = Color.argb(234, 9, 10, 14)
    canvas.drawRoundRect(rect, 22f, 22f, labelBgPaint)
    chipStrokePaint.color = Color.argb(140, 0, 191, 255)
    chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(rect, 22f, 22f, chipStrokePaint)

    val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = CYAN
      style = Paint.Style.FILL
    }
    canvas.drawRoundRect(RectF(rect.left + 22f, rect.top, rect.left + 22f + 60f, rect.top + 3f), 2f, 2f, accentPaint)

    val iconBoxSize = 70f
    val iconBoxLeft = rect.left + 14f
    val iconBoxTop  = rect.top + 14f
    val iconRect = RectF(iconBoxLeft, iconBoxTop, iconBoxLeft + iconBoxSize, iconBoxTop + iconBoxSize)
    chipFillPaint.color = Color.argb(70, 0, 191, 255)
    canvas.drawRoundRect(iconRect, 14f, 14f, chipFillPaint)
    drawManeuverIcon(canvas, iconRect.centerX(), iconRect.centerY(), 22f, snapshot.maneuver, CYAN)

    val textLeft = iconBoxLeft + iconBoxSize + 14f
    val textTop  = rect.top + 30f
    smallTextPaint.textSize = 22f
    smallTextPaint.textAlign = Paint.Align.LEFT
    smallTextPaint.color = Color.WHITE
    smallTextPaint.clearShadowLayer()
    val instrLine = snapshot.instruction.ifBlank { if (snapshot.arrived) "Dotarłeś!" else "Nawigacja" }
    canvas.drawText(instrLine, textLeft, textTop, smallTextPaint)
    smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)

    if (snapshot.destinationName.isNotBlank()) {
      smallTextPaint.textSize = 15f
      smallTextPaint.color = Color.argb(170, 0, 191, 255)
      smallTextPaint.clearShadowLayer()
      canvas.drawText(snapshot.destinationName, textLeft, textTop + 22f, smallTextPaint)
      smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
    }

    val rowY = rect.bottom - 18f
    val turnDist = snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters
    val remDist  = snapshot.remainingDistanceMeters
    val remSec   = snapshot.remainingDurationSec

    smallTextPaint.textAlign = Paint.Align.LEFT
    smallTextPaint.textSize = 17f

    var col = textLeft
    if (turnDist != null) {
      val label = formatDistance(turnDist)
      smallTextPaint.color = CYAN
      canvas.drawText("↗ $label", col, rowY, smallTextPaint)
      col += smallTextPaint.measureText("↗ $label") + 18f
    }
    if (remDist != null) {
      val label = formatDistance(remDist)
      smallTextPaint.color = Color.argb(200, 200, 200, 200)
      canvas.drawText("⬟ $label", col, rowY, smallTextPaint)
      col += smallTextPaint.measureText("⬟ $label") + 18f
    }
    if (remSec != null) {
      val eta = calcEta(remSec)
      smallTextPaint.color = Color.argb(200, 200, 200, 200)
      canvas.drawText("⏱ $eta", col, rowY, smallTextPaint)
    }

    if (snapshot.offRoute) {
      smallTextPaint.textSize = 13f
      smallTextPaint.textAlign = Paint.Align.RIGHT
      smallTextPaint.color = RED
      smallTextPaint.clearShadowLayer()
      canvas.drawText("ZMIANA TRASY", rect.right - 14f, rect.top + 22f, smallTextPaint)
      smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
    }

    smallTextPaint.textSize = 18f
    smallTextPaint.textAlign = Paint.Align.CENTER
    smallTextPaint.color = Color.WHITE
  }

  private fun drawDrivingPanel(
    canvas: Canvas,
    snapshot: AutoNavSnapshot,
    left: Float,
    bottom: Float,
    right: Float,
  ) {
    val CYAN = Color.rgb(0, 191, 255)
    val panelH = 84f
    val rect = RectF(left, bottom - panelH, right.coerceAtMost(left + 320f), bottom)

    labelBgPaint.color = Color.argb(220, 9, 10, 14)
    canvas.drawRoundRect(rect, 20f, 20f, labelBgPaint)
    chipStrokePaint.color = Color.argb(90, 0, 191, 255)
    chipStrokePaint.strokeWidth = 2f
    canvas.drawRoundRect(rect, 20f, 20f, chipStrokePaint)

    smallTextPaint.textAlign = Paint.Align.LEFT
    smallTextPaint.textSize = 18f
    smallTextPaint.color = CYAN
    smallTextPaint.clearShadowLayer()
    canvas.drawText("TRYB JAZDY", rect.left + 18f, rect.top + 30f, smallTextPaint)
    smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)

    var col = rect.left + 18f
    val rowY = rect.bottom - 16f
    listOf(
      "Ostrz. ${snapshot.warnings.size}" to Color.rgb(232, 154, 54),
      "Kam. ${snapshot.speedCameras.size}" to Color.rgb(200, 200, 200),
      "Stacje ${snapshot.fuelStations.size}" to CYAN,
    ).forEach { (text, color) ->
      drawHudChip(canvas, col, rowY - 26f, text, color)
      col += smallTextPaint.measureText(text) + 44f
    }

    smallTextPaint.textAlign = Paint.Align.CENTER
    smallTextPaint.textSize = 18f
    smallTextPaint.color = Color.WHITE
  }

  private fun drawManeuverIcon(canvas: Canvas, cx: Float, cy: Float, size: Float, maneuver: String, color: Int) {
    iconPaint.color = color
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = 3.5f
    iconPaint.strokeCap = Paint.Cap.ROUND
    iconPaint.strokeJoin = Paint.Join.ROUND

    val m = maneuver.lowercase()
    val path = Path()
    when {
      "left" in m || "lewo" in m -> {
        path.moveTo(cx + size * 0.3f, cy + size * 0.5f)
        path.lineTo(cx + size * 0.3f, cy - size * 0.1f)
        path.lineTo(cx - size * 0.3f, cy - size * 0.1f)
        canvas.drawPath(path, iconPaint)
        drawArrowHead(canvas, cx - size * 0.3f, cy - size * 0.1f, -90f, size * 0.35f, color)
      }
      "right" in m || "prawo" in m -> {
        path.moveTo(cx - size * 0.3f, cy + size * 0.5f)
        path.lineTo(cx - size * 0.3f, cy - size * 0.1f)
        path.lineTo(cx + size * 0.3f, cy - size * 0.1f)
        canvas.drawPath(path, iconPaint)
        drawArrowHead(canvas, cx + size * 0.3f, cy - size * 0.1f, 90f, size * 0.35f, color)
      }
      "arrive" in m || "cel" in m || "destination" in m -> {
        iconPaint.style = Paint.Style.FILL
        iconPaint.color = color
        canvas.drawCircle(cx, cy - size * 0.15f, size * 0.35f, iconPaint)
        iconPaint.color = Color.argb(220, 9, 10, 14)
        canvas.drawCircle(cx, cy - size * 0.15f, size * 0.18f, iconPaint)
        iconPaint.style = Paint.Style.STROKE
        iconPaint.color = color
        canvas.drawLine(cx, cy - size * 0.5f, cx, cy + size * 0.5f, iconPaint)
      }
      "roundabout" in m || "rondo" in m -> {
        val oval = RectF(cx - size * 0.3f, cy - size * 0.3f, cx + size * 0.3f, cy + size * 0.3f)
        canvas.drawOval(oval, iconPaint)
        drawArrowHead(canvas, cx + size * 0.3f, cy, 90f, size * 0.28f, color)
      }
      else -> {
        canvas.drawLine(cx, cy + size * 0.5f, cx, cy - size * 0.3f, iconPaint)
        drawArrowHead(canvas, cx, cy - size * 0.3f, 0f, size * 0.35f, color)
      }
    }
    iconPaint.style = Paint.Style.FILL
  }

  private fun drawArrowHead(canvas: Canvas, tipX: Float, tipY: Float, angleDeg: Float, size: Float, color: Int) {
    val rad = Math.toRadians(angleDeg.toDouble())
    val path = Path()
    path.moveTo(tipX, tipY)
    val lx = (tipX - size * 0.4f * cos(rad) + size * 0.25f * sin(rad)).toFloat()
    val ly = (tipY - size * 0.4f * sin(rad) - size * 0.25f * cos(rad)).toFloat()
    val rx = (tipX - size * 0.4f * cos(rad) - size * 0.25f * sin(rad)).toFloat()
    val ry = (tipY - size * 0.4f * sin(rad) + size * 0.25f * cos(rad)).toFloat()
    path.lineTo(lx, ly)
    path.lineTo(rx, ry)
    path.close()
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      style = Paint.Style.FILL
    }
    canvas.drawPath(path, fill)
  }

  private fun drawHudChip(canvas: Canvas, left: Float, top: Float, label: String, color: Int) {
    smallTextPaint.textAlign = Paint.Align.LEFT
    val chipWidth = (smallTextPaint.measureText(label) + 24f).coerceAtLeast(64f)
    val rect = RectF(left, top, left + chipWidth, top + 30f)
    chipFillPaint.color = Color.argb(55, Color.red(color), Color.green(color), Color.blue(color))
    canvas.drawRoundRect(rect, 15f, 15f, chipFillPaint)
    smallTextPaint.textSize = 15f
    smallTextPaint.color = color
    smallTextPaint.clearShadowLayer()
    canvas.drawText(label, rect.left + 10f, rect.centerY() + 6f, smallTextPaint)
    smallTextPaint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
    smallTextPaint.textAlign = Paint.Align.CENTER
    smallTextPaint.textSize = 18f
  }

  private fun formatDistance(meters: Int): String = when {
    meters >= 10_000 -> "${meters / 1000} km"
    meters >= 1_000  -> "${"%.1f".format(meters / 1000f)} km"
    else             -> "$meters m"
  }

  private fun calcEta(remainingSec: Int): String {
    val totalMin = (remainingSec / 60).coerceAtLeast(0)
    val h = totalMin / 60
    val m = totalMin % 60
    val now = java.util.Calendar.getInstance()
    now.add(java.util.Calendar.SECOND, remainingSec)
    val hh = "%02d".format(now.get(java.util.Calendar.HOUR_OF_DAY))
    val mm = "%02d".format(now.get(java.util.Calendar.MINUTE))
    return if (h > 0) "$h godz $m min  •  $hh:$mm" else "$m min  •  $hh:$mm"
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
