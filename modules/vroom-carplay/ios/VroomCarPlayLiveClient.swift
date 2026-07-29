import CoreLocation
import Foundation
import SocketIO

final class VroomCarPlayLiveClient {
  static let shared = VroomCarPlayLiveClient()

  var onUsers: (([VroomMapMarker]) -> Void)?

  private let queue = DispatchQueue(label: "app.vroom.carplay.socket")
  private var manager: SocketManager?
  private var socket: SocketIOClient?
  private var token = ""
  private var reconnects: Int64 = 0
  private var publications: Int64 = 0
  private var receivedUpdates: Int64 = 0
  private var restFallbacks: Int64 = 0
  private var lastPublishAt: TimeInterval = 0
  private var lastPublishedCoordinate: VroomCoordinate?
  private var latestPose: VroomCarPlayPose?
  private var fallbackTimer: DispatchSourceTimer?

  private init() {}

  func start() {
    let nextToken = VroomCarPlayTokenStore.shared.read()
    guard !nextToken.isEmpty else {
      return
    }
    if socket?.status == .connected, token == nextToken {
      return
    }
    stop()
    token = nextToken
    let nextManager = SocketManager(
      socketURL: URL(string: "https://v-room.app")!,
      config: [
        .compress,
        .forceNew(true),
        .handleQueue(queue),
        .log(false),
        .reconnects(true),
        .reconnectAttempts(-1),
        .reconnectWait(1),
        .reconnectWaitMax(5),
        .version(.three),
      ]
    )
    let nextSocket = nextManager.defaultSocket
    manager = nextManager
    socket = nextSocket
    nextSocket.on(clientEvent: .connect) { [weak nextSocket] _, _ in
      nextSocket?.emit("live:join")
    }
    nextSocket.on(clientEvent: .reconnect) { [weak self] _, _ in
      self?.reconnects += 1
    }
    nextSocket.on("live:users:snapshot") { [weak self] values, _ in
      self?.ingestUsers(values.first)
    }
    nextSocket.on("user:location") { [weak self] value, _ in
      self?.ingestUsers(value.first.map { [$0] })
    }
    nextSocket.connect(withPayload: ["token": nextToken])
    startFallbackTimer()
  }

  func stop() {
    fallbackTimer?.cancel()
    fallbackTimer = nil
    socket?.emit("live:leave")
    socket?.removeAllHandlers()
    socket?.disconnect()
    socket = nil
    manager?.disconnect()
    manager = nil
    token = ""
  }

  func publish(_ pose: VroomCarPlayPose, navigating: Bool) {
    latestPose = pose
    let now = Date().timeIntervalSince1970
    let moved = lastPublishedCoordinate.map {
      Self.distanceMeters($0, pose.coordinate)
    } ?? .greatestFiniteMagnitude
    guard now - lastPublishAt >= 0.8 || moved >= 4 else {
      return
    }
    lastPublishAt = now
    lastPublishedCoordinate = pose.coordinate
    socket?.emit("location:update", [
      "lat": pose.coordinate.latitude,
      "lng": pose.coordinate.longitude,
      "rawLat": pose.rawCoordinate.latitude,
      "rawLng": pose.rawCoordinate.longitude,
      "accuracyM": pose.horizontalAccuracy,
      "speedMps": pose.speedMetersPerSecond,
      "speedKmh": pose.speedMetersPerSecond * 3.6,
      "heading": pose.heading,
      "mode": navigating ? "navigation" : "freeDrive",
      "snapSource": "carplay",
      "snapAgeMs": max(
        0,
        Int(Date().timeIntervalSince(pose.timestamp) * 1000)
      ),
    ])
    publications += 1
  }

  func diagnostics() -> [String: Any] {
    [
      "connected": socket?.status == .connected,
      "reconnects": reconnects,
      "publications": publications,
      "receivedUpdates": receivedUpdates,
      "restFallbacks": restFallbacks,
    ]
  }

  private func ingestUsers(_ raw: Any?) {
    let values: [[String: Any]]
    if let array = raw as? [[String: Any]] {
      values = array
    } else if let value = raw as? [String: Any] {
      values = [value]
    } else {
      return
    }
    let markers = values.enumerated().compactMap { index, value in
      VroomMapMarker(json: value, fallbackKind: .user, index: index)
    }
    receivedUpdates += Int64(markers.count)
    DispatchQueue.main.async { [weak self] in
      self?.onUsers?(markers)
    }
  }

  private func startFallbackTimer() {
    fallbackTimer?.cancel()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 3, repeating: 5)
    timer.setEventHandler { [weak self] in
      self?.runRestFallback()
    }
    fallbackTimer = timer
    timer.resume()
  }

  private func runRestFallback() {
    guard socket?.status != .connected,
      !token.isEmpty,
      let pose = latestPose
    else {
      return
    }
    restFallbacks += 1
    let coordinate = pose.rawCoordinate
    var components = URLComponents(
      string: "https://v-room.app/api/live/users"
    )
    components?.queryItems = [
      URLQueryItem(name: "take", value: "40"),
      URLQueryItem(name: "lat", value: String(coordinate.latitude)),
      URLQueryItem(name: "lng", value: String(coordinate.longitude)),
      URLQueryItem(name: "radiusKm", value: "100"),
    ]
    guard let usersURL = components?.url else {
      return
    }
    var usersRequest = URLRequest(url: usersURL)
    usersRequest.timeoutInterval = 5
    usersRequest.setValue(
      "Bearer \(token)",
      forHTTPHeaderField: "Authorization"
    )
    URLSession.shared.dataTask(with: usersRequest) { [weak self] data, _, _ in
      guard let data,
        let object = try? JSONSerialization.jsonObject(with: data)
      else {
        return
      }
      if let root = object as? [String: Any] {
        self?.ingestUsers(root["users"])
      } else {
        self?.ingestUsers(object)
      }
    }.resume()

    var locationRequest = URLRequest(
      url: URL(string: "https://v-room.app/api/live/location")!
    )
    locationRequest.httpMethod = "POST"
    locationRequest.timeoutInterval = 5
    locationRequest.setValue(
      "Bearer \(token)",
      forHTTPHeaderField: "Authorization"
    )
    locationRequest.setValue(
      "application/json",
      forHTTPHeaderField: "Content-Type"
    )
    locationRequest.httpBody = try? JSONSerialization.data(
      withJSONObject: [
        "lat": pose.coordinate.latitude,
        "lng": pose.coordinate.longitude,
        "rawLat": coordinate.latitude,
        "rawLng": coordinate.longitude,
        "accuracyM": pose.horizontalAccuracy,
        "speedMps": pose.speedMetersPerSecond,
        "heading": pose.heading,
        "mode": "carplay",
      ]
    )
    URLSession.shared.dataTask(with: locationRequest).resume()
  }

  private static func distanceMeters(
    _ first: VroomCoordinate,
    _ second: VroomCoordinate
  ) -> Double {
    let firstLocation = CLLocation(
      latitude: first.latitude,
      longitude: first.longitude
    )
    return firstLocation.distance(
      from: CLLocation(
        latitude: second.latitude,
        longitude: second.longitude
      )
    )
  }
}
