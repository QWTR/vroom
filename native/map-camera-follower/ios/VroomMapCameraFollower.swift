import Foundation
import MapboxMaps
import React
import rnmapbox_maps

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: RNMBXMapAndMapViewComponentBase {
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
  @objc var positionValid: NSNumber = 0 { didSet { dirty = true } }
  @objc var latitude: NSNumber = 0 { didSet { dirty = true } }
  @objc var longitude: NSNumber = 0 { didSet { dirty = true } }
  @objc var heading: NSNumber = 0 { didSet { dirty = true } }
  @objc var zoom: NSNumber = 18 { didSet { dirty = true } }
  @objc var pitch: NSNumber = 58 { didSet { dirty = true } }
  @objc var paddingTop: NSNumber = 0 { didSet { dirty = true } }
  @objc var paddingBottom: NSNumber = 0 { didSet { dirty = true } }
  @objc var paddingLeft: NSNumber = 0 { didSet { dirty = true } }
  @objc var paddingRight: NSNumber = 0 { didSet { dirty = true } }

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

  override func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) -> Bool {
    let added = super.addToMap(map, mapView: mapView, style: style)
    nativeMapView = mapView
    dirty = true
    updateDisplayLink()
    return added
  }

  override func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    displayLink?.invalidate()
    displayLink = nil
    nativeMapView = nil
    return super.removeFromMap(map, mapView: mapView, reason: reason)
  }

  private func updateDisplayLink() {
    guard enabled, displayLink == nil else {
      if !enabled { displayLink?.invalidate(); displayLink = nil }
      return
    }
    let link = CADisplayLink(target: self, selector: #selector(onDisplayFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private var hasPendingFraming: Bool {
    framingInitialized && (
      abs(displayedZoom - zoom.doubleValue) > 0.002 ||
      abs(displayedPitch - pitch.doubleValue) > 0.03 ||
      abs(displayedPaddingTop - paddingTop.doubleValue) > 0.25 ||
      abs(displayedPaddingBottom - paddingBottom.doubleValue) > 0.25 ||
      abs(displayedPaddingLeft - paddingLeft.doubleValue) > 0.25 ||
      abs(displayedPaddingRight - paddingRight.doubleValue) > 0.25
    )
  }

  @objc private func onDisplayFrame(_ displayLink: CADisplayLink) {
    guard enabled, dirty || hasPendingFraming else { return }
    guard positionValid.boolValue,
          latitude.doubleValue.isFinite,
          longitude.doubleValue.isFinite,
          heading.doubleValue.isFinite,
          zoom.doubleValue.isFinite,
          abs(latitude.doubleValue) > 0.000001 || abs(longitude.doubleValue) > 0.000001,
          let mapView = nativeMapView else { return }

    if !framingInitialized {
      let camera = mapView.mapboxMap.cameraState
      displayedZoom = camera.zoom
      displayedPitch = camera.pitch
      displayedPaddingTop = camera.padding.top
      displayedPaddingBottom = camera.padding.bottom
      displayedPaddingLeft = camera.padding.left
      displayedPaddingRight = camera.padding.right
      framingInitialized = true
    }
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
    dirty = false

    let normalizedHeading = (heading.doubleValue.truncatingRemainder(dividingBy: 360) + 360)
      .truncatingRemainder(dividingBy: 360)
    mapView.mapboxMap.setCamera(to: CameraOptions(
      center: CLLocationCoordinate2D(latitude: latitude.doubleValue, longitude: longitude.doubleValue),
      padding: UIEdgeInsets(top: displayedPaddingTop, left: displayedPaddingLeft, bottom: displayedPaddingBottom, right: displayedPaddingRight),
      anchor: nil,
      zoom: displayedZoom,
      bearing: normalizedHeading,
      pitch: displayedPitch
    ))
  }
}

@objc(VroomMapCameraFollower)
final class VroomMapCameraFollowerManager: RCTViewManager {
  override func view() -> UIView! { VroomMapCameraFollowerView() }
  override static func requiresMainQueueSetup() -> Bool { true }
}
