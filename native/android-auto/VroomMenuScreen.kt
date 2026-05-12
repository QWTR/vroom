package __PACKAGE__.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

class VroomMenuScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val manager = carContext.getCarService(ScreenManager::class.java)
    val pane = Pane.Builder()
      .addRow(menuRow("Zgloszenie", "Korek, wypadek, kontrola, pogoda, awaria") {
        manager.push(VroomReportScreen(carContext))
      })
      .addRow(menuRow("Ostrzezenia", "${snapshot.warnings.size} aktywnych na mapie") {
        manager.push(VroomItemsScreen(carContext, VroomItemsKind.WARNINGS))
      })
      .addRow(menuRow("Uzytkownicy live", "${snapshot.users.size} widocznych uzytkownikow") {
        manager.push(VroomItemsScreen(carContext, VroomItemsKind.USERS))
      })
      .addRow(menuRow("Fotoradary", "${snapshot.speedCameras.size} w okolicy") {
        manager.push(VroomItemsScreen(carContext, VroomItemsKind.CAMERAS))
      })
      .addRow(menuRow("Paliwo", "${snapshot.fuelStations.size} stacji na mapie") {
        manager.push(VroomItemsScreen(carContext, VroomItemsKind.FUEL))
      })
      .addRow(menuRow("Status mapy", statusText(snapshot)) {
        manager.push(VroomItemsScreen(carContext, VroomItemsKind.STATUS))
      })
      .build()

    return PaneTemplate.Builder(pane)
      .setTitle("VROOM Menu")
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun menuRow(title: String, text: String, onClick: () -> Unit): Row =
    Row.Builder()
      .setTitle(title)
      .addText(text)
      .setOnClickListener(onClick)
      .build()

  private fun statusText(snapshot: AutoNavSnapshot): String {
    val mode = when {
      snapshot.isNavigating -> "nawigacja"
      snapshot.isDriving -> "jazda"
      snapshot.isBuilding -> "budowanie trasy"
      else -> "mapa"
    }
    return "$mode, ${snapshot.speedKmh.toInt()} km/h"
  }
}

class VroomReportScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
      .addRow(reportRow("Korek", "traffic"))
      .addRow(reportRow("Wypadek", "accident"))
      .addRow(reportRow("Kontrola predkosci", "speed_control"))
      .addRow(reportRow("Zla pogoda", "weather"))
      .addRow(reportRow("Awaria auta", "car_breakdown"))
      .addRow(reportRow("Zwierze na drodze", "Animal"))
      .build()

    return PaneTemplate.Builder(pane)
      .setTitle("Zglos")
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun reportRow(title: String, type: String): Row =
    Row.Builder()
      .setTitle(title)
      .addText("Dodaj zgloszenie z aktualnej pozycji")
      .setOnClickListener {
        AutoNavStore.requestReport(carContext, type)
        carContext.getCarService(ScreenManager::class.java).pop()
      }
      .build()
}

enum class VroomItemsKind {
  WARNINGS,
  USERS,
  CAMERAS,
  FUEL,
  STATUS,
}

class VroomItemsScreen(
  carContext: CarContext,
  private val kind: VroomItemsKind,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val paneBuilder = Pane.Builder()
    val rows = when (kind) {
      VroomItemsKind.WARNINGS -> snapshot.warnings.map {
        itemRow(warningTitle(it), it.label.ifBlank { "Ostrzezenie" })
      }
      VroomItemsKind.USERS -> snapshot.users.map {
        itemRow(it.label.ifBlank { "Uzytkownik" }, userSubtitle(it))
      }
      VroomItemsKind.CAMERAS -> snapshot.speedCameras.map {
        itemRow(cameraTitle(it), cameraSubtitle(it))
      }
      VroomItemsKind.FUEL -> snapshot.fuelStations.map {
        itemRow(it.label.ifBlank { "Stacja paliw" }, fuelSubtitle(it))
      }
      VroomItemsKind.STATUS -> listOf(
        itemRow("Tryb", statusMode(snapshot)),
        itemRow("Predkosc", "${snapshot.speedKmh.toInt()} km/h"),
        itemRow("Limit", snapshot.speedLimitKmh?.let { "$it km/h" } ?: "brak"),
        itemRow("Trasa", "${snapshot.route.size} punktow"),
        itemRow("Live", "${snapshot.users.size} users, ${snapshot.warnings.size} ostrzezen"),
      )
    }

    if (rows.isEmpty()) {
      paneBuilder.addRow(
        Row.Builder()
          .setTitle("Brak danych")
          .addText("Otworz / odswiez mape w aplikacji VROOM.")
          .build(),
      )
    } else {
      rows.take(8).forEach { paneBuilder.addRow(it) }
    }

    return PaneTemplate.Builder(paneBuilder.build())
      .setTitle(title())
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun itemRow(title: String, text: String): Row =
    Row.Builder()
      .setTitle(title)
      .addText(text)
      .build()

  private fun title(): String =
    when (kind) {
      VroomItemsKind.WARNINGS -> "Ostrzezenia"
      VroomItemsKind.USERS -> "Uzytkownicy live"
      VroomItemsKind.CAMERAS -> "Fotoradary"
      VroomItemsKind.FUEL -> "Paliwo"
      VroomItemsKind.STATUS -> "Status mapy"
    }

  private fun warningTitle(marker: AutoMapMarker): String {
    val label = when (marker.type) {
      "traffic" -> "Korek"
      "weather" -> "Zla pogoda"
      "accident" -> "Wypadek"
      "car_breakdown" -> "Awaria auta"
      "speed_control" -> "Kontrola predkosci"
      "Animal" -> "Zwierze"
      else -> "Ostrzezenie"
    }
    return if (marker.count > 0) "$label +${marker.count}" else label
  }

  private fun userSubtitle(marker: AutoMapMarker): String =
    when {
      marker.isPremium -> "Premium, widoczny na mapie"
      marker.isFriend -> "Znajomy, widoczny na mapie"
      else -> "Widoczny na mapie"
    }

  private fun cameraTitle(marker: AutoMapMarker): String =
    when (marker.type) {
      "bump" -> "Prog zwalniajacy"
      "section" -> "Odcinkowy pomiar"
      "mobile" -> "Mobilny radar"
      else -> "Fotoradar"
    }

  private fun cameraSubtitle(marker: AutoMapMarker): String =
    if (marker.value.isNotBlank()) "Limit ${marker.value} km/h" else "Bez limitu"

  private fun fuelSubtitle(marker: AutoMapMarker): String =
    if (marker.value.isNotBlank()) "PB95 ${marker.value}" else "Cena niedostepna"

  private fun statusMode(snapshot: AutoNavSnapshot): String =
    when {
      snapshot.isNavigating -> "Nawigacja"
      snapshot.isDriving -> "Tryb jazdy"
      snapshot.isBuilding -> "Budowanie trasy"
      else -> "Mapa"
    }
}
