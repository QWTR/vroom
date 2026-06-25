package com.lexuuw.vroom.app.bg

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

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
      VroomBgTrackingService.stop(reactContext.applicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BG_FG_STOP", e.message, e)
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

  private fun emitStopEvent() {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_STOP, null)
  }

  companion object {
    const val EVENT_STOP = "VROOM_BG_TRACKING_END"
    const val ACTION_END = "com.lexuuw.vroom.app.action.BG_TRACKING_END"
    private const val PREFS = "vroom_bg_tracking"
    private const val KEY_STOP_PENDING = "stop_from_notification"

    @Volatile
    var instance: BgTrackingModule? = null

    fun notifyStopRequested(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_STOP_PENDING, true)
        .apply()
      instance?.emitStopEvent()
    }
  }
}
