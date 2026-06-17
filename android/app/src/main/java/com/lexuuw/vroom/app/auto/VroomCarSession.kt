package com.lexuuw.vroom.app.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

class VroomCarSession : Session() {

    override fun onCreateScreen(intent: Intent): Screen {
        val screen = VroomCarScreen(carContext)
        // Rejestrujemy screen w naszym bridge, aby można było do niego wypychać dane
        VroomCarManager.setScreen(screen)
        return screen
    }

    override fun onDestroy() {
        super.onDestroy()
        VroomCarManager.clearScreen()
    }
}
