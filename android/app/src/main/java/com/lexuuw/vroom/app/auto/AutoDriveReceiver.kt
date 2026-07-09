package com.lexuuw.vroom.app.auto

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AutoDriveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            ACTION_ENABLE_AUTO_DRIVE -> {
                AutoPendingNavigation.requestAutoDrive(context.applicationContext)
                AutoNavigationCoordinator.onAutoDriveRequested()
            }
            ACTION_TEST_NAVIGATION -> {
                val query = intent.getStringExtra(AutoNavigationIntentHandler.EXTRA_QUERY)
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?: return
                AutoPendingNavigation.storeRequest(
                    context.applicationContext,
                    AutoNavigationRequest(query = query),
                )
            }
        }
    }

    companion object {
        const val ACTION_ENABLE_AUTO_DRIVE = "com.lexuuw.vroom.app.action.ENABLE_AUTO_DRIVE"
        const val ACTION_TEST_NAVIGATION = "com.lexuuw.vroom.app.action.TEST_NAVIGATION"
    }
}
