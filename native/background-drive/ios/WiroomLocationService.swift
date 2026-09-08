import CoreLocation
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
  private let maxBufferedFixes = 120
  private let maxRoutePoints = 5_000
  private let maxSpeedSamples = 240
  private let routePointSpacingKm = 0.008
  private let maxAccuracyM = 120.0
  private let minSegmentKm = 0.002
  private let maxSegmentKm = 12.0
  private let maxFixGapMs = 420_000.0
  private let maxPlausibleGapKmh = 220.0
  private let maxPlausibleGapKm = 60.0
  private let minSpeedKmh = 2.0
  private let movingConfirmKmh = 5.0
  private let stoppedConfirmKmh = 3.0
  private let stopConfirmMs = 5_000.0
  private let stationaryRouteHeartbeatMs = 30_000.0
  private let checkpointKm = 0.2
  private let checkpointForceMinKm = 0.05
  private let checkpointForceMs = 30_000.0
  private var mode = "freeDrive"
  private var tripSessionId = ""
  private var hasListenersFlag = false
  private var checkpointInFlight = false
  private var retryAttempt = 0
  private var retryWorkItem: DispatchWorkItem?
  private var lastFixTimestampMs = 0.0
  private var stationarySince: Date?

  override init() {
    super.init()
    let state = currentState()
    mode = state["mode"] as? String == "navigation" ? "navigation" : "freeDrive"
    tripSessionId = state["tripSessionId"] as? String ?? ""
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 2
    manager.activityType = .automotiveNavigation
    // An active drive must not be classified as idle just because the screen is
    // locked or the vehicle waits at lights. The service is explicitly stopped
    // at the trip boundary, so automatic Core Location pausing only creates gaps.
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
    var finalStats = statsSnapshot()
    finalStats["lastFixAt"] = Date().timeIntervalSince1970 * 1000
    persistStats(finalStats)
    maybeFlushNativeCheckpoint(stats: finalStats, force: true)
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
    let stats = statsSnapshot()
    // Reading a durable session after returning online is a retry opportunity
    // even when the vehicle is already stationary and emits no fresh fixes.
    maybeFlushNativeCheckpoint(stats: stats, force: false)
    resolve(stats)
  }

  @objc(getNativeProgress:rejecter:)
  func getNativeProgress(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let stats = statsSnapshot()
    maybeFlushNativeCheckpoint(stats: stats, force: false)
    resolve([
      "distanceKm": number(stats["distanceKm"]),
      "tripSessionId": stats["tripSessionId"] as? String ?? tripSessionId,
      "maxSpeedKmh": number(stats["maxSpeedKmh"]),
      "lastServerCheckpointKm": number(stats["lastServerCheckpointKm"]),
      "elapsedSec": number(stats["elapsedSec"]),
      "movingSec": number(stats["movingSec"]),
      "stoppedSec": number(stats["stoppedSec"]),
      "motionState": stats["motionState"] as? String ?? "unknown",
      "lastFixAt": number(stats["lastFixAt"]),
    ])
  }

  @objc(consumeNativeStats:rejecter:)
  func consumeNativeStats(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let stats = statsSnapshot()
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
      NotificationCenter.default.post(
        name: Notification.Name("VroomSharedLocationFix"),
        object: location
      )
      if location.speed >= 0.7 {
        stationarySince = nil
        manager.distanceFilter = 2
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
      } else if stationarySince == nil {
        stationarySince = Date()
      } else if let stationarySince,
        Date().timeIntervalSince(stationarySince) >= 15
      {
        manager.distanceFilter = 5
        manager.desiredAccuracy = kCLLocationAccuracyBest
      }
      let fix = encode(location)
      lastFixTimestampMs = location.timestamp.timeIntervalSince1970 * 1000
      append(fix: fix)
      let stateFix = isReliable(location) ? fix : currentState()["lastFix"] as? [String: Any]
      persistState(active: true, endedBy: nil, lastFix: stateFix)
      accumulateNativeStats(location)
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
    // CLLocation.speed is -1 when invalid; 0 while moving is common — treat <= 0 as unknown.
    let speedKmh = location.speed > 0 ? location.speed * 3.6 : nil
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

    let elapsedMs = hasPrevious ? nowMs - previousTime : 0
    let elapsedSec = max(0, elapsedMs / 1000)
    let segmentKmForMotion = hasPrevious
      ? haversineKm(previousLat, previousLng, location.coordinate.latitude, location.coordinate.longitude)
      : 0
    let derivedKmh = elapsedSec > 0 ? segmentKmForMotion * 3600 / elapsedSec : 0
    let accuracyEnvelopeKm = max(0.015,
      ((currentAccuracy.isFinite ? currentAccuracy : 0) + (previousAccuracy.isFinite ? previousAccuracy : 0)) * 1.2 / 1000)
    let previousMotion = stats["motionState"] as? String ?? "unknown"
    let movingEvidence = accurateEnough && (
      (speedKmh != nil && speedKmh! >= movingConfirmKmh)
      || (derivedKmh >= movingConfirmKmh && segmentKmForMotion > accuracyEnvelopeKm)
    )
    let stoppedEvidence = accurateEnough && segmentKmForMotion <= accuracyEnvelopeKm
      && (speedKmh == nil || speedKmh! < stoppedConfirmKmh)
    var motion = previousMotion
    var stationaryCandidateAt = number(stats["stationaryCandidateAt"])
    var stopStartedAt = 0.0
    if !hasPrevious && number(stats["movingSec"]) + number(stats["stoppedSec"]) <= 0 {
      stats["movingSec"] = max(0, nowMs - number(stats["startedAt"])) / 1000
    }
    if movingEvidence {
      if previousMotion == "stopped" && elapsedSec > 0 {
        stats["movingSec"] = number(stats["movingSec"]) + elapsedSec
      } else if stationaryCandidateAt > 0 {
        stats["movingSec"] = number(stats["movingSec"]) + max(0, nowMs - stationaryCandidateAt) / 1000
      } else if elapsedSec > 0 {
        stats["movingSec"] = number(stats["movingSec"]) + elapsedSec
      }
      stationaryCandidateAt = 0
      motion = "moving"
    } else if stoppedEvidence {
      if previousMotion == "stopped" {
        stats["stoppedSec"] = number(stats["stoppedSec"]) + elapsedSec
      } else {
        if stationaryCandidateAt <= 0 { stationaryCandidateAt = previousTime > 0 ? previousTime : nowMs }
        if nowMs - stationaryCandidateAt >= stopConfirmMs {
          stats["stoppedSec"] = number(stats["stoppedSec"]) + (nowMs - stationaryCandidateAt) / 1000
          stopStartedAt = stationaryCandidateAt
          motion = "stopped"
          stationaryCandidateAt = 0
        }
      }
    } else if elapsedSec > 0 {
      if previousMotion == "stopped" { stats["stoppedSec"] = number(stats["stoppedSec"]) + elapsedSec }
      else { stats["movingSec"] = number(stats["movingSec"]) + elapsedSec }
    }
    stats["stationaryCandidateAt"] = stationaryCandidateAt
    stats["motionState"] = motion
    stats["lastFixAt"] = nowMs
    stats["elapsedSec"] = max(0, (nowMs - number(stats["startedAt"])) / 1000)
    if elapsedSec > 10 {
      stats["gapCount"] = Int(number(stats["gapCount"])) + 1
      stats["maxGapSec"] = max(number(stats["maxGapSec"]), elapsedSec)
    }

    var acceptedMovement = false
    if hasPrevious && accurateEnough {
      let elapsedMs = nowMs - previousTime
      let segmentKm = haversineKm(previousLat, previousLng, location.coordinate.latitude, location.coordinate.longitude)
      let reportedSpeedOk = speedKmh.map { $0 >= minSpeed } ?? true
      let speedOk = !stoppedEvidence && (reportedSpeedOk || derivedKmh >= movingConfirmKmh)
      let longGapPlausible = elapsedMs > maxFixGapMs && derivedKmh >= movingConfirmKmh &&
        derivedKmh <= maxPlausibleGapKmh && segmentKm <= maxPlausibleGapKm && accurateEnough
      let segmentLimitOk = elapsedMs <= maxFixGapMs ? segmentKm <= maxSegment : longGapPlausible
      if elapsedMs > 0 && segmentKm >= minSegmentKm && speedOk && segmentLimitOk {
        if segmentKm <= maxSegment || longGapPlausible {
          acceptedMovement = true
          stats["acceptedFixes"] = Int(number(stats["acceptedFixes"])) + 1
          stats["distanceKm"] = number(stats["distanceKm"]) + segmentKm
          var route = stats["routePoints"] as? [[String: Any]] ?? []
          if route.isEmpty {
            route.append(routePoint(from: previousFix, source: "native", motionState: previousMotion, segmentStatus: elapsedSec > 10 ? "gap" : "accepted"))
          }
          let lastRoutePoint = route.last
          let lastRouteLat = number(lastRoutePoint?["latitude"])
          let lastRouteLng = number(lastRoutePoint?["longitude"])
          let routeMovedKm = lastRouteLat.isFinite && lastRouteLng.isFinite
            ? haversineKm(lastRouteLat, lastRouteLng, location.coordinate.latitude, location.coordinate.longitude)
            : Double.infinity
          if routeMovedKm >= routePointSpacingKm || previousMotion == "stopped" {
            route.append(routePoint(from: location, source: "native", motionState: motion, segmentStatus: elapsedSec > 10 ? "gap" : "accepted"))
          }
          if route.count > maxRoutePoints {
            var compacted = route.enumerated().compactMap { index, point in
              index.isMultiple(of: 2) ? point : nil
            }
            if let sourceLast = route.last {
              let compactedLast = compacted.last
              if number(compactedLast?["latitude"]) != number(sourceLast["latitude"])
                || number(compactedLast?["longitude"]) != number(sourceLast["longitude"]) {
                compacted.append(sourceLast)
              }
            }
            route = compacted
          }
          stats["routePoints"] = route
        } else {
          stats["rejectedFixes"] = Int(number(stats["rejectedFixes"])) + 1
          // Batched / mock jump — anchor next segment at this fix without bridging.
          stats["tripSessionId"] = tripSessionId
          persistStats(stats)
          defaults.set(currentFix, forKey: statsLastFixKey)
          maybeFlushNativeCheckpoint(stats: stats, force: false)
          return
        }
      }
    }

    if !acceptedMovement && motion == "stopped" {
      var route = stats["routePoints"] as? [[String: Any]] ?? []
      if previousMotion != "stopped" && stopStartedAt > 0 {
        var stopStart = routePoint(from: location, source: "native", motionState: "stopped", segmentStatus: "accepted")
        stopStart["recordedAt"] = stopStartedAt
        route.append(stopStart)
      }
      let lastRouteAt = number(route.last?["recordedAt"])
      if lastRouteAt <= 0 || nowMs - lastRouteAt >= stationaryRouteHeartbeatMs || previousMotion != "stopped" {
        route.append(routePoint(from: location, source: "native", motionState: "stopped", segmentStatus: "accepted"))
      }
      if route.count > maxRoutePoints { route = Array(route.suffix(maxRoutePoints)) }
      stats["routePoints"] = route
    } else if !acceptedMovement && previousMotion == "stopped" && motion == "moving" {
      var route = stats["routePoints"] as? [[String: Any]] ?? []
      route.append(routePoint(from: location, source: "native", motionState: "moving", segmentStatus: "reanchor"))
      if route.count > maxRoutePoints { route = Array(route.suffix(maxRoutePoints)) }
      stats["routePoints"] = route
    }

    if acceptedMovement, let speedKmh, speedKmh >= 1 {
      var samples = stats["speedSamples"] as? [Double] ?? []
      samples.append(speedKmh)
      if samples.count > maxSpeedSamples {
        samples = samples.enumerated().compactMap { index, value in
          index.isMultiple(of: 2) ? value : nil
        }
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
    var durableStats = currentStats()
    durableStats["lastCheckpointAttemptAt"] = nowMs
    durableStats["tripSessionId"] = tripSessionId
    persistStats(durableStats)
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
    if stats["startedAt"] == nil { stats["startedAt"] = number(currentState()["startedAt"]) }
    if stats["elapsedSec"] == nil { stats["elapsedSec"] = 0.0 }
    if stats["movingSec"] == nil { stats["movingSec"] = 0.0 }
    if stats["stoppedSec"] == nil { stats["stoppedSec"] = 0.0 }
    if stats["motionState"] == nil { stats["motionState"] = "unknown" }
    if stats["gapCount"] == nil { stats["gapCount"] = 0 }
    if stats["maxGapSec"] == nil { stats["maxGapSec"] = 0.0 }
    if stats["acceptedFixes"] == nil { stats["acceptedFixes"] = 0 }
    if stats["rejectedFixes"] == nil { stats["rejectedFixes"] = 0 }
    return stats
  }

  private func statsSnapshot() -> [String: Any] {
    var stats = currentStats()
    guard currentState()["active"] as? Bool == true else { return stats }
    let nowMs = Date().timeIntervalSince1970 * 1000
    let startedAt = number(stats["startedAt"])
    let lastFixAt = number(stats["lastFixAt"])
    if startedAt > 0 { stats["elapsedSec"] = max(0, nowMs - startedAt) / 1000 }
    if lastFixAt > 0 && nowMs > lastFixAt {
      let key = (stats["motionState"] as? String) == "stopped" ? "stoppedSec" : "movingSec"
      stats[key] = number(stats[key]) + (nowMs - lastFixAt) / 1000
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
    if location.speed >= 0 {
      fix["speedKmh"] = location.speed * 3.6
    }
    if location.verticalAccuracy >= 0 {
      fix["altitudeM"] = location.altitude
    }
    if location.course >= 0 {
      fix["headingDeg"] = location.course
    }
    return fix
  }

  private func routePoint(from location: CLLocation, source: String, motionState: String = "unknown", segmentStatus: String = "accepted") -> [String: Any] {
    var point: [String: Any] = [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "recordedAt": location.timestamp.timeIntervalSince1970 * 1000,
      "source": source,
      "accepted": true,
      "motionState": motionState,
      "segmentStatus": segmentStatus,
    ]
    if location.speed >= 0 { point["speedKmh"] = location.speed * 3.6 }
    if location.verticalAccuracy >= 0 { point["altitudeM"] = location.altitude }
    if location.horizontalAccuracy >= 0 { point["accuracyM"] = location.horizontalAccuracy }
    if location.course >= 0 { point["headingDeg"] = location.course }
    return point
  }

  private func routePoint(from fix: [String: Any], source: String, motionState: String = "unknown", segmentStatus: String = "accepted") -> [String: Any] {
    var point: [String: Any] = [
      "latitude": number(fix["latitude"]),
      "longitude": number(fix["longitude"]),
      "recordedAt": number(fix["time"]),
      "source": source,
      "accepted": true,
      "motionState": motionState,
      "segmentStatus": segmentStatus,
    ]
    if number(fix["speedKmh"]).isFinite { point["speedKmh"] = number(fix["speedKmh"]) }
    if number(fix["altitudeM"]).isFinite { point["altitudeM"] = number(fix["altitudeM"]) }
    if number(fix["accuracy"]).isFinite { point["accuracyM"] = number(fix["accuracy"]) }
    if number(fix["headingDeg"]).isFinite { point["headingDeg"] = number(fix["headingDeg"]) }
    return point
  }

  private func isReliable(_ location: CLLocation) -> Bool {
    return location.horizontalAccuracy < 0 || location.horizontalAccuracy <= maxAccuracyM
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
