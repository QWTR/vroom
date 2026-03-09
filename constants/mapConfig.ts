import { User } from './types';

export const GOOGLE_MAPS_APIKEY = 'AIzaSyAIViHITDEhTzTsfK_eIhA53PKlAL3dpTw';
export const MAX_NEARBY_USERS_DISTANCE = 25;

// Współrzędne są RELATIVE – zostaną podmienione na Twoją lokalizację + offset
// Na razie hardcode Warszawa – zamień na swoje miasto jeśli testujesz lokalnie
export const MOCK_USERS: User[] = [
  { id: 'user_1', name: 'Anna K.',  latitude: 52.2297, longitude: 21.0122, avatar: '👩',   status: 'Online',  isFriend: true  },
  { id: 'user_2', name: 'Marek W.', latitude: 52.2319, longitude: 21.0054, avatar: '👨',   status: 'Online',  isFriend: true  },
  { id: 'user_3', name: 'Ewa S.',   latitude: 52.2280, longitude: 21.0150, avatar: '👩‍🦰', status: 'Offline', isFriend: false },
  { id: 'user_4', name: 'Jan K.',   latitude: 52.2310, longitude: 21.0100, avatar: '👨‍💼', status: 'Online',  isFriend: false },
  { id: 'user_5', name: 'Tomek Z.', latitude: 52.2250, longitude: 21.0200, avatar: '👨',   status: 'Online',  isFriend: true  },
];

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