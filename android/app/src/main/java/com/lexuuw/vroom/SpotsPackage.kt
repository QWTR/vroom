package com.lexuuw.vroom

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SpotsPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(
            SpotsModule(ctx),
            UsersModule(ctx), // ✅ dodaj
        )

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}