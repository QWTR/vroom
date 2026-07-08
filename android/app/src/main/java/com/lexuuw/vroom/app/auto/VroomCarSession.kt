package com.lexuuw.vroom.app.auto

import android.content.Intent
import android.content.res.Configuration
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class VroomCarSession : Session() {
    private var carScreen: VroomCarScreen? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                AutoLocationTracker.stop()
                VroomCarManager.clearScreen()
                carScreen = null
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen {
        VroomCarManager.setAppContext(carContext)
        val screen = VroomCarScreen(carContext)
        screen.setNightModeActive(carContext.resources.configuration.isNightModeActive())
        carScreen = screen
        VroomCarManager.setScreen(screen)
        AutoLocationTracker.start(carContext)
        AutoNavStore.refreshFromBackendIfNeeded(carContext)
        return screen
    }

    override fun onCarConfigurationChanged(newConfiguration: Configuration) {
        carScreen?.setNightModeActive(newConfiguration.isNightModeActive())
    }

    private fun Configuration.isNightModeActive(): Boolean =
        (uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
}
