package com.lexuuw.vroom.app.mapcamera

import android.content.Context
import android.view.Choreographer
import com.mapbox.bindgen.Value
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.rnmapbox.rnmbx.components.AbstractMapFeature
import com.rnmapbox.rnmbx.components.RemovalReason
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapView

internal fun mapCameraDpToPx(dp: Double, density: Double): Double =
  dp.coerceAtLeast(0.0) * density.coerceAtLeast(0.0)

class VroomMapCameraFollower(context: Context) : AbstractMapFeature(context), Choreographer.FrameCallback {
  override var requiresStyleLoad: Boolean = false
  private val displayDensity = context.resources.displayMetrics.density.toDouble()
  private var enabled = false
  private var markerVisible = true
  private var positionValid = false
  private var latitude = 0.0
  private var longitude = 0.0
  private var heading = 0.0
  private var zoom = 18.0
  private var pitch = 58.0
  private var paddingTop = 0.0
  private var paddingBottom = 0.0
  private var paddingLeft = 0.0
  private var paddingRight = 0.0
  private var dirty = false
  private var framePosted = false
  private var framingInitialized = false
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

  fun setFollowerEnabled(value: Boolean) {
    if (value && !enabled) { framingInitialized = false; lastFrameNanos = 0L; dirty = true }
    enabled = value
    if (isMotionActive()) scheduleFrame() else cancelFrame()
  }
  fun setPositionValid(value: Int) { positionValid = value != 0; dirty = true; scheduleFrame() }
  fun setMarkerVisible(value: Boolean) { if (value && !markerVisible) { lastMarkerLatitude = Double.NaN; lastMarkerLongitude = Double.NaN; lastMarkerHeading = Double.NaN }; markerVisible = value; dirty = true; scheduleFrame() }
  fun setLatitude(value: Double) = update { latitude = value }
  fun setLongitude(value: Double) = update { longitude = value }
  fun setHeading(value: Double) = update { heading = value }
  fun setZoom(value: Double) = update { zoom = value }
  fun setPitch(value: Double) = update { pitch = value }
  fun setPaddingTop(value: Double) = update { paddingTop = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingBottom(value: Double) = update { paddingBottom = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingLeft(value: Double) = update { paddingLeft = mapCameraDpToPx(value, displayDensity) }
  fun setPaddingRight(value: Double) = update { paddingRight = mapCameraDpToPx(value, displayDensity) }
  private inline fun update(block: () -> Unit) { block(); dirty = true; scheduleFrame() }
  private fun scheduleFrame() { if (!isMotionActive() || framePosted) return; framePosted = true; Choreographer.getInstance().postFrameCallback(this) }
  private fun cancelFrame() { if (!framePosted) return; Choreographer.getInstance().removeFrameCallback(this); framePosted = false }
  override fun addToMap(mapView: RNMBXMapView) { super.addToMap(mapView); dirty = true; scheduleFrame() }
  private fun isMotionActive() = enabled || markerVisible
  private fun hasPendingFraming() = enabled && framingInitialized && (
    kotlin.math.abs(displayedZoom - zoom) > 0.002 || kotlin.math.abs(displayedPitch - pitch) > 0.03 ||
      kotlin.math.abs(displayedPaddingTop - paddingTop) > 0.25 || kotlin.math.abs(displayedPaddingBottom - paddingBottom) > 0.25 ||
      kotlin.math.abs(displayedPaddingLeft - paddingLeft) > 0.25 || kotlin.math.abs(displayedPaddingRight - paddingRight) > 0.25
  )
  override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    if (!isMotionActive()) return
    if (dirty || hasPendingFraming()) applyLatestPose(frameTimeNanos)
    if (dirty || hasPendingFraming()) scheduleFrame()
  }
  private fun applyLatestPose(frameTimeNanos: Long) {
    if (!positionValid || !latitude.isFinite() || !longitude.isFinite() || !heading.isFinite() || !zoom.isFinite()) { dirty = false; return }
    if (kotlin.math.abs(latitude) < 1e-6 && kotlin.math.abs(longitude) < 1e-6) { dirty = false; return }
    val mapboxMap = mMapView?.getMapboxMap() ?: return
    if (enabled && !framingInitialized) {
      val camera = mapboxMap.cameraState
      displayedZoom = camera.zoom; displayedPitch = camera.pitch
      displayedPaddingTop = camera.padding.top; displayedPaddingBottom = camera.padding.bottom
      displayedPaddingLeft = camera.padding.left; displayedPaddingRight = camera.padding.right
      framingInitialized = true
    }
    dirty = false
    val normalizedHeading = (heading % 360.0 + 360.0) % 360.0
    if (enabled) {
      val dtMs = if (lastFrameNanos > 0L) ((frameTimeNanos - lastFrameNanos).coerceIn(1_000_000L, 50_000_000L) / 1_000_000.0) else 16.0
      lastFrameNanos = frameTimeNanos
      val alpha = 1.0 - kotlin.math.exp(-dtMs / 120.0)
      displayedZoom += (zoom - displayedZoom) * alpha; displayedPitch += (pitch - displayedPitch) * alpha
      displayedPaddingTop += (paddingTop - displayedPaddingTop) * alpha; displayedPaddingBottom += (paddingBottom - displayedPaddingBottom) * alpha
      displayedPaddingLeft += (paddingLeft - displayedPaddingLeft) * alpha; displayedPaddingRight += (paddingRight - displayedPaddingRight) * alpha
      mapboxMap.setCamera(CameraOptions.Builder()
        .center(Point.fromLngLat(longitude, latitude))
        .bearing(normalizedHeading)
        .zoom(displayedZoom).pitch(displayedPitch)
        .padding(EdgeInsets(displayedPaddingTop, displayedPaddingLeft, displayedPaddingBottom, displayedPaddingRight)).build())
    }
    updateMarkerSource(mapboxMap, normalizedHeading)
  }
  private fun updateMarkerSource(mapboxMap: com.mapbox.maps.MapboxMap, normalizedHeading: Double) {
    if (!markerVisible) return
    val moved = !lastMarkerLatitude.isFinite() || kotlin.math.abs(lastMarkerLatitude - latitude) > 0.0000001 || kotlin.math.abs(lastMarkerLongitude - longitude) > 0.0000001 || kotlin.math.abs(lastMarkerHeading - normalizedHeading) > 0.1
    if (!moved) return
    val style = mapboxMap.getStyle() ?: return
    val geoJson = "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[$longitude,$latitude]},\"properties\":{\"heading\":$normalizedHeading}}]}"
    try {
      style.setStyleSourceProperty("tripDriveMarkerSource", "data", Value.valueOf(geoJson))
      lastMarkerLatitude = latitude; lastMarkerLongitude = longitude; lastMarkerHeading = normalizedHeading
    } catch (_: Throwable) { dirty = true }
  }
  override fun removeFromMap(mapView: RNMBXMapView, reason: RemovalReason): Boolean { cancelFrame(); return super.removeFromMap(mapView, reason) }
}
