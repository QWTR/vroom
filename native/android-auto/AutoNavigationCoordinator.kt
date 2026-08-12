package __PACKAGE__.auto

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.Trip
import java.util.TimeZone

object AutoNavigationCoordinator {
    private const val TAG = "AutoNavigation"
    private val mainHandler = Handler(Looper.getMainLooper())
    private var navigationManager: NavigationManager? = null
    private var carContext: CarContext? = null
    private var navigationActive = false
    @Volatile private var autoDriveEnabled = false
    private var lastTripSignature = ""

    fun attach(context: CarContext) {
        carContext = context
        val pendingAutoDrive = AutoPendingNavigation.consumeAutoDriveRequest(context)
        navigationManager = context.getCarService(NavigationManager::class.java)
        navigationManager?.setNavigationManagerCallback(object : NavigationManagerCallback {
            override fun onAutoDriveEnabled() {
                enableAutoDrive("host")
            }

            override fun onStopNavigation() {
                mainHandler.post {
                    VroomCarManager.stopClick()
                    stopNavigation()
                }
            }
        })
        if (pendingAutoDrive) enableAutoDrive("pending")
    }

    fun detach() {
        stopNavigation()
        runCatching { navigationManager?.clearNavigationManagerCallback() }
        navigationManager = null
        carContext = null
        autoDriveEnabled = false
        lastTripSignature = ""
        AutoDriveSimulator.stop()
    }

    fun isAutoDriveEnabled(): Boolean = autoDriveEnabled

    fun enableAutoDriveFromShell() {
        onAutoDriveRequested()
    }

    fun onAutoDriveRequested() {
        enableAutoDrive("receiver")
    }

    fun handleNavigationIntent(context: CarContext, intent: Intent?) {
        val request = AutoNavigationIntentHandler.parse(intent) ?: run {
            Log.w(TAG, "handleNavigationIntent: brak danych w intencie")
            return
        }
        Log.d(TAG, "handleNavigationIntent query=${request.query} coords=${request.latitude},${request.longitude}")
        if (request.shouldShowSearchResults) {
            request.query?.let { query ->
                mainHandler.post {
                    runCatching {
                        context.getCarService(ScreenManager::class.java)
                            .push(VroomSearchTextScreen(context, query))
                    }.onFailure { Log.w(TAG, "Nie udalo sie otworzyc wynikow wyszukiwania", it) }
                }
            }
            return
        }
        VroomCarManager.showNavigationIntentLoading(request.query ?: "Cel")
        val appContext = context.applicationContext
        Thread {
            val success = runCatching {
                when {
                    request.hasCoordinates -> AutoNavStore.startRoutePreviewToCoordinates(
                        appContext,
                        request.latitude!!,
                        request.longitude!!,
                        request.query ?: "Cel",
                    )
                    request.hasQuery -> AutoNavStore.startRoutePreviewToQuery(appContext, request.query!!)
                    else -> false
                }
            }.onFailure { Log.e(TAG, "Obsluga intentu nawigacji nie powiodla sie", it) }
                .getOrDefault(false)
            Log.d(TAG, "route preview success=$success autoDrive=$autoDriveEnabled")
            mainHandler.post {
                if (!success) {
                    VroomCarManager.clearNavigationIntentLoading()
                    if (request.hasQuery) {
                        Log.w(TAG, "route preview failed, opening search for ${request.query}")
                        runCatching {
                            context.getCarService(ScreenManager::class.java)
                                .push(VroomSearchTextScreen(context, request.query))
                        }
                    } else {
                        VroomCarManager.showDriverAlert("Nie udalo sie wyznaczyc trasy")
                    }
                    return@post
                }
                runCatching { context.getCarService(ScreenManager::class.java).popToRoot() }
                if (success && request.shouldAutoStartNavigation && !request.shouldShowRoutePreviewOnly) {
                    VroomCarManager.startNativeRoutePreview()
                    if (autoDriveEnabled) {
                        startAutoDriveIfReady(context)
                    }
                }
            }
        }.start()
    }

    private fun enableAutoDrive(source: String) {
        autoDriveEnabled = true
        Log.d(TAG, "Tryb testowej jazdy wlaczony przez $source")
        mainHandler.post {
            val context = carContext ?: return@post
            if (VroomCarManager.latestPayload()?.isNavigating == true) {
                startAutoDriveIfReady(context)
            }
        }
    }

    fun syncFromPayload(payload: VroomPayload?) {
        val context = carContext ?: return
        mainHandler.post {
            val snapshot = runCatching { AutoNavStore.snapshot(context) }.getOrNull()
            syncNavigationState(payload, snapshot)
        }
    }

    fun syncTripFromLatest(context: CarContext) {
        carContext = context
        syncFromPayload(VroomCarManager.latestPayload())
    }

    private fun syncNavigationState(payload: VroomPayload?, snapshot: AutoNavSnapshot?) {
        val isNavigating = payload?.isNavigating == true || snapshot?.isNavigating == true
        val isPreview = payload?.mapState?.routePreview == true && !isNavigating
        if (isNavigating) {
            if (!navigationActive) {
                runCatching { navigationManager?.navigationStarted() }
                navigationActive = true
                if (autoDriveEnabled) {
                    carContext?.let(::startAutoDriveIfReady)
                }
            }
            publishTrip(payload, snapshot)
        } else if (navigationActive && !isPreview) {
            stopNavigation()
        } else {
            lastTripSignature = ""
        }
    }

    fun stopNavigation() {
        AutoDriveSimulator.stop()
        AutoTurnNotificationManager.cancel(carContext)
        if (navigationActive) {
            runCatching { navigationManager?.navigationEnded() }
            navigationActive = false
        }
        lastTripSignature = ""
    }

    private fun startAutoDriveIfReady(context: CarContext) {
        if (!AutoDriveSimulator.isRunning() && VroomCarManager.latestPayload()?.isNavigating == true) {
            AutoDriveSimulator.start(context)
        }
    }

    private fun publishTrip(payload: VroomPayload?, snapshot: AutoNavSnapshot?) {
        val manager = navigationManager ?: return
        val maneuver = payload?.maneuver ?: snapshot?.maneuver
        val modifier = payload?.maneuverModifier ?: snapshot?.maneuverModifier
        val cue = AutoInstructionFormatter.cue(
            instruction = payload?.instruction ?: snapshot?.instruction,
            destinationName = payload?.destinationName ?: snapshot?.destinationName,
            maneuver = maneuver,
            modifier = modifier,
            exit = payload?.maneuverExit ?: snapshot?.maneuverExit,
        )
        val turnMeters = (payload?.turnDistanceMeters ?: snapshot?.turnDistanceMeters ?: 1)
            .coerceAtLeast(1)
            .toDouble()
        val remainingMeters = (payload?.remainingDistanceMeters ?: snapshot?.remainingDistanceMeters ?: turnMeters.toInt())
            .coerceAtLeast(1)
            .toDouble()
        val remainingSec = (payload?.remainingDurationSec ?: snapshot?.remainingDurationSec ?: 0)
            .coerceAtLeast(0)
        val destinationName = payload?.destinationName?.takeIf { it.isNotBlank() }
            ?: snapshot?.destinationName?.takeIf { it.isNotBlank() }
            ?: "Cel"
        val signature = "$cue:$turnMeters:$remainingMeters:$remainingSec:$maneuver:$modifier"
        if (signature == lastTripSignature) return
        lastTripSignature = signature

        val step = Step.Builder()
            .setCue(cue)
            .setManeuver(
                Maneuver.Builder(
                    AutoManeuverResolver.maneuverType(
                        maneuver = maneuver,
                        modifier = modifier,
                        instruction = payload?.instruction ?: snapshot?.instruction,
                        cue = cue,
                    ),
                ).build(),
            )
            .build()
        val stepEstimate = TravelEstimate.Builder(
            Distance.create(turnMeters, Distance.UNIT_METERS),
            DateTimeWithZone.create(
                System.currentTimeMillis() + (remainingSec * 1000L),
                TimeZone.getDefault(),
            ),
        ).build()
        val destination = Destination.Builder()
            .setName(destinationName)
            .build()
        val destinationEstimate = TravelEstimate.Builder(
            Distance.create(remainingMeters, Distance.UNIT_METERS),
            DateTimeWithZone.create(
                System.currentTimeMillis() + (remainingSec * 1000L),
                TimeZone.getDefault(),
            ),
        ).build()
        val tripBuilder = Trip.Builder().addStep(step, stepEstimate)
        val followingInstruction = payload?.followingInstruction?.takeIf { it.isNotBlank() }
            ?: snapshot?.followingInstruction?.takeIf { it.isNotBlank() }
        if (followingInstruction != null) {
            val followingManeuver = payload?.followingManeuver ?: snapshot?.followingManeuver
            val followingModifier = payload?.followingManeuverModifier ?: snapshot?.followingManeuverModifier
            val followingCue = AutoInstructionFormatter.cue(
                followingInstruction,
                destinationName,
                followingManeuver,
                followingModifier,
                payload?.followingManeuverExit ?: snapshot?.followingManeuverExit,
            )
            val followingStep = Step.Builder()
                .setCue(followingCue)
                .setManeuver(
                    Maneuver.Builder(
                        AutoManeuverResolver.maneuverType(followingManeuver, followingModifier, followingInstruction, followingCue),
                    ).build(),
                )
                .build()
            val followingMeters = (payload?.followingTurnDistanceMeters ?: snapshot?.followingTurnDistanceMeters ?: turnMeters.toInt())
                .coerceAtLeast(1)
                .toDouble()
            tripBuilder.addStep(
                followingStep,
                TravelEstimate.Builder(
                    Distance.create(followingMeters, Distance.UNIT_METERS),
                    DateTimeWithZone.create(System.currentTimeMillis() + remainingSec * 1_000L, TimeZone.getDefault()),
                ).build(),
            )
        }
        val trip = tripBuilder
            .addDestination(destination, destinationEstimate)
            .build()
        runCatching { manager.updateTrip(trip) }
        carContext?.let { AutoTurnNotificationManager.update(it, cue, turnMeters, destinationName) }
    }
}
