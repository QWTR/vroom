package __PACKAGE__.auto

import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import kotlin.math.atan2
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

object AutoLiveFleetStore {
    private const val INTERPOLATION_BUFFER_MS = 350L
    private const val EXTRAPOLATION_DECAY_START_MS = 1_000L
    private const val EXTRAPOLATION_MAX_MS = 2_500L
    private const val USER_STALE_MS = 60_000L
    private const val MAX_POINTS = 12

    private data class MotionPoint(val lat: Double, val lng: Double, val at: Long)
    private data class Entry(
        var marker: UserMarker,
        var seq: Long,
        var serverAt: Long,
        var heading: Double,
        var speedMs: Double,
        var motionTier: String,
        var lastReceivedAt: Long,
        val points: ArrayDeque<MotionPoint> = ArrayDeque(),
    )

    private val lock = Any()
    private val entries = linkedMapOf<String, Entry>()
    private var rejectedOldSeq = 0L
    private var receivedEvents = 0L
    private var receivedSnapshots = 0L
    private var packetSamples = 0L
    private var latencyTotalMs = 0L
    private var jitterTotalMs = 0L
    private var lastLatencyMs = -1L
    private var snappedPositions = 0L
    private var rawPositions = 0L
    private var sourceUpdates = 0L
    private var updatedAnnotations = 0L

    fun clear() = synchronized(lock) {
        entries.clear()
    }

    fun remove(userId: String) {
        synchronized(lock) {
            entries.remove(userId)
        }
    }

    fun ingestSnapshot(array: JSONArray, receivedAt: Long = System.currentTimeMillis()) {
        synchronized(lock) {
            receivedSnapshots += 1
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let { ingestLocked(it, receivedAt) }
            }
            pruneLocked(receivedAt)
        }
    }

    fun ingestEvent(obj: JSONObject, receivedAt: Long = System.currentTimeMillis()) {
        synchronized(lock) {
            receivedEvents += 1
            ingestLocked(obj, receivedAt)
            pruneLocked(receivedAt)
        }
    }

    fun renderedUsers(
        nowMs: Long = System.currentTimeMillis(),
        viewerLat: Double? = null,
        viewerLng: Double? = null,
        limit: Int = 40,
    ): List<UserMarker> = synchronized(lock) {
        pruneLocked(nowMs)
        entries.values
            .asSequence()
            .map { entry ->
                val rendered = resolve(entry, nowMs)
                entry.marker.copy(lat = rendered.first, lng = rendered.second)
            }
            .sortedWith(
                compareByDescending<UserMarker> { it.isFriend }
                    .thenBy {
                        if (viewerLat != null && viewerLng != null) {
                            distanceMeters(viewerLat, viewerLng, it.lat, it.lng)
                        } else {
                            0.0
                        }
                    },
            )
            .take(limit.coerceAtLeast(0))
            .toList()
    }

    fun stats(): Map<String, Long> = synchronized(lock) {
        mapOf(
            "users" to entries.size.toLong(),
            "events" to receivedEvents,
            "snapshots" to receivedSnapshots,
            "rejectedOldSeq" to rejectedOldSeq,
            "bufferedPoints" to entries.values.sumOf { it.points.size }.toLong(),
            "averageLatencyMs" to if (packetSamples > 0L) latencyTotalMs / packetSamples else 0L,
            "averageJitterMs" to if (packetSamples > 1L) jitterTotalMs / (packetSamples - 1L) else 0L,
            "snappedPositions" to snappedPositions,
            "rawPositions" to rawPositions,
            "sourceUpdates" to sourceUpdates,
            "updatedAnnotations" to updatedAnnotations,
        )
    }

    fun recordSourceUpdate(annotationCount: Int) {
        synchronized(lock) {
            sourceUpdates += 1
            updatedAnnotations += annotationCount.coerceAtLeast(0)
        }
    }

    private fun ingestLocked(obj: JSONObject, receivedAt: Long) {
        val id = obj.opt("id")?.toString()?.takeIf { it.isNotBlank() } ?: return
        val lat = obj.optDouble("lat", Double.NaN)
        val lng = obj.optDouble("lng", Double.NaN)
        if (!validCoordinate(lat, lng)) return
        val seq = obj.optLong("seq", Long.MIN_VALUE)
        val serverAt = obj.optLong("serverAt", obj.optLong("locationAt", receivedAt))
            .takeIf { it > 0L } ?: receivedAt
        val previous = entries[id]
        if (previous != null) {
            val staleBySeq = seq != Long.MIN_VALUE && previous.seq != Long.MIN_VALUE && seq <= previous.seq
            val staleByTime = seq == Long.MIN_VALUE && serverAt <= previous.serverAt
            if (staleBySeq || staleByTime) {
                rejectedOldSeq += 1
                return
            }
        }

        val marker = UserMarker(
            id = id,
            lat = lat,
            lng = lng,
            label = obj.optString("username", obj.optString("label", "Użytkownik")),
            type = if (obj.optBoolean("isFriend", previous?.marker?.isFriend == true)) "friend" else "user",
            avatarUrl = obj.optString("avatarUrl", obj.optString("avatar", previous?.marker?.avatarUrl.orEmpty())),
            avatarFrameUrl = obj.optString("avatarFrameUrl", previous?.marker?.avatarFrameUrl.orEmpty()),
            distanceLabel = obj.optString("distanceLabel", previous?.marker?.distanceLabel.orEmpty()),
            isPremium = obj.optBoolean("isPremium", previous?.marker?.isPremium == true),
            isFriend = obj.optBoolean("isFriend", previous?.marker?.isFriend == true),
            markerSpriteUri = obj.optString("markerSpriteUri", obj.optString("spriteUri", previous?.marker?.markerSpriteUri.orEmpty())),
            vehicleModelUrl = obj.optString("vehicleModelUrl", previous?.marker?.vehicleModelUrl.orEmpty()),
            vehicleModelMeta = obj.optJSONObject("vehicleModelMeta")?.toString()
                ?: obj.optString("vehicleModelMeta", previous?.marker?.vehicleModelMeta.orEmpty()),
        )
        val entry = previous ?: Entry(
            marker = marker,
            seq = Long.MIN_VALUE,
            serverAt = 0L,
            heading = 0.0,
            speedMs = 0.0,
            motionTier = "reduced",
            lastReceivedAt = receivedAt,
        )
        entry.marker = marker
        entry.seq = seq
        entry.serverAt = serverAt
        entry.heading = obj.optDouble("heading", entry.heading).takeIf { it.isFinite() } ?: entry.heading
        entry.speedMs = when {
            obj.has("speedMps") -> obj.optDouble("speedMps", entry.speedMs)
            obj.has("speedKmh") -> obj.optDouble("speedKmh", entry.speedMs * 3.6) / 3.6
            else -> entry.speedMs
        }.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
        entry.motionTier = obj.optString("motionTier", entry.motionTier)
        entry.lastReceivedAt = receivedAt
        val latencyMs = (receivedAt - serverAt).coerceAtLeast(0L)
        packetSamples += 1
        latencyTotalMs += latencyMs
        if (lastLatencyMs >= 0L) jitterTotalMs += abs(latencyMs - lastLatencyMs)
        lastLatencyMs = latencyMs
        if (obj.optString("positionSource") == "snapped") snappedPositions += 1 else rawPositions += 1
        appendTrail(entry, obj.optJSONArray("trail"))
        appendPoint(entry, MotionPoint(lat, lng, serverAt))
        entries[id] = entry
    }

    private fun appendTrail(entry: Entry, trail: JSONArray?) {
        if (trail == null) return
        for (index in 0 until trail.length()) {
            val point = trail.optJSONObject(index) ?: continue
            val lat = point.optDouble("lat", Double.NaN)
            val lng = point.optDouble("lng", Double.NaN)
            val at = point.optLong("t", 0L)
            if (validCoordinate(lat, lng) && at > 0L) {
                appendPoint(entry, MotionPoint(lat, lng, at))
            }
        }
    }

    private fun appendPoint(entry: Entry, point: MotionPoint) {
        val merged = entry.points
            .filter { it.at != point.at }
            .plus(point)
            .sortedBy { it.at }
            .takeLast(MAX_POINTS)
        entry.points.clear()
        merged.forEach(entry.points::addLast)
    }

    private fun resolve(entry: Entry, nowMs: Long): Pair<Double, Double> {
        val points = entry.points.toList()
        if (points.isEmpty() || entry.motionTier == "reduced") {
            return entry.marker.lat to entry.marker.lng
        }
        if (points.size == 1) {
            return extrapolate(points.last(), entry.heading, entry.speedMs, nowMs - INTERPOLATION_BUFFER_MS)
        }
        val renderAt = nowMs - INTERPOLATION_BUFFER_MS
        if (renderAt <= points.first().at) return points.first().lat to points.first().lng
        for (index in 1 until points.size) {
            val from = points[index - 1]
            val to = points[index]
            if (renderAt <= to.at) {
                val duration = max(1L, to.at - from.at)
                val progress = ((renderAt - from.at).toDouble() / duration.toDouble()).coerceIn(0.0, 1.0)
                return lerp(from.lat, to.lat, progress) to lerp(from.lng, to.lng, progress)
            }
        }
        val last = points.last()
        val previous = points[points.lastIndex - 1]
        val derivedHeading = bearingDegrees(previous.lat, previous.lng, last.lat, last.lng)
        val derivedSpeed = if (last.at > previous.at) {
            distanceMeters(previous.lat, previous.lng, last.lat, last.lng) /
                ((last.at - previous.at).toDouble() / 1_000.0)
        } else {
            0.0
        }
        return extrapolate(
            last,
            if (entry.heading.isFinite()) entry.heading else derivedHeading,
            if (entry.speedMs >= 0.8) entry.speedMs else derivedSpeed,
            renderAt,
        )
    }

    private fun extrapolate(
        point: MotionPoint,
        heading: Double,
        speedMs: Double,
        renderAt: Long,
    ): Pair<Double, Double> {
        val ageMs = (renderAt - point.at).coerceIn(0L, EXTRAPOLATION_MAX_MS)
        if (ageMs <= 0L || speedMs < 0.8) return point.lat to point.lng
        val effectiveMs = if (ageMs <= EXTRAPOLATION_DECAY_START_MS) {
            ageMs.toDouble()
        } else {
            val window = max(1L, EXTRAPOLATION_MAX_MS - EXTRAPOLATION_DECAY_START_MS).toDouble()
            val tail = (ageMs - EXTRAPOLATION_DECAY_START_MS).toDouble()
            EXTRAPOLATION_DECAY_START_MS + tail - (tail * tail) / (2.0 * window)
        }
        return moveAlongBearing(point.lat, point.lng, heading, speedMs * effectiveMs / 1_000.0)
    }

    private fun pruneLocked(nowMs: Long) {
        val iterator = entries.iterator()
        while (iterator.hasNext()) {
            if (nowMs - iterator.next().value.lastReceivedAt > USER_STALE_MS) iterator.remove()
        }
    }

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() && lat in -90.0..90.0 && lng in -180.0..180.0

    private fun lerp(from: Double, to: Double, t: Double): Double = from + (to - from) * t

    private fun moveAlongBearing(lat: Double, lng: Double, heading: Double, distanceM: Double): Pair<Double, Double> {
        if (distanceM <= 0.0) return lat to lng
        val radiusM = 6_371_000.0
        val bearing = Math.toRadians(heading)
        val lat1 = Math.toRadians(lat)
        val lng1 = Math.toRadians(lng)
        val lat2 = kotlin.math.asin(
            sin(lat1) * kotlin.math.cos(distanceM / radiusM) +
                cos(lat1) * sin(distanceM / radiusM) * cos(bearing),
        )
        val lng2 = lng1 + atan2(
            sin(bearing) * sin(distanceM / radiusM) * cos(lat1),
            kotlin.math.cos(distanceM / radiusM) - sin(lat1) * sin(lat2),
        )
        return Math.toDegrees(lat2) to Math.toDegrees(lng2)
    }

    private fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val deltaLng = Math.toRadians(toLng - fromLng)
        val y = sin(deltaLng) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLng)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    private fun distanceMeters(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val radiusM = 6_371_000.0
        val lat1 = Math.toRadians(fromLat)
        val lat2 = Math.toRadians(toLat)
        val dLat = lat2 - lat1
        val dLng = Math.toRadians(toLng - fromLng)
        val value = sin(dLat / 2.0) * sin(dLat / 2.0) +
            cos(lat1) * cos(lat2) * sin(dLng / 2.0) * sin(dLng / 2.0)
        return radiusM * 2.0 * atan2(sqrt(value.coerceIn(0.0, 1.0)), sqrt((1.0 - value).coerceIn(0.0, 1.0)))
    }
}
