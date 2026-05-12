package __PACKAGE__.auto

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper

object AutoLocationTracker {
  @Volatile private var started = false
  private var listener: LocationListener? = null
  private var locationManager: LocationManager? = null

  @SuppressLint("MissingPermission")
  fun start(context: Context) {
    if (started) return
    started = true
    val appContext = context.applicationContext
    val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
    locationManager = manager

    val updateListener = LocationListener { location ->
      handleLocation(appContext, location)
    }
    listener = updateListener

    runCatching {
      manager.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let { handleLocation(appContext, it) }
    }
    runCatching {
      manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let { handleLocation(appContext, it) }
    }
    runCatching {
      manager.requestLocationUpdates(
        LocationManager.GPS_PROVIDER,
        1500L,
        1f,
        updateListener,
        Looper.getMainLooper(),
      )
    }
    runCatching {
      manager.requestLocationUpdates(
        LocationManager.NETWORK_PROVIDER,
        2500L,
        3f,
        updateListener,
        Looper.getMainLooper(),
      )
    }
  }

  fun stop() {
    val manager = locationManager ?: return
    val currentListener = listener ?: return
    runCatching { manager.removeUpdates(currentListener) }
    listener = null
    started = false
  }

  private fun handleLocation(context: Context, location: Location) {
    val lat = location.latitude
    val lng = location.longitude
    if (!lat.isFinite() || !lng.isFinite()) return
    AutoNavStore.onNativeLocationUpdate(context, lat, lng, location.speed.toDouble(), location.bearing.toDouble())
  }
}
