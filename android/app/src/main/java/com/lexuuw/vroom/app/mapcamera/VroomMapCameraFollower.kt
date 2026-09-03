package com.lexuuw.vroom.app.mapcamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.view.Choreographer
import androidx.core.content.ContextCompat
import com.mapbox.bindgen.Value
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.rnmapbox.rnmbx.components.AbstractMapFeature
import com.rnmapbox.rnmbx.components.RemovalReason
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapView
import kotlin.math.exp

internal fun mapCameraDpToPx(dp: Double, density: Double): Double =
  dp.coerceAtLeast(0.0) * density.coerceAtLeast(0.0)

internal fun mapCameraNormalizeHeading(value: Double): Double {
  var heading = value % 360.0
  if (heading < 0) heading += 360.0
  return heading
}

internal fun mapCameraShortestHeadingDelta(from: Double, to: Double): Double {
  var delta = (to - from) % 360.0
  if (delta > 180.0) delta -= 360.0
  if (delta < -180.0) delta += 360.0
  return delta
}

internal fun mapCameraScreenHeading(
  worldHeading: Double,
  cameraBearing: Double,
): Double = mapCameraNormalizeHeading(worldHeading - cameraBearing)

internal fun mapCameraArrowPixelSize(logicalDp: Int, density: Float): Int =
  (logicalDp * density.coerceAtLeast(1f)).toInt().coerceAtLeast(logicalDp)

/**
 * Invisible Mapbox feature. Reanimated supplies the final pose; this display loop
 * writes camera + marker atomically at most once per frame.
 */
class VroomMapCameraFollower(context: Context) : AbstractMapFeature(context), Choreographer.FrameCallback {
  companion object {
    private const val MARKER_SOURCE_ID = "tripDriveMarkerSource"
    const val NATIVE_ARROW_IMAGE_ID = "vroom-location-arrow"
    private const val MIN_SEGMENT_MS = 200.0
    private const val MAX_SEGMENT_MS = 2_000.0
    private const val DEFAULT_SEGMENT_MS = 1_000.0
    private const val ARROW_LOGICAL_DP = 74
  }

  override var requiresStyleLoad: Boolean = false
  private val appContext = context.applicationContext
  private val displayDensity = context.resources.displayMetrics.density.toDouble()

  private var enabled = false
  private var cameraMode = "courseUp"
  private var markerVisible = true
  private var positionValid = false
  private var targetLatitude = 0.0
  private var targetLongitude = 0.0
  private var targetHeading = 0.0
  private var targetMarkerHeading = 0.0
  private var segmentDurationMs = DEFAULT_SEGMENT_MS
  private var zoom = 18.0
  private var pitch = 58.0
  private var paddingTop = 0.0
  private var paddingBottom = 0.0
  private var paddingLeft = 0.0
  private var paddingRight = 0.0
  private var dirty = false
  private var framePosted = false
  private var framingInitialized = false
  private var poseInitialized = false
  private var displayedLatitude = Double.NaN
  private var displayedLongitude = Double.NaN
  private var displayedHeading = 0.0
  private var displayedZoom = 18.0
  private var displayedPitch = 58.0
  private var displayedPaddingTop = 0.0
  private var displayedPaddingBottom = 0.0
  private var displayedPaddingLeft = 0.0
  private var displayedPaddingRight = 0.0
  private var lastFrameNanos = 0L
  private var lastMarkerLatitude = Double.NaN
  private var lastMarkerLongitude = Double.NaN
  private var lastMarkerHeading = Double.NaN
  private var lastMarkerWorldHeading = Double.NaN
  private var arrowImageRegistered = false
  private var lastStyleIdentity = 0
  private var cachedArrowBitmap: Bitmap? = null

  fun setFollowerEnabled(value: Boolean) {
    if (value && !enabled) {
      framingInitialized = false
      lastFrameNanos = 0L
      dirty = true
    }
    enabled = value
    if (isMotionActive()) scheduleFrame() else cancelFrame()
  }

  fun setCameraMode(value: String?) {
    cameraMode = when (value) {
      "northUp", "free" -> value
      else -> "courseUp"
    }
    dirty = true
    scheduleFrame()
  }

  fun setPositionValid(value: Int) {
    positionValid = value != 0
    dirty = true
    scheduleFrame()
  }

  fun setMarkerVisible(value: Boolean) {
    if (value && !markerVisible) {
      lastMarkerLatitude = Double.NaN
      lastMarkerLongitude = Double.NaN
      lastMarkerHeading = Double.NaN
      lastMarkerWorldHeading = Double.NaN
      arrowImageRegistered = false
    }
    markerVisible = value
    dirty = true
    scheduleFrame()
  }

  fun setLatitude(value: Double) = updateTarget { targetLatitude = value }
  fun setLongitude(value: Double) = updateTarget { targetLongitude = value }
  fun setHeading(value: Double) = updateTarget { targetHeading = value }
  fun setMarkerHeading(value: Double) = updateTarget { targetMarkerHeading = value }
  fun setSegmentDurationMs(value: Double) {
    segmentDurationMs = value.coerceIn(MIN_SEGMENT_MS, MAX_SEGMENT_MS)
    dirty = true
    scheduleFrame()
  }
  fun setZoom(value: Double) = update { zoom = value }
  fun setPitch(value: Double) = update { pitch = value }
  fun setPaddingTop(value: Double) = update { paddingTop = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingBottom(value: Double) = update { paddingBottom = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingLeft(value: Double) = update { paddingLeft = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingRight(value: Double) = update { paddingRight = mapCameraDpToPx(value, displayDensity) }

  private inline fun update(block: () -> Unit) {
    block()
    dirty = true
    scheduleFrame()
  }

  private inline fun updateTarget(block: () -> Unit) {
    block()
    dirty = true
    scheduleFrame()
  }

  private fun scheduleFrame() {
    if (!isMotionActive() || framePosted) return
    framePosted = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun cancelFrame() {
    if (!framePosted) return
    Choreographer.getInstance().removeFrameCallback(this)
    framePosted = false
  }

  override fun addToMap(mapView: RNMBXMapView) {
    super.addToMap(mapView)
    arrowImageRegistered = false
    lastStyleIdentity = 0
    dirty = true
    scheduleFrame()
  }

  override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    if (!isMotionActive()) return
    if (dirty || hasPendingWork()) applyLatestPose(frameTimeNanos)
    if (dirty || hasPendingWork()) scheduleFrame()
  }

  private fun isMotionActive(): Boolean = enabled || markerVisible

  private fun hasPendingFraming(): Boolean = enabled && framingInitialized && (
    kotlin.math.abs(displayedZoom - zoom) > 0.002
      || kotlin.math.abs(displayedPitch - pitch) > 0.03
      || kotlin.math.abs(displayedPaddingTop - paddingTop) > 0.25
      || kotlin.math.abs(displayedPaddingBottom - paddingBottom) > 0.25
      || kotlin.math.abs(displayedPaddingLeft - paddingLeft) > 0.25
      || kotlin.math.abs(displayedPaddingRight - paddingRight) > 0.25
  )

  private fun hasPendingWork(): Boolean = hasPendingFraming()

  private fun applyLatestPose(frameTimeNanos: Long) {
    if (!positionValid || !targetLatitude.isFinite() || !targetLongitude.isFinite() || !targetHeading.isFinite() || !targetMarkerHeading.isFinite() || !zoom.isFinite()) {
      dirty = false
      return
    }
    if (kotlin.math.abs(targetLatitude) < 1e-6 && kotlin.math.abs(targetLongitude) < 1e-6) {
      dirty = false
      return
    }
    val mapboxMap = mMapView?.getMapboxMap() ?: return

    val dtMs = if (lastFrameNanos > 0L) {
      ((frameTimeNanos - lastFrameNanos).coerceIn(1_000_000L, 50_000_000L) / 1_000_000.0)
    } else 16.0
    lastFrameNanos = frameTimeNanos

    advanceDisplayedPose(dtMs)

    if (enabled && !framingInitialized) {
      val camera = mapboxMap.cameraState
      displayedZoom = camera.zoom
      displayedPitch = camera.pitch
      displayedPaddingTop = camera.padding.top
      displayedPaddingBottom = camera.padding.bottom
      displayedPaddingLeft = camera.padding.left
      displayedPaddingRight = camera.padding.right
      framingInitialized = true
    }

    dirty = false
    val cameraWorldHeading = mapCameraNormalizeHeading(displayedHeading)
    val markerWorldHeading = mapCameraNormalizeHeading(targetMarkerHeading)
    ensureArrowImage(mapboxMap)

    if (enabled && cameraMode != "free") {
      val alpha = 1.0 - exp(-dtMs / 120.0)
      displayedZoom += (zoom - displayedZoom) * alpha
      displayedPitch += (pitch - displayedPitch) * alpha
      displayedPaddingTop += (paddingTop - displayedPaddingTop) * alpha
      displayedPaddingBottom += (paddingBottom - displayedPaddingBottom) * alpha
      displayedPaddingLeft += (paddingLeft - displayedPaddingLeft) * alpha
      displayedPaddingRight += (paddingRight - displayedPaddingRight) * alpha
      mapboxMap.setCamera(
        CameraOptions.Builder()
          .center(Point.fromLngLat(displayedLongitude, displayedLatitude))
          .bearing(if (cameraMode == "northUp") 0.0 else cameraWorldHeading)
          .zoom(displayedZoom)
          .pitch(displayedPitch)
          .padding(EdgeInsets(displayedPaddingTop, displayedPaddingLeft, displayedPaddingBottom, displayedPaddingRight))
          .build(),
      )
    }

    val cameraBearing = mapCameraNormalizeHeading(mapboxMap.cameraState.bearing)
    val screenHeading = mapCameraScreenHeading(markerWorldHeading, cameraBearing)
    updateMarkerSource(mapboxMap, displayedLatitude, displayedLongitude, markerWorldHeading, screenHeading)
  }

  private fun advanceDisplayedPose(@Suppress("UNUSED_PARAMETER") dtMs: Double) {
    displayedLatitude = targetLatitude
    displayedLongitude = targetLongitude
    displayedHeading = mapCameraNormalizeHeading(targetHeading)
    poseInitialized = true
  }

  private fun updateMarkerSource(
    mapboxMap: com.mapbox.maps.MapboxMap,
    latitude: Double,
    longitude: Double,
    worldHeading: Double,
    screenHeading: Double,
  ) {
    if (!markerVisible) return
    val moved = !lastMarkerLatitude.isFinite()
      || kotlin.math.abs(lastMarkerLatitude - latitude) > 0.0000001
      || kotlin.math.abs(lastMarkerLongitude - longitude) > 0.0000001
      || kotlin.math.abs(mapCameraShortestHeadingDelta(lastMarkerHeading, screenHeading)) > 0.05
      || kotlin.math.abs(mapCameraShortestHeadingDelta(lastMarkerWorldHeading, worldHeading)) > 0.05
    if (!moved) return
    val style = mapboxMap.getStyle() ?: return
    val geoJson =
      "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[$longitude,$latitude]},\"properties\":{\"heading\":$screenHeading,\"screenHeading\":$screenHeading,\"worldHeading\":$worldHeading}}]}"
    try {
      style.setStyleSourceProperty(MARKER_SOURCE_ID, "data", Value.valueOf(geoJson))
      lastMarkerLatitude = latitude
      lastMarkerLongitude = longitude
      lastMarkerHeading = screenHeading
      lastMarkerWorldHeading = worldHeading
    } catch (_: Throwable) {
      arrowImageRegistered = false
      dirty = true
    }
  }

  private fun ensureArrowImage(mapboxMap: com.mapbox.maps.MapboxMap) {
    val style = mapboxMap.getStyle() ?: return
    val styleIdentity = System.identityHashCode(style)
    if (styleIdentity != lastStyleIdentity) {
      lastStyleIdentity = styleIdentity
      arrowImageRegistered = false
      lastMarkerLatitude = Double.NaN
      lastMarkerLongitude = Double.NaN
      lastMarkerHeading = Double.NaN
      lastMarkerWorldHeading = Double.NaN
    }
    if (arrowImageRegistered) return
    val bitmap = cachedArrowBitmap ?: renderArrowBitmap()?.also { cachedArrowBitmap = it } ?: return
    try {
      style.addImage(NATIVE_ARROW_IMAGE_ID, bitmap)
      arrowImageRegistered = true
    } catch (_: Throwable) {
      arrowImageRegistered = false
    }
  }

  private fun renderArrowBitmap(): Bitmap? {
    val resId = appContext.resources.getIdentifier(
      "vroom_location_arrow",
      "drawable",
      appContext.packageName,
    )
    if (resId == 0) return null
    val drawable: Drawable = ContextCompat.getDrawable(appContext, resId) ?: return null
    val metrics = appContext.resources.displayMetrics
    val density = metrics.density
    // Mapbox derives logical size from bitmap pixels and device density.
    val px = mapCameraArrowPixelSize(ARROW_LOGICAL_DP, density)
    val bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
    bitmap.density = metrics.densityDpi
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, px, px)
    drawable.draw(canvas)
    return bitmap
  }

  override fun removeFromMap(mapView: RNMBXMapView, reason: RemovalReason): Boolean {
    cancelFrame()
    return super.removeFromMap(mapView, reason)
  }

}
