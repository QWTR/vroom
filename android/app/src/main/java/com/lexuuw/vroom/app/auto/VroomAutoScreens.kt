package com.lexuuw.vroom.app.auto

import android.os.Handler
import android.os.Looper
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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

private const val AUTO_MAPBOX_TOKEN = "pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg"
private const val AUTO_MAPBOX_BASE = "https://api.mapbox.com"

class VroomReportScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
            .addItem(reportRow("Wypadek", "accident", "Zdarzenie lub auto na jezdni"))
            .addItem(reportRow("Korek", "traffic", "Duzy ruch albo zator"))
            .addItem(reportRow("Policja", "speed_control", "Kontrola predkosci lub patrol"))
            .addItem(reportRow("Zla pogoda", "weather", "Mgla, ulewa, sliska droga"))
            .addItem(reportRow("Awaria auta", "car_breakdown", "Pojazd unieruchomiony"))
            .build()

        return ListTemplate.Builder()
            .setTitle("Zgloszenie")
            .setHeaderAction(Action.BACK)
            .setSingleList(list)
            .build()
    }

    private fun reportRow(title: String, type: String, subtitle: String): Row =
        Row.Builder()
            .setTitle(title)
            .addText(subtitle)
            .setOnClickListener {
                VroomCarManager.reportTypeClick(type)
                runCatching { carContext.getCarService(ScreenManager::class.java).pop() }
            }
            .build()
}

class VroomSearchScreen(carContext: CarContext) : Screen(carContext) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var query = ""
    private var loading = false
    private var routing = false
    private var places: List<AutoPlace> = emptyList()
    private var searchSeq = 0
    private var pendingSearch: Runnable? = null

    override fun onGetTemplate(): Template =
        runCatching { buildTemplate() }.getOrElse {
            MessageTemplate.Builder("Wyszukiwanie jest chwilowo niedostepne.")
                .setTitle("VROOM")
                .setHeaderAction(Action.BACK)
                .build()
        }

    private fun buildTemplate(): Template {
        val list = ItemList.Builder()
        when {
            routing -> list.addItem(infoRow("Wyznaczam trase...", "Za moment mapa ruszy do celu"))
            loading -> list.addItem(infoRow("Szukam miejsc...", "Pobieram wyniki z Mapbox"))
            places.isEmpty() && query.trim().length < 2 -> {
                list.addItem(infoRow("VROOM Search", "Wpisz cel albo wybierz szybka kategorie"))
                list.addItem(categoryRow("Paliwo w poblizu", "gas station"))
                list.addItem(categoryRow("Parking w poblizu", "parking"))
                list.addItem(categoryRow("Jedzenie w poblizu", "restaurant"))
                list.addItem(categoryRow("Kawa w poblizu", "coffee"))
            }
            places.isEmpty() -> list.addItem(infoRow("Brak wynikow", "Sprobuj inna fraze"))
            else -> places.take(6).forEach { place ->
                list.addItem(
                    Row.Builder()
                        .setTitle(place.name)
                        .addText(place.address.ifBlank { "Cel na mapie" })
                        .setOnClickListener {
                            carContext.getCarService(ScreenManager::class.java)
                                .push(VroomRoutePreviewScreen(carContext, place))
                        }
                        .build()
                )
            }
        }

        return SearchTemplate.Builder(
            object : SearchTemplate.SearchCallback {
                override fun onSearchTextChanged(searchText: String) {
                    query = searchText
                    scheduleSearch(searchText)
                }

                override fun onSearchSubmitted(searchText: String) {
                    query = searchText.trim()
                    runSearch(query)
                }
            }
        )
            .setInitialSearchText(query)
            .setSearchHint("Wyszukaj adres lub miejsce...")
            .setHeaderAction(Action.BACK)
            .setItemList(list.build())
            .setShowKeyboardByDefault(false)
            .build()
    }

    private fun categoryRow(title: String, category: String): Row =
        Row.Builder()
            .setTitle(title)
            .addText("VROOM znajdzie najblizsze miejsce")
            .setOnClickListener {
                query = category
                runSearch(category)
            }
            .build()

    private fun infoRow(title: String, text: String): Row =
        Row.Builder()
            .setTitle(title)
            .addText(text)
            .build()

    private fun scheduleSearch(raw: String) {
        val cleaned = raw.trim()
        pendingSearch?.let { mainHandler.removeCallbacks(it) }
        if (cleaned.length < 2) {
            loading = false
            places = emptyList()
            invalidate()
            return
        }

        val seq = ++searchSeq
        val task = Runnable {
            if (seq != searchSeq) return@Runnable
            runSearch(cleaned)
        }
        pendingSearch = task
        mainHandler.postDelayed(task, 280L)
    }

    private fun runSearch(cleaned: String) {
        if (cleaned.length < 2) return
        loading = true
        places = emptyList()
        invalidate()
        Thread {
            val result = runCatching { searchPlaces(cleaned) }.getOrDefault(emptyList())
            mainHandler.post {
                loading = false
                places = result
                invalidate()
            }
        }.start()
    }

    private fun startRoute(place: AutoPlace) {
        if (routing) return
        routing = true
        invalidate()
        Thread {
            val ok = runCatching { buildRoutePayload(place) }.getOrNull()?.let {
                VroomCarManager.setNativeNavigation(it)
                true
            } ?: false
            mainHandler.post {
                routing = false
                if (ok) {
                    runCatching { carContext.getCarService(ScreenManager::class.java).popToRoot() }
                } else {
                    invalidate()
                }
            }
        }.start()
    }

    private fun searchPlaces(raw: String): List<AutoPlace> {
        val current = VroomCarManager.latestPayload()
        val lat = current?.userLat
        val lng = current?.userLng
        val proximity = if (lat != null && lng != null) "&proximity=$lng,$lat" else ""
        val url = "$AUTO_MAPBOX_BASE/geocoding/v5/mapbox.places/${URLEncoder.encode(raw, "UTF-8")}.json" +
            "?access_token=$AUTO_MAPBOX_TOKEN&language=pl&limit=8$proximity"
        val body = request(url)
        val features = JSONObject(body).optJSONArray("features") ?: return emptyList()
        val result = mutableListOf<AutoPlace>()
        for (i in 0 until features.length()) {
            val feature = features.optJSONObject(i) ?: continue
            val coords = feature.optJSONObject("geometry")?.optJSONArray("coordinates")
                ?: feature.optJSONArray("center")
                ?: continue
            val placeLng = coords.optDouble(0, Double.NaN)
            val placeLat = coords.optDouble(1, Double.NaN)
            if (!placeLat.isFinite() || !placeLng.isFinite()) continue
            val props = feature.optJSONObject("properties")
            result.add(
                AutoPlace(
                    name = props?.optString("name")?.takeIf { it.isNotBlank() }
                        ?: feature.optString("text", "Cel"),
                    address = props?.optString("full_address")?.takeIf { it.isNotBlank() }
                        ?: feature.optString("place_name", ""),
                    lat = placeLat,
                    lng = placeLng
                )
            )
        }
        return result
    }

    private fun buildRoutePayload(place: AutoPlace): String {
        val current = VroomCarManager.latestPayload() ?: throw IllegalStateException("Missing current payload")
        val fromLat = current.userLat ?: throw IllegalStateException("Missing current latitude")
        val fromLng = current.userLng ?: throw IllegalStateException("Missing current longitude")
        val url = "$AUTO_MAPBOX_BASE/directions/v5/mapbox/driving/$fromLng,$fromLat;${place.lng},${place.lat}" +
            "?alternatives=false&geometries=geojson&steps=true&language=pl&overview=full&access_token=$AUTO_MAPBOX_TOKEN"
        val json = JSONObject(request(url))
        val route = json.optJSONArray("routes")?.optJSONObject(0) ?: throw IllegalStateException("Missing route")
        val coords = route.optJSONObject("geometry")?.optJSONArray("coordinates") ?: JSONArray()
        val routePoints = JSONArray()
        for (i in 0 until coords.length()) {
            val item = coords.optJSONArray(i) ?: continue
            routePoints.put(JSONObject().apply {
                put("lat", item.optDouble(1))
                put("lng", item.optDouble(0))
            })
        }
        val leg = route.optJSONArray("legs")?.optJSONObject(0)
        val step = leg?.optJSONArray("steps")?.optJSONObject(0)
        val maneuver = step?.optJSONObject("maneuver")
        val instruction = maneuver?.optString("instruction", "Jedz do celu") ?: "Jedz do celu"
        val distance = route.optDouble("distance", 0.0).toInt().coerceAtLeast(1)
        val duration = route.optDouble("duration", 0.0).toInt().coerceAtLeast(0)

        return JSONObject().apply {
            put("isNavigating", true)
            put("userLocation", JSONObject().apply {
                put("latitude", fromLat)
                put("longitude", fromLng)
            })
            put("speed", current.speed ?: 0.0)
            put("heading", current.heading ?: 0.0)
            put("destination", JSONObject().apply {
                put("name", place.name)
                put("latitude", place.lat)
                put("longitude", place.lng)
            })
            put("dto", JSONObject().apply {
                put("isNavigating", true)
                put("nextInstruction", instruction)
                put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
                put("destinationName", place.name)
                put("remainingDistanceMeters", distance)
                put("remainingDurationSec", duration)
                put("turnDistanceMeters", step?.optDouble("distance", 0.0)?.toInt() ?: distance)
            })
            put("route", routePoints)
            put("users", JSONArray())
            put("warnings", JSONArray())
            put("mapState", JSONObject().apply {
                put("isDriving", true)
                put("route", routePoints)
                put("destinationLat", place.lat)
                put("destinationLng", place.lng)
                put("speedKmh", (current.speed ?: 0.0) * 3.6)
            })
        }.toString()
    }

    private fun request(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 4500
            readTimeout = 4500
            setRequestProperty("Accept", "application/json")
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) throw IllegalStateException("HTTP $code")
        return body
    }
}

class VroomRoutePreviewScreen(
    carContext: CarContext,
    private val place: AutoPlace
) : Screen(carContext) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var loading = false
    private var loaded = false
    private var error = false
    private var plan: AutoRoutePlan? = null

    override fun onGetTemplate(): Template {
        if (!loading && !loaded && !error) loadPlan()

        val list = ItemList.Builder()
        val currentPlan = plan
        when {
            loading -> list.addItem(infoRow("Wyznaczam trase...", "Licze czas, dystans i pierwszy manewr"))
            error -> {
                list.addItem(infoRow("Nie udalo sie wyznaczyc trasy", "Wroc i sprobuj ponownie"))
                list.addItem(actionRow("Wroc", "Zamknij podglad") {
                    VroomCarManager.clearNativeRoutePreview()
                    runCatching { carContext.getCarService(ScreenManager::class.java).pop() }
                })
            }
            currentPlan != null -> {
                list.addItem(infoRow(place.name, place.address.ifBlank { "Cel na mapie" }))
                list.addItem(infoRow("Czas: ${currentPlan.durationText}", "Dystans: ${currentPlan.distanceText}"))
                list.addItem(infoRow("Pierwszy krok", currentPlan.instruction))
                list.addItem(actionRow("Start", "Rozpocznij nawigacje w Android Auto") {
                    VroomCarManager.setNativeNavigation(currentPlan.navigationPayload)
                    runCatching { carContext.getCarService(ScreenManager::class.java).popToRoot() }
                })
                list.addItem(actionRow("Anuluj", "Wroc do wyszukiwania") {
                    VroomCarManager.clearNativeRoutePreview()
                    runCatching { carContext.getCarService(ScreenManager::class.java).pop() }
                })
            }
        }

        return ListTemplate.Builder()
            .setTitle("Podglad trasy")
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }

    private fun loadPlan() {
        loading = true
        error = false
        invalidate()
        Thread {
            val result = runCatching { buildRoutePlan(place) }.getOrNull()
            mainHandler.post {
                loading = false
                loaded = result != null
                error = result == null
                plan = result
                result?.let { VroomCarManager.setNativeRoutePreview(it.previewPayload) }
                invalidate()
            }
        }.start()
    }

    private fun infoRow(title: String, text: String): Row =
        Row.Builder()
            .setTitle(title)
            .addText(text)
            .build()

    private fun actionRow(title: String, text: String, action: () -> Unit): Row =
        Row.Builder()
            .setTitle(title)
            .addText(text)
            .setOnClickListener(action)
            .build()
}

data class AutoPlace(
    val name: String,
    val address: String,
    val lat: Double,
    val lng: Double
)

data class AutoRoutePlan(
    val previewPayload: String,
    val navigationPayload: String,
    val distanceText: String,
    val durationText: String,
    val instruction: String
)

private fun buildRoutePlan(place: AutoPlace): AutoRoutePlan {
    val current = VroomCarManager.latestPayload() ?: throw IllegalStateException("Missing current payload")
    val fromLat = current.userLat ?: throw IllegalStateException("Missing current latitude")
    val fromLng = current.userLng ?: throw IllegalStateException("Missing current longitude")
    val url = "$AUTO_MAPBOX_BASE/directions/v5/mapbox/driving/$fromLng,$fromLat;${place.lng},${place.lat}" +
        "?alternatives=false&geometries=geojson&steps=true&language=pl&overview=full&access_token=$AUTO_MAPBOX_TOKEN"
    val json = JSONObject(autoRequest(url))
    val route = json.optJSONArray("routes")?.optJSONObject(0) ?: throw IllegalStateException("Missing route")
    val coords = route.optJSONObject("geometry")?.optJSONArray("coordinates") ?: JSONArray()
    val routePoints = JSONArray()
    for (i in 0 until coords.length()) {
        val item = coords.optJSONArray(i) ?: continue
        routePoints.put(JSONObject().apply {
            put("lat", item.optDouble(1))
            put("lng", item.optDouble(0))
        })
    }
    val leg = route.optJSONArray("legs")?.optJSONObject(0)
    val step = leg?.optJSONArray("steps")?.optJSONObject(0)
    val maneuver = step?.optJSONObject("maneuver")
    val instruction = maneuver?.optString("instruction", "Jedz do celu") ?: "Jedz do celu"
    val distance = route.optDouble("distance", 0.0).toInt().coerceAtLeast(1)
    val duration = route.optDouble("duration", 0.0).toInt().coerceAtLeast(0)
    val previewPayload = buildAutoRoutePayload(
        current = current,
        place = place,
        routePoints = routePoints,
        instruction = instruction,
        maneuver = maneuver,
        distance = distance,
        duration = duration,
        navigating = false
    )
    val navigationPayload = buildAutoRoutePayload(
        current = current,
        place = place,
        routePoints = routePoints,
        instruction = instruction,
        maneuver = maneuver,
        distance = distance,
        duration = duration,
        navigating = true
    )
    return AutoRoutePlan(
        previewPayload = previewPayload,
        navigationPayload = navigationPayload,
        distanceText = formatDistance(distance),
        durationText = formatDuration(duration),
        instruction = instruction
    )
}

private fun buildAutoRoutePayload(
    current: VroomPayload,
    place: AutoPlace,
    routePoints: JSONArray,
    instruction: String,
    maneuver: JSONObject?,
    distance: Int,
    duration: Int,
    navigating: Boolean
): String {
    val fromLat = current.userLat ?: place.lat
    val fromLng = current.userLng ?: place.lng
    return JSONObject().apply {
        put("isNavigating", navigating)
        put("userLocation", JSONObject().apply {
            put("latitude", fromLat)
            put("longitude", fromLng)
        })
        put("speed", current.speed ?: 0.0)
        put("heading", current.heading ?: 0.0)
        put("destination", JSONObject().apply {
            put("name", place.name)
            put("latitude", place.lat)
            put("longitude", place.lng)
        })
        put("dto", JSONObject().apply {
            put("isNavigating", navigating)
            put("nextInstruction", instruction)
            put("maneuver", maneuver?.optString("type", "straight") ?: "straight")
            put("destinationName", place.name)
            put("remainingDistanceMeters", distance)
            put("remainingDurationSec", duration)
            put("turnDistanceMeters", distance)
        })
        put("route", JSONArray(routePoints.toString()))
        put("users", JSONArray())
        put("warnings", JSONArray())
        put("mapState", JSONObject().apply {
            put("isDriving", true)
            put("route", JSONArray(routePoints.toString()))
            put("destinationLat", place.lat)
            put("destinationLng", place.lng)
            put("speedKmh", (current.speed ?: 0.0) * 3.6)
            put("routePreview", !navigating)
            put("nativeRoadMatch", false)
        })
    }.toString()
}

private fun autoRequest(url: String): String {
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 4500
        readTimeout = 4500
        setRequestProperty("Accept", "application/json")
    }
    val code = conn.responseCode
    val stream = if (code in 200..299) conn.inputStream else conn.errorStream
    val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    if (code !in 200..299) throw IllegalStateException("HTTP $code")
    return body
}

private fun formatDistance(meters: Int): String =
    if (meters >= 1000) {
        String.format(java.util.Locale.US, "%.1f km", meters / 1000.0)
    } else {
        "$meters m"
    }

private fun formatDuration(seconds: Int): String {
    val minutes = (seconds / 60).coerceAtLeast(1)
    return if (minutes >= 60) {
        val h = minutes / 60
        val m = minutes % 60
        if (m == 0) "${h} h" else "${h} h ${m} min"
    } else {
        "$minutes min"
    }
}
