import AVFoundation
import CarPlay
import CoreLocation
import Foundation
import MapKit
import UIKit

public final class VroomCarPlayCoordinator: NSObject {
  public static let shared = VroomCarPlayCoordinator()

  public var emitEvent: ((String, [String: Any]) -> Void)?

  private weak var interfaceController: CPInterfaceController?
  private weak var carWindow: CPWindow?
  private var mapTemplate: CPMapTemplate?
  private var mapViewController: VroomCarPlayMapViewController?
  private var navigationSession: CPNavigationSession?
  private var activeTrip: CPTrip?
  private var currentSnapshot: VroomCarPlaySnapshot?
  private var activeRoute: VroomAlternativeRoute?
  private var previewRoutes: [VroomAlternativeRoute] = []
  private var routeChoices: [ObjectIdentifier: VroomAlternativeRoute] = [:]
  private var searchItems: [ObjectIdentifier: VroomSearchPlace] = [:]
  private var connectionStartedAt: Date?
  private var mapLoadedAt: Date?
  private var lastWarningKey = ""
  private var lastWarningAt = Date.distantPast
  private var lastRerouteAt = Date.distantPast
  private var rerouteCount: Int64 = 0
  private var locationFailureCount: Int64 = 0
  private var lastGPSLatencyMilliseconds = 0
  private var voiceEnabled = true
  private var voiceAlertsEnabled = true
  private var voiceMode = "auto"
  private var voiceIdentifier: String?
  private var activeInstructionKey = ""
  private var spokenManeuverPhases = Set<String>()
  private var chainedPrepareKeys = Set<String>()
  private var spokenWarningKeys = Set<String>()
  private var pendingSpeechKeys = Set<String>()
  private var speechStartedCallbacks: [ObjectIdentifier: () -> Void] = [:]
  private var speechKeys: [ObjectIdentifier: String] = [:]
  private var protectedSpeechKey: String?
  private var lastVoiceAt = Date.distantPast
  private var themeIndex = 0
  private var lastPhonePreviewKey = ""
  private var lastPanTranslation = CGPoint.zero
  private var lastZoomScale: CGFloat = 1
  private let themes = ["dark", "light", "satellite"]
  private lazy var locationEngine: VroomCarPlayLocationEngine = {
    let engine = VroomCarPlayLocationEngine()
    engine.onPose = { [weak self] pose in
      // CADisplayLink already calls this on the main run loop. Enqueuing every
      // frame again let camera work pile up and made CarPlay several frames late.
      self?.handle(pose: pose)
    }
    engine.onLocationFailure = { [weak self] _ in
      DispatchQueue.main.async {
        self?.locationFailureCount += 1
        self?.showAlert(
          title: "Brak sygnału GPS",
          subtitle: "VROOM spróbuje wznowić prowadzenie automatycznie."
        )
      }
    }
    engine.onConfirmedOffRoute = { [weak self] pose in
      DispatchQueue.main.async {
        self?.reroute(from: pose)
      }
    }
    return engine
  }()
  private lazy var synthesizer: AVSpeechSynthesizer = {
    let value = AVSpeechSynthesizer()
    value.delegate = self
    return value
  }()
  private var roadLayerTimer: Timer?

  private override init() {
    super.init()
  }

  public var isConnected: Bool {
    interfaceController != nil && carWindow != nil
  }

  public func connect(
    interfaceController: CPInterfaceController,
    window: CPWindow
  ) {
    disconnect()
    connectionStartedAt = Date()
    self.interfaceController = interfaceController
    carWindow = window

    let mapController = VroomCarPlayMapViewController()
    mapController.onMapReady = { [weak self] in
      self?.mapLoadedAt = Date()
    }
    mapViewController = mapController
    window.rootViewController = mapController
    window.isHidden = false

    let template = makeMapTemplate()
    mapTemplate = template
    interfaceController.setRootTemplate(template, animated: false, completion: nil)

    if let restored = VroomCarPlayStateStore.shared.snapshot() {
      apply(snapshot: restored)
    }
    locationEngine.start()
    VroomCarPlayLiveClient.shared.onUsers = { [weak self] users in
      DispatchQueue.main.async {
        self?.mapViewController?.applyLiveUsers(users)
      }
    }
    VroomCarPlayLiveClient.shared.start()
    startRoadLayerRefresh()
    VroomCarPlayNetwork.shared.activeNavigationSnapshot {
      [weak self] raw in
      guard let self, let raw else {
        return
      }
      updateSnapshot(raw)
    }
  }

  public func disconnect() {
    synthesizer.stopSpeaking(at: .immediate)
    navigationSession?.cancelTrip()
    navigationSession = nil
    activeTrip = nil
    activeRoute = nil
    previewRoutes = []
    routeChoices = [:]
    searchItems = [:]
    resetSpeechState()
    locationEngine.stop()
    VroomCarPlayLiveClient.shared.stop()
    roadLayerTimer?.invalidate()
    roadLayerTimer = nil
    carWindow?.rootViewController = nil
    carWindow?.isHidden = true
    mapViewController = nil
    mapTemplate = nil
    interfaceController = nil
    carWindow = nil
    connectionStartedAt = nil
    mapLoadedAt = nil
  }

  public func updateSnapshot(_ json: String) {
    guard let incoming = VroomCarPlaySnapshot(jsonString: json) else {
      return
    }
    guard
      let accepted = VroomCarPlayStateStore.shared.ingest(json: json),
      accepted.revision == incoming.revision
    else {
      return
    }
    DispatchQueue.main.async { [weak self] in
      self?.apply(snapshot: accepted)
    }
  }

  public func setAuthToken(_ token: String) {
    VroomCarPlayTokenStore.shared.save(token)
    if isConnected {
      VroomCarPlayLiveClient.shared.start()
    }
  }

  public func diagnostics() -> [String: Any] {
    var values = VroomCarPlayStateStore.shared.diagnostics()
    values["connected"] = isConnected
    values["hasNavigationSession"] = navigationSession != nil
    values["live"] = VroomCarPlayLiveClient.shared.diagnostics()
    values["rerouteCount"] = rerouteCount
    values["locationFailureCount"] = locationFailureCount
    values["lastGPSLatencyMs"] = lastGPSLatencyMilliseconds
    if let connectionStartedAt {
      values["connectedForMs"] = Int(
        Date().timeIntervalSince(connectionStartedAt) * 1_000
      )
    }
    if let connectionStartedAt, let mapLoadedAt {
      values["mapLoadMs"] = Int(
        mapLoadedAt.timeIntervalSince(connectionStartedAt) * 1_000
      )
    }
    return values
  }

  private func apply(snapshot: VroomCarPlaySnapshot) {
    currentSnapshot = snapshot
    voiceEnabled = snapshot.voiceGuidance
    voiceAlertsEnabled = snapshot.voiceAlerts
    voiceMode = snapshot.voiceMode
    voiceIdentifier = snapshot.voiceIdentifier
    mapViewController?.apply(snapshot: snapshot)

    if snapshot.navigation.isNavigating,
      let destination = snapshot.destination,
      snapshot.route.count >= 2
    {
      let route = routeFromSnapshot(snapshot, destination: destination)
      activeRoute = route
      ensureNavigationSession(route: route)
      updateGuidance(snapshot.navigation)
      updateManeuverVoice(snapshot)
    } else if !snapshot.alternatives.isEmpty,
      let destination = snapshot.destination,
      activeRoute == nil
    {
      let previewKey =
        "\(destination.coordinate.latitude):" +
        "\(destination.coordinate.longitude):" +
        snapshot.alternatives.map {
          "\($0.distanceMeters):\($0.durationSeconds)"
        }.joined(separator: "|")
      if previewKey != lastPhonePreviewKey {
        lastPhonePreviewKey = previewKey
        presentRouteChoices(snapshot.alternatives)
      }
    } else if navigationSession != nil {
      finishNavigation(arrived: snapshot.arrived, emitStop: false)
    }
    locationEngine.setRoute(
      activeRoute?.points ??
        (snapshot.navigation.isNavigating ? snapshot.route : [])
    )

    if snapshot.offRoute, let pose = locationEngine.latestPose() {
      reroute(from: pose)
    }
    if snapshot.arrived {
      finishNavigation(arrived: true, emitStop: false)
    }
    presentHighestPriorityWarning(from: snapshot)
  }

  private func makeMapTemplate() -> CPMapTemplate {
    let template = CPMapTemplate()
    template.mapDelegate = self
    template.automaticallyHidesNavigationBar = true

    let recenter = CPMapButton { [weak self] _ in
      self?.mapViewController?.recenter()
    }
    recenter.image = UIImage(systemName: "location.fill")
    let theme = CPMapButton { [weak self] _ in
      self?.cycleTheme()
    }
    theme.image = UIImage(systemName: "circle.lefthalf.filled")
    let voice = CPMapButton { [weak self] button in
      guard let self else {
        return
      }
      voiceEnabled.toggle()
      if !voiceEnabled {
        synthesizer.stopSpeaking(at: .immediate)
      }
      button.image = UIImage(
        systemName: voiceEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill"
      )
    }
    voice.image = UIImage(systemName: "speaker.wave.2.fill")
    let report = CPMapButton { [weak self] _ in
      self?.showReportMenu()
    }
    report.image = UIImage(systemName: "exclamationmark.bubble.fill")
    template.mapButtons = [recenter, theme, voice, report]

    let search = CPBarButton(
      image: UIImage(systemName: "magnifyingglass") ?? UIImage()
    ) { [weak self] _ in
      self?.showSearch()
    }
    let menu = CPBarButton(
      image: UIImage(systemName: "line.3.horizontal") ?? UIImage()
    ) { [weak self] _ in
      self?.showMenu()
    }
    template.leadingNavigationBarButtons = [search]
    template.trailingNavigationBarButtons = [menu]
    return template
  }

  private func showSearch() {
    guard let interfaceController else {
      return
    }
    let search = CPSearchTemplate()
    search.delegate = self
    interfaceController.pushTemplate(search, animated: true, completion: nil)
  }

  private func showMenu() {
    guard let interfaceController else {
      return
    }
    let navigationItem = CPListItem(
      text: activeRoute == nil ? "Wybierz cel" : "Zakończ trasę",
      detailText:
        activeRoute == nil
        ? "Wyszukaj miejsce lub wybierz ostatni cel"
        : activeRoute?.destination.name
    )
    navigationItem.handler = { [weak self] _, completion in
      guard let self else {
        completion()
        return
      }
      if activeRoute == nil {
        interfaceController.popTemplate(animated: true, completion: nil)
        showSearch()
      } else {
        finishNavigation(arrived: false, emitStop: true)
        interfaceController.popToRootTemplate(animated: true, completion: nil)
      }
      completion()
    }

    let recentItems = VroomCarPlayNetwork.shared.recentSearches().map { place in
      let item = CPListItem(text: place.name, detailText: place.address)
      item.handler = { [weak self] _, completion in
        self?.requestRoutes(to: place)
        completion()
      }
      return item
    }
    let layerDefinitions: [(String, VroomMarkerKind)] = [
      ("Użytkownicy Live", .user),
      ("Ostrzeżenia", .warning),
      ("Fotoradary", .camera),
      ("Stacje paliw", .fuel),
      ("Partnerzy", .partner),
      ("Zrzuty", .drop),
    ]
    let layerItems: [CPListItem] = layerDefinitions.map { title, kind in
      let item = CPListItem(
        text: title,
        detailText:
          mapViewController?.isLayerVisible(kind) == true ? "Widoczne" : "Ukryte"
      )
      item.handler = { [weak self, weak item] _, completion in
        guard let self else {
          completion()
          return
        }
        let next = !(mapViewController?.isLayerVisible(kind) ?? true)
        mapViewController?.setLayer(kind, visible: next)
        item?.setDetailText(next ? "Widoczne" : "Ukryte")
        completion()
      }
      return item
    }
    let categoryItems = [
      ("Stacje paliw", "stacja paliw"),
      ("Parking", "parking"),
      ("Restauracje", "restauracja"),
      ("Serwis samochodowy", "serwis samochodowy"),
    ]
    .map { title, query in
      let item = CPListItem(text: title, detailText: "Szukaj w pobliżu")
      item.handler = { [weak self] _, completion in
        self?.showCategoryResults(title: title, query: query)
        completion()
      }
      return item
    }
    var sections = [CPListSection(items: [navigationItem])]
    if !recentItems.isEmpty {
      sections.append(CPListSection(items: recentItems, header: "Ostatnie cele", sectionIndexTitle: nil))
    }
    sections.append(
      CPListSection(
        items: categoryItems,
        header: "Kategorie",
        sectionIndexTitle: nil
      )
    )
    sections.append(
      CPListSection(items: layerItems, header: "Warstwy mapy", sectionIndexTitle: nil)
    )
    interfaceController.pushTemplate(
      CPListTemplate(title: "VROOM", sections: sections),
      animated: true,
      completion: nil
    )
  }

  private func showCategoryResults(title: String, query: String) {
    VroomCarPlayNetwork.shared.search(
      query: query,
      proximity:
        locationEngine.latestPose()?.rawCoordinate ??
        currentSnapshot?.currentLocation
    ) { [weak self] places in
      guard let self, let interfaceController else {
        return
      }
      let items = places.prefix(12).map { place in
        let item = CPListItem(text: place.name, detailText: place.address)
        item.handler = { [weak self] _, completion in
          self?.requestRoutes(to: place)
          completion()
        }
        return item
      }
      guard !items.isEmpty else {
        showAlert(
          title: "Brak wyników",
          subtitle: "Nie znaleziono miejsc w tej kategorii."
        )
        return
      }
      interfaceController.pushTemplate(
        CPListTemplate(
          title: title,
          sections: [CPListSection(items: items)]
        ),
        animated: true,
        completion: nil
      )
    }
  }

  private func showReportMenu() {
    guard let interfaceController else {
      return
    }
    let reports = [
      ("Policja", "police", "shield.fill"),
      ("Wypadek", "accident", "car.side.fill"),
      ("Kontrola ITD", "itd", "truck.box.fill"),
      ("Niebezpieczeństwo", "hazard", "exclamationmark.triangle.fill"),
    ]
    let items = reports.map { title, type, symbol in
      let item = CPListItem(
        text: title,
        detailText: "Zgłoś w bieżącej lokalizacji",
        image: UIImage(systemName: symbol)
      )
      item.handler = { [weak self] _, completion in
        self?.submitReport(type: type, label: title)
        completion()
      }
      return item
    }
    let template = CPListTemplate(
      title: "Zgłoś zdarzenie",
      sections: [CPListSection(items: items)]
    )
    interfaceController.pushTemplate(template, animated: true, completion: nil)
  }

  private func submitReport(type: String, label: String) {
    let pose = locationEngine.latestPose()
    VroomCarPlayNetwork.shared.submitReport(type: type, pose: pose) {
      [weak self] success in
      self?.emitEvent?(
        "reportRequested",
        ["type": type, "handled": success]
      )
      self?.interfaceController?.popToRootTemplate(
        animated: true,
        completion: nil
      )
      self?.showAlert(
        title: success ? "Zgłoszono: \(label)" : "Nie udało się wysłać",
        subtitle:
          success
          ? "Dziękujemy. Ostrzeżenie trafiło do kierowców VROOM."
          : "Sprawdź połączenie z internetem."
      )
    }
  }

  private func requestRoutes(to place: VroomSearchPlace) {
    guard let origin = locationEngine.latestPose()?.rawCoordinate ??
      currentSnapshot?.currentLocation
    else {
      showAlert(
        title: "Brak lokalizacji",
        subtitle: "Poczekaj na sygnał GPS i spróbuj ponownie."
      )
      return
    }
    interfaceController?.popToRootTemplate(animated: true, completion: nil)
    let destination = VroomDestination(
      coordinate: place.coordinate,
      name: place.name
    )
    VroomCarPlayNetwork.shared.route(
      origin: origin,
      destination: destination,
      heading: locationEngine.latestPose()?.heading
    ) { [weak self] routes in
      guard let self else {
        return
      }
      guard !routes.isEmpty else {
        showAlert(
          title: "Nie znaleziono trasy",
          subtitle: "Sprawdź internet lub wybierz inny cel."
        )
        return
      }
      presentRouteChoices(routes)
    }
  }

  private func presentRouteChoices(_ routes: [VroomAlternativeRoute]) {
    guard let mapTemplate else {
      return
    }
    previewRoutes = Array(routes.filter { $0.points.count >= 2 }.prefix(3))
    guard let firstRoute = previewRoutes.first,
      let firstRoutePoint = firstRoute.points.first
    else {
      return
    }
    routeChoices = [:]
    let choices = previewRoutes.map { route -> CPRouteChoice in
      let choice = CPRouteChoice(
        summaryVariants: [
          formatDuration(route.durationSeconds),
          formatDistance(route.distanceMeters),
        ],
        additionalInformationVariants: [
          formatDistance(route.distanceMeters),
        ],
        selectionSummaryVariants: [
          "\(formatDuration(route.durationSeconds)), \(formatDistance(route.distanceMeters))",
        ]
      )
      routeChoices[ObjectIdentifier(choice)] = route
      return choice
    }
    let originCoordinate =
      locationEngine.latestPose()?.rawCoordinate ??
      firstRoutePoint
    let trip = CPTrip(
      origin: mapItem(
        coordinate: originCoordinate,
        name: "Bieżąca lokalizacja"
      ),
      destination: mapItem(
        coordinate: firstRoute.destination.coordinate,
        name: firstRoute.destination.name
      ),
      routeChoices: choices
    )
    activeTrip = trip
    mapViewController?.showRoutePreview(
      previewRoutes,
      selectedIndex: firstRoute.index
    )
    let text = CPTripPreviewTextConfiguration(
      startButtonTitle: "Jedź",
      additionalRoutesButtonTitle: nil,
      overviewButtonTitle: "Podgląd"
    )
    mapTemplate.showTripPreviews([trip], textConfiguration: text)
  }

  private func startNavigation(
    trip: CPTrip,
    routeChoice: CPRouteChoice,
    route: VroomAlternativeRoute
  ) {
    mapTemplate?.hideTripPreviews()
    activeTrip = trip
    activeRoute = route
    previewRoutes = []
    routeChoices = [:]
    mapViewController?.showActiveRoute(route)
    locationEngine.setRoute(route.points)
    navigationSession?.cancelTrip()
    navigationSession = mapTemplate?.startNavigationSession(for: trip)
    mapTemplate?.tripEstimateStyle = .dark
    publishRouteToPhone(route)
    updateGuidance(
      route: route,
      currentIndex: 0,
      remainingDistance: route.distanceMeters,
      remainingDuration: route.durationSeconds
    )
    speak(
      route.steps.first?.instruction ?? "Rozpocznij jazdę",
      key: "navigation-start",
      urgent: true
    )
  }

  private func ensureNavigationSession(route: VroomAlternativeRoute) {
    guard navigationSession == nil, let mapTemplate,
      let routeOrigin = route.points.first
    else {
      return
    }
    let choice = CPRouteChoice(
      summaryVariants: [formatDuration(route.durationSeconds)],
      additionalInformationVariants: [formatDistance(route.distanceMeters)],
      selectionSummaryVariants: [route.destination.name]
    )
    let trip = CPTrip(
      origin: mapItem(
        coordinate: routeOrigin,
        name: "Bieżąca lokalizacja"
      ),
      destination: mapItem(
        coordinate: route.destination.coordinate,
        name: route.destination.name
      ),
      routeChoices: [choice]
    )
    activeTrip = trip
    navigationSession = mapTemplate.startNavigationSession(for: trip)
    mapTemplate.tripEstimateStyle = .dark
  }

  private func updateGuidance(_ state: VroomNavigationState) {
    let steps = [state.current] + state.upcoming
    updateManeuvers(
      steps: steps,
      remainingDistance: state.remainingDistanceMeters,
      remainingDuration: state.remainingDurationSeconds
    )
  }

  private func updateGuidance(
    route: VroomAlternativeRoute,
    currentIndex: Int,
    remainingDistance: Int,
    remainingDuration: Int
  ) {
    let start = min(max(0, currentIndex), max(0, route.steps.count - 1))
    let steps =
      route.steps.isEmpty
      ? [
        VroomNavigationStep(json: [
          "instruction": "Jedź do celu",
          "maneuver": "straight",
          "distanceMeters": remainingDistance,
        ]),
      ]
      : Array(route.steps.dropFirst(start).prefix(4))
    updateManeuvers(
      steps: steps,
      remainingDistance: remainingDistance,
      remainingDuration: remainingDuration
    )
  }

  private func updateManeuvers(
    steps: [VroomNavigationStep],
    remainingDistance: Int?,
    remainingDuration: Int?
  ) {
    guard let navigationSession else {
      return
    }
    let maneuvers = steps.prefix(4).map { step -> CPManeuver in
      let maneuver = CPManeuver()
      maneuver.instructionVariants = [step.instruction]
      maneuver.symbolImage = maneuverImage(for: VroomManeuverKind.resolve(step))
      maneuver.initialTravelEstimates = CPTravelEstimates(
        distanceRemaining: Measurement(
          value: Double(max(0, step.distanceMeters ?? remainingDistance ?? 0)),
          unit: UnitLength.meters
        ),
        timeRemaining: TimeInterval(max(0, remainingDuration ?? 0))
      )
      return maneuver
    }
    navigationSession.upcomingManeuvers = maneuvers
    if let first = maneuvers.first {
      let estimates = CPTravelEstimates(
        distanceRemaining: Measurement(
          value: Double(max(0, remainingDistance ?? 0)),
          unit: UnitLength.meters
        ),
        timeRemaining: TimeInterval(max(0, remainingDuration ?? 0))
      )
      navigationSession.updateEstimates(estimates, for: first)
      if let activeTrip {
        mapTemplate?.updateEstimates(estimates, for: activeTrip)
      }
    }
  }

  private func handle(pose: VroomCarPlayPose) {
    lastGPSLatencyMilliseconds = max(
      0,
      Int(Date().timeIntervalSince(pose.timestamp) * 1_000)
    )
    mapViewController?.update(pose: pose)
    VroomCarPlayLiveClient.shared.publish(
      pose,
      navigating: activeRoute != nil
    )
  }

  private func startRoadLayerRefresh() {
    roadLayerTimer?.invalidate()
    refreshRoadLayers()
    roadLayerTimer = Timer.scheduledTimer(
      withTimeInterval: 20,
      repeats: true
    ) { [weak self] _ in
      self?.refreshRoadLayers()
    }
  }

  private func refreshRoadLayers() {
    guard
      let coordinate =
        locationEngine.latestPose()?.rawCoordinate ??
        currentSnapshot?.currentLocation
    else {
      return
    }
    VroomCarPlayNetwork.shared.roadLayers(near: coordinate) {
      [weak self] warnings, cameras, fuel in
      guard let self else {
        return
      }
      mapViewController?.applyNativeRoadLayers(
        warnings: warnings,
        cameras: cameras,
        fuelStations: fuel
      )
      presentHighestPriorityWarning(
        warnings: warnings ?? currentSnapshot?.warnings ?? [],
        cameras: cameras ?? currentSnapshot?.cameras ?? [],
        voiceAlerts: currentSnapshot?.voiceAlerts ?? true,
        route: currentSnapshot?.route ?? []
      )
    }
  }

  private func reroute(from pose: VroomCarPlayPose) {
    guard let route = activeRoute,
      Date().timeIntervalSince(lastRerouteAt) >= 12
    else {
      return
    }
    lastRerouteAt = Date()
    VroomCarPlayNetwork.shared.route(
      origin: pose.rawCoordinate,
      destination: route.destination,
      heading: pose.heading
    ) { [weak self] routes in
      guard let self, let replacement = routes.first else {
        return
      }
      rerouteCount += 1
      activeRoute = replacement
      locationEngine.setRoute(replacement.points)
      mapViewController?.showActiveRoute(replacement)
      publishRouteToPhone(replacement, reason: "reroute")
      updateGuidance(
        route: replacement,
        currentIndex: 0,
        remainingDistance: replacement.distanceMeters,
        remainingDuration: replacement.durationSeconds
      )
      speak("Przeliczono trasę")
    }
  }

  private func finishNavigation(arrived: Bool, emitStop: Bool) {
    if arrived {
      navigationSession?.finishTrip()
      speak("Jesteś na miejscu")
    } else {
      navigationSession?.cancelTrip()
    }
    navigationSession = nil
    activeTrip = nil
    activeRoute = nil
    previewRoutes = []
    routeChoices = [:]
    locationEngine.setRoute([])
    mapTemplate?.hideTripPreviews()
    mapViewController?.clearRoutePreview()
    resetSpeechState()
    if emitStop {
      VroomCarPlayStateStore.shared.markExplicitCarPlayAction()
      emitEvent?("stopRequested", ["source": "carplay"])
    }
  }

  private func publishRouteToPhone(
    _ route: VroomAlternativeRoute,
    reason: String = "user"
  ) {
    VroomCarPlayStateStore.shared.markExplicitCarPlayAction()
    emitEvent?(
      "navigationStarted",
      [
        "source": "carplay",
        "reason": reason,
        "destination": [
          "name": route.destination.name,
          "latitude": route.destination.coordinate.latitude,
          "longitude": route.destination.coordinate.longitude,
        ],
        "route": route.points.map(\.dictionary),
        "routeSteps": route.steps.map { step in
          [
            "instruction": step.instruction,
            "maneuver": step.maneuver,
            "maneuverModifier": step.modifier,
            "maneuverExit": step.exit.map { $0 as Any } ?? NSNull(),
            "distanceMeters":
              step.distanceMeters.map { $0 as Any } ?? NSNull(),
          ]
        },
        "distanceM": route.distanceMeters,
        "durationS": route.durationSeconds,
      ]
    )
  }

  private func presentHighestPriorityWarning(
    from snapshot: VroomCarPlaySnapshot
  ) {
    presentHighestPriorityWarning(
      warnings: snapshot.warnings,
      cameras: snapshot.cameras,
      voiceAlerts: snapshot.voiceAlerts,
      route: snapshot.route
    )
  }

  private func presentHighestPriorityWarning(
    warnings: [VroomMapMarker],
    cameras: [VroomMapMarker],
    voiceAlerts: Bool,
    route: [VroomCoordinate]
  ) {
    guard voiceAlerts,
      let pose = locationEngine.latestPose()
    else {
      return
    }
    let candidates = warnings + cameras
    let nearest = candidates
      .map { marker in
        (
          marker,
          CLLocation(
            latitude: marker.coordinate.latitude,
            longitude: marker.coordinate.longitude
          )
          .distance(
            from: CLLocation(
              latitude: pose.rawCoordinate.latitude,
              longitude: pose.rawCoordinate.longitude
            )
          )
        )
      }
      .filter { $0.1 <= 650 }
      .filter { item in
        isMarkerAhead(
          item.0.coordinate,
          pose: pose,
          route: route
        )
      }
      .sorted { lhs, rhs in
        let lhsPriority = lhs.0.kind == .camera ? 0 : 1
        let rhsPriority = rhs.0.kind == .camera ? 0 : 1
        return lhsPriority == rhsPriority ? lhs.1 < rhs.1 : lhsPriority < rhsPriority
      }
      .first
    guard let nearest else {
      return
    }
    let key = "\(nearest.0.kind.rawValue)-\(nearest.0.id)"
    guard key != lastWarningKey || Date().timeIntervalSince(lastWarningAt) >= 90 else {
      return
    }
    lastWarningKey = key
    lastWarningAt = Date()
    let distance = Int(nearest.1.rounded())
    let cameraLimit =
      Int(nearest.0.value).map { ", ograniczenie \($0)" } ?? ""
    let title =
      nearest.0.kind == .camera
      ? "Fotoradar\(cameraLimit) za \(distance) m"
      : "Uwaga za \(distance) m"
    showAlert(title: title, subtitle: nearest.0.label)
    guard !spokenWarningKeys.contains(key), !pendingSpeechKeys.contains(key) else {
      return
    }
    let warningText = "\(nearest.0.type) \(nearest.0.label)".lowercased()
    let urgent = [
      "accident", "wypad", "animal", "zwierz", "breakdown", "awari",
    ].contains { warningText.contains($0) }
    speak(
      title,
      key: key,
      urgent: urgent,
      allowWhenGuidanceMuted: true,
      protectUntilFinished: urgent
    ) { [weak self] in
      self?.spokenWarningKeys.insert(key)
    }
  }

  private func showAlert(title: String, subtitle: String) {
    guard let interfaceController, interfaceController.presentedTemplate == nil else {
      return
    }
    let action = CPAlertAction(title: "OK", style: .default) { _ in }
    let template = CPAlertTemplate(
      titleVariants: [title, subtitle],
      actions: [action]
    )
    interfaceController.presentTemplate(template, animated: true, completion: nil)
  }

  private func cycleTheme() {
    themeIndex = (themeIndex + 1) % themes.count
    mapViewController?.setStyle(themes[themeIndex])
  }

  private func updateManeuverVoice(_ snapshot: VroomCarPlaySnapshot) {
    guard voiceEnabled,
      protectedSpeechKey == nil,
      let distance = snapshot.navigation.turnDistanceMeters
    else {
      return
    }
    let step = snapshot.navigation.current
    guard isSpeakableManeuver(step) else {
      return
    }
    let instructionKey =
      "\(step.maneuver):\(step.modifier):\(step.instruction)"
    if instructionKey != activeInstructionKey {
      activeInstructionKey = instructionKey
      spokenManeuverPhases.removeAll()
      if chainedPrepareKeys.contains(instructionKey) {
        spokenManeuverPhases.insert("\(instructionKey):prepare")
      }
    }

    let speedMetersPerSecond = max(
      0,
      snapshot.speedMetersPerSecond ??
        locationEngine.latestPose()?.speedMetersPerSecond ??
        0
    )
    let speedKmh = speedMetersPerSecond * 3.6
    let prepareThreshold = min(900, max(250, speedMetersPerSecond * 25))
    let nowThreshold = min(120, max(35, speedMetersPerSecond * 4))
    let middleThreshold = min(300, max(100, speedMetersPerSecond * 10))
    let phase: String
    if Double(distance) <= nowThreshold {
      phase = "now"
    } else if (speedKmh >= 70 || isComplexManeuver(step)) &&
      Double(distance) <= middleThreshold
    {
      phase = "middle"
    } else if Double(distance) <= prepareThreshold {
      phase = "prepare"
    } else {
      return
    }

    let phaseKey = "\(instructionKey):\(phase)"
    let speechKey = "maneuver:\(phaseKey)"
    guard !spokenManeuverPhases.contains(phaseKey),
      !pendingSpeechKeys.contains(speechKey)
    else {
      return
    }

    var phrase =
      phase == "now"
      ? step.instruction
      : "Za \(readableDistance(distance)), \(step.instruction)"
    var chainedKey: String?
    if phase != "now", let following = snapshot.navigation.upcoming.first,
      let followingDistance = following.distanceMeters
    {
      let chainByTime =
        speedMetersPerSecond > 1 &&
        Double(followingDistance) / speedMetersPerSecond <= 15
      if followingDistance <= 180 || chainByTime {
        phrase += ". Potem \(following.instruction)"
        chainedKey =
          "\(following.maneuver):\(following.modifier):\(following.instruction)"
      }
    }

    speak(
      phrase,
      key: speechKey,
      urgent: phase == "now"
    ) { [weak self] in
      self?.spokenManeuverPhases.insert(phaseKey)
      if let chainedKey {
        self?.chainedPrepareKeys.insert(chainedKey)
      }
    }
  }

  private func speak(
    _ text: String,
    key: String? = nil,
    urgent: Bool = false,
    allowWhenGuidanceMuted: Bool = false,
    protectUntilFinished: Bool = false,
    onStarted: @escaping () -> Void = {}
  ) {
    guard (voiceEnabled || (allowWhenGuidanceMuted && voiceAlertsEnabled)),
      !text.isEmpty
    else {
      return
    }
    let now = Date()
    if !urgent,
      (!pendingSpeechKeys.isEmpty || now.timeIntervalSince(lastVoiceAt) < 6)
    {
      return
    }
    if urgent {
      synthesizer.stopSpeaking(at: .immediate)
      pendingSpeechKeys.removeAll()
      speechStartedCallbacks.removeAll()
      speechKeys.removeAll()
    }

    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = selectedPolishVoice()
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.96
    utterance.pitchMultiplier = 1
    let speechKey = key ?? "info:\(text)"
    let identifier = ObjectIdentifier(utterance)
    pendingSpeechKeys.insert(speechKey)
    speechKeys[identifier] = speechKey
    speechStartedCallbacks[identifier] = onStarted
    if protectUntilFinished {
      protectedSpeechKey = speechKey
    }
    configureAudioSession()
    synthesizer.speak(utterance)
  }

  private func selectedPolishVoice() -> AVSpeechSynthesisVoice? {
    if voiceMode == "manual", let voiceIdentifier,
      let selected = AVSpeechSynthesisVoice(identifier: voiceIdentifier)
    {
      return selected
    }
    return AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language.lowercased().hasPrefix("pl") }
      .sorted { lhs, rhs in
        if lhs.quality != rhs.quality {
          return lhs.quality.rawValue > rhs.quality.rawValue
        }
        return lhs.identifier < rhs.identifier
      }
      .first ?? AVSpeechSynthesisVoice(language: "pl-PL")
  }

  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(
      .playback,
      mode: .voicePrompt,
      options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
    )
    try? session.setActive(true)
  }

  private func resetSpeechState() {
    activeInstructionKey = ""
    spokenManeuverPhases.removeAll()
    chainedPrepareKeys.removeAll()
    spokenWarningKeys.removeAll()
    pendingSpeechKeys.removeAll()
    speechStartedCallbacks.removeAll()
    speechKeys.removeAll()
    protectedSpeechKey = nil
    lastVoiceAt = .distantPast
  }

  private func isSpeakableManeuver(_ step: VroomNavigationStep) -> Bool {
    let clean = "\(step.maneuver) \(step.modifier)".lowercased()
    return !["depart", "notification", "new name", "continue", "straight"]
      .contains { clean.contains($0) }
  }

  private func isComplexManeuver(_ step: VroomNavigationStep) -> Bool {
    let clean = "\(step.maneuver) \(step.modifier)".lowercased()
    return [
      "roundabout", "rotary", "fork", "merge", "ramp", "uturn",
      "u-turn", "sharp", "ostro", "rozwidlen", "zawr",
    ].contains { clean.contains($0) }
  }

  private func readableDistance(_ meters: Int) -> String {
    if meters >= 950 {
      return String(format: "%.1f kilometra", Double(meters) / 1_000)
    }
    let rounded = max(50, Int((Double(meters) / 50).rounded()) * 50)
    return "\(rounded) metrów"
  }

  private func isMarkerAhead(
    _ marker: VroomCoordinate,
    pose: VroomCarPlayPose,
    route: [VroomCoordinate]
  ) -> Bool {
    let markerBearing = bearing(
      from: pose.rawCoordinate,
      to: marker
    )
    let delta = angleDelta(pose.heading, markerBearing)
    if delta <= 105 {
      return true
    }
    return delta <= 135 &&
      route.prefix(100).contains {
        CLLocation(latitude: $0.latitude, longitude: $0.longitude)
          .distance(
            from: CLLocation(
              latitude: marker.latitude,
              longitude: marker.longitude
            )
          ) <= 220
      }
  }

  private func bearing(
    from start: VroomCoordinate,
    to end: VroomCoordinate
  ) -> Double {
    let first = start.latitude * .pi / 180
    let second = end.latitude * .pi / 180
    let longitudeDelta = (end.longitude - start.longitude) * .pi / 180
    let y = sin(longitudeDelta) * cos(second)
    let x =
      cos(first) * sin(second) -
      sin(first) * cos(second) * cos(longitudeDelta)
    return (atan2(y, x) * 180 / .pi + 360)
      .truncatingRemainder(dividingBy: 360)
  }

  private func angleDelta(_ first: Double, _ second: Double) -> Double {
    let raw = abs(first - second)
    return min(raw, 360 - raw)
  }

  private func routeFromSnapshot(
    _ snapshot: VroomCarPlaySnapshot,
    destination: VroomDestination
  ) -> VroomAlternativeRoute {
    var currentStep: [String: Any] = [
      "instruction": snapshot.navigation.current.instruction,
      "maneuver": snapshot.navigation.current.maneuver,
      "maneuverModifier": snapshot.navigation.current.modifier,
    ]
    if let distance = snapshot.navigation.turnDistanceMeters {
      currentStep["distanceMeters"] = distance
    }
    return VroomAlternativeRoute(
      json: [
        "index": 0,
        "route": snapshot.route.map(\.dictionary),
        "routeSteps": [currentStep],
        "distanceM": snapshot.navigation.remainingDistanceMeters ?? 1,
        "durationS": snapshot.navigation.remainingDurationSeconds ?? 0,
      ],
      fallbackIndex: 0,
      destination: destination
    )!
  }

  private func mapItem(
    coordinate: VroomCoordinate,
    name: String
  ) -> MKMapItem {
    let item = MKMapItem(
      placemark: MKPlacemark(coordinate: coordinate.cl)
    )
    item.name = name
    return item
  }

  private func maneuverImage(for kind: VroomManeuverKind) -> UIImage? {
    let symbol: String
    switch kind {
    case .left:
      symbol = "arrow.turn.up.left"
    case .right:
      symbol = "arrow.turn.up.right"
    case .slightLeft, .mergeLeft:
      symbol = "arrow.up.left"
    case .slightRight, .mergeRight:
      symbol = "arrow.up.right"
    case .sharpLeft:
      symbol = "arrow.down.left"
    case .sharpRight:
      symbol = "arrow.down.right"
    case .uTurnLeft:
      symbol = "arrow.uturn.left"
    case .uTurnRight:
      symbol = "arrow.uturn.right"
    case .roundabout:
      symbol = "arrow.triangle.2.circlepath"
    case .arrive:
      symbol = "flag.checkered"
    case .straight:
      symbol = "arrow.up"
    }
    return UIImage(systemName: symbol)
  }

  private func formatDuration(_ seconds: Int) -> String {
    if seconds < 60 {
      return "< 1 min"
    }
    let minutes = Int((Double(seconds) / 60).rounded())
    if minutes < 60 {
      return "\(minutes) min"
    }
    return "\(minutes / 60) godz. \(minutes % 60) min"
  }

  private func formatDistance(_ meters: Int) -> String {
    if meters < 1_000 {
      return "\(max(1, meters)) m"
    }
    return String(format: "%.1f km", Double(meters) / 1_000)
  }
}

extension VroomCarPlayCoordinator: CPMapTemplateDelegate {
  public func mapTemplateDidCancelNavigation(
    _ mapTemplate: CPMapTemplate
  ) {
    previewRoutes = []
    routeChoices = [:]
    mapViewController?.clearRoutePreview()
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    selectedPreviewFor trip: CPTrip,
    using routeChoice: CPRouteChoice
  ) {
    guard let route = routeChoices[ObjectIdentifier(routeChoice)] else {
      return
    }
    mapViewController?.showRoutePreview(
      previewRoutes,
      selectedIndex: route.index
    )
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    startedTrip trip: CPTrip,
    using routeChoice: CPRouteChoice
  ) {
    guard let route = routeChoices[ObjectIdentifier(routeChoice)] else {
      return
    }
    startNavigation(trip: trip, routeChoice: routeChoice, route: route)
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    displayStyleFor maneuver: CPManeuver
  ) -> CPManeuverDisplayStyle {
    .leadingSymbol
  }

  public func mapTemplateDidShowPanningInterface(_ mapTemplate: CPMapTemplate) {
    mapViewController?.setFollowMode(false)
  }

  public func mapTemplateDidBeginPanGesture(_ mapTemplate: CPMapTemplate) {
    lastPanTranslation = .zero
    mapViewController?.setFollowMode(false)
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    didUpdatePanGestureWithTranslation translation: CGPoint,
    velocity: CGPoint
  ) {
    let delta = CGPoint(
      x: translation.x - lastPanTranslation.x,
      y: translation.y - lastPanTranslation.y
    )
    lastPanTranslation = translation
    mapViewController?.pan(
      horizontal: Double(-delta.x / 80),
      vertical: Double(delta.y / 80)
    )
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    didEndPanGestureWithVelocity velocity: CGPoint
  ) {
    lastPanTranslation = .zero
  }

  public func mapTemplateDidBeginZoomGesture(_ mapTemplate: CPMapTemplate) {
    lastZoomScale = 1
    mapViewController?.setFollowMode(false)
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    didUpdateZoomGestureWithCenter center: CGPoint,
    scale: CGFloat,
    velocity: CGFloat
  ) {
    guard scale > 0, lastZoomScale > 0 else {
      return
    }
    let delta = log2(Double(scale / lastZoomScale))
    lastZoomScale = scale
    mapViewController?.zoom(by: max(-0.7, min(0.7, delta)))
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    didEndZoomGestureWithVelocity velocity: CGFloat
  ) {
    lastZoomScale = 1
  }

  public func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    panWith direction: CPMapTemplate.PanDirection
  ) {
    if direction.contains(.left) {
      mapViewController?.pan(horizontal: -1, vertical: 0)
    }
    if direction.contains(.right) {
      mapViewController?.pan(horizontal: 1, vertical: 0)
    }
    if direction.contains(.up) {
      mapViewController?.pan(horizontal: 0, vertical: 1)
    }
    if direction.contains(.down) {
      mapViewController?.pan(horizontal: 0, vertical: -1)
    }
  }
}

extension VroomCarPlayCoordinator: CPSearchTemplateDelegate {
  public func searchTemplate(
    _ searchTemplate: CPSearchTemplate,
    updatedSearchText searchText: String,
    completionHandler: @escaping ([CPListItem]) -> Void
  ) {
    VroomCarPlayNetwork.shared.search(
      query: searchText,
      proximity:
        locationEngine.latestPose()?.rawCoordinate ??
        currentSnapshot?.currentLocation
    ) { [weak self] places in
      guard let self else {
        completionHandler([])
        return
      }
      searchItems = [:]
      let items = places.prefix(12).map { place -> CPListItem in
        let item = CPListItem(text: place.name, detailText: place.address)
        self.searchItems[ObjectIdentifier(item)] = place
        return item
      }
      completionHandler(items)
    }
  }

  public func searchTemplate(
    _ searchTemplate: CPSearchTemplate,
    selectedResult item: CPListItem,
    completionHandler: @escaping () -> Void
  ) {
    guard let place = searchItems[ObjectIdentifier(item)] else {
      completionHandler()
      return
    }
    requestRoutes(to: place)
    completionHandler()
  }
}

extension VroomCarPlayCoordinator: AVSpeechSynthesizerDelegate {
  public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didStart utterance: AVSpeechUtterance
  ) {
    let identifier = ObjectIdentifier(utterance)
    lastVoiceAt = Date()
    if let key = speechKeys[identifier] {
      pendingSpeechKeys.remove(key)
    }
    speechStartedCallbacks.removeValue(forKey: identifier)?()
  }

  public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finishSpeech(utterance)
  }

  public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finishSpeech(utterance)
  }

  private func finishSpeech(_ utterance: AVSpeechUtterance) {
    let identifier = ObjectIdentifier(utterance)
    if let key = speechKeys.removeValue(forKey: identifier) {
      pendingSpeechKeys.remove(key)
      if key == protectedSpeechKey {
        protectedSpeechKey = nil
      }
    }
    speechStartedCallbacks.removeValue(forKey: identifier)
    if !synthesizer.isSpeaking {
      try? AVAudioSession.sharedInstance().setActive(
        false,
        options: .notifyOthersOnDeactivation
      )
    }
  }
}
