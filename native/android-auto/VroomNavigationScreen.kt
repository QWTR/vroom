package __PACKAGE__.auto

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
  override fun onGetTemplate(): Template =
    runCatching { buildNavigationTemplate() }
      .getOrElse { safeMessageTemplate() }

  private fun buildNavigationTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val builder = NavigationTemplate.Builder()
      .setActionStrip(navActionStrip())

    if (!snapshot.isNavigating) {
      return safeMessageTemplate()
    }

    val instruction = snapshot.instruction.ifBlank { "Kontynuuj trase" }
    val turnDistanceMeters = (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
      .coerceAtLeast(1)
    val remainingDistanceMeters = (snapshot.remainingDistanceMeters ?: turnDistanceMeters)
      .coerceAtLeast(1)
    val remainingDurationSec = (snapshot.remainingDurationSec ?: 60).coerceAtLeast(0)
    val arrivalTime = DateTimeWithZone.create(
      System.currentTimeMillis() + remainingDurationSec * 1000L,
      TimeZone.getDefault(),
    )
    val currentStep = Step.Builder(instruction)
      .setManeuver(Maneuver.Builder(toManeuverType(snapshot.maneuver)).build())
      .setRoad(snapshot.destinationName)
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

  private fun safeMessageTemplate(): Template =
    MessageTemplate.Builder("Uruchom nawigacje w aplikacji VROOM na telefonie.")
      .setTitle("VROOM")
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

  private fun navActionStrip(): ActionStrip =
    ActionStrip.Builder()
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
      .addAction(
        Action.Builder()
          .setTitle("Zglos")
          .setOnClickListener {
            runCatching {
              carContext
                .getCarService(ScreenManager::class.java)
                .push(VroomReportScreen(carContext))
            }
          }
          .build(),
      )
      .build()
}
