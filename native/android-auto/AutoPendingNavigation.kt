package __PACKAGE__.auto

import android.content.Context
import android.content.Intent

object AutoPendingNavigation {
    private const val PREFS = "vroom_auto_pending_nav"
    private const val KEY_URI = "pending_nav_uri"
    private const val KEY_ACTION = "pending_nav_action"
    private const val KEY_QUERY = "pending_nav_query"
    private const val KEY_LAT = "pending_nav_lat"
    private const val KEY_LNG = "pending_nav_lng"
    private const val KEY_MODE = "pending_nav_mode"
    private const val KEY_AUTO_DRIVE = "auto_drive_enabled"

    fun store(context: Context, intent: Intent?) {
        val request = runCatching { AutoNavigationIntentHandler.parse(intent) }.getOrNull() ?: return
        storeRequest(context, request, intent?.action)
    }

    fun storeRequest(context: Context, request: AutoNavigationRequest, action: String? = null) {
        if (!request.hasQuery && !request.hasCoordinates) return
        prefs(context).edit()
            .putString(KEY_QUERY, request.query)
            .putString(KEY_ACTION, action?.takeIf { it.isNotBlank() } ?: "androidx.car.app.action.NAVIGATE")
            .putString(KEY_URI, AutoNavigationIntentHandler.toIntent(request, action ?: "androidx.car.app.action.NAVIGATE").data?.toString().orEmpty())
            .putFloat(KEY_LAT, request.latitude?.toFloat() ?: Float.NaN)
            .putFloat(KEY_LNG, request.longitude?.toFloat() ?: Float.NaN)
            .putString(KEY_MODE, request.intentMode)
            .apply()
        VroomCarManager.dispatchPendingNavigation(context)
    }

    fun peekIntent(context: Context): Intent? = buildIntent(context, consume = false)

    fun consumeIntent(context: Context): Intent? = buildIntent(context, consume = true)

    fun requestAutoDrive(context: Context) {
        prefs(context).edit().putBoolean(KEY_AUTO_DRIVE, true).apply()
        VroomCarManager.dispatchAutoDriveRequest()
    }

    fun consumeAutoDriveRequest(context: Context): Boolean {
        val p = prefs(context)
        val requested = p.getBoolean(KEY_AUTO_DRIVE, false)
        if (requested) p.edit().remove(KEY_AUTO_DRIVE).apply()
        return requested
    }

    private fun buildIntent(context: Context, consume: Boolean): Intent? {
        val p = prefs(context)
        val query = p.getString(KEY_QUERY, null)?.trim()?.takeIf { it.isNotBlank() }
        val lat = p.getFloat(KEY_LAT, Float.NaN).toDouble().takeIf { it.isFinite() }
        val lng = p.getFloat(KEY_LNG, Float.NaN).toDouble().takeIf { it.isFinite() }
        if (query.isNullOrBlank() && (lat == null || lng == null)) return null
        val action = p.getString(KEY_ACTION, null)
            ?.takeIf { it.isNotBlank() }
            ?: "androidx.car.app.action.NAVIGATE"
        val mode = p.getString(KEY_MODE, null)?.takeIf { it.isNotBlank() } ?: "navigation"
        val request = AutoNavigationRequest(
            query = query,
            latitude = lat,
            longitude = lng,
            intentMode = mode,
        )
        if (consume) {
            p.edit()
                .remove(KEY_URI)
                .remove(KEY_ACTION)
                .remove(KEY_QUERY)
                .remove(KEY_LAT)
                .remove(KEY_LNG)
                .remove(KEY_MODE)
                .apply()
        }
        return AutoNavigationIntentHandler.toIntent(request, action)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
