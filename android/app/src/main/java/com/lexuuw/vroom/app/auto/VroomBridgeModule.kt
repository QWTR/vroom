package com.lexuuw.vroom.app.auto

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VroomBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "VroomBridgeModule"
    }

    /**
     * Metoda wywoływana z React Native (JS).
     * Przekazuje dane w formie stringa (JSON) bezpośrednio do ekranu Android Auto.
     */
    @ReactMethod
    fun sendDataToCar(jsonPayload: String) {
        VroomCarManager.sendDataToCar(jsonPayload)
    }
}
