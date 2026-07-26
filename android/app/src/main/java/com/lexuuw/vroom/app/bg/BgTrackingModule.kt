package com.lexuuw.vroom.app.bg

import android.content.Context
import android.location.Location
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject

class BgTrackingModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    instance = this
  }

  override fun getName(): String = "VroomBgTracking"

  @ReactMethod
  fun startForegroundNotification(promise: Promise) {
    try {
      VroomBgTrackingService.start(reactContext.applicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BG_FG_START", e.message, e)
    }
  }

  @ReactMethod
  fun stopForegroundNotification(promise: Promise) {
    try {
      VroomBgTrackingService.stopNotificationIfIdle(reactContext.applicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BG_FG_STOP", e.message, e)
    }
  }

  @ReactMethod
  fun startDriveTracking(
    mode: String,
    tripSessionId: String?,
    apiUrl: String?,
    authToken: String?,
    promise: Promise
  ) {
    try {
      VroomBgTrackingService.startTracking(
        reactContext.applicationContext,
        mode,
        tripSessionId,
        apiUrl,
        authToken,
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BG_DRIVE_START", e.message, e)
    }
  }

  @ReactMethod
  fun stopDriveTracking(reason: String, promise: Promise) {
    try {
      VroomBgTrackingService.stopTracking(reactContext.applicationContext, reason)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BG_DRIVE_STOP", e.message, e)
    }
  }

  @ReactMethod
  fun getState(promise: Promise) {
    try {
      promise.resolve(jsonToWritableMap(VroomBgTrackingService.readState(reactContext.applicationContext)))
    } catch (e: Exception) {
      promise.reject("BG_STATE", e.message, e)
    }
  }

  @ReactMethod
  fun consumeBufferedLocations(promise: Promise) {
    try {
      promise.resolve(jsonArrayToWritableArray(VroomBgTrackingService.consumeBufferedLocations(reactContext.applicationContext)))
    } catch (e: Exception) {
      promise.reject("BG_BUFFER", e.message, e)
    }
  }

  @ReactMethod
  fun consumeNativeStats(promise: Promise) {
    try {
      promise.resolve(jsonToWritableMap(VroomBgTrackingService.consumeNativeStats(reactContext.applicationContext)))
    } catch (e: Exception) {
      promise.reject("BG_STATS", e.message, e)
    }
  }

  @ReactMethod
  fun getNativeStats(promise: Promise) {
    try {
      promise.resolve(jsonToWritableMap(VroomBgTrackingService.readNativeStats(reactContext.applicationContext)))
    } catch (e: Exception) {
      promise.reject("BG_STATS_READ", e.message, e)
    }
  }

  @ReactMethod
  fun getNativeProgress(promise: Promise) {
    try {
      promise.resolve(jsonToWritableMap(VroomBgTrackingService.readNativeProgress(reactContext.applicationContext)))
    } catch (e: Exception) {
      promise.reject("BG_PROGRESS_READ", e.message, e)
    }
  }

  @ReactMethod
  fun consumeStopFromNotification(promise: Promise) {
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pending = prefs.getBoolean(KEY_STOP_PENDING, false)
    if (pending) {
      prefs.edit().remove(KEY_STOP_PENDING).apply()
      promise.resolve(true)
    } else {
      promise.resolve(false)
    }
  }

  private fun emitStopEvent(reason: String) {
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("reason", reason)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_STOP, payload)
  }

  private fun emitLocationEvent(location: Location, mode: String, source: String, isSeed: Boolean) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_LOCATION, locationToMap(location, mode, source, isSeed))
  }

  companion object {
    const val EVENT_STOP = "VROOM_BG_TRACKING_END"
    const val EVENT_LOCATION = "VROOM_BG_LOCATION"
    const val ACTION_END = "com.lexuuw.vroom.app.action.BG_TRACKING_END"
    private const val PREFS = "vroom_bg_tracking"
    private const val KEY_STOP_PENDING = "stop_from_notification"
    private const val KEY_STOP_REASON = "stop_reason"

    @Volatile
    var instance: BgTrackingModule? = null

    fun notifyStopRequested(context: Context, reason: String = "notification") {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_STOP_PENDING, true)
        .putString(KEY_STOP_REASON, reason)
        .apply()
      instance?.emitStopEvent(reason)
    }

    fun emitLocation(location: Location, mode: String, source: String = "live", isSeed: Boolean = false) {
      instance?.emitLocationEvent(location, mode, source, isSeed)
    }
  }
}

private fun locationToMap(location: Location, mode: String, source: String, isSeed: Boolean): WritableMap =
  Arguments.createMap().apply {
    putDouble("latitude", location.latitude)
    putDouble("longitude", location.longitude)
    if (location.hasSpeed()) putDouble("speed", location.speed.toDouble()) else putNull("speed")
    if (location.hasBearing()) putDouble("heading", location.bearing.toDouble()) else putNull("heading")
    if (location.hasAccuracy()) putDouble("accuracy", location.accuracy.toDouble()) else putNull("accuracy")
    putDouble("timestamp", (if (location.time > 0) location.time else System.currentTimeMillis()).toDouble())
    putString("mode", mode)
    putString("source", source)
    putDouble("receivedAt", System.currentTimeMillis().toDouble())
    putDouble("elapsedRealtimeNanos", location.elapsedRealtimeNanos.toDouble())
    putBoolean("isSeed", isSeed)
  }

private fun jsonToWritableMap(json: JSONObject): WritableMap {
  val map = Arguments.createMap()
  json.keys().forEach { key ->
    when (val value = json.opt(key)) {
      null, JSONObject.NULL -> map.putNull(key)
      is Boolean -> map.putBoolean(key, value)
      is Int -> map.putInt(key, value)
      is Long -> map.putDouble(key, value.toDouble())
      is Double -> map.putDouble(key, value)
      is Number -> map.putDouble(key, value.toDouble())
      is String -> map.putString(key, value)
      is JSONObject -> map.putMap(key, jsonToWritableMap(value))
      is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
      else -> map.putString(key, value.toString())
    }
  }
  return map
}

private fun jsonArrayToWritableArray(json: JSONArray): WritableArray =
  Arguments.createArray().apply {
    for (i in 0 until json.length()) {
      when (val value = json.opt(i)) {
        null, JSONObject.NULL -> pushNull()
        is Boolean -> pushBoolean(value)
        is Int -> pushInt(value)
        is Long -> pushDouble(value.toDouble())
        is Double -> pushDouble(value)
        is Number -> pushDouble(value.toDouble())
        is String -> pushString(value)
        is JSONObject -> pushMap(jsonToWritableMap(value))
        is JSONArray -> pushArray(jsonArrayToWritableArray(value))
        else -> pushString(value.toString())
      }
    }
  }
