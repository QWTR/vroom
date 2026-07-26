package com.lexuuw.vroom.app.auto

import com.lexuuw.vroom.app.R

import android.app.Presentation
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.Choreographer
import android.widget.FrameLayout
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.SurfaceContainer
import androidx.car.app.SurfaceCallback
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.mapbox.bindgen.Value
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.ImageHolder
import com.mapbox.maps.Style
import com.mapbox.maps.plugin.LocationPuck2D
import com.mapbox.maps.plugin.PuckBearing
import com.mapbox.maps.ScreenCoordinate
import com.mapbox.maps.extension.style.layers.properties.generated.IconRotationAlignment
import com.mapbox.maps.plugin.annotation.annotations
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationOptions
import com.mapbox.maps.plugin.annotation.generated.PolylineAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.PolylineAnnotationOptions
import com.mapbox.maps.plugin.annotation.generated.createPointAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.createPolylineAnnotationManager
import com.mapbox.maps.plugin.attribution.attribution
import com.mapbox.maps.plugin.compass.compass
import com.mapbox.maps.plugin.logo.logo
import com.mapbox.maps.plugin.scalebar.scalebar
import com.mapbox.maps.plugin.locationcomponent.LocationConsumer
import com.mapbox.maps.plugin.locationcomponent.LocationProvider
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.maps.plugin.viewport.data.FollowPuckViewportStateBearing
import com.mapbox.maps.plugin.viewport.data.FollowPuckViewportStateOptions
import com.mapbox.maps.plugin.viewport.viewport
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private fun Rect.toViewportBounds(): AutoViewportBounds =
    AutoViewportBounds(left = left, top = top, right = right, bottom = bottom)

private const val MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"
private const val MAPBOX_NAV_DAY_STYLE = "mapbox://styles/mapbox/navigation-day-v1"
private const val MAPBOX_NAV_NIGHT_STYLE = "mapbox://styles/mapbox/navigation-night-v1"
private const val DEFAULT_LAT = 52.2297
private const val DEFAULT_LNG = 21.0122
private const val EARTH_RADIUS_M = 6_371_000.0
private const val AUTO_OSRM_BASE = "https://v-room.app/osrm"
private const val ROAD_MATCH_FRESH_MS = 8_000L

private class SnappedLocationProvider : LocationProvider {
    private val consumers = CopyOnWriteArraySet<LocationConsumer>()

    override fun registerLocationConsumer(locationConsumer: LocationConsumer) {
        consumers.add(locationConsumer)
    }

    override fun unRegisterLocationConsumer(locationConsumer: LocationConsumer) {
        consumers.remove(locationConsumer)
    }

    fun update(lat: Double, lng: Double, bearing: Double) {
        if (!lat.isFinite() || !lng.isFinite()) return
        val point = Point.fromLngLat(lng, lat)
        consumers.forEach { consumer ->
            consumer.onLocationUpdated(point)
            if (bearing.isFinite()) consumer.onBearingUpdated((bearing % 360.0 + 360.0) % 360.0)
        }
    }
}

class VroomMapSurfaceRenderer(private val carContext: CarContext) : DefaultLifecycleObserver, SurfaceCallback {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isNightModeActive = carContext.resources.configuration.isNightModeActive()
    private var loadedMapStyleUri = ""
    private var virtualDisplay: VirtualDisplay? = null
    private var presentation: Presentation? = null
    private var lifecycleOwner: SurfaceLifecycleOwner? = null
    private var mapView: MapView? = null
    private var overlay: VroomAutoOverlayView? = null
    private var visibleArea: Rect? = null
    private var stableArea: Rect? = null
    private var lockedUiArea: Rect? = null
    private var latestPayload: VroomPayload? = null
    private var userBrowsing = false
    private var lastCameraLat = Double.NaN
    private var lastCameraLng = Double.NaN
    private var lastCameraZoom = 16.85
    private var lastCameraBearing = 0.0
    private var lastCameraPitch = 48.0
    private var stableCameraSpeedKmh = 0.0
    private var stableCameraZoom = 16.85
    private var lastZoomUpdateAt = 0L
    private var lastUserInteractionAt = 0L
    private var lastRoutePreviewActive = false
    private var followViewportActive = false
    private var followViewportMode = ""
    private val snappedLocationProvider = SnappedLocationProvider()
    private var mapMarkerAnnotationManager: PointAnnotationManager? = null
    private var mapMarkerSignature = ""
    private val markerBitmapCache = linkedMapOf<String, Bitmap>()
    private val remoteBitmapCache = linkedMapOf<String, Bitmap>()
    private val loadingRemoteBitmaps = mutableSetOf<String>()
    private var routeAnnotationManager: PolylineAnnotationManager? = null
    private var routeAnnotationSignature = ""
    private var retainedRoutePoints: List<AutoRoutePoint> = emptyList()
    private var retainedRouteNavigating = false
    private var retainedRoutePreview = false
    private var lastDynamicRouteAnnotationAt = 0L
    private var poseTickActive = false
    @Volatile private var hudUiScale = 1f
    private var lastHudInsets: AutoHudInsets? = null
    private var lastViewportKey: String = ""
    private var surfaceWidth = 800
    private var surfaceHeight = 480
    private val poseTickRunnable = object : Runnable {
        override fun run() {
            if (mapView == null || overlay == null) {
                poseTickActive = false
                return
            }
            val frameNs = System.nanoTime()
            overlay?.tickRenderedPose(frameNs)
            overlay?.renderedPose()?.let { (lat, lng, heading) ->
                snappedLocationProvider.update(lat, lng, heading)
            }
            val snap = latestPayload
            val now = System.currentTimeMillis()
            if ((snap?.isNavigating == true || snap?.mapState?.routePreview == true) &&
                now - lastDynamicRouteAnnotationAt >= 250L
            ) {
                lastDynamicRouteAnnotationAt = now
                syncRouteAnnotation(snap)
            }
            mainHandler.postDelayed(this, 16L)
        }
    }

    private fun startPoseTickLoop() {
        if (poseTickActive) return
        poseTickActive = true
        mainHandler.post(poseTickRunnable)
    }

    private fun stopPoseTickLoop() {
        poseTickActive = false
        mainHandler.removeCallbacks(poseTickRunnable)
    }

    fun setNightModeActive(isNightModeActive: Boolean) {
        if (this.isNightModeActive == isNightModeActive) return
        this.isNightModeActive = isNightModeActive
        mainHandler.post {
            overlay?.setNightModeActive(isNightModeActive)
            applyMapStyle(force = true)
            overlay?.postInvalidateOnAnimation()
        }
    }

    private fun currentMapStyleUri(): String =
        if (isNightModeActive) MAPBOX_NAV_NIGHT_STYLE else MAPBOX_NAV_DAY_STYLE

    private fun applyMapStyle(force: Boolean = false) {
        val map = mapView?.getMapboxMap() ?: return
        val targetStyle = currentMapStyleUri()
        if (!force && loadedMapStyleUri == targetStyle) return
        loadedMapStyleUri = targetStyle
        routeAnnotationSignature = ""
        mapMarkerSignature = ""
        map.loadStyleUri(targetStyle) { style ->
            emphasizeRoadNetwork(style)
            syncRouteAnnotation(latestPayload)
            syncMapAnnotations(latestPayload, force = true)
            updateMap(forceFollow = true)
        }
    }

    private fun emphasizeRoadNetwork(style: Style) {
        style.styleLayers.forEach { layer ->
            val width = AutoMapStylePolicy.emphasizedRoadWidth(layer.id, layer.type) ?: return@forEach
            runCatching {
                style.setStyleLayerProperty(layer.id, "line-width", Value.valueOf(width))
                style.setStyleLayerProperty(layer.id, "line-opacity", Value.valueOf(1.0))
                if (isNightModeActive) {
                    AutoMapStylePolicy.nightRoadColor(layer.id, layer.type)?.let { color ->
                        style.setStyleLayerProperty(layer.id, "line-color", Value.valueOf(color))
                    }
                }
            }.onFailure { error ->
                Log.d("VroomAutoMap", "Road layer ${layer.id} could not be emphasized", error)
            }
        }
    }

    private fun Configuration.isNightModeActive(): Boolean =
        (uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private val returnToFollowRunnable = object : Runnable {
        override fun run() {
            val idleMs = System.currentTimeMillis() - lastUserInteractionAt
            if (userBrowsing && idleMs >= 2_500L) {
                userBrowsing = false
                updateMap(forceFollow = true)
            } else if (userBrowsing) {
                mainHandler.postDelayed(this, (2_500L - idleMs).coerceAtLeast(250L))
            }
        }
    }

    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        mainHandler.post {
            if (presentation == null || mapView == null) {
                releaseSurface()
                createMapPresentation(surfaceContainer)
            }
            updateMap()
        }
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        mainHandler.post { releaseSurface() }
    }

    override fun onVisibleAreaChanged(visibleArea: Rect) {
        // Android Auto already gives us the exact map pane. Expanding its top
        // edge puts our HUD under the host action strip in split-screen.
        val normalizedArea = Rect(visibleArea)
        val current = this.visibleArea
        val next = normalizedArea
        lockedUiArea = next
        this.visibleArea = next
        overlay?.visibleArea = next
        overlay?.invalidate()
        if (current == null || next != current) {
            lastHudInsets = null
            lastViewportKey = ""
            followViewportActive = false
            mainHandler.post {
                if (latestPayload?.mapState?.routePreview == true) updateMap() else activateFollowPuck(force = true)
            }
        }
    }

    override fun onStableAreaChanged(stableArea: Rect) {
        this.stableArea = Rect(stableArea)
        overlay?.visibleArea = this.visibleArea
        overlay?.stableArea = this.stableArea
        overlay?.invalidate()
        lastViewportKey = ""
        followViewportActive = false
        mainHandler.post {
            if (latestPayload?.mapState?.routePreview == true) updateMap() else activateFollowPuck(force = true)
        }
    }

    fun updateMapWithPayload(payload: VroomPayload) {
        latestPayload = payload
        mainHandler.post { updateMap() }
    }

    fun resyncMapMarkers() {
        mainHandler.post {
            mapMarkerSignature = ""
            syncMapAnnotations(latestPayload, force = true)
        }
    }

    fun updateNativeLocation(lat: Double, lng: Double, speedMs: Double, heading: Double) {
        mainHandler.post {
            if (VroomCarManager.isSimulationMode()) {
                snappedLocationProvider.update(lat, lng, heading)
                overlay?.handleLivePoseUpdate(lat, lng, speedMs, heading)
                startPoseTickLoop()
                return@post
            }
            val currentOverlay = overlay
            if (currentOverlay != null) {
                currentOverlay.handleLivePoseUpdate(lat, lng, speedMs, heading)
                currentOverlay.tickRenderedPose(System.nanoTime())
                currentOverlay.renderedPose()?.let { (poseLat, poseLng, poseHeading) ->
                    snappedLocationProvider.update(poseLat, poseLng, poseHeading)
                } ?: snappedLocationProvider.update(lat, lng, heading)
            } else {
                snappedLocationProvider.update(lat, lng, heading)
            }
            startPoseTickLoop()
        }
    }

    fun syncOverlayDrivingTelemetry(speedLimitKmh: Int?) {
        mainHandler.post {
            overlay?.syncDrivingTelemetry(speedLimitKmh)
        }
    }

    override fun onClick(x: Float, y: Float) {
        mainHandler.post {
            val action = overlay?.hitAction(x, y)
            if (overlay?.handleCustomAction(action) == true) return@post
            when (action) {
                "search" -> openSystemSearch()
                "report" -> overlay?.openReportMenu()
                "start_preview" -> VroomCarManager.startNativeRoutePreview()
                "cancel_preview" -> VroomCarManager.clearNativeRoutePreview()
                "stop_navigation" -> VroomCarManager.stopClick()
                "recenter" -> recenterFromHost()
                else -> {
                    if (action?.startsWith("route_alt_") == true) {
                        action.removePrefix("route_alt_").toIntOrNull()?.let { VroomCarManager.selectRoutePreviewIndex(it) }
                    }
                }
            }
        }
    }

    private fun openSystemSearch() {
        runCatching {
            carContext.getCarService(ScreenManager::class.java)
                .push(VroomSearchTextScreen(carContext))
        }.onFailure {
            Log.w("VroomAutoMap", "Unable to open Android Auto SearchTemplate", it)
        }
    }

    fun recenterFromHost() {
        mainHandler.post {
            userBrowsing = false
            followViewportActive = false
            lastUserInteractionAt = 0L
            mainHandler.removeCallbacks(returnToFollowRunnable)
            updateMap(forceFollow = true)
        }
    }

    override fun onScroll(distanceX: Float, distanceY: Float) {
        mainHandler.post {
            markUserBrowsing()
            val map = mapView?.getMapboxMap() ?: return@post
            val center = map.cameraState.center
            val screen = map.pixelForCoordinate(center)
            val next = map.coordinateForPixel(
                ScreenCoordinate(screen.x - distanceX.toDouble(), screen.y - distanceY.toDouble())
            )
            map.setCamera(CameraOptions.Builder().center(next).build())
            overlay?.postInvalidateOnAnimation()
        }
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        mainHandler.post {
            markUserBrowsing()
            val map = mapView?.getMapboxMap() ?: return@post
            val zoom = (map.cameraState.zoom + kotlin.math.log(scaleFactor.toDouble(), 2.0)).coerceIn(4.0, 20.0)
            map.setCamera(CameraOptions.Builder().zoom(zoom).build())
            overlay?.postInvalidateOnAnimation()
        }
    }

    private fun markUserBrowsing() {
        mapView?.viewport?.idle()
        followViewportActive = false
        userBrowsing = true
        lastUserInteractionAt = System.currentTimeMillis()
        mainHandler.removeCallbacks(returnToFollowRunnable)
        mainHandler.postDelayed(returnToFollowRunnable, 2_500L)
        overlay?.followMode = false
    }

    private fun createMapPresentation(surfaceContainer: SurfaceContainer) {
        val surface = surfaceContainer.surface ?: return
        if (!surface.isValid || surfaceContainer.width <= 0 || surfaceContainer.height <= 0) return
        surfaceWidth = surfaceContainer.width
        surfaceHeight = surfaceContainer.height

        MapboxOptions.accessToken = MAPBOX_ACCESS_TOKEN

        val displayManager = carContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        virtualDisplay = displayManager.createVirtualDisplay(
            "VROOM_ANDROID_AUTO_MAP",
            surfaceContainer.width,
            surfaceContainer.height,
            surfaceContainer.dpi.coerceAtLeast(160),
            surface,
            0
        )

        val display = virtualDisplay?.display ?: return
        val nextPresentation = Presentation(carContext, display)
        val root = FrameLayout(nextPresentation.context)
        val owner = SurfaceLifecycleOwner().apply {
            onCreate()
            onStart()
            onResume()
        }
        attachLifecycleOwner(root, owner)

        val nextMapView = MapView(
            nextPresentation.context,
            MapInitOptions(context = nextPresentation.context, textureView = true)
        )
        nextMapView.logo.updateSettings { enabled = false }
        nextMapView.attribution.updateSettings { enabled = false }
        nextMapView.compass.updateSettings { enabled = false }
        nextMapView.scalebar.updateSettings { enabled = false }
        loadedMapStyleUri = currentMapStyleUri()
        nextMapView.getMapboxMap().loadStyleUri(loadedMapStyleUri) { style ->
            emphasizeRoadNetwork(style)
            routeAnnotationSignature = ""
            mapMarkerSignature = ""
            mainHandler.post {
                syncRouteAnnotation(latestPayload)
                syncMapAnnotations(latestPayload, force = true)
            }
        }
        nextMapView.onStart()
        nextMapView.location.setLocationProvider(snappedLocationProvider)
        nextMapView.location.updateSettings {
            enabled = true
            locationPuck = LocationPuck2D(
                topImage = null,
                bearingImage = ImageHolder.from(R.drawable.vroom_location_arrow),
                shadowImage = null,
                opacity = 0f,
            )
            puckBearingEnabled = true
            puckBearing = PuckBearing.COURSE
            pulsingEnabled = false
        }
        mapMarkerAnnotationManager = nextMapView.annotations.createPointAnnotationManager().apply {
            iconRotationAlignment = IconRotationAlignment.VIEWPORT
            iconAllowOverlap = true
            iconIgnorePlacement = true
        }
        routeAnnotationManager = nextMapView.annotations.createPolylineAnnotationManager()

        val params = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.addView(nextMapView, params)

        val nextOverlay = VroomAutoOverlayView(nextPresentation.context).apply {
            mapView = nextMapView
            visibleArea = this@VroomMapSurfaceRenderer.visibleArea
            stableArea = this@VroomMapSurfaceRenderer.stableArea
            setNightModeActive(isNightModeActive)
            renderedPoseListener = { lat, lng, heading, _ ->
                snappedLocationProvider.update(lat, lng, heading)
            }
            hudInsetsListener = { insets, scale ->
                applyHudInsetsFromOverlay(insets, scale)
            }
        }
        root.addView(nextOverlay, params)

        nextPresentation.setContentView(root)
        nextPresentation.show()

        lifecycleOwner = owner
        presentation = nextPresentation
        mapView = nextMapView
        overlay = nextOverlay
        followViewportActive = false
        activateFollowPuck()
        startPoseTickLoop()
    }

    private fun updateMap(forceFollow: Boolean = false) {
        val payload = latestPayload
        val map = mapView?.getMapboxMap() ?: return
        overlay?.applyPayload(payload)
        syncRouteAnnotation(payload)
        syncMapAnnotations(payload)
        val routePreviewActive = payload?.mapState?.routePreview == true && payload.routePoints.size > 1
        val enteringRoutePreview = routePreviewActive && !lastRoutePreviewActive
        lastRoutePreviewActive = routePreviewActive
        if (enteringRoutePreview) userBrowsing = false

        if (routePreviewActive) {
            mapView?.viewport?.idle()
            followViewportActive = false
            routePreviewCamera(payload!!.routePoints)?.let { preview ->
                val insets = lastHudInsets ?: AutoHudInsets(30.0, 24.0, 30.0, 24.0)
                map.setCamera(
                    CameraOptions.Builder()
                        .center(Point.fromLngLat(preview.first.lng, preview.first.lat))
                        .zoom(preview.second)
                        .pitch(38.0)
                        .bearing(0.0)
                        .padding(EdgeInsets(insets.top, insets.left, insets.bottom, insets.right))
                        .build()
                )
            }
        } else if (forceFollow || !userBrowsing) {
            activateFollowPuck(force = forceFollow)
        }

        overlay?.followMode = !userBrowsing || forceFollow
        overlay?.mapView = mapView
        overlay?.visibleArea = visibleArea
        overlay?.postInvalidateOnAnimation()
    }

    private fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = sin(dLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
    }

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        return EARTH_RADIUS_M * 2.0 * kotlin.math.atan2(Math.sqrt(a.coerceIn(0.0, 1.0)), Math.sqrt(1.0 - a.coerceIn(0.0, 1.0)))
    }

    private fun activateFollowPuck(force: Boolean = false) {
        val viewport = mapView?.viewport ?: return
        val navigating = latestPayload?.isNavigating == true
        val mode = if (navigating) "navigation" else "free-drive"
        val speedKmh = latestPayload?.mapState?.speedKmh
            ?: ((latestPayload?.speed ?: 0.0) * 3.6)
        val targetSpec = AutoViewportPolicy.resolve(
            surfaceWidth = surfaceWidth,
            surfaceHeight = surfaceHeight,
            visibleArea = visibleArea?.toViewportBounds(),
            stableArea = stableArea?.toViewportBounds(),
            speedKmh = speedKmh,
            navigating = navigating,
            hudInsets = lastHudInsets,
        )
        var zoom = stableDynamicZoom(targetSpec.zoom)
        val mapWidth = (visibleArea?.width() ?: surfaceWidth).toDouble().coerceAtLeast(480.0)
        if (mapWidth > 900.0) {
            zoom += ((mapWidth - 900.0) / 900.0 * 0.5).coerceAtMost(0.75)
        }
        val viewportKey = buildString {
            append(mode).append(':')
            append(String.format(java.util.Locale.US, "%.2f", zoom)).append(':')
            append(targetSpec.topPadding.toInt()).append(':')
            append(targetSpec.leftPadding.toInt()).append(':')
            append(targetSpec.bottomPadding.toInt()).append(':')
            append(targetSpec.rightPadding.toInt())
        }
        if (followViewportActive && followViewportMode == mode && viewportKey == lastViewportKey && !force) return
        val options = FollowPuckViewportStateOptions.Builder()
            .bearing(FollowPuckViewportStateBearing.SyncWithLocationPuck)
            .zoom(zoom)
            .pitch(targetSpec.pitch)
            .padding(EdgeInsets(targetSpec.topPadding, targetSpec.leftPadding, targetSpec.bottomPadding, targetSpec.rightPadding))
            .build()
        followViewportMode = mode
        followViewportActive = true
        lastViewportKey = viewportKey
        viewport.transitionTo(viewport.makeFollowPuckViewportState(options))
    }

    private fun applyHudInsetsFromOverlay(insets: AutoHudInsets, uiScale: Float) {
        val scaleChanged = kotlin.math.abs(hudUiScale - uiScale) > 0.04f
        val insetsChanged = lastHudInsets?.nearlyEquals(insets) != true
        if (!scaleChanged && !insetsChanged) return
        hudUiScale = uiScale
        lastHudInsets = insets
        if (scaleChanged) {
            markerBitmapCache.clear()
            mapMarkerSignature = ""
            syncMapAnnotations(latestPayload, force = true)
            syncRouteAnnotation(latestPayload)
        }
        followViewportActive = false
        mainHandler.post {
            if (latestPayload?.mapState?.routePreview == true) updateMap() else activateFollowPuck(force = true)
        }
    }

    private fun markerDim(base: Int): Int = (base * hudUiScale).toInt().coerceIn(base, (base * 1.55f).toInt())
    private fun markerScaleKey(): String = String.format(java.util.Locale.US, "%.2f", hudUiScale)

    private fun syncMapAnnotations(payload: VroomPayload?, force: Boolean = false) {
        val manager = mapMarkerAnnotationManager ?: return
        if (payload == null) {
            if (mapMarkerSignature.isNotEmpty()) manager.deleteAll()
            mapMarkerSignature = ""
            return
        }
        // Dane live sa odswiezane natywnie miedzy kolejnymi payloadami z JS.
        // Bez tego mapa rysowala tylko przestarzala liste z ostatniego payloadu.
        val liveUsers = AutoNavStore.snapshot(carContext).users.map { marker ->
            UserMarker(
                id = marker.id,
                lat = marker.lat,
                lng = marker.lng,
                label = marker.label,
                type = marker.type,
                avatarUrl = marker.avatarUrl,
                avatarFrameUrl = marker.avatarFrameUrl,
                distanceLabel = marker.distanceLabel,
                isPremium = marker.isPremium,
                isFriend = marker.isFriend,
                markerSpriteUri = marker.markerSpriteUri,
                vehicleModelUrl = marker.vehicleModelUrl,
                vehicleModelMeta = marker.vehicleModelMeta,
            )
        }
        val users = if (payload.mapState.showUsers && AutoNavStore.showUsersLayer(carContext)) {
            liveUsers.take(40)
        } else {
            emptyList()
        }
        val fuelStations = resolvedPoiMarkers(
            payload.fuelStations,
            payload.mapState.showFuelStations && AutoNavStore.showFuelLayer(carContext),
            "fuelStations",
            "fuel",
        )
        val speedCameras = resolvedPoiMarkers(
            payload.speedCameras,
            payload.mapState.showSpeedCameras && AutoNavStore.showSpeedCamerasLayer(carContext),
            "speedCameras",
            "camera",
        )
        val partnerPois = resolvedPoiMarkers(
            payload.partnerPois,
            payload.mapState.showPartnerPois && AutoNavStore.showPartnersLayer(carContext),
            "partnerPois",
            "partner",
        )
        val warnings = if (payload.mapState.showWarnings && AutoNavStore.showWarningsLayer(carContext)) payload.warnings.take(42) else emptyList()
        val geoDrops = payload.mapState.geoDrops.take(40)
        val signature = buildString {
            append("scale:").append(markerScaleKey()).append('|')
            users.forEach { append("u:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.avatarUrl).append(':').append(it.avatarFrameUrl).append(':').append(it.distanceLabel).append(':').append(it.isPremium).append(':').append(it.isFriend).append(':').append(it.markerSpriteUri).append(':').append(it.vehicleModelUrl).append('|') }
            fuelStations.forEach { append("f:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.value).append(':').append(it.logoUrl).append(':').append(it.spriteUri).append('|') }
            speedCameras.forEach { append("c:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.value).append(':').append(it.spriteUri).append('|') }
            partnerPois.forEach { append("p:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.logoUrl).append(':').append(it.accentColor).append(':').append(it.spriteUri).append('|') }
            warnings.forEach { append("w:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.type).append(':').append(it.count).append('|') }
            geoDrops.forEach { append("g:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.status).append(':').append(it.spriteUri).append('|') }
            append("d:").append(payload.mapState.destinationLat).append(':').append(payload.mapState.destinationLng)
        }
        if (!force && signature == mapMarkerSignature) return
        mapMarkerSignature = signature
        if (markerBitmapCache.size > 180) markerBitmapCache.clear()
        manager.deleteAll()

        users.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, userMarkerBitmap(marker)) }
        fuelStations.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, poiMarkerBitmap(marker, PoiMarkerKind.FUEL)) }
        speedCameras.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, poiMarkerBitmap(marker, PoiMarkerKind.CAMERA)) }
        partnerPois.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, poiMarkerBitmap(marker, PoiMarkerKind.PARTNER)) }
        warnings.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, warningMarkerBitmap(marker)) }
        geoDrops.forEach { marker -> createMapAnnotation(manager, marker.lat, marker.lng, dropMarkerBitmap(marker)) }
        val destinationLat = payload.mapState.destinationLat
        val destinationLng = payload.mapState.destinationLng
        if (destinationLat != null && destinationLng != null) {
            createMapAnnotation(manager, destinationLat, destinationLng, destinationMarkerBitmap())
        }
    }

    private fun syncRouteAnnotation(payload: VroomPayload?) {
        val manager = routeAnnotationManager ?: return
        val visible = payload != null &&
            (payload.isNavigating || payload.mapState.routePreview || payload.mapState.isBuilding) &&
            !(payload.mapState.nativeRoadMatch && !payload.isNavigating && !payload.mapState.routePreview) &&
            payload.routePoints.size >= 2
        if (visible) {
            retainedRoutePoints = payload!!.routePoints
            retainedRouteNavigating = payload.isNavigating
            retainedRoutePreview = payload.mapState.routePreview
        }
        val fallbackPayload = if (!visible && VroomCarManager.hasActiveRouteSurface() && retainedRoutePoints.size >= 2) {
            payload?.copy(
                isNavigating = retainedRouteNavigating,
                routePoints = retainedRoutePoints,
            )
        } else {
            null
        }
        val effectivePayload = if (visible) payload else fallbackPayload
        val effectiveVisible = effectivePayload != null &&
            (effectivePayload.isNavigating || retainedRoutePreview) &&
            effectivePayload.routePoints.size >= 2
        if (!effectiveVisible) {
            if (routeAnnotationSignature.isNotEmpty()) manager.deleteAll()
            routeAnnotationSignature = ""
            retainedRoutePoints = emptyList()
            retainedRouteNavigating = false
            retainedRoutePreview = false
            return
        }
        val points = routeAnnotationPointsFromVehicle(effectivePayload!!, effectivePayload.routePoints)
        if (points.size < 2) {
            if (routeAnnotationSignature.isNotEmpty()) manager.deleteAll()
            routeAnnotationSignature = ""
            return
        }
        val signature = buildString {
            append(effectivePayload.isNavigating).append(':')
            append(retainedRoutePreview).append(':')
            append(isNightModeActive).append(':')
            append((hudUiScale * 100f).roundToInt()).append(':')
            effectivePayload.routePoints.forEach { append(it.lat).append(',').append(it.lng).append(';') }
        }
        if (signature == routeAnnotationSignature) return
        routeAnnotationSignature = signature
        manager.deleteAll()
        val routeGeometry = points.map { Point.fromLngLat(it.lng, it.lat) }
        val routeCasingColor = if (isNightModeActive) Color.rgb(0, 22, 40) else Color.rgb(12, 39, 58)
        val routeCoreColor = when {
            effectivePayload.isNavigating && isNightModeActive -> Color.rgb(105, 238, 255)
            effectivePayload.isNavigating -> Color.rgb(0, 178, 242)
            isNightModeActive -> Color.rgb(118, 240, 255)
            else -> Color.rgb(0, 166, 218)
        }
        // Two separate lines are intentional. Mapbox's annotation border could visually
        // swallow the cyan core on the night style; a casing plus a core stays legible.
        manager.create(
            PolylineAnnotationOptions()
                .withPoints(routeGeometry)
                .withLineColor(routeCasingColor)
                .withLineWidth((if (isNightModeActive) 25.0 else 22.0) * hudUiScale)
        )
        manager.create(
            PolylineAnnotationOptions()
                .withPoints(routeGeometry)
                .withLineColor(routeCoreColor)
                .withLineWidth((if (isNightModeActive) 14.0 else 12.0) * hudUiScale)
        )
    }

    private fun routeAnnotationPointsFromVehicle(
        snap: VroomPayload,
        points: List<AutoRoutePoint>
    ): List<AutoRoutePoint> {
        if ((!snap.isNavigating && !snap.mapState.routePreview) || points.size < 2) return points
        val rendered = overlay?.renderedPose()
        val lat = when {
            snap.isNavigating -> rendered?.first ?: snap.userLat
            else -> rendered?.first ?: snap.userLat
        } ?: return points
        val lng = when {
            snap.isNavigating -> rendered?.second ?: snap.userLng
            else -> rendered?.second ?: snap.userLng
        } ?: return points
        val geometryPoints = points.map { AutoRouteGeometry.RoutePoint(it.lat, it.lng) }
        val minArc = if (snap.isNavigating) {
            overlay?.routeProgressArcM()?.let { (it - 35.0).coerceAtLeast(0.0) } ?: 0.0
        } else {
            0.0
        }
        return AutoRouteGeometry.trimRouteFromVehicle(
            geometryPoints,
            lat,
            lng,
            snap.isNavigating,
            minArc,
        ).map { AutoRoutePoint(it.lat, it.lng) }
    }

    private fun isOffRouteFromPayload(snap: VroomPayload?, points: List<AutoRoutePoint>): Boolean {
        if (snap?.isNavigating != true || points.size < 2) return false
        val rendered = overlay?.renderedPose()
        val lat = rendered?.first ?: snap.userLat ?: return false
        val lng = rendered?.second ?: snap.userLng ?: return false
        val projection = projectOnRoute(lat, lng, points, 90.0) ?: return true
        return projection.distanceM > 28.0
    }

    private data class RouteProjection(
        val arcM: Double,
        val distanceM: Double,
        val lat: Double,
        val lng: Double,
        val segmentIndex: Int
    )

    private fun projectOnRoute(
        lat: Double,
        lng: Double,
        points: List<AutoRoutePoint>,
        maxDistanceM: Double
    ): RouteProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var bestArc = 0.0
        var bestDistance = Double.POSITIVE_INFINITY
        var bestLat = lat
        var bestLng = lng
        var bestIndex = 0
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val latScale = cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
            val ax = a.lng * latScale
            val ay = a.lat
            val bx = b.lng * latScale
            val by = b.lat
            val px = lng * latScale
            val py = lat
            val vx = bx - ax
            val vy = by - ay
            val len2 = vx * vx + vy * vy
            val t = if (len2 > 0.0) (((px - ax) * vx + (py - ay) * vy) / len2).coerceIn(0.0, 1.0) else 0.0
            val projLat = a.lat + (b.lat - a.lat) * t
            val projLng = a.lng + (b.lng - a.lng) * t
            val distM = distanceMeters(lat, lng, projLat, projLng)
            if (distM < bestDistance) {
                bestDistance = distM
                bestArc = cumM + segM * t
                bestLat = projLat
                bestLng = projLng
                bestIndex = i
            }
            cumM += segM
        }
        return RouteProjection(bestArc, bestDistance, bestLat, bestLng, bestIndex).takeIf { bestDistance <= maxDistanceM }
    }

    private fun resolvedPoiMarkers(
        fromPayload: List<AutoPoiMarker>,
        enabled: Boolean,
        mapStateKey: String,
        fallbackType: String,
    ): List<AutoPoiMarker> {
        if (!enabled) return emptyList()
        if (fromPayload.isNotEmpty()) return fromPayload.take(40)
        return nativeCachedPoiMarkers(mapStateKey, fallbackType).take(40)
    }

    private fun nativeCachedPoiMarkers(mapStateKey: String, fallbackType: String): List<AutoPoiMarker> {
        val cached = AutoNavStore.cachedMapState?.optJSONArray(mapStateKey)
            ?: runCatching {
                JSONObject(
                    carContext.getSharedPreferences("vroom_auto_nav", Context.MODE_PRIVATE)
                        .getString("map_state", "{}") ?: "{}",
                ).optJSONArray(mapStateKey)
            }.getOrNull()
            ?: return emptyList()
        return VroomPayloadParser.parsePoiMarkersPublic(cached, fallbackType)
    }

    private fun createMapAnnotation(manager: PointAnnotationManager, lat: Double, lng: Double, bitmap: Bitmap) {
        if (!lat.isFinite() || !lng.isFinite()) return
        manager.create(
            PointAnnotationOptions()
                .withPoint(Point.fromLngLat(lng, lat))
                .withIconImage(bitmap)
                .withIconSize(1.0),
        )
    }

    private enum class PoiMarkerKind { FUEL, CAMERA, PARTNER }

    private fun userMarkerBitmap(marker: UserMarker): Bitmap {
        remoteMarkerBitmap(marker.markerSpriteUri)?.let { return it }
        val accent = when {
            marker.isPremium -> Color.rgb(255, 215, 0)
            marker.isFriend || marker.type == "friend" -> Color.rgb(77, 233, 38)
            else -> Color.rgb(0, 191, 255)
        }
        val avatar = remoteMarkerBitmap(marker.avatarUrl)
        val frame = remoteMarkerBitmap(marker.avatarFrameUrl)
        val key = "user:${markerScaleKey()}:${marker.id}:${marker.label}:${marker.distanceLabel}:$accent:${avatar != null}:${frame != null}"
        return markerBitmapCache.getOrPut(key) {
            val w = markerDim(124)
            val h = markerDim(120)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val sx = w / 124f
            val sy = h / 120f
            canvas.scale(sx, sy)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(232, 17, 17, 17) }
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(if (marker.isPremium) 255 else 150, Color.red(accent), Color.green(accent), Color.blue(accent))
                style = Paint.Style.STROKE
                strokeWidth = if (marker.isPremium) 3f else 1.8f
            }
            val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = 11f }
            val labelRect = RectF(7f, 2f, 117f, 48f)
            canvas.drawRoundRect(labelRect, 13f, 13f, fill)
            canvas.drawRoundRect(labelRect, 13f, 13f, stroke)
            canvas.drawText(marker.label.take(16), 62f, 21f, text)
            canvas.drawCircle(39f, 35f, 3f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(77, 233, 38) })
            text.color = accent; text.textSize = 9f
            canvas.drawText(marker.distanceLabel.ifBlank { "ONLINE" }.take(12), 67f, 38f, text)
            stroke.style = Paint.Style.FILL; stroke.color = Color.argb(150, Color.red(accent), Color.green(accent), Color.blue(accent))
            canvas.drawRoundRect(RectF(61f, 48f, 63f, 55f), 1f, 1f, stroke)
            val avatarCenterX = 62f; val avatarCenterY = 79f; val avatarRadius = 21f
            canvas.drawCircle(avatarCenterX, avatarCenterY, avatarRadius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(61, 61, 61) })
            if (avatar != null) {
                val clip = Path().apply { addCircle(avatarCenterX, avatarCenterY, avatarRadius - 1f, Path.Direction.CW) }
                canvas.save(); canvas.clipPath(clip)
                canvas.drawBitmap(avatar, null, RectF(41f, 58f, 83f, 100f), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                canvas.restore()
            } else {
                val initials = marker.label.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }.ifBlank { "U" }
                text.color = Color.WHITE; text.textSize = 15f
                canvas.drawText(initials, avatarCenterX, avatarCenterY + 5f, text)
            }
            stroke.style = Paint.Style.STROKE; stroke.strokeWidth = if (marker.isPremium) 3f else 2f; stroke.color = accent
            canvas.drawCircle(avatarCenterX, avatarCenterY, avatarRadius, stroke)
            if (frame != null) canvas.drawBitmap(frame, null, RectF(36f, 53f, 88f, 105f), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            if (marker.isPremium) {
                canvas.drawCircle(87f, 56f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(255, 215, 0) })
                text.color = Color.BLACK; text.textSize = 10f; canvas.drawText("P", 87f, 60f, text)
            }
            val tip = Path().apply { moveTo(55f, 102f); lineTo(69f, 102f); lineTo(62f, 116f); close() }
            stroke.style = Paint.Style.FILL; stroke.color = accent; canvas.drawPath(tip, stroke)
            bitmap
        }
    }

    private fun poiMarkerBitmap(marker: AutoPoiMarker, kind: PoiMarkerKind): Bitmap {
        remoteMarkerBitmap(marker.spriteUri)?.let { return it }
        val accent = when (kind) {
            PoiMarkerKind.FUEL -> Color.rgb(43, 140, 255)
            PoiMarkerKind.CAMERA -> Color.rgb(255, 212, 59)
            PoiMarkerKind.PARTNER -> parseMarkerColor(marker.accentColor, Color.rgb(255, 215, 0))
        }
        val logo = remoteMarkerBitmap(marker.logoUrl)
        val key = "poi:$kind:${markerScaleKey()}:${marker.id}:${marker.label}:${marker.value}:$accent:${logo != null}"
        return markerBitmapCache.getOrPut(key) {
            val w = markerDim(96)
            val h = markerDim(92)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.scale(w / 96f, h / 92f)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(18, 24, 32) }
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; style = Paint.Style.STROKE; strokeWidth = 2f }
            val body = RectF(7f, 2f, 89f, 78f)
            canvas.drawRoundRect(body, 14f, 14f, fill); canvas.drawRoundRect(body, 14f, 14f, stroke)
            canvas.drawCircle(48f, 25f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
            if (logo != null) {
                canvas.drawBitmap(logo, null, RectF(37f, 14f, 59f, 36f), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            } else {
                val iconText = when (kind) {
                    PoiMarkerKind.FUEL -> "F"
                    PoiMarkerKind.CAMERA -> marker.value.ifBlank { "!" }.take(3)
                    PoiMarkerKind.PARTNER -> "VR"
                }
                val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = if (kind == PoiMarkerKind.CAMERA) 13f else 11f }
                canvas.drawText(iconText, 48f, 30f, iconPaint)
            }
            val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (kind == PoiMarkerKind.PARTNER) accent else Color.rgb(216, 233, 255); textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = 9f }
            canvas.drawText((if (kind == PoiMarkerKind.PARTNER) "PARTNER" else marker.label.uppercase()).take(13), 48f, 51f, text)
            text.color = if (kind == PoiMarkerKind.FUEL) Color.rgb(125, 211, 252) else Color.WHITE
            val bottomLabel = when (kind) { PoiMarkerKind.FUEL -> marker.value.takeIf { it.isNotBlank() } ?: "BRAK CENY"; PoiMarkerKind.CAMERA -> marker.label.take(12); PoiMarkerKind.PARTNER -> marker.label.take(13) }
            canvas.drawText(bottomLabel, 48f, 66f, text)
            val tip = Path().apply { moveTo(41f, 78f); lineTo(55f, 78f); lineTo(48f, 90f); close() }
            stroke.style = Paint.Style.FILL; canvas.drawPath(tip, stroke)
            bitmap
        }
    }

    private fun warningMarkerBitmap(marker: WarningMarker): Bitmap {
        val accent = when (marker.type) { "traffic" -> Color.rgb(255, 107, 107); "weather" -> Color.rgb(255, 212, 59); "accident" -> Color.rgb(255, 146, 43); "speed_control" -> Color.rgb(5, 53, 247); else -> Color.rgb(232, 154, 54) }
        val key = "warning:${markerScaleKey()}:${marker.type}:${marker.count}:$accent"
        return markerBitmapCache.getOrPut(key) {
            val w = markerDim(56)
            val h = markerDim(58)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
            canvas.scale(w / 56f, h / 58f)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent }
            canvas.drawPath(Path().apply { moveTo(28f, 3f); lineTo(3f, 48f); lineTo(53f, 48f); close() }, fill)
            canvas.drawText("!", 28f, 41f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = 27f })
            bitmap
        }
    }

    private fun dropMarkerBitmap(marker: AutoGeoDrop): Bitmap {
        remoteMarkerBitmap(marker.spriteUri)?.let { return it }
        val key = "drop:${markerScaleKey()}:${marker.id}:${marker.status}"
        return markerBitmapCache.getOrPut(key) {
            val w = markerDim(76)
            val h = markerDim(84)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.scale(w / 76f, h / 84f)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(12, 13, 18) }
            val gold = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(255, 215, 0); style = Paint.Style.STROKE; strokeWidth = 3f }
            val red = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(227, 56, 53); style = Paint.Style.FILL }
            val body = RectF(8f, 4f, 68f, 64f)
            canvas.drawRoundRect(body, 16f, 16f, fill)
            canvas.drawRoundRect(body, 16f, 16f, gold)
            canvas.drawCircle(38f, 34f, 16f, red)
            canvas.drawText("V", 38f, 42f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textAlign = Paint.Align.CENTER
                isFakeBoldText = true
                textSize = 22f
            })
            canvas.drawPath(Path().apply { moveTo(29f, 64f); lineTo(47f, 64f); lineTo(38f, 82f); close() }, red)
            bitmap
        }
    }

    private fun destinationMarkerBitmap(): Bitmap = markerBitmapCache.getOrPut("destination:${markerScaleKey()}") {
        val w = markerDim(52)
        val h = markerDim(58)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
        canvas.scale(w / 52f, h / 58f)
        val red = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(227, 56, 53) }
        canvas.drawCircle(26f, 24f, 21f, red); canvas.drawCircle(26f, 24f, 8f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        canvas.drawPath(Path().apply { moveTo(18f, 41f); lineTo(34f, 41f); lineTo(26f, 56f); close() }, red)
        bitmap
    }

    private fun parseMarkerColor(value: String, fallback: Int): Int = runCatching { Color.parseColor(value) }.getOrDefault(fallback)

    private fun remoteMarkerBitmap(url: String): Bitmap? {
        val clean = url.trim()
        if (clean.isBlank()) return null
        remoteBitmapCache[clean]?.let { return it }
        if (!loadingRemoteBitmaps.add(clean)) return null
        Thread {
            val decoded = runCatching {
                when {
                    clean.startsWith("file://", ignoreCase = true) -> BitmapFactory.decodeFile(URL(clean).path)
                    clean.startsWith("/") -> BitmapFactory.decodeFile(clean)
                    else -> {
                        val connection = URL(clean).openConnection() as HttpURLConnection
                        connection.connectTimeout = 2_500; connection.readTimeout = 2_500
                        connection.inputStream.use { BitmapFactory.decodeStream(it) }
                    }
                }
            }.getOrNull()
            mainHandler.post {
                loadingRemoteBitmaps.remove(clean)
                if (decoded != null) {
                    val longest = kotlin.math.max(decoded.width, decoded.height)
                    val cached = if (longest > 256) {
                        val scale = 256f / longest.toFloat()
                        Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt().coerceAtLeast(1), (decoded.height * scale).toInt().coerceAtLeast(1), true)
                    } else decoded
                    if (remoteBitmapCache.size >= 96) {
                        remoteBitmapCache.keys.firstOrNull()?.let(remoteBitmapCache::remove)
                    }
                    remoteBitmapCache[clean] = cached
                    markerBitmapCache.clear(); mapMarkerSignature = ""
                    syncMapAnnotations(latestPayload, force = true)
                }
            }
        }.start()
        return null
    }

    private fun stableDynamicZoom(desiredZoom: Double): Double {
        val now = System.currentTimeMillis()
        val dt = if (lastZoomUpdateAt > 0L) (now - lastZoomUpdateAt).coerceIn(1L, 900L).toDouble() else 180.0
        lastZoomUpdateAt = now
        if (!stableCameraZoom.isFinite()) stableCameraZoom = desiredZoom
        val delta = desiredZoom - stableCameraZoom
        if (kotlin.math.abs(delta) < 0.045) return stableCameraZoom
        val maxStep = 0.22 * (dt / 1000.0)
        stableCameraZoom = (stableCameraZoom + delta.coerceIn(-maxStep, maxStep)).coerceIn(15.80, 17.85)
        return stableCameraZoom
    }

    fun showDriverAlert(text: String) {
        mainHandler.post { overlay?.showDriverAlert(text) }
    }





    private fun routePreviewCamera(points: List<AutoRoutePoint>): Pair<AutoRoutePoint, Double>? {
        if (points.size < 2) return null
        var minLat = Double.POSITIVE_INFINITY
        var maxLat = Double.NEGATIVE_INFINITY
        var minLng = Double.POSITIVE_INFINITY
        var maxLng = Double.NEGATIVE_INFINITY
        points.forEach { p ->
            minLat = kotlin.math.min(minLat, p.lat)
            maxLat = kotlin.math.max(maxLat, p.lat)
            minLng = kotlin.math.min(minLng, p.lng)
            maxLng = kotlin.math.max(maxLng, p.lng)
        }
        if (!minLat.isFinite() || !minLng.isFinite()) return null
        val center = AutoRoutePoint((minLat + maxLat) / 2.0, (minLng + maxLng) / 2.0)
        val latSpan = (maxLat - minLat).coerceAtLeast(0.001)
        val lngSpan = (maxLng - minLng).coerceAtLeast(0.001)
        val span = kotlin.math.max(latSpan, lngSpan)
        val zoom = when {
            span > 1.2 -> 7.8
            span > 0.55 -> 8.8
            span > 0.25 -> 10.0
            span > 0.10 -> 11.2
            span > 0.045 -> 12.4
            span > 0.018 -> 13.7
            span > 0.008 -> 14.8
            else -> 15.7
        }
        return Pair(center, zoom)
    }

    private fun attachLifecycleOwner(view: View, owner: LifecycleOwner) {
        runCatching {
            val clazz = Class.forName("androidx.lifecycle.ViewTreeLifecycleOwner")
            val method = clazz.getMethod("set", View::class.java, LifecycleOwner::class.java)
            method.invoke(null, view, owner)
        }.onFailure {
            Log.w("VroomMapSurfaceRenderer", "Brak właściciela cyklu życia widoku")
        }
    }

    private fun releaseSurface() {
        stopPoseTickLoop()
        lifecycleOwner?.onDestroy()
        lifecycleOwner = null
        runCatching { mapView?.location?.updateSettings { enabled = false } }
        runCatching { mapMarkerAnnotationManager?.deleteAll() }
        runCatching { routeAnnotationManager?.deleteAll() }
        mapMarkerAnnotationManager = null
        routeAnnotationManager = null
        mapMarkerSignature = ""
        routeAnnotationSignature = ""
        markerBitmapCache.clear()
        remoteBitmapCache.clear()
        loadingRemoteBitmaps.clear()
        runCatching { mapView?.onStop() }
        runCatching { mapView?.onDestroy() }
        mapView = null
        followViewportActive = false
        followViewportMode = ""
        overlay = null
        runCatching { presentation?.dismiss() }
        presentation = null
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
    }


    override fun onDestroy(owner: LifecycleOwner) {
        releaseSurface()
    }
}

private class SurfaceLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)

    init {
        registry.currentState = Lifecycle.State.INITIALIZED
    }

    override val lifecycle: Lifecycle
        get() = registry

    fun onCreate() {
        registry.currentState = Lifecycle.State.CREATED
    }

    fun onStart() {
        registry.currentState = Lifecycle.State.STARTED
    }

    fun onResume() {
        registry.currentState = Lifecycle.State.RESUMED
    }

    fun onDestroy() {
        registry.currentState = Lifecycle.State.DESTROYED
    }
}

private class VroomAutoOverlayView(context: Context) : View(context) {
    private val overlayContext = context.applicationContext

    private enum class AutoUiMode {
        FREE_DRIVE,
        SEARCH_RESULTS,
        ROUTE_PREVIEW,
        NAVIGATING,
        REPORT_MENU,
        LOADING,
        ERROR_TOAST
    }

    private data class SearchResultItem(
        val id: String,
        val name: String,
        val address: String,
        val lat: Double,
        val lng: Double,
        val routableLat: Double? = null,
        val routableLng: Double? = null,
        val etaText: String = ""
    )

    private data class RouteOrigin(
        val lat: Double,
        val lng: Double,
        val speedMs: Double,
        val heading: Double
    )

    private val overlayHandler = Handler(Looper.getMainLooper())
    private var payload: VroomPayload? = null
    var mapView: MapView? = null
    var visibleArea: Rect? = null
    var stableArea: Rect? = null
    var hudInsetsListener: ((AutoHudInsets, Float) -> Unit)? = null
    var followMode: Boolean = true
    var renderedPoseListener: ((Double, Double, Double, Double) -> Unit)? = null
    private var uiMode = AutoUiMode.FREE_DRIVE
    private var searchQuery = ""
    private var searchLoading = false
    private var searchSeq = 0
    private var searchResults: List<SearchResultItem> = emptyList()
    private var toastText: String? = null
    private var toastUntil = 0L
    private val hitRects = linkedMapOf<String, RectF>()
    private var avatarBitmap: Bitmap? = null
    private var avatarUrlLoaded = ""
    private var avatarLoading = false
    private var displayedLat: Double? = null
    private var displayedLng: Double? = null
    private var displayedHeading = 0.0
    private var targetLat: Double? = null
    private var targetLng: Double? = null
    private var targetHeading = 0.0
    private var displayedSpeedKmh = 0.0
    private var targetSpeedKmh = 0.0
    private var lastFrameAtNs = 0L
    private var frameLoopScheduled = false
    private var lastRerouteCheckAt = 0L
    private var routeCursorSignature = 0
    private var routeCursorArcM = Double.NaN
    private var routeTargetArcM = Double.NaN
    private var segmentStartLat: Double? = null
    private var segmentStartLng: Double? = null
    private var segmentStartArcM = Double.NaN
    private var segmentStartedAtMs = 0L
    private var segmentDurationMs = 1_000L
    private var activeMotionPoints: List<AutoRoutePoint> = emptyList()
    private var activeMotionIsNavigating = false
    private var coldStartPose = true
    private var lastGpsAt = 0L
    private var stickySpeedLimitKmh: Int? = null
    private var lastMeasuredLat: Double? = null
    private var lastMeasuredLng: Double? = null
    private var lastMeasuredAt = 0L
    private var lastRoadFixLat: Double? = null
    private var lastRoadFixLng: Double? = null
    private var lastRoadFixAt = 0L
    private var lastReliableSpeedKmh = 0.0
    private var lastMotionEvidenceAt = 0L
    private var lastPoseDiagnosticAt = 0L
    private var lastManeuverSignature = ""
    private var maneuverTransitionStartedAt = 0L

    private data class RoadProjection(
        val lat: Double,
        val lng: Double,
        val arcM: Double,
        val segmentIndex: Int,
        val distanceM: Double
    )

    private data class RoadStep(
        val lat: Double,
        val lng: Double,
        val heading: Double
    )

    private data class RoadFixDelta(
        val elapsedSeconds: Double,
        val distanceMeters: Double,
        val isNewFix: Boolean,
    )

    private data class AutoHudTheme(
        val panel: Int,
        val elevatedPanel: Int,
        val input: Int,
        val chip: Int,
        val chipSelected: Int,
        val textPrimary: Int,
        val textSecondary: Int,
        val textMuted: Int,
        val divider: Int,
        val border: Int,
        val accent: Int,
        val positive: Int,
        val destructiveText: Int,
        val cancelIcon: Int
    ) {
        companion object {
            val Night = AutoHudTheme(
                panel = Color.argb(246, 8, 10, 14),
                elevatedPanel = Color.argb(244, 16, 20, 28),
                input = Color.rgb(28, 34, 44),
                chip = Color.rgb(32, 38, 48),
                chipSelected = Color.rgb(227, 56, 53),
                textPrimary = Color.WHITE,
                textSecondary = Color.rgb(216, 224, 235),
                textMuted = Color.rgb(156, 166, 180),
                divider = Color.argb(90, 255, 255, 255),
                border = Color.argb(145, 255, 255, 255),
                accent = Color.rgb(36, 202, 255),
                positive = Color.rgb(45, 212, 120),
                destructiveText = Color.rgb(255, 126, 126),
                cancelIcon = Color.rgb(232, 238, 244)
            )

            val Day = AutoHudTheme(
                panel = Color.argb(246, 248, 250, 252),
                elevatedPanel = Color.argb(244, 255, 255, 255),
                input = Color.rgb(232, 238, 240),
                chip = Color.rgb(232, 238, 238),
                chipSelected = Color.rgb(227, 56, 53),
                textPrimary = Color.rgb(28, 31, 36),
                textSecondary = Color.rgb(45, 48, 54),
                textMuted = Color.rgb(92, 96, 104),
                divider = Color.rgb(222, 226, 230),
                border = Color.argb(95, 0, 0, 0),
                accent = Color.rgb(0, 112, 176),
                positive = Color.rgb(42, 120, 74),
                destructiveText = Color.rgb(166, 24, 45),
                cancelIcon = Color.rgb(30, 34, 38)
            )
        }
    }

    private var isNightModeActive = true
    private val hudTheme: AutoHudTheme
        get() = if (isNightModeActive) AutoHudTheme.Night else AutoHudTheme.Day

    private val routeShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(4, 12, 22)
        style = Paint.Style.STROKE
        strokeWidth = 23f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(48, 218, 255)
        style = Paint.Style.STROKE
        strokeWidth = 13f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val panelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(232, 8, 8, 10)
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(227, 56, 53)
        style = Paint.Style.STROKE
        strokeWidth = 2.4f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 22f
        isFakeBoldText = true
    }
    private val smallText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 17f
        textAlign = Paint.Align.LEFT
    }

    fun setNightModeActive(isNightModeActive: Boolean) {
        if (this.isNightModeActive == isNightModeActive) return
        this.isNightModeActive = isNightModeActive
        postInvalidateOnAnimation()
    }

    fun syncDrivingTelemetry(speedLimitKmh: Int?) {
        if (speedLimitKmh != null && speedLimitKmh > 0) {
            stickySpeedLimitKmh = speedLimitKmh
            postInvalidateOnAnimation()
        }
    }

    fun applyPayload(next: VroomPayload?) {
        val wasNavigating = payload?.isNavigating == true
        val maneuverSignature = next?.let {
            "${it.maneuver}:${it.maneuverModifier}:${it.maneuverExit}:${it.instruction}"
        }.orEmpty()
        if (lastManeuverSignature.isNotEmpty() && maneuverSignature.isNotEmpty() && maneuverSignature != lastManeuverSignature) {
            maneuverTransitionStartedAt = System.currentTimeMillis()
        }
        if (maneuverSignature.isNotEmpty()) lastManeuverSignature = maneuverSignature
        payload = next
        if ((wasNavigating && next?.isNavigating != true) || next == null) {
            resetRouteCursor()
            activeMotionPoints = emptyList()
            activeMotionIsNavigating = false
        }
        next?.mapState?.speedLimitKmh?.toInt()?.takeIf { it > 0 }?.let { stickySpeedLimitKmh = it }
        next?.mapState?.searchQuery?.takeIf { it.isNotBlank() && uiMode != AutoUiMode.SEARCH_RESULTS }?.let {
            searchQuery = it.take(36)
        }
        uiMode = when {
            uiMode == AutoUiMode.SEARCH_RESULTS || uiMode == AutoUiMode.REPORT_MENU ||
                uiMode == AutoUiMode.LOADING || uiMode == AutoUiMode.ERROR_TOAST -> uiMode
            next?.mapState?.uiMode == "NAVIGATING" -> AutoUiMode.NAVIGATING
            next?.mapState?.uiMode == "ROUTE_PREVIEW" -> AutoUiMode.ROUTE_PREVIEW
            next?.isNavigating == true -> AutoUiMode.NAVIGATING
            next?.mapState?.routePreview == true -> AutoUiMode.ROUTE_PREVIEW
            else -> AutoUiMode.FREE_DRIVE
        }
        ensureAvatarLoaded(next?.mapState?.currentUserAvatarUrl.orEmpty())

        if (next != null) {
            val payloadSpeed = payloadSpeedKmh(next).coerceIn(0.0, 180.0)
            if (payloadSpeed > 0.7 || targetSpeedKmh < 0.7) {
                targetSpeedKmh = payloadSpeed
            }
            val now = System.currentTimeMillis()

            val nativeRoadFresh = (next.mapState.nativeRoadMatch || next.mapState.nativeRoadPose) &&
                next.mapState.nativeRoadMatchedAt > 0L &&
                now - next.mapState.nativeRoadMatchedAt <= ROAD_MATCH_FRESH_MS
            // Trasa nawigacji i road match free drive to dwie rozne geometrie.
            // Mieszanie ich powodowalo reset kursora po kazdej aktualizacji road matcha.
            val roadPoints = if (next.isNavigating) {
                next.routePoints.takeIf { it.size >= 2 }
            } else {
                liveFollowPoints(next)
            }
            val routeLocked = roadPoints != null && (next.isNavigating || nativeRoadFresh)
            val liveFixFresh = lastMeasuredAt > 0L && now - lastMeasuredAt <= 2_500L
            val authoritativeLat = if (liveFixFresh) lastMeasuredLat else next.userLat
            val authoritativeLng = if (liveFixFresh) lastMeasuredLng else next.userLng
            val authoritativeHeading = if (liveFixFresh) targetHeading else next.heading

            if (routeLocked && authoritativeLat != null && authoritativeLng != null) {
                updateRouteTarget(
                    roadPoints!!,
                    authoritativeLat,
                    authoritativeLng,
                    targetSpeedKmh,
                    authoritativeHeading,
                    next.mapState.autoTargetArcM.takeIf { nativeRoadFresh && !next.isNavigating },
                    if (next.isNavigating) 0 else next.mapState.nativeRoadVersion
                )
                if (displayedLat == null || displayedLng == null) {
                    displayedLat = targetLat
                    displayedLng = targetLng
                    displayedHeading = targetHeading
                    displayedSpeedKmh = targetSpeedKmh
                }
            } else if ((nativeRoadFresh && next.mapState.nativeRoadPose || next.mapState.nativeAutoPose) &&
                next.userLat != null && next.userLng != null) {
                targetLat = next.userLat
                targetLng = next.userLng
                targetHeading = next.heading ?: targetHeading
                if (displayedLat == null || displayedLng == null) {
                    displayedLat = targetLat
                    displayedLng = targetLng
                    displayedHeading = targetHeading
                }
                displayedSpeedKmh = targetSpeedKmh
            } else if (!next.isNavigating) {
                // Bez świeżej pozycji OSRM zachowujemy ostatnią pozycję drogową i pozwalamy
                // krótkiemu dead reckoningowi dowieźć marker do następnego fixa.
            }
        }
        ensureFrameLoop()
    }

    fun handleLivePoseUpdate(lat: Double, lng: Double, speed: Double, heading: Double) {
        if (!lat.isFinite() || !lng.isFinite() ||
            lat !in -90.0..90.0 || lng !in -180.0..180.0 ||
            kotlin.math.abs(lat) < 1e-6 && kotlin.math.abs(lng) < 1e-6
        ) return

        if (VroomCarManager.isSimulationMode()) {
            val cleanHeading = heading.takeIf { it.isFinite() }
                ?.let { (it % 360.0 + 360.0) % 360.0 }
                ?: targetHeading
            val speedKmh = (speed.takeIf { it.isFinite() }?.coerceIn(0.0, 70.0) ?: 0.0) * 3.6
            targetLat = lat
            targetLng = lng
            targetHeading = cleanHeading
            targetSpeedKmh = speedKmh
            displayedLat = lat
            displayedLng = lng
            displayedHeading = cleanHeading
            displayedSpeedKmh = speedKmh
            lastGpsAt = System.currentTimeMillis()
            coldStartPose = false
            ensureFrameLoop()
            return
        }

        val snap = payload
        val now = System.currentTimeMillis()
        beginMotionSegment(now)

        val previousLat = lastMeasuredLat
        val previousLng = lastMeasuredLng
        val previousAt = lastMeasuredAt
        val measuredDtSec = if (previousAt > 0L) ((now - previousAt).coerceIn(40L, 2_500L)).toDouble() / 1000.0 else 0.0
        val measuredDistanceM = if (previousLat != null && previousLng != null) {
            distanceMeters(previousLat, previousLng, lat, lng)
        } else {
            0.0
        }
        val derivedSpeedMs = if (measuredDtSec > 0.0 && measuredDistanceM.isFinite() && measuredDistanceM > 0.25) {
            (measuredDistanceM / measuredDtSec).coerceIn(0.0, 50.0)
        } else {
            0.0
        }
        val incomingSpeedMs = when {
            speed.isFinite() && speed > 0.15 -> speed.coerceIn(0.0, 70.0)
            derivedSpeedMs > 0.15 -> derivedSpeedMs
            else -> speed.takeIf { it.isFinite() }?.coerceIn(0.0, 70.0) ?: 0.0
        }
        targetSpeedKmh = (incomingSpeedMs * 3.6).coerceIn(0.0, 180.0)
        if (incomingSpeedMs >= 0.8 || derivedSpeedMs >= 0.8) {
            lastReliableSpeedKmh = targetSpeedKmh
            lastMotionEvidenceAt = now
        }
        lastMeasuredLat = lat
        lastMeasuredLng = lng
        lastMeasuredAt = now

        val derivedHeading = if (previousLat != null && previousLng != null && measuredDistanceM > 0.45) {
            bearingBetween(previousLat, previousLng, lat, lng)
        } else {
            null
        }
        val cleanHeading = heading.takeIf { it.isFinite() && (incomingSpeedMs >= 0.8 || derivedHeading == null) }
            ?.let { (it % 360.0 + 360.0) % 360.0 }
            ?: derivedHeading
            ?: targetHeading
        targetHeading = if (targetHeading.isFinite() && !coldStartPose) {
            normalizedHeading(targetHeading + headingDelta(targetHeading, cleanHeading) * 0.7)
        } else {
            cleanHeading
        }

        if (snap?.isNavigating == true) {
            val navigationRoute = snap.routePoints.takeIf { it.size >= 2 }
            if (navigationRoute != null) {
                val routeProjection = projectOnRoad(lat, lng, navigationRoute, 110.0, cleanHeading)
                if (routeProjection != null && routeProjection.distanceM <= 85.0) {
                    updateRouteTarget(
                        navigationRoute,
                        lat,
                        lng,
                        targetSpeedKmh,
                        cleanHeading,
                        null,
                        0
                    )
                } else {
                    // Nie teleportuj markera do surowego GPS. Zachowaj ostatni kurs i
                    // popros o reroute dopiero po rzeczywistym odjechaniu od trasy.
                    maybeRequestReroute(snap, lat, lng, navigationRoute)
                }
                if (displayedLat == null || displayedLng == null) {
                    displayedLat = targetLat ?: lat
                    displayedLng = targetLng ?: lng
                    displayedHeading = targetHeading
                    displayedSpeedKmh = targetSpeedKmh
                    coldStartPose = false
                }
                ensureFrameLoop()
                return
            }
            targetLat = lat
            targetLng = lng
            if (displayedLat == null || displayedLng == null) {
                displayedLat = lat
                displayedLng = lng
                displayedHeading = targetHeading
                displayedSpeedKmh = targetSpeedKmh
                coldStartPose = false
            }
            ensureFrameLoop()
            return
        }

        val freeDriveRoadPoints = snap?.takeIf { !it.isNavigating }?.let { liveFollowPoints(it) }
        if (freeDriveRoadPoints != null && freeDriveRoadPoints.size >= 2) {
            updateRouteTarget(
                freeDriveRoadPoints,
                lat,
                lng,
                targetSpeedKmh,
                cleanHeading,
                snap.mapState.autoTargetArcM.takeIf { snap.mapState.nativeRoadMatch },
                snap.mapState.nativeRoadVersion
            )
            if (displayedLat == null || displayedLng == null) {
                displayedLat = targetLat
                displayedLng = targetLng
                displayedHeading = targetHeading
                displayedSpeedKmh = targetSpeedKmh
                coldStartPose = false
            }
            ensureFrameLoop()
            return
        }

        targetLat = lat
        targetLng = lng
        if (displayedLat == null || displayedLng == null) {
            displayedLat = lat
            displayedLng = lng
            displayedHeading = targetHeading
            displayedSpeedKmh = targetSpeedKmh
            coldStartPose = false
        }
        ensureFrameLoop()
    }

    fun tickRenderedPose(frameTimeNanos: Long) {
        advanceRenderedPose(frameTimeNanos)
        publishRenderedPose()
    }

    fun renderedPose(): Triple<Double, Double, Double>? {
        val lat = displayedLat ?: return null
        val lng = displayedLng ?: return null
        return Triple(lat, lng, displayedHeading)
    }

    fun routeProgressArcM(): Double? = routeCursorArcM.takeIf { it.isFinite() }

    private fun updateRouteTarget(
        points: List<AutoRoutePoint>,
        measuredLat: Double,
        measuredLng: Double,
        speedKmh: Double,
        measuredHeading: Double?,
        preferredTargetArcM: Double?,
        roadVersion: Int = 0
    ) {
        activeMotionPoints = points
        activeMotionIsNavigating = payload?.isNavigating == true
        val roadFix = consumeRoadFix(measuredLat, measuredLng)
        val matchingHeading = measuredHeading
            ?.takeIf { it.isFinite() && speedKmh >= 6.0 }
            ?.let(::normalizedHeading)
        val signature = routeSignature(points, roadVersion)
        if (signature != routeCursorSignature) {
            routeCursorSignature = signature
            val hadDisplayedPose = displayedLat != null && displayedLng != null
            val preferredArc = preferredTargetArcM
                ?.takeIf { it.isFinite() && it >= 0.0 }
            val continuityProjection = if (displayedLat != null && displayedLng != null && preferredArc != null) {
                projectOnRoadWindow(
                    displayedLat!!,
                    displayedLng!!,
                    points,
                    preferredArc,
                    backwardM = 180.0,
                    forwardM = 18.0,
                    maxDistanceM = 140.0,
                    expectedHeading = matchingHeading,
                )
            } else if (displayedLat != null && displayedLng != null) {
                projectOnRoad(displayedLat!!, displayedLng!!, points, 140.0, matchingHeading)
            } else {
                null
            }
            val measuredProjection = projectOnRoad(measuredLat, measuredLng, points, 180.0, matchingHeading)
            // Fresh GPS is authoritative after a geometry refresh. Reusing the
            // old rendered marker here was the main source of accumulated lag.
            val initial = measuredProjection ?: continuityProjection
            val authoritativeArc = preferredArc ?: initial?.arcM ?: 0.0
            routeCursorArcM = authoritativeArc
            routeTargetArcM = authoritativeArc
            val initialPoint = pointAtRoadArc(points, routeCursorArcM)
            val targetPoint = pointAtRoadArc(points, routeTargetArcM)
            if (targetPoint != null) {
                targetLat = targetPoint.lat
                targetLng = targetPoint.lng
            } else if (initialPoint != null) {
                targetLat = initialPoint.lat
                targetLng = initialPoint.lng
            }
            targetHeading = headingAtRoadArc(points, routeTargetArcM, speedKmh)
            val renderedErrorM = if (hadDisplayedPose && targetPoint != null) {
                distanceMeters(displayedLat!!, displayedLng!!, targetPoint.lat, targetPoint.lng)
            } else {
                Double.POSITIVE_INFINITY
            }
            if ((!hadDisplayedPose || renderedErrorM >= 24.0) && targetPoint != null) {
                displayedLat = targetPoint.lat
                displayedLng = targetPoint.lng
                displayedHeading = targetHeading
            }
            return
        }

        val anchor = when {
            routeTargetArcM.isFinite() -> routeTargetArcM
            routeCursorArcM.isFinite() -> routeCursorArcM
            else -> 0.0
        }
        val localProjection = projectOnRoadWindow(
            measuredLat,
            measuredLng,
            points,
            anchor,
            backwardM = 22.0,
            forwardM = ((speedKmh / 3.6) * 8.0 + 90.0).coerceIn(100.0, 360.0),
            maxDistanceM = 85.0,
            expectedHeading = matchingHeading,
        )
        val projection = preferredTargetArcM
            ?.takeIf { it.isFinite() && it >= anchor - 8.0 }
            ?.let { arc ->
                pointAtRoadArc(points, arc)?.let { point ->
                    RoadProjection(point.lat, point.lng, arc, 0, 0.0)
                }
            }
            ?: localProjection
            ?: projectOnRoad(measuredLat, measuredLng, points, 65.0, matchingHeading)
        if (projection != null && (roadFix.isNewFix || preferredTargetArcM != null)) {
            val maxPlausibleAdvance = AutoRoadPosePolicy.maximumForwardAdvanceMeters(
                speedKmh = speedKmh,
                fixElapsedSeconds = roadFix.elapsedSeconds,
                measuredDistanceMeters = roadFix.distanceMeters,
            )
            val candidate = projection.arcM.coerceAtMost(anchor + maxPlausibleAdvance)
            routeTargetArcM = kotlin.math.max(anchor, candidate)
        }
        val snapped = pointAtRoadArc(points, routeTargetArcM)
        if (snapped != null) {
            targetLat = snapped.lat
            targetLng = snapped.lng
            targetHeading = headingAtRoadArc(points, routeTargetArcM, speedKmh)
            val lagM = (routeTargetArcM - routeCursorArcM).coerceAtLeast(0.0)
            val diagnosticNow = System.currentTimeMillis()
            if (lagM >= 8.0 && diagnosticNow - lastPoseDiagnosticAt >= 1_000L) {
                lastPoseDiagnosticAt = diagnosticNow
                Log.d(
                    "VroomAutoPose",
                    "roadLag=${"%.1f".format(java.util.Locale.US, lagM)}m " +
                        "fixAge=${"%.2f".format(java.util.Locale.US, roadFix.elapsedSeconds)}s " +
                        "speed=${"%.1f".format(java.util.Locale.US, speedKmh)}kmh",
                )
            }
            if (AutoRoadPosePolicy.shouldHardResync(lagM, speedKmh)) {
                segmentDurationMs = 300L
            }
        }
    }

    private fun consumeRoadFix(lat: Double, lng: Double): RoadFixDelta {
        val now = SystemClock.elapsedRealtime()
        val previousLat = lastRoadFixLat
        val previousLng = lastRoadFixLng
        val distance = if (previousLat != null && previousLng != null) {
            distanceMeters(previousLat, previousLng, lat, lng)
        } else {
            0.0
        }
        if (previousLat != null && previousLng != null && distance < 0.4) {
            return RoadFixDelta(0.0, 0.0, false)
        }
        val elapsed = if (lastRoadFixAt > 0L) {
            ((now - lastRoadFixAt).coerceIn(40L, 15_000L)).toDouble() / 1_000.0
        } else {
            0.25
        }
        lastRoadFixLat = lat
        lastRoadFixLng = lng
        lastRoadFixAt = now
        return RoadFixDelta(elapsed, distance, true)
    }

    private fun resetRouteCursor() {
        routeCursorSignature = 0
        routeCursorArcM = Double.NaN
        routeTargetArcM = Double.NaN
        lastRoadFixLat = null
        lastRoadFixLng = null
        lastRoadFixAt = 0L
        segmentStartArcM = Double.NaN
    }

    private fun beginMotionSegment(nowMs: Long) {
        segmentStartLat = displayedLat
        segmentStartLng = displayedLng
        segmentStartArcM = routeCursorArcM
        segmentStartedAtMs = nowMs
        segmentDurationMs = if (lastGpsAt > 0L) {
            (nowMs - lastGpsAt).coerceIn(200L, 2_000L)
        } else {
            1_000L
        }
        lastGpsAt = nowMs
    }

    private fun segmentProgress(nowMs: Long = System.currentTimeMillis()): Double {
        if (segmentStartedAtMs <= 0L) return 1.0
        return ((nowMs - segmentStartedAtMs).toDouble() / segmentDurationMs.toDouble())
            .coerceIn(0.0, 1.0)
    }

    private fun ensureFrameLoop() {
        // Pose animation is driven by VroomMapSurfaceRenderer poseTickRunnable (60 fps).
    }

    private fun advanceRenderedPose(frameTimeNanos: Long): Boolean {
        if (VroomCarManager.isSimulationMode()) {
            publishRenderedPose()
            return displayedSpeedKmh > 0.5
        }
        val goalLat = targetLat
        val goalLng = targetLng
        if (goalLat == null || goalLng == null || !goalLat.isFinite() || !goalLng.isFinite()) {
            val curLat = displayedLat
            val curLng = displayedLng
            if (curLat != null && curLng != null && displayedSpeedKmh > 0.5) {
                val dtSec = if (lastFrameAtNs > 0L) {
                    ((frameTimeNanos - lastFrameAtNs).toDouble() / 1_000_000_000.0).coerceIn(1.0 / 120.0, 0.12)
                } else {
                    1.0 / 60.0
                }
                lastFrameAtNs = frameTimeNanos
                val speedMs = displayedSpeedKmh / 3.6
                val (nLat, nLng) = advanceGeodesic(curLat, curLng, displayedHeading, speedMs * dtSec)
                displayedLat = nLat
                displayedLng = nLng
            }
            return displayedSpeedKmh > 0.5
        }

        val previousFrameAt = lastFrameAtNs
        lastFrameAtNs = frameTimeNanos
        val dtSec = if (previousFrameAt > 0L) {
            ((frameTimeNanos - previousFrameAt).toDouble() / 1_000_000_000.0).coerceIn(1.0 / 120.0, 0.12)
        } else {
            1.0 / 60.0
        }

        val curLat = displayedLat
        val curLng = displayedLng
        if (curLat == null || curLng == null || !curLat.isFinite() || !curLng.isFinite()) {
            displayedLat = goalLat
            displayedLng = goalLng
            displayedHeading = normalizedHeading(targetHeading)
            displayedSpeedKmh = targetSpeedKmh
            coldStartPose = false
            return true
        }

        val gpsAgeMs = if (lastGpsAt > 0L) System.currentTimeMillis() - lastGpsAt else Long.MAX_VALUE
        val signalLost = gpsAgeMs > 30_000L
        val speedAlpha = (dtSec * 8.0).coerceIn(0.0, 1.0)
        displayedSpeedKmh += (targetSpeedKmh - displayedSpeedKmh) * speedAlpha
        val motionAgeMs = System.currentTimeMillis() - lastMotionEvidenceAt
        val heldSpeedKmh = if (lastMotionEvidenceAt > 0L && motionAgeMs in 0L..1_200L) {
            lastReliableSpeedKmh * (1.0 - motionAgeMs.toDouble() / 1_200.0)
        } else {
            0.0
        }
        val driveSpeedKmh = kotlin.math.max(displayedSpeedKmh, kotlin.math.max(targetSpeedKmh * 0.85, heldSpeedKmh))
        val speedMs = driveSpeedKmh.coerceIn(0.0, 180.0) / 3.6
        val navigating = payload?.isNavigating == true
        val activeRoadPoints = activeMotionPoints.takeIf {
            it.size >= 2 && activeMotionIsNavigating == navigating
        } ?: payload?.takeIf { it.isNavigating }?.routePoints?.takeIf { it.size >= 2 }
            ?: payload?.let { liveFollowPoints(it) }

        var renderedOnRoad = false
        if (coldStartPose) {
            displayedLat = goalLat
            displayedLng = goalLng
            coldStartPose = false
        } else if (!signalLost) {
            val roadStep = activeRoadPoints?.let { stepAlongActiveRoute(it, driveSpeedKmh) }
            if (roadStep != null) {
                displayedLat = roadStep.lat
                displayedLng = roadStep.lng
                targetHeading = roadStep.heading
                renderedOnRoad = true
            } else {
                val progress = segmentProgress()
                val startLat = segmentStartLat?.takeIf { it.isFinite() } ?: curLat
                val startLng = segmentStartLng?.takeIf { it.isFinite() } ?: curLng
                val segmentLeadM = if (driveSpeedKmh >= 3.0) {
                    speedMs * segmentDurationMs.toDouble() / 1_000.0
                } else {
                    0.0
                }
                val visualGoal = advanceGeodesic(goalLat, goalLng, targetHeading, segmentLeadM)
                val baseLat = startLat + (visualGoal.first - startLat) * progress
                val baseLng = startLng + (visualGoal.second - startLng) * progress
                val predictionAgeMs = (
                    System.currentTimeMillis() - segmentStartedAtMs - segmentDurationMs
                ).coerceIn(0L, 1_200L)
                val predictionM = speedMs * predictionAgeMs.toDouble() / 1_000.0
                val predicted = advanceGeodesic(baseLat, baseLng, displayedHeading, predictionM)
                displayedLat = predicted.first
                displayedLng = predicted.second
            }
        }

        if (renderedOnRoad || driveSpeedKmh >= 3.0) {
            val headingRate = if (renderedOnRoad) 720.0 else 360.0
            val maxHeadingStep = (headingRate * dtSec).coerceAtLeast(4.0)
            val delta = headingDelta(displayedHeading, targetHeading)
            if (kotlin.math.abs(delta) > 0.18) {
                displayedHeading = normalizedHeading(
                    displayedHeading + delta.coerceIn(-maxHeadingStep, maxHeadingStep)
                )
            }
        }

        postInvalidateOnAnimation()

        return driveSpeedKmh > 0.5 ||
            distanceMeters(displayedLat ?: goalLat, displayedLng ?: goalLng, goalLat, goalLng) > 0.3
    }

    private fun publishRenderedPose() {
        val lat = displayedLat ?: return
        val lng = displayedLng ?: return
        if (!lat.isFinite() || !lng.isFinite()) return
        renderedPoseListener?.invoke(lat, lng, displayedHeading, displayedSpeedKmh)
    }

    private fun normalizedHeading(value: Double): Double =
        ((value % 360.0) + 360.0) % 360.0

    private fun headingDelta(from: Double, to: Double): Double {
        var delta = normalizedHeading(to) - normalizedHeading(from)
        if (delta > 180.0) delta -= 360.0
        if (delta < -180.0) delta += 360.0
        return delta
    }

    private fun bearingBetween(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = sin(dLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return normalizedHeading(Math.toDegrees(kotlin.math.atan2(y, x)))
    }

    fun hitAction(x: Float, y: Float): String? =
        hitRects.entries.firstOrNull { it.value.contains(x, y) }?.key

    fun openSearch() {
        uiMode = AutoUiMode.SEARCH_RESULTS
        searchQuery = ""
        searchResults = emptyList()
        searchLoading = false
        postInvalidateOnAnimation()
    }

    fun openReportMenu() {
        uiMode = AutoUiMode.REPORT_MENU
        postInvalidateOnAnimation()
    }

    fun handleCustomAction(action: String?): Boolean {
        if (action == null) {
            if (uiMode == AutoUiMode.SEARCH_RESULTS || uiMode == AutoUiMode.REPORT_MENU) {
                uiMode = currentBaseMode()
                postInvalidateOnAnimation()
                return true
            }
            return false
        }
        when {
            action == "search_close" -> {
                uiMode = currentBaseMode()
                postInvalidateOnAnimation()
                return true
            }
            action == "search_backspace" -> {
                if (searchQuery.isNotEmpty()) searchQuery = searchQuery.dropLast(1)
                searchResults = emptyList()
                postInvalidateOnAnimation()
                return true
            }
            action == "search_clear" -> {
                searchQuery = ""
                searchResults = emptyList()
                postInvalidateOnAnimation()
                return true
            }
            action == "search_space" -> {
                if (searchQuery.length < 36) searchQuery += " "
                searchResults = emptyList()
                postInvalidateOnAnimation()
                return true
            }
            action == "search_submit" -> {
                submitSearch(searchQuery)
                return true
            }
            action.startsWith("search_key_") -> {
                val char = action.removePrefix("search_key_")
                if (char.isNotBlank() && searchQuery.length < 36) searchQuery += char
                searchResults = emptyList()
                postInvalidateOnAnimation()
                return true
            }
            action.startsWith("search_cat_") -> {
                val query = when (action.removePrefix("search_cat_")) {
                    "fuel" -> "stacja paliw"
                    "parking" -> "parking"
                    "food" -> "restauracja"
                    "coffee" -> "kawiarnia"
                    else -> ""
                }
                searchQuery = query
                submitSearch(query)
                return true
            }
            action.startsWith("search_result_") -> {
                val index = action.removePrefix("search_result_").toIntOrNull() ?: return true
                searchResults.getOrNull(index)?.let { buildRoutePreview(it) }
                return true
            }
            action.startsWith("report_type_") -> {
                val type = action.removePrefix("report_type_")
                VroomCarManager.submitReport(type)
                showToast("Zgloszenie wyslane")
                uiMode = currentBaseMode()
                return true
            }
            action == "report_close" -> {
                uiMode = currentBaseMode()
                postInvalidateOnAnimation()
                return true
            }
        }
        return false
    }



    private fun currentBaseMode(): AutoUiMode = when {
        payload?.isNavigating == true -> AutoUiMode.NAVIGATING
        payload?.mapState?.routePreview == true -> AutoUiMode.ROUTE_PREVIEW
        else -> AutoUiMode.FREE_DRIVE
    }

    private fun showToast(text: String) {
        toastText = text
        toastUntil = System.currentTimeMillis() + 2_600L
        postInvalidateOnAnimation()
    }

    fun showDriverAlert(text: String) {
        toastText = text
        toastUntil = System.currentTimeMillis() + 10_000L
        postInvalidateOnAnimation()
    }

    private fun submitSearch(query: String) {
        val clean = query.trim()
        if (clean.length < 2 || searchLoading) return
        val seq = ++searchSeq
        searchLoading = true
        uiMode = AutoUiMode.SEARCH_RESULTS
        postInvalidateOnAnimation()
        Thread {
            val results = runCatching { geocodePlaces(clean) }.getOrDefault(emptyList())
            overlayHandler.post {
                if (seq != searchSeq) return@post
                searchLoading = false
                searchResults = results
                if (results.isEmpty()) showToast("Brak wynikow w poblizu")
                postInvalidateOnAnimation()
            }
        }.start()
    }

    private fun buildRoutePreview(item: SearchResultItem) {
        if (searchLoading) return
        val origin = currentOrigin() ?: run {
            showToast("Czekam na pozycje GPS")
            return
        }
        val seq = ++searchSeq
        searchLoading = true
        uiMode = AutoUiMode.LOADING
        postInvalidateOnAnimation()
        Thread {
            val routePayload = runCatching { buildRoutePreviewPayload(item, origin) }
                .getOrElse {
                    Log.w("VroomAutoOverlay", "Nie udało się przygotować podglądu trasy dla ${item.name}", it)
                    null
                }
            overlayHandler.post {
                if (seq != searchSeq) return@post
                searchLoading = false
                if (routePayload != null) {
                    VroomCarManager.setNativeRoutePreview(routePayload)
                    uiMode = AutoUiMode.ROUTE_PREVIEW
                } else {
                    uiMode = AutoUiMode.SEARCH_RESULTS
                    showToast("Nie udalo sie wyznaczyc trasy")
                }
                postInvalidateOnAnimation()
            }
        }.start()
    }

    private fun geocodePlaces(raw: String): List<SearchResultItem> {
        val origin = currentOrigin()
        return AutoNavStore.searchPlaces(context, raw, 8).mapIndexed { index, place ->
            val eta = origin?.let {
                val km = distanceMeters(it.lat, it.lng, place.lat, place.lng) / 1000.0
                if (km >= 1.0) String.format(java.util.Locale.US, "%.1f km", km) else "${(km * 1000).toInt()} m"
            }.orEmpty()
            SearchResultItem(place.id.ifBlank { "result-$index" }, place.name, place.address, place.lat, place.lng, null, null, eta)
        }
    }

    private fun buildRoutePreviewPayload(item: SearchResultItem, origin: RouteOrigin): String {
        val origins = mutableListOf<RouteOrigin>()
        fun addOrigin(candidate: RouteOrigin?) {
            if (candidate == null) return
            if (!candidate.lat.isFinite() || !candidate.lng.isFinite()) return
            if (origins.none { distanceMeters(it.lat, it.lng, candidate.lat, candidate.lng) < 25.0 }) {
                origins.add(candidate)
            }
        }
        addOrigin(origin)
        nearestRoadPoint(origin.lat, origin.lng)?.let { snapped ->
            addOrigin(RouteOrigin(snapped.first, snapped.second, origin.speedMs, origin.heading))
        }

        val destinations = mutableListOf<Pair<Double, Double>>()
        fun addDestination(lat: Double?, lng: Double?) {
            if (lat == null || lng == null || !lat.isFinite() || !lng.isFinite()) return
            if (destinations.none { distanceMeters(it.first, it.second, lat, lng) < 3.0 }) {
                destinations.add(Pair(lat, lng))
            }
        }
        addDestination(item.routableLat, item.routableLng)
        addDestination(item.lat, item.lng)

        var root: JSONObject? = null
        var usedOrigin = origin
        var lastFailure: Throwable? = null

        fun validateRoute(candidate: JSONObject, from: RouteOrigin): JSONObject {
            val code = candidate.optString("code", "Ok")
            if (code.isNotBlank() && code != "Ok") throw IllegalStateException("Wyznaczanie trasy nie powiodło się: $code")
            val route = candidate.optJSONArray("routes")?.optJSONObject(0)
                ?: throw IllegalStateException("Brak trasy")
            val coords = route.optJSONObject("geometry")?.optJSONArray("coordinates")
                ?: throw IllegalStateException("Brak geometrii")
            if (coords.length() < 2) throw IllegalStateException("Zbyt krótka geometria")
            val first = coords.optJSONArray(0) ?: throw IllegalStateException("Brak startu geometrii")
            val firstLng = first.optDouble(0, Double.NaN)
            val firstLat = first.optDouble(1, Double.NaN)
            if (!firstLat.isFinite() || !firstLng.isFinite()) throw IllegalStateException("Nieprawidlowy start geometrii")
            val startGapM = distanceMeters(from.lat, from.lng, firstLat, firstLng)
            if (!startGapM.isFinite() || startGapM > 120.0) {
                throw IllegalStateException("Trasa startuje za daleko od auta: ${startGapM.toInt()} m")
            }
            return candidate
        }

        fun tryMapboxRoute(from: RouteOrigin, to: Pair<Double, Double>): Boolean {
            return runCatching {
                val heading = normalizeHeadingForApi(from.heading)
                val bearingParam = AutoRouteGeometry.bearingsParam(heading?.toDouble(), toleranceDeg = 90)
                val url = "$AUTO_OSRM_BASE/route/v1/driving/${formatCoord(from.lng)},${formatCoord(from.lat)};${formatCoord(to.second)},${formatCoord(to.first)}" +
                    "?alternatives=false&geometries=geojson&overview=full&steps=true&continue_straight=true" +
                    bearingParam
                root = validateRoute(JSONObject(requestJson(url, 8_000, 8_000)), from)
                usedOrigin = from
                true
            }.getOrElse {
                lastFailure = it
                Log.w("VroomAutoOverlay", "Trasa Mapbox nie powiodła się ${from.lat},${from.lng} -> ${to.first},${to.second}", it)
                false
            }
        }

        fun tryOsrmRoute(from: RouteOrigin, to: Pair<Double, Double>): Boolean {
            return runCatching {
                val url = "$AUTO_OSRM_BASE/route/v1/driving/${formatCoord(from.lng)},${formatCoord(from.lat)};${formatCoord(to.second)},${formatCoord(to.first)}" +
                    "?alternatives=false&geometries=geojson&steps=true&overview=full&continue_straight=true"
                root = validateRoute(JSONObject(requestJson(url, 4_500, 4_500)), from)
                usedOrigin = from
                true
            }.getOrElse {
                lastFailure = it
                Log.w("VroomAutoOverlay", "Trasa OSRM nie powiodła się ${from.lat},${from.lng} -> ${to.first},${to.second}", it)
                false
            }
        }

        outer@ for (from in origins) {
            for (to in destinations) {
                if (tryOsrmRoute(from, to)) break@outer
            }
        }
        if (root == null) {
            outer2@ for (from in origins) {
                for (to in destinations) {
                    if (tryMapboxRoute(from, to)) break@outer2
                }
            }
        }
        if (root == null) {
            val snappedDestinations = destinations.mapNotNull { to -> nearestRoadPoint(to.first, to.second) }
            val dests = if (snappedDestinations.isNotEmpty()) snappedDestinations else destinations
            outer3@ for (from in origins) {
                for (to in dests) {
                    if (tryOsrmRoute(from, to)) break@outer3
                }
            }
        }
        val routeRoot = root ?: throw IllegalStateException("Wyznaczanie trasy nie powiodło się", lastFailure)
        val route = routeRoot.optJSONArray("routes")?.optJSONObject(0) ?: throw IllegalStateException("Missing route")
        val coords = route.optJSONObject("geometry")?.optJSONArray("coordinates") ?: JSONArray()
        val points = JSONArray()
        for (i in 0 until coords.length()) {
            val coord = coords.optJSONArray(i) ?: continue
            val lng = coord.optDouble(0, Double.NaN)
            val lat = coord.optDouble(1, Double.NaN)
            if (lat.isFinite() && lng.isFinite()) {
                points.put(JSONObject().apply {
                    put("lat", lat)
                    put("lng", lng)
                })
            }
        }
        if (points.length() < 2) throw IllegalStateException("Missing geometry")
        val anchoredPoints = AutoRouteGeometry.anchorRoutePoints(points, usedOrigin.lat, usedOrigin.lng)
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
        val steps = leg?.optJSONArray("steps") ?: JSONArray()
        val routeSteps = routeStepsJson(steps, anchoredPoints)
        val maneuver = step?.optJSONObject("maneuver")
        val distance = route.optDouble("distance", 0.0).toInt().coerceAtLeast(1)
        val duration = route.optDouble("duration", 0.0).toInt().coerceAtLeast(0)
        val turnDistance = step?.optDouble("distance", distance.toDouble())?.toInt() ?: distance
        val instruction = polishInstruction(step, maneuver)
        return JSONObject().apply {
            put("isNavigating", false)
            put("userLocation", JSONObject().apply {
                put("latitude", usedOrigin.lat)
                put("longitude", usedOrigin.lng)
            })
            put("speed", usedOrigin.speedMs)
            put("heading", usedOrigin.heading)
            put("destination", JSONObject().apply {
                put("name", item.name)
                put("latitude", item.lat)
                put("longitude", item.lng)
            })
            put("dto", JSONObject().apply {
                put("isNavigating", false)
                put("nextInstruction", instruction)
                put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
                put("maneuverModifier", maneuver?.optString("modifier", "") ?: "")
                put("destinationName", item.name)
                put("remainingDistanceMeters", distance)
                put("remainingDurationSec", duration)
                put("turnDistanceMeters", turnDistance)
            })
            put("route", JSONArray(anchoredPoints.toString()))
            put("routeSteps", JSONArray(routeSteps.toString()))
            put("users", usersJson(payload?.users.orEmpty()))
            put("warnings", warningsJson(payload?.warnings.orEmpty()))
            put("mapState", JSONObject().apply {
                put("uiMode", "ROUTE_PREVIEW")
                put("routePreview", true)
                put("isDriving", true)
                put("route", JSONArray(anchoredPoints.toString()))
                put("routeSteps", JSONArray(routeSteps.toString()))
                put("destinationLat", item.lat)
                put("destinationLng", item.lng)
                put("speedKmh", usedOrigin.speedMs * 3.6)
                put("nativeRoadMatch", false)
                put("speedCameras", poiJson(payload?.speedCameras.orEmpty()))
                put("fuelStations", poiJson(payload?.fuelStations.orEmpty()))
                put("partnerPois", poiJson(payload?.partnerPois.orEmpty()))
            })
        }.toString()
    }

    private fun usersJson(users: List<UserMarker>): JSONArray =
        JSONArray().apply {
            users.forEach { marker ->
                put(JSONObject().apply {
                    put("id", marker.id)
                    put("lat", marker.lat)
                    put("lng", marker.lng)
                    put("label", marker.label)
                    put("type", marker.type)
                    put("isPremium", marker.isPremium)
                })
            }
        }

    private fun warningsJson(warnings: List<WarningMarker>): JSONArray =
        JSONArray().apply {
            warnings.forEach { marker ->
                put(JSONObject().apply {
                    put("id", marker.id)
                    put("lat", marker.lat)
                    put("lng", marker.lng)
                    put("label", marker.label)
                    put("type", marker.type)
                    put("count", marker.count)
                })
            }
        }

    private fun poiJson(markers: List<AutoPoiMarker>): JSONArray =
        JSONArray().apply {
            markers.forEach { marker ->
                put(JSONObject().apply {
                    put("id", marker.id)
                    put("lat", marker.lat)
                    put("lng", marker.lng)
                    put("label", marker.label)
                    put("type", marker.type)
                    put("value", marker.value)
                })
            }
        }

    private fun nearestRoadPoint(lat: Double, lng: Double): Pair<Double, Double>? {
        if (!lat.isFinite() || !lng.isFinite()) return null
        return runCatching {
            val url = "$AUTO_OSRM_BASE/nearest/v1/driving/${formatCoord(lng)},${formatCoord(lat)}?number=1"
            val root = JSONObject(requestJson(url, 2_800, 2_800))
            val code = root.optString("code", "Ok")
            if (code.isNotBlank() && code != "Ok") return null
            val location = root.optJSONArray("waypoints")
                ?.optJSONObject(0)
                ?.optJSONArray("location")
                ?: return null
            val snappedLng = finiteOrNull(location.optDouble(0, Double.NaN)) ?: return null
            val snappedLat = finiteOrNull(location.optDouble(1, Double.NaN)) ?: return null
            Pair(snappedLat, snappedLng)
        }.getOrNull()
    }

    private fun formatCoord(value: Double): String =
        String.format(java.util.Locale.US, "%.6f", value)

    private fun normalizeHeadingForApi(value: Double): Int? {
        if (!value.isFinite()) return null
        val normalized = ((value % 360.0) + 360.0) % 360.0
        return (Math.round(normalized / 45.0).toInt() * 45) % 360
    }

    private fun finiteOrNull(value: Double?): Double? =
        value?.takeIf { it.isFinite() }

    private fun currentOrigin(): RouteOrigin? {
        if (VroomCarManager.isSimulationMode()) {
            val lat = displayedLat
            val lng = displayedLng
            if (lat != null && lng != null) {
                return RouteOrigin(lat, lng, displayedSpeedKmh / 3.6, displayedHeading)
            }
        }
        val pose = AutoLocationTracker.lastKnownPose(2_500L)
        val renderedLat = displayedLat
        val renderedLng = displayedLng
        if (pose != null) {
            if (renderedLat != null && renderedLng != null &&
                distanceMeters(renderedLat, renderedLng, pose.lat, pose.lng) <= 35.0
            ) {
                return RouteOrigin(renderedLat, renderedLng, pose.speedMs, displayedHeading)
            }
            return RouteOrigin(pose.lat, pose.lng, pose.speedMs, pose.heading)
        }
        if (renderedLat != null && renderedLng != null && payload?.isNavigating != true) {
            return RouteOrigin(renderedLat, renderedLng, targetSpeedKmh / 3.6, displayedHeading)
        }
        val snap = payload
        if (snap?.userLat != null && snap.userLng != null) {
            return RouteOrigin(snap.userLat, snap.userLng, snap.speed ?: 0.0, snap.heading ?: 0.0)
        }
        return null
    }

    private fun requestJson(url: String, connectMs: Int, readMs: Int): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = connectMs
            readTimeout = readMs
            setRequestProperty("Accept", "application/json")
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) throw IllegalStateException("HTTP $code")
        return body
    }

    private fun anchorRoutePointsToOrigin(points: JSONArray, originLat: Double, originLng: Double): JSONArray {
        if (points.length() < 2) return points
        val route = parseJsonRoutePoints(points)
        val projection = projectOnRoad(originLat, originLng, route, 150.0)
        val out = JSONArray()
        val startLat = projection?.lat ?: originLat
        val startLng = projection?.lng ?: originLng
        out.put(JSONObject().apply {
            put("lat", startLat)
            put("lng", startLng)
        })
        val startIndex = (projection?.segmentIndex ?: 0) + 1
        for (i in startIndex.coerceAtMost(points.length() - 1) until points.length()) {
            val point = points.optJSONObject(i) ?: continue
            out.put(JSONObject(point.toString()))
        }
        if (out.length() < 2) {
            val last = points.optJSONObject(points.length() - 1) ?: return points
            out.put(JSONObject(last.toString()))
        }
        return out
    }

    private fun roundaboutInstruction(maneuver: JSONObject?): String {
        val exit = maneuver?.optInt("exit", 0) ?: 0
        return if (exit > 0) {
            "Na rondzie zjedz ${roundaboutExitLabel(exit)} zjazdem"
        } else {
            "Wjedz na rondo"
        }
    }

    private fun roundaboutExitLabel(exit: Int): String = when (exit) {
        1 -> "pierwszym"
        2 -> "drugim"
        3 -> "trzecim"
        4 -> "czwartym"
        5 -> "piatym"
        else -> "${exit}."
    }

    private fun maneuverModifierForStep(maneuver: JSONObject?): String {
        if (maneuver == null) return ""
        val modifier = maneuver.optString("modifier", "").orEmpty()
        val exit = maneuver.optInt("exit", 0)
        if (exit > 0) return "exit $exit"
        return modifier
    }

    private fun polishInstruction(step: JSONObject?, maneuver: JSONObject?): String {
        val type = maneuver?.optString("type", "").orEmpty()
        val modifier = maneuver?.optString("modifier", "").orEmpty()
        val roadName = step?.optString("name", "").orEmpty().trim()
        val base = when (type) {
            "depart" -> "Jedz prosto"
            "arrive" -> "Dojezdzasz do celu"
            "roundabout", "rotary" -> roundaboutInstruction(maneuver)
            "merge" -> "Wlacz sie do ruchu"
            "fork" -> "Trzymaj sie rozwidlenia"
            "on ramp" -> "Wjedz na zjazd"
            "off ramp" -> "Zjedz z trasy"
            "turn", "continue", "new name", "end of road" -> when {
                modifier.contains("right", true) -> "Skrec w prawo"
                modifier.contains("left", true) -> "Skrec w lewo"
                modifier.contains("straight", true) -> "Jedz prosto"
                modifier.contains("uturn", true) -> "Zawroc"
                else -> "Kontynuuj"
            }
            else -> "Jedz do celu"
        }
        return if (roadName.isNotBlank()) "$base w strone: $roadName" else base
    }

    private fun routeStepsJson(steps: JSONArray, routePointsJson: JSONArray): JSONArray {
        val route = parseJsonRoutePoints(routePointsJson)
        return JSONArray().apply {
            for (i in 0 until steps.length()) {
                val step = steps.optJSONObject(i) ?: continue
                val maneuver = step.optJSONObject("maneuver")
                val loc = maneuver?.optJSONArray("location")
                val lng = loc?.optDouble(0, Double.NaN) ?: Double.NaN
                val lat = loc?.optDouble(1, Double.NaN) ?: Double.NaN
                val arcM = if (lat.isFinite() && lng.isFinite()) {
                    projectOnRoad(lat, lng, route, Double.POSITIVE_INFINITY)?.arcM ?: 0.0
                } else {
                    0.0
                }
                put(JSONObject().apply {
                    put("arcM", arcM)
                    put("instruction", polishInstruction(step, maneuver))
                    put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
                    put("maneuverModifier", maneuverModifierForStep(maneuver))
                    put("distanceMeters", step.optDouble("distance", 0.0).toInt().coerceAtLeast(1))
                    put("durationSec", step.optDouble("duration", 0.0).toInt().coerceAtLeast(0))
                })
            }
        }
    }

    private fun parseJsonRoutePoints(points: JSONArray): List<AutoRoutePoint> =
        buildList {
            for (i in 0 until points.length()) {
                val p = points.optJSONObject(i) ?: continue
                val lat = p.optDouble("lat", Double.NaN)
                val lng = p.optDouble("lng", Double.NaN)
                if (lat.isFinite() && lng.isFinite()) add(AutoRoutePoint(lat, lng))
            }
        }

    private fun limitIncomingTarget(
        lat: Double,
        lng: Double,
        speedKmh: Double,
        dtSec: Double,
        strict: Boolean
    ): Pair<Double, Double> {
        val curLat = targetLat ?: displayedLat ?: return Pair(lat, lng)
        val curLng = targetLng ?: displayedLng ?: return Pair(lat, lng)
        val jumpM = distanceMeters(curLat, curLng, lat, lng)
        if (!jumpM.isFinite() || jumpM <= 0.01) return Pair(lat, lng)
        val maxStepM = if (strict) {
            ((speedKmh.coerceAtLeast(8.0) / 3.6) * dtSec * 2.4 + 5.0).coerceIn(5.0, 42.0)
        } else {
            ((speedKmh.coerceAtLeast(10.0) / 3.6) * dtSec * 3.0 + 8.0).coerceIn(8.0, 80.0)
        }
        if (jumpM <= maxStepM) return Pair(lat, lng)
        val t = (maxStepM / jumpM).coerceIn(0.0, 1.0)
        return Pair(
            curLat + (lat - curLat) * t,
            curLng + (lng - curLng) * t
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val snap = payload
        if (snap != null) {
            drawRouteChevrons(canvas, snap)
            drawVehicleMarkerAboveRoute(canvas, snap)
        }
        drawHud(canvas, snap)
    }

    private fun drawRoute(canvas: Canvas, snap: VroomPayload) {
        if (!snap.isNavigating && !snap.mapState.routePreview && !snap.mapState.isBuilding) return
        if (snap.mapState.nativeRoadMatch && !snap.isNavigating && !snap.mapState.routePreview) return
        val points = snap.routePoints
        if (points.size < 2) return
        val routePoints = visibleRoutePointsFromVehicle(snap, points)
        if (routePoints.size < 2) return
        val path = Path()
        routePoints.forEachIndexed { index, point ->
            val projected = project(point.lat, point.lng) ?: return@forEachIndexed
            if (index == 0) path.moveTo(projected.first, projected.second) else path.lineTo(projected.first, projected.second)
        }
        val metrics = AutoHudMetrics.fromVisibleArea(stableArea ?: visibleArea, canvas.width, canvas.height)
        routeShadow.strokeWidth = metrics.s(if (snap.isNavigating) 25f else 22f)
        routePaint.strokeWidth = metrics.s(if (snap.isNavigating) 14f else 12f)
        routeShadow.color = if (snap.isNavigating) Color.rgb(0, 22, 40) else Color.argb(230, 5, 18, 30)
        routePaint.color = if (snap.isNavigating) Color.rgb(105, 238, 255) else Color.rgb(118, 240, 255)
        canvas.drawPath(path, routeShadow)
        canvas.drawPath(path, routePaint)
    }

    private fun drawRouteChevrons(canvas: Canvas, snap: VroomPayload) {
        if (!snap.isNavigating && !snap.mapState.routePreview) return
        if (snap.routePoints.size < 2) return
        val projected = chevronRoutePointsFromVehicle(snap)
            .mapNotNull { point -> project(point.lat, point.lng) }
        if (projected.size < 2) return
        val metrics = AutoHudMetrics.fromVisibleArea(stableArea ?: visibleArea, canvas.width, canvas.height)
        val spacing = metrics.s(if (metrics.compact) 116f else 138f)
        val size = metrics.s(if (metrics.compact) 11f else 13f)
        var untilNext = spacing * 1.25f
        var drawnCount = 0
        val maxCount = if (metrics.compact) 5 else 7
        val topGuard = metrics.safeTop + metrics.safeH * 0.17f
        val bottomGuard = metrics.safeBottom - metrics.s(20f)
        val sideGuard = metrics.s(12f)
        val color = if (isNightModeActive) Color.argb(245, 224, 250, 255) else Color.argb(245, 0, 91, 148)

        chevronSegments@ for (index in 0 until projected.lastIndex) {
            val start = projected[index]
            val end = projected[index + 1]
            val dx = end.first - start.first
            val dy = end.second - start.second
            val length = hypot(dx, dy)
            if (length < 2f) continue
            var travelled = untilNext
            while (travelled <= length) {
                val t = travelled / length
                val x = start.first + dx * t
                val y = start.second + dy * t
                val insideChevronZone =
                    y >= topGuard && y <= bottomGuard &&
                        x >= metrics.safeLeft + sideGuard && x <= metrics.safeRight - sideGuard
                if (insideChevronZone) {
                    drawRouteChevron(canvas, x, y, Math.toDegrees(kotlin.math.atan2(dy, dx).toDouble()).toFloat(), size, color)
                    drawnCount += 1
                    if (drawnCount >= maxCount) break@chevronSegments
                }
                travelled += spacing
            }
            untilNext = travelled - length
        }
    }

    private fun chevronRoutePointsFromVehicle(snap: VroomPayload): List<AutoRoutePoint> {
        val points = visibleRoutePointsFromVehicle(snap, snap.routePoints)
        if (points.size < 2) return points

        // Chevrony opisują wyłącznie najbliższy fragment drogi. Rysowanie ich na całej
        // geometrii powodowało rząd strzałek na horyzoncie i przy górnej krawędzi ekranu.
        val maxAheadM = when {
            displayedSpeedKmh >= 90.0 -> 1_050.0
            displayedSpeedKmh >= 60.0 -> 850.0
            else -> 650.0
        }
        val limited = mutableListOf(points.first())
        var accumulatedM = 0.0
        for (index in 0 until points.lastIndex) {
            val start = points[index]
            val end = points[index + 1]
            val segmentM = distanceMeters(start.lat, start.lng, end.lat, end.lng)
            if (!segmentM.isFinite() || segmentM <= 0.01) continue
            val remainingM = maxAheadM - accumulatedM
            if (remainingM <= 0.0) break
            if (segmentM > remainingM) {
                val t = (remainingM / segmentM).coerceIn(0.0, 1.0)
                limited += AutoRoutePoint(
                    lat = start.lat + (end.lat - start.lat) * t,
                    lng = start.lng + (end.lng - start.lng) * t,
                )
                break
            }
            limited += end
            accumulatedM += segmentM
        }
        return limited
    }

    private fun drawVehicleMarkerAboveRoute(canvas: Canvas, snap: VroomPayload) {
        val lat = displayedLat ?: snap.userLat ?: return
        val lng = displayedLng ?: snap.userLng ?: return
        val point = project(lat, lng) ?: return
        if (!inside(point, canvas)) return
        drawArrowMarker(
            canvas = canvas,
            x = point.first,
            y = point.second,
            heading = markerScreenHeading(displayedHeading),
        )
    }

    private fun drawRouteChevron(canvas: Canvas, x: Float, y: Float, angle: Float, size: Float, color: Int) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = size * 0.32f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val checkpoint = canvas.save()
        canvas.rotate(angle, x, y)
        val path = Path().apply {
            moveTo(x - size * 0.62f, y - size * 0.62f)
            lineTo(x + size * 0.30f, y)
            lineTo(x - size * 0.62f, y + size * 0.62f)
        }
        canvas.drawPath(path, paint)
        canvas.restoreToCount(checkpoint)
    }

    private fun visibleRoutePointsFromVehicle(
        snap: VroomPayload,
        points: List<AutoRoutePoint>
    ): List<AutoRoutePoint> {
        val renderedLat = displayedLat
        val renderedLng = displayedLng
        val vehicleLat = when {
            snap.isNavigating -> renderedLat ?: snap.userLat
            else -> renderedLat ?: snap.userLat
        } ?: return points
        val vehicleLng = when {
            snap.isNavigating -> renderedLng ?: snap.userLng
            else -> renderedLng ?: snap.userLng
        } ?: return points
        val geometryPoints = points.map { AutoRouteGeometry.RoutePoint(it.lat, it.lng) }
        val minArc = if (snap.isNavigating) {
            routeCursorArcM.takeIf { it.isFinite() }?.let { (it - 35.0).coerceAtLeast(0.0) } ?: 0.0
        } else {
            0.0
        }
        return AutoRouteGeometry.trimRouteFromVehicle(
            geometryPoints,
            vehicleLat,
            vehicleLng,
            snap.isNavigating,
            minArc,
        ).map { AutoRoutePoint(it.lat, it.lng) }
    }

    private fun isOffRouteFromPayload(snap: VroomPayload?, points: List<AutoRoutePoint>): Boolean {
        if (snap?.isNavigating != true || points.size < 2) return false
        val lat = snap.userLat ?: displayedLat ?: return false
        val lng = snap.userLng ?: displayedLng ?: return false
        val projection = projectOnRoad(lat, lng, points, 90.0) ?: return true
        return projection.distanceM > 28.0
    }

    private fun drawUser(canvas: Canvas, marker: UserMarker) {
        val point = project(marker.lat, marker.lng) ?: return
        if (!inside(point, canvas)) return
        val color = if (marker.type == "friend") Color.rgb(77, 233, 38) else Color.rgb(0, 191, 255)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = Color.argb(235, 8, 8, 10)
            style = Paint.Style.FILL
        }
        val accent = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        val badge = RectF(point.first - 34f, point.second - 64f, point.first + 34f, point.second - 6f)
        canvas.drawRoundRect(badge, 12f, 12f, fill)
        canvas.drawRoundRect(badge, 12f, 12f, accent)
        val initials = marker.label
            .split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercaseChar().toString() }
            .ifBlank { if (marker.isPremium) "P" else "U" }
        textPaint.textSize = 18f
        textPaint.color = Color.WHITE
        canvas.drawText(initials.take(2), badge.centerX(), badge.top + 30f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 13f
        smallText.color = color
        canvas.drawText(marker.label.take(9).uppercase(), badge.centerX(), badge.bottom - 10f, smallText)
        val pin = Path().apply {
            moveTo(point.first - 10f, point.second - 8f)
            lineTo(point.first + 10f, point.second - 8f)
            lineTo(point.first, point.second + 7f)
            close()
        }
        val pinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        canvas.drawPath(pin, pinPaint)
    }

    private fun drawWarning(canvas: Canvas, marker: WarningMarker) {
        val point = project(marker.lat, marker.lng) ?: return
        if (!inside(point, canvas)) return
        val color = when (marker.type) {
            "traffic" -> Color.rgb(255, 107, 107)
            "weather" -> Color.rgb(255, 212, 59)
            "accident" -> Color.rgb(255, 146, 43)
            "speed_control" -> Color.rgb(5, 53, 247)
            else -> Color.rgb(232, 154, 54)
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        val tri = Path().apply {
            moveTo(point.first, point.second - 22f)
            lineTo(point.first - 22f, point.second + 18f)
            lineTo(point.first + 22f, point.second + 18f)
            close()
        }
        canvas.drawPath(tri, fill)
        textPaint.color = Color.WHITE
        textPaint.textSize = 24f
        canvas.drawText("!", point.first, point.second + 10f, textPaint)
    }

    private enum class PoiKind { FUEL, CAMERA, PARTNER }

    private fun drawPoi(canvas: Canvas, marker: AutoPoiMarker, kind: PoiKind) {
        val point = project(marker.lat, marker.lng) ?: return
        if (!inside(point, canvas)) return
        val color = when (kind) {
            PoiKind.FUEL -> Color.rgb(34, 197, 94)
            PoiKind.CAMERA -> Color.rgb(255, 212, 59)
            PoiKind.PARTNER -> Color.rgb(227, 56, 53)
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = Color.argb(232, 8, 8, 10)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        val rect = RectF(point.first - 24f, point.second - 24f, point.first + 24f, point.second + 24f)
        canvas.drawRoundRect(rect, 14f, 14f, fill)
        canvas.drawRoundRect(rect, 14f, 14f, stroke)
        textPaint.textSize = if (kind == PoiKind.PARTNER) 15f else 20f
        textPaint.color = color
        val label = when (kind) {
            PoiKind.FUEL -> marker.value.takeIf { it.isNotBlank() } ?: "95"
            PoiKind.CAMERA -> marker.value.takeIf { it.isNotBlank() } ?: "!"
            PoiKind.PARTNER -> "VR"
        }
        canvas.drawText(label.take(4), rect.centerX(), rect.centerY() + 7f, textPaint)
    }

    private fun drawDestination(canvas: Canvas, snap: VroomPayload) {
        val lat = snap.mapState.destinationLat ?: return
        val lng = snap.mapState.destinationLng ?: return
        val point = project(lat, lng) ?: return
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(point.first, point.second, 19f, fill)
        fill.color = Color.WHITE
        canvas.drawCircle(point.first, point.second, 7f, fill)
    }



    private fun drawHud(canvas: Canvas, snap: VroomPayload?) {
        hitRects.clear()
        val safe = stableArea ?: visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
        val m = AutoHudMetrics.fromVisibleArea(safe, canvas.width, canvas.height)
        val top = m.contentTop()
        // The host's stable area reserves the whole top row for its actions.
        // Our navigation card sits on the free left side, so it can safely use
        // the actual visible map edge instead of being pushed below that row.
        val navigationTop = (visibleArea?.top?.toFloat() ?: m.safeTop) +
            m.s(if (m.compact) 8f else 10f)
        val bottom = m.contentBottom()
        strokePaint.strokeWidth = m.s(2.4f)
        var topPanelBottom = top
        var layoutMode = AutoHudLayoutMode.FREE_DRIVE
        var navigationPanel: RectF? = null

        when (uiMode) {
            AutoUiMode.SEARCH_RESULTS -> {
                layoutMode = AutoHudLayoutMode.SEARCH
                val panel = drawSearchOverlay(canvas, m, top, bottom)
                topPanelBottom = panel.bottom
                drawToast(canvas, m)
                reportHudInsets(m, layoutMode, topPanelBottom, m.speedPanelRect(bottom), m.recenterRect(bottom).left)
                return
            }
            AutoUiMode.REPORT_MENU -> {
                layoutMode = AutoHudLayoutMode.REPORT
                val panel = drawReportOverlay(canvas, m, top, bottom)
                topPanelBottom = panel.bottom
                drawToast(canvas, m)
                reportHudInsets(m, layoutMode, topPanelBottom, m.speedPanelRect(bottom), m.recenterRect(bottom).left)
                return
            }
            AutoUiMode.LOADING -> {
                layoutMode = AutoHudLayoutMode.LOADING
                drawLoadingOverlay(canvas, m, "Wyznaczam trase...")
                drawToast(canvas, m)
                reportHudInsets(m, layoutMode, top + m.s(120f), m.speedPanelRect(bottom), m.recenterRect(bottom).left)
                return
            }
            else -> {
                if (snap?.mapState?.routePreview == true && snap.isNavigating.not()) {
                    layoutMode = AutoHudLayoutMode.ROUTE_PREVIEW
                    val panel = drawRoutePreviewPanel(canvas, m, snap, top, bottom)
                    topPanelBottom = panel.bottom
                } else if (snap?.isNavigating == true) {
                    layoutMode = AutoHudLayoutMode.NAVIGATING
                    navigationPanel = drawPremiumNavigationHud(canvas, m, snap, navigationTop)
                    topPanelBottom = navigationPanel.bottom
                } else {
                    layoutMode = AutoHudLayoutMode.FREE_DRIVE
                    topPanelBottom = top
                }
            }
        }

        val speedRect = m.speedClusterRect(bottom)
        snap?.mapState?.speedLimitKmh?.toInt()?.takeIf { it > 0 }?.let { stickySpeedLimitKmh = it }
        NativeSpeedLimitFetcher.currentLimit()?.takeIf { it > 0 }?.let { stickySpeedLimitKmh = it }
        val limitKmh = stickySpeedLimitKmh
        drawPremiumSpeedCluster(canvas, m, speedRect, limitKmh)

        val recenterRect = m.cockpitRecenterRect(bottom)
        hitRects["recenter"] = recenterRect
        drawRecenterIconButton(canvas, recenterRect, m.uiScale)

        snap?.mapState?.activeDropPrompt?.let { drawDropPrompt(canvas, m, it) }
        if (navigationPanel != null) {
            drawNavigationAlert(canvas, m, navigationPanel)
        } else {
            drawToast(canvas, m)
        }
        reportHudInsets(m, layoutMode, topPanelBottom, speedRect, recenterRect.left, navigationPanel?.right)
    }

    private fun drawPremiumSpeedCluster(canvas: Canvas, m: AutoHudMetrics, rect: RectF, limitKmh: Int?) {
        val overLimit = limitKmh != null && displayedSpeedKmh > limitKmh + 7.0
        val radius = m.s(if (m.compact) 19f else 22f)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                if (isNightModeActive) Color.argb(248, 7, 10, 15) else Color.argb(248, 252, 253, 255),
                if (isNightModeActive) Color.argb(242, 20, 25, 34) else Color.argb(244, 232, 238, 244),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRoundRect(rect, radius, radius, background)
        strokePaint.color = if (overLimit) Color.rgb(255, 62, 65) else Color.argb(if (isNightModeActive) 165 else 105, 36, 202, 255)
        canvas.drawRoundRect(rect, radius, radius, strokePaint)

        val accent = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (overLimit) Color.rgb(255, 62, 65) else Color.rgb(227, 56, 53)
            strokeWidth = m.s(3f)
            strokeCap = Paint.Cap.ROUND
        }
        canvas.drawLine(rect.left + radius, rect.top + m.s(3f), rect.right - radius, rect.top + m.s(3f), accent)

        val dividerX = rect.left + m.s(if (m.compact) 78f else 92f)
        val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = hudTheme.divider
            strokeWidth = m.s(1.2f)
        }
        canvas.drawLine(dividerX, rect.top + m.s(15f), dividerX, rect.bottom - m.s(15f), divider)

        if (limitKmh != null) {
            drawSpeedLimitSign(
                canvas,
                m.speedLimitCenterX(rect),
                m.speedLimitCenterY(rect),
                m.s(if (m.compact) 25f else 29f),
                limitKmh,
                overLimit,
            )
        } else {
            smallText.textAlign = Paint.Align.CENTER
            smallText.textSize = m.ts(14f)
            smallText.color = hudTheme.textMuted
            canvas.drawText("LIMIT", m.speedLimitCenterX(rect), rect.centerY() - m.s(6f), smallText)
            textPaint.textAlign = Paint.Align.CENTER
            textPaint.textSize = m.ts(24f)
            textPaint.color = hudTheme.textPrimary
            canvas.drawText("--", m.speedLimitCenterX(rect), rect.centerY() + m.s(20f), textPaint)
        }

        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(if (m.compact) 43f else 50f)
        textPaint.color = if (overLimit) Color.rgb(255, 72, 75) else hudTheme.textPrimary
        canvas.drawText(
            Math.round(displayedSpeedKmh.coerceAtLeast(0.0)).coerceAtMost(299).toString(),
            m.speedValueCenterX(rect),
            m.speedValueBaseline(rect),
            textPaint,
        )
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = m.ts(if (m.compact) 12f else 14f)
        smallText.color = if (overLimit) Color.rgb(255, 144, 146) else hudTheme.textMuted
        canvas.drawText("km/h", m.speedValueCenterX(rect), m.speedUnitBaseline(rect), smallText)
    }

    private fun drawPremiumNavigationHud(canvas: Canvas, m: AutoHudMetrics, snap: VroomPayload, top: Float): RectF {
        val card = m.navigationCockpitRect(top)
        val corner = m.s(if (m.compact) 20f else 24f)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                card.left,
                card.top,
                card.right,
                card.bottom,
                if (isNightModeActive) Color.argb(250, 6, 9, 14) else Color.argb(250, 250, 252, 255),
                if (isNightModeActive) Color.argb(244, 18, 25, 35) else Color.argb(246, 226, 235, 243),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRoundRect(card, corner, corner, background)
        strokePaint.color = if (isNightModeActive) Color.argb(185, 36, 202, 255) else Color.argb(150, 0, 112, 176)
        canvas.drawRoundRect(card, corner, corner, strokePaint)

        val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(card.left, card.top, card.right, card.top, Color.rgb(227, 56, 53), Color.rgb(36, 202, 255), Shader.TileMode.CLAMP)
            strokeWidth = m.s(3.5f)
            strokeCap = Paint.Cap.ROUND
        }
        canvas.drawLine(card.left + corner, card.top + m.s(3f), card.right - corner, card.top + m.s(3f), accentPaint)

        val mainHeight = m.s(if (m.compact) 104f else 122f)
        val mainBottom = (card.top + mainHeight).coerceAtMost(card.bottom - m.s(42f))
        val statsWidth = m.s(if (m.compact) 86f else 112f)
        val iconSize = m.s(if (m.compact) 64f else 78f)
        val iconRect = RectF(
            card.left + m.s(12f),
            card.top + m.s(17f),
            card.left + m.s(12f) + iconSize,
            card.top + m.s(17f) + iconSize,
        )
        val iconBackground = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (isNightModeActive) Color.rgb(28, 192, 242) else Color.rgb(0, 137, 196)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(iconRect, m.s(18f), m.s(18f), iconBackground)

        val transition = ((System.currentTimeMillis() - maneuverTransitionStartedAt).toFloat() / 220f).coerceIn(0f, 1f)
        val eased = 1f - (1f - transition) * (1f - transition)
        val alpha = (120 + 135 * eased).toInt().coerceIn(120, 255)
        val mainLayer = canvas.saveLayerAlpha(card.left, card.top, card.right - statsWidth, mainBottom, alpha)
        canvas.translate(0f, m.s(8f) * (1f - eased))
        drawManeuverGlyph(
            canvas,
            iconRect.centerX(),
            iconRect.centerY(),
            m.s(if (m.compact) 20f else 25f),
            AutoManeuverResolver.drawGlyphKind(snap.maneuver, snap.maneuverModifier, snap.instruction),
            if (isNightModeActive) Color.rgb(3, 8, 13) else Color.WHITE,
        )

        val textLeft = iconRect.right + m.s(12f)
        val textRight = card.right - statsWidth - m.s(16f)
        val textWidth = (textRight - textLeft).coerceAtLeast(m.s(94f))
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(if (m.compact) 17f else 21f)
        smallText.color = hudTheme.accent
        canvas.drawText(formatMeters(snap.turnDistanceMeters ?: snap.remainingDistanceMeters), textLeft, card.top + m.s(34f), smallText)
        smallText.textSize = m.ts(if (m.compact) 18f else 23f)
        smallText.color = hudTheme.textPrimary
        canvas.drawText(fitText(polishInstructionForHud(snap), smallText, textWidth), textLeft, card.top + m.s(if (m.compact) 62f else 70f), smallText)
        smallText.textSize = m.ts(if (m.compact) 12f else 14f)
        smallText.color = hudTheme.textMuted
        canvas.drawText(
            fitText(snap.destinationName?.takeIf { it.isNotBlank() } ?: "Prowadzenie aktywne", smallText, textWidth),
            textLeft,
            card.top + m.s(if (m.compact) 84f else 98f),
            smallText,
        )
        canvas.restoreToCount(mainLayer)
        if (transition < 1f) postInvalidateOnAnimation()

        val statsLeft = card.right - statsWidth
        val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = hudTheme.divider
            strokeWidth = m.s(1.2f)
        }
        canvas.drawLine(statsLeft, card.top + m.s(14f), statsLeft, mainBottom - m.s(8f), divider)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = m.ts(if (m.compact) 11f else 12f)
        smallText.color = hudTheme.textMuted
        canvas.drawText("DO CELU", statsLeft + statsWidth / 2f, card.top + m.s(25f), smallText)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(if (m.compact) 18f else 22f)
        textPaint.color = hudTheme.textPrimary
        canvas.drawText(formatKm(snap.remainingDistanceMeters), statsLeft + statsWidth / 2f, card.top + m.s(50f), textPaint)
        textPaint.textSize = m.ts(if (m.compact) 17f else 20f)
        textPaint.color = hudTheme.positive
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), statsLeft + statsWidth / 2f, card.top + m.s(if (m.compact) 75f else 81f), textPaint)
        smallText.textSize = m.ts(if (m.compact) 11f else 12f)
        smallText.color = hudTheme.textSecondary
        canvas.drawText(formatEtaClock(snap.remainingDurationSec), statsLeft + statsWidth / 2f, card.top + m.s(if (m.compact) 95f else 105f), smallText)

        canvas.drawLine(card.left + m.s(14f), mainBottom, card.right - m.s(14f), mainBottom, divider)
        val upcoming = snap.upcomingSteps.take(3)
        val queueTop = mainBottom + m.s(7f)
        val queueBottom = card.bottom - m.s(8f)
        if (upcoming.isEmpty()) {
            smallText.textAlign = Paint.Align.LEFT
            smallText.textSize = m.ts(13f)
            smallText.color = hudTheme.textMuted
            canvas.drawText("Dalej zgodnie z trasą", card.left + m.s(16f), queueTop + m.s(21f), smallText)
        } else {
            val gap = m.s(6f)
            val available = card.width() - m.s(28f) - gap * (upcoming.size - 1)
            val chipWidth = available / upcoming.size
            upcoming.forEachIndexed { index, step ->
                val left = card.left + m.s(14f) + index * (chipWidth + gap)
                drawUpcomingStepChip(canvas, m, RectF(left, queueTop, left + chipWidth, queueBottom), step, index)
            }
        }
        textPaint.textAlign = Paint.Align.CENTER
        return card
    }

    private fun drawUpcomingStepChip(canvas: Canvas, m: AutoHudMetrics, rect: RectF, step: AutoUpcomingStep, index: Int) {
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (isNightModeActive) Color.argb(190, 27, 34, 45) else Color.argb(205, 218, 228, 236)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(rect, m.s(11f), m.s(11f), fill)
        drawManeuverGlyph(
            canvas,
            rect.left + m.s(18f),
            rect.centerY(),
            m.s(if (m.compact) 7f else 8f),
            AutoManeuverResolver.drawGlyphKind(step.maneuver, step.maneuverModifier, step.instruction),
            if (index == 0) hudTheme.accent else hudTheme.textSecondary,
        )
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(if (m.compact) 11f else 12f)
        smallText.color = if (index == 0) hudTheme.textPrimary else hudTheme.textSecondary
        val distance = formatMeters(step.distanceMeters)
        canvas.drawText(distance, rect.left + m.s(32f), rect.centerY() + m.s(4f), smallText)
    }

    private fun drawNavigationAlert(canvas: Canvas, m: AutoHudMetrics, navigationRect: RectF) {
        val message = toastText ?: return
        if (System.currentTimeMillis() > toastUntil) {
            toastText = null
            return
        }
        val rect = m.navigationAlertRect(navigationRect)
        if (rect.height() < m.s(34f)) return
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (isNightModeActive) Color.argb(248, 48, 14, 18) else Color.argb(250, 255, 238, 239)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(rect, m.s(15f), m.s(15f), fill)
        strokePaint.color = Color.rgb(255, 72, 75)
        canvas.drawRoundRect(rect, m.s(15f), m.s(15f), strokePaint)
        val warningPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(255, 72, 75)
            style = Paint.Style.FILL
        }
        val cx = rect.left + m.s(23f)
        val cy = rect.centerY()
        val triangle = Path().apply {
            moveTo(cx, cy - m.s(10f))
            lineTo(cx - m.s(10f), cy + m.s(9f))
            lineTo(cx + m.s(10f), cy + m.s(9f))
            close()
        }
        canvas.drawPath(triangle, warningPaint)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(if (m.compact) 13f else 15f)
        smallText.color = hudTheme.textPrimary
        canvas.drawText(fitText(message, smallText, rect.width() - m.s(58f)), rect.left + m.s(43f), rect.centerY() + m.s(5f), smallText)
        postInvalidateDelayed(250L)
    }

    private fun reportHudInsets(
        m: AutoHudMetrics,
        mode: AutoHudLayoutMode,
        topPanelBottom: Float,
        speedRect: RectF,
        rightControlLeft: Float,
        leftPanelRight: Float? = null,
    ) {
        hudInsetsListener?.invoke(
            m.computeInsets(mode, topPanelBottom, speedRect, rightControlLeft, leftPanelRight),
            m.uiScale,
        )
    }

    private fun drawDropPrompt(canvas: Canvas, m: AutoHudMetrics, drop: AutoGeoDrop) {
        val rect = m.dropPromptRect()
        panelPaint.color = Color.argb(238, 12, 13, 18)
        canvas.drawRoundRect(rect, m.s(18f), m.s(18f), panelPaint)
        strokePaint.color = Color.rgb(255, 215, 0)
        canvas.drawRoundRect(rect, m.s(18f), m.s(18f), strokePaint)
        textPaint.textSize = m.ts(19f)
        textPaint.color = Color.WHITE
        canvas.drawText("Zrzut w poblizu", rect.centerX(), rect.top + m.s(27f), textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = m.ts(14f)
        smallText.color = Color.rgb(255, 215, 0)
        canvas.drawText(drop.label.take(28), rect.centerX(), rect.top + m.s(50f), smallText)
    }

    private fun drawSearchOverlay(canvas: Canvas, m: AutoHudMetrics, top: Float, bottom: Float): RectF {
        val wantsResults = searchLoading || searchResults.isNotEmpty()
        val theme = hudTheme
        val panel = m.searchOverlayPanel(top, bottom, wantsResults)
        panelPaint.color = theme.panel
        canvas.drawRoundRect(panel, m.s(22f), m.s(22f), panelPaint)

        val close = RectF(panel.left + m.s(14f), panel.top + m.s(12f), panel.left + m.s(58f), panel.top + m.s(56f))
        hitRects["search_close"] = close
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(30f)
        textPaint.color = theme.textPrimary
        canvas.drawText("<", close.centerX(), close.centerY() + m.s(10f), textPaint)

        val input = RectF(panel.left + m.s(68f), panel.top + m.s(12f), panel.right - m.s(62f), panel.top + m.s(56f))
        val inputPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = theme.input
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(input, m.s(22f), m.s(22f), inputPaint)
        drawSearchIcon(canvas, input.left + m.s(28f), input.centerY(), m.uiScale)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(21f)
        smallText.color = theme.textPrimary
        canvas.drawText(searchQuery.ifBlank { "Szukaj w VROOM" }.take(30), input.left + m.s(60f), input.centerY() + m.s(8f), smallText)

        val submit = RectF(panel.right - m.s(56f), panel.top + m.s(12f), panel.right - m.s(14f), panel.top + m.s(56f))
        hitRects["search_submit"] = submit
        textPaint.textSize = m.ts(24f)
        textPaint.color = theme.accent
        canvas.drawText(">", submit.centerX(), submit.centerY() + m.s(8f), textPaint)

        if (searchQuery.isNotEmpty()) {
            val clear = RectF(input.right - m.s(42f), input.top + m.s(4f), input.right - m.s(5f), input.bottom - m.s(4f))
            hitRects["search_clear"] = clear
            textPaint.textSize = m.ts(20f)
            textPaint.color = theme.textMuted
            canvas.drawText("x", clear.centerX(), clear.centerY() + m.s(7f), textPaint)
        }

        var y = input.bottom + m.s(14f)
        if (searchLoading) {
            smallText.textAlign = Paint.Align.LEFT
            smallText.textSize = m.ts(23f)
            smallText.color = theme.textPrimary
            canvas.drawText("Szukam w poblizu...", panel.left + m.s(28f), y + m.s(36f), smallText)
            return panel
        }
        if (searchResults.isNotEmpty()) {
            val rowH = m.s(64f)
            searchResults.take(3).forEachIndexed { index, item ->
                val row = RectF(panel.left + m.s(22f), y, panel.right - m.s(22f), y + rowH)
                hitRects["search_result_$index"] = row
                panelPaint.color = Color.argb(0, 0, 0, 0)
                canvas.drawRoundRect(row, m.s(14f), m.s(14f), panelPaint)
                textPaint.textAlign = Paint.Align.LEFT
                textPaint.textSize = m.ts(24f)
                textPaint.color = theme.textPrimary
                canvas.drawText(item.name.take(25), row.left + m.s(54f), row.top + m.s(28f), textPaint)
                smallText.textAlign = Paint.Align.LEFT
                smallText.textSize = m.ts(16f)
                smallText.color = theme.textMuted
                canvas.drawText(item.address.take(44), row.left + m.s(54f), row.top + m.s(52f), smallText)
                smallText.textAlign = Paint.Align.RIGHT
                smallText.color = theme.destructiveText
                canvas.drawText(item.etaText, row.right - m.s(4f), row.top + m.s(31f), smallText)
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.textSize = m.ts(19f)
                textPaint.color = theme.accent
                canvas.drawText("o", row.left + m.s(23f), row.top + m.s(38f), textPaint)
                val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = theme.divider
                    strokeWidth = 1f
                }
                canvas.drawLine(row.left + m.s(54f), row.bottom + 1f, row.right, row.bottom + 1f, divider)
                y += rowH + m.s(4f)
            }
            textPaint.textAlign = Paint.Align.CENTER
            return panel
        }

        val cats = listOf(
            Pair("search_cat_fuel", "Paliwo"),
            Pair("search_cat_parking", "Parking"),
            Pair("search_cat_food", "Jedzenie"),
            Pair("search_cat_coffee", "Kawa")
        )
        val gap = m.s(10f)
        val chipW = ((panel.width() - m.s(44f) - gap * 3f) / 4f).coerceAtMost(m.s(142f))
        var x = panel.left + m.s(22f)
        cats.forEach { cat ->
            val chip = RectF(x, y, x + chipW, y + m.s(38f))
            hitRects[cat.first] = chip
            panelPaint.color = theme.chip
            canvas.drawRoundRect(chip, m.s(19f), m.s(19f), panelPaint)
            smallText.textAlign = Paint.Align.CENTER
            smallText.textSize = m.ts(16f)
            smallText.color = theme.textPrimary
            canvas.drawText(cat.second, chip.centerX(), chip.centerY() + m.s(6f), smallText)
            x += chipW + gap
        }
        y += m.s(50f)

        val rows = listOf("1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
        rows.forEachIndexed { rowIndex, rowText ->
            val keyW = m.s(34f)
            val keyGap = if (rowIndex == 3) m.s(13f) else m.s(20f)
            val rowWidth = rowText.length * keyW + (rowText.length - 1) * keyGap
            x = panel.centerX() - rowWidth / 2f
            rowText.forEach { ch ->
                val key = RectF(x, y, x + keyW, y + m.s(30f))
                hitRects["search_key_$ch"] = key
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.textSize = m.ts(19f)
                textPaint.color = theme.textPrimary
                canvas.drawText(ch.toString(), key.centerX(), key.centerY() + m.s(7f), textPaint)
                x += keyW + keyGap
            }
            if (rowIndex == 3) {
                val back = RectF(panel.right - m.s(86f), y - m.s(1f), panel.right - m.s(22f), y + m.s(31f))
                hitRects["search_backspace"] = back
                panelPaint.color = theme.chip
                canvas.drawRoundRect(back, m.s(16f), m.s(16f), panelPaint)
                textPaint.textSize = m.ts(18f)
                textPaint.color = theme.textPrimary
                canvas.drawText("del", back.centerX(), back.centerY() + m.s(6f), textPaint)
            }
            y += m.s(35f)
        }
        val space = RectF(panel.centerX() - m.s(120f), y - m.s(1f), panel.centerX() + m.s(120f), y + m.s(27f))
        hitRects["search_space"] = space
        panelPaint.color = theme.input
        canvas.drawRoundRect(space, m.s(14f), m.s(14f), panelPaint)
        return panel
    }

    private fun drawReportOverlay(canvas: Canvas, m: AutoHudMetrics, top: Float, bottom: Float): RectF {
        val panel = m.reportOverlayPanel(top, bottom)
        panelPaint.color = Color.argb(246, 8, 8, 10)
        strokePaint.color = Color.argb(150, 227, 56, 53)
        canvas.drawRoundRect(panel, m.s(22f), m.s(22f), panelPaint)
        canvas.drawRoundRect(panel, m.s(22f), m.s(22f), strokePaint)

        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(22f)
        smallText.color = Color.WHITE
        canvas.drawText("Zgloszenie", panel.left + m.s(20f), panel.top + m.s(38f), smallText)
        val close = RectF(panel.right - m.s(50f), panel.top + m.s(10f), panel.right - m.s(12f), panel.top + m.s(48f))
        hitRects["report_close"] = close
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(22f)
        textPaint.color = Color.rgb(190, 194, 202)
        canvas.drawText("x", close.centerX(), close.centerY() + m.s(7f), textPaint)

        val reports = listOf(
            Pair("report_type_accident", "Wypadek"),
            Pair("report_type_traffic", "Korek"),
            Pair("report_type_speed_control", "Policja"),
            Pair("report_type_weather", "Pogoda"),
            Pair("report_type_car_breakdown", "Awaria")
        )
        val gap = m.s(10f)
        val cellW = (panel.width() - m.s(50f)) / 2f
        val cellH = m.s(54f)
        reports.forEachIndexed { index, item ->
            val col = index % 2
            val row = index / 2
            val left = panel.left + m.s(20f) + col * (cellW + gap)
            val topCell = panel.top + m.s(62f) + row * (cellH + gap)
            val rect = RectF(left, topCell, left + cellW, topCell + cellH)
            hitRects[item.first] = rect
            panelPaint.color = Color.argb(238, 20, 22, 28)
            canvas.drawRoundRect(rect, m.s(16f), m.s(16f), panelPaint)
            smallText.textAlign = Paint.Align.CENTER
            smallText.textSize = m.ts(17f)
            smallText.color = Color.WHITE
            canvas.drawText(item.second, rect.centerX(), rect.centerY() + m.s(6f), smallText)
        }
        return panel
    }

    private fun drawLoadingOverlay(canvas: Canvas, m: AutoHudMetrics, text: String) {
        val rect = m.loadingOverlayRect(canvas.width.toFloat(), canvas.height.toFloat())
        panelPaint.color = Color.argb(240, 8, 8, 10)
        canvas.drawRoundRect(rect, m.s(22f), m.s(22f), panelPaint)
        textPaint.textSize = m.ts(23f)
        textPaint.color = Color.WHITE
        canvas.drawText(text, rect.centerX(), rect.centerY() + m.s(8f), textPaint)
    }

    private fun drawToast(canvas: Canvas, m: AutoHudMetrics) {
        val text = toastText ?: return
        if (System.currentTimeMillis() > toastUntil) {
            toastText = null
            return
        }
        val rect = m.toastRect(canvas.width.toFloat())
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, m.s(18f), m.s(18f), panelPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = m.ts(18f)
        smallText.color = Color.WHITE
        canvas.drawText(text, rect.centerX(), rect.centerY() + m.s(7f), smallText)
        postInvalidateDelayed(250L)
    }

    private fun drawRoutePreviewPanel(canvas: Canvas, m: AutoHudMetrics, snap: VroomPayload, top: Float, bottom: Float): RectF {
        val previewJson = runCatching { VroomCarManager.getRoutePreviewPayload()?.let { JSONObject(it) } }.getOrNull()
        val alternatives = previewJson?.optJSONObject("mapState")?.optJSONArray("alternativeRoutes")
        val selectedIndex = previewJson?.optJSONObject("mapState")?.optInt("selectedRouteIndex", 0) ?: 0
        val altCount = alternatives?.length() ?: 0
        val theme = hudTheme
        val panel = m.routePreviewPanelRect(top, altCount)
        panelPaint.color = theme.elevatedPanel
        strokePaint.color = theme.border
        canvas.drawRoundRect(panel, m.s(22f), m.s(22f), panelPaint)
        canvas.drawRoundRect(panel, m.s(22f), m.s(22f), strokePaint)

        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(24f)
        smallText.color = theme.textPrimary
        val title = snap.destinationName?.takeIf { it.isNotBlank() } ?: "Cel"
        canvas.drawText(fitText(title, smallText, panel.width() - m.s(48f)), panel.left + m.s(24f), panel.top + m.s(42f), smallText)

        val extraAltHeight = if (altCount > 1) m.s(54f) else 0f
        if (altCount > 1 && alternatives != null) {
            val chipTop = panel.top + m.s(54f)
            val chipWidth = ((panel.width() - m.s(48f)) / altCount.coerceAtMost(3)).coerceAtMost(m.s(108f))
            for (i in 0 until altCount.coerceAtMost(3)) {
                val alt = alternatives.optJSONObject(i) ?: continue
                val chip = RectF(panel.left + m.s(24f) + i * (chipWidth + m.s(8f)), chipTop, panel.left + m.s(24f) + i * (chipWidth + m.s(8f)) + chipWidth, chipTop + m.s(44f))
                hitRects["route_alt_$i"] = chip
                val chipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = if (i == selectedIndex) theme.chipSelected else theme.chip
                    style = Paint.Style.FILL
                }
                canvas.drawRoundRect(chip, m.s(14f), m.s(14f), chipPaint)
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.textSize = m.ts(16f)
                textPaint.color = if (i == selectedIndex) Color.WHITE else theme.textSecondary
                canvas.drawText("Trasa ${i + 1}", chip.centerX(), chip.centerY() + m.s(6f), textPaint)
                smallText.textSize = m.ts(12f)
                smallText.color = if (i == selectedIndex) Color.argb(220, 255, 255, 255) else theme.textMuted
                canvas.drawText(formatDurationShort(alt.optInt("durationS", 0)), chip.centerX(), chip.bottom - m.s(8f), smallText)
            }
        }

        val statsTop = panel.top + m.s(54f) + extraAltHeight
        textPaint.textAlign = Paint.Align.LEFT
        textPaint.textSize = m.ts(27f)
        textPaint.color = theme.destructiveText
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), panel.left + m.s(24f), statsTop + m.s(32f), textPaint)
        smallText.textSize = m.ts(18f)
        smallText.color = theme.textSecondary
        canvas.drawText(" · ${formatEtaClock(snap.remainingDurationSec)}", panel.left + m.s(128f), statsTop + m.s(31f), smallText)

        smallText.textSize = m.ts(18f)
        smallText.color = theme.positive
        canvas.drawText("${formatKm(snap.remainingDistanceMeters)} do celu", panel.left + m.s(24f), statsTop + m.s(62f), smallText)

        val start = RectF(panel.left + m.s(24f), panel.bottom - m.s(62f), panel.right - m.s(86f), panel.bottom - m.s(16f))
        hitRects["start_preview"] = start
        val startPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(12, 132, 126)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(start, m.s(27f), m.s(27f), startPaint)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(20f)
        textPaint.color = Color.WHITE
        canvas.drawText("Rozpocznij", start.centerX() + m.s(14f), start.centerY() + m.s(8f), textPaint)
        drawUpArrowGlyph(canvas, start.left + m.s(34f), start.centerY(), m.s(12f))

        val cancel = RectF(panel.right - m.s(70f), panel.bottom - m.s(62f), panel.right - m.s(20f), panel.bottom - m.s(16f))
        hitRects["cancel_preview"] = cancel
        val cancelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = theme.chip
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(cancel, m.s(27f), m.s(27f), cancelPaint)
        drawCloseGlyph(canvas, cancel.centerX(), cancel.centerY(), m.s(11f), theme.cancelIcon)
        textPaint.textAlign = Paint.Align.CENTER
        return panel
    }

    private fun drawNavigationTopBar(canvas: Canvas, m: AutoHudMetrics, snap: VroomPayload, top: Float): RectF {
        val card = m.navBarRect(top)
        panelPaint.color = Color.argb(242, 6, 8, 12)
        strokePaint.color = Color.argb(135, 36, 202, 255)
        canvas.drawRoundRect(card, m.s(22f), m.s(22f), panelPaint)
        canvas.drawRoundRect(card, m.s(22f), m.s(22f), strokePaint)

        val iconBox = RectF(card.left + m.s(14f), card.top + m.s(14f), card.left + m.s(78f), card.bottom - m.s(14f))
        val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(36, 202, 255)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(iconBox, m.s(18f), m.s(18f), iconPaint)
        drawManeuverGlyph(
            canvas,
            iconBox.centerX(),
            iconBox.centerY(),
            m.s(16f),
            AutoManeuverResolver.drawGlyphKind(snap.maneuver, snap.maneuverModifier, snap.instruction),
            Color.rgb(4, 7, 12),
        )

        val stats = RectF(card.right - m.s(120f), card.top + m.s(12f), card.right - m.s(14f), card.bottom - m.s(12f))
        val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(70, 255, 255, 255)
            strokeWidth = m.s(1.5f)
        }
        canvas.drawLine(stats.left - m.s(12f), card.top + m.s(16f), stats.left - m.s(12f), card.bottom - m.s(16f), divider)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = m.ts(23f)
        textPaint.color = Color.WHITE
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), stats.centerX(), stats.top + m.s(27f), textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = m.ts(15f)
        smallText.color = Color.rgb(36, 202, 255)
        canvas.drawText(formatKm(snap.remainingDistanceMeters), stats.centerX(), stats.top + m.s(52f), smallText)

        val textLeft = iconBox.right + m.s(16f)
        val textRight = stats.left - m.s(22f)
        val textWidth = (textRight - textLeft).coerceAtLeast(m.s(120f))
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = m.ts(16f)
        smallText.color = Color.rgb(36, 202, 255)
        canvas.drawText(formatMeters(snap.turnDistanceMeters ?: snap.remainingDistanceMeters), textLeft, card.top + m.s(28f), smallText)
        smallText.textSize = m.ts(22f)
        smallText.color = Color.WHITE
        canvas.drawText(fitText(polishInstructionForHud(snap), smallText, textWidth), textLeft, card.top + m.s(58f), smallText)
        smallText.textSize = m.ts(14f)
        smallText.color = Color.rgb(170, 170, 178)
        canvas.drawText(fitText(snap.destinationName?.takeIf { it.isNotBlank() } ?: "Prowadzenie aktywne", smallText, textWidth), textLeft, card.bottom - m.s(12f), smallText)
        textPaint.textAlign = Paint.Align.CENTER

        val stop = RectF(card.right + m.s(12f), card.top + m.s(12f), card.right + m.s(76f), card.bottom - m.s(12f))
        hitRects["stop_navigation"] = stop
        val stopPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(238, 8, 8, 10)
            style = Paint.Style.FILL
        }
        val stopStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(150, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = m.s(2f)
        }
        canvas.drawRoundRect(stop, m.s(18f), m.s(18f), stopPaint)
        canvas.drawRoundRect(stop, m.s(18f), m.s(18f), stopStroke)
        drawCloseGlyph(canvas, stop.centerX(), stop.centerY(), m.s(11f), Color.WHITE)
        return RectF(card.left, card.top, stop.right, card.bottom)
    }

    private fun drawEtaBottomBar(canvas: Canvas, snap: VroomPayload, bottom: Float) {
        val card = RectF(150f, bottom - 64f, canvas.width.toFloat() - 154f, bottom)
        panelPaint.color = Color.argb(242, 6, 8, 12)
        strokePaint.color = Color.argb(110, 255, 255, 255)
        canvas.drawRoundRect(card, 20f, 20f, panelPaint)
        canvas.drawRoundRect(card, 20f, 20f, strokePaint)
        textPaint.textSize = 27f
        textPaint.color = Color.WHITE
        textPaint.textAlign = Paint.Align.LEFT
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), card.left + 18f, card.top + 40f, textPaint)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 17f
        smallText.color = Color.rgb(36, 202, 255)
        canvas.drawText(formatKm(snap.remainingDistanceMeters), card.left + 120f, card.top + 39f, smallText)
        textPaint.textAlign = Paint.Align.CENTER
    }

    private fun formatMeters(meters: Int?): String {
        val value = meters ?: return "--"
        return if (value >= 1000) {
            String.format(java.util.Locale.US, "%.1f km", value / 1000.0)
        } else {
            "${value.coerceAtLeast(0)} m"
        }
    }

    private fun formatEta(seconds: Int?): String {
        val sec = seconds ?: return "--"
        val arrival = System.currentTimeMillis() + sec.coerceAtLeast(0) * 1000L
        val fmt = java.text.SimpleDateFormat("HH:mm", java.util.Locale("pl", "PL"))
        return "Cel ${fmt.format(java.util.Date(arrival))}"
    }

    private fun formatEtaClock(seconds: Int?): String {
        val sec = seconds ?: return "--:--"
        val arrival = System.currentTimeMillis() + sec.coerceAtLeast(0) * 1000L
        val fmt = java.text.SimpleDateFormat("HH:mm", java.util.Locale("pl", "PL"))
        return fmt.format(java.util.Date(arrival))
    }

    private fun formatKm(meters: Int?): String {
        val value = meters ?: return "-- km"
        return String.format(java.util.Locale.US, "%.1f km", value.coerceAtLeast(0) / 1000.0)
    }

    private fun formatDurationShort(seconds: Int?): String {
        val minutes = ((seconds ?: 0) / 60).coerceAtLeast(1)
        return if (minutes >= 60) {
            val h = minutes / 60
            val m = minutes % 60
            if (m == 0) "${h} h" else "${h} h ${m} min"
        } else {
            "$minutes min"
        }
    }

    private fun fitText(value: String, paint: Paint, maxWidth: Float): String {
        if (maxWidth <= 0f || paint.measureText(value) <= maxWidth) return value
        val suffix = "..."
        var end = value.length
        while (end > 1 && paint.measureText(value.take(end) + suffix) > maxWidth) {
            end--
        }
        return value.take(end).trimEnd() + suffix
    }

    private fun maneuverSymbol(maneuver: String?, modifier: String?): String {
        val type = maneuver?.lowercase(java.util.Locale.US).orEmpty()
        val mod = modifier?.lowercase(java.util.Locale.US).orEmpty()
        return when {
            type == "roundabout" || type == "rotary" -> "⟳"
            type == "arrive" -> "■"
            mod.contains("left") -> "↰"
            mod.contains("right") -> "↱"
            mod.contains("uturn") -> "↶"
            type == "fork" -> "Y"
            type == "merge" -> "↗"
            else -> "↑"
        }
    }

    private fun polishInstructionForHud(snap: VroomPayload): String {
        return AutoInstructionFormatter.cue(
            instruction = snap.instruction,
            destinationName = snap.destinationName,
            maneuver = snap.maneuver,
            modifier = snap.maneuverModifier,
            exit = snap.maneuverExit,
        )
    }

    private fun drawSearchIcon(canvas: Canvas, cx: Float, cy: Float, scale: Float = 1f) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 4f * scale
        }
        canvas.drawCircle(cx - 5f * scale, cy - 4f * scale, 11f * scale, paint)
        canvas.drawLine(cx + 4f * scale, cy + 6f * scale, cx + 17f * scale, cy + 19f * scale, paint)
    }

    private fun drawLiveBadge(canvas: Canvas, m: AutoHudMetrics, left: Float, top: Float) {
        val rect = RectF(left, top, left + m.liveBadgeWidth(), top + m.s(42f))
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, m.s(21f), m.s(21f), panelPaint)
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(77, 233, 38)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(rect.left + m.s(24f), rect.centerY(), m.s(8f), dot)
        textPaint.textSize = m.ts(18f)
        textPaint.color = Color.rgb(77, 233, 38)
        canvas.drawText("LIVE", rect.left + m.s(70f), rect.centerY() + m.s(7f), textPaint)
    }

    private fun drawReportButton(canvas: Canvas, m: AutoHudMetrics, rect: RectF) {
        val red = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(rect, m.s(18f), m.s(18f), red)
        textPaint.textSize = m.ts(18f)
        textPaint.color = Color.WHITE
        canvas.drawText("ZGLOS", rect.centerX(), rect.bottom - m.s(18f), textPaint)
        val tri = Path().apply {
            moveTo(rect.centerX(), rect.top + m.s(16f))
            lineTo(rect.centerX() - m.s(20f), rect.top + m.s(48f))
            lineTo(rect.centerX() + m.s(20f), rect.top + m.s(48f))
            close()
        }
        val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        canvas.drawPath(tri, white)
        textPaint.color = Color.rgb(227, 56, 53)
        textPaint.textSize = m.ts(22f)
        canvas.drawText("!", rect.centerX(), rect.top + m.s(43f), textPaint)
    }

    private fun drawSpeedLimitSign(
        canvas: Canvas,
        cx: Float,
        cy: Float,
        radius: Float,
        limitKmh: Int,
        overLimit: Boolean
    ) {
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (overLimit) Color.rgb(255, 245, 245) else Color.WHITE
            style = Paint.Style.FILL
        }
        val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 3f * (radius / 21f)
        }
        canvas.drawCircle(cx, cy, radius, fillPaint)
        canvas.drawCircle(cx, cy, radius, ringPaint)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = if (limitKmh >= 100) radius * 0.66f else radius * 0.81f
        textPaint.color = Color.rgb(20, 20, 20)
        canvas.drawText(limitKmh.toString(), cx, cy + radius * 0.28f, textPaint)
    }

    private fun drawRecenterIconButton(canvas: Canvas, rect: RectF, scale: Float = 1f) {
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 18f * scale, 18f * scale, panelPaint)
        strokePaint.color = Color.argb(130, 255, 255, 255)
        canvas.drawRoundRect(rect, 18f * scale, 18f * scale, strokePaint)
        val cx = rect.centerX()
        val cy = rect.centerY()
        val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(230, 230, 236)
            style = Paint.Style.STROKE
            strokeWidth = 3f * scale
        }
        canvas.drawCircle(cx, cy, 14f * scale, ring)
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(230, 230, 236)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(cx, cy, 4f * scale, dot)
    }

    private fun drawCloseGlyph(canvas: Canvas, cx: Float, cy: Float, half: Float, color: Int) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 3.5f
            strokeCap = Paint.Cap.ROUND
        }
        canvas.drawLine(cx - half, cy - half, cx + half, cy + half, paint)
        canvas.drawLine(cx + half, cy - half, cx - half, cy + half, paint)
    }

    private fun drawUpArrowGlyph(canvas: Canvas, cx: Float, cy: Float, half: Float) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        val path = Path().apply {
            moveTo(cx, cy - half)
            lineTo(cx + half, cy + half * 0.6f)
            lineTo(cx - half, cy + half * 0.6f)
            close()
        }
        canvas.drawPath(path, paint)
    }

    private fun drawManeuverGlyph(
        canvas: Canvas,
        cx: Float,
        cy: Float,
        size: Float,
        kind: String,
        color: Int
    ) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 4f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        when (kind) {
            "roundabout" -> canvas.drawCircle(cx, cy, size * 0.7f, paint)
            "arrive" -> canvas.drawRect(cx - size * 0.55f, cy - size * 0.55f, cx + size * 0.55f, cy + size * 0.55f, fill)
            "left", "slight-left", "sharp-left", "ramp-left" -> {
                val path = Path().apply {
                    moveTo(cx, cy - size)
                    lineTo(cx, cy + size * 0.2f)
                    lineTo(cx - size * 0.9f, cy + size * 0.2f)
                }
                canvas.drawPath(path, paint)
                drawArrowHead(canvas, cx - size * 0.9f, cy + size * 0.2f, -90f, size * 0.42f, color)
            }
            "right", "slight-right", "sharp-right", "ramp-right" -> {
                val path = Path().apply {
                    moveTo(cx, cy - size)
                    lineTo(cx, cy + size * 0.2f)
                    lineTo(cx + size * 0.9f, cy + size * 0.2f)
                }
                canvas.drawPath(path, paint)
                drawArrowHead(canvas, cx + size * 0.9f, cy + size * 0.2f, 90f, size * 0.42f, color)
            }
            "uturn-left", "uturn-right" -> {
                val rightTurn = kind == "uturn-right"
                val direction = if (rightTurn) 1f else -1f
                val path = Path().apply {
                    moveTo(cx - direction * size * 0.2f, cy - size)
                    lineTo(cx - direction * size * 0.2f, cy + size * 0.35f)
                    quadTo(cx - direction * size * 0.2f, cy + size, cx + direction * size * 0.55f, cy + size)
                }
                canvas.drawPath(path, paint)
                drawArrowHead(canvas, cx + direction * size * 0.55f, cy + size, direction * 90f, size * 0.42f, color)
            }
            "merge", "merge-left", "merge-right", "fork-left", "fork-right" -> {
                val direction = when {
                    kind.endsWith("left") -> -1f
                    kind.endsWith("right") -> 1f
                    else -> 0f
                }
                val path = Path().apply {
                    moveTo(cx + direction * size, cy + size * 0.65f)
                    lineTo(cx, cy - size)
                    if (direction == 0f) lineTo(cx - size, cy + size * 0.65f)
                }
                canvas.drawPath(path, paint)
                drawArrowHead(canvas, cx, cy - size, 0f, size * 0.42f, color)
            }
            else -> {
                val path = Path().apply {
                    moveTo(cx, cy + size)
                    lineTo(cx, cy - size * 0.2f)
                    lineTo(cx, cy - size)
                }
                canvas.drawPath(path, paint)
                drawArrowHead(canvas, cx, cy - size, 0f, size * 0.42f, color)
            }
        }
    }

    private fun drawArrowHead(canvas: Canvas, tipX: Float, tipY: Float, degrees: Float, size: Float, color: Int) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
        }
        val save = canvas.save()
        canvas.rotate(degrees, tipX, tipY)
        val path = Path().apply {
            moveTo(tipX, tipY - size)
            lineTo(tipX + size * 0.58f, tipY + size * 0.42f)
            lineTo(tipX - size * 0.58f, tipY + size * 0.42f)
            close()
        }
        canvas.drawPath(path, paint)
        canvas.restoreToCount(save)
    }

    private fun drawRoundIconButton(canvas: Canvas, rect: RectF, label: String, color: Int) {
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 18f, 18f, panelPaint)
        strokePaint.color = Color.argb(130, 255, 255, 255)
        canvas.drawRoundRect(rect, 18f, 18f, strokePaint)
        textPaint.textSize = 34f
        textPaint.color = color
        canvas.drawText(label, rect.centerX(), rect.centerY() + 12f, textPaint)
    }

    private var cachedArrowMarkerBitmap: Bitmap? = null
    private var cachedArrowMarkerPx = 0

    private fun ensureArrowMarkerBitmap(targetPx: Int): Bitmap {
        val px = targetPx.coerceAtLeast(48)
        cachedArrowMarkerBitmap?.takeIf { cachedArrowMarkerPx == px }?.let { return it }
        val drawable = androidx.core.content.ContextCompat.getDrawable(
            overlayContext,
            R.drawable.vroom_location_arrow,
        )
        val bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        if (drawable != null) {
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, px, px)
            drawable.draw(canvas)
        }
        cachedArrowMarkerBitmap = bitmap
        cachedArrowMarkerPx = px
        return bitmap
    }

    private fun markerScreenHeading(heading: Double): Double {
        if (followMode) return 0.0
        val bearing = mapView?.getMapboxMap()?.cameraState?.bearing ?: 0.0
        return ((heading - bearing) % 360.0 + 360.0) % 360.0
    }

    private fun drawArrowMarker(canvas: Canvas, x: Float, y: Float, heading: Double) {
        val metrics = AutoHudMetrics.fromVisibleArea(stableArea ?: visibleArea, canvas.width, canvas.height)
        val scale = metrics.uiScale.coerceIn(0.9f, 1.3f) * 1.18f
        val markerPx = (56f * scale).toInt().coerceAtLeast(48)
        val bitmap = ensureArrowMarkerBitmap(markerPx)
        val half = bitmap.width / 2f
        val save = canvas.save()
        canvas.rotate(heading.toFloat(), x, y)
        canvas.drawBitmap(bitmap, x - half, y - half, Paint(Paint.ANTI_ALIAS_FLAG))
        canvas.restoreToCount(save)
    }

    private fun project(lat: Double, lng: Double): Pair<Float, Float>? {
        val map = mapView?.getMapboxMap() ?: return null
        val screen = map.pixelForCoordinate(Point.fromLngLat(lng, lat))
        return Pair(screen.x.toFloat(), screen.y.toFloat())
    }

    private fun inside(point: Pair<Float, Float>, canvas: Canvas): Boolean =
        point.first >= -90f && point.second >= -90f && point.first <= canvas.width.toFloat() + 90f && point.second <= canvas.height.toFloat() + 90f

    private fun advanceGeodesic(
        lat: Double,
        lng: Double,
        heading: Double,
        meters: Double
    ): Pair<Double, Double> {
        if (meters <= 0.0 || !heading.isFinite()) return Pair(lat, lng)
        val bearingRad = Math.toRadians(heading)
        val angularDistance = meters / EARTH_RADIUS_M
        val latRad = Math.toRadians(lat)
        val lngRad = Math.toRadians(lng)
        val nextLatRad = kotlin.math.asin(
            kotlin.math.sin(latRad) * kotlin.math.cos(angularDistance) +
                kotlin.math.cos(latRad) * kotlin.math.sin(angularDistance) *
                kotlin.math.cos(bearingRad)
        )
        val nextLngRad = lngRad + kotlin.math.atan2(
            kotlin.math.sin(bearingRad) * kotlin.math.sin(angularDistance) *
                kotlin.math.cos(latRad),
            kotlin.math.cos(angularDistance) -
                kotlin.math.sin(latRad) * kotlin.math.sin(nextLatRad)
        )
        return Pair(
            Math.toDegrees(nextLatRad),
            ((Math.toDegrees(nextLngRad) + 540.0) % 360.0) - 180.0
        )
    }

    private fun maybeRequestReroute(
        snap: VroomPayload?,
        lat: Double,
        lng: Double,
        roadPoints: List<AutoRoutePoint>?
    ) {
        if (VroomCarManager.isSimulationMode()) return
        if (snap == null || !snap.isNavigating || roadPoints == null || roadPoints.size < 2) return
        val now = System.currentTimeMillis()
        if (now - lastRerouteCheckAt < 1_500L) return
        lastRerouteCheckAt = now
        val measuredLat = lat.takeIf { it.isFinite() } ?: snap.userLat ?: return
        val measuredLng = lng.takeIf { it.isFinite() } ?: snap.userLng ?: return
        val projection = projectOnRoad(measuredLat, measuredLng, roadPoints, 1_000.0)
        if (projection == null || projection.distanceM > 60.0) {
            VroomCarManager.requestNativeReroute(measuredLat, measuredLng, displayedHeading)
        }
    }

    private fun liveFollowPoints(snap: VroomPayload): List<AutoRoutePoint>? {
        val nativeFresh = snap.mapState.nativeRoadMatch &&
            snap.mapState.nativeRoadMatchedAt > 0L &&
            System.currentTimeMillis() - snap.mapState.nativeRoadMatchedAt <= ROAD_MATCH_FRESH_MS
        if (!nativeFresh) return null
        val arcPoints = snap.mapState.autoArcWindow?.points
        if (arcPoints != null && arcPoints.size >= 2) return arcPoints
        return snap.routePoints.takeIf { !snap.isNavigating && it.size >= 2 }
    }

    private fun stepAlongActiveRoute(
        points: List<AutoRoutePoint>,
        speedKmh: Double,
    ): RoadStep? {
        if (points.size < 2) return null
        if (!routeCursorArcM.isFinite()) routeCursorArcM = routeTargetArcM.takeIf { it.isFinite() } ?: 0.0
        if (!routeTargetArcM.isFinite()) routeTargetArcM = routeCursorArcM
        // Płynna interpolacja liniowa (LERP) bez twardych skokowych progów:
        val speedMs = speedKmh.coerceIn(0.0, 180.0) / 3.6
        val nowMs = System.currentTimeMillis()
        val progress = segmentProgress(nowMs)
        val startArc = segmentStartArcM.takeIf { it.isFinite() } ?: routeCursorArcM
        val segmentLeadM = speedMs * segmentDurationMs.toDouble() / 1_000.0
        val segmentEndArc = kotlin.math.max(startArc, routeTargetArcM + segmentLeadM)
        val interpolatedArc = startArc + (segmentEndArc - startArc) * progress
        val predictionAgeMs = (nowMs - segmentStartedAtMs - segmentDurationMs).coerceIn(0L, 1_500L)
        val predictedArc = interpolatedArc + speedMs * predictionAgeMs.toDouble() / 1_000.0
        val maxExtrapolatedArc = routeTargetArcM + speedMs * 1.5 + 1.5
        val proposedArc = predictedArc.coerceAtMost(maxExtrapolatedArc)
        val nextArc = kotlin.math.max(routeCursorArcM, proposedArc)
        routeCursorArcM = nextArc
        val point = pointAtRoadArc(points, nextArc) ?: return null
        return RoadStep(
            lat = point.lat,
            lng = point.lng,
            heading = headingAtRoadArc(points, nextArc, speedKmh)
        )
    }

    private fun projectOnRoad(
        lat: Double,
        lng: Double,
        points: List<AutoRoutePoint>,
        maxDistanceM: Double,
        expectedHeading: Double? = null,
    ): RoadProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val latScale = cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
            val ax = a.lng * latScale
            val ay = a.lat
            val bx = b.lng * latScale
            val by = b.lat
            val px = lng * latScale
            val py = lat
            val vx = bx - ax
            val vy = by - ay
            val len2 = vx * vx + vy * vy
            val t = if (len2 > 0.0) (((px - ax) * vx + (py - ay) * vy) / len2).coerceIn(0.0, 1.0) else 0.0
            val projLat = a.lat + (b.lat - a.lat) * t
            val projLng = a.lng + (b.lng - a.lng) * t
            val distM = distanceMeters(lat, lng, projLat, projLng)
            val headingPenalty = expectedHeading?.let { heading ->
                val segmentHeading = bearingDegrees(a.lat, a.lng, b.lat, b.lng)
                AutoRoadPosePolicy.headingPenalty(kotlin.math.abs(headingDelta(heading, segmentHeading)))
            } ?: 0.0
            val score = distM + headingPenalty
            if (score < bestScore) {
                bestScore = score
                best = RoadProjection(
                    lat = projLat,
                    lng = projLng,
                    arcM = cumM + segM * t,
                    segmentIndex = i,
                    distanceM = distM
                )
            }
            cumM += segM
        }
        return best?.takeIf { it.distanceM <= maxDistanceM }
    }

    private fun projectOnRoadWindow(
        lat: Double,
        lng: Double,
        points: List<AutoRoutePoint>,
        anchorArcM: Double,
        backwardM: Double,
        forwardM: Double,
        maxDistanceM: Double,
        expectedHeading: Double? = null,
    ): RoadProjection? {
        if (points.size < 2) return null
        val minArc = (anchorArcM - backwardM).coerceAtLeast(0.0)
        val maxArc = anchorArcM + forwardM
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val segmentEnd = cumM + segM
            if (segmentEnd < minArc) {
                cumM = segmentEnd
                continue
            }
            if (cumM > maxArc) break
            val latScale = cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
            val ax = a.lng * latScale
            val ay = a.lat
            val bx = b.lng * latScale
            val by = b.lat
            val px = lng * latScale
            val py = lat
            val vx = bx - ax
            val vy = by - ay
            val len2 = vx * vx + vy * vy
            val t = if (len2 > 0.0) (((px - ax) * vx + (py - ay) * vy) / len2).coerceIn(0.0, 1.0) else 0.0
            val arcM = cumM + segM * t
            if (arcM in minArc..maxArc) {
                val projLat = a.lat + (b.lat - a.lat) * t
                val projLng = a.lng + (b.lng - a.lng) * t
                val distM = distanceMeters(lat, lng, projLat, projLng)
                val backwardPenalty = if (arcM < anchorArcM) (anchorArcM - arcM) * 0.35 else 0.0
                val headingPenalty = expectedHeading?.let { heading ->
                    val segmentHeading = bearingDegrees(a.lat, a.lng, b.lat, b.lng)
                    AutoRoadPosePolicy.headingPenalty(kotlin.math.abs(headingDelta(heading, segmentHeading)))
                } ?: 0.0
                val score = distM + backwardPenalty + headingPenalty
                if (score < bestScore) {
                    bestScore = score
                    best = RoadProjection(projLat, projLng, arcM, i, distM)
                }
            }
            cumM = segmentEnd
        }
        return best?.takeIf { it.distanceM <= maxDistanceM }
    }

    private fun headingAtRoadArc(points: List<AutoRoutePoint>, arcM: Double, speedKmh: Double): Double {
        val lookBehindM = if (speedKmh < 18.0) 1.5 else 3.0
        val lookAheadM = when {
            speedKmh < 18.0 -> 5.0
            speedKmh < 55.0 -> 8.0
            else -> 12.0
        }
        val from = pointAtRoadArc(points, (arcM - lookBehindM).coerceAtLeast(0.0))
        val to = pointAtRoadArc(points, arcM + lookAheadM)
        if (from == null || to == null || distanceMeters(from.lat, from.lng, to.lat, to.lng) < 0.5) {
            return targetHeading
        }
        return bearingDegrees(from.lat, from.lng, to.lat, to.lng)
    }

    private fun routeSignature(points: List<AutoRoutePoint>, roadVersion: Int = 0): Int {
        if (points.isEmpty()) return 0
        var signature = 31 * roadVersion + points.size
        val checkpoints = intArrayOf(0, points.size / 2, points.lastIndex)
        checkpoints.distinct().forEach { index ->
            val point = points[index]
            signature = 31 * signature + (point.lat * 100_000.0).toInt()
            signature = 31 * signature + (point.lng * 100_000.0).toInt()
        }
        return signature
    }

    private fun pointAtRoadArc(points: List<AutoRoutePoint>, arcM: Double): AutoRoutePoint? {
        if (points.size < 2) return null
        var remaining = arcM.coerceAtLeast(0.0)
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            if (remaining <= segM) {
                val t = (remaining / segM).coerceIn(0.0, 1.0)
                return AutoRoutePoint(
                    lat = a.lat + (b.lat - a.lat) * t,
                    lng = a.lng + (b.lng - a.lng) * t
                )
            }
            remaining -= segM
        }
        if (payload?.isNavigating != true && remaining > 0.0) {
            val beforeLast = points[points.lastIndex - 1]
            val last = points.last()
            return advanceGeodesic(
                last.lat,
                last.lng,
                bearingDegrees(beforeLast.lat, beforeLast.lng, last.lat, last.lng),
                remaining.coerceAtMost(90.0)
            ).let { AutoRoutePoint(it.first, it.second) }
        }
        return points.lastOrNull()
    }

    private fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = sin(dLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
    }



    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return EARTH_RADIUS_M * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }

    private fun ensureAvatarLoaded(url: String) {
        val clean = url.trim()
        if (clean.isBlank()) return
        if (clean == avatarUrlLoaded && avatarBitmap != null) return
        if (avatarLoading) return
        avatarLoading = true
        Thread {
            val bitmap = runCatching {
                val conn = java.net.URL(clean).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 2500
                conn.readTimeout = 2500
                conn.inputStream.use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
            if (bitmap != null) {
                avatarBitmap = bitmap
                avatarUrlLoaded = clean
                postInvalidate()
            }
            avatarLoading = false
        }.start()
    }
}

private fun payloadSpeedKmh(payload: VroomPayload): Double {
    val raw = payload.speed?.let { it * 3.6 }?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    val map = payload.mapState.speedKmh.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    return when {
        map >= 2.0 -> map
        raw >= 2.0 -> raw
        else -> 0.0
    }
}
