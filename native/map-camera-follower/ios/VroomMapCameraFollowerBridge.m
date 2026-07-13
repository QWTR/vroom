#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(VroomMapCameraFollower, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(enabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(positionValid, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(markerVisible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(latitude, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(longitude, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(heading, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(zoom, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(pitch, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingTop, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingBottom, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingLeft, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(paddingRight, NSNumber)
@end
