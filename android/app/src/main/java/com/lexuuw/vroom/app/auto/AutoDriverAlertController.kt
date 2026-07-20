package com.lexuuw.vroom.app.auto

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
    private const val VOICE_GAP_MS = 10_000L
    private var carContext: CarContext? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val lastAlertAt = mutableMapOf<String, Long>()
    private val lastVoiceAlertAt = mutableMapOf<String, Long>()
    private val spokenManeuverPhases = mutableSetOf<String>()
    private var activeInstructionKey = ""
    private var lastVoiceAt = 0L
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
        activeInstructionKey = ""
        lastVoiceAt = 0L
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
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = abandonAudioFocus()
            @Deprecated("Deprecated by Android")
            override fun onError(utteranceId: String?) = abandonAudioFocus()
        })
    }

    fun update(payload: VroomPayload) {
        val context = carContext ?: return
        val now = System.currentTimeMillis()
        val alert = AutoDriverAlertPolicy.select(payload)
        if (alert != null && AutoDriverAlertPolicy.isCooldownReady(lastAlertAt[alert.id] ?: 0L, now, OBJECT_COOLDOWN_MS)) {
            lastAlertAt[alert.id] = now
            val distance = readableDistance(alert.distanceMeters)
            showVisualAlert(alert, distance)
        }

        val voiceAlert = AutoDriverAlertPolicy.selectVoiceEnforcement(payload)
        if (
            voiceAlert != null &&
            AutoNavStore.snapshot(context).voiceAlerts &&
            AutoDriverAlertPolicy.isCooldownReady(lastVoiceAlertAt[voiceAlert.id] ?: 0L, now, OBJECT_COOLDOWN_MS)
        ) {
            val spoken = speak(
                "${AutoDriverAlertPolicy.voiceTitle(voiceAlert)}, ${readableDistance(voiceAlert.distanceMeters)}",
                urgent = true,
                utteranceId = "enforcement:${voiceAlert.id}",
            )
            if (spoken) {
                lastVoiceAlertAt[voiceAlert.id] = now
            }
        }

        updateManeuverVoice(payload)
    }

    fun stopVoice() {
        tts?.stop()
        abandonAudioFocus()
    }

    private fun updateManeuverVoice(payload: VroomPayload) {
        val context = carContext ?: return
        if (!payload.isNavigating || !AutoNavStore.navigationVoiceEnabled(context)) return
        val cue = AutoInstructionFormatter.cue(payload.instruction, payload.destinationName, payload.maneuver, payload.maneuverModifier, payload.maneuverExit)
        val distance = payload.turnDistanceMeters ?: return
        val instructionKey = "${payload.maneuver}:${payload.maneuverModifier}:$cue"
        if (instructionKey != activeInstructionKey) {
            activeInstructionKey = instructionKey
            spokenManeuverPhases.clear()
        }
        val phase = when {
            distance <= 55 -> "now"
            distance <= 250 -> "near"
            distance <= 900 -> "approach"
            else -> return
        }
        val phaseKey = "$instructionKey:$phase"
        if (phaseKey in spokenManeuverPhases) return
        val phrase = if (phase == "now") cue else "Za ${readableDistance(distance.toDouble())}, $cue"
        if (speak(phrase, urgent = phase == "now", utteranceId = "maneuver:$phase")) {
            spokenManeuverPhases.add(phaseKey)
        }
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

    private fun speak(text: String, urgent: Boolean, utteranceId: String): Boolean {
        if (!ttsReady || text.isBlank()) return false
        val now = System.currentTimeMillis()
        if (now - lastVoiceAt < VOICE_GAP_MS) return false
        lastVoiceAt = now
        requestAudioFocus()
        tts?.speak(text, if (urgent) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, Bundle(), utteranceId)
        return true
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
