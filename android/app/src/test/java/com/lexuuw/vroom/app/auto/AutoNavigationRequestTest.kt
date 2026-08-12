package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoNavigationRequestTest {
    @Test
    fun `navigate request starts turn by turn navigation`() {
        val request = AutoNavigationRequest(query = "Warszawa", intentMode = "navigation")

        assertTrue(request.hasQuery)
        assertTrue(request.shouldAutoStartNavigation)
        assertFalse(request.shouldShowRoutePreviewOnly)
        assertFalse(request.shouldShowSearchResults)
    }

    @Test
    fun `directions and search requests keep their expected presentation`() {
        val directions = AutoNavigationRequest(query = "Krakow", intentMode = "directions")
        val search = AutoNavigationRequest(query = "stacja paliw", intentMode = "search")

        assertTrue(directions.shouldShowRoutePreviewOnly)
        assertFalse(directions.shouldAutoStartNavigation)
        assertTrue(search.shouldShowSearchResults)
        assertFalse(search.shouldAutoStartNavigation)
    }
}
