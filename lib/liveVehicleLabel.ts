export function buildLiveVehicleIdentityProperties(
  id: number,
  username: string,
  pinColor: string,
) {
  'worklet';
  return {
    id,
    username: username.trim() || 'Użytkownik',
    pinColor,
  };
}

export const LIVE_VEHICLE_NAME_STYLE = {
  textField: ['get', 'username'],
  textSize: 12,
  textColor: '#ffffff',
  textHaloColor: 'rgba(0, 0, 0, 0.92)',
  textHaloWidth: 2,
  textHaloBlur: 0.5,
  textAnchor: 'bottom',
  textOffset: [0, -2.1],
  textAllowOverlap: true,
  textIgnorePlacement: true,
  textPitchAlignment: 'viewport',
  textRotationAlignment: 'viewport',
} as const;
