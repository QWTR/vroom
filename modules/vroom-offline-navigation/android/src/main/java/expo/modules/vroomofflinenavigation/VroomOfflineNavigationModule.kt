package expo.modules.vroomofflinenavigation

import android.content.Context
import com.mapbox.common.Cancelable
import com.mapbox.common.TileRegionLoadOptions
import com.mapbox.common.TileStore
import com.mapbox.geojson.Polygon
import com.mapbox.geojson.Point
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.maps.MapboxMapsOptions
import com.mapbox.maps.OfflineManager
import com.mapbox.maps.TilesetDescriptorOptions
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.options.RoutingTilesOptions
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.extensions.applyLanguageAndVoiceUnitOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.base.route.RouterOrigin
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

class VroomOfflineNavigationModule : Module() {
  private val activeDownloads = ConcurrentHashMap<String, Cancelable>()
  private val preferences by lazy {
    context().getSharedPreferences("vroom_offline_navigation", Context.MODE_PRIVATE)
  }
  private val tileStore by lazy {
    val directory = File(context().filesDir, "vroom-navigation-tiles").apply { mkdirs() }
    TileStore.create(directory.absolutePath).also { MapboxMapsOptions.tileStore = it }
  }
  private val navigation by lazy {
    val routingTiles = RoutingTilesOptions.Builder().tileStore(tileStore).build()
    MapboxNavigationProvider.create(
      NavigationOptions.Builder(context()).routingTilesOptions(routingTiles).build()
    )
  }

  override fun definition() = ModuleDefinition {
    Name("VroomOfflineNavigation")
    Events("packProgress")

    AsyncFunction("getCapabilities") {
      mapOf(
        "available" to true,
        "sdkVersion" to "3.18.0",
        "supportsOfflineRouting" to true,
        "supportsVoiceGuidance" to true,
        "supportsRerouting" to true,
        "reason" to null,
      )
    }

    AsyncFunction("estimatePack") { input: Map<String, Any?> ->
      val geometry = input["geometry"] as? Map<*, *>
      val rings = geometry?.get("coordinates") as? List<*> ?: emptyList<Any>()
      val vertices = rings.sumOf { (it as? List<*>)?.size ?: 0 }
      val bufferKm = number(input["bufferKm"], 10.0)
      mapOf("requiredBytes" to ((70_000_000 + vertices * 18_000 + bufferKm * 6_000_000).toLong()))
    }

    AsyncFunction("listPacks") { listPacks() }
    AsyncFunction("downloadPack") { input: Map<String, Any?>, promise: Promise -> download(input, promise) }
    AsyncFunction("updatePack") { input: Map<String, Any?>, promise: Promise -> download(input, promise) }
    AsyncFunction("pausePack") { id: String ->
      activeDownloads.remove(id)?.cancel()
      updateStatus(id, "paused", null)
    }
    AsyncFunction("resumePack") { id: String, promise: Promise ->
      val stored = preferences.getString("input:$id", null)
      if (stored == null) promise.reject("NOT_FOUND", "Nie znaleziono paczki.", null)
      else download(jsonObjectToMap(JSONObject(stored)), promise)
    }
    AsyncFunction("deletePack") { id: String ->
      activeDownloads.remove(id)?.cancel()
      tileStore.removeTileRegion(id)
      preferences.edit().remove("input:$id").remove("pack:$id").apply()
    }
    AsyncFunction("setPremiumEntitlement") { active: Boolean ->
      if (!active) {
        listPacks().forEach { pack ->
          val id = pack["id"] as String
          activeDownloads.remove(id)?.cancel()
          tileStore.removeTileRegion(id)
          preferences.edit().remove("input:$id").remove("pack:$id").apply()
        }
      }
    }
    AsyncFunction("requestOfflineRoute") { input: Map<String, Any?>, promise: Promise ->
      requestOfflineRoute(input, promise)
    }
  }

  private fun context(): Context = appContext.reactContext?.applicationContext
    ?: throw IllegalStateException("APP_CONTEXT_UNAVAILABLE")

  private fun number(value: Any?, fallback: Double = 0.0): Double = (value as? Number)?.toDouble() ?: fallback

  private fun requestOfflineRoute(input: Map<String, Any?>, promise: Promise) {
    val origin = input["origin"] as? Map<*, *>
    val destination = input["destination"] as? Map<*, *>
    val originLat = number(origin?.get("latitude"), Double.NaN)
    val originLng = number(origin?.get("longitude"), Double.NaN)
    val destinationLat = number(destination?.get("latitude"), Double.NaN)
    val destinationLng = number(destination?.get("longitude"), Double.NaN)
    if (!originLat.isFinite() || !originLng.isFinite() || !destinationLat.isFinite() || !destinationLng.isFinite()) {
      promise.reject("INVALID_COORDINATES", "Nieprawidłowy start lub cel.", null)
      return
    }
    val options = RouteOptions.builder()
      .applyDefaultNavigationOptions()
      .applyLanguageAndVoiceUnitOptions(context())
      .coordinatesList(listOf(Point.fromLngLat(originLng, originLat), Point.fromLngLat(destinationLng, destinationLat)))
      .alternatives(false)
      .geometries("polyline6")
      .build()
    navigation.requestRoutes(options, object : NavigationRouterCallback {
      override fun onRoutesReady(routes: List<NavigationRoute>, @RouterOrigin routerOrigin: String) {
        val route = routes.firstOrNull()?.directionsRoute
        if (route == null) promise.reject("NO_OFFLINE_ROUTE", "Brak trasy w pobranym obszarze.", null)
        else promise.resolve(serializeRoute(route, routerOrigin))
      }
      override fun onFailure(reasons: List<RouterFailure>, routeOptions: RouteOptions) {
        promise.reject("NO_OFFLINE_ROUTE", reasons.joinToString { it.message }, null)
      }
      override fun onCanceled(routeOptions: RouteOptions, @RouterOrigin routerOrigin: String) {
        promise.reject("ROUTE_CANCELED", "Wyznaczanie trasy anulowano.", null)
      }
    })
  }

  private fun serializeRoute(route: com.mapbox.api.directions.v5.models.DirectionsRoute, routerOrigin: String): Map<String, Any?> {
    val points = runCatching { decodePolyline(route.geometry() ?: "", 6) }.getOrDefault(emptyList())
      .map { mapOf("latitude" to it.latitude(), "longitude" to it.longitude()) }
    val distance = route.distance()
    val durationSeconds = route.duration()
    val normalizedOrigin = routerOrigin.lowercase(java.util.Locale.US)
    val resolvedOrigin = when {
      normalizedOrigin.contains("offline") || normalizedOrigin.contains("onboard") -> "offline"
      normalizedOrigin.contains("online") || normalizedOrigin.contains("offboard") -> "online"
      else -> "unknown"
    }
    return mapOf(
      "points" to points,
      "steps" to emptyList<Any>(),
      "distanceText" to String.format(java.util.Locale.US, "%.1f km", distance / 1000.0),
      "distanceValue" to distance.toInt(),
      "durationText" to if (durationSeconds >= 3600) "${(durationSeconds / 3600).toInt()} godz. ${((durationSeconds % 3600) / 60).toInt()} min" else "${(durationSeconds / 60).toInt()} min",
      "duration" to kotlin.math.round(durationSeconds / 60.0).toInt(),
      "index" to 0,
      "routerOrigin" to resolvedOrigin,
    )
  }

  /** Dependency-free polyline decoder; Navigation SDK returns polyline6 here. */
  private fun decodePolyline(encoded: String, precision: Int): List<Point> {
    if (encoded.isEmpty()) return emptyList()
    val result = mutableListOf<Point>()
    val factor = Math.pow(10.0, precision.toDouble())
    var index = 0
    var latitude = 0L
    var longitude = 0L

    fun nextDelta(): Long {
      var value = 0L
      var shift = 0
      var byte: Int
      do {
        if (index >= encoded.length) throw IllegalArgumentException("INVALID_POLYLINE")
        byte = encoded[index++].code - 63
        value = value or ((byte and 0x1f).toLong() shl shift)
        shift += 5
      } while (byte >= 0x20)
      return if ((value and 1L) != 0L) -(value shr 1) - 1L else value shr 1
    }

    while (index < encoded.length) {
      latitude += nextDelta()
      longitude += nextDelta()
      result.add(Point.fromLngLat(longitude / factor, latitude / factor))
    }
    return result
  }

  private fun listPacks(): List<Map<String, Any?>> = preferences.all
    .filterKeys { it.startsWith("pack:") }
    .values
    .mapNotNull { raw -> runCatching { jsonObjectToMap(JSONObject(raw as String)) }.getOrNull() }
    .sortedByDescending { number(it["updatedAt"]) }

  private fun download(input: Map<String, Any?>, promise: Promise) {
    try {
      val id = input["id"] as? String ?: throw IllegalArgumentException("INVALID_PACK_ID")
      val existing = listPacks()
      if (existing.none { it["id"] == id } && existing.size >= 3) throw IllegalStateException("OFFLINE_PACK_LIMIT")
      val geometryMap = input["geometry"] as? Map<*, *> ?: throw IllegalArgumentException("INVALID_GEOMETRY")
      val polygon = Polygon.fromJson(JSONObject(geometryMap).toString())
      val styleUri = input["styleURI"] as? String ?: throw IllegalArgumentException("INVALID_STYLE")
      val mapDescriptor = OfflineManager().createTilesetDescriptor(
        TilesetDescriptorOptions.Builder().styleURI(styleUri).minZoom(0).maxZoom(16).build()
      )
      val navigationDescriptor = navigation.tilesetDescriptorFactory.getLatest()
      val options = TileRegionLoadOptions.Builder()
        .geometry(polygon)
        .descriptors(listOf(mapDescriptor, navigationDescriptor))
        .acceptExpired(false)
        .build()
      preferences.edit().putString("input:$id", JSONObject(input).toString()).apply()
      val queued = packFromInput(input, "queued", 0.0, 0L, null)
      persistPack(queued)
      promise.resolve(queued)
      activeDownloads.remove(id)?.cancel()
      activeDownloads[id] = tileStore.loadTileRegion(
        id,
        options,
        { progress ->
          val required = progress.requiredResourceCount.coerceAtLeast(1)
          val percent = progress.completedResourceCount.toDouble() / required.toDouble() * 100.0
          val pack = packFromInput(input, "downloading", percent, progress.completedResourceSize, null)
          persistPack(pack)
          sendEvent("packProgress", pack)
        },
        { expected ->
          activeDownloads.remove(id)
          if (expected.isValue) {
            val current = readPack(id) ?: queued
            val ready = current + mapOf("status" to "ready", "progress" to 100.0, "updatedAt" to System.currentTimeMillis(), "error" to null)
            persistPack(ready)
            sendEvent("packProgress", ready)
          } else {
            val failed = packFromInput(input, "error", 0.0, 0L, expected.error?.message ?: "OFFLINE_DOWNLOAD_FAILED")
            persistPack(failed)
            sendEvent("packProgress", failed)
          }
        },
      )
    } catch (error: Throwable) {
      promise.reject(error.message ?: "OFFLINE_DOWNLOAD_FAILED", "Nie udało się przygotować prawdziwej nawigacji offline.", error)
    }
  }

  private fun packFromInput(input: Map<String, Any?>, status: String, progress: Double, completedBytes: Long, error: String?): Map<String, Any?> {
    val id = input["id"] as String
    val estimate = (70_000_000 + number(input["bufferKm"], 10.0) * 6_000_000).toLong()
    return mapOf(
      "id" to id,
      "routeId" to number(input["routeId"]).toInt(),
      "routeName" to (input["routeName"] as? String ?: "Trasa"),
      "status" to status,
      "progress" to progress.coerceIn(0.0, 100.0),
      "completedBytes" to completedBytes,
      "requiredBytes" to estimate,
      "updatedAt" to System.currentTimeMillis(),
      "bufferKm" to number(input["bufferKm"], 10.0).toInt(),
      "error" to error,
    )
  }

  private fun persistPack(pack: Map<String, Any?>) {
    val id = pack["id"] as String
    preferences.edit().putString("pack:$id", JSONObject(pack).toString()).apply()
  }

  private fun readPack(id: String): Map<String, Any?>? = preferences.getString("pack:$id", null)
    ?.let { jsonObjectToMap(JSONObject(it)) }

  private fun updateStatus(id: String, status: String, error: String?) {
    val current = readPack(id) ?: return
    val updated = current + mapOf("status" to status, "updatedAt" to System.currentTimeMillis(), "error" to error)
    persistPack(updated)
    sendEvent("packProgress", updated)
  }

  private fun jsonObjectToMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key -> jsonValue(json.get(key)) }
  private fun jsonValue(value: Any?): Any? = when (value) {
    JSONObject.NULL -> null
    is JSONObject -> jsonObjectToMap(value)
    is JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }
    else -> value
  }
}
