package com.lexuuw.vroom.app.auto

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class AutoDriverAlertCandidate(
    val id: String,
    val type: String,
    val title: String,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Double,
    val priority: Int,
    val source: String,
)

object AutoDriverAlertPolicy {
    fun isCooldownReady(lastAtMs: Long, nowMs: Long, cooldownMs: Long): Boolean =
        lastAtMs <= 0L || nowMs - lastAtMs >= cooldownMs

    fun select(payload: VroomPayload): AutoDriverAlertCandidate? {
        return candidates(payload)
            .sortedWith(compareByDescending<AutoDriverAlertCandidate> { it.priority }.thenBy { it.distanceMeters })
            .firstOrNull()
    }

    fun selectVoiceEnforcement(payload: VroomPayload): AutoDriverAlertCandidate? =
        candidates(payload)
            .filter(::shouldSpeak)
            .minByOrNull { it.distanceMeters }

    fun shouldSpeak(candidate: AutoDriverAlertCandidate): Boolean {
        if (candidate.source != "camera") return false
        val clean = "${candidate.type} ${candidate.title}".lowercase()
        if (listOf("mobile", "mobil", "polic", "control", "kontrol", "bump", "prog").any(clean::contains)) {
            return false
        }
        return listOf(
            "fixed",
            "camera",
            "radar",
            "fotoradar",
            "section",
            "average",
            "odcink",
            "segment",
        ).any(clean::contains)
    }

    fun voiceTitle(candidate: AutoDriverAlertCandidate): String {
        val clean = "${candidate.type} ${candidate.title}".lowercase()
        return if (listOf("section", "average", "odcink", "segment").any(clean::contains)) {
            "Odcinkowy pomiar prędkości"
        } else {
            "Fotoradar"
        }
    }

    private fun candidates(payload: VroomPayload): List<AutoDriverAlertCandidate> {
        val lat = payload.userLat ?: return emptyList()
        val lng = payload.userLng ?: return emptyList()
        val heading = payload.heading ?: 0.0
        val speedKmh = payload.mapState.speedKmh.coerceAtLeast((payload.speed ?: 0.0) * 3.6)

        val warnings = payload.warnings.mapNotNull { warning ->
            candidate(warning.id, warning.type, warning.label, warning.lat, warning.lng, lat, lng, heading, speedKmh, payload.routePoints, "warning")
        }
        val cameras = payload.speedCameras.mapNotNull { marker ->
            candidate(marker.id, marker.type.ifBlank { "camera" }, marker.label.ifBlank { "Fotoradar" }, marker.lat, marker.lng, lat, lng, heading, speedKmh, payload.routePoints, "camera")
        }
        return warnings + cameras
    }

    fun thresholdMeters(type: String, speedKmh: Double): Double {
        val clean = type.lowercase()
        return when {
            clean.contains("bump") || clean.contains("prog") -> 250.0
            clean.contains("traffic") || clean.contains("korek") || clean.contains("weather") || clean.contains("pogod") -> 1_200.0
            clean.contains("accident") || clean.contains("wypad") || clean.contains("breakdown") || clean.contains("awari") || clean.contains("animal") || clean.contains("zwierz") -> 800.0
            clean.contains("camera") || clean.contains("radar") || clean.contains("fixed") ||
                clean.contains("section") || clean.contains("average") || clean.contains("odcink") ||
                clean.contains("polic") || clean.contains("control") -> if (speedKmh >= 70.0) 1_000.0 else 600.0
            else -> 600.0
        }
    }

    private fun candidate(
        id: String,
        type: String,
        title: String,
        markerLat: Double,
        markerLng: Double,
        userLat: Double,
        userLng: Double,
        heading: Double,
        speedKmh: Double,
        route: List<AutoRoutePoint>,
        source: String,
    ): AutoDriverAlertCandidate? {
        val distance = distanceMeters(userLat, userLng, markerLat, markerLng)
        if (distance > thresholdMeters(type, speedKmh)) return null
        val bearingDelta = angleDelta(heading, bearingDegrees(userLat, userLng, markerLat, markerLng))
        val isAhead = bearingDelta <= 105.0
        val isOnForwardRoute = route.take(100).any { distanceMeters(it.lat, it.lng, markerLat, markerLng) <= 220.0 } && bearingDelta <= 135.0
        if (!isAhead && !isOnForwardRoute) return null
        return AutoDriverAlertCandidate(id, type, title, markerLat, markerLng, distance, priority(type), source)
    }

    private fun priority(type: String): Int {
        val clean = type.lowercase()
        return when {
            clean.contains("accident") || clean.contains("wypad") || clean.contains("animal") || clean.contains("zwierz") -> 5
            clean.contains("breakdown") || clean.contains("awari") || clean.contains("weather") || clean.contains("pogod") -> 4
            clean.contains("camera") || clean.contains("radar") || clean.contains("fixed") ||
                clean.contains("section") || clean.contains("average") || clean.contains("odcink") ||
                clean.contains("polic") -> 3
            clean.contains("bump") || clean.contains("prog") -> 2
            else -> 1
        }
    }

    internal fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val radius = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    private fun bearingDegrees(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dLng = Math.toRadians(lng2 - lng1)
        val y = sin(dLng) * cos(p2)
        val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dLng)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    private fun angleDelta(first: Double, second: Double): Double = min(abs(first - second), 360.0 - abs(first - second))
}
