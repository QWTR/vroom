#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(VroomMapCameraFollower, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(enabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(markerVisible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(navigationSample, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(zoom, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(pitch, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingLeft, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingRight, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(bottomOcclusion, NSNumber)
@end
