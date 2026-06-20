package com.lexuuw.vroom.app.auto

data class UserMarker(
    val id: String,
    val lat: Double,
    val lng: Double,
    val label: String,
    val type: String,
    val avatarUrl: String = "",
    val avatarFrameUrl: String = "",
    val distanceLabel: String = "",
    val isPremium: Boolean = false,
    val isFriend: Boolean = false
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

data class AutoPoiMarker(
    val id: String,
    val lat: Double,
    val lng: Double,
    val label: String,
    val type: String,
    val value: String,
    val logoUrl: String = "",
    val accentColor: String = "",
    val distanceLabel: String = ""
)

data class AutoArcWindow(
    val points: List<AutoRoutePoint>,
    val baseArcM: Double,
    val totalM: Double
)

data class MapState(
    val uiMode: String?,
    val searchQuery: String?,
    val mapStyle: String?,
    val hideLocation: Boolean,
    val isDriving: Boolean,
    val isBuilding: Boolean,
    val arrived: Boolean,
    val offRoute: Boolean,
    val routePreview: Boolean,
    val autoPoseActive: Boolean,
    val nativeRoadMatch: Boolean,
    val nativeRoadPose: Boolean,
    val nativeAutoPose: Boolean,
    val nativeRoadMatchedAt: Long,
    val speedKmh: Double,
    val speedLimitKmh: Double?,
    val locationMarkerStyle: String,
    val currentUserAvatarUrl: String,
    val destinationLat: Double?,
    val destinationLng: Double?,
    val routePoints: List<AutoRoutePoint>,
    val autoArcWindow: AutoArcWindow?,
    val autoTargetArcM: Double?,
    val autoRoadBlend: Double,
    val autoPathMode: String?
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
    val maneuverModifier: String?,
    val remainingDistanceMeters: Int?,
    val remainingDurationSec: Int?,
    val turnDistanceMeters: Int?,
    val mapState: MapState,
    val users: List<UserMarker>,
    val warnings: List<WarningMarker>,
    val speedCameras: List<AutoPoiMarker>,
    val fuelStations: List<AutoPoiMarker>,
    val partnerPois: List<AutoPoiMarker>,
    val routePoints: List<AutoRoutePoint>
)
