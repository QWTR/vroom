import type { Achievement } from '../hooks/useAchievements';

export type AchievementCatalogItem = Omit<
  Achievement,
  'id' | 'currentValue' | 'progress' | 'unlocked' | 'unlockedAt' | 'active'
>;

export const EXTRA_ACHIEVEMENTS: AchievementCatalogItem[] = [
  { key: 'distance_100', label: 'Pierwsza Setka', description: 'Przejedz lacznie 100 km.', icon: '🛣️', category: 'distance', rarity: 'common', points: 25, conditionField: 'totalDistance', conditionValue: 100 },
  { key: 'distance_500', label: 'Pol Tysiaca', description: 'Przejedz lacznie 500 km.', icon: '🧭', category: 'distance', rarity: 'common', points: 50, conditionField: 'totalDistance', conditionValue: 500 },
  { key: 'distance_2500', label: 'Tourer', description: 'Przejedz lacznie 2500 km.', icon: '🏁', category: 'distance', rarity: 'rare', points: 120, conditionField: 'totalDistance', conditionValue: 2500 },
  { key: 'distance_10000', label: 'Kontynent', description: 'Przejedz lacznie 10000 km.', icon: '🌍', category: 'distance', rarity: 'epic', points: 300, conditionField: 'totalDistance', conditionValue: 10000 },
  { key: 'distance_50000', label: 'Legenda Szos', description: 'Przejedz lacznie 50000 km.', icon: '👑', category: 'distance', rarity: 'legendary', points: 900, conditionField: 'totalDistance', conditionValue: 50000 },

  { key: 'rides_5', label: 'Regularny', description: 'Zapisz 5 przejazdow.', icon: '🚗', category: 'rides', rarity: 'common', points: 25, conditionField: 'totalRides', conditionValue: 5 },
  { key: 'rides_25', label: 'W Trasie', description: 'Zapisz 25 przejazdow.', icon: '🚘', category: 'rides', rarity: 'common', points: 60, conditionField: 'totalRides', conditionValue: 25 },
  { key: 'rides_100', label: 'Sto Startow', description: 'Zapisz 100 przejazdow.', icon: '🔑', category: 'rides', rarity: 'rare', points: 150, conditionField: 'totalRides', conditionValue: 100 },
  { key: 'rides_250', label: 'Garaz Pelny Tras', description: 'Zapisz 250 przejazdow.', icon: '🧰', category: 'rides', rarity: 'epic', points: 350, conditionField: 'totalRides', conditionValue: 250 },
  { key: 'rides_1000', label: 'Tysiak Przejazdow', description: 'Zapisz 1000 przejazdow.', icon: '🏆', category: 'rides', rarity: 'legendary', points: 1000, conditionField: 'totalRides', conditionValue: 1000 },

  { key: 'single_25', label: 'Dluzszy Wypad', description: 'Zrob jeden przejazd minimum 25 km.', icon: '📍', category: 'single_ride', rarity: 'common', points: 40, conditionField: 'longestRide', conditionValue: 25 },
  { key: 'single_100', label: 'Setka Na Raz', description: 'Zrob jeden przejazd minimum 100 km.', icon: '🗺️', category: 'single_ride', rarity: 'rare', points: 140, conditionField: 'longestRide', conditionValue: 100 },
  { key: 'single_300', label: 'Roadtrip', description: 'Zrob jeden przejazd minimum 300 km.', icon: '🌄', category: 'single_ride', rarity: 'epic', points: 400, conditionField: 'longestRide', conditionValue: 300 },
  { key: 'single_700', label: 'Iron Drive', description: 'Zrob jeden przejazd minimum 700 km.', icon: '🦾', category: 'single_ride', rarity: 'legendary', points: 1000, conditionField: 'longestRide', conditionValue: 700 },

  { key: 'speed_90', label: 'Tempo', description: 'Osiagnij 90 km/h.', icon: '⚡', category: 'speed', rarity: 'common', points: 35, conditionField: 'topSpeed', conditionValue: 90 },
  { key: 'speed_140', label: 'Autostrada', description: 'Osiagnij 140 km/h.', icon: '💨', category: 'speed', rarity: 'rare', points: 100, conditionField: 'topSpeed', conditionValue: 140 },
  { key: 'speed_180', label: 'Rakieta', description: 'Osiagnij 180 km/h.', icon: '🚀', category: 'speed', rarity: 'epic', points: 250, conditionField: 'topSpeed', conditionValue: 180 },
  { key: 'speed_200', label: 'Limit Fizyki', description: 'Osiagnij 200 km/h.', icon: '🔥', category: 'speed', rarity: 'legendary', points: 500, conditionField: 'topSpeed', conditionValue: 200 },

  { key: 'streak_3', label: 'Trzy Dni', description: 'Jedz przez 3 dni z rzedu.', icon: '📆', category: 'streak', rarity: 'common', points: 30, conditionField: 'rideStreakDays', conditionValue: 3 },
  { key: 'streak_7', label: 'Tydzien Za Kolkiem', description: 'Jedz przez 7 dni z rzedu.', icon: '🗓️', category: 'streak', rarity: 'rare', points: 100, conditionField: 'rideStreakDays', conditionValue: 7 },
  { key: 'streak_14', label: 'Dwa Tygodnie', description: 'Jedz przez 14 dni z rzedu.', icon: '🔥', category: 'streak', rarity: 'epic', points: 250, conditionField: 'rideStreakDays', conditionValue: 14 },
  { key: 'streak_30', label: 'Miesiac Jazdy', description: 'Jedz przez 30 dni z rzedu.', icon: '💎', category: 'streak', rarity: 'legendary', points: 800, conditionField: 'rideStreakDays', conditionValue: 30 },

  { key: 'drops_1', label: 'Pierwszy Zrzut', description: 'Odbierz pierwszy zrzut.', icon: '🎁', category: 'drops', rarity: 'common', points: 25, conditionField: 'geoDropsClaimed', conditionValue: 1 },
  { key: 'drops_5', label: 'Lowca Zrzutow', description: 'Odbierz 5 zrzutow.', icon: '📦', category: 'drops', rarity: 'common', points: 60, conditionField: 'geoDropsClaimed', conditionValue: 5 },
  { key: 'drops_10', label: 'Drop Hunter', description: 'Odbierz 10 zrzutow.', icon: '🧲', category: 'drops', rarity: 'rare', points: 120, conditionField: 'geoDropsClaimed', conditionValue: 10 },
  { key: 'drops_25', label: 'Magazynier', description: 'Odbierz 25 zrzutow.', icon: '🏗️', category: 'drops', rarity: 'epic', points: 300, conditionField: 'geoDropsClaimed', conditionValue: 25 },
  { key: 'drops_50', label: 'Król Zrzutow', description: 'Odbierz 50 zrzutow.', icon: '👑', category: 'drops', rarity: 'legendary', points: 700, conditionField: 'geoDropsClaimed', conditionValue: 50 },
  { key: 'drop_rare_1', label: 'Rare Drop', description: 'Odbierz pierwszy rzadki zrzut.', icon: '🔵', category: 'drops', rarity: 'rare', points: 120, conditionField: 'rareDropsClaimed', conditionValue: 1 },
  { key: 'drop_epic_1', label: 'Epic Drop', description: 'Odbierz pierwszy epicki zrzut.', icon: '🟣', category: 'drops', rarity: 'epic', points: 250, conditionField: 'epicDropsClaimed', conditionValue: 1 },
  { key: 'drop_legendary_1', label: 'Legendarny Zrzut', description: 'Odbierz pierwszy legendarny zrzut.', icon: '🟡', category: 'drops', rarity: 'legendary', points: 600, conditionField: 'legendaryDropsClaimed', conditionValue: 1 },

  { key: 'spots_1', label: 'Pierwszy Spot', description: 'Dodaj pierwszy spot.', icon: '📌', category: 'spots', rarity: 'common', points: 25, conditionField: 'spotsCreated', conditionValue: 1 },
  { key: 'spots_10', label: 'Mapa Spotow', description: 'Dodaj 10 spotow.', icon: '🧭', category: 'spots', rarity: 'rare', points: 140, conditionField: 'spotsCreated', conditionValue: 10 },
  { key: 'spot_photos_10', label: 'Fotoreporter', description: 'Dodaj 10 zdjec do spotow.', icon: '📸', category: 'spots', rarity: 'rare', points: 120, conditionField: 'spotPhotosUploaded', conditionValue: 10 },
  { key: 'spot_photos_50', label: 'Kronikarz', description: 'Dodaj 50 zdjec do spotow.', icon: '🎞️', category: 'spots', rarity: 'epic', points: 300, conditionField: 'spotPhotosUploaded', conditionValue: 50 },

  { key: 'social_followers_10', label: 'Znany Kierowca', description: 'Zdobadz 10 obserwujacych.', icon: '👥', category: 'social', rarity: 'rare', points: 120, conditionField: 'followersCount', conditionValue: 10 },
  { key: 'social_followers_100', label: 'Ikona Wiroom', description: 'Zdobadz 100 obserwujacych.', icon: '🌟', category: 'social', rarity: 'legendary', points: 800, conditionField: 'followersCount', conditionValue: 100 },
];

EXTRA_ACHIEVEMENTS.push(
  { key: 'passport_city_1', label: 'Pierwsza Pieczątka', description: 'Odwiedź pierwsze miasto w paszporcie.', icon: '🏙️', category: 'cities', rarity: 'common', points: 40, conditionField: 'cityCount', conditionValue: 1 },
  { key: 'passport_city_3', label: 'Weekendowy Nomada', description: 'Odwiedź 3 miasta w paszporcie.', icon: '🧳', category: 'cities', rarity: 'common', points: 90, conditionField: 'cityCount', conditionValue: 3 },
  { key: 'passport_city_5', label: 'Urbanista', description: 'Odwiedź 5 miast w paszporcie.', icon: '🏬', category: 'cities', rarity: 'rare', points: 200, conditionField: 'cityCount', conditionValue: 5 },
  { key: 'passport_city_10', label: 'Miejski Nomada', description: 'Odwiedź 10 miast w paszporcie.', icon: '🗺️', category: 'cities', rarity: 'epic', points: 500, conditionField: 'cityCount', conditionValue: 10 },
  { key: 'passport_city_25', label: 'Atlas Wiroom', description: 'Odwiedź 25 miast w paszporcie.', icon: '🌍', category: 'cities', rarity: 'legendary', points: 1200, conditionField: 'cityCount', conditionValue: 25 },

  { key: 'map_cells_50', label: 'Pierwsze Kafelki', description: 'Odkryj 50 kafelków mapy.', icon: '🗺️', category: 'map', rarity: 'common', points: 50, conditionField: 'coverageCellsCount', conditionValue: 50 },
  { key: 'map_cells_250', label: 'Siatka Trasy', description: 'Odkryj 250 kafelków mapy.', icon: '🧭', category: 'map', rarity: 'rare', points: 150, conditionField: 'coverageCellsCount', conditionValue: 250 },
  { key: 'map_cells_1000', label: 'Kartograf', description: 'Odkryj 1000 kafelków mapy.', icon: '📍', category: 'map', rarity: 'epic', points: 450, conditionField: 'coverageCellsCount', conditionValue: 1000 },
  { key: 'map_cells_5000', label: 'Mapa Bez Tajemnic', description: 'Odkryj 5000 kafelków mapy.', icon: '🛰️', category: 'map', rarity: 'legendary', points: 1400, conditionField: 'coverageCellsCount', conditionValue: 5000 },

  { key: 'district_first_25', label: 'Pierwsza Dzielnica 25%', description: 'Odkryj dowolny obszar w 25%.', icon: '🧭', category: 'map', rarity: 'common', points: 60, conditionField: 'districtMaxPct', conditionValue: 25 },
  { key: 'district_first_50', label: 'Pół Dzielnicy', description: 'Odkryj dowolny obszar w 50%.', icon: '🧭', category: 'map', rarity: 'rare', points: 140, conditionField: 'districtMaxPct', conditionValue: 50 },
  { key: 'district_first_75', label: 'Trzy Czwarte', description: 'Odkryj dowolny obszar w 75%.', icon: '🧭', category: 'map', rarity: 'epic', points: 260, conditionField: 'districtMaxPct', conditionValue: 75 },
  { key: 'district_first_100', label: 'Obszar Domknięty', description: 'Odkryj dowolny obszar w 100%.', icon: '🏁', category: 'map', rarity: 'legendary', points: 600, conditionField: 'districtMaxPct', conditionValue: 100 },
  { key: 'district_5_half', label: 'Pięciu Po Połowie', description: 'Odkryj 5 obszarów przynajmniej w 50%.', icon: '🧩', category: 'map', rarity: 'epic', points: 300, conditionField: 'district50Count', conditionValue: 5 },
  { key: 'district_10_half', label: 'Miejski Skaner', description: 'Odkryj 10 obszarów przynajmniej w 50%.', icon: '📡', category: 'map', rarity: 'legendary', points: 650, conditionField: 'district50Count', conditionValue: 10 },

  { key: 'turf_crown_1', label: 'Pierwsza Korona', description: 'Zdobądź pierwszą koronę Street Kings.', icon: '👑', category: 'map', rarity: 'rare', points: 180, conditionField: 'turfCrownCount', conditionValue: 1 },
  { key: 'turf_crown_3', label: 'Król Kilku Ulic', description: 'Zdobądź 3 korony Street Kings.', icon: '👑', category: 'map', rarity: 'epic', points: 420, conditionField: 'turfCrownCount', conditionValue: 3 },
  { key: 'turf_crown_10', label: 'Street King', description: 'Zdobądź 10 koron Street Kings.', icon: '👑', category: 'map', rarity: 'legendary', points: 1000, conditionField: 'turfCrownCount', conditionValue: 10 },

  { key: 'drop_common_first', label: 'Pierwszy Common', description: 'Odbierz pierwszy zwykły zrzut.', icon: '🎁', category: 'drops', rarity: 'common', points: 45, conditionField: 'commonDropsClaimed', conditionValue: 1 },
  { key: 'drop_rare_first_v2', label: 'Niebieski Łup', description: 'Odbierz pierwszy rare drop.', icon: '🔵', category: 'drops', rarity: 'rare', points: 150, conditionField: 'rareDropsClaimed', conditionValue: 1 },
  { key: 'drop_epic_first_v2', label: 'Fioletowy Strzał', description: 'Odbierz pierwszy epic drop.', icon: '🟣', category: 'drops', rarity: 'epic', points: 350, conditionField: 'epicDropsClaimed', conditionValue: 1 },
  { key: 'drop_legendary_first_v2', label: 'Złoty Zrzut', description: 'Odbierz pierwszy legendary drop.', icon: '🟡', category: 'drops', rarity: 'legendary', points: 900, conditionField: 'legendaryDropsClaimed', conditionValue: 1 },
  { key: 'drop_nav_1', label: 'Kierunek Zrzut', description: 'Włącz nawigację do zrzutu.', icon: '🧭', category: 'drops', rarity: 'common', points: 35, conditionField: 'geoDropNavigateIntents', conditionValue: 1 },
  { key: 'drop_nav_10', label: 'Łowca Sygnałów', description: 'Włącz nawigację do zrzutów 10 razy.', icon: '📡', category: 'drops', rarity: 'rare', points: 160, conditionField: 'geoDropNavigateIntents', conditionValue: 10 },

  { key: 'duel_vote_1', label: 'Pierwszy Typ', description: 'Oddaj pierwszy głos w pojedynku dnia.', icon: '🆚', category: 'duels', rarity: 'common', points: 30, conditionField: 'dailyDuelVotesCount', conditionValue: 1 },
  { key: 'duel_vote_10', label: 'Stały Juror', description: 'Oddaj 10 głosów w pojedynkach dnia.', icon: '🗳️', category: 'duels', rarity: 'rare', points: 120, conditionField: 'dailyDuelVotesCount', conditionValue: 10 },
  { key: 'duel_vote_50', label: 'Sędzia Dnia', description: 'Oddaj 50 głosów w pojedynkach dnia.', icon: '⚖️', category: 'duels', rarity: 'epic', points: 350, conditionField: 'dailyDuelVotesCount', conditionValue: 50 },
  { key: 'duel_win_1', label: 'Trafiony Zwycięzca', description: 'Zagłosuj na zwycięzcę pojedynku dnia.', icon: '🏆', category: 'duels', rarity: 'rare', points: 130, conditionField: 'dailyDuelWins', conditionValue: 1 },
  { key: 'duel_win_5', label: 'Dobry Nos', description: 'Traf 5 zwycięzców pojedynku dnia.', icon: '🎯', category: 'duels', rarity: 'epic', points: 320, conditionField: 'dailyDuelWins', conditionValue: 5 },
  { key: 'duel_win_25', label: 'Wyrocznia Garażu', description: 'Traf 25 zwycięzców pojedynku dnia.', icon: '🔮', category: 'duels', rarity: 'legendary', points: 1000, conditionField: 'dailyDuelWins', conditionValue: 25 },
  { key: 'grid_votes_10', label: 'Grid Starter', description: 'Oddaj 10 głosów w gridach.', icon: '🏁', category: 'duels', rarity: 'rare', points: 110, conditionField: 'gridVotesCount', conditionValue: 10 },
  { key: 'grid_votes_50', label: 'Grid Maniak', description: 'Oddaj 50 głosów w gridach.', icon: '🏎️', category: 'duels', rarity: 'epic', points: 300, conditionField: 'gridVotesCount', conditionValue: 50 },

  { key: 'discussion_post_1', label: 'Pierwszy Post', description: 'Dodaj pierwszy post.', icon: '📝', category: 'discussion', rarity: 'common', points: 30, conditionField: 'postsCreated', conditionValue: 1 },
  { key: 'discussion_post_10', label: 'Autor Wątku', description: 'Dodaj 10 postów.', icon: '🗒️', category: 'discussion', rarity: 'rare', points: 130, conditionField: 'postsCreated', conditionValue: 10 },
  { key: 'discussion_post_50', label: 'Redaktor Społeczności', description: 'Dodaj 50 postów.', icon: '📰', category: 'discussion', rarity: 'epic', points: 380, conditionField: 'postsCreated', conditionValue: 50 },
  { key: 'discussion_comment_5', label: 'Pierwsza Dyskusja', description: 'Dodaj 5 komentarzy pod postami.', icon: '💬', category: 'discussion', rarity: 'common', points: 45, conditionField: 'postCommentsCreated', conditionValue: 5 },
  { key: 'discussion_comment_25', label: 'Rozmówca', description: 'Dodaj 25 komentarzy pod postami.', icon: '🗣️', category: 'discussion', rarity: 'rare', points: 150, conditionField: 'postCommentsCreated', conditionValue: 25 },
  { key: 'discussion_comment_100', label: 'Głos Forum', description: 'Dodaj 100 komentarzy pod postami.', icon: '📣', category: 'discussion', rarity: 'epic', points: 420, conditionField: 'postCommentsCreated', conditionValue: 100 },
  { key: 'post_likes_given_25', label: 'Dobry Gest', description: 'Daj 25 polubień postom.', icon: '❤️', category: 'discussion', rarity: 'common', points: 60, conditionField: 'postLikesGiven', conditionValue: 25 },
  { key: 'post_reactions_given_25', label: 'Reaktor', description: 'Dodaj 25 reakcji pod postami.', icon: '✨', category: 'discussion', rarity: 'rare', points: 120, conditionField: 'postReactionsGiven', conditionValue: 25 },
  { key: 'post_poll_votes_5', label: 'Ankieter', description: 'Zagłosuj w 5 ankietach.', icon: '📊', category: 'discussion', rarity: 'common', points: 60, conditionField: 'postPollVotesCount', conditionValue: 5 },
  { key: 'reposts_5', label: 'Podbijacz', description: 'Udostępnij 5 postów.', icon: '🔁', category: 'discussion', rarity: 'rare', points: 140, conditionField: 'repostsCount', conditionValue: 5 },

  { key: 'chat_public_1', label: 'Pierwsza Wiadomość', description: 'Wyślij pierwszą wiadomość na czacie ogólnym.', icon: '💬', category: 'chat', rarity: 'common', points: 25, conditionField: 'publicChatMessagesSent', conditionValue: 1 },
  { key: 'chat_public_25', label: 'Bywalec Czatu', description: 'Wyślij 25 wiadomości na czacie ogólnym.', icon: '💬', category: 'chat', rarity: 'common', points: 80, conditionField: 'publicChatMessagesSent', conditionValue: 25 },
  { key: 'chat_public_100', label: 'Głos Kanału', description: 'Wyślij 100 wiadomości na czacie ogólnym.', icon: '📢', category: 'chat', rarity: 'rare', points: 220, conditionField: 'publicChatMessagesSent', conditionValue: 100 },
  { key: 'chat_public_500', label: 'Legenda Czatu', description: 'Wyślij 500 wiadomości na czacie ogólnym.', icon: '🎙️', category: 'chat', rarity: 'legendary', points: 900, conditionField: 'publicChatMessagesSent', conditionValue: 500 },
  { key: 'chat_public_reactions_25', label: 'Szybka Reakcja', description: 'Dodaj 25 reakcji na czacie ogólnym.', icon: '⚡', category: 'chat', rarity: 'rare', points: 130, conditionField: 'publicChatReactionsGiven', conditionValue: 25 },
  { key: 'club_chat_10', label: 'Klubowy Głos', description: 'Wyślij 10 wiadomości w klubie.', icon: '🏎️', category: 'chat', rarity: 'rare', points: 120, conditionField: 'clubMessagesSent', conditionValue: 10 },
  { key: 'club_chat_100', label: 'Stały Klubowicz', description: 'Wyślij 100 wiadomości w klubie.', icon: '🏁', category: 'chat', rarity: 'epic', points: 360, conditionField: 'clubMessagesSent', conditionValue: 100 },
  { key: 'club_reactions_25', label: 'Klubowa Energia', description: 'Dodaj 25 reakcji w klubie.', icon: '✨', category: 'chat', rarity: 'rare', points: 130, conditionField: 'clubReactionsGiven', conditionValue: 25 },
  { key: 'private_msg_25', label: 'Na Privie', description: 'Wyślij 25 wiadomości prywatnych.', icon: '✉️', category: 'chat', rarity: 'common', points: 70, conditionField: 'privateMessagesSent', conditionValue: 25 },
  { key: 'private_msg_100', label: 'Łącznik', description: 'Wyślij 100 wiadomości prywatnych.', icon: '📨', category: 'chat', rarity: 'rare', points: 180, conditionField: 'privateMessagesSent', conditionValue: 100 },

  { key: 'spot_comments_5', label: 'Komentator Spotów', description: 'Dodaj 5 komentarzy pod spotami.', icon: '📍', category: 'spots', rarity: 'common', points: 60, conditionField: 'spotCommentsCreated', conditionValue: 5 },
  { key: 'spot_comments_25', label: 'Recenzent Miejsc', description: 'Dodaj 25 komentarzy pod spotami.', icon: '🗺️', category: 'spots', rarity: 'rare', points: 160, conditionField: 'spotCommentsCreated', conditionValue: 25 },
  { key: 'spot_likes_25', label: 'Łowca Miejscówek', description: 'Polub 25 spotów.', icon: '❤️', category: 'spots', rarity: 'rare', points: 140, conditionField: 'spotLikesGiven', conditionValue: 25 },
  { key: 'car_comments_10', label: 'Pod Maską', description: 'Dodaj 10 komentarzy pod autami.', icon: '🚗', category: 'social', rarity: 'rare', points: 130, conditionField: 'carCommentsCreated', conditionValue: 10 },
  { key: 'followers_10', label: 'Pierwsza Publiczność', description: 'Zdobądź 10 obserwujących.', icon: '👥', category: 'social', rarity: 'rare', points: 160, conditionField: 'followersCount', conditionValue: 10 },
  { key: 'followers_50', label: 'Rozpoznawalny', description: 'Zdobądź 50 obserwujących.', icon: '🌟', category: 'social', rarity: 'epic', points: 420, conditionField: 'followersCount', conditionValue: 50 },
);

export function mergeAchievementCatalog(serverAchievements: Achievement[]): Achievement[] {
  const byKey = new Map<string, Achievement>();
  serverAchievements.forEach((achievement) => byKey.set(achievement.key, achievement));
  EXTRA_ACHIEVEMENTS.forEach((item, index) => {
    if (byKey.has(item.key)) return;
    byKey.set(item.key, {
      ...item,
      id: -1000 - index,
      currentValue: 0,
      progress: 0,
      unlocked: false,
      unlockedAt: null,
      active: false,
    });
  });
  return [...byKey.values()];
}
