package com.lexuuw.vroom

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SpotsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SpotsModule"

    @ReactMethod
    fun saveSpotsForAuto(spotsJson: String) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit()
            .putString("spots", spotsJson)
            .apply()
    }
}