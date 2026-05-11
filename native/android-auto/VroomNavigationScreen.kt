package __PACKAGE__.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import java.util.TimeZone

class VroomNavigationScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val builder = NavigationTemplate.Builder()

    if (!snapshot.isNavigating) {
      return builder
        .setNavigationInfo(
          MessageInfo.Builder("VROOM")
            .setText("Uruchom nawigacje w aplikacji VROOM na telefonie.")
            .build(),
        )
        .build()
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

  private fun toManeuverType(raw: String): Int {
    val value = raw.lowercase()
    return when {
      "left" in value || "lewo" in value -> Maneuver.TYPE_TURN_NORMAL_LEFT
      "right" in value || "prawo" in value -> Maneuver.TYPE_TURN_NORMAL_RIGHT
      "roundabout" in value || "rondo" in value -> Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW
      "arrive" in value || "destination" in value || "cel" in value -> Maneuver.TYPE_DESTINATION
      "straight" in value || "prosto" in value -> Maneuver.TYPE_STRAIGHT
      else -> Maneuver.TYPE_STRAIGHT
    }
  }
}
