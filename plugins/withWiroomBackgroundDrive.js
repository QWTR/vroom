const { createRunOncePlugin, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');

const SWIFT_MODULE = `import CoreLocation
import Foundation
import React

@objc(WiroomLocationService)
class WiroomLocationService: RCTEventEmitter, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  private let stateKey = "wiroom_background_drive_state"
  private let bufferKey = "wiroom_background_drive_buffer"
  private var mode = "freeDrive"
  private var hasListenersFlag = false

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 2
    manager.activityType = .automotiveNavigation
    manager.pausesLocationUpdatesAutomatically = false
    manager.allowsBackgroundLocationUpdates = true
    if #available(iOS 11.0, *) {
      manager.showsBackgroundLocationIndicator = true
    }
  }

  override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func supportedEvents() -> [String]! {
    return ["VROOM_BG_TRACKING_END", "VROOM_BG_LOCATION"]
  }

  override func startObserving() {
    hasListenersFlag = true
  }

  override func stopObserving() {
    hasListenersFlag = false
  }

  @objc(startDriveTracking:resolver:rejecter:)
  func startDriveTracking(_ nextMode: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    mode = nextMode == "navigation" ? "navigation" : "freeDrive"
    manager.requestAlwaysAuthorization()
    persistState(active: true, endedBy: nil, lastFix: currentState()["lastFix"] as? [String: Any])
    manager.startUpdatingLocation()
    resolve(true)
  }

  @objc(stopDriveTracking:resolver:rejecter:)
  func stopDriveTracking(_ reason: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    manager.stopUpdatingLocation()
    persistState(active: false, endedBy: reason, lastFix: currentState()["lastFix"] as? [String: Any])
    if reason != "app" && hasListenersFlag {
      sendEvent(withName: "VROOM_BG_TRACKING_END", body: ["reason": reason])
    }
    resolve(true)
  }

  @objc(getState:rejecter:)
  func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(currentState())
  }

  @objc(consumeBufferedLocations:rejecter:)
  func consumeBufferedLocations(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let buffer = currentBuffer()
    defaults.removeObject(forKey: bufferKey)
    resolve(buffer)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations {
      let fix = encode(location)
      append(fix: fix)
      persistState(active: true, endedBy: nil, lastFix: fix)
      if hasListenersFlag {
        sendEvent(withName: "VROOM_BG_LOCATION", body: fix)
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    persistState(active: false, endedBy: "system", lastFix: currentState()["lastFix"] as? [String: Any])
    if hasListenersFlag {
      sendEvent(withName: "VROOM_BG_TRACKING_END", body: ["reason": "system"])
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    if status == .denied || status == .restricted {
      manager.stopUpdatingLocation()
      persistState(active: false, endedBy: "permission", lastFix: currentState()["lastFix"] as? [String: Any])
      if hasListenersFlag {
        sendEvent(withName: "VROOM_BG_TRACKING_END", body: ["reason": "permission"])
      }
    }
  }

  private func encode(_ location: CLLocation) -> [String: Any] {
    var fix: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
      "mode": mode
    ]
    if location.speed >= 0 {
      fix["speed"] = location.speed
    }
    if location.course >= 0 {
      fix["heading"] = location.course
    }
    if location.horizontalAccuracy >= 0 {
      fix["accuracy"] = location.horizontalAccuracy
    }
    return fix
  }

  private func persistState(active: Bool, endedBy: String?, lastFix: [String: Any]?) {
    var state = currentState()
    let now = Date().timeIntervalSince1970 * 1000
    state["active"] = active
    state["mode"] = mode
    if active {
      let wasActive = state["active"] as? Bool ?? false
      state["startedAt"] = wasActive ? (state["startedAt"] ?? now) : now
    } else {
      state["startedAt"] = state["startedAt"] ?? now
    }
    if let lastFix = lastFix {
      state["lastFix"] = lastFix
    } else {
      state.removeValue(forKey: "lastFix")
    }
    if let endedBy = endedBy {
      state["endedBy"] = endedBy
    } else {
      state.removeValue(forKey: "endedBy")
    }
    state["updatedAt"] = now
    defaults.set(state, forKey: stateKey)
  }

  private func currentState() -> [String: Any] {
    return defaults.dictionary(forKey: stateKey) ?? ["active": false]
  }

  private func currentBuffer() -> [[String: Any]] {
    return defaults.array(forKey: bufferKey) as? [[String: Any]] ?? []
  }

  private func append(fix: [String: Any]) {
    var buffer = currentBuffer()
    buffer.append(fix)
    if buffer.count > 240 {
      buffer = Array(buffer.suffix(240))
    }
    defaults.set(buffer, forKey: bufferKey)
  }
}
`;

const OBJC_BRIDGE = `#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WiroomLocationService, RCTEventEmitter)
RCT_EXTERN_METHOD(startDriveTracking:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopDriveTracking:(NSString *)reason resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getState:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeBufferedLocations:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;

const withWiroomBackgroundDrive = (config) => {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIBackgroundModes = Array.from(new Set([
      ...(cfg.modResults.UIBackgroundModes || []),
      'location',
    ]));
    cfg.modResults.NSLocationWhenInUseUsageDescription =
      cfg.modResults.NSLocationWhenInUseUsageDescription
      || 'Wiroom uses location for map, navigation and road alerts.';
    cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription =
      cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription
      || 'Wiroom uses location in the background during active navigation and free drive.';
    return cfg;
  });

  config = withXcodeProject(config, (cfg) => {
    const projectName = cfg.modRequest.projectName || getProjectName(cfg.modRequest.projectRoot);
    cfg.modResults = createBuildSourceFile({
      project: cfg.modResults,
      nativeProjectRoot: cfg.modRequest.platformProjectRoot,
      filePath: `${projectName}/WiroomLocationService.swift`,
      fileContents: SWIFT_MODULE,
      overwrite: true,
    });
    cfg.modResults = createBuildSourceFile({
      project: cfg.modResults,
      nativeProjectRoot: cfg.modRequest.platformProjectRoot,
      filePath: `${projectName}/WiroomLocationServiceBridge.m`,
      fileContents: OBJC_BRIDGE,
      overwrite: true,
    });
    cfg.modResults.addBuildProperty('SWIFT_VERSION', '5.0');
    return cfg;
  });

  return config;
};

module.exports = createRunOncePlugin(withWiroomBackgroundDrive, 'with-wiroom-background-drive', '1.0.0');
