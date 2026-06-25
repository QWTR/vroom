package com.lexuuw.vroom.app.bg

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BgTrackingStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != BgTrackingModule.ACTION_END) return
    BgTrackingModule.notifyStopRequested(context.applicationContext)
  }
}
