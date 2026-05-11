package __PACKAGE__.auto

import androidx.car.app.Screen
import androidx.car.app.Session

class VroomCarSession : Session() {
  override fun onCreateScreen(intent: android.content.Intent): Screen = VroomNavigationScreen(carContext)
}
