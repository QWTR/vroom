import Foundation
import MapboxMaps
import React
import Turf
import UIKit
import rnmapbox_maps

@objc(VroomMapCameraFollowerView)
final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {
  private static let markerSourceId = "tripDriveMarkerSource"
  private static let fallbackLayerId = "tripDriveMarkerNativeFallback"
  private static let markerBottomClearance: CGFloat = 76

  @objc var enabled = false { didSet { if enabled && !oldValue { framingInitialized = false }; markDirty(forceSource: enabled) } }
  @objc var markerVisible = true { didSet { markDirty(forceSource: markerVisible && !oldValue) } }
  @objc var navigationSample: NSDictionary? {
    didSet {
      guard let navigationSample, let sample = VroomNativeNavigationSample(dictionary: navigationSample) else { return }
      predictor.ingest(sample, wallClockMs: Date().timeIntervalSince1970 * 1000, monotonic: CACurrentMediaTime())
      NSLog("[VroomNativeFollower] sample=\(sample.sequence) fixAgeMs=\(Int(predictor.lastFixAgeMs)) path=\(sample.pathMode)")
      markDirty(forceSource: true)
    }
  }
  @objc var zoom: NSNumber = 18 { didSet { markDirty() } }
  @objc var pitch: NSNumber = 58 { didSet { markDirty() } }
  @objc var paddingLeft: NSNumber = 0 { didSet { markDirty() } }
  @objc var paddingRight: NSNumber = 0 { didSet { markDirty() } }
  @objc var bottomOcclusion: NSNumber = 0 { didSet { markDirty() } }

  private weak var nativeMapView: MapView?
  private var displayLink: CADisplayLink?
  private let predictor = VroomNativeMotionPredictor()
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
  private var lastPose: VroomNativePose?
  private var observers: [NSObjectProtocol] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    restoreNativeState()
    installLifecycleObservers()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    restoreNativeState()
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

  private func restoreNativeState() {
    let state = VroomNativeNavigationState.shared.snapshot()
    predictor.restore(sample: state.0, pose: state.1)
    lastPose = state.1
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
    if let pose = predictor.pose(at: now) ?? lastPose {
      lastPose = pose
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
    guard let pose = predictor.pose(at: now) ?? lastPose else { return }
    lastPose = pose
    apply(pose: pose, to: mapView, timestamp: now)
    dirty = false
  }

  private func apply(pose: VroomNativePose, to mapView: MapView, timestamp: CFTimeInterval) {
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
      let height = mapView.bounds.height
      let anchorY = max(0, min(height, height - max(0, bottomOcclusion.doubleValue) - Self.markerBottomClearance))
      mapView.mapboxMap.setCamera(to: CameraOptions(
        center: CLLocationCoordinate2D(latitude: pose.latitude, longitude: pose.longitude),
        padding: UIEdgeInsets(top: 0, left: max(0, paddingLeft.doubleValue), bottom: 0, right: max(0, paddingRight.doubleValue)),
        anchor: CGPoint(x: mapView.bounds.midX, y: anchorY),
        zoom: displayedZoom,
        bearing: VroomNativeMotionPredictor.normalizeHeading(pose.heading),
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
      if !style.layerExists(withId: Self.fallbackLayerId) {
        var layer = CircleLayer(id: Self.fallbackLayerId, source: Self.markerSourceId)
        layer.circleRadius = .constant(9)
        layer.circleColor = .constant(StyleColor(UIColor(red: 0.89, green: 0.22, blue: 0.21, alpha: 1)))
        layer.circleStrokeWidth = .constant(2.5)
        layer.circleStrokeColor = .constant(StyleColor(UIColor.white))
        layer.circlePitchAlignment = .constant(.map)
        try style.addLayer(layer)
        NSLog("[VroomNativeFollower] recreated fallback marker layer")
      }
      try style.setLayerProperty(
        for: Self.fallbackLayerId,
        property: "visibility",
        value: markerVisible ? "visible" : "none"
      )
      sourceRetryCount = 0
      sourceRetryAt = 0
    } catch {
      NSLog("[VroomNativeFollower] marker infrastructure retry: %@", String(describing: error))
      sourceRetryCount = min(sourceRetryCount + 1, 6)
      sourceRetryAt = now + min(1, 0.05 * pow(2, Double(sourceRetryCount)))
      forceSourceRefresh = true
    }
  }

  private func updateMarkerSource(_ mapView: MapView, pose: VroomNativePose) {
    guard markerVisible else { return }
    let moved = !lastMarkerLatitude.isFinite
      || abs(lastMarkerLatitude - pose.latitude) > 0.0000001
      || abs(lastMarkerLongitude - pose.longitude) > 0.0000001
      || abs(lastMarkerHeading - pose.heading) > 0.1
    guard moved || forceSourceRefresh else { return }
    let heading = VroomNativeMotionPredictor.normalizeHeading(pose.heading)
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
}

@objc(VroomMapCameraFollower)
final class VroomMapCameraFollowerManager: RCTViewManager {
  override func view() -> UIView! { VroomMapCameraFollowerView() }
  override static func requiresMainQueueSetup() -> Bool { true }
}
