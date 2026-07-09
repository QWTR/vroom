package __PACKAGE__.auto

import android.content.Intent
import android.net.Uri
import java.util.Locale

data class AutoNavigationRequest(
    val query: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val intentMode: String = "navigation",
) {
    val shouldAutoStartNavigation: Boolean get() = intentMode == "navigation"
    val shouldShowRoutePreviewOnly: Boolean get() = intentMode == "directions"
    val hasCoordinates: Boolean
        get() = latitude != null && longitude != null &&
            latitude.isFinite() && longitude.isFinite() &&
            !(kotlin.math.abs(latitude) < 1e-6 && kotlin.math.abs(longitude) < 1e-6)
    val hasQuery: Boolean get() = !query.isNullOrBlank()
}

object AutoNavigationIntentHandler {
    const val EXTRA_QUERY = "q"
    const val EXTRA_QUERY_ALT = "query"
    const val EXTRA_LAT = "latitude"
    const val EXTRA_LNG = "longitude"
    const val EXTRA_LAT_ALT = "lat"
    const val EXTRA_LNG_ALT = "lng"
    const val EXTRA_INTENT_MODE = "intent"

    private val supportedActions = setOf(
        "androidx.car.app.action.NAVIGATE",
        Intent.ACTION_VIEW,
        "android.intent.action.NAVIGATE",
    )

    fun parse(intent: Intent?): AutoNavigationRequest? {
        if (intent == null) return null
        val fromExtras = parseFromExtras(intent)
        val action = intent.action
        if (action == null || action !in supportedActions) return fromExtras
        val uri = intent.data ?: return fromExtras
        if (uri.scheme != "geo") return fromExtras
        val fromUri = parseGeoUri(uri)
        return mergeRequests(fromUri, fromExtras)
    }

    fun toIntent(request: AutoNavigationRequest, action: String = "androidx.car.app.action.NAVIGATE"): Intent {
        return Intent(action).apply {
            if (request.hasQuery) {
                putExtra(EXTRA_QUERY, request.query)
            }
            if (request.hasCoordinates) {
                putExtra(EXTRA_LAT, request.latitude!!)
                putExtra(EXTRA_LNG, request.longitude!!)
            }
            putExtra(EXTRA_INTENT_MODE, request.intentMode)
            if (request.hasCoordinates) {
                data = Uri.parse("geo:${request.latitude},${request.longitude}")
            } else if (request.hasQuery) {
                data = Uri.parse("geo:0,0?q=${Uri.encode(request.query)}")
            }
        }
    }

    fun parseGeoUri(uri: Uri): AutoNavigationRequest? {
        return runCatching { parseGeoUriInternal(uri) }.getOrNull()
    }

    private fun parseFromExtras(intent: Intent): AutoNavigationRequest? {
        val query = intent.getStringExtra(EXTRA_QUERY)?.trim()?.takeIf { it.isNotBlank() }
            ?: intent.getStringExtra(EXTRA_QUERY_ALT)?.trim()?.takeIf { it.isNotBlank() }
        val lat = readDoubleExtra(intent, EXTRA_LAT)
            ?: readDoubleExtra(intent, EXTRA_LAT_ALT)
        val lng = readDoubleExtra(intent, EXTRA_LNG)
            ?: readDoubleExtra(intent, EXTRA_LNG_ALT)
        val intentMode = intent.getStringExtra(EXTRA_INTENT_MODE)
            ?.lowercase(Locale.US)
            ?: "navigation"
        val request = AutoNavigationRequest(
            query = query,
            latitude = lat,
            longitude = lng,
            intentMode = intentMode,
        )
        return if (request.hasQuery || request.hasCoordinates) request else null
    }

    private fun readDoubleExtra(intent: Intent, key: String): Double? {
        if (!intent.hasExtra(key)) return null
        val value = intent.getDoubleExtra(key, Double.NaN)
        return value.takeIf { it.isFinite() }
    }

    private fun mergeRequests(
        primary: AutoNavigationRequest?,
        fallback: AutoNavigationRequest?,
    ): AutoNavigationRequest? {
        if (primary == null) return fallback
        if (fallback == null) return primary
        return AutoNavigationRequest(
            query = primary.query ?: fallback.query,
            latitude = primary.latitude ?: fallback.latitude,
            longitude = primary.longitude ?: fallback.longitude,
            intentMode = primary.intentMode.ifBlank { fallback.intentMode },
        )
    }

    private fun parseGeoUriInternal(uri: Uri): AutoNavigationRequest? {
        val schemeSpecificPart = uri.schemeSpecificPart?.trim().orEmpty()
        if (schemeSpecificPart.isEmpty() || schemeSpecificPart == "/" || schemeSpecificPart == "//") {
            return null
        }

        val parts = schemeSpecificPart.split("?", limit = 2)
        val coordsPart = parts[0].trim().removePrefix("//")
        val queryPart = parts.getOrNull(1).orEmpty()

        val intentMode = queryParam(queryPart, "intent")?.lowercase(Locale.US) ?: "navigation"
        val query = queryParam(queryPart, "q")

        var lat: Double? = null
        var lng: Double? = null
        val coordTokens = coordsPart.split(",")
        if (coordTokens.size >= 2) {
            val parsedLat = coordTokens[0].toDoubleOrNull()
            val parsedLng = coordTokens[1].toDoubleOrNull()
            if (parsedLat != null && parsedLng != null &&
                parsedLat.isFinite() && parsedLng.isFinite() &&
                !(kotlin.math.abs(parsedLat) < 1e-6 && kotlin.math.abs(parsedLng) < 1e-6)
            ) {
                lat = parsedLat
                lng = parsedLng
            }
        }

        val request = AutoNavigationRequest(
            query = query,
            latitude = lat,
            longitude = lng,
            intentMode = intentMode,
        )
        return if (request.hasQuery || request.hasCoordinates) request else null
    }

    private fun queryParam(queryPart: String, name: String): String? {
        if (queryPart.isBlank()) return null
        return queryPart.split("&")
            .mapNotNull { param ->
                val kv = param.split("=", limit = 2)
                if (kv.size == 2 && kv[0] == name) {
                    Uri.decode(kv[1].replace("+", " ")).trim().takeIf { it.isNotBlank() }
                } else {
                    null
                }
            }
            .firstOrNull()
    }
}
