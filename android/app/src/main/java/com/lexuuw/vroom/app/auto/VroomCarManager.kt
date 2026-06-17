package com.lexuuw.vroom.app.auto

import android.util.Log
import org.json.JSONObject

object VroomCarManager {
    private var currentScreen: VroomCarScreen? = null
    private var bridgeModule: VroomBridgeModule? = null
    private var latestPayloadJson: String = ""
    private var nativeNavigationPayloadJson: String? = null

    fun setScreen(screen: VroomCarScreen) {
        currentScreen = screen
        Log.d("VroomCarManager", "Screen registered")
    }

    fun clearScreen() {
        currentScreen = null
        Log.d("VroomCarManager", "Screen cleared")
    }

    fun setBridge(module: VroomBridgeModule) {
        bridgeModule = module
    }

    fun sendDataToCar(jsonPayload: String) {
        val payload = mergeNativeNavigation(jsonPayload)
        latestPayloadJson = payload
        if (currentScreen != null) {
            currentScreen?.updateData(payload)
        } else {
            Log.w("VroomCarManager", "No active screen to receive data")
        }
    }

    fun latestPayload(): VroomPayload? = VroomPayloadParser.parse(latestPayloadJson)

    fun setNativeNavigation(jsonPayload: String) {
        nativeNavigationPayloadJson = jsonPayload
        sendDataToCar(jsonPayload)
    }

    fun clearNativeNavigation() {
        nativeNavigationPayloadJson = null
    }

    fun reportClick() {
        bridgeModule?.sendEvent("onReport", null)
    }

    fun reportTypeClick(type: String) {
        bridgeModule?.sendEvent("onReportType", type)
    }

    fun searchClick() {
        bridgeModule?.sendEvent("onSearch", null)
    }

    fun stopClick() {
        clearNativeNavigation()
        bridgeModule?.sendEvent("onStop", null)
    }

    private fun mergeNativeNavigation(jsonPayload: String): String {
        val nativePayload = nativeNavigationPayloadJson ?: return jsonPayload
        return runCatching {
            val base = JSONObject(jsonPayload)
            if (base.optBoolean("isNavigating", false)) return@runCatching jsonPayload
            val native = JSONObject(nativePayload)
            base.put("isNavigating", true)
            base.put("dto", native.optJSONObject("dto"))
            base.put("destination", native.optJSONObject("destination"))
            base.put("route", native.optJSONArray("route"))
            val baseMap = base.optJSONObject("mapState") ?: JSONObject()
            val nativeMap = native.optJSONObject("mapState")
            if (nativeMap != null) {
                baseMap.put("route", nativeMap.optJSONArray("route"))
                baseMap.put("isDriving", true)
            }
            base.put("mapState", baseMap)
            base.toString()
        }.getOrElse { jsonPayload }
    }
}
