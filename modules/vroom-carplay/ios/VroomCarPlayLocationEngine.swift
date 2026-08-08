import CoreLocation
import Foundation
import UIKit

final class VroomCarPlayLocationEngine: NSObject, CLLocationManagerDelegate {
  var onPose: ((VroomCarPlayPose) -> Void)?
  var onLocationFailure: ((Error) -> Void)?
  var onConfirmedOffRoute: ((VroomCarPlayPose) -> Void)?

  private let manager = CLLocationManager()
  private var displayLink: CADisplayLink?
  private var fallbackWorkItem: DispatchWorkItem?
  private var started = false
  private var usingSharedLocation = false
  private var activeRoute: [VroomCoordinate] = []
  private var sourceCoordinate: VroomCoordinate?
  private var targetCoordinate: VroomCoordinate?
  private var rawCoordinate: VroomCoordinate?
  private var renderedCoordinate: VroomCoordinate?
  private var latestLocation: CLLocation?
  private var segmentStartedAt = CACurrentMediaTime()
  private var segmentDuration = 0.35
  private var displayedHeading = 0.0
  private var targetHeading = 0.0
  private var lastProjectionSegmentIndex: Int?
  private var highFrameRateEnabled = true
  private var offRouteStartedAt: TimeInterval?
  private var lastOffRouteCallbackAt: TimeInterval = 0

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 2
    manager.activityType = .automotiveNavigation
    manager.pausesLocationUpdatesAutomatically = true
    manager.allowsBackgroundLocationUpdates = true
  }

  func start() {
    guard !started else { return }
    started = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(receiveSharedLocation(_:)),
      name: Notification.Name("VroomSharedLocationFix"),
      object: nil
    )
    startDisplayLink()
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.started, self.latestLocation == nil else { return }
      self.startFallbackLocation()
    }
    fallbackWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
  }

  func stop() {
    started = false
    usingSharedLocation = false
    fallbackWorkItem?.cancel()
    fallbackWorkItem = nil
    NotificationCenter.default.removeObserver(
      self,
      name: Notification.Name("VroomSharedLocationFix"),
      object: nil
    )
    displayLink?.invalidate()
    displayLink = nil
    manager.stopUpdatingHeading()
    manager.stopUpdatingLocation()
    offRouteStartedAt = nil
  }

  func setRoute(_ route: [VroomCoordinate]) {
    guard route != activeRoute else { return }
    activeRoute = route
    lastProjectionSegmentIndex = nil
    offRouteStartedAt = nil
  }

  func latestPose() -> VroomCarPlayPose? {
    guard let renderedCoordinate,
      let rawCoordinate,
      let latestLocation
    else {
      return nil
    }
    return VroomCarPlayPose(
      coordinate: renderedCoordinate,
      rawCoordinate: rawCoordinate,
      speedMetersPerSecond: max(0, latestLocation.speed),
      heading: displayedHeading,
      horizontalAccuracy: max(0, latestLocation.horizontalAccuracy),
      timestamp: latestLocation.timestamp
    )
  }

  func locationManager(
    _ manager: CLLocationManager,
    didUpdateLocations locations: [CLLocation]
  ) {
    guard let location = locations.last else { return }
    ingest(location)
  }

  @objc
  private func receiveSharedLocation(_ notification: Notification) {
    guard started, let location = notification.object as? CLLocation else {
      return
    }
    usingSharedLocation = true
    fallbackWorkItem?.cancel()
    fallbackWorkItem = nil
    manager.stopUpdatingHeading()
    manager.stopUpdatingLocation()
    ingest(location)
  }

  private func startFallbackLocation() {
    guard started, !usingSharedLocation else { return }
    let status = manager.authorizationStatus
    if status == .notDetermined {
      manager.requestWhenInUseAuthorization()
    }
    manager.startUpdatingLocation()
    manager.startUpdatingHeading()
  }

  private func ingest(_ location: CLLocation) {
    let now = Date()
    guard
      location.horizontalAccuracy >= 0,
      location.horizontalAccuracy <= 120,
      abs(now.timeIntervalSince(location.timestamp)) <= 10,
      abs(location.coordinate.latitude) <= 90,
      abs(location.coordinate.longitude) <= 180,
      latestLocation.map({ location.timestamp > $0.timestamp }) ?? true
    else {
      return
    }
    let previousLocation = latestLocation
    let raw = VroomCoordinate(
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude
    )
    let projection = project(raw, onto: activeRoute)
    let shouldSnap = projection.map {
      activeRoute.count >= 2 &&
        $0.distanceMeters <= max(
          35,
          min(80, location.horizontalAccuracy * 2)
        )
    } ?? false
    let target = shouldSnap ? (projection?.coordinate ?? raw) : raw
    if shouldSnap {
      lastProjectionSegmentIndex = projection?.segmentIndex
    }
    evaluateOffRoute(
      projectionDistance: projection?.distanceMeters,
      location: location
    )

    sourceCoordinate = renderedCoordinate ?? targetCoordinate ?? target
    targetCoordinate = target
    rawCoordinate = raw
    latestLocation = location
    segmentStartedAt = CACurrentMediaTime()
    let measuredInterval = previousLocation.map {
      location.timestamp.timeIntervalSince($0.timestamp)
    } ?? 0.35
    segmentDuration = max(0.28, min(1.05, measuredInterval * 0.9))
    targetHeading = resolvedHeading(location)
    if renderedCoordinate == nil {
      renderedCoordinate = target
      displayedHeading = targetHeading
    }
  }

  func locationManager(
    _ manager: CLLocationManager,
    didUpdateHeading newHeading: CLHeading
  ) {
    guard newHeading.headingAccuracy >= 0 else {
      return
    }
    let heading =
      newHeading.trueHeading >= 0
      ? newHeading.trueHeading
      : newHeading.magneticHeading
    if latestLocation?.speed ?? 0 < 2 {
      targetHeading = normalized(heading)
    }
  }

  func locationManager(
    _ manager: CLLocationManager,
    didFailWithError error: Error
  ) {
    onLocationFailure?(error)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus == .authorizedAlways ||
      manager.authorizationStatus == .authorizedWhenInUse
    {
      if started && !usingSharedLocation {
        manager.startUpdatingLocation()
      }
    }
  }

  private func startDisplayLink() {
    guard displayLink == nil else {
      return
    }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.preferredFrameRateRange = CAFrameRateRange(
      minimum: 30,
      maximum: 60,
      preferred: 60
    )
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  @objc
  private func tick() {
    if usingSharedLocation,
      let latestLocation,
      Date().timeIntervalSince(latestLocation.timestamp) > 4
    {
      usingSharedLocation = false
      startFallbackLocation()
    }
    guard let source = sourceCoordinate,
      let target = targetCoordinate,
      let raw = rawCoordinate,
      let location = latestLocation
    else {
      return
    }
    let elapsed = CACurrentMediaTime() - segmentStartedAt
    let linearProgress = min(1, max(0, elapsed / max(0.12, segmentDuration)))
    var interpolationTarget = target
    if location.speed > 1 {
      interpolationTarget = advance(
        target,
        meters: min(24, location.speed * segmentDuration),
        heading: targetHeading
      )
      if let projection = project(interpolationTarget, onto: activeRoute),
        projection.distanceMeters <= 45
      {
        interpolationTarget = projection.coordinate
      }
    }
    var coordinate = interpolate(source, interpolationTarget, linearProgress)
    if linearProgress >= 1, location.speed > 1 {
      // Start prediction at zero when interpolation completes. Advancing by
      // the full GPS age here caused a visible jump at every location fix.
      let extrapolationSeconds = min(
        1.0,
        max(
          0,
          Date().timeIntervalSince(location.timestamp) - segmentDuration
        )
      )
      coordinate = advance(
        coordinate,
        meters: min(24, location.speed * extrapolationSeconds),
        heading: targetHeading
      )
      if let projection = project(coordinate, onto: activeRoute),
        projection.distanceMeters <= 45
      {
        coordinate = projection.coordinate
      }
    }
    renderedCoordinate = coordinate
    if #available(iOS 15.0, *) {
      let moving = location.speed >= 0.7
      if moving != highFrameRateEnabled {
        highFrameRateEnabled = moving
        displayLink?.preferredFrameRateRange = CAFrameRateRange(
          minimum: moving ? 55 : 10,
          maximum: moving ? 60 : 20,
          preferred: moving ? 60 : 15
        )
      }
    }
    displayedHeading = interpolateHeading(
      displayedHeading,
      targetHeading,
      location.speed >= 0.7 ? 0.16 : 0.08
    )
    onPose?(
      VroomCarPlayPose(
        coordinate: coordinate,
        rawCoordinate: raw,
        speedMetersPerSecond: max(0, location.speed),
        heading: displayedHeading,
        horizontalAccuracy: max(0, location.horizontalAccuracy),
        timestamp: location.timestamp
      )
    )
  }

  private func evaluateOffRoute(
    projectionDistance: Double?,
    location: CLLocation
  ) {
    guard activeRoute.count >= 2,
      location.speed * 3.6 >= 5,
      let projectionDistance,
      projectionDistance > 70
    else {
      offRouteStartedAt = nil
      return
    }
    let now = Date().timeIntervalSince1970
    if offRouteStartedAt == nil {
      offRouteStartedAt = now
    }
    guard now - (offRouteStartedAt ?? now) >= 4,
      now - lastOffRouteCallbackAt >= 12,
      let pose = latestPose()
    else {
      return
    }
    lastOffRouteCallbackAt = now
    onConfirmedOffRoute?(pose)
  }

  private func resolvedHeading(_ location: CLLocation) -> Double {
    if location.course >= 0, location.speed >= 1.5 {
      return normalized(location.course)
    }
    return targetHeading
  }

  private func interpolate(
    _ first: VroomCoordinate,
    _ second: VroomCoordinate,
    _ progress: Double
  ) -> VroomCoordinate {
    VroomCoordinate(
      latitude: first.latitude + (second.latitude - first.latitude) * progress,
      longitude:
        first.longitude + (second.longitude - first.longitude) * progress
    )
  }

  private func interpolateHeading(
    _ first: Double,
    _ second: Double,
    _ progress: Double
  ) -> Double {
    var delta = (second - first).truncatingRemainder(dividingBy: 360)
    if delta > 180 {
      delta -= 360
    } else if delta < -180 {
      delta += 360
    }
    return normalized(first + delta * progress)
  }

  private func normalized(_ heading: Double) -> Double {
    let value = heading.truncatingRemainder(dividingBy: 360)
    return value < 0 ? value + 360 : value
  }

  private func advance(
    _ coordinate: VroomCoordinate,
    meters: Double,
    heading: Double
  ) -> VroomCoordinate {
    let radius = 6_371_000.0
    let angularDistance = meters / radius
    let bearing = heading * .pi / 180
    let latitude = coordinate.latitude * .pi / 180
    let longitude = coordinate.longitude * .pi / 180
    let nextLatitude = asin(
      sin(latitude) * cos(angularDistance) +
        cos(latitude) * sin(angularDistance) * cos(bearing)
    )
    let nextLongitude =
      longitude +
      atan2(
        sin(bearing) * sin(angularDistance) * cos(latitude),
        cos(angularDistance) - sin(latitude) * sin(nextLatitude)
      )
    return VroomCoordinate(
      latitude: nextLatitude * 180 / .pi,
      longitude: nextLongitude * 180 / .pi
    )
  }

  private struct RouteProjection {
    let coordinate: VroomCoordinate
    let distanceMeters: Double
    let segmentIndex: Int
  }

  private func project(
    _ coordinate: VroomCoordinate,
    onto route: [VroomCoordinate]
  ) -> RouteProjection? {
    guard route.count >= 2 else {
      return nil
    }
    let metersPerDegree = 111_320.0
    let longitudeScale = max(
      0.15,
      cos(coordinate.latitude * .pi / 180)
    )
    let pointX = coordinate.longitude * longitudeScale * metersPerDegree
    let pointY = coordinate.latitude * metersPerDegree
    var best: RouteProjection?
    let lowerIndex = max(0, (lastProjectionSegmentIndex ?? 20) - 20)
    let upperIndex = min(
      route.count - 2,
      (lastProjectionSegmentIndex ?? (route.count - 82)) + 80
    )
    let searchRange =
      lastProjectionSegmentIndex == nil
      ? 0..<(route.count - 1)
      : lowerIndex..<(upperIndex + 1)
    for index in searchRange {
      let first = route[index]
      let second = route[index + 1]
      let firstX = first.longitude * longitudeScale * metersPerDegree
      let firstY = first.latitude * metersPerDegree
      let secondX = second.longitude * longitudeScale * metersPerDegree
      let secondY = second.latitude * metersPerDegree
      let deltaX = secondX - firstX
      let deltaY = secondY - firstY
      let lengthSquared = deltaX * deltaX + deltaY * deltaY
      let ratio: Double
      if lengthSquared > 0 {
        ratio = max(
          0,
          min(
            1,
            ((pointX - firstX) * deltaX + (pointY - firstY) * deltaY) /
              lengthSquared
          )
        )
      } else {
        ratio = 0
      }
      let projectedX = firstX + deltaX * ratio
      let projectedY = firstY + deltaY * ratio
      let distance = hypot(pointX - projectedX, pointY - projectedY)
      if best.map({ distance < $0.distanceMeters }) ?? true {
        best = RouteProjection(
          coordinate: VroomCoordinate(
            latitude: projectedY / metersPerDegree,
            longitude: projectedX / longitudeScale / metersPerDegree
          ),
          distanceMeters: distance,
          segmentIndex: index
        )
      }
    }
    return best
  }
}
