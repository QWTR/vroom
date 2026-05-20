/**
 * Model monetyzacji VROOM — NIE mieszać Premium z Nitro.
 *
 * PREMIUM (subskrypcja / gift / admin):
 * - Baner profilu, personalizacja (motywy, gradienty, animacje)
 * - Więcej aut w garażu, więcej ogłoszeń na giełdzie
 * - GPS w tle podczas jazdy/nawigacji (free: tylko foreground)
 * - Skórki kursora wymagające Premium, wykresy statystyk itd.
 *
 * NITRO (waluta wirtualna — sklep ozdób):
 * - Obramówki avatara, banery ze sklepu, efekty wejścia (kosmetyka Discord-style)
 * - Kupno za Nitro lub wymiana punktów rankingu
 * - NIE odblokowuje funkcji Premium
 */

export const MONETIZATION = {
  premiumLabel: 'VROOM Premium',
  nitroLabel: 'Nitro',
  shopSubtitle: 'Dodatki kosmetyczne — osobno od subskrypcji Premium',
} as const;
