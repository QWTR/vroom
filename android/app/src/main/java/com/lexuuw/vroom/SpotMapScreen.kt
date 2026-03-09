package com.lexuuw.vroom

import android.content.Context
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import org.json.JSONArray

class SpotMapScreen(carContext: CarContext) : Screen(carContext) {

    data class UserItem(
        val id: String,
        val name: String,
        val latitude: Double,
        val longitude: Double,
        val status: String,
        val isFriend: Boolean,
    )

    private var users: List<UserItem> = emptyList()
    private var myLat: Double = 0.0
    private var myLng: Double = 0.0
    private var isLoading = true

    init {
        loadData()
        // ✅ Odświeżaj co 3 sekundy
        carContext.mainExecutor.execute(object : Runnable {
            override fun run() {
                loadData()
                carContext.mainExecutor.execute(this)
            }
        })
    }

    private fun loadData() {
        try {
            val prefs = carContext.getSharedPreferences("auto_data", Context.MODE_PRIVATE)

            // Moja lokalizacja
            myLat = prefs.getFloat("my_lat", 0f).toDouble()
            myLng = prefs.getFloat("my_lng", 0f).toDouble()

            // Użytkownicy
            val json = prefs.getString("users", "[]") ?: "[]"
            val arr = JSONArray(json)
            val list = mutableListOf<UserItem>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    UserItem(
                        id        = obj.optString("id", ""),
                        name      = obj.optString("name", "Użytkownik"),
                        latitude  = obj.optDouble("latitude", 0.0),
                        longitude = obj.optDouble("longitude", 0.0),
                        status    = obj.optString("status", ""),
                        isFriend  = obj.optBoolean("isFriend", false),
                    )
                )
            }
            users = list
            isLoading = false
            invalidate()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun calcDistance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    override fun onGetTemplate(): Template {
        val itemsBuilder = ItemList.Builder()

        if (isLoading || users.isEmpty()) {
            itemsBuilder.setNoItemsMessage(
                if (isLoading) "Ładowanie..." else "Brak użytkowników w pobliżu"
            )
        } else {
            // Sortuj po odległości
            val sorted = users.sortedBy {
                calcDistance(myLat, myLng, it.latitude, it.longitude)
            }

            sorted.take(50).forEach { user ->
                val dist = calcDistance(myLat, myLng, user.latitude, user.longitude)
                val distText = if (dist < 1.0)
                    "${(dist * 1000).toInt()} m"
                else
                    "${"%.1f".format(dist)} km"

                val friendLabel = if (user.isFriend) "👥 Znajomy · " else ""
                val statusLabel = if (user.status == "Online") "🟢" else "⚫"

                itemsBuilder.addItem(
                    Row.Builder()
                        .setTitle("$statusLabel ${user.name}")
                        .addText("$friendLabel$distText")
                        .setMetadata(
                            Metadata.Builder()
                                .setPlace(
                                    Place.Builder(
                                        CarLocation.create(user.latitude, user.longitude)
                                    )
                                    .setMarker(
                                        PlaceMarker.Builder()
                                            .setColor(
                                                if (user.isFriend) CarColor.BLUE
                                                else CarColor.RED
                                            )
                                            .build()
                                    )
                                    .build()
                                )
                                .build()
                        )
                        .build()
                )
            }
        }

        return PlaceListMapTemplate.Builder()
            .setTitle("👥 Użytkownicy w pobliżu")
            .setHeaderAction(Action.APP_ICON)
            .setItemList(itemsBuilder.build())
            .setLoading(false)
            .build()
    }
}