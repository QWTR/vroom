package com.lexuuw.vroom.app.auto

import android.util.Log

object VroomCarManager {
    private var currentScreen: VroomCarScreen? = null

    fun setScreen(screen: VroomCarScreen) {
        currentScreen = screen
        Log.d("VroomCarManager", "Screen registered")
    }

    fun clearScreen() {
        currentScreen = null
        Log.d("VroomCarManager", "Screen cleared")
    }

    fun sendDataToCar(jsonPayload: String) {
        if (currentScreen != null) {
            currentScreen?.updateData(jsonPayload)
        } else {
            Log.w("VroomCarManager", "No active screen to receive data")
        }
    }
}
