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
private let vroomCameraCenterHalfLifeMs = 90.0
private let vroomCameraBearingHalfLifeMs = 90.0
private let vroomCameraBearingDeadbandDeg = 0.25
private let vroomCameraMovingMaxErrorM = 0.75
private let vroomCameraStoppedMaxErrorM = 0.25
private let vroomCameraMovingSpeedMps = 0.83

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {
  private static let markerSourceId = "tripDriveMarkerSource"
  private static let nativeArrowImageId = "vroom-location-arrow"
  private static let arrowLogicalPt: CGFloat = 74

  @objc var enabled = false {
    didSet {
      if enabled && !oldValue {
        framingInitialized = false
        poseInitialized = false
        cameraReentry = true
        lastFrameTimestamp = 0
      }
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
  @objc var markerHeading: NSNumber = 0 { didSet { markDirty() } }
  @objc var speedMps: NSNumber = 0 { didSet { markDirty() } }
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
  private var poseInitialized = false
  private var cameraReentry = false
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
    dirty = false
    apply(to: mapView, timestamp: now)
    if !hasPendingWork() {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  private func apply(to mapView: MapView, timestamp: CFTimeInterval) {
    guard positionValid.doubleValue > 0.5 else { return }
    let targetLat = latitude.doubleValue
    let targetLng = longitude.doubleValue
    let targetHdg = heading.doubleValue
    let targetMarkerHdg = markerHeading.doubleValue
    guard targetLat.isFinite, targetLng.isFinite, targetHdg.isFinite, targetMarkerHdg.isFinite,
          abs(targetLat) > 0.000001 || abs(targetLng) > 0.000001 else { return }

    let dtMs: Double
    if lastFrameTimestamp > 0 {
      dtMs = min(50, max(1, (timestamp - lastFrameTimestamp) * 1000))
    } else {
      dtMs = 16
    }
    lastFrameTimestamp = timestamp

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
    }

    if !poseInitialized {
      if enabled {
        let camera = mapView.mapboxMap.cameraState
        displayedLatitude = camera.center.latitude
        displayedLongitude = camera.center.longitude
        displayedHeading = Self.normalizeHeading(camera.bearing)
      } else {
        displayedLatitude = targetLat
        displayedLongitude = targetLng
        displayedHeading = Self.normalizeHeading(targetHdg)
      }
      poseInitialized = true
    }
    advanceDisplayedPose(
      targetLat: targetLat,
      targetLng: targetLng,
      targetHeading: targetHdg,
      targetSpeedMps: max(0, speedMps.doubleValue),
      dtMs: dtMs
    )

    let cameraWorldHeading = Self.normalizeHeading(displayedHeading)
    let markerWorldHeading = Self.normalizeHeading(targetMarkerHdg)
    ensureArrowImage(mapView)

    var appliedCameraBearing = Self.normalizeHeading(mapView.mapboxMap.cameraState.bearing)
    if enabled && mode != "free" {
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
        bearing: mode == "northUp" ? 0 : cameraWorldHeading,
        pitch: displayedPitch
      ))
      appliedCameraBearing = mode == "northUp" ? 0 : cameraWorldHeading
    }

    let screenHeading = Self.normalizeHeading(markerWorldHeading - appliedCameraBearing)
    updateMarkerSource(
      mapView,
      pose: VroomRenderedPose(
        latitude: targetLat,
        longitude: targetLng,
        worldHeading: markerWorldHeading,
        screenHeading: screenHeading
      )
    )
  }

  private func advanceDisplayedPose(
    targetLat: Double,
    targetLng: Double,
    targetHeading: Double,
    targetSpeedMps: Double,
    dtMs: Double
  ) {
    let center = Self.advanceCenter(
      currentLat: displayedLatitude,
      currentLng: displayedLongitude,
      targetLat: targetLat,
      targetLng: targetLng,
      targetHeading: targetHeading,
      speedMps: targetSpeedMps,
      dtMs: dtMs,
      clampTrackingError: !cameraReentry
    )
    displayedLatitude = center.latitude
    displayedLongitude = center.longitude
    displayedHeading = Self.advanceBearing(current: displayedHeading, target: targetHeading, dtMs: dtMs)
    if cameraReentry && Self.distanceMeters(displayedLatitude, displayedLongitude, targetLat, targetLng) <= vroomCameraMovingMaxErrorM {
      cameraReentry = false
    }
  }

  private func hasPendingWork() -> Bool {
    guard enabled, poseInitialized else { return dirty }
    let centerPending = Self.distanceMeters(
      displayedLatitude,
      displayedLongitude,
      latitude.doubleValue,
      longitude.doubleValue
    ) > 0.01
    let bearingPending = abs(Self.shortestHeadingDelta(from: displayedHeading, to: heading.doubleValue)) > vroomCameraBearingDeadbandDeg
    let framingPending = abs(displayedZoom - zoom.doubleValue) > 0.002
      || abs(displayedPitch - pitch.doubleValue) > 0.03
      || abs(displayedPaddingTop - max(0, paddingTop.doubleValue)) > 0.25
      || abs(displayedPaddingBottom - max(0, paddingBottom.doubleValue)) > 0.25
      || abs(displayedPaddingLeft - max(0, paddingLeft.doubleValue)) > 0.25
      || abs(displayedPaddingRight - max(0, paddingRight.doubleValue)) > 0.25
    return dirty || centerPending || bearingPending || framingPending
  }

  private func ensureMarkerInfrastructure(_ mapView: MapView, now: CFTimeInterval) {
    guard now >= sourceRetryAt else { return }
    guard let mapboxMap = mapView.mapboxMap else {
      sourceRetryCount = min(sourceRetryCount + 1, 6)
      sourceRetryAt = now + min(1, 0.05 * pow(2, Double(sourceRetryCount)))
      forceSourceRefresh = true
      return
    }
    do {
      if !mapboxMap.sourceExists(withId: Self.markerSourceId) {
        var source = GeoJSONSource(id: Self.markerSourceId)
        source.data = .featureCollection(FeatureCollection(features: []))
        try mapboxMap.addSource(source)
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
    guard let mapboxMap = mapView.mapboxMap else {
      arrowImageRegistered = false
      return
    }
    let image = cachedArrowImage ?? Self.renderArrowImage()
    cachedArrowImage = image
    do {
      try mapboxMap.addImage(image, id: Self.nativeArrowImageId)
      arrowImageRegistered = true
    } catch {
      arrowImageRegistered = false
      NSLog("[VroomNativeFollower] arrow image register failed: %@", String(describing: error))
    }
  }

  private func updateMarkerSource(_ mapView: MapView, pose: VroomRenderedPose) {
    guard markerVisible else { return }
    guard let mapboxMap = mapView.mapboxMap else {
      forceSourceRefresh = true
      dirty = true
      return
    }
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
    guard mapboxMap.sourceExists(withId: Self.markerSourceId) else {
      forceSourceRefresh = true
      dirty = true
      return
    }
    mapboxMap.updateGeoJSONSource(
      withId: Self.markerSourceId,
      geoJSON: .feature(feature)
    )
    lastMarkerLatitude = pose.latitude
    lastMarkerLongitude = pose.longitude
    lastMarkerHeading = screenHeading
    lastMarkerWorldHeading = worldHeading
    forceSourceRefresh = false
  }

  private static func distanceMeters(_ aLat: Double, _ aLng: Double, _ bLat: Double, _ bLng: Double) -> Double {
    guard aLat.isFinite, aLng.isFinite, bLat.isFinite, bLng.isFinite else { return .infinity }
    let meanLat = (aLat + bLat) * 0.5 * .pi / 180
    let north = (bLat - aLat) * 111_320
    let east = (bLng - aLng) * 111_320 * max(0.15, cos(meanLat))
    return hypot(north, east)
  }

  private static func advanceCenter(
    currentLat: Double,
    currentLng: Double,
    targetLat: Double,
    targetLng: Double,
    targetHeading: Double,
    speedMps: Double,
    dtMs: Double,
    clampTrackingError: Bool
  ) -> CLLocationCoordinate2D {
    guard currentLat.isFinite, currentLng.isFinite else {
      return CLLocationCoordinate2D(latitude: targetLat, longitude: targetLng)
    }
    let boundedDt = min(50, max(1, dtMs))
    let frameSeconds = boundedDt / 1_000
    let predictedDistance = max(0, speedMps) * frameSeconds
    let headingRad = normalizeHeading(targetHeading) * .pi / 180
    let predictedLat = targetLat + cos(headingRad) * predictedDistance / 111_320
    let lngScale = 111_320 * max(0.15, cos(targetLat * .pi / 180))
    let predictedLng = targetLng + sin(headingRad) * predictedDistance / lngScale
    let alpha = 1 - exp(-log(2) * boundedDt / vroomCameraCenterHalfLifeMs)
    var nextLat = currentLat + (predictedLat - currentLat) * alpha
    var nextLng = currentLng + (predictedLng - currentLng) * alpha
    if clampTrackingError {
      let maxError = speedMps >= vroomCameraMovingSpeedMps
        ? vroomCameraMovingMaxErrorM
        : vroomCameraStoppedMaxErrorM
      let remaining = distanceMeters(nextLat, nextLng, targetLat, targetLng)
      if remaining > maxError {
        let correction = (remaining - maxError) / remaining
        nextLat += (targetLat - nextLat) * correction
        nextLng += (targetLng - nextLng) * correction
      }
    }
    return CLLocationCoordinate2D(latitude: nextLat, longitude: nextLng)
  }

  private static func advanceBearing(current: Double, target: Double, dtMs: Double) -> Double {
    let delta = shortestHeadingDelta(from: current, to: target)
    if abs(delta) <= vroomCameraBearingDeadbandDeg { return normalizeHeading(current) }
    let boundedDt = min(50, max(1, dtMs))
    let alpha = 1 - exp(-log(2) * boundedDt / vroomCameraBearingHalfLifeMs)
    return normalizeHeading(current + delta * alpha)
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
