import Foundation
import MapboxMaps
import React
import Turf
import UIKit
import rnmapbox_maps

private struct VroomRenderedPose {
  let latitude: Double
  let longitude: Double
  let worldHeading: Double
  let screenHeading: Double
}

private let vroomMapCameraDefaultSegmentMs = 1_000.0

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {
  private static let markerSourceId = "tripDriveMarkerSource"
  private static let nativeArrowImageId = "vroom-location-arrow"
  private static let arrowLogicalPt: CGFloat = 74

  @objc var enabled = false {
    didSet {
      if enabled && !oldValue { framingInitialized = false; lastFrameTimestamp = 0 }
      markDirty(forceSource: enabled)
    }
  }
  @objc var cameraMode: NSString = "courseUp" { didSet { markDirty(forceSource: true) } }
  @objc var markerVisible = true {
    didSet {
      if markerVisible && !oldValue {
        lastMarkerLatitude = .nan
        lastMarkerLongitude = .nan
        lastMarkerHeading = .nan
        lastMarkerWorldHeading = .nan
        arrowImageRegistered = false
      }
      markDirty(forceSource: markerVisible && !oldValue)
    }
  }
  @objc var positionValid: NSNumber = 0 { didSet { markDirty(forceSource: true) } }
  @objc var latitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var longitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var heading: NSNumber = 0 { didSet { markDirty() } }
  @objc var segmentDurationMs: NSNumber = NSNumber(value: vroomMapCameraDefaultSegmentMs) { didSet { markDirty() } }
  @objc var zoom: NSNumber = 18 { didSet { markDirty() } }
  @objc var pitch: NSNumber = 58 { didSet { markDirty() } }
  @objc var paddingTop: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingBottom: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingLeft: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingRight: NSNumber = 0 { didSet { markDirty() } }

  private weak var nativeMapView: MapView?
  private var displayLink: CADisplayLink?
  private var dirty = true
  private var forceSourceRefresh = true
  private var framingInitialized = false
  private var displayedLatitude = Double.nan
  private var displayedLongitude = Double.nan
  private var displayedHeading = 0.0
  private var displayedZoom = 18.0
  private var displayedPitch = 58.0
  private var displayedPaddingTop = 0.0
  private var displayedPaddingBottom = 0.0
  private var displayedPaddingLeft = 0.0
  private var displayedPaddingRight = 0.0
  private var lastFrameTimestamp: CFTimeInterval = 0
  private var nextSourceHealthCheck: CFTimeInterval = 0
  private var sourceRetryAt: CFTimeInterval = 0
  private var sourceRetryCount = 0
  private var lastMarkerLatitude = Double.nan
  private var lastMarkerLongitude = Double.nan
  private var lastMarkerHeading = Double.nan
  private var lastMarkerWorldHeading = Double.nan
  private var arrowImageRegistered = false
  private var cachedArrowImage: UIImage?
  private var observers: [NSObjectProtocol] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    installLifecycleObservers()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    installLifecycleObservers()
  }

  deinit {
    displayLink?.invalidate()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  public func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) {
    nativeMapView = mapView
    arrowImageRegistered = false
    invalidateSourceCache()
    ensureMarkerInfrastructure(mapView, now: CACurrentMediaTime())
    ensureArrowImage(mapView)
    applyImmediately()
    updateDisplayLink()
  }

  public func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    displayLink?.invalidate()
    displayLink = nil
    nativeMapView = nil
    return true
  }

  private func installLifecycleObservers() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.handleForeground()
    })
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.handleForeground()
    })
  }

  private func handleForeground() {
    arrowImageRegistered = false
    invalidateSourceCache()
    updateDisplayLink()
    applyImmediately()
  }

  private func applyImmediately() {
    guard let mapView = nativeMapView else { return }
    let now = CACurrentMediaTime()
    ensureMarkerInfrastructure(mapView, now: now)
    ensureArrowImage(mapView)
    apply(to: mapView, timestamp: now)
  }

  private func markDirty(forceSource: Bool = false) {
    dirty = true
    if forceSource { forceSourceRefresh = true }
    updateDisplayLink()
  }

  private func invalidateSourceCache() {
    forceSourceRefresh = true
    sourceRetryAt = 0
    sourceRetryCount = 0
    lastMarkerLatitude = .nan
    lastMarkerLongitude = .nan
    lastMarkerHeading = .nan
    lastMarkerWorldHeading = .nan
    dirty = true
  }

  private func updateDisplayLink() {
    guard enabled || markerVisible else {
      displayLink?.invalidate()
      displayLink = nil
      return
    }
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(onDisplayFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  @objc private func onDisplayFrame(_ link: CADisplayLink) {
    guard let mapView = nativeMapView else { return }
    let now = link.timestamp
    if now >= nextSourceHealthCheck || forceSourceRefresh {
      ensureMarkerInfrastructure(mapView, now: now)
      ensureArrowImage(mapView)
      nextSourceHealthCheck = now + 1
    }
    apply(to: mapView, timestamp: now)
    dirty = false
  }

  private func apply(to mapView: MapView, timestamp: CFTimeInterval) {
    guard positionValid.doubleValue > 0.5 else { return }
    let targetLat = latitude.doubleValue
    let targetLng = longitude.doubleValue
    let targetHdg = heading.doubleValue
    guard targetLat.isFinite, targetLng.isFinite, targetHdg.isFinite,
          abs(targetLat) > 0.000001 || abs(targetLng) > 0.000001 else { return }

    let dtMs: Double
    if lastFrameTimestamp > 0 {
      dtMs = min(50, max(1, (timestamp - lastFrameTimestamp) * 1000))
    } else {
      dtMs = 16
    }
    lastFrameTimestamp = timestamp

    advanceDisplayedPose(
      targetLat: targetLat,
      targetLng: targetLng,
      targetHeading: targetHdg,
      dtMs: dtMs
    )

    let worldHeading = Self.normalizeHeading(displayedHeading)
    ensureArrowImage(mapView)

    let mode = normalizedCameraMode()
    if enabled && mode != "free" {
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
      let alpha = 1 - exp(-dtMs / 120)
      displayedZoom += (zoom.doubleValue - displayedZoom) * alpha
      displayedPitch += (pitch.doubleValue - displayedPitch) * alpha
      displayedPaddingTop += (max(0, paddingTop.doubleValue) - displayedPaddingTop) * alpha
      displayedPaddingBottom += (max(0, paddingBottom.doubleValue) - displayedPaddingBottom) * alpha
      displayedPaddingLeft += (max(0, paddingLeft.doubleValue) - displayedPaddingLeft) * alpha
      displayedPaddingRight += (max(0, paddingRight.doubleValue) - displayedPaddingRight) * alpha
      mapView.mapboxMap.setCamera(to: CameraOptions(
        center: CLLocationCoordinate2D(latitude: displayedLatitude, longitude: displayedLongitude),
        padding: UIEdgeInsets(
          top: max(0, displayedPaddingTop),
          left: max(0, displayedPaddingLeft),
          bottom: max(0, displayedPaddingBottom),
          right: max(0, displayedPaddingRight)
        ),
        zoom: displayedZoom,
        bearing: mode == "northUp" ? 0 : worldHeading,
        pitch: displayedPitch
      ))
    }

    let cameraBearing: Double
    if enabled && mode == "courseUp" {
      cameraBearing = worldHeading
    } else if enabled && mode == "northUp" {
      cameraBearing = 0
    } else {
      cameraBearing = Self.normalizeHeading(mapView.mapboxMap.cameraState.bearing)
    }
    let screenHeading = enabled && mode == "courseUp"
      ? 0
      : Self.normalizeHeading(worldHeading - cameraBearing)
    updateMarkerSource(
      mapView,
      pose: VroomRenderedPose(
        latitude: displayedLatitude,
        longitude: displayedLongitude,
        worldHeading: worldHeading,
        screenHeading: screenHeading
      )
    )
  }

  private func advanceDisplayedPose(
    targetLat: Double,
    targetLng: Double,
    targetHeading: Double,
    dtMs _: Double
  ) {
    displayedLatitude = targetLat
    displayedLongitude = targetLng
    displayedHeading = Self.normalizeHeading(targetHeading)
  }

  private func ensureMarkerInfrastructure(_ mapView: MapView, now: CFTimeInterval) {
    guard now >= sourceRetryAt else { return }
    let style = mapView.mapboxMap.style
    do {
      if !style.sourceExists(withId: Self.markerSourceId) {
        var source = GeoJSONSource(id: Self.markerSourceId)
        source.data = .featureCollection(FeatureCollection(features: []))
        try style.addSource(source)
        NSLog("[VroomNativeFollower] recreated marker source")
        arrowImageRegistered = false
        forceSourceRefresh = true
      }
      sourceRetryCount = 0
      sourceRetryAt = 0
    } catch {
      NSLog("[VroomNativeFollower] marker infrastructure retry: %@", String(describing: error))
      sourceRetryCount = min(sourceRetryCount + 1, 6)
      sourceRetryAt = now + min(1, 0.05 * pow(2, Double(sourceRetryCount)))
      forceSourceRefresh = true
    }
  }

  private func ensureArrowImage(_ mapView: MapView) {
    guard !arrowImageRegistered else { return }
    let image = cachedArrowImage ?? Self.renderArrowImage()
    cachedArrowImage = image
    do {
      try mapView.mapboxMap.style.addImage(image, id: Self.nativeArrowImageId)
      arrowImageRegistered = true
    } catch {
      arrowImageRegistered = false
      NSLog("[VroomNativeFollower] arrow image register failed: %@", String(describing: error))
    }
  }

  private func updateMarkerSource(_ mapView: MapView, pose: VroomRenderedPose) {
    guard markerVisible else { return }
    let moved = !lastMarkerLatitude.isFinite
      || abs(lastMarkerLatitude - pose.latitude) > 0.0000001
      || abs(lastMarkerLongitude - pose.longitude) > 0.0000001
      || abs(Self.shortestHeadingDelta(from: lastMarkerHeading, to: pose.screenHeading)) > 0.05
      || abs(Self.shortestHeadingDelta(from: lastMarkerWorldHeading, to: pose.worldHeading)) > 0.05
    guard moved || forceSourceRefresh else { return }
    let screenHeading = Self.normalizeHeading(pose.screenHeading)
    let worldHeading = Self.normalizeHeading(pose.worldHeading)
    var feature = Feature(geometry: .point(Point(CLLocationCoordinate2D(
      latitude: pose.latitude,
      longitude: pose.longitude
    ))))
    feature.properties = [
      "heading": .number(screenHeading),
      "screenHeading": .number(screenHeading),
      "worldHeading": .number(worldHeading),
    ]
    do {
      try mapView.mapboxMap.style.updateGeoJSONSource(withId: Self.markerSourceId, geoJSON: .feature(feature))
      lastMarkerLatitude = pose.latitude
      lastMarkerLongitude = pose.longitude
      lastMarkerHeading = screenHeading
      lastMarkerWorldHeading = worldHeading
      forceSourceRefresh = false
    } catch {
      NSLog("[VroomNativeFollower] marker source write failed: %@", String(describing: error))
      forceSourceRefresh = true
      dirty = true
    }
  }

  private static func normalizeHeading(_ value: Double) -> Double {
    var normalized = value.truncatingRemainder(dividingBy: 360)
    if normalized < 0 { normalized += 360 }
    return normalized
  }

  private static func shortestHeadingDelta(from: Double, to: Double) -> Double {
    var delta = (to - from).truncatingRemainder(dividingBy: 360)
    if delta > 180 { delta -= 360 }
    if delta < -180 { delta += 360 }
    return delta
  }

  private func normalizedCameraMode() -> String {
    let value = cameraMode as String
    return value == "northUp" || value == "free" ? value : "courseUp"
  }

  /// Brand arrow matching Android `vroom_location_arrow.xml` with native Retina scale metadata.
  private static func renderArrowImage() -> UIImage {
    let logical = arrowLogicalPt
    let size = CGSize(width: logical, height: logical)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = UIScreen.main.scale
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    return renderer.image { ctx in
      let c = ctx.cgContext
      let s = logical / 74.0
      func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }

      // Shadow
      c.beginPath()
      c.move(to: p(37, 4))
      c.addLine(to: p(62, 66))
      c.addLine(to: p(37, 54))
      c.addLine(to: p(12, 66))
      c.closePath()
      c.setFillColor(UIColor(white: 0, alpha: 0.45).cgColor)
      c.fillPath()

      // Body + white stroke
      c.beginPath()
      c.move(to: p(37, 8))
      c.addLine(to: p(57, 61))
      c.addLine(to: p(37, 51))
      c.addLine(to: p(17, 61))
      c.closePath()
      c.setFillColor(UIColor(red: 0xE3 / 255, green: 0x38 / 255, blue: 0x35 / 255, alpha: 1).cgColor)
      c.fillPath()
      c.beginPath()
      c.move(to: p(37, 8))
      c.addLine(to: p(57, 61))
      c.addLine(to: p(37, 51))
      c.addLine(to: p(17, 61))
      c.closePath()
      c.setStrokeColor(UIColor.white.cgColor)
      c.setLineWidth(3.6 * s)
      c.setLineJoin(.round)
      c.strokePath()

      // Inner highlight
      c.beginPath()
      c.move(to: p(37, 15))
      c.addLine(to: p(48, 49))
      c.addLine(to: p(37, 43))
      c.addLine(to: p(26, 49))
      c.closePath()
      c.setFillColor(UIColor(red: 0xE3 / 255, green: 0x38 / 255, blue: 0x35 / 255, alpha: 1).cgColor)
      c.fillPath()
    }
  }
}

@objc(VroomMapCameraFollower)
final class VroomMapCameraFollowerManager: RCTViewManager {
  override func view() -> UIView! { VroomMapCameraFollowerView() }
  override static func requiresMainQueueSetup() -> Bool { true }
}
