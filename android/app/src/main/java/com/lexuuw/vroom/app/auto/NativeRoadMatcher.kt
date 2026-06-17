package com.lexuuw.vroom.app.auto

import android.location.Location
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque
import java.util.Locale
import kotlin.math.cos

private const val NATIVE_MATCH_EARTH_RADIUS_M = 6_371_000.0
private const val NATIVE_MAPBOX_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"

object NativeRoadMatcher {
    data class NativeRoadPose(
        val lat: Double,
        val lng: Double,
        val heading: Double,
        val distanceM: Double,
        val arcM: Double,
        val roadVersion: Int
    )

    private data class Sample(
        val lat: Double,
        val lng: Double,
        val accuracyM: Float,
        val atMs: Long
    )

    private data class RoadPoint(
        val lat: Double,
        val lng: Double
    )

    private data class RoadProjection(
        val lat: Double,
        val lng: Double,
        val arcM: Double,
        val segmentIndex: Int,
        val distanceM: Double
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val samples = ArrayDeque<Sample>()
    private var latestRoadPoints: List<RoadPoint> = emptyList()
    private var latestRoadAt = 0L
    private var latestRoadVersion = 0
    private var inFlight = false
    private var lastRequestAt = 0L

    fun ingest(location: Location, speedKmh: Double) {
        if (VroomCarManager.hasFreshJsAutoPose()) return
        val lat = location.latitude
        val lng = location.longitude
        if (!lat.isFinite() || !lng.isFinite()) return
        val accuracy = if (location.hasAccuracy()) location.accuracy else 25f
        if (accuracy > 55f) return

        val now = System.currentTimeMillis()
        val last = samples.peekLast()
        if (last != null) {
            val movedM = distanceMeters(last.lat, last.lng, lat, lng)
            if (movedM < 4.0 && now - last.atMs < 1_200L) return
        }

        samples.addLast(Sample(lat, lng, accuracy, now))
        while (samples.size > 14) samples.removeFirst()

        if (speedKmh < 6.0 || samples.size < 2 || inFlight || now - lastRequestAt < 1_600L) return
        lastRequestAt = now
        val requestSamples = samples.toList().takeLast(10)
        requestMatch(requestSamples)
    }

    fun reset() {
        samples.clear()
        latestRoadPoints = emptyList()
        latestRoadAt = 0L
        latestRoadVersion += 1
        inFlight = false
        lastRequestAt = 0L
    }

    fun latestRoadJson(): JSONArray? {
        if (!hasFreshRoad()) return null
        return latestRoadPoints.toJsonArray()
    }

    fun snapToRoad(lat: Double, lng: Double, maxDistanceM: Double = 70.0): NativeRoadPose? {
        if (!hasFreshRoad()) return null
        val road = latestRoadPoints
        val projection = projectOnRoad(lat, lng, road, maxDistanceM) ?: return null
        return NativeRoadPose(
            lat = projection.lat,
            lng = projection.lng,
            heading = roadHeadingAt(road, projection.segmentIndex),
            distanceM = projection.distanceM,
            arcM = projection.arcM,
            roadVersion = latestRoadVersion
        )
    }

    fun stepAlongRoad(lat: Double, lng: Double, meters: Double, maxDistanceM: Double = 95.0): NativeRoadPose? {
        if (meters <= 0.0 || !hasFreshRoad()) return null
        val road = latestRoadPoints
        val projection = projectOnRoad(lat, lng, road, maxDistanceM) ?: return null
        val point = pointAtArc(road, projection.arcM + meters) ?: return null
        val pointProjection = projectOnRoad(point.lat, point.lng, road, maxDistanceM) ?: projection
        return NativeRoadPose(
            lat = point.lat,
            lng = point.lng,
            heading = roadHeadingAt(road, pointProjection.segmentIndex),
            distanceM = projection.distanceM,
            arcM = pointProjection.arcM,
            roadVersion = latestRoadVersion
        )
    }

    private fun requestMatch(requestSamples: List<Sample>) {
        inFlight = true
        Thread {
            val matched = runCatching {
                val coords = requestSamples.joinToString(";") {
                    "${formatCoord(it.lng)},${formatCoord(it.lat)}"
                }
                val radiuses = requestSamples.joinToString(";") {
                    String.format(Locale.US, "%.0f", it.accuracyM.coerceIn(5f, 35f))
                }
                val url = URL(
                    "https://api.mapbox.com/matching/v5/mapbox/driving/$coords" +
                        "?geometries=geojson&overview=full&tidy=true&radiuses=$radiuses&access_token=$NATIVE_MAPBOX_TOKEN"
                )
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 2_200
                conn.readTimeout = 2_200
                conn.requestMethod = "GET"
                conn.inputStream.use { stream ->
                    parseMatch(String(stream.readBytes(), Charsets.UTF_8))
                }
            }.getOrNull()

            mainHandler.post {
                inFlight = false
                if (matched != null && matched.length() >= 2) {
                    val road = roadPointsFromJson(matched)
                    if (road.size >= 2) {
                        latestRoadPoints = road
                        latestRoadAt = System.currentTimeMillis()
                        latestRoadVersion += 1
                    }
                    VroomCarManager.updateNativeRoadGeometry(matched)
                }
            }
        }.start()
    }

    private fun parseMatch(body: String): JSONArray? {
        val root = JSONObject(body)
        val matchings = root.optJSONArray("matchings") ?: return null
        val first = matchings.optJSONObject(0) ?: return null
        if (first.optDouble("confidence", 0.0) < 0.08) return null
        val geometry = first.optJSONObject("geometry") ?: return null
        val coords = geometry.optJSONArray("coordinates") ?: return null
        val points = JSONArray()
        for (i in 0 until coords.length()) {
            val pair = coords.optJSONArray(i) ?: continue
            val lng = pair.optDouble(0, Double.NaN)
            val lat = pair.optDouble(1, Double.NaN)
            if (lat.isFinite() && lng.isFinite()) {
                points.put(JSONObject().apply {
                    put("lat", lat)
                    put("lng", lng)
                })
            }
        }
        return points.takeIf { it.length() >= 2 }
    }

    private fun hasFreshRoad(): Boolean =
        latestRoadPoints.size >= 2 && System.currentTimeMillis() - latestRoadAt < 18_000L

    private fun roadPointsFromJson(points: JSONArray): List<RoadPoint> {
        val out = mutableListOf<RoadPoint>()
        for (i in 0 until points.length()) {
            val obj = points.optJSONObject(i) ?: continue
            val lat = obj.optDouble("lat", Double.NaN)
            val lng = obj.optDouble("lng", Double.NaN)
            if (lat.isFinite() && lng.isFinite()) {
                val last = out.lastOrNull()
                if (last == null || distanceMeters(last.lat, last.lng, lat, lng) >= 0.5) {
                    out.add(RoadPoint(lat, lng))
                }
            }
        }
        return out
    }

    private fun List<RoadPoint>.toJsonArray(): JSONArray {
        val arr = JSONArray()
        forEach { point ->
            arr.put(JSONObject().apply {
                put("lat", point.lat)
                put("lng", point.lng)
            })
        }
        return arr
    }

    private fun projectOnRoad(
        lat: Double,
        lng: Double,
        points: List<RoadPoint>,
        maxDistanceM: Double
    ): RoadProjection? {
        if (points.size < 2) return null
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestDistance = Double.POSITIVE_INFINITY
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
            val distM = distanceMeters(lat, lng, projLat, projLng)
            if (distM < bestDistance) {
                bestDistance = distM
                best = RoadProjection(
                    lat = projLat,
                    lng = projLng,
                    arcM = cumM + segM * t,
                    segmentIndex = i,
                    distanceM = distM
                )
            }
            cumM += segM
        }
        return best?.takeIf { bestDistance <= maxDistanceM }
    }

    private fun pointAtArc(points: List<RoadPoint>, arcM: Double): RoadPoint? {
        if (points.size < 2) return null
        var remaining = arcM.coerceAtLeast(0.0)
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            if (remaining <= segM) {
                val t = (remaining / segM).coerceIn(0.0, 1.0)
                return RoadPoint(
                    lat = a.lat + (b.lat - a.lat) * t,
                    lng = a.lng + (b.lng - a.lng) * t
                )
            }
            remaining -= segM
        }
        return points.lastOrNull()
    }

    private fun roadHeadingAt(points: List<RoadPoint>, segmentIndex: Int): Double {
        val i = segmentIndex.coerceIn(0, points.size - 2)
        val a = points[i]
        val b = points[i + 1]
        return bearingDegrees(a.lat, a.lng, b.lat, b.lng)
    }

    private fun formatCoord(value: Double): String =
        String.format(Locale.US, "%.6f", value)

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val a = kotlin.math.sin(dLat / 2.0) * kotlin.math.sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * kotlin.math.sin(dLng / 2.0) * kotlin.math.sin(dLng / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return NATIVE_MATCH_EARTH_RADIUS_M * 2.0 * kotlin.math.atan2(Math.sqrt(clamped), Math.sqrt(1.0 - clamped))
    }

    private fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLng = Math.toRadians(toLng - fromLng)
        val y = kotlin.math.sin(dLng) * cos(lat2)
        val x = cos(lat1) * kotlin.math.sin(lat2) - kotlin.math.sin(lat1) * cos(lat2) * cos(dLng)
        return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
    }
}
