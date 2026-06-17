package com.lexuuw.vroom.app.auto

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

object VroomCarManager {
    private const val PREFS = "vroom_auto_profile"
    private const val KEY_MARKER_STYLE = "marker_style"
    private const val KEY_AVATAR_URL = "avatar_url"

    private var currentScreen: VroomCarScreen? = null
    private var bridgeModule: VroomBridgeModule? = null
    private var latestPayloadJson: String = ""
    private var nativeNavigationPayloadJson: String? = null
    private var nativeRoutePreviewPayloadJson: String? = null
    private var lastJsAutoPoseAt = 0L
    private var lastNativeEmitAt = 0L
    private var lastNativeRoadAt = 0L
    private var appContext: Context? = null

    fun setScreen(screen: VroomCarScreen) {
        currentScreen = screen
        Log.d("VroomCarManager", "Screen registered")
    }

    fun setAppContext(context: Context) {
        appContext = context.applicationContext
    }

    fun clearScreen() {
        currentScreen = null
        Log.d("VroomCarManager", "Screen cleared")
    }

    fun setBridge(module: VroomBridgeModule) {
        bridgeModule = module
    }

    fun sendDataToCar(jsonPayload: String) {
        rememberJsPoseFreshness(jsonPayload)
        rememberProfile(jsonPayload)
        val payload = mergeNativeNavigation(mergeNativeRoutePreview(jsonPayload))
        latestPayloadJson = payload
        if (currentScreen != null) {
            currentScreen?.updateData(payload)
        } else {
            Log.w("VroomCarManager", "No active screen to receive data")
        }
    }

    fun latestPayload(): VroomPayload? = VroomPayloadParser.parse(latestPayloadJson)

    fun hasFreshJsAutoPose(): Boolean =
        System.currentTimeMillis() - lastJsAutoPoseAt < 1_400L

    fun updateNativePose(
        lat: Double,
        lng: Double,
        speedMs: Double,
        heading: Double,
        accuracyMeters: Float
    ) {
        val now = System.currentTimeMillis()
        if (now - lastJsAutoPoseAt < 1_400L) return
        if (now - lastNativeEmitAt < 180L) return
        lastNativeEmitAt = now

        val base = runCatching {
            if (latestPayloadJson.isBlank()) JSONObject() else JSONObject(latestPayloadJson)
        }.getOrDefault(JSONObject())
        base.put("userLocation", JSONObject().apply {
            put("latitude", lat)
            put("longitude", lng)
            put("accuracy", accuracyMeters.toDouble())
        })
        val cleanSpeed = if (speedMs.isFinite()) speedMs.coerceIn(0.0, 50.0) else 0.0
        val cleanHeading = if (heading.isFinite() && heading >= 0.0) (heading % 360.0 + 360.0) % 360.0 else 0.0
        base.put("speed", cleanSpeed)
        base.put("heading", cleanHeading)
        if (!base.has("isNavigating")) base.put("isNavigating", false)
        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        mapState.put("isDriving", true)
        mapState.put("speedKmh", cleanSpeed * 3.6)
        mapState.put("autoPoseActive", false)
        mapState.put("nativeAutoPose", true)
        NativeRoadMatcher.latestRoadJson()?.let { road ->
            mapState.put("route", JSONArray(road.toString()))
            mapState.put("autoArcWindow", JSONObject().apply {
                put("points", JSONArray(road.toString()))
                put("baseArcM", 0.0)
                put("totalM", 0.0)
            })
            mapState.put("autoRoadBlend", 1.0)
            mapState.put("autoPathMode", "onRoad")
            mapState.put("nativeRoadMatch", true)
            base.put("route", JSONArray(road.toString()))
        }
        val profile = cachedProfile()
        if (!mapState.has("locationMarkerStyle")) mapState.put("locationMarkerStyle", profile.first)
        if (!mapState.has("currentUserAvatarUrl")) mapState.put("currentUserAvatarUrl", profile.second)
        base.put("mapState", mapState)
        if (!base.has("users")) base.put("users", org.json.JSONArray())
        if (!base.has("warnings")) base.put("warnings", org.json.JSONArray())

        val payload = mergeNativeNavigation(mergeNativeRoutePreview(base.toString()))
        latestPayloadJson = payload
        currentScreen?.updateData(payload)
    }

    fun updateNativeRoadGeometry(points: JSONArray) {
        val now = System.currentTimeMillis()
        if (hasFreshJsAutoPose()) return
        if (nativeRoutePreviewPayloadJson != null) return
        if (points.length() < 2 || now - lastNativeRoadAt < 900L) return
        lastNativeRoadAt = now

        val base = runCatching {
            if (latestPayloadJson.isBlank()) JSONObject() else JSONObject(latestPayloadJson)
        }.getOrDefault(JSONObject())
        val mapState = base.optJSONObject("mapState") ?: JSONObject()
        val clonedPoints = JSONArray(points.toString())
        mapState.put("route", clonedPoints)
        mapState.put("autoArcWindow", JSONObject().apply {
            put("points", JSONArray(points.toString()))
            put("baseArcM", 0.0)
            put("totalM", 0.0)
        })
        mapState.put("autoRoadBlend", 1.0)
        mapState.put("autoPathMode", "onRoad")
        mapState.put("nativeRoadMatch", true)
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
        currentScreen?.updateData(latestPayloadJson)
    }

    fun setNativeNavigation(jsonPayload: String) {
        nativeNavigationPayloadJson = jsonPayload
        nativeRoutePreviewPayloadJson = null
        sendDataToCar(jsonPayload)
    }

    fun clearNativeNavigation() {
        nativeNavigationPayloadJson = null
        nativeRoutePreviewPayloadJson = null
    }

    fun setNativeRoutePreview(jsonPayload: String) {
        nativeRoutePreviewPayloadJson = jsonPayload
        sendDataToCar(jsonPayload)
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

    private fun rememberJsPoseFreshness(jsonPayload: String) {
        runCatching {
            val mapState = JSONObject(jsonPayload).optJSONObject("mapState") ?: return
            if (mapState.optBoolean("autoPoseActive", false)) {
                lastJsAutoPoseAt = System.currentTimeMillis()
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
        val context = appContext ?: return Pair("profile", "")
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Pair(
            prefs.getString(KEY_MARKER_STYLE, "profile") ?: "profile",
            prefs.getString(KEY_AVATAR_URL, "") ?: ""
        )
    }
}
