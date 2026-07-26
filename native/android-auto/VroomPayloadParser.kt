package __PACKAGE__.auto

import org.json.JSONArray
import org.json.JSONObject

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
                uiMode = cleanString(msObj?.optString("uiMode", "")),
                searchQuery = cleanString(msObj?.optString("searchQuery", "")),
                mapStyle = msObj?.optString("mapStyle", "dark"),
                hideLocation = msObj?.optBoolean("hideLocation", false) ?: false,
                isDriving = true,
                isBuilding = msObj?.optBoolean("isBuilding", false) ?: false,
                arrived = msObj?.optBoolean("arrived", false) ?: false,
                offRoute = msObj?.optBoolean("offRoute", false) ?: false,
                routePreview = msObj?.optBoolean("routePreview", false) ?: false,
                autoPoseActive = msObj?.optBoolean("autoPoseActive", false) ?: false,
                nativeRoadMatch = msObj?.optBoolean("nativeRoadMatch", false) ?: false,
                nativeRoadPose = msObj?.optBoolean("nativeRoadPose", false) ?: false,
                nativeAutoPose = msObj?.optBoolean("nativeAutoPose", false) ?: false,
                nativeRoadMatchedAt = msObj?.optLong("nativeRoadMatchedAt", 0L) ?: 0L,
                nativeRoadVersion = msObj?.optInt("nativeRoadVersion", 0) ?: 0,
                speedKmh = finiteOrNull(msObj?.optDouble("speedKmh", Double.NaN)) ?: ((speed ?: 0.0) * 3.6),
                speedLimitKmh = finiteOrNull(msObj?.optDouble("speedLimitKmh", Double.NaN)),
                locationMarkerStyle = msObj?.optString("locationMarkerStyle", "arrow") ?: "arrow",
                currentUserAvatarUrl = msObj?.optString("currentUserAvatarUrl", "") ?: "",
                destinationLat = destinationLat,
                destinationLng = destinationLng,
                routePoints = routePoints,
                autoArcWindow = parseArcWindow(msObj?.optJSONObject("autoArcWindow")),
                autoTargetArcM = finiteOrNull(msObj?.optDouble("autoTargetArcM", Double.NaN)),
                autoRoadBlend = finiteOrNull(msObj?.optDouble("autoRoadBlend", Double.NaN)) ?: 0.0,
                autoPathMode = cleanString(msObj?.optString("autoPathMode", "")),
                selfMarker = parseSelfMarker(msObj?.optJSONObject("selfMarker")),
                geoDrops = parseGeoDrops(msObj?.optJSONArray("geoDrops")),
                activeDropPrompt = parseGeoDrop(msObj?.optJSONObject("activeDropPrompt"), -1),
                showUsers = msObj?.optBoolean("showUsers", true) ?: true,
                showWarnings = msObj?.optBoolean("showWarnings", true) ?: true,
                showSpeedCameras = msObj?.optBoolean("showSpeedCameras", true) ?: true,
                showFuelStations = msObj?.optBoolean("showFuelStations", true) ?: true,
                showPartnerPois = msObj?.optBoolean("showPartnerPois", true) ?: true
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
                maneuverModifier = cleanString(dto?.optString("maneuverModifier", "")),
                maneuverExit = nullableInt(dto, "maneuverExit"),
                followingInstruction = cleanString(dto?.optString("followingInstruction", "")),
                followingManeuver = cleanString(dto?.optString("followingManeuver", "")),
                followingManeuverModifier = cleanString(dto?.optString("followingManeuverModifier", "")),
                followingManeuverExit = nullableInt(dto, "followingManeuverExit"),
                followingTurnDistanceMeters = nullableInt(dto, "followingTurnDistanceMeters"),
                upcomingSteps = parseUpcomingSteps(dto),
                remainingDistanceMeters = nullableInt(dto, "remainingDistanceMeters"),
                remainingDurationSec = nullableInt(dto, "remainingDurationSec"),
                turnDistanceMeters = nullableInt(dto, "turnDistanceMeters"),
                mapState = mapState,
                users = parseUsers(root.optJSONArray("users")),
                warnings = parseWarnings(root.optJSONArray("warnings")),
                speedCameras = parsePoiMarkers(msObj?.optJSONArray("speedCameras"), "camera"),
                fuelStations = parsePoiMarkers(msObj?.optJSONArray("fuelStations"), "fuel"),
                partnerPois = parsePoiMarkers(msObj?.optJSONArray("partnerPois"), "partner"),
                routePoints = routePoints
            )
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun parseUpcomingSteps(dto: JSONObject?): List<AutoUpcomingStep> {
        val parsed = mutableListOf<AutoUpcomingStep>()
        val array = dto?.optJSONArray("upcomingSteps")
        if (array != null) {
            for (index in 0 until minOf(array.length(), 3)) {
                val item = array.optJSONObject(index) ?: continue
                parsed += AutoUpcomingStep(
                    instruction = cleanString(item.optString("instruction", "")) ?: "Jedź dalej",
                    maneuver = cleanString(item.optString("maneuver", "")) ?: "",
                    maneuverModifier = cleanString(item.optString("maneuverModifier", "")) ?: "",
                    maneuverExit = nullableInt(item, "maneuverExit"),
                    distanceMeters = nullableInt(item, "distanceMeters"),
                )
            }
        }
        if (parsed.isNotEmpty()) return parsed
        val instruction = cleanString(dto?.optString("followingInstruction", "")) ?: return emptyList()
        return listOf(
            AutoUpcomingStep(
                instruction = instruction,
                maneuver = cleanString(dto?.optString("followingManeuver", "")) ?: "",
                maneuverModifier = cleanString(dto?.optString("followingManeuverModifier", "")) ?: "",
                maneuverExit = nullableInt(dto, "followingManeuverExit"),
                distanceMeters = nullableInt(dto, "followingTurnDistanceMeters"),
            )
        )
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
                    avatarUrl = u.optString("avatarUrl", u.optString("avatar", "")),
                    avatarFrameUrl = u.optString("avatarFrameUrl", ""),
                    distanceLabel = u.optString("distanceLabel", ""),
                    isPremium = u.optBoolean("isPremium", false),
                    isFriend = u.optBoolean("isFriend", u.optString("type", "") == "friend"),
                    markerSpriteUri = u.optString("markerSpriteUri", u.optString("spriteUri", "")),
                    vehicleModelUrl = u.optString("vehicleModelUrl", ""),
                    vehicleModelMeta = u.optJSONObject("vehicleModelMeta")?.toString()
                        ?: u.optString("vehicleModelMeta", "")
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

    private fun parsePoiMarkers(array: JSONArray?, fallbackType: String): List<AutoPoiMarker> =
        parsePoiMarkersPublic(array, fallbackType)

    fun parsePoiMarkersPublic(array: JSONArray?, fallbackType: String): List<AutoPoiMarker> {
        if (array == null) return emptyList()
        val markers = mutableListOf<AutoPoiMarker>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val lat = finiteOrNull(item.optDouble("lat", item.optDouble("latitude", Double.NaN))) ?: continue
            val lng = finiteOrNull(item.optDouble("lng", item.optDouble("longitude", Double.NaN))) ?: continue
            markers.add(
                AutoPoiMarker(
                    id = item.optString("id", "$fallbackType-$i"),
                    lat = lat,
                    lng = lng,
                    label = item.optString("label", item.optString("name", fallbackType)),
                    type = item.optString("type", fallbackType),
                    value = item.optString("value", ""),
                    logoUrl = item.optString("logoUrl", item.optString("brandLogoUrl", "")),
                    accentColor = item.optString("accentColor", item.optString("markerAccentColor", "")),
                    distanceLabel = item.optString("distanceLabel", ""),
                    spriteUri = item.optString("spriteUri", item.optString("markerSpriteUri", ""))
                )
            )
        }
        return markers
    }

    private fun parseSelfMarker(obj: JSONObject?): AutoSelfMarker? {
        if (obj == null) return null
        return AutoSelfMarker(
            style = obj.optString("style", obj.optString("locationMarkerStyle", "")),
            markerSpriteUri = obj.optString("markerSpriteUri", obj.optString("spriteUri", "")),
            vehicleModelUrl = obj.optString("vehicleModelUrl", obj.optString("modelUrl", "")),
            vehicleModelMeta = obj.optJSONObject("vehicleModelMeta")?.toString()
                ?: obj.optString("vehicleModelMeta", obj.optString("metadata", "")),
            modelHealth = obj.optString("modelHealth", "")
        )
    }

    private fun parseGeoDrops(array: JSONArray?): List<AutoGeoDrop> {
        if (array == null) return emptyList()
        val drops = mutableListOf<AutoGeoDrop>()
        for (i in 0 until array.length()) {
            parseGeoDrop(array.optJSONObject(i), i)?.let { drops.add(it) }
        }
        return drops
    }

    private fun parseGeoDrop(obj: JSONObject?, index: Int): AutoGeoDrop? {
        if (obj == null) return null
        val lat = finiteOrNull(obj.optDouble("lat", obj.optDouble("latitude", Double.NaN))) ?: return null
        val lng = finiteOrNull(obj.optDouble("lng", obj.optDouble("longitude", Double.NaN))) ?: return null
        return AutoGeoDrop(
            id = obj.opt("id")?.toString() ?: "drop-$index",
            lat = lat,
            lng = lng,
            label = obj.optString("label", obj.optString("title", obj.optString("name", "Zrzut"))),
            type = obj.optString("type", "drop"),
            status = obj.optString("status", ""),
            radiusM = finiteOrNull(obj.optDouble("radiusM", obj.optDouble("radius", Double.NaN))),
            spriteUri = obj.optString("spriteUri", obj.optString("markerSpriteUri", ""))
        )
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

    private fun parseArcWindow(obj: JSONObject?): AutoArcWindow? {
        if (obj == null) return null
        val points = parsePoints(obj.optJSONArray("points"))
        if (points.size < 2) return null
        return AutoArcWindow(
            points = points,
            baseArcM = finiteOrNull(obj.optDouble("baseArcM", Double.NaN)) ?: 0.0,
            totalM = finiteOrNull(obj.optDouble("totalM", Double.NaN)) ?: 0.0
        )
    }

    private fun finiteOrNull(value: Double?): Double? =
        value?.takeIf { it.isFinite() }

    private fun cleanString(value: String?): String? =
        value?.trim()?.takeIf { it.isNotBlank() && it.lowercase() != "null" }

    private fun nullableInt(obj: JSONObject?, key: String): Int? =
        if (obj != null && obj.has(key) && !obj.isNull(key)) obj.optInt(key) else null
}
