package com.lexuuw.vroom

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class UsersModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "UsersModule"

    @ReactMethod
    fun saveUsersForAuto(usersJson: String) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit().putString("users", usersJson).apply()
    }

    @ReactMethod
    fun saveMyLocationForAuto(lat: Double, lng: Double) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit()
            .putFloat("my_lat", lat.toFloat())
            .putFloat("my_lng", lng.toFloat())
            .apply()
    }

    // ✅ Dane nawigacji
    @ReactMethod
    fun saveNavStepForAuto(instruction: String, distance: String, eta: String) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit()
            .putString("nav_instruction", instruction)
            .putString("nav_distance", distance)
            .putString("nav_eta", eta)
            .apply()
    }

    // ✅ Cała trasa (punkty do rysowania na mapie)
    @ReactMethod
    fun saveRouteForAuto(routeJson: String) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit().putString("nav_route", routeJson).apply()
    }

    // ✅ Status nawigacji
    @ReactMethod
    fun setNavigatingForAuto(isNavigating: Boolean) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit().putBoolean("is_navigating", isNavigating).apply()
    }

    // ✅ Prędkość i kierunek
    @ReactMethod
    fun saveSpeedHeadingForAuto(speed: Double, heading: Double) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit()
            .putFloat("speed", speed.toFloat())
            .putFloat("heading", heading.toFloat())
            .apply()
    }

    // ✅ Cel nawigacji
    @ReactMethod
    fun saveDestinationForAuto(lat: Double, lng: Double, name: String) {
        reactApplicationContext
            .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            .edit()
            .putFloat("dest_lat", lat.toFloat())
            .putFloat("dest_lng", lng.toFloat())
            .putString("dest_name", name)
            .apply()
    }
    @ReactMethod
    fun checkNavStopRequested(promise: com.facebook.react.bridge.Promise) {
        try {
            val prefs = reactApplicationContext
                .getSharedPreferences("auto_data", Context.MODE_PRIVATE)
            val requested = prefs.getBoolean("nav_stop_requested", false)
            if (requested) {
                prefs.edit().putBoolean("nav_stop_requested", false).apply()
            }
            promise.resolve(requested)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}