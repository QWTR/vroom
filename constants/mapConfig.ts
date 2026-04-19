const _token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!_token && __DEV__) {
  console.warn('[mapConfig] EXPO_PUBLIC_MAPBOX_TOKEN is not set. Set it in your .env file.');
}
export const MAPBOX_TOKEN           = 'pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg';
export const MAPBOX_STYLE_DARK      = 'mapbox://styles/mapbox/dark-v11';
export const MAPBOX_STYLE_LIGHT     = 'mapbox://styles/mapbox/light-v11';
export const MAPBOX_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-v9';
export const MAPBOX_STYLE_HYBRID    = 'mapbox://styles/mapbox/satellite-streets-v12';
export const MAX_NEARBY_USERS_DISTANCE = 120;
export const API_URL                = 'https://v-room.app';
