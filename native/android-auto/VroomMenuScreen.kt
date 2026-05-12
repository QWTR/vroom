package __PACKAGE__.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import android.os.Handler
import android.os.Looper

class VroomMenuScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template =
    runCatching {
      AutoNavStore.refreshFromBackendIfNeeded(carContext)
      buildTemplate()
    }
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
      .addItem(menuRow("Szukaj celu", "Adres, firma, miejsce, punkt na mapie") {
        runCatching { manager.push(VroomSearchTextScreen(carContext)) }
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
    MessageTemplate.Builder("Menu jest chwilowo niedostepne. Dane Android Auto odswieza sie automatycznie.")
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
    runCatching {
      AutoNavStore.refreshFromBackendIfNeeded(carContext)
      buildTemplate()
    }
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
        Thread {
          runCatching { AutoNavStore.submitReportFromCurrentLocation(carContext, type) }
        }.start()
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
    runCatching {
      AutoNavStore.refreshFromBackendIfNeeded(carContext)
      buildTemplate()
    }
      .getOrElse { fallbackTemplate() }

  private fun buildTemplate(): Template {
    val snapshot = AutoNavStore.snapshot(carContext)
    val listBuilder = ItemList.Builder()
    val rows = when (kind) {
      VroomItemsKind.WARNINGS -> snapshot.warnings.map {
        actionableRow(
          warningTitle(it),
          "${it.label.ifBlank { "Ostrzezenie" }} • dotknij aby potwierdzic",
        ) {
          Thread { runCatching { AutoNavStore.confirmWarning(carContext, it.id) } }.start()
        }
      }
      VroomItemsKind.USERS -> snapshot.users.map {
        itemRow(it.label.ifBlank { "Uzytkownik" }, userSubtitle(it))
      }
      VroomItemsKind.CAMERAS -> snapshot.speedCameras.map {
        actionableRow(
          cameraTitle(it),
          "${cameraSubtitle(it)} • dotknij aby potwierdzic",
        ) {
          Thread { runCatching { AutoNavStore.confirmSpeedCamera(carContext, it.id) } }.start()
        }
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
          .addText("Dane zostana pobrane automatycznie.")
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

  private fun actionableRow(title: String, text: String, onClick: () -> Unit): Row =
    Row.Builder()
      .setTitle(title)
      .addText(text)
      .setOnClickListener(onClick)
      .build()

  private fun fallbackTemplate(): Template =
    MessageTemplate.Builder("Dane sa chwilowo niedostepne. Android Auto pobiera je bezposrednio z serwera.")
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

class VroomSearchCategoryScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val manager = carContext.getCarService(ScreenManager::class.java)
    val list = ItemList.Builder()
      .addItem(searchRow("Stacje paliw", "gas_station", manager))
      .addItem(searchRow("Parking", "parking", manager))
      .addItem(searchRow("Restauracje", "restaurant", manager))
      .addItem(searchRow("Kawiarnie", "coffee", manager))
      .build()

    return ListTemplate.Builder()
      .setSingleList(list)
      .setTitle("Szukaj celu")
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun searchRow(
    title: String,
    category: String,
    manager: ScreenManager,
  ): Row = Row.Builder()
    .setTitle(title)
    .addText("Wyszukaj w poblizu")
    .setBrowsable(true)
    .setOnClickListener {
      runCatching { manager.push(VroomSearchResultsScreen(carContext, title, category)) }
    }
    .build()
}

class VroomSearchTextScreen(carContext: CarContext) : Screen(carContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var searchText = ""
  private var lastSubmitted = ""
  private var loading = false
  private var routing = false
  private var places: List<AutoSearchPlace> = emptyList()

  override fun onGetTemplate(): Template {
    val listBuilder = ItemList.Builder()
    val manager = carContext.getCarService(ScreenManager::class.java)

    if (routing) {
      listBuilder.addItem(
        Row.Builder()
          .setTitle("Wyznaczam trase...")
          .addText("Poczekaj chwile")
          .build(),
      )
    } else if (loading) {
      listBuilder.addItem(
        Row.Builder()
          .setTitle("Szukam miejsc...")
          .addText("Trwa pobieranie wynikow")
          .build(),
      )
    } else if (places.isEmpty()) {
      listBuilder.addItem(
        Row.Builder()
          .setTitle("Wpisz adres i zatwierdz")
          .addText("Np. Wolowska 8, Krakow")
          .build(),
      )
    } else {
      places.take(12).forEach { place ->
        listBuilder.addItem(
          Row.Builder()
            .setTitle(place.name)
            .addText(place.address.ifBlank { "Cel na mapie" })
            .setOnClickListener {
              if (routing) return@setOnClickListener
              routing = true
              invalidate()
              Thread {
                val ok = runCatching { AutoNavStore.startNavigationToPlace(carContext, place) }.getOrDefault(false)
                mainHandler.post {
                  routing = false
                  if (ok) runCatching { manager.popToRoot() } else invalidate()
                }
              }.start()
            }
            .build(),
        )
      }
    }

    return SearchTemplate.Builder(
      object : SearchTemplate.SearchCallback {
        override fun onSearchTextChanged(searchText: String) {
          this@VroomSearchTextScreen.searchText = searchText
        }

        override fun onSearchSubmitted(searchText: String) {
          val query = searchText.trim()
          this@VroomSearchTextScreen.searchText = query
          if (query.length < 2 || query == lastSubmitted) return
          lastSubmitted = query
          loading = true
          places = emptyList()
          invalidate()
          Thread {
            val result = runCatching { AutoNavStore.searchPlaces(carContext, query) }.getOrDefault(emptyList())
            mainHandler.post {
              places = result
              loading = false
              invalidate()
            }
          }.start()
        }
      },
    )
      .setInitialSearchText(searchText)
      .setSearchHint("Szukaj adresu lub miejsca")
      .setHeaderAction(Action.BACK)
      .setItemList(listBuilder.build())
      .setShowKeyboardByDefault(true)
      .build()
  }
}

class VroomSearchResultsScreen(
  carContext: CarContext,
  private val title: String,
  private val category: String,
) : Screen(carContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var loading = true
  private var routing = false
  private var fetchStarted = false
  private var places: List<AutoSearchPlace> = emptyList()

  override fun onGetTemplate(): Template =
    runCatching {
      ensureLoaded()
      buildTemplate()
    }
      .getOrElse {
        MessageTemplate.Builder("Wyszukiwanie chwilowo niedostepne.")
          .setTitle("VROOM")
          .setHeaderAction(Action.BACK)
          .build()
      }

  private fun ensureLoaded() {
    if (fetchStarted) return
    fetchStarted = true
    Thread {
      val result = runCatching { AutoNavStore.searchCategory(carContext, category) }.getOrDefault(emptyList())
      places = result
      loading = false
      mainHandler.post { invalidate() }
    }.start()
  }

  private fun buildTemplate(): Template {
    val manager = carContext.getCarService(ScreenManager::class.java)
    if (loading) {
      return MessageTemplate.Builder("Szukam miejsc w poblizu...")
        .setTitle(title)
        .setHeaderAction(Action.BACK)
        .build()
    }
    if (routing) {
      return MessageTemplate.Builder("Wyznaczam trase...")
        .setTitle(title)
        .setHeaderAction(Action.BACK)
        .build()
    }

    val list = ItemList.Builder()
    if (places.isEmpty()) {
      list.addItem(
        Row.Builder()
          .setTitle("Brak wynikow")
          .addText("Sprawdz lokalizacje i polaczenie z internetem")
          .build(),
      )
    } else {
      places.take(12).forEach { place ->
        list.addItem(
          Row.Builder()
            .setTitle(place.name)
            .addText(place.address.ifBlank { "Cel na mapie" })
            .setOnClickListener {
              if (routing) return@setOnClickListener
              routing = true
              invalidate()
              Thread {
                val ok = runCatching { AutoNavStore.startNavigationToPlace(carContext, place) }.getOrDefault(false)
                mainHandler.post {
                  routing = false
                  if (ok) {
                    runCatching { manager.popToRoot() }
                  } else {
                    invalidate()
                  }
                }
              }.start()
            }
            .build(),
        )
      }
    }

    return ListTemplate.Builder()
      .setSingleList(list.build())
      .setTitle(title)
      .setHeaderAction(Action.BACK)
      .build()
  }
}
