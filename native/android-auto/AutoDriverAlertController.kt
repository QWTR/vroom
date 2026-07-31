package __PACKAGE__.auto

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.widget.Toast
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import java.util.Locale
import kotlin.math.roundToInt

/** Prioritises driver alerts and serialises all spoken navigation audio. */
object AutoDriverAlertController : TextToSpeech.OnInitListener {
    private const val OBJECT_COOLDOWN_MS = 180_000L
    private const val VOICE_GAP_MS = 6_000L
    private var carContext: CarContext? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val lastAlertAt = mutableMapOf<String, Long>()
    private val lastVoiceAlertAt = mutableMapOf<String, Long>()
    private val spokenManeuverPhases = mutableSetOf<String>()
    private val chainedPrepareKeys = mutableSetOf<String>()
    private val pendingUtterances = mutableSetOf<String>()
    private val onUtteranceStarted = mutableMapOf<String, () -> Unit>()
    private var activeInstructionKey = ""
    private var lastVoiceAt = 0L
    private var appliedVoiceIdentifier: String? = null
    private var criticalUtteranceId: String? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { }

    fun attach(context: CarContext) {
        carContext = context
        if (tts == null) tts = TextToSpeech(context.applicationContext, this)
    }

    fun detach() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
        abandonAudioFocus()
        carContext = null
        lastAlertAt.clear()
        lastVoiceAlertAt.clear()
        spokenManeuverPhases.clear()
        chainedPrepareKeys.clear()
        pendingUtterances.clear()
        onUtteranceStarted.clear()
        activeInstructionKey = ""
        lastVoiceAt = 0L
        appliedVoiceIdentifier = null
        criticalUtteranceId = null
    }

    override fun onInit(status: Int) {
        val engine = tts ?: return
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) return
        engine.language = Locale("pl", "PL")
        engine.setSpeechRate(0.96f)
        engine.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                val id = utteranceId ?: return
                pendingUtterances.remove(id)
                lastVoiceAt = System.currentTimeMillis()
                onUtteranceStarted.remove(id)?.invoke()
            }
            override fun onDone(utteranceId: String?) {
                utteranceId?.let {
                    pendingUtterances.remove(it)
                    onUtteranceStarted.remove(it)
                }
                if (utteranceId == criticalUtteranceId) criticalUtteranceId = null
                abandonAudioFocus()
            }
            @Deprecated("Deprecated by Android")
            override fun onError(utteranceId: String?) {
                utteranceId?.let {
                    pendingUtterances.remove(it)
                    onUtteranceStarted.remove(it)
                }
                if (utteranceId == criticalUtteranceId) criticalUtteranceId = null
                abandonAudioFocus()
            }
        })
    }

    fun update(payload: VroomPayload) {
        val context = carContext ?: return
        applyVoice(payload)
        val now = System.currentTimeMillis()
        val alert = AutoDriverAlertPolicy.select(payload)
        if (alert != null && AutoDriverAlertPolicy.isCooldownReady(lastAlertAt[alert.id] ?: 0L, now, OBJECT_COOLDOWN_MS)) {
            lastAlertAt[alert.id] = now
            val distance = readableDistance(alert.distanceMeters)
            showVisualAlert(alert, distance)
        }

        val voiceAlert = AutoDriverAlertPolicy.selectVoiceEnforcement(payload)
        val canSpeakAlert = voiceAlert != null &&
            payload.mapState.voiceAlerts &&
            AutoNavStore.snapshot(context).voiceAlerts &&
            AutoDriverAlertPolicy.isCooldownReady(lastVoiceAlertAt[voiceAlert.id] ?: 0L, now, OBJECT_COOLDOWN_MS)
        val criticalAlert = canSpeakAlert && (voiceAlert?.priority ?: 0) >= 4

        if (criticalAlert && voiceAlert != null) {
            speakAlert(voiceAlert, urgent = true)
        }

        if (!criticalAlert && criticalUtteranceId == null) {
            updateManeuverVoice(payload)
        }

        if (canSpeakAlert && !criticalAlert && voiceAlert != null) {
            speakAlert(voiceAlert, urgent = false)
        }
    }

    fun stopVoice() {
        tts?.stop()
        criticalUtteranceId = null
        abandonAudioFocus()
    }

    private fun updateManeuverVoice(payload: VroomPayload) {
        val context = carContext ?: return
        if (
            !payload.isNavigating ||
            !payload.mapState.voiceGuidance ||
            !AutoNavStore.navigationVoiceEnabled(context)
        ) return
        val cue = AutoInstructionFormatter.cue(payload.instruction, payload.destinationName, payload.maneuver, payload.maneuverModifier, payload.maneuverExit)
        val distance = payload.turnDistanceMeters ?: return
        val instructionKey = "${payload.maneuver}:${payload.maneuverModifier}:$cue"
        if (instructionKey != activeInstructionKey) {
            activeInstructionKey = instructionKey
            spokenManeuverPhases.clear()
            if (instructionKey in chainedPrepareKeys) {
                spokenManeuverPhases.add("$instructionKey:approach")
            }
        }
        if (!isSpeakableManeuver(payload.maneuver, payload.maneuverModifier)) return
        val speedKmh = payload.mapState.speedKmh.coerceAtLeast((payload.speed ?: 0.0) * 3.6)
        val speedMs = (speedKmh / 3.6).coerceAtLeast(0.0)
        val prepareThreshold = (speedMs * 25.0).coerceIn(250.0, 900.0)
        val nowThreshold = (speedMs * 4.0).coerceIn(35.0, 120.0)
        val needsMiddleCue = speedKmh >= 70.0 || isComplexManeuver(payload.maneuver, payload.maneuverModifier)
        val middleThreshold = (speedMs * 10.0).coerceIn(100.0, 300.0)
        val phase = when {
            distance <= nowThreshold -> "now"
            needsMiddleCue && distance <= middleThreshold -> "near"
            distance <= prepareThreshold -> "approach"
            else -> return
        }
        val phaseKey = "$instructionKey:$phase"
        val utteranceId = "maneuver:${instructionKey.hashCode()}:$phase"
        if (phaseKey in spokenManeuverPhases || utteranceId in pendingUtterances) return

        var phrase = if (phase == "now") cue else "Za ${readableDistance(distance.toDouble())}, $cue"
        var chainedKey: String? = null
        val followingDistance = payload.followingTurnDistanceMeters
        val chainByTime = followingDistance != null && speedMs > 1.0 && followingDistance / speedMs <= 15.0
        if (
            phase != "now" &&
            followingDistance != null &&
            (followingDistance <= 180 || chainByTime) &&
            payload.followingInstruction?.isNotBlank() == true
        ) {
            val followingCue = AutoInstructionFormatter.cue(
                payload.followingInstruction,
                payload.destinationName,
                payload.followingManeuver.orEmpty(),
                payload.followingManeuverModifier.orEmpty(),
                payload.followingManeuverExit,
            )
            phrase += ". Potem $followingCue"
            chainedKey = "${payload.followingManeuver}:${payload.followingManeuverModifier}:$followingCue"
        }
        speak(phrase, urgent = phase == "now", utteranceId = utteranceId) {
            spokenManeuverPhases.add(phaseKey)
            chainedKey?.let(chainedPrepareKeys::add)
        }
    }

    private fun speakAlert(candidate: AutoDriverAlertCandidate, urgent: Boolean) {
        val utteranceId = "enforcement:${candidate.id}"
        if (utteranceId in pendingUtterances) return
        val limit = candidate.title.toIntOrNull()?.let { ", ograniczenie $it" }.orEmpty()
        val accepted = speak(
            "${AutoDriverAlertPolicy.voiceTitle(candidate)}$limit, ${readableDistance(candidate.distanceMeters)}",
            urgent = urgent,
            utteranceId = utteranceId,
        ) {
            lastVoiceAlertAt[candidate.id] = System.currentTimeMillis()
        }
        if (accepted && urgent) criticalUtteranceId = utteranceId
    }

    private fun showVisualAlert(candidate: AutoDriverAlertCandidate, subtitle: String) {
        val title = if (AutoDriverAlertPolicy.shouldSpeak(candidate)) {
            AutoDriverAlertPolicy.voiceTitle(candidate)
        } else {
            candidate.title
        }
        showFallbackAlert("$title • $subtitle")
    }

    private fun showFallbackAlert(text: String) {
        val context = carContext ?: return
        VroomCarManager.showDriverAlert(text)
        runCatching { context.getCarService(AppManager::class.java).showToast(text, Toast.LENGTH_LONG) }
    }

    private fun speak(
        text: String,
        urgent: Boolean,
        utteranceId: String,
        started: () -> Unit = {},
    ): Boolean {
        if (!ttsReady || text.isBlank()) return false
        val now = System.currentTimeMillis()
        if (!urgent && (pendingUtterances.isNotEmpty() || now - lastVoiceAt < VOICE_GAP_MS)) return false
        requestAudioFocus()
        if (urgent) {
            pendingUtterances.clear()
            onUtteranceStarted.clear()
        }
        pendingUtterances.add(utteranceId)
        onUtteranceStarted[utteranceId] = started
        val result = tts?.speak(
            text,
            if (urgent) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,
            Bundle(),
            utteranceId,
        )
        if (result != TextToSpeech.SUCCESS) {
            pendingUtterances.remove(utteranceId)
            onUtteranceStarted.remove(utteranceId)
            abandonAudioFocus()
            return false
        }
        return true
    }

    private fun applyVoice(payload: VroomPayload) {
        val engine = tts ?: return
        if (!ttsReady) return
        val requested = payload.mapState.voiceIdentifier?.takeIf { payload.mapState.voiceMode == "manual" }
        val selected = engine.voices
            .asSequence()
            .filter { it.locale.language.equals("pl", ignoreCase = true) }
            .sortedWith(
                compareByDescending<android.speech.tts.Voice> { it.name == requested }
                    .thenByDescending { it.quality }
                    .thenBy { it.isNetworkConnectionRequired },
            )
            .firstOrNull()
        if (selected != null && selected.name != appliedVoiceIdentifier) {
            engine.voice = selected
            appliedVoiceIdentifier = selected.name
        }
    }

    private fun isSpeakableManeuver(maneuver: String?, modifier: String?): Boolean {
        val clean = "${maneuver.orEmpty()} ${modifier.orEmpty()}".lowercase()
        return listOf("depart", "notification", "new name", "continue", "straight").none(clean::contains)
    }

    private fun isComplexManeuver(maneuver: String?, modifier: String?): Boolean {
        val clean = "${maneuver.orEmpty()} ${modifier.orEmpty()}".lowercase()
        return listOf(
            "roundabout", "rotary", "fork", "merge", "ramp", "uturn",
            "u-turn", "sharp", "ostro", "rozwidlen", "zawr",
        ).any(clean::contains)
    }

    private fun requestAudioFocus() {
        val context = carContext ?: return
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = audioFocusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
                .also { audioFocusRequest = it }
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        }
    }

    private fun abandonAudioFocus() {
        val context = carContext ?: return
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let(manager::abandonAudioFocusRequest)
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(focusListener)
        }
    }

    private fun readableDistance(distanceMeters: Double): String = when {
        distanceMeters >= 950.0 -> String.format(Locale("pl", "PL"), "%.1f kilometra", distanceMeters / 1_000.0)
        else -> "${((distanceMeters / 50.0).roundToInt() * 50).coerceAtLeast(50)} metrów"
    }
}
