import { User } from './types';

export const GOOGLE_MAPS_APIKEY = 'AIzaSyAIViHITDEhTzTsfK_eIhA53PKlAL3dpTw';
export const MAX_NEARBY_USERS_DISTANCE = 120;
export const API_URL = 'https://v-room.app';
// Współrzędne są RELATIVE – zostaną podmienione na Twoją lokalizację + offset
// Na razie hardcode Warszawa – zamień na swoje miasto jeśli testujesz lokalnie
export const customMapStyle = [
  { elementType: 'geometry',           stylers: [{ color: '#181C27' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#d0d0d0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1e1e40' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#292951' }] },
  { featureType: 'road',           elementType: 'geometry',         stylers: [{ color: '#283d6a' }] },
  { featureType: 'road',           elementType: 'labels.text.fill', stylers: [{ color: '#a1b6d3' }] },
  { featureType: 'water',          elementType: 'geometry',         stylers: [{ color: '#151a2a' }] },
  { featureType: 'poi',    stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// ─── Jasny styl mapy ─────────────────────────────────────
export const lightMapStyle = [
  { elementType: 'geometry',           stylers: [{ color: '#f5f5f0' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#1a1a1a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry',         stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'road',           elementType: 'geometry',         stylers: [{ color: '#d0d0d0' }] },
  { featureType: 'road',           elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { featureType: 'road.highway',   elementType: 'geometry',         stylers: [{ color: '#b8b8b8' }] },
  { featureType: 'water',          elementType: 'geometry',         stylers: [{ color: '#aad3df' }] },
  { featureType: 'landscape',      elementType: 'geometry',         stylers: [{ color: '#eaeaea' }] },
  { featureType: 'poi.park',       elementType: 'geometry',         stylers: [{ color: '#c8e6c9' }] },
  { featureType: 'poi',   stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];