import Foundation
import React

@objc(UsersModule)
class UsersModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(setNavigatingForAuto:)
  func setNavigatingForAuto(_ isNavigating: Bool) {
    let payload = [
      "isNavigating": isNavigating,
      "currentStepIndex": 0,
      "nextInstruction": "",
      "maneuver": "navigation"
    ] as [String : Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      VroomCarPlayNavStore.shared.save(dtoJson: json)
    }
  }

  @objc(saveMyLocationForAuto:lng:)
  func saveMyLocationForAuto(_ lat: NSNumber, lng: NSNumber) {
    _ = lat
    _ = lng
  }

  @objc(saveSpeedHeadingForAuto:heading:)
  func saveSpeedHeadingForAuto(_ speed: NSNumber, heading: NSNumber) {
    _ = speed
    _ = heading
  }

  @objc(saveNavStepForAuto:stepDistance:etaText:)
  func saveNavStepForAuto(_ stepText: String, stepDistance: String, etaText: String) {
    let payload = [
      "isNavigating": true,
      "currentStepIndex": 0,
      "nextInstruction": stepText,
      "maneuver": "navigation",
      "remainingDistanceMeters": Int(stepDistance.replacingOccurrences(of: "[^0-9]", with: "", options: .regularExpression)) ?? 0
    ] as [String : Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      VroomCarPlayNavStore.shared.save(dtoJson: json)
    }
    _ = etaText
  }

  @objc(saveRouteForAuto:)
  func saveRouteForAuto(_ routeJson: String) {
    _ = routeJson
  }

  @objc(saveDestinationForAuto:lng:name:)
  func saveDestinationForAuto(_ lat: NSNumber, lng: NSNumber, name: String) {
    let payload = [
      "isNavigating": true,
      "currentStepIndex": 0,
      "nextInstruction": "",
      "maneuver": "navigation",
      "destinationName": name
    ] as [String : Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      VroomCarPlayNavStore.shared.save(dtoJson: json)
    }
    _ = lat
    _ = lng
  }

  @objc(saveCarSafeNavStateForAuto:)
  func saveCarSafeNavStateForAuto(_ dtoJson: String) {
    VroomCarPlayNavStore.shared.save(dtoJson: dtoJson)
  }

  @objc(requestNavStopFromAuto)
  func requestNavStopFromAuto() {
    VroomCarPlayNavStore.shared.requestStop()
  }

  @objc(checkNavStopRequested:rejecter:)
  func checkNavStopRequested(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(VroomCarPlayNavStore.shared.consumeStopRequest())
    _ = reject
  }
}
