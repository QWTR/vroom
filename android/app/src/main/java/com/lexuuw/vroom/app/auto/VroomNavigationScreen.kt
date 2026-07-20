package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Distance
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
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
          .setTitle("Zakoncz")
          .setOnClickListener { VroomCarManager.stopClick() }
          .build(),
      )
      .build()

  private fun routingInfo(snapshot: AutoNavSnapshot): RoutingInfo {
    val meters = (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
      .coerceAtLeast(1)
      .toDouble()
    val cue = AutoInstructionFormatter.cue(
      snapshot.instruction,
      snapshot.destinationName,
      snapshot.maneuver,
      snapshot.maneuverModifier,
      snapshot.maneuverExit,
    )
    return RoutingInfo.Builder()
      .setCurrentStep(
        Step.Builder()
          .setCue(cue)
          .setManeuver(Maneuver.Builder(AutoManeuverResolver.maneuverType(snapshot.maneuver, snapshot.maneuverModifier, snapshot.instruction, cue)).build())
          .build(),
        Distance.create(meters, Distance.UNIT_METERS),
      )
      .apply {
        snapshot.followingInstruction.takeIf { it.isNotBlank() }?.let { instruction ->
          val nextCue = AutoInstructionFormatter.cue(
            instruction,
            snapshot.destinationName,
            snapshot.followingManeuver,
            snapshot.followingManeuverModifier,
            snapshot.followingManeuverExit,
          )
          setNextStep(
            Step.Builder()
              .setCue(nextCue)
              .setManeuver(
                Maneuver.Builder(
                  AutoManeuverResolver.maneuverType(snapshot.followingManeuver, snapshot.followingManeuverModifier, instruction, nextCue),
                ).build(),
              )
              .build(),
          )
        }
      }
      .build()
  }

  private fun maneuverType(maneuver: String?, modifier: String?, cue: String?): Int {
    if (isStraightCue(cue)) return Maneuver.TYPE_STRAIGHT
    val type = maneuver?.lowercase(java.util.Locale.US).orEmpty()
    val mod = modifier?.lowercase(java.util.Locale.US).orEmpty()
    return when {
      type == "roundabout" || type == "rotary" || mod.contains("exit") -> Maneuver.TYPE_ROUNDABOUT_ENTER_CW
      type == "merge" && mod.contains("left") -> Maneuver.TYPE_MERGE_LEFT
      type == "merge" && mod.contains("right") -> Maneuver.TYPE_MERGE_RIGHT
      type == "merge" -> Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED
      mod.contains("uturn") && mod.contains("right") -> Maneuver.TYPE_U_TURN_RIGHT
      mod.contains("uturn") -> Maneuver.TYPE_U_TURN_LEFT
      mod.contains("slight left") -> Maneuver.TYPE_TURN_SLIGHT_LEFT
      mod.contains("slight right") -> Maneuver.TYPE_TURN_SLIGHT_RIGHT
      mod.contains("sharp left") -> Maneuver.TYPE_TURN_SHARP_LEFT
      mod.contains("sharp right") -> Maneuver.TYPE_TURN_SHARP_RIGHT
      mod.contains("left") -> Maneuver.TYPE_TURN_NORMAL_LEFT
      mod.contains("right") -> Maneuver.TYPE_TURN_NORMAL_RIGHT
      else -> Maneuver.TYPE_STRAIGHT
    }
  }

  private fun isStraightCue(cue: String?): Boolean {
    val clean = cue?.trim()?.lowercase(java.util.Locale("pl", "PL")).orEmpty()
    return clean == "jedz prosto" || clean == "jedź prosto" || clean.startsWith("jedz prosto ") || clean.startsWith("jedź prosto ")
  }
}
