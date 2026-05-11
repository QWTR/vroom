package __PACKAGE__.auto

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class VroomCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
  override fun onCreateSession(): Session = VroomCarSession()
}
