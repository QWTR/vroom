package com.lexuuw.vroom.app.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoMapStylePolicyTest {
    @Test fun `major roads are wider than local streets`() {
        val motorway = AutoMapStylePolicy.emphasizedRoadWidth("road-motorway", "line")!!
        val street = AutoMapStylePolicy.emphasizedRoadWidth("road-street", "line")!!
        assertTrue(motorway > street)
    }

    @Test fun `road casing stays wider than its fill`() {
        val fill = AutoMapStylePolicy.emphasizedRoadWidth("road-primary", "line")!!
        val casing = AutoMapStylePolicy.emphasizedRoadWidth("road-primary-case", "line")!!
        assertTrue(casing > fill)
        assertEquals("#263548", AutoMapStylePolicy.nightRoadColor("road-primary-case", "line"))
    }

    @Test fun `paths labels and non line layers are untouched`() {
        assertNull(AutoMapStylePolicy.emphasizedRoadWidth("road-path", "line"))
        assertNull(AutoMapStylePolicy.emphasizedRoadWidth("road-primary-traffic", "line"))
        assertNull(AutoMapStylePolicy.emphasizedRoadWidth("road-label", "symbol"))
        assertNull(AutoMapStylePolicy.emphasizedRoadWidth("building", "fill"))
        assertEquals(7.0, AutoMapStylePolicy.emphasizedRoadWidth("road-street", "line")!!, 0.01)
        assertEquals("#7B8FA5", AutoMapStylePolicy.nightRoadColor("road-street", "line"))
    }
}
