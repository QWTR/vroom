package com.lexuuw.vroom

import android.content.Context
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.car.app.navigation.model.*

class NavigationScreen(carContext: CarContext) : Screen(carContext) {

    private var currentInstruction = "Ładowanie trasy..."
    private var distanceToNext = ""
    private var eta = ""

    init {
        // Odbieraj dane z React Native przez SharedPreferences
        startPolling()
    }

    private fun startPolling() {
        Thread {
            while (true) {
                try {
                    val prefs = carContext.getSharedPreferences("auto_data", Context.MODE_PRIVATE)

                    // React Native zapisuje aktualny krok nawigacji
                    currentInstruction = prefs.getString("nav_instruction", "Jedź prosto") ?: ""
                    distanceToNext     = prefs.getString("nav_distance", "") ?: ""
                    eta                = prefs.getString("nav_eta", "") ?: ""

                    invalidate()
                    Thread.sleep(1000)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }.start()
    }

    override fun onGetTemplate(): Template {
        val navigationInfo = RoutingInfo.Builder()
            .setCurrentStep(
                Step.Builder(currentInstruction)
                    .setManeuver(
                        Maneuver.Builder(Maneuver.TYPE_STRAIGHT).build()
                    )
                    .setRoad(distanceToNext)
                    .build(),
                Distance.create(0.0, Distance.UNIT_METERS)
            )
            .build()

        return NavigationTemplate.Builder()
            .setNavigationInfo(navigationInfo)
            .setActionStrip(
                ActionStrip.Builder()
                    .addAction(
                        Action.Builder()
                            .setTitle("Stop")
                            .setOnClickListener {
                                carContext.getSharedPreferences("auto_data", Context.MODE_PRIVATE)
                                    .edit().putBoolean("nav_stop", true).apply()
                            }
                            .build()
                    )
                    .build()
            )
            .build()
    }
}