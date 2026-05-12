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
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
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
    // Keep callback constant-time to avoid host ANR timeouts.
  }

  override fun onStableAreaChanged(stableArea: Rect) {
    // Keep callback constant-time to avoid host ANR timeouts.
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
    val nextMapView = MapView(
      nextPresentation.context,
      MapInitOptions(context = nextPresentation.context, textureView = true),
    )

    root.addView(
      nextMapView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    nextPresentation.setContentView(root)
    nextPresentation.show()

    mapView = nextMapView
    overlayView = null
    presentation = nextPresentation
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
    runCatching { presentation?.dismiss() }
    presentation = null
    mapView = null
    overlayView = null
    runCatching { virtualDisplay?.release() }
    virtualDisplay = null
  }

  private fun updateMap() {
    AutoNavStore.refreshFromBackendIfNeeded(context)
    val snapshot = AutoNavStore.snapshot(context)
    val map = mapView?.getMapboxMap()
    val center = snapshot.cameraCenter()
      ?: lastCameraCenter
      ?: AutoNavPoint(DEFAULT_CENTER_LAT, DEFAULT_CENTER_LNG)
    val styleUri = snapshot.mapStyle.ifBlank { MAPBOX_STYLE }

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

private class VroomMapOverlayView(context: Context) : View(context) {
  var snapshot: AutoNavSnapshot? = null
  var mapView: MapView? = null
  var visibleArea: Rect? = null
  private var avatarBitmap: Bitmap? = null
  private var avatarUrlLoaded: String = ""
  private var avatarLoading = false

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
  private val labelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(235, 10, 10, 10)
    style = Paint.Style.FILL
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
    drawMarkers(canvas, currentSnapshot.fuelStations, fuelPaint, MarkerKind.FUEL)
    drawMarkers(canvas, currentSnapshot.speedCameras, cameraPaint, MarkerKind.CAMERA)
    drawMarkers(canvas, currentSnapshot.users, userPaint, MarkerKind.USER)
    drawMarkers(canvas, currentSnapshot.warnings, warningPaint, MarkerKind.WARNING)
    drawDestination(canvas, currentSnapshot)
    drawCar(canvas, currentSnapshot)
    drawSpeedHud(canvas, currentSnapshot)
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
    val color = when {
      marker.isPremium -> Color.rgb(255, 215, 0)
      marker.isFriend -> Color.rgb(77, 233, 38)
      else -> Color.rgb(0, 191, 255)
    }
    drawLabel(canvas, x, y - 38f, marker.label.take(10), color)
    userPaint.color = color
    canvas.drawCircle(x, y, if (marker.isPremium) 18f else 16f, userPaint)
    canvas.drawCircle(x, y, if (marker.isPremium) 18f else 16f, strokePaint)
  }

  private fun drawWarningMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    val color = warningColor(marker.type)
    warningPaint.color = color
    if (marker.count > 0) drawLabel(canvas, x, y - 31f, "+${marker.count}", color)
    canvas.drawCircle(x, y, 22f, warningPaint)
    canvas.drawCircle(x, y, 22f, strokePaint)
    canvas.drawText("!", x, y + 9f, textPaint)
  }

  private fun drawSpeedCameraMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    if (marker.type == "bump") {
      val rect = RectF(x - 25f, y - 21f, x + 25f, y + 21f)
      cameraPaint.color = Color.argb(38, 77, 233, 38)
      canvas.drawRoundRect(rect, 12f, 12f, cameraPaint)
      strokePaint.color = Color.rgb(77, 233, 38)
      canvas.drawRoundRect(rect, 12f, 12f, strokePaint)
      strokePaint.color = Color.WHITE
      smallTextPaint.color = Color.rgb(77, 233, 38)
      canvas.drawText("PROG", x, y + 6f, smallTextPaint)
      smallTextPaint.color = Color.WHITE
      return
    }

    canvas.drawCircle(x, y, 24f, cameraPaint)
    val border = Paint(strokePaint).apply {
      color = Color.rgb(204, 0, 0)
      strokeWidth = 4f
    }
    canvas.drawCircle(x, y, 24f, border)
    smallTextPaint.color = Color.rgb(17, 17, 17)
    canvas.drawText(marker.value.ifBlank { "CAM" }, x, y + 7f, smallTextPaint)
    smallTextPaint.color = Color.WHITE
  }

  private fun drawFuelMarker(canvas: Canvas, x: Float, y: Float, marker: AutoMapMarker) {
    val rect = RectF(x - 26f, y - 42f, x + 26f, y + 10f)
    labelBgPaint.color = Color.rgb(10, 10, 10)
    canvas.drawRoundRect(rect, 10f, 10f, labelBgPaint)
    strokePaint.color = Color.rgb(0, 191, 255)
    canvas.drawRoundRect(rect, 10f, 10f, strokePaint)
    strokePaint.color = Color.WHITE
    smallTextPaint.color = Color.rgb(0, 191, 255)
    canvas.drawText("GAS", x, y - 18f, smallTextPaint)
    if (marker.value.isNotBlank()) canvas.drawText(marker.value, x, y + 2f, smallTextPaint)
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
    drawLabel(canvas, screen.first, screen.second - 48f, snapshot.currentUserName.take(10), Color.rgb(69, 168, 255))
    drawDriverAvatar(canvas, screen.first, screen.second)
  }

  private fun drawSpeedHud(canvas: Canvas, snapshot: AutoNavSnapshot) {
    if (!snapshot.isDriving && !snapshot.isNavigating) return
    val rect = RectF(width - 118f, height - 118f, width - 18f, height - 24f)
    labelBgPaint.color = Color.argb(225, 12, 12, 14)
    canvas.drawRoundRect(rect, 18f, 18f, labelBgPaint)
    strokePaint.color = Color.argb(90, 227, 56, 53)
    canvas.drawRoundRect(rect, 18f, 18f, strokePaint)
    strokePaint.color = Color.WHITE
    textPaint.color = Color.WHITE
    canvas.drawText(snapshot.speedKmh.toInt().toString(), rect.centerX(), rect.top + 42f, textPaint)
    smallTextPaint.color = Color.argb(160, 255, 255, 255)
    canvas.drawText("KM/H", rect.centerX(), rect.top + 65f, smallTextPaint)
    snapshot.speedLimitKmh?.let {
      smallTextPaint.color = Color.rgb(227, 56, 53)
      canvas.drawText("LIMIT $it", rect.centerX(), rect.top + 86f, smallTextPaint)
    }
    smallTextPaint.color = Color.WHITE
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

  private fun drawDriverAvatar(canvas: Canvas, cx: Float, cy: Float) {
    val avatar = avatarBitmap ?: return
    val radius = 12f
    val dst = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
    val clip = Path().apply { addCircle(cx, cy, radius, Path.Direction.CW) }
    val count = canvas.save()
    canvas.clipPath(clip)
    canvas.drawBitmap(avatar, null, dst, null)
    canvas.restoreToCount(count)
    canvas.drawCircle(cx, cy, radius, strokePaint)
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
