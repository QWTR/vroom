package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate

class VroomNavigationScreen(carContext: CarContext) : Screen(carContext) {
  companion object {
    private const val TAG = "VroomNavigationScreen"
  }

  override fun onGetTemplate(): Template =
    runCatching {
      AutoNavStore.refreshFromBackendIfNeeded(carContext)
      buildNavigationTemplate()
    }
      .getOrElse {
        Log.e(TAG, "Failed to build navigation template", it)
        hardFallbackTemplate()
      }

  private fun buildNavigationTemplate(): Template =
    NavigationTemplate.Builder()
      .setActionStrip(appIconStrip())
      .setMapActionStrip(mapPanStrip())
      .build()

  private fun hardFallbackTemplate(): Template =
    MessageTemplate.Builder("Nie mozna uruchomic mapy. Sprobuj ponownie.")
      .setTitle("VROOM")
      .build()

  private fun mapPanStrip(): ActionStrip =
    ActionStrip.Builder()
      .addAction(Action.PAN)
      .build()

  private fun appIconStrip(): ActionStrip =
    ActionStrip.Builder()
      .addAction(Action.APP_ICON)
      .build()
}
