package __PACKAGE__.auto

import android.Manifest
import android.content.Intent
import android.content.res.Configuration
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class VroomCarSession : Session() {
    private var carScreen: VroomCarScreen? = null
    private val locationOwner = "android_auto_${System.identityHashCode(this)}"
    @Volatile private var destroyed = false

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                destroyed = true
                AutoLocationForegroundService.release(carContext, locationOwner)
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
        ensureLocationRuntime()
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

    private fun ensureLocationRuntime() {
        if (AutoLocationTracker.hasFineLocationPermission(carContext)) {
            AutoLocationForegroundService.acquire(carContext, locationOwner)
            return
        }
        runCatching {
            carContext.requestPermissions(
                listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                ContextCompat.getMainExecutor(carContext),
            ) { granted, _ ->
                if (destroyed) return@requestPermissions
                if (granted.contains(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    AutoLocationForegroundService.acquire(carContext, locationOwner)
                } else {
                    VroomCarManager.showDriverAlert("Włącz dokładną lokalizację dla nawigacji")
                }
            }
        }.onFailure {
            VroomCarManager.showDriverAlert("Włącz dokładną lokalizację w telefonie")
        }
    }
}
