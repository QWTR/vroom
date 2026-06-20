package __PACKAGE__.auto

import __PACKAGE__.R

import android.app.Presentation
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.SurfaceContainer
import androidx.car.app.SurfaceCallback
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.ImageHolder
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
import java.net.URLEncoder
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.math.cos
import kotlin.math.sin

private const val MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"
private const val MAPBOX_NAV_STYLE = "mapbox://styles/mapbox/navigation-night-v1"
private const val DEFAULT_LAT = 52.2297
private const val DEFAULT_LNG = 21.0122
private const val EARTH_RADIUS_M = 6_371_000.0
private const val AUTO_MAPBOX_BASE = "https://api.mapbox.com"
private const val AUTO_OSRM_BASE = "https://v-room.app/osrm"
private const val POLAND_BBOX = "14.07,49.00,24.15,54.84"

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
    private var virtualDisplay: VirtualDisplay? = null
    private var presentation: Presentation? = null
    private var lifecycleOwner: SurfaceLifecycleOwner? = null
    private var mapView: MapView? = null
    private var overlay: VroomAutoOverlayView? = null
    private var visibleArea: Rect? = null
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
        val normalizedTop = kotlin.math.min(
            visibleArea.top,
            (visibleArea.bottom * 0.13f).toInt()
        )
        val normalizedArea = Rect(visibleArea.left, normalizedTop, visibleArea.right, visibleArea.bottom)
        val current = lockedUiArea
        val next = if (current == null) {
            normalizedArea
        } else {
            Rect(
                kotlin.math.min(current.left, normalizedArea.left),
                kotlin.math.min(current.top, normalizedArea.top),
                kotlin.math.max(current.right, normalizedArea.right),
                kotlin.math.max(current.bottom, normalizedArea.bottom)
            )
        }
        lockedUiArea = next
        this.visibleArea = next
        overlay?.visibleArea = next
        overlay?.invalidate()
    }

    override fun onStableAreaChanged(stableArea: Rect) {
        // Host zmienia obszar po pokazaniu akcji „Centruj”.
        // Kotwiczymy HUD do największego znanego obszaru, aby układ nie przeskakiwał.
        overlay?.visibleArea = lockedUiArea ?: this.visibleArea
        overlay?.invalidate()
    }

    fun updateMapWithPayload(payload: VroomPayload) {
        latestPayload = payload
        mainHandler.post { updateMap() }
    }

    fun updateNativeLocation(lat: Double, lng: Double, speedMs: Double, heading: Double) {
        mainHandler.post {
            snappedLocationProvider.update(lat, lng, heading)
        }
    }

    override fun onClick(x: Float, y: Float) {
        mainHandler.post {
            val action = overlay?.hitAction(x, y)
            if (overlay?.handleCustomAction(action) == true) return@post
            when (action) {
                "search" -> overlay?.openSearch()
                "report" -> overlay?.openReportMenu()
                "start_preview" -> VroomCarManager.startNativeRoutePreview()
                "cancel_preview" -> VroomCarManager.clearNativeRoutePreview()
                "stop_navigation" -> VroomCarManager.stopClick()
                "recenter" -> recenterFromHost()
                else -> Unit
            }
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
        nextMapView.getMapboxMap().loadStyleUri(MAPBOX_NAV_STYLE)
        nextMapView.onStart()
        nextMapView.location.setLocationProvider(snappedLocationProvider)
        nextMapView.location.updateSettings {
            enabled = true
            locationPuck = LocationPuck2D(
                topImage = null,
                bearingImage = ImageHolder.from(R.drawable.vroom_location_arrow),
                shadowImage = null
            )
            puckBearingEnabled = true
            puckBearing = PuckBearing.COURSE
            pulsingEnabled = false
        }
        mapMarkerAnnotationManager = nextMapView.annotations.createPointAnnotationManager().apply {
            iconRotationAlignment = IconRotationAlignment.VIEWPORT
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
                map.setCamera(
                    CameraOptions.Builder()
                        .center(Point.fromLngLat(preview.first.lng, preview.first.lat))
                        .zoom(preview.second)
                        .pitch(38.0)
                        .bearing(0.0)
                        .padding(EdgeInsets(30.0, 24.0, 30.0, 24.0))
                        .build()
                )
            }
        } else if (forceFollow || !userBrowsing) {
            activateFollowPuck()
        }

        overlay?.followMode = !userBrowsing || forceFollow
        overlay?.mapView = mapView
        overlay?.visibleArea = lockedUiArea ?: visibleArea
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

    private fun activateFollowPuck() {
        val viewport = mapView?.viewport ?: return
        val navigating = latestPayload?.isNavigating == true
        val mode = if (navigating) "navigation" else "free-drive"
        if (followViewportActive && followViewportMode == mode) return
        val options = FollowPuckViewportStateOptions.Builder()
            .bearing(FollowPuckViewportStateBearing.SyncWithLocationPuck)
            .zoom(if (navigating) 16.55 else 16.85)
            .pitch(if (navigating) 56.0 else 50.0)
            .padding(EdgeInsets(if (navigating) 218.0 else 190.0, 28.0, 44.0, 28.0))
            .build()
        followViewportMode = mode
        followViewportActive = true
        viewport.transitionTo(viewport.makeFollowPuckViewportState(options))
    }

    private fun syncMapAnnotations(payload: VroomPayload?, force: Boolean = false) {
        val manager = mapMarkerAnnotationManager ?: return
        if (payload == null) {
            if (mapMarkerSignature.isNotEmpty()) manager.deleteAll()
            mapMarkerSignature = ""
            return
        }
        val users = payload.users.take(40)
        val fuelStations = payload.fuelStations.take(40)
        val speedCameras = payload.speedCameras.take(40)
        val partnerPois = payload.partnerPois.take(40)
        val warnings = payload.warnings.take(42)
        val signature = buildString {
            users.forEach { append("u:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.avatarUrl).append(':').append(it.avatarFrameUrl).append(':').append(it.distanceLabel).append(':').append(it.isPremium).append(':').append(it.isFriend).append('|') }
            fuelStations.forEach { append("f:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.value).append(':').append(it.logoUrl).append('|') }
            speedCameras.forEach { append("c:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.value).append('|') }
            partnerPois.forEach { append("p:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.label).append(':').append(it.logoUrl).append(':').append(it.accentColor).append('|') }
            warnings.forEach { append("w:").append(it.id).append(':').append(it.lat).append(':').append(it.lng).append(':').append(it.type).append(':').append(it.count).append('|') }
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
        if (!visible) {
            if (routeAnnotationSignature.isNotEmpty()) manager.deleteAll()
            routeAnnotationSignature = ""
            return
        }
        val points = payload!!.routePoints
        val signature = buildString {
            append(payload.isNavigating).append(':').append(payload.mapState.routePreview).append(':')
            points.forEach { append(it.lat).append(',').append(it.lng).append(';') }
        }
        if (signature == routeAnnotationSignature) return
        routeAnnotationSignature = signature
        manager.deleteAll()
        manager.create(
            PolylineAnnotationOptions()
                .withPoints(points.map { Point.fromLngLat(it.lng, it.lat) })
                .withLineColor(if (payload.isNavigating) Color.rgb(36, 202, 255) else Color.rgb(114, 225, 255))
                .withLineWidth(9.0)
                .withLineBorderColor(if (payload.isNavigating) Color.rgb(13, 25, 38) else Color.rgb(18, 24, 34))
                .withLineBorderWidth(3.5)
        )
    }

    private fun createMapAnnotation(manager: PointAnnotationManager, lat: Double, lng: Double, bitmap: Bitmap) {
        if (!lat.isFinite() || !lng.isFinite()) return
        manager.create(PointAnnotationOptions().withPoint(Point.fromLngLat(lng, lat)).withIconImage(bitmap).withIconSize(1.0))
    }

    private enum class PoiMarkerKind { FUEL, CAMERA, PARTNER }

    private fun userMarkerBitmap(marker: UserMarker): Bitmap {
        val accent = when {
            marker.isPremium -> Color.rgb(255, 215, 0)
            marker.isFriend || marker.type == "friend" -> Color.rgb(77, 233, 38)
            else -> Color.rgb(0, 191, 255)
        }
        val avatar = remoteMarkerBitmap(marker.avatarUrl)
        val frame = remoteMarkerBitmap(marker.avatarFrameUrl)
        val key = "user:${marker.id}:${marker.label}:${marker.distanceLabel}:$accent:${avatar != null}:${frame != null}"
        return markerBitmapCache.getOrPut(key) {
            val bitmap = Bitmap.createBitmap(124, 120, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
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
        val accent = when (kind) {
            PoiMarkerKind.FUEL -> Color.rgb(43, 140, 255)
            PoiMarkerKind.CAMERA -> Color.rgb(255, 212, 59)
            PoiMarkerKind.PARTNER -> parseMarkerColor(marker.accentColor, Color.rgb(255, 215, 0))
        }
        val logo = remoteMarkerBitmap(marker.logoUrl)
        val key = "poi:$kind:${marker.id}:${marker.label}:${marker.value}:$accent:${logo != null}"
        return markerBitmapCache.getOrPut(key) {
            val bitmap = Bitmap.createBitmap(96, 92, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(18, 24, 32) }
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; style = Paint.Style.STROKE; strokeWidth = 2f }
            val body = RectF(7f, 2f, 89f, 78f)
            canvas.drawRoundRect(body, 14f, 14f, fill); canvas.drawRoundRect(body, 14f, 14f, stroke)
            canvas.drawCircle(48f, 25f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
            if (logo != null) {
                canvas.drawBitmap(logo, null, RectF(37f, 14f, 59f, 36f), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            } else {
                val iconText = when (kind) { PoiMarkerKind.FUEL -> "⛽"; PoiMarkerKind.CAMERA -> marker.value.ifBlank { "!" }.take(3); PoiMarkerKind.PARTNER -> "VR" }
                val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = if (kind == PoiMarkerKind.CAMERA) 13f else 11f }
                canvas.drawText(iconText, 48f, 30f, iconPaint)
            }
            val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (kind == PoiMarkerKind.PARTNER) accent else Color.rgb(216, 233, 255); textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = 9f }
            canvas.drawText((if (kind == PoiMarkerKind.PARTNER) "PARTNER" else marker.label.uppercase()).take(13), 48f, 51f, text)
            text.color = if (kind == PoiMarkerKind.FUEL) Color.rgb(125, 211, 252) else Color.WHITE
            val bottomLabel = when (kind) { PoiMarkerKind.FUEL -> marker.value.takeIf { it.isNotBlank() }?.let { "PB95 $it" } ?: "BRAK CENY"; PoiMarkerKind.CAMERA -> marker.label.take(12); PoiMarkerKind.PARTNER -> marker.label.take(13) }
            canvas.drawText(bottomLabel, 48f, 66f, text)
            val tip = Path().apply { moveTo(41f, 78f); lineTo(55f, 78f); lineTo(48f, 90f); close() }
            stroke.style = Paint.Style.FILL; canvas.drawPath(tip, stroke)
            bitmap
        }
    }

    private fun warningMarkerBitmap(marker: WarningMarker): Bitmap {
        val accent = when (marker.type) { "traffic" -> Color.rgb(255, 107, 107); "weather" -> Color.rgb(255, 212, 59); "accident" -> Color.rgb(255, 146, 43); "speed_control" -> Color.rgb(5, 53, 247); else -> Color.rgb(232, 154, 54) }
        val key = "warning:${marker.type}:${marker.count}:$accent"
        return markerBitmapCache.getOrPut(key) {
            val bitmap = Bitmap.createBitmap(56, 58, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent }
            canvas.drawPath(Path().apply { moveTo(28f, 3f); lineTo(3f, 48f); lineTo(53f, 48f); close() }, fill)
            canvas.drawText("!", 28f, 41f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true; textSize = 27f })
            bitmap
        }
    }

    private fun destinationMarkerBitmap(): Bitmap = markerBitmapCache.getOrPut("destination") {
        val bitmap = Bitmap.createBitmap(52, 58, Bitmap.Config.ARGB_8888); val canvas = Canvas(bitmap)
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
                val connection = URL(clean).openConnection() as HttpURLConnection
                connection.connectTimeout = 2_500; connection.readTimeout = 2_500
                connection.inputStream.use { BitmapFactory.decodeStream(it) }
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

    private fun dynamicDriveZoom(speedKmh: Double, navigating: Boolean): Double {
        val speed = speedKmh.coerceIn(0.0, 140.0)
        val base = when {
            speed < 8.0 -> 17.85
            speed < 25.0 -> 17.65 - ((speed - 8.0) / 17.0) * 0.28
            speed < 55.0 -> 17.37 - ((speed - 25.0) / 30.0) * 0.42
            speed < 95.0 -> 16.95 - ((speed - 55.0) / 40.0) * 0.55
            else -> 16.40 - ((speed - 95.0) / 45.0) * 0.22
        }
        return (base + if (navigating) 0.08 else 0.0).coerceIn(16.05, 17.9)
    }

    private fun stableDynamicZoom(speedKmh: Double, navigating: Boolean): Double {
        val now = System.currentTimeMillis()
        val dt = if (lastZoomUpdateAt > 0L) (now - lastZoomUpdateAt).coerceIn(1L, 900L).toDouble() else 180.0
        lastZoomUpdateAt = now
        val speedAlpha = (1.0 - Math.exp(-dt / 1800.0)).coerceIn(0.02, 0.16)
        stableCameraSpeedKmh += (speedKmh.coerceIn(0.0, 160.0) - stableCameraSpeedKmh) * speedAlpha
        val desired = dynamicDriveZoom(stableCameraSpeedKmh, navigating)
        if (!stableCameraZoom.isFinite()) stableCameraZoom = desired
        val delta = desired - stableCameraZoom
        if (kotlin.math.abs(delta) < 0.045) return stableCameraZoom
        val maxStep = 0.22 * (dt / 1000.0)
        stableCameraZoom = (stableCameraZoom + delta.coerceIn(-maxStep, maxStep)).coerceIn(16.05, 17.9)
        return stableCameraZoom
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
    var followMode: Boolean = true
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
    private var lastTargetAt = 0L
    private var lastRerouteCheckAt = 0L
    private var routeCursorSignature = 0
    private var routeCursorArcM = Double.NaN
    private var routeTargetArcM = Double.NaN

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

    private val routeShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(13, 25, 38)
        style = Paint.Style.STROKE
        strokeWidth = 16f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val routePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(36, 202, 255)
        style = Paint.Style.STROKE
        strokeWidth = 9f
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

    fun applyPayload(next: VroomPayload?) {
        payload = next
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
            targetSpeedKmh = payloadSpeedKmh(next).coerceIn(0.0, 180.0)
            val now = System.currentTimeMillis()
            val dtSec = if (lastTargetAt > 0L) {
                ((now - lastTargetAt).coerceIn(40L, 1_200L)).toDouble() / 1000.0
            } else {
                0.25
            }
            lastTargetAt = now

            val nativeRoadFresh = (next.mapState.nativeRoadMatch || next.mapState.nativeRoadPose) &&
                next.mapState.nativeRoadMatchedAt > 0L &&
                now - next.mapState.nativeRoadMatchedAt <= 18_000L
            val roadPoints = routeFollowPoints(next)
            val routeLocked = roadPoints != null && (next.isNavigating || nativeRoadFresh)

            if (routeLocked && next.userLat != null && next.userLng != null) {
                updateRouteTarget(
                    roadPoints!!,
                    next.userLat,
                    next.userLng,
                    targetSpeedKmh,
                    dtSec,
                    next.mapState.autoTargetArcM.takeIf { nativeRoadFresh && !next.isNavigating }
                )
                if (displayedLat == null || displayedLng == null) {
                    displayedLat = targetLat
                    displayedLng = targetLng
                    displayedHeading = targetHeading
                    displayedSpeedKmh = targetSpeedKmh
                }
            } else if ((nativeRoadFresh && next.mapState.nativeRoadPose || next.mapState.nativeAutoPose) &&
                next.userLat != null && next.userLng != null) {
                resetRouteCursor()
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
                // Bez świeżej pozycji OSRM zachowujemy ostatnią pozycję drogową.
                resetRouteCursor()
            }
        }
        displayedLat = targetLat ?: displayedLat
        displayedLng = targetLng ?: displayedLng
        displayedHeading = targetHeading
        displayedSpeedKmh = targetSpeedKmh
        postInvalidateOnAnimation()
    }

    fun handleLivePoseUpdate(lat: Double, lng: Double, speed: Double, heading: Double) {
        if (!lat.isFinite() || !lng.isFinite() ||
            lat !in -90.0..90.0 || lng !in -180.0..180.0 ||
            kotlin.math.abs(lat) < 1e-6 && kotlin.math.abs(lng) < 1e-6
        ) return
        val snap = payload
        targetSpeedKmh = (speed.takeIf { it.isFinite() } ?: 0.0).coerceIn(0.0, 70.0) * 3.6
        val now = System.currentTimeMillis()
        val dtSec = if (lastTargetAt > 0L) {
            ((now - lastTargetAt).coerceIn(40L, 1_200L)).toDouble() / 1000.0
        } else {
            0.25
        }
        lastTargetAt = now

        val nativeRoadFresh = snap?.mapState?.let {
            (it.nativeRoadMatch || it.nativeRoadPose) &&
            it.nativeRoadMatchedAt > 0L &&
            now - it.nativeRoadMatchedAt <= 18_000L
        } == true
        val roadPoints = snap?.let { routeFollowPoints(it) }
        val routeLocked = roadPoints != null && (snap.isNavigating || nativeRoadFresh)

        if (routeLocked) {
            updateRouteTarget(
                roadPoints!!,
                lat,
                lng,
                targetSpeedKmh,
                dtSec,
                snap?.mapState?.autoTargetArcM?.takeIf { nativeRoadFresh && !snap.isNavigating }
            )
            if (displayedLat == null || displayedLng == null) {
                displayedLat = targetLat
                displayedLng = targetLng
                displayedHeading = targetHeading
                displayedSpeedKmh = targetSpeedKmh
            }
        } else {
            resetRouteCursor()
            targetLat = lat
            targetLng = lng
            targetHeading = heading.takeIf { it.isFinite() }?.let { (it % 360.0 + 360.0) % 360.0 } ?: targetHeading
            if (displayedLat == null || displayedLng == null) {
                displayedLat = targetLat
                displayedLng = targetLng
                displayedHeading = targetHeading
                displayedSpeedKmh = targetSpeedKmh
            }
        }
        postInvalidateOnAnimation()
    }

    fun renderedPose(): Triple<Double, Double, Double>? {
        val lat = displayedLat ?: return null
        val lng = displayedLng ?: return null
        return Triple(lat, lng, displayedHeading)
    }

    private fun updateRouteTarget(
        points: List<AutoRoutePoint>,
        measuredLat: Double,
        measuredLng: Double,
        speedKmh: Double,
        dtSec: Double,
        preferredTargetArcM: Double?
    ) {
        val signature = routeSignature(points)
        if (signature != routeCursorSignature) {
            routeCursorSignature = signature
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
                    maxDistanceM = 140.0
                )
            } else if (displayedLat != null && displayedLng != null) {
                projectOnRoad(displayedLat!!, displayedLng!!, points, 140.0)
            } else {
                null
            }
            val measuredProjection = projectOnRoad(measuredLat, measuredLng, points, 180.0)
            val initial = continuityProjection ?: measuredProjection
            routeCursorArcM = initial?.arcM ?: 0.0
            val measuredAhead = preferredArc
                ?: measuredProjection?.arcM?.takeIf { it >= routeCursorArcM - 8.0 }
            routeTargetArcM = kotlin.math.max(routeCursorArcM, measuredAhead ?: routeCursorArcM)
            val initialPoint = pointAtRoadArc(points, routeCursorArcM)
            if (initialPoint != null) {
                displayedLat = initialPoint.lat
                displayedLng = initialPoint.lng
                targetLat = initialPoint.lat
                targetLng = initialPoint.lng
            }
            val targetPoint = pointAtRoadArc(points, routeTargetArcM)
            if (targetPoint != null) {
                targetLat = targetPoint.lat
                targetLng = targetPoint.lng
            }
            targetHeading = headingAtRoadArc(points, routeCursorArcM, speedKmh)
            displayedHeading = targetHeading
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
            maxDistanceM = 85.0
        )
        val projection = preferredTargetArcM
            ?.takeIf { it.isFinite() && it >= anchor - 8.0 }
            ?.let { arc ->
                pointAtRoadArc(points, arc)?.let { point ->
                    RoadProjection(point.lat, point.lng, arc, 0, 0.0)
                }
            }
            ?: localProjection
            ?: projectOnRoad(measuredLat, measuredLng, points, 65.0)
        if (projection != null) {
            val maxPlausibleAdvance = ((speedKmh.coerceAtLeast(8.0) / 3.6) * dtSec * 2.4 + 18.0)
                .coerceIn(18.0, 75.0)
            val candidate = projection.arcM.coerceAtMost(anchor + maxPlausibleAdvance)
            routeTargetArcM = kotlin.math.max(anchor, candidate)
        }
        val snapped = pointAtRoadArc(points, routeTargetArcM)
        if (snapped != null) {
            targetLat = snapped.lat
            targetLng = snapped.lng
            targetHeading = headingAtRoadArc(points, routeTargetArcM, speedKmh)
        }
    }

    private fun resetRouteCursor() {
        routeCursorSignature = 0
        routeCursorArcM = Double.NaN
        routeTargetArcM = Double.NaN
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
        val proximity = origin?.let { "&proximity=${it.lng},${it.lat}" }.orEmpty()
        val url = "$AUTO_MAPBOX_BASE/geocoding/v5/mapbox.places/${URLEncoder.encode(raw, "UTF-8")}.json" +
            "?access_token=$MAPBOX_ACCESS_TOKEN&language=pl&country=pl&types=poi,address,place&limit=8" +
            "&autocomplete=true&fuzzyMatch=true&routing=true&bbox=$POLAND_BBOX$proximity"
        val root = JSONObject(requestJson(url, 4_500, 4_500))
        val features = root.optJSONArray("features") ?: return emptyList()
        val out = mutableListOf<SearchResultItem>()
        for (i in 0 until features.length()) {
            val feature = features.optJSONObject(i) ?: continue
            val coords = feature.optJSONObject("geometry")?.optJSONArray("coordinates")
                ?: feature.optJSONArray("center")
                ?: continue
            val lng = coords.optDouble(0, Double.NaN)
            val lat = coords.optDouble(1, Double.NaN)
            if (!lat.isFinite() || !lng.isFinite()) continue
            val props = feature.optJSONObject("properties")
            val name = props?.optString("name")?.takeIf { it.isNotBlank() }
                ?: feature.optString("text", "Cel")
            val address = props?.optString("full_address")?.takeIf { it.isNotBlank() }
                ?: feature.optString("place_name", "")
            val routable = props
                ?.optJSONObject("coordinates")
                ?.optJSONArray("routable_points")
                ?.optJSONObject(0)
            val routableLng = finiteOrNull(routable?.optDouble("longitude", Double.NaN))
            val routableLat = finiteOrNull(routable?.optDouble("latitude", Double.NaN))
            val eta = origin?.let {
                val km = distanceMeters(it.lat, it.lng, lat, lng) / 1000.0
                if (km >= 1.0) String.format(java.util.Locale.US, "%.1f km", km) else "${(km * 1000).toInt()} m"
            }.orEmpty()
            out.add(SearchResultItem("result-$i", name, address, lat, lng, routableLat, routableLng, eta))
        }
        return out
    }

    private fun buildRoutePreviewPayload(item: SearchResultItem, origin: RouteOrigin): String {
        val origins = mutableListOf<RouteOrigin>()
        fun addOrigin(candidate: RouteOrigin?) {
            if (candidate == null) return
            if (!candidate.lat.isFinite() || !candidate.lng.isFinite()) return
            if (origins.none { distanceMeters(it.lat, it.lng, candidate.lat, candidate.lng) < 3.0 }) {
                origins.add(candidate)
            }
        }
        addOrigin(origin)
        AutoLocationTracker.lastKnownPose()?.let { addOrigin(RouteOrigin(it.lat, it.lng, it.speedMs, it.heading)) }
        payload?.let { snap ->
            if (snap.userLat != null && snap.userLng != null) {
                addOrigin(RouteOrigin(snap.userLat, snap.userLng, snap.speed ?: 0.0, snap.heading ?: origin.heading))
            }
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

        fun validateRoute(candidate: JSONObject): JSONObject {
            val code = candidate.optString("code", "Ok")
            if (code.isNotBlank() && code != "Ok") throw IllegalStateException("Wyznaczanie trasy nie powiodło się: $code")
            val route = candidate.optJSONArray("routes")?.optJSONObject(0)
                ?: throw IllegalStateException("Brak trasy")
            val coords = route.optJSONObject("geometry")?.optJSONArray("coordinates")
                ?: throw IllegalStateException("Brak geometrii")
            if (coords.length() < 2) throw IllegalStateException("Zbyt krótka geometria")
            return candidate
        }

        fun tryMapboxRoute(from: RouteOrigin, to: Pair<Double, Double>): Boolean {
            return runCatching {
                val heading = normalizeHeadingForApi(from.heading)
                val bearingParam = heading?.let { "&bearings=$it,45;" }.orEmpty()
                val url = "$AUTO_MAPBOX_BASE/directions/v5/mapbox/driving/${formatCoord(from.lng)},${formatCoord(from.lat)};${formatCoord(to.second)},${formatCoord(to.first)}" +
                    "?alternatives=false&geometries=geojson&overview=full&steps=true&language=pl&continue_straight=true" +
                    bearingParam +
                    "&access_token=$MAPBOX_ACCESS_TOKEN"
                root = validateRoute(JSONObject(requestJson(url, 8_000, 8_000)))
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
                    "?alternatives=false&geometries=geojson&steps=true&overview=full"
                root = validateRoute(JSONObject(requestJson(url, 4_500, 4_500)))
                usedOrigin = from
                true
            }.getOrElse {
                lastFailure = it
                Log.w("VroomAutoOverlay", "Trasa OSRM nie powiodła się ${from.lat},${from.lng} -> ${to.first},${to.second}", it)
                false
            }
        }

        origins.any { from -> destinations.any { to -> tryMapboxRoute(from, to) } }
        if (root == null) {
            origins.any { from -> destinations.any { to -> tryOsrmRoute(from, to) } }
        }
        if (root == null) {
            val snappedOrigins = origins.mapNotNull { from ->
                nearestRoadPoint(from.lat, from.lng)?.let { RouteOrigin(it.first, it.second, from.speedMs, from.heading) }
            }
            val snappedDestinations = destinations.mapNotNull { to -> nearestRoadPoint(to.first, to.second) }
            snappedOrigins.any { from -> (snappedDestinations.ifEmpty { destinations }).any { to -> tryMapboxRoute(from, to) } }
            if (root == null) {
                snappedOrigins.any { from -> (snappedDestinations.ifEmpty { destinations }).any { to -> tryOsrmRoute(from, to) } }
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
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
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
            put("route", JSONArray(points.toString()))
            put("users", usersJson(payload?.users.orEmpty()))
            put("warnings", warningsJson(payload?.warnings.orEmpty()))
            put("mapState", JSONObject().apply {
                put("uiMode", "ROUTE_PREVIEW")
                put("routePreview", true)
                put("isDriving", true)
                put("route", JSONArray(points.toString()))
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
        val renderedLat = displayedLat
        val renderedLng = displayedLng
        if (renderedLat != null && renderedLng != null) {
            return RouteOrigin(renderedLat, renderedLng, targetSpeedKmh / 3.6, displayedHeading)
        }
        val snap = payload
        if (snap?.userLat != null && snap.userLng != null) {
            return RouteOrigin(snap.userLat, snap.userLng, snap.speed ?: 0.0, snap.heading ?: 0.0)
        }
        return AutoLocationTracker.lastKnownPose()?.let {
            RouteOrigin(it.lat, it.lng, it.speedMs, it.heading)
        }
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

    private fun polishInstruction(step: JSONObject?, maneuver: JSONObject?): String {
        val type = maneuver?.optString("type", "").orEmpty()
        val modifier = maneuver?.optString("modifier", "").orEmpty()
        val roadName = step?.optString("name", "").orEmpty().trim()
        val base = when (type) {
            "depart" -> "Rusz"
            "arrive" -> "Dojezdzasz do celu"
            "roundabout", "rotary" -> "Rondo"
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
        routeShadow.color = if (snap.isNavigating) Color.rgb(13, 25, 38) else Color.argb(190, 18, 24, 34)
        routePaint.color = if (snap.isNavigating) Color.rgb(36, 202, 255) else Color.argb(230, 114, 225, 255)
        canvas.drawPath(path, routeShadow)
        canvas.drawPath(path, routePaint)
    }

    private fun visibleRoutePointsFromVehicle(
        snap: VroomPayload,
        points: List<AutoRoutePoint>
    ): List<AutoRoutePoint> {
        val vehicleLat = displayedLat ?: snap.userLat ?: return points
        val vehicleLng = displayedLng ?: snap.userLng ?: return points
        val projection = projectOnRoad(vehicleLat, vehicleLng, points, 140.0) ?: return points
        val startIndex = projection.segmentIndex.coerceIn(0, points.size - 2)
        val trimmed = ArrayList<AutoRoutePoint>(points.size - startIndex + 1)
        trimmed.add(AutoRoutePoint(projection.lat, projection.lng))
        for (i in (startIndex + 1) until points.size) {
            trimmed.add(points[i])
        }
        return if (trimmed.size >= 2) trimmed else points
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
        val safe = visibleArea ?: Rect(0, 0, canvas.width, canvas.height)
        val top = safe.top + 14f
        val bottom = safe.bottom - 14f

        when (uiMode) {
            AutoUiMode.SEARCH_RESULTS -> {
                drawSearchOverlay(canvas, top, bottom)
                drawToast(canvas)
                return
            }
            AutoUiMode.REPORT_MENU -> {
                drawReportOverlay(canvas, top, bottom)
                drawToast(canvas)
                return
            }
            AutoUiMode.LOADING -> {
                drawLoadingOverlay(canvas, "Wyznaczam trase...")
                drawToast(canvas)
                return
            }
            else -> {
                if (snap?.mapState?.routePreview == true && snap.isNavigating.not()) {
                    drawRoutePreviewPanel(canvas, snap, top, bottom)
                } else if (snap?.isNavigating == true) {
                    drawNavigationTopBar(canvas, snap, top)
                } else {
                    val searchLeft = 24f
                    val searchTop = (top - 18f).coerceAtLeast(8f)
                    val searchRight = (searchLeft + 468f)
                        .coerceAtMost(canvas.width.toFloat() - 210f)
                        .coerceAtLeast(searchLeft + 360f)
                    val search = RectF(searchLeft, searchTop, searchRight, searchTop + 54f)
                    hitRects["search"] = search
                    panelPaint.color = Color.argb(232, 10, 10, 12)
                    strokePaint.color = Color.argb(190, 227, 56, 53)
                    canvas.drawRoundRect(search, 29f, 29f, panelPaint)
                    canvas.drawRoundRect(search, 29f, 29f, strokePaint)
                    smallText.textAlign = Paint.Align.LEFT
                    smallText.textSize = 22f
                    smallText.color = Color.argb(210, 255, 255, 255)
                    canvas.drawText("Wyszukaj adres lub miejsce...", search.left + 62f, search.centerY() + 8f, smallText)
                    drawSearchIcon(canvas, search.left + 32f, search.centerY())
                }
            }
        }

        val speedRect = RectF(24f, bottom - 136f, 128f, bottom - 4f)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(speedRect, 18f, 18f, panelPaint)
        textPaint.textSize = 46f
        textPaint.color = Color.WHITE
        canvas.drawText(Math.round(displayedSpeedKmh.coerceAtLeast(0.0)).toString(), speedRect.centerX(), speedRect.top + 88f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 16f
        smallText.color = Color.rgb(160, 160, 166)
        canvas.drawText("km/h", speedRect.centerX(), speedRect.top + 116f, smallText)
        snap?.mapState?.speedLimitKmh?.let {
            val limit = RectF(speedRect.left + 24f, speedRect.top + 9f, speedRect.right - 24f, speedRect.top + 45f)
            val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            canvas.drawOval(limit, white)
            textPaint.textSize = 17f
            textPaint.color = Color.rgb(20, 20, 20)
            canvas.drawText(it.toInt().toString(), limit.centerX(), limit.centerY() + 6f, textPaint)
        }

        drawLiveBadge(canvas, canvas.width.toFloat() - 132f, bottom - 208f)
        val recenterRect = RectF(canvas.width.toFloat() - 138f, bottom - 150f, canvas.width.toFloat() - 26f, bottom - 96f)
        hitRects["recenter"] = recenterRect
        drawRoundIconButton(canvas, recenterRect, "◎", Color.rgb(230, 230, 236))
        val reportRect = RectF(canvas.width.toFloat() - 138f, bottom - 84f, canvas.width.toFloat() - 26f, bottom)
        hitRects["report"] = reportRect
        drawReportButton(canvas, reportRect.left, reportRect.top)

        drawToast(canvas)
    }

    private fun drawSearchOverlay(canvas: Canvas, top: Float, bottom: Float) {
        val width = canvas.width.toFloat()
        val maxBottom = bottom - 18f
        val wantsResults = searchLoading || searchResults.isNotEmpty()
        val desiredHeight = if (wantsResults) 296f else 312f
        val panel = RectF(
            18f,
            top + 4f,
            width - 18f,
            (top + 4f + desiredHeight).coerceAtMost(maxBottom)
        )
        panelPaint.color = Color.argb(246, 248, 250, 252)
        canvas.drawRoundRect(panel, 22f, 22f, panelPaint)

        val close = RectF(panel.left + 14f, panel.top + 12f, panel.left + 58f, panel.top + 56f)
        hitRects["search_close"] = close
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = 30f
        textPaint.color = Color.rgb(38, 42, 48)
        canvas.drawText("<", close.centerX(), close.centerY() + 10f, textPaint)

        val input = RectF(panel.left + 68f, panel.top + 12f, panel.right - 62f, panel.top + 56f)
        val inputPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(232, 238, 240)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(input, 22f, 22f, inputPaint)
        drawSearchIcon(canvas, input.left + 28f, input.centerY())
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 21f
        smallText.color = Color.rgb(42, 46, 52)
        canvas.drawText(searchQuery.ifBlank { "Szukaj w VROOM" }.take(30), input.left + 60f, input.centerY() + 8f, smallText)

        val submit = RectF(panel.right - 56f, panel.top + 12f, panel.right - 14f, panel.top + 56f)
        hitRects["search_submit"] = submit
        textPaint.textSize = 24f
        textPaint.color = Color.rgb(12, 132, 126)
        canvas.drawText(">", submit.centerX(), submit.centerY() + 8f, textPaint)

        if (searchQuery.isNotEmpty()) {
            val clear = RectF(input.right - 42f, input.top + 4f, input.right - 5f, input.bottom - 4f)
            hitRects["search_clear"] = clear
            textPaint.textSize = 20f
            textPaint.color = Color.rgb(92, 96, 104)
            canvas.drawText("x", clear.centerX(), clear.centerY() + 7f, textPaint)
        }

        var y = input.bottom + 14f
        if (searchLoading) {
            smallText.textAlign = Paint.Align.LEFT
            smallText.textSize = 23f
            smallText.color = Color.rgb(32, 36, 42)
            canvas.drawText("Szukam w poblizu...", panel.left + 28f, y + 36f, smallText)
            return
        }
        if (searchResults.isNotEmpty()) {
            searchResults.take(3).forEachIndexed { index, item ->
                val row = RectF(panel.left + 22f, y, panel.right - 22f, y + 64f)
                hitRects["search_result_$index"] = row
                panelPaint.color = Color.argb(0, 0, 0, 0)
                canvas.drawRoundRect(row, 14f, 14f, panelPaint)
                textPaint.textAlign = Paint.Align.LEFT
                textPaint.textSize = 24f
                textPaint.color = Color.rgb(24, 28, 34)
                canvas.drawText(item.name.take(25), row.left + 54f, row.top + 28f, textPaint)
                smallText.textAlign = Paint.Align.LEFT
                smallText.textSize = 16f
                smallText.color = Color.rgb(92, 96, 104)
                canvas.drawText(item.address.take(44), row.left + 54f, row.top + 52f, smallText)
                smallText.textAlign = Paint.Align.RIGHT
                smallText.color = Color.rgb(166, 24, 45)
                canvas.drawText(item.etaText, row.right - 4f, row.top + 31f, smallText)
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.textSize = 19f
                textPaint.color = Color.rgb(12, 132, 126)
                canvas.drawText("o", row.left + 23f, row.top + 38f, textPaint)
                val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.rgb(222, 226, 230)
                    strokeWidth = 1f
                }
                canvas.drawLine(row.left + 54f, row.bottom + 1f, row.right, row.bottom + 1f, divider)
                y += 68f
            }
            textPaint.textAlign = Paint.Align.CENTER
            return
        }

        val cats = listOf(
            Pair("search_cat_fuel", "Paliwo"),
            Pair("search_cat_parking", "Parking"),
            Pair("search_cat_food", "Jedzenie"),
            Pair("search_cat_coffee", "Kawa")
        )
        val gap = 10f
        val chipW = ((panel.width() - 44f - gap * 3f) / 4f).coerceAtMost(142f)
        var x = panel.left + 22f
        cats.forEach { cat ->
            val chip = RectF(x, y, x + chipW, y + 38f)
            hitRects[cat.first] = chip
            panelPaint.color = Color.rgb(232, 238, 238)
            canvas.drawRoundRect(chip, 19f, 19f, panelPaint)
            smallText.textAlign = Paint.Align.CENTER
            smallText.textSize = 16f
            smallText.color = Color.rgb(28, 32, 38)
            canvas.drawText(cat.second, chip.centerX(), chip.centerY() + 6f, smallText)
            x += chipW + gap
        }
        y += 50f

        val rows = listOf("1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
        rows.forEachIndexed { rowIndex, rowText ->
            val keyW = 34f
            val keyGap = if (rowIndex == 3) 13f else 20f
            val rowWidth = rowText.length * keyW + (rowText.length - 1) * keyGap
            x = panel.centerX() - rowWidth / 2f
            rowText.forEach { ch ->
                val key = RectF(x, y, x + keyW, y + 30f)
                hitRects["search_key_$ch"] = key
                textPaint.textAlign = Paint.Align.CENTER
                textPaint.textSize = 19f
                textPaint.color = Color.rgb(38, 42, 48)
                canvas.drawText(ch.toString(), key.centerX(), key.centerY() + 7f, textPaint)
                x += keyW + keyGap
            }
            if (rowIndex == 3) {
                val back = RectF(panel.right - 86f, y - 1f, panel.right - 22f, y + 31f)
                hitRects["search_backspace"] = back
                panelPaint.color = Color.rgb(232, 238, 238)
                canvas.drawRoundRect(back, 16f, 16f, panelPaint)
                textPaint.textSize = 18f
                textPaint.color = Color.rgb(38, 42, 48)
                canvas.drawText("del", back.centerX(), back.centerY() + 6f, textPaint)
            }
            y += 35f
        }
        val space = RectF(panel.centerX() - 120f, y - 1f, panel.centerX() + 120f, y + 27f)
        hitRects["search_space"] = space
        panelPaint.color = Color.rgb(210, 216, 218)
        canvas.drawRoundRect(space, 14f, 14f, panelPaint)
    }

    private fun drawReportOverlay(canvas: Canvas, top: Float, bottom: Float) {
        val width = canvas.width.toFloat()
        val panelW = 318f.coerceAtMost(width - 44f)
        val panel = RectF(width - panelW - 22f, top + 70f, width - 22f, (top + 318f).coerceAtMost(bottom - 18f))
        panelPaint.color = Color.argb(246, 8, 8, 10)
        strokePaint.color = Color.argb(150, 227, 56, 53)
        canvas.drawRoundRect(panel, 22f, 22f, panelPaint)
        canvas.drawRoundRect(panel, 22f, 22f, strokePaint)

        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 22f
        smallText.color = Color.WHITE
        canvas.drawText("Zgloszenie", panel.left + 20f, panel.top + 38f, smallText)
        val close = RectF(panel.right - 50f, panel.top + 10f, panel.right - 12f, panel.top + 48f)
        hitRects["report_close"] = close
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = 22f
        textPaint.color = Color.rgb(190, 194, 202)
        canvas.drawText("x", close.centerX(), close.centerY() + 7f, textPaint)

        val reports = listOf(
            Pair("report_type_accident", "Wypadek"),
            Pair("report_type_traffic", "Korek"),
            Pair("report_type_speed_control", "Policja"),
            Pair("report_type_weather", "Pogoda"),
            Pair("report_type_car_breakdown", "Awaria")
        )
        val gap = 10f
        val cellW = (panel.width() - 50f) / 2f
        val cellH = 54f
        reports.forEachIndexed { index, item ->
            val col = index % 2
            val row = index / 2
            val left = panel.left + 20f + col * (cellW + gap)
            val topCell = panel.top + 62f + row * (cellH + gap)
            val rect = RectF(left, topCell, left + cellW, topCell + cellH)
            hitRects[item.first] = rect
            panelPaint.color = Color.argb(238, 20, 22, 28)
            canvas.drawRoundRect(rect, 16f, 16f, panelPaint)
            smallText.textAlign = Paint.Align.CENTER
            smallText.textSize = 17f
            smallText.color = Color.WHITE
            canvas.drawText(item.second, rect.centerX(), rect.centerY() + 6f, smallText)
        }
    }

    private fun drawLoadingOverlay(canvas: Canvas, text: String) {
        val rect = RectF(canvas.width.toFloat() * 0.5f - 160f, canvas.height.toFloat() * 0.5f - 44f, canvas.width.toFloat() * 0.5f + 160f, canvas.height.toFloat() * 0.5f + 44f)
        panelPaint.color = Color.argb(240, 8, 8, 10)
        canvas.drawRoundRect(rect, 22f, 22f, panelPaint)
        textPaint.textSize = 23f
        textPaint.color = Color.WHITE
        canvas.drawText(text, rect.centerX(), rect.centerY() + 8f, textPaint)
    }

    private fun drawToast(canvas: Canvas) {
        val text = toastText ?: return
        if (System.currentTimeMillis() > toastUntil) {
            toastText = null
            return
        }
        val rect = RectF(canvas.width.toFloat() * 0.5f - 190f, 88f, canvas.width.toFloat() * 0.5f + 190f, 136f)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 18f, 18f, panelPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 18f
        smallText.color = Color.WHITE
        canvas.drawText(text, rect.centerX(), rect.centerY() + 7f, smallText)
        postInvalidateDelayed(250L)
    }

    private fun drawRoutePreviewPanel(canvas: Canvas, snap: VroomPayload, top: Float, bottom: Float) {
        val panel = RectF(24f, top + 8f, 392f.coerceAtMost(canvas.width.toFloat() - 164f), top + 206f)
        panelPaint.color = Color.argb(244, 248, 250, 252)
        strokePaint.color = Color.argb(95, 0, 0, 0)
        canvas.drawRoundRect(panel, 22f, 22f, panelPaint)
        canvas.drawRoundRect(panel, 22f, 22f, strokePaint)

        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 24f
        smallText.color = Color.rgb(28, 31, 36)
        val title = snap.destinationName?.takeIf { it.isNotBlank() } ?: "Cel"
        canvas.drawText(fitText(title, smallText, panel.width() - 48f), panel.left + 24f, panel.top + 42f, smallText)

        textPaint.textAlign = Paint.Align.LEFT
        textPaint.textSize = 27f
        textPaint.color = Color.rgb(166, 24, 45)
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), panel.left + 24f, panel.top + 86f, textPaint)
        smallText.textSize = 18f
        smallText.color = Color.rgb(45, 48, 54)
        canvas.drawText(" · ${formatEtaClock(snap.remainingDurationSec)}", panel.left + 128f, panel.top + 85f, smallText)

        smallText.textSize = 18f
        smallText.color = Color.rgb(42, 120, 74)
        canvas.drawText("${formatKm(snap.remainingDistanceMeters)} do celu", panel.left + 24f, panel.top + 116f, smallText)

        val start = RectF(panel.left + 24f, panel.bottom - 62f, panel.right - 86f, panel.bottom - 16f)
        hitRects["start_preview"] = start
        val startPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(12, 132, 126)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(start, 27f, 27f, startPaint)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = 20f
        textPaint.color = Color.WHITE
        canvas.drawText("Rozpocznij", start.centerX() + 14f, start.centerY() + 8f, textPaint)
        textPaint.textSize = 25f
        canvas.drawText("▲", start.left + 34f, start.centerY() + 9f, textPaint)

        val cancel = RectF(panel.right - 70f, panel.bottom - 62f, panel.right - 20f, panel.bottom - 16f)
        hitRects["cancel_preview"] = cancel
        val cancelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(232, 238, 238)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(cancel, 27f, 27f, cancelPaint)
        textPaint.textSize = 28f
        textPaint.color = Color.rgb(30, 34, 38)
        canvas.drawText("×", cancel.centerX(), cancel.centerY() + 10f, textPaint)
        textPaint.textAlign = Paint.Align.CENTER
    }

    private fun drawNavigationTopBar(canvas: Canvas, snap: VroomPayload, top: Float) {
        val card = RectF(24f, top, canvas.width.toFloat() - 154f, top + 92f)
        panelPaint.color = Color.argb(242, 6, 8, 12)
        strokePaint.color = Color.argb(135, 36, 202, 255)
        canvas.drawRoundRect(card, 22f, 22f, panelPaint)
        canvas.drawRoundRect(card, 22f, 22f, strokePaint)

        val iconBox = RectF(card.left + 14f, card.top + 14f, card.left + 78f, card.bottom - 14f)
        val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(36, 202, 255)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(iconBox, 18f, 18f, iconPaint)
        textPaint.textSize = 34f
        textPaint.color = Color.rgb(4, 7, 12)
        canvas.drawText(maneuverSymbol(snap.maneuver, snap.maneuverModifier), iconBox.centerX(), iconBox.centerY() + 12f, textPaint)

        val stats = RectF(card.right - 120f, card.top + 12f, card.right - 14f, card.bottom - 12f)
        val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(70, 255, 255, 255)
            strokeWidth = 1.5f
        }
        canvas.drawLine(stats.left - 12f, card.top + 16f, stats.left - 12f, card.bottom - 16f, divider)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = 23f
        textPaint.color = Color.WHITE
        canvas.drawText(formatDurationShort(snap.remainingDurationSec), stats.centerX(), stats.top + 27f, textPaint)
        smallText.textAlign = Paint.Align.CENTER
        smallText.textSize = 15f
        smallText.color = Color.rgb(36, 202, 255)
        canvas.drawText(formatKm(snap.remainingDistanceMeters), stats.centerX(), stats.top + 52f, smallText)

        val textLeft = iconBox.right + 16f
        val textRight = stats.left - 22f
        val textWidth = (textRight - textLeft).coerceAtLeast(120f)
        smallText.textAlign = Paint.Align.LEFT
        smallText.textSize = 16f
        smallText.color = Color.rgb(36, 202, 255)
        canvas.drawText(formatMeters(snap.turnDistanceMeters ?: snap.remainingDistanceMeters), textLeft, card.top + 28f, smallText)
        smallText.textSize = 22f
        smallText.color = Color.WHITE
        canvas.drawText(fitText(polishInstructionForHud(snap), smallText, textWidth), textLeft, card.top + 58f, smallText)
        smallText.textSize = 14f
        smallText.color = Color.rgb(170, 170, 178)
        canvas.drawText(fitText(snap.destinationName?.takeIf { it.isNotBlank() } ?: "Prowadzenie aktywne", smallText, textWidth), textLeft, card.bottom - 12f, smallText)
        textPaint.textAlign = Paint.Align.CENTER

        val stop = RectF(card.right + 12f, card.top + 12f, card.right + 76f, card.bottom - 12f)
        hitRects["stop_navigation"] = stop
        val stopPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(238, 8, 8, 10)
            style = Paint.Style.FILL
        }
        val stopStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(150, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(stop, 18f, 18f, stopPaint)
        canvas.drawRoundRect(stop, 18f, 18f, stopStroke)
        textPaint.textSize = 28f
        textPaint.color = Color.WHITE
        canvas.drawText("×", stop.centerX(), stop.centerY() + 10f, textPaint)
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
        val clean = snap.instruction?.trim().orEmpty()
        if (clean.isNotBlank() && !looksEnglishInstruction(clean)) return clean
        val type = snap.maneuver?.lowercase(java.util.Locale.US).orEmpty()
        val mod = snap.maneuverModifier?.lowercase(java.util.Locale.US).orEmpty()
        return when {
            type == "roundabout" || type == "rotary" -> "Rondo"
            type == "arrive" -> "Dojezdzasz do celu"
            type == "depart" -> "Rusz"
            type == "merge" -> "Wlacz sie do ruchu"
            type == "fork" -> "Trzymaj sie rozwidlenia"
            mod.contains("right") -> "Skrec w prawo"
            mod.contains("left") -> "Skrec w lewo"
            mod.contains("straight") -> "Jedz prosto"
            mod.contains("uturn") -> "Zawroc"
            else -> "Jedz do celu"
        }
    }

    private fun looksEnglishInstruction(value: String): Boolean {
        val lower = value.lowercase(java.util.Locale.US)
        return listOf("turn ", "continue", "merge", "arrive", "depart", "roundabout", "keep ", "head ").any { lower.contains(it) }
    }

    private fun drawSearchIcon(canvas: Canvas, cx: Float, cy: Float) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.STROKE
            strokeWidth = 4f
        }
        canvas.drawCircle(cx - 5f, cy - 4f, 11f, paint)
        canvas.drawLine(cx + 4f, cy + 6f, cx + 17f, cy + 19f, paint)
    }

    private fun drawLiveBadge(canvas: Canvas, left: Float, top: Float) {
        val rect = RectF(left, top, left + 112f, top + 42f)
        panelPaint.color = Color.argb(235, 8, 8, 10)
        canvas.drawRoundRect(rect, 21f, 21f, panelPaint)
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(77, 233, 38)
            style = Paint.Style.FILL
        }
        canvas.drawCircle(rect.left + 24f, rect.centerY(), 8f, dot)
        textPaint.textSize = 18f
        textPaint.color = Color.rgb(77, 233, 38)
        canvas.drawText("LIVE", rect.left + 70f, rect.centerY() + 7f, textPaint)
    }

    private fun drawReportButton(canvas: Canvas, left: Float, top: Float) {
        val rect = RectF(left, top, left + 112f, top + 84f)
        val red = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(rect, 18f, 18f, red)
        textPaint.textSize = 18f
        textPaint.color = Color.WHITE
        canvas.drawText("ZGLOS", rect.centerX(), rect.bottom - 18f, textPaint)
        val tri = Path().apply {
            moveTo(rect.centerX(), rect.top + 16f)
            lineTo(rect.centerX() - 20f, rect.top + 48f)
            lineTo(rect.centerX() + 20f, rect.top + 48f)
            close()
        }
        val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        canvas.drawPath(tri, white)
        textPaint.color = Color.rgb(227, 56, 53)
        textPaint.textSize = 22f
        canvas.drawText("!", rect.centerX(), rect.top + 43f, textPaint)
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

    private fun markerScreenHeading(heading: Double): Double {
        val bearing = mapView?.getMapboxMap()?.cameraState?.bearing ?: 0.0
        return ((heading - bearing) % 360.0 + 360.0) % 360.0
    }

    private fun drawArrowMarker(canvas: Canvas, x: Float, y: Float, heading: Double) {
        val outerHalo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(72, 227, 56, 53)
            style = Paint.Style.FILL
        }
        val innerHalo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(48, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2.5f
        }
        canvas.drawCircle(x, y, 31f, outerHalo)
        canvas.drawCircle(x, y, 22f, innerHalo)

        val save = canvas.save()
        canvas.rotate(heading.toFloat(), x, y)
        val path = Path().apply {
            moveTo(x, y - 27f)
            cubicTo(x + 6f, y - 13f, x + 13f, y + 3f, x + 18f, y + 18f)
            cubicTo(x + 10f, y + 14f, x + 5f, y + 10f, x, y + 6f)
            cubicTo(x - 5f, y + 10f, x - 10f, y + 14f, x - 18f, y + 18f)
            cubicTo(x - 13f, y + 3f, x - 6f, y - 13f, x, y - 27f)
            close()
        }
        val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(95, 0, 0, 0)
            style = Paint.Style.FILL
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(227, 56, 53)
            style = Paint.Style.FILL
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3.2f
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
        }
        val shine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(88, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
            strokeCap = Paint.Cap.ROUND
        }
        canvas.save()
        canvas.translate(0f, 3f)
        canvas.drawPath(path, shadow)
        canvas.restore()
        canvas.drawPath(path, fill)
        canvas.drawPath(path, stroke)
        canvas.drawLine(x, y - 16f, x, y + 3f, shine)
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
        if (snap == null || !snap.isNavigating || roadPoints == null || roadPoints.size < 2) return
        val now = System.currentTimeMillis()
        if (now - lastRerouteCheckAt < 1_500L) return
        lastRerouteCheckAt = now
        val measuredLat = snap.userLat ?: lat
        val measuredLng = snap.userLng ?: lng
        val projection = projectOnRoad(measuredLat, measuredLng, roadPoints, 1_000.0)
        if (projection == null || projection.distanceM > 40.0) {
            VroomCarManager.requestNativeReroute(measuredLat, measuredLng)
        }
    }

    private fun routeFollowPoints(snap: VroomPayload): List<AutoRoutePoint>? {
        if (snap.isNavigating && snap.routePoints.size >= 2) return snap.routePoints
        val nativeFresh = snap.mapState.nativeRoadMatch &&
            snap.mapState.nativeRoadMatchedAt > 0L &&
            System.currentTimeMillis() - snap.mapState.nativeRoadMatchedAt <= 18_000L
        if (!nativeFresh) return null
        val arcPoints = snap.mapState.autoArcWindow?.points
        if (arcPoints != null && arcPoints.size >= 2) return arcPoints
        return snap.routePoints.takeIf { it.size >= 2 }
    }

    private fun stepAlongActiveRoute(
        points: List<AutoRoutePoint>,
        travelM: Double,
        speedKmh: Double
    ): RoadStep? {
        if (points.size < 2) return null
        if (!routeCursorArcM.isFinite()) routeCursorArcM = routeTargetArcM.takeIf { it.isFinite() } ?: 0.0
        if (!routeTargetArcM.isFinite()) routeTargetArcM = routeCursorArcM
        val gapM = (routeTargetArcM - routeCursorArcM).coerceAtLeast(0.0)
        // Płynna interpolacja liniowa (LERP) bez twardych skokowych progów:
        val catchupM = if (gapM > 0.05) {
            val factor = (gapM / 40.0).coerceIn(0.05, 0.55)
            (travelM * factor + (gapM * 0.05)).coerceAtMost(1.5)
        } else {
            0.0
        }
        val targetAgeSec = if (lastTargetAt > 0L) {
            ((System.currentTimeMillis() - lastTargetAt).coerceIn(0L, 3_000L)).toDouble() / 1000.0
        } else {
            0.0
        }
        val maxExtrapolatedArc = routeTargetArcM + (speedKmh / 3.6) * targetAgeSec + 2.5
        val proposedArc = (routeCursorArcM + travelM + catchupM).coerceAtMost(maxExtrapolatedArc)
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
        maxDistanceM: Double
    ): RoadProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestDistance = Double.POSITIVE_INFINITY
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
        return best?.takeIf { bestDistance <= maxDistanceM }
    }

    private fun projectOnRoadWindow(
        lat: Double,
        lng: Double,
        points: List<AutoRoutePoint>,
        anchorArcM: Double,
        backwardM: Double,
        forwardM: Double,
        maxDistanceM: Double
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
                val score = distM + backwardPenalty
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

    private fun routeSignature(points: List<AutoRoutePoint>): Int {
        if (points.isEmpty()) return 0
        val first = points.first()
        val middle = points[points.size / 2]
        val last = points.last()
        var result = points.size
        listOf(first, middle, last).forEach { point ->
            result = 31 * result + (point.lat * 1_000_000.0).toLong().hashCode()
            result = 31 * result + (point.lng * 1_000_000.0).toLong().hashCode()
        }
        return result
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
