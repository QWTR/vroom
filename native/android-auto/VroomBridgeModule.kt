package __PACKAGE__.auto

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

import com.facebook.react.modules.core.DeviceEventManagerModule

class VroomBridgeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        VroomCarManager.setBridge(this)
    }

    override fun getName(): String {
        return "VroomBridgeModule"
    }

    /**
     * Wysyła zdarzenie do JS.
     */
    fun sendEvent(eventName: String, params: String?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
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
