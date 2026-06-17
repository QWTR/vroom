package com.lexuuw.vroom.app.auto

import android.content.Context
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.Style
import com.mapbox.maps.extension.style.layers.generated.LineLayer
import com.mapbox.maps.extension.style.sources.generated.GeoJsonSource
import com.mapbox.maps.plugin.annotation.annotations
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationManager
import com.mapbox.maps.plugin.annotation.generated.PointAnnotationOptions
import com.mapbox.maps.plugin.annotation.generated.createPointAnnotationManager
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.animation.camera
import android.graphics.Color
import com.mapbox.maps.extension.style.layers.addLayer
import com.mapbox.maps.extension.style.layers.getLayer
import com.mapbox.maps.extension.style.layers.properties.generated.LineCap
import com.mapbox.maps.extension.style.layers.properties.generated.LineJoin
import com.mapbox.maps.extension.style.sources.addSource
import com.mapbox.maps.extension.style.sources.getSourceAs
import com.mapbox.geojson.Feature
import com.mapbox.geojson.LineString

class VroomMapSurfaceRenderer(private val carContext: CarContext) : DefaultLifecycleObserver {

    private var virtualDisplay: VirtualDisplay? = null
    private var mapView: MapView? = null
    private var isMapReady = false
    private var lastMapStyle: String? = null
    private var pointAnnotationManager: PointAnnotationManager? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        val surface = surfaceContainer.surface ?: return
        val width = surfaceContainer.width
        val height = surfaceContainer.height
        val dpi = surfaceContainer.dpi

        Log.d("VroomMapSurfaceRenderer", "onSurfaceAvailable: \$width x \$height, dpi: \$dpi")

        mainHandler.post {
            createVirtualDisplayAndMap(surface, width, height, dpi)
        }
    }

    fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        Log.d("VroomMapSurfaceRenderer", "onSurfaceDestroyed")
        mainHandler.post {
            mapView?.onDestroy()
            mapView = null
            virtualDisplay?.release()
            virtualDisplay = null
            isMapReady = false
        }
    }

    fun onVisibleAreaChanged(visibleArea: Rect) {
        // Adjust map padding if needed
    }

    fun onStableAreaChanged(stableArea: Rect) {
        // Adjust map padding if needed
    }

    private fun createVirtualDisplayAndMap(surface: Surface, width: Int, height: Int, dpi: Int) {
        val displayManager = carContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        virtualDisplay = displayManager.createVirtualDisplay(
            "VroomAndroidAutoDisplay",
            width,
            height,
            dpi,
            surface,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
        )

        val displayContext = carContext.createDisplayContext(virtualDisplay!!.display)
        
        mapView = MapView(displayContext, MapInitOptions(
            context = displayContext,
            styleUri = Style.DARK // Domyślny styl
        ))
        
        // Zmuszamy MapView do poprawnego wymiarowania w środowisku bez pełnego Activity
        mapView?.layout(0, 0, width, height)
        
        mapView?.mapboxMap?.loadStyleUri(Style.DARK) { style ->
            isMapReady = true
            lastMapStyle = Style.DARK
            setupRouteLayer(style)
            
            // Inicjalizacja managera adnotacji raz
            val annotationPlugin = mapView?.annotations
            pointAnnotationManager = annotationPlugin?.createPointAnnotationManager()
            
            Log.d("VroomMapSurfaceRenderer", "Mapbox Style Loaded & Annotation Manager Ready")
        }

        mapView?.onStart()
    }

    private fun setupRouteLayer(style: com.mapbox.maps.Style) {
        if (!style.styleSourceExists("vroom-route-source")) {
            val source = GeoJsonSource.Builder("vroom-route-source").build()
            style.addSource(source)
        }
        if (!style.styleLayerExists("vroom-route-layer")) {
            val layer = LineLayer("vroom-route-layer", "vroom-route-source")
                .lineColor(Color.parseColor("#e33835"))
                .lineWidth(8.0)
                .lineCap(LineCap.ROUND)
                .lineJoin(LineJoin.ROUND)
            style.addLayer(layer)
        }
    }

    fun updateMapWithPayload(payload: VroomPayload) {
        mainHandler.post {
            if (!isMapReady) return@post
            
            val map = mapView?.mapboxMap ?: return@post

            // Aktualizacja kamery
            if (payload.userLat != null && payload.userLng != null) {
                val cameraOptions = CameraOptions.Builder()
                    .center(Point.fromLngLat(payload.userLng, payload.userLat))
                    .bearing(payload.heading ?: 0.0)
                    .zoom(16.0)
                    .pitch(45.0)
                    .build()
                
                val animationOptions = MapAnimationOptions.Builder().duration(1000).build()
                mapView?.camera?.easeTo(cameraOptions, animationOptions)
            }

            // Aktualizacja stylu mapy
            val desiredStyle = if (payload.mapState.mapStyle?.contains("light") == true) Style.LIGHT else Style.DARK
            if (desiredStyle != lastMapStyle) {
                map.loadStyleUri(desiredStyle) { style ->
                    lastMapStyle = desiredStyle
                    setupRouteLayer(style)
                    // Po zmianie stylu manager adnotacji może wymagać ponownego stworzenia 
                    // lub upewnienia się, że warstwy są na miejscu.
                    val annotationPlugin = mapView?.annotations
                    pointAnnotationManager = annotationPlugin?.createPointAnnotationManager()
                }
            }

            // Rysowanie markerów
            val manager = pointAnnotationManager ?: return@post
            manager.deleteAll()

            val annotations = mutableListOf<PointAnnotationOptions>()

            // Nasz marker
            if (payload.userLat != null && payload.userLng != null) {
                annotations.add(PointAnnotationOptions()
                    .withPoint(Point.fromLngLat(payload.userLng, payload.userLat))
                )
            }

            // Inni użytkownicy
            payload.users.forEach { u ->
                annotations.add(PointAnnotationOptions()
                    .withPoint(Point.fromLngLat(u.lng, u.lat))
                    .withTextField(u.label)
                )
            }

            // Radary / Ostrzeżenia
            payload.warnings.forEach { w ->
                annotations.add(PointAnnotationOptions()
                    .withPoint(Point.fromLngLat(w.lng, w.lat))
                    .withTextField(w.label)
                )
            }

            manager.create(annotations)

            // Trasa
            map.getStyle { style ->
                val routeSource = style.getSourceAs<GeoJsonSource>("vroom-route-source")
                if (payload.route != null) {
                    val lineString = LineString.fromPolyline(payload.route, 6)
                    routeSource?.feature(Feature.fromGeometry(lineString))
                } else {
                    routeSource?.feature(Feature.fromGeometry(LineString.fromLngLats(emptyList())))
                }
            }
        }
    }

    override fun onDestroy(owner: LifecycleOwner) {
        mainHandler.post {
            mapView?.onStop()
            mapView?.onDestroy()
            mapView = null
            virtualDisplay?.release()
            virtualDisplay = null
        }
    }
}
