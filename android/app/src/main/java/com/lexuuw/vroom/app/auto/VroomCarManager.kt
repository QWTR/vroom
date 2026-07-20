package com.lexuuw.vroom.app.auto

import android.content.Context
import android.util.Log
import androidx.car.app.CarContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object VroomCarManager {
    private const val PREFS = "vroom_auto_profile"
    private const val KEY_MARKER_STYLE = "marker_style"
    private const val KEY_AVATAR_URL = "avatar_url"
    private const val AUTO_OSRM_BASE = "https://v-room.app/osrm"
    private const val OFF_ROUTE_REROUTE_DISTANCE_M = 14.0
    private const val OFF_ROUTE_HEADING_DISTANCE_M = 3.0
    private const val OFF_ROUTE_HEADING_DELTA_DEG = 45.0
    private const val OFF_ROUTE_HARD_HEADING_DELTA_DEG = 60.0
    private const val OFF_ROUTE_HEADING_MIN_SPEED_MS = 2.0
    private const val REROUTE_MIN_INTERVAL_MS = 1_200L

    private var currentScreen: VroomCarScreen? = null
    private var bridgeModule: VroomBridgeModule? = null
    private var latestPayloadJson: String = ""
    private var nativeNavigationPayloadJson: String? = null
    private var nativeRoutePreviewPayloadJson: String? = null
    private var rerouteInFlight = false
    private var lastRerouteAt = 0L
    private var jsMirroredNativeNavigation = false
    private var nativeNavigationRouteKey: String = ""
    private var appContext: Context? = null
    private var activeCarContext: CarContext? = null
    @Volatile private var nativeLat = Double.NaN
    @Volatile private var nativeLng = Double.NaN
    @Volatile private var nativeSpeedMs = 0.0
    @Volatile private var nativeHeading = 0.0
    @Volatile private var nativeAccuracyMeters = Float.NaN
    @Volatile private var nativePoseAtMs = 0L
    @Volatile private var lastColdPayloadAt = 0L
    @Volatile private var lastNavigationArcM = 0.0
    @Volatile private var simulationMode = false

    fun setScreen(screen: VroomCarScreen) {
        currentScreen = screen
        latestPayloadJson.takeIf { it.isNotBlank() }?.let(screen::updateData)
        Log.d("VroomCarManager", "Ekran zarejestrowany")
    }

    fun setAppContext(context: Context) {
        appContext = context.applicationContext
    }

    fun setCarContext(context: CarContext) {
        activeCarContext = context
    }

    fun clearCarContext() {
        activeCarContext = null
    }

    fun dispatchPendingNavigation(context: Context) {
        val carContext = activeCarContext ?: return
        val pending = AutoPendingNavigation.peekIntent(context.applicationContext) ?: return
        AutoPendingNavigation.consumeIntent(context.applicationContext)
        AutoNavigationCoordinator.handleNavigationIntent(carContext, pending)
    }

    fun dispatchAutoDriveRequest() {
        AutoNavigationCoordinator.onAutoDriveRequested()
    }

    fun clearScreen() {
        currentScreen = null
        Log.d("VroomCarManager", "Ekran wyczyszczony")
    }

    fun setBridge(module: VroomBridgeModule) {
        bridgeModule = module
    }

    fun resyncNativeMapMarkers() {
        currentScreen?.resyncMapMarkers()
    }

    fun sendDataToCar(jsonPayload: String) {
        rememberProfile(jsonPayload)
        rememberJsNavigationState(jsonPayload)
        val payload = mergeNativeNavigation(mergeNativeRoutePreview(mergeNativePose(jsonPayload)))
        latestPayloadJson = payload
        if (currentScreen != null) {
            currentScreen?.updateData(payload)
        } else {
            Log.w("VroomCarManager", "Brak aktywnego ekranu do odebrania danych")
        }
    }

    fun latestPayload(): VroomPayload? = VroomPayloadParser.parse(latestPayloadJson)

    fun showDriverAlert(text: String) {
        currentScreen?.showDriverAlert(text)
    }

    fun refreshTheme() {
        currentScreen?.refreshTheme()
    }

    fun hasActiveRouteSurface(): Boolean =
        nativeNavigationPayloadJson != null || nativeRoutePreviewPayloadJson != null

    fun setSimulationMode(active: Boolean) {
        simulationMode = active
        if (active) {
            rerouteInFlight = false
        }
    }

    fun isSimulationMode(): Boolean = simulationMode

    private fun mergeNativePose(jsonPayload: String): String {
        return runCatching {
            val base = JSONObject(jsonPayload)
            val mapState = base.optJSONObject("mapState") ?: JSONObject()
            val jsPoseActive = mapState.optBoolean("autoPoseActive", false)
            if (jsPoseActive) return@runCatching jsonPayload
            if (!validCoordinate(nativeLat, nativeLng)) {
                return@runCatching JSONObject(jsonPayload).apply {
                    remove("userLocation")
                    remove("speed")
                    remove("heading")
                }.toString()
            }
            base.put("userLocation", JSONObject().apply {
                put("latitude", nativeLat)
                put("longitude", nativeLng)
                put("accuracy", nativeAccuracyMeters.toDouble())
            })
            base.put("speed", nativeSpeedMs)
            base.put("heading", nativeHeading)
            mapState.put("isDriving", true)
            mapState.put("speedKmh", nativeSpeedMs * 3.6)
            mapState.put("autoPoseActive", false)
            mapState.put("nativeAutoPose", true)
            base.put("mapState", mapState)
            base.toString()
        }.getOrDefault(jsonPayload)
    }

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() &&
            lat in -90.0..90.0 && lng in -180.0..180.0 &&
            !(kotlin.math.abs(lat) < 1e-6 && kotlin.math.abs(lng) < 1e-6)

    fun currentNativeOrigin(maxAgeMs: Long): Pair<Double, Double>? {
        if (!validCoordinate(nativeLat, nativeLng)) return null
        val ageMs = if (nativePoseAtMs > 0L) System.currentTimeMillis() - nativePoseAtMs else Long.MAX_VALUE
        if (ageMs > maxAgeMs) return null
        return nativeLat to nativeLng
    }

    fun updateNativePose(
        lat: Double,
        lng: Double,
        speedMs: Double,
        heading: Double,
        accuracyMeters: Float,
        fromSimulation: Boolean = false,
    ) {
        if (!fromSimulation && simulationMode) return
        if (!validCoordinate(lat, lng)) return
        val now = System.currentTimeMillis()
        val cleanSpeed = if (speedMs.isFinite()) speedMs.coerceIn(0.0, 50.0) else 0.0
        val cleanHeading = if (heading.isFinite() && heading >= 0.0) (heading % 360.0 + 360.0) % 360.0 else nativeHeading
        nativeLat = lat
        nativeLng = lng
        nativeSpeedMs = cleanSpeed
        nativeHeading = cleanHeading
        nativeAccuracyMeters = accuracyMeters
        nativePoseAtMs = now
        currentScreen?.updateNativeLocation(lat, lng, cleanSpeed, cleanHeading)
        updateNativeNavigationProgress(lat, lng)

        val base = runCatching {
            if (latestPayloadJson.isBlank()) JSONObject() else JSONObject(latestPayloadJson)
        }.getOrDefault(JSONObject())
        base.put("userLocation", JSONObject().apply {
            put("latitude", lat)
            put("longitude", lng)
            put("accuracy", accuracyMeters.toDouble())
        })
        base.put("speed", cleanSpeed)
        base.put("heading", cleanHeading)
        if (!base.has("isNavigating")) base.put("isNavigating", false)

        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        mapState.put("isDriving", true)
        mapState.put("speedKmh", cleanSpeed * 3.6)
        mapState.put("autoPoseActive", false)
        mapState.put("nativeAutoPose", true)
        if (fromSimulation) {
            mapState.put("simulationMode", true)
            mapState.remove("nativeRoadGeometry")
            mapState.remove("autoArcWindow")
            mapState.remove("autoTargetArcM")
            mapState.put("nativeRoadMatch", false)
            mapState.put("nativeRoadPose", false)
        } else {
            mapState.remove("simulationMode")
        }

        if (!fromSimulation) {
            val road = NativeRoadMatcher.latestRoadJson()
            val roadVersion = NativeRoadMatcher.latestRoadVersion()
            if (road != null) {
                mapState.put("nativeRoadGeometry", JSONArray(road.toString()))
                mapState.put("autoArcWindow", JSONObject().apply {
                    put("points", JSONArray(road.toString()))
                    put("baseArcM", 0.0)
                    put("totalM", NativeRoadMatcher.latestRoadLength() ?: 0.0)
                })
                NativeRoadMatcher.latestMatchedArc()?.let { mapState.put("autoTargetArcM", it) }
                mapState.put("autoRoadBlend", 1.0)
                mapState.put("autoPathMode", "onRoad")
                mapState.put("nativeRoadMatch", true)
                mapState.put("nativeRoadPose", false)
                mapState.put("nativeRoadMatchedAt", now)
                mapState.put("nativeRoadVersion", roadVersion)
                if (!base.optBoolean("isNavigating", false) && !mapState.optBoolean("routePreview", false)) {
                    mapState.remove("route")
                    base.remove("route")
                }
            } else if (NativeRoadMatcher.hasFreshBootstrapPose()) {
                mapState.remove("nativeRoadGeometry")
                mapState.remove("autoArcWindow")
                mapState.remove("autoTargetArcM")
                mapState.put("nativeRoadMatch", false)
                mapState.put("nativeRoadPose", true)
                mapState.put("nativeRoadMatchedAt", now)
                mapState.put("nativeRoadVersion", 0)
                if (!base.optBoolean("isNavigating", false) && !mapState.optBoolean("routePreview", false)) {
                    mapState.remove("route")
                    base.remove("route")
                }
            } else {
                clearExpiredNativeRoadState(base, mapState)
            }
        }

        val navigating = base.optBoolean("isNavigating", false)
        val jsLimit = mapState.optInt("speedLimitKmh", 0).takeIf { it > 0 }
        NativeSpeedLimitFetcher.maybeFetch(lat, lng, navigating, jsLimit)
        val resolvedLimit = jsLimit ?: NativeSpeedLimitFetcher.currentLimit()
        resolvedLimit?.let { mapState.put("speedLimitKmh", it) }
        if (!mapState.has("speedLimitKmh")) {
            NativeSpeedLimitFetcher.currentLimit()?.let { mapState.put("speedLimitKmh", it) }
        }

        val profile = cachedProfile()
        if (!mapState.has("locationMarkerStyle")) mapState.put("locationMarkerStyle", profile.first)
        if (!mapState.has("currentUserAvatarUrl")) mapState.put("currentUserAvatarUrl", profile.second)
        base.put("mapState", mapState)
        if (!base.has("users")) base.put("users", JSONArray())
        if (!base.has("warnings")) base.put("warnings", JSONArray())

        val payload = mergeNativeNavigation(mergeNativeRoutePreview(base.toString()))
        latestPayloadJson = payload
        currentScreen?.syncOverlayDrivingTelemetry(resolvedLimit)
        if (now - lastColdPayloadAt >= 5_000L) {
            lastColdPayloadAt = now
            currentScreen?.updateData(payload)
        }
    }

    private fun clearExpiredNativeRoadState(base: JSONObject, mapState: JSONObject) {
        mapState.remove("autoArcWindow")
        mapState.remove("autoTargetArcM")
        mapState.remove("autoRoadBlend")
        mapState.remove("autoPathMode")
        mapState.remove("nativeRoadMatchedAt")
        mapState.remove("nativeRoadPose")
        mapState.remove("nativeRoadGeometry")
        mapState.put("nativeRoadVersion", 0)
        mapState.put("nativeRoadMatch", false)
        if (!base.optBoolean("isNavigating", false) && !mapState.optBoolean("routePreview", false)) {
            mapState.remove("route")
            base.remove("route")
        }
    }

    fun updateNativeRoadGeometry(points: JSONArray) {
        val now = System.currentTimeMillis()
        if (nativeNavigationPayloadJson != null) return
        if (nativeRoutePreviewPayloadJson != null) return
        if (points.length() < 2) return

        val base = runCatching {
            if (latestPayloadJson.isBlank()) JSONObject() else JSONObject(latestPayloadJson)
        }.getOrDefault(JSONObject())
        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        val clonedPoints = JSONArray(points.toString())
        mapState.put("route", clonedPoints)
        mapState.put("autoArcWindow", JSONObject().apply {
            put("points", JSONArray(points.toString()))
            put("baseArcM", 0.0)
            put("totalM", NativeRoadMatcher.latestRoadLength() ?: 0.0)
        })
        NativeRoadMatcher.latestMatchedArc()?.let { mapState.put("autoTargetArcM", it) }
        mapState.put("autoRoadBlend", 1.0)
        mapState.put("autoPathMode", "onRoad")
        mapState.put("nativeRoadMatch", true)
        mapState.put("nativeRoadPose", false)
        mapState.put("nativeRoadMatchedAt", now)
        mapState.put("isDriving", true)
        val profile = cachedProfile()
        if (!mapState.has("locationMarkerStyle")) mapState.put("locationMarkerStyle", profile.first)
        if (!mapState.has("currentUserAvatarUrl")) mapState.put("currentUserAvatarUrl", profile.second)
        base.put("mapState", mapState)
        base.put("route", JSONArray(points.toString()))
        if (!base.has("users")) base.put("users", JSONArray())
        if (!base.has("warnings")) base.put("warnings", JSONArray())

        latestPayloadJson = base.toString()
        if (System.currentTimeMillis() - lastColdPayloadAt >= 5_000L) {
            lastColdPayloadAt = System.currentTimeMillis()
            currentScreen?.updateData(latestPayloadJson)
        }
    }

    fun setNativeNavigation(jsonPayload: String) {
        nativeNavigationPayloadJson = jsonPayload
        nativeNavigationRouteKey = routeKeyFromPayload(jsonPayload)
        nativeRoutePreviewPayloadJson = null
        jsMirroredNativeNavigation = false
        lastNavigationArcM = 0.0
        lastColdPayloadAt = 0L
        sendDataToCar(jsonPayload)
        jsMirroredNativeNavigation = false
        latestPayload()?.let { AutoNavigationCoordinator.syncFromPayload(it) }
    }

    fun clearNativeNavigation() {
        nativeNavigationPayloadJson = null
        nativeRoutePreviewPayloadJson = null
        jsMirroredNativeNavigation = false
        nativeNavigationRouteKey = ""
        lastNavigationArcM = 0.0
        latestPayloadJson.takeIf { it.isNotBlank() }?.let { current ->
            val cleaned = runCatching {
                val base = JSONObject(current)
                base.put("isNavigating", false)
                base.remove("destination")
                base.remove("route")
                base.remove("dto")
                val mapState = base.optJSONObject("mapState") ?: JSONObject()
                mapState.put("uiMode", "FREE_DRIVE")
                mapState.put("routePreview", false)
                mapState.remove("route")
                mapState.remove("destinationLat")
                mapState.remove("destinationLng")
                base.put("mapState", mapState)
                base.toString()
            }.getOrDefault(current)
            latestPayloadJson = cleaned
            currentScreen?.updateData(cleaned)
            AutoNavigationCoordinator.stopNavigation()
        }
    }

    fun setNativeRoutePreview(jsonPayload: String) {
        nativeNavigationPayloadJson = null
        nativeNavigationRouteKey = ""
        jsMirroredNativeNavigation = false
        lastNavigationArcM = 0.0
        nativeRoutePreviewPayloadJson = jsonPayload
        sendDataToCar(jsonPayload)
        bridgeModule?.sendEvent("onAutoNavigationStarted", jsonPayload)
    }

    fun getRoutePreviewPayload(): String? = nativeRoutePreviewPayloadJson

    fun selectRoutePreviewIndex(index: Int) {
        val preview = nativeRoutePreviewPayloadJson ?: return
        val updated = runCatching {
            val root = JSONObject(preview)
            val mapState = root.optJSONObject("mapState") ?: return@runCatching preview
            val alternatives = mapState.optJSONArray("alternativeRoutes") ?: return@runCatching preview
            if (index < 0 || index >= alternatives.length()) return@runCatching preview
            val selected = alternatives.optJSONObject(index) ?: return@runCatching preview
            val rawRoute = selected.optJSONArray("route") ?: JSONArray()
            val pose = AutoLocationTracker.lastKnownPose(2_500L)
            val route = if (pose != null && rawRoute.length() >= 2) {
                AutoRouteGeometry.anchorRoutePoints(rawRoute, pose.lat, pose.lng)
            } else {
                rawRoute
            }
            mapState.put("selectedRouteIndex", index)
            mapState.put("route", JSONArray(route.toString()))
            root.put("route", JSONArray(route.toString()))
            val routeSteps = selected.optJSONArray("routeSteps")
            if (routeSteps != null) {
                mapState.put("routeSteps", JSONArray(routeSteps.toString()))
                root.put("routeSteps", JSONArray(routeSteps.toString()))
            }
            root.optJSONObject("dto")?.apply {
                val firstStep = routeSteps?.optJSONObject(0)
                val followingStep = routeSteps?.optJSONObject(1)
                put("nextInstruction", selected.optString("instruction", "Jedz do celu"))
                put("maneuver", selected.optString("maneuver", "straight"))
                put("maneuverModifier", selected.optString("maneuverModifier", ""))
                put("maneuverExit", firstStep?.optInt("maneuverExit", 0) ?: 0)
                put("followingInstruction", followingStep?.optString("instruction", "") ?: "")
                put("followingManeuver", followingStep?.optString("maneuver", "") ?: "")
                put("followingManeuverModifier", followingStep?.optString("maneuverModifier", "") ?: "")
                put("followingManeuverExit", followingStep?.optInt("maneuverExit", 0) ?: 0)
                put("followingTurnDistanceMeters", followingStep?.optInt("distanceMeters", 0) ?: 0)
                put("upcomingSteps", routeStepSlice(routeSteps, 1))
                put("remainingDistanceMeters", selected.optInt("distanceM", 1))
                put("remainingDurationSec", selected.optInt("durationS", 0))
                put("turnDistanceMeters", selected.optInt("distanceM", 1))
            }
            root.put("mapState", mapState)
            root.toString()
        }.getOrNull() ?: return
        nativeRoutePreviewPayloadJson = updated
        sendDataToCar(updated)
        bridgeModule?.sendEvent("onAutoNavigationStarted", updated)
    }

    fun startNativeRoutePreview() {
        val preview = nativeRoutePreviewPayloadJson ?: return
        val autoDrive = AutoNavigationCoordinator.isAutoDriveEnabled()
        val pose = if (autoDrive) null else AutoLocationTracker.lastKnownPose(5_000L)
        val preparedPreview = if (pose != null && !autoDrive) {
            runCatching {
                val root = JSONObject(preview)
                val route = root.optJSONArray("route")
                    ?: root.optJSONObject("mapState")?.optJSONArray("route")
                if (route != null && route.length() >= 2) {
                    val anchored = AutoRouteGeometry.anchorRoutePoints(route, pose.lat, pose.lng)
                    root.put("route", anchored)
                    root.optJSONObject("mapState")?.put("route", JSONArray(anchored.toString()))
                    root.put("userLocation", JSONObject().apply {
                        put("latitude", pose.lat)
                        put("longitude", pose.lng)
                    })
                    root.put("heading", pose.heading)
                }
                root.toString()
            }.getOrDefault(preview)
        } else {
            preview
        }
        val navigating = runCatching {
            val root = JSONObject(preparedPreview)
            root.put("isNavigating", true)
            root.optJSONObject("dto")?.put("isNavigating", true)
            val mapState = root.optJSONObject("mapState") ?: JSONObject()
            mapState.put("uiMode", "NAVIGATING")
            mapState.put("routePreview", false)
            mapState.put("isDriving", true)
            root.put("mapState", mapState)
            root.toString()
        }.getOrDefault(preparedPreview)
        nativeRoutePreviewPayloadJson = null
        setNativeNavigation(navigating)
        appContext?.let { AutoNavStore.setNavigating(it, true) }
        if (pose != null && !autoDrive) {
            requestNativeReroute(pose.lat, pose.lng, pose.heading)
        }
        bridgeModule?.sendEvent("onAutoNavigationStarted", navigating)
    }

    fun startNavigationFromSearch(jsonPayload: String) {
        setNativeNavigation(jsonPayload)
        bridgeModule?.sendEvent("onAutoNavigationStarted", jsonPayload)
    }

    fun submitSearchQuery(query: String) {
        bridgeModule?.sendEvent("onSearchQuery", query)
    }

    fun selectSearchResult(id: String) {
        bridgeModule?.sendEvent("onSearchResult", id)
    }

    fun startRoutePreview() {
        startNativeRoutePreview()
    }

    fun cancelRoutePreview() {
        clearNativeRoutePreview()
    }

    fun openReportMenu() {
        reportClick()
    }

    fun submitReport(type: String) {
        reportTypeClick(type)
    }

    fun clearNativeRoutePreview() {
        nativeRoutePreviewPayloadJson = null
        latestPayloadJson.takeIf { it.isNotBlank() }?.let { current ->
            val cleaned = runCatching {
                val base = JSONObject(current)
                val mapState = base.optJSONObject("mapState") ?: JSONObject()
                mapState.put("routePreview", false)
                mapState.remove("route")
                mapState.remove("destinationLat")
                mapState.remove("destinationLng")
                base.put("mapState", mapState)
                base.remove("route")
                base.remove("destination")
                base.toString()
            }.getOrDefault(current)
            latestPayloadJson = cleaned
            currentScreen?.updateData(cleaned)
        }
    }

    fun reportClick() {
        bridgeModule?.sendEvent("onReport", null)
    }

    fun reportTypeClick(type: String) {
        bridgeModule?.sendEvent("onReportType", type)
    }

    fun searchClick() {
        bridgeModule?.sendEvent("onSearch", null)
    }

    fun stopClick() {
        clearNativeNavigation()
        bridgeModule?.sendEvent("onStop", null)
    }

    private fun updateNativeNavigationProgress(currentLat: Double, currentLng: Double) {
        if (simulationMode) return
        val navPayload = nativeNavigationPayloadJson ?: return
        if (!validCoordinate(currentLat, currentLng)) return
        val updated = runCatching {
            val root = JSONObject(navPayload)
            val route = parseRoutePoints(root.optJSONArray("route") ?: root.optJSONObject("mapState")?.optJSONArray("route"))
            val steps = root.optJSONObject("mapState")?.optJSONArray("routeSteps") ?: root.optJSONArray("routeSteps")
            if (route.size < 2) return
            val projection = projectOnRoute(
                currentLat,
                currentLng,
                route,
                minArcM = (lastNavigationArcM - 25.0).coerceAtLeast(0.0)
            ) ?: return
            if (shouldRerouteFromProjection(projection)) {
                requestNativeReroute(currentLat, currentLng, nativeHeading)
                return
            }
            lastNavigationArcM = kotlin.math.max(lastNavigationArcM, projection.arcM)
            if (steps == null || steps.length() == 0) return
            val dto = root.optJSONObject("dto") ?: JSONObject()
            val totalM = routeTotalMeters(route).coerceAtLeast(projection.arcM)
            val remainingM = (totalM - projection.arcM).toInt().coerceAtLeast(1)
            val active = nextRouteStep(steps, projection.arcM)
            if (active == null && remainingM > 100) {
                requestNativeReroute(currentLat, currentLng, nativeHeading)
                return
            }
            val safeActive = active ?: activeRouteStep(steps, projection.arcM)
            val following = followingRouteStep(steps, safeActive.optDouble("arcM", projection.arcM))
            val turnM = (safeActive.optDouble("arcM", projection.arcM) - projection.arcM).toInt().coerceAtLeast(1)
            if (isDeadManeuver(safeActive, turnM, remainingM)) {
                requestNativeReroute(currentLat, currentLng, nativeHeading)
                return
            }
            dto.put("isNavigating", true)
            dto.put("nextInstruction", safeActive.optString("instruction", "Jedz prosto"))
            dto.put("maneuver", safeActive.optString("maneuver", "straight"))
            dto.put("maneuverModifier", safeActive.optString("maneuverModifier", ""))
            dto.put("maneuverExit", safeActive.optInt("maneuverExit", 0).takeIf { it > 0 })
            dto.put("followingInstruction", following?.optString("instruction", "") ?: "")
            dto.put("followingManeuver", following?.optString("maneuver", "") ?: "")
            dto.put("followingManeuverModifier", following?.optString("maneuverModifier", "") ?: "")
            dto.put("followingManeuverExit", following?.optInt("maneuverExit", 0)?.takeIf { it > 0 })
            dto.put("followingTurnDistanceMeters", following?.optInt("distanceMeters", 0)?.takeIf { it > 0 })
            dto.put("upcomingSteps", upcomingRouteSteps(steps, safeActive.optDouble("arcM", projection.arcM)))
            dto.put("remainingDistanceMeters", remainingM)
            dto.put("turnDistanceMeters", turnM)
            root.put("dto", dto)
            root.toString()
        }.getOrNull() ?: return
        if (updated != nativeNavigationPayloadJson) {
            nativeNavigationPayloadJson = updated
            sendDataToCar(updated)
        }
    }

    private fun activeRouteStep(steps: JSONArray, arcM: Double): JSONObject {
        val first = steps.optJSONObject(0) ?: JSONObject().apply {
            put("instruction", "Jedz prosto")
            put("maneuver", "straight")
            put("arcM", arcM)
        }
        var fallback = first
        for (i in 0 until steps.length()) {
            val step = steps.optJSONObject(i) ?: continue
            val stepArc = step.optDouble("arcM", Double.NaN)
            if (!stepArc.isFinite()) continue
            if (stepArc >= arcM - 6.0) return step
            fallback = step
        }
        return fallback
    }

    private fun nextRouteStep(steps: JSONArray, arcM: Double): JSONObject? {
        for (i in 0 until steps.length()) {
            val step = steps.optJSONObject(i) ?: continue
            val stepArc = step.optDouble("arcM", Double.NaN)
            if (!stepArc.isFinite()) continue
            if (stepArc >= arcM - 6.0) return step
        }
        return null
    }

    private fun followingRouteStep(steps: JSONArray, currentArcM: Double): JSONObject? {
        for (i in 0 until steps.length()) {
            val step = steps.optJSONObject(i) ?: continue
            val stepArc = step.optDouble("arcM", Double.NaN)
            if (stepArc.isFinite() && stepArc > currentArcM + 6.0) return step
        }
        return null
    }

    private fun upcomingRouteSteps(steps: JSONArray, currentArcM: Double): JSONArray {
        val result = JSONArray()
        for (index in 0 until steps.length()) {
            val step = steps.optJSONObject(index) ?: continue
            val stepArc = step.optDouble("arcM", Double.NaN)
            if (!stepArc.isFinite() || stepArc <= currentArcM + 6.0) continue
            result.put(JSONObject(step.toString()))
            if (result.length() >= 3) break
        }
        return result
    }

    private fun routeStepSlice(steps: JSONArray?, startIndex: Int): JSONArray {
        val result = JSONArray()
        if (steps == null) return result
        for (index in startIndex until minOf(steps.length(), startIndex + 3)) {
            steps.optJSONObject(index)?.let { result.put(JSONObject(it.toString())) }
        }
        return result
    }

    private fun isDeadManeuver(step: JSONObject, turnM: Int, remainingM: Int): Boolean {
        if (remainingM <= 100 || turnM > 3 || nativeSpeedMs < 2.0) return false
        val maneuver = step.optString("maneuver", "").lowercase(java.util.Locale.US)
        val instruction = step.optString("instruction", "").lowercase(java.util.Locale("pl", "PL"))
        return maneuver == "roundabout" || maneuver == "rotary" || instruction.contains("rond")
    }

    fun requestNativeReroute(fromLat: Double, fromLng: Double, headingDeg: Double? = null) {
        if (simulationMode) return
        val navPayload = nativeNavigationPayloadJson ?: return
        if (!fromLat.isFinite() || !fromLng.isFinite()) return
        val now = System.currentTimeMillis()
        if (rerouteInFlight || now - lastRerouteAt < REROUTE_MIN_INTERVAL_MS) return
        val root = runCatching { JSONObject(navPayload) }.getOrNull() ?: return
        val destination = resolveNavigationDestination(root) ?: return
        val toLat = destination.lat
        val toLng = destination.lng
        val toName = destination.name
        val resolvedHeading = headingDeg?.takeIf { it.isFinite() }
            ?: root.optDouble("heading", Double.NaN).takeIf { it.isFinite() }
            ?: AutoLocationTracker.lastKnownPose()?.heading
        rerouteInFlight = true
        lastRerouteAt = now
        Thread {
            val nextPayload = runCatching {
                val bearings = AutoRouteGeometry.bearingsParam(resolvedHeading, toleranceDeg = 45)
                val baseUrl = "$AUTO_OSRM_BASE/route/v1/driving/$fromLng,$fromLat;$toLng,$toLat" +
                    "?alternatives=true&geometries=geojson&steps=true&overview=full&continue_straight=true"
                val body = runCatching {
                    val withBearings = requestJson(baseUrl + bearings, 3_800, 3_800)
                    val parsed = JSONObject(withBearings)
                    if (!isUsableRouteResponse(parsed) || AutoRouteGeometry.firstStepRequiresUturn(parsed)) {
                        val fallback = requestJson(baseUrl, 3_800, 3_800)
                        AutoRouteGeometry.selectBestRoute(JSONObject(fallback), preferNoUturn = true).toString()
                    } else {
                        withBearings
                    }
                }.recoverCatching {
                    requestJson(baseUrl, 3_800, 3_800)
                }.getOrThrow()
                buildReroutedPayload(navPayload, body, fromLat, fromLng, toLat, toLng, toName)
            }.getOrNull()
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                rerouteInFlight = false
                if (nextPayload != null) {
                    nativeNavigationPayloadJson = nextPayload
                    nativeNavigationRouteKey = routeKeyFromPayload(nextPayload)
                    lastNavigationArcM = 0.0
                    sendDataToCar(nextPayload)
                } else {
                    Log.w("VroomCarManager", "Native reroute failed or returned no payload")
                }
            }
        }.start()
    }

    private fun mergeNativeNavigation(jsonPayload: String): String {
        val nativePayload = nativeNavigationPayloadJson ?: return jsonPayload
        return runCatching {
            val base = JSONObject(jsonPayload)
            val native = JSONObject(nativePayload)
            base.put("isNavigating", true)
            base.put("dto", native.optJSONObject("dto"))
            base.put("destination", native.optJSONObject("destination"))
            base.put("route", native.optJSONArray("route"))
            native.optJSONArray("routeSteps")?.let { base.put("routeSteps", it) }
            val baseMap = base.optJSONObject("mapState") ?: JSONObject()
            val nativeMap = native.optJSONObject("mapState")
            if (nativeMap != null) {
                baseMap.put("route", nativeMap.optJSONArray("route"))
                nativeMap.optJSONArray("routeSteps")?.let { baseMap.put("routeSteps", it) }
                baseMap.put("destinationLat", nativeMap.optDouble("destinationLat"))
                baseMap.put("destinationLng", nativeMap.optDouble("destinationLng"))
                baseMap.put("routePreview", false)
                baseMap.put("nativeRoadMatch", false)
                baseMap.put("isDriving", true)
            }
            applySpeedLimitToMapState(
                baseMap,
                base.optJSONObject("userLocation")?.optDouble("latitude", Double.NaN),
                base.optJSONObject("userLocation")?.optDouble("longitude", Double.NaN),
                navigating = true,
            )
            base.put("mapState", baseMap)
            base.toString()
        }.getOrElse { jsonPayload }
    }

    private fun mergeNativeRoutePreview(jsonPayload: String): String {
        val previewPayload = nativeRoutePreviewPayloadJson ?: return jsonPayload
        if (nativeNavigationPayloadJson != null) return jsonPayload
        return runCatching {
            val base = JSONObject(jsonPayload)
            val preview = JSONObject(previewPayload)
            base.put("isNavigating", false)
            base.put("dto", preview.optJSONObject("dto"))
            base.put("destination", preview.optJSONObject("destination"))
            base.put("route", preview.optJSONArray("route"))
            preview.optJSONArray("routeSteps")?.let { base.put("routeSteps", it) }
            val baseMap = base.optJSONObject("mapState") ?: JSONObject()
            val previewMap = preview.optJSONObject("mapState")
            if (previewMap != null) {
                baseMap.put("route", previewMap.optJSONArray("route"))
                previewMap.optJSONArray("routeSteps")?.let { baseMap.put("routeSteps", it) }
                previewMap.optJSONArray("alternativeRoutes")?.let { baseMap.put("alternativeRoutes", it) }
                if (previewMap.has("selectedRouteIndex")) {
                    baseMap.put("selectedRouteIndex", previewMap.optInt("selectedRouteIndex", 0))
                }
                baseMap.put("destinationLat", previewMap.optDouble("destinationLat"))
                baseMap.put("destinationLng", previewMap.optDouble("destinationLng"))
                baseMap.put("routePreview", true)
                baseMap.put("isDriving", true)
            }
            base.put("mapState", baseMap)
            base.toString()
        }.getOrElse { jsonPayload }
    }

    private fun rememberJsNavigationState(jsonPayload: String) {
        runCatching {
            val root = JSONObject(jsonPayload)
            val jsNavigating = root.optBoolean("isNavigating", false)
            if (jsNavigating) {
                if (nativeNavigationPayloadJson != null) jsMirroredNativeNavigation = true
                val routeKey = routeKeyFromRoot(root)
                if (routeKey.isNotBlank()) {
                    val routeChanged = routeKey != nativeNavigationRouteKey
                    nativeNavigationPayloadJson = root.toString()
                    nativeNavigationRouteKey = routeKey
                    nativeRoutePreviewPayloadJson = null
                    if (routeChanged) lastNavigationArcM = 0.0
                    rerouteInFlight = false
                    if (routeChanged) Log.d("VroomCarManager", "Przejmuje trase z telefonu dla Android Auto")
                }
            }
        }
    }

    private fun rememberProfile(jsonPayload: String) {
        runCatching {
            val mapState = JSONObject(jsonPayload).optJSONObject("mapState") ?: return
            val style = mapState.optString("locationMarkerStyle", "").takeIf { it.isNotBlank() }
            val avatar = mapState.optString("currentUserAvatarUrl", "").takeIf { it.isNotBlank() }
            val context = appContext ?: return
            val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            if (style != null) edit.putString(KEY_MARKER_STYLE, style)
            if (avatar != null) edit.putString(KEY_AVATAR_URL, avatar)
            edit.apply()
        }
    }

    private fun cachedProfile(): Pair<String, String> {
        val context = appContext ?: return Pair("arrow", "")
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Pair(
            prefs.getString(KEY_MARKER_STYLE, "arrow") ?: "arrow",
            prefs.getString(KEY_AVATAR_URL, "") ?: ""
        )
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

    private data class RoutePoint(val lat: Double, val lng: Double)
    private data class RouteProjection(val arcM: Double, val distanceM: Double, val routeHeading: Double)
    private data class NavDestination(val lat: Double, val lng: Double, val name: String)

    private fun routeStepsJson(steps: JSONArray, routePointsJson: JSONArray): JSONArray {
        val route = parseRoutePoints(routePointsJson)
        return JSONArray().apply {
            for (i in 0 until steps.length()) {
                val step = steps.optJSONObject(i) ?: continue
                val maneuver = step.optJSONObject("maneuver")
                val loc = maneuver?.optJSONArray("location")
                val lng = loc?.optDouble(0, Double.NaN) ?: Double.NaN
                val lat = loc?.optDouble(1, Double.NaN) ?: Double.NaN
                val arcM = if (lat.isFinite() && lng.isFinite()) {
                    projectOnRoute(lat, lng, route)?.arcM ?: 0.0
                } else {
                    0.0
                }
                put(JSONObject().apply {
                    put("arcM", arcM)
                    put("instruction", polishInstruction(step, maneuver))
                    put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
                    put("maneuverModifier", maneuverModifierForStep(maneuver))
                    put("maneuverExit", maneuver?.optInt("exit", 0) ?: 0)
                    put("distanceMeters", step.optDouble("distance", 0.0).toInt().coerceAtLeast(1))
                    put("durationSec", step.optDouble("duration", 0.0).toInt().coerceAtLeast(0))
                })
            }
        }
    }

    private fun parseRoutePoints(points: JSONArray?): List<RoutePoint> {
        if (points == null) return emptyList()
        return buildList {
            for (i in 0 until points.length()) {
                val p = points.optJSONObject(i) ?: continue
                val lat = p.optDouble("lat", Double.NaN)
                val lng = p.optDouble("lng", Double.NaN)
                if (lat.isFinite() && lng.isFinite()) add(RoutePoint(lat, lng))
            }
        }
    }

    private fun routeKeyFromPayload(payload: String): String =
        runCatching { routeKeyFromRoot(JSONObject(payload)) }.getOrDefault("")

    private fun routeKeyFromRoot(root: JSONObject): String {
        val route = parseRoutePoints(root.optJSONArray("route") ?: root.optJSONObject("mapState")?.optJSONArray("route"))
        if (route.size < 2) return ""
        val first = route.first()
        val last = route.last()
        return "${route.size}:${coordKey(first.lat)},${coordKey(first.lng)}:${coordKey(last.lat)},${coordKey(last.lng)}"
    }

    private fun coordKey(value: Double): Int =
        kotlin.math.round(value * 100_000.0).toInt()

    private fun routeTotalMeters(points: List<RoutePoint>): Double {
        var total = 0.0
        for (i in 0 until points.size - 1) {
            total += distanceMeters(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
        }
        return total
    }

    private fun projectOnRoute(
        lat: Double,
        lng: Double,
        points: List<RoutePoint>,
        minArcM: Double = 0.0
    ): RouteProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var bestArc = 0.0
        var bestDistance = Double.POSITIVE_INFINITY
        var bestHeading = nativeHeading
        var bestScore = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val latScale = kotlin.math.cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
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
            val arcPenalty = if (cumM + segM * t + 2.0 < minArcM) (minArcM - (cumM + segM * t)) * 8.0 else 0.0
            val score = distM + arcPenalty
            if (score < bestScore) {
                bestScore = score
                bestDistance = distM
                bestArc = cumM + segM * t
                bestHeading = bearingDeg(a.lat, a.lng, b.lat, b.lng)
            }
            cumM += segM
        }
        return RouteProjection(bestArc, bestDistance, bestHeading).takeIf { bestDistance.isFinite() }
    }

    private fun shouldRerouteFromProjection(projection: RouteProjection): Boolean {
        if (projection.distanceM > OFF_ROUTE_REROUTE_DISTANCE_M) return true
        if (projection.arcM + 35.0 < lastNavigationArcM) return true
        val heading = nativeHeading.takeIf { it.isFinite() } ?: return false
        if (nativeSpeedMs < OFF_ROUTE_HEADING_MIN_SPEED_MS) return false
        val delta = headingDeltaDeg(heading, projection.routeHeading)
        if (delta >= OFF_ROUTE_HARD_HEADING_DELTA_DEG && projection.distanceM >= 2.0) return true
        return delta >= OFF_ROUTE_HEADING_DELTA_DEG && projection.distanceM >= OFF_ROUTE_HEADING_DISTANCE_M
    }

    private fun isUsableRouteResponse(root: JSONObject): Boolean {
        if (root.optString("code", "Ok") != "Ok") return false
        val routes = root.optJSONArray("routes") ?: return false
        return routes.length() > 0 && routes.optJSONObject(0) != null
    }

    private fun resolveNavigationDestination(root: JSONObject): NavDestination? {
        val destination = root.optJSONObject("destination")
        val mapState = root.optJSONObject("mapState")
        val dto = root.optJSONObject("dto")
        val lat = destination?.optDouble("latitude", destination.optDouble("lat", Double.NaN))?.takeIf { it.isFinite() }
            ?: mapState?.optDouble("destinationLat", Double.NaN)?.takeIf { it.isFinite() }
            ?: Double.NaN
        val lng = destination?.optDouble("longitude", destination.optDouble("lng", Double.NaN))?.takeIf { it.isFinite() }
            ?: mapState?.optDouble("destinationLng", Double.NaN)?.takeIf { it.isFinite() }
            ?: Double.NaN
        if (!lat.isFinite() || !lng.isFinite()) return null
        val name = destination?.optString("name", "")?.takeIf { it.isNotBlank() }
            ?: dto?.optString("destinationName", "")?.takeIf { it.isNotBlank() }
            ?: "Cel"
        return NavDestination(lat, lng, name)
    }

    private fun bearingDeg(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = kotlin.math.sin(dLng) * kotlin.math.cos(lat2)
        val x = kotlin.math.cos(lat1) * kotlin.math.sin(lat2) -
            kotlin.math.sin(lat1) * kotlin.math.cos(lat2) * kotlin.math.cos(dLng)
        return ((Math.toDegrees(kotlin.math.atan2(y, x)) % 360.0) + 360.0) % 360.0
    }

    private fun headingDeltaDeg(a: Double, b: Double): Double {
        val delta = kotlin.math.abs((((a - b) % 360.0) + 540.0) % 360.0 - 180.0)
        return delta.coerceIn(0.0, 180.0)
    }

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val earthRadiusM = 6_371_000.0
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            kotlin.math.cos(lat1) * kotlin.math.cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return earthRadiusM * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }

    private fun buildReroutedPayload(
        previousPayload: String,
        routeBody: String,
        fromLat: Double,
        fromLng: Double,
        toLat: Double,
        toLng: Double,
        toName: String
    ): String {
        val root = JSONObject(routeBody)
        val code = root.optString("code", "Ok")
        if (code.isNotBlank() && code != "Ok") throw IllegalStateException("Wyznaczanie trasy nie powiodło się: $code")
        val route = root.optJSONArray("routes")?.optJSONObject(0) ?: throw IllegalStateException("Brak trasy")
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
        if (points.length() < 2) throw IllegalStateException("Brak geometrii trasy")
        val anchoredPoints = AutoRouteGeometry.anchorRoutePoints(points, fromLat, fromLng)
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
        val followingStep = leg?.optJSONArray("steps")?.optJSONObject(1)
        val steps = leg?.optJSONArray("steps") ?: JSONArray()
        val routeSteps = routeStepsJson(steps, anchoredPoints)
        val maneuver = step?.optJSONObject("maneuver")
        val followingManeuver = followingStep?.optJSONObject("maneuver")
        val distance = route.optDouble("distance", 0.0).toInt().coerceAtLeast(1)
        val duration = route.optDouble("duration", 0.0).toInt().coerceAtLeast(0)
        val instruction = polishInstruction(step, maneuver)
        val turnDistance = step?.optDouble("distance", distance.toDouble())?.toInt() ?: distance
        val base = runCatching { JSONObject(previousPayload) }.getOrDefault(JSONObject())
        base.put("isNavigating", true)
        base.put("userLocation", JSONObject().apply {
            put("latitude", fromLat)
            put("longitude", fromLng)
        })
        base.put("destination", JSONObject().apply {
            put("name", toName)
            put("latitude", toLat)
            put("longitude", toLng)
        })
        base.put("route", JSONArray(anchoredPoints.toString()))
        base.put("routeSteps", JSONArray(routeSteps.toString()))
        base.put("dto", JSONObject().apply {
            put("isNavigating", true)
            put("nextInstruction", instruction)
            put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
            put("maneuverModifier", maneuver?.optString("modifier", "") ?: "")
            put("maneuverExit", maneuver?.optInt("exit", 0) ?: 0)
            put("followingInstruction", polishInstruction(followingStep, followingManeuver))
            put("followingManeuver", followingManeuver?.optString("type", "") ?: "")
            put("followingManeuverModifier", followingManeuver?.optString("modifier", "") ?: "")
            put("followingManeuverExit", followingManeuver?.optInt("exit", 0) ?: 0)
            put("followingTurnDistanceMeters", followingStep?.optDouble("distance", 0.0)?.toInt() ?: 0)
            put("upcomingSteps", routeStepSlice(routeSteps, 1))
            put("destinationName", toName)
            put("remainingDistanceMeters", distance)
            put("remainingDurationSec", duration)
            put("turnDistanceMeters", turnDistance)
        })
        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        mapState.put("route", JSONArray(anchoredPoints.toString()))
        mapState.put("routeSteps", JSONArray(routeSteps.toString()))
        mapState.put("destinationLat", toLat)
        mapState.put("destinationLng", toLng)
        mapState.put("routePreview", false)
        mapState.put("isDriving", true)
        mapState.put("nativeRoadMatch", false)
        base.put("mapState", mapState)
        return base.toString()
    }

    private fun maneuverModifierForStep(maneuver: JSONObject?): String {
        if (maneuver == null) return ""
        val modifier = maneuver.optString("modifier", "").orEmpty()
        val exit = maneuver.optInt("exit", 0)
        if (exit > 0) return "exit $exit"
        return modifier
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

    private fun applySpeedLimitToMapState(
        mapState: JSONObject,
        lat: Double?,
        lng: Double?,
        navigating: Boolean,
    ) {
        val jsLimit = mapState.optInt("speedLimitKmh", 0).takeIf { it > 0 }
        if (lat != null && lng != null && lat.isFinite() && lng.isFinite()) {
            NativeSpeedLimitFetcher.maybeFetch(lat, lng, navigating, jsLimit)
        }
        val resolved = jsLimit ?: NativeSpeedLimitFetcher.currentLimit()
        resolved?.let { mapState.put("speedLimitKmh", it) }
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
}
