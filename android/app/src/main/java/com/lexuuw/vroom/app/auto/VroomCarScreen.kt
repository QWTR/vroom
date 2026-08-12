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
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Distance
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.core.graphics.drawable.IconCompat
import com.lexuuw.vroom.app.R

class VroomCarScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback {

    private var latestPayload: VroomPayload? = null
    private var lastTemplateSignature = ""
    private var hostNightModeActive = false
    private val mapRenderer = VroomMapSurfaceRenderer(carContext)

    init {
        // Rejestrujemy powierzchnię mapy tylko raz dla całej sesji.
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        lifecycle.addObserver(mapRenderer)
    }

    override fun onGetTemplate(): Template = runCatching { buildNavigationTemplate() }
        .getOrElse { error ->
            Log.e("VroomCarScreen", "Nie udało się zbudować NavigationTemplate", error)
            MessageTemplate.Builder("Nie udało się otworzyć mapy. Spróbuj ponownie.")
                .setTitle("VROOM")
                .build()
        }

    private fun buildNavigationTemplate(): Template {
        val payload = latestPayload
        val snapshot = runCatching { AutoNavStore.snapshot(carContext) }.getOrNull()
        val builder = NavigationTemplate.Builder()

        builder.setActionStrip(carActionStrip(payload, snapshot))
        builder.setMapActionStrip(
            ActionStrip.Builder()
                .addAction(Action.PAN)
                .addAction(recenterAction())
                .addAction(themeAction())
                .build(),
        )
        builder.setPanModeListener { isInPanMode ->
            if (!isInPanMode) mapRenderer.recenterFromHost()
        }

        routingInfo(payload, snapshot)?.let { builder.setNavigationInfo(it) }
        return builder.build()
    }

    private fun carActionStrip(payload: VroomPayload?, snapshot: AutoNavSnapshot?): ActionStrip {
        val builder = ActionStrip.Builder()
        val isNavigating = payload?.isNavigating == true || snapshot?.isNavigating == true
        val isPreview = payload?.mapState?.routePreview == true && !isNavigating

        if (isNavigating) {
            builder.addAction(iconAction(R.drawable.ic_auto_stop) { VroomCarManager.stopClick() })
            val voiceEnabled = AutoNavStore.navigationVoiceEnabled(carContext) ||
                AutoNavStore.voiceAlertsEnabled(carContext)
            builder.addAction(iconAction(
                if (voiceEnabled) R.drawable.ic_auto_voice else R.drawable.ic_auto_voice_muted,
                if (voiceEnabled) "Wycisz" else "Odcisz",
            ) {
                AutoNavStore.setNavigationVoiceEnabled(carContext, !voiceEnabled)
                AutoNavStore.setVoiceAlertsEnabled(carContext, !voiceEnabled)
                if (voiceEnabled) AutoDriverAlertController.stopVoice()
                lastTemplateSignature = ""
                invalidate()
            })
            builder.addAction(iconAction(R.drawable.ic_auto_report) {
                carContext.getCarService(ScreenManager::class.java).push(VroomReportScreen(carContext))
            })
            return builder.build()
        }

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

        builder.addAction(reportAction())
        builder.addAction(
            Action.Builder()
                .setTitle("Menu")
                .setOnClickListener { openMenu() }
                .build(),
        )

        return builder.build()
    }

    private fun recenterAction(): Action =
        persistentActionBuilder()
            .setIcon(
                CarIcon.Builder(
                    IconCompat.createWithResource(carContext, R.drawable.ic_auto_recenter),
                ).build(),
            )
            .setOnClickListener { mapRenderer.recenterFromHost() }
            .build()

    private fun themeAction(): Action =
        persistentActionBuilder()
            .setIcon(
                CarIcon.Builder(
                    IconCompat.createWithResource(carContext, R.drawable.ic_auto_theme),
                ).build(),
            )
            .setOnClickListener {
                AutoNavStore.toggleQuickTheme(carContext, hostNightModeActive)
                mapRenderer.setNightModeActive(effectiveNightModeActive())
                lastTemplateSignature = ""
                invalidate()
            }
            .build()

    private fun persistentActionBuilder(): Action.Builder =
        Action.Builder().apply {
            if (carContext.carAppApiLevel >= 5) setFlags(Action.FLAG_IS_PERSISTENT)
        }

    private fun iconAction(drawableRes: Int, title: String? = null, onClick: () -> Unit): Action =
        Action.Builder().apply {
            setIcon(CarIcon.Builder(IconCompat.createWithResource(carContext, drawableRes)).build())
            title?.let(::setTitle)
            setOnClickListener { onClick() }
        }.build()

    private fun reportAction(): Action =
        Action.Builder()
            .setTitle("Zgłoś")
            .setOnClickListener {
                carContext.getCarService(ScreenManager::class.java)
                    .push(VroomReportScreen(carContext))
            }
            .build()

    private fun openMenu() {
        carContext.getCarService(ScreenManager::class.java)
            .push(VroomMenuScreen(carContext))
    }

    private fun openSystemSearch() {
        runCatching {
            carContext.getCarService(ScreenManager::class.java)
                .push(VroomSearchTextScreen(carContext))
        }.onFailure {
            Log.w("VroomCarScreen", "Unable to open Android Auto SearchTemplate", it)
        }
    }

    private fun routingInfo(payload: VroomPayload?, snapshot: AutoNavSnapshot?): NavigationTemplate.NavigationInfo? {
        if (payload?.mapState?.arrived == true || snapshot?.arrived == true) {
            val destination = payload?.destinationName ?: snapshot?.destinationName ?: "celu"
            return MessageInfo.Builder("Jesteś na miejscu")
                .setText("Dotarłeś do $destination")
                .build()
        }
        if (payload?.mapState?.isBuilding == true || payload?.mapState?.offRoute == true || snapshot?.isBuilding == true || snapshot?.offRoute == true) {
            return MessageInfo.Builder("Przeliczam trasę")
                .setText("Za chwilę pokażę dalsze prowadzenie")
                .build()
        }
        if (payload?.isNavigating == true && (payload.userLat == null || payload.userLng == null)) {
            return MessageInfo.Builder("Szukam sygnału GPS")
                .setText("Jedź ostrożnie — pozycja wróci automatycznie")
                .build()
        }
        if (payload?.isNavigating == true) {
            val meters = (payload.turnDistanceMeters ?: payload.remainingDistanceMeters ?: 1)
                .coerceAtLeast(1)
                .toDouble()
            val cue = AutoInstructionFormatter.cue(payload.instruction, payload.destinationName, payload.maneuver, payload.maneuverModifier, payload.maneuverExit)
            return RoutingInfo.Builder()
                .setCurrentStep(systemStep(cue, payload.maneuver, payload.maneuverModifier, payload.instruction), Distance.create(meters, Distance.UNIT_METERS))
                .build()
        }

        if (snapshot?.isNavigating == true) {
            val meters = (snapshot.turnDistanceMeters ?: snapshot.remainingDistanceMeters ?: 1)
                .coerceAtLeast(1)
                .toDouble()
            val cue = AutoInstructionFormatter.cue(snapshot.instruction, snapshot.destinationName, snapshot.maneuver, snapshot.maneuverModifier, snapshot.maneuverExit)
            return RoutingInfo.Builder()
                .setCurrentStep(systemStep(cue, snapshot.maneuver, snapshot.maneuverModifier, snapshot.instruction), Distance.create(meters, Distance.UNIT_METERS))
                .build()
        }

        return null
    }

    private fun systemStep(cue: String, maneuver: String?, modifier: String?, instruction: String?): Step =
        Step.Builder()
            .setCue(cue)
            .setManeuver(
                Maneuver.Builder(
                    AutoManeuverResolver.maneuverType(maneuver, modifier, instruction, cue),
                ).build(),
            )
            .build()

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
        val following = payload?.followingInstruction ?: snapshot?.followingInstruction ?: ""
        val voice = AutoNavStore.navigationVoiceEnabled(carContext) ||
            AutoNavStore.voiceAlertsEnabled(carContext)
        val navigationState = when {
            payload?.mapState?.arrived == true -> "arrived"
            payload?.mapState?.isBuilding == true -> "building"
            payload?.mapState?.offRoute == true -> "off-route"
            payload?.isNavigating == true && (payload.userLat == null || payload.userLng == null) -> "gps"
            else -> "ready"
        }
        return "$isNavigating:$isPreview:$navigationState:$cue:$maneuver:$modifier:$following:$distance:$voice:${effectiveNightModeActive()}"
    }

    fun setNightModeActive(isNightModeActive: Boolean) {
        hostNightModeActive = isNightModeActive
        mapRenderer.setNightModeActive(effectiveNightModeActive())
        invalidate()
    }

    private fun effectiveNightModeActive(): Boolean {
        return when (AutoNavStore.themeMode(carContext)) {
            AutoThemeMode.AUTO -> hostNightModeActive
            AutoThemeMode.DAY -> false
            AutoThemeMode.NIGHT -> true
        }
    }

    fun refreshTheme() {
        mapRenderer.setNightModeActive(effectiveNightModeActive())
        lastTemplateSignature = ""
        invalidate()
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

    fun showDriverAlert(text: String) {
        mapRenderer.showDriverAlert(text)
    }

    fun updateData(jsonPayload: String) {
        val parsed = VroomPayloadParser.parse(jsonPayload)
        if (parsed != null) {
            latestPayload = parsed
            mapRenderer.updateMapWithPayload(parsed)
            AutoDriverAlertController.update(parsed)
            val nextTemplateSignature = templateSignature(parsed)
            AutoNavigationCoordinator.syncFromPayload(parsed)
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
