package com.lexuuw.vroom.app.mapcamera

import android.content.Context
import android.view.Choreographer
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.rnmapbox.rnmbx.components.AbstractMapFeature
import com.rnmapbox.rnmbx.components.RemovalReason
import com.rnmapbox.rnmbx.components.mapview.RNMBXMapView

class VroomMapCameraFollower(context: Context) : AbstractMapFeature(context), Choreographer.FrameCallback {
  override var requiresStyleLoad: Boolean = false
  private var enabled = false
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

  fun setFollowerEnabled(value: Boolean) {
    if (value && !enabled) { framingInitialized = false; lastFrameNanos = 0L; dirty = true }
    enabled = value
    if (value) scheduleFrame() else cancelFrame()
  }
  fun setPositionValid(value: Int) { positionValid = value != 0; dirty = true; scheduleFrame() }
  fun setLatitude(value: Double) = update { latitude = value }
  fun setLongitude(value: Double) = update { longitude = value }
  fun setHeading(value: Double) = update { heading = value }
  fun setZoom(value: Double) = update { zoom = value }
  fun setPitch(value: Double) = update { pitch = value }
  fun setPaddingTop(value: Double) = update { paddingTop = value }
  fun setPaddingBottom(value: Double) = update { paddingBottom = value }
  fun setPaddingLeft(value: Double) = update { paddingLeft = value }
  fun setPaddingRight(value: Double) = update { paddingRight = value }
  private inline fun update(block: () -> Unit) { block(); dirty = true; scheduleFrame() }
  private fun scheduleFrame() { if (!enabled || framePosted) return; framePosted = true; Choreographer.getInstance().postFrameCallback(this) }
  private fun cancelFrame() { if (!framePosted) return; Choreographer.getInstance().removeFrameCallback(this); framePosted = false }
  override fun addToMap(mapView: RNMBXMapView) { super.addToMap(mapView); dirty = true; scheduleFrame() }
  private fun hasPendingFraming() = framingInitialized && (
    kotlin.math.abs(displayedZoom - zoom) > 0.002 || kotlin.math.abs(displayedPitch - pitch) > 0.03 ||
      kotlin.math.abs(displayedPaddingTop - paddingTop) > 0.25 || kotlin.math.abs(displayedPaddingBottom - paddingBottom) > 0.25 ||
      kotlin.math.abs(displayedPaddingLeft - paddingLeft) > 0.25 || kotlin.math.abs(displayedPaddingRight - paddingRight) > 0.25
  )
  override fun doFrame(frameTimeNanos: Long) { framePosted = false; if (!enabled) return; if (dirty || hasPendingFraming()) applyLatestPose(frameTimeNanos); scheduleFrame() }
  private fun applyLatestPose(frameTimeNanos: Long) {
    if (!positionValid || !latitude.isFinite() || !longitude.isFinite() || !heading.isFinite() || !zoom.isFinite()) return
    if (kotlin.math.abs(latitude) < 1e-6 && kotlin.math.abs(longitude) < 1e-6) return
    val mapboxMap = mMapView?.getMapboxMap() ?: return
    if (!framingInitialized) {
      val camera = mapboxMap.cameraState
      displayedZoom = camera.zoom; displayedPitch = camera.pitch
      displayedPaddingTop = camera.padding.top; displayedPaddingBottom = camera.padding.bottom
      displayedPaddingLeft = camera.padding.left; displayedPaddingRight = camera.padding.right
      framingInitialized = true
    }
    val dtMs = if (lastFrameNanos > 0L) ((frameTimeNanos - lastFrameNanos).coerceIn(1_000_000L, 50_000_000L) / 1_000_000.0) else 16.0
    lastFrameNanos = frameTimeNanos
    val alpha = 1.0 - kotlin.math.exp(-dtMs / 120.0)
    displayedZoom += (zoom - displayedZoom) * alpha; displayedPitch += (pitch - displayedPitch) * alpha
    displayedPaddingTop += (paddingTop - displayedPaddingTop) * alpha; displayedPaddingBottom += (paddingBottom - displayedPaddingBottom) * alpha
    displayedPaddingLeft += (paddingLeft - displayedPaddingLeft) * alpha; displayedPaddingRight += (paddingRight - displayedPaddingRight) * alpha
    dirty = false
    mapboxMap.setCamera(CameraOptions.Builder()
      .center(Point.fromLngLat(longitude, latitude))
      .bearing((heading % 360.0 + 360.0) % 360.0)
      .zoom(displayedZoom).pitch(displayedPitch)
      .padding(EdgeInsets(displayedPaddingTop, displayedPaddingLeft, displayedPaddingBottom, displayedPaddingRight)).build())
  }
  override fun removeFromMap(mapView: RNMBXMapView, reason: RemovalReason): Boolean { cancelFrame(); return super.removeFromMap(mapView, reason) }
}
