package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class AutoThemeModeTest {
    @Test
    fun `unknown or missing values fall back to auto`() {
        assertEquals(AutoThemeMode.AUTO, AutoThemeMode.fromStored(null))
        assertEquals(AutoThemeMode.AUTO, AutoThemeMode.fromStored("legacy"))
    }

    @Test
    fun `stored values are case insensitive`() {
        assertEquals(AutoThemeMode.DAY, AutoThemeMode.fromStored("day"))
        assertEquals(AutoThemeMode.NIGHT, AutoThemeMode.fromStored("NIGHT"))
    }
}
