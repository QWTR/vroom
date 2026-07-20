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
                AutoNavStore.endNativeTripSession(carContext)
                AutoNavStore.setNativeDistanceOwner(carContext, false)
                VroomCarManager.clearCarContext()
                AutoNavigationCoordinator.detach()
                AutoDriverAlertController.detach()
                VroomCarManager.clearScreen()
                carScreen = null
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen {
        AutoNavigationCoordinator.attach(carContext)
        AutoDriverAlertController.attach(carContext)
        VroomCarManager.setCarContext(carContext)
        VroomCarManager.setAppContext(carContext)
        val screen = VroomCarScreen(carContext)
        screen.setNightModeActive(carContext.resources.configuration.isNightModeActive())
        carScreen = screen
        VroomCarManager.setScreen(screen)
        AutoNavStore.setNativeDistanceOwner(carContext, true)
        AutoLocationTracker.start(carContext)
        AutoNavStore.refreshFromBackendIfNeeded(carContext)
        val pendingIntent = AutoPendingNavigation.consumeIntent(carContext)
        AutoNavigationCoordinator.handleNavigationIntent(carContext, pendingIntent ?: intent)
        VroomCarManager.dispatchPendingNavigation(carContext)
        return screen
    }

    override fun onNewIntent(intent: Intent) {
        AutoNavigationCoordinator.handleNavigationIntent(carContext, intent)
    }

    override fun onCarConfigurationChanged(newConfiguration: Configuration) {
        carScreen?.setNightModeActive(newConfiguration.isNightModeActive())
    }

    private fun Configuration.isNightModeActive(): Boolean =
        (uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
}
