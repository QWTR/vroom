import Foundation
import MapboxMaps
import React
import Turf
import UIKit
import rnmapbox_maps

private struct VroomRenderedPose {
  let latitude: Double
  let longitude: Double
  let heading: Double
}

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {
  private static let markerSourceId = "tripDriveMarkerSource"

  @objc var enabled = false { didSet { if enabled && !oldValue { framingInitialized = false }; markDirty(forceSource: enabled) } }
  @objc var markerVisible = true { didSet { markDirty(forceSource: markerVisible && !oldValue) } }
  @objc var positionValid: NSNumber = 0 { didSet { markDirty(forceSource: true) } }
  @objc var latitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var longitude: NSNumber = 0 { didSet { markDirty() } }
  @objc var heading: NSNumber = 0 { didSet { markDirty() } }
  @objc var segmentDurationMs: NSNumber = 180 { didSet { markDirty() } }
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
  private var displayedZoom = 18.0
  private var displayedPitch = 58.0
  private var lastFrameTimestamp: CFTimeInterval = 0
  private var nextSourceHealthCheck: CFTimeInterval = 0
  private var sourceRetryAt: CFTimeInterval = 0
  private var sourceRetryCount = 0
  private var lastMarkerLatitude = Double.nan
  private var lastMarkerLongitude = Double.nan
  private var lastMarkerHeading = Double.nan
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
    invalidateSourceCache()
    ensureMarkerInfrastructure(mapView, now: CACurrentMediaTime())
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
    invalidateSourceCache()
    updateDisplayLink()
    applyImmediately()
  }

  private func applyImmediately() {
    guard let mapView = nativeMapView else { return }
    let now = CACurrentMediaTime()
    ensureMarkerInfrastructure(mapView, now: now)
    if let pose = currentPose() {
      apply(pose: pose, to: mapView, timestamp: now)
    }
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
      nextSourceHealthCheck = now + 1
    }
    guard let pose = currentPose() else { return }
    apply(pose: pose, to: mapView, timestamp: now)
    dirty = false
  }

  private func apply(pose: VroomRenderedPose, to mapView: MapView, timestamp: CFTimeInterval) {
    if enabled {
      if !framingInitialized {
        let camera = mapView.mapboxMap.cameraState
        displayedZoom = camera.zoom
        displayedPitch = camera.pitch
        framingInitialized = true
      }
      let dtMs = lastFrameTimestamp > 0 ? min(50, max(1, (timestamp - lastFrameTimestamp) * 1000)) : 16
      lastFrameTimestamp = timestamp
      let alpha = 1 - exp(-dtMs / 120)
      displayedZoom += (zoom.doubleValue - displayedZoom) * alpha
      displayedPitch += (pitch.doubleValue - displayedPitch) * alpha
      mapView.mapboxMap.setCamera(to: CameraOptions(
        center: CLLocationCoordinate2D(latitude: pose.latitude, longitude: pose.longitude),
        padding: UIEdgeInsets(
          top: max(0, paddingTop.doubleValue),
          left: max(0, paddingLeft.doubleValue),
          bottom: max(0, paddingBottom.doubleValue),
          right: max(0, paddingRight.doubleValue)
        ),
        zoom: displayedZoom,
        bearing: Self.normalizeHeading(pose.heading),
        pitch: displayedPitch
      ))
    }
    updateMarkerSource(mapView, pose: pose)
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

  private func updateMarkerSource(_ mapView: MapView, pose: VroomRenderedPose) {
    guard markerVisible else { return }
    let moved = !lastMarkerLatitude.isFinite
      || abs(lastMarkerLatitude - pose.latitude) > 0.0000001
      || abs(lastMarkerLongitude - pose.longitude) > 0.0000001
      || abs(lastMarkerHeading - pose.heading) > 0.1
    guard moved || forceSourceRefresh else { return }
    let heading = Self.normalizeHeading(pose.heading)
    var feature = Feature(geometry: .point(Point(CLLocationCoordinate2D(
      latitude: pose.latitude,
      longitude: pose.longitude
    ))))
    feature.properties = ["heading": .number(heading)]
    do {
      try mapView.mapboxMap.style.updateGeoJSONSource(withId: Self.markerSourceId, geoJSON: .feature(feature))
      lastMarkerLatitude = pose.latitude
      lastMarkerLongitude = pose.longitude
      lastMarkerHeading = heading
      forceSourceRefresh = false
    } catch {
      NSLog("[VroomNativeFollower] marker source write failed: %@", String(describing: error))
      forceSourceRefresh = true
      dirty = true
    }
  }

  private func currentPose() -> VroomRenderedPose? {
    guard positionValid.doubleValue > 0.5 else { return nil }
    let lat = latitude.doubleValue
    let lng = longitude.doubleValue
    let hdg = heading.doubleValue
    guard lat.isFinite, lng.isFinite, hdg.isFinite,
          abs(lat) > 0.000001 || abs(lng) > 0.000001 else { return nil }
    return VroomRenderedPose(latitude: lat, longitude: lng, heading: hdg)
  }

  private static func normalizeHeading(_ value: Double) -> Double {
    let normalized = value.truncatingRemainder(dividingBy: 360)
    return normalized < 0 ? normalized + 360 : normalized
  }
}

@objc(VroomMapCameraFollower)
final class VroomMapCameraFollowerManager: RCTViewManager {
  override func view() -> UIView! { VroomMapCameraFollowerView() }
  override static func requiresMainQueueSetup() -> Bool { true }
}
