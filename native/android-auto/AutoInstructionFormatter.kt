package __PACKAGE__.auto

import java.util.Locale

/** One source of truth for the cue shown by Android Auto, TTS and map fallback UI. */
object AutoInstructionFormatter {
    fun cue(
        instruction: String?,
        destinationName: String? = null,
        maneuver: String? = null,
        modifier: String? = null,
        exit: Int? = null,
    ): String {
        val clean = instruction?.trim().orEmpty()
        if (clean.equals("rusz", true) || clean.equals("depart", true)) return "Jedź prosto"
        if (clean.isNotBlank() && !looksEnglish(clean)) return clean

        val type = maneuver?.lowercase(Locale.US).orEmpty()
        val mod = modifier?.lowercase(Locale.US).orEmpty()
        return when {
            type == "arrive" -> "Dojeżdżasz do celu"
            type == "roundabout" || type == "rotary" || mod.contains("exit") ->
                exit?.takeIf { it > 0 }?.let { "Na rondzie wybierz ${exitLabel(it)} zjazd" }
                    ?: "Wjedź na rondo"
            type == "merge" -> "Włącz się do ruchu"
            type == "fork" && mod.contains("left") -> "Trzymaj się lewej strony"
            type == "fork" && mod.contains("right") -> "Trzymaj się prawej strony"
            type == "fork" -> "Trzymaj się rozwidlenia"
            mod.contains("uturn") -> "Zawróć"
            mod.contains("left") -> "Skręć w lewo"
            mod.contains("right") -> "Skręć w prawo"
            type == "depart" || type == "continue" || mod.contains("straight") -> "Jedź prosto"
            else -> destinationName?.takeIf { it.isNotBlank() }?.let { "Jedź do $it" } ?: "Jedź prosto"
        }
    }

    private fun exitLabel(exit: Int): String = when (exit) {
        1 -> "pierwszy"
        2 -> "drugi"
        3 -> "trzeci"
        4 -> "czwarty"
        5 -> "piąty"
        else -> "$exit."
    }

    private fun looksEnglish(value: String): Boolean {
        val lower = value.lowercase(Locale.US)
        return listOf("turn ", "continue", "merge", "arrive", "depart", "roundabout", "keep ", "head ")
            .any(lower::contains)
    }
}
