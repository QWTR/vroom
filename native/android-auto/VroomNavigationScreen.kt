package __PACKAGE__.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import java.util.TimeZone

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
    if (!snapshot.isNavigating) {
      return NavigationTemplate.Builder()
        .setActionStrip(mapActionStrip())
        .build()
    }

    val builder = NavigationTemplate.Builder()
      .setActionStrip(mapActionStrip())

    val idleMapMode = !snapshot.isNavigating
    val instruction = if (idleMapMode) {
      "Tryb mapy aktywny"
    } else {
      snapshot.instruction.ifBlank { "Kontynuuj trase" }
    }
    val turnDistanceMeters = if (idleMapMode) 1 else (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
      .coerceAtLeast(1)
    val remainingDistanceMeters = if (idleMapMode) 1 else (snapshot.remainingDistanceMeters ?: turnDistanceMeters)
      .coerceAtLeast(1)
    val remainingDurationSec = if (idleMapMode) 0 else (snapshot.remainingDurationSec ?: 60).coerceAtLeast(0)
    val arrivalTime = DateTimeWithZone.create(
      System.currentTimeMillis() + remainingDurationSec * 1000L,
      TimeZone.getDefault(),
    )
    val currentStep = Step.Builder(instruction)
      .setManeuver(Maneuver.Builder(if (idleMapMode) Maneuver.TYPE_STRAIGHT else toManeuverType(snapshot.maneuver)).build())
      .setRoad(if (idleMapMode) "VROOM live map" else snapshot.destinationName.ifBlank { "Cel" })
      .build()
    val routingInfo = RoutingInfo.Builder()
      .setCurrentStep(currentStep, Distance.create(turnDistanceMeters.toDouble(), Distance.UNIT_METERS))
      .build()
    val estimate = TravelEstimate.Builder(
      Distance.create(remainingDistanceMeters.toDouble(), Distance.UNIT_METERS),
      arrivalTime,
    )
      .setRemainingTimeSeconds(remainingDurationSec.toLong())
      .build()

    return builder
      .setNavigationInfo(routingInfo)
      .setDestinationTravelEstimate(estimate)
      .build()
  }

  private fun hardFallbackTemplate(): Template =
    MessageTemplate.Builder("Nie mozna uruchomic mapy. Sprobuj ponownie.")
      .setTitle("VROOM Android Auto")
      .build()

  private fun toManeuverType(raw: String): Int {
    val value = raw.lowercase()
    return when {
      "left" in value || "lewo" in value -> Maneuver.TYPE_TURN_NORMAL_LEFT
      "right" in value || "prawo" in value -> Maneuver.TYPE_TURN_NORMAL_RIGHT
      "roundabout" in value || "rondo" in value -> Maneuver.TYPE_STRAIGHT
      "arrive" in value || "destination" in value || "cel" in value -> Maneuver.TYPE_DESTINATION
      "straight" in value || "prosto" in value -> Maneuver.TYPE_STRAIGHT
      else -> Maneuver.TYPE_STRAIGHT
    }
  }

  private fun mapActionStrip(): ActionStrip =
    ActionStrip.Builder()
      .addAction(
        Action.Builder()
          .setTitle("Szukaj")
          .setOnClickListener {
            runCatching {
              carContext
                .getCarService(ScreenManager::class.java)
                .push(VroomSearchTextScreen(carContext))
            }
          }
          .build(),
      )
      .addAction(
        Action.Builder()
          .setTitle("Menu")
          .setOnClickListener {
            runCatching {
              carContext
                .getCarService(ScreenManager::class.java)
                .push(VroomMenuScreen(carContext))
            }
          }
          .build(),
      )
      .build()

}
