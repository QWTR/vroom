#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(UsersModule, NSObject)

RCT_EXTERN_METHOD(setNavigatingForAuto:(BOOL)isNavigating)
RCT_EXTERN_METHOD(saveMyLocationForAuto:(nonnull NSNumber *)lat lng:(nonnull NSNumber *)lng)
RCT_EXTERN_METHOD(saveSpeedHeadingForAuto:(nonnull NSNumber *)speed heading:(nonnull NSNumber *)heading)
RCT_EXTERN_METHOD(saveNavStepForAuto:(NSString *)stepText stepDistance:(NSString *)stepDistance etaText:(NSString *)etaText)
RCT_EXTERN_METHOD(saveRouteForAuto:(NSString *)routeJson)
RCT_EXTERN_METHOD(saveDestinationForAuto:(nonnull NSNumber *)lat lng:(nonnull NSNumber *)lng name:(NSString *)name)
RCT_EXTERN_METHOD(saveCarSafeNavStateForAuto:(NSString *)dtoJson)
RCT_EXTERN_METHOD(requestNavStopFromAuto)
RCT_EXTERN_METHOD(checkNavStopRequested:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
