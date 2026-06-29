export type TutorialIconLib = 'material' | 'feather';

export type AppTutorialStep = {
  id: string;
  title: string;
  body: string;
  icon: string;
  iconLib?: TutorialIconLib;
  /** Przełącza tab przed pokazaniem kroku (expo-router). */
  tabRoute?: string;
};

export const APP_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'welcome',
    title: 'WITAJ W VROOM',
    body: 'Aplikacja dla pasjonatów motoryzacji — jazda, mapa, społeczność i rywalizacja w jednym miejscu. Ten krótki przewodnik pokaże Ci najważniejsze zakładki.',
    icon: 'car-sports',
    iconLib: 'material',
  },
  {
    id: 'home',
    title: 'HOME',
    body: 'Twój kokpit: streak, punkty, ranking i szybki dostęp do aktywności. Tu zaczynasz każdą sesję i śledzisz postępy.',
    icon: 'home',
    iconLib: 'feather',
    tabRoute: '/(tabs)',
  },
  {
    id: 'map',
    title: 'MAPA',
    body: 'Nawigacja, jazda, trasy i statystyki km. Ustaw cel, jedź bezpiecznie i odkrywaj spoty w okolicy.',
    icon: 'navigation',
    iconLib: 'feather',
    tabRoute: '/(tabs)/map',
  },
  {
    id: 'community',
    title: 'SPOŁECZNOŚĆ',
    body: 'Hub modułów: dyskusje, czaty, wydarzenia, rankingi i arena. Tu żyje społeczność VROOM.',
    icon: 'account-group-outline',
    iconLib: 'material',
    tabRoute: '/(tabs)/community',
  },
  {
    id: 'arena',
    title: 'BITWA DNIA & THE GRID',
    body: 'Pojedynek Dnia — głosuj na zwycięzcę co 24h. THE GRID to turniej 1v1: zgłoś auto i walcz o LEGENDARY.',
    icon: 'sword-cross',
    iconLib: 'material',
    tabRoute: '/(tabs)/community',
  },
  {
    id: 'social',
    title: 'CZATY, KLUBY, GIEŁDA',
    body: 'Pisz do znajomych, dołącz do klubów z własnymi kanałami albo kupuj i sprzedawaj na giełdzie VROOM.',
    icon: 'forum',
    iconLib: 'material',
    tabRoute: '/(tabs)/community',
  },
  {
    id: 'spots',
    title: 'SPOTY',
    body: 'Mapa miejsc spotkań — parkingi, zloty, punkty widokowe. Dodawaj własne i odkrywaj nowe.',
    icon: 'map-marker-radius-outline',
    iconLib: 'material',
    tabRoute: '/(tabs)/spotmap',
  },
  {
    id: 'profile',
    title: 'PROFIL',
    body: 'Twoje auto, statystyki, osiągnięcia i ustawienia. Personalizuj profil i zarządzaj kontem.',
    icon: 'user',
    iconLib: 'feather',
    tabRoute: '/(tabs)/account',
  },
  {
    id: 'done',
    title: 'GOTOWE — JEDŹ!',
    body: 'Możesz wrócić do tego przewodnika w każdej chwili: Ustawienia → Aplikacja → Przewodnik po aplikacji. Do zobaczenia na trasie!',
    icon: 'flag-checkered',
    iconLib: 'material',
    tabRoute: '/(tabs)',
  },
];

export const APP_TUTORIAL_STORAGE = {
  pending: 'vroom_onboarding_pending',
  completed: 'vroom_onboarding_completed_v1',
} as const;
