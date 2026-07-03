package __PACKAGE__.auto

import android.location.Location
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque
import java.util.Locale
import kotlin.math.cos

private const val NATIVE_MATCH_EARTH_RADIUS_M = 6_371_000.0
private const val AUTO_OSRM_BASE = "https://v-room.app/osrm"

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
        val bearing: Double?,
        val elapsedNanos: Long,
        val timestampSec: Long
    )

    private data class RoadPoint(val lat: Double, val lng: Double)

    private data class RoadProjection(
        val lat: Double,
        val lng: Double,
        val arcM: Double,
        val segmentIndex: Int,
        val distanceM: Double
    )

    private data class MatchResult(
        val geometry: JSONArray,
        val matchedLat: Double?,
        val matchedLng: Double?,
        val roadIds: Set<String>
    )

    private data class NearestCandidate(
        val point: RoadPoint,
        val roadIds: Set<String>,
        val distanceM: Double
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val samples = ArrayDeque<Sample>()
    private var latestRoadPoints: List<RoadPoint> = emptyList()
    private var latestRoadAt = 0L
    private var latestRoadVersion = 0
    private var latestMatchedLat = Double.NaN
    private var latestMatchedLng = Double.NaN
    private var latestMatchedArcM = Double.NaN
    private var latestMatchedHeading = 0.0
    private var latestMatchedAt = 0L
    private var currentRoadIds: Set<String> = emptySet()
    private var inFlight = false
    private var lastRequestAtElapsedMs = 0L
    private var lastRequestLat = Double.NaN
    private var lastRequestLng = Double.NaN
    private var lastRequestBearing = Double.NaN

    fun ingest(location: Location, speedKmh: Double) {
        val lat = location.latitude
        val lng = location.longitude
        if (!lat.isFinite() || !lng.isFinite()) return
        val accuracy = if (location.hasAccuracy()) location.accuracy else 25f
        if (accuracy > 55f) return

        val nowElapsedNanos = SystemClock.elapsedRealtimeNanos()
        val elapsedNanos = location.elapsedRealtimeNanos.takeIf { it > 0L } ?: nowElapsedNanos
        val ageMs = (nowElapsedNanos - elapsedNanos).coerceAtLeast(0L) / 1_000_000L
        if (ageMs > 1_000L) return
        val elapsedMs = elapsedNanos / 1_000_000L
        val last = samples.peekLast()
        if (last != null) {
            val movedM = distanceMeters(last.lat, last.lng, lat, lng)
            val sinceLastMs = (elapsedNanos - last.elapsedNanos).coerceAtLeast(0L) / 1_000_000L
            if (movedM < 1.0 && sinceLastMs < 700L) return
        }

        val bearing = location.bearing.toDouble()
            .takeIf { location.hasBearing() && it.isFinite() && speedKmh >= 3.0 }
            ?.let { (it % 360.0 + 360.0) % 360.0 }
        val timestampSec = (System.currentTimeMillis() - ageMs) / 1_000L
        if (last != null && timestampSec <= last.timestampSec) return
        samples.addLast(Sample(lat, lng, accuracy, bearing, elapsedNanos, timestampSec))
        while (samples.size > 16) samples.removeFirst()

        if (!hasFreshRoad() && bootstrapNeedsRefresh() && !inFlight) {
            lastRequestAtElapsedMs = elapsedMs
            requestNearestBootstrap(samples.peekLast())
            return
        }

        if (speedKmh < 2.0 || samples.size < 2 || inFlight) return
        val requestIntervalMs = if (speedKmh >= 80.0) 1_800L else 2_500L
        if (elapsedMs - lastRequestAtElapsedMs < requestIntervalMs) return
        val movedSinceRequest = if (lastRequestLat.isFinite() && lastRequestLng.isFinite()) {
            distanceMeters(lastRequestLat, lastRequestLng, lat, lng)
        } else Double.POSITIVE_INFINITY
        val bearingChange = if (bearing != null && lastRequestBearing.isFinite()) {
            kotlin.math.abs(((bearing - lastRequestBearing + 540.0) % 360.0) - 180.0)
        } else 0.0
        val roadNeedsRefresh = !hasFreshRoad() || System.currentTimeMillis() - latestRoadAt >= 7_000L
        val movementGateM = ((speedKmh / 3.6) * 0.65).coerceIn(8.0, 24.0)
        if (!roadNeedsRefresh && movedSinceRequest < movementGateM && bearingChange < 24.0) return
        lastRequestAtElapsedMs = elapsedMs
        lastRequestLat = lat
        lastRequestLng = lng
        lastRequestBearing = bearing ?: lastRequestBearing
        requestMatch(samples.toList().takeLast(12))
    }

    fun reset() {
        samples.clear()
        latestRoadPoints = emptyList()
        latestRoadAt = 0L
        latestRoadVersion += 1
        latestMatchedLat = Double.NaN
        latestMatchedLng = Double.NaN
        latestMatchedArcM = Double.NaN
        latestMatchedHeading = 0.0
        latestMatchedAt = 0L
        currentRoadIds = emptySet()
        inFlight = false
        lastRequestAtElapsedMs = 0L
        lastRequestLat = Double.NaN
        lastRequestLng = Double.NaN
        lastRequestBearing = Double.NaN
    }

    fun latestRoadJson(): JSONArray? {
        if (!hasFreshRoad()) return null
        return latestRoadPoints.toJsonArray()
    }

    fun hasFreshRoadGeometry(): Boolean = hasFreshRoad()

    fun hasFreshBootstrapPose(): Boolean =
        latestMatchedLat.isFinite() && latestMatchedLng.isFinite() &&
            System.currentTimeMillis() - latestMatchedAt <= 18_000L

    private fun bootstrapNeedsRefresh(): Boolean =
        !hasFreshBootstrapPose() || System.currentTimeMillis() - latestMatchedAt >= 3_000L

    fun latestMatchedArc(): Double? =
        latestMatchedArcM.takeIf { hasFreshRoad() && it.isFinite() }

    fun latestRoadLength(): Double? =
        latestRoadPoints.takeIf { hasFreshRoad() && it.size >= 2 }?.let(::roadLengthMeters)

    fun latestRoadVersion(): Int =
        if (hasFreshRoad()) latestRoadVersion else 0

    fun snapToRoad(lat: Double, lng: Double, maxDistanceM: Double = 70.0): NativeRoadPose? {
        if (!hasFreshRoad()) {
            if (!hasFreshBootstrapPose()) return null
            return NativeRoadPose(
                latestMatchedLat,
                latestMatchedLng,
                latestMatchedHeading,
                distanceMeters(lat, lng, latestMatchedLat, latestMatchedLng),
                0.0,
                latestRoadVersion
            )
        }
        val road = latestRoadPoints
        val closeToLatestMatch = latestMatchedLat.isFinite() && latestMatchedLng.isFinite() &&
            distanceMeters(lat, lng, latestMatchedLat, latestMatchedLng) <= 90.0
        val projection = if (closeToLatestMatch && latestMatchedArcM.isFinite()) {
            projectOnRoadWindow(lat, lng, road, latestMatchedArcM, 55.0, 90.0, maxDistanceM)
                ?: projectOnRoad(lat, lng, road, maxDistanceM)
        } else {
            projectOnRoad(lat, lng, road, maxDistanceM)
        } ?: return null
        return NativeRoadPose(
            projection.lat,
            projection.lng,
            roadHeadingAt(road, projection.segmentIndex),
            projection.distanceM,
            projection.arcM,
            latestRoadVersion
        )
    }

    fun stepAlongRoad(lat: Double, lng: Double, meters: Double, maxDistanceM: Double = 95.0): NativeRoadPose? {
        if (meters <= 0.0 || !hasFreshRoad()) return null
        val road = latestRoadPoints
        val projection = projectOnRoadWindow(
            lat, lng, road, latestMatchedArcM.takeIf { it.isFinite() } ?: 0.0, 220.0, 100.0, maxDistanceM
        ) ?: projectOnRoad(lat, lng, road, maxDistanceM) ?: return null
        val point = pointAtArc(road, projection.arcM + meters) ?: return null
        val pointProjection = projectOnRoadWindow(
            point.lat, point.lng, road, projection.arcM + meters, 8.0, 8.0, maxDistanceM
        ) ?: projection
        return NativeRoadPose(
            point.lat,
            point.lng,
            roadHeadingAt(road, pointProjection.segmentIndex),
            projection.distanceM,
            pointProjection.arcM,
            latestRoadVersion
        )
    }

    private fun requestNearestBootstrap(sample: Sample) {
        inFlight = true
        Thread {
            val result = runCatching {
                chooseNearestCandidate(requestNearestCandidates(sample))
                    ?: throw IllegalStateException("OSRM nie znalazł drogi w pobliżu")
            }
            result.exceptionOrNull()?.let { error ->
                Log.w("NativeRoadMatcher", "Początkowe dopasowanie drogi nie powiodło się", error)
            }
            mainHandler.post {
                inFlight = false
                result.getOrNull()?.let { candidate ->
                    latestMatchedLat = candidate.point.lat
                    latestMatchedLng = candidate.point.lng
                    latestMatchedHeading = sample.bearing ?: latestMatchedHeading
                    latestMatchedAt = System.currentTimeMillis()
                    if (candidate.roadIds.isNotEmpty()) currentRoadIds = candidate.roadIds
                    latestRoadVersion += 1
                }
            }
        }.start()
    }

    private fun requestMatch(requestSamples: List<Sample>) {
        inFlight = true
        Thread {
            val result = runCatching {
                val coords = requestSamples.joinToString(";") { "${formatCoord(it.lng)},${formatCoord(it.lat)}" }
                val radiuses = requestSamples.joinToString(";") {
                    String.format(Locale.US, "%.1f", it.accuracyM.toDouble().coerceIn(6.0, 55.0))
                }
                val bearings = requestSamples.joinToString(";") {
                    it.bearing?.let { value -> String.format(Locale.US, "%.1f,55", value) }.orEmpty()
                }
                val timestamps = requestSamples.joinToString(";") { it.timestampSec.toString() }
                val url = URL(
                    "$AUTO_OSRM_BASE/match/v1/driving/$coords" +
                        "?geometries=geojson&overview=full&steps=false&tidy=true&gaps=ignore" +
                        "&radiuses=$radiuses&bearings=$bearings&timestamps=$timestamps"
                )
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 2_200
                conn.readTimeout = 2_200
                conn.requestMethod = "GET"
                conn.setRequestProperty("Accept", "application/json")
                val responseCode = conn.responseCode
                val stream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.use { String(it.readBytes(), Charsets.UTF_8) }.orEmpty()
                if (responseCode !in 200..299) {
                    throw IllegalStateException("OSRM dopasowanie HTTP $responseCode: ${body.take(180)}")
                }
                parseMatch(body) ?: throw IllegalStateException("OSRM nie zwrócił użytecznej geometrii")
            }
            result.exceptionOrNull()?.let { error -> Log.w("NativeRoadMatcher", "Dopasowanie drogi nie powiodło się", error) }
            val matched = result.getOrNull() ?: runCatching { requestNearestFallback(requestSamples) }
                .onFailure { error -> Log.w("NativeRoadMatcher", "Awaryjne dopasowanie do najbliższej drogi nie powiodło się", error) }
                .getOrNull()

            mainHandler.post {
                inFlight = false
                if (matched != null && matched.geometry.length() >= 2) {
                    val road = roadPointsFromJson(matched.geometry)
                    if (road.size >= 2) {
                        latestRoadPoints = road
                        latestRoadAt = System.currentTimeMillis()
                        latestRoadVersion += 1
                        latestMatchedAt = System.currentTimeMillis()
                        if (matched.roadIds.isNotEmpty()) currentRoadIds = matched.roadIds
                        val matchedProjection = if (matched.matchedLat != null && matched.matchedLng != null) {
                            projectOnRoad(matched.matchedLat, matched.matchedLng, road, 45.0)
                        } else null
                        if (matchedProjection != null) {
                            latestMatchedLat = matchedProjection.lat
                            latestMatchedLng = matchedProjection.lng
                            latestMatchedArcM = matchedProjection.arcM
                            latestMatchedHeading = roadHeadingAt(road, matchedProjection.segmentIndex)
                        } else {
                            val last = road.last()
                            latestMatchedLat = last.lat
                            latestMatchedLng = last.lng
                            latestMatchedArcM = roadLengthMeters(road)
                        }
                        VroomCarManager.updateNativeRoadGeometry(matched.geometry)
                    }
                }
            }
        }.start()
    }

    private fun requestNearestFallback(requestSamples: List<Sample>): MatchResult? {
        val latestSample = requestSamples.lastOrNull() ?: return null
        val snappedLatest = chooseNearestCandidate(requestNearestCandidates(latestSample)) ?: return null
        val fallbackRoad = latestRoadPoints.toMutableList()
        if (fallbackRoad.isEmpty() && requestSamples.size >= 2) {
            chooseNearestCandidate(requestNearestCandidates(requestSamples.first()))?.point?.let(fallbackRoad::add)
        }
        val previous = fallbackRoad.lastOrNull()
        if (previous == null || distanceMeters(previous.lat, previous.lng, snappedLatest.point.lat, snappedLatest.point.lng) >= 0.5) {
            fallbackRoad.add(snappedLatest.point)
        }
        while (fallbackRoad.size > 18) fallbackRoad.removeAt(0)
        if (fallbackRoad.size < 2) return null
        return MatchResult(
            fallbackRoad.toJsonArray(),
            snappedLatest.point.lat,
            snappedLatest.point.lng,
            snappedLatest.roadIds
        )
    }

    private fun chooseNearestCandidate(candidates: List<NearestCandidate>): NearestCandidate? {
        if (candidates.isEmpty()) return null
        return candidates.minByOrNull { candidate ->
            val keepsRoad = currentRoadIds.isNotEmpty() && candidate.roadIds.any(currentRoadIds::contains)
            candidate.distanceM + if (currentRoadIds.isNotEmpty() && !keepsRoad) 32.0 else 0.0
        }
    }

    private fun requestNearestCandidates(sample: Sample): List<NearestCandidate> {
        val url = URL(
            "$AUTO_OSRM_BASE/nearest/v1/driving/${formatCoord(sample.lng)},${formatCoord(sample.lat)}?number=4"
        )
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 1_800
        conn.readTimeout = 1_800
        conn.requestMethod = "GET"
        conn.setRequestProperty("Accept", "application/json")
        val responseCode = conn.responseCode
        val stream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
        val body = stream?.use { String(it.readBytes(), Charsets.UTF_8) }.orEmpty()
        if (responseCode !in 200..299) {
            throw IllegalStateException("OSRM najbliższa droga HTTP $responseCode: ${body.take(180)}")
        }
        val root = JSONObject(body)
        if (root.optString("code", "Ok") != "Ok") return emptyList()
        val waypoints = root.optJSONArray("waypoints") ?: return emptyList()
        val out = mutableListOf<NearestCandidate>()
        for (index in 0 until waypoints.length()) {
            val waypoint = waypoints.optJSONObject(index) ?: continue
            val location = waypoint.optJSONArray("location") ?: continue
            val lng = location.optDouble(0, Double.NaN)
            val lat = location.optDouble(1, Double.NaN)
            if (!lat.isFinite() || !lng.isFinite()) continue
            out += NearestCandidate(
                RoadPoint(lat, lng),
                parseRoadIds(waypoint),
                waypoint.optDouble("distance", Double.POSITIVE_INFINITY)
            )
        }
        return out
    }

    private fun parseMatch(body: String): MatchResult? {
        val root = JSONObject(body)
        val code = root.optString("code", "Ok")
        if (code.isNotBlank() && code != "Ok") return null
        val matchings = root.optJSONArray("matchings") ?: return null
        var bestMatching: JSONObject? = null
        var bestConfidence = Double.NEGATIVE_INFINITY
        var bestMatchingIndex = -1
        for (index in 0 until matchings.length()) {
            val candidate = matchings.optJSONObject(index) ?: continue
            val confidence = candidate.optDouble("confidence", 0.0)
            if (confidence > bestConfidence) {
                bestConfidence = confidence
                bestMatching = candidate
                bestMatchingIndex = index
            }
        }
        if (bestConfidence < 0.25) return null
        val coords = bestMatching?.optJSONObject("geometry")?.optJSONArray("coordinates") ?: return null
        val points = JSONArray()
        for (index in 0 until coords.length()) {
            val pair = coords.optJSONArray(index) ?: continue
            val lng = pair.optDouble(0, Double.NaN)
            val lat = pair.optDouble(1, Double.NaN)
            if (lat.isFinite() && lng.isFinite()) {
                points.put(JSONObject().apply { put("lat", lat); put("lng", lng) })
            }
        }
        if (points.length() < 2) return null
        val tracepoints = root.optJSONArray("tracepoints")
        var matchedLat: Double? = null
        var matchedLng: Double? = null
        var roadIds: Set<String> = emptySet()
        if (tracepoints != null) {
            for (index in tracepoints.length() - 1 downTo 0) {
                val tracepoint = tracepoints.optJSONObject(index) ?: continue
                if (tracepoint.optInt("matchings_index", bestMatchingIndex) != bestMatchingIndex) continue
                val location = tracepoint.optJSONArray("location") ?: continue
                val lng = location.optDouble(0, Double.NaN)
                val lat = location.optDouble(1, Double.NaN)
                if (lat.isFinite() && lng.isFinite()) {
                    matchedLat = lat
                    matchedLng = lng
                    roadIds = parseRoadIds(tracepoint)
                    break
                }
            }
        }
        return MatchResult(points, matchedLat, matchedLng, roadIds)
    }

    private fun parseRoadIds(waypoint: JSONObject): Set<String> {
        val ids = linkedSetOf<String>()
        val nodes = waypoint.optJSONArray("nodes")
        if (nodes != null) {
            for (index in 0 until nodes.length()) {
                val node = nodes.optLong(index, Long.MIN_VALUE)
                if (node != Long.MIN_VALUE) ids += "node:$node"
            }
        }
        waypoint.optString("hint", "").takeIf { it.isNotBlank() }?.let { ids += "hint:${it.take(48)}" }
        return ids
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

    private fun projectOnRoadWindow(
        lat: Double,
        lng: Double,
        points: List<RoadPoint>,
        anchorArcM: Double,
        backwardM: Double,
        forwardM: Double,
        maxDistanceM: Double
    ): RoadProjection? {
        if (points.size < 2) return null
        val minArc = (anchorArcM - backwardM).coerceAtLeast(0.0)
        val maxArc = anchorArcM + forwardM
        var cumM = 0.0
        var best: RoadProjection? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            val segM = distanceMeters(a.lat, a.lng, b.lat, b.lng)
            if (segM < 0.2) continue
            val segmentEnd = cumM + segM
            if (segmentEnd < minArc) {
                cumM = segmentEnd
                continue
            }
            if (cumM > maxArc) break
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
            val arcM = cumM + segM * t
            if (arcM in minArc..maxArc) {
                val projLat = a.lat + (b.lat - a.lat) * t
                val projLng = a.lng + (b.lng - a.lng) * t
                val distM = distanceMeters(lat, lng, projLat, projLng)
                val backwardPenalty = if (arcM < anchorArcM) (anchorArcM - arcM) * 0.4 else 0.0
                val score = distM + backwardPenalty
                if (score < bestScore) {
                    bestScore = score
                    best = RoadProjection(projLat, projLng, arcM, i, distM)
                }
            }
            cumM = segmentEnd
        }
        return best?.takeIf { it.distanceM <= maxDistanceM }
    }

    private fun roadLengthMeters(points: List<RoadPoint>): Double {
        var total = 0.0
        for (i in 0 until points.size - 1) {
            total += distanceMeters(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
        }
        return total
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
