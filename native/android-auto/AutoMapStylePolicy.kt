package __PACKAGE__.auto

/** Keeps the navigation basemap readable without thickening paths or labels. */
object AutoMapStylePolicy {
    fun emphasizedRoadWidth(layerId: String, layerType: String): Double? {
        if (!layerType.equals("line", ignoreCase = true)) return null
        val id = layerId.lowercase()
        if (!id.contains("road")) return null
        if (listOf(
                "label",
                "shield",
                "path",
                "trail",
                "pedestrian",
                "steps",
                "rail",
                "ferry",
                "traffic",
                "congestion",
            ).any(id::contains)
        ) {
            return null
        }

        val base = when {
            id.contains("motorway") || id.contains("trunk") -> 12.0
            id.contains("primary") -> 10.5
            id.contains("secondary") -> 9.0
            id.contains("tertiary") -> 8.0
            id.contains("street") -> 7.0
            id.contains("service") || id.contains("driveway") -> 5.5
            else -> 6.5
        }
        val isCasing = id.contains("case") || id.contains("casing") || id.contains("outline")
        return base + if (isCasing) 3.5 else 0.0
    }

    fun nightRoadColor(layerId: String, layerType: String): String? {
        if (emphasizedRoadWidth(layerId, layerType) == null) return null
        val id = layerId.lowercase()
        if (id.contains("case") || id.contains("casing") || id.contains("outline")) {
            return "#263548"
        }
        return when {
            id.contains("motorway") || id.contains("trunk") -> "#B8C9DB"
            id.contains("primary") -> "#A8BACD"
            id.contains("secondary") -> "#98AABE"
            id.contains("tertiary") -> "#899DB2"
            id.contains("street") -> "#7B8FA5"
            id.contains("service") || id.contains("driveway") -> "#6D8299"
            else -> "#8296AC"
        }
    }
}
