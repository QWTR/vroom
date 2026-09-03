import { MAP_MARKER_IMAGE_KEYS } from '../../constants/mapMarkerAssets';

export { MAP_MARKER_IMAGE_KEYS } from '../../constants/mapMarkerAssets';

/** Bitmapy 2x trafiają od razu do natywnego atlasu Mapboxa. */
export const MAP_POI_MARKER_IMAGES = {
  [MAP_MARKER_IMAGE_KEYS.fuelCompact]: { image: require('../../assets/map-markers/poi-fuel-compact-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.fuelCard]: { image: require('../../assets/map-markers/poi-fuel-card-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.partnerCompact]: { image: require('../../assets/map-markers/poi-partner-compact-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.partnerCard]: { image: require('../../assets/map-markers/poi-partner-card-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.partnerOfferCard]: { image: require('../../assets/map-markers/poi-partner-offer-card-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.meetCompact]: { image: require('../../assets/map-markers/poi-meet-compact-2x.png'), scale: 2 },
  [MAP_MARKER_IMAGE_KEYS.meetCard]: { image: require('../../assets/map-markers/poi-meet-card-2x.png'), scale: 2 },
} as const;

export const MAP_SPEED_CAMERA_MARKER_IMAGES = {
  [MAP_MARKER_IMAGE_KEYS.speedCameraCompact]: { image: require('../../assets/map-markers/poi-camera-compact-2x.png'), scale: 2 },
} as const;

export const MAP_DROP_MARKER_IMAGES = {
  [MAP_MARKER_IMAGE_KEYS.dropCompact]: { image: require('../../assets/map-markers/poi-drop-compact-2x.png'), scale: 2 },
} as const;
