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
        resetInterpolationState()
        dirty = true
      }
      updateDisplayLink()
    }
  }
  @objc var positionValid: NSNumber = 0 { didSet { markDirty() } }
  @objc var markerVisible = true {
    didSet {
      if markerVisible && !oldValue {
        resetInterpolationState()
      }
      markDirty()
    }
  }
  @objc var latitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var longitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var heading: NSNumber = 0 { didSet { markDirty() } }
  @objc var segmentDurationMs: NSNumber = 900 { didSet { markDirty() } }
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

  private var sourceLatitude = Double.nan
  private var sourceLongitude = Double.nan
  private var sourceHeading = 0.0
  private var displayLatitude = Double.nan
  private var displayLongitude = Double.nan
  private var displayHeading = 0.0
  private var segmentStartLatitude = 0.0
  private var segmentStartLongitude = 0.0
  private var segmentStartHeading = 0.0
  private var segmentStartTimestamp: CFTimeInterval = 0
  private var segmentDurationSec = 1.0
  private var hasDisplayPose = false

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

  @objc public override func didSetProps(_ props: [String]) {
    noteSourcePose(
      lat: latitude.doubleValue,
      lng: longitude.doubleValue,
      heading: heading.doubleValue
    )
    markDirty()
  }

  private func updateDisplayLink() {
    if !isMotionActive {
      displayLink?.invalidate()
      displayLink = nil
      return
    }
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(onDisplayFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func markDirty() {
    dirty = true
    updateDisplayLink()
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

  private func resetInterpolationState() {
    hasDisplayPose = false
    sourceLatitude = .nan
    sourceLongitude = .nan
    sourceHeading = 0
    displayLatitude = .nan
    displayLongitude = .nan
    displayHeading = 0
    segmentStartLatitude = 0
    segmentStartLongitude = 0
    segmentStartHeading = 0
    segmentStartTimestamp = 0
    lastMarkerLatitude = .nan
    lastMarkerLongitude = .nan
    lastMarkerHeading = .nan
  }

  private func noteSourcePose(lat: Double, lng: Double, heading: Double) {
    guard lat.isFinite, lng.isFinite, heading.isFinite else { return }
    let moved = !sourceLatitude.isFinite
      || abs(sourceLatitude - lat) > 1e-8
      || abs(sourceLongitude - lng) > 1e-8
      || abs(sourceHeading - heading) > 0.05
    guard moved else { return }

    if hasDisplayPose {
      segmentStartLatitude = displayLatitude
      segmentStartLongitude = displayLongitude
      segmentStartHeading = displayHeading
      segmentStartTimestamp = CACurrentMediaTime()
      segmentDurationSec = max(0.08, min(5.0, segmentDurationMs.doubleValue / 1000.0))
    } else {
      displayLatitude = lat
      displayLongitude = lng
      displayHeading = normalizeHeading(heading)
      hasDisplayPose = true
      segmentStartTimestamp = 0
    }

    sourceLatitude = lat
    sourceLongitude = lng
    sourceHeading = normalizeHeading(heading)
  }

  private func interpolateDisplayPose(now: CFTimeInterval) {
    guard hasDisplayPose, sourceLatitude.isFinite, displayLatitude.isFinite else { return }
    let t: Double
    if segmentStartTimestamp > 0 {
      t = min(1.0, max(0.0, (now - segmentStartTimestamp) / segmentDurationSec))
    } else {
      t = 1.0
    }
    displayLatitude = segmentStartLatitude + (sourceLatitude - segmentStartLatitude) * t
    displayLongitude = segmentStartLongitude + (sourceLongitude - segmentStartLongitude) * t
    displayHeading = lerpHeading(segmentStartHeading, sourceHeading, t)
  }

  private func normalizeHeading(_ heading: Double) -> Double {
    (heading.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
  }

  private func lerpHeading(_ from: Double, _ to: Double, _ t: Double) -> Double {
    let diff = ((to - from + 540).truncatingRemainder(dividingBy: 360)) - 180
    return normalizeHeading(from + diff * t)
  }

  @objc private func onDisplayFrame(_ displayLink: CADisplayLink) {
    guard isMotionActive else { return }

    let shouldApplyPose = positionValid.boolValue
      && latitude.doubleValue.isFinite
      && longitude.doubleValue.isFinite
      && heading.doubleValue.isFinite
      && zoom.doubleValue.isFinite
      && (abs(latitude.doubleValue) > 0.000001 || abs(longitude.doubleValue) > 0.000001)
      && nativeMapView != nil

    guard shouldApplyPose || dirty || hasPendingFraming else { return }

    guard let mapView = nativeMapView else {
      dirty = false
      return
    }

    if shouldApplyPose {
      interpolateDisplayPose(now: displayLink.timestamp)
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

    let needsFramingUpdate = enabled && (dirty || hasPendingFraming)
    let needsPoseUpdate = shouldApplyPose && hasDisplayPose

    if !needsFramingUpdate && !needsPoseUpdate {
      dirty = false
      return
    }

    dirty = false

    if needsPoseUpdate {
      let normalizedHeading = displayHeading
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
          center: CLLocationCoordinate2D(latitude: displayLatitude, longitude: displayLongitude),
          padding: UIEdgeInsets(
            top: displayedPaddingTop,
            left: displayedPaddingLeft,
            bottom: displayedPaddingBottom,
            right: displayedPaddingRight
          ),
          anchor: nil,
          zoom: displayedZoom,
          bearing: normalizedHeading,
          pitch: displayedPitch
        ))
      }
      updateMarkerSource(mapView, latitude: displayLatitude, longitude: displayLongitude, heading: normalizedHeading)
    } else if needsFramingUpdate && enabled {
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
      let camera = mapView.mapboxMap.cameraState
      mapView.mapboxMap.setCamera(to: CameraOptions(
        center: camera.center,
        padding: UIEdgeInsets(
          top: displayedPaddingTop,
          left: displayedPaddingLeft,
          bottom: displayedPaddingBottom,
          right: displayedPaddingRight
        ),
        anchor: nil,
        zoom: displayedZoom,
        bearing: camera.bearing,
        pitch: displayedPitch
      ))
    }
  }

  private func updateMarkerSource(_ mapView: MapView, latitude: Double, longitude: Double, heading: Double) {
    guard markerVisible else { return }
    let moved = !lastMarkerLatitude.isFinite
      || abs(lastMarkerLatitude - latitude) > 0.0000001
      || abs(lastMarkerLongitude - longitude) > 0.0000001
      || abs(lastMarkerHeading - heading) > 0.1
    guard moved else { return }
    let geoJson = "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[\(longitude),\(latitude)]},\"properties\":{\"heading\":\(heading)}}]}"
    do {
      try mapView.mapboxMap.style.setSourceProperty(
        for: "tripDriveMarkerSource",
        property: "data",
        value: geoJson
      )
      lastMarkerLatitude = latitude
      lastMarkerLongitude = longitude
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
