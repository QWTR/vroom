package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Distance
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step

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

  private fun buildNavigationTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val builder = NavigationTemplate.Builder()
      .setActionStrip(requiredActionStrip())

    if (snapshot.isNavigating) {
      builder.setNavigationInfo(routingInfo(snapshot))
    }

    return builder.build()
  }

  private fun hardFallbackTemplate(): Template =
    MessageTemplate.Builder("Nie mozna uruchomic mapy. Sprobuj ponownie.")
      .setTitle("VROOM")
      .build()

  private fun requiredActionStrip(): ActionStrip =
    ActionStrip.Builder()
      .addAction(
        Action.Builder()
          .setTitle("\u200B")
          .setOnClickListener { }
          .build(),
      )
      .build()

  private fun routingInfo(snapshot: AutoNavSnapshot): RoutingInfo {
    val meters = (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
      .coerceAtLeast(1)
      .toDouble()
    val cue = snapshot.instruction.ifBlank { snapshot.destinationName.ifBlank { "Nawigacja" } }
    return RoutingInfo.Builder()
      .setCurrentStep(
        Step.Builder()
          .setCue(cue)
          .build(),
        Distance.create(meters, Distance.UNIT_METERS),
      )
      .build()
  }
}
