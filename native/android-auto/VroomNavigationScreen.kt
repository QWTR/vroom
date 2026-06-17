package __PACKAGE__.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
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
      .setActionStrip(appActionStrip(snapshot))
      .setMapActionStrip(mapPanStrip())

    if (snapshot.isNavigating) {
      builder.setNavigationInfo(routingInfo(snapshot))
    }

    return builder.build()
  }

  private fun hardFallbackTemplate(): Template =
    MessageTemplate.Builder("Nie mozna uruchomic mapy. Sprobuj ponownie.")
      .setTitle("VROOM")
      .build()

  private fun mapPanStrip(): ActionStrip =
    ActionStrip.Builder()
      .addAction(Action.PAN)
      .build()

  private fun appActionStrip(snapshot: AutoNavSnapshot): ActionStrip {
    val manager = carContext.getCarService(ScreenManager::class.java)
    val builder = ActionStrip.Builder()
      .addAction(
        Action.Builder()
          .setTitle("Menu")
          .setOnClickListener { runCatching { manager.push(VroomMenuScreen(carContext)) } }
          .build(),
      )
      .addAction(
        Action.Builder()
          .setTitle("Zglos")
          .setOnClickListener { runCatching { manager.push(VroomReportScreen(carContext)) } }
          .build(),
      )
      .addAction(
        Action.Builder()
          .setTitle("Szukaj")
          .setOnClickListener { runCatching { manager.push(VroomSearchTextScreen(carContext)) } }
          .build(),
      )

    if (snapshot.isNavigating) {
      builder.addAction(
        Action.Builder()
          .setTitle("Stop")
          .setOnClickListener {
            AutoNavStore.stopNavigation(carContext)
            invalidate()
          }
          .build(),
      )
    }

    return builder.build()
  }

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
