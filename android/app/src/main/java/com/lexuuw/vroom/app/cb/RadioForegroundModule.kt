package com.lexuuw.vroom.app.cb

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RadioForegroundModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "VroomCbForeground"
  @ReactMethod fun start(promise: Promise) = try { VroomCbForegroundService.start(reactContext.applicationContext); promise.resolve(true) } catch (error: Exception) { promise.reject("CB_FOREGROUND_START", error.message, error) }
  @ReactMethod fun stop(promise: Promise) = try { VroomCbForegroundService.stop(reactContext.applicationContext); promise.resolve(true) } catch (error: Exception) { promise.reject("CB_FOREGROUND_STOP", error.message, error) }
}
