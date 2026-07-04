package __PACKAGE__.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class VroomCarSession : Session() {
    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                AutoLocationTracker.stop()
                VroomCarManager.clearScreen()
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen {
        VroomCarManager.setAppContext(carContext)
        val screen = VroomCarScreen(carContext)
        VroomCarManager.setScreen(screen)
        AutoLocationTracker.start(carContext)
        AutoNavStore.refreshFromBackendIfNeeded(carContext)
        return screen
    }
}
