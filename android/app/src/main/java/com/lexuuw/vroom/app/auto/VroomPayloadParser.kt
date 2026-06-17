package com.lexuuw.vroom.app.auto

import org.json.JSONArray
import org.json.JSONObject

data class UserMarker(
    val id: String,
    val lat: Double,
    val lng: Double,
    val label: String,
    val type: String,
    val isPremium: Boolean
)

data class WarningMarker(
    val id: String,
    val lat: Double,
    val lng: Double,
    val label: String,
    val type: String,
    val count: Int = 0
)

data class AutoRoutePoint(
    val lat: Double,
    val lng: Double
)

data class MapState(
    val mapStyle: String?,
    val hideLocation: Boolean,
    val isDriving: Boolean,
    val isBuilding: Boolean,
    val arrived: Boolean,
    val offRoute: Boolean,
    val speedKmh: Double,
    val speedLimitKmh: Double?,
    val locationMarkerStyle: String,
    val currentUserAvatarUrl: String,
    val destinationLat: Double?,
    val destinationLng: Double?,
    val routePoints: List<AutoRoutePoint>
)

data class VroomPayload(
    val isNavigating: Boolean,
    val userLat: Double?,
    val userLng: Double?,
    val speed: Double?,
    val heading: Double?,
    val destinationName: String?,
    val instruction: String?,
    val maneuver: String?,
    val remainingDistanceMeters: Int?,
    val remainingDurationSec: Int?,
    val turnDistanceMeters: Int?,
    val mapState: MapState,
    val users: List<UserMarker>,
    val warnings: List<WarningMarker>,
    val routePoints: List<AutoRoutePoint>
)

object VroomPayloadParser {

    fun parse(jsonString: String): VroomPayload? {
        return try {
            val root = JSONObject(jsonString)
            val userLocation = root.optJSONObject("userLocation")
            val userLat = finiteOrNull(userLocation?.optDouble("latitude", Double.NaN))
            val userLng = finiteOrNull(userLocation?.optDouble("longitude", Double.NaN))
            val speed = finiteOrNull(root.optDouble("speed", Double.NaN))
            val heading = finiteOrNull(root.optDouble("heading", Double.NaN))
            val isNavigating = root.optBoolean("isNavigating", false)
            val dto = root.optJSONObject("dto")
            val destination = root.optJSONObject("destination") ?: dto?.optJSONObject("destination")
            val destinationLat = if (destination != null) {
                finiteOrNull(destination.optDouble("latitude", destination.optDouble("lat", Double.NaN)))
            } else {
                null
            }
            val destinationLng = if (destination != null) {
                finiteOrNull(destination.optDouble("longitude", destination.optDouble("lng", Double.NaN)))
            } else {
                null
            }
            val msObj = root.optJSONObject("mapState")
            val routePoints = parsePoints(msObj?.optJSONArray("route"))
                .ifEmpty { parsePoints(root.optJSONArray("route")) }

            val mapState = MapState(
                mapStyle = msObj?.optString("mapStyle", "dark"),
                hideLocation = msObj?.optBoolean("hideLocation", false) ?: false,
                isDriving = true,
                isBuilding = msObj?.optBoolean("isBuilding", false) ?: false,
                arrived = msObj?.optBoolean("arrived", false) ?: false,
                offRoute = msObj?.optBoolean("offRoute", false) ?: false,
                speedKmh = finiteOrNull(msObj?.optDouble("speedKmh", Double.NaN)) ?: ((speed ?: 0.0) * 3.6),
                speedLimitKmh = finiteOrNull(msObj?.optDouble("speedLimitKmh", Double.NaN)),
                locationMarkerStyle = msObj?.optString("locationMarkerStyle", "profile") ?: "profile",
                currentUserAvatarUrl = msObj?.optString("currentUserAvatarUrl", "") ?: "",
                destinationLat = destinationLat,
                destinationLng = destinationLng,
                routePoints = routePoints
            )

            VroomPayload(
                isNavigating = isNavigating,
                userLat = userLat,
                userLng = userLng,
                speed = speed,
                heading = heading,
                destinationName = cleanString(dto?.optString("destinationName", ""))
                    ?: cleanString(destination?.optString("name", "")),
                instruction = cleanString(dto?.optString("nextInstruction", "")),
                maneuver = cleanString(dto?.optString("maneuver", "")),
                remainingDistanceMeters = nullableInt(dto, "remainingDistanceMeters"),
                remainingDurationSec = nullableInt(dto, "remainingDurationSec"),
                turnDistanceMeters = nullableInt(dto, "turnDistanceMeters"),
                mapState = mapState,
                users = parseUsers(root.optJSONArray("users")),
                warnings = parseWarnings(root.optJSONArray("warnings")),
                routePoints = routePoints
            )
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun parseUsers(usersArray: JSONArray?): List<UserMarker> {
        if (usersArray == null) return emptyList()
        val users = mutableListOf<UserMarker>()
        for (i in 0 until usersArray.length()) {
            val u = usersArray.optJSONObject(i) ?: continue
            val lat = finiteOrNull(u.optDouble("lat", u.optDouble("latitude", Double.NaN))) ?: continue
            val lng = finiteOrNull(u.optDouble("lng", u.optDouble("longitude", Double.NaN))) ?: continue
            users.add(
                UserMarker(
                    id = u.optString("id", "user-$i"),
                    lat = lat,
                    lng = lng,
                    label = u.optString("label", u.optString("name", "User")),
                    type = u.optString("type", "user"),
                    isPremium = u.optBoolean("isPremium", false)
                )
            )
        }
        return users
    }

    private fun parseWarnings(warningsArray: JSONArray?): List<WarningMarker> {
        if (warningsArray == null) return emptyList()
        val warnings = mutableListOf<WarningMarker>()
        for (i in 0 until warningsArray.length()) {
            val w = warningsArray.optJSONObject(i) ?: continue
            val lat = finiteOrNull(w.optDouble("lat", w.optDouble("latitude", Double.NaN))) ?: continue
            val lng = finiteOrNull(w.optDouble("lng", w.optDouble("longitude", Double.NaN))) ?: continue
            warnings.add(
                WarningMarker(
                    id = w.optString("id", "warning-$i"),
                    lat = lat,
                    lng = lng,
                    label = w.optString("label", w.optString("message", "Zgloszenie")),
                    type = w.optString("type", "warning"),
                    count = w.optInt("count", w.optInt("confirmCount", 0))
                )
            )
        }
        return warnings
    }

    private fun parsePoints(array: JSONArray?): List<AutoRoutePoint> {
        if (array == null) return emptyList()
        val points = mutableListOf<AutoRoutePoint>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val lat = finiteOrNull(item.optDouble("lat", item.optDouble("latitude", Double.NaN))) ?: continue
            val lng = finiteOrNull(item.optDouble("lng", item.optDouble("longitude", Double.NaN))) ?: continue
            points.add(AutoRoutePoint(lat, lng))
        }
        return points
    }

    private fun finiteOrNull(value: Double?): Double? =
        value?.takeIf { it.isFinite() }

    private fun cleanString(value: String?): String? =
        value?.trim()?.takeIf { it.isNotBlank() && it.lowercase() != "null" }

    private fun nullableInt(obj: JSONObject?, key: String): Int? =
        if (obj != null && obj.has(key) && !obj.isNull(key)) obj.optInt(key) else null
}
