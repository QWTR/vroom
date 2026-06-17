package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver

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
        val speedLimitText = latestPayload?.mapState?.speedLimitKmh?.let { "Limit: ${it.toInt()} km/h" } ?: ""
        val speedText = latestPayload?.let { "Predkosc: ${it.mapState.speedKmh.toInt()} km/h" } ?: "VROOM"

        val actionStripBuilder = ActionStrip.Builder()
            .addAction(Action.Builder().setTitle("Zglos").setOnClickListener {
                VroomCarManager.reportClick()
            }.build())
            .addAction(Action.Builder().setTitle("Szukaj").setOnClickListener {
                VroomCarManager.searchClick()
            }.build())
        if (latestPayload?.isNavigating == true) {
            actionStripBuilder.addAction(Action.Builder().setTitle("Stop").setOnClickListener {
                VroomCarManager.stopClick()
            }.build())
        }
        actionStripBuilder.addAction(Action.APP_ICON)

        val builder = NavigationTemplate.Builder()
        builder.setActionStrip(actionStripBuilder.build())
        
        // Custom message displaying speed
        val step = androidx.car.app.navigation.model.Step.Builder()
            .setCue("$speedLimitText | $speedText")
            .build()
        
        val routingInfo = androidx.car.app.navigation.model.RoutingInfo.Builder()
            .setCurrentStep(step, androidx.car.app.model.Distance.create(1.0, androidx.car.app.model.Distance.UNIT_KILOMETERS))
            .build()
            
        builder.setNavigationInfo(routingInfo)

        return builder.build()
    }

    private fun buildFallbackTemplate(): Template {
        val paneBuilder = Pane.Builder()

        val speedLimitText = latestPayload?.mapState?.speedLimitKmh?.let { "Limit: ${it.toInt()} km/h | " } ?: ""
        val speedText = latestPayload?.let { "Predkosc: ${it.mapState.speedKmh.toInt()} km/h" } ?: "Oczekiwanie na mape..."
        
        paneBuilder.addRow(
            Row.Builder()
                .setTitle("VROOM")
                .addText(speedLimitText + speedText)
                .build()
        )

        return PaneTemplate.Builder(paneBuilder.build())
            .setTitle("VROOM")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }

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
}
