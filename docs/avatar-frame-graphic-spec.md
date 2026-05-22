# Avatar Frame Graphic Spec (PNG/GIF)

Specyfikacja dla grafika pod obramowki avatara (nakladka graficzna), zgodnie z implementacja `ShopAvatarDecoration`.

## 1) Format pliku

- Dozwolone:
  - `PNG` (statyczna obramowka, zalecane dla wiekszosci skinow)
  - `GIF` (animowana obramowka)
- Tlo: **pelna przezroczystosc** (`alpha`), bez prostokatnego tla.
- Proporcje: **1:1** (kwadrat).

## 2) Geometria (najwazniejsze)

Nakladka jest renderowana jako kwadrat, a avatar jest pod spodem jako kolo.

- `outer` (caly plik obramowki) = `1.28 * avatarSize`
- Z tego wynika:
  - srednica bezpiecznego kola avatara (srodek, ktory ma byc przezroczysty):  
    `avatarSize / outer = 0.78125` czyli **78.125% canvasu**
  - margines/ring na kazda strone:  
    `(1 - 0.78125) / 2 = 0.109375` czyli **10.9375% canvasu**

### Prosta instrukcja dla grafika

W pliku 1024x1024:

- narysuj kolo "avatar-safe zone" o srednicy **800 px** (78.125%)
- to kolo ma byc przezroczyste (albo prawie przezroczyste przy efektach)
- obszar efektu/obramowki: od promienia 400 px do krawedzi canvasu

## 3) Rzeczywiste rozmiary w aplikacji (runtime)

Te rozmiary sa uzywane w kodzie:

- Mapa live marker (snapshot): `size=40` -> obramowka renderuje sie jako `51.2 px`
- Mapa live marker fallback: `size=36` -> obramowka `46.08 px`
- Modal usera na mapie: `size=56` -> obramowka `71.68 px`
- Profil usera: `size=80` -> obramowka `102.4 px`
- Podglad w sklepie: `size=100` -> obramowka `128 px`

Dlatego plik musi dobrze wygladac juz od malej skali (~51 px) i nie moze miec zbyt cienkich detali.

## 4) Zalecane eksporty dla grafika

- Master:
  - `1024x1024` (PNG lub GIF)
- Opcjonalnie podglad:
  - `512x512` (lzejszy preview)

> Runtime i tak skaluje `contentFit="contain"`, ale master 1024 daje najlepsza ostrosc i zapas pod animacje.

## 5) Performance (praktyczne limity)

- PNG: najlepiej celowac w `< 600 KB`
- GIF: najlepiej `< 1.5 MB` (im lzejszy, tym plynniej na mapie)
- Dlugie/ciezkie GIF-y potrafia zwolnic render markerow live.

## 6) Animacje (GIF)

- Zalecane:
  - 12-24 FPS
  - petla `loop`
  - brak migania pelnym ekranem (efekt ma byc "ring", nie flash calego avatara)
- Unikaj ostrych bialych klatek (mogace wygladac jak bug/jitter na mapie).

## 7) Checklist przed wrzutka do sklepu

- [ ] Canvas kwadrat 1:1
- [ ] Przezroczysty srodek pod avatar (78.125% srednicy)
- [ ] Brak tla prostokatnego
- [ ] Czytelne przy ~51 px (fallback marker)
- [ ] Plik rozsadnej wagi
- [ ] Nazwa pliku bez spacji (np. `frame_flame_v1.gif`)

