package __PACKAGE__.auto

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object NativeSpeedLimitFetcher {
    private const val EARTH_RADIUS_M = 6_371_000.0
    private val OVERPASS_ENDPOINTS = listOf(
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    )
    private const val SEARCH_RADIUS_M = 25
    private const val MIN_INTERVAL_MS = 20_000L
    private const val MIN_INTERVAL_NAV_MS = 6_000L
    private const val STICKY_LIMIT_MS = 20_000L
    private const val STICKY_LIMIT_DISTANCE_M = 400.0
    private const val STICKY_LIMIT_MS_NAV = 120_000L
    private const val STICKY_LIMIT_DISTANCE_M_NAV = 800.0

    @Volatile private var stickyLimit: Int? = null
    @Volatile private var stickySinceMs = 0L
    @Volatile private var stickyAnchorLat = Double.NaN
    @Volatile private var stickyAnchorLng = Double.NaN
    @Volatile private var lastFetchAt = 0L
    @Volatile private var lastFetchLat = Double.NaN
    @Volatile private var lastFetchLng = Double.NaN
    @Volatile private var inFlight = false

    private val mainHandler = Handler(Looper.getMainLooper())

    fun currentLimit(): Int? = stickyLimit

    fun maybeFetch(lat: Double, lng: Double, navigating: Boolean, jsLimit: Int?) {
        if (jsLimit != null && jsLimit > 0) {
            commitLimit(jsLimit, lat, lng)
            return
        }
        val now = System.currentTimeMillis()
        if (isStickyValid(lat, lng, navigating, now)) return
        val minInterval = if (navigating) MIN_INTERVAL_NAV_MS else MIN_INTERVAL_MS
        val refetchDistM = if (navigating) 50.0 else 200.0
        if (lastFetchAt > 0L) {
            val age = now - lastFetchAt
            val moved = if (lastFetchLat.isFinite() && lastFetchLng.isFinite()) {
                haversineMeters(lastFetchLat, lastFetchLng, lat, lng)
            } else {
                Double.MAX_VALUE
            }
            if (age < minInterval && moved < refetchDistM) return
        }
        if (inFlight) return
        inFlight = true
        val seqLat = lat
        val seqLng = lng
        val seqNav = navigating
        Thread {
            val limit = runCatching { fetchLimit(seqLat, seqLng) }.getOrNull()
            mainHandler.post {
                inFlight = false
                lastFetchAt = System.currentTimeMillis()
                lastFetchLat = seqLat
                lastFetchLng = seqLng
                if (limit != null) commitLimit(limit, seqLat, seqLng)
            }
        }.start()
    }

    private fun commitLimit(limit: Int, lat: Double, lng: Double) {
        val clean = sanitizeLimit(limit) ?: return
        stickyLimit = clean
        stickySinceMs = System.currentTimeMillis()
        stickyAnchorLat = lat
        stickyAnchorLng = lng
    }

    private fun isStickyValid(lat: Double, lng: Double, navigating: Boolean, now: Long): Boolean {
        val limit = stickyLimit ?: return false
        if (limit <= 0) return false
        val age = now - stickySinceMs
        val maxAge = if (navigating) STICKY_LIMIT_MS_NAV else STICKY_LIMIT_MS
        val maxDist = if (navigating) STICKY_LIMIT_DISTANCE_M_NAV else STICKY_LIMIT_DISTANCE_M
        val dist = haversineMeters(lat, lng, stickyAnchorLat, stickyAnchorLng)
        return age <= maxAge && dist <= maxDist
    }

    private fun fetchLimit(lat: Double, lng: Double): Int? {
        val query = """
            [out:json][timeout:8];
            way(around:$SEARCH_RADIUS_M,$lat,$lng)["highway"]["maxspeed"];
            way(around:$SEARCH_RADIUS_M,$lat,$lng)["highway"];
            out geom;
        """.trimIndent()
        for (endpoint in OVERPASS_ENDPOINTS) {
            val body = runCatching { postOverpass(endpoint, query) }.getOrNull() ?: continue
            val json = runCatching { JSONObject(body) }.getOrNull() ?: continue
            val elements = json.optJSONArray("elements") ?: continue
            val limit = pickBestLimit(elements, lat, lng) ?: continue
            return sanitizeLimit(limit)
        }
        return null
    }

    private fun pickBestLimit(elements: JSONArray, lat: Double, lng: Double): Int? {
        var bestLimit: Int? = null
        var bestDist = Double.MAX_VALUE
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            if (el.optString("type") != "way") continue
            val tags = el.optJSONObject("tags") ?: continue
            val highway = tags.optString("highway", "")
            if (highway.isBlank()) continue
            val maxspeed = tags.optString("maxspeed", "")
            val resolved = resolveOsmSpeedLimit(maxspeed, highway) ?: continue
            val geometry = el.optJSONArray("geometry") ?: continue
            val dist = nearestGeometryDistanceM(geometry, lat, lng)
            if (dist < bestDist) {
                bestDist = dist
                bestLimit = resolved
            }
        }
        return bestLimit
    }

    private fun nearestGeometryDistanceM(geometry: JSONArray, lat: Double, lng: Double): Double {
        var best = Double.MAX_VALUE
        for (i in 0 until geometry.length()) {
            val node = geometry.optJSONObject(i) ?: continue
            val nodeLat = node.optDouble("lat", Double.NaN)
            val nodeLng = node.optDouble("lon", Double.NaN)
            if (!nodeLat.isFinite() || !nodeLng.isFinite()) continue
            best = minOf(best, haversineMeters(lat, lng, nodeLat, nodeLng))
        }
        return best
    }

    private fun postOverpass(endpoint: String, query: String): String {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 9_000
            readTimeout = 9_000
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            setRequestProperty("Accept", "application/json")
            outputStream.bufferedWriter().use {
                it.write("data=${URLEncoder.encode(query, "UTF-8")}")
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) throw IllegalStateException("Overpass HTTP $code")
        return body
    }

    private fun resolveOsmSpeedLimit(maxspeedRaw: String, highway: String): Int? {
        parseOsmMaxSpeed(maxspeedRaw)?.let { return it }
        return highwaySpeedFallback(highway)
    }

    private fun parseOsmMaxSpeed(raw: String): Int? {
        if (raw.isBlank()) return null
        val trimmed = raw.trim()
        val compact = trimmed.lowercase().replace("\\s+".toRegex(), "")
        if (compact == "signals" || compact == "variable") return null
        if (compact == "none" || compact == "unlimited") return null
        val plZones = mapOf(
            "pl:urban" to 50,
            "pl:rural" to 90,
            "pl:motorway" to 140,
            "pl:expressway" to 120,
            "pl:living_street" to 20,
        )
        plZones[trimmed.lowercase().replace("\\s+".toRegex(), "")]?.let { return it }
        if (compact.contains("mph")) {
            val mph = compact.replace(Regex("[^\\d]"), "").toIntOrNull() ?: return null
            if (mph in 1..155) return (mph * 1.60934).toInt()
        }
        Regex("^(\\d{1,3})").find(compact)?.groupValues?.getOrNull(1)?.toIntOrNull()?.let {
            if (it in 1..250) return it
        }
        trimmed.replace(Regex("[^\\d]"), "").toIntOrNull()?.let {
            if (it in 1..250) return it
        }
        return null
    }

    private fun highwaySpeedFallback(highway: String): Int? = when (highway.lowercase()) {
        "motorway", "motorway_link" -> 140
        "expressway" -> 120
        "trunk", "trunk_link" -> 120
        "primary", "primary_link" -> 90
        "secondary", "secondary_link" -> 90
        "tertiary", "tertiary_link" -> 70
        "residential" -> 30
        "living_street" -> 20
        "service" -> 20
        else -> null
    }

    private fun sanitizeLimit(limit: Int?): Int? {
        if (limit == null) return null
        if (limit <= 0 || limit > 250) return null
        return limit
    }

    private fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLon / 2) * sin(dLon / 2)
        return EARTH_RADIUS_M * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
