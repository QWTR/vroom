package __PACKAGE__.auto

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

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun setNavigating(context: Context, value: Boolean) { prefs(context).edit().putBoolean(KEY_IS_NAVIGATING, value).apply() }
  fun saveLocation(context: Context, lat: Double, lng: Double) { prefs(context).edit().putFloat(KEY_LAT, lat.toFloat()).putFloat(KEY_LNG, lng.toFloat()).apply() }
  fun saveSpeedHeading(context: Context, speed: Double, heading: Double) { prefs(context).edit().putFloat(KEY_SPEED, speed.toFloat()).putFloat(KEY_HEADING, heading.toFloat()).apply() }
  fun saveRoute(context: Context, routeJson: String) { prefs(context).edit().putString(KEY_ROUTE, routeJson).apply() }
  fun saveDestination(context: Context, lat: Double, lng: Double, name: String) { prefs(context).edit().putFloat(KEY_DEST_LAT, lat.toFloat()).putFloat(KEY_DEST_LNG, lng.toFloat()).putString(KEY_DEST_NAME, name).apply() }
  fun saveStep(context: Context, text: String, distance: String, eta: String) { prefs(context).edit().putString(KEY_STEP_TEXT, text).putString(KEY_STEP_DISTANCE, distance).putString(KEY_STEP_ETA, eta).apply() }
  fun saveCarSafeState(context: Context, dtoJson: String) { prefs(context).edit().putString(KEY_CAR_SAFE_DTO, dtoJson).apply() }
  fun requestStop(context: Context) { prefs(context).edit().putBoolean(KEY_STOP_REQUESTED, true).apply() }
  fun consumeStopRequest(context: Context): Boolean {
    val p = prefs(context); val requested = p.getBoolean(KEY_STOP_REQUESTED, false)
    if (requested) p.edit().putBoolean(KEY_STOP_REQUESTED, false).apply()
    return requested
  }

  fun snapshot(context: Context): AutoNavSnapshot {
    val p = prefs(context)
    val dtoRaw = p.getString(KEY_CAR_SAFE_DTO, null)
    val dto = dtoRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val route = runCatching {
      val arr = JSONArray(p.getString(KEY_ROUTE, "[]"))
      buildList {
        for (i in 0 until arr.length()) {
          val point = arr.optJSONObject(i) ?: continue
          add(AutoNavPoint(point.optDouble("lat", 0.0), point.optDouble("lng", 0.0)))
        }
      }
    }.getOrElse { emptyList() }

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
      destinationLat = p.getFloat(KEY_DEST_LAT, 0f).toDouble(),
      destinationLng = p.getFloat(KEY_DEST_LNG, 0f).toDouble(),
      speedKmh = p.getFloat(KEY_SPEED, 0f).toDouble(),
      heading = p.getFloat(KEY_HEADING, 0f).toDouble(),
      fallbackDistance = fallbackDistance,
      fallbackEta = fallbackEta,
      route = route,
    )
  }
}

data class AutoNavPoint(val lat: Double, val lng: Double)
data class AutoNavSnapshot(
  val isNavigating: Boolean,
  val instruction: String,
  val maneuver: String,
  val remainingDistanceMeters: Int?,
  val remainingDurationSec: Int?,
  val turnDistanceMeters: Int?,
  val destinationName: String,
  val destinationLat: Double,
  val destinationLng: Double,
  val speedKmh: Double,
  val heading: Double,
  val fallbackDistance: String,
  val fallbackEta: String,
  val route: List<AutoNavPoint>,
)
