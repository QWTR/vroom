package com.lexuuw.vroom.app.auto

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
    val type: String
)

data class MapState(
    val mapStyle: String?,
    val hideLocation: Boolean,
    val isDriving: Boolean,
    val isBuilding: Boolean,
    val arrived: Boolean,
    val offRoute: Boolean,
    val speedKmh: Double,
    val speedLimitKmh: Double?
)

data class VroomPayload(
    val isNavigating: Boolean,
    val userLat: Double?,
    val userLng: Double?,
    val speed: Double?,
    val heading: Double?,
    val mapState: MapState,
    val users: List<UserMarker>,
    val warnings: List<WarningMarker>,
    val route: String?
)

object VroomPayloadParser {

    fun parse(jsonString: String): VroomPayload? {
        return try {
            val root = JSONObject(jsonString)
            
            val userLocation = root.optJSONObject("userLocation")
            val userLat = userLocation?.optDouble("latitude")
            val userLng = userLocation?.optDouble("longitude")
            
            val speed = root.optDouble("speed").takeIf { !it.isNaN() }
            val heading = root.optDouble("heading").takeIf { !it.isNaN() }
            val isNavigating = root.optBoolean("isNavigating", false)

            val usersList = mutableListOf<UserMarker>()
            val usersArray = root.optJSONArray("users")
            if (usersArray != null) {
                for (i in 0 until usersArray.length()) {
                    val u = usersArray.optJSONObject(i) ?: continue
                    usersList.add(
                        UserMarker(
                            id = u.optString("id", ""),
                            lat = u.optDouble("lat", 0.0),
                            lng = u.optDouble("lng", 0.0),
                            label = u.optString("label", ""),
                            type = u.optString("type", "user"),
                            isPremium = u.optBoolean("isPremium", false)
                        )
                    )
                }
            }

            val warningsList = mutableListOf<WarningMarker>()
            val warningsArray = root.optJSONArray("warnings")
            if (warningsArray != null) {
                for (i in 0 until warningsArray.length()) {
                    val w = warningsArray.optJSONObject(i) ?: continue
                    warningsList.add(
                        WarningMarker(
                            id = w.optString("id", ""),
                            lat = w.optDouble("lat", 0.0),
                            lng = w.optDouble("lng", 0.0),
                            label = w.optString("label", ""),
                            type = w.optString("type", "warning")
                        )
                    )
                }
            }

            val msObj = root.optJSONObject("mapState")
            val mapState = MapState(
                mapStyle = msObj?.optString("mapStyle", "dark"),
                hideLocation = msObj?.optBoolean("hideLocation", false) ?: false,
                isDriving = msObj?.optBoolean("isDriving", false) ?: false,
                isBuilding = msObj?.optBoolean("isBuilding", false) ?: false,
                arrived = msObj?.optBoolean("arrived", false) ?: false,
                offRoute = msObj?.optBoolean("offRoute", false) ?: false,
                speedKmh = msObj?.optDouble("speedKmh", 0.0) ?: 0.0,
                speedLimitKmh = msObj?.optDouble("speedLimitKmh").takeIf { it?.isNaN() == false }
            )

            val route = root.optString("route", null).takeIf { !it.isNullOrBlank() }

            VroomPayload(
                isNavigating = isNavigating,
                userLat = userLat,
                userLng = userLng,
                speed = speed,
                heading = heading,
                mapState = mapState,
                users = usersList,
                warnings = warningsList,
                route = route
            )
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
