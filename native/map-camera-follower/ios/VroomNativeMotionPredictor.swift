import CoreLocation
import Foundation
import QuartzCore

struct VroomNativePose {
  var latitude: Double
  var longitude: Double
  var heading: Double
  var arcM: Double?
}

struct VroomNativeArcWindow {
  let baseArcM: Double
  let pointsFlat: [Double]
  let cumulativeM: [Double]

  func point(atAbsoluteArcM arcM: Double) -> CLLocationCoordinate2D? {
    let pointCount = pointsFlat.count / 2
    guard pointCount >= 2, cumulativeM.count == pointCount else { return nil }
    let localM = max(0, min(cumulativeM.last ?? 0, arcM - baseArcM))
    var upper = 1
    while upper < cumulativeM.count - 1 && cumulativeM[upper] < localM { upper += 1 }
    let lower = max(0, upper - 1)
    let length = max(0.001, cumulativeM[upper] - cumulativeM[lower])
    let t = max(0, min(1, (localM - cumulativeM[lower]) / length))
    let lowerIndex = lower * 2
    let upperIndex = upper * 2
    return CLLocationCoordinate2D(
      latitude: pointsFlat[lowerIndex + 1] + (pointsFlat[upperIndex + 1] - pointsFlat[lowerIndex + 1]) * t,
      longitude: pointsFlat[lowerIndex] + (pointsFlat[upperIndex] - pointsFlat[lowerIndex]) * t
    )
  }

  func heading(atAbsoluteArcM arcM: Double) -> Double? {
    guard let from = point(atAbsoluteArcM: arcM),
          let to = point(atAbsoluteArcM: arcM + 12) else { return nil }
    guard VroomNativeMotionPredictor.distanceM(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude
    ) >= 0.2 else { return nil }
    return VroomNativeMotionPredictor.bearing(from: from, to: to)
  }
}

struct VroomNativeNavigationSample {
  var sequence: Int
  var latitude: Double
  var longitude: Double
  var rawLatitude: Double
  var rawLongitude: Double
  var heading: Double
  var speedMs: Double
  var sourceTimestampMs: Double
  var gpsIntervalMs: Double
  var pathMode: String
  var roadBlend: Double
  var targetArcM: Double?
  var polylineKey: String?
  var allowInstant: Bool
  var arcWindow: VroomNativeArcWindow?

  init?(dictionary: NSDictionary) {
    func number(_ key: String) -> Double? {
      guard let value = dictionary[key] as? NSNumber else { return nil }
      let result = value.doubleValue
      return result.isFinite ? result : nil
    }
    guard let latitude = number("lat"), let longitude = number("lng") else { return nil }
    sequence = (dictionary["sequence"] as? NSNumber)?.intValue ?? 0
    self.latitude = latitude
    self.longitude = longitude
    rawLatitude = number("rawLat") ?? latitude
    rawLongitude = number("rawLng") ?? longitude
    heading = number("headingDeg") ?? 0
    speedMs = max(0, number("speedMs") ?? 0)
    sourceTimestampMs = number("sourceTimestampMs") ?? Date().timeIntervalSince1970 * 1000
    gpsIntervalMs = max(250, number("gpsIntervalMs") ?? 1000)
    pathMode = dictionary["pathMode"] as? String ?? "offRoad"
    roadBlend = max(0, min(1, number("roadBlend") ?? (pathMode == "onRoad" ? 1 : 0)))
    targetArcM = number("targetArcM")
    polylineKey = dictionary["polylineKey"] as? String
    allowInstant = (dictionary["allowInstant"] as? NSNumber)?.boolValue ?? false

    if let window = dictionary["arcWindow"] as? NSDictionary,
       let baseArcM = (window["baseArcM"] as? NSNumber)?.doubleValue,
       let points = window["pointsFlat"] as? [NSNumber],
       let cumulative = window["cumM"] as? [NSNumber] {
      arcWindow = VroomNativeArcWindow(
        baseArcM: baseArcM,
        pointsFlat: points.map(\.doubleValue),
        cumulativeM: cumulative.map(\.doubleValue)
      )
    } else {
      arcWindow = nil
    }
  }
}

final class VroomNativeNavigationState {
  static let shared = VroomNativeNavigationState()
  private let lock = NSLock()
  private var storedSample: VroomNativeNavigationSample?
  private var storedPose: VroomNativePose?

  func store(sample: VroomNativeNavigationSample) {
    lock.lock(); defer { lock.unlock() }
    storedSample = sample
  }

  func store(pose: VroomNativePose) {
    lock.lock(); defer { lock.unlock() }
    storedPose = pose
  }

  func snapshot() -> (VroomNativeNavigationSample?, VroomNativePose?) {
    lock.lock(); defer { lock.unlock() }
    return (storedSample, storedPose)
  }
}

final class VroomNativeMotionPredictor {
  private var sample: VroomNativeNavigationSample?
  private var receivedMonotonic: CFTimeInterval = 0
  private var ageAtReceiptSec = 0.0
  private var correctionStartMonotonic: CFTimeInterval = 0
  private var correctionStartPose: VroomNativePose?
  private var lastPose: VroomNativePose?
  private var lastAcceptedArcM: Double?
  private var lastPolylineKey: String?
  private var rollbackCandidate: (arcM: Double, hits: Int)?

  private(set) var lastFixAgeMs = 0.0
  private(set) var lastPredictionM = 0.0
  private(set) var didReanchor = false

  func restore(sample: VroomNativeNavigationSample?, pose: VroomNativePose?) {
    lastPose = pose
    guard let sample else { return }
    ingest(sample, wallClockMs: Date().timeIntervalSince1970 * 1000, monotonic: CACurrentMediaTime())
  }

  func ingest(_ incoming: VroomNativeNavigationSample, wallClockMs: Double, monotonic: CFTimeInterval) {
    var next = incoming
    let rawAgeMs = wallClockMs - next.sourceTimestampMs
    let validAgeMs = rawAgeMs < -500 ? 0 : max(0, rawAgeMs)
    lastFixAgeMs = validAgeMs
    ageAtReceiptSec = validAgeMs > 10_000 ? 0 : validAgeMs / 1000

    if next.pathMode == "onRoad", let incomingArc = next.targetArcM {
      if next.polylineKey == lastPolylineKey,
         let previousArc = lastAcceptedArcM,
         incomingArc < previousArc - 2,
         !next.allowInstant {
        if let candidate = rollbackCandidate, abs(candidate.arcM - incomingArc) <= 4 {
          rollbackCandidate = (incomingArc, candidate.hits + 1)
          if candidate.hits < 1 { next.targetArcM = previousArc }
        } else {
          rollbackCandidate = (incomingArc, 1)
          next.targetArcM = previousArc
        }
      } else {
        rollbackCandidate = nil
      }
      lastAcceptedArcM = next.targetArcM
      lastPolylineKey = next.polylineKey
    } else {
      rollbackCandidate = nil
      lastAcceptedArcM = nil
      lastPolylineKey = nil
    }

    sample = next
    receivedMonotonic = monotonic
    correctionStartMonotonic = monotonic
    correctionStartPose = lastPose
    let target = projectedPose(at: monotonic)
    didReanchor = next.allowInstant || lastPose == nil || target.map { pose in
      guard let lastPose else { return true }
      return Self.distanceM(lastPose.latitude, lastPose.longitude, pose.latitude, pose.longitude) > 30
    } ?? false
    if didReanchor, let target {
      lastPose = target
      correctionStartPose = target
    }
    VroomNativeNavigationState.shared.store(sample: next)
  }

  func pose(at monotonic: CFTimeInterval) -> VroomNativePose? {
    guard let target = projectedPose(at: monotonic), let sample else { return lastPose }
    let elapsed = max(0, monotonic - correctionStartMonotonic)
    let t = didReanchor ? 1 : Self.smoothstep(min(1, elapsed / 0.35))
    let pose: VroomNativePose
    if let start = correctionStartPose, t < 1 {
      pose = VroomNativePose(
        latitude: start.latitude + (target.latitude - start.latitude) * t,
        longitude: start.longitude + (target.longitude - start.longitude) * t,
        heading: Self.lerpHeading(start.heading, target.heading, t),
        arcM: target.arcM
      )
    } else {
      pose = target
    }
    lastPose = pose
    if sample.pathMode == "onRoad", let arc = pose.arcM { lastAcceptedArcM = max(lastAcceptedArcM ?? arc, arc) }
    VroomNativeNavigationState.shared.store(pose: pose)
    return pose
  }

  private func projectedPose(at monotonic: CFTimeInterval) -> VroomNativePose? {
    guard let sample else { return nil }
    let sinceReceipt = max(0, monotonic - receivedMonotonic)
    let coastHorizon = max(1.5, min(5, sample.gpsIntervalMs / 1000 * 1.25))
    let totalSec = lastFixAgeMs > 10_000 ? 0 : min(coastHorizon, ageAtReceiptSec + sinceReceipt)
    let predictionM = min(60, sample.speedMs * totalSec)
    lastPredictionM = predictionM

    let rawProjected = Self.project(
      latitude: sample.rawLatitude,
      longitude: sample.rawLongitude,
      heading: sample.heading,
      distanceM: predictionM
    )
    if sample.pathMode == "onRoad",
       let targetArcM = sample.targetArcM,
       let window = sample.arcWindow,
       let roadPoint = window.point(atAbsoluteArcM: targetArcM + predictionM) {
      let blend = sample.roadBlend
      let heading = window.heading(atAbsoluteArcM: targetArcM + predictionM) ?? sample.heading
      return VroomNativePose(
        latitude: rawProjected.latitude + (roadPoint.latitude - rawProjected.latitude) * blend,
        longitude: rawProjected.longitude + (roadPoint.longitude - rawProjected.longitude) * blend,
        heading: heading,
        arcM: targetArcM + predictionM
      )
    }
    return VroomNativePose(
      latitude: rawProjected.latitude,
      longitude: rawProjected.longitude,
      heading: sample.heading,
      arcM: nil
    )
  }

  private static func project(latitude: Double, longitude: Double, heading: Double, distanceM: Double) -> CLLocationCoordinate2D {
    guard distanceM > 0 else { return CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
    let radius = 6_371_000.0
    let angular = distanceM / radius
    let bearing = heading * .pi / 180
    let lat1 = latitude * .pi / 180
    let lng1 = longitude * .pi / 180
    let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearing))
    let lng2 = lng1 + atan2(sin(bearing) * sin(angular) * cos(lat1), cos(angular) - sin(lat1) * sin(lat2))
    return CLLocationCoordinate2D(latitude: lat2 * 180 / .pi, longitude: lng2 * 180 / .pi)
  }

  static func bearing(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> Double {
    let lat1 = from.latitude * .pi / 180
    let lat2 = to.latitude * .pi / 180
    let dLng = (to.longitude - from.longitude) * .pi / 180
    let y = sin(dLng) * cos(lat2)
    let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
    return normalizeHeading(atan2(y, x) * 180 / .pi)
  }

  static func distanceM(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
    CLLocation(latitude: lat1, longitude: lng1).distance(from: CLLocation(latitude: lat2, longitude: lng2))
  }

  static func normalizeHeading(_ value: Double) -> Double {
    (value.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
  }

  static func lerpHeading(_ from: Double, _ to: Double, _ t: Double) -> Double {
    let diff = ((to - from + 540).truncatingRemainder(dividingBy: 360)) - 180
    return normalizeHeading(from + diff * t)
  }

  private static func smoothstep(_ t: Double) -> Double { t * t * (3 - 2 * t) }
}
