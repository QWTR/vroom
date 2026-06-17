package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import org.json.JSONObject

class VroomCarScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback {

    private var latestData: JSONObject? = null

    init {
        // Rejestrujemy SurfaceCallback dla przyszłego renderowania mapy
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
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
        val builder = NavigationTemplate.Builder()
        builder.setActionStrip(
            ActionStrip.Builder()
                .addAction(Action.APP_ICON)
                .build()
        )
        // You can populate NavigationTemplate more here.
        return builder.build()
    }

    private fun buildFallbackTemplate(): Template {
        val paneBuilder = Pane.Builder()
        val dataText = latestData?.toString() ?: "Oczekiwanie na dane z aplikacji..."
        
        paneBuilder.addRow(
            Row.Builder()
                .setTitle("VROOM")
                .addText(dataText)
                .build()
        )

        return PaneTemplate.Builder(paneBuilder.build())
            .setTitle("VROOM")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }

    // --- Metoda wywoływana z React Native ---
    fun updateData(jsonPayload: String) {
        try {
            latestData = JSONObject(jsonPayload)
            // Invalidujemy ekran, co wymusi ponowne wywołanie onGetTemplate()
            invalidate()
        } catch (e: Exception) {
            Log.e("VroomCarScreen", "Invalid JSON payload", e)
        }
    }

    // --- SurfaceCallback ---
    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        Log.d("VroomCarScreen", "Surface available")
        // TODO: Inicjalizacja renderowania mapy na Surface
    }

    override fun onVisibleAreaChanged(visibleArea: android.graphics.Rect) {
        Log.d("VroomCarScreen", "Visible area changed: \$visibleArea")
    }

    override fun onStableAreaChanged(stableArea: android.graphics.Rect) {
        Log.d("VroomCarScreen", "Stable area changed: \$stableArea")
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        Log.d("VroomCarScreen", "Surface destroyed")
        // TODO: Czyszczenie zasobów mapy
    }
}
