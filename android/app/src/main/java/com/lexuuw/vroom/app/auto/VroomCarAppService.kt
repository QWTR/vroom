package com.lexuuw.vroom.app.auto

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class VroomCarAppService : CarAppService() {

    override fun createHostValidator(): HostValidator {
        // Allow all hosts for development/beta. Adjust for production if needed.
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    }

    override fun onCreateSession(): Session {
        return VroomCarSession()
    }
}
