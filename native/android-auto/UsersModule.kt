package __PACKAGE__.auto

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class UsersModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "UsersModule"

  @ReactMethod fun setNavigatingForAuto(isNavigating: Boolean) { AutoNavStore.setNavigating(ctx, isNavigating) }
  @ReactMethod fun saveMyLocationForAuto(lat: Double, lng: Double) { AutoNavStore.saveLocation(ctx, lat, lng) }
  @ReactMethod fun saveSpeedHeadingForAuto(speed: Double, heading: Double) { AutoNavStore.saveSpeedHeading(ctx, speed, heading) }
  @ReactMethod fun saveNavStepForAuto(stepText: String, stepDistance: String, etaText: String) { AutoNavStore.saveStep(ctx, stepText, stepDistance, etaText) }
  @ReactMethod fun saveRouteForAuto(routeJson: String) { AutoNavStore.saveRoute(ctx, routeJson) }
  @ReactMethod fun saveDestinationForAuto(lat: Double, lng: Double, name: String) { AutoNavStore.saveDestination(ctx, lat, lng, name) }
  @ReactMethod fun saveCarSafeNavStateForAuto(dtoJson: String) { AutoNavStore.saveCarSafeState(ctx, dtoJson) }
  @ReactMethod fun saveVisibleUsersForAuto(usersJson: String) { AutoNavStore.saveUsers(ctx, usersJson) }
  @ReactMethod fun saveWarningsForAuto(warningsJson: String) { AutoNavStore.saveWarnings(ctx, warningsJson) }
  @ReactMethod fun saveMapStateForAuto(mapStateJson: String) { AutoNavStore.saveMapState(ctx, mapStateJson) }
  @ReactMethod fun saveAuthTokenForAuto(token: String) { AutoNavStore.saveAuthToken(ctx, token) }
  @ReactMethod fun requestNavStopFromAuto() { AutoNavStore.requestStop(ctx) }
  @ReactMethod fun requestReportFromAuto() { AutoNavStore.requestReport(ctx) }
  @ReactMethod fun requestReportTypeFromAuto(type: String) { AutoNavStore.requestReport(ctx, type) }
  @ReactMethod fun checkNavStopRequested(promise: Promise) { promise.resolve(AutoNavStore.consumeStopRequest(ctx)) }
  @ReactMethod fun checkReportRequested(promise: Promise) { promise.resolve(AutoNavStore.consumeReportRequest(ctx)) }
}
