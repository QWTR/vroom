import ExpoModulesCore
import CoreLocation
import MapboxDirections
import MapboxMaps
import MapboxNavigationCore
import Turf

public final class VroomOfflineNavigationModule: Module {
  private let defaults = UserDefaults.standard
  private lazy var navigationProvider = MapboxNavigationProvider(
    coreConfig: .init(
      tilestoreConfig: .custom(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("vroom-navigation-tiles", isDirectory: true))
    )
  )
  private lazy var tileStore = navigationProvider.coreConfig.tilestoreConfig.navigatorLocation.tileStore
  private lazy var offlineManager = OfflineManager()
  private var downloads: [String: Cancelable] = [:]

  public func definition() -> ModuleDefinition {
    Name("VroomOfflineNavigation")
    Events("packProgress")

    AsyncFunction("getCapabilities") { () -> [String: Any?] in
      [
        "available": true,
        "sdkVersion": "3.18.x",
        "supportsOfflineRouting": true,
        "supportsVoiceGuidance": true,
        "supportsRerouting": true,
        "reason": nil,
      ]
    }

    AsyncFunction("estimatePack") { (input: [String: Any]) -> [String: Any] in
      let buffer = input["bufferKm"] as? Double ?? 10
      return ["requiredBytes": Int64(70_000_000 + buffer * 6_000_000)]
    }

    AsyncFunction("listPacks") { () -> [[String: Any]] in self.listPacks() }
    AsyncFunction("downloadPack") { (input: [String: Any], promise: Promise) in self.download(input, promise: promise) }
    AsyncFunction("updatePack") { (input: [String: Any], promise: Promise) in self.download(input, promise: promise) }
    AsyncFunction("pausePack") { (id: String) in
      self.downloads.removeValue(forKey: id)?.cancel()
      self.patchPack(id, ["status": "paused"])
    }
    AsyncFunction("resumePack") { (id: String, promise: Promise) in
      guard let input = self.defaults.dictionary(forKey: "vroom.offline.input.\(id)") else {
        promise.reject("NOT_FOUND", "Nie znaleziono paczki.")
        return
      }
      self.download(input, promise: promise)
    }
    AsyncFunction("deletePack") { (id: String) in
      self.downloads.removeValue(forKey: id)?.cancel()
      self.tileStore.removeTileRegion(forId: id)
      self.defaults.removeObject(forKey: "vroom.offline.input.\(id)")
      self.defaults.removeObject(forKey: "vroom.offline.pack.\(id)")
    }
    AsyncFunction("setPremiumEntitlement") { (active: Bool) in
      if !active {
        self.listPacks().compactMap { $0["id"] as? String }.forEach { id in
          self.downloads.removeValue(forKey: id)?.cancel()
          self.tileStore.removeTileRegion(forId: id)
          self.defaults.removeObject(forKey: "vroom.offline.input.\(id)")
          self.defaults.removeObject(forKey: "vroom.offline.pack.\(id)")
        }
      }
    }
    AsyncFunction("requestOfflineRoute") { (input: [String: Any], promise: Promise) in
      self.requestOfflineRoute(input, promise: promise)
    }
  }

  private func listPacks() -> [[String: Any]] {
    defaults.dictionaryRepresentation().compactMap { key, value in
      key.hasPrefix("vroom.offline.pack.") ? value as? [String: Any] : nil
    }.sorted { ($0["updatedAt"] as? Double ?? 0) > ($1["updatedAt"] as? Double ?? 0) }
  }

  private func requestOfflineRoute(_ input: [String: Any], promise: Promise) {
    guard let origin = input["origin"] as? [String: Any],
          let destination = input["destination"] as? [String: Any],
          let originLat = origin["latitude"] as? Double,
          let originLng = origin["longitude"] as? Double,
          let destinationLat = destination["latitude"] as? Double,
          let destinationLng = destination["longitude"] as? Double else {
      promise.reject("INVALID_COORDINATES", "Nieprawidłowy start lub cel.")
      return
    }
    let options = NavigationRouteOptions(coordinates: [
      CLLocationCoordinate2D(latitude: originLat, longitude: originLng),
      CLLocationCoordinate2D(latitude: destinationLat, longitude: destinationLng),
    ])
    let request = navigationProvider.mapboxNavigation.routingProvider().calculateRoutes(options: options)
    Task {
      switch await request.result {
      case .failure(let error):
        promise.reject("NO_OFFLINE_ROUTE", "Brak trasy w pobranym obszarze: \(error.localizedDescription)")
      case .success(let navigationRoutes):
        let route = navigationRoutes.mainRoute.route
        let coordinates = route.shape?.coordinates ?? []
        guard coordinates.count >= 2 else {
          promise.reject("NO_OFFLINE_ROUTE", "Pobrany obszar nie zawiera danych potrzebnych do tej trasy.")
          return
        }
        let distance = route.distance
        let seconds = route.expectedTravelTime
        promise.resolve([
          "points": coordinates.map { ["latitude": $0.latitude, "longitude": $0.longitude] },
          "steps": [],
          "distanceText": String(format: "%.1f km", distance / 1000),
          "distanceValue": Int(distance),
          "durationText": seconds >= 3600
            ? "\(Int(seconds / 3600)) godz. \(Int(seconds.truncatingRemainder(dividingBy: 3600) / 60)) min"
            : "\(Int(seconds / 60)) min",
          "duration": Int((seconds / 60).rounded()),
          "index": 0,
          "routerOrigin": "unknown",
        ])
      }
    }
  }

  private func download(_ input: [String: Any], promise: Promise) {
    guard let id = input["id"] as? String,
          let geometry = input["geometry"] as? [String: Any],
          let nested = geometry["coordinates"] as? [[[Double]]],
          let firstRing = nested.first,
          firstRing.count >= 4,
          let styleRaw = input["styleURI"] as? String,
          let styleURI = StyleURI(rawValue: styleRaw) else {
      promise.reject("INVALID_PACK", "Nieprawidłowy obszar paczki offline.")
      return
    }
    if !listPacks().contains(where: { $0["id"] as? String == id }) && listPacks().count >= 3 {
      promise.reject("OFFLINE_PACK_LIMIT", "Możesz mieć maksymalnie trzy paczki offline.")
      return
    }
    let ring = firstRing.compactMap { pair -> LocationCoordinate2D? in
      guard pair.count >= 2 else { return nil }
      return LocationCoordinate2D(latitude: pair[1], longitude: pair[0])
    }
    let polygon = Polygon([ring])
    let descriptorOptions = TilesetDescriptorOptions(styleURI: styleURI, zoomRange: 0...16)
    let descriptor = offlineManager.createTilesetDescriptor(for: descriptorOptions)
    guard let loadOptions = TileRegionLoadOptions(geometry: polygon, descriptors: [descriptor], acceptExpired: false) else {
      promise.reject("OFFLINE_REGION_INVALID", "Nie udało się przygotować danych offline.")
      return
    }
    defaults.set(input, forKey: "vroom.offline.input.\(id)")
    let queued = pack(input, status: "queued", progress: 0, completedBytes: 0, error: nil)
    persist(queued)
    promise.resolve(queued)
    downloads[id]?.cancel()
    downloads[id] = tileStore.loadTileRegion(forId: id, loadOptions: loadOptions) { [weak self] result in
      guard let self else { return }
      self.downloads.removeValue(forKey: id)
      switch result {
      case .success:
        let ready = self.pack(input, status: "ready", progress: 100, completedBytes: 0, error: nil)
        self.persist(ready)
        self.sendEvent("packProgress", ready)
      case .failure(let error):
        let failed = self.pack(input, status: "error", progress: 0, completedBytes: 0, error: error.localizedDescription)
        self.persist(failed)
        self.sendEvent("packProgress", failed)
      }
    }
  }

  private func pack(_ input: [String: Any], status: String, progress: Double, completedBytes: Int64, error: String?) -> [String: Any] {
    let buffer = input["bufferKm"] as? Double ?? 10
    return [
      "id": input["id"] as? String ?? "",
      "routeId": input["routeId"] as? Int ?? 0,
      "routeName": input["routeName"] as? String ?? "Trasa",
      "status": status,
      "progress": progress,
      "completedBytes": completedBytes,
      "requiredBytes": Int64(70_000_000 + buffer * 6_000_000),
      "updatedAt": Date().timeIntervalSince1970 * 1000,
      "bufferKm": Int(buffer),
      "error": error as Any,
    ]
  }

  private func persist(_ pack: [String: Any]) {
    guard let id = pack["id"] as? String else { return }
    defaults.set(pack, forKey: "vroom.offline.pack.\(id)")
  }

  private func patchPack(_ id: String, _ patch: [String: Any]) {
    guard var current = defaults.dictionary(forKey: "vroom.offline.pack.\(id)") else { return }
    patch.forEach { current[$0.key] = $0.value }
    current["updatedAt"] = Date().timeIntervalSince1970 * 1000
    persist(current)
    sendEvent("packProgress", current)
  }
}
