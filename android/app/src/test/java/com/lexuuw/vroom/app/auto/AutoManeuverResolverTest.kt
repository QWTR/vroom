package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class AutoManeuverResolverTest {
    @Test
    fun `resolves detailed cockpit glyphs`() {
        assertEquals("roundabout", AutoManeuverResolver.drawGlyphKind("roundabout", "right", "Rondo"))
        assertEquals("uturn-left", AutoManeuverResolver.drawGlyphKind("turn", "uturn left", "Zawróć"))
        assertEquals("fork-right", AutoManeuverResolver.drawGlyphKind("fork", "slight right", "Trzymaj się prawej"))
        assertEquals("merge-left", AutoManeuverResolver.drawGlyphKind("merge", "left", "Włącz się do ruchu"))
        assertEquals("ramp-right", AutoManeuverResolver.drawGlyphKind("off ramp", "right", "Zjedź"))
        assertEquals("arrive", AutoManeuverResolver.drawGlyphKind("arrive", "", "Cel"))
    }
}
