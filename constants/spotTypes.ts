export type SpotCategory =
  | 'Fotki'
  | 'Trasa'
  | 'Punkt widokowy'
  | 'Inne'
  | 'Cross'
  | 'Bagna'
  | 'Błoto'
  | 'Leśna droga'
  | 'Podjazd'
  | 'Piaski'
  | 'Skałki';

export interface Spot {
  id: string;
  name: string;
  description: string;
  category: SpotCategory;
  latitude: number;
  longitude: number;
  photos: string[];
  author: string;
  createdAt: string;
  likesCount:    number;
  commentsCount: number;
  isLiked:       boolean;
}

export interface SpotComment {
  id: number;
  text: string;
  createdAt: string;
  user: { id: number; username: string; avatarUrl: string | null };
}

export interface SpotDetails extends Spot {
  comments: SpotComment[];
  authorObj?: {
    id:        number;
    username:  string;
    avatarUrl: string | null;
  } | null;
}

export const CATEGORIES: SpotCategory[] = [
  'Fotki',
  'Trasa',
  'Punkt widokowy',
  'Inne',
  'Cross',
  'Bagna',
  'Błoto',
  'Leśna droga',
  'Podjazd',
  'Piaski',
  'Skałki',
];

export const OFFROAD_CATEGORIES: SpotCategory[] = [
  'Cross',
  'Bagna',
  'Błoto',
  'Leśna droga',
  'Podjazd',
  'Piaski',
  'Skałki',
];

export const CATEGORY_ICONS: Record<SpotCategory, string> = {
  'Fotki':          'camera-alt',
  'Trasa':          'route',
  'Punkt widokowy': 'landscape',
  'Inne':           'place',
  'Cross':          'two-wheeler',
  'Bagna':          'water',
  'Błoto':          'terrain',
  'Leśna droga':    'forest',
  'Podjazd':        'moving',
  'Piaski':         'waves',
  'Skałki':         'filter-hdr',
};

export const CATEGORY_COLORS: Record<SpotCategory, string> = {
  'Fotki':          '#ff9f43',
  'Trasa':          '#00bfff',
  'Punkt widokowy': '#00d26a',
  'Inne':           '#a29bfe',
  'Cross':          '#ff6b35',
  'Bagna':          '#26de81',
  'Błoto':          '#a0522d',
  'Leśna droga':    '#20bf6b',
  'Podjazd':        '#f7b731',
  'Piaski':         '#fed330',
  'Skałki':         '#778ca3',
};

export const DISTANCE_OPTIONS = [10, 25, 50, 100];

export const MOCK_SPOTS: never[] = [];