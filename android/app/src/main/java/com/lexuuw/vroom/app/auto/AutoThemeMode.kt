package com.lexuuw.vroom.app.auto

enum class AutoThemeMode {
    AUTO,
    DAY,
    NIGHT;

    companion object {
        fun fromStored(value: String?): AutoThemeMode =
            values().firstOrNull { it.name == value?.uppercase(java.util.Locale.US) } ?: AUTO
    }
}
