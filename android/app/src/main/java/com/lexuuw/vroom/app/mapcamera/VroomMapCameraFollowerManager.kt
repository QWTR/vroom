package com.lexuuw.vroom.app.mapcamera

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class VroomMapCameraFollowerManager : SimpleViewManager<VroomMapCameraFollower>() {
  override fun getName() = "VroomMapCameraFollower"
  override fun createViewInstance(context: ThemedReactContext) = VroomMapCameraFollower(context)

  @ReactProp(name = "enabled", defaultBoolean = false)
  fun setEnabled(view: VroomMapCameraFollower, value: Boolean) = view.setFollowerEnabled(value)

  @ReactProp(name = "cameraMode")
  fun setCameraMode(view: VroomMapCameraFollower, value: String?) = view.setCameraMode(value)

  @ReactProp(name = "positionValid", defaultInt = 0)
  fun setPositionValid(view: VroomMapCameraFollower, value: Int) = view.setPositionValid(value)

  @ReactProp(name = "markerVisible", defaultBoolean = true)
  fun setMarkerVisible(view: VroomMapCameraFollower, value: Boolean) = view.setMarkerVisible(value)

  @ReactProp(name = "latitude") fun setLatitude(view: VroomMapCameraFollower, value: Double) = view.setLatitude(value)
  @ReactProp(name = "longitude") fun setLongitude(view: VroomMapCameraFollower, value: Double) = view.setLongitude(value)
  @ReactProp(name = "heading") fun setHeading(view: VroomMapCameraFollower, value: Double) = view.setHeading(value)
  @ReactProp(name = "markerHeading") fun setMarkerHeading(view: VroomMapCameraFollower, value: Double) = view.setMarkerHeading(value)
  @ReactProp(name = "segmentDurationMs", defaultDouble = 1_000.0)
  fun setSegmentDurationMs(view: VroomMapCameraFollower, value: Double) = view.setSegmentDurationMs(value)
  @ReactProp(name = "zoom") fun setZoom(view: VroomMapCameraFollower, value: Double) = view.setZoom(value)
  @ReactProp(name = "pitch") fun setPitch(view: VroomMapCameraFollower, value: Double) = view.setPitch(value)
  @ReactProp(name = "paddingTop") fun setPaddingTop(view: VroomMapCameraFollower, value: Double) = view.setPaddingTop(value)
  @ReactProp(name = "paddingBottom") fun setPaddingBottom(view: VroomMapCameraFollower, value: Double) = view.setPaddingBottom(value)
  @ReactProp(name = "paddingLeft") fun setPaddingLeft(view: VroomMapCameraFollower, value: Double) = view.setPaddingLeft(value)
  @ReactProp(name = "paddingRight") fun setPaddingRight(view: VroomMapCameraFollower, value: Double) = view.setPaddingRight(value)
}
