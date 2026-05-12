package __PACKAGE__.auto

import androidx.car.app.AppManager
import androidx.car.app.Screen
import androidx.car.app.Session

class VroomCarSession : Session() {
  override fun onCreateScreen(intent: android.content.Intent): Screen {
    runCatching { AutoLocationTracker.start(carContext) }
    runCatching {
      carContext
        .getCarService(AppManager::class.java)
        .setSurfaceCallback(VroomMapSurfaceRenderer(carContext))
    }

    return VroomNavigationScreen(carContext)
  }
}
