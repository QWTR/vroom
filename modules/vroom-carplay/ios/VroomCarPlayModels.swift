import CoreLocation
import Foundation

public struct VroomCoordinate: Equatable {
  public let latitude: Double
  public let longitude: Double

  public var cl: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  }

  public var dictionary: [String: Double] {
    ["latitude": latitude, "longitude": longitude]
  }

  init?(json: Any?) {
    guard let object = json as? [String: Any] else {
      return nil
    }
    let latitude = object.finiteDouble("latitude") ?? object.finiteDouble("lat")
    let longitude = object.finiteDouble("longitude") ?? object.finiteDouble("lng")
    guard let latitude, let longitude,
      (-90.0...90.0).contains(latitude),
      (-180.0...180.0).contains(longitude)
    else {
      return nil
    }
    self.latitude = latitude
    self.longitude = longitude
  }

  init(latitude: Double, longitude: Double) {
    self.latitude = latitude
    self.longitude = longitude
  }
}

public struct VroomDestination {
  public let coordinate: VroomCoordinate
  public let name: String

  init?(json: Any?) {
    guard let object = json as? [String: Any],
      let coordinate = VroomCoordinate(json: object)
    else {
      return nil
    }
    self.coordinate = coordinate
    self.name = object.cleanString("name") ?? "Cel"
  }

  init(coordinate: VroomCoordinate, name: String) {
    self.coordinate = coordinate
    self.name = name
  }
}

public struct VroomNavigationStep {
  public let instruction: String
  public let maneuver: String
  public let modifier: String
  public let exit: Int?
  public let distanceMeters: Int?

  init(json: [String: Any]) {
    instruction =
      json.cleanString("instruction") ??
      json.cleanString("nextInstruction") ??
      "Jedź dalej"
    maneuver = json.cleanString("maneuver") ?? "straight"
    modifier =
      json.cleanString("maneuverModifier") ??
      json.cleanString("modifier") ??
      ""
    exit = json.int("maneuverExit")
    distanceMeters =
      json.int("distanceMeters") ??
      json.int("turnDistanceMeters")
  }
}

public struct VroomNavigationState {
  public let isNavigating: Bool
  public let currentStepIndex: Int
  public let current: VroomNavigationStep
  public let upcoming: [VroomNavigationStep]
  public let remainingDistanceMeters: Int?
  public let remainingDurationSeconds: Int?
  public let turnDistanceMeters: Int?
  public let destinationName: String

  init(root: [String: Any]) {
    let dto = root.object("dto") ?? [:]
    isNavigating = root.bool("isNavigating") ?? dto.bool("isNavigating") ?? false
    currentStepIndex = max(0, dto.int("currentStepIndex") ?? 0)
    current = VroomNavigationStep(json: dto)
    var next = (dto["upcomingSteps"] as? [[String: Any]] ?? [])
      .prefix(3)
      .map(VroomNavigationStep.init)
    if next.isEmpty, dto.cleanString("followingInstruction") != nil {
      var following: [String: Any] = [
        "instruction": dto.cleanString("followingInstruction") ?? "",
        "maneuver": dto.cleanString("followingManeuver") ?? "",
        "maneuverModifier": dto.cleanString("followingManeuverModifier") ?? "",
      ]
      if let exit = dto.int("followingManeuverExit") {
        following["maneuverExit"] = exit
      }
      if let distance = dto.int("followingTurnDistanceMeters") {
        following["distanceMeters"] = distance
      }
      next = [
        VroomNavigationStep(json: following),
      ]
    }
    upcoming = next
    remainingDistanceMeters = dto.int("remainingDistanceMeters")
    remainingDurationSeconds =
      dto.int("remainingDurationSec") ??
      dto.int("remainingDurationSeconds")
    turnDistanceMeters = dto.int("turnDistanceMeters")
    destinationName =
      dto.cleanString("destinationName") ??
      root.object("destination")?.cleanString("name") ??
      "Cel"
  }
}

public enum VroomMarkerKind: String {
  case user
  case friend
  case warning
  case camera
  case fuel
  case partner
  case drop
  case builder
}

public struct VroomMapMarker {
  public let id: String
  public let coordinate: VroomCoordinate
  public let label: String
  public let type: String
  public let value: String
  public let imageURL: String
  public let accentColor: String
  public let kind: VroomMarkerKind

  init?(json: [String: Any], fallbackKind: VroomMarkerKind, index: Int) {
    guard let coordinate = VroomCoordinate(json: json) else {
      return nil
    }
    id = String(describing: json["id"] ?? "\(fallbackKind.rawValue)-\(index)")
    self.coordinate = coordinate
    label =
      json.cleanString("label") ??
      json.cleanString("name") ??
      json.cleanString("username") ??
      fallbackKind.rawValue
    type = json.cleanString("type") ?? fallbackKind.rawValue
    value = json.cleanString("value") ?? json.cleanString("distanceLabel") ?? ""
    imageURL =
      json.cleanString("markerSpriteUri") ??
      json.cleanString("spriteUri") ??
      json.cleanString("logoUrl") ??
      json.cleanString("avatar") ??
      json.cleanString("avatarUrl") ??
      ""
    accentColor = json.cleanString("accentColor") ?? "#E33835"
    if fallbackKind == .user, json.bool("isFriend") == true {
      kind = .friend
    } else {
      kind = fallbackKind
    }
  }
}

public struct VroomAlternativeRoute {
  public let index: Int
  public let points: [VroomCoordinate]
  public let steps: [VroomNavigationStep]
  public let distanceMeters: Int
  public let durationSeconds: Int
  public let destination: VroomDestination

  init?(
    json: [String: Any],
    fallbackIndex: Int,
    destination: VroomDestination
  ) {
    let points = Self.parseCoordinates(json["route"])
    guard points.count >= 2 else {
      return nil
    }
    self.index = json.int("index") ?? fallbackIndex
    self.points = points
    steps = (json["routeSteps"] as? [[String: Any]] ?? [])
      .map(VroomNavigationStep.init)
    distanceMeters = max(1, json.int("distanceM") ?? 1)
    durationSeconds = max(0, json.int("durationS") ?? 0)
    self.destination = destination
  }

  static func parseCoordinates(_ value: Any?) -> [VroomCoordinate] {
    guard let values = value as? [Any] else {
      return []
    }
    return values.compactMap(VroomCoordinate.init)
  }
}

public struct VroomCarPlaySnapshot {
  public let schemaVersion: Int
  public let revision: Int64
  public let sentAtMilliseconds: Int64
  public let source: String
  public let navigation: VroomNavigationState
  public let currentLocation: VroomCoordinate?
  public let speedMetersPerSecond: Double?
  public let heading: Double?
  public let destination: VroomDestination?
  public let route: [VroomCoordinate]
  public let alternatives: [VroomAlternativeRoute]
  public let builderRoute: [VroomCoordinate]
  public let users: [VroomMapMarker]
  public let warnings: [VroomMapMarker]
  public let cameras: [VroomMapMarker]
  public let fuelStations: [VroomMapMarker]
  public let partnerPOIs: [VroomMapMarker]
  public let geoDrops: [VroomMapMarker]
  public let mapStyle: String
  public let markerStyle: String
  public let selfMarkerImageURL: String
  public let speedLimitKmh: Int?
  public let offRoute: Bool
  public let arrived: Bool
  public let showUsers: Bool
  public let showWarnings: Bool
  public let showCameras: Bool
  public let showFuel: Bool
  public let showPartners: Bool
  public let voiceGuidance: Bool
  public let voiceAlerts: Bool

  init?(jsonString: String) {
    guard let data = jsonString.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    self.init(root: root)
  }

  init?(root: [String: Any]) {
    let mapState = root.object("mapState") ?? [:]
    let destination =
      VroomDestination(json: root["destination"]) ??
      VroomDestination(json: root.object("dto")?["destination"]) ??
      Self.destinationFromMapState(mapState)
    let route = VroomAlternativeRoute.parseCoordinates(
      mapState["route"] ?? root["route"]
    )
    let alternativesJSON =
      mapState["alternativeRoutes"] as? [[String: Any]] ?? []
    let alternatives = destination.map { destination in
      alternativesJSON.enumerated().compactMap { index, value in
        VroomAlternativeRoute(
          json: value,
          fallbackIndex: index,
          destination: destination
        )
      }
    } ?? []

    schemaVersion = max(1, root.int("schemaVersion") ?? 1)
    revision =
      root.int64("revision") ??
      root.int64("sentAtMs") ??
      Int64(Date().timeIntervalSince1970 * 1000)
    sentAtMilliseconds = root.int64("sentAtMs") ?? revision
    source = root.cleanString("source") ?? "phone"
    navigation = VroomNavigationState(root: root)
    currentLocation = VroomCoordinate(json: root["userLocation"])
    speedMetersPerSecond = root.finiteDouble("speed")
    heading = root.finiteDouble("heading")
    self.destination = destination
    self.route = route
    self.alternatives = alternatives
    builderRoute = VroomAlternativeRoute.parseCoordinates(mapState["builderRoute"])
    users = Self.parseMarkers(root["users"], kind: .user)
    warnings = Self.parseMarkers(root["warnings"], kind: .warning)
    cameras = Self.parseMarkers(mapState["speedCameras"], kind: .camera)
    fuelStations = Self.parseMarkers(mapState["fuelStations"], kind: .fuel)
    partnerPOIs = Self.parseMarkers(mapState["partnerPois"], kind: .partner)
    geoDrops = Self.parseMarkers(mapState["geoDrops"], kind: .drop)
    mapStyle = mapState.cleanString("mapStyle") ?? "dark"
    markerStyle = mapState.cleanString("locationMarkerStyle") ?? "arrow"
    let selfMarker = mapState.object("selfMarker") ?? [:]
    selfMarkerImageURL =
      selfMarker.cleanString("markerSpriteUri") ??
      mapState.cleanString("currentUserAvatarUrl") ??
      ""
    speedLimitKmh = mapState.int("speedLimitKmh")
    offRoute = mapState.bool("offRoute") ?? false
    arrived = mapState.bool("arrived") ?? false
    showUsers = mapState.bool("showUsers") ?? true
    showWarnings = mapState.bool("showWarnings") ?? true
    showCameras = mapState.bool("showSpeedCameras") ?? true
    showFuel = mapState.bool("showFuelStations") ?? true
    showPartners = mapState.bool("showPartnerPois") ?? true
    voiceGuidance = mapState.bool("voiceGuidance") ?? true
    voiceAlerts = mapState.bool("voiceAlerts") ?? true
  }

  private static func parseMarkers(
    _ value: Any?,
    kind: VroomMarkerKind
  ) -> [VroomMapMarker] {
    (value as? [[String: Any]] ?? []).enumerated().compactMap { index, json in
      VroomMapMarker(json: json, fallbackKind: kind, index: index)
    }
  }

  private static func destinationFromMapState(
    _ mapState: [String: Any]
  ) -> VroomDestination? {
    guard let latitude = mapState.finiteDouble("destinationLat"),
      let longitude = mapState.finiteDouble("destinationLng")
    else {
      return nil
    }
    return VroomDestination(
      coordinate: VroomCoordinate(latitude: latitude, longitude: longitude),
      name: mapState.cleanString("destinationName") ?? "Cel"
    )
  }
}

public struct VroomCarPlayPose {
  public let coordinate: VroomCoordinate
  public let rawCoordinate: VroomCoordinate
  public let speedMetersPerSecond: Double
  public let heading: Double
  public let horizontalAccuracy: Double
  public let timestamp: Date
}

public struct VroomSearchPlace {
  public let id: String
  public let name: String
  public let address: String
  public let coordinate: VroomCoordinate
}

public enum VroomManeuverKind: String {
  case straight
  case slightLeft
  case slightRight
  case left
  case right
  case sharpLeft
  case sharpRight
  case uTurnLeft
  case uTurnRight
  case mergeLeft
  case mergeRight
  case roundabout
  case arrive

  public static func resolve(_ step: VroomNavigationStep) -> VroomManeuverKind {
    let type = step.maneuver.lowercased()
    let modifier = step.modifier.lowercased()
    if type.contains("arrive") {
      return .arrive
    }
    if type.contains("roundabout") || type.contains("rotary") {
      return .roundabout
    }
    if modifier.contains("uturn") || modifier.contains("u-turn") {
      return modifier.contains("right") ? .uTurnRight : .uTurnLeft
    }
    if type.contains("merge") {
      return modifier.contains("left") ? .mergeLeft : .mergeRight
    }
    if modifier.contains("sharp left") {
      return .sharpLeft
    }
    if modifier.contains("sharp right") {
      return .sharpRight
    }
    if modifier.contains("slight left") {
      return .slightLeft
    }
    if modifier.contains("slight right") {
      return .slightRight
    }
    if modifier.contains("left") {
      return .left
    }
    if modifier.contains("right") {
      return .right
    }
    return .straight
  }
}

extension Dictionary where Key == String, Value == Any {
  func object(_ key: String) -> [String: Any]? {
    self[key] as? [String: Any]
  }

  func cleanString(_ key: String) -> String? {
    guard let value = self[key] as? String else {
      return nil
    }
    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return clean.isEmpty ? nil : clean
  }

  func bool(_ key: String) -> Bool? {
    if let value = self[key] as? Bool {
      return value
    }
    if let number = self[key] as? NSNumber {
      return number.boolValue
    }
    return nil
  }

  func int(_ key: String) -> Int? {
    if let value = self[key] as? Int {
      return value
    }
    if let number = self[key] as? NSNumber {
      return number.intValue
    }
    if let string = self[key] as? String {
      return Int(string)
    }
    return nil
  }

  func int64(_ key: String) -> Int64? {
    if let value = self[key] as? Int64 {
      return value
    }
    if let number = self[key] as? NSNumber {
      return number.int64Value
    }
    if let string = self[key] as? String {
      return Int64(string)
    }
    return nil
  }

  func finiteDouble(_ key: String) -> Double? {
    let value: Double?
    if let number = self[key] as? NSNumber {
      value = number.doubleValue
    } else if let string = self[key] as? String {
      value = Double(string)
    } else {
      value = nil
    }
    guard let value, value.isFinite else {
      return nil
    }
    return value
  }
}
