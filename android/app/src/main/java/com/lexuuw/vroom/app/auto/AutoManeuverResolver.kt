package com.lexuuw.vroom.app.auto

import androidx.car.app.navigation.model.Maneuver

object AutoManeuverResolver {
    fun maneuverType(
        maneuver: String?,
        modifier: String?,
        instruction: String? = null,
        cue: String? = null,
    ): Int {
        if (isStraightManeuver(maneuver, modifier, instruction, cue)) {
            return Maneuver.TYPE_STRAIGHT
        }
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

    fun isStraightManeuver(
        maneuver: String?,
        modifier: String?,
        instruction: String? = null,
        cue: String? = null,
    ): Boolean {
        val type = maneuver?.lowercase(java.util.Locale.US).orEmpty()
        val mod = modifier?.lowercase(java.util.Locale.US).orEmpty()
        if (type == "depart" || type == "continue") return true
        if (mod.contains("straight")) return true
        val texts = listOf(instruction, cue)
            .mapNotNull { it?.trim()?.takeIf { value -> value.isNotBlank() } }
            .map { it.lowercase(java.util.Locale("pl", "PL")) }
        if (texts.any { text ->
                (text.contains("jedz prosto") || text.contains("jedź prosto") || text.contains("prosto")) &&
                    !text.contains("w lewo") &&
                    !text.contains("w prawo") &&
                    !text.contains("skrec") &&
                    !text.contains("skręć")
            }
        ) {
            return true
        }
        if (texts.any { text ->
                text.contains("head ") ||
                    text.contains("continue") ||
                    text.equals("rusz", ignoreCase = true) ||
                    text.equals("depart", ignoreCase = true)
            }
        ) {
            return true
        }
        return false
    }

    fun drawGlyphKind(
        maneuver: String?,
        modifier: String?,
        instruction: String? = null,
    ): String = when {
        isStraightManeuver(maneuver, modifier, instruction, instruction) -> "straight"
        maneuver?.lowercase(java.util.Locale.US).orEmpty() in setOf("roundabout", "rotary") -> "roundabout"
        maneuver?.lowercase(java.util.Locale.US).orEmpty() == "arrive" -> "arrive"
        modifier?.lowercase(java.util.Locale.US)?.contains("left") == true -> "left"
        modifier?.lowercase(java.util.Locale.US)?.contains("right") == true -> "right"
        modifier?.lowercase(java.util.Locale.US)?.contains("uturn") == true -> "uturn"
        maneuver?.lowercase(java.util.Locale.US).orEmpty() == "merge" -> "merge"
        else -> "straight"
    }
}
