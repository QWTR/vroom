package com.lexuuw.vroom.app.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

class VroomMenuScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template =
    runCatching { buildTemplate() }
      .getOrElse { fallbackTemplate() }

  private fun buildTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val manager = carContext.getCarService(ScreenManager::class.java)
    val list = ItemList.Builder()
      .addItem(menuRow("Zgloszenie", "Korek, wypadek, kontrola, pogoda, awaria") {
        runCatching { manager.push(VroomReportScreen(carContext)) }
      })
      .addItem(menuRow("Ostrzezenia", "${snapshot.warnings.size} aktywnych na mapie") {
        runCatching { manager.push(VroomItemsScreen(carContext, VroomItemsKind.WARNINGS)) }
      })
      .addItem(menuRow("Uzytkownicy live", "${snapshot.users.size} widocznych uzytkownikow") {
        runCatching { manager.push(VroomItemsScreen(carContext, VroomItemsKind.USERS)) }
      })
      .addItem(menuRow("Fotoradary", "${snapshot.speedCameras.size} w okolicy") {
        runCatching { manager.push(VroomItemsScreen(carContext, VroomItemsKind.CAMERAS)) }
      })
      .addItem(menuRow("Paliwo", "${snapshot.fuelStations.size} stacji na mapie") {
        runCatching { manager.push(VroomItemsScreen(carContext, VroomItemsKind.FUEL)) }
      })
      .addItem(menuRow("Status mapy", statusText(snapshot)) {
        runCatching { manager.push(VroomItemsScreen(carContext, VroomItemsKind.STATUS)) }
      })
      .build()

    return ListTemplate.Builder()
      .setSingleList(list)
      .setTitle("VROOM Menu")
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun menuRow(title: String, text: String, onClick: () -> Unit): Row =
    Row.Builder()
      .setTitle(title)
      .addText(text)
      .setBrowsable(true)
      .setOnClickListener(onClick)
      .build()

  private fun fallbackTemplate(): Template =
    MessageTemplate.Builder("Menu jest chwilowo niedostepne. Otworz aplikacje VROOM na telefonie.")
      .setTitle("VROOM")
      .setHeaderAction(Action.BACK)
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
  override fun onGetTemplate(): Template =
    runCatching { buildTemplate() }
      .getOrElse { fallbackTemplate() }

  private fun buildTemplate(): Template {
    val list = ItemList.Builder()
      .addItem(reportRow("Korek", "traffic"))
      .addItem(reportRow("Wypadek", "accident"))
      .addItem(reportRow("Kontrola predkosci", "speed_control"))
      .addItem(reportRow("Zla pogoda", "weather"))
      .addItem(reportRow("Awaria auta", "car_breakdown"))
      .addItem(reportRow("Zwierze na drodze", "Animal"))
      .build()

    return ListTemplate.Builder()
      .setSingleList(list)
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
        runCatching { carContext.getCarService(ScreenManager::class.java).pop() }
      }
      .build()

  private fun fallbackTemplate(): Template =
    MessageTemplate.Builder("Zgloszenia sa chwilowo niedostepne.")
      .setTitle("VROOM")
      .setHeaderAction(Action.BACK)
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
  override fun onGetTemplate(): Template =
    runCatching { buildTemplate() }
      .getOrElse { fallbackTemplate() }

  private fun buildTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val listBuilder = ItemList.Builder()
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
      listBuilder.addItem(
        Row.Builder()
          .setTitle("Brak danych")
          .addText("Otworz / odswiez mape w aplikacji VROOM.")
          .build(),
      )
    } else {
      rows.take(12).forEach { listBuilder.addItem(it) }
    }

    return ListTemplate.Builder()
      .setSingleList(listBuilder.build())
      .setTitle(title())
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun itemRow(title: String, text: String): Row =
    Row.Builder()
      .setTitle(title)
      .addText(text)
      .build()

  private fun fallbackTemplate(): Template =
    MessageTemplate.Builder("Dane sa chwilowo niedostepne. Otworz aplikacje VROOM na telefonie.")
      .setTitle("VROOM")
      .setHeaderAction(Action.BACK)
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
