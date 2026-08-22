import Foundation

enum VroomCarPlayPerformanceProfile: String {
  case standard
  case battery
  case smooth

  static let storageKey = "vroom.performance.profile.v1"

  static func normalized(_ raw: String?) -> Self {
    Self(rawValue: raw ?? "") ?? .standard
  }

  static func stored(defaults: UserDefaults = .standard) -> Self {
    normalized(defaults.string(forKey: storageKey))
  }
}

enum VroomCarPlayMotionPolicy {
  static func preferredFramesPerSecond(
    profile: VroomCarPlayPerformanceProfile,
    speedMetersPerSecond: Double,
    stationaryFor: TimeInterval
  ) -> Int {
    let speedKmh = max(0, speedMetersPerSecond) * 3.6

    switch profile {
    case .battery:
      return speedKmh < 1 && stationaryFor >= 3 ? 15 : 30
    case .smooth:
      return speedKmh < 1 && stationaryFor >= 10 ? 30 : 60
    case .standard:
      if speedKmh < 1 && stationaryFor >= 5 { return 15 }
      return speedKmh > 10 ? 60 : 30
    }
  }
}
