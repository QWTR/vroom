package com.lexuuw.vroom.app.auto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object AutoNavStore {
  private const val API_URL = "https://v-room.app"
  private const val OSRM_URL = "https://v-room.app/osrm"
  private const val REMOTE_REFRESH_INTERVAL_MS = 7_000L
  private const val PREFS = "vroom_auto_nav"
  private const val KEY_IS_NAVIGATING = "is_navigating"
  private const val KEY_LAT = "lat"
  private const val KEY_LNG = "lng"
  private const val KEY_SPEED = "speed"
  private const val KEY_HEADING = "heading"
  private const val KEY_ROUTE = "route"
  private const val KEY_DEST_LAT = "dest_lat"
  private const val KEY_DEST_LNG = "dest_lng"
  private const val KEY_DEST_NAME = "dest_name"
  private const val KEY_STEP_TEXT = "step_text"
  private const val KEY_STEP_DISTANCE = "step_distance"
  private const val KEY_STEP_ETA = "step_eta"
  private const val KEY_CAR_SAFE_DTO = "car_safe_dto"
  private const val KEY_STOP_REQUESTED = "stop_requested"
  private const val KEY_REPORT_REQUESTED = "report_requested"
  private const val KEY_USERS = "users"
  private const val KEY_WARNINGS = "warnings"
  private const val KEY_MAP_STATE = "map_state"
  private const val KEY_AUTH_TOKEN = "auth_token"
  private const val KEY_LAST_REMOTE_REFRESH = "last_remote_refresh"
  private const val KEY_LAST_PROFILE_REFRESH = "last_profile_refresh"
  private const val KEY_PROFILE_NAME = "profile_name"
  private const val KEY_PROFILE_AVATAR = "profile_avatar"
  private const val KEY_SEARCH_HISTORY = "search_history"
  private const val KEY_SHOW_USERS = "show_users"
  private const val KEY_SHOW_WARNINGS = "show_warnings"
  private const val KEY_SHOW_CAMERAS = "show_cameras"
  private const val KEY_SHOW_FUEL = "show_fuel"
  private const val KEY_VOICE_ALERTS = "voice_alerts"
  private const val KEY_SPEED_ALERTS = "speed_alerts"
  private const val KEY_LAST_TRACK_LAT = "last_track_lat"
  private const val KEY_LAST_TRACK_LNG = "last_track_lng"
  private const val KEY_LAST_TRACK_TS = "last_track_ts"
  private const val KEY_PENDING_DRIVE_KM = "pending_drive_km"
  private const val KEY_LAST_LIVE_PUSH = "last_live_push"
  private const val CAMERAS_RADIUS_KM = 3
  private const val PROFILE_REFRESH_INTERVAL_MS = 60_000L
  private const val DRIVE_SPEED_THRESHOLD_KMH = 8.0
  private const val DRIVE_UPLOAD_STEP_KM = 0.2
  private const val DRIVE_SEGMENT_MAX_KM = 0.35
  private const val DRIVE_SEGMENT_MAX_KMH = 220.0
  private const val DRIVE_SEGMENT_MAX_DT_MS = 20_000L
  private const val DRIVE_SEGMENT_MIN_DT_MS = 500L
  private const val DRIVE_PENDING_HARD_CAP_KM = 10.0
  private const val DRIVE_UPLOAD_MAX_CHUNK_KM = 1.5
  private const val LIVE_PUSH_INTERVAL_MS = 4_000L
  private const val ROUTE_ORIGIN_MAX_AGE_MS = 15_000L
  private const val SEARCH_ORIGIN_MAX_AGE_MS = 60_000L
  @Volatile private var isRemoteRefreshInFlight = false

  // IN-MEMORY HIGH FREQUENCY STATE
  @Volatile var liveLat: Double = Double.NaN
  @Volatile var liveLng: Double = Double.NaN
  @Volatile var liveSpeed: Double = Double.NaN
  @Volatile var liveHeading: Double = Double.NaN
  @Volatile private var liveLocationAtMs: Long = 0L

  // IN-MEMORY CACHE FOR SNAPSHOT
  @Volatile var memDtoRaw: String? = null
  @Volatile var memMapRaw: String? = null
  @Volatile var memUsersRaw: String? = null
  @Volatile var memWarningsRaw: String? = null
  @Volatile var memRouteRaw: String? = null
  @Volatile var memIsNavigating: Boolean = false
  
  @Volatile var memDestLat: Double = Double.NaN
  @Volatile var memDestLng: Double = Double.NaN
  @Volatile var memDestName: String? = null
  @Volatile var memStepText: String? = null
  @Volatile var memStepDistance: String? = null
  @Volatile var memStepEta: String? = null
  @Volatile var memAuthToken: String? = null

  @Volatile private var isMemLoaded = false

    
    // PUSH bezpośrednio do subskrybenta (np. pętli renderowania w Kotlinie):
  private fun ensureMem(context: Context) {
    if (isMemLoaded) return
    synchronized(this) {
      if (isMemLoaded) return
      val p = prefs(context)
      liveLat = p.getFloat(KEY_LAT, 0f).toDouble()
      liveLng = p.getFloat(KEY_LNG, 0f).toDouble()
      liveSpeed = p.getFloat(KEY_SPEED, 0f).toDouble()
      liveHeading = p.getFloat(KEY_HEADING, 0f).toDouble()
      memDtoRaw = p.getString(KEY_CAR_SAFE_DTO, null)
      memMapRaw = p.getString(KEY_MAP_STATE, null)
      memUsersRaw = p.getString(KEY_USERS, "[]")
      memWarningsRaw = p.getString(KEY_WARNINGS, "[]")
      memRouteRaw = p.getString(KEY_ROUTE, "[]")
      memIsNavigating = p.getBoolean(KEY_IS_NAVIGATING, false)
      memDestLat = p.getFloat(KEY_DEST_LAT, Float.NaN).toDouble()
      memDestLng = p.getFloat(KEY_DEST_LNG, Float.NaN).toDouble()
      memDestName = p.getString(KEY_DEST_NAME, null)
      memStepText = p.getString(KEY_STEP_TEXT, null)
      memStepDistance = p.getString(KEY_STEP_DISTANCE, null)
      memStepEta = p.getString(KEY_STEP_ETA, null)
      memAuthToken = p.getString(KEY_AUTH_TOKEN, null)
      isMemLoaded = true
    }
  }

  private var cachedSnapshot: AutoNavSnapshot? = null
  var cachedMapState: JSONObject? = null
  private var cacheKeyDto: String? = null
  private var cacheKeyMap: String? = null
  private var cacheKeyUsers: String? = null
  private var cacheKeyWarnings: String? = null
  private var cacheKeyRoute: String? = null

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setNavigating(context: Context, value: Boolean) { 
    ensureMem(context)
    memIsNavigating = value
    prefs(context).edit().putBoolean(KEY_IS_NAVIGATING, value).apply() 
  }
  
  private var lastLocationSaveTime = 0L
  fun saveLocation(context: Context, lat: Double, lng: Double) { 
    liveLat = lat
    liveLng = lng
    liveLocationAtMs = System.currentTimeMillis()
    
    val now = System.currentTimeMillis()
    if (now - lastLocationSaveTime > 1000) {
      lastLocationSaveTime = now
      prefs(context).edit().putFloat(KEY_LAT, lat.toFloat()).putFloat(KEY_LNG, lng.toFloat()).apply() 
    }
  }
  
  private var lastSpeedHeadingSaveTime = 0L
  fun saveSpeedHeading(context: Context, speed: Double, heading: Double) { 
    liveSpeed = speed
    liveHeading = heading
    
    val now = System.currentTimeMillis()
    if (now - lastSpeedHeadingSaveTime > 1000) {
      lastSpeedHeadingSaveTime = now
      prefs(context).edit().putFloat(KEY_SPEED, speed.toFloat()).putFloat(KEY_HEADING, heading.toFloat()).apply() 
    }
  }

  private fun isValidOrigin(lat: Double, lng: Double): Boolean =
    lat.isFinite() && lng.isFinite() && (lat != 0.0 || lng != 0.0)

  private fun currentOrigin(context: Context, maxStaleMs: Long = SEARCH_ORIGIN_MAX_AGE_MS): Pair<Double, Double>? {
    ensureMem(context)
    val pose = AutoLocationTracker.lastKnownPose(maxStaleMs)
    if (pose != null && isValidOrigin(pose.lat, pose.lng)) return pose.lat to pose.lng
    VroomCarManager.currentNativeOrigin(maxStaleMs)?.let { origin ->
      if (isValidOrigin(origin.first, origin.second)) return origin
    }
    val liveAgeMs = if (liveLocationAtMs > 0L) System.currentTimeMillis() - liveLocationAtMs else Long.MAX_VALUE
    if (liveAgeMs <= maxStaleMs && isValidOrigin(liveLat, liveLng)) return liveLat to liveLng
    val p = prefs(context)
    val prefLat = p.getFloat(KEY_LAT, 0f).toDouble()
    val prefLng = p.getFloat(KEY_LNG, 0f).toDouble()
    val prefAgeMs = if (lastLocationSaveTime > 0L) System.currentTimeMillis() - lastLocationSaveTime else Long.MAX_VALUE
    if (prefAgeMs <= maxStaleMs && isValidOrigin(prefLat, prefLng)) return prefLat to prefLng
    return null
  }

  private fun routeOrigin(context: Context): Pair<Double, Double>? =
    currentOrigin(context, ROUTE_ORIGIN_MAX_AGE_MS)

  private fun currentSpeedHeading(context: Context): Pair<Double, Double> {
    ensureMem(context)
    val pose = AutoLocationTracker.lastKnownPose()
    val speed = pose?.speedMs?.takeIf { it.isFinite() }
      ?: liveSpeed.takeIf { it.isFinite() }
      ?: prefs(context).getFloat(KEY_SPEED, 0f).toDouble()
    val heading = pose?.heading?.takeIf { it.isFinite() }
      ?: liveHeading.takeIf { it.isFinite() }
      ?: prefs(context).getFloat(KEY_HEADING, 0f).toDouble()
    return speed to heading
  }

  fun saveRoute(context: Context, routeJson: String) { 
    ensureMem(context)
    memRouteRaw = routeJson
    prefs(context).edit().putString(KEY_ROUTE, routeJson).apply() 
  }
  fun saveDestination(context: Context, lat: Double, lng: Double, name: String) { 
    ensureMem(context)
    memDestLat = lat
    memDestLng = lng
    memDestName = name
    prefs(context).edit().putFloat(KEY_DEST_LAT, lat.toFloat()).putFloat(KEY_DEST_LNG, lng.toFloat()).putString(KEY_DEST_NAME, name).apply() 
  }
  fun saveStep(context: Context, text: String, distance: String, eta: String) { 
    ensureMem(context)
    memStepText = text
    memStepDistance = distance
    memStepEta = eta
    prefs(context).edit().putString(KEY_STEP_TEXT, text).putString(KEY_STEP_DISTANCE, distance).putString(KEY_STEP_ETA, eta).apply() 
  }
  fun saveCarSafeState(context: Context, dtoJson: String) { 
    ensureMem(context)
    memDtoRaw = dtoJson
    prefs(context).edit().putString(KEY_CAR_SAFE_DTO, dtoJson).apply() 
  }
  fun saveUsers(context: Context, usersJson: String) { 
    ensureMem(context)
    memUsersRaw = usersJson
    prefs(context).edit().putString(KEY_USERS, usersJson).apply() 
  }
  fun saveWarnings(context: Context, warningsJson: String) { 
    ensureMem(context)
    memWarningsRaw = warningsJson
    prefs(context).edit().putString(KEY_WARNINGS, warningsJson).apply() 
  }
  fun saveMapState(context: Context, mapStateJson: String) { 
    ensureMem(context)
    memMapRaw = mapStateJson
    prefs(context).edit().putString(KEY_MAP_STATE, mapStateJson).apply() 
  }
  fun saveAuthToken(context: Context, token: String) { 
    ensureMem(context)
    memAuthToken = token
    prefs(context).edit().putString(KEY_AUTH_TOKEN, token).apply() 
  }
  fun requestStop(context: Context) { prefs(context).edit().putBoolean(KEY_STOP_REQUESTED, true).apply() }
  fun stopNavigation(context: Context) {
    requestStop(context)
    clearNavigationState(context)
  }
  fun requestReport(context: Context, type: String = "menu") { prefs(context).edit().putString(KEY_REPORT_REQUESTED, type).apply() }
  fun setMapOption(context: Context, key: String, enabled: Boolean) { prefs(context).edit().putBoolean(key, enabled).apply() }
  fun getMapOption(context: Context, key: String, default: Boolean): Boolean = prefs(context).getBoolean(key, default)
  fun showUsersLayer(context: Context): Boolean = getMapOption(context, KEY_SHOW_USERS, true)
  fun showWarningsLayer(context: Context): Boolean = getMapOption(context, KEY_SHOW_WARNINGS, true)
  fun showSpeedCamerasLayer(context: Context): Boolean = getMapOption(context, KEY_SHOW_CAMERAS, true)
  fun showFuelLayer(context: Context): Boolean = getMapOption(context, KEY_SHOW_FUEL, true)
  fun recentSearches(context: Context, limit: Int = 4): List<AutoSearchPlace> {
    val raw = prefs(context).getString(KEY_SEARCH_HISTORY, "[]") ?: "[]"
    val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    return buildList {
      for (i in 0 until arr.length()) {
        val item = arr.optJSONObject(i) ?: continue
        val lat = item.optDouble("lat", Double.NaN)
        val lng = item.optDouble("lng", Double.NaN)
        if (!lat.isFinite() || !lng.isFinite()) continue
        add(
          AutoSearchPlace(
            id = item.optString("id", "recent-$i"),
            name = item.optString("name", "Cel"),
            address = item.optString("address", ""),
            lat = lat,
            lng = lng,
          ),
        )
        if (size >= limit) break
      }
    }
  }
  fun consumeStopRequest(context: Context): Boolean {
    val p = prefs(context); val requested = p.getBoolean(KEY_STOP_REQUESTED, false)
    if (requested) p.edit().putBoolean(KEY_STOP_REQUESTED, false).apply()
    return requested
  }
  fun consumeReportRequest(context: Context): String {
    val p = prefs(context)
    val requested = p.getString(KEY_REPORT_REQUESTED, "") ?: ""
    if (requested.isNotBlank()) p.edit().remove(KEY_REPORT_REQUESTED).apply()
    return requested
  }

  fun snapshot(context: Context): AutoNavSnapshot {
    ensureMem(context)

    val currentLat = if (liveLat.isFinite()) liveLat else 0.0
    val currentLng = if (liveLng.isFinite()) liveLng else 0.0
    val heading = if (liveHeading.isFinite()) liveHeading else 0.0
    val speedMs = if (liveSpeed.isFinite()) liveSpeed else 0.0

    val dtoRaw = memDtoRaw
    val mapRaw = memMapRaw
    val usersRaw = memUsersRaw ?: "[]"
    val warningsRaw = memWarningsRaw ?: "[]"
    val routeRaw = memRouteRaw ?: "[]"

    val dto = dtoRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val mapState = mapRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    cachedMapState = mapState
    val speedKmh = (mapState?.optDouble("speedKmh", Double.NaN) ?: Double.NaN)
      .takeIf { it.isFinite() }
      ?: (speedMs * 3.6)

    if (cachedSnapshot != null &&
        cacheKeyDto == dtoRaw &&
        cacheKeyMap == mapRaw &&
        cacheKeyUsers == usersRaw &&
        cacheKeyWarnings == warningsRaw &&
        cacheKeyRoute == routeRaw) {
      return cachedSnapshot!!.copy(
        currentLat = currentLat,
        currentLng = currentLng,
        heading = heading,
        speedKmh = speedKmh
      )
    }

    cacheKeyDto = dtoRaw
    cacheKeyMap = mapRaw
    cacheKeyUsers = usersRaw
    cacheKeyWarnings = warningsRaw
    cacheKeyRoute = routeRaw

    val route = parsePoints(mapState?.optJSONArray("route")).ifEmpty {
      parsePoints(routeRaw)
    }
    val builderRoute = parsePoints(mapState?.optJSONArray("builderRoute"))
    val builderPins = parseMarkers(mapState?.optJSONArray("builderPins"), "pin")
    val speedCameras = parseMarkers(mapState?.optJSONArray("speedCameras"), "camera")
    val fuelStations = parseMarkers(mapState?.optJSONArray("fuelStations"), "fuel")
    val users = parseMarkers(usersRaw, "user")
    val warnings = parseMarkers(warningsRaw, "warning")
    val start = mapState?.optJSONObject("start")

    val fallbackInstruction = memStepText ?: ""
    val fallbackDistance = memStepDistance ?: ""
    val fallbackEta = memStepEta ?: ""
    val fallbackDestName = memDestName ?: "Cel"

    val rawNavigating = dto?.optBoolean("isNavigating", memIsNavigating) ?: memIsNavigating
    val hasNavSignal =
      route.size > 1 ||
        (memDestLat != 0.0 && !memDestLat.isNaN() || memDestLng != 0.0 && !memDestLng.isNaN()) ||
        ((dto?.optInt("remainingDistanceMeters", 0) ?: 0) > 1)
    val effectiveNavigating = rawNavigating && hasNavSignal

    cachedSnapshot = AutoNavSnapshot(
      isNavigating = effectiveNavigating,
      instruction = dto?.optString("nextInstruction", fallbackInstruction) ?: fallbackInstruction,
      maneuver = dto?.optString("maneuver", "navigation") ?: "navigation",
      maneuverModifier = dto?.optString("maneuverModifier", "") ?: "",
      remainingDistanceMeters = if (effectiveNavigating && dto?.has("remainingDistanceMeters") == true) dto.optInt("remainingDistanceMeters") else null,
      remainingDurationSec = if (effectiveNavigating && dto?.has("remainingDurationSec") == true) dto.optInt("remainingDurationSec") else null,
      turnDistanceMeters = if (effectiveNavigating && dto?.has("turnDistanceMeters") == true) dto.optInt("turnDistanceMeters") else null,
      destinationName = dto?.optString("destinationName", fallbackDestName) ?: fallbackDestName,
      mapStyle = mapState?.optString("mapStyle", "") ?: "",
      isDriving = mapState?.optBoolean("isDriving", true) ?: true,
      isBuilding = mapState?.optBoolean("isBuilding", false) ?: false,
      arrived = mapState?.optBoolean("arrived", false) ?: false,
      offRoute = mapState?.optBoolean("offRoute", false) ?: false,
      speedLimitKmh = mapState?.nullableInt("speedLimitKmh"),
      useArrowMarker = (mapState?.optString("locationMarkerStyle", "profile") ?: "profile") == "arrow",
      showUsers = getMapOption(context, KEY_SHOW_USERS, true),
      showWarnings = getMapOption(context, KEY_SHOW_WARNINGS, true),
      showSpeedCameras = getMapOption(context, KEY_SHOW_CAMERAS, true),
      showFuelStations = getMapOption(context, KEY_SHOW_FUEL, true),
      voiceAlerts = getMapOption(context, KEY_VOICE_ALERTS, true),
      speedAlerts = getMapOption(context, KEY_SPEED_ALERTS, true),
      currentLat = currentLat,
      currentLng = currentLng,
      startLat = start?.optDouble("lat", 0.0) ?: 0.0,
      startLng = start?.optDouble("lng", 0.0) ?: 0.0,
      startName = start?.optString("name", "Start") ?: "Start",
      destinationLat = memDestLat.takeIf { it.isFinite() } ?: 0.0,
      destinationLng = memDestLng.takeIf { it.isFinite() } ?: 0.0,
      speedKmh = speedKmh,
      heading = heading,
      currentUserName = memAuthToken ?: "Ty", // just reuse or default
      currentUserAvatarUrl = "", // we don't have avatar in mem variables yet, keep default
      fallbackDistance = fallbackDistance,
      fallbackEta = fallbackEta,
      route = route,
      builderRoute = builderRoute,
      builderPins = builderPins,
      users = users,
      warnings = warnings,
      speedCameras = speedCameras,
      fuelStations = fuelStations,
    )

    return cachedSnapshot!!
  }

  fun onNativeLocationUpdate(
    context: Context,
    lat: Double,
    lng: Double,
    speedMs: Double,
    headingDeg: Double,
  ) {
    val now = System.currentTimeMillis()
    // If JS is actively sending smooth snapped location, ignore raw GPS for the map pose!
    // This fixes massive jitter when raw 1Hz GPS fights with JS 60fps snapped location.
    run {
      liveLat = lat
      liveLng = lng
      liveSpeed = speedMs
      liveHeading = headingDeg
    }

    val p = prefs(context)
    val prevLat = p.getFloat(KEY_LAST_TRACK_LAT, Float.NaN).toDouble()
    val prevLng = p.getFloat(KEY_LAST_TRACK_LNG, Float.NaN).toDouble()
    val prevTs = p.getLong(KEY_LAST_TRACK_TS, 0L)
    var pendingKm = p.getFloat(KEY_PENDING_DRIVE_KM, 0f).toDouble().coerceAtLeast(0.0)
      .coerceAtMost(DRIVE_PENDING_HARD_CAP_KM)
    val nowTs = System.currentTimeMillis()

    if (
      (prevLat != 0.0 || prevLng != 0.0)
      && prevLat.isFinite()
      && prevLng.isFinite()
      && prevTs > 0L
    ) {
      val segmentKm = haversineKm(prevLat, prevLng, lat, lng)
      val dtMs = nowTs - prevTs
      val segKmh = if (dtMs > 0) segmentKm * 3600_000.0 / dtMs.toDouble() else Double.POSITIVE_INFINITY
      if (
        segmentKm.isFinite()
        && segmentKm in 0.0..DRIVE_SEGMENT_MAX_KM
        && dtMs in DRIVE_SEGMENT_MIN_DT_MS..DRIVE_SEGMENT_MAX_DT_MS
        && segKmh.isFinite()
        && segKmh <= DRIVE_SEGMENT_MAX_KMH
      ) {
        pendingKm += segmentKm
      }
    }

    val speedKmh = speedMs.coerceAtLeast(0.0) * 3.6
    mergeNativeMapDrivingState(context, speedKmh >= DRIVE_SPEED_THRESHOLD_KMH, speedKmh)
    var oldLat = prevLat.toFloat()
    var oldLng = prevLng.toFloat()
    
    if (oldLat != lat.toFloat() || oldLng != lng.toFloat() || pendingKm > 0) {
      p.edit().putFloat(KEY_LAST_TRACK_LAT, lat.toFloat())
        .putFloat(KEY_LAST_TRACK_LNG, lng.toFloat())
        .putLong(KEY_LAST_TRACK_TS, nowTs)
        .putFloat(KEY_PENDING_DRIVE_KM, pendingKm.toFloat())
        .apply()
    }

    saveLocation(context, lat, lng)
    saveSpeedHeading(context, speedMs, headingDeg)

    val token = p.getString(KEY_AUTH_TOKEN, "") ?: ""
    val lastLivePush = p.getLong(KEY_LAST_LIVE_PUSH, 0L)
    if (token.isNotBlank() && now - lastLivePush >= LIVE_PUSH_INTERVAL_MS) {
      val locationPayload = JSONObject()
        .put("lat", lat)
        .put("lng", lng)
        .put("shareLocation", true)
      val (liveCode, _) = requestJson("POST", "/api/live/location", token, locationPayload.toString())
      if (liveCode in 200..299) {
        p.edit().putLong(KEY_LAST_LIVE_PUSH, now).apply()
      }
    }

    if (token.isNotBlank() && pendingKm >= DRIVE_UPLOAD_STEP_KM) {
      val uploadKm = pendingKm.coerceAtMost(DRIVE_UPLOAD_MAX_CHUNK_KM)
      val payload = JSONObject().put("km", uploadKm)
      val (code, _) = requestJson("POST", "/api/live/distance", token, payload.toString())
      if (code in 200..299) {
        val remainingKm = (pendingKm - uploadKm).coerceAtLeast(0.0)
        p.edit().putFloat(KEY_PENDING_DRIVE_KM, remainingKm.toFloat()).apply()
      }
    }
  }

  fun refreshFromBackendIfNeeded(context: Context) {
    val p = prefs(context)
    val token = p.getString(KEY_AUTH_TOKEN, "") ?: ""
    if (token.isBlank()) return
    val now = System.currentTimeMillis()
    val last = p.getLong(KEY_LAST_REMOTE_REFRESH, 0L)
    if (now - last < REMOTE_REFRESH_INTERVAL_MS) return
    if (isRemoteRefreshInFlight) return
    isRemoteRefreshInFlight = true

    Thread {
      try {
        val (code, body) = requestJson("GET", "/api/navigation/session/active", token)
        if (code == 200 && body.isNotBlank()) {
          val json = JSONObject(body)
          mergeRemoteSession(context, json)
        } else if (code == 404) {
          clearNavigationState(context)
        }
        syncLiveLayers(context, token)
      } catch (_: Throwable) {
      } finally {
        prefs(context).edit().putLong(KEY_LAST_REMOTE_REFRESH, System.currentTimeMillis()).apply()
        isRemoteRefreshInFlight = false
      }
    }.start()
  }

  fun submitReportFromCurrentLocation(context: Context, type: String): Boolean {
    val p = prefs(context)
    val token = p.getString(KEY_AUTH_TOKEN, "") ?: ""
    if (token.isBlank()) return false
    val (lat, lng) = currentOrigin(context) ?: return false
    val payload = JSONObject().apply {
      put("type", type)
      put("lat", lat)
      put("lng", lng)
      put("message", "")
    }
    val (code, _) = requestJson("POST", "/api/live/warnings", token, payload.toString())
    return code in 200..299
  }

  fun confirmWarning(context: Context, warningId: String): Boolean {
    val token = prefs(context).getString(KEY_AUTH_TOKEN, "") ?: ""
    if (token.isBlank()) return false
    val id = warningId.toIntOrNull() ?: return false
    val (code, _) = requestJson("POST", "/api/live/warnings/$id/confirm", token)
    return code in 200..299
  }

  fun confirmSpeedCamera(context: Context, cameraId: String): Boolean {
    val token = prefs(context).getString(KEY_AUTH_TOKEN, "") ?: ""
    if (token.isBlank()) return false
    val id = cameraId.toIntOrNull() ?: return false
    val (code, _) = requestJson("POST", "/api/speed-cameras/$id/confirm", token)
    return code in 200..299
  }

  fun searchCategory(context: Context, category: String, limit: Int = 12): List<AutoSearchPlace> {
    val query = when (category.lowercase()) {
      "gas_station", "fuel", "paliwo" -> "stacja paliw"
      "parking" -> "parking"
      "coffee", "cafe", "kawa" -> "kawiarnia"
      "food", "restaurant", "jedzenie" -> "restauracja"
      else -> category
    }
    return searchPlaces(context, query, limit)
  }

  fun searchPlaces(context: Context, query: String, limit: Int = 12): List<AutoSearchPlace> {
    val cleaned = query.trim()
    if (cleaned.length < 2) return emptyList()
    val p = prefs(context)
    val token = p.getString(KEY_AUTH_TOKEN, "") ?: ""
    val origin = currentOrigin(context, SEARCH_ORIGIN_MAX_AGE_MS)
    val lat = origin?.first ?: 0.0
    val lng = origin?.second ?: 0.0
    if (token.isBlank()) return emptyList()
    val payload = JSONObject().apply {
      put("query", cleaned)
      put("limit", limit.coerceIn(1, 15))
      put("language", "pl")
      put("allowMapboxFallback", false)
      if ((lat != 0.0 || lng != 0.0) && lat.isFinite() && lng.isFinite()) {
        put("proximityLat", lat)
        put("proximityLng", lng)
      }
    }
    val (code, body) = requestJson("POST", "/api/osm/geocode", token, payload.toString())
    if (code !in 200..299 || body.isBlank()) return emptyList()
    val json = runCatching { JSONObject(body) }.getOrNull() ?: return emptyList()
    val features = json.optJSONArray("features") ?: return emptyList()
    return parseSearchFeatures(features)
  }

  fun startNavigationToPlace(context: Context, place: AutoSearchPlace): Boolean =
    startRoutePreviewToPlace(context, place)

  fun startRoutePreviewToPlace(context: Context, place: AutoSearchPlace): Boolean {
    val p = prefs(context)
    val token = p.getString(KEY_AUTH_TOKEN, "") ?: ""
    val (lat, lng) = routeOrigin(context) ?: return false
    if (!place.lat.isFinite() || !place.lng.isFinite()) return false
    val (fromSpeed, fromHeading) = currentSpeedHeading(context)

    val requestPayload = JSONObject().apply {
      put("coordinates", JSONArray().apply {
        put(JSONArray().apply { put(lng); put(lat) })
        put(JSONArray().apply { put(place.lng); put(place.lat) })
      })
      put("profile", "driving")
      put("alternatives", true)
      put("geometries", "geojson")
      put("steps", true)
      put("language", "pl")
      put("overview", "full")
      put("allowMapboxFallback", false)
    }
    val routeBody = if (token.isNotBlank()) {
      val (code, body) = requestJson(
        "POST",
        "/api/osm/directions",
        token,
        requestPayload.toString(),
        mapOf("x-vroom-client" to "automotive"),
      )
      if (code in 200..299 && body.isNotBlank()) {
        body
      } else {
        fetchDirectOsrmRoute(lat, lng, place.lat, place.lng, alternatives = true, headingDeg = fromHeading)
      }
    } else {
      fetchDirectOsrmRoute(lat, lng, place.lat, place.lng, alternatives = true, headingDeg = fromHeading)
    }

    val json = routeBody.takeIf { it.isNotBlank() }?.let { runCatching { JSONObject(it) }.getOrNull() }
    val routes = json?.optJSONArray("routes")
    val alternativeRoutes = JSONArray()
    if (routes != null && routes.length() > 0) {
      for (i in 0 until routes.length().coerceAtMost(3)) {
        val route = routes.optJSONObject(i) ?: continue
        val rawPoints = routePointsFromGeometry(route)
        if (rawPoints.length() < 2) continue
        val points = AutoRouteGeometry.anchorRoutePoints(rawPoints, lat, lng)
        if (points.length() < 2) continue
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
        val steps = leg?.optJSONArray("steps") ?: JSONArray()
        val maneuver = step?.optJSONObject("maneuver")
        val routeSteps = routeStepsJson(steps, points)
        alternativeRoutes.put(JSONObject().apply {
          put("index", alternativeRoutes.length())
          put("distanceM", route.optDouble("distance", 0.0).toInt().coerceAtLeast(1))
          put("durationS", route.optDouble("duration", 0.0).toInt().coerceAtLeast(0))
          put("route", points)
          put("routeSteps", routeSteps)
          put("instruction", polishInstruction(step, maneuver))
          put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
          put("maneuverModifier", maneuverModifierForStep(maneuver))
        })
      }
    }
    if (alternativeRoutes.length() == 0) {
      if (clearRoutePreviewState(context)) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          VroomCarManager.clearNativeRoutePreview()
        }
      }
      return false
    }

    val selected = alternativeRoutes.optJSONObject(0) ?: return false
    val points = selected.optJSONArray("route") ?: JSONArray()
    val routeSteps = selected.optJSONArray("routeSteps") ?: JSONArray()
    val instruction = selected.optString("instruction", "Jedz do celu")
    val distanceM = selected.optInt("distanceM", 1).coerceAtLeast(1)
    val durationS = selected.optInt("durationS", 0).coerceAtLeast(0)
    val maneuverType = selected.optString("maneuver", "straight")
    val maneuverModifier = selected.optString("maneuverModifier", "")
    val turnDistanceM = distanceM

    val dto = JSONObject().apply {
      put("isNavigating", false)
      put("currentStepIndex", 0)
      put("nextInstruction", instruction)
      put("maneuver", maneuverType)
      put("maneuverModifier", maneuverModifier)
      put("remainingDistanceMeters", distanceM)
      put("remainingDurationSec", durationS)
      put("turnDistanceMeters", turnDistanceM)
      put("destinationName", place.name)
    }
    val mapState = runCatching { JSONObject(p.getString(KEY_MAP_STATE, "{}") ?: "{}") }.getOrDefault(JSONObject())
    mapState.put("route", JSONArray(points.toString()))
    mapState.put("routeSteps", JSONArray(routeSteps.toString()))
    mapState.put("alternativeRoutes", alternativeRoutes)
    mapState.put("selectedRouteIndex", 0)
    mapState.put("isDriving", true)
    mapState.put("uiMode", "ROUTE_PREVIEW")
    mapState.put("routePreview", true)
    mapState.put("destinationLat", place.lat)
    mapState.put("destinationLng", place.lng)
    mapState.put("nativeRoadMatch", false)

    p.edit()
      .putBoolean(KEY_IS_NAVIGATING, false)
      .putString(KEY_CAR_SAFE_DTO, dto.toString())
      .putString(KEY_ROUTE, points.toString())
      .putString(KEY_STEP_TEXT, instruction)
      .putString(KEY_DEST_NAME, place.name)
      .putFloat(KEY_DEST_LAT, place.lat.toFloat())
      .putFloat(KEY_DEST_LNG, place.lng.toFloat())
      .putString(KEY_MAP_STATE, mapState.toString())
      .apply()
    saveRecentSearch(context, place)

    ensureMem(context)
    memIsNavigating = false
    memDtoRaw = dto.toString()
    memRouteRaw = points.toString()
    memMapRaw = mapState.toString()
    memDestLat = place.lat
    memDestLng = place.lng
    memDestName = place.name
    memStepText = instruction
    cachedSnapshot = null

    val previewPayload = buildNavigationPayload(
      fromLat = lat,
      fromLng = lng,
      fromSpeed = fromSpeed,
      fromHeading = fromHeading,
      place = place,
      points = points,
      routeSteps = routeSteps,
      instruction = instruction,
      maneuverType = maneuverType,
      maneuverModifier = maneuverModifier,
      distanceM = distanceM,
      durationS = durationS,
      turnDistanceM = turnDistanceM,
      mapState = mapState,
      dto = dto,
      isNavigating = false,
    )
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      VroomCarManager.setNativeRoutePreview(previewPayload)
    }
    return true
  }

  private fun routePointsFromGeometry(route: JSONObject): JSONArray {
    val geometryValue = route.opt("geometry")
    val geometry = when (geometryValue) {
      is JSONObject -> geometryValue.optJSONArray("coordinates")
      is JSONArray -> geometryValue
      is String -> return routePointsFromEncodedPolyline(geometryValue, 5).takeIf { it.length() >= 2 }
        ?: routePointsFromEncodedPolyline(geometryValue, 6)
      else -> null
    } ?: JSONArray()
    val points = JSONArray()
    for (i in 0 until geometry.length()) {
      val coord = geometry.optJSONArray(i) ?: continue
      val pointLng = coord.optDouble(0, Double.NaN)
      val pointLat = coord.optDouble(1, Double.NaN)
      if (!pointLat.isFinite() || !pointLng.isFinite()) continue
      points.put(JSONObject().apply {
        put("lat", pointLat)
        put("lng", pointLng)
      })
    }
    return points
  }

  private fun routePointsFromEncodedPolyline(encoded: String, precision: Int): JSONArray {
    val points = JSONArray()
    if (encoded.isBlank()) return points
    val factor = Math.pow(10.0, precision.toDouble())
    var index = 0
    var lat = 0
    var lng = 0
    while (index < encoded.length) {
      val latResult = decodePolylineValue(encoded, index) ?: return JSONArray()
      index = latResult.nextIndex
      lat += latResult.delta
      val lngResult = decodePolylineValue(encoded, index) ?: return JSONArray()
      index = lngResult.nextIndex
      lng += lngResult.delta
      val pointLat = lat / factor
      val pointLng = lng / factor
      if (pointLat.isFinite() && pointLng.isFinite() && pointLat in -90.0..90.0 && pointLng in -180.0..180.0) {
        points.put(JSONObject().apply {
          put("lat", pointLat)
          put("lng", pointLng)
        })
      }
    }
    return points
  }

  private data class PolylineValue(val delta: Int, val nextIndex: Int)

  private fun decodePolylineValue(encoded: String, startIndex: Int): PolylineValue? {
    var result = 0
    var shift = 0
    var index = startIndex
    var byteValue: Int
    do {
      if (index >= encoded.length) return null
      byteValue = encoded[index++].code - 63
      result = result or ((byteValue and 0x1f) shl shift)
      shift += 5
    } while (byteValue >= 0x20)
    val delta = if ((result and 1) != 0) (result shr 1).inv() else result shr 1
    return PolylineValue(delta, index)
  }

  private fun fetchDirectOsrmRoute(
    fromLat: Double,
    fromLng: Double,
    toLat: Double,
    toLng: Double,
    alternatives: Boolean = false,
    headingDeg: Double? = null,
  ): String {
    if (!fromLat.isFinite() || !fromLng.isFinite() || !toLat.isFinite() || !toLng.isFinite()) return ""
    val bearings = AutoRouteGeometry.bearingsParam(headingDeg, toleranceDeg = 90)
    val altParam = if (alternatives) "true" else "false"
    val url = "$OSRM_URL/route/v1/driving/${formatCoord(fromLng)},${formatCoord(fromLat)};${formatCoord(toLng)},${formatCoord(toLat)}" +
      "?alternatives=$altParam&geometries=geojson&steps=true&overview=full&continue_straight=true$bearings"
    val (code, body) = requestAbsoluteJson("GET", url)
    return if (code in 200..299) body else ""
  }

  private fun formatCoord(value: Double): String =
    String.format(java.util.Locale.US, "%.6f", value)

  private data class RoutePointForSteps(val lat: Double, val lng: Double)
  private data class RouteProjectionForSteps(val arcM: Double, val distanceM: Double)

  private fun routeStepsJson(steps: JSONArray, routePointsJson: JSONArray): JSONArray {
    val route = parseRoutePointsForSteps(routePointsJson)
    return JSONArray().apply {
      for (i in 0 until steps.length()) {
        val step = steps.optJSONObject(i) ?: continue
        val maneuver = step.optJSONObject("maneuver")
        val loc = maneuver?.optJSONArray("location")
        val lng = loc?.optDouble(0, Double.NaN) ?: Double.NaN
        val lat = loc?.optDouble(1, Double.NaN) ?: Double.NaN
        val arcM = if (lat.isFinite() && lng.isFinite()) {
          projectOnRouteForSteps(lat, lng, route)?.arcM ?: 0.0
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

  private fun parseRoutePointsForSteps(points: JSONArray?): List<RoutePointForSteps> {
    if (points == null) return emptyList()
    return buildList {
      for (i in 0 until points.length()) {
        val p = points.optJSONObject(i) ?: continue
        val lat = p.optDouble("lat", Double.NaN)
        val lng = p.optDouble("lng", Double.NaN)
        if (lat.isFinite() && lng.isFinite()) add(RoutePointForSteps(lat, lng))
      }
    }
  }

  private fun projectOnRouteForSteps(lat: Double, lng: Double, points: List<RoutePointForSteps>): RouteProjectionForSteps? {
    if (points.size < 2) return null
    var cumM = 0.0
    var bestArc = 0.0
    var bestDistance = Double.POSITIVE_INFINITY
    for (i in 0 until points.size - 1) {
      val a = points[i]
      val b = points[i + 1]
      val segM = distanceMetersForSteps(a.lat, a.lng, b.lat, b.lng)
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
      val distM = distanceMetersForSteps(lat, lng, projLat, projLng)
      if (distM < bestDistance) {
        bestDistance = distM
        bestArc = cumM + segM * t
      }
      cumM += segM
    }
    return RouteProjectionForSteps(bestArc, bestDistance).takeIf { bestDistance.isFinite() }
  }

  private fun distanceMetersForSteps(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
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

  private fun maneuverModifierForStep(maneuver: JSONObject?): String {
    if (maneuver == null) return ""
    val exit = maneuver.optInt("exit", 0)
    if (exit > 0) return "exit $exit"
    return maneuver.optString("modifier", "").orEmpty()
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

  private fun buildNavigationPayload(
    fromLat: Double,
    fromLng: Double,
    fromSpeed: Double,
    fromHeading: Double,
    place: AutoSearchPlace,
    points: JSONArray,
    routeSteps: JSONArray = JSONArray(),
    instruction: String,
    maneuverType: String,
    maneuverModifier: String,
    distanceM: Int,
    durationS: Int,
    turnDistanceM: Int,
    mapState: JSONObject,
    dto: JSONObject,
    isNavigating: Boolean = true,
  ): String {
    val safeMapState = JSONObject(mapState.toString()).apply {
      put("route", JSONArray(points.toString()))
      put("routeSteps", JSONArray(routeSteps.toString()))
      put("destinationLat", place.lat)
      put("destinationLng", place.lng)
      put("routePreview", !isNavigating)
      put("isDriving", true)
    }
    val safeDto = JSONObject(dto.toString()).apply {
      put("isNavigating", isNavigating)
      put("destinationName", place.name)
    }
    return JSONObject().apply {
      put("isNavigating", isNavigating)
      put("userLocation", JSONObject().apply {
        put("latitude", fromLat)
        put("longitude", fromLng)
      })
      put("speed", fromSpeed)
      put("heading", fromHeading)
      put("destination", JSONObject().apply {
        put("name", place.name)
        put("latitude", place.lat)
        put("longitude", place.lng)
      })
      put("dto", safeDto)
      put("route", JSONArray(points.toString()))
      put("routeSteps", JSONArray(routeSteps.toString()))
      put("mapState", safeMapState)
    }.toString()
  }

  private fun mergeRemoteSession(context: Context, json: JSONObject) {
    val dest = json.optJSONObject("destination")
    val remainingDistance = if (json.has("remainingDistanceMeters")) json.optInt("remainingDistanceMeters") else JSONObject.NULL
    val remainingDuration = if (json.has("remainingDurationSec")) json.optInt("remainingDurationSec") else JSONObject.NULL
    val dto = JSONObject().apply {
      put("isNavigating", json.optBoolean("isNavigating", false))
      put("currentStepIndex", json.optInt("currentStepIndex", 0))
      put("nextInstruction", json.optString("nextInstruction", ""))
      put("maneuver", json.optString("maneuver", "navigation"))
      put("maneuverModifier", json.optString("maneuverModifier", ""))
      put("remainingDistanceMeters", remainingDistance)
      put("remainingDurationSec", remainingDuration)
      put("turnDistanceMeters", remainingDistance)
      put("destinationName", json.optString("destinationName", "Cel"))
    }
    val route = json.optJSONArray("routePolyline") ?: JSONArray()

    val editor = prefs(context).edit()
      .putBoolean(KEY_IS_NAVIGATING, json.optBoolean("isNavigating", false))
      .putString(KEY_CAR_SAFE_DTO, dto.toString())
      .putString(KEY_ROUTE, route.toString())
      .putString(KEY_STEP_TEXT, json.optString("nextInstruction", ""))
      .putString(KEY_DEST_NAME, json.optString("destinationName", "Cel"))
    if (dest != null) {
      editor
        .putFloat(KEY_DEST_LAT, dest.optDouble("lat", 0.0).toFloat())
        .putFloat(KEY_DEST_LNG, dest.optDouble("lng", 0.0).toFloat())
    }
    editor.apply()
  }

  private fun clearNavigationState(context: Context) {
    prefs(context).edit()
      .putBoolean(KEY_IS_NAVIGATING, false)
      .remove(KEY_CAR_SAFE_DTO)
      .remove(KEY_ROUTE)
      .remove(KEY_STEP_TEXT)
      .remove(KEY_STEP_DISTANCE)
      .remove(KEY_STEP_ETA)
      .remove(KEY_DEST_NAME)
      .putFloat(KEY_DEST_LAT, 0f)
      .putFloat(KEY_DEST_LNG, 0f)
      .apply()
  }

  private fun clearRoutePreviewState(context: Context): Boolean {
    ensureMem(context)
    if (memIsNavigating || prefs(context).getBoolean(KEY_IS_NAVIGATING, false)) return false
    val mapState = runCatching { JSONObject(prefs(context).getString(KEY_MAP_STATE, "{}") ?: "{}") }
      .getOrDefault(JSONObject())
    mapState.put("uiMode", "FREE_DRIVE")
    mapState.put("routePreview", false)
    mapState.remove("route")
    mapState.remove("alternativeRoutes")
    mapState.remove("selectedRouteIndex")
    mapState.remove("destinationLat")
    mapState.remove("destinationLng")
    memDtoRaw = null
    memRouteRaw = "[]"
    memMapRaw = mapState.toString()
    memDestLat = Double.NaN
    memDestLng = Double.NaN
    memDestName = null
    memStepText = null
    cachedSnapshot = null
    prefs(context).edit()
      .putBoolean(KEY_IS_NAVIGATING, false)
      .remove(KEY_CAR_SAFE_DTO)
      .remove(KEY_ROUTE)
      .remove(KEY_STEP_TEXT)
      .remove(KEY_STEP_DISTANCE)
      .remove(KEY_STEP_ETA)
      .remove(KEY_DEST_NAME)
      .putFloat(KEY_DEST_LAT, 0f)
      .putFloat(KEY_DEST_LNG, 0f)
      .putString(KEY_MAP_STATE, mapState.toString())
      .apply()
    return true
  }

  private fun syncLiveLayers(context: Context, token: String) {
    val p = prefs(context)
    val origin = currentOrigin(context, SEARCH_ORIGIN_MAX_AGE_MS)
    val lat = origin?.first ?: 0.0
    val lng = origin?.second ?: 0.0

    val (_, usersBody) = requestJson("GET", "/api/live/users", token)
    if (usersBody.isNotBlank()) {
      val users = runCatching { JSONArray(usersBody) }.getOrNull()
      if (users != null) {
        val mapped = JSONArray()
        for (i in 0 until users.length()) {
          val u = users.optJSONObject(i) ?: continue
          if (!isUserLocationVisible(u)) continue
          mapped.put(
            JSONObject().apply {
              put("id", u.opt("id")?.toString() ?: "u-$i")
              put("type", if (u.optBoolean("isFriend", false)) "friend" else "user")
              put("label", u.optString("username", "Uzytkownik"))
              put("lat", u.optDouble("lat", Double.NaN))
              put("lng", u.optDouble("lng", Double.NaN))
              put("isPremium", u.optBoolean("isPremium", false))
              put("isFriend", u.optBoolean("isFriend", false))
              put("avatarUrl", u.optString("avatar", u.optString("avatarUrl", "")))
              put("avatarFrameUrl", u.optString("avatarFrameUrl", ""))
              put("markerSpriteUri", u.optString("markerSpriteUri", u.optString("spriteUri", "")))
              put("vehicleModelUrl", u.optString("vehicleModelUrl", ""))
              u.optJSONObject("vehicleModelMeta")?.let { put("vehicleModelMeta", it) }
            },
          )
        }
        p.edit().putString(KEY_USERS, mapped.toString()).apply()
      }
    }

    val (_, warningsBody) = requestJson("GET", "/api/live/warnings", token)
    if (warningsBody.isNotBlank()) {
      val warnings = runCatching { JSONArray(warningsBody) }.getOrNull()
      if (warnings != null) {
        val mapped = JSONArray()
        for (i in 0 until warnings.length()) {
          val w = warnings.optJSONObject(i) ?: continue
          mapped.put(
            JSONObject().apply {
              put("id", w.opt("id")?.toString() ?: "w-$i")
              put("type", w.optString("type", "warning"))
              put("label", w.optString("message", w.optString("type", "Ostrzezenie")))
              put("lat", w.optDouble("lat", Double.NaN))
              put("lng", w.optDouble("lng", Double.NaN))
              put("confirmCount", w.optInt("confirmCount", 0))
            },
          )
        }
        p.edit().putString(KEY_WARNINGS, mapped.toString()).apply()
      }
    }

    if ((lat != 0.0 || lng != 0.0) && lat.isFinite() && lng.isFinite()) {
      val (_, camerasBody) = requestJson(
        "GET",
        "/api/speed-cameras?lat=$lat&lng=$lng&radius=$CAMERAS_RADIUS_KM",
        token,
      )
      val (_, fuelBody) = requestJson(
        "GET",
        "/api/fuel-stations?minLat=${lat - 0.15}&maxLat=${lat + 0.15}&minLng=${lng - 0.15}&maxLng=${lng + 0.15}",
        token,
      )
      mergeMapStateOverlays(context, camerasBody, fuelBody, "{\"features\":[]}")
    }
    syncProfile(context, token)
  }

  private fun syncProfile(context: Context, token: String) {
    val p = prefs(context)
    val now = System.currentTimeMillis()
    val last = p.getLong(KEY_LAST_PROFILE_REFRESH, 0L)
    if (now - last < PROFILE_REFRESH_INTERVAL_MS) return
    val (code, body) = requestJson("GET", "/api/profile/me", token)
    if (code !in 200..299 || body.isBlank()) return
    val me = runCatching { JSONObject(body) }.getOrNull() ?: return
    val avatar = me.optString("avatar", "")
    p.edit()
      .putString(KEY_PROFILE_NAME, me.optString("username", "Ty"))
      .putString(KEY_PROFILE_AVATAR, avatar)
      .putLong(KEY_LAST_PROFILE_REFRESH, now)
      .apply()
  }

  private fun mergeNativeMapDrivingState(context: Context, isDriving: Boolean, speedKmh: Double) {
    val p = prefs(context)
    val mapState = runCatching { JSONObject(p.getString(KEY_MAP_STATE, "{}") ?: "{}") }.getOrDefault(JSONObject())
    mapState.put("isDriving", isDriving)
    mapState.put("speedKmh", speedKmh)
    p.edit().putString(KEY_MAP_STATE, mapState.toString()).apply()
  }

  private fun mergeMapStateOverlays(
    context: Context,
    camerasBody: String,
    fuelBody: String,
    gasStationsBody: String,
  ) {
    val p = prefs(context)
    val currentMapState = runCatching {
      JSONObject(p.getString(KEY_MAP_STATE, "{}") ?: "{}")
    }.getOrDefault(JSONObject())

    val camerasArr = JSONArray()
    val cameras = runCatching { JSONArray(camerasBody) }.getOrNull() ?: JSONArray()
    for (i in 0 until cameras.length()) {
      val c = cameras.optJSONObject(i) ?: continue
      camerasArr.put(
        JSONObject().apply {
          put("id", c.opt("id")?.toString() ?: "c-$i")
          put("type", c.optString("type", "fixed"))
          put("label", c.optString("type", "camera"))
          put("lat", c.optDouble("lat", Double.NaN))
          put("lng", c.optDouble("lng", Double.NaN))
          put("maxspeed", if (c.has("maxspeed")) c.optInt("maxspeed") else JSONObject.NULL)
          put("confirmCount", c.optInt("confirmCount", 0))
        },
      )
    }

    val dbFuelArr = JSONArray()
    val stations = runCatching { JSONArray(fuelBody) }.getOrNull() ?: JSONArray()
    for (i in 0 until stations.length()) {
      val s = stations.optJSONObject(i) ?: continue
      val prices = s.optJSONArray("prices")
      val pb95 = prices?.optJSONObject(0)?.opt("pb95")
      dbFuelArr.put(
        JSONObject().apply {
          put("id", "db-${s.opt("id")?.toString() ?: "f-$i"}")
          put("type", "fuel")
          put("label", s.optString("brand", s.optString("name", "Paliwo")))
          put("lat", s.optDouble("lat", Double.NaN))
          put("lng", s.optDouble("lng", Double.NaN))
          put("value", pb95?.toString() ?: "")
        },
      )
    }

    val fuelArr = JSONArray()
    val usedDbIds = mutableSetOf<String>()
    val features = runCatching { JSONObject(gasStationsBody).optJSONArray("features") }.getOrNull() ?: JSONArray()
    for (i in 0 until features.length()) {
      val f = features.optJSONObject(i) ?: continue
      val geometry = f.optJSONObject("geometry") ?: continue
      val coords = geometry.optJSONArray("coordinates") ?: continue
      val gLng = coords.optDouble(0, Double.NaN)
      val gLat = coords.optDouble(1, Double.NaN)
      if (!gLat.isFinite() || !gLng.isFinite()) continue

      var best: JSONObject? = null
      var bestDist = Double.MAX_VALUE
      for (j in 0 until dbFuelArr.length()) {
        val db = dbFuelArr.optJSONObject(j) ?: continue
        val d = haversineKm(gLat, gLng, db.optDouble("lat", Double.NaN), db.optDouble("lng", Double.NaN))
        if (d < bestDist && d <= 0.1) { // 100m
          bestDist = d
          best = db
        }
      }
      val props = f.optJSONObject("properties")
      val id = props?.optString("mapbox_id", "gas-$i") ?: "gas-$i"
      val label = best?.optString("label")
        ?: props?.optString("name", "Stacja paliw")
        ?: "Stacja paliw"
      val value = best?.optString("value", "") ?: ""
      best?.optString("id")?.takeIf { it.isNotBlank() }?.let { usedDbIds.add(it) }
      fuelArr.put(
        JSONObject().apply {
          put("id", id)
          put("type", "fuel")
          put("label", label)
          put("lat", gLat)
          put("lng", gLng)
          put("value", value)
        },
      )
    }

    for (i in 0 until dbFuelArr.length()) {
      val db = dbFuelArr.optJSONObject(i) ?: continue
      val dbId = db.optString("id", "")
      if (dbId.isNotBlank() && !usedDbIds.contains(dbId)) {
        fuelArr.put(db)
      }
    }

    // Keep richer fuel datasets already pushed by RN bridge if they contain
    // additional stations not present in native refresh.
    val existingFuel = runCatching { currentMapState.optJSONArray("fuelStations") }.getOrNull()
    if (existingFuel != null && existingFuel.length() > 0) {
      for (i in 0 until existingFuel.length()) {
        val item = existingFuel.optJSONObject(i) ?: continue
        val lat = item.optDouble("lat", item.optDouble("latitude", Double.NaN))
        val lng = item.optDouble("lng", item.optDouble("longitude", Double.NaN))
        if (!lat.isFinite() || !lng.isFinite()) continue
        var duplicate = false
        for (j in 0 until fuelArr.length()) {
          val existing = fuelArr.optJSONObject(j) ?: continue
          val dist = haversineKm(lat, lng, existing.optDouble("lat", Double.NaN), existing.optDouble("lng", Double.NaN))
          if (dist <= 0.05) {
            duplicate = true
            break
          }
        }
        if (!duplicate) fuelArr.put(item)
      }
    }

    currentMapState.put("speedCameras", camerasArr)
    currentMapState.put("fuelStations", fuelArr)
    p.edit().putString(KEY_MAP_STATE, currentMapState.toString()).apply()
    cachedMapState = JSONObject(currentMapState.toString())
    memMapRaw = currentMapState.toString()
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      VroomCarManager.resyncNativeMapMarkers()
    }
  }

  private fun requestJson(
    method: String,
    path: String,
    token: String,
    body: String? = null,
    extraHeaders: Map<String, String> = emptyMap(),
  ): Pair<Int, String> {
    return runCatching {
      val conn = (URL("$API_URL$path").openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 3500
        readTimeout = 3500
        setRequestProperty("Accept", "application/json")
        setRequestProperty("Authorization", "Bearer $token")
        extraHeaders.forEach { (k, v) -> setRequestProperty(k, v) }
        if (body != null) {
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          outputStream.bufferedWriter().use { it.write(body) }
        }
      }
      val code = conn.responseCode
      val payload = runCatching {
        val src = if (code in 200..299) conn.inputStream else conn.errorStream
        src?.bufferedReader()?.use { it.readText() } ?: ""
      }.getOrDefault("")
      code to payload
    }.getOrDefault(0 to "")
  }

  private fun parseSearchFeatures(features: JSONArray): List<AutoSearchPlace> {
    val seen = mutableSetOf<String>()
    return buildList {
      for (i in 0 until features.length()) {
        val f = features.optJSONObject(i) ?: continue
        val geometry = f.optJSONObject("geometry")
        val geometryCoords = geometry?.optJSONArray("coordinates")
        val centerCoords = f.optJSONArray("center")
        val coords = when {
          geometryCoords != null -> geometryCoords
          centerCoords != null -> centerCoords
          else -> null
        } ?: continue
        val placeLng = coords.optDouble(0, Double.NaN)
        val placeLat = coords.optDouble(1, Double.NaN)
        if (!placeLat.isFinite() || !placeLng.isFinite()) continue
        val props = f.optJSONObject("properties")
        val name = props?.optString("name")
          ?: f.optString("text")
          ?: f.optString("place_name")
          ?: "Cel"
        val dedupeKey = "${name.lowercase()}|${(placeLat * 10_000).toInt()}|${(placeLng * 10_000).toInt()}"
        if (!seen.add(dedupeKey)) continue
        add(
          AutoSearchPlace(
            id = props?.optString("mapbox_id")
              ?: f.optString("id")
              ?: "place-$i",
            name = name,
            address = props?.optString("full_address")
              ?: props?.optString("address")
              ?: f.optString("place_name")
              ?: "",
            lat = placeLat,
            lng = placeLng,
          ),
        )
      }
    }
  }

  private fun toFuelGeoJson(places: List<AutoSearchPlace>): String {
    val features = JSONArray()
    places.forEachIndexed { i, place ->
      features.put(
        JSONObject().apply {
          put("id", place.id.ifBlank { "fuel-$i" })
          put(
            "geometry",
            JSONObject().apply {
              put("type", "Point")
              put("coordinates", JSONArray().apply {
                put(place.lng)
                put(place.lat)
              })
            },
          )
          put(
            "properties",
            JSONObject().apply {
              put("mapbox_id", place.id.ifBlank { "fuel-$i" })
              put("name", place.name.ifBlank { "Stacja paliw" })
              put("full_address", place.address)
            },
          )
        },
      )
    }
    return JSONObject().put("features", features).toString()
  }

  private fun mergeFuelGeoJson(primary: String, secondary: String): String {
    val merged = JSONArray()
    val seen = mutableListOf<Pair<Double, Double>>()
    fun absorb(raw: String) {
      val features = runCatching { JSONObject(raw).optJSONArray("features") }.getOrNull() ?: JSONArray()
      for (i in 0 until features.length()) {
        val f = features.optJSONObject(i) ?: continue
        val coords = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: continue
        val lng = coords.optDouble(0, Double.NaN)
        val lat = coords.optDouble(1, Double.NaN)
        if (!lat.isFinite() || !lng.isFinite()) continue
        if (seen.any { haversineKm(lat, lng, it.first, it.second) <= 0.06 }) continue
        seen.add(lat to lng)
        merged.put(f)
      }
    }
    absorb(primary)
    absorb(secondary)
    return JSONObject().put("features", merged).toString()
  }

  private fun persistRouteFromDirections(context: Context, place: AutoSearchPlace, json: JSONObject): Boolean {
    val p = prefs(context)
    val route = json.optJSONArray("routes")?.optJSONObject(0) ?: return false
    val points = routePointsFromGeometry(route)
    if (points.length() < 2) return false
    val leg = route.optJSONArray("legs")?.optJSONObject(0)
    val step = leg?.optJSONArray("steps")?.optJSONObject(0)
    val maneuver = step?.optJSONObject("maneuver")
    val instruction = maneuver?.optString("instruction", "Jedz do celu") ?: "Jedz do celu"
    val distanceM = route.optDouble("distance", 0.0).toInt().coerceAtLeast(1)
    val durationS = route.optDouble("duration", 0.0).toInt().coerceAtLeast(0)
    val maneuverType = maneuver?.optString("type", "straight") ?: "straight"

    val dto = JSONObject().apply {
      put("isNavigating", true)
      put("currentStepIndex", 0)
      put("nextInstruction", instruction)
      put("maneuver", maneuverType)
      put("remainingDistanceMeters", distanceM)
      put("remainingDurationSec", durationS)
      put("turnDistanceMeters", distanceM)
      put("destinationName", place.name)
    }
    val mapState = runCatching { JSONObject(p.getString(KEY_MAP_STATE, "{}") ?: "{}") }.getOrDefault(JSONObject())
    mapState.put("route", points)
    mapState.put("destinationLat", place.lat)
    mapState.put("destinationLng", place.lng)
    mapState.put("routePreview", false)
    mapState.put("isDriving", true)

    p.edit()
      .putBoolean(KEY_IS_NAVIGATING, true)
      .putString(KEY_CAR_SAFE_DTO, dto.toString())
      .putString(KEY_ROUTE, points.toString())
      .putString(KEY_STEP_TEXT, instruction)
      .putString(KEY_DEST_NAME, place.name)
      .putFloat(KEY_DEST_LAT, place.lat.toFloat())
      .putFloat(KEY_DEST_LNG, place.lng.toFloat())
      .putString(KEY_MAP_STATE, mapState.toString())
      .apply()
    saveRecentSearch(context, place)
    return true
  }

  private fun saveRecentSearch(context: Context, place: AutoSearchPlace) {
    val p = prefs(context)
    val existing = runCatching { JSONArray(p.getString(KEY_SEARCH_HISTORY, "[]") ?: "[]") }.getOrDefault(JSONArray())
    val out = JSONArray()
    out.put(
      JSONObject().apply {
        put("id", place.id)
        put("name", place.name)
        put("address", place.address)
        put("lat", place.lat)
        put("lng", place.lng)
      },
    )
    for (i in 0 until existing.length()) {
      val item = existing.optJSONObject(i) ?: continue
      val id = item.optString("id", "")
      if (id.isNotBlank() && id == place.id) continue
      out.put(item)
      if (out.length() >= 6) break
    }
    p.edit().putString(KEY_SEARCH_HISTORY, out.toString()).apply()
  }

  private fun requestAbsoluteJson(
    method: String,
    url: String,
    body: String? = null,
  ): Pair<Int, String> {
    return runCatching {
      val conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 4000
        readTimeout = 4000
        setRequestProperty("Accept", "application/json")
        if (body != null) {
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
          outputStream.bufferedWriter().use { it.write(body) }
        }
      }
      val code = conn.responseCode
      val payload = runCatching {
        val src = if (code in 200..299) conn.inputStream else conn.errorStream
        src?.bufferedReader()?.use { it.readText() } ?: ""
      }.getOrDefault("")
      code to payload
    }.getOrDefault(0 to "")
  }

  private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6371.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
      kotlin.math.cos(Math.toRadians(lat1)) *
      kotlin.math.cos(Math.toRadians(lat2)) *
      kotlin.math.sin(dLng / 2) * kotlin.math.sin(dLng / 2)
    return r * 2 * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
  }

  private fun isUserLocationVisible(user: JSONObject): Boolean {
    val hideFlags = listOf(
      "hideLocation",
      "locationHidden",
      "isLocationHidden",
      "isHidden",
      "privateProfile",
    )
    return hideFlags.none { user.optBoolean(it, false) }
  }

  private fun parseMarkers(raw: String?, fallbackType: String): List<AutoMapMarker> = runCatching {
    parseMarkers(JSONArray(raw ?: "[]"), fallbackType)
  }.getOrElse { emptyList() }

  private fun parsePoints(raw: String?): List<AutoNavPoint> = runCatching {
    parsePoints(JSONArray(raw ?: "[]"))
  }.getOrElse { emptyList() }

  private fun parseMarkers(arr: JSONArray?, fallbackType: String): List<AutoMapMarker> = runCatching {
    if (arr == null) return@runCatching emptyList()
    buildList {
      for (i in 0 until arr.length()) {
        val item = arr.optJSONObject(i) ?: continue
        if (fallbackType == "user" && !isUserLocationVisible(item)) continue
        val lat = item.optDouble("lat", item.optDouble("latitude", Double.NaN))
        val lng = item.optDouble("lng", item.optDouble("longitude", Double.NaN))
        if (!lat.isFinite() || !lng.isFinite()) continue
        add(
          AutoMapMarker(
            id = item.optString("id", "$fallbackType-$i"),
            type = item.optString("type", fallbackType),
            label = item.optString("label", item.optString("name", fallbackType)),
            lat = lat,
            lng = lng,
            value = item.optString("value", ""),
            count = item.optInt("count", item.optInt("confirmCount", 0)),
            isPremium = item.optBoolean("isPremium", false),
            isFriend = item.optBoolean("isFriend", false),
          ),
        )
      }
    }
  }.getOrElse { emptyList() }

  private fun parsePoints(arr: JSONArray?): List<AutoNavPoint> = runCatching {
    if (arr == null) return@runCatching emptyList()
    buildList {
      for (i in 0 until arr.length()) {
        val point = arr.optJSONObject(i) ?: continue
        val lat = point.optDouble("lat", point.optDouble("latitude", Double.NaN))
        val lng = point.optDouble("lng", point.optDouble("longitude", Double.NaN))
        if (!lat.isFinite() || !lng.isFinite()) continue
        add(AutoNavPoint(lat, lng))
      }
    }
  }.getOrElse { emptyList() }

  private fun JSONObject.nullableInt(key: String): Int? =
    if (has(key) && !isNull(key)) optInt(key) else null
}

data class AutoNavPoint(val lat: Double, val lng: Double)
data class AutoMapMarker(
  val id: String,
  val type: String,
  val label: String,
  val lat: Double,
  val lng: Double,
  val value: String = "",
  val count: Int = 0,
  val isPremium: Boolean = false,
  val isFriend: Boolean = false,
)
data class AutoSearchPlace(
  val id: String,
  val name: String,
  val address: String,
  val lat: Double,
  val lng: Double,
)
data class AutoNavSnapshot(
  val isNavigating: Boolean,
  val instruction: String,
  val maneuver: String,
  val maneuverModifier: String,
  val remainingDistanceMeters: Int?,
  val remainingDurationSec: Int?,
  val turnDistanceMeters: Int?,
  val destinationName: String,
  val mapStyle: String,
  val isDriving: Boolean,
  val isBuilding: Boolean,
  val arrived: Boolean,
  val offRoute: Boolean,
  val speedLimitKmh: Int?,
  val useArrowMarker: Boolean,
  val showUsers: Boolean,
  val showWarnings: Boolean,
  val showSpeedCameras: Boolean,
  val showFuelStations: Boolean,
  val voiceAlerts: Boolean,
  val speedAlerts: Boolean,
  val currentLat: Double,
  val currentLng: Double,
  val startLat: Double,
  val startLng: Double,
  val startName: String,
  val destinationLat: Double,
  val destinationLng: Double,
  val speedKmh: Double,
  val heading: Double,
  val currentUserName: String,
  val currentUserAvatarUrl: String,
  val fallbackDistance: String,
  val fallbackEta: String,
  val route: List<AutoNavPoint>,
  val builderRoute: List<AutoNavPoint>,
  val builderPins: List<AutoMapMarker>,
  val users: List<AutoMapMarker>,
  val warnings: List<AutoMapMarker>,
  val speedCameras: List<AutoMapMarker>,
  val fuelStations: List<AutoMapMarker>,
)
