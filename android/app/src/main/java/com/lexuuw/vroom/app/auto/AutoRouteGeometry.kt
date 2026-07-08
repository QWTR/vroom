package com.lexuuw.vroom.app.auto

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object AutoRouteGeometry {

    data class RoutePoint(val lat: Double, val lng: Double)

    data class RouteProjection(
        val arcM: Double,
        val distanceM: Double,
        val lat: Double,
        val lng: Double,
        val segmentIndex: Int,
    )

    fun parseRoutePoints(points: JSONArray): List<RoutePoint> = buildList {
        for (i in 0 until points.length()) {
            val p = points.optJSONObject(i) ?: continue
            val lat = p.optDouble("lat", Double.NaN)
            val lng = p.optDouble("lng", Double.NaN)
            if (lat.isFinite() && lng.isFinite()) add(RoutePoint(lat, lng))
        }
    }

    fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val earthRadiusM = 6_371_000.0
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = sin(dLat / 2.0) * sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * sin(dLng / 2.0) * sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return earthRadiusM * 2.0 * atan2(sqrt(clamped), sqrt(1.0 - clamped))
    }

    fun projectOnRoute(
        lat: Double,
        lng: Double,
        points: List<RoutePoint>,
        maxDistanceM: Double,
        minArcM: Double = 0.0,
    ): RouteProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var best: RouteProjection? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val latScale = cos(Math.toRadians((a.lat + b.lat + lat) / 3.0)).coerceAtLeast(0.15)
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
            val arcM = cumM + segM * t
            val distM = distanceMeters(lat, lng, projLat, projLng)
            if (distM <= maxDistanceM) {
                val arcPenalty = if (arcM + 2.0 < minArcM) (minArcM - arcM) * 4.0 else 0.0
                val score = distM + arcPenalty
                if (score < bestScore) {
                    bestScore = score
                    best = RouteProjection(arcM, distM, projLat, projLng, i)
                }
            }
            cumM += segM
        }
        return best
    }

    fun anchorRoutePoints(points: JSONArray, originLat: Double, originLng: Double): JSONArray {
        if (points.length() < 2) return points
        val route = parseRoutePoints(points)
        val projection = projectOnRoute(originLat, originLng, route, 180.0) ?: return points
        val out = JSONArray()
        out.put(JSONObject().apply {
            put("lat", projection.lat)
            put("lng", projection.lng)
        })
        val startIndex = (projection.segmentIndex + 1).coerceAtMost(points.length() - 1)
        for (i in startIndex until points.length()) {
            val point = points.optJSONObject(i) ?: continue
            out.put(JSONObject(point.toString()))
        }
        if (out.length() < 2) {
            val last = points.optJSONObject(points.length() - 1) ?: return points
            out.put(JSONObject(last.toString()))
        }
        return out
    }

    fun trimRouteFromVehicle(
        points: List<RoutePoint>,
        vehicleLat: Double,
        vehicleLng: Double,
        isNavigating: Boolean,
        minArcM: Double = 0.0,
    ): List<RoutePoint> {
        if (points.size < 2) return points
        val maxGapM = if (isNavigating) 45.0 else 250.0
        val projection = projectOnRoute(
            vehicleLat,
            vehicleLng,
            points,
            maxDistanceM = maxGapM,
            minArcM = if (isNavigating) minArcM else 0.0,
        ) ?: return if (isNavigating) emptyList() else points
        if (projection.distanceM > maxGapM) {
            return if (isNavigating) emptyList() else points
        }
        val startIndex = projection.segmentIndex.coerceIn(0, points.size - 2)
        val trimmed = ArrayList<RoutePoint>(points.size - startIndex + 1)
        trimmed.add(RoutePoint(projection.lat, projection.lng))
        for (i in (startIndex + 1) until points.size) {
            trimmed.add(points[i])
        }
        return trimmed.takeIf { it.size >= 2 } ?: if (isNavigating) emptyList() else points
    }

    fun firstStepRequiresUturn(routeRoot: JSONObject): Boolean {
        val route = routeRoot.optJSONArray("routes")?.optJSONObject(0) ?: return false
        val step = route.optJSONArray("legs")?.optJSONObject(0)
            ?.optJSONArray("steps")?.optJSONObject(0) ?: return false
        val maneuver = step.optJSONObject("maneuver") ?: return false
        val modifier = maneuver.optString("modifier", "")
        val type = maneuver.optString("type", "")
        return modifier.contains("uturn", true) || type.contains("uturn", true)
    }

    fun selectBestRoute(routeRoot: JSONObject, preferNoUturn: Boolean): JSONObject {
        val routes = routeRoot.optJSONArray("routes") ?: return routeRoot
        if (!preferNoUturn || routes.length() <= 1) return routeRoot
        for (i in 0 until routes.length()) {
            val candidate = JSONObject(routeRoot.toString()).apply {
                put("routes", JSONArray().apply { put(routes.optJSONObject(i)) })
            }
            if (!firstStepRequiresUturn(candidate)) return candidate
        }
        return routeRoot
    }

    fun bearingsParam(headingDeg: Double?, toleranceDeg: Int = 90): String {
        val heading = headingDeg?.takeIf { it.isFinite() } ?: return ""
        val bearing = (Math.round((((heading % 360.0) + 360.0) % 360.0) / 45.0) * 45).toInt() % 360
        return "&bearings=$bearing,$toleranceDeg;"
    }
}
