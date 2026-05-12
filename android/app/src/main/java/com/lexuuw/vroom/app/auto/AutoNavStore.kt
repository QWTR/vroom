package com.lexuuw.vroom.app.auto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object AutoNavStore {
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

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun setNavigating(context: Context, value: Boolean) { prefs(context).edit().putBoolean(KEY_IS_NAVIGATING, value).apply() }
  fun saveLocation(context: Context, lat: Double, lng: Double) { prefs(context).edit().putFloat(KEY_LAT, lat.toFloat()).putFloat(KEY_LNG, lng.toFloat()).apply() }
  fun saveSpeedHeading(context: Context, speed: Double, heading: Double) { prefs(context).edit().putFloat(KEY_SPEED, speed.toFloat()).putFloat(KEY_HEADING, heading.toFloat()).apply() }
  fun saveRoute(context: Context, routeJson: String) { prefs(context).edit().putString(KEY_ROUTE, routeJson).apply() }
  fun saveDestination(context: Context, lat: Double, lng: Double, name: String) { prefs(context).edit().putFloat(KEY_DEST_LAT, lat.toFloat()).putFloat(KEY_DEST_LNG, lng.toFloat()).putString(KEY_DEST_NAME, name).apply() }
  fun saveStep(context: Context, text: String, distance: String, eta: String) { prefs(context).edit().putString(KEY_STEP_TEXT, text).putString(KEY_STEP_DISTANCE, distance).putString(KEY_STEP_ETA, eta).apply() }
  fun saveCarSafeState(context: Context, dtoJson: String) { prefs(context).edit().putString(KEY_CAR_SAFE_DTO, dtoJson).apply() }
  fun saveUsers(context: Context, usersJson: String) { prefs(context).edit().putString(KEY_USERS, usersJson).apply() }
  fun saveWarnings(context: Context, warningsJson: String) { prefs(context).edit().putString(KEY_WARNINGS, warningsJson).apply() }
  fun saveMapState(context: Context, mapStateJson: String) { prefs(context).edit().putString(KEY_MAP_STATE, mapStateJson).apply() }
  fun requestStop(context: Context) { prefs(context).edit().putBoolean(KEY_STOP_REQUESTED, true).apply() }
  fun requestReport(context: Context, type: String = "menu") { prefs(context).edit().putString(KEY_REPORT_REQUESTED, type).apply() }
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
    val p = prefs(context)
    val dtoRaw = p.getString(KEY_CAR_SAFE_DTO, null)
    val dto = dtoRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val mapRaw = p.getString(KEY_MAP_STATE, null)
    val mapState = mapRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val route = parsePoints(mapState?.optJSONArray("route")).ifEmpty {
      parsePoints(JSONArray(p.getString(KEY_ROUTE, "[]")))
    }
    val builderRoute = parsePoints(mapState?.optJSONArray("builderRoute"))
    val builderPins = parseMarkers(mapState?.optJSONArray("builderPins"), "pin")
    val speedCameras = parseMarkers(mapState?.optJSONArray("speedCameras"), "camera")
    val fuelStations = parseMarkers(mapState?.optJSONArray("fuelStations"), "fuel")
    val users = parseMarkers(p.getString(KEY_USERS, "[]"), "user")
    val warnings = parseMarkers(p.getString(KEY_WARNINGS, "[]"), "warning")
    val start = mapState?.optJSONObject("start")

    val fallbackInstruction = p.getString(KEY_STEP_TEXT, "") ?: ""
    val fallbackDistance = p.getString(KEY_STEP_DISTANCE, "") ?: ""
    val fallbackEta = p.getString(KEY_STEP_ETA, "") ?: ""
    val fallbackDestName = p.getString(KEY_DEST_NAME, "Cel") ?: "Cel"

    return AutoNavSnapshot(
      isNavigating = dto?.optBoolean("isNavigating", p.getBoolean(KEY_IS_NAVIGATING, false))
        ?: p.getBoolean(KEY_IS_NAVIGATING, false),
      instruction = dto?.optString("nextInstruction", fallbackInstruction) ?: fallbackInstruction,
      maneuver = dto?.optString("maneuver", "navigation") ?: "navigation",
      remainingDistanceMeters = if (dto?.has("remainingDistanceMeters") == true) dto.optInt("remainingDistanceMeters") else null,
      remainingDurationSec = if (dto?.has("remainingDurationSec") == true) dto.optInt("remainingDurationSec") else null,
      turnDistanceMeters = if (dto?.has("turnDistanceMeters") == true) dto.optInt("turnDistanceMeters") else null,
      destinationName = dto?.optString("destinationName", fallbackDestName) ?: fallbackDestName,
      mapStyle = mapState?.optString("mapStyle", "") ?: "",
      isDriving = mapState?.optBoolean("isDriving", false) ?: false,
      isBuilding = mapState?.optBoolean("isBuilding", false) ?: false,
      arrived = mapState?.optBoolean("arrived", false) ?: false,
      offRoute = mapState?.optBoolean("offRoute", false) ?: false,
      speedLimitKmh = mapState?.nullableInt("speedLimitKmh"),
      currentLat = p.getFloat(KEY_LAT, 0f).toDouble(),
      currentLng = p.getFloat(KEY_LNG, 0f).toDouble(),
      startLat = start?.optDouble("lat", 0.0) ?: 0.0,
      startLng = start?.optDouble("lng", 0.0) ?: 0.0,
      startName = start?.optString("name", "Start") ?: "Start",
      destinationLat = p.getFloat(KEY_DEST_LAT, 0f).toDouble(),
      destinationLng = p.getFloat(KEY_DEST_LNG, 0f).toDouble(),
      speedKmh = p.getFloat(KEY_SPEED, 0f).toDouble(),
      heading = p.getFloat(KEY_HEADING, 0f).toDouble(),
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
  }

  private fun parseMarkers(raw: String?, fallbackType: String): List<AutoMapMarker> = runCatching {
    parseMarkers(JSONArray(raw ?: "[]"), fallbackType)
  }.getOrElse { emptyList() }

  private fun parseMarkers(arr: JSONArray?, fallbackType: String): List<AutoMapMarker> = runCatching {
    if (arr == null) return@runCatching emptyList()
    buildList {
      for (i in 0 until arr.length()) {
        val item = arr.optJSONObject(i) ?: continue
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
data class AutoNavSnapshot(
  val isNavigating: Boolean,
  val instruction: String,
  val maneuver: String,
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
  val currentLat: Double,
  val currentLng: Double,
  val startLat: Double,
  val startLng: Double,
  val startName: String,
  val destinationLat: Double,
  val destinationLng: Double,
  val speedKmh: Double,
  val heading: Double,
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
