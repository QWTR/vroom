import Foundation
import MapboxMaps
import React
import rnmapbox_maps

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {
  @objc var enabled = false {
    didSet {
      if enabled && !oldValue {
        framingInitialized = false
        lastFrameTimestamp = 0
        dirty = true
      }
      updateDisplayLink()
    }
  }
  @objc var positionValid: NSNumber = 0 { didSet { markDirty() } }
  @objc var markerVisible = true {
    didSet {
      if markerVisible && !oldValue {
        lastMarkerLatitude = .nan
        lastMarkerLongitude = .nan
        lastMarkerHeading = .nan
      }
      markDirty()
    }
  }
  @objc var latitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var longitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var heading: NSNumber = 0 { didSet { markDirty() } }
  @objc var zoom: NSNumber = 18 { didSet { markDirty() } }
  @objc var pitch: NSNumber = 58 { didSet { markDirty() } }
  @objc var paddingTop: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingBottom: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingLeft: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingRight: NSNumber = 0 { didSet { markDirty() } }

  private var displayLink: CADisplayLink?
  private var dirty = false
  private weak var nativeMapView: MapView?
  private var framingInitialized = false
  private var displayedZoom = 18.0
  private var displayedPitch = 58.0
  private var displayedPaddingTop = 0.0
  private var displayedPaddingBottom = 0.0
  private var displayedPaddingLeft = 0.0
  private var displayedPaddingRight = 0.0
  private var lastFrameTimestamp: CFTimeInterval = 0
  private var lastMarkerLatitude = Double.nan
  private var lastMarkerLongitude = Double.nan
  private var lastMarkerHeading = Double.nan

  public func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) {
    nativeMapView = mapView
    dirty = true
    updateDisplayLink()
  }

  public func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    displayLink?.invalidate()
    displayLink = nil
    nativeMapView = nil
    return true
  }

  private func updateDisplayLink() {
    guard isMotionActive, displayLink == nil else {
      if !isMotionActive { displayLink?.invalidate(); displayLink = nil }
      return
    }
    let link = CADisplayLink(target: self, selector: #selector(onDisplayFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func markDirty() {
    dirty = true
    updateDisplayLink()
  }

  private func stopDisplayLinkIfIdle() {
    guard !dirty, !hasPendingFraming else { return }
    displayLink?.invalidate()
    displayLink = nil
  }

  private var isMotionActive: Bool { enabled || markerVisible }

  private var hasPendingFraming: Bool {
    enabled && framingInitialized && (
      abs(displayedZoom - zoom.doubleValue) > 0.002 ||
      abs(displayedPitch - pitch.doubleValue) > 0.03 ||
      abs(displayedPaddingTop - paddingTop.doubleValue) > 0.25 ||
      abs(displayedPaddingBottom - paddingBottom.doubleValue) > 0.25 ||
      abs(displayedPaddingLeft - paddingLeft.doubleValue) > 0.25 ||
      abs(displayedPaddingRight - paddingRight.doubleValue) > 0.25
    )
  }

  @objc private func onDisplayFrame(_ displayLink: CADisplayLink) {
    guard isMotionActive else { return }
    guard dirty || hasPendingFraming else {
      stopDisplayLinkIfIdle()
      return
    }
    guard positionValid.boolValue,
          latitude.doubleValue.isFinite,
          longitude.doubleValue.isFinite,
          heading.doubleValue.isFinite,
          zoom.doubleValue.isFinite,
          abs(latitude.doubleValue) > 0.000001 || abs(longitude.doubleValue) > 0.000001,
          let mapView = nativeMapView else {
      dirty = false
      stopDisplayLinkIfIdle()
      return
    }

    if enabled && !framingInitialized {
      let camera = mapView.mapboxMap.cameraState
      displayedZoom = camera.zoom
      displayedPitch = camera.pitch
      displayedPaddingTop = camera.padding.top
      displayedPaddingBottom = camera.padding.bottom
      displayedPaddingLeft = camera.padding.left
      displayedPaddingRight = camera.padding.right
      framingInitialized = true
    }
    dirty = false

    let normalizedHeading = (heading.doubleValue.truncatingRemainder(dividingBy: 360) + 360)
      .truncatingRemainder(dividingBy: 360)
    if enabled {
      let dtMs = lastFrameTimestamp > 0
        ? min(50, max(1, (displayLink.timestamp - lastFrameTimestamp) * 1000))
        : 16
      lastFrameTimestamp = displayLink.timestamp
      let alpha = 1 - exp(-dtMs / 120)
      displayedZoom += (zoom.doubleValue - displayedZoom) * alpha
      displayedPitch += (pitch.doubleValue - displayedPitch) * alpha
      displayedPaddingTop += (paddingTop.doubleValue - displayedPaddingTop) * alpha
      displayedPaddingBottom += (paddingBottom.doubleValue - displayedPaddingBottom) * alpha
      displayedPaddingLeft += (paddingLeft.doubleValue - displayedPaddingLeft) * alpha
      displayedPaddingRight += (paddingRight.doubleValue - displayedPaddingRight) * alpha
      mapView.mapboxMap.setCamera(to: CameraOptions(
        center: CLLocationCoordinate2D(latitude: latitude.doubleValue, longitude: longitude.doubleValue),
        padding: UIEdgeInsets(top: displayedPaddingTop, left: displayedPaddingLeft, bottom: displayedPaddingBottom, right: displayedPaddingRight),
        anchor: nil,
        zoom: displayedZoom,
        bearing: normalizedHeading,
        pitch: displayedPitch
      ))
    }
    updateMarkerSource(mapView, heading: normalizedHeading)
    stopDisplayLinkIfIdle()
  }

  private func updateMarkerSource(_ mapView: MapView, heading: Double) {
    guard markerVisible else { return }
    let moved = !lastMarkerLatitude.isFinite
      || abs(lastMarkerLatitude - latitude.doubleValue) > 0.0000001
      || abs(lastMarkerLongitude - longitude.doubleValue) > 0.0000001
      || abs(lastMarkerHeading - heading) > 0.1
    guard moved else { return }
    let geoJson = "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[\(longitude.doubleValue),\(latitude.doubleValue)]},\"properties\":{\"heading\":\(heading)}}]}"
    do {
      try mapView.mapboxMap.style.setSourceProperty(
        for: "tripDriveMarkerSource",
        property: "data",
        value: geoJson
      )
      lastMarkerLatitude = latitude.doubleValue
      lastMarkerLongitude = longitude.doubleValue
      lastMarkerHeading = heading
    } catch {
      // The React marker source can mount after the follower.
      dirty = true
    }
  }
}

@objc(VroomMapCameraFollower)
final class VroomMapCameraFollowerManager: RCTViewManager {
  override func view() -> UIView! { VroomMapCameraFollowerView() }
  override static func requiresMainQueueSetup() -> Bool { true }
}
