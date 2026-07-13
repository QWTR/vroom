const { createRunOncePlugin, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');

const SWIFT_MODULE = `import CoreLocation
import Foundation
import React
import Security

@objc(WiroomLocationService)
class WiroomLocationService: RCTEventEmitter, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  private let stateKey = "wiroom_background_drive_state"
  private let bufferKey = "wiroom_background_drive_buffer"
  private let statsKey = "wiroom_background_drive_native_stats"
  private let statsLastFixKey = "wiroom_background_drive_native_stats_last_fix"
  private let checkpointKmKey = "wiroom_background_drive_last_server_checkpoint_km"
  private let apiUrlKey = "wiroom_background_drive_checkpoint_api_url"
  private let keychainService = "com.lexuuw.vroom.background-drive"
  private let keychainAccount = "checkpoint-auth-token"
  private let maxBufferedFixes = 240
  private let maxRoutePoints = 1500
  private let maxSpeedSamples = 400
  private let maxAccuracyM = 65.0
  private let minSegmentKm = 0.003
  private let maxSegmentKm = 2.0
  private let maxFixGapMs = 420_000.0
  private let minSpeedKmh = 3.0
  private let checkpointKm = 0.2
  private let checkpointForceMinKm = 0.05
  private let checkpointForceMs = 30_000.0
  private let idleStopMs = 10 * 60_000.0
  private var mode = "freeDrive"
  private var tripSessionId = ""
  private var hasListenersFlag = false
  private var checkpointInFlight = false
  private var idleSinceMs = 0.0

  override init() {
    super.init()
    let state = currentState()
    mode = state["mode"] as? String == "navigation" ? "navigation" : "freeDrive"
    tripSessionId = state["tripSessionId"] as? String ?? ""
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

  @objc(startDriveTracking:tripSessionId:apiUrl:authToken:resolver:rejecter:)
  func startDriveTracking(
    _ nextMode: String,
    tripSessionId nextSessionId: String,
    apiUrl: String,
    authToken: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let previousSessionId = currentState()["tripSessionId"] as? String ?? ""
    mode = nextMode == "navigation" ? "navigation" : "freeDrive"
    tripSessionId = nextSessionId

    if !nextSessionId.isEmpty && previousSessionId != nextSessionId {
      defaults.removeObject(forKey: statsKey)
      defaults.removeObject(forKey: statsLastFixKey)
      defaults.removeObject(forKey: checkpointKmKey)
    }
    if !apiUrl.isEmpty {
      defaults.set(apiUrl, forKey: apiUrlKey)
    }
    saveAuthToken(authToken)
    manager.requestAlwaysAuthorization()
    persistState(active: true, endedBy: nil, lastFix: currentState()["lastFix"] as? [String: Any])
    manager.startUpdatingLocation()
    maybeFlushNativeCheckpoint(stats: currentStats(), force: false)
    resolve(true)
  }

  @objc(stopDriveTracking:resolver:rejecter:)
  func stopDriveTracking(_ reason: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    maybeFlushNativeCheckpoint(stats: currentStats(), force: true)
    manager.stopUpdatingLocation()
    persistState(active: false, endedBy: reason, lastFix: currentState()["lastFix"] as? [String: Any])
    // Keep the Keychain token until the final activity is acknowledged. A
    // forced checkpoint can fail while offline and must remain retryable after
    // the user opens the app again.
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

  @objc(getNativeStats:rejecter:)
  func getNativeStats(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let stats = currentStats()
    // Reading a durable session after returning online is a retry opportunity
    // even when the vehicle is already stationary and emits no fresh fixes.
    maybeFlushNativeCheckpoint(stats: stats, force: false)
    resolve(stats)
  }

  @objc(consumeNativeStats:rejecter:)
  func consumeNativeStats(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let stats = currentStats()
    defaults.removeObject(forKey: statsKey)
    defaults.removeObject(forKey: statsLastFixKey)
    defaults.removeObject(forKey: checkpointKmKey)
    defaults.removeObject(forKey: apiUrlKey)
    clearAuthToken()
    resolve(stats)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations {
      let fix = encode(location)
      append(fix: fix)
      let stateFix = isReliable(location) ? fix : currentState()["lastFix"] as? [String: Any]
      persistState(active: true, endedBy: nil, lastFix: stateFix)
      accumulateNativeStats(location)
      if observeIdle(location) {
        maybeFlushNativeCheckpoint(stats: currentStats(), force: true)
        manager.stopUpdatingLocation()
        persistState(active: false, endedBy: "idle", lastFix: stateFix)
        continue
      }
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
      clearAuthToken()
      if hasListenersFlag {
        sendEvent(withName: "VROOM_BG_TRACKING_END", body: ["reason": "permission"])
      }
    }
  }

  private func accumulateNativeStats(_ location: CLLocation) {
    var stats = currentStats()
    let nowMs = location.timestamp.timeIntervalSince1970 * 1000
    let currentFix = statsFix(from: location)
    let previousFix = defaults.dictionary(forKey: statsLastFixKey) ?? [:]
    let previousLat = number(previousFix["latitude"])
    let previousLng = number(previousFix["longitude"])
    let previousTime = number(previousFix["time"])
    let previousAccuracy = number(previousFix["accuracy"])
    let currentAccuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : Double.nan
    let speedKmh = location.speed >= 0 ? location.speed * 3.6 : nil
    let hasPrevious = previousTime > 0 && previousLat.isFinite && previousLng.isFinite
    let accurateEnough =
      (!currentAccuracy.isFinite || currentAccuracy <= maxAccuracyM) &&
      (!previousAccuracy.isFinite || previousAccuracy <= maxAccuracyM)

    var acceptedMovement = false
    if hasPrevious && accurateEnough {
      let elapsedMs = nowMs - previousTime
      let segmentKm = haversineKm(previousLat, previousLng, location.coordinate.latitude, location.coordinate.longitude)
      let speedOk = speedKmh == nil || speedKmh! >= minSpeedKmh
      if elapsedMs > 0 && elapsedMs <= maxFixGapMs &&
        segmentKm >= minSegmentKm && segmentKm <= maxSegmentKm && speedOk {
        acceptedMovement = true
        stats["distanceKm"] = number(stats["distanceKm"]) + segmentKm
        var route = stats["routePoints"] as? [[String: Any]] ?? []
        if route.isEmpty {
          route.append(["latitude": previousLat, "longitude": previousLng])
        }
        route.append(["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude])
        if route.count > maxRoutePoints {
          route = Array(route.suffix(maxRoutePoints))
        }
        stats["routePoints"] = route
      }
    }

    if acceptedMovement, let speedKmh, speedKmh >= 1 {
      var samples = stats["speedSamples"] as? [Double] ?? []
      samples.append(speedKmh)
      if samples.count > maxSpeedSamples {
        samples = Array(samples.suffix(maxSpeedSamples))
      }
      stats["speedSamples"] = samples
      stats["maxSpeedKmh"] = max(number(stats["maxSpeedKmh"]), speedKmh)
    }

    stats["tripSessionId"] = tripSessionId
    persistStats(stats)
    defaults.set(currentFix, forKey: statsLastFixKey)
    maybeFlushNativeCheckpoint(stats: stats, force: false)
  }

  private func maybeFlushNativeCheckpoint(stats: [String: Any], force: Bool) {
    guard !checkpointInFlight else { return }
    let distance = number(stats["distanceKm"])
    guard distance >= checkpointForceMinKm else { return }
    let lastServerCheckpoint = number(stats["lastServerCheckpointKm"])
    let lastAttempt = number(stats["lastCheckpointAttemptAt"])
    let nowMs = Date().timeIntervalSince1970 * 1000
    let dueByDistance = distance - lastServerCheckpoint >= checkpointKm
    let dueByForce = distance - lastServerCheckpoint >= checkpointForceMinKm && nowMs - lastAttempt >= checkpointForceMs
    guard force || dueByDistance || dueByForce else { return }
    guard !tripSessionId.isEmpty, checkpointEndpoint() != nil, readAuthToken() != nil else { return }

    var snapshot = stats
    snapshot["lastCheckpointAttemptAt"] = nowMs
    snapshot["tripSessionId"] = tripSessionId
    persistStats(snapshot)
    checkpointInFlight = true
    postNativeCheckpoint(snapshot)
  }

  private func postNativeCheckpoint(_ stats: [String: Any]) {
    guard let endpoint = checkpointEndpoint(),
      let token = readAuthToken(),
      let sessionId = stats["tripSessionId"] as? String,
      !sessionId.isEmpty else {
      checkpointInFlight = false
      return
    }

    let samples = stats["speedSamples"] as? [Double] ?? []
    let payload: [String: Any] = [
      "tripSessionId": sessionId,
      "distanceTotal": roundKm(number(stats["distanceKm"])),
      "maxSpeed": roundSpeed(number(stats["maxSpeedKmh"])),
      "avgSpeed": roundSpeed(averageSpeed(samples)),
      "source": mode == "navigation" ? "navigation" : "driving",
      "visibleInHistory": false,
    ]
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
      checkpointInFlight = false
      return
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 5
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.httpBody = body

    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      DispatchQueue.main.async {
        self.checkpointInFlight = false
        guard error == nil,
          let http = response as? HTTPURLResponse,
          (200...299).contains(http.statusCode) else { return }
        let decoded = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
        let acknowledgedKm = self.number(decoded?["checkpointDistanceKm"])
        let checkpointKm = acknowledgedKm.isFinite && acknowledgedKm > 0
          ? acknowledgedKm
          : self.number(stats["distanceKm"])
        var latest = self.currentStats()
        latest["lastServerCheckpointKm"] = max(self.number(latest["lastServerCheckpointKm"]), checkpointKm)
        latest["lastCheckpointAttemptAt"] = Date().timeIntervalSince1970 * 1000
        latest["tripSessionId"] = sessionId
        self.persistStats(latest)
        self.defaults.set(checkpointKm, forKey: self.checkpointKmKey)
      }
    }.resume()
  }

  private func currentStats() -> [String: Any] {
    var stats = defaults.dictionary(forKey: statsKey) ?? [:]
    let storedCheckpointKm = defaults.double(forKey: checkpointKmKey)
    if stats["distanceKm"] == nil { stats["distanceKm"] = storedCheckpointKm }
    if stats["routePoints"] == nil { stats["routePoints"] = [[String: Any]]() }
    if stats["speedSamples"] == nil { stats["speedSamples"] = [Double]() }
    if stats["maxSpeedKmh"] == nil { stats["maxSpeedKmh"] = 0.0 }
    if stats["lastServerCheckpointKm"] == nil { stats["lastServerCheckpointKm"] = storedCheckpointKm }
    if stats["lastCheckpointAttemptAt"] == nil { stats["lastCheckpointAttemptAt"] = 0.0 }
    if stats["tripSessionId"] == nil || (stats["tripSessionId"] as? String ?? "").isEmpty {
      stats["tripSessionId"] = tripSessionId
    }
    return stats
  }

  private func persistStats(_ stats: [String: Any]) {
    defaults.set(stats, forKey: statsKey)
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
    if buffer.count > maxBufferedFixes {
      buffer = Array(buffer.suffix(maxBufferedFixes))
    }
    defaults.set(buffer, forKey: bufferKey)
  }

  private func persistState(active: Bool, endedBy: String?, lastFix: [String: Any]?) {
    var state = currentState()
    let wasActive = state["active"] as? Bool ?? false
    let nowMs = Date().timeIntervalSince1970 * 1000
    state["active"] = active
    state["mode"] = mode
    state["tripSessionId"] = tripSessionId
    state["startedAt"] = active && !wasActive ? nowMs : (state["startedAt"] ?? nowMs)
    if let lastFix {
      state["lastFix"] = lastFix
    } else {
      state.removeValue(forKey: "lastFix")
    }
    if let endedBy {
      state["endedBy"] = endedBy
    } else {
      state.removeValue(forKey: "endedBy")
    }
    state["updatedAt"] = nowMs
    defaults.set(state, forKey: stateKey)
  }

  private func checkpointEndpoint() -> URL? {
    guard let raw = defaults.string(forKey: apiUrlKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !raw.isEmpty else { return nil }
    return URL(string: raw.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/activity/session/checkpoint")
  }

  private func saveAuthToken(_ token: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
    ]
    guard !token.isEmpty else {
      SecItemDelete(query as CFDictionary)
      return
    }
    let data = Data(token.utf8)
    let update = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = query
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(add as CFDictionary, nil)
    }
  }

  private func readAuthToken() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data,
      let token = String(data: data, encoding: .utf8),
      !token.isEmpty else { return nil }
    return token
  }

  private func clearAuthToken() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
    ]
    SecItemDelete(query as CFDictionary)
  }

  private func encode(_ location: CLLocation) -> [String: Any] {
    var fix: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
      "mode": mode,
      "source": "live",
      "receivedAt": Date().timeIntervalSince1970 * 1000,
      "isSeed": false,
    ]
    if location.speed >= 0 { fix["speed"] = location.speed }
    if location.course >= 0 { fix["heading"] = location.course }
    if location.horizontalAccuracy >= 0 { fix["accuracy"] = location.horizontalAccuracy }
    return fix
  }

  private func statsFix(from location: CLLocation) -> [String: Any] {
    var fix: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "time": location.timestamp.timeIntervalSince1970 * 1000,
    ]
    if location.horizontalAccuracy >= 0 {
      fix["accuracy"] = location.horizontalAccuracy
    }
    return fix
  }

  private func isReliable(_ location: CLLocation) -> Bool {
    return location.horizontalAccuracy < 0 || location.horizontalAccuracy <= maxAccuracyM
  }

  private func observeIdle(_ location: CLLocation) -> Bool {
    let reliable = isReliable(location)
    let stopped = reliable && location.speed >= 0 && location.speed * 3.6 < 3
    if !stopped {
      idleSinceMs = 0
      return false
    }
    let nowMs = location.timestamp.timeIntervalSince1970 * 1000
    if idleSinceMs == 0 {
      idleSinceMs = nowMs
      return false
    }
    return nowMs - idleSinceMs >= idleStopMs
  }

  private func number(_ value: Any?) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    if let string = value as? String, let number = Double(string) { return number }
    return Double.nan
  }

  private func averageSpeed(_ samples: [Double]) -> Double {
    let valid = samples.filter { $0.isFinite && $0 >= 1 }
    guard !valid.isEmpty else { return 0 }
    return valid.reduce(0, +) / Double(valid.count)
  }

  private func roundKm(_ value: Double) -> Double {
    return (value * 1000).rounded() / 1000
  }

  private func roundSpeed(_ value: Double) -> Double {
    return (value * 10).rounded() / 10
  }

  private func haversineKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let earthKm = 6371.0
    let dLat = (lat2 - lat1) * Double.pi / 180
    let dLon = (lon2 - lon1) * Double.pi / 180
    let a = sin(dLat / 2) * sin(dLat / 2) +
      cos(lat1 * Double.pi / 180) * cos(lat2 * Double.pi / 180) *
      sin(dLon / 2) * sin(dLon / 2)
    return earthKm * 2 * atan2(sqrt(a), sqrt(1 - a))
  }
}
`;

const OBJC_BRIDGE = `#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WiroomLocationService, RCTEventEmitter)
RCT_EXTERN_METHOD(startDriveTracking:(NSString *)mode tripSessionId:(NSString *)tripSessionId apiUrl:(NSString *)apiUrl authToken:(NSString *)authToken resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopDriveTracking:(NSString *)reason resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getState:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeBufferedLocations:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getNativeStats:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeNativeStats:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;

const resolveIosProjectName = (cfg) =>
  cfg.modRequest.projectName
  || getHackyProjectName(cfg.modRequest.platformProjectRoot, cfg);

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
    // Fresh EAS prebuilds do not have AppDelegate yet. getHackyProjectName
    // safely falls back to the sanitized Expo app name until Xcode exists.
    const projectName = resolveIosProjectName(cfg);
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

const plugin = createRunOncePlugin(withWiroomBackgroundDrive, 'with-wiroom-background-drive', '1.0.1');

// Exposed for contract tests; Expo still receives the function itself.
plugin.__internal = { SWIFT_MODULE, OBJC_BRIDGE, resolveIosProjectName };

module.exports = plugin;
