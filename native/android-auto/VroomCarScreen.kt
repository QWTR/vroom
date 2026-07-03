package __PACKAGE__.auto

import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate

class VroomCarScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback {

    private var latestPayload: VroomPayload? = null
    private val mapRenderer = VroomMapSurfaceRenderer(carContext)

    init {
        // Rejestrujemy powierzchnię mapy tylko raz dla całej sesji.
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        lifecycle.addObserver(mapRenderer)
    }

    override fun onGetTemplate(): Template {
        return buildNavigationTemplate()
    }

    private fun buildNavigationTemplate(): Template {
        return NavigationTemplate.Builder()
            .setActionStrip(recenterActionStrip())
            .build()
    }

    private fun recenterActionStrip(): ActionStrip =
        ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle("\u200B")
                    .setOnClickListener { mapRenderer.recenterFromHost() }
                    .build()
            )
            .build()

    fun updateNativeLocation(lat: Double, lng: Double, speedMs: Double, heading: Double) {
        mapRenderer.updateNativeLocation(lat, lng, speedMs, heading)
    }

    fun syncOverlayDrivingTelemetry(speedLimitKmh: Int?) {
        mapRenderer.syncOverlayDrivingTelemetry(speedLimitKmh)
    }

    fun updateData(jsonPayload: String) {
        val parsed = VroomPayloadParser.parse(jsonPayload)
        if (parsed != null) {
            latestPayload = parsed
            mapRenderer.updateMapWithPayload(parsed)
        } else {
            Log.e("VroomCarScreen", "Nie udało się odczytać danych mapy")
        }
    }

    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        mapRenderer.onSurfaceAvailable(surfaceContainer)
    }

    override fun onVisibleAreaChanged(visibleArea: android.graphics.Rect) {
        mapRenderer.onVisibleAreaChanged(visibleArea)
    }

    override fun onStableAreaChanged(stableArea: android.graphics.Rect) {
        mapRenderer.onStableAreaChanged(stableArea)
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        mapRenderer.onSurfaceDestroyed(surfaceContainer)
    }

    override fun onClick(x: Float, y: Float) {
        mapRenderer.onClick(x, y)
    }

    override fun onScroll(distanceX: Float, distanceY: Float) {
        mapRenderer.onScroll(distanceX, distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        mapRenderer.onScale(focusX, focusY, scaleFactor)
    }
}
