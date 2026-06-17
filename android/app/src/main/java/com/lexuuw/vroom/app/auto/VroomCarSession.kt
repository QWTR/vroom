package com.lexuuw.vroom.app.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class VroomCarSession : Session() {

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                VroomCarManager.clearScreen()
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen {
        val screen = VroomCarScreen(carContext)
        // Rejestrujemy screen w naszym bridge, aby można było do niego wypychać dane
        VroomCarManager.setScreen(screen)
        return screen
    }
}
