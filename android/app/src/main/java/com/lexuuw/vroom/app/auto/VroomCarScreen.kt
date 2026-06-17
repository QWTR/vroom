package com.lexuuw.vroom.app.auto

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
        // Rejestrujemy SurfaceCallback dla renderowania mapy
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        lifecycle.addObserver(mapRenderer)
    }

    override fun onGetTemplate(): Template {
        return try {
            buildNavigationTemplate()
        } catch (e: Exception) {
            Log.e("VroomCarScreen", "Failed to build NavigationTemplate, falling back", e)
            buildFallbackTemplate()
        }
    }

    private fun buildNavigationTemplate(): Template {
        return NavigationTemplate.Builder()
            .setActionStrip(requiredActionStrip())
            .build()
    }

    private fun buildFallbackTemplate(): Template {
        return NavigationTemplate.Builder()
            .setActionStrip(requiredActionStrip())
            .build()
    }

    private fun requiredActionStrip(): ActionStrip =
        ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle("\u200B")
                    .setOnClickListener { }
                    .build()
            )
            .build()

    // --- Metoda wywoływana z React Native ---
    fun updateData(jsonPayload: String) {
        val parsed = VroomPayloadParser.parse(jsonPayload)
        if (parsed != null) {
            latestPayload = parsed
            mapRenderer.updateMapWithPayload(parsed)
            // Invalidujemy ekran, aby np. zaktualizować dane na HUD jeśli potrzeba
            invalidate()
        } else {
            Log.e("VroomCarScreen", "Failed to parse JSON payload")
        }
    }

    // --- SurfaceCallback ---
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
