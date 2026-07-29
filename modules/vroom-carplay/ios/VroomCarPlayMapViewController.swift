import CoreLocation
import Foundation
import MapboxMaps
import Turf
import UIKit

public final class VroomCarPlayMapViewController: UIViewController {
  public var onMapReady: (() -> Void)?

  private let mapView: MapView
  private let routeShadowManager: PolylineAnnotationManager
  private let routeManager: PolylineAnnotationManager
  private let alternativeManager: PolylineAnnotationManager
  private let builderRouteManager: PolylineAnnotationManager
  private let selfMarkerManager: PointAnnotationManager
  private let userMarkerManager: PointAnnotationManager
  private let warningMarkerManager: PointAnnotationManager
  private let poiMarkerManager: PointAnnotationManager
  private let destinationMarkerManager: PointAnnotationManager
  private let imageCache = NSCache<NSString, UIImage>()
  private let speedPanel = UIVisualEffectView(
    effect: UIBlurEffect(style: .systemUltraThinMaterialDark)
  )
  private let speedLabel = UILabel()
  private let speedUnitLabel = UILabel()
  private let limitLabel = UILabel()
  private var cancelables = Set<AnyCancelable>()
  private var currentSnapshot: VroomCarPlaySnapshot?
  private var liveUsers: [VroomMapMarker] = []
  private var nativeWarnings: [VroomMapMarker]?
  private var nativeCameras: [VroomMapMarker]?
  private var nativeFuelStations: [VroomMapMarker]?
  private var latestPose: VroomCarPlayPose?
  private var followMode = true
  private var hostNightMode = true
  private var lastCameraUpdateAt = 0.0
  private var currentStyleURI = ""
  private var previewRoutes: [VroomAlternativeRoute]?
  private var hiddenLayers = Set<VroomMarkerKind>()
  private var loadingImageURLs = Set<String>()

  public init() {
    if let token = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken")
      as? String,
      !token.isEmpty
    {
      MapboxOptions.accessToken = token
    }
    mapView = MapView(frame: .zero, mapInitOptions: MapInitOptions())
    routeShadowManager = mapView.annotations.makePolylineAnnotationManager(
      id: "vroom-carplay-route-shadow"
    )
    routeManager = mapView.annotations.makePolylineAnnotationManager(
      id: "vroom-carplay-route"
    )
    alternativeManager = mapView.annotations.makePolylineAnnotationManager(
      id: "vroom-carplay-alternatives"
    )
    builderRouteManager = mapView.annotations.makePolylineAnnotationManager(
      id: "vroom-carplay-builder-route"
    )
    selfMarkerManager = mapView.annotations.makePointAnnotationManager(
      id: "vroom-carplay-self"
    )
    userMarkerManager = mapView.annotations.makePointAnnotationManager(
      id: "vroom-carplay-users"
    )
    warningMarkerManager = mapView.annotations.makePointAnnotationManager(
      id: "vroom-carplay-warnings"
    )
    poiMarkerManager = mapView.annotations.makePointAnnotationManager(
      id: "vroom-carplay-pois"
    )
    destinationMarkerManager = mapView.annotations.makePointAnnotationManager(
      id: "vroom-carplay-destination"
    )
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  public override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    mapView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(mapView)
    NSLayoutConstraint.activate([
      mapView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      mapView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      mapView.topAnchor.constraint(equalTo: view.topAnchor),
      mapView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    configureAnnotationManagers()
    configureSpeedPanel()
    configureStyle(hostNightMode ? "dark" : "light")
    mapView.mapboxMap.onMapLoaded.observeNext { [weak self] _ in
      self?.onMapReady?()
    }.store(in: &cancelables)
  }

  public func apply(snapshot: VroomCarPlaySnapshot) {
    currentSnapshot = snapshot
    configureStyle(snapshot.mapStyle)
    renderRoutes(snapshot)
    renderMarkers(snapshot)
    updateSpeedPanel(
      speedMetersPerSecond:
        latestPose?.speedMetersPerSecond ??
        snapshot.speedMetersPerSecond ??
        0,
      limitKmh: snapshot.speedLimitKmh
    )
    if let location = snapshot.currentLocation, latestPose == nil {
      let pose = VroomCarPlayPose(
        coordinate: location,
        rawCoordinate: location,
        speedMetersPerSecond: snapshot.speedMetersPerSecond ?? 0,
        heading: snapshot.heading ?? 0,
        horizontalAccuracy: 0,
        timestamp: Date()
      )
      update(pose: pose)
    }
    if !snapshot.navigation.isNavigating, !snapshot.route.isEmpty {
      showRouteOverview(snapshot.route)
    }
  }

  public func applyLiveUsers(_ users: [VroomMapMarker]) {
    liveUsers = users
    renderUsers()
  }

  public func applyNativeRoadLayers(
    warnings: [VroomMapMarker]?,
    cameras: [VroomMapMarker]?,
    fuelStations: [VroomMapMarker]?
  ) {
    if let warnings {
      nativeWarnings = warnings
    }
    if let cameras {
      nativeCameras = cameras
    }
    if let fuelStations {
      nativeFuelStations = fuelStations
    }
    if let currentSnapshot {
      renderMarkers(currentSnapshot)
    }
  }

  public func update(pose: VroomCarPlayPose) {
    latestPose = pose
    renderSelfMarker(pose)
    updateSpeedPanel(
      speedMetersPerSecond: pose.speedMetersPerSecond,
      limitKmh: currentSnapshot?.speedLimitKmh
    )
    guard followMode else {
      return
    }
    let now = CACurrentMediaTime()
    guard now - lastCameraUpdateAt >= 1.0 / 30.0 else {
      return
    }
    lastCameraUpdateAt = now
    let speedKmh = pose.speedMetersPerSecond * 3.6
    let zoom: CGFloat = speedKmh >= 100 ? 14.3 : speedKmh >= 60 ? 15.0 : 15.7
    let pitch: CGFloat = speedKmh >= 15 ? 52 : 38
    let safeInsets = view.safeAreaInsets
    let camera = CameraOptions(
      center: pose.coordinate.cl,
      padding: UIEdgeInsets(
        top: max(72, safeInsets.top + 48),
        left: max(24, safeInsets.left + 12),
        bottom: max(155, safeInsets.bottom + 125),
        right: max(24, safeInsets.right + 12)
      ),
      anchor: CGPoint(x: view.bounds.midX, y: view.bounds.height * 0.68),
      zoom: zoom,
      bearing: pose.heading,
      pitch: pitch
    )
    mapView.mapboxMap.setCamera(to: camera)
  }

  public func setFollowMode(_ enabled: Bool) {
    followMode = enabled
    if enabled, let latestPose {
      lastCameraUpdateAt = 0
      update(pose: latestPose)
    }
  }

  public func recenter() {
    setFollowMode(true)
  }

  public func zoom(by delta: Double) {
    followMode = false
    let state = mapView.mapboxMap.cameraState
    mapView.camera.ease(
      to: CameraOptions(zoom: max(3, min(20, state.zoom + delta))),
      duration: 0.2,
      curve: .easeOut,
      completion: nil
    )
  }

  public func pan(horizontal: Double, vertical: Double) {
    followMode = false
    let state = mapView.mapboxMap.cameraState
    let span = max(0.0002, 0.02 / pow(2, state.zoom - 12))
    let center = CLLocationCoordinate2D(
      latitude: state.center.latitude + vertical * span,
      longitude: state.center.longitude + horizontal * span
    )
    mapView.camera.ease(
      to: CameraOptions(center: center),
      duration: 0.18,
      curve: .easeOut,
      completion: nil
    )
  }

  public func setHostNightMode(_ night: Bool) {
    hostNightMode = night
    configureStyle(night ? "dark" : "light")
  }

  public func setStyle(_ style: String) {
    configureStyle(style)
  }

  public func showRouteOverview(_ points: [VroomCoordinate]) {
    guard points.count >= 2 else {
      return
    }
    let line = LineString(points.map(\.cl))
    var options = OverviewViewportStateOptions(geometry: line)
    options.padding = UIEdgeInsets(
      top: 90,
      left: 70,
      bottom: 180,
      right: 70
    )
    options.bearing = 0
    options.pitch = 0
    options.maxZoom = 16
    let viewport = mapView.viewport.makeOverviewViewportState(options: options)
    mapView.viewport.transition(to: viewport)
    followMode = false
  }

  public func showRoutePreview(
    _ routes: [VroomAlternativeRoute],
    selectedIndex: Int
  ) {
    previewRoutes = routes
    var alternatives: [PolylineAnnotation] = []
    var selected: PolylineAnnotation?
    var selectedShadow: PolylineAnnotation?
    for route in routes {
      var annotation = PolylineAnnotation(
        id: "preview-\(route.index)",
        lineCoordinates: route.points.map(\.cl)
      )
      if route.index == selectedIndex {
        annotation.lineColor = StyleColor(
          traitCollection.userInterfaceStyle == .dark
            ? UIColor(red: 208 / 255, green: 107 / 255, blue: 1, alpha: 1)
            : UIColor(red: 132 / 255, green: 56 / 255, blue: 245 / 255, alpha: 1)
        )
        annotation.lineWidth = 8
        var shadow = PolylineAnnotation(
          id: "preview-shadow-\(route.index)",
          lineCoordinates: route.points.map(\.cl)
        )
        shadow.lineColor = StyleColor(
          UIColor(red: 16 / 255, green: 8 / 255, blue: 22 / 255, alpha: 0.94)
        )
        shadow.lineWidth = 12
        selected = annotation
        selectedShadow = shadow
      } else {
        annotation.lineColor = StyleColor(
          UIColor(red: 143 / 255, green: 150 / 255, blue: 163 / 255, alpha: 0.75)
        )
        annotation.lineWidth = 5
        alternatives.append(annotation)
      }
    }
    routeShadowManager.annotations = selectedShadow.map { [$0] } ?? []
    routeManager.annotations = selected.map { [$0] } ?? []
    alternativeManager.annotations = alternatives
    if let route = routes.first(where: { $0.index == selectedIndex }) {
      showRouteOverview(route.points)
    }
  }

  public func clearRoutePreview() {
    previewRoutes = nil
    if let currentSnapshot {
      renderRoutes(currentSnapshot)
    } else {
      routeShadowManager.annotations = []
      routeManager.annotations = []
      alternativeManager.annotations = []
    }
  }

  public func showActiveRoute(_ route: VroomAlternativeRoute) {
    showRoutePreview([route], selectedIndex: route.index)
    recenter()
  }

  public func setLayer(_ kind: VroomMarkerKind, visible: Bool) {
    if visible {
      hiddenLayers.remove(kind)
    } else {
      hiddenLayers.insert(kind)
    }
    if let currentSnapshot {
      renderMarkers(currentSnapshot)
    }
  }

  public func isLayerVisible(_ kind: VroomMarkerKind) -> Bool {
    !hiddenLayers.contains(kind)
  }

  private func configureAnnotationManagers() {
    routeShadowManager.lineCap = .round
    routeShadowManager.lineJoin = .round
    routeManager.lineCap = .round
    routeManager.lineJoin = .round
    alternativeManager.lineCap = .round
    alternativeManager.lineJoin = .round
    builderRouteManager.lineCap = .round
    builderRouteManager.lineJoin = .round
    builderRouteManager.lineDasharray = [1.5, 1]
    [
      selfMarkerManager,
      userMarkerManager,
      warningMarkerManager,
      poiMarkerManager,
      destinationMarkerManager,
    ].forEach {
      $0.iconAllowOverlap = true
      $0.iconIgnorePlacement = true
      $0.textAllowOverlap = false
      $0.textOptional = true
    }
    selfMarkerManager.iconRotationAlignment = .map
  }

  private func configureSpeedPanel() {
    speedPanel.translatesAutoresizingMaskIntoConstraints = false
    speedPanel.layer.cornerRadius = 18
    speedPanel.clipsToBounds = true
    view.addSubview(speedPanel)
    let stack = UIStackView(arrangedSubviews: [
      limitLabel,
      speedLabel,
      speedUnitLabel,
    ])
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    speedPanel.contentView.addSubview(stack)
    limitLabel.font = .systemFont(ofSize: 19, weight: .heavy)
    limitLabel.textColor = .black
    limitLabel.backgroundColor = .white
    limitLabel.textAlignment = .center
    limitLabel.layer.cornerRadius = 20
    limitLabel.layer.borderColor = UIColor.systemRed.cgColor
    limitLabel.layer.borderWidth = 4
    limitLabel.clipsToBounds = true
    speedLabel.font = .monospacedDigitSystemFont(ofSize: 34, weight: .bold)
    speedLabel.textColor = .white
    speedUnitLabel.font = .systemFont(ofSize: 12, weight: .semibold)
    speedUnitLabel.textColor = .secondaryLabel
    speedUnitLabel.text = "km/h"
    NSLayoutConstraint.activate([
      speedPanel.leadingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.leadingAnchor,
        constant: 18
      ),
      speedPanel.bottomAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.bottomAnchor,
        constant: -18
      ),
      stack.leadingAnchor.constraint(
        equalTo: speedPanel.contentView.leadingAnchor,
        constant: 12
      ),
      stack.trailingAnchor.constraint(
        equalTo: speedPanel.contentView.trailingAnchor,
        constant: -14
      ),
      stack.topAnchor.constraint(
        equalTo: speedPanel.contentView.topAnchor,
        constant: 9
      ),
      stack.bottomAnchor.constraint(
        equalTo: speedPanel.contentView.bottomAnchor,
        constant: -9
      ),
      limitLabel.widthAnchor.constraint(equalToConstant: 42),
      limitLabel.heightAnchor.constraint(equalToConstant: 42),
    ])
  }

  private func updateSpeedPanel(
    speedMetersPerSecond: Double,
    limitKmh: Int?
  ) {
    speedLabel.text = String(Int(max(0, speedMetersPerSecond * 3.6).rounded()))
    limitLabel.text = limitKmh.map(String.init) ?? "—"
    limitLabel.alpha = limitKmh == nil ? 0.45 : 1
  }

  private func configureStyle(_ value: String) {
    let uri: String
    let lowered = value.lowercased()
    if value.hasPrefix("mapbox://styles/") {
      uri = value
    } else if lowered.contains("satellite") {
      uri = "mapbox://styles/mapbox/satellite-streets-v12"
    } else if lowered.contains("light") {
      uri = "mapbox://styles/mapbox/streets-v12"
    } else {
      uri = "mapbox://styles/mapbox/navigation-night-v1"
    }
    guard currentStyleURI != uri, let styleURI = StyleURI(rawValue: uri) else {
      return
    }
    currentStyleURI = uri
    mapView.mapboxMap.loadStyleURI(styleURI)
  }

  private func renderRoutes(_ snapshot: VroomCarPlaySnapshot) {
    guard previewRoutes == nil else {
      return
    }
    let route = snapshot.route
    if route.count >= 2 {
      var shadow = PolylineAnnotation(
        id: "active-route-shadow",
        lineCoordinates: route.map(\.cl)
      )
      shadow.lineColor = StyleColor(
        UIColor(red: 16 / 255, green: 8 / 255, blue: 22 / 255, alpha: 0.94)
      )
      shadow.lineWidth = 12
      shadow.lineOpacity = 0.95
      routeShadowManager.annotations = [shadow]

      var primary = PolylineAnnotation(
        id: "active-route",
        lineCoordinates: route.map(\.cl)
      )
      primary.lineColor = StyleColor(
        snapshot.navigation.isNavigating
          ? (traitCollection.userInterfaceStyle == .dark
              ? UIColor(red: 208 / 255, green: 107 / 255, blue: 1, alpha: 1)
              : UIColor(red: 132 / 255, green: 56 / 255, blue: 245 / 255, alpha: 1))
          : UIColor(red: 143 / 255, green: 150 / 255, blue: 163 / 255, alpha: 0.85)
      )
      primary.lineWidth = snapshot.navigation.isNavigating ? 8 : 7
      primary.lineOpacity = 1
      routeManager.annotations = [primary]
    } else {
      routeShadowManager.annotations = []
      routeManager.annotations = []
    }

    alternativeManager.annotations = snapshot.alternatives
      .filter { $0.index != 0 }
      .map { route in
        var annotation = PolylineAnnotation(
          id: "alternative-\(route.index)",
          lineCoordinates: route.points.map(\.cl)
        )
        annotation.lineColor = StyleColor(
          UIColor(red: 143 / 255, green: 150 / 255, blue: 163 / 255, alpha: 0.75)
        )
        annotation.lineWidth = 5
        return annotation
      }

    if snapshot.builderRoute.count >= 2 {
      var builder = PolylineAnnotation(
        id: "builder-route",
        lineCoordinates: snapshot.builderRoute.map(\.cl)
      )
      builder.lineColor = StyleColor(.systemRed)
      builder.lineWidth = 5
      builderRouteManager.annotations = [builder]
    } else {
      builderRouteManager.annotations = []
    }
  }

  private func renderMarkers(_ snapshot: VroomCarPlaySnapshot) {
    renderUsers()
    warningMarkerManager.annotations =
      snapshot.showWarnings && !hiddenLayers.contains(.warning)
      ? (nativeWarnings ?? snapshot.warnings).prefix(60).map(markerAnnotation)
      : []
    var points: [VroomMapMarker] = []
    if snapshot.showCameras && !hiddenLayers.contains(.camera) {
      points.append(contentsOf: (nativeCameras ?? snapshot.cameras).prefix(60))
    }
    if snapshot.showFuel && !hiddenLayers.contains(.fuel) {
      points.append(
        contentsOf: (nativeFuelStations ?? snapshot.fuelStations).prefix(120)
      )
    }
    if snapshot.showPartners && !hiddenLayers.contains(.partner) {
      points.append(contentsOf: snapshot.partnerPOIs.prefix(80))
    }
    if !hiddenLayers.contains(.drop) {
      points.append(contentsOf: snapshot.geoDrops.prefix(60))
    }
    poiMarkerManager.annotations = points.map(markerAnnotation)
    if let destination = snapshot.destination {
      var annotation = PointAnnotation(
        id: "destination",
        coordinate: destination.coordinate.cl
      )
      annotation.image = .init(
        image: markerImage(
          kind: .partner,
          label: "C",
          color: .systemRed,
          size: 46
        ),
        name: "vroom-carplay-destination"
      )
      annotation.textField = destination.name
      annotation.textColor = StyleColor(.white)
      annotation.textHaloColor = StyleColor(.black)
      annotation.textHaloWidth = 1
      annotation.textSize = 12
      annotation.textOffset = [0, 2.2]
      destinationMarkerManager.annotations = [annotation]
    } else {
      destinationMarkerManager.annotations = []
    }
  }

  private func renderUsers() {
    guard
      let snapshot = currentSnapshot,
      snapshot.showUsers,
      !hiddenLayers.contains(.user)
    else {
      userMarkerManager.annotations = []
      return
    }
    let values = liveUsers.isEmpty ? snapshot.users : liveUsers
    userMarkerManager.annotations = values.prefix(40).map(markerAnnotation)
  }

  private func renderSelfMarker(_ pose: VroomCarPlayPose) {
    var annotation = PointAnnotation(
      id: "vroom-self",
      coordinate: pose.coordinate.cl
    )
    let markerStyle = currentSnapshot?.markerStyle ?? "arrow"
    let markerImageURL = currentSnapshot?.selfMarkerImageURL ?? ""
    let image: UIImage
    if markerStyle == "profile" {
      image =
        cachedImage(for: markerImageURL) ??
        markerImage(
          kind: .user,
          label: "V",
          color: .systemRed,
          size: 52
        )
      if !markerImageURL.isEmpty,
        cachedImage(for: markerImageURL) == nil
      {
        loadImage(markerImageURL)
      }
    } else {
      image = arrowImage(size: 58)
      annotation.iconRotate = pose.heading
    }
    annotation.image = .init(
      image: image,
      name:
        "vroom-carplay-self-\(markerStyle)-" +
        String(markerImageURL.hashValue)
    )
    annotation.iconSize = 1
    selfMarkerManager.annotations = [annotation]
  }

  private func markerAnnotation(_ marker: VroomMapMarker) -> PointAnnotation {
    var annotation = PointAnnotation(
      id: "\(marker.kind.rawValue)-\(marker.id)",
      coordinate: marker.coordinate.cl
    )
    let color: UIColor
    switch marker.kind {
    case .friend:
      color = .systemGreen
    case .user:
      color = .systemBlue
    case .warning:
      color = .systemOrange
    case .camera:
      color = .systemRed
    case .fuel:
      color = .systemGreen
    case .partner:
      color = self.color(from: marker.accentColor) ?? .systemYellow
    case .drop:
      color = .systemPurple
    case .builder:
      color = .systemRed
    }
    let label =
      marker.value.isEmpty
      ? String(marker.label.prefix(1)).uppercased()
      : String(marker.value.prefix(4))
    let fallback = markerImage(
      kind: marker.kind,
      label: label,
      color: color,
      size: marker.kind == .user || marker.kind == .friend ? 46 : 40
    )
    annotation.image = .init(
      image: cachedImage(for: marker.imageURL) ?? fallback,
      name:
        "vroom-marker-\(marker.kind.rawValue)-\(marker.id)-" +
        String(marker.imageURL.hashValue)
    )
    annotation.textField = marker.label
    annotation.textSize = 11
    annotation.textColor = StyleColor(.white)
    annotation.textHaloColor = StyleColor(.black)
    annotation.textHaloWidth = 1
    annotation.textOffset = [0, 2.15]
    if !marker.imageURL.isEmpty, cachedImage(for: marker.imageURL) == nil {
      loadImage(marker.imageURL)
    }
    return annotation
  }

  private func cachedImage(for url: String) -> UIImage? {
    guard !url.isEmpty else {
      return nil
    }
    return imageCache.object(forKey: url as NSString)
  }

  private func loadImage(_ value: String) {
    guard
      let url = URL(string: value),
      imageCache.object(forKey: value as NSString) == nil,
      !loadingImageURLs.contains(value)
    else {
      return
    }
    loadingImageURLs.insert(value)
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      defer {
        DispatchQueue.main.async {
          self?.loadingImageURLs.remove(value)
        }
      }
      guard let data, let image = UIImage(data: data) else {
        return
      }
      let normalized = self?.normalizedMarkerImage(image, size: 46) ?? image
      self?.imageCache.setObject(normalized, forKey: value as NSString)
      DispatchQueue.main.async {
        guard let snapshot = self?.currentSnapshot else {
          return
        }
        self?.renderMarkers(snapshot)
      }
    }.resume()
  }

  private func normalizedMarkerImage(_ image: UIImage, size: CGFloat) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    return renderer.image { _ in
      let bounds = CGRect(x: 2, y: 2, width: size - 4, height: size - 4)
      UIBezierPath(ovalIn: bounds).addClip()
      let scale = max(bounds.width / image.size.width, bounds.height / image.size.height)
      let drawnSize = CGSize(
        width: image.size.width * scale,
        height: image.size.height * scale
      )
      image.draw(
        in: CGRect(
          x: bounds.midX - drawnSize.width / 2,
          y: bounds.midY - drawnSize.height / 2,
          width: drawnSize.width,
          height: drawnSize.height
        )
      )
      UIColor.white.setStroke()
      let border = UIBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1))
      border.lineWidth = 3
      border.stroke()
    }
  }

  private func markerImage(
    kind: VroomMarkerKind,
    label: String,
    color: UIColor,
    size: CGFloat
  ) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    return renderer.image { context in
      let bounds = CGRect(x: 2, y: 2, width: size - 4, height: size - 4)
      context.cgContext.setShadow(
        offset: CGSize(width: 0, height: 2),
        blur: 4,
        color: UIColor.black.withAlphaComponent(0.7).cgColor
      )
      color.setFill()
      UIBezierPath(ovalIn: bounds).fill()
      UIColor.white.setStroke()
      let border = UIBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
      border.lineWidth = 3
      border.stroke()
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(
          ofSize: max(10, min(17, size * 0.31)),
          weight: .heavy
        ),
        .foregroundColor: UIColor.white,
        .paragraphStyle: paragraph,
      ]
      label.draw(
        in: CGRect(x: 0, y: size * 0.32, width: size, height: size * 0.4),
        withAttributes: attributes
      )
    }
  }

  private func arrowImage(size: CGFloat) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    return renderer.image { context in
      context.cgContext.setShadow(
        offset: CGSize(width: 0, height: 2),
        blur: 5,
        color: UIColor.black.cgColor
      )
      let path = UIBezierPath()
      path.move(to: CGPoint(x: size / 2, y: 3))
      path.addLine(to: CGPoint(x: size - 8, y: size - 8))
      path.addLine(to: CGPoint(x: size / 2, y: size * 0.72))
      path.addLine(to: CGPoint(x: 8, y: size - 8))
      path.close()
      UIColor(red: 0.89, green: 0.22, blue: 0.21, alpha: 1).setFill()
      path.fill()
      UIColor.white.setStroke()
      path.lineWidth = 3
      path.stroke()
    }
  }

  private func color(from hex: String) -> UIColor? {
    let clean = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard clean.count == 6, let value = Int(clean, radix: 16) else {
      return nil
    }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
