package __PACKAGE__.auto

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object VroomCarManager {
    private const val PREFS = "vroom_auto_profile"
    private const val KEY_MARKER_STYLE = "marker_style"
    private const val KEY_AVATAR_URL = "avatar_url"
    private const val AUTO_OSRM_BASE = "https://v-room.app/osrm"

    private var currentScreen: VroomCarScreen? = null
    private var bridgeModule: VroomBridgeModule? = null
    private var latestPayloadJson: String = ""
    private var nativeNavigationPayloadJson: String? = null
    private var nativeRoutePreviewPayloadJson: String? = null
    private var rerouteInFlight = false
    private var lastRerouteAt = 0L
    private var jsMirroredNativeNavigation = false
    private var appContext: Context? = null
    @Volatile private var nativeLat = Double.NaN
    @Volatile private var nativeLng = Double.NaN
    @Volatile private var nativeSpeedMs = 0.0
    @Volatile private var nativeHeading = 0.0
    @Volatile private var nativeAccuracyMeters = Float.NaN
    @Volatile private var lastColdPayloadAt = 0L

    fun setScreen(screen: VroomCarScreen) {
        currentScreen = screen
        latestPayloadJson.takeIf { it.isNotBlank() }?.let(screen::updateData)
        Log.d("VroomCarManager", "Ekran zarejestrowany")
    }

    fun setAppContext(context: Context) {
        appContext = context.applicationContext
    }

    fun clearScreen() {
        currentScreen = null
        Log.d("VroomCarManager", "Ekran wyczyszczony")
    }

    fun setBridge(module: VroomBridgeModule) {
        bridgeModule = module
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

    fun hasActiveRouteSurface(): Boolean =
        nativeNavigationPayloadJson != null || nativeRoutePreviewPayloadJson != null

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

    fun updateNativePose(
        lat: Double,
        lng: Double,
        speedMs: Double,
        heading: Double,
        accuracyMeters: Float
    ) {
        if (!validCoordinate(lat, lng)) return
        val now = System.currentTimeMillis()
        val cleanSpeed = if (speedMs.isFinite()) speedMs.coerceIn(0.0, 50.0) else 0.0
        val cleanHeading = if (heading.isFinite() && heading >= 0.0) (heading % 360.0 + 360.0) % 360.0 else nativeHeading
        nativeLat = lat
        nativeLng = lng
        nativeSpeedMs = cleanSpeed
        nativeHeading = cleanHeading
        nativeAccuracyMeters = accuracyMeters
        currentScreen?.updateNativeLocation(lat, lng, cleanSpeed, cleanHeading)

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
        nativeRoutePreviewPayloadJson = null
        jsMirroredNativeNavigation = false
        lastColdPayloadAt = 0L
        sendDataToCar(jsonPayload)
        jsMirroredNativeNavigation = false
    }

    fun clearNativeNavigation() {
        nativeNavigationPayloadJson = null
        nativeRoutePreviewPayloadJson = null
        jsMirroredNativeNavigation = false
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
        }
    }

    fun setNativeRoutePreview(jsonPayload: String) {
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
            val route = selected.optJSONArray("route") ?: JSONArray()
            mapState.put("selectedRouteIndex", index)
            mapState.put("route", JSONArray(route.toString()))
            root.put("route", JSONArray(route.toString()))
            root.optJSONObject("dto")?.apply {
                put("nextInstruction", selected.optString("instruction", "Jedz do celu"))
                put("maneuver", selected.optString("maneuver", "straight"))
                put("maneuverModifier", selected.optString("maneuverModifier", ""))
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
        val navigating = runCatching {
            val root = JSONObject(preview)
            root.put("isNavigating", true)
            root.optJSONObject("dto")?.put("isNavigating", true)
            val mapState = root.optJSONObject("mapState") ?: JSONObject()
            mapState.put("uiMode", "NAVIGATING")
            mapState.put("routePreview", false)
            mapState.put("isDriving", true)
            root.put("mapState", mapState)
            root.toString()
        }.getOrDefault(preview)
        nativeRoutePreviewPayloadJson = null
        setNativeNavigation(navigating)
        appContext?.let { AutoNavStore.setNavigating(it, true) }
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

    fun requestNativeReroute(fromLat: Double, fromLng: Double, headingDeg: Double? = null) {
        val navPayload = nativeNavigationPayloadJson ?: return
        if (!fromLat.isFinite() || !fromLng.isFinite()) return
        val now = System.currentTimeMillis()
        if (rerouteInFlight || now - lastRerouteAt < 4_000L) return
        val destination = runCatching { JSONObject(navPayload).optJSONObject("destination") }.getOrNull() ?: return
        val toLat = destination.optDouble("latitude", destination.optDouble("lat", Double.NaN))
        val toLng = destination.optDouble("longitude", destination.optDouble("lng", Double.NaN))
        val toName = destination.optString("name", "Cel")
        if (!toLat.isFinite() || !toLng.isFinite()) return
        val resolvedHeading = headingDeg?.takeIf { it.isFinite() }
            ?: runCatching { JSONObject(navPayload).optDouble("heading", Double.NaN) }.getOrNull()?.takeIf { it.isFinite() }
            ?: AutoLocationTracker.lastKnownPose()?.heading
        rerouteInFlight = true
        lastRerouteAt = now
        Thread {
            val nextPayload = runCatching {
                val bearings = resolvedHeading?.let {
                    val bearing = (Math.round((((it % 360.0) + 360.0) % 360.0) / 45.0) * 45).toInt() % 360
                    "&bearings=$bearing,60;"
                }.orEmpty()
                val url = "$AUTO_OSRM_BASE/route/v1/driving/$fromLng,$fromLat;$toLng,$toLat" +
                    "?alternatives=false&geometries=geojson&steps=true&overview=full$bearings"
                val body = requestJson(url, 3_800, 3_800)
                buildReroutedPayload(navPayload, body, fromLat, fromLng, toLat, toLng, toName)
            }.getOrNull()
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                rerouteInFlight = false
                if (nextPayload != null) {
                    nativeNavigationPayloadJson = nextPayload
                    sendDataToCar(nextPayload)
                }
            }
        }.start()
    }

    private fun mergeNativeNavigation(jsonPayload: String): String {
        val nativePayload = nativeNavigationPayloadJson ?: return jsonPayload
        return runCatching {
            val base = JSONObject(jsonPayload)
            if (base.optBoolean("isNavigating", false)) return@runCatching jsonPayload
            val native = JSONObject(nativePayload)
            base.put("isNavigating", true)
            base.put("dto", native.optJSONObject("dto"))
            base.put("destination", native.optJSONObject("destination"))
            base.put("route", native.optJSONArray("route"))
            val baseMap = base.optJSONObject("mapState") ?: JSONObject()
            val nativeMap = native.optJSONObject("mapState")
            if (nativeMap != null) {
                baseMap.put("route", nativeMap.optJSONArray("route"))
                baseMap.put("destinationLat", nativeMap.optDouble("destinationLat"))
                baseMap.put("destinationLng", nativeMap.optDouble("destinationLng"))
                baseMap.put("routePreview", false)
                baseMap.put("nativeRoadMatch", false)
                baseMap.put("isDriving", true)
            }
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
            val baseMap = base.optJSONObject("mapState") ?: JSONObject()
            val previewMap = preview.optJSONObject("mapState")
            if (previewMap != null) {
                baseMap.put("route", previewMap.optJSONArray("route"))
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
            val jsNavigating = JSONObject(jsonPayload).optBoolean("isNavigating", false)
            if (jsNavigating) {
                if (nativeNavigationPayloadJson != null) jsMirroredNativeNavigation = true
            } else if (nativeNavigationPayloadJson != null && jsMirroredNativeNavigation) {
                clearNativeNavigation()
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
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
        val maneuver = step?.optJSONObject("maneuver")
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
        base.put("route", JSONArray(points.toString()))
        base.put("dto", JSONObject().apply {
            put("isNavigating", true)
            put("nextInstruction", instruction)
            put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
            put("maneuverModifier", maneuver?.optString("modifier", "") ?: "")
            put("destinationName", toName)
            put("remainingDistanceMeters", distance)
            put("remainingDurationSec", duration)
            put("turnDistanceMeters", turnDistance)
        })
        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        mapState.put("route", JSONArray(points.toString()))
        mapState.put("destinationLat", toLat)
        mapState.put("destinationLng", toLng)
        mapState.put("routePreview", false)
        mapState.put("isDriving", true)
        mapState.put("nativeRoadMatch", false)
        base.put("mapState", mapState)
        return base.toString()
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
}
