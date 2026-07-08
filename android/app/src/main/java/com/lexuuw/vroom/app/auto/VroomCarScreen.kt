package com.lexuuw.vroom.app.auto

import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Distance
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step

class VroomCarScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback {

    private var latestPayload: VroomPayload? = null
    private var lastTemplateSignature = ""
    private var hostNightModeActive = false
    private var manualNightModeOverride: Boolean? = null
    private val mapRenderer = VroomMapSurfaceRenderer(carContext)

    init {
        // Rejestrujemy powierzchnię mapy tylko raz dla całej sesji.
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        lifecycle.addObserver(mapRenderer)
    }

    override fun onGetTemplate(): Template {
        return buildNavigationTemplate()
    }

    private fun buildNavigationTemplate(): Template {
        val payload = latestPayload
        val snapshot = runCatching { AutoNavStore.snapshot(carContext) }.getOrNull()
        val builder = NavigationTemplate.Builder()
            .setActionStrip(carActionStrip(payload, snapshot))

        routingInfo(payload, snapshot)?.let { builder.setNavigationInfo(it) }

        return builder.build()
    }

    private fun carActionStrip(payload: VroomPayload?, snapshot: AutoNavSnapshot?): ActionStrip {
        val builder = ActionStrip.Builder()
        val isNavigating = payload?.isNavigating == true || snapshot?.isNavigating == true
        val isPreview = payload?.mapState?.routePreview == true && !isNavigating

        if (isPreview) {
            builder.addAction(
                Action.Builder()
                    .setTitle("Rozpocznij")
                    .setOnClickListener { VroomCarManager.startNativeRoutePreview() }
                    .build()
            )
        }

        builder.addAction(
            Action.Builder()
                .setTitle("Szukaj")
                .setOnClickListener { openSystemSearch() }
                .build()
        )

        if (isNavigating) {
            builder.addAction(
                Action.Builder()
                    .setTitle("Zakoncz")
                    .setOnClickListener { VroomCarManager.stopClick() }
                    .build()
            )
        }

        builder.addAction(
            Action.Builder()
                .setTitle(if (effectiveNightModeActive()) "Jasny" else "Ciemny")
                .setOnClickListener { toggleNightModeOverride() }
                .build()
        )

        builder.addAction(
            Action.Builder()
                .setTitle("Centruj")
                .setOnClickListener { mapRenderer.recenterFromHost() }
                .build()
        )

        return builder.build()
    }

    private fun openSystemSearch() {
        runCatching {
            carContext.getCarService(ScreenManager::class.java)
                .push(VroomSearchTextScreen(carContext))
        }.onFailure {
            Log.w("VroomCarScreen", "Unable to open Android Auto SearchTemplate", it)
        }
    }

    private fun routingInfo(payload: VroomPayload?, snapshot: AutoNavSnapshot?): RoutingInfo? {
        if (payload?.isNavigating == true) {
            val meters = (payload.turnDistanceMeters ?: payload.remainingDistanceMeters ?: 1)
                .coerceAtLeast(1)
                .toDouble()
            val cue = normalizedCue(
                payload.instruction,
                payload.destinationName,
                payload.maneuver,
                payload.maneuverModifier
            )
            return RoutingInfo.Builder()
                .setCurrentStep(
                    Step.Builder().apply {
                        setCue(cue)
                        setManeuver(Maneuver.Builder(maneuverType(payload.maneuver, payload.maneuverModifier, cue)).build())
                    }.build(),
                    Distance.create(meters, Distance.UNIT_METERS)
                )
                .build()
        }

        if (snapshot?.isNavigating == true) {
            val meters = (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
                .coerceAtLeast(1)
                .toDouble()
            val cue = normalizedCue(
                snapshot.instruction,
                snapshot.destinationName,
                snapshot.maneuver,
                snapshot.maneuverModifier
            )
            return RoutingInfo.Builder()
                .setCurrentStep(
                    Step.Builder().apply {
                        setCue(cue)
                        setManeuver(Maneuver.Builder(maneuverType(snapshot.maneuver, snapshot.maneuverModifier, cue)).build())
                    }.build(),
                    Distance.create(meters, Distance.UNIT_METERS)
                )
                .build()
        }

        return null
    }

    private fun normalizedCue(
        instruction: String?,
        destinationName: String?,
        maneuver: String?,
        modifier: String?
    ): String {
        val clean = instruction?.trim().orEmpty()
        if (clean.equals("rusz", ignoreCase = true) || clean.equals("depart", ignoreCase = true)) {
            return "Jedz prosto"
        }
        if (clean.isNotBlank() && !looksEnglishInstruction(clean)) return clean

        val type = maneuver?.lowercase(java.util.Locale.US).orEmpty()
        val mod = modifier?.lowercase(java.util.Locale.US).orEmpty()
        return when {
            type == "arrive" -> "Dojezdzasz do celu"
            (type == "roundabout" || type == "rotary") && mod.contains("exit") -> {
                val exit = mod.substringAfter("exit", "").trim().substringBefore(" ").toIntOrNull()
                if (exit != null && exit > 0) "Na rondzie zjedz ${roundaboutExitLabel(exit)} zjazdem" else "Wjedz na rondo"
            }
            type == "roundabout" || type == "rotary" -> "Wjedz na rondo"
            type == "merge" -> "Wlacz sie do ruchu"
            type == "fork" && mod.contains("left") -> "Trzymaj sie lewej strony"
            type == "fork" && mod.contains("right") -> "Trzymaj sie prawej strony"
            type == "fork" -> "Trzymaj sie rozwidlenia"
            mod.contains("uturn") -> "Zawroc"
            mod.contains("left") -> "Skrec w lewo"
            mod.contains("right") -> "Skrec w prawo"
            type == "depart" || mod.contains("straight") -> "Jedz prosto"
            else -> destinationName?.takeIf { it.isNotBlank() }?.let { "Jedz do $it" } ?: "Jedz prosto"
        }
    }

    private fun maneuverType(maneuver: String?, modifier: String?, cue: String? = null): Int {
        if (isStraightCue(cue)) return Maneuver.TYPE_STRAIGHT
        val type = maneuver?.lowercase(java.util.Locale.US).orEmpty()
        val mod = modifier?.lowercase(java.util.Locale.US).orEmpty()
        return when {
            type == "arrive" -> Maneuver.TYPE_UNKNOWN
            type == "roundabout" || type == "rotary" -> Maneuver.TYPE_ROUNDABOUT_ENTER_CW
            mod.contains("exit") -> Maneuver.TYPE_ROUNDABOUT_ENTER_CW
            type == "merge" && mod.contains("left") -> Maneuver.TYPE_MERGE_LEFT
            type == "merge" && mod.contains("right") -> Maneuver.TYPE_MERGE_RIGHT
            type == "merge" -> Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED
            type == "fork" && mod.contains("left") -> Maneuver.TYPE_FORK_LEFT
            type == "fork" && mod.contains("right") -> Maneuver.TYPE_FORK_RIGHT
            type == "fork" -> Maneuver.TYPE_STRAIGHT
            type == "off ramp" && mod.contains("left") -> Maneuver.TYPE_OFF_RAMP_NORMAL_LEFT
            type == "off ramp" && mod.contains("right") -> Maneuver.TYPE_OFF_RAMP_NORMAL_RIGHT
            type == "on ramp" && mod.contains("left") -> Maneuver.TYPE_ON_RAMP_NORMAL_LEFT
            type == "on ramp" && mod.contains("right") -> Maneuver.TYPE_ON_RAMP_NORMAL_RIGHT
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

    private fun roundaboutExitLabel(exit: Int): String = when (exit) {
        1 -> "pierwszym"
        2 -> "drugim"
        3 -> "trzecim"
        4 -> "czwartym"
        5 -> "piatym"
        else -> "${exit}."
    }

    private fun looksEnglishInstruction(value: String): Boolean {
        val lower = value.lowercase(java.util.Locale.US)
        return listOf("turn ", "continue", "merge", "arrive", "depart", "roundabout", "keep ", "head ").any { lower.contains(it) }
    }

    private fun templateSignature(payload: VroomPayload?): String {
        val snapshot = runCatching { AutoNavStore.snapshot(carContext) }.getOrNull()
        val isNavigating = payload?.isNavigating == true || snapshot?.isNavigating == true
        val isPreview = payload?.mapState?.routePreview == true && !isNavigating
        val cue = payload?.instruction?.takeIf { it.isNotBlank() }
            ?: snapshot?.instruction?.takeIf { it.isNotBlank() }
            ?: payload?.destinationName
            ?: snapshot?.destinationName
            ?: ""
        val distance = payload?.turnDistanceMeters
            ?: payload?.remainingDistanceMeters
            ?: snapshot?.turnDistanceMeters
            ?: snapshot?.remainingDistanceMeters
            ?: 0
        val maneuver = payload?.maneuver.orEmpty()
        val modifier = payload?.maneuverModifier ?: snapshot?.maneuverModifier ?: ""
        return "$isNavigating:$isPreview:$cue:$maneuver:$modifier:$distance:${effectiveNightModeActive()}"
    }

    fun setNightModeActive(isNightModeActive: Boolean) {
        hostNightModeActive = isNightModeActive
        mapRenderer.setNightModeActive(effectiveNightModeActive())
        invalidate()
    }

    private fun toggleNightModeOverride() {
        manualNightModeOverride = !effectiveNightModeActive()
        mapRenderer.setNightModeActive(effectiveNightModeActive())
        invalidate()
    }

    private fun effectiveNightModeActive(): Boolean {
        return manualNightModeOverride ?: hostNightModeActive
    }

    fun updateNativeLocation(lat: Double, lng: Double, speedMs: Double, heading: Double) {
        mapRenderer.updateNativeLocation(lat, lng, speedMs, heading)
    }

    fun syncOverlayDrivingTelemetry(speedLimitKmh: Int?) {
        mapRenderer.syncOverlayDrivingTelemetry(speedLimitKmh)
    }

    fun resyncMapMarkers() {
        mapRenderer.resyncMapMarkers()
    }

    fun updateData(jsonPayload: String) {
        val parsed = VroomPayloadParser.parse(jsonPayload)
        if (parsed != null) {
            latestPayload = parsed
            mapRenderer.updateMapWithPayload(parsed)
            val nextTemplateSignature = templateSignature(parsed)
            if (nextTemplateSignature != lastTemplateSignature) {
                lastTemplateSignature = nextTemplateSignature
                invalidate()
            }
        } else {
            Log.e("VroomCarScreen", "Nie udało się odczytać danych mapy")
        }
    }

    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        mapRenderer.onSurfaceAvailable(surfaceContainer)
    }

    override fun onVisibleAreaChanged(visibleArea: android.graphics.Rect) {
        mapRenderer.onVisibleAreaChanged(visibleArea)
    }

    override fun onStableAreaChanged(stableArea: android.graphics.Rect) {
        mapRenderer.onStableAreaChanged(stableArea)
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        mapRenderer.onSurfaceDestroyed(surfaceContainer)
    }

    override fun onClick(x: Float, y: Float) {
        mapRenderer.onClick(x, y)
    }

    override fun onScroll(distanceX: Float, distanceY: Float) {
        mapRenderer.onScroll(distanceX, distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        mapRenderer.onScale(focusX, focusY, scaleFactor)
    }
}
