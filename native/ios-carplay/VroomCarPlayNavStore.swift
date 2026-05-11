import Foundation
import CoreLocation

struct VroomCarSafeNavState: Codable {
  let isNavigating: Bool
  let currentStepIndex: Int
  let nextInstruction: String
  let turnDistanceMeters: Int?
  let remainingDistanceMeters: Int?
  let remainingDurationSec: Int?
  let etaEpochSec: Int?
  let maneuver: String
  let destinationName: String?
}

final class VroomCarPlayNavStore {
  static let shared = VroomCarPlayNavStore()
  private let defaults = UserDefaults.standard

  private enum Keys {
    static let dto = "vroom_car_safe_dto"
    static let stopRequested = "vroom_car_stop_requested"
  }

  private init() {}

  func save(dtoJson: String) {
    defaults.set(dtoJson, forKey: Keys.dto)
  }

  func readState() -> VroomCarSafeNavState? {
    guard let raw = defaults.string(forKey: Keys.dto),
          let data = raw.data(using: .utf8) else {
      return nil
    }
    return try? JSONDecoder().decode(VroomCarSafeNavState.self, from: data)
  }

  func requestStop() {
    defaults.set(true, forKey: Keys.stopRequested)
  }

  func consumeStopRequest() -> Bool {
    let requested = defaults.bool(forKey: Keys.stopRequested)
    if requested {
      defaults.set(false, forKey: Keys.stopRequested)
    }
    return requested
  }
}
