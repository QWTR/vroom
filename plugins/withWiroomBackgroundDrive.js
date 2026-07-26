const { createRunOncePlugin, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
const fs = require('fs');
const path = require('path');

const LEGACY_SWIFT_MODULE = `import CoreLocation
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
  private let diagnosticsKey = "wiroom_background_drive_diagnostics"
  private let keychainService = "com.lexuuw.vroom.background-drive"
  private let keychainAccount = "checkpoint-auth-token"
  private let maxBufferedFixes = 240
  private let maxRoutePoints = 1500
  private let maxSpeedSamples = 400
  private let maxAccuracyM = 120.0
  private let minSegmentKm = 0.002
  private let maxSegmentKm = 12.0
  private let maxFixGapMs = 420_000.0
  private let minSpeedKmh = 2.0
  private let checkpointKm = 0.2
  private let checkpointForceMinKm = 0.05
  private let checkpointForceMs = 30_000.0
  private let idleStopMs = 10 * 60_000.0
  private var mode = "freeDrive"
  private var tripSessionId = ""
  private var hasListenersFlag = false
  private var checkpointInFlight = false
  private var idleSinceMs = 0.0
  private var retryAttempt = 0
  private var retryWorkItem: DispatchWorkItem?
  private var lastFixTimestampMs = 0.0

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
    return ["VROOM_BG_TRACKING_END", "VROOM_BG_TRACKING_STATE", "VROOM_BG_LOCATION"]
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
    retryWorkItem?.cancel()
    retryAttempt = 0
    manager.requestAlwaysAuthorization()
    persistState(active: true, endedBy: nil, lastFix: currentState()["lastFix"] as? [String: Any])
    appendDiagnostic(state: "starting", reason: "start", errorCode: nil, recoverable: true)
    emitRuntimeState(state: "starting", reason: "start", errorCode: nil, recoverable: true)
    manager.startUpdatingLocation()
    maybeFlushNativeCheckpoint(stats: currentStats(), force: false)
    resolve(true)
  }

  @objc(stopDriveTracking:resolver:rejecter:)
  func stopDriveTracking(_ reason: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    maybeFlushNativeCheckpoint(stats: currentStats(), force: true)
    retryWorkItem?.cancel()
    retryAttempt = 0
    manager.stopUpdatingLocation()
    persistState(active: false, endedBy: reason, lastFix: currentState()["lastFix"] as? [String: Any])
    // Keep the Keychain token until the final activity is acknowledged. A
    // forced checkpoint can fail while offline and must remain retryable after
    // the user opens the app again.
    appendDiagnostic(state: "inactive", reason: reason, errorCode: nil, recoverable: false)
    if ["notification", "manual", "user"].contains(reason) && hasListenersFlag {
      sendEvent(withName: "VROOM_BG_TRACKING_END", body: ["reason": reason])
    }
    resolve(true)
  }

  @objc(getState:rejecter:)
  func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(currentState())
  }

  @objc(getDiagnostics:rejecter:)
  func getDiagnostics(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(defaults.array(forKey: diagnosticsKey) ?? [])
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
    retryWorkItem?.cancel()
    retryAttempt = 0
    for location in locations {
      let fix = encode(location)
      lastFixTimestampMs = location.timestamp.timeIntervalSince1970 * 1000
      append(fix: fix)
      let stateFix = isReliable(location) ? fix : currentState()["lastFix"] as? [String: Any]
      persistState(active: true, endedBy: nil, lastFix: stateFix)
      accumulateNativeStats(location)
      if observeIdle(location) {
        maybeFlushNativeCheckpoint(stats: currentStats(), force: true)
        manager.stopUpdatingLocation()
        persistState(active: false, endedBy: "idle", lastFix: stateFix)
        appendDiagnostic(state: "idle", reason: "idle", errorCode: nil, recoverable: true)
        emitRuntimeState(state: "idle", reason: "idle", errorCode: nil, recoverable: true)
        continue
      }
      if hasListenersFlag {
        sendEvent(withName: "VROOM_BG_LOCATION", body: fix)
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let code = (error as? CLError)?.code
    let codeValue = code?.rawValue
    let reason = code == .locationUnknown ? "locationUnknown" : "system"
    persistState(active: true, endedBy: nil, lastFix: currentState()["lastFix"] as? [String: Any])
    appendDiagnostic(state: "recovering", reason: reason, errorCode: codeValue, recoverable: true)
    emitRuntimeState(state: "recovering", reason: reason, errorCode: codeValue, recoverable: true)
    scheduleLocationRetry(errorCode: codeValue)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    if status == .denied || status == .restricted {
      manager.stopUpdatingLocation()
      persistState(active: false, endedBy: "permission", lastFix: currentState()["lastFix"] as? [String: Any])
      appendDiagnostic(state: "blockedPermission", reason: "permission", errorCode: nil, recoverable: false)
      emitRuntimeState(state: "blockedPermission", reason: "permission", errorCode: nil, recoverable: false)
    } else {
      appendDiagnostic(state: "active", reason: "authorization", errorCode: nil, recoverable: true)
      emitRuntimeState(state: "active", reason: "authorization", errorCode: nil, recoverable: true)
    }
  }

  private func scheduleLocationRetry(errorCode: Int?) {
    retryWorkItem?.cancel()
    retryAttempt = min(retryAttempt + 1, 5)
    let delays = [1.0, 2.0, 4.0, 8.0, 15.0]
    let delay = delays[max(0, retryAttempt - 1)]
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.manager.startUpdatingLocation()
      self.appendDiagnostic(state: "recovering", reason: "retry", errorCode: errorCode, recoverable: true)
      self.emitRuntimeState(state: "recovering", reason: "retry", errorCode: errorCode, recoverable: true)
    }
    retryWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func emitRuntimeState(state: String, reason: String, errorCode: Int?, recoverable: Bool) {
    guard hasListenersFlag else { return }
    var body: [String: Any] = [
      "state": state,
      "reason": reason,
      "recoverable": recoverable,
      "authorizationStatus": authorizationStatusName(),
      "timestampMs": Date().timeIntervalSince1970 * 1000,
      "lastFixTimestampMs": lastFixTimestampMs,
      "lastFixAgeMs": lastFixTimestampMs > 0 ? max(0, Date().timeIntervalSince1970 * 1000 - lastFixTimestampMs) : 0,
      "retryAttempt": retryAttempt,
    ]
    if let errorCode { body["errorCode"] = errorCode }
    sendEvent(withName: "VROOM_BG_TRACKING_STATE", body: body)
  }

  private func appendDiagnostic(state: String, reason: String, errorCode: Int?, recoverable: Bool) {
    var item: [String: Any] = [
      "state": state,
      "reason": reason,
      "recoverable": recoverable,
      "authorizationStatus": authorizationStatusName(),
      "timestampMs": Date().timeIntervalSince1970 * 1000,
      "lastFixTimestampMs": lastFixTimestampMs,
      "retryAttempt": retryAttempt,
    ]
    if let errorCode { item["errorCode"] = errorCode }
    var diagnostics = defaults.array(forKey: diagnosticsKey) as? [[String: Any]] ?? []
    diagnostics.append(item)
    defaults.set(Array(diagnostics.suffix(200)), forKey: diagnosticsKey)
  }

  private func authorizationStatusName() -> String {
    switch manager.authorizationStatus {
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "whenInUse"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
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
    #if DEBUG
    let bypassStrictFilters = true
    #else
    let bypassStrictFilters = false
    #endif
    let accuracyLimit = bypassStrictFilters ? 200.0 : maxAccuracyM
    let minSpeed = bypassStrictFilters ? 0.0 : minSpeedKmh
    let maxSegment = bypassStrictFilters ? 25.0 : maxSegmentKm
    let accurateEnough =
      bypassStrictFilters ||
      ((!currentAccuracy.isFinite || currentAccuracy <= accuracyLimit) &&
      (!previousAccuracy.isFinite || previousAccuracy <= accuracyLimit))

    var acceptedMovement = false
    if hasPrevious && accurateEnough {
      let elapsedMs = nowMs - previousTime
      let segmentKm = haversineKm(previousLat, previousLng, location.coordinate.latitude, location.coordinate.longitude)
      let speedOk = speedKmh == nil || speedKmh! >= minSpeed
      if elapsedMs > 0 && elapsedMs <= maxFixGapMs && segmentKm >= minSegmentKm && speedOk {
        if segmentKm <= maxSegment {
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
        } else {
          // Batched / mock jump — anchor next segment at this fix without bridging.
          stats["tripSessionId"] = tripSessionId
          persistStats(stats)
          defaults.set(currentFix, forKey: statsLastFixKey)
          maybeFlushNativeCheckpoint(stats: stats, force: false)
          return
        }
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

const LEGACY_OBJC_BRIDGE = `#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WiroomLocationService, RCTEventEmitter)
RCT_EXTERN_METHOD(startDriveTracking:(NSString *)mode tripSessionId:(NSString *)tripSessionId apiUrl:(NSString *)apiUrl authToken:(NSString *)authToken resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopDriveTracking:(NSString *)reason resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getState:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getDiagnostics:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeBufferedLocations:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getNativeStats:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeNativeStats:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;

// Canonical native sources are read directly so Expo prebuild and the checked-in
// iOS implementation can never drift apart.
const SWIFT_MODULE = fs.readFileSync(
  path.join(__dirname, '..', 'native', 'background-drive', 'ios', 'WiroomLocationService.swift'),
  'utf8',
);
const OBJC_BRIDGE = fs.readFileSync(
  path.join(__dirname, '..', 'native', 'background-drive', 'ios', 'WiroomLocationServiceBridge.m'),
  'utf8',
);

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
    cfg.modResults.NSLocationAlwaysUsageDescription =
      cfg.modResults.NSLocationAlwaysUsageDescription
      || cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription;
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

const plugin = createRunOncePlugin(withWiroomBackgroundDrive, 'with-wiroom-background-drive', '1.2.0');

// Exposed for contract tests; Expo still receives the function itself.
plugin.__internal = { SWIFT_MODULE, OBJC_BRIDGE, resolveIosProjectName };

module.exports = plugin;
