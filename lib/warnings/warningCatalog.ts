export type WarningType =
  | 'traffic'
  | 'weather'
  | 'accident'
  | 'car_breakdown'
  | 'speed_control'
  | 'Animal'
  | 'road_hazard'
  | 'kosmici';

export type WarningDirection = 'same' | 'opposite' | 'both' | 'unknown';
export type WarningSource = 'phone' | 'android_auto' | 'legacy';
export type WarningSubtype =
  | 'slow' | 'stopped' | 'queue'
  | 'fog' | 'heavy_rain' | 'snow_ice' | 'strong_wind'
  | 'collision' | 'blocked_lane' | 'road_blocked' | 'emergency_services'
  | 'shoulder' | 'lane'
  | 'speed' | 'documents' | 'tachograph' | 'truck_inspection' | 'weighing' | 'sobriety' | 'unmarked_patrol' | 'general'
  | 'on_road' | 'roadside'
  | 'obstacle' | 'pothole' | 'roadworks' | 'flooding' | 'slippery';

export type LiveWarning = {
  id: number;
  type: WarningType;
  subtype?: WarningSubtype | string | null;
  direction?: WarningDirection;
  heading?: number | null;
  source?: WarningSource;
  status?: 'active' | 'expired' | 'removed';
  dismissCount?: number;
  lat: number;
  lng: number;
  message: string;
  createdAt: string;
  expiresAt: string;
  confirmCount: number;
  user: { id: number; username: string; avatarUrl: string | null };
};

export type CreateWarningInput = {
  type: WarningType;
  subtype?: WarningSubtype | null;
  direction?: WarningDirection;
  heading?: number | null;
  source?: WarningSource;
  message?: string;
};

type WarningSubtypeOption = { value: WarningSubtype; label: string };
type WarningMeta = {
  label: string;
  shortLabel: string;
  color: string;
  glyph: string;
  icon: string;
  subtypes: WarningSubtypeOption[];
  reportable: boolean;
};

export const WARNING_CATALOG: Record<WarningType, WarningMeta> = {
  traffic: {
    label: 'Korek', shortLabel: 'KOREK', color: '#ff9500', glyph: '≋', icon: 'car-multiple', reportable: true,
    subtypes: [{ value: 'slow', label: 'Wolny ruch' }, { value: 'stopped', label: 'Ruch stoi' }, { value: 'queue', label: 'Kolejka' }],
  },
  weather: {
    label: 'Zła pogoda', shortLabel: 'POGODA', color: '#f4c430', glyph: '☂', icon: 'weather-lightning-rainy', reportable: true,
    subtypes: [{ value: 'fog', label: 'Mgła' }, { value: 'heavy_rain', label: 'Ulewa' }, { value: 'snow_ice', label: 'Śnieg / lód' }, { value: 'strong_wind', label: 'Silny wiatr' }],
  },
  accident: {
    label: 'Wypadek', shortLabel: 'WYPADEK', color: '#ff5a36', glyph: '!', icon: 'car-emergency', reportable: true,
    subtypes: [{ value: 'collision', label: 'Kolizja' }, { value: 'blocked_lane', label: 'Zablokowany pas' }, { value: 'road_blocked', label: 'Droga zablokowana' }, { value: 'emergency_services', label: 'Służby na miejscu' }],
  },
  car_breakdown: {
    label: 'Awaria pojazdu', shortLabel: 'AWARIA', color: '#748ffc', glyph: '⚙', icon: 'car-wrench', reportable: true,
    subtypes: [{ value: 'shoulder', label: 'Na poboczu' }, { value: 'lane', label: 'Na pasie ruchu' }],
  },
  speed_control: {
    label: 'Kontrola policji', shortLabel: 'KONTROLA', color: '#3d6cff', glyph: 'P', icon: 'police-badge', reportable: true,
    subtypes: [
      { value: 'speed', label: 'Pomiar prędkości' }, { value: 'documents', label: 'Dokumenty' },
      { value: 'tachograph', label: 'Tachograf' }, { value: 'truck_inspection', label: 'ITD / ciężarówki' },
      { value: 'weighing', label: 'Ważenie pojazdów' }, { value: 'sobriety', label: 'Trzeźwość' },
      { value: 'unmarked_patrol', label: 'Nieoznakowany patrol' }, { value: 'general', label: 'Kontrola ogólna' },
    ],
  },
  Animal: {
    label: 'Zwierzęta', shortLabel: 'ZWIERZĘTA', color: '#46c46f', glyph: '!', icon: 'paw', reportable: true,
    subtypes: [{ value: 'on_road', label: 'Na jezdni' }, { value: 'roadside', label: 'Przy drodze' }],
  },
  road_hazard: {
    label: 'Zagrożenie na drodze', shortLabel: 'ZAGROŻENIE', color: '#f05a67', glyph: '▲', icon: 'alert', reportable: true,
    subtypes: [{ value: 'obstacle', label: 'Przeszkoda' }, { value: 'pothole', label: 'Dziura' }, { value: 'roadworks', label: 'Roboty drogowe' }, { value: 'flooding', label: 'Zalanie' }, { value: 'slippery', label: 'Ślisko' }],
  },
  kosmici: {
    label: 'Inne ostrzeżenie', shortLabel: 'INNE', color: '#9aa0a6', glyph: '?', icon: 'help-circle', reportable: false, subtypes: [],
  },
};

export const REPORTABLE_WARNING_TYPES = (Object.keys(WARNING_CATALOG) as WarningType[])
  .filter((type) => WARNING_CATALOG[type].reportable);

export function warningSubtypeLabel(type: WarningType, subtype?: string | null): string | null {
  if (!subtype) return null;
  return WARNING_CATALOG[type].subtypes.find((item) => item.value === subtype)?.label ?? subtype;
}
