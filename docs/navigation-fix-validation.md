# Nawigacja — odbiór poprawki z 10.09.2026

## Zakres

Wspólna pozycja kamery i znacznika, zakończone w 400 ms przejście do śledzenia,
jedno źródło pozostałej linii trasy, odrzucanie poprzednich wyników przeliczenia,
zatrzymanie animacji ukrytej mapy i dostarczanie GPS bez grupowania podczas
widocznej jazdy. Wygląd mapy i dokładność GPS aktywnego przejazdu pozostają zachowane.

Nie potwierdzono jeszcze płynności na zgłoszonym telefonie ani oszczędności baterii.
Nie publikować do produkcji przed testem urządzenia. iOS wymaga osobnej kompilacji
na macOS i próby na urządzeniu.

## Wersja testowa Androida

Budować w konfiguracji release z osadzonym pakietem JavaScript, aby pomiar nie
obejmował serwera deweloperskiego. Lokalny wariant ma oznaczenie
`1.0.31-navfix-test`, architekturę `arm64-v8a` i wyłączone aktualizacje OTA.

Z katalogu `android`, przy skonfigurowanych Java i Node:

```powershell
$env:VROOM_NAVIGATION_TEST = '1'
.\gradlew.bat :app:assembleRelease :app:testDebugUnitTest -PvroomNavigationTest=true -PreactNativeArchitectures=arm64-v8a --max-workers=4
```

Wynik: `android/app/build/outputs/apk/release/app-release.apk`.
Lokalna konfiguracja podpisuje APK kluczem testowym projektu. Jeżeli telefon ma
instalację podpisaną innym kluczem, potrzebny jest pakiet z właściwym podpisem;
nie odinstalowywać obecnej aplikacji tylko po to, aby ominąć konflikt podpisów.
Przed próbą porównać wersję i sumę SHA-256 z informacją dołączoną do APK.

## Płynność i poprawność prowadzenia

1. Jazda prosto około 90–95 km/h: po wejściu w śledzenie znacznik nie skacze
   pionowo, kamera nie wykonuje cyklicznych korekt i nie powstają ukośne kolce trasy.
2. Zakręt, rondo, skrzyżowanie i równoległa droga: linia zachowuje wszystkie
   wierzchołki, a pozycja nie przeskakuje na inną gałąź trasy.
3. Przesunięcie mapy ręką i „Centruj”: jedno płynne przejście; sprawdzić też
   automatyczny powrót po zakończeniu gestu.
4. Zjechanie z trasy i przeliczenie: stara linia nie jest łączona prostą z autem,
   nowa pojawia się jako całość, spóźniony wynik nie przywraca poprzedniej trasy.
5. Postój, słaby GPS i krótka utrata sygnału: brak teleportacji i fałszywych skoków
   prędkości. Po powrocie GPS prowadzenie wraca do aktualnej pozycji.
6. Inna zakładka, wygaszenie ekranu przez 1–5 minut, powrót do mapy: brak odgrywania
   zaległych klatek. Przebieg, zapis przejazdu i komunikaty działają nadal.
7. Koniec przejazdu, ponowny start oraz Android Auto: brak podwójnego dostawcy GPS;
   ostatni zakończony odbiorca zwalnia dostawcę.

## Porównanie baterii A/B

- A: obecnie używana wersja. B: poprawiona wersja testowa. Ten sam telefon, trasa,
  jasność ekranu, profil wydajności, łączność, udostępnianie lokalizacji i funkcje CB.
- Co najmniej dwa porównania po 45–60 minut. Osobno ekran włączony i wygaszony.
  Zachować podobną temperaturę urządzenia i warunki przejazdu; bez ładowania.
- Najpierw zebrać pomiar A. Na czas pomiarów baterii wyłączyć nagrywanie ekranu;
  płynność nagrać w osobnej krótkiej próbie.
- Zapisać: model telefonu, Android, wersję aplikacji, ustawienia, czas start/koniec,
  poziom baterii start/koniec, dystans, przerwy GPS i zachowanie po powrocie z tła.
- W obu wersjach włączyć dostępne w ustawieniach „Pomiary zuzycia”. Zachować
  podsumowanie osobno dla każdego przebiegu. Sprawdzić także systemowe zużycie
  energii przez VROOM; spadek baterii telefonu obejmuje również inne aplikacje.

Przeliczenie: spadek punktów procentowych baterii / czas w godzinach. Poprawa:
`(zużycie A - zużycie B) / zużycie A × 100%`. Cel: minimum 20% w powtarzalnym
porównaniu bez pogorszenia prowadzenia. Przy niskiej rozdzielczości procentowego
wskaźnika potrzebne są dłuższe lub kolejne pomiary. Nie oznaczać baterii jako
naprawionej wyłącznie na podstawie testów automatycznych.

## Diagnostyka techniczna

Po włączeniu pomiarów natywny follower zgłasza zbiorcze liczniki najwyżej raz na
10 sekund: zapisy kamery, zapisy znacznika i wykonane klatki. Istniejący zapis
lokalny co minutę otrzymuje opcjonalną sekcję `navigation`, obejmującą również
przebudowy trasy, pracę ukrytego widoku i stan dostawcy GPS. Liczniki dotyczą
okna od ostatniego zbiorczego raportu wydajności; raport może je wyzerować.
W starszych zapisach sekcja nie występuje i nie wymaga migracji.

Przy ukrytej mapie animacja jest wyłączona i źródła wizualne nie są aktualizowane.
Kilku odbiorców GPS nie oznacza kilku dostawców: `consumerCount` może być większe
od jedności przy jednym wspólnym dostawcy. `immediateDelivery` powinno być aktywne
dla widocznej jazdy lub Android Auto, a nie dla samego przejazdu w tle.

Weryfikacja automatyczna obejmuje geometrię linii, opóźnione odpowiedzi przeliczenia,
cykl życia animacji, ograniczenie FPS, odrzucanie starszych próbek, prędkość,
prowadzenie głosowe i zgodność źródeł natywnych z pluginem. Testy natywne Androida
sprawdzają dokładną pozycję kamery przy 15/30/60 FPS i powrót podczas ruchu.

Znane problemy repozytorium sprzed poprawki: 173 błędy typów (po poprawce 172),
cztery błędy testów gamifikacji i nieaktualne oczekiwanie wersji runtime w jednym
teście OTA. Odtworzono je niezależnie z wcześniejszą konfiguracją testową.
