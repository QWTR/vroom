# VROOM CarPlay

Natywny moduł CarPlay dla iOS 15.1+, oparty o `CarPlay`, Mapbox Maps 11.18.2
i Expo Modules API. Nie używa `react-native-carplay`.

## Zakres

- `CPMapTemplate` z natywną mapą VROOM w `CPWindow`;
- `CPNavigationSession`, manewry, ETA i estymaty podróży;
- `CPSearchTemplate`, ostatnie cele, kategorie i maksymalnie trzy warianty trasy;
- trasa, alternatywy, użytkownicy Live, ostrzeżenia, fotoradary, paliwo,
  partnerzy, zrzuty i cel;
- płynny marker 60 Hz, snap do trasy, interpolacja, ograniczone przewidywanie,
  course-up i kamera zależna od prędkości;
- synchronizacja start/stop/zgłoszenie z ekranem telefonu;
- token wyłącznie w Keychain;
- Socket.IO z REST fallbackiem;
- odtworzenie aktywnej sesji i odświeżanie warstw drogowych bez udziału JS;
- diagnostyka bez tokenów i dokładnych współrzędnych.

CarPlay nie zapisuje checkpointów dystansu. Jedynym właścicielem naliczania
kilometrów na iOS pozostaje istniejący background-drive.

## Wymagania podpisu

Konto Apple i profil provisioning muszą zawierać zatwierdzone uprawnienie:

`com.apple.developer.carplay-maps`

Plugin `plugins/withCarPlay.js` dodaje scenę CarPlay, entitlement, tryb
lokalizacji w tle, token publiczny Mapbox oraz scene delegate.

## Odbiór

Po zielonym buildzie EAS należy wykonać na macOS:

1. Czysty prebuild i instalację Pods.
2. Cold start w CarPlay Simulator.
3. Wyszukanie celu, wybór każdego z trzech wariantów i rozpoczęcie trasy.
4. Manewry, ETA, rerouting, dojazd, Stop i ponowne podłączenie.
5. Wszystkie warstwy, motywy, zgłoszenia, offline i utratę GPS.
6. Ekrany o różnych proporcjach, dotyk, pokrętło, pan i zoom.
7. Minimum 30 minut na prawdziwym iPhonie i jednostce CarPlay z pomiarem FPS,
   opóźnienia GPS i czasu reakcji przycisków.
