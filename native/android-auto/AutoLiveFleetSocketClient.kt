package __PACKAGE__.auto

import android.content.Context
import io.socket.client.IO
import io.socket.client.Manager
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.ArrayDeque
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object AutoLiveFleetSocketClient {
    private const val API_URL = "https://v-room.app"
    private const val SEND_MIN_INTERVAL_MS = 800L
    private const val SEND_HEARTBEAT_MS = 1_200L
    private const val SEND_MIN_DISTANCE_M = 4.0
    private const val TRAIL_MAX_POINTS = 8

    private var socket: Socket? = null
    private var activeToken = ""
    private var lastSendAt = 0L
    private var lastSendLat = Double.NaN
    private var lastSendLng = Double.NaN
    private var latestPayload: JSONObject? = null
    private var latestPayloadAt = 0L
    private val trail = ArrayDeque<JSONObject>()
    private var reconnects = 0L
    private var publications = 0L

    @Synchronized
    fun start(context: Context) {
        val token = AutoNavStore.authToken(context)
        if (token.isBlank()) return
        if (socket != null && activeToken == token) {
            socket?.connect()
            return
        }
        stop(clearFleet = false)
        activeToken = token
        val options = IO.Options.builder()
            .setAuth(mapOf("token" to token))
            .setReconnection(true)
            .setReconnectionDelay(500)
            .setReconnectionDelayMax(5_000)
            .setTimeout(8_000)
            .build()
        val next = IO.socket(URI.create(API_URL), options)
        socket = next
        next.on(Socket.EVENT_CONNECT) {
            next.emit("live:join")
            transportPayload()?.let { next.emit("location:update", it) }
        }
        next.io().on(Manager.EVENT_RECONNECT) {
            reconnects += 1
        }
        next.on("user:location") { args ->
            parseObject(args.firstOrNull())?.let(AutoLiveFleetStore::ingestEvent)
        }
        next.on("live:users:snapshot") { args ->
            parseArray(args.firstOrNull())?.let(AutoLiveFleetStore::ingestSnapshot)
        }
        next.on("user:offline") { args ->
            val id = when (val value = args.firstOrNull()) {
                is JSONObject -> value.opt("id")?.toString()
                else -> value?.toString()
            }
            if (!id.isNullOrBlank()) AutoLiveFleetStore.remove(id)
        }
        next.connect()
    }

    @Synchronized
    fun stop(clearFleet: Boolean = true) {
        socket?.let { current ->
            if (current.connected()) current.emit("live:leave")
            current.off()
            current.io().off()
            current.disconnect()
            current.close()
        }
        socket = null
        activeToken = ""
        latestPayload = null
        latestPayloadAt = 0L
        trail.clear()
        lastSendAt = 0L
        lastSendLat = Double.NaN
        lastSendLng = Double.NaN
        if (clearFleet) AutoLiveFleetStore.clear()
    }

    @Synchronized
    fun isConnected(): Boolean = socket?.connected() == true

    @Synchronized
    fun restFallbackPayload(): String? = transportPayload()?.toString()

    @Synchronized
    fun publishLocation(
        displayLat: Double,
        displayLng: Double,
        rawLat: Double,
        rawLng: Double,
        accuracyM: Double,
        speedMs: Double,
        heading: Double,
        mode: String,
        snapSource: String,
        snapAgeMs: Long,
    ) {
        if (!validCoordinate(displayLat, displayLng) || !validCoordinate(rawLat, rawLng)) return
        val now = System.currentTimeMillis()
        val movedM = if (lastSendLat.isFinite() && lastSendLng.isFinite()) {
            distanceMeters(lastSendLat, lastSendLng, displayLat, displayLng)
        } else {
            Double.POSITIVE_INFINITY
        }
        if (
            lastSendAt > 0L &&
            now - lastSendAt < SEND_MIN_INTERVAL_MS &&
            movedM < SEND_MIN_DISTANCE_M &&
            now - lastSendAt < SEND_HEARTBEAT_MS
        ) return

        val point = JSONObject()
            .put("lat", displayLat)
            .put("lng", displayLng)
            .put("t", now)
        if (trail.isEmpty() || trail.peekLast().optDouble("lat") != displayLat || trail.peekLast().optDouble("lng") != displayLng) {
            trail.addLast(point)
            while (trail.size > TRAIL_MAX_POINTS) trail.removeFirst()
        }
        val payload = JSONObject()
            .put("lat", displayLat)
            .put("lng", displayLng)
            .put("rawLat", rawLat)
            .put("rawLng", rawLng)
            .put("accuracyM", accuracyM.coerceAtLeast(0.0))
            .put("speedMps", speedMs.coerceAtLeast(0.0))
            .put("speedKmh", speedMs.coerceAtLeast(0.0) * 3.6)
            .put("heading", normalizeHeading(heading))
            .put("mode", mode)
            .put("snapSource", snapSource)
            .put("snapAgeMs", snapAgeMs.coerceAtLeast(0L))
            .put("snapDistanceM", distanceMeters(rawLat, rawLng, displayLat, displayLng))
            .put("trail", JSONArray(trail.toList()))
        latestPayload = payload
        latestPayloadAt = now
        lastSendAt = now
        lastSendLat = displayLat
        lastSendLng = displayLng
        socket?.takeIf { it.connected() }?.emit("location:update", payload)
        publications += 1
    }

    @Synchronized
    fun stats(): Map<String, Any> = mapOf(
        "connected" to isConnected(),
        "reconnects" to reconnects,
        "publications" to publications,
        "bufferedTrailPoints" to trail.size,
    )

    private fun parseObject(value: Any?): JSONObject? = when (value) {
        is JSONObject -> value
        is String -> runCatching { JSONObject(value) }.getOrNull()
        else -> null
    }

    @Synchronized
    private fun transportPayload(): JSONObject? {
        val elapsedMs = System.currentTimeMillis() - latestPayloadAt
        val payload = latestPayload ?: return null
        if (latestPayloadAt <= 0L || elapsedMs !in 0L..2_500L) return null
        return JSONObject(payload.toString()).apply {
            put("snapAgeMs", optLong("snapAgeMs", 0L).coerceAtLeast(0L) + elapsedMs)
        }
    }

    private fun parseArray(value: Any?): JSONArray? = when (value) {
        is JSONArray -> value
        is String -> runCatching { JSONArray(value) }.getOrNull()
        else -> null
    }

    private fun validCoordinate(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() && lat in -90.0..90.0 && lng in -180.0..180.0

    private fun normalizeHeading(value: Double): Double =
        if (value.isFinite()) (value % 360.0 + 360.0) % 360.0 else 0.0

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
