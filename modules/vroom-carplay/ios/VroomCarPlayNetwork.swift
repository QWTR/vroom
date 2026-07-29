import Foundation

final class VroomCarPlayNetwork {
  static let shared = VroomCarPlayNetwork()

  private let apiBase = URL(string: "https://v-room.app")!
  private let osrmBase = URL(string: "https://v-room.app/osrm")!
  private let session: URLSession
  private let recentsKey = "vroom_carplay_recent_searches_v1"

  private init() {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 4
    configuration.timeoutIntervalForResource = 8
    configuration.waitsForConnectivity = false
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = URLSession(configuration: configuration)
  }

  func search(
    query: String,
    proximity: VroomCoordinate?,
    completion: @escaping ([VroomSearchPlace]) -> Void
  ) {
    let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard clean.count >= 2 else {
      completion(recentSearches())
      return
    }
    var body: [String: Any] = [
      "query": clean,
      "limit": 12,
      "language": "pl",
      "allowMapboxFallback": false,
    ]
    if let proximity {
      body["proximityLat"] = proximity.latitude
      body["proximityLng"] = proximity.longitude
    }
    request(
      method: "POST",
      path: "/api/osm/geocode",
      body: body
    ) { result in
      let places =
        (try? result.get()).flatMap(Self.parseSearchResponse) ?? []
      DispatchQueue.main.async {
        completion(places)
      }
    }
  }

  func route(
    origin: VroomCoordinate,
    destination: VroomDestination,
    heading: Double?,
    completion: @escaping ([VroomAlternativeRoute]) -> Void
  ) {
    let body: [String: Any] = [
      "coordinates": [
        [origin.longitude, origin.latitude],
        [destination.coordinate.longitude, destination.coordinate.latitude],
      ],
      "profile": "driving",
      "alternatives": true,
      "geometries": "geojson",
      "steps": true,
      "language": "pl",
      "overview": "full",
      "allowMapboxFallback": false,
    ]
    request(
      method: "POST",
      path: "/api/osm/directions",
      body: body,
      extraHeaders: ["x-vroom-client": "automotive"]
    ) { [weak self] result in
      if let data = try? result.get(),
        let routes = Self.parseRouteResponse(data, destination: destination),
        !routes.isEmpty
      {
        self?.saveRecent(destination)
        DispatchQueue.main.async {
          completion(routes)
        }
        return
      }
      self?.fallbackRoute(
        origin: origin,
        destination: destination,
        heading: heading
      ) { routes in
        if !routes.isEmpty {
          self?.saveRecent(destination)
        }
        DispatchQueue.main.async {
          completion(routes)
        }
      }
    }
  }

  func submitReport(
    type: String,
    pose: VroomCarPlayPose?,
    completion: @escaping (Bool) -> Void
  ) {
    guard let pose else {
      completion(false)
      return
    }
    request(
      method: "POST",
      path: "/api/live/warnings",
      body: [
        "type": type,
        "lat": pose.rawCoordinate.latitude,
        "lng": pose.rawCoordinate.longitude,
      ]
    ) { result in
      DispatchQueue.main.async {
        completion((try? result.get()) != nil)
      }
    }
  }

  func roadLayers(
    near coordinate: VroomCoordinate,
    completion: @escaping (
      [VroomMapMarker]?,
      [VroomMapMarker]?,
      [VroomMapMarker]?
    ) -> Void
  ) {
    let group = DispatchGroup()
    let lock = NSLock()
    var warnings: [VroomMapMarker]?
    var cameras: [VroomMapMarker]?
    var fuel: [VroomMapMarker]?

    group.enter()
    request(method: "GET", path: "/api/live/warnings") { result in
      if let data = try? result.get() {
        let parsed = Self.parseMarkerArray(data, kind: .warning)
        lock.lock()
        warnings = parsed
        lock.unlock()
      }
      group.leave()
    }

    let latitude = coordinate.latitude
    let longitude = coordinate.longitude
    group.enter()
    request(
      method: "GET",
      path:
        "/api/speed-cameras?lat=\(latitude)&lng=\(longitude)&radius=100"
    ) { result in
      if let data = try? result.get() {
        let parsed = Self.parseMarkerArray(data, kind: .camera)
        lock.lock()
        cameras = parsed
        lock.unlock()
      }
      group.leave()
    }

    group.enter()
    request(
      method: "GET",
      path:
        "/api/fuel-stations?minLat=\(latitude - 0.15)" +
        "&maxLat=\(latitude + 0.15)&minLng=\(longitude - 0.15)" +
        "&maxLng=\(longitude + 0.15)"
    ) { result in
      if let data = try? result.get() {
        let parsed = Self.parseMarkerArray(data, kind: .fuel)
        lock.lock()
        fuel = parsed
        lock.unlock()
      }
      group.leave()
    }

    group.notify(queue: .main) {
      completion(warnings, cameras, fuel)
    }
  }

  func activeNavigationSnapshot(
    completion: @escaping (String?) -> Void
  ) {
    request(
      method: "GET",
      path: "/api/navigation/session/active"
    ) { result in
      guard let data = try? result.get(),
        let remote = try? JSONSerialization.jsonObject(with: data)
          as? [String: Any],
        remote.bool("isNavigating") == true
      else {
        DispatchQueue.main.async {
          completion(nil)
        }
        return
      }
      let route = remote["routePolyline"] as? [Any] ?? []
      let destination = remote.object("destination") ?? [:]
      let now = Int64(Date().timeIntervalSince1970 * 1_000)
      let dto: [String: Any] = [
        "isNavigating": true,
        "currentStepIndex": remote.int("currentStepIndex") ?? 0,
        "nextInstruction": remote.cleanString("nextInstruction") ?? "",
        "maneuver": remote.cleanString("maneuver") ?? "navigation",
        "maneuverModifier": remote.cleanString("maneuverModifier") ?? "",
        "remainingDistanceMeters":
          remote["remainingDistanceMeters"] ?? NSNull(),
        "remainingDurationSec":
          remote["remainingDurationSec"] ?? NSNull(),
        "turnDistanceMeters":
          remote["turnDistanceMeters"] ??
          remote["remainingDistanceMeters"] ??
          NSNull(),
        "destinationName":
          remote.cleanString("destinationName") ?? "Cel",
      ]
      let normalizedDestination: [String: Any] = [
        "name": remote.cleanString("destinationName") ?? "Cel",
        "latitude":
          destination["latitude"] ?? destination["lat"] ?? NSNull(),
        "longitude":
          destination["longitude"] ?? destination["lng"] ?? NSNull(),
      ]
      let snapshot: [String: Any] = [
        "schemaVersion": 2,
        "revision": now,
        "sentAtMs": now,
        "source": "backend",
        "isNavigating": true,
        "dto": dto,
        "route": route,
        "destination": normalizedDestination,
        "mapState": ["route": route],
      ]
      let raw = (try? JSONSerialization.data(withJSONObject: snapshot))
        .flatMap { String(data: $0, encoding: .utf8) }
      DispatchQueue.main.async {
        completion(raw)
      }
    }
  }

  func recentSearches() -> [VroomSearchPlace] {
    guard let values = UserDefaults.standard.array(forKey: recentsKey)
      as? [[String: Any]]
    else {
      return []
    }
    return values.compactMap { value in
      guard let coordinate = VroomCoordinate(json: value) else {
        return nil
      }
      return VroomSearchPlace(
        id: value.cleanString("id") ?? UUID().uuidString,
        name: value.cleanString("name") ?? "Cel",
        address: value.cleanString("address") ?? "",
        coordinate: coordinate
      )
    }
  }

  private func fallbackRoute(
    origin: VroomCoordinate,
    destination: VroomDestination,
    heading: Double?,
    completion: @escaping ([VroomAlternativeRoute]) -> Void
  ) {
    let coordinates =
      "\(origin.longitude),\(origin.latitude);" +
      "\(destination.coordinate.longitude),\(destination.coordinate.latitude)"
    var components = URLComponents(
      string: "\(osrmBase.absoluteString)/route/v1/driving/\(coordinates)"
    )
    var items = [
      URLQueryItem(name: "alternatives", value: "true"),
      URLQueryItem(name: "geometries", value: "geojson"),
      URLQueryItem(name: "steps", value: "true"),
      URLQueryItem(name: "overview", value: "full"),
      URLQueryItem(name: "continue_straight", value: "true"),
    ]
    if let heading, heading.isFinite {
      items.append(
        URLQueryItem(
          name: "bearings",
          value:
            "\(Int(heading.rounded().truncatingRemainder(dividingBy: 360))),60;"
        )
      )
    }
    components?.queryItems = items
    guard let url = components?.url else {
      completion([])
      return
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 5
    session.dataTask(with: request) { data, _, _ in
      let routes = data.flatMap {
        Self.parseRouteResponse($0, destination: destination)
      } ?? []
      completion(routes)
    }.resume()
  }

  private func request(
    method: String,
    path: String,
    body: [String: Any]? = nil,
    extraHeaders: [String: String] = [:],
    completion: @escaping (Result<Data, Error>) -> Void
  ) {
    guard let url = URL(string: path, relativeTo: apiBase)?.absoluteURL else {
      completion(
        .failure(NSError(domain: "VroomCarPlayNetwork", code: -2))
      )
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let token = VroomCarPlayTokenStore.shared.read()
    if !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    extraHeaders.forEach { key, value in
      request.setValue(value, forHTTPHeaderField: key)
    }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    session.dataTask(with: request) { data, response, error in
      if let error {
        completion(.failure(error))
        return
      }
      guard let response = response as? HTTPURLResponse,
        (200...299).contains(response.statusCode),
        let data
      else {
        completion(
          .failure(
            NSError(
              domain: "VroomCarPlayNetwork",
              code: (response as? HTTPURLResponse)?.statusCode ?? -1
            )
          )
        )
        return
      }
      completion(.success(data))
    }.resume()
  }

  private func saveRecent(_ destination: VroomDestination) {
    var values = UserDefaults.standard.array(forKey: recentsKey)
      as? [[String: Any]] ?? []
    let next: [String: Any] = [
      "id": "recent-\(destination.coordinate.latitude)-\(destination.coordinate.longitude)",
      "name": destination.name,
      "address": "",
      "latitude": destination.coordinate.latitude,
      "longitude": destination.coordinate.longitude,
    ]
    values.removeAll {
      VroomCoordinate(json: $0) == destination.coordinate
    }
    values.insert(next, at: 0)
    UserDefaults.standard.set(Array(values.prefix(5)), forKey: recentsKey)
  }

  private static func parseSearchResponse(_ data: Data) -> [VroomSearchPlace]? {
    guard let root = try? JSONSerialization.jsonObject(with: data)
      as? [String: Any],
      let features = root["features"] as? [[String: Any]]
    else {
      return nil
    }
    var seen = Set<String>()
    return features.enumerated().compactMap { index, feature in
      let properties = feature.object("properties") ?? [:]
      let geometry = feature.object("geometry") ?? [:]
      let coordinateValues =
        geometry["coordinates"] as? [Any] ??
        feature["center"] as? [Any] ??
        []
      guard coordinateValues.count >= 2,
        let longitude = (coordinateValues[0] as? NSNumber)?.doubleValue,
        let latitude = (coordinateValues[1] as? NSNumber)?.doubleValue
      else {
        return nil
      }
      let coordinate = VroomCoordinate(
        latitude: latitude,
        longitude: longitude
      )
      let name =
        properties.cleanString("name") ??
        feature.cleanString("text") ??
        feature.cleanString("place_name") ??
        "Cel"
      let key =
        "\(name.lowercased())|" +
        "\(Int(latitude * 10_000))|\(Int(longitude * 10_000))"
      guard seen.insert(key).inserted else {
        return nil
      }
      return VroomSearchPlace(
        id:
          properties.cleanString("mapbox_id") ??
          feature.cleanString("id") ??
          "place-\(index)",
        name: name,
        address:
          properties.cleanString("full_address") ??
          feature.cleanString("place_name") ??
          "",
        coordinate: coordinate
      )
    }
  }

  private static func parseMarkerArray(
    _ data: Data,
    kind: VroomMarkerKind
  ) -> [VroomMapMarker] {
    guard let root = try? JSONSerialization.jsonObject(with: data) else {
      return []
    }
    let values: [[String: Any]]
    if let array = root as? [[String: Any]] {
      values = array
    } else if let object = root as? [String: Any] {
      values =
        object["items"] as? [[String: Any]] ??
        object["features"] as? [[String: Any]] ??
        []
    } else {
      values = []
    }
    return values.enumerated().compactMap { index, original in
      var value = original
      if kind == .warning {
        value["label"] =
          value.cleanString("message") ??
          value.cleanString("type") ??
          "Ostrzeżenie"
      } else if kind == .camera {
        value["label"] =
          value["maxspeed"].map(String.init(describing:)) ??
          value.cleanString("type") ??
          "Fotoradar"
        value["value"] = value["maxspeed"].map(String.init(describing:)) ?? ""
      } else if kind == .fuel {
        value["label"] =
          value.cleanString("brand") ??
          value.cleanString("name") ??
          "Paliwo"
        value["logoUrl"] =
          value.cleanString("brandLogoUrl") ??
          value.cleanString("logoUrl") ??
          ""
      }
      return VroomMapMarker(
        json: value,
        fallbackKind: kind,
        index: index
      )
    }
  }

  private static func parseRouteResponse(
    _ data: Data,
    destination: VroomDestination
  ) -> [VroomAlternativeRoute]? {
    guard let root = try? JSONSerialization.jsonObject(with: data)
      as? [String: Any],
      let routes = root["routes"] as? [[String: Any]]
    else {
      return nil
    }
    return routes.prefix(3).enumerated().compactMap { index, route in
      let geometry = route.object("geometry") ?? [:]
      let rawCoordinates = geometry["coordinates"] as? [[Any]] ?? []
      let points: [[String: Any]] = rawCoordinates.compactMap { pair in
        guard pair.count >= 2,
          let longitude = (pair[0] as? NSNumber)?.doubleValue,
          let latitude = (pair[1] as? NSNumber)?.doubleValue
        else {
          return nil
        }
        return ["lat": latitude, "lng": longitude]
      }
      let leg = (route["legs"] as? [[String: Any]])?.first ?? [:]
      let steps = leg["steps"] as? [[String: Any]] ?? []
      let parsedSteps = steps.map { step -> [String: Any] in
        let maneuver = step.object("maneuver") ?? [:]
        var parsed: [String: Any] = [
          "instruction":
            maneuver.cleanString("instruction") ??
            step.cleanString("name") ??
            "Jedź dalej",
          "maneuver": maneuver.cleanString("type") ?? "straight",
          "maneuverModifier": maneuver.cleanString("modifier") ?? "",
          "distanceMeters": Int(
            (step.finiteDouble("distance") ?? 0).rounded()
          ),
        ]
        if let exit = maneuver.int("exit") {
          parsed["maneuverExit"] = exit
        }
        return parsed
      }
      return VroomAlternativeRoute(
        json: [
          "index": index,
          "route": points,
          "routeSteps": parsedSteps,
          "distanceM": Int(
            (route.finiteDouble("distance") ?? 1).rounded()
          ),
          "durationS": Int(
            (route.finiteDouble("duration") ?? 0).rounded()
          ),
        ],
        fallbackIndex: index,
        destination: destination
      )
    }
  }
}
